import pytest
import asyncio
from fastapi import HTTPException
from app.routers import products


class Collection:
    def __init__(self, rows):
        self.rows = rows
        self.query = None
    async def find_one(self, query, projection):
        self.query = query
        return self.rows[0] if self.rows else None
    def find(self, query, projection):
        self.query = query
        return self
    def sort(self, *args):
        return self
    async def to_list(self, limit):
        return self.rows[:limit]


def test_projection_and_scope(monkeypatch):
    from types import SimpleNamespace
    row = {"id": "t1", "products": [{"product_id": "p1", "quantity": 2, "unit_price": 12}, {"product_id": "other", "quantity": 99}]}
    database = SimpleNamespace(products=Collection([{"id": "p1"}]), tickets=Collection([row]), purchase_orders=Collection([]), invoices=Collection([]))
    monkeypatch.setattr(products, "db", database)
    result = asyncio.run(products.get_product_related_records("p1", {"id": "u", "tenant_id": "tenant-a", "role": "admin"}))
    assert result["tickets"]["records"][0]["lines"] == [{"quantity": 2, "received_qty": None, "unit_price": 12, "total": None}]
    for collection in (database.products, database.tickets, database.purchase_orders, database.invoices):
        assert "tenant-a" in str(collection.query)
    assert not result["tickets"]["has_more"]


def test_missing_product(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(products, "db", SimpleNamespace(products=Collection([])))
    with pytest.raises(HTTPException) as error:
        asyncio.run(products.get_product_related_records("missing", {"id": "u", "tenant_id": "tenant-a", "role": "admin"}))
    assert error.value.status_code == 404
