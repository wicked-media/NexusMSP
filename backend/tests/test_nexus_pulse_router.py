"""Tenant-scope regression coverage for the Nexus Pulse read model."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.routers import nexus_pulse


class _Cursor:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]

    async def to_list(self, length):
        return self.rows[:length]


class _Collection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.find_queries = []

    def find(self, query, _projection):
        self.find_queries.append(query)
        return _Cursor(self.rows)


def test_pulse_applies_explicit_tenant_partition_to_all_source_queries(monkeypatch):
    fake_db = SimpleNamespace(
        devices=_Collection(),
        nexus_agents=_Collection(),
        tickets=_Collection(),
        workflow_runs=_Collection(),
        backup_jobs=_Collection(),
    )
    monkeypatch.setattr(nexus_pulse, "db", fake_db)
    user = {
        "id": "admin-a",
        "tenant_id": "tenant-a",
        "role": "admin",
        "is_admin": True,
    }

    asyncio.run(nexus_pulse.nexus_pulse_overview(current_user=user))

    collections = (
        fake_db.devices,
        fake_db.nexus_agents,
        fake_db.tickets,
        fake_db.workflow_runs,
        fake_db.backup_jobs,
    )
    assert all("tenant-a" in str(collection.find_queries[0]) for collection in collections)
