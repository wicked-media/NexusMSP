"""Contract tests for the Nexus Evidence Engine (operation evidence + packs)."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.services import nexus_evidence  # noqa: E402


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


def _db(**collections):
    namespace = SimpleNamespace()
    for name in ("operation_evidence", "evidence_packs", "clients", "devices", "tickets"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False, tenant="platform-a"):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": tenant, "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_evidence, "_utcnow", lambda: FIXED_NOW)


def _record(db, user=None, **overrides):
    payload = {
        "operation": "patch.deploy",
        "target_id": "dev-1",
        "target_type": "device",
        "method": "agent_command",
        "actor_kind": "automation",
        "outcome": "success",
        "required_checks": ["service_running", "port_listening"],
        "checks": [
            {"check": "service_running", "observed": True, "evidence_ref": "ev/1"},
            {"check": "port_listening", "observed": True, "evidence_ref": "ev/2"},
        ],
    }
    payload.update(overrides)
    return asyncio.run(nexus_evidence.record_evidence(db, user or _user(), "Terry Tech", payload))


def _entry(entry_id, verdict_checks, outcome="success", tenant="platform-a", client_id="CLI-001",
           recorded_at=None, entry_hash=None, required_checks=None):
    """A pre-seeded evidence row, so reads can be tested without recording."""
    return {
        "id": entry_id,
        "tenant_id": tenant,
        "client_id": client_id,
        "operation": "patch.deploy",
        "target_type": "device",
        "target_id": "dev-1",
        "outcome": outcome,
        "required_checks": list(required_checks or ["service_running"]),
        "checks": verdict_checks,
        "chain": {"sequence": 1, "previous_hash": "", "entry_hash": entry_hash or f"hash-{entry_id}"},
        "recorded_at": (recorded_at or FIXED_NOW).isoformat(),
    }


# ============== THE PUBLISHED CONTRACT ==============


def test_contract_publishes_verdicts_and_the_never_infer_rule():
    contract = nexus_evidence.evidence_contract()
    assert contract["verdicts"] == ["verified", "partial", "unverified", "failed"]
    assert set(contract["verdict_meaning"]) == set(nexus_evidence.EVIDENCE_VERDICTS)
    assert "not a pass" in contract["required_observation"]
    assert "never infers" in contract["note"]
    assert "hash-chained" in contract["integrity"]
    assert "no secrets" in contract["pack"].lower()


# ============== RECORDING VALIDATION ==============


def test_record_evidence_validates_its_input(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    assert _record(db, operation="")["error"] == "operation is required"
    assert _record(db, target_id="  ")["error"] == "target_id is required"
    assert "outcome must be one of" in _record(db, outcome="maybe")["error"]
    assert _record(db, required_checks=[])["error"] == "required_checks must be a non-empty list"
    assert _record(db, required_checks="service_running")["error"] == \
        "required_checks must be a non-empty list"
    assert db.operation_evidence.inserted == []


def test_record_evidence_rejects_bad_check_entries(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    unknown = _record(db, checks=[{"check": "vibes", "observed": True}])
    assert unknown["found"] is False
    assert "is not a required check" in unknown["error"]
    duplicate_required = _record(db, required_checks=["service_running", "service_running"])
    assert duplicate_required["error"] == "duplicate check 'service_running'"
    duplicate_check = _record(db, checks=[
        {"check": "service_running", "observed": True},
        {"check": "service_running", "observed": True},
    ])
    assert duplicate_check["error"] == "duplicate check 'service_running'"
    not_boolean = _record(db, checks=[{"check": "service_running", "observed": "true"}])
    assert not_boolean["error"] == "observed must be true or false for 'service_running'"
    assert db.operation_evidence.inserted == []


# ============== THE VERDICT IS DERIVED ==============


def test_verified_requires_every_required_check_observed_and_true(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    recorded = _record(db)
    assert recorded["found"] is True
    assert recorded["verdict"]["verdict"] == "verified"
    assert recorded["verdict"]["unobserved_required"] == []
    assert recorded["evidence"]["id"].startswith("EVD-")
    assert recorded["evidence"]["verdict"] == "verified"

    checked = asyncio.run(nexus_evidence.verify_operation(db, _user(), recorded["evidence"]["id"]))
    assert checked["found"] is True
    assert checked["verdict"]["verdict"] == "verified"
    assert "Verified" in checked["note"]


def test_partial_when_a_required_check_is_unobserved(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    recorded = _record(db, checks=[{"check": "service_running", "observed": True}])
    assert recorded["verdict"]["verdict"] in ("partial", "unverified")
    # A success outcome with SOME evidence but a missing required check is partial, never verified.
    assert recorded["verdict"]["verdict"] == "partial"
    assert recorded["verdict"]["unobserved_required"] == ["port_listening"]
    assert "not proof of success" in recorded["verdict"]["reason"] or \
        "Success is unproven" in recorded["verdict"]["reason"]

    checked = asyncio.run(nexus_evidence.verify_operation(db, _user(), recorded["evidence"]["id"]))
    assert checked["verdict"]["verdict"] == "partial"
    assert checked["unobserved_required"] == ["port_listening"]
    assert checked["note"].startswith("Not verified.")


def test_unverified_when_no_check_has_an_observation(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    recorded = _record(db, checks=None)
    assert recorded["verdict"]["verdict"] == "unverified"
    assert recorded["verdict"]["observed_checks"] == []
    assert "absence of evidence is not success" in recorded["verdict"]["reason"]

    # An unknown outcome with no observations is also unverified, not partial.
    unknown_outcome = _record(db, checks=None, outcome="unknown", target_id="dev-2")
    assert unknown_outcome["verdict"]["verdict"] == "unverified"


def test_a_false_observation_is_failed(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    recorded = _record(db, checks=[
        {"check": "service_running", "observed": True},
        {"check": "port_listening", "observed": False},
    ])
    assert recorded["verdict"]["verdict"] == "failed"
    assert recorded["verdict"]["failed_required"] == ["port_listening"]
    assert "port_listening" in recorded["verdict"]["reason"]


def test_failure_outcome_is_failed_regardless_of_checks(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    every_check_passing = _record(db, outcome="failure")
    assert every_check_passing["verdict"]["verdict"] == "failed"
    assert every_check_passing["verdict"]["failed_required"] == []
    assert "no check can make this a success" in every_check_passing["verdict"]["reason"]


def test_verdict_is_derived_and_a_supplied_verdict_is_ignored(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    recorded = _record(db, verdict="verified", checks=[{"check": "service_running", "observed": True}])
    assert recorded["verdict"]["verdict"] == "partial"
    assert recorded["evidence"]["verdict"] == "partial"

    first = asyncio.run(nexus_evidence.verify_operation(db, _user(), recorded["evidence"]["id"]))
    second = asyncio.run(nexus_evidence.verify_operation(db, _user(), recorded["evidence"]["id"]))
    assert first["verdict"] == second["verdict"]
    assert first["verdict"]["verdict"] == "partial"
    assert asyncio.run(nexus_evidence.verify_operation(db, _user(), "EVD-GHOST")) == {"found": False}


# ============== INTEGRITY ==============


def test_hash_chain_links_entries_and_recomputes(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    first = _record(db, target_id="dev-1")
    second = _record(db, target_id="dev-2")
    rows = db.operation_evidence.rows
    assert len(rows) == 2
    assert rows[0]["chain"]["sequence"] == 1
    assert rows[0]["chain"]["previous_hash"] == ""
    assert rows[1]["chain"]["sequence"] == 2
    assert rows[1]["chain"]["previous_hash"] == rows[0]["chain"]["entry_hash"]
    assert rows[1]["chain"]["entry_hash"] != rows[0]["chain"]["entry_hash"]

    for row in rows:
        assert nexus_evidence.compute_entry_hash(row) == row["chain"]["entry_hash"]
    assert second["evidence"]["chain"]["previous_hash"] == first["evidence"]["chain"]["entry_hash"]


def test_tampering_with_a_stored_body_changes_the_recomputed_hash(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    recorded = _record(db)
    row = db.operation_evidence.rows[0]
    original = nexus_evidence.compute_entry_hash(row)
    assert original == row["chain"]["entry_hash"]

    row["checks"][0]["observed"] = False
    assert nexus_evidence.compute_entry_hash(row) != original

    # And the derived verdict follows the tampered body, so a lie cannot survive a re-read.
    verdict = nexus_evidence.derive_verdict(row["outcome"], row["required_checks"], row["checks"])
    assert verdict["verdict"] == "failed"

    integrity = asyncio.run(nexus_evidence.get_evidence(db, _user(), recorded["evidence"]["id"]))
    assert integrity["integrity"]["recomputed_hash"] != integrity["integrity"]["recorded_hash"]


# ============== PACKS ==============


def test_pack_with_explicit_ids_selects_exactly_those(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(operation_evidence=_Collection([
        _entry("EVD-A", [{"check": "service_running", "observed": True}]),
        _entry("EVD-B", [{"check": "service_running", "observed": True}], client_id="CLI-002"),
    ]))
    pack = asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "INC-414 evidence", "subject": "Print outage",
        "evidence_ids": ["EVD-A", "EVD-B"],
    }))
    assert pack["found"] is True
    assert pack["pack"]["id"].startswith("PCK-")
    assert pack["pack"]["evidence_ids"] == ["EVD-A", "EVD-B"]
    assert pack["pack"]["evidence_count"] == 2
    assert pack["pack"]["summary"]["verified"] == 2
    assert pack["pack"]["integrity"]["algorithm"] == "sha256"
    assert len(pack["pack"]["integrity"]["root_hash"]) == 64
    assert "no secrets" in pack["note"].lower()

    assert asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "x", "subject": "y", "evidence_ids": []}))["error"] == \
        "evidence_ids must be a non-empty list"
    assert asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "x", "subject": "y", "evidence_ids": ["EVD-A"], "verdict": "verified"}))["found"] is True
    assert asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "", "subject": "y"}))["error"] == "title is required"
    assert asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "x", "subject": " "}))["error"] == "subject is required"


def test_pack_rejects_a_foreign_or_missing_evidence_id(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(operation_evidence=_Collection([
        _entry("EVD-A", [{"check": "service_running", "observed": True}]),
        _entry("EVD-OTHER", [{"check": "service_running", "observed": True}], tenant="platform-b"),
    ]))
    missing = asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "x", "subject": "y", "evidence_ids": ["EVD-NOPE"]}))
    assert missing["found"] is False
    assert "'EVD-NOPE' not found in your scope" in missing["error"]

    foreign = asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "x", "subject": "y", "evidence_ids": ["EVD-OTHER"]}))
    assert foreign["found"] is False
    assert "EVD-OTHER" in foreign["error"]
    assert db.evidence_packs.inserted == []


def test_windowed_pack_selects_only_in_window_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(operation_evidence=_Collection([
        _entry("EVD-IN", [{"check": "service_running", "observed": True}],
               recorded_at=FIXED_NOW - timedelta(days=2)),
        _entry("EVD-OUT", [{"check": "service_running", "observed": True}],
               recorded_at=FIXED_NOW - timedelta(days=90)),
        _entry("EVD-OTHER", [{"check": "service_running", "observed": True}],
               client_id="CLI-002", recorded_at=FIXED_NOW - timedelta(days=1)),
        _entry("EVD-FOREIGN", [{"check": "service_running", "observed": True}],
               tenant="platform-b", recorded_at=FIXED_NOW - timedelta(days=1)),
    ]))
    pack = asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "Windowed", "subject": "CLI-001 recovery proof",
        "client_id": "CLI-001", "window_days": 30,
    }))
    assert pack["found"] is True
    assert pack["pack"]["evidence_ids"] == ["EVD-IN"]
    assert pack["pack"]["window"]["days"] == 30

    bad_window = asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "x", "subject": "y", "window_days": 9999}))
    assert bad_window["found"] is False
    assert "window_days must be between" in bad_window["error"]


def test_manifest_summary_counts_each_verdict(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(operation_evidence=_Collection([
        _entry("EVD-V", [{"check": "service_running", "observed": True}]),
        _entry("EVD-P", [{"check": "service_running", "observed": True}],
               required_checks=["service_running", "port_listening"]),
        _entry("EVD-F", [{"check": "service_running", "observed": False}]),
        _entry("EVD-FAIL", [{"check": "service_running", "observed": True}], outcome="failure"),
    ]))
    pack = asyncio.run(nexus_evidence.build_evidence_pack(db, _user(), "Terry Tech", {
        "title": "Mixed", "subject": "Full manifest",
        "evidence_ids": ["EVD-V", "EVD-P", "EVD-F", "EVD-FAIL"],
    }))
    assert pack["pack"]["summary"] == {"verified": 1, "partial": 1, "unverified": 0, "failed": 2}
    manifest = {row["id"]: row["verdict"] for row in pack["pack"]["manifest"]}
    assert manifest["EVD-V"] == "verified"
    assert manifest["EVD-P"] == "partial"
    assert manifest["EVD-F"] == "failed"
    assert manifest["EVD-FAIL"] == "failed"

    fetched = asyncio.run(nexus_evidence.get_pack(db, _user(), pack["pack"]["id"]))
    assert fetched["found"] is True
    assert fetched["integrity"]["unchanged"] is True
    assert fetched["integrity"]["recomputed_root_hash"] == fetched["integrity"]["recorded_root_hash"]


# ============== TENANT ISOLATION ==============


def test_evidence_and_packs_are_tenant_scoped(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        operation_evidence=_Collection([
            _entry("EVD-A", [{"check": "service_running", "observed": True}]),
            _entry("EVD-B", [{"check": "service_running", "observed": True}], tenant="platform-b"),
        ]),
        evidence_packs=_Collection([
            {"id": "PCK-A", "tenant_id": "platform-a", "title": "a", "subject": "a",
             "evidence_count": 1, "manifest": [], "summary": {}, "integrity": {"root_hash": "x"},
             "generated_at": "2026-10-04T00:00:00+00:00"},
            {"id": "PCK-B", "tenant_id": "platform-b", "title": "b", "subject": "b",
             "evidence_count": 1, "manifest": [], "summary": {}, "integrity": {"root_hash": "y"},
             "generated_at": "2026-10-04T00:00:00+00:00"},
        ]),
    )
    listed = asyncio.run(nexus_evidence.list_evidence(db, _user()))
    assert listed["count"] == 1
    assert [row["id"] for row in listed["evidence"]] == ["EVD-A"]
    assert asyncio.run(nexus_evidence.get_evidence(db, _user(), "EVD-B")) == {"found": False}
    assert asyncio.run(nexus_evidence.get_evidence(db, _user(tenant="platform-b"), "EVD-B"))["found"] is True

    packs = asyncio.run(nexus_evidence.list_packs(db, _user()))
    assert packs["count"] == 1
    assert [row["id"] for row in packs["packs"]] == ["PCK-A"]
    assert asyncio.run(nexus_evidence.get_pack(db, _user(), "PCK-B")) == {"found": False}

    # Recording in one tenant never appears in the other.
    _record(db, user=_user(tenant="platform-b"), target_id="dev-b")
    assert asyncio.run(nexus_evidence.list_evidence(db, _user()))["count"] == 1


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
