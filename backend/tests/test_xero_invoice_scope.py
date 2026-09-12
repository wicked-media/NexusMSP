"""Regression coverage for the legacy Xero mirror invoice routes.

The Xero workspace keeps integration-shaped documents in MongoDB, but they
remain customer financial records.  It must not become a second unauthorised
path around the governed Nexus invoice boundary.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import xero
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, part) for part in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + value
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def count_documents(self, query: dict[str, Any]) -> int:
        return sum(1 for row in self.rows if _matches(row, query))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            xero_invoices=_Collection(
                [
                    {
                        "id": "xero-invoice-a",
                        "invoice_number": "XI-A",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "status": "DRAFT",
                        "total": 100.0,
                        "amount_paid": 0.0,
                        "amount_due": 100.0,
                        "version": 1,
                    },
                    {
                        "id": "xero-invoice-b",
                        "invoice_number": "XI-B",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "status": "DRAFT",
                        "total": 100.0,
                        "amount_paid": 0.0,
                        "amount_due": 100.0,
                        "version": 1,
                    },
                ]
            ),
            xero_contacts=_Collection(),
            xero_estimates=_Collection(
                [
                    {"id": "estimate-a", "client_id": "client-a", "status": "DRAFT"},
                    {"id": "estimate-b", "client_id": "client-b", "status": "DRAFT"},
                ]
            ),
            xero_recurring=_Collection(
                [
                    {"id": "recurring-a", "client_id": "client-a", "status": "active"},
                    {"id": "recurring-b", "client_id": "client-b", "status": "active"},
                ]
            ),
            xero_invoice_emails=_Collection(),
            xero_sync_history=_Collection(),
            clients=_Collection(
                [
                    {"id": "client-a", "name": "Client A"},
                    {"id": "client-b", "name": "Client B"},
                ]
            ),
            scope_denials=_Collection(),
            activity_logs=_Collection(),
        )


def _restricted_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(xero, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _ignore(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(xero, "log_activity", _ignore)
    monkeypatch.setattr(xero, "_log_sync_event", _ignore)
    return database


def test_xero_invoice_list_and_mutations_are_client_scoped(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_xero_invoice_list_and_mutations_are_client_scoped(monkeypatch))


async def _test_xero_invoice_list_and_mutations_are_client_scoped(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    user = _restricted_user()

    visible = await xero.get_xero_invoices(current_user=user)
    assert [invoice["id"] for invoice in visible] == ["xero-invoice-a"]

    with pytest.raises(HTTPException) as foreign_payment:
        await xero.pay_xero_invoice("xero-invoice-b", {"amount": 10}, current_user=user)
    assert foreign_payment.value.status_code == 404
    assert database.xero_invoices.rows[1]["amount_paid"] == 0.0

    with pytest.raises(HTTPException) as foreign_void:
        await xero.void_xero_invoice("xero-invoice-b", current_user=user)
    assert foreign_void.value.status_code == 404
    assert database.xero_invoices.rows[1]["status"] == "DRAFT"


def test_xero_payment_uses_a_bound_invoice_version_and_cannot_overpay(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_xero_payment_uses_a_bound_invoice_version_and_cannot_overpay(monkeypatch))


async def _test_xero_payment_uses_a_bound_invoice_version_and_cannot_overpay(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    user = _restricted_user()

    payment = await xero.pay_xero_invoice("xero-invoice-a", {"amount": 40}, current_user=user)
    assert payment == {"message": "Payment recorded", "amount_paid": 40.0, "amount_due": 60.0, "status": "AUTHORISED"}
    assert database.xero_invoices.rows[0]["version"] == 2

    with pytest.raises(HTTPException) as overpayment:
        await xero.pay_xero_invoice("xero-invoice-a", {"amount": 61}, current_user=user)
    assert overpayment.value.status_code == 422
    assert database.xero_invoices.rows[0]["amount_paid"] == 40.0


def test_xero_create_derives_client_identity_from_the_scoped_client(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_xero_create_derives_client_identity_from_the_scoped_client(monkeypatch))


async def _test_xero_create_derives_client_identity_from_the_scoped_client(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    result = await xero.create_xero_invoice(
        {"client_id": "client-a", "client_name": "Attacker supplied", "line_items": []},
        current_user=_restricted_user(),
    )
    assert result["client_name"] == "Client A"
    assert result["version"] == 1
    assert database.xero_invoices.rows[-1]["client_id"] == "client-a"


def test_xero_dashboard_and_integration_operations_do_not_leak_across_client_scope(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_xero_dashboard_and_integration_operations_do_not_leak_across_client_scope(monkeypatch))


async def _test_xero_dashboard_and_integration_operations_do_not_leak_across_client_scope(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    user = _restricted_user()

    dashboard = await xero.get_xero_dashboard(current_user=user)
    assert dashboard["invoice_count"] == 1
    assert dashboard["total_revenue"] == 100.0
    assert dashboard["estimates_count"] == 1
    assert dashboard["recurring_count"] == 1
    assert dashboard["last_sync"] is None

    with pytest.raises(HTTPException) as denied_history:
        await xero.get_sync_history(current_user=user)
    assert denied_history.value.status_code == 403

    with pytest.raises(HTTPException) as denied_sync:
        await xero.trigger_xero_sync(current_user=user)
    assert denied_sync.value.status_code == 403


def test_xero_estimate_and_recurring_mutations_are_client_scoped(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_xero_estimate_and_recurring_mutations_are_client_scoped(monkeypatch))


async def _test_xero_estimate_and_recurring_mutations_are_client_scoped(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    user = _restricted_user()

    with pytest.raises(HTTPException) as foreign_estimate:
        await xero.update_estimate_status("estimate-b", {"status": "ACCEPTED"}, current_user=user)
    assert foreign_estimate.value.status_code == 404
    assert database.xero_estimates.rows[1]["status"] == "DRAFT"

    with pytest.raises(HTTPException) as foreign_recurring:
        await xero.generate_from_recurring("recurring-b", current_user=user)
    assert foreign_recurring.value.status_code == 404
    assert not any(invoice.get("recurring_id") == "recurring-b" for invoice in database.xero_invoices.rows)
