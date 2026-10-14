"""P0 regression coverage for scoped supplier matching and PO PDF email delivery."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import email_signatures, email_utils, po_enhanced, purchase_orders


async def _async_value(value=None):
    return value


def _contains_exact_clause(query, field, value):
    if isinstance(query, dict):
        if query.get(field) == value:
            return True
        return any(_contains_exact_clause(item, field, value) for item in query.values())
    if isinstance(query, (list, tuple)):
        return any(_contains_exact_clause(item, field, value) for item in query)
    return False


def _value_at_path(row, path):
    value = row
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _matches_query(row, query):
    for field, expected in query.items():
        if field == "$and":
            if not all(_matches_query(row, clause) for clause in expected):
                return False
            continue
        actual = _value_at_path(row, field)
        if isinstance(expected, dict):
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _InvoiceMatchCollection:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.queries = []
        self.updates = []

    async def find_one(self, query, _projection=None):
        self.queries.append(query)
        return next((row for row in self.rows if _matches_query(row, query)), None)

    async def update_one(self, query, update):
        self.updates.append((query, update))
        return SimpleNamespace(matched_count=1, modified_count=1)


def _purchase_order():
    return {
        "id": "po-current",
        "po_number": "PO-1001",
        "client_id": "client-a",
        "vendor_id": "vendor-a",
        "status": "submitted",
        "total": 120.0,
    }


def test_supplier_invoice_duplicate_lookup_is_limited_to_the_po_client_for_admins(monkeypatch):
    asyncio.run(_test_supplier_invoice_duplicate_lookup_is_limited_to_the_po_client_for_admins(monkeypatch))


async def _test_supplier_invoice_duplicate_lookup_is_limited_to_the_po_client_for_admins(monkeypatch):
    collection = _InvoiceMatchCollection([
        {
            "id": "po-other-client",
            "po_number": "PO-0999",
            "client_id": "client-b",
            "vendor_id": "vendor-a",
            "vendor_invoice_match": {"invoice_number": "SUP-100"},
        }
    ])
    monkeypatch.setattr(purchase_orders, "db", SimpleNamespace(purchase_orders=collection))
    monkeypatch.setattr(purchase_orders, "_po_or_404", lambda *_args, **_kwargs: _async_value(_purchase_order()))
    monkeypatch.setattr(purchase_orders, "_log_po_audit", lambda *_args, **_kwargs: _async_value())

    response = await purchase_orders.record_vendor_invoice_match(
        "po-current",
        {"invoice_number": "SUP-100", "supplier_total": 120.0},
        current_user={"id": "admin-1", "name": "Admin", "role": "admin"},
    )

    assert response["vendor_invoice_match"]["status"] == "matched"
    assert _contains_exact_clause(collection.queries[0], "client_id", "client-a")


def test_supplier_invoice_duplicate_remains_blocked_inside_the_same_client(monkeypatch):
    asyncio.run(_test_supplier_invoice_duplicate_remains_blocked_inside_the_same_client(monkeypatch))


async def _test_supplier_invoice_duplicate_remains_blocked_inside_the_same_client(monkeypatch):
    collection = _InvoiceMatchCollection([
        {
            "id": "po-same-client",
            "po_number": "PO-0999",
            "client_id": "client-a",
            "vendor_id": "vendor-a",
            "vendor_invoice_match": {"invoice_number": "SUP-100"},
        }
    ])
    monkeypatch.setattr(purchase_orders, "db", SimpleNamespace(purchase_orders=collection))
    monkeypatch.setattr(purchase_orders, "_po_or_404", lambda *_args, **_kwargs: _async_value(_purchase_order()))

    with pytest.raises(HTTPException) as exc:
        await purchase_orders.record_vendor_invoice_match(
            "po-current",
            {"invoice_number": "SUP-100", "supplier_total": 120.0},
            current_user={"id": "admin-1", "name": "Admin", "role": "admin"},
        )

    assert exc.value.status_code == 409
    assert "PO-0999" in exc.value.detail
    assert _contains_exact_clause(collection.queries[0], "client_id", "client-a")


class _EmailPurchaseOrders:
    def __init__(self):
        self.updates = []

    async def update_one(self, query, update):
        self.updates.append((query, update))
        return SimpleNamespace(matched_count=1, modified_count=1)


class _BrandingSettings:
    async def find_one(self, query, _projection=None):
        if query == {"type": "branding"}:
            return {"company_name": "Nexus MSP"}
        return None


class _EmptyCollection:
    async def find_one(self, _query, _projection=None):
        return None


def test_po_vendor_email_includes_the_generated_pdf_attachment(monkeypatch):
    asyncio.run(_test_po_vendor_email_includes_the_generated_pdf_attachment(monkeypatch))


def test_po_email_idempotency_replay_does_not_rerender_or_resend(monkeypatch):
    asyncio.run(_test_po_email_idempotency_replay_does_not_rerender_or_resend(monkeypatch))


async def _test_po_email_idempotency_replay_does_not_rerender_or_resend(monkeypatch):
    po = {
        **_purchase_order(),
        "status": "approved",
        "vendor_email": "orders@acme.example",
    }
    monkeypatch.setattr(po_enhanced, "db", SimpleNamespace())
    monkeypatch.setattr(
        po_enhanced,
        "_po_or_404",
        lambda *_args, **_kwargs: _async_value(po),
    )
    monkeypatch.setattr(
        po_enhanced,
        "begin_idempotent_operation",
        lambda *_args, **_kwargs: _async_value({"message": "Already delivered"}),
    )
    monkeypatch.setattr(
        po_enhanced,
        "render_nexus_purchase_order_pdf",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("PDF must not rerender")),
    )
    monkeypatch.setattr(
        email_signatures,
        "append_default_signature",
        lambda **_kwargs: _async_value(("<p>Signed</p>", None, "signature-1")),
    )
    monkeypatch.setattr(
        email_utils,
        "send_email",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Email must not resend")),
    )

    response = await po_enhanced.email_po_to_vendor(
        "po-current",
        {"idempotency_key": "po-email-1001"},
        current_user={"id": "admin-1", "name": "Operations Admin", "role": "admin"},
    )

    assert response == {"message": "Already delivered", "replayed": True}


async def _test_po_vendor_email_includes_the_generated_pdf_attachment(monkeypatch):
    po = {
        **_purchase_order(),
        "status": "approved",
        "vendor": "Acme Supplier",
        "vendor_email": "orders@acme.example",
    }
    purchase_orders_collection = _EmailPurchaseOrders()
    deliveries = []

    monkeypatch.setattr(
        po_enhanced,
        "db",
        SimpleNamespace(
            settings=_BrandingSettings(),
            invoice_pdf_templates=_EmptyCollection(),
            purchase_orders=purchase_orders_collection,
        ),
    )
    monkeypatch.setattr(
        po_enhanced,
        "_po_or_404",
        lambda *_args, **_kwargs: _async_value(po),
    )
    monkeypatch.setattr(po_enhanced, "_po_audit", lambda *_args, **_kwargs: _async_value())
    monkeypatch.setattr(
        po_enhanced,
        "begin_idempotent_operation",
        lambda *_args, **_kwargs: _async_value(None),
    )
    monkeypatch.setattr(
        po_enhanced,
        "complete_idempotent_operation",
        lambda *_args, **_kwargs: _async_value(),
    )
    monkeypatch.setattr(
        po_enhanced,
        "render_nexus_purchase_order_pdf",
        lambda *_args, **_kwargs: b"%PDF-test",
    )
    monkeypatch.setattr(
        email_signatures,
        "append_default_signature",
        lambda **_kwargs: _async_value(("<p>Signed</p>", None, "signature-1")),
    )

    async def send_email(*args, **kwargs):
        deliveries.append((args, kwargs))
        return {"status": "sent", "message": "Delivered", "sender": "billing@nexus.example"}

    monkeypatch.setattr(email_utils, "send_email", send_email)

    response = await po_enhanced.email_po_to_vendor(
        "po-current",
        {
            "email": "orders@acme.example",
            "subject": "PO 1001",
            "message": "Attached is the PO.",
            "idempotency_key": "po-email-1001",
        },
        current_user={"id": "admin-1", "name": "Operations Admin", "role": "admin"},
    )

    assert response["sent"] is True
    _, kwargs = deliveries[0]
    assert kwargs["attachments"] == [
        {
            "filename": "PO_PO-1001.pdf",
            "content": b"%PDF-test",
            "content_type": "application/pdf",
        }
    ]
    assert kwargs["client_id"] == "client-a"
    assert kwargs["related_type"] == "purchase_order"
    assert kwargs["related_id"] == "po-current"
    assert purchase_orders_collection.updates[0][1]["$set"]["status"] == "submitted"
    assert purchase_orders_collection.updates[0][1]["$set"]["document_snapshot"]["document_type"] == "purchase_order"
