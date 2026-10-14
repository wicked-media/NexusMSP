"""Tests for the first executing provider adapter: Proxmox VE.

Covered contract:

- adapter: fail-closed when unconfigured, real task verification, honest
  verdicts (verified / inconclusive / failed / unknown), no secret leakage;
- router: permission gate, tenant/client scope, canonical descriptor
  validation, simulation is never an execution, destructive actions require
  independent approval, unconfigured execution fails closed with evidence,
  approved execution runs exactly once, provider failures are recorded and
  never reported as success;
- reconciliation (``app/services/proxmox_inventory.py``): the operator sync and
  the scheduled worker pass share one writer, a scheduled pass observes every
  tenant's configured connection inside that tenant's partition, one
  unreachable cluster is disclosed rather than fatal, a disabled schedule calls
  no provider, and the schedule an operator can read carries no other tenant's
  totals.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import proxmox  # noqa: E402
from app.services import (  # noqa: E402
    action_permissions,
    proxmox_adapter,
    proxmox_inventory,
    scope_permissions,
)
from app.services.action_permissions import (  # noqa: E402
    ACTION_PERMISSION_BY_ID,
    TECHNICIAN_DEFAULTS,
    assert_action_permission,
    require_action,
)
from app.services.nexus_protocol import validate_action_descriptor  # noqa: E402
from app.services.secret_store import encrypt_secret  # noqa: E402


# ============== FAKES ==============


def _matches(row: dict, query: dict | None) -> bool:
    """The Mongo query shapes the Proxmox router actually issues."""
    for key, condition in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, part) for part in condition):
                return False
        elif key == "$or":
            if not any(_matches(row, part) for part in condition):
                return False
        elif isinstance(condition, dict) and any(k.startswith("$") for k in condition):
            for op, operand in condition.items():
                if op == "$in":
                    if row.get(key) not in operand:
                        return False
                elif op == "$exists":
                    if (key in row) != bool(operand):
                        return False
                elif op == "$ne":
                    if row.get(key) == operand:
                        return False
                else:
                    raise AssertionError(f"unsupported operator {op}")
        elif row.get(key) != condition:
            return False
    return True


class Cursor:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def sort(self, field: str, direction: int = 1):
        self._rows.sort(key=lambda r: str(r.get(field) or ""), reverse=direction == -1)
        return self

    async def to_list(self, limit: int | None = None):
        return [dict(row) for row in self._rows[:limit]] if limit else [dict(row) for row in self._rows]


class FakeCollection:
    def __init__(self):
        self.rows: list[dict] = []

    def find(self, query=None, *_args, **_kwargs):
        return Cursor([dict(r) for r in self.rows if _matches(r, query)])

    async def find_one(self, query, *_args, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
        return None

    async def insert_one(self, doc):
        stored = dict(doc)
        stored.setdefault("_id", f"oid-{len(self.rows) + 1}")
        self.rows.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    async def update_one(self, query, update, *_args, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        if _kwargs.get("upsert"):
            stored = {**query, **update.get("$set", {})}
            stored.setdefault("_id", f"oid-{len(self.rows) + 1}")
            self.rows.append(stored)
            return SimpleNamespace(matched_count=0, upserted_id=stored["_id"])
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query, *_args, **_kwargs):
        for i, row in enumerate(self.rows):
            if _matches(row, query):
                del self.rows[i]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class FakeDb:
    def __init__(self):
        self._collections: dict[str, FakeCollection] = {}

    def __getattr__(self, name: str) -> FakeCollection:
        return self[name]

    def __getitem__(self, name: str) -> FakeCollection:
        if name.startswith("_"):
            raise AttributeError(name)
        return self._collections.setdefault(name, FakeCollection())


@pytest.fixture()
def fake_db(monkeypatch):
    database = FakeDb()
    monkeypatch.setattr(proxmox, "db", database)
    # The reconciliation writer is shared by the sync route and the scheduled
    # worker pass, so both modules must resolve the same fake database.
    monkeypatch.setattr(proxmox_inventory, "db", database)
    # Scope and permission denials are recorded by their own services.
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    return database


@pytest.fixture()
def event_log(monkeypatch):
    """Record platform events and activity entries instead of persisting them."""
    events: list[dict] = []
    activity: list[tuple] = []

    async def record_event(**kwargs):
        events.append(kwargs)

    async def record_activity(*args, **kwargs):
        activity.append((args, kwargs))

    monkeypatch.setattr(proxmox, "emit_platform_event", record_event)
    monkeypatch.setattr(proxmox, "log_activity", record_activity)
    # The reconciliation writer emits its own observation events and audit
    # entries from ``proxmox_inventory`` for both triggers.
    monkeypatch.setattr(proxmox_inventory, "emit_platform_event", record_event)
    monkeypatch.setattr(proxmox_inventory, "log_activity", record_activity)
    return SimpleNamespace(events=events, activity=activity)


ADMIN = {
    "id": "admin-1",
    "name": "Ada Admin",
    "role": "admin",
    "is_admin": True,
    "client_scope_mode": "all",
}

RESTRICTED_TECH = {
    "id": "tech-1",
    "name": "Tess Tech",
    "role": "technician",
    "is_admin": False,
    "client_scope_mode": "restricted",
    "client_scope_ids": ["client-a"],
}


def fake_request(path: str = "/api/proxmox/vms/vm-1/action"):
    return SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path=path),
        state=SimpleNamespace(correlation_id="corr-1"),
    )


def make_vm(**overrides) -> dict:
    vm = {
        "id": "vm-1",
        "name": "DC-PRIMARY",
        "server_id": "pve-1",
        "vmid": 100,
        "vm_type": "qemu",
        "node": "pve-node01",
        "client_id": "client-a",
        "client_name": "Acme",
        "status": "stopped",
    }
    vm.update(overrides)
    return vm


def configured_server(**overrides) -> dict:
    server = {
        "id": "pve-1",
        "name": "Acme PVE",
        "host": "pve.example.internal",
        "port": 8006,
        "username": "root@pam",
        "token_name": "nexus",
        "token_value": "00000000-1111-2222-3333-444444444444",
        "client_id": "client-a",
        "ssl_verify": False,
    }
    server.update(overrides)
    return server


# ============== ADAPTER: configuration and secrets ==============


def test_unconfigured_connection_fails_closed():
    assert proxmox_adapter.load_connection(None) is None
    assert proxmox_adapter.load_connection({"id": "x", "host": ""}) is None
    no_token = proxmox_adapter.load_connection(configured_server(token_value="", token_name=""))
    assert no_token is not None and no_token.configured is False
    with pytest.raises(proxmox_adapter.ProxmoxNotConfigured):
        proxmox_adapter.ProxmoxClient(no_token)


def test_connection_decrypts_stored_token_and_summary_never_exposes_it():
    secret = "abcd1234-efgh-5678-ijkl-mnopqrstuvwx"
    doc = configured_server(token_value=encrypt_secret(secret))
    connection = proxmox_adapter.load_connection(doc)
    assert connection.configured is True
    assert secret in (connection.token_header or "")

    summary = proxmox_adapter.connection_summary(doc)
    assert summary["configured"] is True
    assert secret not in json.dumps(summary)
    assert "token" not in json.dumps(summary).lower().replace("token_value", "")


def test_plaintext_legacy_token_still_loads():
    connection = proxmox_adapter.load_connection(configured_server())
    assert connection.configured is True
    assert connection.token_header.startswith("PVEAPIToken=root@pam!nexus=")


def test_guest_ref_refuses_records_without_a_provider_binding():
    with pytest.raises(proxmox_adapter.ProxmoxBindingError) as excinfo:
        proxmox_adapter.guest_ref({"id": "vm-9", "vmid": None, "node": ""})
    assert "will not invent a target" in str(excinfo.value)


# ============== ADAPTER: execution and verification ==============


def _connection() -> proxmox_adapter.ProxmoxConnection:
    return proxmox_adapter.ProxmoxConnection(
        server_id="pve-1",
        name="Acme PVE",
        base_url="https://pve.example.internal:8006",
        token_header="PVEAPIToken=root@pam!nexus=SUPER-SECRET",
        ssl_verify=False,
        client_id="client-a",
        tenant_id=None,
    )


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def _route_handler(handler):
    """The request handler for the documented Proxmox paths."""

    def inner(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/status/start") or path.endswith("/status/shutdown"):
            return httpx.Response(200, json={"data": "UPID:pve01:00000ABCD:1234:6520ABCD:qmstart:100:root@pam:"})
        if "/tasks/" in path and path.endswith("/status"):
            return httpx.Response(200, json={"data": handler["task"]})
        if path.endswith("/status/current"):
            return httpx.Response(200, json={"data": {"status": handler.get("current", "running")}})
        if path.endswith("/version"):
            return httpx.Response(200, json={"data": {"version": "8.2.4"}})
        if path.endswith("/nodes"):
            return httpx.Response(200, json={"data": [
                {"node": "pve-node01", "status": "online", "cpu": 0.342,
                 "mem": 6_750_000_000, "maxmem": 10_000_000_000,
                 "disk": 45_000_000_000, "maxdisk": 100_000_000_000, "uptime": 7200},
            ]})
        if path.endswith("/cluster/resources"):
            return httpx.Response(200, json={"data": [
                {"node": "pve-node01", "vmid": 100, "name": "DC-PRIMARY", "status": "running", "type": "qemu"},
                {"node": "pve-node01", "vmid": 101, "name": "SQL-DB-01", "status": "stopped", "type": "qemu"},
            ]})
        return httpx.Response(404, json={"data": None, "message": "no such path"})

    return inner


def _route(handler):
    """Build a MockTransport that answers the documented Proxmox paths."""
    return _transport(_route_handler(handler))


def test_execute_power_action_verifies_against_provider_task_and_state():
    transport = _route({"task": {"status": "stopped", "exitstatus": "OK"}, "current": "running"})
    result = asyncio.run(
        proxmox_adapter.execute_power_action(
            _connection(), make_vm(status="stopped"), "start",
            transport=transport, poll_interval=0.01,
        )
    )
    assert result["verification"]["verdict"] == "verified"
    assert result["verification"]["observed_status"] == "running"
    assert result["task"]["exitstatus"] == "OK"
    assert result["submitted"]["upid"].startswith("UPID:")
    assert any("matches the pre-action expectation" in e for e in result["verification"]["evidence"])


def test_execute_power_action_reports_inconclusive_when_state_mismatches():
    transport = _route({"task": {"status": "stopped", "exitstatus": "OK"}, "current": "stopped"})
    result = asyncio.run(
        proxmox_adapter.execute_power_action(
            _connection(), make_vm(status="running"), "start",
            transport=transport, poll_interval=0.01,
        )
    )
    assert result["verification"]["verdict"] == "inconclusive"
    assert result["verification"]["observed_status"] == "stopped"
    assert result["verification"]["expected_status"] == "running"


def test_execute_power_action_reports_failed_task_exitstatus():
    transport = _route({"task": {"status": "stopped", "exitstatus": "task failed"}})
    result = asyncio.run(
        proxmox_adapter.execute_power_action(
            _connection(), make_vm(), "shutdown",
            transport=transport, poll_interval=0.01,
        )
    )
    assert result["verification"]["verdict"] == "failed"
    assert "task failed" in " ".join(result["verification"]["evidence"])


def test_execute_power_action_unknown_when_task_never_finishes():
    transport = _route({"task": {"status": "running"}})
    result = asyncio.run(
        proxmox_adapter.execute_power_action(
            _connection(), make_vm(), "start",
            transport=transport, task_timeout=0.0, poll_interval=0.0,
        )
    )
    assert result["verification"]["verdict"] == "unknown"
    assert result["task"]["timed_out"] is True
    assert result["observed"]["status"] is None


def test_unreachable_provider_raises_and_claims_nothing():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(proxmox_adapter.ProxmoxProviderError) as excinfo:
        asyncio.run(
            proxmox_adapter.execute_power_action(
                _connection(), make_vm(), "start",
                transport=_transport(boom), poll_interval=0.01,
            )
        )
    assert excinfo.value.kind == "unreachable"
    assert "no change was made" in excinfo.value.detail


def test_auth_failure_detail_never_leaks_the_token():
    def deny(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"data": None, "message": "invalid auth"})

    with pytest.raises(proxmox_adapter.ProxmoxProviderError) as excinfo:
        asyncio.run(
            proxmox_adapter.execute_power_action(
                _connection(), make_vm(), "start",
                transport=_transport(deny), poll_interval=0.01,
            )
        )
    assert excinfo.value.kind == "auth"
    assert "SUPER-SECRET" not in excinfo.value.detail


def test_suspend_verifies_on_task_outcome_without_asserting_an_end_state():
    spec = proxmox_adapter.action_spec("suspend")
    assert spec["expected_status"] is None
    verdict = proxmox_adapter.verify_power_action(
        spec, {"finished": True, "exitstatus": "OK"}, observed_status="running"
    )
    assert verdict["verdict"] == "verified"
    assert "not asserted" in verdict["evidence"][0]


def test_simulation_is_never_an_execution():
    simulation = proxmox_adapter.simulate_power_action(make_vm(), "stop", actor_id="tech-1")
    assert simulation["executed"] is False
    assert simulation["status"] == "simulated"
    assert simulation["mode"] == "simulation"
    assert simulation["destructive"] is True
    assert simulation["rollback"]["action"] == "start"
    assert any("require independent approval" in step for step in simulation["plan"])
    assert "did not call Proxmox" in simulation["note"]


def test_every_provider_call_uses_the_documented_api2json_prefix():
    """A Proxmox call that misses ``/api2/json`` reaches the web UI, not the API."""
    seen: list[str] = []
    dispatch = _route_handler({"task": {"status": "stopped", "exitstatus": "OK"}, "current": "running"})

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        return dispatch(request)

    inventory = asyncio.run(
        proxmox_adapter.fetch_inventory(_connection(), transport=_transport(recording))
    )
    result = asyncio.run(
        proxmox_adapter.execute_power_action(
            _connection(), make_vm(status="stopped"), "start",
            transport=_transport(recording), poll_interval=0.01,
        )
    )

    assert inventory["nodes"] and inventory["guests"]
    assert result["verification"]["verdict"] == "verified"
    assert seen, "expected the adapter to call the provider"
    assert all(path.startswith("/api2/json/") for path in seen), seen


def test_fetch_inventory_carries_provenance():
    inventory = asyncio.run(
        proxmox_adapter.fetch_inventory(_connection(), transport=_route({}))
    )
    assert inventory["source"] == "proxmox:pve-1"
    assert inventory["observed_at"]
    assert inventory["version"] == "8.2.4"
    assert inventory["nodes"][0]["cpu_usage"] == 34.2
    assert inventory["nodes"][0]["memory_usage"] == 67.5
    assert inventory["nodes"][0]["vm_count"] == 2


# ============== PERMISSION GATE ==============


def test_power_action_permission_is_registered_and_denied_by_default_for_technicians():
    assert "virtualization.vm.control" in ACTION_PERMISSION_BY_ID
    assert "virtualization.vm.control" not in TECHNICIAN_DEFAULTS
    assert callable(require_action("virtualization.vm.control"))


def test_technician_without_the_grant_is_denied_with_evidence(fake_db):
    # A missing grant is a 403 with a recorded denial, not a silent no-op.
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(assert_action_permission(RESTRICTED_TECH, "virtualization.vm.control"))
    assert excinfo.value.status_code == 403
    assert excinfo.value.headers["X-Required-Permission"] == "virtualization.vm.control"
    assert len(fake_db.permission_denials.rows) == 1
    assert fake_db.permission_denials.rows[0]["permission"] == "virtualization.vm.control"


def test_admin_role_holds_the_power_action_permission(fake_db):
    # An allowed evaluation returns the actor unchanged and records no denial.
    assert asyncio.run(assert_action_permission(ADMIN, "virtualization.vm.control")) is ADMIN
    assert not fake_db.permission_denials.rows


# ============== DESCRIPTOR ==============


def test_descriptor_for_every_power_action_validates_against_the_protocol():
    for action, spec in proxmox_adapter.VM_ACTIONS.items():
        descriptor = proxmox._build_descriptor(
            vm=make_vm(), action=action, spec=spec,
            user=ADMIN, mode="execute", reason="ticket-1",
        )
        validation = validate_action_descriptor(descriptor)
        assert validation["valid"], f"{action}: {validation['problems']}"
        assert descriptor["destructive"] is spec["destructive"]
        assert descriptor["rollback"]["plan"].startswith("perform")
        assert descriptor["target"]["nexus_id"] == "vm-1"


def test_descriptor_rejects_missing_actor_scope_and_rollback():
    validation = validate_action_descriptor({
        "action": "configure",
        "actor": {"kind": "technician", "id": ""},
        "target": {"kind": "device", "nexus_id": ""},
        "scope": {},
        "destructive": True,
        "autonomy_level": "act",
    })
    assert validation["valid"] is False
    joined = " ".join(validation["problems"])
    assert "actor.id" in joined
    assert "tenant_id" in joined
    assert "rollback plan" in joined


# ============== ROUTER ==============


def _seed_vm(db, **overrides):
    db.proxmox_vms.rows.append(make_vm(**overrides))


def test_unknown_action_is_rejected(fake_db, event_log):
    _seed_vm(fake_db)
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.vm_action(
            "vm-1", {"action": "explode"}, fake_request(), current_user=ADMIN,
        ))
    assert excinfo.value.status_code == 400
    assert "start" in excinfo.value.detail


def test_simulation_records_evidence_and_makes_no_provider_call(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)

    def must_not_run(*_args, **_kwargs):
        raise AssertionError("simulation must never reach the provider")

    monkeypatch.setattr(proxmox_adapter, "execute_power_action", must_not_run)

    response = asyncio.run(proxmox.vm_action(
        "vm-1", {"action": "start", "mode": "simulate"}, fake_request(), current_user=ADMIN,
    ))
    assert response["status"] == "simulated"
    assert response["executed"] is False
    assert response["simulation"]["executed"] is False

    stored = fake_db.proxmox_vm_actions.rows[0]
    assert stored["status"] == "simulated"
    assert stored["tenant_id"] == "nexus-local"
    assert stored["descriptor"]["autonomy_level"] == "suggest"
    assert event_log.activity and event_log.activity[0][0][1] == "proxmox_vm_action_simulated"
    assert event_log.events[0]["subject"] == "virtualization.vm.action.simulated"


def test_execution_without_a_connection_fails_closed_with_evidence(fake_db, event_log):
    _seed_vm(fake_db)  # no proxmox_servers row: nothing is configured

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.vm_action(
            "vm-1", {"action": "start"}, fake_request(), current_user=ADMIN,
        ))
    assert excinfo.value.status_code == 409
    assert "nothing was executed" in excinfo.value.detail

    stored = fake_db.proxmox_vm_actions.rows[0]
    assert stored["status"] == "not_configured"
    assert stored["failure_kind"] == "not_configured"
    assert any(args[1] == "proxmox_vm_action_blocked" for args, _ in event_log.activity)
    assert event_log.events[0]["subject"] == "virtualization.vm.action.blocked"


def test_destructive_action_waits_for_independent_approval(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)
    fake_db.proxmox_servers.rows.append(configured_server())
    approvals: list[dict] = []

    async def fake_approval(data, user):
        approvals.append(data)
        return {"id": "APR-1", "status": "pending"}

    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("an unapproved destructive action must not execute")

    monkeypatch.setattr(proxmox, "create_approval", fake_approval)
    monkeypatch.setattr(proxmox_adapter, "execute_power_action", must_not_run)

    response = asyncio.run(proxmox.vm_action(
        "vm-1", {"action": "stop", "reason": "ticket-42"}, fake_request(),
        current_user=ADMIN,
    ))
    assert response["status"] == "pending_approval"
    assert response["executed"] is False
    assert response["approval"]["id"] == "APR-1"
    assert approvals and approvals[0]["ref_type"] == "proxmox_vm_action"
    assert approvals[0]["approver_role"] == "admin"

    stored = fake_db.proxmox_vm_actions.rows[0]
    assert stored["status"] == "pending_approval"
    assert stored["approval_id"] == "APR-1"
    assert stored["destructive"] is True
    assert event_log.events[0]["subject"] == "virtualization.vm.action.approval.requested"


def _verified_result(action: str = "start") -> dict:
    return {
        "provider": "proxmox",
        "connection_id": "pve-1",
        "action": action,
        "destructive": False,
        "node": "pve-node01",
        "vmid": "100",
        "kind": "qemu",
        "submitted": {"upid": "UPID:pve01:00000ABCD", "submitted_at": "2026-01-01T00:00:00+00:00"},
        "task": {"finished": True, "exitstatus": "OK", "timed_out": False},
        "observed": {"status": "running", "observed_at": "2026-01-01T00:00:01+00:00"},
        "verification": {
            "verdict": "verified",
            "expected_status": "running",
            "observed_status": "running",
            "evidence": ["observed guest status 'running' matches the pre-action expectation"],
            "plan": "task OK and status running",
        },
    }


def test_non_destructive_action_executes_and_records_verification(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)
    fake_db.proxmox_servers.rows.append(configured_server())
    calls: list[str] = []

    async def fake_execute(connection, guest, action, **kwargs):
        calls.append(action)
        assert connection.server_id == "pve-1"
        return _verified_result(action)

    monkeypatch.setattr(proxmox_adapter, "execute_power_action", fake_execute)

    response = asyncio.run(proxmox.vm_action(
        "vm-1", {"action": "start"}, fake_request(), current_user=ADMIN,
    ))
    assert calls == ["start"]
    assert response["status"] == "completed"
    assert response["executed"] is True
    assert response["verified"] is True
    assert response["verification"]["verdict"] == "verified"

    stored = fake_db.proxmox_vm_actions.rows[0]
    assert stored["status"] == "completed"
    assert stored["task"]["exitstatus"] == "OK"
    assert stored["descriptor"]["destructive"] is False
    assert any(args[1] == "proxmox_vm_action_completed" for args, _ in event_log.activity)
    assert event_log.events[0]["subject"] == "virtualization.vm.action.completed"


def test_provider_failure_is_recorded_and_never_returned_as_success(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)
    fake_db.proxmox_servers.rows.append(configured_server())

    async def fail(*_args, **_kwargs):
        raise proxmox_adapter.ProxmoxProviderError(
            "Nexus could not reach the Proxmox API; no change was made.",
            kind="unreachable",
        )

    monkeypatch.setattr(proxmox_adapter, "execute_power_action", fail)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.vm_action(
            "vm-1", {"action": "start"}, fake_request(), current_user=ADMIN,
        ))
    assert excinfo.value.status_code == 502
    assert "no change was made" in excinfo.value.detail

    stored = fake_db.proxmox_vm_actions.rows[0]
    assert stored["status"] == "execution_failed"
    assert stored["failure_kind"] == "unreachable"
    assert event_log.events[0]["subject"] == "virtualization.vm.action.failed"


def test_inconclusive_outcome_is_not_reported_as_verified(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)
    fake_db.proxmox_servers.rows.append(configured_server())

    async def mismatch(*_args, **_kwargs):
        result = _verified_result()
        result["verification"].update(
            {"verdict": "inconclusive", "observed_status": "stopped"}
        )
        return result

    monkeypatch.setattr(proxmox_adapter, "execute_power_action", mismatch)

    response = asyncio.run(proxmox.vm_action(
        "vm-1", {"action": "start"}, fake_request(), current_user=ADMIN,
    ))
    assert response["status"] == "completed_unverified"
    assert response["verified"] is False


def test_unknown_outcome_raises_after_the_evidence_is_written(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)
    fake_db.proxmox_servers.rows.append(configured_server())

    async def timed_out(*_args, **_kwargs):
        result = _verified_result()
        result["task"] = {"finished": False, "exitstatus": None, "timed_out": True}
        result["verification"].update({"verdict": "unknown", "observed_status": None})
        return result

    monkeypatch.setattr(proxmox_adapter, "execute_power_action", timed_out)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.vm_action(
            "vm-1", {"action": "start"}, fake_request(), current_user=ADMIN,
        ))
    assert excinfo.value.status_code == 504
    stored = fake_db.proxmox_vm_actions.rows[0]
    assert stored["status"] == "outcome_unknown"


def test_approved_destructive_action_executes_exactly_once(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)
    fake_db.proxmox_servers.rows.append(configured_server())
    approvals: list[dict] = []

    async def fake_approval(data, user):
        approvals.append(data)
        return {"id": "APR-9", "status": "pending"}

    async def fake_execute(*_args, **_kwargs):
        return _verified_result("shutdown")

    monkeypatch.setattr(proxmox, "create_approval", fake_approval)
    monkeypatch.setattr(proxmox_adapter, "execute_power_action", fake_execute)

    requested = asyncio.run(proxmox.vm_action(
        "vm-1", {"action": "shutdown"}, fake_request(), current_user=ADMIN,
    ))
    assert requested["status"] == "pending_approval"
    action_id = requested["id"]

    # Nobody has approved it yet: execution must be refused.
    with pytest.raises(HTTPException) as unapproved:
        asyncio.run(proxmox.execute_approved_vm_action(
            "vm-1", action_id, fake_request(), current_user=ADMIN,
        ))
    assert unapproved.value.status_code == 409

    # An independent admin approves it.
    fake_db.approvals.rows.append({
        "id": "APR-9", "ref_id": action_id, "status": "approved",
        "decided_by": "admin-2",
    })

    response = asyncio.run(proxmox.execute_approved_vm_action(
        "vm-1", action_id, fake_request(), current_user=ADMIN,
    ))
    assert response["status"] == "completed"
    assert response["verified"] is True

    # A replay cannot execute it a second time.
    with pytest.raises(HTTPException) as replay:
        asyncio.run(proxmox.execute_approved_vm_action(
            "vm-1", action_id, fake_request(), current_user=ADMIN,
        ))
    assert replay.value.status_code == 409
    assert fake_db.proxmox_vm_actions.rows[0]["status"] == "completed"


def test_restricted_technician_cannot_act_on_another_clients_vm(fake_db, event_log):
    _seed_vm(fake_db, client_id="client-b", client_name="Other Co")

    # A foreign record must be indistinguishable from a missing one (404),
    # while the denial itself is still recorded for audit.
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.vm_action(
            "vm-1", {"action": "start", "mode": "simulate"}, fake_request(),
            current_user=RESTRICTED_TECH,
        ))
    assert excinfo.value.status_code == 404
    assert not fake_db.proxmox_vm_actions.rows
    assert fake_db.scope_denials.rows
    assert fake_db.scope_denials.rows[0]["client_id"] == "client-b"


def test_tenant_partition_constrains_the_action_record_lookup(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db, tenant_id="other-tenant")
    tenant_bound_admin = dict(ADMIN, tenant_id="tenant-2")

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.vm_action(
            "vm-1", {"action": "start", "mode": "simulate"}, fake_request(),
            current_user=tenant_bound_admin,
        ))
    assert excinfo.value.status_code == 404  # foreign records are indistinguishable
    assert not fake_db.proxmox_vm_actions.rows


def test_idempotency_key_returns_the_first_recorded_outcome(fake_db, event_log, monkeypatch):
    _seed_vm(fake_db)

    def must_not_run(*_args, **_kwargs):
        raise AssertionError("a replayed request must not execute again")

    monkeypatch.setattr(proxmox_adapter, "execute_power_action", must_not_run)

    first = asyncio.run(proxmox.vm_action(
        "vm-1", {"action": "start", "mode": "simulate", "idempotency_key": "job-7"},
        fake_request(), current_user=ADMIN,
    ))
    replay = asyncio.run(proxmox.vm_action(
        "vm-1", {"action": "start", "mode": "simulate", "idempotency_key": "job-7"},
        fake_request(), current_user=ADMIN,
    ))
    assert first["id"] == replay["id"]
    assert replay["idempotent_replay"] is True
    assert len(fake_db.proxmox_vm_actions.rows) == 1


def test_action_log_requires_scope_and_returns_attributable_history(fake_db, event_log):
    _seed_vm(fake_db, client_id="client-b")
    with pytest.raises(HTTPException):
        asyncio.run(proxmox.get_vm_action_log("vm-1", current_user=RESTRICTED_TECH))

    fake_db.proxmox_vms.rows.clear()
    _seed_vm(fake_db)
    fake_db.proxmox_vm_actions.rows.append({
        "id": "PXA-1", "vm_id": "vm-1", "client_id": "client-a",
        "tenant_id": "nexus-local", "status": "completed",
        "requested_by": "admin-1", "created_at": "2026-01-01T00:00:00+00:00",
    })
    rows = asyncio.run(proxmox.get_vm_action_log("vm-1", current_user=ADMIN))
    assert rows and rows[0]["id"] == "PXA-1"


# ============== READ PATHS: scoped, provenance, no fabrication ==============


def test_nodes_are_empty_and_unfabricated_without_a_connection(fake_db, event_log):
    nodes = asyncio.run(proxmox.get_proxmox_nodes(current_user=ADMIN))
    assert nodes == []  # the previous implementation invented three demo nodes


def test_nodes_come_from_the_provider_with_provenance(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server())

    async def fake_inventory(connection, **_kwargs):
        return {
            "provider": "proxmox",
            "source": f"proxmox:{connection.server_id}",
            "observed_at": "2026-01-01T00:00:00+00:00",
            "version": "8.2.4",
            "nodes": [{
                "node": "pve-node01", "status": "online", "cpu_usage": 34.2,
                "memory_usage": 67.5, "disk_usage": 45.0, "uptime_hours": 2, "vm_count": 8,
            }],
            "guests": [],
        }

    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", fake_inventory)
    nodes = asyncio.run(proxmox.get_proxmox_nodes(current_user=ADMIN))
    assert len(nodes) == 1
    assert nodes[0]["source"] == "proxmox:pve-1"
    assert nodes[0]["observed_at"] == "2026-01-01T00:00:00+00:00"
    assert nodes[0]["status"] == "online"


def test_connection_endpoint_reports_health_without_leaking_the_token(fake_db, event_log, monkeypatch):
    secret = "feedface-0000-1111-2222-333333333333"
    fake_db.proxmox_servers.rows.append(configured_server(token_value=encrypt_secret(secret)))

    class StubClient:
        def __init__(self, connection, **_kwargs):
            self.connection = connection

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

        async def version(self):
            return {"version": "8.2.4"}

    monkeypatch.setattr(proxmox_adapter, "ProxmoxClient", StubClient)

    response = asyncio.run(proxmox.get_proxmox_connection(current_user=ADMIN))
    assert response["configured"] is True
    assert response["mode"] == "execute"
    assert response["connections"][0]["health"] == "ok"
    assert secret not in json.dumps(response)


def test_connection_endpoint_reports_unconfigured_mode(fake_db, event_log):
    response = asyncio.run(proxmox.get_proxmox_connection(current_user=ADMIN))
    assert response["configured"] is False
    assert response["mode"] == "unconfigured"


def test_connection_list_is_client_scoped_for_restricted_technicians(fake_db, event_log):
    fake_db.proxmox_servers.rows.append(configured_server(id="pve-a", client_id="client-a"))
    fake_db.proxmox_servers.rows.append(configured_server(id="pve-b", client_id="client-b"))

    class StubClient:
        def __init__(self, connection, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

        async def version(self):
            return {"version": "8.2.4"}

    # The restricted technician only ever sees their own client's connection.
    original = proxmox_adapter.ProxmoxClient
    proxmox_adapter.ProxmoxClient = StubClient
    try:
        response = asyncio.run(proxmox.get_proxmox_connection(current_user=RESTRICTED_TECH))
    finally:
        proxmox_adapter.ProxmoxClient = original
    assert [c["server_id"] for c in response["connections"]] == ["pve-a"]


def test_stored_vm_inventory_is_returned_empty_rather_than_invented(fake_db, event_log):
    rows = asyncio.run(proxmox.get_proxmox_vms(current_user=ADMIN))
    assert rows == []
    _seed_vm(fake_db)
    rows = asyncio.run(proxmox.get_proxmox_vms(current_user=ADMIN))
    assert [row["id"] for row in rows] == ["vm-1"]


def test_backup_records_say_requested_rather_than_claiming_a_running_job(fake_db, event_log):
    created = asyncio.run(proxmox.create_backup(
        {"vm_id": "vm-1", "vm_name": "DC-PRIMARY"}, current_user=ADMIN,
    ))
    assert created["status"] == "requested"
    assert created["execution"] == "not_connected"

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.restore_backup("missing-backup", {}, current_user=ADMIN))
    assert excinfo.value.status_code == 404


# ============== INVENTORY SYNC: store what the provider reported ==============


def provider_guest(**overrides) -> dict:
    guest = {
        "node": "pve-node01",
        "vmid": 100,
        "name": "DC-PRIMARY",
        "status": "running",
        "type": "qemu",
    }
    guest.update(overrides)
    return guest


def fake_inventory(guests: list[dict], nodes: list[dict] | None = None, observed_at="2026-10-12T00:00:00+00:00"):
    """A provider observation in the shape ``fetch_inventory`` really returns."""

    async def inner(connection, **_kwargs):
        return {
            "provider": "proxmox",
            "source": f"proxmox:{connection.server_id}",
            "observed_at": observed_at,
            "version": "8.2.4",
            "nodes": nodes if nodes is not None else [],
            "guests": guests,
        }

    return inner


def test_inventory_sync_stores_the_provider_binding_with_provenance(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server())
    monkeypatch.setattr(
        proxmox_adapter, "fetch_inventory",
        fake_inventory([provider_guest(), provider_guest(vmid=101, name="SQL-DB-01", status="stopped")]),
    )

    result = asyncio.run(proxmox.sync_proxmox_inventory("pve-1", current_user=ADMIN))
    assert result["observed"] == 2 and result["created"] == 2 and result["removed"] == 0
    assert result["source"] == "proxmox:pve-1" and result["observed_at"] == "2026-10-12T00:00:00+00:00"

    rows = {row["id"]: row for row in fake_db.proxmox_vms.rows}
    assert set(rows) == {"pve-1:qemu:100", "pve-1:qemu:101"}
    first = rows["pve-1:qemu:100"]
    # The stored row carries exactly the coordinates a power action needs to bind.
    assert first["node"] == "pve-node01" and first["node_name"] == "pve-node01"
    assert first["vmid"] == 100 and first["type"] == "qemu" and first["vm_type"] == "qemu"
    assert first["status"] == "running"
    assert first["tenant_id"] == "nexus-local" and first["client_id"] == "client-a"
    assert first["source"] == "proxmox:pve-1" and first["observed_at"]
    assert any(args[1] == "proxmox_inventory_synced" for args, _ in event_log.activity)
    assert event_log.events[0]["subject"] == "virtualization.inventory.observed"

    # A second observation updates in place rather than duplicating guests.
    result = asyncio.run(proxmox.sync_proxmox_inventory("pve-1", current_user=ADMIN))
    assert result["updated"] == 2 and result["created"] == 0
    assert len(fake_db.proxmox_vms.rows) == 2


def test_inventory_sync_removes_a_guest_the_provider_no_longer_reports(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server())
    # A guest the provider stopped reporting, as a real retirement would look.
    fake_db.proxmox_vms.rows.append({
        "id": "pve-1:qemu:999", "server_id": "pve-1", "tenant_id": "nexus-local",
        "name": "RETIRED-GUEST", "status": "stopped",
    })
    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", fake_inventory([provider_guest()]))

    result = asyncio.run(proxmox.sync_proxmox_inventory("pve-1", current_user=ADMIN))
    assert result["removed"] == 1 and result["created"] == 1
    assert [row["id"] for row in fake_db.proxmox_vms.rows] == ["pve-1:qemu:100"]


def test_inventory_sync_never_invents_a_guest_it_cannot_bind(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server())
    monkeypatch.setattr(
        proxmox_adapter, "fetch_inventory",
        fake_inventory([provider_guest(), {"node": "pve-node01", "type": "qemu", "name": "NO-VMID"}]),
    )

    result = asyncio.run(proxmox.sync_proxmox_inventory("pve-1", current_user=ADMIN))
    assert result["observed"] == 1 and result["unbindable"] == 1
    assert [row["name"] for row in fake_db.proxmox_vms.rows] == ["DC-PRIMARY"]


def test_inventory_sync_refuses_an_unconfigured_connection(fake_db, event_log):
    fake_db.proxmox_servers.rows.append(configured_server(token_value="", token_name=""))

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.sync_proxmox_inventory("pve-1", current_user=ADMIN))
    assert excinfo.value.status_code == 409
    assert "no inventory was observed" in excinfo.value.detail
    assert not fake_db.proxmox_vms.rows


def test_inventory_sync_reports_an_unreachable_provider_and_writes_nothing(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server())

    async def unreachable(*_args, **_kwargs):
        raise proxmox_adapter.ProxmoxProviderError(
            "Nexus could not reach the Proxmox API; no change was made.", kind="unreachable",
        )

    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", unreachable)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.sync_proxmox_inventory("pve-1", current_user=ADMIN))
    assert excinfo.value.status_code == 502
    assert "no change was made" in excinfo.value.detail
    assert not fake_db.proxmox_vms.rows
    assert any(args[1] == "proxmox_inventory_sync_failed" for args, _ in event_log.activity)
    assert not event_log.events  # a failed observation is not reported as an observation


def test_inventory_sync_is_scoped_to_the_actor(fake_db, event_log):
    fake_db.proxmox_servers.rows.append(configured_server(id="pve-b", client_id="client-b"))

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(proxmox.sync_proxmox_inventory("pve-b", current_user=RESTRICTED_TECH))
    assert excinfo.value.status_code == 404
    assert not fake_db.proxmox_vms.rows


# ====== SCHEDULED RECONCILIATION: current without an operator pressing sync ======


def test_the_durable_worker_registers_the_proxmox_reconciliation_loop():
    """Scheduled reconciliation is a registered durable loop, not a promise."""
    import server

    loops = dict(server.background_worker_specs())
    assert callable(loops.get("proxmox-inventory"))


def test_a_scheduled_pass_observes_each_connection_in_its_own_tenant(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(
        configured_server(id="pve-a", tenant_id="tenant-a", client_id="client-a")
    )
    fake_db.proxmox_servers.rows.append(
        configured_server(id="pve-b", tenant_id="tenant-b", client_id="client-b")
    )
    # A connection with no stored token has nothing to observe.
    fake_db.proxmox_servers.rows.append(configured_server(id="pve-c", token_value="", token_name=""))

    async def provider(connection, **_kwargs):
        guest = provider_guest() if connection.server_id == "pve-a" else provider_guest(vmid=200, name="SQL-DB-01")
        return {
            "provider": "proxmox",
            "source": f"proxmox:{connection.server_id}",
            "observed_at": "2026-10-12T00:00:00+00:00",
            "version": "8.2.4",
            "nodes": [],
            "guests": [guest],
        }

    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", provider)

    summary = asyncio.run(proxmox_inventory.reconcile_configured_connections())

    assert summary["trigger"] == "scheduled" and summary["enabled"] is True
    assert summary["connections"] == 3
    assert summary["configured"] == 2 and summary["observed"] == 2 and summary["failed"] == 0
    assert summary["unconfigured"] == 1 and summary["guests"] == 2

    rows = {row["id"]: row for row in fake_db.proxmox_vms.rows}
    # Each projection row lands in the partition that owns its connection, so the
    # tenant that owns the cluster can read back what the schedule observed — and
    # a pass that runs with no authenticated user can write it at all.
    assert rows["pve-a:qemu:100"]["tenant_id"] == "tenant-a"
    assert rows["pve-a:qemu:100"]["client_id"] == "client-a"
    assert rows["pve-b:qemu:200"]["tenant_id"] == "tenant-b"
    assert not any(row["server_id"] == "pve-c" for row in fake_db.proxmox_vms.rows)


def test_one_unreachable_cluster_is_disclosed_rather_than_fatal(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server(id="pve-a", client_id="client-a"))
    fake_db.proxmox_servers.rows.append(configured_server(id="pve-b", client_id="client-b"))

    async def provider(connection, **_kwargs):
        if connection.server_id == "pve-a":
            raise proxmox_adapter.ProxmoxProviderError(
                "Nexus could not reach the Proxmox API; no change was made.", kind="unreachable",
            )
        return {
            "provider": "proxmox",
            "source": f"proxmox:{connection.server_id}",
            "observed_at": "2026-10-12T00:00:00+00:00",
            "version": "8.2.4",
            "nodes": [],
            "guests": [provider_guest(vmid=200, name="SQL-DB-01")],
        }

    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", provider)

    summary = asyncio.run(proxmox_inventory.reconcile_configured_connections())

    assert summary["observed"] == 1 and summary["failed"] == 1 and summary["guests"] == 1
    assert [entry["status"] for entry in summary["results"]] == ["unreachable", "ok"]
    assert [row["server_id"] for row in fake_db.proxmox_vms.rows] == ["pve-b"]

    # The failure belongs to the connection that failed, with its reason recorded.
    failed = next(row for row in fake_db.proxmox_servers.rows if row["id"] == "pve-a")
    assert failed["last_sync_status"] == "unreachable"
    assert failed["last_sync_trigger"] == "scheduled"
    assert "no change was made" in failed["last_sync_error"]
    assert any(args[1] == "proxmox_inventory_sync_failed" for args, _ in event_log.activity)

    # Only the connection that was actually observed publishes an observation, and
    # it is attributed to the system actor rather than to a technician.
    assert [event["subject"] for event in event_log.events] == ["virtualization.inventory.observed"]
    assert event_log.events[0]["actor"]["id"] == "system-proxmox-inventory"
    assert event_log.events[0]["payload"]["trigger"] == "scheduled"
    assert event_log.events[0]["tenant_id"] == "nexus-local"


def test_a_disabled_schedule_calls_no_provider_and_writes_nothing(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server())
    fake_db.settings.rows.append({"type": "proxmox_inventory_sync", "enabled": False})

    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("a disabled schedule must not call a customer's cluster")

    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", must_not_run)

    summary = asyncio.run(proxmox_inventory.reconcile_configured_connections())

    assert summary["enabled"] is False
    assert summary["connections"] == 0 and summary["configured"] == 0 and summary["guests"] == 0
    assert not fake_db.proxmox_vms.rows
    assert not event_log.events and not event_log.activity
    assert asyncio.run(proxmox_inventory.scheduler_status())["enabled"] is False


def test_a_pass_records_when_it_last_ran_and_what_it_did(fake_db, event_log, monkeypatch):
    fake_db.proxmox_servers.rows.append(configured_server())
    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", fake_inventory([provider_guest()]))

    asyncio.run(proxmox_inventory.reconcile_configured_connections())

    state = next(row for row in fake_db.settings.rows if row["type"] == "proxmox_inventory_sync")
    assert state["last_run_at"]
    assert state["last_result"]["guests"] == 1 and state["last_result"]["failed"] == 0
    # The connection records the scheduled observation it received, so staleness
    # is visible per connection instead of only in the worker's log.
    connection = fake_db.proxmox_servers.rows[0]
    assert connection["last_sync_status"] == "ok"
    assert connection["last_sync_trigger"] == "scheduled"
    assert connection["last_sync_counts"]["observed"] == 1


def test_scheduler_interval_is_clamped_and_absent_settings_use_the_default():
    assert proxmox_inventory.normalise_interval_minutes(0) == proxmox_inventory.MIN_INTERVAL_MINUTES
    assert proxmox_inventory.normalise_interval_minutes(99999) == proxmox_inventory.MAX_INTERVAL_MINUTES
    assert proxmox_inventory.normalise_interval_minutes("not-a-number") == proxmox_inventory.DEFAULT_INTERVAL_MINUTES
    assert proxmox_inventory.normalise_interval_minutes(45) == 45
    assert proxmox_inventory.scheduler_config(None) == {
        "enabled": True,
        "interval_minutes": proxmox_inventory.DEFAULT_INTERVAL_MINUTES,
    }


def test_the_schedule_a_tenant_can_read_carries_no_other_tenants_totals(fake_db):
    fake_db.settings.rows.append({
        "type": "proxmox_inventory_sync",
        "enabled": True,
        "interval_minutes": 15,
        "last_run_at": "2026-10-12T02:00:00+00:00",
        "last_result": {"connections": 4, "guests": 91, "failed": 1},
    })

    status = asyncio.run(proxmox_inventory.scheduler_status())
    assert status == {
        "enabled": True,
        "interval_minutes": 15,
        "last_run_at": "2026-10-12T02:00:00+00:00",
    }

    payload = asyncio.run(proxmox.get_proxmox_connection(current_user=ADMIN))
    assert payload["reconciliation"] == status


def test_a_scheduled_pass_and_a_manual_sync_write_the_same_projection(fake_db, event_log, monkeypatch):
    """One writer: the two triggers cannot reconcile by different rules."""
    fake_db.proxmox_servers.rows.append(configured_server())
    monkeypatch.setattr(proxmox_adapter, "fetch_inventory", fake_inventory([provider_guest()]))

    asyncio.run(proxmox_inventory.reconcile_configured_connections())
    after_pass = [dict(row) for row in fake_db.proxmox_vms.rows]

    manual = asyncio.run(proxmox.sync_proxmox_inventory("pve-1", current_user=ADMIN))

    assert manual["trigger"] == "operator"
    assert manual["updated"] == 1 and manual["created"] == 0 and manual["removed"] == 0
    assert [dict(row) for row in fake_db.proxmox_vms.rows] == after_pass
    assert [event["payload"]["trigger"] for event in event_log.events] == ["scheduled", "operator"]
