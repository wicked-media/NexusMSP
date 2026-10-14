"""Regression coverage for the shared Nexus tenant query boundary."""

from __future__ import annotations

from app.services.scope_permissions import tenant_scoped_query


def _matches(row: dict, query: dict) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$exists" in expected and (key in row) != expected["$exists"]:
                return False
        elif actual != expected:
            return False
    return True


def test_explicit_tenant_cannot_read_another_tenant_or_unbound_legacy_rows():
    query = tenant_scoped_query({"tenant_id": "tenant-a"}, {"client_id": "client-a"})

    assert _matches({"tenant_id": "tenant-a", "client_id": "client-a"}, query)
    assert not _matches({"tenant_id": "tenant-b", "client_id": "client-a"}, query)
    assert not _matches({"client_id": "client-a"}, query)


def test_legacy_local_partition_is_explicit_and_never_includes_other_tenants():
    query = tenant_scoped_query({}, {"client_id": "client-local"})

    assert _matches({"tenant_id": "nexus-local", "client_id": "client-local"}, query)
    assert _matches({"client_id": "client-local"}, query)
    assert not _matches({"tenant_id": "tenant-a", "client_id": "client-local"}, query)
