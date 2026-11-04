"""Focused client-boundary and financial-action regressions for Billing Dashboard."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import billing_dashboard
from app.services import action_permissions, scope_permissions


_MISSING = object()


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key, _MISSING)
        if isinstance(expected, dict):
            if "$exists" in expected and (actual is not _MISSING) != bool(expected["$exists"]):
                return False
            if "$ne" in expected and actual is not _MISSING and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            continue
        if actual is _MISSING or actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    async def to_list(self, limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])
        self.update_queries: list[dict[str, Any]] = []
        self.force_conflict_once = False

    async def find_one(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        self.update_queries.append(deepcopy(query))
        if self.force_conflict_once:
            self.force_conflict_once = False
            return SimpleNamespace(matched_count=0, modified_count=0)
        for row in self.rows:
            if not _matches(row, query):
                continue
            for field, value in update.get("$set", {}).items():
                row[field] = deepcopy(value)
            for field, value in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + value
            for field, value in update.get("$push", {}).items():
                row.setdefault(field, []).append(deepcopy(value))
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            invoices=_Collection(
                [
                    {
                        "id": "invoice-a",
                        "invoice_number": "INV-A",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "status": "sent",
                        "payment_status": "unpaid",
                        "total": 100.0,
                        "amount_paid": 0.0,
                        "due_date": "2030-01-15",
                        "created_at": "2030-01-01T00:00:00+00:00",
                        "version": 4,
                    },
                    {
                        "id": "invoice-b",
                        "invoice_number": "INV-B",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "status": "sent",
                        "payment_status": "unpaid",
                        "total": 200.0,
                        "amount_paid": 0.0,
                        "due_date": "2030-01-15",
                        "created_at": "2030-01-01T00:00:00+00:00",
                        "version": 9,
                    },
                ]
            ),
            purchase_orders=_Collection(
                [
                    {"id": "po-a", "client_id": "client-a", "status": "approved", "total": 50.0},
                    {"id": "po-b", "client_id": "client-b", "status": "approved", "total": 75.0},
                ]
            ),
            contracts=_Collection(),
            invoice_activity_log=_Collection(),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
            permission_denials=_Collection(),
            settings=_Collection(),
        )


def _restricted_client_a_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _admin() -> dict[str, Any]:
    return {"id": "admin-1", "name": "Finance Admin", "role": "admin", "is_admin": True}


def _install_database(monkeypatch: pytest.MonkeyPatch) -> tuple[_Database, list[dict[str, Any]]]:
    database = _Database()
    activity: list[dict[str, Any]] = []
    monkeypatch.setattr(billing_dashboard, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)

    async def _activity(*args: Any, **kwargs: Any) -> None:
        activity.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(billing_dashboard, "log_activity", _activity)
    return database, activity


def test_global_billing_analytics_rejects_a_restricted_two_client_view(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_global_billing_analytics_rejects_a_restricted_two_client_view(monkeypatch))


async def _test_global_billing_analytics_rejects_a_restricted_two_client_view(monkeypatch: pytest.MonkeyPatch):
    database, _activity = _install_database(monkeypatch)

    with pytest.raises(HTTPException) as denied:
        await billing_dashboard.get_billing_dashboard_metrics(None, _restricted_client_a_user())

    assert denied.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "billing.dashboard.metrics.read"

    metrics = await billing_dashboard.get_billing_dashboard_metrics(None, _admin())
    assert metrics["total_invoiced"] == 300.0
    assert metrics["total_po_spend"] == 125.0


def test_dashboard_chase_is_canonical_scoped_versioned_and_audited(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_dashboard_chase_is_canonical_scoped_versioned_and_audited(monkeypatch))


async def _test_dashboard_chase_is_canonical_scoped_versioned_and_audited(monkeypatch: pytest.MonkeyPatch):
    database, activity = _install_database(monkeypatch)
    user = _restricted_client_a_user()

    with pytest.raises(HTTPException) as foreign:
        await billing_dashboard.chase_overdue_invoice("invoice-b", None, user)
    assert foreign.value.status_code == 404
    assert database.invoices.rows[1].get("chase_count", 0) == 0
    assert database.invoice_activity_log.rows == []

    result = await billing_dashboard.chase_overdue_invoice("invoice-a", None, user)
    assert result["message"] == "Chase logged for INV-A"
    stored = database.invoices.rows[0]
    assert stored["version"] == 5
    assert stored["chase_count"] == 1
    assert stored["chase_history"][0]["user_id"] == "tech-a"
    query = database.invoices.update_queries[-1]
    assert query == {"id": "invoice-a", "client_id": "client-a", "status": "sent", "version": 4}
    assert database.invoice_activity_log.rows[0]["client_id"] == "client-a"
    assert activity[-1]["kwargs"]["metadata"] == {
        "client_id": "client-a",
        "previous_version": 4,
        "new_version": 5,
        "method": "manual",
    }


def test_dashboard_chase_fails_closed_on_a_stale_invoice_version(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_dashboard_chase_fails_closed_on_a_stale_invoice_version(monkeypatch))


async def _test_dashboard_chase_fails_closed_on_a_stale_invoice_version(monkeypatch: pytest.MonkeyPatch):
    database, activity = _install_database(monkeypatch)
    database.invoices.force_conflict_once = True

    with pytest.raises(HTTPException) as conflict:
        await billing_dashboard.chase_overdue_invoice("invoice-a", None, _restricted_client_a_user())

    assert conflict.value.status_code == 409
    assert database.invoices.rows[0]["version"] == 4
    assert database.invoice_activity_log.rows == []
    assert activity == []


def test_billing_analytics_and_chase_actions_are_explicit_and_conservative(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_billing_analytics_and_chase_actions_are_explicit_and_conservative(monkeypatch))


async def _test_billing_analytics_and_chase_actions_are_explicit_and_conservative(monkeypatch: pytest.MonkeyPatch):
    database, _activity = _install_database(monkeypatch)
    user = _restricted_client_a_user()

    assert "billing.analytics.view" in action_permissions.ACTION_PERMISSION_IDS
    assert "billing.analytics.view" not in action_permissions.default_permissions_for_role("technician")
    assert "billing.analytics.view" not in action_permissions.default_permissions_for_role("service_desk_manager")
    assert "billing.portal.reminder.send" not in action_permissions.default_permissions_for_role("technician")
    for permission_id in ("billing.analytics.view", "billing.portal.reminder.send"):
        result = await action_permissions.evaluate_action_permission(user, permission_id)
        assert result["allowed"] is False
    assert database.permission_denials.rows == []

    expected_route_permissions = {
        "/billing-dashboard/metrics": {"billing.analytics.view"},
        "/billing-dashboard/chase/{invoice_id}": {"billing.portal.reminder.send"},
    }
    actual_route_permissions = {
        route.path: {
            cell.cell_contents
            for dependency in route.dependencies
            for cell in (dependency.dependency.__closure__ or ())
            if isinstance(cell.cell_contents, str)
        }
        for route in billing_dashboard.router.routes
    }
    assert actual_route_permissions == expected_route_permissions
