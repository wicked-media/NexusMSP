"""Tenant-bound regression coverage for ticket labour-type configuration."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import labour_types as labour_types_router
from app.services import labour_types as labour_types_service


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
            if "$exists" in expected and (key in row) != expected["$exists"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, _limit: int):
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])
        self.indexes: list[dict] = []
        self.queries: list[dict] = []

    async def create_index(self, keys, **kwargs):
        self.indexes.append({"keys": keys, **kwargs})
        return kwargs.get("name")

    def find(self, query, _projection=None):
        self.queries.append(deepcopy(query))
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query, _projection=None):
        self.queries.append(deepcopy(query))
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        self.queries.append(deepcopy(query))
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class _Database:
    def __init__(self, rows: list[dict] | None = None):
        self.labour_types = _Collection(rows)


def test_labour_type_resolver_is_tenant_bound_and_local_keeps_legacy_compatibility():
    asyncio.run(_test_labour_type_resolver_is_tenant_bound_and_local_keeps_legacy_compatibility())


async def _test_labour_type_resolver_is_tenant_bound_and_local_keeps_legacy_compatibility():
    database = _Database(
        [
            {"id": "remote", "tenant_id": "tenant-a", "name": "Remote", "is_active": True},
            {"id": "legacy", "name": "Legacy local", "is_active": True},
        ]
    )

    selected = await labour_types_service.resolve_labour_type(
        "remote", tenant_id="tenant-a", database=database
    )
    assert selected["tenant_id"] == "tenant-a"

    with pytest.raises(HTTPException) as denied:
        await labour_types_service.resolve_labour_type(
            "remote", tenant_id="tenant-b", database=database
        )
    assert denied.value.status_code == 422

    legacy = await labour_types_service.resolve_labour_type(
        "legacy", tenant_id="nexus-local", database=database
    )
    assert legacy["name"] == "Legacy local"

    with pytest.raises(HTTPException):
        await labour_types_service.resolve_labour_type(
            "legacy", tenant_id="tenant-a", database=database
        )

    assert any(query == {"$and": [{"id": "remote", "is_active": True}, {"tenant_id": "tenant-a"}]} for query in database.labour_types.queries)
    assert all("tenant-b" not in str(query) for query in database.labour_types.queries[:1])


def test_labour_type_router_scopes_list_create_update_and_archive(monkeypatch):
    asyncio.run(_test_labour_type_router_scopes_list_create_update_and_archive(monkeypatch))


async def _test_labour_type_router_scopes_list_create_update_and_archive(monkeypatch):
    database = _Database(
        [
            {
                "id": "shared-id",
                "tenant_id": "tenant-a",
                "name": "Tenant A remote",
                "code": "REMOTE",
                "hourly_rate": 120.0,
                "billable_default": True,
                "is_active": True,
                "sort_order": 1,
                "version": 1,
            },
            {
                "id": "shared-id",
                "tenant_id": "tenant-b",
                "name": "Tenant B remote",
                "code": "REMOTE",
                "hourly_rate": 200.0,
                "billable_default": True,
                "is_active": True,
                "sort_order": 1,
                "version": 1,
            },
        ]
    )
    monkeypatch.setattr(labour_types_router, "db", database)

    async def _no_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(labour_types_router, "log_activity", _no_activity)
    labour_types_service._INDEXED_DATABASE_IDS.discard(id(database))
    user = {"id": "admin-a", "name": "Admin A", "role": "admin", "tenant_id": "tenant-a"}

    available = await labour_types_router.list_available_labour_types(current_user=user)
    assert [item["name"] for item in available] == ["Tenant A remote"]

    created = await labour_types_router.create_labour_type(
        {
            "name": "Onsite engineering",
            "code": "ONSITE",
            "hourly_rate": 155,
            "billable_default": True,
        },
        request=SimpleNamespace(),
        current_user=user,
    )
    new_record = next(row for row in database.labour_types.rows if row["id"] == created["id"])
    assert new_record["tenant_id"] == "tenant-a"

    await labour_types_router.update_labour_type(
        "shared-id",
        {"expected_version": 1, "name": "Tenant A remote updated"},
        request=SimpleNamespace(),
        current_user=user,
    )
    assert database.labour_types.rows[0]["name"] == "Tenant A remote updated"
    assert database.labour_types.rows[1]["name"] == "Tenant B remote"

    await labour_types_router.archive_labour_type(
        "shared-id",
        expected_version=2,
        request=SimpleNamespace(),
        current_user=user,
    )
    assert database.labour_types.rows[0]["is_active"] is False
    assert database.labour_types.rows[1]["is_active"] is True

    index_names = {index["name"] for index in database.labour_types.indexes}
    assert {"labour_type_tenant_id_unique", "labour_type_tenant_available"} <= index_names
    for query in database.labour_types.queries:
        assert "tenant-b" not in str(query), f"cross-tenant labour query: {query}"
