"""Security and evidence-contract regression coverage for Device Smart routes."""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import device_smart  # noqa: E402
from app.services import scope_permissions  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, limit):
        self.rows = self.rows[:limit]
        return self

    async def to_list(self, limit):
        return list(self.rows[:limit])


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.find_queries = []
        self.find_one_queries = []
        self.inserted = []
        self.updated = []

    async def find_one(self, query, _projection=None):
        self.find_one_queries.append(query)
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return dict(row)
        return None

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor(self.rows)

    async def insert_one(self, row):
        self.inserted.append(dict(row))

    async def update_one(self, query, update):
        self.updated.append((query, update))


class _NoReadCollection:
    def __init__(self):
        self.read_attempts = 0
        self.write_attempts = 0

    def find(self, *_args, **_kwargs):
        self.read_attempts += 1
        raise AssertionError("foreign request must not load child data")

    async def find_one(self, *_args, **_kwargs):
        self.read_attempts += 1
        raise AssertionError("foreign request must not load provider configuration")

    async def insert_one(self, *_args, **_kwargs):
        self.write_attempts += 1
        raise AssertionError("foreign request must not persist a comment")


def _restricted_user():
    return {
        "id": "tech-a",
        "name": "Technician A",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def test_live_metrics_masks_a_foreign_device_before_any_telemetry_read(monkeypatch):
    metrics = _NoReadCollection()
    database = SimpleNamespace(
        devices=_Collection([{"id": "device-b", "client_id": "client-b"}]),
        device_metrics=metrics,
        scope_denials=_Collection(),
    )
    monkeypatch.setattr(device_smart, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(device_smart.live_metrics("device-b", current_user=_restricted_user()))

    assert denied.value.status_code == 404
    assert denied.value.detail == "Resource not found"
    assert metrics.read_attempts == 0
    assert database.scope_denials.inserted[-1]["operation"] == "device.live_metrics.read"


def test_ai_diagnose_rejects_a_same_operator_cross_client_ticket_before_reading_diagnostic_data(monkeypatch):
    calls = []
    no_read = _NoReadCollection()
    database = SimpleNamespace(
        devices=object(),
        tickets=object(),
        device_metrics=no_read,
        device_events=no_read,
        device_services=no_read,
        device_winupdates=no_read,
        device_diagnoses=no_read,
        ticket_comments=no_read,
    )

    async def scoped_record(_user, collection, record_id, **_kwargs):
        calls.append(record_id)
        if collection is database.devices:
            return {"id": "device-a", "name": "Endpoint A", "client_id": "client-a"}
        return {"id": "ticket-b", "ticket_number": "T-2", "client_id": "client-b"}

    monkeypatch.setattr(device_smart, "db", database)
    monkeypatch.setattr(device_smart, "assert_record_scope", scoped_record)

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(device_smart.ai_diagnose(
            "device-a",
            {"ticket_id": "ticket-b"},
            current_user={"id": "admin-a", "role": "admin"},
        ))

    assert rejected.value.status_code == 409
    assert calls == ["device-a", "ticket-b"]
    assert no_read.read_attempts == 0
    assert no_read.write_attempts == 0


def test_screenshot_rejects_a_cross_client_ticket_before_provider_configuration_or_comment(monkeypatch):
    calls = []
    no_read = _NoReadCollection()
    database = SimpleNamespace(
        devices=object(),
        tickets=object(),
        settings=no_read,
        ticket_comments=no_read,
    )

    async def scoped_record(_user, collection, record_id, **_kwargs):
        calls.append(record_id)
        if collection is database.devices:
            return {"id": "device-a", "name": "Endpoint A", "client_id": "client-a", "trmm_agent_id": "trmm-a"}
        return {"id": "ticket-b", "ticket_number": "T-2", "client_id": "client-b"}

    monkeypatch.setattr(device_smart, "db", database)
    monkeypatch.setattr(device_smart, "assert_record_scope", scoped_record)

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(device_smart.screenshot_to_ticket(
            "device-a",
            {"ticket_id": "ticket-b"},
            current_user={"id": "admin-a", "role": "admin"},
        ))

    assert rejected.value.status_code == 409
    assert calls == ["device-a", "ticket-b"]
    assert no_read.read_attempts == 0
    assert no_read.write_attempts == 0


def test_screenshot_requires_the_governed_agent_command_permission_before_ticket_or_provider_reads(monkeypatch):
    """An L1 technician must not use ticket context to request a screen capture."""
    no_read = _NoReadCollection()
    database = SimpleNamespace(
        devices=object(),
        tickets=no_read,
        settings=no_read,
        ticket_comments=no_read,
    )

    async def scoped_device(_user, _collection, record_id, **_kwargs):
        return {"id": record_id, "name": "Endpoint A", "client_id": "client-a", "trmm_agent_id": "trmm-a"}

    monkeypatch.setattr(device_smart, "db", database)
    monkeypatch.setattr(device_smart, "assert_record_scope", scoped_device)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(device_smart.screenshot_to_ticket(
            "device-a",
            {"ticket_id": "ticket-a"},
            current_user={**_restricted_user(), "permissions": {"agent_commands": {"execute": False}}},
        ))

    assert denied.value.status_code == 403
    assert denied.value.detail == "Agent command permission required"
    assert no_read.read_attempts == 0
    assert no_read.write_attempts == 0


def test_bulk_diagnose_validates_every_target_before_any_diagnosis_runs(monkeypatch):
    checked = []
    diagnose_calls = []
    database = SimpleNamespace(devices=object())

    async def scoped_record(_user, _collection, record_id, **_kwargs):
        checked.append(record_id)
        if record_id == "device-b":
            raise HTTPException(status_code=404, detail="Resource not found")
        return {"id": record_id, "client_id": "client-a"}

    async def unexpected_diagnose(*args, **kwargs):
        diagnose_calls.append((args, kwargs))
        raise AssertionError("mixed-client bulk request must fail before diagnosis starts")

    monkeypatch.setattr(device_smart, "db", database)
    monkeypatch.setattr(device_smart, "assert_record_scope", scoped_record)
    monkeypatch.setattr(device_smart, "ai_diagnose", unexpected_diagnose)

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(device_smart.bulk_diagnose(
            {"device_ids": ["device-a", "device-b"]},
            current_user=_restricted_user(),
        ))

    assert rejected.value.status_code == 404
    assert checked == ["device-a", "device-b"]
    assert diagnose_calls == []


def test_live_metrics_uses_an_honest_empty_observation_state(monkeypatch):
    metrics = _Collection()
    database = SimpleNamespace(devices=object(), device_metrics=metrics)

    async def scoped_record(_user, _collection, record_id, **_kwargs):
        return {
            "id": record_id,
            "name": "Endpoint A",
            "client_id": "client-a",
            "status": "online",
            "cpu_usage": 22,
            "memory_usage": 41,
            "disk_usage": 68,
        }

    monkeypatch.setattr(device_smart, "db", database)
    monkeypatch.setattr(device_smart, "assert_record_scope", scoped_record)

    result = asyncio.run(device_smart.live_metrics("device-a", current_user=_restricted_user()))

    assert result["series"] == []
    assert result["observation_state"] == "not_collected"
    assert "synthetic" not in str(result)


def test_fleet_health_uses_the_current_technician_client_scope(monkeypatch):
    devices = _Collection()
    monkeypatch.setattr(device_smart, "db", SimpleNamespace(devices=devices))

    result = asyncio.run(device_smart.fleet_health(_restricted_user()))

    assert result["counts"]["total"] == 0
    assert devices.find_queries == [{"client_id": {"$in": ["client-a"]}}]
