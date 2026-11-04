"""Tenant and client-scope regression coverage for Proving Ground."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.routers import nexus_proving_ground


class _Cursor:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]

    def sort(self, *_args):
        return self

    async def to_list(self, length):
        return self.rows[:length]


class _Collection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.find_queries = []

    def find(self, query, _projection):
        self.find_queries.append(query)
        return _Cursor(self.rows)


def _fake_db():
    return SimpleNamespace(
        workflows=_Collection(),
        workflow_simulations=_Collection(),
        workflow_runs=_Collection(),
        change_requests=_Collection(),
        production_readiness_items=_Collection(),
    )


def test_restricted_workflow_query_requires_structured_scope_and_tenant_partition():
    query = nexus_proving_ground._workflow_query({
        "id": "tech-a",
        "tenant_id": "tenant-a",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    })

    rendered = str(query)
    assert "tenant-a" in rendered
    assert "scope.type" in rendered
    assert "scope.client_id" in rendered
    assert "'client_id': {'$in'" not in rendered


def test_overview_applies_explicit_tenant_partition_to_every_operational_query(monkeypatch):
    fake_db = _fake_db()
    monkeypatch.setattr(nexus_proving_ground, "db", fake_db)

    async def denied_readiness(_user, _action):
        return {"allowed": False}

    monkeypatch.setattr(nexus_proving_ground, "evaluate_action_permission", denied_readiness)
    user = {
        "id": "admin-a",
        "tenant_id": "tenant-a",
        "role": "admin",
        "is_admin": True,
    }

    response = asyncio.run(nexus_proving_ground.proving_ground_overview(current_user=user))

    assert response["readiness"]["state"] == "not_authorised"
    collections = (
        fake_db.workflows,
        fake_db.workflow_simulations,
        fake_db.workflow_runs,
        fake_db.change_requests,
    )
    assert all("tenant-a" in str(collection.find_queries[0]) for collection in collections)
