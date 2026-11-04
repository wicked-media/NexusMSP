import asyncio
from types import SimpleNamespace

from app.services import ticket_participants


def test_participant_index_is_partitioned_by_tenant(monkeypatch):
    calls = []

    class Participants:
        async def update_one(self, query, update, **kwargs):
            calls.append((query, update, kwargs))

    monkeypatch.setattr(ticket_participants, "db", SimpleNamespace(ticket_participants=Participants()))

    asyncio.run(ticket_participants.sync_ticket_participants(
        ticket={"id": "ticket-1", "tenant_id": "tenant-a", "client_id": "client-1"},
        addresses=["customer@example.test"],
        role="recipient",
        direction="outbound",
    ))

    query, update, kwargs = calls[0]
    assert query["tenant_id"] == "tenant-a"
    assert update["$set"]["tenant_id"] == "tenant-a"
    assert kwargs["upsert"] is True
