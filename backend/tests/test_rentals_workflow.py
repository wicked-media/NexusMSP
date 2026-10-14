"""Focused regression coverage for the phone-rental lifecycle boundaries."""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import rentals


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return self.rows


class _Rentals:
    def __init__(self, record=None):
        self.record = record
        self.query = None

    def find(self, query, _projection):
        self.query = query
        return _Cursor([])

    async def find_one(self, _query, _projection=None):
        return self.record


def _admin():
    return {"id": "admin-1", "name": "Nexus Admin", "role": "admin"}


def test_rental_list_is_limited_to_the_technicians_client_scope(monkeypatch):
    collection = _Rentals()
    monkeypatch.setattr(rentals, "db", type("RentalDB", (), {"rentals": collection})())
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    assert asyncio.run(rentals.get_rentals(current_user=user)) == []
    assert collection.query == {"client_id": {"$in": ["client-a"]}}


def test_completed_rental_cannot_accept_another_payment(monkeypatch):
    agreement = {
        "id": "rental-1",
        "client_id": "client-a",
        "client_name": "Example Client",
        "status": "completed",
        "agreement_type": "rental",
    }
    monkeypatch.setattr(rentals, "db", type("RentalDB", (), {"rentals": _Rentals(agreement)})())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rentals.record_rental_payment("rental-1", {"amount": 25}, _admin()))

    assert exc.value.status_code == 409
    assert "active agreement" in exc.value.detail


def test_purchase_cannot_be_returned_through_rental_lifecycle(monkeypatch):
    agreement = {
        "id": "rental-1",
        "client_id": "client-a",
        "client_name": "Example Client",
        "status": "completed",
        "agreement_type": "buy_outright",
    }
    monkeypatch.setattr(rentals, "db", type("RentalDB", (), {"rentals": _Rentals(agreement)})())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rentals.return_rental_device("rental-1", {"condition": "good"}, _admin()))

    assert exc.value.status_code == 409
    assert "outright purchase" in exc.value.detail


@pytest.mark.parametrize("value", [0, -5, "not-a-number", float("nan"), float("inf")])
def test_payment_amount_requires_a_positive_finite_value(value):
    with pytest.raises(HTTPException) as exc:
        rentals._amount(value, "Payment amount")

    assert exc.value.status_code == 422
