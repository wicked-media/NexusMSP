"""Security contracts for legacy secure-link ticket conversation history."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import client_portal


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    if "$and" in query:
        return all(_matches(row, clause) for clause in query["$and"])
    if "$or" in query:
        return any(_matches(row, clause) for clause in query["$or"])
    for key, value in query.items():
        if isinstance(value, dict) and "$ne" in value:
            if row.get(key) == value["$ne"]:
                return False
        elif row.get(key) != value:
            return False
    return True


def _project(row: dict[str, Any], projection: dict[str, int] | None) -> dict[str, Any]:
    if not projection:
        return deepcopy(row)
    included = {key for key, enabled in projection.items() if enabled and key != "_id"}
    return {key: deepcopy(value) for key, value in row.items() if key in included}


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]], projection: dict[str, int] | None):
        self.rows = [_project(row, projection) for row in rows]

    def sort(self, key: str, direction: int):
        self.rows.sort(key=lambda row: row.get(key) or "", reverse=direction < 0)
        return self

    async def to_list(self, limit: int):
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])
        self.last_find_query: dict[str, Any] | None = None

    async def find_one(self, query: dict[str, Any], projection: dict[str, int] | None = None):
        row = next((row for row in self.rows if _matches(row, query)), None)
        return _project(row, projection) if row else None

    def find(self, query: dict[str, Any], projection: dict[str, int] | None = None):
        self.last_find_query = deepcopy(query)
        return _Cursor([row for row in self.rows if _matches(row, query)], projection)


async def _active_config(_token: str) -> tuple[dict[str, Any], dict[str, Any]]:
    return {"client_id": "client-a", "tenant_id": "nexus-local"}, {"id": "link-a"}


def test_secure_link_returns_only_public_history_for_its_client(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_secure_link_returns_only_public_history_for_its_client(monkeypatch))


async def _test_secure_link_returns_only_public_history_for_its_client(monkeypatch: pytest.MonkeyPatch):
    comments = _Collection(
        [
            {
                "id": "public-a",
                "ticket_id": "ticket-a",
                "client_id": "client-a",
                "portal_visible": True,
                "content": "<p>Client-visible update</p>",
                "content_text": "Client-visible update",
                "user_name": "Technician A",
                "created_at": "2026-09-12T01:00:00+00:00",
                "delivery_status": "portal_only",
                "to_addresses": ["private@example.test"],
                "delivery_id": "provider-secret",
            },
            {
                "id": "internal-a",
                "ticket_id": "ticket-a",
                "client_id": "client-a",
                "portal_visible": False,
                "content": "Internal note",
            },
            {
                "id": "public-b",
                "ticket_id": "ticket-a",
                "client_id": "client-b",
                "portal_visible": True,
                "content": "Foreign client note",
            },
        ]
    )
    database = SimpleNamespace(
        tickets=_Collection(
            [
                {
                    "id": "ticket-a",
                    "client_id": "client-a",
                    "title": "Printer offline",
                    "status": "closed",
                    "resolution_status": "resolved_and_closed",
                    "private_metadata": "must-not-leak",
                }
            ]
        ),
        ticket_comments=comments,
    )
    monkeypatch.setattr(client_portal, "db", database)
    monkeypatch.setattr(client_portal, "_active_portal_config_for_token", _active_config)

    response = await client_portal.portal_get_ticket_history("valid-link", "ticket-a")

    assert response["ticket"] == {
        "id": "ticket-a",
        "title": "Printer offline",
        "status": "closed",
        "resolution_status": "resolved_and_closed",
    }
    assert [comment["id"] for comment in response["comments"]] == ["public-a"]
    assert response["comments"][0]["content"] == "Client-visible update"
    assert not {"client_id", "to_addresses", "delivery_id"}.intersection(response["comments"][0])
    assert comments.last_find_query == {
        "$and": [
            {
                "ticket_id": "ticket-a",
                "client_id": "client-a",
                "portal_visible": True,
                "is_internal": {"$ne": True},
            },
            {"$or": [{"tenant_id": "nexus-local"}, {"tenant_id": {"$exists": False}}, {"tenant_id": None}, {"tenant_id": ""}]},
        ]
    }


def test_secure_link_masks_foreign_and_missing_tickets_identically(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_secure_link_masks_foreign_and_missing_tickets_identically(monkeypatch))


async def _test_secure_link_masks_foreign_and_missing_tickets_identically(monkeypatch: pytest.MonkeyPatch):
    database = SimpleNamespace(
        tickets=_Collection([{"id": "ticket-b", "client_id": "client-b", "title": "Foreign"}]),
        ticket_comments=_Collection(),
    )
    monkeypatch.setattr(client_portal, "db", database)
    monkeypatch.setattr(client_portal, "_active_portal_config_for_token", _active_config)

    responses = []
    for ticket_id in ("ticket-b", "missing-ticket"):
        with pytest.raises(HTTPException) as exc_info:
            await client_portal.portal_get_ticket_history("valid-link", ticket_id)
        responses.append((exc_info.value.status_code, exc_info.value.detail))

    assert responses == [(404, "Ticket not found"), (404, "Ticket not found")]
