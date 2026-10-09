"""Regression coverage for the shared commercial-document contract."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import commercial_documents


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query, _projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return deepcopy(row)
        return None

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if upsert:
            row = {**query, **deepcopy(update.get("$set", {}))}
            self.rows.append(row)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id="new")
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)


def _install_database(monkeypatch):
    database = SimpleNamespace(
        settings=_Collection(),
        invoice_pdf_templates=_Collection([
            {
                "id": "invoice-executive",
                "doc_type": "invoice",
                "name": "Executive Client Invoice",
                "layout": "executive",
                "density": "spacious",
                "primary_color": "#155E75",
                "accent_color": "#22D3EE",
                "blocks": [
                    {"key": "header_banner", "enabled": True, "content": "CLIENT INVOICE"},
                    {"key": "payment_terms", "enabled": True, "content": "Payment due within {{terms_days}} days."},
                    {"key": "footer", "enabled": True, "content": "Thank you for partnering with {{company_name}}."},
                ],
                "revision": 4,
            },
            {"id": "po-standard", "doc_type": "purchase_order", "name": "PO Standard"},
        ]),
    )
    monkeypatch.setattr(commercial_documents, "db", database)
    return database


def test_template_selection_is_limited_to_the_matching_document_type(monkeypatch):
    asyncio.run(_test_template_selection_is_limited_to_the_matching_document_type(monkeypatch))


async def _test_template_selection_is_limited_to_the_matching_document_type(monkeypatch):
    _install_database(monkeypatch)
    with pytest.raises(HTTPException) as error:
        await commercial_documents.normalise_document_customisation(
            {"document_template_id": "po-standard"}, "invoice"
        )
    assert error.value.status_code == 422


def test_sent_snapshot_keeps_the_exact_template_branding_and_copy(monkeypatch):
    asyncio.run(_test_sent_snapshot_keeps_the_exact_template_branding_and_copy(monkeypatch))


async def _test_sent_snapshot_keeps_the_exact_template_branding_and_copy(monkeypatch):
    database = _install_database(monkeypatch)
    invoice = {
        "id": "invoice-1",
        "invoice_number": "INV-1001",
        "client_name": "Acme Health",
        "payment_terms_days": 14,
        "document_template_id": "invoice-executive",
    }
    branding = {"company_name": "Nexus MSP", "primary_color": "#0F766E"}

    snapshot = await commercial_documents.freeze_commercial_document_snapshot("invoice", invoice, branding)
    assert snapshot["profile"]["label"] == "CLIENT INVOICE"
    assert snapshot["profile"]["terms"] == "Payment due within 14 days."
    assert snapshot["profile"]["footer"] == "Thank you for partnering with Nexus MSP."
    assert snapshot["profile"]["density"] == "spacious"
    assert snapshot["branding"]["primary_color"] == "#155E75"

    # A later organisation rebrand/default change must not alter a document
    # that has already become commercial evidence.
    database.settings.rows.append({
        "key": "commercial_document_profile:invoice",
        "value": {"label": "Rebranded Invoice", "footer": "New footer"},
        "revision": 1,
    })
    frozen_context = await commercial_documents.resolve_commercial_document_render_context(
        "invoice", {**invoice, "document_snapshot": snapshot}, {"company_name": "Different Company"}
    )
    assert frozen_context["frozen"] is True
    assert frozen_context["profile"] == snapshot["profile"]
    assert frozen_context["branding"] == snapshot["branding"]


def test_explicit_organisation_copy_overrides_template_copy(monkeypatch):
    asyncio.run(_test_explicit_organisation_copy_overrides_template_copy(monkeypatch))


async def _test_explicit_organisation_copy_overrides_template_copy(monkeypatch):
    database = _install_database(monkeypatch)
    database.settings.rows.append({
        "key": "commercial_document_profile:invoice",
        "value": {"label": "Nexus Tax Invoice", "terms": "Pay by the due date."},
    })
    context = await commercial_documents.resolve_commercial_document_render_context(
        "invoice",
        {"id": "invoice-2", "invoice_number": "INV-1002", "document_template_id": "invoice-executive"},
        {"company_name": "Nexus MSP"},
    )
    assert context["profile"]["label"] == "Nexus Tax Invoice"
    assert context["profile"]["terms"] == "Pay by the due date."
    assert context["profile"]["primary_color"] == "#155E75"


def test_template_safe_content_blocks_are_retained_as_commercial_sections(monkeypatch):
    asyncio.run(_test_template_safe_content_blocks_are_retained_as_commercial_sections(monkeypatch))


async def _test_template_safe_content_blocks_are_retained_as_commercial_sections(monkeypatch):
    database = _install_database(monkeypatch)
    template = database.invoice_pdf_templates.rows[0]
    template["blocks"].extend([
        {"key": "bank_details", "enabled": True, "content": "Bank: Nexus Bank\nReference: {{invoice_number}}"},
        {"key": "signature", "enabled": True, "content": "Authorised by {{company_name}}"},
        {"key": "custom_html", "enabled": True, "content": "<strong>Service note</strong>: retained evidence."},
    ])

    context = await commercial_documents.resolve_commercial_document_render_context(
        "invoice",
        {"id": "invoice-3", "invoice_number": "INV-1003", "document_template_id": "invoice-executive"},
        {"company_name": "Nexus MSP"},
    )

    assert context["profile"]["extra_sections"] == [
        {"title": "Remittance details", "content": "Bank: Nexus Bank\nReference: INV-1003"},
        {"title": "Authorisation", "content": "Authorised by Nexus MSP"},
        {"title": "Additional information", "content": "Service note: retained evidence."},
    ]
