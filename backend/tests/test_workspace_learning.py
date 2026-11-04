"""Workspace learning memory: bounded, tenant-scoped, not customer data.

These run against an in-memory database and pin the properties every workspace
relies on when it reorders itself: one counter per technician, workspace and
target, a bounded key space, per-technician isolation inside the tenant, one
workspace never borrowing another's evidence, a tenant-wide aggregate that never
names anyone, and a forget path that provably leaves other technicians and other
workspaces alone.
"""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import workspace_learning  # noqa: E402

TECH = {"id": "tech-1", "name": "Tech One", "role": "admin", "is_admin": True}
PEER = {"id": "tech-2", "name": "Tech Two", "role": "technician"}
OTHER_TENANT_TECH = {"id": "tech-3", "name": "Tech Three", "role": "admin", "tenant_id": "acme"}


# --- In-memory persistence --------------------------------------------------


def _matches(doc, query):
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(doc, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(doc, clause) for clause in expected):
                return False
            continue
        if isinstance(expected, dict):
            if "$exists" in expected:
                if bool(expected["$exists"]) != (key in doc):
                    return False
                continue
            if "$ne" in expected and doc.get(key) == expected["$ne"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, key, direction=1):
        self.rows.sort(key=lambda row: str(row.get(key) or ""), reverse=int(direction) < 0)
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, limit=None):
        return [dict(row) for row in (self.rows[:limit] if limit else self.rows)]


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]

    def find(self, query=None, *_args, **_kwargs):
        return Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query, *_args, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                for key, delta in (update.get("$inc") or {}).items():
                    row[key] = (row.get(key) or 0) + delta
                row.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        if upsert:
            merged = {key: value for key, value in (query or {}).items() if not key.startswith("$")}
            merged.update(update.get("$set", {}))
            for key, delta in (update.get("$inc") or {}).items():
                merged[key] = (merged.get(key) or 0) + delta
            self.rows.append(merged)
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query, **_kwargs):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                del self.rows[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query, **_kwargs):
        keep = [row for row in self.rows if not _matches(row, query)]
        deleted = len(self.rows) - len(keep)
        self.rows = keep
        return SimpleNamespace(deleted_count=deleted)


def _prepare(monkeypatch, rows=None):
    database = SimpleNamespace(workspace_learning_signals=FakeCollection(rows))
    activity = AsyncMock()
    monkeypatch.setattr(workspace_learning, "db", database)
    monkeypatch.setattr(workspace_learning, "log_activity", activity)
    return database, activity


def run(coro):
    return asyncio.run(coro)


def _row(**overrides):
    return {
        "tenant_id": "nexus-local",
        "user_id": "tech-1",
        "workspace": "client",
        "surface": "view",
        "target": "billing",
        "count": 1,
        "last_used_at": "2026-01-01T00:00:00+00:00",
        **overrides,
    }


# --- Input discipline -------------------------------------------------------


def test_signal_rejects_an_unregistered_workspace_and_never_stores_it(monkeypatch):
    database, _ = _prepare(monkeypatch)

    for workspace in ("ticket", "client_workspace", "", "workspace_learning", 7):
        with pytest.raises(HTTPException) as excinfo:
            run(workspace_learning.record_workspace_signal(
                workspace, {"surface": "view", "target": "billing"}, TECH,
            ))
        assert excinfo.value.status_code == 422

    assert database.workspace_learning_signals.rows == []


def test_workspace_names_normalise_to_their_registered_slug(monkeypatch):
    """A capitalised or padded workspace resolves to the one registered key."""
    database, _ = _prepare(monkeypatch)

    run(workspace_learning.record_workspace_signal(" Tickets ", {"surface": "view", "target": "queue"}, TECH))

    assert database.workspace_learning_signals.rows[0]["workspace"] == "tickets"


def test_every_registered_workspace_remembers_itself_and_only_itself(monkeypatch):
    """The registry is a contract, so the whole registry is pinned, not one name.

    A workspace is added deliberately here when a workspace gains a ranking
    surface; the same slug must then own its own rows and must never read another
    workspace's evidence, including the newest member (purchase orders).
    """
    database, _ = _prepare(monkeypatch)

    for workspace in workspace_learning.WORKSPACES:
        run(workspace_learning.record_workspace_signal(
            workspace, {"surface": "view", "target": "queue"}, TECH,
        ))

    assert sorted(row["workspace"] for row in database.workspace_learning_signals.rows) == sorted(
        workspace_learning.WORKSPACES
    )

    procurement = run(workspace_learning.get_workspace_learning("purchase_orders", TECH))
    assert [row["target"] for row in procurement["personal"]] == ["queue"]

    invoices = run(workspace_learning.get_workspace_learning("invoices", TECH))
    assert [row["target"] for row in invoices["personal"]] == ["queue"]



def test_signal_rejects_an_unknown_surface_and_never_stores_it(monkeypatch):
    database, _ = _prepare(monkeypatch)

    with pytest.raises(HTTPException) as excinfo:
        run(workspace_learning.record_workspace_signal(
            "client", {"surface": "click", "target": "billing"}, TECH,
        ))

    assert excinfo.value.status_code == 422
    assert database.workspace_learning_signals.rows == []


def test_signal_rejects_free_text_targets(monkeypatch):
    database, _ = _prepare(monkeypatch)

    for target in ("billing view", "billing/../secrets", "", "x" * 60, "-billing", "billing.view", "bílling"):
        with pytest.raises(HTTPException) as excinfo:
            run(workspace_learning.record_workspace_signal(
                "client", {"surface": "view", "target": target}, TECH,
            ))
        assert excinfo.value.status_code == 422

    assert database.workspace_learning_signals.rows == []


def test_signal_normalises_a_capitalised_target_to_its_slug(monkeypatch):
    database, _ = _prepare(monkeypatch)

    run(workspace_learning.record_workspace_signal("client", {"surface": "View", "target": "Billing"}, TECH))

    assert database.workspace_learning_signals.rows[0]["target"] == "billing"


def test_signal_advances_one_counter_instead_of_storing_duplicates(monkeypatch):
    database, _ = _prepare(monkeypatch)

    run(workspace_learning.record_workspace_signal("client", {"surface": "view", "target": "billing"}, TECH))
    run(workspace_learning.record_workspace_signal("client", {"surface": "VIEW", "target": " billing "}, TECH))

    rows = database.workspace_learning_signals.rows
    assert len(rows) == 1
    assert rows[0]["count"] == 2
    assert rows[0]["target"] == "billing"
    assert rows[0]["tenant_id"] == "nexus-local"
    assert rows[0]["workspace"] == "client"
    assert rows[0]["last_used_at"]


# --- Isolation --------------------------------------------------------------


def test_memory_is_per_technician_and_tenant_partitioned(monkeypatch):
    database, _ = _prepare(monkeypatch, rows=[
        _row(target="billing", count=5),
        _row(user_id="tech-2", target="warroom", count=9),
        _row(tenant_id="acme", user_id="tech-3", target="security", count=4),
    ])

    result = run(workspace_learning.get_workspace_learning("client", TECH))

    assert [row["target"] for row in result["personal"]] == ["billing"]
    assert result["memory"]["personal_signals"] == 5
    assert result["workspace"] == "client"

    team_targets = {row["target"]: row["count"] for row in result["team"]}
    assert team_targets == {"billing": 5, "warroom": 9}
    assert "security" not in team_targets
    assert "tech-2" not in str(result)
    assert "user_id" not in result["team"][0]


def test_team_aggregate_sums_counts_for_the_same_target(monkeypatch):
    database, _ = _prepare(monkeypatch, rows=[
        _row(target="billing", count=3),
        _row(user_id="tech-2", target="billing", count=4, last_used_at="2026-02-01T00:00:00+00:00"),
        _row(user_id="tech-2", target="assets", count=1),
    ])

    result = run(workspace_learning.get_workspace_learning("client", TECH))

    assert result["team"][0] == {
        "surface": "view",
        "target": "billing",
        "count": 7,
        "last_used_at": "2026-02-01T00:00:00+00:00",
    }
    assert result["team"][1]["target"] == "assets"


def test_bound_legacy_rows_are_visible_only_to_the_local_partition(monkeypatch):
    database, _ = _prepare(monkeypatch, rows=[
        _row(tenant_id=None, target="billing", count=2),
        _row(tenant_id="acme", user_id="tech-3", target="security", count=4),
    ])

    local = run(workspace_learning.get_workspace_learning("client", TECH))
    scoped = run(workspace_learning.get_workspace_learning("client", OTHER_TENANT_TECH))

    assert [row["target"] for row in local["personal"]] == ["billing"]
    assert [row["target"] for row in scoped["personal"]] == ["security"]


# --- Bounds -----------------------------------------------------------------


def _seed_full_surface(surface="view", workspace="client"):
    return [
        _row(
            workspace=workspace,
            surface=surface,
            target=f"{surface}_{index}",
            count=1,
            last_used_at=f"2026-01-{index + 1:02d}T00:00:00+00:00",
        )
        for index in range(workspace_learning._MAX_TARGETS_PER_SURFACE)
    ]


def test_memory_is_capped_per_surface_and_forgets_the_least_recent(monkeypatch):
    database, _ = _prepare(monkeypatch, rows=_seed_full_surface())

    run(workspace_learning.record_workspace_signal("client", {"surface": "view", "target": "newest"}, TECH))

    stored = database.workspace_learning_signals.rows
    assert len(stored) == workspace_learning._MAX_TARGETS_PER_SURFACE
    assert "view_0" not in {row["target"] for row in stored}
    assert "newest" in {row["target"] for row in stored}


def test_a_busy_workspace_never_evicts_another_workspace_memory(monkeypatch):
    """The cap is per workspace and surface, not per technician."""
    seeded = _seed_full_surface(workspace="client")
    seeded.append(_row(workspace="tickets", target="conversation", count=2))
    database, _ = _prepare(monkeypatch, rows=seeded)

    run(workspace_learning.record_workspace_signal("tickets", {"surface": "view", "target": "queue"}, TECH))

    client_targets = {
        row["target"] for row in database.workspace_learning_signals.rows if row["workspace"] == "client"
    }
    assert len(client_targets) == workspace_learning._MAX_TARGETS_PER_SURFACE
    assert "view_0" in client_targets
    ticket_targets = {
        row["target"] for row in database.workspace_learning_signals.rows if row["workspace"] == "tickets"
    }
    assert ticket_targets == {"conversation", "queue"}


# --- Workspace isolation ----------------------------------------------------


def test_a_workspace_only_returns_its_own_evidence(monkeypatch):
    """A view named 'billing' in one workspace is not evidence in another."""
    _prepare(monkeypatch, rows=[
        _row(workspace="client", target="billing", count=6),
        _row(workspace="invoices", target="billing", count=2),
        _row(workspace="invoices", target="payments", count=9),
    ])

    client = run(workspace_learning.get_workspace_learning("client", TECH))
    invoices = run(workspace_learning.get_workspace_learning("invoices", TECH))

    assert {row["target"] for row in client["personal"]} == {"billing"}
    assert client["memory"]["personal_signals"] == 6
    assert {row["target"]: row["count"] for row in invoices["personal"]} == {"billing": 2, "payments": 9}
    # The team aggregate is scoped to the workspace too: the client workspace's
    # larger count cannot outrank the invoice workspace's own evidence.
    assert [row["target"] for row in invoices["team"]] == ["payments", "billing"]


# --- Forgetting -------------------------------------------------------------


def test_forgetting_removes_only_the_callers_memory_and_is_audited(monkeypatch):
    database, activity = _prepare(monkeypatch, rows=[
        _row(target="billing"),
        _row(surface="action", target="schedule"),
        _row(user_id="tech-2", target="warroom"),
        _row(tenant_id="acme", user_id="tech-3", target="security"),
    ])

    result = run(workspace_learning.forget_workspace_learning("client", TECH))

    assert result["removed"] == 2
    remaining = {(row["tenant_id"], row["user_id"], row["target"]) for row in database.workspace_learning_signals.rows}
    assert remaining == {("nexus-local", "tech-2", "warroom"), ("acme", "tech-3", "security")}
    activity.assert_awaited_once()
    assert activity.await_args.args[1] == "workspace_learning.forgotten"
    assert "client" in activity.await_args.kwargs["details"]


def test_forgetting_one_workspace_leaves_the_technicians_other_workspaces_alone(monkeypatch):
    database, _ = _prepare(monkeypatch, rows=[
        _row(workspace="client", target="billing"),
        _row(workspace="tickets", target="conversation"),
        _row(workspace="voice", surface="action", target="sync"),
    ])

    result = run(workspace_learning.forget_workspace_learning("client", TECH))

    assert result["removed"] == 1
    remaining = {(row["workspace"], row["target"]) for row in database.workspace_learning_signals.rows}
    assert remaining == {("tickets", "conversation"), ("voice", "sync")}


def test_forgetting_with_no_memory_is_a_harmless_no_op(monkeypatch):
    database, activity = _prepare(monkeypatch)

    result = run(workspace_learning.forget_workspace_learning("client", TECH))

    assert result["removed"] == 0
    assert database.workspace_learning_signals.rows == []
    activity.assert_awaited_once()
