"""Focused security regressions for catalogue pricing and kit mutations."""

from __future__ import annotations

import asyncio
from copy import deepcopy
import sys
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import products_invoices_plus
from app.services import action_permissions, activity, scope_permissions


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
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = _value(row, key)
        if isinstance(expected, dict):
            if "$exists" in expected and (actual is not _MISSING) != bool(expected["$exists"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual is not _MISSING and actual == expected["$ne"]:
                return False
            continue
        if actual is _MISSING or actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    def limit(self, _limit: int):
        return self

    async def to_list(self, limit: int):
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def count_documents(self, query: dict[str, Any]) -> int:
        return sum(1 for row in self.rows if _matches(row, query))

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

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
        for field, pushed in update.get("$push", {}).items():
            row.setdefault(field, []).append(deepcopy(pushed))
        for field, increment in update.get("$inc", {}).items():
            row[field] = row.get(field, 0) + increment
        return SimpleNamespace(
            matched_count=0 if inserted else 1,
            modified_count=1,
            upserted_id=row.get("id") if inserted else None,
        )

    async def delete_one(self, query: dict[str, Any]):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            products=_Collection(
                [{"id": "product-a", "name": "Managed Router", "retail_price": 99.0, "cost_price": 44.0}]
            ),
            product_kits=_Collection(
                [{"id": "kit-a", "name": "Router rollout", "items": [{"product_id": "product-a", "quantity": 2}]}]
            ),
            clients=_Collection([{"id": "client-a", "name": "Alpha"}, {"id": "client-b", "name": "Bravo"}]),
            tickets=_Collection(
                [
                    {"id": "ticket-a", "client_id": "client-a", "site_id": "site-a", "subject": "In-scope work"},
                    {"id": "ticket-b", "client_id": "client-b", "site_id": "site-b", "subject": "Foreign work"},
                    {
                        "id": "resolved-ticket-a",
                        "client_id": "client-a",
                        "status": "resolved",
                        "ticket_number": "TCK-SECRET",
                        "title": "Sensitive customer server recovery details",
                    },
                ]
            ),
            invoices=_Collection(
                [
                    {
                        "id": "invoice-a",
                        "invoice_number": "INV-SECRET-A",
                        "client_id": "client-a",
                        "total": 2800.0,
                        "line_items": [
                            {
                                "description": "Sensitive customer server recovery work after hours",
                                "quantity": 7,
                                "unit_price": 400.0,
                                "total": 2800.0,
                            }
                        ],
                    },
                    {
                        "id": "invoice-b",
                        "invoice_number": "INV-SECRET-B",
                        "client_id": "client-b",
                        "total": 125.0,
                        "line_items": [],
                    },
                ]
            ),
            client_price_overrides=_Collection(),
            ticket_products=_Collection(),
            activity_logs=_Collection(),
            permission_denials=_Collection(),
            scope_denials=_Collection(),
            settings=_Collection(),
        )


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(products_invoices_plus, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)
    monkeypatch.setattr(activity, "db", database)
    return database


def _admin() -> dict[str, Any]:
    return {"id": "admin-1", "name": "Billing Admin", "email": "admin@example.test", "role": "admin", "is_admin": True}


def _client_a_pricing_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Tech",
        "email": "tech-a@example.test",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "action_permissions": ["billing.catalogue.pricing.manage"],
    }


def _client_a_analytics_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Tech",
        "email": "tech-a@example.test",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "action_permissions": ["billing.analytics.view"],
    }


def _request(correlation_id: str = "corr-dispute-scan") -> SimpleNamespace:
    return SimpleNamespace(
        method="POST",
        url=SimpleNamespace(path="/api/invoices/invoice-a/dispute-scan"),
        state=SimpleNamespace(correlation_id=correlation_id),
    )


def test_catalogue_pricing_permission_is_admin_or_explicit_grant_only():
    permission = "billing.catalogue.pricing.manage"
    assert permission in action_permissions.ACTION_PERMISSION_IDS
    assert permission not in action_permissions.default_permissions_for_role("technician")
    assert permission not in action_permissions.default_permissions_for_role("service_desk_manager")


def test_global_catalogue_mutations_require_permission_global_scope_and_finite_values(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_global_catalogue_mutations_require_permission_global_scope_and_finite_values(monkeypatch))


async def _test_global_catalogue_mutations_require_permission_global_scope_and_finite_values(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)
    ungranted = {"id": "tech-none", "role": "technician", "client_scope_mode": "all"}
    with pytest.raises(HTTPException) as denied_permission:
        await products_invoices_plus.record_price_change("product-a", {"retail_price": 100}, ungranted)
    assert denied_permission.value.status_code == 403
    assert database.products.rows[0]["retail_price"] == 99.0
    assert database.permission_denials.rows[-1]["permission"] == "billing.catalogue.pricing.manage"

    with pytest.raises(HTTPException) as denied_scope:
        await products_invoices_plus.record_price_change("product-a", {"retail_price": 100}, _client_a_pricing_user())
    assert denied_scope.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "billing.catalogue.price.change"
    assert database.products.rows[0]["retail_price"] == 99.0

    with pytest.raises(HTTPException) as invalid_price:
        await products_invoices_plus.record_price_change("product-a", {"retail_price": float("nan")}, _admin())
    assert invalid_price.value.status_code == 422
    assert database.products.rows[0]["retail_price"] == 99.0

    result = await products_invoices_plus.record_price_change(
        "product-a", {"cost_price": "45.005", "retail_price": "120.005", "reason": "vendor increase"}, _admin()
    )
    assert result["entry"]["cost_price"] == 45.01
    assert result["entry"]["retail_price"] == 120.01
    assert database.products.rows[0]["price_history"][-1]["retail_price"] == 120.01
    assert database.activity_logs.rows[-1]["action"] == "catalogue_price_changed"


def test_client_price_book_is_canonically_client_scoped_and_validated(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_client_price_book_is_canonically_client_scoped_and_validated(monkeypatch))


async def _test_client_price_book_is_canonically_client_scoped_and_validated(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)
    technician = _client_a_pricing_user()
    payload = {"product_id": "product-a", "override_price": 20, "reason": "agreed price"}

    with pytest.raises(HTTPException) as foreign_write:
        await products_invoices_plus.upsert_price_book("client-b", payload, technician)
    assert foreign_write.value.status_code == 404
    assert database.client_price_overrides.rows == []

    with pytest.raises(HTTPException) as foreign_read:
        await products_invoices_plus.get_price_book("client-b", technician)
    assert foreign_read.value.status_code == 404

    result = await products_invoices_plus.upsert_price_book(
        "client-a", {"product_id": "product-a", "override_price": "19.995", "reason": "agreed price"}, technician
    )
    assert result == {"ok": True}
    override = database.client_price_overrides.rows[0]
    assert override["client_id"] == "client-a"
    assert override["override_price"] == 20.0
    assert database.activity_logs.rows[-1]["metadata"]["client_id"] == "client-a"

    with pytest.raises(HTTPException) as invalid_price:
        await products_invoices_plus.upsert_price_book(
            "client-a", {"product_id": "product-a", "override_price": float("inf")}, technician
        )
    assert invalid_price.value.status_code == 422
    assert len(database.client_price_overrides.rows) == 1


def test_kit_to_ticket_is_client_scoped_atomic_on_validation_and_audited(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_kit_to_ticket_is_client_scoped_atomic_on_validation_and_audited(monkeypatch))


async def _test_kit_to_ticket_is_client_scoped_atomic_on_validation_and_audited(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)
    technician = _client_a_pricing_user()

    with pytest.raises(HTTPException) as foreign_ticket:
        await products_invoices_plus.apply_kit_to_ticket("ticket-b", "kit-a", technician)
    assert foreign_ticket.value.status_code == 404
    assert database.ticket_products.rows == []

    with pytest.raises(HTTPException) as invalid_kit:
        await products_invoices_plus.create_kit(
            {"name": "Bad quantity", "items": [{"product_id": "product-a", "quantity": float("nan")}]}, _admin()
        )
    assert invalid_kit.value.status_code == 422
    assert len(database.product_kits.rows) == 1

    result = await products_invoices_plus.apply_kit_to_ticket("ticket-a", "kit-a", technician)
    assert result["attached_count"] == 1
    ticket_product = database.ticket_products.rows[0]
    assert ticket_product["ticket_id"] == "ticket-a"
    assert ticket_product["client_id"] == "client-a"
    assert ticket_product["quantity"] == 2
    assert ticket_product["total"] == 198.0
    assert database.activity_logs.rows[-1]["action"] == "ticket_product_kit_applied"


def test_dispute_scan_requires_billing_analytics_permission_and_masks_foreign_invoice(monkeypatch: pytest.MonkeyPatch):
    assert "billing.analytics.view" in action_permissions.ACTION_PERMISSION_IDS
    assert "billing.analytics.view" not in action_permissions.default_permissions_for_role("technician")
    asyncio.run(_test_dispute_scan_requires_billing_analytics_permission_and_masks_foreign_invoice(monkeypatch))


async def _test_dispute_scan_requires_billing_analytics_permission_and_masks_foreign_invoice(
    monkeypatch: pytest.MonkeyPatch,
):
    database = _install_database(monkeypatch)
    ungranted = {
        "id": "tech-none",
        "name": "No Finance Permission",
        "role": "technician",
        "client_scope_mode": "all",
    }
    with pytest.raises(HTTPException) as denied_permission:
        await products_invoices_plus.dispute_scan("invoice-a", _request(), ungranted)
    assert denied_permission.value.status_code == 403
    assert database.permission_denials.rows[-1]["permission"] == "billing.analytics.view"

    with pytest.raises(HTTPException) as denied_foreign_invoice:
        await products_invoices_plus.dispute_scan("invoice-b", _request("corr-foreign-scan"), _client_a_analytics_user())
    assert denied_foreign_invoice.value.status_code == 404
    assert database.activity_logs.rows == []
    assert database.scope_denials.rows[-1]["correlation_id"] == "corr-foreign-scan"


def test_dispute_scan_minimises_ai_context_and_audits_client_correlation(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_dispute_scan_minimises_ai_context_and_audits_client_correlation(monkeypatch))


async def _test_dispute_scan_minimises_ai_context_and_audits_client_correlation(
    monkeypatch: pytest.MonkeyPatch,
):
    database = _install_database(monkeypatch)
    captured: dict[str, Any] = {}

    class _FakeChat:
        def __init__(self, **kwargs: Any):
            captured["system_message"] = kwargs["system_message"]

        def with_model(self, _provider: str, _model: str):
            return self

        async def send_message(self, message: Any) -> str:
            captured["prompt"] = message.text
            return '{"risks": [], "summary": "Evidence should be reviewed."}'

    class _FakeUserMessage:
        def __init__(self, text: str):
            self.text = text

    provider = ModuleType("app.services.ai_provider")
    provider.LlmChat = _FakeChat
    provider.UserMessage = _FakeUserMessage
    monkeypatch.setitem(sys.modules, "app.services.ai_provider", provider)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    result = await products_invoices_plus.dispute_scan(
        "invoice-a", _request("corr-ai-scan"), _client_a_analytics_user()
    )

    assert result["model"] == "gpt-5.6-terra"
    prompt = captured["prompt"]
    assert "invoice_total_band=high" in prompt
    assert "value_band=high" in prompt
    assert "Sensitive customer" not in prompt
    assert "TCK-SECRET" not in prompt
    assert "INV-SECRET-A" not in prompt
    assert "2800" not in prompt

    audit = database.activity_logs.rows[-1]
    assert audit["action"] == "invoice_dispute_scan_completed"
    assert audit["metadata"] == {
        "client_id": "client-a",
        "correlation_id": "corr-ai-scan",
        "outcome": "ai_completed",
        "ai_used": True,
        "line_count": 1,
        "resolved_ticket_count": 1,
    }
    assert "prompt" not in audit["metadata"]


def test_dispute_scan_preserves_heuristic_fallback_without_ai_key(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_dispute_scan_preserves_heuristic_fallback_without_ai_key(monkeypatch))


async def _test_dispute_scan_preserves_heuristic_fallback_without_ai_key(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = await products_invoices_plus.dispute_scan(
        "invoice-a", _request("corr-heuristic-scan"), _client_a_analytics_user()
    )

    assert result["model"] == "heuristic-only"
    assert isinstance(result["flags"], list)
    assert database.activity_logs.rows[-1]["metadata"] == {
        "client_id": "client-a",
        "correlation_id": "corr-heuristic-scan",
        "outcome": "heuristic_only",
        "ai_used": False,
        "line_count": 1,
        "resolved_ticket_count": 1,
    }
