"""Tenant-isolation regression coverage for Yeastar billing snapshots.

The manual recalculation endpoint is permitted for a technician with a
restricted client scope, but it must only read and write PBX billing data for
the clients in that scope.  Global users retain the existing whole-fleet
recalculation behaviour.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.routers import yeastar


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, expected in (query or {}).items():
        actual: Any = row
        for segment in key.split("."):
            if not isinstance(actual, dict):
                actual = None
                break
            actual = actual.get(segment)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = [dict(row) for row in rows]

    def sort(self, *_args: Any):
        return self

    async def to_list(self, _length: int) -> list[dict[str, Any]]:
        return [dict(row) for row in self.rows]


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = [dict(row) for row in (rows or [])]
        self.find_queries: list[dict[str, Any]] = []
        self.find_one_queries: list[dict[str, Any]] = []
        self.inserted: list[dict[str, Any]] = []

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> _Cursor:
        self.find_queries.append(dict(query))
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(
        self,
        query: dict[str, Any],
        _projection: dict[str, Any] | None = None,
        sort: list[tuple[str, int]] | None = None,
    ) -> dict[str, Any] | None:
        self.find_one_queries.append(dict(query))
        matches = [row for row in self.rows if _matches(row, query)]
        if sort:
            field, direction = sort[0]
            matches.sort(key=lambda row: row.get(field, ""), reverse=direction < 0)
        return dict(matches[0]) if matches else None

    async def insert_one(self, row: dict[str, Any]) -> None:
        record = dict(row)
        self.rows.append(record)
        self.inserted.append(record)


class _Db:
    def __init__(self):
        self.logged_activity: list[dict[str, Any]] = []
        self.yeastar_pbxs = _Collection([
            {"id": "pbx-a", "client_id": "client-a", "client_name": "Client A", "name": "PBX A", "enabled": True},
            {"id": "pbx-b", "client_id": "client-b", "client_name": "Client B", "name": "PBX B", "enabled": True},
        ])
        self.yeastar_billing_snapshots = _Collection([
            {"id": "old-a", "pbx_id": "pbx-a", "client_id": "client-a", "billable_quantity": 2, "created_at": "2026-08-21T00:00:00+00:00"},
            {"id": "old-b", "pbx_id": "pbx-b", "client_id": "client-b", "billable_quantity": 5, "created_at": "2026-08-21T00:00:00+00:00"},
            {"id": "global-summary", "billable_quantity": 7, "created_at": "2026-08-21T00:00:00+00:00"},
        ])
        self.yeastar_sync_history = _Collection([
            {"id": "sync-a", "pbx_id": "pbx-a", "client_id": "client-a", "status": "success", "started_at": "2026-08-22T00:00:00+00:00"},
            {"id": "sync-b", "pbx_id": "pbx-b", "client_id": "client-b", "status": "success", "started_at": "2026-08-22T01:00:00+00:00"},
        ])
        self.yeastar_extension_cache = _Collection([
            {"id": "extension-a", "pbx_id": "pbx-a", "client_id": "client-a", "included_in_billing": True},
            {"id": "extension-b", "pbx_id": "pbx-b", "client_id": "client-b", "included_in_billing": True},
        ])
        self.activity_logs = _Collection([
            {"id": "activity-a", "entity_type": "voice_billing", "metadata": {"client_id": "client-a"}, "created_at": "2026-08-22T00:00:00+00:00"},
            {"id": "activity-b", "entity_type": "voice_billing", "metadata": {"client_id": "client-b"}, "created_at": "2026-08-22T01:00:00+00:00"},
            {"id": "activity-global", "entity_type": "voice_provider", "metadata": {}, "created_at": "2026-08-22T02:00:00+00:00"},
        ])


def _client_a_technician() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "email": "tech-a@example.test",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_voice_billing(monkeypatch: pytest.MonkeyPatch) -> _Db:
    fake_db = _Db()

    async def extensions(_current_user: dict[str, Any], pbx: dict[str, Any]):
        if pbx["id"] == "pbx-a":
            return [
                {"number": "100", "included_in_billing": True},
                {"number": "101", "included_in_billing": True},
                {"number": "102", "included_in_billing": True},
            ]
        return [
            {"number": "200", "included_in_billing": True},
            {"number": "201", "included_in_billing": True},
            {"number": "202", "included_in_billing": True},
            {"number": "203", "included_in_billing": True},
        ]

    async def log_activity(*_args: Any, **kwargs: Any) -> None:
        fake_db.logged_activity.append(dict(kwargs.get("metadata") or {}))
        return None

    monkeypatch.setattr(yeastar, "db", fake_db)
    monkeypatch.setattr(yeastar, "_voice_extensions_with_overrides", extensions)
    monkeypatch.setattr(yeastar, "log_activity", log_activity)
    return fake_db


def test_recalculate_billing_only_reads_and_writes_the_technicians_client_scope(monkeypatch: pytest.MonkeyPatch):
    """Client A cannot trigger billing snapshots for Client B's PBX."""
    fake_db = _install_voice_billing(monkeypatch)

    result = asyncio.run(yeastar.recalculate_yeastar_billing(_client_a_technician()))

    assert result["pbx_count"] == 1
    assert [snapshot["pbx_id"] for snapshot in result["by_pbx"]] == ["pbx-a"]
    assert result["billable_quantity"] == 3
    assert fake_db.yeastar_pbxs.find_queries == [{"client_id": {"$in": ["client-a"]}}]
    assert all(snapshot.get("client_id") != "client-b" for snapshot in fake_db.yeastar_billing_snapshots.inserted)
    assert [snapshot["pbx_id"] for snapshot in fake_db.yeastar_billing_snapshots.inserted] == ["pbx-a"]
    assert fake_db.yeastar_billing_snapshots.find_one_queries == [
        {"pbx_id": "pbx-a", "client_id": {"$in": ["client-a"]}},
    ]
    assert fake_db.logged_activity[-1]["client_id"] == "client-a"


def test_recalculate_billing_fails_closed_when_a_technician_has_no_assigned_clients(monkeypatch: pytest.MonkeyPatch):
    """An unassigned technician cannot turn an empty scope into a fleet-wide run."""
    fake_db = _install_voice_billing(monkeypatch)

    result = asyncio.run(yeastar.recalculate_yeastar_billing({"id": "tech-unassigned", "role": "technician"}))

    assert result["pbx_count"] == 0
    assert result["billable_quantity"] == 0
    assert result["by_pbx"] == []
    assert fake_db.yeastar_pbxs.find_queries == [{"client_id": {"$in": []}}]
    assert fake_db.yeastar_billing_snapshots.inserted == []


def test_global_recalculate_keeps_authorised_whole_fleet_behaviour(monkeypatch: pytest.MonkeyPatch):
    """Administrators may still capture one whole-fleet summary after both PBXs."""
    fake_db = _install_voice_billing(monkeypatch)

    result = asyncio.run(yeastar.recalculate_yeastar_billing({"id": "admin-1", "email": "admin@example.test", "is_admin": True}))

    assert result["pbx_count"] == 2
    assert result["billable_quantity"] == 7
    assert fake_db.yeastar_pbxs.find_queries == [{}]
    assert [snapshot.get("pbx_id") for snapshot in fake_db.yeastar_billing_snapshots.inserted] == ["pbx-a", "pbx-b", None]
    assert fake_db.yeastar_billing_snapshots.inserted[-1]["source"] == "manual_recalculate_summary"
    assert "client_id" not in fake_db.logged_activity[-1]


def test_voice_workspace_returns_only_client_scoped_billing_and_operational_history(monkeypatch: pytest.MonkeyPatch):
    """A Client A technician cannot read Client B through the Voice workspace payload."""
    _install_voice_billing(monkeypatch)

    workspace = asyncio.run(yeastar.yeastar_voice_workspace(_client_a_technician()))

    assert [pbx["id"] for pbx in workspace["pbxs"]] == ["pbx-a"]
    assert [entry["id"] for entry in workspace["billing"]["history"]] == ["old-a"]
    assert [entry["id"] for entry in workspace["sync_history"]] == ["sync-a"]
    assert [entry["id"] for entry in workspace["activity"]] == ["activity-a"]


def test_global_voice_workspace_retains_whole_fleet_history(monkeypatch: pytest.MonkeyPatch):
    """Explicitly global operators still receive the operational fleet view."""
    _install_voice_billing(monkeypatch)

    workspace = asyncio.run(yeastar.yeastar_voice_workspace({"id": "admin-1", "is_admin": True}))

    assert {pbx["id"] for pbx in workspace["pbxs"]} == {"pbx-a", "pbx-b"}
    assert {entry["id"] for entry in workspace["billing"]["history"]} == {"old-a", "old-b", "global-summary"}
    assert {entry["id"] for entry in workspace["sync_history"]} == {"sync-a", "sync-b"}
    assert {entry["id"] for entry in workspace["activity"]} == {"activity-a", "activity-b", "activity-global"}
