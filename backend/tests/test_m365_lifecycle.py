"""Regression tests for the read-only Nexus 365 lifecycle evidence boundary."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import m365_lifecycle
from app.services.m365_lifecycle import build_client_lifecycle_readiness, build_lifecycle_readiness


def test_lifecycle_readiness_reports_evidence_without_exposing_people_or_executing_actions():
    result = build_client_lifecycle_readiness(
        {"id": "client-a", "name": "Acme", "cipp_tenant_id": "tenant-a"},
        tenant_connections=[{"tenant_id": "tenant-a", "client_id": "client-a", "graph_verified": True}],
        provider_tenants=[{"tenant_id": "tenant-a", "source": "m365_graph", "updated_at": "2026-08-21T10:00:00+00:00"}],
        provider_users=[
            {"tenant_id": "tenant-a", "account_enabled": True, "assigned_licenses": ["sku-a"], "upn": "licensed@example.test"},
            {"tenant_id": "tenant-a", "account_enabled": True, "assigned_licenses": [], "upn": "unlicensed@example.test"},
            {"tenant_id": "tenant-a", "account_enabled": False, "assigned_licenses": ["sku-a"], "upn": "disabled@example.test"},
        ],
        provider_licenses=[{"tenant_id": "tenant-a", "total_units": 10, "consumed_units": 9}],
        cipp_actions=[{"tenant_id": "tenant-a", "action": "offboard_user", "timestamp": "2026-08-21T11:00:00+00:00", "user_id": "sensitive"}],
    )

    assert result["state"] == "attention_required"
    assert result["lifecycle_counts"] == {
        "provider_users": 3,
        "active_users": 2,
        "unlicensed_active_users": 1,
        "disabled_licensed_users": 1,
        "low_stock_skus": 1,
    }
    assert {finding["key"] for finding in result["findings"]} == {
        "active_users_without_licence",
        "disabled_users_with_licence",
        "low_licence_stock",
    }
    assert result["evidence"]["provider_action_audit"]["action_types"] == {"offboard_user": 1}
    assert "unlicensed@example.test" not in repr(result)
    assert "sensitive" not in repr(result)
    assert all(handoff["execution_state"] == "not_started" for handoff in result["safe_handoffs"])
    assert "No Microsoft" in result["boundary"]


def test_lifecycle_readiness_marks_unknowns_as_evidence_gaps_not_passes():
    result = build_lifecycle_readiness(
        [{"id": "client-a", "name": "Acme", "cipp_tenant_id": "tenant-a"}],
        tenant_connections=[{"tenant_id": "tenant-a", "client_id": "client-a", "graph_verified": True}],
        generated_at="2026-08-21T12:00:00+00:00",
    )

    row = result["clients"][0]
    assert result["generated_at"] == "2026-08-21T12:00:00+00:00"
    assert row["state"] == "evidence_incomplete"
    assert row["evidence"]["provider_snapshot"]["state"] == "not_available"
    assert any(gap["key"] == "provider_snapshot_missing" for gap in row["evidence_gaps"])
    assert result["summary"]["ready_for_planning"] == 0


def test_lifecycle_readiness_requires_stable_client_to_tenant_mapping():
    result = build_client_lifecycle_readiness({"id": "client-a", "name": "Acme"})

    assert result["state"] == "attention_required"
    assert result["tenant"]["state"] == "not_mapped"
    assert result["findings"][0]["key"] == "tenant_unmapped"


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    async def to_list(self, *_args, **_kwargs):
        return list(self.rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.queries = []

    def find(self, query, _projection=None):
        self.queries.append(query)
        return _Cursor(self.rows)

    async def find_one(self, query, _projection=None):
        return next((row for row in self.rows if row.get("id") == query.get("id")), None)


def _database(client_rows):
    return SimpleNamespace(
        clients=_Collection(client_rows),
        m365_tenant_connections=_Collection(),
        m365_tenants=_Collection(),
        m365_users=_Collection(),
        m365_licenses=_Collection(),
        cipp_actions=_Collection(),
    )


def _restricted_user():
    return {
        "id": "tech-a",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def test_lifecycle_portfolio_query_is_server_scoped(monkeypatch):
    fake_db = _database([{"id": "client-a", "name": "Acme"}])
    monkeypatch.setattr(m365_lifecycle, "db", fake_db)

    asyncio.run(m365_lifecycle.lifecycle_readiness(current_user=_restricted_user()))

    assert fake_db.clients.queries == [
        {
            "$and": [
                {"id": {"$exists": True, "$ne": ""}},
                {"id": {"$in": ["client-a"]}},
            ]
        }
    ]


def test_client_lifecycle_masks_a_foreign_client_before_loading_evidence(monkeypatch):
    fake_db = _database([{"id": "client-b", "name": "Foreign client", "cipp_tenant_id": "tenant-b"}])
    calls = []

    async def reject_scope(*args, **kwargs):
        calls.append((args, kwargs))
        raise HTTPException(status_code=404, detail="Resource not found")

    monkeypatch.setattr(m365_lifecycle, "db", fake_db)
    monkeypatch.setattr(m365_lifecycle, "assert_client_scope", reject_scope)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            m365_lifecycle.client_lifecycle_readiness(
                "client-b",
                request=SimpleNamespace(),
                current_user=_restricted_user(),
            )
        )

    assert exc.value.status_code == 404
    assert calls[0][0][1] == "client-b"
    assert calls[0][1]["operation"] == "m365.lifecycle.read"
    assert calls[0][1]["mask_not_found"] is True
    assert not fake_db.m365_users.queries
