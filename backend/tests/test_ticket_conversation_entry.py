"""Regression coverage for the unified ticket conversation action boundary."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import tickets
from app.services import ticket_checkpoint_notifications, ticket_time
from app.services.ticket_conversation import sanitise_ticket_rich_text


def _matches(row: dict, query: dict) -> bool:
    if not query:
        return True
    if "$and" in query and not all(_matches(row, clause) for clause in query["$and"]):
        return False
    if "$or" in query and not any(_matches(row, clause) for clause in query["$or"]):
        return False
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
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
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
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                for field, value in update.get("$addToSet", {}).items():
                    current = row.setdefault(field, [])
                    if value not in current:
                        current.append(value)
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, query, update):
        matched = [row for row in self.rows if _matches(row, query)]
        for row in matched:
            row.update(deepcopy(update.get("$set", {})))
            for field in update.get("$unset", {}):
                row.pop(field, None)
            for field, value in update.get("$addToSet", {}).items():
                current = row.setdefault(field, [])
                if value not in current:
                    current.append(value)
        return SimpleNamespace(matched_count=len(matched), modified_count=len(matched))


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
            notifications=FakeCollection(),
        )


def test_conversation_update_preserves_rich_structure_and_logs_one_canonical_time_entry(monkeypatch):
    asyncio.run(_test_conversation_update_preserves_rich_structure_and_logs_one_canonical_time_entry(monkeypatch))


async def _test_conversation_update_preserves_rich_structure_and_logs_one_canonical_time_entry(monkeypatch):
    database = FakeDb()
    ticket_time._indexed_database_ids.clear()
    tickets._CONVERSATION_INDEXED_DATABASE_IDS.clear()
    monkeypatch.setattr(tickets, "db", database)
    monkeypatch.setattr(ticket_checkpoint_notifications, "db", database)

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


def test_conversation_update_records_the_promised_next_checkpoint_once(monkeypatch):
    asyncio.run(_test_conversation_update_records_the_promised_next_checkpoint_once(monkeypatch))


async def _test_conversation_update_records_the_promised_next_checkpoint_once(monkeypatch):
    database = FakeDb()
    ticket_time._indexed_database_ids.clear()
    tickets._CONVERSATION_INDEXED_DATABASE_IDS.clear()
    monkeypatch.setattr(tickets, "db", database)
    monkeypatch.setattr(ticket_checkpoint_notifications, "db", database)

    async def ticket_in_scope(ticket_id, _user, _operation, **_kwargs):
        return await database.tickets.find_one({"id": ticket_id, "tenant_id": "tenant-a"})

    async def allow_action(*_args, **_kwargs):
        return None

    monkeypatch.setattr(tickets, "_ticket_in_tenant_scope", ticket_in_scope)
    monkeypatch.setattr(tickets, "assert_action_permission", allow_action)

    promise = datetime.now(timezone.utc) + timedelta(hours=3)
    payload = tickets.TicketConversationEntryCreate(
        content="<p>Our engineer is still investigating. The next update is on the record.</p>",
        visibility="public",
        next_checkpoint_at=promise,
        idempotency_key="conversation-checkpoint-retry-key-0001",
    )
    user = {
        "id": "tech-1",
        "name": "Alex Tech",
        "email": "alex@example.test",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "all",
    }

    first = await tickets.create_ticket_conversation_entry(
        "ticket-1", payload, request=SimpleNamespace(), current_user=user
    )
    replay = await tickets.create_ticket_conversation_entry(
        "ticket-1", payload, request=SimpleNamespace(), current_user=user
    )

    ticket = database.tickets.rows[0]
    assert ticket["next_checkpoint_at"] == promise.astimezone(timezone.utc).isoformat()
    assert ticket["next_checkpoint_set_by"] == "tech-1"
    assert ticket["next_checkpoint_set_by_name"] == "Alex Tech"
    assert ticket["next_checkpoint_set_at"]
    assert database.ticket_conversation_actions.rows[0]["next_checkpoint_applied"] is True
    assert replay["idempotent_replay"] is True
    assert replay["comment"]["id"] == first["comment"]["id"]

    conflicting_checkpoint = payload.model_copy(update={"next_checkpoint_at": promise + timedelta(hours=1)})
    with pytest.raises(HTTPException) as raised:
        await tickets.create_ticket_conversation_entry(
            "ticket-1", conflicting_checkpoint, request=SimpleNamespace(), current_user=user
        )
    assert raised.value.status_code == 409

    # A delayed retry must not overwrite a promise another technician has
    # recorded since this retry key was created.
    newer_promise = promise + timedelta(days=1)
    database.tickets.rows[0]["next_checkpoint_at"] = newer_promise.astimezone(timezone.utc).isoformat()
    database.tickets.rows[0]["next_checkpoint_set_at"] = "2099-01-01T00:00:00+00:00"
    database.ticket_conversation_actions.rows[0]["next_checkpoint_applied"] = False
    retried = await tickets.create_ticket_conversation_entry(
        "ticket-1", payload, request=SimpleNamespace(), current_user=user
    )
    assert retried["idempotent_replay"] is True
    assert database.tickets.rows[0]["next_checkpoint_at"] == newer_promise.astimezone(timezone.utc).isoformat()
    assert database.ticket_conversation_actions.rows[0]["next_checkpoint_applied"] is True


def test_public_update_clears_the_fulfilled_promise_and_resolves_its_due_alert(monkeypatch):
    asyncio.run(_test_public_update_clears_the_fulfilled_promise_and_resolves_its_due_alert(monkeypatch))


async def _test_public_update_clears_the_fulfilled_promise_and_resolves_its_due_alert(monkeypatch):
    database = FakeDb()
    due = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    database.tickets.rows[0].update({
        "next_checkpoint_at": due,
        "next_checkpoint_set_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
        "next_checkpoint_set_by": "tech-1",
        "next_checkpoint_set_by_name": "Alex Tech",
    })
    database.notifications.rows.append({
        "id": "due-alert",
        "user_id": "tech-1",
        "tenant_id": "tenant-a",
        "client_id": "client-1",
        "site_id": None,
        "type": "ticket_checkpoint_due",
        "ref_id": "ticket-1",
        "checkpoint_at": due,
        "read": False,
        "created_at": due,
    })
    ticket_time._indexed_database_ids.clear()
    tickets._CONVERSATION_INDEXED_DATABASE_IDS.clear()
    monkeypatch.setattr(tickets, "db", database)
    monkeypatch.setattr(ticket_checkpoint_notifications, "db", database)

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
        content="<p>The access issue is resolved and verified.</p>",
        visibility="public",
        idempotency_key="conversation-fulfilment-retry-key-0001",
    )

    first = await tickets.create_ticket_conversation_entry(
        "ticket-1", payload, request=SimpleNamespace(), current_user=user
    )
    ticket = database.tickets.rows[0]
    alert = database.notifications.rows[0]

    assert "next_checkpoint_at" not in ticket
    assert "next_checkpoint_set_at" not in ticket
    assert "next_checkpoint_set_by" not in ticket
    assert alert["read"] is True
    assert alert["resolution"] == "client_update_published"
    assert alert["resolved_comment_id"] == first["comment"]["id"]
    assert [row["action"] for row in database.ticket_audit_log.rows].count("next_checkpoint_fulfilled") == 1

    replay = await tickets.create_ticket_conversation_entry(
        "ticket-1", payload, request=SimpleNamespace(), current_user=user
    )
    assert replay["idempotent_replay"] is True
    assert "next_checkpoint_at" not in ticket
    assert [row["action"] for row in database.ticket_audit_log.rows].count("next_checkpoint_fulfilled") == 1


def test_legacy_public_comment_also_settles_the_due_promise(monkeypatch):
    asyncio.run(_test_legacy_public_comment_also_settles_the_due_promise(monkeypatch))


async def _test_legacy_public_comment_also_settles_the_due_promise(monkeypatch):
    database = FakeDb()
    due = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    database.tickets.rows[0].update({
        "next_checkpoint_at": due,
        "next_checkpoint_set_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
    })
    database.notifications.rows.append({
        "id": "legacy-due-alert",
        "user_id": "tech-1",
        "tenant_id": "tenant-a",
        "client_id": "client-1",
        "type": "ticket_checkpoint_due",
        "ref_id": "ticket-1",
        "checkpoint_at": due,
        "read": False,
        "created_at": due,
    })
    monkeypatch.setattr(tickets, "db", database)
    monkeypatch.setattr(ticket_checkpoint_notifications, "db", database)

    async def ticket_in_scope(ticket_id, _user, _operation, **_kwargs):
        return await database.tickets.find_one({"id": ticket_id, "tenant_id": "tenant-a"})

    async def allow_action(*_args, **_kwargs):
        return None

    async def ignore_subscribers(**_kwargs):
        return None

    monkeypatch.setattr(tickets, "_ticket_in_tenant_scope", ticket_in_scope)
    monkeypatch.setattr(tickets, "assert_action_permission", allow_action)
    monkeypatch.setattr(tickets, "notify_ticket_subscribers", ignore_subscribers)

    user = {
        "id": "tech-1",
        "name": "Alex Tech",
        "email": "alex@example.test",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "all",
    }

    comment = await tickets.create_ticket_comment(
        "ticket-1",
        {"content": "<p>The promised update is now available.</p>", "visibility": "public"},
        current_user=user,
    )

    assert "next_checkpoint_at" not in database.tickets.rows[0]
    alert = database.notifications.rows[0]
    assert alert["read"] is True
    assert alert["resolution"] == "client_update_published"
    assert alert["resolved_comment_id"] == comment["id"]
    assert [row["action"] for row in database.ticket_audit_log.rows].count("next_checkpoint_fulfilled") == 1


def test_next_checkpoint_validation_rejects_ambiguous_or_stale_times():
    now = datetime.now(timezone.utc)

    assert tickets._next_checkpoint_at(None) is None
    with pytest.raises(HTTPException) as naive:
        tickets._next_checkpoint_at(datetime.now() + timedelta(hours=2))
    assert naive.value.status_code == 422
    with pytest.raises(HTTPException) as stale:
        tickets._next_checkpoint_at(now - timedelta(hours=1))
    assert stale.value.status_code == 422
    with pytest.raises(HTTPException) as distant:
        tickets._next_checkpoint_at(now + timedelta(days=367))
    assert distant.value.status_code == 422


def test_ticket_rich_text_sanitiser_keeps_lists_but_rejects_empty_note():
    html, text = sanitise_ticket_rich_text("<p>Plan</p><ol><li>Back up</li><li>Verify</li></ol><script>alert(1)</script>")

    assert "<ol>" in html
    assert "<li>Back up</li>" in html
    assert "<script" not in html
    assert "Plan Back up Verify" in text

    with pytest.raises(HTTPException) as raised:
        sanitise_ticket_rich_text("<p>&nbsp;</p>")
    assert raised.value.status_code == 422
