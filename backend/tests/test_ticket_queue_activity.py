"""Regression coverage for ticket queue activity evidence."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

from app.routers import tickets


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])
        self.updates = []

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        self.updates.append({"query": deepcopy(query), "update": deepcopy(update)})
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def test_ticket_updates_record_activity_without_fabricating_customer_reply(monkeypatch):
    database = SimpleNamespace(
        tickets=_Collection([{"id": "ticket-1", "client_id": "client-1", "title": "Restore access"}]),
        ticket_comments=_Collection(),
    )

    async def in_scope(ticket_id, _user, _operation):
        assert ticket_id == "ticket-1"
        return deepcopy(database.tickets.rows[0])

    async def no_audit(*_args, **_kwargs):
        return None

    async def allow_action(*_args, **_kwargs):
        return {"allowed": True}

    monkeypatch.setattr(tickets, "db", database)
    monkeypatch.setattr(tickets, "_ticket_in_tenant_scope", in_scope)
    monkeypatch.setattr(tickets, "ticket_audit", no_audit)
    monkeypatch.setattr(tickets, "assert_action_permission", allow_action)
    technician = {"id": "tech-1", "name": "Alex Tech", "role": "technician"}

    internal = asyncio.run(tickets.create_ticket_comment("ticket-1", {"content": "Checked identity configuration.", "visibility": "internal"}, technician))
    after_internal = database.tickets.rows[0]
    assert after_internal["last_activity_at"] == internal["created_at"]
    assert after_internal["last_activity_by_id"] == "tech-1"
    assert "last_technician_reply_at" not in after_internal
    assert database.tickets.updates[0]["query"] == {"id": "ticket-1", "client_id": "client-1"}

    public = asyncio.run(tickets.create_ticket_comment("ticket-1", {"content": "We are continuing the investigation.", "visibility": "public"}, technician))
    after_public = database.tickets.rows[0]
    assert after_public["last_activity_at"] == public["created_at"]
    assert after_public["last_technician_reply_at"] == public["created_at"]
    assert "last_customer_reply_at" not in after_public
