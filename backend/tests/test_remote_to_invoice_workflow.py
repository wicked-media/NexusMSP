from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import asyncio

import pytest
from fastapi import HTTPException

from app.routers import time_entries
from app.services import remote_runtime


def _matches(row, query):
    for key, expected in query.items():
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
        elif actual != expected:
            return False
    return True


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return deepcopy(self.rows)


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, _projection=None):
        return FakeCursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        modified = 0
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                modified += 1
        return SimpleNamespace(matched_count=modified, modified_count=modified)


class FakeDb(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=FakeCollection([{
                "id": "ticket-1",
                "title": "Restore workstation access",
                "client_id": "client-1",
                "client_name": "Northwind Dental",
            }]),
            users=FakeCollection([{"id": "tech-1", "hourly_rate": 120.0}]),
            time_entries=FakeCollection(),
            invoices=FakeCollection(),
            ticket_notes=FakeCollection(),
            ticket_audit_log=FakeCollection(),
            remote_sessions=FakeCollection(),
        )


def test_remote_session_creates_priced_auditable_time(monkeypatch):
    asyncio.run(_test_remote_session_creates_priced_auditable_time(monkeypatch))


async def _test_remote_session_creates_priced_auditable_time(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(remote_runtime, "db", fake_db)
    monkeypatch.setattr(remote_runtime, "remote_policy", lambda: _async_value({
        "auto_create_time_entry": True,
        "auto_ticket_note": True,
    }))
    monkeypatch.setattr(remote_runtime, "log_activity", lambda *_args, **_kwargs: _async_value(None))
    monkeypatch.setattr(remote_runtime, "emit_platform_event", lambda **_kwargs: _async_value(None))

    session = {
        "id": "remote-1",
        "status": "active",
        "user_id": "tech-1",
        "user_name": "Alex Tech",
        "ticket_id": "ticket-1",
        "client_id": "client-1",
        "client_name": "Northwind Dental",
        "device_id": "device-1",
        "device_name": "Reception-PC",
        "provider": "rustdesk",
        "opened_at": (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat(),
    }
    user = {"id": "tech-1", "name": "Alex Tech", "role": "technician"}
    result = await remote_runtime.end_remote_session_record(
        session=session,
        user=user,
        data={"notes": "Resolved the client issue", "billable": True},
    )

    entry = fake_db.time_entries.rows[0]
    assert result["time_entry_id"] == entry["id"]
    assert entry["remote_session_id"] == "remote-1"
    assert entry["hourly_rate"] == 120.0
    assert entry["total_amount"] >= 60.0
    assert entry["invoiced"] is False
    assert fake_db.ticket_notes.rows[0]["remote_session_id"] == "remote-1"
    assert fake_db.ticket_audit_log.rows[0]["action"] == "remote_session_ended"


def test_invoice_generation_is_priced_linked_and_not_repeatable(monkeypatch):
    asyncio.run(_test_invoice_generation_is_priced_linked_and_not_repeatable(monkeypatch))


async def _test_invoice_generation_is_priced_linked_and_not_repeatable(monkeypatch):
    fake_db = FakeDb()
    fake_db.time_entries.rows.append({
        "id": "time-1",
        "ticket_id": "ticket-1",
        "ticket_title": "Restore workstation access",
        "client_id": "client-1",
        "client_name": "Northwind Dental",
        "user_id": "tech-1",
        "user_name": "Alex Tech",
        "description": "Remote remediation",
        "minutes": 30,
        "hourly_rate": 120.0,
        "total_amount": 0.0,
        "billable": True,
        "invoiced": False,
        "remote_session_id": "remote-1",
        "date": "2026-08-06",
    })
    monkeypatch.setattr(time_entries, "db", fake_db)
    monkeypatch.setattr(time_entries, "log_activity", lambda *_args, **_kwargs: _async_value(None))
    user = {"id": "admin-1", "name": "Aaron", "role": "admin", "is_admin": True}

    invoice = await time_entries.generate_invoice_from_time(
        {"client_name": "Northwind Dental"},
        current_user=user,
    )

    assert invoice["client_id"] == "client-1"
    assert invoice["total_amount"] == 60.0
    assert invoice["ticket_ids"] == ["ticket-1"]
    assert invoice["source_refs"][0]["remote_session_id"] == "remote-1"
    assert fake_db.time_entries.rows[0]["invoice_id"] == invoice["id"]

    with pytest.raises(HTTPException) as exc:
        await time_entries.generate_invoice_from_time(
            {"client_name": "Northwind Dental"},
            current_user=user,
        )
    assert exc.value.status_code == 404


async def _async_value(value):
    return value
