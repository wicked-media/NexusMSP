"""Regression coverage for the November 2026 billing integrity closures."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routers import (
    billing_pro,
    invoice_enhanced,
    purchase_orders,
    recurring_invoices,
    usage_billing,
)
from app.services import scope_permissions


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
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            if "$gte" in expected and not (actual is not None and actual >= expected["$gte"]):
                return False
            if "$lte" in expected and not (actual is not None and actual <= expected["$lte"]):
                return False
            if "$gt" in expected and not (actual is not None and actual > expected["$gt"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + value
            for field, value in update.get("$push", {}).items():
                row.setdefault(field, []).append(deepcopy(value))
            return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if _kwargs.get("upsert"):
            row = {key: value for key, value in query.items() if not isinstance(value, dict)}
            row.update(deepcopy(update.get("$set", {})))
            self.rows.append(row)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id="upserted")
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)


def _user(restricted: bool = False) -> dict[str, Any]:
    if restricted:
        return {
            "id": "tech-a",
            "name": "Client A Technician",
            "role": "technician",
            "client_scope_mode": "restricted",
            "client_scope_ids": ["client-a"],
        }
    return {
        "id": "admin-1",
        "name": "Administrator",
        "role": "admin",
        "is_admin": True,
        "client_scope_mode": "all",
    }


def _install(monkeypatch: pytest.MonkeyPatch, **collections: Any) -> SimpleNamespace:
    database = SimpleNamespace(
        scope_denials=_Collection(),
        activity_logs=_Collection(),
        po_audit_log=_Collection(),
        notifications=_Collection(),
        settings=_Collection(),
        **collections,
    )
    monkeypatch.setattr(scope_permissions, "db", database)
    return database


def test_usage_overview_is_scoped_and_does_not_seed(monkeypatch: pytest.MonkeyPatch):
    async def run():
        database = _install(
            monkeypatch,
            recurring_invoices=_Collection([
                {
                    "id": "ri-a",
                    "client_id": "client-a",
                    "client_name": "Client A",
                    "description": "Managed endpoints",
                    "status": "active",
                    "frequency": "monthly",
                    "subtotal": 200.0,
                    "currency": "AUD",
                    "next_generation": "2026-12-01",
                    "include_acronis_usage": True,
                    "line_items": [
                        {"description": "Support", "quantity": 1, "rate": 100, "amount": 100},
                        {"description": "Endpoints", "billing_source": "asset_count", "quantity": 2, "rate": 50, "amount": 100},
                    ],
                },
                {
                    "id": "ri-b",
                    "client_id": "client-b",
                    "client_name": "Client B",
                    "status": "active",
                    "frequency": "monthly",
                    "subtotal": 900.0,
                    "include_pax8_usage": True,
                    "next_generation": "2026-12-01",
                },
            ]),
            assets=_Collection([
                {"id": "asset-a1", "client_id": "client-a", "status": "active"},
                {"id": "asset-a2", "client_id": "client-a", "status": "active"},
                {"id": "asset-b1", "client_id": "client-b", "status": "active"},
            ]),
        )
        monkeypatch.setattr(usage_billing, "db", database)
        result = await usage_billing.billing_overview(current_user=_user(restricted=True))
        assert [plan["id"] for plan in result["plans"]] == ["ri-a"]
        assert result["plans"][0]["device_count"] == 2
        assert result["plans"][0]["user_count"] is None
        assert result["plans"][0]["storage_gb"] is None
        assert result["plans"][0]["current_mrr"] == 200.0
        assert result["summary"]["total_mrr"] == 200.0
        assert result["summary"]["avg_per_device"] == 100.0

        database.recurring_invoices.rows = []
        empty = await usage_billing.billing_overview(current_user=_user(restricted=True))
        assert empty["plans"] == []
        assert not hasattr(database, "usage_billing")

    asyncio.run(run())


def test_provider_usage_fails_closed(monkeypatch: pytest.MonkeyPatch):
    async def run():
        from app.routers import acronis

        recurring = {"client_id": "client-a", "include_acronis_usage": True}

        monkeypatch.setattr(
            acronis,
            "get_client_acronis_billing",
            AsyncMock(return_value={"linked": False}),
        )
        with pytest.raises(HTTPException) as unlinked:
            await recurring_invoices._resolve_acronis_usage_lines(recurring, _user())
        assert unlinked.value.status_code == 409

        monkeypatch.setattr(
            acronis,
            "get_client_acronis_billing",
            AsyncMock(return_value={"linked": True, "error": "timeout", "total": 0, "line_items": []}),
        )
        with pytest.raises(HTTPException) as failed:
            await recurring_invoices._resolve_acronis_usage_lines(recurring, _user())
        assert failed.value.status_code == 503

        monkeypatch.setattr(
            acronis,
            "get_client_acronis_billing",
            AsyncMock(return_value={"linked": True, "total": 0, "line_items": []}),
        )
        with pytest.raises(HTTPException) as unpriced:
            await recurring_invoices._resolve_acronis_usage_lines(recurring, _user())
        assert unpriced.value.status_code == 409

        monkeypatch.setattr(
            acronis,
            "get_client_acronis_billing",
            AsyncMock(return_value={
                "linked": True,
                "period": "2026-11",
                "currency": "AUD",
                "total": 25.0,
                "line_items": [{"label": "Backup", "quantity": 5, "unit": "GB", "unit_price": 5.0, "total": 25.0}],
            }),
        )
        lines = await recurring_invoices._resolve_acronis_usage_lines(recurring, _user())
        assert lines[0]["acronis_auto"] is True
        assert lines[0]["amount"] == 25.0

    asyncio.run(run())


def test_proration_apply_creates_one_document_and_is_idempotent(monkeypatch: pytest.MonkeyPatch):
    async def run():
        database = _install(
            monkeypatch,
            recurring_invoices=_Collection([
                {
                    "id": "ri-a",
                    "client_id": "client-a",
                    "client_name": "Client A",
                    "description": "Managed services",
                    "status": "active",
                    "frequency": "monthly",
                    "next_generation": "2026-12-01",
                    "tax_rate": 10.0,
                    "payment_terms": "net_30",
                    "currency": "AUD",
                    "version": 1,
                }
            ]),
            invoices=_Collection(),
            credit_notes=_Collection(),
            billing_proration_adjustments=_Collection(),
        )
        monkeypatch.setattr(billing_pro, "db", database)
        monkeypatch.setattr(billing_pro, "log_activity", AsyncMock())

        payload = {
            "quantity_delta": 1,
            "unit_price": 100,
            "description": "Extra endpoint",
            "effective_date": "2026-11-16",
            "idempotency_key": "change-1",
        }
        first = await billing_pro.apply_proration("ri-a", payload, request=None, current_user=_user())
        assert first["replayed"] is False
        assert first["adjustment"]["direction"] == "charge"
        assert first["adjustment"]["prorated_amount"] == 50.0
        assert first["document"]["total"] == 55.0
        assert first["document"]["source"] == "proration_adjustment"
        assert first["document"]["client_id"] == "client-a"
        assert len(database.invoices.rows) == 1

        replay = await billing_pro.apply_proration("ri-a", payload, request=None, current_user=_user())
        assert replay["replayed"] is True
        assert len(database.invoices.rows) == 1
        assert len(database.billing_proration_adjustments.rows) == 1

        credit = await billing_pro.apply_proration(
            "ri-a",
            {**payload, "quantity_delta": -1, "idempotency_key": "change-2"},
            request=None,
            current_user=_user(),
        )
        assert credit["adjustment"]["direction"] == "credit"
        assert credit["adjustment"]["total"] == -55.0
        assert credit["document"]["total"] == 55.0
        assert credit["document"]["status"] == "issued"
        assert len(database.credit_notes.rows) == 1
        assert len(database.invoices.rows) == 1

    asyncio.run(run())


def test_legacy_reminder_routes_use_the_single_programme(monkeypatch: pytest.MonkeyPatch):
    async def run():
        database = _install(monkeypatch)
        monkeypatch.setattr(invoice_enhanced, "db", database)
        monkeypatch.setattr(invoice_enhanced, "log_activity", AsyncMock())

        canonical = {
            "enabled": True,
            "stages": [
                {"id": "b7", "kind": "before_due", "days": 7, "enabled": True, "tone": "friendly", "subject": "Soon", "message": "Due {due_date}"},
                {"id": "due", "kind": "due_date", "days": 0, "enabled": True, "tone": "professional", "subject": "Due", "message": "Due today"},
            ],
            "min_balance": 0,
            "weekday_only": True,
        }
        monkeypatch.setattr(invoice_enhanced, "load_reminder_settings", AsyncMock(return_value=canonical))
        settings = await invoice_enhanced.get_reminder_settings(current_user=_user(), request=None)
        assert settings["authoritative_type"] == "invoice_reminders"
        assert settings["before_due_days"] == [7]
        assert settings["include_due_date"] is True

        await invoice_enhanced.update_reminder_settings(
            {
                "enabled": True,
                "before_due_days": [5, 1],
                "after_due_days": [3],
                "include_due_date": True,
            },
            current_user=_user(),
            request=None,
        )
        stored = database.settings.rows[0]
        assert stored["type"] == "invoice_reminders"
        assert [stage["days"] for stage in stored["stages"] if stage["kind"] == "before_due"] == [1, 5]
        assert not any(row.get("type") == "payment_reminders" for row in database.settings.rows)

        runner = AsyncMock(return_value={"sent": 2, "skipped": 0, "failed": 0, "message": "ok"})
        monkeypatch.setattr(invoice_enhanced, "run_due_reminders", runner)
        result = await invoice_enhanced.send_payment_reminders(current_user=_user(), request=None)
        assert result["sent"] == 2
        runner.assert_awaited_once_with(_user(), force=True)

    asyncio.run(run())


def test_supplier_line_matching_detects_offsetting_line_variance(monkeypatch: pytest.MonkeyPatch):
    async def run():
        po = {
            "id": "po-1",
            "po_number": "PO-1",
            "client_id": "client-a",
            "vendor": "Vendor",
            "vendor_id": "vendor-1",
            "status": "submitted",
            "line_items": [
                {
                    "product_id": "product-1",
                    "product_name": "Widget",
                    "quantity": 2,
                    "unit_price": 50.0,
                    "tax_rate": 10.0,
                    "total": 100.0,
                }
            ],
            "subtotal": 100.0,
            "tax": 10.0,
            "shipping": 5.0,
            "total": 115.0,
        }
        database = _install(monkeypatch, purchase_orders=_Collection([po]))
        monkeypatch.setattr(purchase_orders, "db", database)

        result = await purchase_orders.record_vendor_invoice_match(
            "po-1",
            {
                "invoice_number": "SUP-1",
                "supplier_total": 115.0,
                "shipping": 5.0,
                "line_items": [
                    {"line_index": 0, "quantity": 1, "unit_price": 100.0, "tax_rate": 10.0}
                ],
            },
            current_user=_user(),
        )
        match = result["vendor_invoice_match"]
        assert match["status"] == "variance"
        assert match["variance"] == 0
        assert match["line_variance_count"] == 1
        assert match["line_items"][0]["quantity_variance"] == -1

        with pytest.raises(HTTPException) as mismatch:
            await purchase_orders.record_vendor_invoice_match(
                "po-1",
                {
                    "invoice_number": "SUP-2",
                    "supplier_total": 115.0,
                    "shipping": 5.0,
                    "line_items": [
                        {"line_index": 0, "quantity": 2, "unit_price": 50.0, "tax_rate": 0.0}
                    ],
                },
                current_user=_user(),
            )
        assert mismatch.value.status_code == 422

    asyncio.run(run())


def test_mrr_analytics_uses_persisted_movements(monkeypatch: pytest.MonkeyPatch):
    async def run():
        database = _install(
            monkeypatch,
            recurring_invoices=_Collection([
                {
                    "id": "ri-a",
                    "client_id": "client-a",
                    "description": "New managed",
                    "status": "active",
                    "frequency": "monthly",
                    "subtotal": 100.0,
                    "start_date": "2026-10-01",
                    "created_at": "2026-10-01T00:00:00+00:00",
                },
                {
                    "id": "ri-b",
                    "client_id": "client-b",
                    "description": "Quarterly support",
                    "status": "active",
                    "frequency": "quarterly",
                    "subtotal": 50.0,
                    "start_date": "2025-01-01",
                    "created_at": "2025-01-01T00:00:00+00:00",
                },
                {
                    "id": "ri-c",
                    "client_id": "client-c",
                    "description": "Churned",
                    "status": "cancelled",
                    "frequency": "monthly",
                    "subtotal": 30.0,
                    "start_date": "2025-01-01",
                    "created_at": "2025-01-01T00:00:00+00:00",
                    "cancelled_at": "2026-11-05T00:00:00+00:00",
                },
            ]),
            recurring_indexation_log=_Collection([
                {"id": "idx-1", "ri_id": "ri-a", "delta": 20.0, "applied_at": "2026-11-10T00:00:00+00:00"}
            ]),
        )
        monkeypatch.setattr(billing_pro, "db", database)
        result = await billing_pro.mrr_analytics(request=None, current_user=_user())
        assert result["current_mrr"] == 116.67
        assert result["active_count"] == 2
        assert result["churn_this_month"] == 30.0
        assert result["expansion_mrr"] == 20.0
        assert result["contraction_mrr"] == 0.0
        assert result["by_month"][-1]["mrr"] == 116.67
        assert result["by_month"][-1]["net_new_mrr"] == -10.0
        assert result["movement_source"] == "recurring_invoices+recurring_indexation_log"

    asyncio.run(run())
