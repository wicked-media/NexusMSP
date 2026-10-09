"""Regression coverage for managed-asset archive, restore, merge and purge policy."""

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

from app.routers import devices, nexus_agent  # noqa: E402


class _Cursor:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return [dict(row) for row in self.rows[:limit]]


class _Collection:
    def __init__(self, *, count=0, rows=None, matched_count=1, deleted_count=1):
        self.count = count
        self.rows = list(rows or [])
        self.matched_count = matched_count
        self.deleted_count = deleted_count
        self.count_queries = []
        self.update_calls = []
        self.delete_calls = []
        self.find_queries = []

    async def count_documents(self, query):
        self.count_queries.append(query)
        return self.count

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor(self.rows)

    async def update_one(self, query, update, *_args, **_kwargs):
        self.update_calls.append((query, update))
        return SimpleNamespace(matched_count=self.matched_count, modified_count=self.matched_count)

    async def delete_one(self, query):
        self.delete_calls.append(query)
        return SimpleNamespace(deleted_count=self.deleted_count)


def _user():
    return {"id": "tech-1", "name": "Jamie Tech", "role": "admin"}


def _device(device_id="device-a", **overrides):
    record = {
        "id": device_id,
        "name": "Reception PC",
        "client_id": "client-a",
        "status": "online",
        "archived": False,
    }
    record.update(overrides)
    return record


def _db(*, evidence=None, asset_rows=None):
    evidence = evidence or {}
    collections = {
        "devices": _Collection(),
        "clients": _Collection(),
        "assets": _Collection(count=evidence.get("assets", 0), rows=asset_rows),
    }
    for name in devices._DEVICE_EVIDENCE_COLLECTIONS:
        collections.setdefault(name, _Collection(count=evidence.get(name, 0)))
    return SimpleNamespace(**collections)


def _scope_map(records):
    async def scoped(_user, _collection, record_id, **_kwargs):
        record = records.get(record_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Resource not found")
        return dict(record)

    return scoped


def _operational(query):
    """Return the operational part of a tenant-scoped filter.

    ``tenant_scoped_query`` wraps every scoped read and write in
    ``{"$and": [operational, tenant partition]}``; these lifecycle checks pin
    the operational semantics and require the partition to be present.
    """
    fragments = []

    def collect(fragment):
        for key, value in fragment.items():
            if key == "$and":
                for option in value:
                    collect(option)
            else:
                fragments.append({key: value})

    collect(query)

    def is_tenant_partition(fragment):
        if set(fragment) == {"$or"}:
            return all("tenant_id" in option for option in fragment["$or"])
        return set(fragment) == {"tenant_id"}

    assert any(is_tenant_partition(fragment) for fragment in fragments), (
        f"tenant partition missing from filter {query!r}"
    )
    operational = {}
    for fragment in fragments:
        if is_tenant_partition(fragment):
            continue
        operational.update(fragment)
    return operational


def test_archive_retires_the_asset_without_deleting_endpoint_evidence(monkeypatch):
    fake_db = _db(evidence={"tickets": 3, "device_events": 5})
    activities = []
    monkeypatch.setattr(devices, "db", fake_db)
    monkeypatch.setattr(devices, "assert_tenant_record_scope", _scope_map({"device-a": _device()}))

    async def capture_activity(*args, **kwargs):
        activities.append((args, kwargs))

    monkeypatch.setattr(devices, "log_activity", capture_activity)

    result = asyncio.run(devices.archive_device("device-a", {"reason": "Device was replaced"}, _user()))

    assert result["device_id"] == "device-a"
    query, update = fake_db.devices.update_calls[0]
    assert _operational(query) == {"id": "device-a", "archived": {"$ne": True}}
    assert update["$set"]["archived"] is True
    assert update["$set"]["status"] == "archived"
    assert [(_operational(call_query), call_update) for call_query, call_update in fake_db.clients.update_calls] == [
        ({"id": "client-a", "device_count": {"$gt": 0}}, {"$inc": {"device_count": -1}})
    ]
    assert activities[0][0][1:5] == ("archived", "device", "device-a", "Reception PC")
    assert not fake_db.devices.delete_calls


def test_archive_requires_a_handover_reason_before_mutating(monkeypatch):
    fake_db = _db()
    monkeypatch.setattr(devices, "db", fake_db)
    monkeypatch.setattr(devices, "assert_tenant_record_scope", _scope_map({"device-a": _device()}))

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(devices.archive_device("device-a", {"reason": ""}, _user()))

    assert rejected.value.status_code == 422
    assert not fake_db.devices.update_calls


def test_restore_never_restores_a_duplicate_that_was_merged(monkeypatch):
    fake_db = _db()
    monkeypatch.setattr(devices, "db", fake_db)
    monkeypatch.setattr(
        devices,
        "assert_tenant_record_scope",
        _scope_map({"device-a": _device(archived=True, status="archived", merged_into_id="device-b")}),
    )

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(devices.restore_device("device-a", _user()))

    assert rejected.value.status_code == 409
    assert "cannot be restored independently" in rejected.value.detail
    assert not fake_db.devices.update_calls


def test_merge_blocks_an_agent_linked_source_from_becoming_a_duplicate(monkeypatch):
    fake_db = _db()
    source = _device(nexus_agent_id="agent-a")
    survivor = _device("device-b", name="Manual duplicate")
    monkeypatch.setattr(devices, "db", fake_db)
    monkeypatch.setattr(devices, "assert_tenant_record_scope", _scope_map({"device-a": source, "device-b": survivor}))

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(devices.merge_device("device-a", {"survivor_id": "device-b", "reason": "Duplicate record"}, _user()))

    assert rejected.value.status_code == 409
    assert "Agent-linked asset" in rejected.value.detail
    assert not fake_db.devices.update_calls


def test_merge_archives_manual_duplicate_and_keeps_evidence_on_source(monkeypatch):
    fake_db = _db(evidence={"tickets": 2, "remote_sessions": 1})
    source = _device()
    survivor = _device("device-b", name="Reception PC · Agent", nexus_agent_id="agent-a")
    activities = []
    monkeypatch.setattr(devices, "db", fake_db)
    monkeypatch.setattr(devices, "assert_tenant_record_scope", _scope_map({"device-a": source, "device-b": survivor}))

    async def capture_activity(*args, **kwargs):
        activities.append((args, kwargs))

    monkeypatch.setattr(devices, "log_activity", capture_activity)

    result = asyncio.run(devices.merge_device(
        "device-a",
        {"survivor_id": "device-b", "reason": "Manual record duplicated at agent enrolment"},
        _user(),
    ))

    assert result["survivor_id"] == "device-b"
    assert result["evidence_counts"]["tickets"] == 2
    survivor_update = fake_db.devices.update_calls[0][1]
    source_update = fake_db.devices.update_calls[1][1]
    assert survivor_update["$addToSet"] == {"merged_device_ids": "device-a"}
    assert source_update["$set"]["archived"] is True
    assert source_update["$set"]["merged_into_id"] == "device-b"
    assert source_update["$set"]["lifecycle_state"] == "merged"
    assert [(_operational(call_query), call_update) for call_query, call_update in fake_db.clients.update_calls] == [
        ({"id": "client-a", "device_count": {"$gt": 0}}, {"$inc": {"device_count": -1}})
    ]
    assert [call[0][1] for call in activities] == ["merged", "merge_received"]


def test_purge_rejects_any_record_with_retained_operational_evidence(monkeypatch):
    fake_db = _db(evidence={"tickets": 1})
    monkeypatch.setattr(devices, "db", fake_db)
    monkeypatch.setattr(devices, "assert_tenant_record_scope", _scope_map({"device-a": _device()}))

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(devices.delete_device("device-a", _user()))

    assert rejected.value.status_code == 409
    assert "retained evidence" in rejected.value.detail
    assert not fake_db.devices.delete_calls


def test_active_device_list_excludes_archived_records_by_default(monkeypatch):
    fake_db = _db()
    monkeypatch.setattr(devices, "db", fake_db)

    asyncio.run(devices.get_devices(current_user=_user()))

    assert _operational(fake_db.devices.find_queries[0])["archived"] == {"$ne": True}


def test_generic_device_edit_cannot_bypass_lifecycle_or_agent_identity(monkeypatch):
    fake_db = _db()
    monkeypatch.setattr(devices, "db", fake_db)
    monkeypatch.setattr(devices, "assert_tenant_record_scope", _scope_map({"device-a": _device()}))

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(devices.update_device(
            "device-a",
            {"name": "Reception PC", "archived": True, "nexus_agent_id": "replacement-agent"},
            _user(),
        ))

    assert rejected.value.status_code == 422
    assert "system-managed" in rejected.value.detail
    assert not fake_db.devices.update_calls


def test_agent_enrolment_sync_does_not_revive_an_archived_managed_asset():
    class _ArchivedDevices:
        async def find_one(self, query, *_args, **_kwargs):
            assert query == {"nexus_agent_id": "agent-a"}
            return {"id": "device-a", "archived": True}

        async def update_one(self, *_args, **_kwargs):
            raise AssertionError("an archived device must not be overwritten or revived by agent sync")

    class _Clients:
        async def find_one(self, query, *_args, **_kwargs):
            assert query == {"id": "client-a"}
            return {"name": "Client A"}

    req = nexus_agent.EnrollRequest(
        enrollment_token="token",
        client_id="client-a",
        hostname="ARCHIVED-PC",
        os="windows",
    )

    asyncio.run(nexus_agent._sync_to_devices(
        SimpleNamespace(devices=_ArchivedDevices(), clients=_Clients()),
        "agent-a",
        "client-a",
        req,
    ))
