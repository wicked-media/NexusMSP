"""Two-client acceptance coverage for ticket, time, and Work Session flows.

These tests exercise the actual scope service used by the routers rather than
trusting a browser-side filter.  A restricted technician must not be able to
discover or mutate Client B records while working for Client A.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

from fastapi import HTTPException

from app.models import TimeEntryCreate
from app.routers import tickets, time_entries, work_sessions
from app.services import scope_permissions


def _matches(row: dict, query: dict) -> bool:
    """Small Mongo-style matcher sufficient for the scoped acceptance paths."""
    for key, value in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in value):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in value):
                return False
            continue
        if isinstance(value, dict):
            if "$in" in value and row.get(key) not in value["$in"]:
                return False
            if "$exists" in value and (key in row) != bool(value["$exists"]):
                return False
            continue
        if row.get(key) != value:
            return False
    return True


class FakeCursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit: int):
        return deepcopy(self.rows)


class FakeCollection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict, _projection=None):
        return FakeCursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class FakeDb(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=FakeCollection(
                [
                    {
                        "id": "ticket-a",
                        "tenant_id": "tenant-a",
                        "ticket_number": "SR-1001",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "title": "Client A Outlook issue",
                    },
                    {
                        "id": "ticket-b",
                        "tenant_id": "tenant-a",
                        "ticket_number": "SR-2001",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "title": "Client B confidential issue",
                    },
                ]
            ),
            users=FakeCollection([{"id": "tech-a", "tenant_id": "tenant-a", "name": "Technician A", "hourly_rate": 140.0}]),
            time_entries=FakeCollection(
                [
                    {
                        "id": "time-a",
                        "tenant_id": "tenant-a",
                        "ticket_id": "ticket-a",
                        "client_id": "client-a",
                        "created_at": "2026-08-22T09:00:00+00:00",
                        "minutes": 10,
                    },
                    {
                        "id": "time-b",
                        "tenant_id": "tenant-a",
                        "ticket_id": "ticket-b",
                        "client_id": "client-b",
                        "created_at": "2026-08-22T09:01:00+00:00",
                        "minutes": 20,
                    },
                ]
            ),
            nexus_work_sessions=FakeCollection(
                [
                    {
                        "id": "work-b",
                        "ticket_id": "ticket-b",
                        "client_id": "client-b",
                        "status": "active",
                    }
                ]
            ),
            scope_denials=FakeCollection(),
        )


def _restricted_client_a_technician() -> dict:
    return {
        "id": "tech-a",
        "tenant_id": "tenant-a",
        "name": "Technician A",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_database(monkeypatch, database: FakeDb):
    """Point the route modules and the shared scope service at the same fake DB."""
    monkeypatch.setattr(time_entries, "db", database)
    monkeypatch.setattr(tickets, "db", database)
    monkeypatch.setattr(work_sessions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)


async def _assert_masked_denial(operation, database: FakeDb, expected_operation: str):
    try:
        await operation
    except HTTPException as exc:
        assert exc.status_code == 404
        assert exc.detail == "Resource not found" or exc.detail == "Ticket not found"
    else:
        raise AssertionError("A Client A technician must not access a Client B record")

    assert database.scope_denials.rows[-1]["client_id"] == "client-b"
    assert database.scope_denials.rows[-1]["operation"] == expected_operation


def test_restricted_technician_cannot_discover_client_b_time_entries(monkeypatch):
    asyncio.run(_test_restricted_technician_cannot_discover_client_b_time_entries(monkeypatch))


async def _test_restricted_technician_cannot_discover_client_b_time_entries(monkeypatch):
    database = FakeDb()
    _install_database(monkeypatch, database)
    technician = _restricted_client_a_technician()

    visible = await time_entries.get_time_entries(current_user=technician)
    targeted = await time_entries.get_time_entries(ticket_id="ticket-b", current_user=technician)

    assert [entry["id"] for entry in visible] == ["time-a"]
    assert targeted == []


def test_restricted_technician_cannot_create_time_against_client_b_ticket(monkeypatch):
    asyncio.run(_test_restricted_technician_cannot_create_time_against_client_b_ticket(monkeypatch))


async def _test_restricted_technician_cannot_create_time_against_client_b_ticket(monkeypatch):
    database = FakeDb()
    _install_database(monkeypatch, database)
    await _assert_masked_denial(
        time_entries.create_time_entry(
            TimeEntryCreate(
                ticket_id="ticket-b",
                # This legacy-required field is deliberately untrusted; the
                # route resolves attribution from the authenticated identity.
                user_id="untrusted-client-b-user",
                description="Attempted cross-client time entry",
                minutes=15,
                billable=True,
            ),
            current_user=_restricted_client_a_technician(),
        ),
        database,
        "time_entry.create",
    )
    assert [entry["id"] for entry in database.time_entries.rows] == ["time-a", "time-b"]


def test_restricted_technician_cannot_add_ticket_workspace_time_to_client_b(monkeypatch):
    asyncio.run(_test_restricted_technician_cannot_add_ticket_workspace_time_to_client_b(monkeypatch))


async def _test_restricted_technician_cannot_add_ticket_workspace_time_to_client_b(monkeypatch):
    database = FakeDb()
    _install_database(monkeypatch, database)
    await _assert_masked_denial(
        tickets.add_ticket_time_entry(
            "ticket-b",
            {"minutes": 15, "description": "Attempted cross-client ticket time", "billable": True},
            current_user=_restricted_client_a_technician(),
        ),
        database,
        "ticket.time.create",
    )
    assert [entry["id"] for entry in database.time_entries.rows] == ["time-a", "time-b"]


def test_restricted_technician_cannot_start_or_complete_client_b_work_session(monkeypatch):
    asyncio.run(_test_restricted_technician_cannot_start_or_complete_client_b_work_session(monkeypatch))


async def _test_restricted_technician_cannot_start_or_complete_client_b_work_session(monkeypatch):
    database = FakeDb()
    _install_database(monkeypatch, database)
    technician = _restricted_client_a_technician()

    await _assert_masked_denial(
        work_sessions.start_work_session("ticket-b", {}, current_user=technician),
        database,
        "work_session.start",
    )
    await _assert_masked_denial(
        work_sessions.complete_work_session(
            "work-b",
            {
                "minutes": 15,
                "technical_notes": "Attempted cross-client completion",
                "customer_summary": "Attempted cross-client completion",
                "billing_classification": "billable",
            },
            current_user=technician,
        ),
        database,
        "work_session.complete",
    )
    assert database.nexus_work_sessions.rows[0]["status"] == "active"
    assert [entry["id"] for entry in database.time_entries.rows] == ["time-a", "time-b"]
