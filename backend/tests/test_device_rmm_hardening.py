"""Security regression coverage for the Devices/RMM trust boundary."""

from __future__ import annotations

import asyncio
import os
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
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

from app.routers import asset_lifecycle, device_agent, device_discovery, device_pulse, nexus_agent, patch_compliance, scripting, third_party_patching  # noqa: E402
from app.services import scope_permissions  # noqa: E402


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
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, size: int):
        self.rows = self.rows[:size]
        return self

    async def to_list(self, size: int):
        return deepcopy(self.rows[:size])

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return deepcopy(next(self._iterator))
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])
        self.find_queries: list[dict] = []
        self.update_calls: list[tuple[dict, dict]] = []
        self.inserted: list[dict] = []

    async def find_one(self, query: dict, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict, _projection=None):
        self.find_queries.append(deepcopy(query))
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def update_one(self, query: dict, update: dict):
        self.update_calls.append((deepcopy(query), deepcopy(update)))
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def insert_one(self, document: dict):
        self.inserted.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


def _restricted_user() -> dict:
    return {
        "id": "tech-a",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-a"],
    }


def _database() -> SimpleNamespace:
    return SimpleNamespace(
        devices=_Collection([
            {"id": "device-a", "client_id": "client-a", "site_id": "site-a", "name": "CLIENT-A-01", "status": "online"},
            {"id": "device-b", "client_id": "client-b", "site_id": "site-b", "name": "CLIENT-B-01", "status": "warning"},
        ]),
        device_disks=_Collection([
            {"id": "disk-a", "device_id": "device-a", "usage_percent": 35},
            {"id": "disk-b", "device_id": "device-b", "usage_percent": 94},
        ]),
        alerts=_Collection([
            {"id": "alert-a", "device_id": "device-a", "title": "Observed A", "created_at": "2026-01-01T00:00:00+00:00"},
            {"id": "alert-b", "device_id": "device-b", "title": "Hidden B", "created_at": "2026-01-01T00:00:00+00:00"},
        ]),
        maintenance_runs=_Collection(),
        quick_script_runs=_Collection(),
        scope_denials=_Collection(),
    )


def test_legacy_report_is_retired_before_payload_or_database_access(monkeypatch):
    class _NoDatabaseAccess:
        def __getattr__(self, name):
            raise AssertionError(f"legacy report must not access db.{name}")

    monkeypatch.setattr(device_agent, "db", _NoDatabaseAccess())

    with pytest.raises(HTTPException) as retired:
        asyncio.run(device_agent.agent_report({"device_id": "device-b", "pending_patches": 0}))

    assert retired.value.status_code == 410


def test_disk_evidence_and_tags_mask_foreign_device_before_child_read_or_update(monkeypatch):
    database = _database()
    monkeypatch.setattr(device_agent, "db", database)
    monkeypatch.setattr(device_pulse, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    own_disks = asyncio.run(device_agent.get_device_disks("device-a", current_user=_restricted_user()))
    assert own_disks == [{"id": "disk-a", "device_id": "device-a", "usage_percent": 35}]

    database.device_disks.find_queries.clear()
    with pytest.raises(HTTPException) as denied_disks:
        asyncio.run(device_agent.get_device_disks("device-b", current_user=_restricted_user()))
    assert denied_disks.value.status_code == 404
    assert database.device_disks.find_queries == []

    with pytest.raises(HTTPException) as denied_tags:
        asyncio.run(device_pulse.update_tags("device-b", {"tags": ["tampered"]}, current_user=_restricted_user()))
    assert denied_tags.value.status_code == 404
    assert database.devices.update_calls == []


def test_fleet_and_alert_read_models_only_return_authorised_device_evidence(monkeypatch):
    database = _database()
    monkeypatch.setattr(device_pulse, "db", database)

    pulse = asyncio.run(device_pulse.fleet_pulse(_restricted_user()))
    anomalies = asyncio.run(device_pulse.anomalies(current_user=_restricted_user()))

    assert [tile["id"] for tile in pulse["tiles"]] == ["device-a"]
    assert pulse["tiles"][0]["trend_state"] == "not_collected"
    assert pulse["tiles"][0]["cpu_spark"] == []
    assert [alert["id"] for alert in anomalies["anomalies"]] == ["alert-a"]
    assert all("client-a" in str(query) for query in database.devices.find_queries)
    assert database.alerts.find_queries[-1] == {"device_id": {"$in": ["device-a"]}}


def test_fleet_pulse_marks_old_snapshots_stale_and_does_not_invent_a_health_score(monkeypatch):
    database = _database()
    database.devices.rows[0].update({
        "last_seen": "2020-01-01T00:00:00+00:00",
        "cpu_usage": 22,
        "memory_usage": 40,
        "disk_usage": 60,
    })
    monkeypatch.setattr(device_pulse, "db", database)

    pulse = asyncio.run(device_pulse.fleet_pulse(_restricted_user()))
    tile = pulse["tiles"][0]

    assert tile["observation_state"] == "stale"
    assert tile["health"] is None
    assert tile["cpu"] == 22
    assert tile["cpu_spark"] == []


def test_quick_scripts_are_honestly_rejected_without_a_command_record(monkeypatch):
    database = _database()
    monkeypatch.setattr(device_pulse, "db", database)

    with pytest.raises(HTTPException) as unavailable:
        asyncio.run(device_pulse.quick_scripts_run(
            {"script_id": "qs-flushdns", "device_ids": ["device-a"]},
            current_user=_restricted_user(),
        ))

    assert unavailable.value.status_code == 409
    assert database.quick_script_runs.inserted == []


def test_explicit_site_scope_masks_an_unassigned_device_for_direct_rmm_reads_and_mutations(monkeypatch):
    """A missing site binding must not bypass a technician's site allowlist."""
    database = _database()
    database.devices.rows.append({
        "id": "device-unassigned-site",
        "client_id": "client-a",
        "name": "UNASSIGNED-SITE-01",
        "status": "online",
    })
    monkeypatch.setattr(device_agent, "db", database)
    monkeypatch.setattr(device_pulse, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    with pytest.raises(HTTPException) as denied_disks:
        asyncio.run(device_agent.get_device_disks("device-unassigned-site", current_user=_restricted_user()))
    with pytest.raises(HTTPException) as denied_tags:
        asyncio.run(device_pulse.update_tags(
            "device-unassigned-site",
            {"tags": ["tampered"]},
            current_user=_restricted_user(),
        ))

    assert denied_disks.value.status_code == 404
    assert denied_tags.value.status_code == 404
    assert database.device_disks.find_queries == []
    assert database.devices.update_calls == []
    assert database.scope_denials.inserted[-1]["site_id"] is None


def test_discovery_import_uses_authorised_server_scan_not_browser_device_payload(monkeypatch):
    database = SimpleNamespace(
        clients=_Collection([{"id": "client-a", "name": "Client A"}]),
        devices=_Collection(),
        network_scans=_Collection([
            {
                "id": "scan-a", "client_id": "client-a", "created_at": "2026-08-30T00:00:00+00:00",
                "devices": [{"id": "finding-a", "hostname": "DISCOVERED-A", "ip_address": "10.0.0.10", "mac_address": "AA:BB:CC:DD:EE:01"}],
            },
            {
                "id": "scan-b", "client_id": "client-b", "created_at": "2026-08-30T00:00:00+00:00",
                "devices": [{"id": "finding-b", "hostname": "FOREIGN", "ip_address": "10.0.1.10", "mac_address": "AA:BB:CC:DD:EE:02"}],
            },
        ]),
        scope_denials=_Collection(),
    )
    operator = {**_restricted_user(), "site_scope_ids": []}
    monkeypatch.setattr(device_discovery, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    with pytest.raises(HTTPException) as raw_payload:
        asyncio.run(device_discovery.import_discovered_devices({
            "client_id": "client-a", "devices": [{"hostname": "FORGED"}],
        }, current_user=operator))
    assert raw_payload.value.status_code == 422

    imported = asyncio.run(device_discovery.import_discovered_devices({
        "scan_id": "scan-a", "device_ids": ["finding-a"],
    }, current_user=operator))
    assert imported["imported_count"] == 1
    assert database.devices.inserted[0]["name"] == "DISCOVERED-A"
    assert database.devices.inserted[0]["source_scan_id"] == "scan-a"
    assert database.devices.inserted[0]["status"] == "discovered"
    assert database.devices.inserted[0]["cpu_usage"] is None

    with pytest.raises(HTTPException) as foreign_scan:
        asyncio.run(device_discovery.import_discovered_devices({
            "scan_id": "scan-b", "device_ids": ["finding-b"],
        }, current_user=operator))
    assert foreign_scan.value.status_code == 404
    assert len(database.devices.inserted) == 1

    visible_scans = asyncio.run(device_discovery.get_scan_history(current_user=operator))
    assert [row["id"] for row in visible_scans] == ["scan-a"]


def test_third_party_patch_overview_never_seeds_fake_data_or_leaks_foreign_evidence(monkeypatch):
    apps = _Collection([
        {
            "id": "observed-a", "device_id": "device-a", "client_id": "client-a", "client_name": "Client A",
            "app_name": "Browser", "status": "outdated", "source": "nexus-agent", "observed_at": "2026-08-30T00:00:00+00:00",
        },
        {
            "id": "observed-b", "device_id": "device-b", "client_id": "client-b", "client_name": "Client B",
            "app_name": "Foreign", "status": "outdated", "source": "nexus-agent", "observed_at": "2026-08-30T00:00:00+00:00",
        },
        {"id": "legacy-unowned", "device_id": "device-b", "app_name": "Legacy fake", "status": "current"},
    ])
    database = SimpleNamespace(third_party_apps=apps, scope_denials=_Collection())
    operator = {**_restricted_user(), "site_scope_ids": []}
    monkeypatch.setattr(third_party_patching, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    overview = asyncio.run(third_party_patching.get_third_party_overview(operator))

    assert [app["id"] for app in overview["apps"]] == ["observed-a"]
    assert overview["summary"]["evidence_state"] == "observed"
    assert apps.inserted == []


def test_patch_compliance_requires_fresh_signed_patch_evidence_not_a_generic_heartbeat(monkeypatch):
    now = datetime.now(timezone.utc)
    database = SimpleNamespace(
        devices=_Collection([
            {
                "id": "current", "client_id": "client-a", "site_id": "site-a", "source": "nexus-agent",
                "pending_patches": 0, "patch_evidence_state": "reported", "patch_evidence_source": "nexus-agent",
                "patch_evidence_observed_at": now.isoformat(), "last_seen": now.isoformat(),
            },
            {
                "id": "stale", "client_id": "client-a", "site_id": "site-a", "source": "nexus-agent",
                "pending_patches": 2, "patch_evidence_state": "reported", "patch_evidence_source": "nexus-agent",
                "patch_evidence_observed_at": (now - timedelta(hours=2)).isoformat(), "last_seen": now.isoformat(),
            },
            {
                "id": "missing", "client_id": "client-a", "site_id": "site-a", "source": "nexus-agent",
                "pending_patches": 0, "patch_evidence_state": "not_reported", "last_seen": now.isoformat(),
            },
        ]),
    )
    monkeypatch.setattr(patch_compliance, "db", database)

    rows = asyncio.run(patch_compliance._observed_devices(_restricted_user()))
    by_id = {row["id"]: row for row in rows}

    assert by_id["current"]["assessment_state"] == "assessed"
    assert by_id["current"]["patch_status"] == "current"
    assert by_id["stale"]["assessment_state"] == "stale"
    assert by_id["stale"]["pending_patches"] is None
    assert by_id["stale"]["patch_status"] == "stale"
    assert by_id["missing"]["assessment_state"] == "not_assessed"
    assert by_id["missing"]["patch_status"] == "not_assessed"


def test_agent_patch_evidence_explicitly_clears_a_prior_count_when_collector_is_unavailable():
    observed_at = "2026-08-31T00:00:00+00:00"
    reported = nexus_agent._patch_evidence_update({"security": {"pending_update_count": 0}}, observed_at)
    unavailable = nexus_agent._patch_evidence_update({"security": {"defender_enabled": True}}, observed_at)

    assert reported["patch_evidence_state"] == "reported"
    assert reported["pending_patches"] == 0
    assert reported["patch_evidence_observed_at"] == observed_at
    assert unavailable["patch_evidence_state"] == "not_reported"
    assert unavailable["pending_patches"] is None
    assert unavailable["patch_evidence_observed_at"] is None
    assert unavailable["patch_evidence_not_reported_at"] == observed_at


def test_legacy_patch_routes_are_retired_before_database_access(monkeypatch):
    class _NoDatabaseAccess:
        def __getattr__(self, name):
            raise AssertionError(f"retired patch endpoint must not access db.{name}")

    monkeypatch.setattr(scripting, "db", _NoDatabaseAccess())
    calls = (
        lambda: scripting.get_patch_policies(current_user=_restricted_user()),
        lambda: scripting.create_patch_policy({}, current_user=_restricted_user()),
        lambda: scripting.update_patch_policy("legacy", {}, current_user=_restricted_user()),
        lambda: scripting.delete_patch_policy("legacy", current_user=_restricted_user()),
        lambda: scripting.get_patches(current_user=_restricted_user()),
        lambda: scripting.get_patches_dashboard(current_user=_restricted_user()),
        lambda: scripting.approve_patch("legacy", current_user=_restricted_user()),
        lambda: scripting.hide_patch("legacy", current_user=_restricted_user()),
    )
    for call in calls:
        with pytest.raises(HTTPException) as retired:
            asyncio.run(call())
        assert retired.value.status_code == 410


def test_lifecycle_record_cannot_be_deleted_while_linked_to_a_managed_endpoint(monkeypatch):
    database = SimpleNamespace(
        assets=_Collection([{"id": "asset-a", "client_id": "client-a", "site_id": "site-a", "name": "Endpoint inventory", "device_id": "device-a"}]),
        scope_denials=_Collection(),
    )
    monkeypatch.setattr(asset_lifecycle, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    with pytest.raises(HTTPException) as blocked:
        asyncio.run(asset_lifecycle.delete_lifecycle_asset("asset-a", current_user=_restricted_user()))

    assert blocked.value.status_code == 409
