"""Invoice delivery must attach and retain the governed commercial PDF."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

from app.routers import email_signatures, email_utils, invoice_enhanced
from app.services import commercial_documents


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query, _projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return deepcopy(row)
        return None

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update, **_kwargs):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                row.update(deepcopy(update.get("$set", {})))
                for field, value in update.get("$inc", {}).items():
                    row[field] = row.get(field, 0) + value
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def test_invoice_email_includes_pdf_and_freezes_the_same_render_context(monkeypatch):
    asyncio.run(_test_invoice_email_includes_pdf_and_freezes_the_same_render_context(monkeypatch))


async def _test_invoice_email_includes_pdf_and_freezes_the_same_render_context(monkeypatch):
    invoice = {
        "id": "invoice-1001",
        "invoice_number": "INV-1001",
        "client_id": "client-a",
        "client_name": "Acme Health",
        "status": "draft",
        "payment_status": "unpaid",
        "total": 120.0,
        "amount_paid": 0.0,
        "version": 4,
    }
    database = SimpleNamespace(
        invoices=_Collection([invoice]),
        clients=_Collection([{"id": "client-a", "email": "accounts@acme.example"}]),
        settings=_Collection([{"type": "branding", "company_name": "Nexus MSP", "primary_color": "#0F766E"}]),
        invoice_pdf_templates=_Collection(),
        invoice_emails=_Collection(),
        activity_logs=_Collection(),
    )
    deliveries = []
    monkeypatch.setattr(invoice_enhanced, "db", database)
    monkeypatch.setattr(commercial_documents, "db", database)
    monkeypatch.setattr(invoice_enhanced, "begin_idempotent_operation", lambda *_args, **_kwargs: _async_value(None))
    monkeypatch.setattr(invoice_enhanced, "complete_idempotent_operation", lambda *_args, **_kwargs: _async_value())
    monkeypatch.setattr(invoice_enhanced, "fail_idempotent_operation", lambda *_args, **_kwargs: _async_value())
    monkeypatch.setattr(invoice_enhanced, "log_activity", lambda *_args, **_kwargs: _async_value())
    monkeypatch.setattr(invoice_enhanced, "render_nexus_invoice_pdf", lambda *_args, **_kwargs: b"%PDF-invoice")
    monkeypatch.setattr(email_signatures, "append_default_signature", lambda **_kwargs: _async_value(("<p>Signed</p>", None, "signature-1")))

    async def send_email(*args, **kwargs):
        deliveries.append((args, kwargs))
        return {"status": "sent", "message": "Delivered", "sender": "billing@nexus.example"}

    monkeypatch.setattr(email_utils, "send_email", send_email)

    result = await invoice_enhanced.email_invoice_to_client(
        "invoice-1001",
        {"email": "accounts@acme.example", "idempotency_key": "invoice-email-1001"},
        current_user={"id": "admin-1", "name": "Operations Admin", "role": "admin", "is_admin": True},
    )

    assert result["sent"] is True
    _, kwargs = deliveries[0]
    assert kwargs["attachments"] == [{
        "filename": "Invoice_INV-1001.pdf",
        "content": b"%PDF-invoice",
        "content_type": "application/pdf",
    }]
    saved = database.invoices.rows[0]
    assert saved["status"] == "sent"
    assert saved["document_snapshot"]["document_type"] == "invoice"
    assert saved["document_snapshot"]["branding"]["company_name"] == "Nexus MSP"


async def _async_value(value=None):
    return value
