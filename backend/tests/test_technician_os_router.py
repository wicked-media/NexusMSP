"""Router contract tests for the technician-OS batch.

The five new services have their own service-level tests; this file proves the
``/tech-fun/*`` boundary itself — that every endpoint is wired, thin, and maps
the honest service contract onto HTTP (bad input is 400, a missing object in
your scope is 404).
"""

import asyncio
import copy
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import tech_fun as tech_fun_router  # noqa: E402
from app.services import nexus_rescue  # noqa: E402
from datetime import datetime, timezone  # noqa: E402


FIXED_NOW = datetime(2026, 10, 4, 8, 0, tzinfo=timezone.utc)

USER = {"id": "tech-1", "name": "Terry Tech", "role": "tech", "is_admin": False,
        "tenant_id": "platform-a", "client_scope_mode": "all"}


# ============== MINIMAL MONGO FAKES (same contract as test_tech_fun) ==============


def _match_value(value, condition):
    if isinstance(condition, dict):
        for op, operand in condition.items():
            if op == "$in" and value not in operand:
                return False
            if op == "$nin" and value in operand:
                return False
            if op == "$exists" and (value is not None) != bool(operand):
                return False
            if op == "$ne" and value == operand:
                return False
            if op == "$gt" and not (value is not None and value > operand):
                return False
            if op == "$gte" and not (value is not None and value >= operand):
                return False
            if op == "$lt" and not (value is not None and value < operand):
                return False
            if op == "$lte" and not (value is not None and value <= operand):
                return False
            if op == "$regex" and not re.search(operand, str(value or "")):
                return False
        return True
    if condition is None:
        return value is None
    return value == condition


def _matches(row, query):
    for key, condition in query.items():
        if key == "$or":
            if not any(_matches(row, sub) for sub in condition):
                return False
        elif key == "$and":
            if not all(_matches(row, sub) for sub in condition):
                return False
        elif not _match_value(row.get(key), condition):
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, field, direction=1):
        self._rows = sorted(self._rows, key=lambda row: (row.get(field) is None, row.get(field)),
                            reverse=direction < 0)
        return self

    def limit(self, count):
        self._rows = self._rows[:count]
        return self

    async def to_list(self, _count=None):
        return [copy.deepcopy(row) for row in self._rows]


class _Collection:
    def __init__(self, rows=None):
        self.rows = [copy.deepcopy(row) for row in (rows or [])]
        self.inserted = []
        self.updates = []

    def find(self, query=None, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query or {})])

    async def find_one(self, query=None, _projection=None):
        for row in self.rows:
            if _matches(row, query or {}):
                return copy.deepcopy(row)
        return None

    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))
        self.inserted.append(copy.deepcopy(row))

    async def update_one(self, query, update, upsert=False, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                for field, value in (update.get("$set") or {}).items():
                    row[field] = value
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for row in self.rows if _matches(row, query or {}))


COLLECTIONS = (
    "investigations", "devices", "users", "clients", "tickets", "script_library",
    "automation_workflows", "network_devices", "ssl_certificates", "nexus_intents",
    "recorded_runbooks", "recorded_sessions", "synthetic_identities", "synthetic_runs",
    "rescue_sessions",
)


def _db(**collections):
    namespace = SimpleNamespace()
    for name in COLLECTIONS:
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _device(device_id="dev-1", tenant="platform-a", ip_address="192.168.1.14"):
    return {"id": device_id, "tenant_id": tenant, "hostname": device_id.upper(),
            "client_id": "CLI-001", "client_name": "ACME", "last_seen": "2026-10-04T07:59:00+00:00",
            "status": "online", "ip_address": ip_address}


def _fixture(**overrides):
    defaults = dict(
        devices=_Collection([_device(), _device("dev-2", ip_address="192.168.1.15"),
                             _device("dev-9", tenant="platform-b")]),
        clients=_Collection([{"id": "CLI-001", "tenant_id": "platform-a", "name": "ACME"}]),
        tickets=_Collection([{"id": "TKT-001", "tenant_id": "platform-a", "client_id": "CLI-001",
                              "status": "open"}]),
        script_library=_Collection([{"id": "s-1", "tenant_id": "platform-a", "name": "Print fix",
                                     "script": "Set-Printer -Host 192.168.1.14"}]),
    )
    defaults.update(overrides)
    return _db(**defaults)


def _patch(monkeypatch, db):
    monkeypatch.setattr(tech_fun_router, "db", db)


# ============== DIAGNOSTIC WORKBENCH ==============


def test_diagnostics_endpoints_round_trip(monkeypatch):
    db = _fixture()
    _patch(monkeypatch, db)

    model = asyncio.run(tech_fun_router.diagnostics_model(current_user=USER))
    assert len(model["tests"]) == 12
    assert "model_note" in model

    opened = asyncio.run(tech_fun_router.open_investigation(
        data={"symptom": "Sarah cannot access MYOB", "subject_type": "device", "subject_id": "dev-1"},
        current_user=USER))
    investigation_id = opened["investigation"]["id"]
    assert investigation_id.startswith("INV-")

    listed = asyncio.run(tech_fun_router.list_investigations(
        client_id=None, status="open", current_user=USER))
    assert listed["count"] == 1

    summary = asyncio.run(tech_fun_router.investigation_summary(
        investigation_id=investigation_id, current_user=USER))
    assert summary["investigation"]["symptom"] == "Sarah cannot access MYOB"

    nxt = asyncio.run(tech_fun_router.investigation_next_test(
        investigation_id=investigation_id, current_user=USER))
    assert nxt["test"]["expected_information_gain"] > 0

    record = asyncio.run(tech_fun_router.record_investigation_evidence(
        investigation_id=investigation_id,
        data={"test": "auth_recent_failures", "result": "abnormal", "detail": "bad password"},
        current_user=USER))
    assert record["update"]["posteriors_after"]["identity"] > 20.0

    closed = asyncio.run(tech_fun_router.close_investigation(
        investigation_id=investigation_id,
        data={"outcome": "inconclusive", "note": "carrier confirmed nothing"},
        current_user=USER))
    assert closed["investigation"]["status"] == "closed"


def test_diagnostics_endpoints_map_errors_to_http(monkeypatch):
    _patch(monkeypatch, _fixture())

    with pytest.raises(HTTPException) as bad_input:
        asyncio.run(tech_fun_router.open_investigation(
            data={"symptom": "", "subject_type": "device", "subject_id": "dev-1"},
            current_user=USER))
    assert bad_input.value.status_code == 400

    with pytest.raises(HTTPException) as missing_subject:
        asyncio.run(tech_fun_router.open_investigation(
            data={"symptom": "x", "subject_type": "device", "subject_id": "dev-404"},
            current_user=USER))
    assert missing_subject.value.status_code == 404

    with pytest.raises(HTTPException) as missing_investigation:
        asyncio.run(tech_fun_router.investigation_summary(
            investigation_id="INV-GHOST", current_user=USER))
    assert missing_investigation.value.status_code == 404

    with pytest.raises(HTTPException) as bad_status:
        asyncio.run(tech_fun_router.list_investigations(
            client_id=None, status="nonsense", current_user=USER))
    assert bad_status.value.status_code == 400


# ============== FIND EVERYWHERE ==============


def test_find_everywhere_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    sources = asyncio.run(tech_fun_router.find_sources(current_user=USER))
    assert len(sources["sources"]) == 10

    found = asyncio.run(tech_fun_router.find_everywhere(
        q="192.168.1.14", sources=None, limit=25, current_user=USER))
    assert found["total"] == 2
    assert [group["source"] for group in found["groups"]] == ["devices", "scripts"]

    narrowed = asyncio.run(tech_fun_router.find_everywhere(
        q="192.168.1.14", sources="devices", limit=25, current_user=USER))
    assert narrowed["sources_searched"] == ["devices"]

    literal = asyncio.run(tech_fun_router.find_literals(
        data={"value": "192.168.1.14"}, current_user=USER))
    assert literal["mode"] == "locate"
    assert literal["kind"] == "ip"

    discovered = asyncio.run(tech_fun_router.find_literals(data={"kind": "auto"}, current_user=USER))
    assert discovered["mode"] == "discover"
    assert any(item["kind"] == "ip" for item in discovered["literals"])

    impact = asyncio.run(tech_fun_router.find_change_impact(
        data={"value": "192.168.1.14"}, current_user=USER))
    assert impact["affected"]["devices"] == 1
    assert impact["risk_band"]["band"] == "medium"


def test_find_everywhere_endpoints_map_errors_to_http(monkeypatch):
    _patch(monkeypatch, _fixture())

    with pytest.raises(HTTPException) as unknown_source:
        asyncio.run(tech_fun_router.find_everywhere(
            q="acme", sources="ghost", limit=25, current_user=USER))
    assert unknown_source.value.status_code == 400

    with pytest.raises(HTTPException) as bad_kind:
        asyncio.run(tech_fun_router.find_literals(data={"kind": "serial"}, current_user=USER))
    assert bad_kind.value.status_code == 400

    with pytest.raises(HTTPException) as no_value:
        asyncio.run(tech_fun_router.find_change_impact(data={}, current_user=USER))
    assert no_value.value.status_code == 400


# ============== COMMAND RECORDER ==============


def test_recorder_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    started = asyncio.run(tech_fun_router.start_recording(
        data={"label": "Print spooler hangs", "device_id": "dev-1", "kind": "manual_fix"},
        current_user=USER))
    session_id = started["session"]["id"]
    assert session_id.startswith("REC-")

    stepped = asyncio.run(tech_fun_router.record_recording_step(
        session_id=session_id,
        data={"kind": "command", "command": "Restart-Service Spooler -Force"},
        current_user=USER))
    assert stepped["step"]["index"] == 1

    asyncio.run(tech_fun_router.record_recording_step(
        session_id=session_id,
        data={"kind": "verification", "detail": "test page printed"},
        current_user=USER))

    fetched = asyncio.run(tech_fun_router.get_recording_session(
        session_id=session_id, current_user=USER))
    assert len(fetched["session"]["steps"]) == 2

    listed = asyncio.run(tech_fun_router.list_recording_sessions(
        status=None, current_user=USER))
    assert listed["count"] == 1

    ended = asyncio.run(tech_fun_router.end_recording_session(
        session_id=session_id, data={"outcome": "success"}, current_user=USER))
    assert ended["session"]["status"] == "completed"

    proposed = asyncio.run(tech_fun_router.propose_runbook_from_session(
        session_id=session_id, data={}, current_user=USER))
    runbook_id = proposed["runbook"]["id"]
    assert runbook_id.startswith("RBK-")
    assert proposed["runbook"]["autonomy_candidate"] is False

    runbooks = asyncio.run(tech_fun_router.list_recorded_runbooks(
        status=None, current_user=USER))
    assert runbooks["count"] == 1

    verified = asyncio.run(tech_fun_router.verify_recorded_runbook(
        runbook_id=runbook_id, data={"outcome": "success"}, current_user=USER))
    assert verified["runbook"]["verified_successes"] == 1
    assert verified["runbook"]["autonomy_candidate"] is False


def test_recorder_endpoints_map_errors_to_http(monkeypatch):
    _patch(monkeypatch, _fixture())

    with pytest.raises(HTTPException) as missing_label:
        asyncio.run(tech_fun_router.start_recording(data={"label": "  "}, current_user=USER))
    assert missing_label.value.status_code == 400

    with pytest.raises(HTTPException) as missing_session:
        asyncio.run(tech_fun_router.get_recording_session(
            session_id="REC-GHOST", current_user=USER))
    assert missing_session.value.status_code == 404

    with pytest.raises(HTTPException) as no_commands:
        asyncio.run(tech_fun_router.propose_runbook_from_session(
            session_id="REC-GHOST", data={}, current_user=USER))
    assert no_commands.value.status_code == 404


# ============== SYNTHETIC EMPLOYEE ==============


def test_synthetic_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    catalog = asyncio.run(tech_fun_router.synthetic_checks(current_user=USER))
    assert len(catalog["checks"]) >= 8

    registered = asyncio.run(tech_fun_router.register_synthetic_identity(
        data={"label": "Payroll workflow", "client_id": "CLI-001",
              "checks": ["authenticate", "send_test_mail"],
              "credential_ref": "vault://tenants/acme/payroll-tester"},
        current_user=USER))
    identity_id = registered["identity"]["id"]
    assert identity_id.startswith("SYN-")

    listed = asyncio.run(tech_fun_router.list_synthetic_identities(
        client_id=None, current_user=USER))
    assert listed["count"] == 1

    run = asyncio.run(tech_fun_router.record_synthetic_run(
        data={"identity_id": identity_id, "results": [
            {"check": "authenticate", "verdict": "pass", "latency_ms": 240},
            {"check": "send_test_mail", "verdict": "fail", "detail": "relay refused"},
        ]},
        current_user=USER))
    assert run["run"]["verdict"] == "failed"
    assert "send_test_mail" in run["run"]["business_statement"] or \
        "sending mail" in run["run"]["business_statement"]

    status = asyncio.run(tech_fun_router.synthetic_identity_status(
        identity_id=identity_id, current_user=USER))
    assert status["latest_run"]["verdict"] == "failed"

    toggled = asyncio.run(tech_fun_router.set_synthetic_identity_state(
        identity_id=identity_id, data={"enabled": False}, current_user=USER))
    assert toggled["identity"]["enabled"] is False

    overview = asyncio.run(tech_fun_router.synthetic_overview(
        client_id=None, current_user=USER))
    assert overview["count"] == 1


def test_synthetic_endpoints_refuse_credentials_and_map_errors(monkeypatch):
    _patch(monkeypatch, _fixture())

    with pytest.raises(HTTPException) as credential:
        asyncio.run(tech_fun_router.register_synthetic_identity(
            data={"label": "Bad idea", "password": "hunter2"}, current_user=USER))
    assert credential.value.status_code == 400
    assert "never store credentials" in credential.value.detail

    with pytest.raises(HTTPException) as unknown_check:
        asyncio.run(tech_fun_router.register_synthetic_identity(
            data={"label": "Payroll", "checks": ["levitate"]}, current_user=USER))
    assert unknown_check.value.status_code == 400

    with pytest.raises(HTTPException) as missing_identity:
        asyncio.run(tech_fun_router.synthetic_identity_status(
            identity_id="SYN-GHOST", current_user=USER))
    assert missing_identity.value.status_code == 404


# ============== NEXUS RESCUE ==============


def test_rescue_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())
    monkeypatch.setattr(nexus_rescue, "_utcnow", lambda: FIXED_NOW)

    ladder = asyncio.run(tech_fun_router.rescue_capabilities(current_user=USER))
    assert len(ladder["capabilities"]) == 7
    assert all(entry["boundary"] for entry in ladder["capabilities"])

    assessment = asyncio.run(tech_fun_router.rescue_assess(
        data={"device_id": "dev-1", "symptom": "no_boot"}, current_user=USER))
    assert assessment["agent_reachable"] is True
    assert "repair_boot" in assessment["out_of_band_required"]

    console = asyncio.run(tech_fun_router.rescue_console(
        device_id="dev-1", current_user=USER))
    assert console["found"] is True

    started = asyncio.run(tech_fun_router.start_rescue_session(
        data={"device_id": "dev-1", "symptom": "no_boot", "capabilities": ["collect_logs"]},
        current_user=USER))
    session_id = started["session"]["id"]
    assert session_id.startswith("RSC-")
    assert started["session"]["status"] == "planned"

    stepped = asyncio.run(tech_fun_router.record_rescue_step(
        session_id=session_id,
        data={"kind": "technician_action", "detail": "Booted from recovery media"},
        current_user=USER))
    assert stepped["step"]["index"] == 1
    assert stepped["step"]["performed_by"] == "technician"

    listed = asyncio.run(tech_fun_router.list_rescue_sessions(
        device_id="dev-1", current_user=USER))
    assert listed["count"] == 1

    fetched = asyncio.run(tech_fun_router.get_rescue_session(
        session_id=session_id, current_user=USER))
    # A logged step means the work is underway; Nexus never reports a remote execution.
    assert fetched["session"]["status"] == "in_progress"
    assert fetched["session"]["status"] not in ("executed", "completed_remotely")


def test_rescue_endpoints_map_errors_to_http(monkeypatch):
    _patch(monkeypatch, _fixture())
    monkeypatch.setattr(nexus_rescue, "_utcnow", lambda: FIXED_NOW)

    with pytest.raises(HTTPException) as bad_symptom:
        asyncio.run(tech_fun_router.rescue_assess(
            data={"device_id": "dev-1", "symptom": "haunted"}, current_user=USER))
    assert bad_symptom.value.status_code == 400

    with pytest.raises(HTTPException) as missing_device:
        asyncio.run(tech_fun_router.rescue_assess(
            data={"device_id": "dev-404", "symptom": "no_boot"}, current_user=USER))
    assert missing_device.value.status_code == 404

    with pytest.raises(HTTPException) as no_capabilities:
        asyncio.run(tech_fun_router.start_rescue_session(
            data={"device_id": "dev-1", "symptom": "no_boot", "capabilities": []},
            current_user=USER))
    assert no_capabilities.value.status_code == 400

    with pytest.raises(HTTPException) as unknown_capability:
        asyncio.run(tech_fun_router.start_rescue_session(
            data={"device_id": "dev-1", "symptom": "no_boot", "capabilities": ["reinstall_everything"]},
            current_user=USER))
    assert unknown_capability.value.status_code == 400

    with pytest.raises(HTTPException) as missing_console:
        asyncio.run(tech_fun_router.rescue_console(device_id="dev-404", current_user=USER))
    assert missing_console.value.status_code == 404


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
