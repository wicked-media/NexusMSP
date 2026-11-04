"""Contract tests for Mission Control · Investigate (the per-problem orchestrator)."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import nexus_investigate, nexus_operational_mode  # noqa: E402


FIXED_NOW = datetime(2026, 10, 5, 10, 0, tzinfo=timezone.utc)


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


COLLECTIONS = ("mission_investigations", "investigations", "drift_findings", "devices", "users",
               "clients", "tickets", "operational_mode_state", "operational_mode_events")


def _db(**collections):
    namespace = SimpleNamespace()
    for name in COLLECTIONS:
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", tenant="platform-a"):
    return {"id": uid, "name": name, "role": "tech", "is_admin": False,
            "tenant_id": tenant, "client_scope_mode": "all"}


def _device(device_id="dev-1", hostname="ACME-LT-07", tenant="platform-a", client_id="CLI-001"):
    return {"id": device_id, "tenant_id": tenant, "hostname": hostname, "name": hostname,
            "client_id": client_id, "client_name": "ACME", "last_seen": "2026-10-05T09:55:00+00:00",
            "status": "online"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_investigate, "_utcnow", lambda: FIXED_NOW)


def _investigate(db, user=None, **payload):
    body = {"problem": "Sarah cannot access Finance"}
    body.update(payload)
    return asyncio.run(nexus_investigate.investigate(db, user or _user(), "Terry Tech", body))


def _fixture(**overrides):
    defaults = dict(
        devices=_Collection([_device(), _device("dev-9", "OTHER-LT-01", tenant="platform-b")]),
        clients=_Collection([{"id": "CLI-001", "tenant_id": "platform-a", "name": "ACME"}]),
        users=_Collection([{"id": "usr-1", "tenant_id": "platform-a", "name": "Sarah",
                            "client_id": "CLI-001"}]),
        tickets=_Collection([
            {"id": "TKT-1", "tenant_id": "platform-a", "client_id": "CLI-001", "status": "open"},
            {"id": "TKT-2", "tenant_id": "platform-a", "client_id": "CLI-001", "status": "closed"},
        ]),
    )
    defaults.update(overrides)
    return _db(**defaults)


# ============== THE PUBLISHED TOOL CATALOG ==============


def test_tool_catalog_only_advertises_endpoints_that_exist():
    catalog = nexus_investigate.tool_catalog()
    assert len(catalog["tools"]) == 8
    for entry in catalog["tools"]:
        assert entry["endpoint"].startswith("/tech-fun/")
        assert entry["requires"] and entry["answers"] and entry["label"] and entry["domain"]
    names = [entry["tool"] for entry in catalog["tools"]]
    assert "diagnostic_workbench" in names and "fleet_shell" in names
    assert "selects tools" in catalog["note"]
    assert catalog["by_domain"]["recovery"] == ["rescue"]


# ============== INTAKE AND SUBJECT RESOLUTION ==============


def test_investigate_requires_a_problem(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    assert _investigate(db, problem="  ")["error"] == "problem is required — describe what appears wrong"
    assert db.mission_investigations.inserted == []


def test_an_explicit_subject_outside_scope_is_a_bad_request_not_a_downgrade(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    result = _investigate(db, subject_type="device", subject_id="dev-404")
    assert result["found"] is False
    assert "not in your scope" in result["error"]
    assert db.mission_investigations.inserted == []


def test_a_hostname_in_the_report_resolves_to_a_real_device(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    result = _investigate(db, problem="ACME-LT-07 cannot open Finance")
    assert result["found"] is True
    assert result["resolved"] is True
    investigation = result["investigation"]
    assert investigation["status"] == "open"
    assert investigation["subject"]["type"] == "device"
    assert investigation["subject"]["id"] == "dev-1"
    assert investigation["subject"]["label"] == "ACME-LT-07"
    assert investigation["client_id"] == "CLI-001"

    rows = {row["kind"]: row for row in investigation["scope"]["rows"]}
    assert rows["device"]["source"] == "devices"
    assert rows["incidents"]["count"] == 1
    assert rows["estate"]["count"] == 1
    assert "been interpreted as a cause" in investigation["scope"]["note"]
    assert set(investigation["scope"]["sources_read"]) == {"devices", "tickets"}


def test_an_unresolvable_report_is_awaiting_subject_rather_than_invented(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    result = _investigate(db, problem="the office wifi is haunted")
    assert result["found"] is True
    assert result["resolved"] is False
    assert result["investigation"]["status"] == "awaiting_subject"
    assert result["investigation"]["subject"] == {}
    assert "will not invent a device" in result["note"]


def test_a_person_is_resolved_by_name_and_carries_their_client(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    result = _investigate(db, problem="Sarah says Finance is down again")
    assert result["resolved"] is True
    assert result["investigation"]["subject"]["type"] == "user"
    assert result["investigation"]["subject"]["id"] == "usr-1"
    assert result["investigation"]["client_id"] == "CLI-001"


# ============== TOOL SELECTION ==============


def test_tool_selection_reacts_to_real_scope_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture(drift_findings=_Collection([
        {"id": "DRF-1", "tenant_id": "platform-a", "device_id": "dev-1", "check": "bitlocker",
         "status": "open"},
    ]))
    result = _investigate(db, subject_type="device", subject_id="dev-1")
    selected = [entry["tool"] for entry in result["investigation"]["tools"]["selected"]]
    assert "state_engine" in selected
    assert selected[0] == "diagnostic_workbench"
    assert len(selected) == len(set(selected))
    assert "does not run them" in result["investigation"]["tools"]["note"]


def test_linking_a_diagnostic_investigation_is_validated(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    missing = _investigate(db, subject_type="device", subject_id="dev-1",
                           diagnostics_investigation_id="INV-GHOST")
    assert missing["found"] is False
    assert "not in your scope" in missing["error"]

    db = _fixture(investigations=_Collection([
        {"id": "INV-1", "tenant_id": "platform-a", "symptom": "cannot access MYOB",
         "subject": {"type": "device", "id": "dev-1"}, "posteriors": {}, "evidence": [],
         "root_cause": None, "status": "open"},
    ]))
    linked = _investigate(db, subject_type="device", subject_id="dev-1",
                          diagnostics_investigation_id="INV-1")
    assert linked["investigation"]["diagnostics_investigation_id"] == "INV-1"


# ============== NEXT ACTION AND THE HUMAN-DECISION GATE ==============


def test_next_action_starts_with_the_workbench_and_ends_with_proof(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    first = _investigate(db, subject_type="device", subject_id="dev-1")
    assert first["investigation"]["next_action"]["action"] == "open_a_diagnostic_investigation"

    db2 = _fixture(investigations=_Collection([
        {"id": "INV-1", "tenant_id": "platform-a", "symptom": "s", "evidence": [],
         "posteriors": {"application": 0.9}, "status": "open",
         "root_cause": {"domain": "application", "probability": 0.9, "basis": "recorded evidence"}},
    ]))
    isolated = _investigate(db2, subject_type="device", subject_id="dev-1",
                            diagnostics_investigation_id="INV-1")
    action = isolated["investigation"]["next_action"]
    assert action["action"] == "apply_then_prove"
    assert action["tool"] == "evidence"
    assert "proven rather than assumed" in action["detail"]


def test_identity_and_change_causes_are_gated_for_a_human(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture(investigations=_Collection([
        {"id": "INV-9", "tenant_id": "platform-a", "symptom": "s", "evidence": [],
         "posteriors": {"identity": 0.8}, "status": "open",
         "root_cause": {"domain": "identity", "probability": 0.8, "basis": "group reconciliation"}},
    ]))
    result = _investigate(db, subject_type="device", subject_id="dev-1",
                          diagnostics_investigation_id="INV-9")
    gate = result["investigation"]["human_decision"]
    assert gate["required"] is True
    combined = " ".join(item["reason"] + " " + item["detail"] for item in gate["reasons"])
    assert "identity domain" in combined
    assert "cannot see" in combined


def test_an_application_cause_needs_no_human_gate(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture(investigations=_Collection([
        {"id": "INV-1", "tenant_id": "platform-a", "symptom": "s", "evidence": [],
         "posteriors": {"application": 0.9}, "status": "open",
         "root_cause": {"domain": "application", "probability": 0.9, "basis": "e"}},
    ]))
    result = _investigate(db, subject_type="device", subject_id="dev-1",
                          diagnostics_investigation_id="INV-1")
    assert result["investigation"]["human_decision"]["required"] is False


def test_observe_only_mode_blocks_execution_and_gates_for_a_human(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture(investigations=_Collection([
        {"id": "INV-1", "tenant_id": "platform-a", "symptom": "s", "evidence": [],
         "posteriors": {"application": 0.9}, "status": "open",
         "root_cause": {"domain": "application", "probability": 0.9, "basis": "e"}},
    ]))
    asyncio.run(nexus_operational_mode.set_mode(
        db, _user(), "Terry Tech",
        {"mode": "observe_only", "reason": "suspected compromise"}))

    result = _investigate(db, subject_type="device", subject_id="dev-1",
                          diagnostics_investigation_id="INV-1")
    action = result["investigation"]["next_action"]
    assert action["execution_permitted"] is False
    assert "suspected compromise" in action["mode_reason"]
    gate = result["investigation"]["human_decision"]
    assert gate["required"] is True
    assert any("not permitted to execute" in item["reason"] for item in gate["reasons"])


# ============== DECISIONS, ATTACHMENT AND CLOSING ==============


def test_decisions_are_append_only_and_carry_their_author(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    mission_id = _investigate(db, subject_type="device", subject_id="dev-1")["investigation"]["id"]

    assert asyncio.run(nexus_investigate.record_decision(
        db, _user(), "Terry Tech", mission_id, {}))["error"] == "decision is required"

    first = asyncio.run(nexus_investigate.record_decision(
        db, _user(), "Terry Tech", mission_id,
        {"decision": "do not restore access yet", "chosen": "refer to HR",
         "reason": "HR role update removed it deliberately",
         "conflict": "restoring access conflicts with current HR state"}))
    assert first["found"] is True
    assert len(first["investigation"]["decisions"]) == 1
    assert first["investigation"]["decisions"][0]["by"] == "Terry Tech"

    second = asyncio.run(nexus_investigate.record_decision(
        db, _user("u2", "Rita Reviewer"), "Rita Reviewer", mission_id,
        {"decision": "escalate to the customer"}))
    assert len(second["investigation"]["decisions"]) == 2
    assert second["investigation"]["human_decision"]["required"] is True
    assert "HR state" in " ".join(
        item["detail"] for item in second["investigation"]["human_decision"]["reasons"])


def test_attaching_a_subject_rebuilds_the_scope_from_real_records(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    created = _investigate(db, problem="something is wrong somewhere")
    mission_id = created["investigation"]["id"]
    assert created["investigation"]["status"] == "awaiting_subject"

    attached = asyncio.run(nexus_investigate.attach_subject(
        db, _user(), "Terry Tech", mission_id, {"subject_type": "device", "subject_id": "dev-1"}))
    assert attached["found"] is True
    assert attached["investigation"]["status"] == "open"
    assert attached["investigation"]["subject"]["id"] == "dev-1"
    assert attached["investigation"]["client_id"] == "CLI-001"
    assert {row["kind"] for row in attached["investigation"]["scope"]["rows"]} >= {"device", "estate"}

    refused = asyncio.run(nexus_investigate.attach_subject(
        db, _user(), "Terry Tech", mission_id, {"subject_type": "device", "subject_id": "dev-404"}))
    assert refused["found"] is False
    assert "not in your scope" in refused["error"]

    assert asyncio.run(nexus_investigate.attach_subject(
        db, _user(), "Terry Tech", "MCI-GHOST",
        {"subject_type": "device", "subject_id": "dev-1"})) == {"found": False}


def test_closing_validates_the_outcome_and_happens_once(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    mission_id = _investigate(db, subject_type="device", subject_id="dev-1")["investigation"]["id"]

    bad = asyncio.run(nexus_investigate.close_investigation(
        db, _user(), "Terry Tech", mission_id, {"outcome": "shrugged"}))
    assert "outcome must be one of" in bad["error"]

    closed = asyncio.run(nexus_investigate.close_investigation(
        db, _user(), "Terry Tech", mission_id, {"outcome": "referred"}))
    assert closed["found"] is True
    assert closed["investigation"]["status"] == "closed"
    assert closed["investigation"]["close_outcome"] == "referred"
    assert "Nothing was invented" in closed["note"]

    twice = asyncio.run(nexus_investigate.close_investigation(
        db, _user(), "Terry Tech", mission_id, {"outcome": "resolved"}))
    assert "already closed" in twice["error"]

    blocked = asyncio.run(nexus_investigate.record_decision(
        db, _user(), "Terry Tech", mission_id, {"decision": "one more thought"}))
    assert "closed" in blocked["error"]


def test_list_investigations_validates_status_and_counts_the_gates(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _fixture()
    _investigate(db, subject_type="device", subject_id="dev-1")
    _investigate(db, problem="nobody knows")

    listed = asyncio.run(nexus_investigate.list_investigations(db, _user()))
    assert listed["count"] == 2
    assert listed["awaiting_subject"] == 1

    only_open = asyncio.run(nexus_investigate.list_investigations(db, _user(), status="open"))
    assert only_open["count"] == 1

    bad = asyncio.run(nexus_investigate.list_investigations(db, _user(), status="mystery"))
    assert bad["found"] is False
    assert "status must be one of" in bad["error"]

    assert asyncio.run(nexus_investigate.list_investigations(
        db, _user("u2", "Other", tenant="platform-b")))["count"] == 0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
