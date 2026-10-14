"""Focused regressions for late-payment email authority boundaries.

The browser may choose to request a reminder or confirmation, but it must
never become the source of the client, invoice, money, recipient or payment
link facts included in a commercial email.
"""

from __future__ import annotations

import asyncio
import inspect
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import late_payment
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    return all(row.get(key) == value for key, value in (query or {}).items())


def _project(row: dict[str, Any], projection: dict[str, Any] | None) -> dict[str, Any]:
    if not projection:
        return deepcopy(row)
    included = {key for key, enabled in projection.items() if key != "_id" and enabled}
    if included:
        return {key: deepcopy(row[key]) for key in included if key in row}
    return {key: deepcopy(value) for key, value in row.items() if projection.get(key, 1)}


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], projection: dict[str, Any] | None = None):
        return next((_project(row, projection) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            clients=_Collection(
                [
                    {
                        "id": "client-a",
                        "name": "Canonical Client",
                        "billing_email": "billing-a@example.com",
                        "email": "do-not-use@example.com",
                    },
                    {"id": "client-b", "name": "Other Client", "billing_email": "billing-b@example.com"},
                ]
            ),
            invoices=_Collection(
                [
                    {
                        "id": "invoice-a",
                        "client_id": "client-a",
                        "invoice_number": "INV-CANONICAL",
                        "total": 160,
                        "amount_paid": 10,
                        "currency": "AUD",
                        "status": "sent",
                        "payment_status": "unpaid",
                        "due_date": "2020-01-01",
                    },
                    {
                        "id": "invoice-b",
                        "client_id": "client-b",
                        "invoice_number": "INV-OTHER",
                        "total": 40,
                        "amount_paid": 0,
                        "status": "sent",
                        "payment_status": "unpaid",
                    },
                ]
            ),
            payment_links=_Collection(
                [
                    {
                        "id": "link-a",
                        "invoice_id": "invoice-a",
                        "client_id": "client-a",
                        "status": "active",
                        "token": "canonical-token",
                        "expires_at": "2035-01-01T00:00:00+00:00",
                    }
                ]
            ),
            payment_transactions=_Collection(
                [
                    {
                        "id": "payment-a",
                        "invoice_id": "invoice-a",
                        "client_id": "client-a",
                        "amount": 150,
                        "currency": "AUD",
                        "payment_status": "settled",
                        "method": "bank_transfer",
                    },
                    {
                        "id": "payment-pending",
                        "invoice_id": "invoice-a",
                        "client_id": "client-a",
                        "amount": 150,
                        "payment_status": "initiated",
                        "method": "card",
                    },
                ]
            ),
            settings=_Collection(
                [
                    {
                        "type": "branding",
                        "company_name": "Nexus MSP",
                        "primary_color": "#1177cc",
                    }
                ]
            ),
            late_payment_reminders=_Collection(),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
        )


def _restricted_client_a() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Finance Technician",
        "email": "finance-tech@example.com",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(late_payment, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(late_payment, "configured_public_base_url", lambda: "https://portal.nexus.test")

    async def _audit(
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

    monkeypatch.setattr(late_payment, "log_activity", _audit)
    return database


def test_reminder_uses_canonical_invoice_client_recipient_amount_and_payment_link(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_reminder_uses_canonical_invoice_client_recipient_amount_and_payment_link(monkeypatch))


async def _test_reminder_uses_canonical_invoice_client_recipient_amount_and_payment_link(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install(monkeypatch)
    deliveries: list[dict[str, str]] = []

    async def _send(to_email: str, subject: str, html: str, *, category: str) -> dict[str, str]:
        deliveries.append({"to": to_email, "subject": subject, "html": html, "category": category})
        return {"status": "sent", "message": "delivered"}

    monkeypatch.setattr(late_payment, "send_email", _send)
    result = await late_payment.send_late_payment_reminder(
        {
            "invoice_id": "invoice-a",
            "client_name": "Attacker Selected Client",
            "invoice_number": "INV-ATTACKER",
            "amount": 999999,
            "due_date": "2099-01-01",
            "days_late": 0,
            "to_email": "attacker@example.com",
            "portal_url": "https://attacker.example/steal",
        },
        request=None,
        current_user=_restricted_client_a(),
    )

    assert result["status"] == "sent"
    assert len(deliveries) == 1
    assert deliveries[0]["to"] == "billing-a@example.com"
    assert deliveries[0]["subject"] == "Nexus MSP - Payment Reminder: INV-CANONICAL"
    assert deliveries[0]["category"] == "billing"
    html = deliveries[0]["html"]
    assert "$150.00" in html
    assert "https://portal.nexus.test/pay/canonical-token" in html
    assert "attacker@example.com" not in html
    assert "INV-ATTACKER" not in html
    assert "999,999" not in html
    assert "attacker.example" not in html
    reminder = database.late_payment_reminders.rows[0]
    assert reminder["client_id"] == "client-a"
    assert reminder["invoice_id"] == "invoice-a"
    assert reminder["amount"] == 150
    audit = database.activity_logs.rows[-1]
    assert audit["action"] == "late_payment_reminder_sent"
    assert audit["entity_id"] == "invoice-a"
    assert audit["metadata"]["client_id"] == "client-a"
    assert audit["metadata"]["payment_link_id"] == "link-a"


def test_reminder_masks_foreign_invoice_before_delivery(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_reminder_masks_foreign_invoice_before_delivery(monkeypatch))


async def _test_reminder_masks_foreign_invoice_before_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    database = _install(monkeypatch)
    sent = False

    async def _send(*_args: Any, **_kwargs: Any) -> dict[str, str]:
        nonlocal sent
        sent = True
        return {"status": "sent"}

    monkeypatch.setattr(late_payment, "send_email", _send)
    with pytest.raises(HTTPException) as foreign:
        await late_payment.send_late_payment_reminder(
            {"invoice_id": "invoice-b", "to_email": "attacker@example.com"},
            request=None,
            current_user=_restricted_client_a(),
        )
    assert foreign.value.status_code == 404
    assert sent is False
    assert database.scope_denials.rows[-1]["operation"] == "billing.late_payment.reminder.send"
    assert database.late_payment_reminders.rows == []


def test_confirmation_uses_only_settled_canonical_payment_and_canonical_recipient(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_confirmation_uses_only_settled_canonical_payment_and_canonical_recipient(monkeypatch))


async def _test_confirmation_uses_only_settled_canonical_payment_and_canonical_recipient(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install(monkeypatch)
    deliveries: list[dict[str, str]] = []

    async def _send(to_email: str, subject: str, html: str, *, category: str) -> dict[str, str]:
        deliveries.append({"to": to_email, "subject": subject, "html": html, "category": category})
        return {"status": "sent"}

    monkeypatch.setattr(late_payment, "send_email", _send)
    result = await late_payment.send_payment_confirmation(
        {
            "invoice_id": "invoice-a",
            "payment_id": "payment-a",
            "client_name": "Attacker Selected Client",
            "invoice_number": "INV-ATTACKER",
            "amount": 999999,
            "payment_method": "attacker selected method",
            "to_email": "attacker@example.com",
            "cc_team": False,
        },
        request=None,
        current_user=_restricted_client_a(),
    )

    assert result["message"] == "Confirmation sent for INV-CANONICAL"
    assert len(deliveries) == 1
    assert deliveries[0]["to"] == "billing-a@example.com"
    assert "$150.00" in deliveries[0]["html"]
    assert "Bank Transfer" in deliveries[0]["html"]
    assert "attacker@example.com" not in deliveries[0]["html"]
    assert "INV-ATTACKER" not in deliveries[0]["html"]
    assert "999,999" not in deliveries[0]["html"]
    audit = database.activity_logs.rows[-1]
    assert audit["action"] == "late_payment_confirmation_sent"
    assert audit["entity_id"] == "invoice-a"
    assert audit["metadata"]["client_id"] == "client-a"
    assert audit["metadata"]["payment_id"] == "payment-a"


def test_confirmation_refuses_unsettled_or_missing_payment_records(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_confirmation_refuses_unsettled_or_missing_payment_records(monkeypatch))


async def _test_confirmation_refuses_unsettled_or_missing_payment_records(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch)

    async def _send(*_args: Any, **_kwargs: Any) -> dict[str, str]:
        raise AssertionError("email delivery must not occur for an unsettled payment")

    monkeypatch.setattr(late_payment, "send_email", _send)
    with pytest.raises(HTTPException) as unsettled:
        await late_payment.send_payment_confirmation(
            {"invoice_id": "invoice-a", "payment_id": "payment-pending"},
            request=None,
            current_user=_restricted_client_a(),
        )
    assert unsettled.value.status_code == 409

    with pytest.raises(HTTPException) as missing:
        await late_payment.send_payment_confirmation(
            {"invoice_id": "invoice-a"},
            request=None,
            current_user=_restricted_client_a(),
        )
    assert missing.value.status_code == 422


def test_late_payment_email_html_escapes_content_and_rejects_unsafe_payment_urls():
    reminder_html = late_payment._late_reminder_html(
        "<script>alert(1)</script>",
        "INV-<img src=x>",
        12,
        "<b>today</b>",
        1,
        "<img src=x>",
        '";background:url(https://attacker.example)',
        "javascript:alert(1)",
    )
    confirmation_html = late_payment._payment_confirmation_html(
        "<script>alert(1)</script>",
        "INV-<img src=x>",
        12,
        "<b>Card</b>",
        "<img src=x>",
        "#1177cc",
    )

    for html in (reminder_html, confirmation_html):
        assert "<script>" not in html
        assert "<img src=x>" not in html
        assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "javascript:alert" not in reminder_html
    assert "background:url" not in reminder_html


def test_late_payment_email_routes_have_explicit_financial_action_dependencies():
    expected_actions = {
        "/late-payment/send-reminder": "billing.portal.reminder.send",
        "/late-payment/send-confirmation": "billing.payment.record",
    }
    for path, expected_action in expected_actions.items():
        route = next(candidate for candidate in late_payment.router.routes if candidate.path == path)
        actions = {
            inspect.getclosurevars(dependency.call).nonlocals["permission_id"]
            for dependency in route.dependant.dependencies
            if dependency.call is not None and "permission_id" in inspect.getclosurevars(dependency.call).nonlocals
        }
        assert expected_action in actions
