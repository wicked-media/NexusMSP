"""Focused access and evidence-boundary coverage for Threat Timeline."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

from app.routers import threat_timeline
from app.services import scope_permissions


class _Cursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]
        self.find_queries = []
        self.find_one_queries = []
        self.inserted = []

    def find(self, query, _projection=None):
        self.find_queries.append(dict(query))
        return _Cursor(self.rows)

    async def find_one(self, query, _projection=None):
        self.find_one_queries.append(dict(query))
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return dict(row)
        return None

    async def insert_one(self, row):
        self.inserted.append(dict(row))


def _restricted_user():
    return {
        "id": "tech-a",
        "name": "Scoped Technician",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _contains(value, target):
    if value == target:
        return True
    if isinstance(value, dict):
        return any(_contains(child, target) for child in value.values())
    if isinstance(value, list):
        return any(_contains(child, target) for child in value)
    return False


def test_timeline_reads_use_client_and_tenant_boundaries_without_seeding(monkeypatch):
    events = _Collection([
        {
            "id": "threat-a",
            "client_id": "client-a",
            "tenant_id": "tenant-a",
            "title": "Recorded threat",
            "severity": "high",
            "provider_payload": {"secret": "must-not-leak"},
        },
        {
            "id": "thr-001",
            "client_id": "client-a",
            "tenant_id": "tenant-a",
            "title": "Retired generated record",
        },
    ])
    devices = _Collection([{"id": "device-a", "client_id": "client-a"}])
    monkeypatch.setattr(
        threat_timeline,
        "db",
        SimpleNamespace(threat_events=events, devices=devices),
    )

    response = Response()
    result = asyncio.run(
        threat_timeline.get_threat_events(response=response, current_user=_restricted_user())
    )

    assert result == [{"id": "threat-a", "client_id": "client-a", "severity": "high", "title": "Recorded threat"}]
    assert response.headers["X-Nexus-Evidence-State"] == "recorded-events-only"
    assert _contains(events.find_queries[0], {"client_id": {"$in": ["client-a"]}})
    assert _contains(events.find_queries[0], {"tenant_id": "tenant-a"})
    assert _contains(
        events.find_queries[0],
        {"id": {"$nin": ["thr-001", "thr-002", "thr-003", "thr-004", "thr-005"]}},
    )
    assert _contains(devices.find_queries[0], {"client_id": {"$in": ["client-a"]}})
    assert not hasattr(events, "seeded")


def test_timeline_detail_masks_foreign_client_event(monkeypatch):
    events = _Collection([{"id": "threat-b", "client_id": "client-b", "tenant_id": "tenant-a"}])
    denials = _Collection()
    monkeypatch.setattr(
        threat_timeline,
        "db",
        SimpleNamespace(threat_events=events, devices=_Collection(), scope_denials=denials),
    )
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(threat_timeline.get_threat_detail("threat-b", current_user=_restricted_user()))

    assert exc.value.status_code == 404
    assert len(denials.inserted) == 1


def test_timeline_detail_masks_conflicting_tenant_event(monkeypatch):
    events = _Collection([{"id": "threat-b", "client_id": "client-a", "tenant_id": "tenant-b"}])
    monkeypatch.setattr(
        threat_timeline,
        "db",
        SimpleNamespace(threat_events=events, devices=_Collection(), scope_denials=_Collection()),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(threat_timeline.get_threat_detail("threat-b", current_user=_restricted_user()))

    assert exc.value.status_code == 404


def test_retired_generated_event_cannot_be_returned_as_security_evidence(monkeypatch):
    events = _Collection([{"id": "thr-001", "client_id": "client-a", "tenant_id": "tenant-a"}])
    monkeypatch.setattr(
        threat_timeline,
        "db",
        SimpleNamespace(threat_events=events, devices=_Collection(), scope_denials=_Collection()),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(threat_timeline.get_threat_detail("thr-001", current_user=_restricted_user()))

    assert exc.value.status_code == 404


def test_timeline_detail_fails_closed_for_unbound_legacy_event(monkeypatch):
    events = _Collection([{"id": "threat-unbound", "tenant_id": "tenant-a"}])
    denials = _Collection()
    monkeypatch.setattr(
        threat_timeline,
        "db",
        SimpleNamespace(threat_events=events, devices=_Collection(), scope_denials=denials),
    )
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            threat_timeline.get_threat_detail("threat-unbound", current_user=_restricted_user())
        )

    assert exc.value.status_code == 404
    assert len(denials.inserted) == 1


def test_timeline_resolve_is_retired_without_loading_or_mutating_evidence(monkeypatch):
    monkeypatch.setattr(threat_timeline, "db", SimpleNamespace())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(threat_timeline.resolve_threat("threat-a", current_user=_restricted_user()))

    assert exc.value.status_code == 410
    assert "evidence-only" in exc.value.detail
