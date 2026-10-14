"""Scope-boundary coverage for the SOC Realtime evidence feed."""

import asyncio
from types import SimpleNamespace

from app.routers import soc


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


def _client_allowlist(query):
    if "client_id" in query:
        return set(query["client_id"].get("$in") or [])
    for clause in query.get("$and", []):
        if "client_id" in clause:
            return set(clause["client_id"].get("$in") or [])
    return None


class _RealtimeEvents:
    def __init__(self, rows):
        self.rows = list(rows)
        self.find_queries = []

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        allowed_client_ids = _client_allowlist(query)
        visible = [
            row
            for row in self.rows
            if allowed_client_ids is None or row.get("client_id") in allowed_client_ids
        ]
        return _Cursor(visible)


def _restricted_user():
    return {
        "id": "tech-a",
        "name": "Scoped Technician",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def test_soc_realtime_events_and_stats_exclude_foreign_client_evidence(monkeypatch):
    events = _RealtimeEvents([
        {"id": "event-a", "client_id": "client-a", "severity": "critical", "action": "blocked"},
        {"id": "event-b", "client_id": "client-b", "severity": "high", "status": "investigating"},
    ])
    monkeypatch.setattr(soc, "db", SimpleNamespace(soc_realtime_events=events))

    response = asyncio.run(soc.get_soc_realtime_events(current_user=_restricted_user()))

    assert [event["id"] for event in response["events"]] == ["event-a"]
    assert response["stats"] == {
        "total_events_24h": 1,
        "critical": 1,
        "high": 0,
        "medium": 0,
        "blocked": 1,
        "investigating": 0,
    }
    assert response["feed_type"] == "polling"
    assert response["evidence_state"] == "recorded_events_only"
    assert _client_allowlist(events.find_queries[0]) == {"client-a"}
