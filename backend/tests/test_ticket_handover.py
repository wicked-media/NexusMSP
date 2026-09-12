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
    monkeypatch.setattr(tickets, "db", SimpleNamespace(ticket_comments=Rows(), tickets=Rows()))
    result = asyncio.run(tickets.get_ticket_handover("t", 0, {"id": "u", "tenant_id": "tenant-a"}))
    assert result["evidence"] == []
    assert all(query["$and"][1] == {"tenant_id": "tenant-a"} for query in queries)
    assert queries[1]["$and"][0]["client_id"] == "c"
