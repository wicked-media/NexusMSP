import asyncio
from types import SimpleNamespace

from app.routers import ticket_email_notifications


def test_notification_history_authorises_parent_and_scopes_history(monkeypatch):
    calls = []

    class History:
        def find(self, query, _projection):
            calls.append(query)
            return self

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return []

    async def permitted(user, collection, ticket_id, **kwargs):
        calls.append((user, collection, ticket_id, kwargs))
        return {"id": ticket_id, "tenant_id": "tenant-a", "client_id": "client-a"}

    tickets = object()
    monkeypatch.setattr(ticket_email_notifications, "db", SimpleNamespace(
        tickets=tickets, ticket_email_notifications=History(),
    ))
    monkeypatch.setattr(ticket_email_notifications, "assert_tenant_record_scope", permitted)

    result = asyncio.run(ticket_email_notifications.get_ticket_notification_history(
        "ticket-1", {"id": "tech-1", "tenant_id": "tenant-a"}
    ))

    assert result == []
    assert calls[0][1] is tickets
    assert calls[0][2] == "ticket-1"
    assert calls[1] == {"$and": [{"ticket_id": "ticket-1"}, {"tenant_id": "tenant-a"}]}
