"""Focused regressions for the authenticated portal card-checkout boundary."""

from __future__ import annotations

import asyncio
import sys
from copy import deepcopy
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import payment_links, portal_v2


_MISSING = object()


def _value(row: dict[str, Any], key: str) -> Any:
    current: Any = row
    for segment in key.split("."):
        if not isinstance(current, dict) or segment not in current:
            return _MISSING
        current = current[segment]
    return current


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = _value(row, key)
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


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("_id") or document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], *, upsert: bool = False, **_kwargs: Any):
        row = next((row for row in self.rows if _matches(row, query)), None)
        inserted = False
        if row is None and upsert:
            row = {
                key: deepcopy(value)
                for key, value in query.items()
                if not key.startswith("$") and not isinstance(value, dict)
            }
            self.rows.append(row)
            inserted = True
        if row is None:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        if inserted:
            row.update(deepcopy(update.get("$setOnInsert", {})))
        row.update(deepcopy(update.get("$set", {})))
        for key, value in update.get("$push", {}).items():
            row.setdefault(key, []).append(deepcopy(value))
        return SimpleNamespace(
            matched_count=0 if inserted else 1,
            modified_count=1,
            upserted_id=row.get("_id") if inserted else None,
        )


class _Database(SimpleNamespace):
    def __init__(self, *, invoices: list[dict[str, Any]] | None = None, xero_invoices: list[dict[str, Any]] | None = None):
        super().__init__(
            invoices=_Collection(invoices),
            xero_invoices=_Collection(xero_invoices),
            payment_links=_Collection(),
            payment_transactions=_Collection(),
            settings=_Collection(),
        )


def _invoice(*, client_id: str = "client-a", invoice_id: str = "invoice-a") -> dict[str, Any]:
    return {
        "id": invoice_id,
        "invoice_number": "INV-100",
        "client_id": client_id,
        "client_name": "Client A",
        "currency": "AUD",
        "status": "sent",
        "total": 100.0,
        "amount_paid": 20.0,
        "version": 7,
    }


def _portal_user(*, client_id: str = "client-a") -> dict[str, Any]:
    return {
        "id": "portal-user-a",
        "name": "Portal User",
        "email": "portal.user@example.test",
        "client_id": client_id,
        "client_name": "Client A",
        "can_view_invoices": True,
    }


def _request() -> Any:
    return SimpleNamespace(
        headers={"user-agent": "portal-checkout-security-test"},
        client=SimpleNamespace(host="127.0.0.1"),
    )


def _install_database(
    monkeypatch: pytest.MonkeyPatch,
    *,
    invoices: list[dict[str, Any]] | None = None,
    xero_invoices: list[dict[str, Any]] | None = None,
) -> tuple[_Database, list[dict[str, Any]]]:
    database = _Database(invoices=invoices, xero_invoices=xero_invoices)
    audits: list[dict[str, Any]] = []
    monkeypatch.setattr(portal_v2, "db", database)
    monkeypatch.setattr(payment_links, "db", database)
    monkeypatch.setattr(portal_v2, "configured_public_base_url", lambda: "https://nexus.example.test")

    async def _stripe_key() -> str:
        return "server-only-stripe-key"

    async def _audit(**event: Any) -> dict[str, Any]:
        audits.append(event)
        return event

    monkeypatch.setattr(payment_links, "_stripe_api_key", _stripe_key)
    monkeypatch.setattr(portal_v2, "record_portal_event", _audit)
    return database, audits


def _install_checkout(monkeypatch: pytest.MonkeyPatch) -> list[tuple[Any, str | None]]:
    # The local test environment deliberately does not require the Stripe SDK.
    monkeypatch.setitem(sys.modules, "stripe", ModuleType("stripe"))
    import app.services.stripe_checkout as stripe_checkout

    calls: list[tuple[Any, str | None]] = []

    class _Checkout:
        def __init__(self, **_kwargs: Any):
            pass

        async def create_checkout_session(self, request: Any, *, idempotency_key: str | None = None):
            calls.append((request, idempotency_key))
            return SimpleNamespace(session_id="cs-portal-bound", url="https://checkout.example.test/cs-portal-bound")

    monkeypatch.setattr(stripe_checkout, "StripeCheckout", _Checkout)
    return calls


def test_portal_checkout_uses_server_owned_urls_currency_and_payment_binding(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_checkout_uses_server_owned_urls_currency_and_payment_binding(monkeypatch))


async def _test_portal_checkout_uses_server_owned_urls_currency_and_payment_binding(monkeypatch: pytest.MonkeyPatch):
    database, audits = _install_database(monkeypatch, invoices=[_invoice()])
    checkout_calls = _install_checkout(monkeypatch)

    result = await portal_v2.portal_pay_invoice(
        "invoice-a",
        {
            "origin_url": "https://attacker.example.test",
            "currency": "usd",
            "idempotency_key": "attacker-controlled-key",
        },
        _request(),
        _portal_user(),
    )

    assert result == {
        "status": "checkout",
        "url": "https://checkout.example.test/cs-portal-bound",
        "session_id": "cs-portal-bound",
        "balance": 80.0,
    }
    assert len(checkout_calls) == 1
    checkout_request, provider_key = checkout_calls[0]
    assert checkout_request.currency == "aud"
    assert checkout_request.success_url.startswith("https://nexus.example.test/portal-dashboard?")
    assert checkout_request.cancel_url.startswith("https://nexus.example.test/portal-dashboard?")
    assert "attacker.example.test" not in checkout_request.success_url
    assert provider_key and provider_key != "attacker-controlled-key"

    assert len(database.payment_links.rows) == 1
    link = database.payment_links.rows[0]
    assert link["source"] == "portal_checkout"
    assert link["visibility"] == "portal_authenticated"
    assert link["invoice_id"] == "invoice-a"
    assert link["invoice_collection"] == "invoices"
    assert link["client_id"] == "client-a"
    assert link["checkout_lock"]["stripe_session_id"] == "cs-portal-bound"
    assert "token" not in result

    assert len(database.payment_transactions.rows) == 1
    transaction = database.payment_transactions.rows[0]
    assert transaction["invoice_id"] == "invoice-a"
    assert transaction["invoice_collection"] == "invoices"
    assert transaction["client_id"] == "client-a"
    assert transaction["payment_link_id"] == link["id"]
    assert transaction["payment_link_payment_id"] == link["checkout_lock"]["id"]
    assert transaction["stripe_session_id"] == "cs-portal-bound"
    assert transaction["amount_cents"] == 8000
    assert transaction["currency"] == "aud"
    assert audits[-1]["action"] == "portal_invoice_payment_checkout"
    assert "token" not in audits[-1]["metadata"]
    assert "url" not in audits[-1]["metadata"]


def test_portal_checkout_retry_reuses_one_provider_session_and_transaction(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_checkout_retry_reuses_one_provider_session_and_transaction(monkeypatch))


async def _test_portal_checkout_retry_reuses_one_provider_session_and_transaction(monkeypatch: pytest.MonkeyPatch):
    database, _audits = _install_database(monkeypatch, invoices=[_invoice()])
    checkout_calls = _install_checkout(monkeypatch)

    first = await portal_v2.portal_pay_invoice(
        "invoice-a", {"origin_url": "https://one.attacker.test", "currency": "usd"}, _request(), _portal_user()
    )
    second = await portal_v2.portal_pay_invoice(
        "invoice-a", {"origin_url": "https://two.attacker.test", "currency": "eur"}, _request(), _portal_user()
    )

    assert first["session_id"] == second["session_id"] == "cs-portal-bound"
    assert second["reused"] is True
    assert len(checkout_calls) == 1
    assert len(database.payment_links.rows) == 1
    assert len(database.payment_transactions.rows) == 1


def test_portal_checkout_fails_closed_for_cross_client_or_ambiguous_invoice_ids(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_checkout_fails_closed_for_cross_client_or_ambiguous_invoice_ids(monkeypatch))


async def _test_portal_checkout_fails_closed_for_cross_client_or_ambiguous_invoice_ids(monkeypatch: pytest.MonkeyPatch):
    database, _audits = _install_database(monkeypatch, invoices=[_invoice(client_id="client-b")])
    checkout_calls = _install_checkout(monkeypatch)

    with pytest.raises(HTTPException) as foreign:
        await portal_v2.portal_pay_invoice("invoice-a", {}, _request(), _portal_user())
    assert foreign.value.status_code == 404
    assert not database.payment_links.rows
    assert not checkout_calls

    database.invoices.rows = [_invoice()]
    database.xero_invoices.rows = [_invoice()]
    with pytest.raises(HTTPException) as ambiguous:
        await portal_v2.portal_pay_invoice("invoice-a", {}, _request(), _portal_user())
    assert ambiguous.value.status_code == 409
    assert not database.payment_links.rows
    assert not checkout_calls


def test_portal_checkout_persists_the_canonical_xero_invoice_collection(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_checkout_persists_the_canonical_xero_invoice_collection(monkeypatch))


async def _test_portal_checkout_persists_the_canonical_xero_invoice_collection(monkeypatch: pytest.MonkeyPatch):
    database, _audits = _install_database(monkeypatch, xero_invoices=[_invoice()])
    _install_checkout(monkeypatch)

    result = await portal_v2.portal_pay_invoice("invoice-a", {}, _request(), _portal_user())

    assert result["status"] == "checkout"
    assert database.payment_links.rows[0]["invoice_collection"] == "xero_invoices"
    assert database.payment_transactions.rows[0]["invoice_collection"] == "xero_invoices"


def test_portal_checkout_does_not_create_a_demo_or_pending_payment_without_stripe(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_checkout_does_not_create_a_demo_or_pending_payment_without_stripe(monkeypatch))


async def _test_portal_checkout_does_not_create_a_demo_or_pending_payment_without_stripe(monkeypatch: pytest.MonkeyPatch):
    database, audits = _install_database(monkeypatch, invoices=[_invoice()])

    async def _no_stripe_key() -> str:
        return ""

    monkeypatch.setattr(payment_links, "_stripe_api_key", _no_stripe_key)
    with pytest.raises(HTTPException) as unavailable:
        await portal_v2.portal_pay_invoice("invoice-a", {}, _request(), _portal_user())

    assert unavailable.value.status_code == 503
    assert not database.payment_links.rows
    assert not database.payment_transactions.rows
    assert audits[-1]["outcome"] == "blocked"
