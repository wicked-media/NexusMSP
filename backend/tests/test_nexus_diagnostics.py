"""Contract tests for the Nexus Diagnostic Workbench (investigations)."""

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

from app.services import nexus_diagnostics  # noqa: E402


FIXED_NOW = datetime(2026, 10, 4, 8, 0, tzinfo=timezone.utc)


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


COLLECTIONS = ("investigations", "devices", "users", "clients", "tickets", "script_library",
               "automation_workflows", "network_devices", "ssl_certificates", "nexus_intents",
               "recorded_runbooks")


def _db(**collections):
    namespace = SimpleNamespace()
    for name in COLLECTIONS:
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False, tenant="platform-a"):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": tenant, "client_scope_mode": "all"}


def _device(device_id="dev-1", tenant="platform-a", last_seen="2026-10-04T07:55:00+00:00",
            client_id="CLI-001"):
    return {"id": device_id, "tenant_id": tenant, "hostname": device_id.upper(),
            "client_id": client_id, "last_seen": last_seen, "status": "online",
            "ip_address": "192.168.1.14"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_diagnostics, "_utcnow", lambda: FIXED_NOW)


def _open(db, user=None, **payload):
    body = {"symptom": "Sarah cannot access MYOB", "subject_type": "device",
            "subject_id": "dev-1", "ticket_id": "TKT-001"}
    body.update(payload)
    return asyncio.run(nexus_diagnostics.open_investigation(
        db, user or _user(), "Terry Tech", body))


# ============== THE PUBLISHED MODEL ==============


def test_catalog_publishes_priors_tests_and_likelihoods():
    catalog = nexus_diagnostics.hypothesis_catalog()
    domains = catalog["domains"]
    assert [entry["domain"] for entry in domains] == [
        "application", "identity", "endpoint", "network", "change"]
    assert round(sum(entry["prior"] for entry in domains), 6) == 1.0
    assert len(catalog["tests"]) == 12
    for entry in catalog["tests"]:
        assert entry["source"] and entry["label"]
        assert set(entry["likelihoods"]) == {item["domain"] for item in domains}
        assert all(0.0 <= value <= 1.0 for value in entry["likelihoods"].values())
    assert "heuristic" in catalog["model_note"]
    assert catalog["isolation"]["threshold"] == nexus_diagnostics.ISOLATION_THRESHOLD


def test_information_gain_is_bounded_and_rewards_discrimination():
    priors = nexus_diagnostics._priors()
    neutral = 0.0
    for entry in nexus_diagnostics.DIAGNOSTIC_TESTS:
        gain = nexus_diagnostics._expected_information_gain(priors, entry["test"])
        assert gain >= 0.0
        if all(abs(value - 0.5) < 1e-9 for value in entry["likelihoods"].values()):
            neutral = gain
    best = nexus_diagnostics._rank_tests(priors, set())[0]
    assert best["expected_information_gain"] > neutral
    assert best["expected_information_gain"] <= nexus_diagnostics._entropy(priors) + 1e-9


def test_posterior_updates_preserve_total_probability():
    priors = nexus_diagnostics._priors()
    updated = nexus_diagnostics._posterior(priors, "auth_recent_failures", True)
    assert round(sum(updated.values()), 9) == 1.0
    assert updated["identity"] > priors["identity"]
    normal = nexus_diagnostics._posterior(priors, "auth_recent_failures", False)
    assert normal["identity"] < priors["identity"]


# ============== OPENING ==============


def test_open_investigation_validates_its_input(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    assert _open(db, symptom="  ")["error"] == "symptom is required"
    assert "subject_type must be" in _open(db, subject_type="printer")["error"]
    assert _open(db, subject_id="")["error"] == "subject_id is required"
    assert db.investigations.inserted == []


def test_open_investigation_records_observation_not_cause(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]), tickets=_Collection([
        {"id": "TKT-001", "tenant_id": "platform-a", "client_id": "CLI-001", "status": "open"},
        {"id": "TKT-002", "tenant_id": "platform-a", "client_id": "CLI-001", "status": "closed"},
    ]))
    result = _open(db)
    assert result["found"] is True
    investigation = result["investigation"]
    assert investigation["id"].startswith("INV-")
    assert investigation["status"] == "open"
    assert investigation["isolated"] is False
    assert investigation["root_cause"] is None
    assert investigation["evidence_count"] == 0
    assert investigation["next_test"]["test"]
    assert investigation["probabilities_percent"]["application"] == 25.0
    assert "not been interpreted" in result["note"] or "unrecorded tests" in result["note"]
    stored = db.investigations.inserted[0]
    assert stored["observations"]
    assert "has been interpreted as a cause" in stored["context_note"]
    assert any(item["observation"] == "open tickets for this customer" and item["value"] == 1
               for item in stored["observations"])
    assert stored["tenant_id"] == "platform-a"


def test_open_investigation_rejects_subject_outside_tenant(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device("dev-2", tenant="platform-b")]))
    assert _open(db) == {"found": False}
    assert db.investigations.inserted == []


# ============== EVIDENCE ==============


def test_evidence_moves_the_hypotheses(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]

    result = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id,
        {"test": "auth_recent_failures", "result": "abnormal", "detail": "14 failures, bad password"}))
    assert result["found"] is True
    assert result["update"]["test"] == "auth_recent_failures"
    assert result["update"]["information_gain"] > 0
    after = result["investigation"]["probabilities_percent"]
    assert after["identity"] > 20.0
    assert round(sum(after.values()), 1) == 100.0
    assert result["investigation"]["evidence_count"] == 1
    assert "abnormal" in result["note"]


def test_inconclusive_evidence_changes_nothing(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]

    result = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id,
        {"test": "name_resolution", "result": "inconclusive", "detail": "could not reach the resolver"}))
    assert result["found"] is True
    assert result["update"]["information_gain"] == 0.0
    assert result["update"]["posteriors_after"] == result["update"]["posteriors_before"] == {
        "application": 25.0, "identity": 20.0, "endpoint": 20.0, "network": 20.0, "change": 15.0}
    assert result["investigation"]["evidence_count"] == 1
    assert "inconclusive" in result["note"]
    assert result["investigation"]["isolated"] is False


def test_evidence_rejects_unknown_test_and_bad_result(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]
    bad_test = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id, {"test": "vibes", "result": "abnormal"}))
    assert "unknown test" in bad_test["error"]
    bad_result = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id,
        {"test": "auth_recent_failures", "result": "maybe"}))
    assert "result must be one of" in bad_result["error"]
    missing = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", "INV-GHOST", {"test": "auth_recent_failures", "result": "normal"}))
    assert missing == {"found": False}


def test_repeated_discriminating_evidence_isolates_the_root_cause(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]

    first = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id,
        {"test": "same_application_other_device", "result": "abnormal"}))
    assert first["investigation"]["isolated"] is False

    second = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id,
        {"test": "runtime_and_licence_present", "result": "abnormal"}))
    assert second["investigation"]["isolated"] is True
    assert second["investigation"]["root_cause"]["domain"] == "application"
    assert "recorded evidence moved" in second["investigation"]["root_cause"]["basis"]

    summary = asyncio.run(nexus_diagnostics.investigation_summary(db, _user(), investigation_id))
    assert summary["investigation"]["isolated"] is True
    assert len(summary["investigation"]["evidence"]) == 2

    nxt = asyncio.run(nexus_diagnostics.next_best_test(db, _user(), investigation_id))
    assert nxt["test"] is None
    assert nxt["isolated"] is True
    assert "verified rather than assumed" in nxt["why"]


def test_next_test_excludes_already_recorded_tests(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]
    first_choice = asyncio.run(nexus_diagnostics.next_best_test(
        db, _user(), investigation_id))["test"]["test"]

    asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id,
        {"test": first_choice, "result": "normal"}))

    follow_up = asyncio.run(nexus_diagnostics.next_best_test(db, _user(), investigation_id))
    assert follow_up["test"]["test"] != first_choice
    assert follow_up["alternatives"]
    assert "not a promise" in follow_up["note"]


def test_all_tests_recorded_leaves_nothing_to_ask(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]
    for entry in nexus_diagnostics.DIAGNOSTIC_TESTS:
        asyncio.run(nexus_diagnostics.add_evidence(
            db, _user(), "Terry Tech", investigation_id,
            {"test": entry["test"], "result": "inconclusive"}))
    nxt = asyncio.run(nexus_diagnostics.next_best_test(db, _user(), investigation_id))
    assert nxt["test"] is None
    assert "Every test in the catalog" in nxt["why"]


# ============== CLOSING AND LISTING ==============


def test_closed_investigation_refuses_new_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]
    asyncio.run(nexus_diagnostics.close_investigation(
        db, _user(), "Terry Tech", investigation_id,
        {"outcome": "inconclusive", "note": "carrier confirmed nothing"}))
    rejected = asyncio.run(nexus_diagnostics.add_evidence(
        db, _user(), "Terry Tech", investigation_id, {"test": "name_resolution", "result": "normal"}))
    assert "closed" in rejected["error"]
    assert rejected["found"] is False


def test_resolved_close_needs_a_real_cause(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]))
    investigation_id = _open(db)["investigation"]["id"]

    refused = asyncio.run(nexus_diagnostics.close_investigation(
        db, _user(), "Terry Tech", investigation_id, {"outcome": "resolved"}))
    assert refused["found"] is False
    assert "invent" in refused["error"]

    bad_outcome = asyncio.run(nexus_diagnostics.close_investigation(
        db, _user(), "Terry Tech", investigation_id, {"outcome": "fixed"}))
    assert "outcome must be one of" in bad_outcome["error"]

    closed = asyncio.run(nexus_diagnostics.close_investigation(
        db, _user(), "Terry Tech", investigation_id,
        {"outcome": "resolved", "root_cause": "MYOB licence expired for this site"}))
    assert closed["found"] is True
    assert closed["investigation"]["status"] == "closed"
    assert closed["investigation"]["closed_outcome"] == "resolved"
    assert "expired" in closed["investigation"]["root_cause"]["basis"]

    twice = asyncio.run(nexus_diagnostics.close_investigation(
        db, _user(), "Terry Tech", investigation_id, {"outcome": "inconclusive"}))
    assert "already closed" in twice["error"]


def test_list_investigations_is_tenant_scoped_and_validates_status(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(devices=_Collection([_device()]),
             investigations=_Collection([
                 {"id": "INV-A", "tenant_id": "platform-a", "symptom": "printer", "status": "open",
                  "subject": {"type": "device", "id": "dev-1"}, "posteriors": {"application": 0.8},
                  "evidence": [{"test": "x"}], "root_cause": None, "updated_at": "2026-10-03T00:00:00+00:00"},
                 {"id": "INV-B", "tenant_id": "platform-b", "symptom": "email", "status": "open",
                  "subject": {"type": "device", "id": "dev-9"}, "posteriors": {"identity": 0.6},
                  "evidence": [], "root_cause": None, "updated_at": "2026-10-04T00:00:00+00:00"},
             ]))
    listed = asyncio.run(nexus_diagnostics.list_investigations(db, _user()))
    assert listed["count"] == 1
    assert [item["id"] for item in listed["investigations"]] == ["INV-A"]
    assert listed["investigations"][0]["probability_percent"] == 80.0
    assert listed["investigations"][0]["evidence_count"] == 1
    assert listed["open"] == 1

    other = asyncio.run(nexus_diagnostics.list_investigations(
        db, _user("u2", "Other Tech", tenant="platform-b")))
    assert [item["id"] for item in other["investigations"]] == ["INV-B"]

    bad = asyncio.run(nexus_diagnostics.list_investigations(db, _user(), status="nonsense"))
    assert bad["found"] is False
    assert "status must be one of" in bad["error"]


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
