"""Focused client-scope and permission coverage for SOC Feed APIs."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import soc


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

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor(self.rows)


def _restricted_user():
    return {
        "id": "tech-a",
        "name": "Scoped Technician",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _has_client_scope(query):
    if query.get("client_id") == {"$in": ["client-a"]}:
        return True
    return {"client_id": {"$in": ["client-a"]}} in query.get("$and", [])


def test_soc_feed_and_alert_reads_are_limited_to_client_scope(monkeypatch):
    events = _Collection()
    alerts = _Collection()
    monkeypatch.setattr(soc, "db", SimpleNamespace(soc_events=events, soc_alerts=alerts))
    user = _restricted_user()

    asyncio.run(soc.get_soc_feed_events(current_user=user))
    asyncio.run(soc.get_soc_feed_stats(current_user=user))
    asyncio.run(soc.get_soc_alerts(user=user))

    assert all(_has_client_scope(query) for query in events.find_queries)
    assert all(_has_client_scope(query) for query in alerts.find_queries)


def test_soc_acknowledgement_requires_device_edit_before_loading_alert(monkeypatch):
    calls = []

    async def _deny(user, module, action):
        calls.append((user, module, action))
        raise HTTPException(status_code=403, detail="Devices edit permission required")

    monkeypatch.setattr(soc, "require_module_permission", _deny)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(soc.acknowledge_alert("alert-a", user=_restricted_user()))

    assert exc.value.status_code == 403
    assert calls == [(_restricted_user(), "devices", "edit")]


def test_soc_action_audit_carries_the_actor_tenant(monkeypatch):
    rows = []

    class _AuditLogs:
        async def insert_one(self, row):
            rows.append(dict(row))

    monkeypatch.setattr(soc, "db", SimpleNamespace(audit_logs=_AuditLogs()))

    asyncio.run(soc._write_soc_audit(
        _restricted_user(),
        "soc_alert_acknowledge",
        {"id": "alert-a", "client_id": "client-a"},
    ))

    assert rows[0]["tenant_id"] == "tenant-a"
    assert rows[0]["client_id"] == "client-a"
