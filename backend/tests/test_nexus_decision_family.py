"""Contract tests for the human-decision object family (P0 #7)."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timedelta, timezone
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
from app.services import nexus_decision_family  # noqa: E402


FIXED_NOW = datetime(2026, 10, 4, 8, 0, tzinfo=timezone.utc)


# ============== MINIMAL MONGO FAKES (same contract as test_tech_fun) ==============\


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
        self._rows = sorted(self._rows, key=lambda row: (row.get(field) is None, row.get(field)), reverse=direction < 0)
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
    for name in ("decision_family", "nexus_decisions", "risk_acceptances", "clients", "devices", "users", "tickets"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_decision_family, "_utcnow", lambda: FIXED_NOW)


# ============== LIFECYCLE SPEC ==============\


def test_lifecycle_spec_publishes_shared_states():
    spec = nexus_decision_family.lifecycle_spec()
    assert spec["states"] == ["proposed", "reviewed", "decided", "review-due", "expired"]
    assert spec["transitions"]["proposed"] == ["decided", "reviewed"]
    assert spec["terminal_states"] == ["expired"]
    assert set(spec["kinds"]) == {"decision_log", "risk_acceptance", "approval", "consent_receipt"}
    assert "derive" in spec["note"]


# ============== RECORDING ==============\


def test_record_object_validates_kind_subject_and_state(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    assert "kind must be" in asyncio.run(nexus_decision_family.record_object(
        db, _user(), "Terry Tech", {"kind": "mystery", "subject": "x"}))["error"]
    assert asyncio.run(nexus_decision_family.record_object(
        db, _user(), "Terry Tech", {"kind": "approval", "subject": "  "}))["error"] == "subject is required"
    assert "proposed or decided" in asyncio.run(nexus_decision_family.record_object(
        db, _user(), "Terry Tech", {"kind": "approval", "subject": "x", "state": "expired"}))["error"]
    assert db.decision_family.inserted == []


def test_record_object_stores_family_member(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = asyncio.run(nexus_decision_family.record_object(db, _user(), "Terry Tech", {
        "kind": "risk_acceptance", "subject": "Server 2012 stays until FY27",
        "client_id": "c1", "owner": "Dana Customer", "expires": "2027-04-01",
    }))
    assert result["found"] is True
    obj = result["object"]
    assert obj["id"].startswith("DFM-")
    assert obj["state"] == "proposed"
    assert obj["owner"] == "Dana Customer"
    assert obj["tenant_id"] == "platform-a"
    assert obj["transitions"] == []
    assert result["object"]["effective_state"] == "proposed"


def test_consent_receipt_can_be_born_decided(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = asyncio.run(nexus_decision_family.record_object(db, _user(), "Terry Tech", {
        "kind": "consent_receipt", "subject": "Customer consented to after-hours patching",
        "state": "decided", "decision": "consent given",
    }))
    obj = result["object"]
    assert obj["state"] == "decided"
    assert obj["decided_by"] == "Terry Tech"
    assert obj["decided_at"] == FIXED_NOW.isoformat()
    assert obj["effective_state"] == "decided"


# ============== TRANSITIONS ==============\


def test_transition_walks_the_lifecycle_with_audit_trail(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    obj = asyncio.run(nexus_decision_family.record_object(db, _user(), "Terry Tech", {
        "kind": "approval", "subject": "Raise RMM threshold to 90%"}))["object"]

    reviewed = asyncio.run(nexus_decision_family.transition(
        db, _user(), "Terry Tech", obj["id"], {"to_state": "reviewed", "note": "looks sane"}))
    assert reviewed["found"] is True
    assert reviewed["object"]["state"] == "reviewed"

    decided = asyncio.run(nexus_decision_family.transition(
        db, _user(uid="rev-2", name="Rita Reviewer"), "Rita Reviewer", obj["id"],
        {"to_state": "decided", "decision": "approved"}))
    assert decided["object"]["state"] == "decided"
    assert decided["object"]["decided_by"] == "Rita Reviewer"
    moves = decided["object"]["transitions"]
    assert [(m["from"], m["to"]) for m in moves] == [("proposed", "reviewed"), ("reviewed", "decided")]
    assert moves[0]["by"] == "Terry Tech" and moves[0]["note"] == "looks sane"


def test_illegal_transitions_are_rejected(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    obj = asyncio.run(nexus_decision_family.record_object(db, _user(), "Terry Tech", {
        "kind": "decision_log", "subject": "Keep the old firewall"}))["object"]

    bad = asyncio.run(nexus_decision_family.transition(
        db, _user(), "Terry Tech", obj["id"], {"to_state": "expired"}))
    assert bad["found"] is False
    assert "illegal transition proposed -> expired" in bad["error"]

    unknown = asyncio.run(nexus_decision_family.transition(
        db, _user(), "Terry Tech", obj["id"], {"to_state": "archived"}))
    assert "to_state must be" in unknown["error"]

    missing = asyncio.run(nexus_decision_family.transition(
        db, _user(), "Terry Tech", "ghost", {"to_state": "decided"}))
    assert missing == {"found": False}


def test_expired_is_terminal(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    obj = asyncio.run(nexus_decision_family.record_object(db, _user(), "Terry Tech", {
        "kind": "risk_acceptance", "subject": "Old risk", "state": "decided"}))["object"]
    expired = asyncio.run(nexus_decision_family.transition(
        db, _user(), "Terry Tech", obj["id"], {"to_state": "expired"}))
    assert expired["object"]["state"] == "expired"
    back = asyncio.run(nexus_decision_family.transition(
        db, _user(), "Terry Tech", obj["id"], {"to_state": "decided"}))
    assert back["found"] is False
    assert "terminal state" in back["error"]


# ============== HONEST DERIVED STATES ==============\


def test_effective_state_derives_review_due_and_expired():
    today = FIXED_NOW
    assert nexus_decision_family.effective_state("decided", "2027-04-01", "", today) == "decided"
    assert nexus_decision_family.effective_state("decided", "2026-10-10", "", today) == "review-due"
    assert nexus_decision_family.effective_state("decided", "", "2026-10-12", today) == "review-due"
    assert nexus_decision_family.effective_state("decided", "2026-09-01", "", today) == "expired"
    assert nexus_decision_family.effective_state("accepted", "2026-09-01", "", today) == "expired"
    assert nexus_decision_family.effective_state("proposed", "2026-09-01", "", today) == "proposed"


# ============== THE FAMILY INDEX ==============\


def test_family_index_merges_legacy_memory_with_derived_states(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        nexus_decisions=_Collection([{
            "id": "dec-1", "tenant_id": "platform-a", "client_id": "c1",
            "decision": "Keep SERVER02 until FY27", "reason": "budget",
            "review_date": "2027-04-01", "state": "active", "created_by_name": "Terry Tech",
            "created_at": "2026-09-01T09:00:00+00:00",
        }]),
        risk_acceptances=_Collection([{
            "id": "ra-1", "tenant_id": "platform-a", "client_id": "c1",
            "title": "Server 2012 stays", "risk_owner": "Dana Customer",
            "expires": "2026-09-15", "status": "accepted", "recorded_by": "Terry Tech",
            "created_at": "2026-08-01T09:00:00+00:00",
        }]),
        decision_family=_Collection([{
            "id": "DFM-1", "tenant_id": "platform-a", "kind": "consent_receipt",
            "client_id": "c1", "subject": "After-hours patching consent", "owner": "Dana Customer",
            "state": "decided", "expires": "2027-01-01", "review_date": "",
            "created_at": "2026-10-01T09:00:00+00:00",
        }]),
    )
    index = asyncio.run(nexus_decision_family.family_index(db, _user()))
    assert index["count"] == 3
    states = {item["id"]: item["state"] for item in index["objects"]}
    assert states["DFM-1"] == "decided"
    assert states["dec-1"] == "decided"
    assert states["ra-1"] == "expired"  # expiry 2026-09-15 is in the past of FIXED_NOW
    kinds = {item["id"]: item["kind"] for item in index["objects"]}
    assert kinds["dec-1"] == "decision_log"
    assert kinds["ra-1"] == "risk_acceptance"
    assert index["by_state"]["decided"] == 2
    assert index["open_risk_owners"] == []  # the only open-risk candidate expired
    assert "who accepted what risk" in index["question_answered"]


def test_family_index_is_tenant_and_client_scoped(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(decision_family=_Collection([
        {"id": "DFM-1", "tenant_id": "platform-a", "kind": "approval", "client_id": "c1",
         "subject": "Threshold change", "state": "proposed", "created_at": "2026-10-01T09:00:00+00:00"},
        {"id": "DFM-2", "tenant_id": "platform-a", "kind": "approval", "client_id": "c2",
         "subject": "Other customer change", "state": "proposed", "created_at": "2026-10-02T09:00:00+00:00"},
        {"id": "DFM-3", "tenant_id": "platform-b", "kind": "approval", "client_id": "c1",
         "subject": "Foreign tenant", "state": "proposed", "created_at": "2026-10-03T09:00:00+00:00"},
    ]))
    scoped = asyncio.run(nexus_decision_family.family_index(db, _user(), "c1"))
    assert [item["id"] for item in scoped["objects"]] == ["DFM-1"]
    other_tenant = asyncio.run(nexus_decision_family.family_index(
        db, {"id": "x", "name": "X", "tenant_id": "platform-b", "client_scope_mode": "all"}))
    assert [item["id"] for item in other_tenant["objects"]] == ["DFM-3"]


# ============== ROUTER CONTRACT ==============\


def test_router_record_family_object_rejects_bad_payload(monkeypatch):
    monkeypatch.setattr(tech_fun_router, "db", _db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.record_family_object({"kind": "mystery"}, _user()))
    assert exc.value.status_code == 400


def test_router_transition_unknown_object_is_404(monkeypatch):
    monkeypatch.setattr(tech_fun_router, "db", _db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.transition_family_object("ghost", {"to_state": "decided"}, _user()))
    assert exc.value.status_code == 404


def test_router_lifecycle_endpoint_returns_spec():
    spec = asyncio.run(tech_fun_router.decision_family_lifecycle(_user()))
    assert "review-due" in spec["states"]
