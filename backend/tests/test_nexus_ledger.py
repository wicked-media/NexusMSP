"""Contract tests for metering + transaction ledger: usage, double-entry, shares."""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from bson import ObjectId  # noqa: E402

from app.services import nexus_ledger  # noqa: E402

FIXED_NOW = datetime(2026, 10, 5, 8, 0, tzinfo=timezone.utc)


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
        row["_id"] = ObjectId()  # mimic pymongo: insert_one mutates the document in place
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
    for name in ("usage_meter_events", "ledger_entries", "users", "devices"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_ledger, "_utcnow", lambda: FIXED_NOW)


def _run(coro):
    return asyncio.run(coro)


# ============== USAGE METERING ==============


def test_record_usage_stores_event_with_dimensions(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = _run(nexus_ledger.record_usage(db, _user(), "Terry Tech", {
        "meter": "endpoints.managed", "quantity": 15, "unit": "device",
        "client_id": "c1", "dimensions": {"site": "Perth"}, "idempotency_key": "k1",
    }))
    assert result["found"] is True
    stored = db.usage_meter_events.inserted[0]
    assert stored["tenant_id"] == "platform-a"
    assert stored["meter"] == "endpoints.managed"
    assert stored["quantity"] == 15.0
    assert stored["dimensions"] == {"site": "Perth"}
    assert stored["recorded_at"] == FIXED_NOW.isoformat()


def test_record_usage_validates_meter_and_quantity(monkeypatch):
    _fixed_clock(monkeypatch)
    assert _run(nexus_ledger.record_usage(_db(), _user(), "T", {"quantity": 1})) == \
        {"found": False, "error": "meter is required"}
    result = _run(nexus_ledger.record_usage(_db(), _user(), "T", {"meter": "x", "quantity": -2}))
    assert result == {"found": False, "error": "quantity must be a non-negative number"}


def test_record_usage_is_idempotent_on_key(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    payload = {"meter": "mailboxes.protected", "quantity": 3, "idempotency_key": "dup-1"}
    first = _run(nexus_ledger.record_usage(db, _user(), "T", payload))
    second = _run(nexus_ledger.record_usage(db, _user(), "T", payload))
    assert first.get("idempotent_replay") is None
    assert second["idempotent_replay"] is True
    assert len(db.usage_meter_events.inserted) == 1


def test_usage_summary_aggregates_per_meter(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(usage_meter_events=_Collection([
        {"id": "u1", "tenant_id": "platform-a", "meter": "storage.gb", "quantity": 100.0, "unit": "GB"},
        {"id": "u2", "tenant_id": "platform-a", "meter": "storage.gb", "quantity": 50.5, "unit": "GB"},
        {"id": "u3", "tenant_id": "platform-a", "meter": "endpoints.managed", "quantity": 15.0},
    ]))
    summary = _run(nexus_ledger.usage_summary(db, _user()))
    assert summary["events"] == 3
    assert summary["meters"]["storage.gb"]["quantity"] == 150.5
    assert summary["meters"]["endpoints.managed"]["events"] == 1


# ============== DOUBLE-ENTRY LEDGER ==============


def _transfer(amount=2500.0, ref="INV-9", key="tx-1"):
    return {"entries": [
        {"account": "accounts_receivable", "direction": "debit", "amount": amount},
        {"account": "revenue_managed_services", "direction": "credit", "amount": amount},
    ], "client_id": "c1", "transaction_ref": ref, "idempotency_key": key}


def test_post_entries_stores_balanced_hash_chained_pair(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = _run(nexus_ledger.post_entries(db, _user(), "Terry Tech", _transfer()))
    assert result["found"] is True
    assert result["transaction_balanced"] is True
    first, second = db.ledger_entries.inserted
    assert first["sequence"] == 1 and second["sequence"] == 2
    assert second["previous_hash"] == first["entry_hash"]
    assert first["previous_hash"] == ""
    assert first["tenant_id"] == "platform-a"


def test_post_entries_rejects_unbalanced_transaction(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = _run(nexus_ledger.post_entries(db, _user(), "T", {"entries": [
        {"account": "a", "direction": "debit", "amount": 100},
        {"account": "b", "direction": "credit", "amount": 90},
    ]}))
    assert result["found"] is False
    assert "not balanced" in result["error"]
    assert db.ledger_entries.inserted == []


def test_post_entries_validates_entry_shape(monkeypatch):
    _fixed_clock(monkeypatch)
    result = _run(nexus_ledger.post_entries(_db(), _user(), "T", {"entries": []}))
    assert result["found"] is False
    result = _run(nexus_ledger.post_entries(_db(), _user(), "T", {"entries": [
        {"account": "a", "direction": "sideways", "amount": 5}]}))
    assert "direction" in result["error"]


def test_post_entries_is_idempotent_on_key(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    _run(nexus_ledger.post_entries(db, _user(), "T", _transfer()))
    replay = _run(nexus_ledger.post_entries(db, _user(), "T", _transfer()))
    assert replay["idempotent_replay"] is True
    assert len(db.ledger_entries.inserted) == 2  # one transaction, not two


def test_account_balance_computes_net(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    _run(nexus_ledger.post_entries(db, _user(), "T", _transfer(amount=1000.0, key="a")))
    _run(nexus_ledger.post_entries(db, _user(), "T", {
        "entries": [
            {"account": "revenue_managed_services", "direction": "debit", "amount": 200.0},
            {"account": "accounts_receivable", "direction": "credit", "amount": 200.0},
        ], "idempotency_key": "b",
    }))
    balance = _run(nexus_ledger.account_balance(db, _user(), "accounts_receivable"))
    assert balance["found"] is True
    assert balance["debits"] == 1000.0
    assert balance["credits"] == 200.0
    assert balance["net"] == 800.0
    assert _run(nexus_ledger.account_balance(db, _user(), "ghost"))["found"] is False


def test_statement_groups_accounts(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    _run(nexus_ledger.post_entries(db, _user(), "T", _transfer(amount=500.0)))
    statement = _run(nexus_ledger.statement(db, _user()))
    assert statement["entry_count"] == 2
    assert statement["accounts"]["accounts_receivable"]["net"] == 500.0
    assert statement["accounts"]["revenue_managed_services"]["net"] == -500.0


def test_ledger_write_responses_never_leak_mongo_ids(monkeypatch):
    """pymongo mutates inserted docs with an ObjectId _id; responses must never carry it."""
    _fixed_clock(monkeypatch)
    db = _db()
    usage = _run(nexus_ledger.record_usage(db, _user(), "T", {"meter": "m", "quantity": 1}))
    assert "_id" not in usage["usage_event"]
    result = _run(nexus_ledger.post_entries(db, _user(), "T", _transfer()))
    assert all("_id" not in entry for entry in result["entries"])
    replay = _run(nexus_ledger.post_entries(db, _user(), "T", _transfer()))
    assert all("_id" not in entry for entry in replay["entries"])


# ============== REVENUE SHARE (rates are never invented) ==============


def test_revenue_share_preview_uses_supplied_rate_only(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(usage_meter_events=_Collection([
        {"id": "u1", "tenant_id": "platform-a", "meter": "endpoints.managed", "quantity": 100.0},
    ]))
    result = _run(nexus_ledger.revenue_share_preview(db, _user(), {
        "meter": "endpoints.managed", "rate_per_unit": 2.5, "platform_share_percent": 10}))
    assert result["found"] is True
    assert result["gross"] == 250.0
    assert result["platform_fee"] == 25.0
    assert result["msp_net"] == 225.0
    assert "supplied by the caller" in result["note"]


def test_revenue_share_preview_refuses_missing_rate(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(usage_meter_events=_Collection([
        {"id": "u1", "tenant_id": "platform-a", "meter": "m", "quantity": 1.0}]))
    result = _run(nexus_ledger.revenue_share_preview(db, _user(), {"meter": "m", "platform_share_percent": 5}))
    assert result["found"] is False
    assert "never invented" in result["error"]
    result = _run(nexus_ledger.revenue_share_preview(db, _user(), {
        "meter": "m", "rate_per_unit": 1, "platform_share_percent": 101}))
    assert "between 0 and 100" in result["error"]
    result = _run(nexus_ledger.revenue_share_preview(db, _user(), {
        "meter": "ghost", "rate_per_unit": 1, "platform_share_percent": 5}))
    assert result["found"] is False
