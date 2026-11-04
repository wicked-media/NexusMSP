"""Focused regressions for browser PDF query-token security boundaries.

Browser PDF navigation cannot reliably attach an Authorization header, so the
compatibility query-token route must remain exactly as strict as the normal
Bearer path: active account, action permission, and client/global scope.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app import auth
from app.routers import invoice_pdf, invoice_pdf_templates as templates
from app.services import action_permissions, scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], projection: dict[str, Any] | None = None):
        for row in self.rows:
            if _matches(row, query):
                value = deepcopy(row)
                if projection:
                    included = {key for key, enabled in projection.items() if key != "_id" and enabled}
                    if included:
                        value = {key: value[key] for key in included if key in value}
                    else:
                        value = {key: item for key, item in value.items() if projection.get(key, 1)}
                return value
        return None

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            users=_Collection(
                [
                    {"id": "active-user", "name": "Active", "role": "technician"},
                    {"id": "suspended-user", "name": "Suspended", "role": "technician", "status": "suspended"},
                ]
            ),
            settings=_Collection(),
            invoices=_Collection(
                [
                    {"id": "invoice-a", "invoice_number": "INV-A", "client_id": "client-a"},
                    {"id": "invoice-b", "invoice_number": "INV-B", "client_id": "client-b"},
                ]
            ),
            xero_invoices=_Collection(),
            xero_estimates=_Collection(),
            estimates=_Collection(),
            contracts=_Collection(),
            purchase_orders=_Collection(),
            invoice_pdf_templates=_Collection([{"id": "template-a", "doc_type": "invoice"}]),
            clients=_Collection([{"id": "client-a", "name": "Client A"}]),
            permission_denials=_Collection(),
            scope_denials=_Collection(),
        )


def _request(path: str = "/api/invoices/invoice-a/pdf") -> SimpleNamespace:
    return SimpleNamespace(
        method="GET",
        url=SimpleNamespace(path=path),
        state=SimpleNamespace(correlation_id="pdf-security-test"),
    )


def _restricted_viewer() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A technician",
        "role": "technician",
        "permissions": {"invoices": {"view": True}},
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(auth, "db", database)
    monkeypatch.setattr(invoice_pdf, "db", database)
    monkeypatch.setattr(templates, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    return database


def test_query_token_uses_canonical_active_account_validation(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_query_token_uses_canonical_active_account_validation(monkeypatch))


async def _test_query_token_uses_canonical_active_account_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(monkeypatch)
    monkeypatch.setattr(auth.jwt, "decode", lambda *_args, **_kwargs: {"sub": "suspended-user"})

    with pytest.raises(HTTPException) as suspended:
        await invoice_pdf._get_user_from_token("signed-token")

    assert suspended.value.status_code == 401
    assert suspended.value.detail == "User account is inactive"


def test_query_document_route_requires_billing_view_action_and_records_denial(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_query_document_route_requires_billing_view_action_and_records_denial(monkeypatch))


async def _test_query_document_route_requires_billing_view_action_and_records_denial(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install(monkeypatch)
    denied_user = {
        "id": "tech-denied",
        "name": "No billing permission",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as denied:
        await invoice_pdf._get_financial_document_pdf_user(_request(), denied_user)

    assert denied.value.status_code == 403
    assert database.permission_denials.rows[-1]["permission"] == "billing.portal.view"
    assert database.permission_denials.rows[-1]["correlation_id"] == "pdf-security-test"


def test_query_document_route_masks_foreign_client_record_and_allows_owned_record(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_query_document_route_masks_foreign_client_record_and_allows_owned_record(monkeypatch))


async def _test_query_document_route_masks_foreign_client_record_and_allows_owned_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install(monkeypatch)
    user = _restricted_viewer()

    owned = await invoice_pdf._load_scoped_document(
        user,
        "invoice-a",
        (database.invoices,),
        resource_name="Invoice",
    )
    assert owned["id"] == "invoice-a"

    with pytest.raises(HTTPException) as foreign:
        await invoice_pdf._load_scoped_document(
            user,
            "invoice-b",
            (database.invoices,),
            resource_name="Invoice",
        )

    assert foreign.value.status_code == 404
    assert database.scope_denials.rows[-1]["operation"] == "commercial_document.pdf.read"


def test_query_template_preview_requires_template_action_and_global_scope(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_query_template_preview_requires_template_action_and_global_scope(monkeypatch))


async def _test_query_template_preview_requires_template_action_and_global_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install(monkeypatch)

    with pytest.raises(HTTPException) as denied:
        await templates._template_preview_query_user(_request("/api/invoice-templates/template-a/preview-pdf"), _restricted_viewer())

    assert denied.value.status_code == 403
    assert database.permission_denials.rows[-1]["permission"] == "billing.document_template.manage"

    global_action_but_client_limited = _restricted_viewer()
    global_action_but_client_limited["action_permissions"] = {"billing.document_template.manage": True}
    with pytest.raises(HTTPException) as scoped:
        await templates._template_preview_query_user(
            _request("/api/invoice-templates/template-a/preview-pdf"),
            global_action_but_client_limited,
        )

    assert scoped.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "billing.document_template.preview"


def test_selected_template_render_cannot_bypass_global_template_controls(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_selected_template_render_cannot_bypass_global_template_controls(monkeypatch))


async def _test_selected_template_render_cannot_bypass_global_template_controls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch)
    user = _restricted_viewer()

    with pytest.raises(HTTPException) as denied:
        await templates.invoice_pdf_with_template(
            "invoice-a",
            template_id="template-a",
            request=_request("/api/invoices/invoice-a/pdf-with-template"),
            user=user,
        )

    assert denied.value.status_code == 403
    assert denied.value.headers["X-Required-Permission"] == "billing.document_template.manage"


def test_pdf_compatibility_responses_disable_caching_and_referrers():
    headers = invoice_pdf._private_pdf_headers('inline; filename="invoice.pdf"')
    template_headers = templates._private_pdf_headers("inline; filename=preview.pdf")

    for response_headers in (headers, template_headers):
        assert response_headers["Cache-Control"] == "private, no-store, max-age=0"
        assert response_headers["Referrer-Policy"] == "no-referrer"
        assert response_headers["X-Content-Type-Options"] == "nosniff"
