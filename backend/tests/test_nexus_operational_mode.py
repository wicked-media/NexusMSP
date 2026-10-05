"""Contract tests for the platform operational mode (normal / observe-only / freeze)."""

import asyncio
import copy
import inspect
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

from app.services import nexus_operational_mode as ops  # noqa: E402


FIXED_NOW = datetime(2026, 10, 5, 9, 0, tzinfo=timezone.utc)


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
    for name in ("operational_mode_state", "operational_mode_events"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech", tenant="platform-a"):
    return {"id": uid, "name": name, "role": "tech", "is_admin": False,
            "tenant_id": tenant, "client_scope_mode": "all"}


def _fixed_clock(monkeypatch):
    monkeypatch.setattr(ops, "_utcnow", lambda: FIXED_NOW)


def _set(db, user=None, **payload):
    body = {"mode": "observe_only", "reason": "suspected compromise under investigation"}
    body.update(payload)
    return asyncio.run(ops.set_mode(db, user or _user(), "Terry Tech", body))


# ============== THE PUBLISHED CONTROL SURFACE ==============


def test_catalog_publishes_modes_capabilities_and_what_is_not_governed():
    catalog = ops.capability_catalog()
    assert catalog["modes"] == ["normal", "observe_only", "frozen"]
    assert catalog["capabilities"] == ["patching", "software_deployment", "ai_remediation",
                                       "customer_communications", "billing_sync",
                                       "device_remediation"]
    assert catalog["consulting_layers"]
    assert catalog["separate_controls"]
    assert "NOT yet consulted" in catalog["enforcement_note"]
    assert "declared operational intent" in catalog["enforcement_note"]
    assert "executes nothing" in catalog["meaning"]["observe_only"]


def test_permits_is_a_sync_function_so_a_gate_can_never_await_its_way_around_it():
    assert not inspect.iscoroutinefunction(ops.permits)


def test_default_mode_is_normal_when_nothing_is_set():
    mode = asyncio.run(ops.current_mode(_db(), _user()))
    assert mode["mode"] == "normal"
    assert mode["frozen_clients"] == [] and mode["frozen_capabilities"] == []
    assert ops.permits(mode, capability="patching")["allowed"] is True


# ============== permits() SEMANTICS ==============


def test_observe_only_blocks_everything_and_says_why():
    mode = {"mode": "observe_only", "reason": "suspected compromise"}
    for capability in ops.CAPABILITIES:
        decision = ops.permits(mode, client_id="CLI-001", capability=capability)
        assert decision["allowed"] is False
        assert "suspected compromise" in decision["reason"]
        assert "executes nothing" in decision["reason"]


def test_an_unrecognised_mode_is_never_read_as_permission():
    decision = ops.permits({"mode": "yolo"}, capability="patching")
    assert decision["allowed"] is False
    assert "Unrecognised operational mode" in decision["reason"]


def test_frozen_without_a_scope_blocks_everything():
    mode = {"mode": "frozen", "reason": "incident", "frozen_clients": [], "frozen_capabilities": []}
    assert ops.permits(mode, client_id="CLI-001", capability="patching")["allowed"] is False
    assert ops.permits(mode, capability="software_deployment")["allowed"] is False


def test_freeze_is_an_intersection_of_capability_and_customer():
    # Stop patching for ACME only: ACME+patching blocked, everything else allowed.
    mode = {"mode": "frozen", "reason": "bad patch night",
            "frozen_clients": ["CLI-001"], "frozen_capabilities": ["patching"]}
    blocked = ops.permits(mode, client_id="CLI-001", capability="patching")
    assert blocked["allowed"] is False
    assert "capability patching" in blocked["reason"] and "customer CLI-001" in blocked["reason"]
    assert "bad patch night" in blocked["reason"]

    assert ops.permits(mode, client_id="CLI-002", capability="patching")["allowed"] is True
    assert ops.permits(mode, client_id="CLI-001", capability="software_deployment")["allowed"] is True


def test_capability_only_and_client_only_freezes_scope_correctly():
    capability_only = {"mode": "frozen", "reason": "vendor advisory", "frozen_clients": [],
                       "frozen_capabilities": ["software_deployment"]}
    assert ops.permits(capability_only, client_id="CLI-001",
                       capability="software_deployment")["allowed"] is False
    assert ops.permits(capability_only, client_id="CLI-001", capability="patching")["allowed"] is True

    client_only = {"mode": "frozen", "reason": "freeze ACME", "frozen_clients": ["CLI-001"],
                   "frozen_capabilities": []}
    assert ops.permits(client_only, client_id="CLI-001", capability="patching")["allowed"] is False
    assert ops.permits(client_only, client_id="CLI-002", capability="patching")["allowed"] is True


# ============== set_mode() ==============


def test_set_mode_requires_a_real_mode_and_a_written_reason(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    assert "mode must be one of" in _set(db, mode="paused")["error"]
    refusal = _set(db, mode="observe_only", reason="   ")
    assert refusal["found"] is False
    assert "unjustified stop" in refusal["error"]
    assert db.operational_mode_state.inserted == []


def test_set_mode_rejects_unknown_capabilities_and_misuse_of_scope(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    unknown = _set(db, mode="frozen", capabilities=["launch_missiles"])
    assert "unknown capability 'launch_missiles'" in unknown["error"]
    misuse = _set(db, mode="observe_only", capabilities=["patching"])
    assert "only apply to a frozen mode" in misuse["error"]
    misuse_client = _set(db, mode="normal", client_id="CLI-001")
    assert "only apply to a frozen mode" in misuse_client["error"]


def test_set_mode_records_state_and_append_only_history(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    applied = _set(db, mode="frozen", reason="maintenance window",
                   capabilities=["patching"], client_id="CLI-001")
    assert applied["found"] is True
    assert applied["mode"]["mode"] == "frozen"
    assert applied["mode"]["frozen_capabilities"] == ["patching"]
    assert applied["mode"]["frozen_clients"] == ["CLI-001"]
    assert applied["event"]["from_mode"] == "normal"
    assert applied["event"]["to_mode"] == "frozen"
    assert applied["event"]["actor"] == "Terry Tech"
    assert applied["event"]["reason"] == "maintenance window"
    assert "declared operational" in applied["note"]

    resumed = _set(db, mode="normal", reason="window closed")
    assert resumed["found"] is True
    assert resumed["mode"]["mode"] == "normal"
    assert resumed["event"]["from_mode"] == "frozen"
    assert "Returned to normal operation" in resumed["note"]
    # One state document, not one per change; the history keeps every change.
    assert len(db.operational_mode_state.rows) == 1
    assert len(db.operational_mode_events.rows) == 2


def test_list_events_returns_newest_first_with_the_current_mode(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    _set(db, mode="observe_only", reason="audit")
    listed = asyncio.run(ops.list_events(db, _user(), limit=10))
    assert listed["count"] == 1
    assert listed["mode"]["mode"] == "observe_only"
    assert listed["events"][0]["reason"] == "audit"
    assert "actor" in listed["events"][0]


def test_mode_and_history_are_tenant_isolated(monkeypatch):
    _fixed_clock(monkeypatch)
    db = _db()
    _set(db, mode="frozen", reason="acme only", client_id="CLI-001")
    other = asyncio.run(ops.current_mode(db, _user("u2", "Other Tech", tenant="platform-b")))
    assert other["mode"] == "normal"
    assert asyncio.run(ops.list_events(db, _user("u2", "Other Tech", tenant="platform-b")))["count"] == 0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
