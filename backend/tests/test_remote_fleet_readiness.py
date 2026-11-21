"""Nexus Remote fleet readiness and session evidence boundaries.

The readiness view is a derived, tenant-scoped read model. These tests exercise
the real router and readiness service against a small scoped database so a
future refactor cannot quietly drop tenant/site scoping, batch the wrong Agent
record or report an active session as a blocked endpoint.
"""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import remote
from app.services import native_remote


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


NOW = datetime(2026, 11, 16, 10, 0, tzinfo=timezone.utc)

USER = {
    "id": "tech-1",
    "name": "Terry Tech",
    "role": "technician",
    "tenant_id": "tenant-a",
    "client_scope_mode": "restricted",
    "client_scope_ids": ["client-a"],
    "site_scope_ids": ["site-a"],
}


class _Cursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)
        self.offset = 0
        self.last_limit = None

    def sort(self, *_args, **_kwargs):
        return self

    def skip(self, value):
        self.offset = int(value)
        return self

    async def to_list(self, limit):
        self.last_limit = limit
        rows = self.rows[self.offset:self.offset + limit]
        return deepcopy(rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])
        self.last_find_query = None
        self.last_find_one_query = None
        self.last_cursor = None

    @staticmethod
    def _matches(row, query):
        for key, value in query.items():
            if key == "$and":
                if not all(_Collection._matches(row, part) for part in value):
                    return False
                continue
            if key == "$or":
                if not any(_Collection._matches(row, part) for part in value):
                    return False
                continue
            actual = row.get(key)
            if isinstance(value, dict):
                for operator, operand in value.items():
                    if operator == "$in" and actual not in operand:
                        return False
                    if operator == "$nin" and actual in operand:
                        return False
                    if operator == "$ne" and actual == operand:
                        return False
                    if operator == "$gte" and (actual is None or str(actual) < str(operand)):
                        return False
                    if operator == "$lte" and (actual is None or str(actual) > str(operand)):
                        return False
                    if operator == "$exists" and (key in row) != operand:
                        return False
                continue
            if actual != value:
                return False
        return True

    def find(self, query, _projection=None, **_kwargs):
        self.last_find_query = deepcopy(query)
        cursor = _Cursor([row for row in self.rows if self._matches(row, query)])
        self.last_cursor = cursor
        return cursor

    async def find_one(self, query, _projection=None, **_kwargs):
        self.last_find_one_query = deepcopy(query)
        for row in self.rows:
            if self._matches(row, query):
                return deepcopy(row)
        return None


def _database():
    current = datetime.now(timezone.utc)
    ready_agent = {
        "id": "agent-ready",
        "client_id": "client-a",
        "tenant_id": "tenant-a",
        "is_active": True,
        "last_seen": _iso(current),
        "agent_runtime_capabilities": [native_remote.RUNTIME_CAPABILITY],
        "native_remote_evidence": {"status": "ready"},
    }
    offline_agent = {
        "id": "agent-offline",
        "client_id": "client-a",
        "tenant_id": "tenant-a",
        "is_active": True,
        "last_seen": _iso(current - timedelta(hours=2)),
        "agent_runtime_capabilities": [native_remote.RUNTIME_CAPABILITY],
        "native_remote_evidence": {"status": "ready"},
    }
    devices = [
        {
            "id": "device-1", "name": "Reception", "client_id": "client-a",
            "tenant_id": "tenant-a", "client_name": "Acme", "site_id": "site-a",
            "device_type": "workstation", "status": "online", "nexus_agent_id": "agent-ready",
        },
        {
            "id": "device-2", "name": "Workshop", "client_id": "client-a",
            "tenant_id": "tenant-a", "client_name": "Acme", "site_id": "site-a",
            "device_type": "workstation", "status": "offline", "nexus_agent_id": "agent-offline",
        },
    ]
    sessions = [
        {
            "id": "session-1", "provider": "nexus", "device_id": "device-1",
            "tenant_id": "tenant-a", "client_id": "client-a", "site_id": "site-a", "status": "active",
            "user_id": "tech-1", "access_mode": "control", "user_name": "Terry Tech",
            "started_at": _iso(current - timedelta(minutes=5)), "ended_at": None,
            "last_heartbeat_at": _iso(current), "transport_state": "connected", "capture_freshness": "fresh",
            "ticket_id": "ticket-1", "ticket_number": "TKT-1",
            "purpose": "Replace the reception scanner driver",
            "consent_required": True, "consent_confirmed": True,
            "control_consent_confirmed": True, "duration_minutes": 5,
        },
        {
            "id": "session-2", "provider": "nexus", "device_id": "device-2",
            "tenant_id": "tenant-a", "client_id": "client-a", "site_id": "site-a", "status": "authorised",
            "user_id": "tech-1", "access_mode": "view", "user_name": "Terry Tech",
            "started_at": _iso(current - timedelta(minutes=1)), "ended_at": None,
            "last_heartbeat_at": _iso(current),
            "ticket_id": "ticket-2", "duration_minutes": 0,
        },
    ]
    database = SimpleNamespace(
        users=_Collection([{"id": "tech-1", "tenant_id": "tenant-a", "role": "technician"}]),
        devices=_Collection(devices),
        nexus_agents=_Collection([ready_agent, offline_agent]),
        remote_sessions=_Collection(sessions),
        native_remote_grants=_Collection([{
            "id": "grant-1", "tenant_id": "tenant-a", "session_id": "session-1",
            "status": "acknowledged", "issued_at": _iso(NOW - timedelta(minutes=5)),
            "expires_at": _iso(NOW + timedelta(hours=23)),
            "delivered_at": _iso(NOW - timedelta(minutes=5)),
            "acknowledged_at": _iso(NOW - timedelta(minutes=5)),
            "revoked_at": None, "key_id": "key-1",
        }]),
        time_entries=_Collection([{
            "id": "time-1", "tenant_id": "tenant-a", "remote_session_id": "session-1",
            "minutes": 5, "created_at": _iso(NOW - timedelta(minutes=4)),
        }]),
    )
    return database


def _install(monkeypatch):
    database = _database()

    async def no_expiry(**_kwargs):
        return 0

    monkeypatch.setattr(remote, "db", database)
    monkeypatch.setattr(remote, "expire_overdue_grants", no_expiry)
    monkeypatch.setattr(native_remote, "db", database)
    return database


def test_fleet_readiness_is_scoped_and_joins_active_sessions(monkeypatch):
    database = _install(monkeypatch)

    result = asyncio.run(remote.get_remote_fleet_readiness(current_user=USER))

    # The tenant, client and site boundaries are all present in the device read.
    query_text = str(database.devices.last_find_query)
    assert "tenant-a" in query_text
    assert "client-a" in query_text
    assert "site-a" in query_text

    summary = result["summary"]
    assert summary["total_endpoints"] == 2
    assert summary["ready"] == 1
    assert summary["blocked"] == 1
    assert summary["active_sessions"] == 2
    assert summary["control_sessions"] == 1
    assert summary["ready_percentage"] == 50.0
    states = {item["state"]: item["count"] for item in summary["states"]}
    assert states == {"ready": 1, "agent_offline": 1}

    blockers = {item["state"]: item for item in result["blockers"]}
    assert blockers["agent_offline"]["count"] == 1
    assert blockers["agent_offline"]["examples"][0]["device_id"] == "device-2"

    # Active endpoints sort first, then blocked endpoints. Readiness is not
    # treated as equivalent to "in use".
    assert [item["device_id"] for item in result["endpoints"]] == ["device-2", "device-1"]
    assert result["endpoints"][0]["active_session"]["id"] == "session-2"
    assert result["endpoints"][1]["active_session"]["id"] == "session-1"
    assert result["endpoints"][1]["active_session"]["access_mode"] == "control"
    assert [item["device_id"] for item in result["attention_endpoints"]] == ["device-2", "device-1"]


def test_session_detail_keeps_grant_lifecycle_and_time_entries_on_one_boundary(monkeypatch):
    _install(monkeypatch)

    detail = asyncio.run(remote.get_remote_session_detail("session-1", current_user=USER))

    assert detail["id"] == "session-1"
    assert detail["grant"]["status"] == "acknowledged"
    assert detail["time_entries"][0]["minutes"] == 5
    assert detail["capture_freshness"] == "fresh"
    assert detail["native_risk"]["band"] in {"low", "medium", "elevated", "high"}
    assert detail["native_risk"]["factors"]


def test_session_listing_applies_filters_and_bounded_pagination(monkeypatch):
    database = _install(monkeypatch)

    result = asyncio.run(remote.get_remote_sessions(
        client_id="client-a",
        ticket_id="ticket-1",
        status="active",
        started_after=(NOW - timedelta(days=1)).isoformat(),
        limit=25,
        offset=0,
        current_user=USER,
    ))

    assert result[0]["id"] == "session-1"
    query_text = str(database.remote_sessions.last_find_query)
    assert "ticket-1" in query_text
    assert "client-a" in query_text
    assert "tenant-a" in query_text
    assert database.remote_sessions.last_cursor.offset == 0
    assert database.remote_sessions.last_cursor.last_limit == 25


def test_session_listing_rejects_an_invalid_time_bound(monkeypatch):
    _install(monkeypatch)

    with pytest.raises(HTTPException) as invalid:
        asyncio.run(remote.get_remote_sessions(started_after="not-a-date", current_user=USER))

    assert invalid.value.status_code == 422


def test_technician_session_history_keeps_the_site_boundary(monkeypatch):
    database = _install(monkeypatch)

    result = asyncio.run(remote.get_technician_remote_sessions("tech-1", current_user=USER))

    assert {session["id"] for session in result["sessions"]} == {"session-1", "session-2"}
    query_text = str(database.remote_sessions.last_find_query)
    assert "client-a" in query_text
    assert "site-a" in query_text
    assert "tenant-a" in query_text
