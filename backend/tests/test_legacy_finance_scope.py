"""Regression coverage for legacy Billing Pro scope and mutation boundaries.

The older Billing Pro routes are still registered by ``server.py``.  These
tests exercise their functions directly with a small Mongo-like fixture so a
restricted technician cannot use a legacy path to read or alter another
client's financial records.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import billing_pro
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue

        present = key in row
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and present != bool(expected["$exists"]):
                return False
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any) -> "_Cursor":
        return self

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + value
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query: dict[str, Any]):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


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
                        "status": "draft",
                        "payment_status": "unpaid",
                        "total": 100.0,
                        "amount_paid": 0.0,
                        "version": 1,
                    },
                    {
                        "id": "invoice-b",
                        "invoice_number": "INV-B",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "status": "draft",
                        "payment_status": "unpaid",
                        "total": 200.0,
                        "amount_paid": 0.0,
                        "version": 1,
                    },
                ]
            ),
            recurring_invoices=_Collection(),
            time_entries=_Collection(),
            ticket_products=_Collection(),
            retainers=_Collection(),
            retainer_transactions=_Collection(),
            invoice_comments=_Collection(),
            settings=_Collection(),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
        )


def _restricted_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(billing_pro, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _record_activity(*args: Any, **kwargs: Any) -> None:
        await database.activity_logs.insert_one(
            {"action": args[1], "entity_id": args[3], "metadata": kwargs.get("metadata") or {}}
        )

    monkeypatch.setattr(billing_pro, "log_activity", _record_activity)
    return database


def test_export_csv_is_scoped_for_filter_and_explicit_ids(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_export_csv_is_scoped_for_filter_and_explicit_ids(monkeypatch))


async def _test_export_csv_is_scoped_for_filter_and_explicit_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_user()
    database.invoices.rows[0]["invoice_name"] = "=HYPERLINK(\"https://attacker.invalid\")"

    scoped_export = await billing_pro.export_invoices_csv(
        {"filter": {"status": "all"}}, request=None, current_user=user
    )
    assert scoped_export["count"] == 1
    assert "INV-A" in scoped_export["csv"]
    assert "INV-B" not in scoped_export["csv"]
    assert "'=HYPERLINK" in scoped_export["csv"]

    with pytest.raises(HTTPException) as foreign_export:
        await billing_pro.export_invoices_csv(
            {"invoice_ids": ["invoice-a", "invoice-b"]}, request=None, current_user=user
        )
    assert foreign_export.value.status_code == 404
    assert database.scope_denials.rows[-1]["operation"] == "billing.invoice.export"


def test_smart_suggest_rejects_another_clients_billable_data_before_querying(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_smart_suggest_rejects_another_clients_billable_data_before_querying(monkeypatch))


async def _test_smart_suggest_rejects_another_clients_billable_data_before_querying(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    database.time_entries.rows.append(
        {"id": "time-b", "client_id": "client-b", "billable": True, "minutes": 60, "date": "2026-08-24"}
    )

    with pytest.raises(HTTPException) as foreign_suggest:
        await billing_pro.smart_suggest_lines(
            "client-b", request=None, days=30, current_user=_restricted_user()
        )
    assert foreign_suggest.value.status_code == 404
    assert database.scope_denials.rows[-1]["operation"] == "billing.invoice.smart_suggest"


def test_bulk_action_validates_every_invoice_scope_before_any_invoice_changes(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_action_validates_every_invoice_scope_before_any_invoice_changes(monkeypatch))


async def _test_bulk_action_validates_every_invoice_scope_before_any_invoice_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)

    with pytest.raises(HTTPException) as foreign_bulk:
        await billing_pro.bulk_invoice_action(
            {"invoice_ids": ["invoice-a", "invoice-b"], "action": "mark_sent"},
            request=None,
            current_user=_restricted_user(),
        )
    assert foreign_bulk.value.status_code == 404
    assert [invoice["status"] for invoice in database.invoices.rows] == ["draft", "draft"]
    assert database.scope_denials.rows[-1]["operation"] == "billing.invoice.bulk.mark_sent"

    result = await billing_pro.bulk_invoice_action(
        {"invoice_ids": ["invoice-a"], "action": "mark_sent"},
        request=None,
        current_user=_restricted_user(),
    )
    assert result == {"updated": 1, "action": "mark_sent"}
    assert database.invoices.rows[0]["status"] == "sent"
    assert database.invoices.rows[0]["version"] == 2
    assert database.invoices.rows[0]["document_snapshot"]["document_type"] == "invoice"


def test_approval_and_deposit_routes_do_not_mutate_a_foreign_invoice(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_approval_and_deposit_routes_do_not_mutate_a_foreign_invoice(monkeypatch))


async def _test_approval_and_deposit_routes_do_not_mutate_a_foreign_invoice(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_user()

    with pytest.raises(HTTPException) as foreign_approval:
        await billing_pro.request_approval("invoice-b", request=None, current_user=user)
    assert foreign_approval.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_deposit:
        await billing_pro.create_deposit("invoice-b", {"pct": 50}, request=None, current_user=user)
    assert foreign_deposit.value.status_code == 404
    assert len(database.invoices.rows) == 2
    assert database.invoices.rows[1].get("has_deposit") is None


def test_scoped_deposit_reserves_the_parent_and_prevents_duplicate_financial_documents(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_scoped_deposit_reserves_the_parent_and_prevents_duplicate_financial_documents(monkeypatch))


async def _test_scoped_deposit_reserves_the_parent_and_prevents_duplicate_financial_documents(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_user()

    deposit = await billing_pro.create_deposit("invoice-a", {"pct": 25}, request=None, current_user=user)
    parent = next(invoice for invoice in database.invoices.rows if invoice["id"] == "invoice-a")
    assert deposit["client_id"] == "client-a"
    assert deposit["total"] == 25.0
    assert parent["deposit_invoice_id"] == deposit["id"]
    assert parent["version"] == 2

    with pytest.raises(HTTPException) as duplicate:
        await billing_pro.create_deposit("invoice-a", {"pct": 25}, request=None, current_user=user)
    assert duplicate.value.status_code == 409
    assert len(database.invoices.rows) == 3


def test_restricted_technician_cannot_read_global_billing_configuration(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_restricted_technician_cannot_read_global_billing_configuration(monkeypatch))


async def _test_restricted_technician_cannot_read_global_billing_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)

    with pytest.raises(HTTPException) as forbidden:
        await billing_pro.get_tax_compliance(request=None, current_user=_restricted_user())
    assert forbidden.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "billing.tax_compliance.view"
