"""Tenant, validation and derived-state contracts for the on-call roster."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import on_call, tech_roster


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
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$lte" in expected and not actual <= expected["$lte"]:
                return False
            if "$gte" in expected and not actual >= expected["$gte"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])
        self.queries = []

    def find(self, query, _projection=None):
        self.queries.append(deepcopy(query))
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query, _projection=None):
        self.queries.append(deepcopy(query))
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


def test_shift_payload_requires_a_bounded_valid_window_and_known_tier():
    valid = on_call._normalise_shift_payload({
        "tech_id": "tech-a",
        "shift_type": "secondary",
        "category": "security",
        "start_time": "2026-09-12T08:00:00+10:00",
        "end_time": "2026-09-12T20:00:00+10:00",
    })
    assert valid["shift_type"] == "secondary"
    assert valid["start_time"].endswith("+00:00")

    with pytest.raises(HTTPException, match="after start_time"):
        on_call._normalise_shift_payload({
            "tech_id": "tech-a",
            "start_time": "2026-09-12T20:00:00Z",
            "end_time": "2026-09-12T08:00:00Z",
        })
    with pytest.raises(HTTPException, match="primary, secondary or lead"):
        on_call._normalise_shift_payload({
            "tech_id": "tech-a",
            "shift_type": "manager",
            "start_time": "2026-09-12T08:00:00Z",
            "end_time": "2026-09-12T20:00:00Z",
        })


def test_roster_read_is_tenant_bound_and_on_call_is_derived(monkeypatch):
    asyncio.run(_test_roster_read_is_tenant_bound_and_on_call_is_derived(monkeypatch))


async def _test_roster_read_is_tenant_bound_and_on_call_is_derived(monkeypatch):
    database = SimpleNamespace(
        tech_roster=_Collection([
            {"id": "tech-a", "tenant_id": "tenant-a", "name": "A", "active": True, "on_call": False, "escalation_tier": 1},
            {"id": "tech-b", "tenant_id": "tenant-b", "name": "B", "active": True, "on_call": True, "escalation_tier": 1},
        ]),
        on_call_roster=_Collection([
            {"id": "shift-a", "tenant_id": "tenant-a", "tech_id": "tech-a", "start_time": "2000-01-01T00:00:00+00:00", "end_time": "2999-01-01T00:00:00+00:00", "status": "scheduled"},
            {"id": "shift-b", "tenant_id": "tenant-b", "tech_id": "tech-b", "start_time": "2000-01-01T00:00:00+00:00", "end_time": "2999-01-01T00:00:00+00:00", "status": "scheduled"},
        ]),
    )
    monkeypatch.setattr(tech_roster, "db", database)
    user = {"id": "admin-a", "role": "admin", "tenant_id": "tenant-a"}

    rows = await tech_roster.list_technicians(on_call_only=True, current_user=user)

    assert [row["id"] for row in rows] == ["tech-a"]
    assert rows[0]["on_call"] is True
    assert all("tenant-b" not in str(query) for collection in (database.tech_roster, database.on_call_roster) for query in collection.queries)


def test_explicit_tenant_cannot_select_another_tenants_roster_contact(monkeypatch):
    asyncio.run(_test_explicit_tenant_cannot_select_another_tenants_roster_contact(monkeypatch))


async def _test_explicit_tenant_cannot_select_another_tenants_roster_contact(monkeypatch):
    database = SimpleNamespace(tech_roster=_Collection([
        {"id": "tech-b", "tenant_id": "tenant-b", "name": "B", "active": True},
    ]))
    monkeypatch.setattr(on_call, "db", database)

    with pytest.raises(HTTPException, match="this organisation"):
        await on_call._scoped_roster_contact({"tenant_id": "tenant-a"}, "tech-b")
