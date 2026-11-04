import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.models import TicketCreate
from app.routers import ticket_suggestions, tickets


KEY = "retry-key-0123456789abcdef"


def test_ticket_create_validates_idempotency_key_bounds():
    assert TicketCreate(title="t", description="d", idempotency_key=KEY).idempotency_key == KEY
    assert TicketCreate(title="t", description="d").idempotency_key is None
    with pytest.raises(ValidationError):
        TicketCreate(title="t", description="d", idempotency_key="short")


def test_replay_lookup_is_tenant_scoped(monkeypatch):
    captured = {}

    class Tickets:
        async def find_one(self, query, projection):
            captured["query"] = query
            return None

    monkeypatch.setattr(tickets, "db", SimpleNamespace(tickets=Tickets()))
    result = asyncio.run(tickets._ticket_by_create_idempotency_key(
        {"id": "tech-1", "tenant_id": "tenant-a"}, KEY,
    ))
    assert result is None
    query_text = str(captured["query"])
    assert KEY in query_text
    assert "tenant-a" in query_text


def test_create_replays_existing_ticket_without_inserting(monkeypatch):
    existing = {"id": "t-1", "ticket_number": "INC-0001", "title": "VPN drops overnight"}

    class Tickets:
        inserted = 0

        async def find_one(self, query, projection):
            return dict(existing)

        async def insert_one(self, doc):
            self.inserted += 1

    fake = Tickets()

    async def allow_create(user, client_id, operation=None):
        return None

    monkeypatch.setattr(tickets, "db", SimpleNamespace(tickets=fake))
    monkeypatch.setattr(tickets, "assert_client_scope", allow_create)

    result = asyncio.run(tickets.create_ticket(
        TicketCreate(title="VPN drops overnight", description="d", client_id="client-1", idempotency_key=KEY),
        {"id": "tech-1", "tenant_id": "tenant-a"},
    ))
    assert result.id == "t-1"
    assert result.ticket_number == "INC-0001"
    assert fake.inserted == 0


def test_create_idempotency_index_is_partial_and_unique(monkeypatch):
    captured = []

    class Tickets:
        async def create_index(self, keys, **kwargs):
            captured.append((keys, kwargs))

    monkeypatch.setattr(tickets, "db", SimpleNamespace(tickets=Tickets()))
    tickets._CREATE_INDEXED_DATABASE_IDS.clear()
    asyncio.run(tickets._ensure_ticket_create_idempotency_index())
    asyncio.run(tickets._ensure_ticket_create_idempotency_index())
    assert len(captured) == 1
    keys, kwargs = captured[0]
    assert ("idempotency_key", 1) in keys
    assert kwargs["unique"] is True
    # Partial: documents without a key must not collide with each other.
    assert kwargs["partialFilterExpression"] == {"idempotency_key": {"$type": "string"}}
    tickets._CREATE_INDEXED_DATABASE_IDS.clear()


def test_intake_candidates_match_open_tickets_and_respect_client(monkeypatch):
    captured = {}
    open_tickets = [
        {"id": "t-1", "ticket_number": "INC-0001", "title": "VPN drops for remote staff",
         "description": "", "status": "open", "priority": "high", "client_name": "Acme"},
        {"id": "t-2", "ticket_number": "INC-0002", "title": "Printer toner order",
         "description": "", "status": "open", "priority": "low", "client_name": "Acme"},
        # One shared word only: noise, not a duplicate candidate.
        {"id": "t-3", "ticket_number": "INC-0003", "title": "Overnight backup window change",
         "description": "", "status": "open", "priority": "low", "client_name": "Acme"},
    ]

    class Tickets:
        def find(self, query, projection):
            captured["query"] = query

            class Cursor:
                async def to_list(self, limit):
                    return list(open_tickets)

            return Cursor()

    monkeypatch.setattr(ticket_suggestions, "db", SimpleNamespace(tickets=Tickets()))
    result = asyncio.run(ticket_suggestions.intake_duplicate_candidates(
        title="VPN drops overnight", client_id="client-1",
        current_user={"id": "tech-1", "tenant_id": "tenant-a"},
    ))
    query_text = str(captured["query"])
    assert "client-1" in query_text
    assert "resolved" in query_text
    assert [c["ticket_id"] for c in result["candidates"]] == ["t-1"]
    assert result["candidates"][0]["relevance_score"] >= 2
    assert all(c["ticket_id"] != "t-3" for c in result["candidates"])


def test_intake_candidates_short_title_returns_empty_without_querying(monkeypatch):
    class Tickets:
        def find(self, *args, **kwargs):
            raise AssertionError("short titles must not query the ticket store")

    monkeypatch.setattr(ticket_suggestions, "db", SimpleNamespace(tickets=Tickets()))
    result = asyncio.run(ticket_suggestions.intake_duplicate_candidates(
        title="vpn", client_id="client-1",
        current_user={"id": "tech-1", "tenant_id": "tenant-a"},
    ))
    assert result["candidates"] == []


def test_intake_candidates_respect_restricted_client_scope(monkeypatch):
    captured = {}

    class Tickets:
        def find(self, query, projection):
            captured["query"] = query

            class Cursor:
                async def to_list(self, limit):
                    return []

            return Cursor()

    monkeypatch.setattr(ticket_suggestions, "db", SimpleNamespace(tickets=Tickets()))
    asyncio.run(ticket_suggestions.intake_duplicate_candidates(
        title="VPN drops overnight", client_id="client-2",
        current_user={"id": "tech-1", "tenant_id": "tenant-a",
                      "client_scope_mode": "clients", "client_scope_ids": ["client-1"]},
    ))
    query_text = str(captured["query"])
    assert "client-1" in query_text
    assert "$in" in query_text
