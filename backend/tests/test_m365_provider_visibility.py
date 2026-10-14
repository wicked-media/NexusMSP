"""Fail-closed mapping tests for Microsoft provider evidence."""

import asyncio
from types import SimpleNamespace

from app.services.m365_provider_visibility import (
    m365_tenant_connection_query,
    m365_provider_evidence_query,
    m365_provider_tenant_query,
    visible_m365_provider_tenant_ids,
)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return list(self.rows)


class _Collection:
    def __init__(self, rows_by_call, captured, name):
        self.rows_by_call = list(rows_by_call)
        self.captured = captured
        self.name = name

    def find(self, query, _projection):
        calls = self.captured.setdefault(self.name, [])
        calls.append(query)
        index = len(calls) - 1
        rows = self.rows_by_call[min(index, len(self.rows_by_call) - 1)]
        return _Cursor(rows)


class _Database(SimpleNamespace):
    def __bool__(self):
        raise NotImplementedError("Database objects do not implement truth value testing")


def _database(client_rows, connection_calls, provider_calls, captured):
    return _Database(
        clients=_Collection([client_rows], captured, "clients"),
        m365_tenant_connections=_Collection(connection_calls, captured, "connections"),
        m365_tenants=_Collection(provider_calls, captured, "provider_tenants"),
    )


def _contains(value, expected):
    if value == expected:
        return True
    if isinstance(value, dict):
        return any(_contains(item, expected) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains(item, expected) for item in value)
    return False


def test_explicit_platform_actor_gets_only_mapped_provider_tenants():
    captured = {}
    store = _database(
        [{"id": "client-a", "cipp_tenant_id": "entra-a"}],
        [[{"tenant_id": "entra-b", "client_id": "client-a"}]],
        [[{"tenant_id": "entra-c", "id": "legacy-c", "client_id": "client-a"}]],
        captured,
    )

    visible = asyncio.run(
        visible_m365_provider_tenant_ids(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"},
            database=store,
        )
    )

    assert visible == {"entra-a", "entra-b", "entra-c", "legacy-c"}
    assert _contains(captured["clients"][0], {"tenant_id": "platform-a"})
    assert captured["connections"][0] == {"client_id": {"$in": ["client-a"]}}
    assert _contains(
        captured["provider_tenants"][0], {"client_id": {"$in": ["client-a"]}}
    )
    assert not _contains(captured["connections"][0], {"tenant_id": "platform-a"})

    tenant_query = m365_provider_tenant_query(visible)
    evidence_query = m365_provider_evidence_query(visible)
    assert _contains(tenant_query, {"tenant_id": {"$in": sorted(visible)}})
    assert _contains(tenant_query, {"id": {"$in": sorted(visible)}})
    assert _contains(evidence_query, {"tenant_id": {"$in": sorted(visible)}})
    assert not _contains(evidence_query, {"id": {"$in": sorted(visible)}})

    assert m365_tenant_connection_query(visible) == {
        "$or": [
            {"tenant_id": {"$in": sorted(visible)}},
            {"tenantId": {"$in": sorted(visible)}},
        ]
    }


def test_conflicting_provider_mapping_is_omitted_without_disclosing_the_owner():
    captured = {}
    store = _database(
        [{"id": "client-a", "cipp_tenant_id": "entra-a"}],
        [[], [
            {"tenant_id": "entra-a", "client_id": "client-a"},
            {"tenant_id": "entra-a", "client_id": "client-b"},
        ]],
        [[], []],
        captured,
    )

    visible = asyncio.run(
        visible_m365_provider_tenant_ids(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"},
            database=store,
        )
    )

    assert visible == set()
    assert m365_provider_evidence_query(visible) == {
        "$and": [
            {"source": {"$in": ["m365_graph", "m365_partner_center"]}},
            {"tenant_id": {"$in": []}},
        ]
    }


def test_legacy_local_administrator_keeps_the_documented_compatibility_path():
    assert asyncio.run(
        visible_m365_provider_tenant_ids({"id": "admin-local", "role": "admin"})
    ) is None


def test_connection_query_fails_closed_for_an_explicit_empty_mapping():
    assert m365_tenant_connection_query(set()) == {
        "$or": [
            {"tenant_id": {"$in": []}},
            {"tenantId": {"$in": []}},
        ]
    }
