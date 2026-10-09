"""Regression coverage for the unified ticket conversation action boundary."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import tickets
from app.services import ticket_time
from app.services.ticket_conversation import sanitise_ticket_rich_text


def _matches(row: dict, query: dict) -> bool:
    if not query:
        return True
    if "$and" in query:
        return all(_matches(row, clause) for clause in query["$and"])
    if "$or" in query:
        return any(_matches(row, clause) for clause in query["$or"])
    for key, expected in query.items():
        if key.startswith("$"):
            continue
        present = key in row
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and present != bool(expected["$exists"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class FakeCursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return deepcopy(self.rows)


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(deepcopy(rows or []))
        self.indexes = []

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, _projection=None):
        return FakeCursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def create_index(self, keys, **kwargs):
        self.indexes.append({"keys": keys, **kwargs})
        return kwargs.get("name")

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class FakeDb(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=FakeCollection([
                {
                    "id": "ticket-1",
                    "tenant_id": "tenant-a",
                    "client_id": "client-1",
                    "client_name": "Northwind Dental",
                    "title": "Restore workstation access",
                    "ticket_number": "SR-1001",
                }
            ]),
            users=FakeCollection([{"id": "tech-1", "name": "Alex Tech", "email": "alex@example.test", "hourly_rate": 90.0}]),
            labour_types=FakeCollection([
                {
                    "id": "remote-support",
                    "tenant_id": "tenant-a",
                    "name": "Remote support",
                    "code": "REMOTE",
                    "hourly_rate": 200.0,
                    "billable_default": True,
                    "is_active": True,
                }
            ]),
            time_entries=FakeCollection(),
            ticket_time_entries=FakeCollection(),
            ticket_comments=FakeCollection(),
            ticket_conversation_actions=FakeCollection(),
            ticket_audit_log=FakeCollection(),
        )


def test_conversation_update_preserves_rich_structure_and_logs_one_canonical_time_entry(monkeypatch):
    asyncio.run(_test_conversation_update_preserves_rich_structure_and_logs_one_canonical_time_entry(monkeypatch))


async def _test_conversation_update_preserves_rich_structure_and_logs_one_canonical_time_entry(monkeypatch):
    database = FakeDb()
    ticket_time._indexed_database_ids.clear()
    tickets._CONVERSATION_INDEXED_DATABASE_IDS.clear()
    monkeypatch.setattr(tickets, "db", database)

    async def ticket_in_scope(ticket_id, _user, _operation, **_kwargs):
        return await database.tickets.find_one({"id": ticket_id, "tenant_id": "tenant-a"})

    async def allow_action(*_args, **_kwargs):
        return None

    monkeypatch.setattr(tickets, "_ticket_in_tenant_scope", ticket_in_scope)
    monkeypatch.setattr(tickets, "assert_action_permission", allow_action)

    user = {
        "id": "tech-1",
        "name": "Alex Tech",
        "email": "alex@example.test",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "all",
    }
    payload = tickets.TicketConversationEntryCreate(
        content="<p>Completed the restoration:</p><ul><li>Reset the credential</li><li>Verified the sign-in</li></ul>",
        visibility="internal",
        idempotency_key="conversation-entry-retry-key-0001",
        time={
            "minutes": 30,
            "labour_type_id": "remote-support",
            "description": "Restored access and verified sign-in",
        },
    )

    first = await tickets.create_ticket_conversation_entry(
        "ticket-1", payload, request=SimpleNamespace(), current_user=user
    )
    replay = await tickets.create_ticket_conversation_entry(
        "ticket-1", payload, request=SimpleNamespace(), current_user=user
    )

    assert len(database.ticket_comments.rows) == 1
    comment = database.ticket_comments.rows[0]
    assert "<ul>" in comment["content"]
    assert "<li>Reset the credential</li>" in comment["content"]
    assert "Verified the sign-in" in comment["content_text"]
    assert comment["tenant_id"] == "tenant-a"
    assert comment["time_entry_id"] == first["time_entry"]["id"]

    assert len(database.time_entries.rows) == 1
    time_entry = database.time_entries.rows[0]
    assert time_entry["minutes"] == 30
    assert time_entry["hourly_rate"] == 200.0
    assert time_entry["total_amount"] == 100.0
    assert time_entry["labour_type_name"] == "Remote support"
    assert time_entry["tenant_id"] == "tenant-a"
    assert database.tickets.rows[0]["total_time_minutes"] == 30
    assert replay["idempotent_replay"] is True
    assert replay["time_entry"]["id"] == first["time_entry"]["id"]

    conflicting_payload = payload.model_copy(update={"content": "<p>A different update</p>"})
    with pytest.raises(HTTPException) as raised:
        await tickets.create_ticket_conversation_entry(
            "ticket-1", conflicting_payload, request=SimpleNamespace(), current_user=user
        )
    assert raised.value.status_code == 409


def test_ticket_rich_text_sanitiser_keeps_lists_but_rejects_empty_note():
    html, text = sanitise_ticket_rich_text("<p>Plan</p><ol><li>Back up</li><li>Verify</li></ol><script>alert(1)</script>")

    assert "<ol>" in html
    assert "<li>Back up</li>" in html
    assert "<script" not in html
    assert "Plan Back up Verify" in text

    with pytest.raises(HTTPException) as raised:
        sanitise_ticket_rich_text("<p>&nbsp;</p>")
    assert raised.value.status_code == 422
