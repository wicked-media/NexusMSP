"""Regression coverage for the portal-to-service-desk comment boundary."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest

from app.routers import portal_v2


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    if "$and" in query:
        return all(_matches(row, clause) for clause in query["$and"])
    if "$or" in query:
        return any(_matches(row, clause) for clause in query["$or"])
    for key, expected in query.items():
        if isinstance(expected, dict) and "$exists" in expected:
            if (key in row) != bool(expected["$exists"]):
                return False
        elif row.get(key) != expected:
            return False
    return True


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        row = next((row for row in self.rows if _matches(row, query)), None)
        if not row:
            return SimpleNamespace(matched_count=0, modified_count=0)
        row.update(deepcopy(update.get("$set", {})))
        return SimpleNamespace(matched_count=1, modified_count=1)


class _Database(SimpleNamespace):
    def __init__(
        self,
        *,
        clients: list[dict[str, Any]] | None = None,
        tickets: list[dict[str, Any]] | None = None,
    ):
        super().__init__(
            clients=_Collection(clients),
            tickets=_Collection(tickets),
            ticket_comments=_Collection(),
        )


def _portal_user(**overrides: Any) -> dict[str, Any]:
    return {
        "id": "portal-user-a",
        "name": "Portal User",
        "email": "portal.user@example.test",
        "client_id": "client-a",
        "tenant_id": "tenant-a",
        **overrides,
    }


def test_portal_ticket_creation_persists_scoped_structured_initial_comment(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_ticket_creation_persists_scoped_structured_initial_comment(monkeypatch))


async def _test_portal_ticket_creation_persists_scoped_structured_initial_comment(monkeypatch: pytest.MonkeyPatch):
    database = _Database(clients=[{"id": "client-a", "name": "Client A", "tenant_id": "tenant-a"}])
    monkeypatch.setattr(portal_v2, "db", database)

    ticket = await portal_v2.portal_create_ticket(
        {
            "title": "Printing issue",
            "description": "<p>Printer has stopped.</p><ul><li>Checked paper</li><li>Restarted device</li></ul>",
        },
        _portal_user(site_id="site-a"),
    )

    assert ticket["tenant_id"] == "tenant-a"
    assert ticket["site_id"] == "site-a"
    comment = database.ticket_comments.rows[0]
    assert comment["tenant_id"] == "tenant-a"
    assert comment["client_id"] == "client-a"
    assert comment["site_id"] == "site-a"
    assert comment["content_format"] == "tiptap_html.v1"
    assert comment["content"] == "<p>Printer has stopped.</p><ul><li>Checked paper</li><li>Restarted device</li></ul>"
    assert comment["content_text"] == "Printer has stopped. Checked paper Restarted device"


def test_portal_reply_uses_parent_scope_and_only_returns_safe_projection(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_portal_reply_uses_parent_scope_and_only_returns_safe_projection(monkeypatch))


async def _test_portal_reply_uses_parent_scope_and_only_returns_safe_projection(monkeypatch: pytest.MonkeyPatch):
    database = _Database(
        tickets=[
            {
                "id": "ticket-a",
                "client_id": "client-a",
                "tenant_id": "tenant-a",
                "site_id": "site-a",
                "status": "resolved",
            }
        ]
    )
    monkeypatch.setattr(portal_v2, "db", database)

    response = await portal_v2.portal_add_ticket_message(
        "ticket-a",
        {"content": "<p>It is working again.</p><script>not executable</script>"},
        _portal_user(tenant_id="tenant-a"),
    )

    comment = database.ticket_comments.rows[0]
    assert comment["tenant_id"] == "tenant-a"
    assert comment["client_id"] == "client-a"
    assert comment["site_id"] == "site-a"
    assert comment["content_format"] == "tiptap_html.v1"
    assert "<script>" not in comment["content"]
    assert comment["content_text"] == "It is working again. not executable"
    assert database.tickets.rows[0]["status"] == "open"

    assert response["content"] == "It is working again. not executable"
    assert response["sender_type"] == "client"
    assert not {
        "tenant_id",
        "client_id",
        "site_id",
        "time_entry_id",
        "hourly_rate",
        "total_amount",
        "labour_type_id",
        "labour_type_name",
    }.intersection(response)
