"""Focused contracts for approved customer-to-technician chat connections."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import customer_chat
from app.services import chat_access


def _get_path(document: dict, path: str):
    value = document
    for part in path.split("."):
        if not isinstance(value, dict) or part not in value:
            return None, False
        value = value[part]
    return value, True


def _set_path(document: dict, path: str, value):
    target = document
    parts = path.split(".")
    for part in parts[:-1]:
        target = target.setdefault(part, {})
    target[parts[-1]] = deepcopy(value)


def _delete_path(document: dict, path: str):
    target = document
    parts = path.split(".")
    for part in parts[:-1]:
        if not isinstance(target, dict):
            return
        target = target.get(part)
    if isinstance(target, dict):
        target.pop(parts[-1], None)


def _matches(document: dict, query: dict) -> bool:
    for path, expected in (query or {}).items():
        value, exists = _get_path(document, path)
        if isinstance(expected, dict):
            if "$ne" in expected and exists and value == expected["$ne"]:
                return False
            if "$in" in expected and (not exists or value not in expected["$in"]):
                return False
            if "$exists" in expected and bool(expected["$exists"]) != exists:
                return False
            continue
        if not exists or value != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    def sort(self, field, direction):
        self.rows.sort(key=lambda row: str(row.get(field) or ""), reverse=direction < 0)
        return self

    async def to_list(self, limit):
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])
        self.inserted = []

    async def find_one(self, query, _projection=None):
        row = next((row for row in self.rows if _matches(row, query)), None)
        return deepcopy(row) if row else None

    def find(self, query, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document):
        if any(row.get("_id") == document.get("_id") for row in self.rows if document.get("_id") is not None):
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("duplicate")
        self.rows.append(deepcopy(document))
        self.inserted.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("_id") or document.get("id"))

    async def update_one(self, query, update, upsert=False, **_kwargs):
        row = next((row for row in self.rows if _matches(row, query)), None)
        if not row and not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        created = row is None
        if created:
            row = {}
            for key, value in query.items():
                if not isinstance(value, dict):
                    _set_path(row, key, value)
            self.rows.append(row)
        before = deepcopy(row)
        for path, value in update.get("$setOnInsert", {}).items():
            if created:
                _set_path(row, path, value)
        for path, value in update.get("$set", {}).items():
            _set_path(row, path, value)
        for path in update.get("$unset", {}):
            _delete_path(row, path)
        return SimpleNamespace(
            matched_count=0 if created else 1,
            modified_count=1 if row != before else 0,
            upserted_id=row.get("_id") if created else None,
        )

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        original = len(self.rows)
        self.rows = [row for row in self.rows if not _matches(row, query)]
        return SimpleNamespace(deleted_count=original - len(self.rows))

    async def create_index(self, *_args, **_kwargs):
        return "index"


class _Database(SimpleNamespace):
    def __init__(self, *, requests=None, channels=None):
        users = [
            {
                "id": "tech-client-a", "name": "Alex Client A", "role": "technician", "is_active": True,
                "client_scope_mode": "restricted", "client_scope_ids": ["client-a"], "specialties": ["Microsoft 365"],
            },
            {
                "id": "tech-client-b", "name": "Blair Client B", "role": "technician", "is_active": True,
                "client_scope_mode": "restricted", "client_scope_ids": ["client-b"],
            },
            {
                "id": "ordinary-user", "name": "Ordinary", "role": "viewer", "is_active": True,
                "client_scope_mode": "restricted", "client_scope_ids": ["client-a"],
            },
        ]
        super().__init__(
            clients=_Collection([
                {"id": "client-a", "name": "Client A", "tenant_id": "tenant-a"},
                {"id": "client-b", "name": "Client B", "tenant_id": "tenant-b"},
            ]),
            users=_Collection(users),
            customer_technician_favorites=_Collection(),
            customer_technician_chat_requests=_Collection(requests),
            chat_channels=_Collection(channels),
            chat_messages=_Collection(),
            notifications=_Collection(),
            tickets=_Collection([
                {"id": "ticket-a", "client_id": "client-a"},
                {"id": "ticket-b", "client_id": "client-b"},
            ]),
            devices=_Collection([
                {"id": "device-a", "client_id": "client-a"},
                {"id": "device-b", "client_id": "client-b"},
            ]),
        )


def _portal_a():
    return {"id": "portal-a", "name": "Casey Customer", "email": "casey@client-a.example", "client_id": "client-a"}


def _portal_b():
    return {"id": "portal-b", "name": "Robin Customer", "email": "robin@client-b.example", "client_id": "client-b"}


def _tech_a():
    return {"id": "tech-client-a", "name": "Alex Client A", "role": "technician", "is_active": True, "client_scope_mode": "restricted", "client_scope_ids": ["client-a"]}


def _tech_b():
    return {"id": "tech-client-b", "name": "Blair Client B", "role": "technician", "is_active": True, "client_scope_mode": "restricted", "client_scope_ids": ["client-b"]}


def _patch_audits(monkeypatch):
    events = []

    async def _portal_event(**kwargs):
        events.append({"kind": "portal", **kwargs})

    async def _activity(*args, **kwargs):
        events.append({"kind": "activity", "args": args, "kwargs": kwargs})

    monkeypatch.setattr(customer_chat, "record_portal_event", _portal_event)
    monkeypatch.setattr(customer_chat, "log_activity", _activity)
    return events


def test_portal_technician_directory_and_favourite_are_client_scoped_and_audited(monkeypatch):
    database = _Database()
    events = _patch_audits(monkeypatch)
    monkeypatch.setattr(customer_chat, "db", database)

    directory = asyncio.run(customer_chat.list_portal_technicians(_portal_a()))
    assert [tech["id"] for tech in directory["technicians"]] == ["tech-client-a"]

    favourite = asyncio.run(customer_chat.set_portal_favourite(_portal_a(), "tech-client-a", favourite=True))
    repeated = asyncio.run(customer_chat.set_portal_favourite(_portal_a(), "tech-client-a", favourite=True))
    assert favourite["is_favourite"] is True and favourite["changed"] is True
    assert repeated["changed"] is False
    assert len(database.customer_technician_favorites.rows) == 1
    assert len([event for event in events if event["kind"] == "portal"]) == 2

    with pytest.raises(HTTPException) as denied:
        asyncio.run(customer_chat.set_portal_favourite(_portal_a(), "tech-client-b", favourite=True))
    assert denied.value.status_code == 404


def test_portal_request_is_context_scoped_idempotent_and_notifies_only_target(monkeypatch):
    database = _Database()
    events = _patch_audits(monkeypatch)
    monkeypatch.setattr(customer_chat, "db", database)
    payload = {
        "technician_id": "tech-client-a",
        "subject": "Outlook assistance",
        "message": "Could you help with the Outlook issue?",
        "context": {"ticket_id": "ticket-a", "device_id": "device-a"},
    }

    with pytest.raises(HTTPException) as unfollowed:
        asyncio.run(customer_chat.create_portal_request(_portal_a(), payload))
    assert unfollowed.value.status_code == 422

    asyncio.run(customer_chat.set_portal_favourite(_portal_a(), "tech-client-a", favourite=True))
    events.clear()
    created = asyncio.run(customer_chat.create_portal_request(_portal_a(), payload))
    repeated = asyncio.run(customer_chat.create_portal_request(_portal_a(), payload))
    assert created["reused"] is False
    assert repeated["reused"] is True
    assert created["request"]["client_name"] == "Client A"
    assert len(database.customer_technician_chat_requests.rows) == 1
    assert database.notifications.rows[0]["user_id"] == "tech-client-a"
    assert database.customer_technician_chat_requests.rows[0]["context"] == {"ticket_id": "ticket-a", "device_id": "device-a"}
    assert len([event for event in events if event["kind"] == "portal"]) == 1

    with pytest.raises(HTTPException) as foreign_context:
        asyncio.run(customer_chat.create_portal_request(
            _portal_a(), {**payload, "context": {"ticket_id": "ticket-b"}}
        ))
    assert foreign_context.value.status_code == 404


def test_only_assigned_technician_can_accept_or_decline_and_acceptance_creates_team_chat_channel(monkeypatch):
    record = {
        "id": "request-a", "client_id": "client-a", "tenant_id": "tenant-a", "portal_user_id": "portal-a",
        "requester_name": "Casey Customer", "requester_email": "casey@client-a.example",
        "technician_id": "tech-client-a", "technician_name": "Alex Client A", "subject": "Help", "message": "Please help",
        "context": {"ticket_id": "ticket-a"}, "status": "pending", "pending_key": "pending-a", "created_at": "2026-01-01T00:00:00+00:00",
    }
    database = _Database(requests=[record])
    events = _patch_audits(monkeypatch)
    monkeypatch.setattr(customer_chat, "db", database)

    with pytest.raises(HTTPException) as foreign_technician:
        asyncio.run(customer_chat.decide_technician_request(_tech_b(), "request-a", {"decision": "accept"}))
    assert foreign_technician.value.status_code == 404

    accepted = asyncio.run(customer_chat.decide_technician_request(_tech_a(), "request-a", {"decision": "accept", "response": "I can help now."}))
    replayed = asyncio.run(customer_chat.decide_technician_request(_tech_a(), "request-a", {"decision": "accept"}))
    assert accepted["changed"] is True
    assert accepted["channel_id"]
    assert replayed["changed"] is False
    assert database.customer_technician_chat_requests.rows[0]["status"] == "accepted"
    assert "pending_key" not in database.customer_technician_chat_requests.rows[0]
    channel = database.chat_channels.rows[0]
    assert channel["kind"] == "client_direct"
    assert channel["member_ids"] == ["tech-client-a"]
    assert channel["portal_user_id"] == "portal-a"
    assert channel["request_context"] == {"ticket_id": "ticket-a"}
    assert database.chat_messages.rows[0]["message_type"] == "system"
    assert {event["kind"] for event in events} == {"portal", "activity"}

    customer_message = asyncio.run(customer_chat.send_portal_message(
        _portal_a(), accepted["channel_id"], {"body": "Thanks Alex, I can share the error now."}
    ))
    visible_messages = asyncio.run(customer_chat.list_portal_messages(_portal_a(), accepted["channel_id"]))
    assert customer_message["actor_type"] == "portal_user"
    assert [message["body"] for message in visible_messages["messages"]][-1].startswith("Thanks Alex")
    assert any(row.get("type") == "customer_direct_chat_message" for row in database.notifications.rows)

    listing = asyncio.run(customer_chat.list_technician_requests(_tech_a()))
    assert listing["summary"] == {"pending": 0, "accepted": 1, "declined": 0}
    with pytest.raises(HTTPException) as no_staff_access:
        asyncio.run(customer_chat.list_technician_requests({"id": "ordinary-user", "role": "viewer", "is_active": True}))
    assert no_staff_access.value.status_code == 403


def test_decline_is_idempotent_and_portal_conversations_remain_user_and_client_bound(monkeypatch):
    record = {
        "id": "request-decline", "client_id": "client-a", "tenant_id": "tenant-a", "portal_user_id": "portal-a",
        "requester_name": "Casey Customer", "requester_email": "casey@client-a.example",
        "technician_id": "tech-client-a", "technician_name": "Alex Client A", "subject": "Help", "message": "Please help",
        "context": {}, "status": "pending", "pending_key": "pending-decline", "created_at": "2026-01-01T00:00:00+00:00",
    }
    channel = {
        "id": "channel-b", "kind": "client_direct", "is_private": True, "client_id": "client-b",
        "portal_user_id": "portal-b", "technician_id": "tech-client-b", "technician_name": "Blair Client B",
        "customer_name": "Robin Customer", "member_ids": ["tech-client-b"], "updated_at": "2026-01-01T00:00:00+00:00",
    }
    database = _Database(requests=[record], channels=[channel])
    _patch_audits(monkeypatch)
    monkeypatch.setattr(customer_chat, "db", database)

    declined = asyncio.run(customer_chat.decide_technician_request(_tech_a(), "request-decline", {"decision": "decline"}))
    repeated = asyncio.run(customer_chat.decide_technician_request(_tech_a(), "request-decline", {"decision": "decline"}))
    assert declined["changed"] is True
    assert repeated["changed"] is False
    assert database.customer_technician_chat_requests.rows[0]["status"] == "declined"

    with pytest.raises(HTTPException) as cross_client:
        asyncio.run(customer_chat.list_portal_messages(_portal_a(), "channel-b"))
    assert cross_client.value.status_code == 404
    matching_portal = asyncio.run(customer_chat.list_portal_messages(_portal_b(), "channel-b"))
    assert matching_portal["channel"]["channel_id"] == "channel-b"
    assert matching_portal["messages"] == []


def test_team_chat_revokes_customer_conversation_when_technician_loses_client_scope(monkeypatch):
    channel = {
        "id": "channel-client-b", "kind": "client_direct", "is_private": True,
        "client_id": "client-b", "portal_user_id": "portal-b", "member_ids": ["tech-client-a"],
    }
    database = _Database(channels=[channel])
    monkeypatch.setattr(chat_access, "db", database)
    restricted_tech = _tech_a()  # Explicitly scoped only to client-a.

    with pytest.raises(HTTPException) as denied:
        asyncio.run(chat_access.require_channel_access("channel-client-b", restricted_tech))
    assert denied.value.status_code == 404

    # It is filtered from the Team Chat list as well, not merely blocked when
    # a user guesses the direct conversation URL.
    enriched = asyncio.run(chat_access.enrich_channels([channel], restricted_tech))
    assert enriched == []


def test_scope_loss_hides_and_blocks_customer_chat_requests(monkeypatch):
    request = {
        "id": "request-client-b", "client_id": "client-b", "tenant_id": "tenant-b", "portal_user_id": "portal-b",
        "requester_name": "Robin Customer", "requester_email": "robin@client-b.example",
        "technician_id": "tech-client-a", "technician_name": "Alex Client A", "subject": "Help", "message": "Please help",
        "context": {}, "status": "pending", "pending_key": "pending-client-b", "created_at": "2026-01-01T00:00:00+00:00",
    }
    database = _Database(requests=[request])
    monkeypatch.setattr(customer_chat, "db", database)

    # Alex is still the historical assignee, but their current scope excludes
    # client-b. Neither the inbox nor a guessed request ID may expose it.
    assert asyncio.run(customer_chat.list_technician_requests(_tech_a()))["requests"] == []
    with pytest.raises(HTTPException) as denied:
        asyncio.run(customer_chat.decide_technician_request(_tech_a(), "request-client-b", {"decision": "accept"}))
    assert denied.value.status_code == 404
