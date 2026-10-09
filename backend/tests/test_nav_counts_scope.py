"""Regression coverage for server-side sidebar badge boundaries."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from app.routers import nav_counts


_MISSING = object()


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    """Small Mongo matcher for the predicates used by nav-count regression tests."""
    for field, expected in (query or {}).items():
        if field == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if field == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue

        actual = row.get(field, _MISSING)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual is not _MISSING and actual == expected["$ne"]:
                return False
            if "$lt" in expected and (actual is _MISSING or actual >= expected["$lt"]):
                return False
            if "$gte" in expected and (actual is _MISSING or actual < expected["$gte"]):
                return False
            if "$gt" in expected and (actual is _MISSING or actual <= expected["$gt"]):
                return False
            continue
        if actual is _MISSING or actual != expected:
            return False
    return True


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])
        self.count_queries: list[dict[str, Any]] = []

    async def count_documents(self, query: dict[str, Any]) -> int:
        self.count_queries.append(deepcopy(query))
        return sum(1 for row in self.rows if _matches(row, query))


class _Database(SimpleNamespace):
    def __init__(self):
        now = datetime.now(timezone.utc).isoformat()
        super().__init__(
            tickets=_Collection([
                {"id": "ticket-a-critical", "client_id": "client-a", "status": "open", "priority": "critical", "sla_due_at": "2000-01-01T00:00:00+00:00"},
                {"id": "ticket-a-open", "client_id": "client-a", "status": "in_progress", "priority": "normal", "sla_due_at": "2999-01-01T00:00:00+00:00"},
                {"id": "ticket-b-critical", "client_id": "client-b", "status": "open", "priority": "critical", "sla_due_at": "2000-01-01T00:00:00+00:00"},
                {"id": "ticket-a-closed", "client_id": "client-a", "status": "closed", "priority": "critical", "sla_due_at": "2000-01-01T00:00:00+00:00"},
            ]),
            devices=_Collection([
                {"id": "device-a-offline", "client_id": "client-a", "status": "offline"},
                {"id": "device-a-warning", "client_id": "client-a", "status": "online", "cpu_load": 95},
                {"id": "device-b-offline", "client_id": "client-b", "status": "offline", "checks_failing": 1},
            ]),
            alerts=_Collection([
                {"id": "alert-a", "client_id": "client-a", "status": "active"},
                {"id": "alert-b", "client_id": "client-b", "status": "active"},
            ]),
            approvals=_Collection([
                {"id": "approval-a", "client_id": "client-a", "status": "pending"},
                {"id": "approval-b", "client_id": "client-b", "status": "pending"},
                {"id": "approval-global", "status": "pending"},
            ]),
            invoices=_Collection([
                {"id": "invoice-a", "client_id": "client-a", "status": "sent"},
                {"id": "invoice-b", "client_id": "client-b", "status": "overdue"},
            ]),
            backup_jobs=_Collection([
                {"id": "backup-a", "client_id": "client-a", "status": "failed", "updated_at": now},
                {"id": "backup-b", "client_id": "client-b", "status": "failed", "updated_at": now},
            ]),
        )


def _restricted_client_a_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


async def _unread_by_channel(*, current_user: dict[str, Any]) -> dict[str, int]:
    return {"service-desk": 2} if current_user.get("id") == "tech-a" else {"ops": 1}


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(nav_counts, "db", database)
    monkeypatch.setattr(nav_counts.chat_presence, "unread_counts", _unread_by_channel)
    return database


def test_nav_counts_are_client_scoped_and_use_canonical_sidebar_paths(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)

    counts = asyncio.run(nav_counts.nav_counts(current_user=_restricted_client_a_user()))

    assert counts == {
        "/tickets": 2,
        "/devices": 2,
        "/security-dashboard": 1,
        "/billing-dashboard": 1,
        "/team-chat": 2,
        "/backup-center": 1,
        "_meta": {
            "open_tickets": 2,
            "breached": 1,
            "critical": 1,
            "offline": 1,
            "warning": 1,
            "alerts": 1,
            "pending_approvals": 1,
        },
    }
    assert {"/security", "/approvals", "/billing", "/backup", "/tech-command", "/invoices"}.isdisjoint(counts)

    for collection in (
        database.tickets,
        database.devices,
        database.alerts,
        database.approvals,
        database.invoices,
        database.backup_jobs,
    ):
        assert collection.count_queries
        assert all("client-a" in str(query) for query in collection.count_queries)
        assert all("client-b" not in str(query) for query in collection.count_queries)


def test_nav_counts_fail_closed_without_an_explicit_client_scope(monkeypatch: pytest.MonkeyPatch):
    _install_database(monkeypatch)

    counts = asyncio.run(nav_counts.nav_counts(current_user={"id": "unassigned-tech", "role": "technician"}))

    assert counts["/tickets"] == 0
    assert counts["/devices"] == 0
    assert counts["/security-dashboard"] == 0
    assert counts["/billing-dashboard"] == 0
    assert counts["/backup-center"] == 0
    assert counts["_meta"]["pending_approvals"] == 0


def test_nav_counts_keep_global_results_for_authorised_administrators(monkeypatch: pytest.MonkeyPatch):
    _install_database(monkeypatch)

    counts = asyncio.run(nav_counts.nav_counts(current_user={"id": "admin-1", "role": "admin", "is_admin": True}))

    assert counts["/tickets"] == 4
    assert counts["/devices"] == 4
    assert counts["/security-dashboard"] == 2
    assert counts["/billing-dashboard"] == 2
    assert counts["/backup-center"] == 2
    assert counts["_meta"]["pending_approvals"] == 3
