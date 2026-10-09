"""Focused financial-boundary regressions for the legacy invoice enhancements.

Credit notes settle invoice balances, so their browser-controlled IDs and
amounts need the same server-side scope, action and optimistic-write controls
as the primary invoice router.  These tests exercise the router directly with
small in-memory collections to prove the boundary without relying on a live
provider or shared development data.
"""

from __future__ import annotations

import asyncio
import inspect
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import invoice_enhanced as enhanced
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

        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and bool(key in row) != bool(expected["$exists"]):
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

    async def count_documents(self, query: dict[str, Any]) -> int:
        return sum(1 for row in self.rows if _matches(row, query))

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$push", {}).items():
                row.setdefault(field, []).append(deepcopy(value))
            for field, value in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + value
            return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)


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
                        "version": 3,
                        "created_at": "2026-08-01T00:00:00+00:00",
                    },
                    {
                        "id": "invoice-b",
                        "invoice_number": "INV-B",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "status": "sent",
                        "payment_status": "unpaid",
                        "total": 100.0,
                        "amount_paid": 0.0,
                        "version": 3,
                        "created_at": "2026-08-02T00:00:00+00:00",
                    },
                ]
            ),
            clients=_Collection(
                [
                    {"id": "client-a", "name": "Client A", "email": "billing-a@example.test"},
                    {"id": "client-b", "name": "Client B", "email": "billing-b@example.test"},
                ]
            ),
            credit_notes=_Collection(
                [
                    {
                        "id": "credit-a",
                        "credit_note_number": "CN-A",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "invoice_id": "invoice-a",
                        "total": 60.0,
                        "status": "issued",
                        "applied_to_invoice": False,
                        "version": 1,
                        "created_at": "2026-08-03T00:00:00+00:00",
                    },
                    {
                        "id": "credit-b",
                        "credit_note_number": "CN-B",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "invoice_id": "invoice-b",
                        "total": 10.0,
                        "status": "issued",
                        "applied_to_invoice": False,
                        "version": 1,
                    },
                ]
            ),
            invoice_emails=_Collection(
                [
                    {"id": "email-a", "invoice_id": "invoice-a", "client_id": "client-a", "email": "billing-a@example.test"},
                    {"id": "email-b", "invoice_id": "invoice-b", "client_id": "client-b", "email": "billing-b@example.test"},
                ]
            ),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
        )


def _restricted_client_a() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _global_admin() -> dict[str, Any]:
    return {
        "id": "admin-1",
        "name": "Administrator",
        "role": "admin",
        "is_admin": True,
        "client_scope_mode": "all",
    }


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(enhanced, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def audit(
        user: dict,
        action: str,
        entity_type: str,
        entity_id: str,
        entity_name: str = "",
        details: str = "",
        changes: dict | None = None,
        metadata: dict | None = None,
    ) -> None:
        await database.activity_logs.insert_one(
            {
                "user_id": user.get("id"),
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "entity_name": entity_name,
                "details": details,
                "changes": changes or {},
                "metadata": metadata or {},
            }
        )

    monkeypatch.setattr(enhanced, "log_activity", audit)
    return database


def test_credit_note_creation_scopes_invoice_and_uses_authoritative_client_data(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_credit_note_creation_scopes_invoice_and_uses_authoritative_client_data(monkeypatch))


async def _test_credit_note_creation_scopes_invoice_and_uses_authoritative_client_data(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()
    payload = {"subtotal": 50, "tax": 5, "total": 55, "reason": "Service correction"}

    with pytest.raises(HTTPException) as foreign:
        await enhanced.create_credit_note({**payload, "invoice_id": "invoice-b", "client_id": "client-b"}, request=None, current_user=user)
    assert foreign.value.status_code == 404
    assert len(database.credit_notes.rows) == 2
    assert database.scope_denials.rows[-1]["operation"] == "billing.credit_note.create"

    with pytest.raises(HTTPException) as forged_client:
        await enhanced.create_credit_note({**payload, "invoice_id": "invoice-a", "client_id": "client-b"}, request=None, current_user=user)
    assert forged_client.value.status_code == 422
    assert len(database.credit_notes.rows) == 2

    created = await enhanced.create_credit_note(
        {**payload, "invoice_id": "invoice-a", "client_id": "client-a", "client_name": "Forged Browser Name"},
        request=None,
        current_user=user,
    )
    assert created["client_id"] == "client-a"
    assert created["client_name"] == "Client A"
    assert created["version"] == 1
    assert created["audit_trail"][0]["client_id"] == "client-a"
    audit = database.activity_logs.rows[-1]
    assert audit["action"] == "created"
    assert audit["metadata"] == {"invoice_id": "invoice-a", "client_id": "client-a", "total": 55.0}


def test_credit_note_creation_rejects_nonfinite_and_inconsistent_amounts(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_credit_note_creation_rejects_nonfinite_and_inconsistent_amounts(monkeypatch))


async def _test_credit_note_creation_rejects_nonfinite_and_inconsistent_amounts(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as nonfinite:
        await enhanced.create_credit_note(
            {"client_id": "client-a", "subtotal": 1, "tax": 0, "total": float("nan")},
            request=None,
            current_user=user,
        )
    assert nonfinite.value.status_code == 422

    with pytest.raises(HTTPException) as inconsistent:
        await enhanced.create_credit_note(
            {"client_id": "client-a", "subtotal": 50, "tax": 5, "total": 50},
            request=None,
            current_user=user,
        )
    assert inconsistent.value.status_code == 422
    assert database.credit_notes.rows == _Database().credit_notes.rows


def test_credit_application_is_client_consistent_versioned_and_audited(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_credit_application_is_client_consistent_versioned_and_audited(monkeypatch))


async def _test_credit_application_is_client_consistent_versioned_and_audited(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as mismatched_global:
        await enhanced.apply_credit_note("credit-a", {"invoice_id": "invoice-b"}, request=None, current_user=_global_admin())
    assert mismatched_global.value.status_code == 409
    assert database.invoices.rows[1]["amount_paid"] == 0.0
    assert database.credit_notes.rows[0]["status"] == "issued"

    result = await enhanced.apply_credit_note("credit-a", {"invoice_id": "invoice-a"}, request=None, current_user=user)
    assert result == {"message": "Credit of $60.00 applied to invoice", "new_balance": 40.0}
    invoice = database.invoices.rows[0]
    credit = database.credit_notes.rows[0]
    assert invoice["amount_paid"] == 60.0
    assert invoice["payment_status"] == "partial"
    assert invoice["version"] == 4
    assert invoice["payments"][-1]["credit_note_id"] == "credit-a"
    assert credit["status"] == "applied"
    assert credit["applied_to_invoice"] is True
    assert credit["version"] == 3
    assert credit["audit_trail"][-1]["action"] == "applied"
    audit = database.activity_logs.rows[-1]
    assert audit["action"] == "credit_applied"
    assert audit["metadata"]["client_id"] == "client-a"
    assert audit["metadata"]["credit_note_id"] == "credit-a"


def test_credit_application_releases_its_claim_when_the_invoice_changes(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_credit_application_releases_its_claim_when_the_invoice_changes(monkeypatch))


async def _test_credit_application_releases_its_claim_when_the_invoice_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    original_update = database.invoices.update_one

    async def stale_invoice_update(query: dict[str, Any], update: dict[str, Any], **kwargs: Any):
        if query.get("id") == "invoice-a":
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        return await original_update(query, update, **kwargs)

    database.invoices.update_one = stale_invoice_update
    with pytest.raises(HTTPException) as stale:
        await enhanced.apply_credit_note("credit-a", {"invoice_id": "invoice-a"}, request=None, current_user=_restricted_client_a())
    assert stale.value.status_code == 409
    assert database.invoices.rows[0]["amount_paid"] == 0.0
    assert database.credit_notes.rows[0]["status"] == "issued"
    assert database.credit_notes.rows[0]["application_error"] == "invoice_update_conflict"
    assert database.credit_notes.rows[0]["applied_to_invoice"] is False


def test_invoice_enhanced_reads_mask_foreign_clients_and_keep_results_scoped(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_invoice_enhanced_reads_mask_foreign_clients_and_keep_results_scoped(monkeypatch))


async def _test_invoice_enhanced_reads_mask_foreign_clients_and_keep_results_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as foreign_history:
        await enhanced.get_invoice_email_history("invoice-b", current_user=user, request=None)
    assert foreign_history.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_statement:
        await enhanced.get_client_statement("client-b", current_user=user, request=None)
    assert foreign_statement.value.status_code == 404

    statement = await enhanced.get_client_statement("client-a", current_user=user, request=None)
    assert statement["client"]["id"] == "client-a"
    assert {entry["number"] for entry in statement["entries"]} == {"INV-A", "CN-A"}

    notes = await enhanced.get_credit_notes(current_user=user, request=None)
    assert [note["id"] for note in notes] == ["credit-a"]


def test_invoice_enhanced_financial_routes_declare_stable_action_permissions():
    expected_permissions = {
        ("/invoices/{invoice_id}/email", "POST"): "billing.invoice.modify",
        ("/invoices/{invoice_id}/email-history", "GET"): "billing.portal.view",
        ("/credit-notes", "GET"): "billing.portal.view",
        ("/credit-notes", "POST"): "billing.invoice.modify",
        ("/credit-notes/{cn_id}/apply", "POST"): "billing.payment.record",
        ("/clients/{client_id}/statement", "GET"): "billing.portal.view",
        ("/clients/{client_id}/statement/pdf", "GET"): "billing.portal.view",
    }
    for (path, method), expected_permission in expected_permissions.items():
        route = next(candidate for candidate in enhanced.router.routes if candidate.path == path and method in candidate.methods)
        permissions = {
            inspect.getclosurevars(dependency.call).nonlocals["permission_id"]
            for dependency in route.dependant.dependencies
            if dependency.call is not None and "permission_id" in inspect.getclosurevars(dependency.call).nonlocals
        }
        assert expected_permission in permissions
