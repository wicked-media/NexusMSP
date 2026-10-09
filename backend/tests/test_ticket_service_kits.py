"""Unit coverage for the parent-ticket Service Kit boundary."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import ticket_service_kits as service_kits


def _matches(row, query):
    for field, expected in query.items():
        actual = row.get(field)
        if isinstance(expected, dict) and "$exists" in expected:
            if (field in row) != bool(expected["$exists"]):
                return False
        elif actual != expected:
            return False
    return True


class _Rows:
    def __init__(self, rows=()):
        self.rows = [deepcopy(row) for row in rows]

    async def find_one(self, query, *_args, **_kwargs):
        found = next((row for row in self.rows if _matches(row, query)), None)
        return deepcopy(found) if found else None

    async def insert_one(self, record):
        self.rows.append(deepcopy(record))
        return SimpleNamespace(inserted_id=record.get("id"))

    async def update_one(self, query, update, *_args, **_kwargs):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query, *_args, **_kwargs):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


def _database(ticket=None):
    ticket = ticket or {
        "id": "ticket-1",
        "ticket_number": "INC-1042",
        "client_id": "client-1",
        "client_name": "Acme Pty Ltd",
        "contact_email": "owner@acme.example",
        "title": "Laptop keeps restarting",
        "description": "Laptop reboots after ten minutes.",
        "priority": "high",
        "assigned_to": "tech-1",
        "assigned_name": "Alex Tech",
        "device_id": "device-1",
    }
    return SimpleNamespace(
        tickets=_Rows([ticket]),
        clients=_Rows([{"id": "client-1", "name": "Acme Pty Ltd", "address": "100 Example Road", "email": "accounts@acme.example", "phone": "0400 000 000"}]),
        devices=_Rows([{"id": "device-1", "client_id": "client-1", "device_type": "laptop", "manufacturer": "Dell", "model": "Latitude 5440", "serial_number": "SER-1"}]),
        workshop_jobs=_Rows(),
        field_jobs=_Rows(),
        workshop_audit_log=_Rows(),
        field_audit_log=_Rows(),
        ticket_audit_log=_Rows(),
        activity_logs=_Rows(),
    )


async def _noop(*_args, **_kwargs):
    return None


def _user():
    return {"id": "tech-1", "name": "Alex Tech", "role": "technician"}


def test_catalog_exposes_only_curated_delivery_kits():
    catalog = service_kits.public_catalog()
    assert {kit["id"] for kit in catalog} == {"workshop_repair", "cabling_field"}
    assert all("record_collection" not in kit for kit in catalog)


def test_context_rejects_secrets_and_unrecognised_fields():
    with pytest.raises(HTTPException) as error:
        service_kits.normalise_service_kit_context("workshop_repair", {"customer_password": "not-allowed"})
    assert error.value.status_code == 422
    assert "Unsupported" in error.value.detail


def test_workshop_kit_creates_linked_work_record_and_keeps_parent_authoritative(monkeypatch):
    database = _database()
    monkeypatch.setattr(service_kits, "db", database)
    monkeypatch.setattr(service_kits, "ticket_audit", _noop)
    monkeypatch.setattr(service_kits, "log_activity", _noop)
    ticket = database.tickets.rows[0]

    result = asyncio.run(service_kits.activate_service_kit(ticket, "workshop_repair", {"device_brand": "Dell", "accessories_received": ["Charger"]}, _user()))

    assert result["idempotent"] is False
    parent = database.tickets.rows[0]
    assert parent["service_kit"]["id"] == "workshop_repair"
    assert parent["service_kit"]["work_record"]["id"] == database.workshop_jobs.rows[0]["id"]
    child = database.workshop_jobs.rows[0]
    assert child["ticket_id"] == parent["id"]
    assert child["parent_ticket_id"] == parent["id"]
    assert child["job_number"] == "INC-1042-WS"
    assert child["fault_description"] == ticket["description"]
    assert "customer_password" not in child
    assert database.workshop_audit_log.rows[0]["action"] == "created_from_service_kit"


def test_same_kit_retry_is_idempotent_and_does_not_duplicate_specialist_work(monkeypatch):
    database = _database()
    monkeypatch.setattr(service_kits, "db", database)
    monkeypatch.setattr(service_kits, "ticket_audit", _noop)
    monkeypatch.setattr(service_kits, "log_activity", _noop)

    first = asyncio.run(service_kits.activate_service_kit(database.tickets.rows[0], "workshop_repair", {}, _user()))
    second = asyncio.run(service_kits.activate_service_kit(first["ticket"], "workshop_repair", {}, _user()))

    assert first["idempotent"] is False
    assert second["idempotent"] is True
    assert len(database.workshop_jobs.rows) == 1


def test_field_kit_copies_client_address_as_a_snapshot_and_links_to_parent(monkeypatch):
    database = _database()
    monkeypatch.setattr(service_kits, "db", database)
    monkeypatch.setattr(service_kits, "ticket_audit", _noop)
    monkeypatch.setattr(service_kits, "log_activity", _noop)

    result = asyncio.run(service_kits.activate_service_kit(database.tickets.rows[0], "cabling_field", {"zone": "CBD", "job_category": "survey"}, _user()))

    field_job = database.field_jobs.rows[0]
    assert result["service_kit"]["workflow"] == "field"
    assert field_job["ticket_id"] == "ticket-1"
    assert field_job["job_number"] == "INC-1042-FIELD"
    assert field_job["service_address"] == "100 Example Road"
    assert field_job["zone"] == "CBD"
    assert field_job["job_category"] == "survey"


def test_ticket_cannot_carry_two_specialist_kits(monkeypatch):
    database = _database()
    monkeypatch.setattr(service_kits, "db", database)
    monkeypatch.setattr(service_kits, "ticket_audit", _noop)
    monkeypatch.setattr(service_kits, "log_activity", _noop)

    first = asyncio.run(service_kits.activate_service_kit(database.tickets.rows[0], "workshop_repair", {}, _user()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(service_kits.activate_service_kit(first["ticket"], "cabling_field", {}, _user()))
    assert error.value.status_code == 409
