"""Regression coverage for legacy name-only purchase-order receiving payloads."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

from app.routers import purchase_orders


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, expected in query.items():
        if isinstance(expected, dict):
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            continue
        if row.get(key) != expected:
            return False
    return True


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + value
            for field, value in update.get("$push", {}).items():
                row.setdefault(field, []).append(deepcopy(value))
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            purchase_orders=_Collection(
                [{
                    "id": "po-1",
                    "po_number": "PO-001",
                    "client_id": "client-a",
                    "status": "submitted",
                    "version": 1,
                    "line_items": [{
                        "product_id": "product-1",
                        "product_name": "Managed router",
                        "quantity": 2,
                        "received_qty": 0,
                        "destination_type": "stock",
                    }],
                }]
            ),
            products=_Collection([{"id": "product-1", "name": "Managed router", "track_inventory": True, "quantity_in_stock": 3}]),
            stock_movements=_Collection(),
        )


def test_name_only_receipt_preserves_the_authoritative_product_id(monkeypatch):
    asyncio.run(_test_name_only_receipt_preserves_the_authoritative_product_id(monkeypatch))


async def _test_name_only_receipt_preserves_the_authoritative_product_id(monkeypatch):
    database = _Database()
    monkeypatch.setattr(purchase_orders, "db", database)
    monkeypatch.setattr(purchase_orders, "_log_po_audit", lambda *_args, **_kwargs: _async_value(None))

    response = await purchase_orders.receive_po_items(
        "po-1",
        {"items": [{"product_name": "Managed router", "quantity": 2}]},
        current_user={"id": "admin-1", "name": "Operations Admin", "role": "admin"},
    )

    assert response["status"] == "received"
    assert response["receipt_event"]["items"][0]["product_id"] == "product-1"
    assert database.products.rows[0]["quantity_in_stock"] == 5
    assert database.stock_movements.rows[0]["product_id"] == "product-1"


async def _async_value(value):
    return value
