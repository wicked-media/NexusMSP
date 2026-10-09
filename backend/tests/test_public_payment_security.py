"""Focused regressions for public payment capabilities and Stripe settlement."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

import server
from app.routers import payment_links
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual: Any = row
        for segment in key.split("."):
            if not isinstance(actual, dict) or segment not in actual:
                actual = None
                break
            actual = actual[segment]
        if isinstance(expected, dict):
            if "$exists" in expected and (actual is not None) != bool(expected["$exists"]):
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$elemMatch" in expected:
                values = actual if isinstance(actual, list) else []
                if not any(_matches(value, expected["$elemMatch"]) for value in values if isinstance(value, dict)):
                    return False
                continue
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    async def to_list(self, _limit: int):
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
        invoice = {
            "id": "invoice-a",
            "invoice_number": "INV-A",
            "client_id": "client-a",
            "client_name": "Client A",
            "currency": "AUD",
            "status": "sent",
            "total": 100.0,
            "amount_paid": 0.0,
            "amount_due": 100.0,
            "payments": [],
        }
        link = {
            "id": "link-a",
            "token": "payment-token-a",
            "invoice_id": "invoice-a",
            "invoice_collection": "invoices",
            "client_id": "client-a",
            "status": "active",
            "expires_at": "2099-01-01T00:00:00+00:00",
            "allowed_methods": ["card", "becs", "bank_transfer"],
            "payments": [{"id": "payment-a", "method": "card", "amount": 50.0, "status": "pending", "stripe_session_id": "cs-a"}],
        }
        transaction = {
            "id": "transaction-a",
            "invoice_id": "invoice-a",
            "invoice_collection": "invoices",
            "client_id": "client-a",
            "payment_link_id": "link-a",
            "payment_link_payment_id": "payment-a",
            "stripe_session_id": "cs-a",
            "amount": 50.0,
            "amount_cents": 5000,
            "currency": "aud",
            "payment_status": "initiated",
        }
        super().__init__(
            invoices=_Collection([invoice]),
            xero_invoices=_Collection(),
            payment_links=_Collection([link]),
            payment_transactions=_Collection([transaction]),
            settings=_Collection(),
            doc_branding_settings=_Collection(),
            scope_denials=_Collection(),
            activity_logs=_Collection(),
        )


def _restricted_client_a() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_payment_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(payment_links, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _no_activity(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(payment_links, "log_activity", _no_activity)
    return database


def test_public_link_expiry_and_transfer_amount_apply_to_all_public_mutations(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_public_link_expiry_and_transfer_amount_apply_to_all_public_mutations(monkeypatch))


async def _test_public_link_expiry_and_transfer_amount_apply_to_all_public_mutations(monkeypatch: pytest.MonkeyPatch):
    database = _install_payment_database(monkeypatch)
    database.payment_links.rows[0]["expires_at"] = "2000-01-01T00:00:00+00:00"

    with pytest.raises(HTTPException) as expired:
        await payment_links.record_bank_transfer("payment-token-a", {"amount": 1})
    assert expired.value.status_code == 410
    assert database.payment_links.rows[0]["status"] == "expired"
    assert len(database.payment_links.rows[0]["payments"]) == 1

    database.payment_links.rows[0].update({"status": "active", "expires_at": "2099-01-01T00:00:00+00:00"})
    with pytest.raises(HTTPException) as over_balance:
        await payment_links.record_bank_transfer("payment-token-a", {"amount": "1000"})
    assert over_balance.value.status_code == 400
    assert len(database.payment_links.rows[0]["payments"]) == 1


def test_public_confirmation_is_read_only_and_session_bound(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_public_confirmation_is_read_only_and_session_bound(monkeypatch))


async def _test_public_confirmation_is_read_only_and_session_bound(monkeypatch: pytest.MonkeyPatch):
    database = _install_payment_database(monkeypatch)
    result = await payment_links.confirm_payment("payment-token-a", "cs-a")
    assert result == {"status": "pending_confirmation"}
    assert database.invoices.rows[0]["amount_paid"] == 0.0

    with pytest.raises(HTTPException) as foreign_session:
        await payment_links.confirm_payment("payment-token-a", "cs-other")
    assert foreign_session.value.status_code == 404
    assert database.invoices.rows[0]["amount_paid"] == 0.0

    database.payment_links.rows[0]["status"] = "revoked"
    with pytest.raises(HTTPException) as revoked:
        await payment_links.confirm_payment("payment-token-a", "cs-a")
    assert revoked.value.status_code == 410

    database.payment_links.rows[0].update({"status": "active", "expires_at": "2000-01-01T00:00:00+00:00"})
    with pytest.raises(HTTPException) as expired:
        await payment_links.confirm_payment("payment-token-a", "cs-a")
    assert expired.value.status_code == 410
    assert database.payment_links.rows[0]["status"] == "expired"


def test_payment_link_honours_its_bound_invoice_collection_when_ids_collide(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_payment_link_honours_its_bound_invoice_collection_when_ids_collide(monkeypatch))


async def _test_payment_link_honours_its_bound_invoice_collection_when_ids_collide(monkeypatch: pytest.MonkeyPatch):
    database = _install_payment_database(monkeypatch)
    database.xero_invoices.rows.append(
        {
            **deepcopy(database.invoices.rows[0]),
            "client_id": "client-b",
            "invoice_number": "XERO-COLLISION",
        }
    )

    _link, invoice, collection, balance = await payment_links._load_public_link("payment-token-a")

    assert collection == "invoices"
    assert invoice["client_id"] == "client-a"
    assert balance == 100.0


def test_online_payment_reservation_allows_one_retry_but_blocks_a_second_charge(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_online_payment_reservation_allows_one_retry_but_blocks_a_second_charge(monkeypatch))


async def _test_online_payment_reservation_allows_one_retry_but_blocks_a_second_charge(monkeypatch: pytest.MonkeyPatch):
    database = _install_payment_database(monkeypatch)
    link = deepcopy(database.payment_links.rows[0])
    invoice = deepcopy(database.invoices.rows[0])

    first, reused = await payment_links._reserve_online_payment_attempt(
        link=link,
        invoice=invoice,
        method="card",
        amount=50.0,
        idempotency_key="retry-key-123",
    )
    assert reused is False
    assert database.payment_links.rows[0]["checkout_lock"]["id"] == first["id"]

    retry, reused = await payment_links._reserve_online_payment_attempt(
        link=link,
        invoice=invoice,
        method="card",
        amount=50.0,
        idempotency_key="retry-key-123",
    )
    assert reused is True
    assert retry["id"] == first["id"]

    with pytest.raises(HTTPException) as duplicate:
        await payment_links._reserve_online_payment_attempt(
            link=link,
            invoice=invoice,
            method="card",
            amount=50.0,
            idempotency_key="different-key-123",
        )
    assert duplicate.value.status_code == 409


def test_revoked_payment_link_never_settles_an_already_bound_stripe_charge(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_revoked_payment_link_never_settles_an_already_bound_stripe_charge(monkeypatch))


async def _test_revoked_payment_link_never_settles_an_already_bound_stripe_charge(monkeypatch: pytest.MonkeyPatch):
    database = _Database()
    database.payment_links.rows[0]["status"] = "revoked"
    monkeypatch.setattr(server, "db", database)
    event = SimpleNamespace(
        event_id="evt-revoked",
        event_type="checkout.session.completed",
        object_type="checkout.session",
        object_id="cs-a",
        payment_status="paid",
        amount_total=5000,
        currency="aud",
        metadata={"invoice_id": "invoice-a"},
    )

    assert await server._settle_verified_stripe_event(event) == "reconciliation_required"
    assert database.invoices.rows[0]["amount_paid"] == 0.0
    assert database.payment_transactions.rows[0]["payment_status"] == "reconciliation_required"


def test_operator_mutations_mask_foreign_client_links_and_keep_route_permissions(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_operator_mutations_mask_foreign_client_links_and_keep_route_permissions(monkeypatch))


async def _test_operator_mutations_mask_foreign_client_links_and_keep_route_permissions(monkeypatch: pytest.MonkeyPatch):
    database = _install_payment_database(monkeypatch)
    database.invoices.rows[0]["client_id"] = "client-b"
    user = _restricted_client_a()

    with pytest.raises(HTTPException) as forbidden:
        await payment_links.revoke_payment_link("link-a", request=None, current_user=user)
    assert forbidden.value.status_code == 404
    assert database.payment_links.rows[0]["status"] == "active"

    expected = {
        ("/payment-links", "POST"): "billing.invoice.modify",
        ("/payment-links", "GET"): "billing.portal.view",
        ("/payment-links/{link_id}", "DELETE"): "billing.invoice.modify",
        ("/payment-links/{link_id}/confirm-transfer", "POST"): "billing.payment.record",
    }
    import inspect

    for (path, method), permission in expected.items():
        route = next(candidate for candidate in payment_links.router.routes if candidate.path == path and method in candidate.methods)
        values = {
            inspect.getclosurevars(dependency.call).nonlocals["permission_id"]
            for dependency in route.dependant.dependencies
            if dependency.call is not None and "permission_id" in inspect.getclosurevars(dependency.call).nonlocals
        }
        assert permission in values

    listed = await payment_links.list_payment_links({"role": "admin"})
    assert "token" not in listed[0]
    assert "stripe_session_id" not in listed[0]["payments"][0]


def test_bank_transfer_never_marks_link_paid_when_bound_invoice_update_fails(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bank_transfer_never_marks_link_paid_when_bound_invoice_update_fails(monkeypatch))


async def _test_bank_transfer_never_marks_link_paid_when_bound_invoice_update_fails(monkeypatch: pytest.MonkeyPatch):
    database = _install_payment_database(monkeypatch)
    database.payment_links.rows[0]["payments"].append(
        {
            "id": "bank-payment-a",
            "method": "bank_transfer",
            "amount": 25.0,
            "status": "awaiting_confirmation",
        }
    )

    async def reject_invoice_update(*_args: Any, **_kwargs: Any):
        return SimpleNamespace(matched_count=0, modified_count=0)

    database.invoices.update_one = reject_invoice_update
    with pytest.raises(HTTPException) as changed:
        await payment_links.admin_confirm_bank_transfer(
            "link-a",
            {"payment_id": "bank-payment-a"},
            request=None,
            current_user={"id": "admin-a", "name": "Admin", "role": "admin"},
        )
    assert changed.value.status_code == 409
    bank_payment = next(item for item in database.payment_links.rows[0]["payments"] if item["id"] == "bank-payment-a")
    assert bank_payment["status"] == "awaiting_confirmation"


def test_verified_stripe_event_requires_nexus_transaction_and_is_idempotent(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_verified_stripe_event_requires_nexus_transaction_and_is_idempotent(monkeypatch))


async def _test_verified_stripe_event_requires_nexus_transaction_and_is_idempotent(monkeypatch: pytest.MonkeyPatch):
    database = _Database()
    monkeypatch.setattr(server, "db", database)
    event = SimpleNamespace(
        event_id="evt-a",
        event_type="checkout.session.completed",
        object_type="checkout.session",
        object_id="cs-a",
        payment_status="paid",
        amount_total=5000,
        currency="aud",
        metadata={"invoice_id": "invoice-a"},
    )

    assert await server._settle_verified_stripe_event(event) == "processed"
    assert database.invoices.rows[0]["amount_paid"] == 50.0
    assert database.payment_links.rows[0]["payments"][0]["status"] == "paid"
    assert await server._settle_verified_stripe_event(event) == "duplicate"
    assert database.invoices.rows[0]["amount_paid"] == 50.0

    unbound = SimpleNamespace(**{**event.__dict__, "event_id": "evt-unbound", "object_id": "cs-unbound"})
    assert await server._settle_verified_stripe_event(unbound) == "ignored"
    assert database.invoices.rows[0]["amount_paid"] == 50.0


def test_stripe_settlement_releases_idempotency_gate_when_invoice_write_races(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_stripe_settlement_releases_idempotency_gate_when_invoice_write_races(monkeypatch))


async def _test_stripe_settlement_releases_idempotency_gate_when_invoice_write_races(monkeypatch: pytest.MonkeyPatch):
    database = _Database()
    monkeypatch.setattr(server, "db", database)
    event = SimpleNamespace(
        event_id="evt-race",
        event_type="checkout.session.completed",
        object_type="checkout.session",
        object_id="cs-a",
        payment_status="paid",
        amount_total=5000,
        currency="aud",
        metadata={"invoice_id": "invoice-a"},
    )
    normal_invoice_update = database.invoices.update_one

    async def reject_invoice_update(*_args: Any, **_kwargs: Any):
        return SimpleNamespace(matched_count=0, modified_count=0)

    database.invoices.update_one = reject_invoice_update
    with pytest.raises(RuntimeError):
        await server._settle_verified_stripe_event(event)
    assert database.invoices.rows[0]["amount_paid"] == 0.0
    assert database.payment_transactions.rows[0]["payment_status"] == "retryable"
    assert database.payment_transactions.rows[0]["last_settlement_error"] == "invoice_update_conflict"

    database.invoices.update_one = normal_invoice_update
    assert await server._settle_verified_stripe_event(event) == "processed"
    assert database.invoices.rows[0]["amount_paid"] == 50.0
