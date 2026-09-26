import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from app.services.ticket_handover import build_handover
from app.routers import tickets


def test_handover_filters_dates_and_never_claims_verification():
    result = build_handover({"id": "a", "description": "<p>Request</p>"}, [
        {"id": "old", "created_at": "2026-01-01T00:00:00Z"},
        {"id": "new", "created_at": "2026-09-05T00:00:00Z", "content": "<b>Restart attempted</b>", "is_internal": True},
        {"id": "bad", "created_at": "unknown"},
    ], [{"id": "done", "status": "closed"}, {"id": "open", "status": "open"}], since=datetime(2026, 9, 1, tzinfo=timezone.utc))
    assert [r["id"] for r in result["evidence"]] == ["new"]
    assert result["evidence"][0]["text"] == "Restart attempted"
    assert result["evidence"][0]["internal"] is True
    assert result["undated_notes"] == 1
    assert [r["id"] for r in result["open_children"]] == ["open"]
    assert "not verification" in result["scope"]


def test_scope_denial_prevents_evidence_reads(monkeypatch):
    async def deny(*args):
        raise HTTPException(status_code=403, detail="Forbidden")
    monkeypatch.setattr(tickets, "_ticket_in_scope", deny)
    monkeypatch.setattr(tickets, "db", SimpleNamespace())
    with pytest.raises(HTTPException) as error:
        asyncio.run(tickets.get_ticket_handover("foreign", 24, {"id": "u"}))
    assert error.value.status_code == 403


def test_queries_are_tenant_scoped_and_read_only(monkeypatch):
    queries = []
    class Rows:
        def find(self, query, projection):
            queries.append(query)
            return self
        def sort(self, *args):
            return self
        async def to_list(self, limit):
            return []
    async def permitted(*args):
        return {"id": "t", "client_id": "c"}
    monkeypatch.setattr(tickets, "_ticket_in_scope", permitted)
    monkeypatch.setattr(tickets, "db", SimpleNamespace(ticket_comments=Rows(), tickets=Rows(), ticket_subscriptions=Rows()))
    result = asyncio.run(tickets.get_ticket_handover("t", 0, {"id": "u", "tenant_id": "tenant-a"}))
    assert result["evidence"] == []
    assert all(query["$and"][1] == {"tenant_id": "tenant-a"} for query in queries[:2])
    assert queries[1]["$and"][0]["client_id"] == "c"
    assert queries[2] == {"tenant_id": "tenant-a", "ticket_id": "t", "active": True}


def test_child_ticket_list_is_tenant_scoped_after_parent_authorisation(monkeypatch):
    class Rows:
        def __init__(self):
            self.query = None

        def find(self, query, _projection):
            self.query = query
            return self

        async def to_list(self, _limit):
            return []

    rows = Rows()

    async def permitted(*_args):
        return {"id": "parent-1", "client_id": "client-1"}

    monkeypatch.setattr(tickets, "_ticket_in_scope", permitted)
    monkeypatch.setattr(tickets, "db", SimpleNamespace(tickets=rows))

    assert asyncio.run(tickets.get_child_tickets(
        "parent-1", {"id": "tech-1", "tenant_id": "tenant-a"}
    )) == []
    assert rows.query == {
        "$and": [
            {"parent_id": "parent-1", "client_id": "client-1"},
            {"tenant_id": "tenant-a"},
        ],
    }


def test_ticket_queue_side_reads_keep_tenant_scope(monkeypatch):
    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return self.rows

    class TicketRows:
        def __init__(self):
            self.query = None

        def find(self, query, _projection):
            self.query = query
            return Cursor([{"id": "ticket-1"}])

    class CommentRows:
        def __init__(self):
            self.queries = []

        async def count_documents(self, query):
            self.queries.append(query)
            return 2

    class ClientRows:
        def __init__(self):
            self.query = None

        def find(self, query, _projection):
            self.query = query
            return Cursor([])

    ticket_rows = TicketRows()
    comment_rows = CommentRows()
    client_rows = ClientRows()
    user = {"id": "tech-1", "tenant_id": "tenant-a"}
    monkeypatch.setattr(tickets, "db", SimpleNamespace(
        tickets=ticket_rows,
        ticket_comments=comment_rows,
        clients=client_rows,
    ))

    assert asyncio.run(tickets.get_ticket_note_counts(user)) == {"ticket-1": 2}
    assert comment_rows.queries == [{
        "$and": [{"ticket_id": "ticket-1"}, {"tenant_id": "tenant-a"}],
    }]
    asyncio.run(tickets._attach_client_branding([{"client_id": "client-1"}], user))
    assert client_rows.query == {
        "$and": [{"id": {"$in": ["client-1"]}}, {"tenant_id": "tenant-a"}],
    }


def test_handover_returns_active_subscriber_profiles(monkeypatch):
    class Rows:
        def __init__(self, rows):
            self.rows = rows

        def find(self, _query, _projection):
            return self

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return self.rows

    async def permitted(*_args):
        return {"id": "t", "client_id": "c"}

    monkeypatch.setattr(tickets, "_ticket_in_scope", permitted)
    monkeypatch.setattr(tickets, "db", SimpleNamespace(
        ticket_comments=Rows([]),
        tickets=Rows([]),
        ticket_subscriptions=Rows([{"user_id": "tech-1"}]),
        users=Rows([{"id": "tech-1", "name": "Robin"}]),
    ))
    result = asyncio.run(tickets.get_ticket_handover("t", 0, {"id": "u", "tenant_id": "tenant-a"}))
    assert result["subscribers"] == [{"user_id": "tech-1", "user": {"id": "tech-1", "name": "Robin"}}]


def test_ticket_audit_preserves_structured_subscriber_evidence(monkeypatch):
    class AuditLog:
        def __init__(self):
            self.entries = []

        async def insert_one(self, entry):
            self.entries.append(entry)

    audit_log = AuditLog()
    monkeypatch.setattr(tickets, "db", SimpleNamespace(ticket_audit_log=audit_log))

    asyncio.run(tickets.ticket_audit(
        "ticket-1",
        {"id": "actor-1", "name": "Alex"},
        "ticket_subscriber_added",
        "Subscribed Robin to ticket updates",
        metadata={"subscriber_user_id": "tech-1", "subscriber_name": "Robin", "subscription_active": True},
    ))

    assert audit_log.entries[0]["metadata"] == {
        "subscriber_user_id": "tech-1",
        "subscriber_name": "Robin",
        "subscription_active": True,
    }


def test_subscriber_change_records_target_in_audit_metadata(monkeypatch):
    class Users:
        async def find_one(self, _query, _projection):
            return {"id": "tech-1", "name": "Robin"}

    class Subscriptions:
        async def update_one(self, *_args, **_kwargs):
            return None

    audit_calls = []

    async def ticket_in_scope(*_args):
        return {"id": "ticket-1", "client_id": "client-1", "site_id": "site-1"}

    async def indexes():
        return None

    async def audit(*args, **kwargs):
        audit_calls.append((args, kwargs))

    async def subscribers(*_args):
        return {"ticket_id": "ticket-1", "subscribers": [], "subscribed": True}

    monkeypatch.setattr(tickets, "db", SimpleNamespace(users=Users(), ticket_subscriptions=Subscriptions()))
    monkeypatch.setattr(tickets, "_ticket_in_tenant_scope", ticket_in_scope)
    monkeypatch.setattr(tickets, "ensure_ticket_subscription_indexes", indexes)
    monkeypatch.setattr(tickets, "ticket_audit", audit)
    monkeypatch.setattr(tickets, "get_ticket_subscribers", subscribers)

    result = asyncio.run(tickets.update_ticket_subscriber(
        "ticket-1",
        tickets.TicketSubscriptionUpdate(user_id="tech-1", subscribed=True),
        {"id": "tech-1", "name": "Robin", "tenant_id": "tenant-a"},
    ))

    assert result["subscribed"] is True
    assert audit_calls[0][0][2] == "ticket_subscriber_added"
    assert audit_calls[0][1]["metadata"] == {
        "subscriber_user_id": "tech-1",
        "subscriber_name": "Robin",
        "subscription_active": True,
    }


def test_dashboard_subscribed_tickets_remains_tenant_and_client_scoped(monkeypatch):
    class Subscriptions:
        def __init__(self):
            self.query = None

        def find(self, query, _projection):
            self.query = query
            return self

        async def to_list(self, _limit):
            return [{"ticket_id": "ticket-1"}]

    class TicketRows:
        def __init__(self):
            self.query = None

        def find(self, query, _projection):
            self.query = query
            return self

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return [{"id": "ticket-1", "title": "Followed work", "client_id": "client-1"}]

    subscriptions = Subscriptions()
    ticket_rows = TicketRows()
    async def indexes():
        return None
    monkeypatch.setattr(tickets, "db", SimpleNamespace(ticket_subscriptions=subscriptions, tickets=ticket_rows))
    monkeypatch.setattr(tickets, "ensure_ticket_subscription_indexes", indexes)

    result = asyncio.run(tickets.list_my_subscribed_tickets(
        {"id": "tech-1", "role": "admin", "tenant_id": "tenant-a"}
    ))

    assert result["total"] == 1
    assert subscriptions.query == {"tenant_id": "tenant-a", "user_id": "tech-1", "active": True}
    assert ticket_rows.query == {"$and": [{"id": {"$in": ["ticket-1"]}}, {"tenant_id": "tenant-a"}]}
