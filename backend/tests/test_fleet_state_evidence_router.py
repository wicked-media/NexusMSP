"""Router contract tests for the orchestration + trust batch.

The five services have their own service-level tests; this file proves the
``/tech-fun/*`` boundary: every endpoint is wired, thin, and maps the honest
service contract onto HTTP (bad input is 400, a missing object is 404).
"""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timezone
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
from app.services import nexus_fleet_shell  # noqa: E402


FIXED_NOW = datetime(2026, 10, 5, 11, 0, tzinfo=timezone.utc)

USER = {"id": "tech-1", "name": "Terry Tech", "role": "admin", "is_admin": True,
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
        self.updates.append((copy.deepcopy(query), copy.deepcopy(update)))
        for row in self.rows:
            if _matches(row, query):
                for field, value in (update.get("$set") or {}).items():
                    row[field] = value
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for row in self.rows if _matches(row, query or {}))


COLLECTIONS = (
    "devices", "users", "clients", "tickets", "backup_jobs", "investigations",
    "drift_findings", "device_state_declarations", "fleet_object_sets",
    "mission_investigations", "operation_evidence", "evidence_packs",
    "operational_mode_state", "operational_mode_events",
)


def _db(**collections):
    namespace = SimpleNamespace()
    for name in COLLECTIONS:
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _device(device_id="dev-1", tenant="platform-a", **extra):
    row = {"id": device_id, "tenant_id": tenant, "hostname": device_id.upper(),
           "client_id": "CLI-001", "client_name": "ACME", "status": "online",
           "last_seen": "2026-10-05T10:55:00+00:00", "last_boot": "2026-09-20T08:00:00+00:00"}
    row.update(extra)
    return row


def _fixture(**overrides):
    defaults = dict(
        devices=_Collection([_device(), _device("dev-2"), _device("dev-9", tenant="platform-b")]),
        clients=_Collection([{"id": "CLI-001", "tenant_id": "platform-a", "name": "ACME"}]),
        tickets=_Collection([{"id": "TKT-1", "tenant_id": "platform-a", "client_id": "CLI-001",
                              "status": "open"}]),
    )
    defaults.update(overrides)
    return _db(**defaults)


def _patch(monkeypatch, db):
    monkeypatch.setattr(tech_fun_router, "db", db)


# ============== MISSION CONTROL · INVESTIGATE ==============


def test_mission_control_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    catalog = asyncio.run(tech_fun_router.mission_control_tools(current_user=USER))
    assert len(catalog["tools"]) == 8

    opened = asyncio.run(tech_fun_router.mission_control_investigate(
        data={"problem": "DEV-1 cannot reach Finance"}, current_user=USER))
    mission_id = opened["investigation"]["id"]
    assert mission_id.startswith("MCI-")
    assert opened["investigation"]["status"] == "open"
    assert opened["investigation"]["next_action"]["action"] == "open_a_diagnostic_investigation"

    listed = asyncio.run(tech_fun_router.list_mission_investigations(
        status=None, current_user=USER))
    assert listed["count"] == 1

    fetched = asyncio.run(tech_fun_router.get_mission_investigation(
        mission_id=mission_id, current_user=USER))
    assert fetched["investigation"]["id"] == mission_id

    decided = asyncio.run(tech_fun_router.record_mission_decision(
        mission_id=mission_id,
        data={"decision": "hold", "reason": "HR removed the access deliberately"},
        current_user=USER))
    assert len(decided["investigation"]["decisions"]) == 1

    closed = asyncio.run(tech_fun_router.close_mission_investigation(
        mission_id=mission_id, data={"outcome": "referred"}, current_user=USER))
    assert closed["investigation"]["status"] == "closed"


def test_mission_control_maps_errors_to_http(monkeypatch):
    _patch(monkeypatch, _fixture())

    with pytest.raises(HTTPException) as no_problem:
        asyncio.run(tech_fun_router.mission_control_investigate(data={}, current_user=USER))
    assert no_problem.value.status_code == 400

    with pytest.raises(HTTPException) as bad_subject:
        asyncio.run(tech_fun_router.mission_control_investigate(
            data={"problem": "x", "subject_type": "device", "subject_id": "dev-404"},
            current_user=USER))
    assert bad_subject.value.status_code == 400

    with pytest.raises(HTTPException) as missing:
        asyncio.run(tech_fun_router.get_mission_investigation(
            mission_id="MCI-GHOST", current_user=USER))
    assert missing.value.status_code == 404

    with pytest.raises(HTTPException) as bad_status:
        asyncio.run(tech_fun_router.list_mission_investigations(
            status="mystery", current_user=USER))
    assert bad_status.value.status_code == 400


# ============== STATE ENGINE & DRIFT CONTROL ==============


def test_state_engine_and_drift_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    checks = asyncio.run(tech_fun_router.state_engine_checks(current_user=USER))
    assert len(checks["checks"]) == 8

    declared = asyncio.run(tech_fun_router.declare_device_state(
        data={"check": "dns_servers", "expectation": "10.0.0.5", "client_id": "CLI-001"},
        current_user=USER))
    assert declared["declaration"]["id"].startswith("DSD-")

    declarations = asyncio.run(tech_fun_router.list_device_declarations(
        client_id=None, current_user=USER))
    assert declarations["count"] == 1

    evaluated = asyncio.run(tech_fun_router.evaluate_device_state(
        device_id="dev-1", current_user=USER))
    assert evaluated["found"] is True
    # A bare device record proves nothing, so the honest verdicts dominate.
    assert evaluated["counts"]["unverified"] >= 1

    estate = asyncio.run(tech_fun_router.evaluate_estate_state(
        data={"client_id": "CLI-001"}, current_user=USER))
    assert estate["found"] is True

    drift = asyncio.run(tech_fun_router.list_drift(
        client_id=None, status=None, device_id=None, current_user=USER))
    assert "findings" in drift
    assert asyncio.run(tech_fun_router.drift_summary(
        client_id=None, current_user=USER))["found"] is True


def test_drift_remediation_is_a_plan_and_maps_errors(monkeypatch):
    _patch(monkeypatch, _fixture())
    asyncio.run(tech_fun_router.evaluate_device_state(device_id="dev-1", current_user=USER))
    drift = asyncio.run(tech_fun_router.list_drift(
        client_id=None, status=None, device_id=None, current_user=USER))

    if drift["findings"]:
        drift_id = drift["findings"][0]["id"]
        proposal = asyncio.run(tech_fun_router.propose_drift_remediation(
            drift_id=drift_id, data={"action": "re-apply the baseline", "rollback": "restore prior"},
            current_user=USER))
        assert "executed" in proposal["note"] or "plan" in proposal["note"].lower()

        verified = asyncio.run(tech_fun_router.record_drift_verification(
            drift_id=drift_id, data={"verdict": "verified"}, current_user=USER))
        assert verified["found"] is True

    with pytest.raises(HTTPException) as bad_check:
        asyncio.run(tech_fun_router.declare_device_state(
            data={"check": "vibes", "expectation": "good"}, current_user=USER))
    assert bad_check.value.status_code == 400

    with pytest.raises(HTTPException) as missing_device:
        asyncio.run(tech_fun_router.evaluate_device_state(device_id="dev-404", current_user=USER))
    assert missing_device.value.status_code == 404

    with pytest.raises(HTTPException) as missing_drift:
        asyncio.run(tech_fun_router.propose_drift_remediation(
            drift_id="DRF-GHOST", data={"action": "x"}, current_user=USER))
    assert missing_drift.value.status_code == 404


# ============== FLEET SHELL ==============


def test_fleet_shell_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    grammar = asyncio.run(tech_fun_router.fleet_grammar(current_user=USER))
    assert grammar["filters"]

    queried = asyncio.run(tech_fun_router.fleet_query(
        data={"filters": [{"filter": "status", "value": "online"}]}, current_user=USER))
    assert queried["count"] == 2  # the third device belongs to another tenant

    saved = asyncio.run(tech_fun_router.save_fleet_object_set(
        data={"label": "Online endpoints",
              "filters": [{"filter": "status", "value": "online"}]},
        current_user=USER))
    set_id = saved["object_set"]["id"]
    assert set_id.startswith("FOS-")

    listed = asyncio.run(tech_fun_router.list_fleet_object_sets(current_user=USER))
    assert listed["count"] == 1
    assert asyncio.run(tech_fun_router.get_fleet_object_set(
        set_id=set_id, current_user=USER))["object_set"]["id"] == set_id

    refined = asyncio.run(tech_fun_router.refine_fleet_object_set(
        set_id=set_id, data={"filters": [{"filter": "hostname_contains", "value": "DEV-1"}]},
        current_user=USER))
    assert refined["object_set"]["lineage"]["parent_set_id"] == set_id
    assert refined["object_set"]["id"] != set_id

    planned = asyncio.run(tech_fun_router.plan_fleet_set_action(
        set_id=set_id, data={"action": "Deploy the package",
                             "capability": "software_deployment"}, current_user=USER))
    # The published ladder is applied to the real membership: a 2-device set cannot
    # produce a 25-device ring, and no ring is released without its gate.
    assert nexus_fleet_shell.BLAST_RADIUS_RINGS == (1, 5, 25, "remainder")
    rings = planned["plan"]["rings"]
    assert len(rings) == 4
    assert rings[0]["size"] == 1
    assert rings[-1]["kind"] == "remainder"
    sizes = [ring["size"] for ring in rings]
    assert sizes == sorted(sizes, reverse=True)
    assert all(ring["size"] <= len(saved["object_set"]["member_device_ids"] or [1]) * 25
               for ring in rings)
    assert all(ring["verification_gate"] for ring in rings)
    assert planned["permitted"] is True
    assert "not executed" in planned["note"] or "plan" in planned["note"].lower()
    assert asyncio.run(tech_fun_router.fleet_summary(
        client_id=None, current_user=USER))["found"] is True


def test_fleet_shell_maps_errors_to_http(monkeypatch):
    _patch(monkeypatch, _fixture())

    with pytest.raises(HTTPException) as unknown_filter:
        asyncio.run(tech_fun_router.fleet_query(
            data={"filters": [{"filter": "soul", "value": "yes"}]}, current_user=USER))
    assert unknown_filter.value.status_code == 400

    with pytest.raises(HTTPException) as missing_set:
        asyncio.run(tech_fun_router.get_fleet_object_set(set_id="FOS-GHOST", current_user=USER))
    assert missing_set.value.status_code == 404

    with pytest.raises(HTTPException) as bad_action:
        asyncio.run(tech_fun_router.save_fleet_object_set(data={"label": "  "}, current_user=USER))
    assert bad_action.value.status_code == 400


# ============== EVIDENCE ENGINE ==============


def test_evidence_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    contract = asyncio.run(tech_fun_router.evidence_contract(current_user=USER))
    assert "verified" in contract["verdicts"]

    recorded = asyncio.run(tech_fun_router.record_operation_evidence(
        data={"operation": "restart_spooler", "target_type": "device", "target_id": "dev-1",
              "client_id": "CLI-001", "method": "agent command", "actor_kind": "technician",
              "outcome": "success", "required_checks": ["service_running"],
              "checks": [{"check": "service_running", "observed": True}]},
        current_user=USER))
    evidence_id = recorded["evidence"]["id"]
    assert evidence_id.startswith("EVD-")

    listed = asyncio.run(tech_fun_router.list_operation_evidence(
        client_id=None, target_id=None, operation=None, current_user=USER))
    assert listed["count"] == 1

    fetched = asyncio.run(tech_fun_router.get_operation_evidence(
        evidence_id=evidence_id, current_user=USER))
    assert fetched["verdict"]["verdict"] == "verified"

    verified = asyncio.run(tech_fun_router.verify_operation_evidence(
        evidence_id=evidence_id, current_user=USER))
    assert verified["verdict"]["verdict"] == "verified"
    assert verified["verdict"]["reason"]

    pack = asyncio.run(tech_fun_router.build_evidence_pack(
        data={"title": "Incident evidence", "subject": "spooler outage",
              "evidence_ids": [evidence_id]}, current_user=USER))
    pack_id = pack["pack"]["id"]
    assert pack_id.startswith("PCK-")
    assert asyncio.run(tech_fun_router.get_evidence_pack(
        pack_id=pack_id, current_user=USER))["pack"]["id"] == pack_id
    assert asyncio.run(tech_fun_router.list_evidence_packs(current_user=USER))["count"] == 1


def test_evidence_refuses_to_claim_success_without_observation(monkeypatch):
    _patch(monkeypatch, _fixture())
    recorded = asyncio.run(tech_fun_router.record_operation_evidence(
        data={"operation": "swap_disk", "target_type": "device", "target_id": "dev-1",
              "outcome": "success", "required_checks": ["smart_clean", "array_healthy"],
              "checks": [{"check": "smart_clean", "observed": True}]},
        current_user=USER))
    evidence_id = recorded["evidence"]["id"]
    verified = asyncio.run(tech_fun_router.verify_operation_evidence(
        evidence_id=evidence_id, current_user=USER))
    assert verified["verdict"]["verdict"] == "partial"
    assert verified["verdict"]["verdict"] != "verified"
    assert "array_healthy" in verified["verdict"]["reason"]


def test_evidence_maps_errors_to_http(monkeypatch):
    _patch(monkeypatch, _fixture())

    with pytest.raises(HTTPException) as missing_checks:
        asyncio.run(tech_fun_router.record_operation_evidence(
            data={"operation": "x", "target_type": "device", "target_id": "dev-1",
                  "outcome": "success", "required_checks": []},
            current_user=USER))
    assert missing_checks.value.status_code == 400

    with pytest.raises(HTTPException) as bad_observed:
        asyncio.run(tech_fun_router.record_operation_evidence(
            data={"operation": "x", "target_type": "device", "target_id": "dev-1",
                  "outcome": "success", "required_checks": ["a"],
                  "checks": [{"check": "a", "observed": "yes"}]},
            current_user=USER))
    assert bad_observed.value.status_code == 400

    with pytest.raises(HTTPException) as missing_evidence:
        asyncio.run(tech_fun_router.get_operation_evidence(
            evidence_id="EVD-GHOST", current_user=USER))
    assert missing_evidence.value.status_code == 404

    with pytest.raises(HTTPException) as missing_pack:
        asyncio.run(tech_fun_router.get_evidence_pack(pack_id="PCK-GHOST", current_user=USER))
    assert missing_evidence.value.status_code == 404


# ============== OPERATIONAL MODE ==============


def test_operational_mode_endpoints_round_trip(monkeypatch):
    _patch(monkeypatch, _fixture())

    catalog = asyncio.run(tech_fun_router.operational_mode_capabilities(current_user=USER))
    assert catalog["modes"] == ["normal", "observe_only", "frozen"]
    assert "NOT yet consulted" in catalog["enforcement_note"]

    assert asyncio.run(tech_fun_router.get_operational_mode(
        current_user=USER))["mode"]["mode"] == "normal"

    applied = asyncio.run(tech_fun_router.set_operational_mode(
        data={"mode": "observe_only", "reason": "suspected compromise"}, current_user=USER))
    assert applied["mode"]["mode"] == "observe_only"

    assert asyncio.run(tech_fun_router.get_operational_mode(
        current_user=USER))["mode"]["mode"] == "observe_only"

    events = asyncio.run(tech_fun_router.list_operational_mode_events(
        limit=10, current_user=USER))
    assert events["count"] == 1
    assert events["events"][0]["reason"] == "suspected compromise"


def test_operational_mode_is_admin_only_and_requires_a_reason(monkeypatch):
    _patch(monkeypatch, _fixture())
    non_admin = {**USER, "is_admin": False, "role": "tech"}

    with pytest.raises(HTTPException) as forbidden:
        asyncio.run(tech_fun_router.set_operational_mode(
            data={"mode": "observe_only", "reason": "because"}, current_user=non_admin))
    assert forbidden.value.status_code == 403

    with pytest.raises(HTTPException) as no_reason:
        asyncio.run(tech_fun_router.set_operational_mode(
            data={"mode": "observe_only"}, current_user=USER))
    assert no_reason.value.status_code == 400
    assert "unjustified stop" in no_reason.value.detail

    with pytest.raises(HTTPException) as bad_mode:
        asyncio.run(tech_fun_router.set_operational_mode(
            data={"mode": "paused", "reason": "typo"}, current_user=USER))
    assert bad_mode.value.status_code == 400


def test_observe_only_mode_reaches_the_action_plan(monkeypatch):
    """The mode must have teeth in a layer that consults it, not just be a record."""
    _patch(monkeypatch, _fixture())
    asyncio.run(tech_fun_router.set_operational_mode(
        data={"mode": "observe_only", "reason": "incident in progress"}, current_user=USER))

    saved = asyncio.run(tech_fun_router.save_fleet_object_set(
        data={"label": "All", "filters": [{"filter": "status", "value": "online"}]},
        current_user=USER))
    planned = asyncio.run(tech_fun_router.plan_fleet_set_action(
        set_id=saved["object_set"]["id"],
        data={"action": "Deploy", "capability": "software_deployment"}, current_user=USER))
    assert planned["permitted"] is False
    assert "incident in progress" in planned["note"]
    assert planned["plan"]["rings"][0]["size"] == 1
    assert planned["plan"]["rings"][-1]["kind"] == "remainder"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
