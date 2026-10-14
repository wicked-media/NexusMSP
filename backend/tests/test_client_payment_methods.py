"""Saved-card payment methods: masking, capture proof and settlement safety.

These run against an in-memory database and a fake Stripe SDK, so the suite
pins the behaviour Nexus promises without a provider account: a card is only
recorded after Stripe proves the capture, provider identifiers never reach the
browser, and a card charge can never settle another customer's invoice.
"""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import client_payment_methods  # noqa: E402
from app.services.action_permissions import (  # noqa: E402
    ACTION_PERMISSION_IDS,
    default_permissions_for_role,
)

USER = {"id": "tech-1", "name": "Tech One", "role": "admin", "is_admin": True}


# --- In-memory persistence --------------------------------------------------


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit=None):
        return [dict(row) for row in self.rows]


def _matches(doc, query):
    for key, expected in (query or {}).items():
        if isinstance(expected, dict):
            if "$ne" in expected and doc.get(key) == expected["$ne"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]

    def find(self, query=None, *_args, **_kwargs):
        return Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query, *_args, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, upsert=False, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        if upsert:
            merged = {key: value for key, value in (query or {}).items() if not key.startswith("$")}
            merged.update(update.get("$set", {}))
            self.rows.append(merged)
        return SimpleNamespace(matched_count=0)

    async def update_many(self, query, update, **_kwargs):
        changed = 0
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set", {}))
                changed += 1
        return SimpleNamespace(modified_count=changed)


def _database(*, clients=None, methods=None, invoices=None, xero_invoices=None):
    return SimpleNamespace(
        clients=FakeCollection(clients),
        client_payment_methods=FakeCollection(methods),
        invoices=FakeCollection(invoices),
        xero_invoices=FakeCollection(xero_invoices),
        payment_transactions=FakeCollection(),
        settings=FakeCollection([{"type": "stripe", "api_key": "sk_test"}]),
    )


def _client(**overrides):
    return {
        "id": "client-a",
        "name": "Acme Ltd",
        "email": "accounts@acme.test",
        "stripe_customer_id": "cus_existing",
        **overrides,
    }


def _method(**overrides):
    return {
        "id": "pm-record-1",
        "client_id": "client-a",
        "stripe_customer_id": "cus_existing",
        "stripe_payment_method_id": "pm_1",
        "brand": "visa",
        "last4": "4242",
        "exp_month": 12,
        "exp_year": 2030,
        "funding": "credit",
        "status": "active",
        "is_default": True,
        "created_at": "2026-01-01T00:00:00+00:00",
        **overrides,
    }


# --- Fake Stripe SDK --------------------------------------------------------


def _stripe_double(calls, *, session=None, setup_intent=None, payment_method=None, intent=None, detach_raises=False):
    class Customer:
        @staticmethod
        def create(**kwargs):
            calls.append(("customer.create", kwargs))
            return SimpleNamespace(id="cus_created")

    class Session:
        @staticmethod
        def create(**kwargs):
            calls.append(("session.create", kwargs))
            return session or SimpleNamespace(id="cs_1", url="https://checkout.stripe.test/setup")

        @staticmethod
        def retrieve(session_id):
            calls.append(("session.retrieve", session_id))
            return session

    class SetupIntent:
        @staticmethod
        def retrieve(setup_intent_id):
            calls.append(("setup_intent.retrieve", setup_intent_id))
            return setup_intent

    class PaymentMethod:
        @staticmethod
        def retrieve(payment_method_id):
            calls.append(("payment_method.retrieve", payment_method_id))
            return payment_method

        @staticmethod
        def detach(payment_method_id):
            calls.append(("payment_method.detach", payment_method_id))
            if detach_raises:
                raise RuntimeError("no such payment method")
            return SimpleNamespace(id=payment_method_id)

    class PaymentIntent:
        @staticmethod
        def create(**kwargs):
            calls.append(("intent.create", kwargs))
            return intent

    return SimpleNamespace(
        Customer=Customer,
        checkout=SimpleNamespace(Session=Session),
        SetupIntent=SetupIntent,
        PaymentMethod=PaymentMethod,
        PaymentIntent=PaymentIntent,
    )


def _prepare(monkeypatch, database, stripe_double):
    monkeypatch.setattr(client_payment_methods, "db", database)
    monkeypatch.setattr(client_payment_methods, "assert_client_scope", AsyncMock(return_value={}))
    monkeypatch.setattr(client_payment_methods, "log_activity", AsyncMock())
    monkeypatch.setattr(client_payment_methods, "_stripe_api_key", AsyncMock(return_value="sk_test"))
    monkeypatch.setattr(client_payment_methods, "_stripe_client", lambda _key: stripe_double)


def run(coro):
    return asyncio.run(coro)


def request_double():
    return SimpleNamespace(method="POST", url=SimpleNamespace(path="/api/clients/client-a/payment-methods"))


# --- Masking and guards -----------------------------------------------------


def test_safe_method_never_returns_provider_identifiers():
    safe = client_payment_methods._safe_method(_method())

    assert safe["brand"] == "visa"
    assert safe["last4"] == "4242"
    assert safe["is_default"] is True
    for forbidden in ("stripe_payment_method_id", "stripe_customer_id", "_id", "client_id"):
        assert forbidden not in safe


def test_money_and_currency_reject_untrusted_values():
    assert client_payment_methods._money("12.345", field_name="amount") == 12.35
    assert client_payment_methods._currency("aud") == "aud"
    with pytest.raises(HTTPException):
        client_payment_methods._money("not money", field_name="amount")
    with pytest.raises(HTTPException):
        client_payment_methods._money(-1, field_name="amount")
    with pytest.raises(HTTPException):
        client_payment_methods._currency("australian dollars")


# --- Capture ----------------------------------------------------------------


def test_list_returns_only_masked_active_cards(monkeypatch):
    database = _database(
        clients=[_client()],
        methods=[_method(), _method(id="pm-record-2", stripe_payment_method_id="pm_2", status="detached", is_default=False)],
    )
    _prepare(monkeypatch, database, _stripe_double([]))

    result = run(client_payment_methods.list_client_payment_methods("client-a", request_double(), USER))

    assert result["stripe_configured"] is True
    assert len(result["methods"]) == 1
    assert result["default_method_id"] == "pm-record-1"
    assert "pm_1" not in str(result)


def test_setup_creates_a_customer_once_and_binds_the_session_to_the_client(monkeypatch):
    calls = []
    database = _database(clients=[_client(stripe_customer_id=None)])
    _prepare(monkeypatch, database, _stripe_double(calls))

    result = run(client_payment_methods.start_client_payment_method_setup("client-a", request_double(), USER))

    assert calls[0][0] == "customer.create"
    assert database.clients.rows[0]["stripe_customer_id"] == "cus_created"
    assert result["url"].startswith("https://checkout.stripe.test/")
    session_kwargs = next(payload for name, payload in calls if name == "session.create")
    assert session_kwargs["mode"] == "setup"
    assert session_kwargs["customer"] == "cus_created"
    assert session_kwargs["metadata"]["nexus_client_id"] == "client-a"
    assert "session_id={CHECKOUT_SESSION_ID}" in session_kwargs["success_url"]


def test_setup_refuses_when_stripe_is_not_configured(monkeypatch):
    database = _database(clients=[_client()])
    _prepare(monkeypatch, database, _stripe_double([]))
    monkeypatch.setattr(client_payment_methods, "_stripe_api_key", AsyncMock(return_value=""))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.start_client_payment_method_setup("client-a", request_double(), USER))

    assert excinfo.value.status_code == 503


def test_complete_refuses_a_session_that_belongs_to_another_client(monkeypatch):
    calls = []
    session = SimpleNamespace(
        id="cs_1",
        mode="setup",
        status="complete",
        setup_intent="si_1",
        customer="cus_existing",
        metadata={"nexus_client_id": "client-b"},
    )
    database = _database(clients=[_client()])
    _prepare(monkeypatch, database, _stripe_double(calls, session=session))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.complete_client_payment_method_setup(
            "client-a", {"session_id": "cs_1"}, request_double(), USER,
        ))

    assert excinfo.value.status_code == 404
    assert database.client_payment_methods.rows == []


def test_complete_stores_a_masked_card_and_makes_the_first_card_default(monkeypatch):
    calls = []
    session = SimpleNamespace(
        id="cs_1", mode="setup", status="complete", setup_intent="si_1",
        customer="cus_existing", metadata={"nexus_client_id": "client-a"},
    )
    setup_intent = SimpleNamespace(id="si_1", payment_method="pm_1")
    payment_method = SimpleNamespace(
        id="pm_1",
        card=SimpleNamespace(brand="mastercard", last4="4444", exp_month=3, exp_year=2029, funding="credit", country="AU", wallet=None),
    )
    database = _database(clients=[_client()])
    _prepare(monkeypatch, database, _stripe_double(
        calls, session=session, setup_intent=setup_intent, payment_method=payment_method,
    ))

    result = run(client_payment_methods.complete_client_payment_method_setup(
        "client-a", {"session_id": "cs_1"}, request_double(), USER,
    ))

    stored = database.client_payment_methods.rows[0]
    assert stored["last4"] == "4444"
    assert stored["brand"] == "mastercard"
    assert stored["status"] == "active"
    assert stored["is_default"] is True
    assert result["method"]["id"] == stored["id"]
    assert "stripe_payment_method_id" not in result["method"]


def test_complete_refuses_a_session_that_is_not_a_setup_session(monkeypatch):
    session = SimpleNamespace(id="cs_1", mode="payment", status="complete", setup_intent="si_1", metadata={"nexus_client_id": "client-a"})
    database = _database(clients=[_client()])
    _prepare(monkeypatch, database, _stripe_double([], session=session))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.complete_client_payment_method_setup(
            "client-a", {"session_id": "cs_1"}, request_double(), USER,
        ))

    assert excinfo.value.status_code == 409
    assert database.client_payment_methods.rows == []


# --- Default and removal ----------------------------------------------------


def test_setting_a_default_leaves_exactly_one_default(monkeypatch):
    database = _database(
        clients=[_client()],
        methods=[_method(), _method(id="pm-record-2", stripe_payment_method_id="pm_2", is_default=False)],
    )
    _prepare(monkeypatch, database, _stripe_double([]))

    result = run(client_payment_methods.set_default_client_payment_method(
        "client-a", "pm-record-2", request_double(), USER,
    ))

    defaults = [row for row in database.client_payment_methods.rows if row["is_default"]]
    assert [row["id"] for row in defaults] == ["pm-record-2"]
    assert result["default_method_id"] == "pm-record-2"


def test_removing_the_default_detaches_at_stripe_and_promotes_the_next_card(monkeypatch):
    calls = []
    database = _database(
        clients=[_client()],
        methods=[_method(), _method(id="pm-record-2", stripe_payment_method_id="pm_2", is_default=False)],
    )
    _prepare(monkeypatch, database, _stripe_double(calls))

    result = run(client_payment_methods.remove_client_payment_method(
        "client-a", "pm-record-1", request_double(), USER,
    ))

    assert ("payment_method.detach", "pm_1") in calls
    detached = next(row for row in database.client_payment_methods.rows if row["id"] == "pm-record-1")
    assert detached["status"] == "detached"
    assert detached["is_default"] is False
    assert result["default_method_id"] == "pm-record-2"


def test_removing_a_card_closes_the_reference_even_when_stripe_already_forgot_it(monkeypatch):
    database = _database(clients=[_client()], methods=[_method()])
    _prepare(monkeypatch, database, _stripe_double([], detach_raises=True))

    result = run(client_payment_methods.remove_client_payment_method(
        "client-a", "pm-record-1", request_double(), USER,
    ))

    assert result["methods"] == []
    assert database.client_payment_methods.rows[0]["status"] == "detached"


# --- Charging ---------------------------------------------------------------


def _charge_database(**invoice_overrides):
    invoice = {
        "id": "inv-1",
        "client_id": "client-a",
        "invoice_number": "INV-1",
        "total": 100,
        "amount_paid": 0,
        "currency": "AUD",
        "status": "sent",
        **invoice_overrides,
    }
    return _database(clients=[_client()], methods=[_method()], invoices=[invoice])


def test_charge_binds_a_transaction_and_never_settles_the_invoice(monkeypatch):
    calls = []
    database = _charge_database()
    intent = SimpleNamespace(id="pi_1", status="succeeded")
    _prepare(monkeypatch, database, _stripe_double(calls, intent=intent))

    result = run(client_payment_methods.charge_invoice_with_client_payment_method(
        "client-a", "pm-record-1", {"invoice_id": "inv-1"}, request_double(), USER,
    ))

    intent_kwargs = next(payload for name, payload in calls if name == "intent.create")
    assert intent_kwargs["amount"] == 10000
    assert intent_kwargs["currency"] == "aud"
    assert intent_kwargs["customer"] == "cus_existing"
    assert intent_kwargs["payment_method"] == "pm_1"
    assert intent_kwargs["confirm"] is True
    assert intent_kwargs["off_session"] is True
    assert intent_kwargs["metadata"] == {"invoice_id": "inv-1", "nexus_client_id": "client-a"}

    transaction = database.payment_transactions.rows[0]
    assert transaction["stripe_payment_intent_id"] == "pi_1"
    assert transaction["provider_id_field"] == "stripe_payment_intent_id"
    assert transaction["amount_cents"] == 10000
    assert transaction["invoice_id"] == "inv-1"
    assert transaction["client_id"] == "client-a"
    assert transaction["payment_status"] == "awaiting_confirmation"
    assert transaction["source"] == "saved_card"

    # The signed webhook is the only settlement path.
    assert database.invoices.rows[0]["amount_paid"] == 0
    assert database.invoices.rows[0]["status"] == "sent"
    assert result["status"] == "processing"


def test_charge_requires_authentication_when_the_bank_demands_it(monkeypatch):
    calls = []
    database = _charge_database()
    _prepare(monkeypatch, database, _stripe_double(calls, intent=SimpleNamespace(id="pi_1", status="requires_action")))

    result = run(client_payment_methods.charge_invoice_with_client_payment_method(
        "client-a", "pm-record-1", {"invoice_id": "inv-1"}, request_double(), USER,
    ))

    assert result["status"] == "requires_action"
    assert database.payment_transactions.rows[0]["payment_status"] == "initiated"
    assert database.invoices.rows[0]["amount_paid"] == 0


def test_charge_refuses_an_invoice_owned_by_another_client(monkeypatch):
    calls = []
    database = _charge_database(client_id="client-b")
    _prepare(monkeypatch, database, _stripe_double(calls, intent=SimpleNamespace(id="pi_1", status="succeeded")))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.charge_invoice_with_client_payment_method(
            "client-a", "pm-record-1", {"invoice_id": "inv-1"}, request_double(), USER,
        ))

    assert excinfo.value.status_code == 404
    assert calls == []
    assert database.payment_transactions.rows == []


def test_charge_refuses_a_voided_invoice(monkeypatch):
    calls = []
    database = _charge_database(status="void")
    _prepare(monkeypatch, database, _stripe_double(calls, intent=SimpleNamespace(id="pi_1", status="succeeded")))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.charge_invoice_with_client_payment_method(
            "client-a", "pm-record-1", {"invoice_id": "inv-1"}, request_double(), USER,
        ))

    assert excinfo.value.status_code == 409
    assert calls == []


def test_charge_refuses_an_amount_above_the_outstanding_balance(monkeypatch):
    calls = []
    database = _charge_database()
    _prepare(monkeypatch, database, _stripe_double(calls, intent=SimpleNamespace(id="pi_1", status="succeeded")))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.charge_invoice_with_client_payment_method(
            "client-a", "pm-record-1", {"invoice_id": "inv-1", "amount": 150}, request_double(), USER,
        ))

    assert excinfo.value.status_code == 409
    assert calls == []


def test_charge_refuses_an_already_paid_invoice(monkeypatch):
    calls = []
    database = _charge_database(amount_paid=100)
    _prepare(monkeypatch, database, _stripe_double(calls, intent=SimpleNamespace(id="pi_1", status="succeeded")))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.charge_invoice_with_client_payment_method(
            "client-a", "pm-record-1", {"invoice_id": "inv-1"}, request_double(), USER,
        ))

    assert excinfo.value.status_code == 400
    assert calls == []


def test_charge_refuses_an_unknown_saved_card(monkeypatch):
    calls = []
    database = _charge_database()
    _prepare(monkeypatch, database, _stripe_double(calls, intent=SimpleNamespace(id="pi_1", status="succeeded")))

    with pytest.raises(HTTPException) as excinfo:
        run(client_payment_methods.charge_invoice_with_client_payment_method(
            "client-a", "pm-record-9", {"invoice_id": "inv-1"}, request_double(), USER,
        ))

    assert excinfo.value.status_code == 404
    assert calls == []


# --- Permission vocabulary --------------------------------------------------


def test_payment_method_permissions_are_registered_and_not_granted_by_default():
    assert {"billing.payment_method.view", "billing.payment_method.manage", "billing.payment_method.charge"} <= ACTION_PERMISSION_IDS
    service_desk_manager = default_permissions_for_role("service_desk_manager")
    assert "billing.payment_method.view" in service_desk_manager
    assert "billing.payment_method.manage" not in service_desk_manager
    assert "billing.payment_method.charge" not in service_desk_manager
    assert "billing.payment_method.charge" in default_permissions_for_role("admin")
