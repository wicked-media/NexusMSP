"""Focused tenant/client-boundary coverage for legacy Security Dashboard reads."""

import asyncio
from types import SimpleNamespace

from app.routers import security_dashboard


class _Cursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.find_queries = []
        self.count_queries = []

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor(self.rows)

    async def count_documents(self, query):
        self.count_queries.append(query)
        return 0


def _restricted_user():
    return {
        "id": "tech-a",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _has_scope(query):
    if query.get("client_id") == {"$in": ["client-a"]}:
        return True
    return {"client_id": {"$in": ["client-a"]}} in query.get("$and", [])


def test_security_dashboard_compatibility_reads_are_client_scoped(monkeypatch):
    devices = _Collection()
    alerts = _Collection()
    events = _Collection()
    canaries = _Collection()
    snapshots = _Collection()
    monkeypatch.setattr(
        security_dashboard,
        "db",
        SimpleNamespace(
            devices=devices,
            soc_alerts=alerts,
            threat_events=events,
            canary_triggers=canaries,
            security_dashboard_snapshots=snapshots,
        ),
    )

    current_user = _restricted_user()
    asyncio.run(security_dashboard.get_security_overview(current_user=current_user))
    asyncio.run(security_dashboard.get_score_trend(current_user=current_user))

    assert all(_has_scope(query) for query in devices.find_queries)
    assert all(_has_scope(query) for query in alerts.find_queries)
    assert all(_has_scope(query) for query in events.find_queries)
    assert all(_has_scope(query) for query in canaries.count_queries)
    assert all(_has_scope(query) for query in snapshots.find_queries)
