"""Focused safety coverage for legacy Billing Pro operational routes.

The warehouse, inventory, purchase-order and global catalogue records predate
client ownership in Billing Pro.  They remain organisation-global rather than
being incorrectly reclassified as client records, so a client-restricted
technician must fail closed while an administrator can complete a versioned
stock/PO workflow.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import billing_pro
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
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any) -> "_Cursor":
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
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query: dict[str, Any]):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            warehouses=_Collection(
                [
                    {"id": "warehouse-a", "name": "Main", "is_default": True, "version": 1},
                    {"id": "warehouse-b", "name": "Bench", "is_default": False, "version": 1},
                ]
            ),
            products=_Collection(
                [
                    {
                        "id": "product-router",
                        "name": "Managed Router",
                        "sku": "RTR-1",
                        "vendor": "Example Vendor",
                        "quantity_in_stock": 5,
                        "reorder_level": 3,
                        "cost_price": 40.0,
                        "retail_price": 90.0,
                        "stock_by_location": {"warehouse-a": 5, "warehouse-b": 0},
                        "version": 1,
                    }
                ]
            ),
            purchase_orders=_Collection(
                [
                    {
                        "id": "po-sent",
                        "po_number": "PO-100",
                        "status": "sent",
                        "version": 1,
                        "items": [{"product_id": "product-router", "quantity": 2}],
                    }
                ]
            ),
            stock_transfers=_Collection(),
            product_stock_movements=_Collection(),
            settings=_Collection(),
            invoice_pdf_templates=_Collection(),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
        )


def _restricted_client_a_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _admin() -> dict[str, Any]:
    return {"id": "admin-1", "name": "Billing administrator", "role": "admin"}


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(billing_pro, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def _record_activity(*args: Any, **kwargs: Any) -> None:
        await database.activity_logs.insert_one(
            {
                "action": args[1],
                "entity_type": args[2],
                "entity_id": args[3],
                "metadata": kwargs.get("metadata") or {},
            }
        )

    monkeypatch.setattr(billing_pro, "log_activity", _record_activity)
    return database


def test_restricted_client_scope_cannot_read_or_mutate_global_catalogue_operations(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_restricted_client_scope_cannot_read_or_mutate_global_catalogue_operations(monkeypatch))


async def _test_restricted_client_scope_cannot_read_or_mutate_global_catalogue_operations(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)
    user = _restricted_client_a_user()

    with pytest.raises(HTTPException) as transfer_denied:
        await billing_pro.transfer_stock(
            "product-router",
            {"from_id": "warehouse-a", "to_id": "warehouse-b", "qty": 2},
            request=None,
            current_user=user,
        )
    assert transfer_denied.value.status_code == 403
    assert database.products.rows[0]["stock_by_location"] == {"warehouse-a": 5, "warehouse-b": 0}

    with pytest.raises(HTTPException) as po_denied:
        await billing_pro.create_po_from_low_stock(
            "product-router", {"qty": 2}, request=None, current_user=user
        )
    assert po_denied.value.status_code == 403
    assert len(database.purchase_orders.rows) == 1

    with pytest.raises(HTTPException) as list_denied:
        await billing_pro.list_pos(request=None, current_user=user)
    assert list_denied.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "billing.purchase_order.list"


def test_global_catalogue_stock_and_purchase_receipt_are_versioned_and_idempotent(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_global_catalogue_stock_and_purchase_receipt_are_versioned_and_idempotent(monkeypatch))


async def _test_global_catalogue_stock_and_purchase_receipt_are_versioned_and_idempotent(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)
    admin = _admin()

    transfer = await billing_pro.transfer_stock(
        "product-router",
        {"from_id": "warehouse-a", "to_id": "warehouse-b", "qty": 2, "note": "Bench allocation"},
        request=None,
        current_user=admin,
    )
    assert transfer["stock_by_location"] == {"warehouse-a": 3, "warehouse-b": 2}
    assert database.products.rows[0]["version"] == 2
    assert database.stock_transfers.rows[0]["qty"] == 2

    created = await billing_pro.create_po_from_low_stock(
        "product-router", {"qty": 4}, request=None, current_user=admin
    )
    assert created["status"] == "draft"
    assert created["version"] == 1
    assert len(database.purchase_orders.rows) == 2

    received = await billing_pro.update_po_status(
        "po-sent", {"status": "received"}, request=None, current_user=admin
    )
    assert received == {"message": "PO marked received"}
    assert database.purchase_orders.rows[0]["status"] == "received"
    assert database.purchase_orders.rows[0]["version"] == 3
    assert database.products.rows[0]["quantity_in_stock"] == 7
    assert database.products.rows[0]["version"] == 3
    assert database.product_stock_movements.rows[0]["quantity"] == 2

    database.purchase_orders.rows.append(
        {"id": "po-draft", "po_number": "PO-101", "status": "draft", "version": 1}
    )
    sent = await billing_pro.update_po_status(
        "po-draft", {"status": "sent"}, request=None, current_user=admin
    )
    assert sent == {"message": "PO marked sent"}
    draft_po = next(po for po in database.purchase_orders.rows if po["id"] == "po-draft")
    assert draft_po["document_snapshot"]["document_type"] == "purchase_order"

    repeat = await billing_pro.update_po_status(
        "po-sent", {"status": "received"}, request=None, current_user=admin
    )
    assert repeat["idempotent"] is True
    assert database.products.rows[0]["quantity_in_stock"] == 7

    tiers = await billing_pro.set_tier_pricing(
        "product-router",
        {"tiers": [{"min_qty": 1, "unit_price": 90}, {"min_qty": 10, "unit_price": 80}]},
        request=None,
        current_user=admin,
    )
    assert tiers["tiers"][-1] == {"min_qty": 10, "unit_price": 80.0}
    assert database.products.rows[0]["version"] == 4
    assert database.activity_logs.rows[-1]["action"] == "pricing_tiers_updated"
