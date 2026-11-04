"""Contract tests for the intent model: record business intent, evaluate drift."""

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

from fastapi import HTTPException  # noqa: E402

from app.routers import tech_fun as tech_fun_router  # noqa: E402
from app.services import nexus_intent  # noqa: E402

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
    for name in ("tickets", "users", "devices", "clients", "contracts", "alerts",
                 "device_events", "device_patches", "ssl_certificates",
                 "work_activity_audit", "nexus_intents", "genome_patterns",
                 "usage_meter_events", "ledger_entries"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", admin=False):
    return {"id": uid, "name": name, "role": "admin" if admin else "tech",
            "is_admin": admin, "tenant_id": "platform-a", "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(nexus_intent, "_utcnow", lambda: FIXED_NOW)


def _run(coro):
    return asyncio.run(coro)


# ============== RECORDING ==============


def test_record_intent_stores_compiled_controls(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    result = _run(nexus_intent.record_intent(
        db, _user(), "Terry Tech",
        {"statement": "Every employee must be strongly authenticated and encrypted",
         "controls": [{"kind": "mfa", "scope": "users"}, "encryption"], "client_id": "c1"}))
    assert result["found"] is True
    stored = db.nexus_intents.inserted[0]
    assert stored["tenant_id"] == "platform-a"
    assert stored["client_id"] == "c1"
    assert stored["state"] == "active"
    assert [c["kind"] for c in stored["controls"]] == ["mfa", "encryption"]
    assert result["intent"]["statement"].startswith("Every employee")


def test_record_intent_requires_statement(monkeypatch):
    _fixed_clock(monkeypatch)
    result = _run(nexus_intent.record_intent(db := _db(), _user(), "T", {"statement": "  "}))
    assert result == {"found": False, "error": "statement is required"}
    assert db.nexus_intents.inserted == []


def test_record_intent_suggests_controls_when_none_supplied(monkeypatch):
    _fixed_clock(monkeypatch)
    result = _run(nexus_intent.record_intent(
        db := _db(), _user(), "T",
        {"statement": "Backups must be recoverable and everything encrypted"}))
    assert result["found"] is True
    kinds = {c["kind"] for c in result["intent"]["controls"]}
    assert kinds == {"backup_verified", "encryption"}


def test_record_intent_errors_when_nothing_suggested(monkeypatch):
    _fixed_clock(monkeypatch)
    result = _run(nexus_intent.record_intent(db := _db(), _user(), "T", {"statement": "make it nice"}))
    assert result["found"] is False
    assert "no controls" in result["error"]
    assert db.nexus_intents.inserted == []


def test_suggest_controls_covers_financial_statement():
    kinds = nexus_intent.suggest_controls(
        "Every employee working with financial data must be strongly authenticated, "
        "encrypted, backed up and unable to use unmanaged devices")
    assert set(kinds) >= {"mfa", "encryption", "backup_verified", "device_compliance"}


# ============== EVALUATION (deterministic, honest) ==============


def test_evaluation_flags_privileged_user_without_mfa(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        nexus_intents=_Collection([{
            "id": "INT-1", "tenant_id": "platform-a", "state": "active", "client_id": None,
            "statement": "MFA everywhere", "controls": [{"kind": "mfa"}],
        }]),
        users=_Collection([
            {"id": "u1", "tenant_id": "platform-a", "is_admin": True, "mfa_enabled": True},
            {"id": "u2", "tenant_id": "platform-a", "is_admin": True, "mfa_enabled": False},
        ]),
    )
    report = _run(nexus_intent.evaluate_intents(db, _user()))
    result = report["intents"][0]["results"][0]
    assert result["verdict"] == "drifting"
    assert "without MFA" in result["reason"]
    assert report["intents"][0]["overall"] == "drifting"
    assert report["drifting"] == 1


def test_evaluation_says_unverified_when_no_evidence(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        nexus_intents=_Collection([{
            "id": "INT-1", "tenant_id": "platform-a", "state": "active", "client_id": None,
            "statement": "Backups recoverable", "controls": [{"kind": "backup_verified"}],
        }]),
    )
    report = _run(nexus_intent.evaluate_intents(db, _user()))
    result = report["intents"][0]["results"][0]
    assert result["verdict"] == "unverified"
    assert report["intents"][0]["overall"] == "unverified"


def test_evaluation_backup_says_drifting_without_restore_proof(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        nexus_intents=_Collection([{
            "id": "INT-1", "tenant_id": "platform-a", "state": "active", "client_id": None,
            "statement": "Backups recoverable", "controls": [{"kind": "backup_verified"}],
        }]),
        device_events=_Collection([
            {"id": "e1", "tenant_id": "platform-a", "event_type": "backup_completed"},
            {"id": "e2", "tenant_id": "platform-a", "event_type": "backup_completed"},
        ]),
    )
    report = _run(nexus_intent.evaluate_intents(db, _user()))
    result = report["intents"][0]["results"][0]
    assert result["verdict"] == "drifting"
    assert "no restore has ever been verified" in result["reason"]


def test_evaluation_patch_currency_met_when_all_applied(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        nexus_intents=_Collection([{
            "id": "INT-1", "tenant_id": "platform-a", "state": "active", "client_id": None,
            "statement": "Patched estate", "controls": [{"kind": "patch_currency"}],
        }]),
        device_patches=_Collection([
            {"id": "p1", "tenant_id": "platform-a", "status": "applied"},
            {"id": "p2", "tenant_id": "platform-a", "status": "applied"},
        ]),
    )
    report = _run(nexus_intent.evaluate_intents(db, _user()))
    result = report["intents"][0]["results"][0]
    assert result["verdict"] == "met"
    assert "all 2 tracked patch(es) applied" in result["reason"]


def test_evaluation_unknown_control_is_unverified_not_faked(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db(
        nexus_intents=_Collection([{
            "id": "INT-1", "tenant_id": "platform-a", "state": "active", "client_id": None,
            "statement": "Something exotic", "controls": [{"kind": "quantum_shield"}],
        }]),
    )
    report = _run(nexus_intent.evaluate_intents(db, _user()))
    result = report["intents"][0]["results"][0]
    assert result["verdict"] == "unverified"
    assert "unknown control kind" in result["reason"]


# ============== ROUTER GATES ==============


def test_router_record_intent_requires_statement(monkeypatch):
    monkeypatch.setattr(tech_fun_router, "db", _db())
    try:
        _run(tech_fun_router.record_intent({}, _user()))
    except HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("expected HTTP 400")


def test_router_suggest_returns_controls(monkeypatch):
    monkeypatch.setattr(tech_fun_router, "db", _db())
    result = _run(tech_fun_router.suggest_intent_controls(
        {"statement": "encrypt all the things and back them up"}, _user()))
    assert set(result["suggested_controls"]) >= {"encryption", "backup_verified"}
    assert "mfa" in result["known_controls"]
