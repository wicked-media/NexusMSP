import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.routers import client_360


class Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class Invoices:
    def __init__(self, open_rows, paid_rows):
        self.open_rows = open_rows
        self.paid_rows = paid_rows

    def find(self, query, *_args, **_kwargs):
        return Cursor(self.paid_rows if query.get("payment_status") == "paid" else self.open_rows)


class RecurringInvoices:
    def __init__(self, rows):
        self.rows = rows

    def find(self, *_args, **_kwargs):
        return Cursor(self.rows)


def test_monthly_equivalent_preserves_supported_cadences():
    assert client_360._monthly_equivalent(1200, "annually") == 100
    assert client_360._monthly_equivalent(1200, "yearly") == 100
    assert client_360._monthly_equivalent(300, "quarterly") == 100
    assert round(client_360._monthly_equivalent(100, "fortnightly"), 2) == 216.67


def test_billing_detail_distinguishes_receivables_revenue_and_provider_evidence(monkeypatch):
    now = datetime.now(timezone.utc)
    invoices = [
        {"id": "invoice-30", "invoice_number": "INV-30", "total": 100, "amount_paid": 0, "due_date": (now - timedelta(days=10)).isoformat(), "payment_status": "unpaid"},
        {"id": "invoice-90", "invoice_number": "INV-90", "total": 50, "amount_paid": 0, "due_date": (now - timedelta(days=95)).isoformat(), "payment_status": "unpaid"},
        {"id": "invoice-current", "invoice_number": "INV-CURRENT", "total": 20, "amount_paid": 0, "due_date": (now + timedelta(days=5)).isoformat(), "payment_status": "unpaid"},
    ]
    recurring = [
        {
            "id": "annual-managed-service",
            "description": "Managed service agreement",
            "amount": 1200,
            "currency": "AUD",
            "frequency": "annually",
            "status": "active",
            "next_generation": (now + timedelta(days=10)).isoformat(),
            "auto_send": True,
            "auto_send_email": "accounts@example.test",
            "line_items": [{"description": "Managed IT"}],
        },
        {
            "id": "paused-backup",
            "description": "Paused backup add-on",
            "amount": 120,
            "frequency": "monthly",
            "status": "paused",
            "auto_send": False,
            "line_items": [],
        },
    ]
    payment_promises = SimpleNamespace(
        count_documents=AsyncMock(side_effect=lambda query: 2 if query["status"] == "kept" else 1),
    )
    clients = SimpleNamespace(find_one=AsyncMock(return_value={
        "billing_profile": {
            "billing_email": "billing@example.test",
            "payment_terms_days": 14,
            "purchase_order_required": True,
            "default_payment_method": "direct_debit",
        },
    }))
    monkeypatch.setattr(client_360, "db", SimpleNamespace(
        invoices=Invoices(invoices, [{"total": 900}]),
        recurring_invoices=RecurringInvoices(recurring),
        payment_promises=payment_promises,
        clients=clients,
    ))
    monkeypatch.setattr(client_360, "_aggregate_subscriptions", AsyncMock(return_value={
        "items": [
            {"source": "pax8", "source_label": "Pax8 CSP", "monthly_cost": 19.5},
            {"source": "msp_contract", "source_label": "Contract billing", "monthly_cost": 100},
        ],
    }))

    result = asyncio.run(client_360._aggregate_billing("client-a"))

    assert result["open_balance"] == 170
    assert result["overdue_balance"] == 150
    assert result["critical_overdue_balance"] == 50
    assert result["aging"] == {"current": 20, "30": 100, "60": 0, "90": 0, "90+": 50}
    assert result["mrr_aud"] == 100
    assert result["recurring_summary"]["active"] == 1
    assert result["recurring_summary"]["paused"] == 1
    assert result["recurring_streams"][0]["delivery_state"] == "ready"
    assert "auto_send_email" not in result["recurring_streams"][0]
    assert result["billing_profile"] == {
        "billing_email_configured": True,
        "billing_email_available": True,
        "billing_recipient_state": "configured",
        "payment_terms_days": 14,
        "purchase_order_required": True,
        "default_payment_method": "direct_debit",
    }
    assert "billing@example.test" not in str(result)
    assert result["subscription_summary"] == {
        "provider_records": 1,
        "provider_sources": ["Pax8 CSP"],
        "provider_monthly_cost": 19.5,
        "recurring_billing_records": 2,
    }
    assert result["payment_promises"] == {"kept": 2, "broken": 1}
