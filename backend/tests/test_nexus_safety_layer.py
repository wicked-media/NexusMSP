"""Contract tests for the safety UX layer: writing guard, wrong-customer, four-eyes."""

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
from app.services import nexus_decision_family, nexus_safety_layer  # noqa: E402


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
    monkeypatch.setattr(nexus_safety_layer, "_utcnow", lambda: FIXED_NOW)
    monkeypatch.setattr(nexus_decision_family, "_utcnow", lambda: FIXED_NOW)


def _estate_db():
    return _db(
        clients=_Collection([
            {"id": "c1", "name": "Acme Corporation", "tenant_id": "platform-a"},
            {"id": "c2", "name": "Contoso Ltd", "tenant_id": "platform-a"},
        ]),
        devices=_Collection([
            {"id": "d1", "hostname": "ACME-DC-01", "client_id": "c1",
             "client_name": "Acme Corporation", "tenant_id": "platform-a"},
            {"id": "d2", "hostname": "CONTOSO-SRV-1", "client_id": "c2",
             "client_name": "Contoso Ltd", "tenant_id": "platform-a"},
        ]),
    )


# ============== WRITING GUARD ==============\


def test_writing_guard_flags_cross_customer_name(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_safety_layer.writing_guard(_estate_db(), _user(), {
        "content": "Dear Contoso Ltd, please see the attached invoice.", "client_id": "c1"}))
    assert result["found"] is True
    assert result["verdict"] == "review_required"
    warning = result["warnings"][0]
    assert warning["kind"] == "cross_customer_name"
    assert warning["message"] == "This content references Contoso Ltd, you are replying to Acme Corporation."


def test_writing_guard_flags_cross_customer_device(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_safety_layer.writing_guard(_estate_db(), _user(), {
        "content": "Please reboot CONTOSO-SRV-1 tonight.", "client_id": "c1"}))
    assert result["verdict"] == "review_required"
    warning = result["warnings"][0]
    assert warning["kind"] == "cross_customer_device"
    assert warning["client_id"] == "c2"
    assert "CONTOSO-SRV-1" in warning["message"]


def test_writing_guard_clean_for_own_customer(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_safety_layer.writing_guard(_estate_db(), _user(), {
        "content": "Dear Acme Corporation, we will reboot ACME-DC-01 tonight.", "client_id": "c1"}))
    assert result["verdict"] == "clean"
    assert result["warnings"] == []
    assert len(result["references"]) == 2
    assert result["checked_against"] == {"clients": 2, "devices": 2}


def test_writing_guard_without_target_reports_references(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_safety_layer.writing_guard(_estate_db(), _user(), {
        "content": "Contoso Ltd signed the quote."}))
    assert result["verdict"] == "clean"
    assert result["warnings"] == []
    assert result["references"][0]["name"] == "Contoso Ltd"
    assert "client_id" in result["note"]


def test_writing_guard_rejects_empty_content_and_unknown_client(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _estate_db()
    assert asyncio.run(nexus_safety_layer.writing_guard(db, _user(), {"content": "  "}))["error"] == "content is required"
    assert asyncio.run(nexus_safety_layer.writing_guard(
        db, _user(), {"content": "hello", "client_id": "ghost"}))["error"] == "client_id not found in your tenant"


# ============== WRONG-CUSTOMER PROTECTION ==============\


def test_wrong_customer_check_blocks_mismatched_content(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_safety_layer.wrong_customer_check(_estate_db(), _user(), {
        "content": "Hi Contoso Ltd — here is the Acme Corporation service review.", "client_id": "c1"}))
    assert result["found"] is True
    assert result["verdict"] == "review_required"
    assert result["target"] == {"id": "c1", "name": "Acme Corporation"}
    assert result["note"].startswith("Hold before sending")


def test_wrong_customer_check_passes_matching_content(monkeypatch):
    _fixed_clock(monkeypatch)
    result = asyncio.run(nexus_safety_layer.wrong_customer_check(_estate_db(), _user(), {
        "content": "Hi Acme Corporation — your ACME-DC-01 patch window is confirmed.", "client_id": "c1"}))
    assert result["verdict"] == "clean"
    assert result["note"].startswith("No cross-customer references detected.")


def test_wrong_customer_check_requires_both_fields(monkeypatch):
    _fixed_clock(monkeypatch)
    assert asyncio.run(nexus_safety_layer.wrong_customer_check(
        _estate_db(), _user(), {"content": "hi"}))["error"] == "client_id and content are required"


# ============== REAL DIFFS ==============\


def test_diff_changes_reports_real_values_at_real_paths():
    changes = nexus_safety_layer.diff_changes(
        {"threshold": 80, "notify": {"email": "ops@acme.test", "sms": "+15550000"}},
        {"threshold": 90, "notify": {"email": "ops@acme.test", "slack": "#noc"}})
    by_path = {change["path"]: change for change in changes}
    assert by_path["threshold"] == {"path": "threshold", "kind": "changed", "before": 80, "after": 90}
    assert by_path["notify.sms"] == {"path": "notify.sms", "kind": "removed", "before": "+15550000", "after": None}
    assert by_path["notify.slack"] == {"path": "notify.slack", "kind": "added", "before": None, "after": "#noc"}
    assert "notify.email" not in by_path


# ============== FOUR-EYES ==============\


def test_request_four_eyes_attaches_the_real_diff(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _estate_db()
    result = asyncio.run(nexus_safety_layer.request_four_eyes(db, _user(), "Terry Tech", {
        "title": "Raise RMM alert threshold", "client_id": "c1",
        "before": {"threshold": 80}, "after": {"threshold": 95}}))
    assert result["found"] is True
    assert result["review_id"].startswith("DFM-")
    assert result["diff"]["changes"] == [
        {"path": "threshold", "kind": "changed", "before": 80, "after": 95}]
    assert result["diff"]["summary"] == {"added": 0, "removed": 0, "changed": 1}
    assert result["object"]["state"] == "proposed"
    assert result["object"]["kind"] == "approval"


def test_request_four_eyes_rejects_noop_or_missing_diff(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _estate_db()
    assert asyncio.run(nexus_safety_layer.request_four_eyes(
        db, _user(), "Terry Tech", {"title": "Same"}))["error"] == "before and/or after state is required"
    assert asyncio.run(nexus_safety_layer.request_four_eyes(
        db, _user(), "Terry Tech", {"title": "Same", "before": {"a": 1}, "after": {"a": 1}}))[
        "error"] == "before and after are identical — nothing to approve"
    assert asyncio.run(nexus_safety_layer.request_four_eyes(
        db, _user(), "Terry Tech", {"before": {"a": 1}, "after": {"a": 2}}))["error"] == "title is required"


def test_four_eyes_refuses_self_approval(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _estate_db()
    review_id = asyncio.run(nexus_safety_layer.request_four_eyes(db, _user(), "Terry Tech", {
        "title": "Raise threshold", "before": {"threshold": 80}, "after": {"threshold": 95}}))["review_id"]
    result = asyncio.run(nexus_safety_layer.review_four_eyes(db, _user(), "Terry Tech", review_id, {
        "decision": "approved"}))
    assert result["found"] is False
    assert result["error"] == "four-eyes: the requester cannot sign off their own change"


def test_four_eyes_independent_review_decides_once(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _estate_db()
    review_id = asyncio.run(nexus_safety_layer.request_four_eyes(db, _user(), "Terry Tech", {
        "title": "Raise threshold", "before": {"threshold": 80}, "after": {"threshold": 95}}))["review_id"]

    bad_decision = asyncio.run(nexus_safety_layer.review_four_eyes(
        db, _user(uid="rev-2", name="Rita Reviewer"), "Rita Reviewer", review_id, {"decision": "maybe"}))
    assert bad_decision["error"] == "decision must be approved or rejected"

    decided = asyncio.run(nexus_safety_layer.review_four_eyes(
        db, _user(uid="rev-2", name="Rita Reviewer"), "Rita Reviewer", review_id,
        {"decision": "approved", "note": "checked with change board"}))
    assert decided["found"] is True
    assert decided["decision"] == "approved"
    assert decided["object"]["state"] == "decided"
    assert decided["object"]["decided_by"] == "Rita Reviewer"
    assert decided["diff"]["changes"][0]["before"] == 80

    again = asyncio.run(nexus_safety_layer.review_four_eyes(
        db, _user(uid="rev-3", name="Sam Second"), "Sam Second", review_id, {"decision": "rejected"}))
    assert again["found"] is False
    assert "already decided" in again["error"]


def test_review_four_eyes_unknown_id_is_not_found(monkeypatch):
    _fixed_clock(monkeypatch)
    assert asyncio.run(nexus_safety_layer.review_four_eyes(
        _estate_db(), _user(), "Terry Tech", "ghost", {"decision": "approved"})) == {"found": False}


def test_list_four_eyes_reports_pending_queue(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _estate_db()
    asyncio.run(nexus_safety_layer.request_four_eyes(db, _user(), "Terry Tech", {
        "title": "Raise threshold", "before": {"threshold": 80}, "after": {"threshold": 95}}))
    review_id = asyncio.run(nexus_safety_layer.request_four_eyes(db, _user(), "Terry Tech", {
        "title": "Open firewall port", "before": {"ports": [443]}, "after": {"ports": [443, 8443]}}))["review_id"]
    asyncio.run(nexus_safety_layer.review_four_eyes(
        db, _user(uid="rev-2", name="Rita Reviewer"), "Rita Reviewer", review_id, {"decision": "approved"}))

    listing = asyncio.run(nexus_safety_layer.list_four_eyes(db, _user()))
    assert listing["count"] == 2
    assert listing["pending"] == 1
    decided_item = next(item for item in listing["sign_offs"] if item["id"] == review_id)
    assert decided_item["decision"] == "approved"
    assert decided_item["diff_summary"]["added"] == 1


# ============== ROUTER CONTRACT ==============\


def test_router_writing_guard_rejects_empty_draft(monkeypatch):
    monkeypatch.setattr(tech_fun_router, "db", _db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.safety_writing_guard({"content": ""}, _user()))
    assert exc.value.status_code == 400


def test_router_review_unknown_sign_off_is_404(monkeypatch):
    monkeypatch.setattr(tech_fun_router, "db", _db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.review_four_eyes("ghost", {"decision": "approved"}, _user()))
    assert exc.value.status_code == 404


def test_router_request_four_eyes_rejects_missing_title(monkeypatch):
    monkeypatch.setattr(tech_fun_router, "db", _db())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.request_four_eyes({"before": {"a": 1}, "after": {"a": 2}}, _user()))
    assert exc.value.status_code == 400
