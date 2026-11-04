"""Regression coverage for the managed-assets command-strip boundary."""

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

from app.routers import device_intel  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return list(self.rows[:limit])

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class _Devices:
    def __init__(self):
        self.find_queries = []
        self.count_queries = []
        self.aggregate_pipelines = []
        self.rows = []

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor(self.rows)

    async def count_documents(self, query):
        self.count_queries.append(query)
        return 0

    def aggregate(self, pipeline):
        self.aggregate_pipelines.append(pipeline)
        return _Cursor([])


class _Tickets:
    def __init__(self):
        self.find_queries = []
        self.count_queries = []

    def find(self, query, _projection=None):
        self.find_queries.append(query)
        return _Cursor([])

    async def count_documents(self, query):
        self.count_queries.append(query)
        return 2


def _restricted_user():
    return {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _is_scoped_to_client_a(query):
    return "client_id" in str(query) and "client-a" in str(query)


def test_smart_inbox_applies_the_technician_client_scope(monkeypatch):
    devices = _Devices()
    monkeypatch.setattr(device_intel, "db", SimpleNamespace(devices=devices))

    response = asyncio.run(device_intel.smart_inbox(_restricted_user()))

    assert response["items"] == []
    assert len(devices.find_queries) == 4
    assert all(_is_scoped_to_client_a(query) for query in devices.find_queries)


def test_stat_tiles_use_scoped_queries_and_new_agent_signal_aliases(monkeypatch):
    devices = _Devices()
    devices.rows = [{"pending_patches": 7}]
    tickets = _Tickets()
    monkeypatch.setattr(device_intel, "db", SimpleNamespace(devices=devices, tickets=tickets))

    response = asyncio.run(device_intel.device_intel_stats(_restricted_user()))

    assert response["patches_pending"] == 7
    assert all(_is_scoped_to_client_a(query) for query in devices.count_queries)
    assert all(_is_scoped_to_client_a(query) for query in devices.find_queries)
    assert devices.aggregate_pipelines[0][0]["$match"] == {"client_id": {"$in": ["client-a"]}}
    assert _is_scoped_to_client_a(tickets.find_queries[0])

    attention_query = devices.count_queries[3]
    assert {"cpu_usage": {"$gte": 90}} in attention_query["$and"][0]["$or"]
    assert {"disk_usage": {"$gte": 90}} in attention_query["$and"][0]["$or"]


def test_device_compare_masks_a_foreign_requested_asset_before_reading_any_ticket_data(monkeypatch):
    """A tampered compare body must not reveal or correlate another client's device."""
    scope_calls = []

    async def masked_scope(_user, _collection, record_id, **kwargs):
        scope_calls.append({"record_id": record_id, **kwargs})
        raise HTTPException(status_code=404, detail="Resource not found")

    class _NoTicketReads:
        async def count_documents(self, _query):
            raise AssertionError("foreign device comparison must not query ticket history")

    monkeypatch.setattr(device_intel, "assert_record_scope", masked_scope)
    monkeypatch.setattr(
        device_intel,
        "db",
        SimpleNamespace(devices=object(), tickets=_NoTicketReads()),
    )

    with pytest.raises(HTTPException) as denied:
        asyncio.run(device_intel.compare_devices(
            {"device_ids": ["device-b"]},
            current_user=_restricted_user(),
        ))

    assert denied.value.status_code == 404
    assert denied.value.detail == "Resource not found"
    assert scope_calls == [{
        "record_id": "device-b",
        "operation": "device.compare",
    }]


def test_device_compare_keeps_the_authorised_device_and_its_ticket_count_in_client_scope(monkeypatch):
    scope_calls = []
    tickets = _Tickets()

    async def owned_scope(_user, _collection, record_id, **kwargs):
        scope_calls.append({"record_id": record_id, **kwargs})
        return {
            "id": record_id,
            "name": "Reception workstation",
            "client_id": "client-a",
            "status": "online",
        }

    monkeypatch.setattr(device_intel, "assert_record_scope", owned_scope)
    monkeypatch.setattr(
        device_intel,
        "db",
        SimpleNamespace(devices=object(), tickets=tickets),
    )

    result = asyncio.run(device_intel.compare_devices(
        {"device_ids": ["device-a", "device-a"]},
        current_user=_restricted_user(),
    ))

    assert [call["record_id"] for call in scope_calls] == ["device-a"]
    assert result["devices"][0]["device"]["id"] == "device-a"
    assert result["devices"][0]["ticket_count"] == 2
    assert len(tickets.count_queries) == 1
    assert tickets.count_queries[0] == {
        "$and": [
            {
                "client_id": "client-a",
                "$or": [{"device_id": "device-a"}, {"device_ids": "device-a"}],
            },
            {"client_id": {"$in": ["client-a"]}},
        ]
    }


def test_device_compare_rejects_a_non_list_payload_before_loading_any_asset():
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(device_intel.compare_devices(
            {"device_ids": "device-a"},
            current_user=_restricted_user(),
        ))

    assert invalid.value.status_code == 400
    assert invalid.value.detail == "device_ids must be a list of 1-4 managed asset IDs"


def test_direct_device_intelligence_reads_mask_a_foreign_device_before_loading_child_data(monkeypatch):
    scope_calls = []

    async def masked_scope(_user, _collection, record_id, **kwargs):
        scope_calls.append({"record_id": record_id, **kwargs})
        raise HTTPException(status_code=404, detail="Resource not found")

    monkeypatch.setattr(device_intel, "assert_record_scope", masked_scope)
    monkeypatch.setattr(device_intel, "db", SimpleNamespace(devices=object()))
    user = _restricted_user()

    for read in (
        lambda: device_intel.device_time_machine("device-b", limit=50, current_user=user),
        lambda: device_intel.compare_device_time_machine("device-b", current_user=user),
        lambda: device_intel.device_dossier("device-b", current_user=user),
    ):
        with pytest.raises(HTTPException) as denied:
            asyncio.run(read())
        assert denied.value.status_code == 404
        assert denied.value.detail == "Resource not found"

    assert [call["operation"] for call in scope_calls] == [
        "device.time_machine.read",
        "device.time_machine.compare",
        "device.dossier.read",
    ]


def test_time_machine_keeps_the_scoped_device_history_workflow_available(monkeypatch):
    scope_calls = []

    class _Snapshots:
        def find(self, _query, _projection=None):
            return _Cursor([{
                "id": "snapshot-1",
                "device_id": "device-a",
                "captured_at": "2026-08-28T00:00:00+00:00",
                "coverage": ["hardware"],
            }])

        async def count_documents(self, _query):
            return 1

    async def owned_scope(_user, _collection, record_id, **kwargs):
        scope_calls.append({"record_id": record_id, **kwargs})
        return {
            "id": record_id,
            "name": "Reception workstation",
            "client_id": "client-a",
            "nexus_agent_id": "agent-a",
        }

    monkeypatch.setattr(device_intel, "assert_record_scope", owned_scope)
    monkeypatch.setattr(
        device_intel,
        "db",
        SimpleNamespace(devices=object(), device_state_snapshots=_Snapshots()),
    )

    result = asyncio.run(device_intel.device_time_machine(
        "device-a",
        limit=50,
        current_user=_restricted_user(),
    ))

    assert result["device"] == {
        "id": "device-a",
        "name": "Reception workstation",
        "client_id": "client-a",
        "agent_linked": True,
    }
    assert result["total"] == 1
    assert scope_calls == [{"record_id": "device-a", "operation": "device.time_machine.read"}]


def test_device_dossier_scopes_the_correlated_ticket_query_to_the_canonical_client(monkeypatch):
    tickets = _Tickets()

    async def owned_scope(_user, _collection, record_id, **_kwargs):
        return {"id": record_id, "name": "Reception workstation", "client_id": "client-a", "status": "online"}

    monkeypatch.setattr(device_intel, "assert_record_scope", owned_scope)
    monkeypatch.setattr(
        device_intel,
        "db",
        SimpleNamespace(devices=object(), tickets=tickets),
    )

    result = asyncio.run(device_intel.device_dossier("device-a", current_user=_restricted_user()))

    assert result["device"]["id"] == "device-a"
    assert tickets.find_queries[0] == {
        "$and": [
            {
                "client_id": "client-a",
                "$or": [{"device_id": "device-a"}, {"device_ids": "device-a"}],
                "status": {"$in": ["open", "in_progress", "pending"]},
            },
            {"client_id": {"$in": ["client-a"]}},
        ]
    }


def test_device_dossier_keeps_stale_telemetry_as_uncertainty(monkeypatch):
    """Old telemetry must never be presented as a healthy, low-risk endpoint."""
    tickets = _Tickets()

    async def owned_scope(_user, _collection, record_id, **_kwargs):
        return {
            "id": record_id,
            "name": "Reception workstation",
            "client_id": "client-a",
            "status": "online",
            "last_seen": "2020-01-01T00:00:00+00:00",
        }

    monkeypatch.setattr(device_intel, "assert_record_scope", owned_scope)
    monkeypatch.setattr(
        device_intel,
        "db",
        SimpleNamespace(devices=object(), tickets=tickets),
    )

    result = asyncio.run(device_intel.device_dossier("device-a", current_user=_restricted_user()))

    assert result["health_evidence"]["state"] == "stale"
    assert result["health_score"] is None
    assert result["failure_risk"] == {
        "risk_pct": None,
        "verdict": "not_assessed",
        "factors": [],
        "message": "Failure risk needs a fresh endpoint observation.",
    }


def test_telemetry_evidence_distinguishes_fresh_and_missing_observations():
    now = device_intel.datetime(2026, 8, 30, 12, tzinfo=device_intel.timezone.utc)
    fresh = device_intel._telemetry_evidence(
        {"last_heartbeat": "2026-08-30T11:55:00+00:00"},
        now=now,
    )
    missing = device_intel._telemetry_evidence({}, now=now)

    assert fresh["state"] == "observed"
    assert fresh["age_seconds"] == 300
    assert missing["state"] == "not_collected"


def test_device_sites_map_applies_the_technician_scope_before_aggregation(monkeypatch):
    devices = _Devices()
    monkeypatch.setattr(device_intel, "db", SimpleNamespace(devices=devices, clients=object()))

    result = asyncio.run(device_intel.sites_map(_restricted_user()))

    assert result == {"sites": []}
    assert devices.aggregate_pipelines == [[
        {"$match": {"client_id": {"$in": ["client-a"]}}},
        {"$group": {
            "_id": "$client_id",
            "client_name": {"$first": "$client_name"},
            "total": {"$sum": 1},
            "online": {"$sum": {"$cond": [{"$eq": ["$status", "online"]}, 1, 0]}},
            "offline": {"$sum": {"$cond": [{"$eq": ["$status", "offline"]}, 1, 0]}},
        }},
    ]]
