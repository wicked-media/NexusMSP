"""Focused regressions for opaque, object-bound browser PDF capabilities."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from app import auth
from app.routers import invoice_pdf
from app.services import action_permissions, scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$gt" in expected and not (actual is not None and actual > expected["$gt"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
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

    async def update_one(self, query: dict[str, Any], update: dict[str, Any]):
        for row in self.rows:
            if not _matches(row, query):
                continue
            for key, value in update.get("$set", {}).items():
                row[key] = deepcopy(value)
            for key, value in update.get("$inc", {}).items():
                row[key] = row.get(key, 0) + value
            return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)

    async def create_index(self, keys: Any, **kwargs: Any):
        indexes = getattr(self, "indexes", [])
        indexes.append((keys, kwargs))
        self.indexes = indexes
        return kwargs.get("name") or "index"


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            users=_Collection(
                [
                    {
                        "id": "actor-a",
                        "name": "Billing manager",
                        "email": "manager@example.test",
                        "role": "service_desk_manager",
                        "tenant_id": "tenant-a",
                        "client_scope_mode": "all",
                    }
                ]
            ),
            invoices=_Collection(
                [
                    {"id": "invoice-a", "invoice_number": "INV-A", "client_id": "client-a", "tenant_id": "tenant-a"},
                    {"id": "invoice-b", "invoice_number": "INV-B", "client_id": "client-b", "tenant_id": "tenant-a"},
                ]
            ),
            xero_invoices=_Collection(),
            estimates=_Collection(),
            xero_estimates=_Collection(),
            contracts=_Collection(),
            purchase_orders=_Collection(),
            document_pdf_capabilities=_Collection(),
            settings=_Collection(),
            permission_denials=_Collection(),
            scope_denials=_Collection(),
            activity_logs=_Collection(),
        )


def _request(path: str = "/api/invoices/invoice-a/pdf") -> SimpleNamespace:
    return SimpleNamespace(
        method="GET",
        url=SimpleNamespace(path=path),
        state=SimpleNamespace(correlation_id="pdf-capability-test"),
    )


def _actor() -> dict[str, Any]:
    return {
        "id": "actor-a",
        "name": "Billing manager",
        "email": "manager@example.test",
        "role": "service_desk_manager",
        "tenant_id": "tenant-a",
        "client_scope_mode": "all",
    }


def _install(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(auth, "db", database)
    monkeypatch.setattr(invoice_pdf, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _audit(*args, **kwargs):
        await database.activity_logs.insert_one(
            {
                "action": args[1],
                "entity_id": args[3],
                "metadata": deepcopy(kwargs.get("metadata") or {}),
            }
        )

    monkeypatch.setattr(invoice_pdf, "log_activity", _audit)
    return database


async def _issue(database: _Database) -> tuple[dict[str, Any], str]:
    result = await invoice_pdf._issue_document_pdf_capability(
        _request(),
        invoice_pdf.DocumentPdfCapabilityRequest(document_type="invoice", document_id="invoice-a"),
        _actor(),
    )
    capability = parse_qs(urlparse(result["pdf_path"]).query)["capability"][0]
    return result, capability


def test_opaque_capability_is_hash_stored_and_bound_to_one_document(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_opaque_capability_is_hash_stored_and_bound_to_one_document(monkeypatch))


async def _test_opaque_capability_is_hash_stored_and_bound_to_one_document(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    result, capability = await _issue(database)

    assert result["pdf_path"].startswith("/api/invoices/invoice-a/pdf?capability=pdfc_")
    assert capability.startswith("pdfc_")
    assert "." not in capability  # It is not a JWT or a full session credential.
    stored = database.document_pdf_capabilities.rows[0]
    assert stored["token_hash"] == invoice_pdf._capability_hash(capability)
    assert capability not in str(stored)
    assert stored["document_id"] == "invoice-a"
    assert stored["source_collection"] == "invoices"
    assert stored["tenant_id"] == "tenant-a"
    assert stored["client_id"] == "client-a"
    assert stored["actor_id"] == "actor-a"
    assert stored["delivery"] == "preview"
    assert stored["expiry_at"].tzinfo is not None
    assert capability not in str(database.activity_logs.rows[0])


def test_capability_indexes_cover_hash_lookup_and_expiry_retention(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_capability_indexes_cover_hash_lookup_and_expiry_retention(monkeypatch))


async def _test_capability_indexes_cover_hash_lookup_and_expiry_retention(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    await invoice_pdf.ensure_document_pdf_capability_indexes()
    index_names = {options.get("name") for _keys, options in database.document_pdf_capabilities.indexes}
    assert {
        "unique_document_pdf_capability_hash",
        "document_pdf_capability_expiry_ttl",
        "document_pdf_capability_actor_expiry",
    } <= index_names


def test_capability_cannot_be_retargeted_or_escalated_to_download(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_capability_cannot_be_retargeted_or_escalated_to_download(monkeypatch))


async def _test_capability_cannot_be_retargeted_or_escalated_to_download(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    _result, capability = await _issue(database)
    access = await invoice_pdf._get_financial_document_pdf_access(
        _request(), token=None, capability=capability
    )

    with pytest.raises(HTTPException) as foreign_target:
        await invoice_pdf._load_financial_pdf_document(
            access,
            "invoice",
            "invoice-b",
            resource_name="Invoice",
            delivery="preview",
        )
    assert foreign_target.value.status_code == 404

    with pytest.raises(HTTPException) as delivery_escalation:
        await invoice_pdf._load_financial_pdf_document(
            access,
            "invoice",
            "invoice-a",
            resource_name="Invoice",
            delivery="download",
        )
    assert delivery_escalation.value.status_code == 404


def test_capability_rechecks_actor_tenant_and_current_client_scope(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_capability_rechecks_actor_tenant_and_current_client_scope(monkeypatch))


async def _test_capability_rechecks_actor_tenant_and_current_client_scope(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    _result, capability = await _issue(database)

    database.users.rows[0].update({"client_scope_mode": "restricted", "client_scope_ids": ["client-b"]})
    access = await invoice_pdf._get_financial_document_pdf_access(
        _request(), token=None, capability=capability
    )
    with pytest.raises(HTTPException) as out_of_scope:
        await invoice_pdf._load_financial_pdf_document(
            access,
            "invoice",
            "invoice-a",
            resource_name="Invoice",
            delivery="preview",
        )
    assert out_of_scope.value.status_code == 404

    database.users.rows[0].update({"client_scope_mode": "all", "tenant_id": "tenant-b"})
    with pytest.raises(HTTPException) as wrong_tenant:
        await invoice_pdf._get_financial_document_pdf_access(
            _request(), token=None, capability=capability
        )
    assert wrong_tenant.value.status_code == 404


def test_capability_keeps_legacy_client_scoping_when_actor_has_no_explicit_tenant(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_capability_keeps_legacy_client_scoping_when_actor_has_no_explicit_tenant(monkeypatch))


async def _test_capability_keeps_legacy_client_scoping_when_actor_has_no_explicit_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install(monkeypatch)
    legacy_actor = _actor()
    legacy_actor.pop("tenant_id")
    database.users.rows[0].pop("tenant_id")
    result = await invoice_pdf._issue_document_pdf_capability(
        _request(),
        invoice_pdf.DocumentPdfCapabilityRequest(document_type="invoice", document_id="invoice-a"),
        legacy_actor,
    )
    capability = parse_qs(urlparse(result["pdf_path"]).query)["capability"][0]

    access = await invoice_pdf._get_financial_document_pdf_access(
        _request(), token=None, capability=capability
    )
    _user, document = await invoice_pdf._load_financial_pdf_document(
        access,
        "invoice",
        "invoice-a",
        resource_name="Invoice",
        delivery="preview",
    )
    assert document["client_id"] == "client-a"


def test_capability_rejects_expired_or_inactive_actor_and_records_valid_use(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_capability_rejects_expired_or_inactive_actor_and_records_valid_use(monkeypatch))


async def _test_capability_rejects_expired_or_inactive_actor_and_records_valid_use(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    _result, capability = await _issue(database)
    access = await invoice_pdf._get_financial_document_pdf_access(
        _request(), token=None, capability=capability
    )
    _user, document = await invoice_pdf._load_financial_pdf_document(
        access,
        "invoice",
        "invoice-a",
        resource_name="Invoice",
        delivery="preview",
    )
    assert document["id"] == "invoice-a"
    assert database.document_pdf_capabilities.rows[0]["use_count"] == 1
    assert database.document_pdf_capabilities.rows[0]["last_used_at"]

    database.document_pdf_capabilities.rows[0]["expires_at"] = "2000-01-01T00:00:00+00:00"
    with pytest.raises(HTTPException) as expired:
        await invoice_pdf._get_financial_document_pdf_access(
            _request(), token=None, capability=capability
        )
    assert expired.value.status_code == 404

    database.document_pdf_capabilities.rows[0]["expires_at"] = "2999-01-01T00:00:00+00:00"
    database.users.rows[0]["status"] = "suspended"
    with pytest.raises(HTTPException) as inactive:
        await invoice_pdf._get_financial_document_pdf_access(
            _request(), token=None, capability=capability
        )
    assert inactive.value.status_code == 404

    database.users.rows[0].pop("status")
    database.document_pdf_capabilities.rows[0]["revoked_at"] = "2026-08-24T00:00:00+00:00"
    with pytest.raises(HTTPException) as revoked:
        await invoice_pdf._get_financial_document_pdf_access(
            _request(), token=None, capability=capability
        )
    assert revoked.value.status_code == 404
