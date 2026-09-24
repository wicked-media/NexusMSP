import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.routers import mega_features
from app.routers.mega_features import _timeline_audit_event


def test_timeline_uses_current_audit_action_details():
    event = _timeline_audit_event(
        {"action": "ticket_subscriber_added", "details": "Subscribed Mike Rodriguez to ticket updates"}
    )

    assert event == {
        "type": "audit",
        "icon": "shuffle",
        "label": "Subscribed Mike Rodriguez to ticket updates",
    }


def test_timeline_keeps_legacy_status_change_readable():
    event = _timeline_audit_event(
        {"field": "status", "old_value": "open", "new_value": "in_progress"}
    )

    assert event == {
        "type": "status_change",
        "icon": "shuffle",
        "label": "status: open → in_progress",
    }


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    def limit(self, *_args):
        return self

    async def to_list(self, *_args):
        return self.rows


class _Collection:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def find(self, query, _projection):
        self.queries.append(query)
        return _Cursor(self.rows)


def test_apology_draft_uses_authorised_ticket_and_current_conversation(monkeypatch):
    comments = _Collection([{"id": "comment-1", "content": "We are investigating", "user_name": "Ava", "created_at": "2026-09-24T00:00:00+00:00"}])
    notes = _Collection([])
    monkeypatch.setattr(mega_features, "db", SimpleNamespace(tickets=object(), ticket_comments=comments, ticket_notes=notes))
    scoped_ticket = {"id": "ticket-1", "ticket_number": "SR-1", "title": "Mail delay", "priority": "high"}
    authorise = AsyncMock(return_value=scoped_ticket)
    monkeypatch.setattr(mega_features, "assert_tenant_record_scope", authorise)
    monkeypatch.setattr(mega_features, "tenant_scoped_query", lambda _user, query: {"scoped": query})
    monkeypatch.setattr(mega_features, "_llm", AsyncMock(return_value='{"subject":"Update","body":"Body","makegood":"Review","tone":"warm"}'))

    result = asyncio.run(
        mega_features.apology_draft(
            "ticket-1",
            {"reason": "Delay"},
            {"id": "tech-1", "tenant_id": "tenant-1"},
        )
    )

    assert result["ticket_id"] == "ticket-1"
    assert authorise.await_args.args[2] == "ticket-1"
    assert comments.queries == [{"scoped": {"ticket_id": "ticket-1"}}]
