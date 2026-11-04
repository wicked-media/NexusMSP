"""Regression coverage for destructive invoice scope enforcement.

An invoice ID must never be enough for a restricted technician to delete a
different client's unpaid draft.  Draft deletion is a critical billing action:
it is both client-scoped and protected by the existing void permission.
"""

from __future__ import annotations

import asyncio
import inspect
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import invoices
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, expected in (query or {}).items():
        if isinstance(expected, dict) and "$exists" in expected:
            if (key in row) != bool(expected["$exists"]):
                return False
            continue
        if row.get(key) != expected:
            return False
    return True


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

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
                        "status": "draft",
                        "payment_status": "unpaid",
                    },
                    {
                        "id": "invoice-b",
                        "invoice_number": "INV-B",
                        "client_id": "client-b",
                        "status": "draft",
                        "payment_status": "unpaid",
                    },
                ]
            ),
            scope_denials=_Collection(),
        )


def _restricted_client_a_technician() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(invoices, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _no_activity(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(invoices, "log_activity", _no_activity)
    return database


def test_restricted_technician_cannot_delete_foreign_draft_invoice(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_restricted_technician_cannot_delete_foreign_draft_invoice(monkeypatch))


async def _test_restricted_technician_cannot_delete_foreign_draft_invoice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        await invoices.delete_invoice("invoice-b", current_user=_restricted_client_a_technician())

    assert exc.value.status_code == 404
    assert exc.value.detail == "Resource not found"
    assert [row["id"] for row in database.invoices.rows] == ["invoice-a", "invoice-b"]
    assert database.scope_denials.rows[-1]["client_id"] == "client-b"
    assert database.scope_denials.rows[-1]["operation"] == "billing.invoice.delete"


def test_restricted_technician_can_still_delete_own_unpaid_draft_invoice(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_restricted_technician_can_still_delete_own_unpaid_draft_invoice(monkeypatch))


async def _test_restricted_technician_can_still_delete_own_unpaid_draft_invoice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)

    result = await invoices.delete_invoice("invoice-a", current_user=_restricted_client_a_technician())

    assert result == {"message": "Invoice deleted"}
    assert [row["id"] for row in database.invoices.rows] == ["invoice-b"]
    assert database.scope_denials.rows == []


def test_delete_scope_check_masks_a_foreign_issued_invoice_before_its_status(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_delete_scope_check_masks_a_foreign_issued_invoice_before_its_status(monkeypatch))


async def _test_delete_scope_check_masks_a_foreign_issued_invoice_before_its_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)
    database.invoices.rows[1].update({"status": "sent", "payment_status": "paid"})

    with pytest.raises(HTTPException) as exc:
        await invoices.delete_invoice("invoice-b", current_user=_restricted_client_a_technician())

    assert exc.value.status_code == 404
    assert exc.value.detail == "Resource not found"
    assert database.invoices.rows[1]["status"] == "sent"
    assert database.invoices.rows[1]["payment_status"] == "paid"


def test_invoice_delete_route_requires_the_existing_void_permission():
    route = next(
        candidate
        for candidate in invoices.router.routes
        if candidate.path == "/invoices/{invoice_id}" and "DELETE" in candidate.methods
    )
    assert len(route.dependencies) == 1
    dependency = route.dependencies[0].dependency
    assert dependency is not None
    assert inspect.getclosurevars(dependency).nonlocals["permission_id"] == "billing.invoice.void"


def test_delete_refuses_a_stale_invoice_after_client_ownership_changes(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_delete_refuses_a_stale_invoice_after_client_ownership_changes(monkeypatch))


async def _test_delete_refuses_a_stale_invoice_after_client_ownership_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)
    original_delete = database.invoices.delete_one

    async def move_before_delete(query: dict[str, Any]):
        database.invoices.rows[0]["client_id"] = "client-b"
        return await original_delete(query)

    database.invoices.delete_one = move_before_delete
    with pytest.raises(HTTPException) as stale:
        await invoices.delete_invoice("invoice-a", current_user=_restricted_client_a_technician())

    assert stale.value.status_code == 404
    assert database.invoices.rows[0]["id"] == "invoice-a"
    assert database.invoices.rows[0]["client_id"] == "client-b"
