"""Focused scope regressions for high-impact invoice mutations.

Invoice IDs, payment session IDs, contract IDs and client IDs are all browser
controlled references.  A restricted technician must prove access to every
client implicated by a financial action before the router loads related data or
changes any record.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
from copy import deepcopy
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import invoices
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
            if "$nin" in expected and actual in expected["$nin"]:
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
                        "status": "draft",
                        "payment_status": "unpaid",
                        "total": 100.0,
                        "subtotal": 100.0,
                        "tax": 0.0,
                        "amount_paid": 0.0,
                        "due_date": "2026-09-01",
                        "version": 1,
                    },
                    {
                        "id": "invoice-b",
                        "invoice_number": "INV-B",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "status": "draft",
                        "payment_status": "unpaid",
                        "total": 100.0,
                        "subtotal": 100.0,
                        "tax": 0.0,
                        "amount_paid": 0.0,
                        "due_date": "2026-09-01",
                        "version": 1,
                    },
                ]
            ),
            clients=_Collection(
                [
                    {"id": "client-a", "name": "Client A", "email": "billing-a@example.test"},
                    {"id": "client-b", "name": "Client B", "email": "billing-b@example.test"},
                    {"id": "client-c", "name": "Client C", "email": "billing-c@example.test"},
                ]
            ),
            contracts=_Collection(
                [
                    {"id": "contract-a", "client_id": "client-a", "name": "A Support"},
                    {"id": "contract-b", "client_id": "client-b", "name": "B Support"},
                ]
            ),
            line_items=_Collection(
                [
                    {
                        "id": "contract-line-a",
                        "contract_id": "contract-a",
                        "name": "Support",
                        "quantity": 1,
                        "unit_price": 100,
                        "total": 100,
                    }
                ]
            ),
            tickets=_Collection(),
            payment_transactions=_Collection(
                [
                    {
                        "id": "transaction-b",
                        "invoice_id": "invoice-b",
                        "client_id": "client-b",
                        "session_id": "session-b",
                        "payment_status": "initiated",
                    }
                ]
            ),
            billing_settlements=_Collection(),
            settings=_Collection(),
            scope_denials=_Collection(),
            activity_logs=_Collection(),
        )


def _restricted_client_a() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _restricted_client_a_and_c() -> dict[str, Any]:
    user = _restricted_client_a()
    user["client_scope_ids"] = ["client-a", "client-c"]
    return user


def _global_admin() -> dict[str, Any]:
    return {"id": "admin-1", "name": "Administrator", "role": "admin", "is_admin": True}


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(invoices, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _no_activity(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _no_replay(*_args: Any, **_kwargs: Any):
        return None

    monkeypatch.setattr(invoices, "log_activity", _no_activity)
    monkeypatch.setattr(invoices, "ticket_audit", _no_activity)
    monkeypatch.setattr(invoices, "begin_idempotent_operation", _no_replay)
    monkeypatch.setattr(invoices, "complete_idempotent_operation", _no_activity)
    monkeypatch.setattr(invoices, "fail_idempotent_operation", _no_activity)
    monkeypatch.setattr(invoices, "_sync_split_billing_parent_payment", _no_activity)
    return database


def test_split_billing_checks_source_and_every_payer_before_any_invoice_is_created(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_split_billing_checks_source_and_every_payer_before_any_invoice_is_created(monkeypatch))


async def _test_split_billing_checks_source_and_every_payer_before_any_invoice_is_created(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()
    initial_invoice_count = len(database.invoices.rows)

    with pytest.raises(HTTPException) as foreign_source:
        await invoices.create_split_billing_invoices(
            "invoice-b",
            {"allocations": [{"payer_client_id": "client-a", "amount": 50}, {"payer_client_id": "client-b", "amount": 50}]},
            request=None,
            current_user=user,
        )
    assert foreign_source.value.status_code == 404
    assert len(database.invoices.rows) == initial_invoice_count

    with pytest.raises(HTTPException) as foreign_payer:
        await invoices.create_split_billing_invoices(
            "invoice-a",
            {"allocations": [{"payer_client_id": "client-a", "amount": 50}, {"payer_client_id": "client-b", "amount": 50}]},
            request=None,
            current_user=user,
        )
    assert foreign_payer.value.status_code == 404
    assert len(database.invoices.rows) == initial_invoice_count
    assert [row["operation"] for row in database.scope_denials.rows] == [
        "billing.invoice.split_billing.create",
        "billing.invoice.split_billing.allocate",
    ]


def test_split_billing_keeps_the_legitimate_multiclient_payer_flow(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_split_billing_keeps_the_legitimate_multiclient_payer_flow(monkeypatch))


async def _test_split_billing_keeps_the_legitimate_multiclient_payer_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)

    result = await invoices.create_split_billing_invoices(
        "invoice-a",
        {"allocations": [{"payer_client_id": "client-a", "amount": 45}, {"payer_client_id": "client-c", "amount": 55}]},
        request=None,
        current_user=_restricted_client_a_and_c(),
    )

    assert result["message"] == "Split-billing payer invoices created"
    assert database.invoices.rows[0]["is_split_parent"] is True
    payer_invoices = [row for row in database.invoices.rows if row.get("is_split_child")]
    assert {row["client_id"] for row in payer_invoices} == {"client-a", "client-c"}


def test_move_and_generate_from_contract_require_authorized_source_and_target_clients(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_move_and_generate_from_contract_require_authorized_source_and_target_clients(monkeypatch))


async def _test_move_and_generate_from_contract_require_authorized_source_and_target_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as foreign_source:
        await invoices.move_invoice_to_client("invoice-b", {"client_id": "client-a"}, request=None, current_user=user)
    assert foreign_source.value.status_code == 404
    assert database.invoices.rows[1]["client_id"] == "client-b"

    with pytest.raises(HTTPException) as foreign_target:
        await invoices.move_invoice_to_client("invoice-a", {"client_id": "client-b"}, request=None, current_user=user)
    assert foreign_target.value.status_code == 404
    assert database.invoices.rows[0]["client_id"] == "client-a"

    with pytest.raises(HTTPException) as foreign_contract:
        await invoices.generate_invoice_from_contract(
            "legacy-route-placeholder",
            "contract-b",
            request=None,
            current_user=user,
        )
    assert foreign_contract.value.status_code == 404
    assert len(database.invoices.rows) == 2

    moved = await invoices.move_invoice_to_client(
        "invoice-a",
        {"client_id": "client-c"},
        request=None,
        current_user=_restricted_client_a_and_c(),
    )
    assert moved["new_client_name"] == "Client C"
    assert database.invoices.rows[0]["client_id"] == "client-c"


def test_payment_paths_enforce_invoice_scope_and_checkout_session_binding(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_payment_paths_enforce_invoice_scope_and_checkout_session_binding(monkeypatch))


async def _test_payment_paths_enforce_invoice_scope_and_checkout_session_binding(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as checkout_foreign:
        await invoices.create_invoice_payment("invoice-b", {}, request=None, current_user=user)
    assert checkout_foreign.value.status_code == 404

    with pytest.raises(HTTPException) as status_foreign:
        await invoices.check_payment_status("invoice-b", "session-b", request=None, current_user=user)
    assert status_foreign.value.status_code == 404

    with pytest.raises(HTTPException) as foreign_session:
        await invoices.check_payment_status("invoice-a", "session-b", request=None, current_user=user)
    assert foreign_session.value.status_code == 404
    assert foreign_session.value.detail == "Payment session not found"
    assert database.invoices.rows[0]["amount_paid"] == 0.0

    with pytest.raises(HTTPException) as manual_foreign:
        await invoices.record_manual_payment(
            "invoice-b",
            {"amount": 10, "method": "cash"},
            request=None,
            current_user=user,
        )
    assert manual_foreign.value.status_code == 404

    result = await invoices.record_manual_payment(
        "invoice-a",
        {"amount": 20, "method": "cash", "reference": "CASH-001"},
        request=None,
        current_user=user,
    )
    assert result == {"message": "Payment recorded", "new_balance": 80.0}
    assert database.invoices.rows[0]["amount_paid"] == 20.0
    assert database.invoices.rows[1]["amount_paid"] == 0.0


def test_reconciliation_billing_profiles_and_gateway_settings_do_not_cross_client_boundaries(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_reconciliation_billing_profiles_and_gateway_settings_do_not_cross_client_boundaries(monkeypatch))


async def _test_reconciliation_billing_profiles_and_gateway_settings_do_not_cross_client_boundaries(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    database.invoices.rows[0]["payments"] = [{"amount": 15, "method": "cash", "date": "2026-08-24"}]
    database.invoices.rows[1]["payments"] = [{"amount": 25, "method": "cash", "date": "2026-08-24"}]
    user = _restricted_client_a()

    summary = await invoices.get_reconciliation_summary(current_user=user)
    assert summary["pending_count"] == 1
    assert summary["items"][0]["invoice_id"] == "invoice-a"

    with pytest.raises(HTTPException) as settlement:
        await invoices.close_payment_settlement(
            {"method": "cash", "date": "2026-08-24", "reference": "SET-A"},
            request=None,
            current_user=user,
        )
    assert settlement.value.status_code == 403
    assert database.invoices.rows[0]["payments"][0].get("settlement_id") is None
    assert database.invoices.rows[1]["payments"][0].get("settlement_id") is None

    with pytest.raises(HTTPException) as profile_read:
        await invoices.get_client_billing_profile("client-b", current_user=user)
    assert profile_read.value.status_code == 404

    with pytest.raises(HTTPException) as profile_update:
        await invoices.update_client_billing_profile(
            "client-b",
            {"payment_terms_days": 14},
            request=None,
            current_user=user,
        )
    assert profile_update.value.status_code == 404

    profile = await invoices.update_client_billing_profile(
        "client-a",
        {"billing_email": "finance@example.test", "payment_terms_days": 21},
        request=None,
        current_user=user,
    )
    assert profile["payment_terms_days"] == 21
    assert database.clients.rows[0]["billing_profile"]["billing_email"] == "finance@example.test"

    with pytest.raises(HTTPException) as stripe_read:
        await invoices.get_stripe_settings(request=None, current_user=user)
    assert stripe_read.value.status_code == 403
    with pytest.raises(HTTPException) as stripe_update:
        await invoices.update_stripe_settings({"api_key": "sk_test_should_not_store"}, request=None, current_user=user)
    assert stripe_update.value.status_code == 403


def test_void_masks_foreign_invoices_and_preserves_own_draft_void_flow(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_void_masks_foreign_invoices_and_preserves_own_draft_void_flow(monkeypatch))


async def _test_void_masks_foreign_invoices_and_preserves_own_draft_void_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as foreign_void:
        await invoices.void_invoice("invoice-b", request=None, data={"reason": "not allowed"}, current_user=user)
    assert foreign_void.value.status_code == 404
    assert database.invoices.rows[1]["status"] == "draft"

    result = await invoices.void_invoice("invoice-a", request=None, data={"reason": "duplicate"}, current_user=user)
    assert result == {"message": "Invoice voided"}
    assert database.invoices.rows[0]["status"] == "cancelled"


def test_invoice_financial_routes_keep_existing_action_boundaries():
    expected_permissions = {
        ("/invoices/{invoice_id}/pay", "POST"): "billing.payment.record",
        ("/invoices/{invoice_id}/payment-status", "GET"): "billing.payment.record",
        ("/clients/{client_id}/billing-profile", "PUT"): "billing.invoice.modify",
        ("/settings/stripe", "GET"): "billing.integration.manage",
        ("/settings/stripe", "PUT"): "billing.integration.manage",
        ("/settings/xero", "GET"): "billing.integration.manage",
        ("/settings/xero", "PUT"): "billing.integration.manage",
    }
    for (path, method), expected_permission in expected_permissions.items():
        route = next(
            candidate
            for candidate in invoices.router.routes
            if candidate.path == path and method in candidate.methods
        )
        assert route.dependant.dependencies
        permissions = {
            inspect.getclosurevars(dependency.call).nonlocals["permission_id"]
            for dependency in route.dependant.dependencies
            if dependency.call is not None
            and "permission_id" in inspect.getclosurevars(dependency.call).nonlocals
        }
        assert expected_permission in permissions

    for method in ("GET", "PUT"):
        assert len([
            route for route in invoices.router.routes
            if route.path == "/settings/xero" and method in route.methods
        ]) == 1


def test_update_refuses_a_stale_invoice_after_client_ownership_changes(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_update_refuses_a_stale_invoice_after_client_ownership_changes(monkeypatch))


async def _test_update_refuses_a_stale_invoice_after_client_ownership_changes(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    original_update = database.invoices.update_one

    async def move_before_update(query: dict[str, Any], update: dict[str, Any], **kwargs: Any):
        if query.get("id") == "invoice-a" and "notes" in update.get("$set", {}):
            database.invoices.rows[0].update({"client_id": "client-b", "version": 2})
        return await original_update(query, update, **kwargs)

    database.invoices.update_one = move_before_update
    with pytest.raises(HTTPException) as stale:
        await invoices.update_invoice(
            "invoice-a",
            {"notes": "must not cross the client boundary"},
            request=None,
            current_user=_restricted_client_a(),
        )

    assert stale.value.status_code == 409
    assert database.invoices.rows[0]["client_id"] == "client-b"
    assert database.invoices.rows[0].get("notes") is None


def test_move_increments_version_to_invalidate_stale_invoice_edits(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_move_increments_version_to_invalidate_stale_invoice_edits(monkeypatch))


async def _test_move_increments_version_to_invalidate_stale_invoice_edits(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    result = await invoices.move_invoice_to_client(
        "invoice-a",
        {"client_id": "client-c"},
        request=None,
        current_user=_restricted_client_a_and_c(),
    )

    assert result["new_client_name"] == "Client C"
    assert database.invoices.rows[0]["version"] == 2


def test_legacy_checkout_uses_deployment_origin_and_provider_idempotency(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_legacy_checkout_uses_deployment_origin_and_provider_idempotency(monkeypatch))


async def _test_legacy_checkout_uses_deployment_origin_and_provider_idempotency(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install_database(monkeypatch)
    database.settings.rows.append({"type": "stripe", "api_key": "server-only-test-key"})
    monkeypatch.setenv("PUBLIC_URL", "https://nexus.example.test")

    created_requests: list[Any] = []

    class _Checkout:
        def __init__(self, **_kwargs: Any):
            pass

        async def create_checkout_session(self, request: Any, *, idempotency_key: str | None = None):
            created_requests.append((request, idempotency_key))
            return SimpleNamespace(session_id="cs-server-owned", url="https://checkout.example.test/cs-server-owned")

    # The unit environment intentionally does not install the live Stripe SDK.
    # Supply only the import placeholder needed before replacing the adapter.
    monkeypatch.setitem(sys.modules, "stripe", ModuleType("stripe"))
    import app.services.stripe_checkout as stripe_checkout

    monkeypatch.setattr(stripe_checkout, "StripeCheckout", _Checkout)

    first = await invoices.create_invoice_payment(
        "invoice-a",
        {"origin_url": "https://attacker.example.test"},
        request=None,
        current_user=_restricted_client_a(),
    )
    second = await invoices.create_invoice_payment(
        "invoice-a",
        {"origin_url": "https://another-attacker.example.test"},
        request=None,
        current_user=_restricted_client_a(),
    )

    assert first["session_id"] == second["session_id"] == "cs-server-owned"
    assert created_requests[0][0].success_url.startswith("https://nexus.example.test/invoices?")
    assert created_requests[0][0].cancel_url == "https://nexus.example.test/invoices?payment_cancelled=true"
    assert created_requests[0][1] == created_requests[1][1]
    assert len(database.payment_transactions.rows) == 2  # existing foreign fixture + one persisted checkout
    assert database.payment_transactions.rows[-1]["source"] == "invoice_checkout"
