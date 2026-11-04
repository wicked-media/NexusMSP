import asyncio
from types import SimpleNamespace

from app.routers import ticket_ping


def test_ping_history_authorises_ticket_before_partitioned_read(monkeypatch):
    calls = []

    class Pings:
        def find(self, query, _projection):
            calls.append(query)
            return self

        def sort(self, *_args):
            return self

        async def to_list(self, _limit):
            return []

    async def permitted(user, collection, ticket_id, **kwargs):
        calls.append((user, collection, ticket_id, kwargs))
        return {"id": ticket_id, "tenant_id": "tenant-a"}

    tickets = object()
    monkeypatch.setattr(ticket_ping, "db", SimpleNamespace(tickets=tickets, ticket_pings=Pings()))
    monkeypatch.setattr(ticket_ping, "assert_tenant_record_scope", permitted)

    assert asyncio.run(ticket_ping.get_ticket_ping_history(
        "ticket-1", {"id": "tech-1", "tenant_id": "tenant-a"}
    )) == []
    assert calls[0][1] is tickets
    assert calls[1] == {"$and": [{"ticket_id": "ticket-1"}, {"tenant_id": "tenant-a"}]}
