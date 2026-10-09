"""Financial-boundary regressions for the legacy billing reconciliation overview."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import billing_recon
from app.services import action_permissions, scope_permissions


_MISSING = object()


def _value_at(row: dict[str, Any], field: str) -> Any:
    value: Any = row
    for segment in field.split("."):
        if not isinstance(value, dict) or segment not in value:
            return _MISSING
        value = value[segment]
    return value


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for field, expected in (query or {}).items():
        actual = _value_at(row, field)
        if isinstance(expected, dict):
            if "$exists" in expected and (actual is not _MISSING) != bool(expected["$exists"]):
                return False
            if "$ne" in expected and actual is not _MISSING and actual == expected["$ne"]:
                return False
            if "$gte" in expected and (actual is _MISSING or actual < expected["$gte"]):
                return False
            continue
        if actual is _MISSING or actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any) -> "_Cursor":
        return self

    async def to_list(self, limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])
        self.find_calls = 0

    def find(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None
    ) -> _Cursor:
        self.find_calls += 1
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]) -> SimpleNamespace:
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            time_entries=_Collection(
                [
                    {
                        "id": "time-a",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "ticket_id": "ticket-a",
                        "minutes": 60,
                        "hourly_rate": 100,
                        "date": "2030-01-02",
                    },
                    {
                        "id": "time-b",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "ticket_id": "ticket-b",
                        "minutes": 60,
                        "hourly_rate": 200,
                        "date": "2030-01-03",
                    },
                ]
            ),
            tickets=_Collection(
                [
                    {
                        "id": "ticket-a",
                        "client_id": "client-a",
                        "title": "A product",
                        "products": [{"price": 50, "quantity": 1}],
                    },
                    {
                        "id": "ticket-b",
                        "client_id": "client-b",
                        "title": "B product",
                        "products": [{"price": 70, "quantity": 2}],
                    },
                ]
            ),
            contracts=_Collection(),
            invoices=_Collection(
                [
                    {
                        "id": "invoice-a",
                        "client_id": "client-a",
                        "invoice_number": "INV-A",
                        "client_name": "Client A",
                        "status": "overdue",
                        "total": 30,
                    },
                    {
                        "id": "invoice-b",
                        "client_id": "client-b",
                        "invoice_number": "INV-B",
                        "client_name": "Client B",
                        "status": "overdue",
                        "total": 40,
                    },
                ]
            ),
            purchase_orders=_Collection(
                [
                    {
                        "id": "po-a",
                        "client_id": "client-a",
                        "po_number": "PO-A",
                        "vendor": "Supplier A",
                        "vendor_api_secret": "must-not-leak-to-restricted-users",
                        "vendor_invoice_match": {"status": "variance", "variance": 12},
                    },
                    {
                        "id": "po-b",
                        "client_id": "client-b",
                        "po_number": "PO-B",
                        "vendor": "Supplier B",
                        "vendor_api_secret": "must-not-leak-to-restricted-users",
                        "vendor_invoice_match": {"status": "variance", "variance": -4},
                    },
                ]
            ),
            scope_denials=_Collection(),
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
    monkeypatch.setattr(billing_recon, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _activity(*args: Any, **kwargs: Any) -> None:
        activity.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(billing_recon, "log_activity", _activity)
    return database, activity


def test_reconciliation_overview_rejects_restricted_two_client_financial_data(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_reconciliation_overview_rejects_restricted_two_client_financial_data(monkeypatch))


async def _test_reconciliation_overview_rejects_restricted_two_client_financial_data(
    monkeypatch: pytest.MonkeyPatch,
):
    database, activity = _install_database(monkeypatch)

    with pytest.raises(HTTPException) as denied:
        await billing_recon.billing_reconciliation(None, _restricted_client_a_user())

    assert denied.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "billing.reconciliation.overview.read"
    assert all(
        collection.find_calls == 0
        for collection in (
            database.time_entries,
            database.tickets,
            database.contracts,
            database.invoices,
            database.purchase_orders,
        )
    )
    assert activity == []


def test_reconciliation_overview_is_global_audited_and_contains_two_client_totals(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_reconciliation_overview_is_global_audited_and_contains_two_client_totals(monkeypatch))


async def _test_reconciliation_overview_is_global_audited_and_contains_two_client_totals(
    monkeypatch: pytest.MonkeyPatch,
):
    _database, activity = _install_database(monkeypatch)

    result = await billing_recon.billing_reconciliation(None, _admin())

    assert result["unbilled_time"]["total_amount"] == 300.0
    assert result["uninvoiced_products"]["total_amount"] == 190
    assert result["overdue_invoices"]["total_amount"] == 70.0
    assert result["total_recoverable"] == 560.0
    assert {po["vendor"] for po in result["supplier_invoice_variances"]["purchase_orders"]} == {
        "Supplier A",
        "Supplier B",
    }
    assert activity[-1]["args"][:5] == (
        _admin(),
        "billing_reconciliation_viewed",
        "billing_reconciliation",
        "organisation",
        "Organisation-wide billing reconciliation",
    )
    assert activity[-1]["kwargs"]["metadata"] == {
        "scope": "organisation",
        "finding_count": result["action_count"],
    }
    assert "vendor_api_secret" not in activity[-1]["kwargs"]["metadata"]


def test_reconciliation_overview_requires_the_explicit_conservative_analytics_action():
    assert "billing.analytics.view" in action_permissions.ACTION_PERMISSION_IDS
    assert "billing.analytics.view" not in action_permissions.default_permissions_for_role("technician")
    assert "billing.analytics.view" not in action_permissions.default_permissions_for_role("service_desk_manager")

    route = next(route for route in billing_recon.router.routes if route.path == "/billing-recon/overview")
    route_permissions = {
        cell.cell_contents
        for dependency in route.dependencies
        for cell in (dependency.dependency.__closure__ or ())
        if isinstance(cell.cell_contents, str)
    }
    assert route_permissions == {"billing.analytics.view"}
