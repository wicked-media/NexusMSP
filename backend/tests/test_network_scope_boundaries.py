"""Regression coverage for Nexus network and bandwidth client boundaries."""

from __future__ import annotations

import asyncio
import os
import sys
from copy import deepcopy
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

from app.routers import bandwidth_monitor, networking  # noqa: E402
from app.services import module_permissions, scope_permissions  # noqa: E402
from app.services.secret_store import decrypt_secret  # noqa: E402


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
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    def sort(self, _field: str, _direction: int):
        return self

    async def to_list(self, limit: int):
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])
        self.inserted: list[dict] = []
        self.update_calls: list[tuple[dict, dict]] = []
        self.deleted: list[dict] = []

    async def find_one(self, query: dict, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict):
        copy = deepcopy(document)
        self.rows.append(copy)
        self.inserted.append(copy)
        return SimpleNamespace(inserted_id=copy.get("id"))

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        self.update_calls.append((deepcopy(query), deepcopy(update)))
        for row in self.rows:
            if _matches(row, query):
                for key, value in update.get("$set", {}).items():
                    row[key] = deepcopy(value)
                for key in update.get("$unset", {}):
                    row.pop(key, None)
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            document = dict(query)
            document.update(deepcopy(update.get("$set", {})))
            self.rows.append(document)
            self.inserted.append(document)
            return SimpleNamespace(matched_count=0, modified_count=0)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query: dict):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.deleted.append(deepcopy(row))
                del self.rows[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query: dict):
        deleted = [row for row in self.rows if _matches(row, query)]
        self.deleted.extend(deepcopy(deleted))
        self.rows = [row for row in self.rows if not _matches(row, query)]
        return SimpleNamespace(deleted_count=len(deleted))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            clients=_Collection([
                {"id": "client-a", "name": "Client A"},
                {"id": "client-b", "name": "Client B"},
            ]),
            network_sites=_Collection([
                {"id": "site-a", "client_id": "client-a", "client_name": "Client A", "site_id": "default", "name": "A Network", "controller_url": "https://192.168.1.1:8443"},
                {"id": "site-b", "client_id": "client-b", "client_name": "Client B", "site_id": "default", "name": "B Network", "controller_url": "https://192.168.2.1:8443"},
                {"id": "site-legacy", "client_id": "client-a", "client_name": "Client A", "site_id": "legacy", "name": "Legacy Network", "controller_url": "https://192.168.3.1:8443", "username": "legacy-user", "password": "legacy-password"},
            ]),
            network_devices=_Collection([
                {"id": "device-a", "site_id": "site-a", "client_id": "client-a", "name": "A switch", "status": "online", "device_type": "switch"},
                {"id": "device-b", "site_id": "site-b", "client_id": "client-b", "name": "B switch", "status": "offline", "device_type": "switch"},
            ]),
            network_clients=_Collection([
                {"id": "network-client-a", "site_id": "site-a", "client_id": "client-a", "name": "A endpoint", "rx_bytes": 20, "tx_bytes": 10},
                {"id": "network-client-b", "site_id": "site-b", "client_id": "client-b", "name": "B endpoint", "rx_bytes": 200, "tx_bytes": 100},
            ]),
            network_wlans=_Collection([
                {"id": "wlan-b", "site_id": "site-b", "client_id": "client-b", "name": "B Wi-Fi", "password": "legacy-psk"},
            ]),
            network_port_profiles=_Collection([
                {"id": "profile-b", "site_id": "site-b", "client_id": "client-b"},
            ]),
            network_dpi=_Collection([
                {"id": "dpi-b", "site_id": "site-b", "client_id": "client-b", "categories": ["streaming"]},
            ]),
            bandwidth_data=_Collection([
                {"id": "bandwidth-a", "site_id": "site-a", "client_id": "client-a", "download_mbps": 10},
                {"id": "bandwidth-b", "site_id": "site-b", "client_id": "client-b", "download_mbps": 90},
            ]),
            bandwidth_alerts=_Collection([
                {"id": "alert-a", "site_id": "site-a", "client_id": "client-a", "site_name": "A Network", "resolved": False},
                {"id": "alert-b", "site_id": "site-b", "client_id": "client-b", "site_name": "B Network", "resolved": False},
            ]),
            settings=_Collection(),
            audit_logs=_Collection(),
            permission_denials=_Collection(),
            scope_denials=_Collection(),
        )


def _restricted_operator() -> dict:
    return {
        "id": "tech-a",
        "name": "Technician A",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-a"],
        "permissions": {"networking": {"view": True, "create": True, "edit": True, "delete": True}},
    }


def _global_operator() -> dict:
    return {"id": "admin-1", "name": "Administrator", "role": "admin", "is_admin": True}


def _install_database(monkeypatch, database: _Database):
    monkeypatch.setattr(networking, "db", database)
    monkeypatch.setattr(bandwidth_monitor, "db", database)
    monkeypatch.setattr(module_permissions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)


def test_network_site_lists_and_children_use_the_nexus_site_scope(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    visible = asyncio.run(networking.get_networking_sites(current_user=_restricted_operator()))
    own_devices = asyncio.run(networking.get_site_devices("site-a", current_user=_restricted_operator()))

    assert [site["id"] for site in visible] == ["site-a"]
    assert [device["id"] for device in own_devices] == ["device-a"]

    with pytest.raises(HTTPException) as foreign_site:
        asyncio.run(networking.get_networking_site("site-b", current_user=_restricted_operator()))
    with pytest.raises(HTTPException) as foreign_children:
        asyncio.run(networking.get_site_devices("site-b", current_user=_restricted_operator()))

    assert foreign_site.value.status_code == 404
    assert foreign_children.value.status_code == 404
    assert database.scope_denials.rows[-1]["site_id"] == "site-b"


def test_legacy_controller_url_credentials_are_never_reflected(monkeypatch):
    database = _Database()
    database.network_sites.rows[0]["controller_url"] = "https://operator:secret@192.168.1.1:8443/?token=secret"
    _install_database(monkeypatch, database)

    listed = asyncio.run(networking.get_networking_sites(current_user=_restricted_operator()))
    direct = asyncio.run(networking.get_networking_site("site-a", current_user=_restricted_operator()))
    overview = asyncio.run(bandwidth_monitor.get_bandwidth_overview(current_user=_restricted_operator()))

    assert listed[0]["controller_url"] == ""
    assert direct["controller_url"] == ""
    assert overview["sites"][0]["controller_url"] == ""


def test_network_child_mutations_are_blocked_before_the_write(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as foreign_device:
        asyncio.run(networking.update_network_device("device-b", {"name": "tampered"}, current_user=_restricted_operator()))
    with pytest.raises(HTTPException) as foreign_wlan:
        asyncio.run(networking.delete_wlan("wlan-b", current_user=_restricted_operator()))

    assert foreign_device.value.status_code == 404
    assert foreign_wlan.value.status_code == 404
    assert database.network_devices.update_calls == []
    assert database.network_wlans.deleted == []


def test_network_permission_is_enforced_before_a_scoped_read(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    no_network_access = _restricted_operator()
    no_network_access["permissions"] = {"networking": {"view": False}}

    with pytest.raises(HTTPException) as denied:
        asyncio.run(networking.get_networking_site("site-a", current_user=no_network_access))

    assert denied.value.status_code == 403
    assert database.permission_denials.rows[-1]["permission"] == "networking.view"


def test_bandwidth_reads_and_alert_resolution_authorize_the_parent_site(monkeypatch):
    database = _Database()
    database.network_sites.rows[0].update({
        "username": "never-return",
        "password": "never-return",
        "api_key": "never-return",
        "password_encrypted": "never-return",
    })
    _install_database(monkeypatch, database)

    overview = asyncio.run(bandwidth_monitor.get_bandwidth_overview(current_user=_restricted_operator()))
    alerts = asyncio.run(bandwidth_monitor.get_bandwidth_alerts(current_user=_restricted_operator()))

    assert [site["id"] for site in overview["sites"]] == ["site-a"]
    assert not set(overview["sites"][0]).intersection({"username", "password", "api_key", "password_encrypted"})
    assert [entry["site_id"] for entry in overview["bandwidth_data"]] == ["site-a"]
    assert [alert["id"] for alert in alerts] == ["alert-a"]

    with pytest.raises(HTTPException) as foreign_data:
        asyncio.run(bandwidth_monitor.get_site_bandwidth("site-b", current_user=_restricted_operator()))
    with pytest.raises(HTTPException) as foreign_alert:
        asyncio.run(bandwidth_monitor.resolve_bandwidth_alert("alert-b", {}, current_user=_restricted_operator()))

    assert foreign_data.value.status_code == 404
    assert foreign_alert.value.status_code == 404
    assert database.bandwidth_alerts.rows[1]["resolved"] is False
    assert database.audit_logs.inserted == []


def test_network_site_creation_derives_client_ownership_and_encrypts_credentials(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    client_scoped_user = _restricted_operator()
    client_scoped_user["site_scope_ids"] = []

    created = asyncio.run(networking.create_networking_site({
        "name": "A New Site",
        "client_id": "client-a",
        "client_name": "Attacker-supplied value",
        "controller_url": "https://192.168.10.1:8443",
        "username": "unifi-admin",
        "password": "do-not-store-me-plain",
    }, current_user=client_scoped_user))

    stored = database.network_sites.inserted[-1]
    assert created["client_name"] == "Client A"
    assert "username" not in created
    assert "password" not in created
    assert "username" not in stored
    assert "password" not in stored
    assert decrypt_secret(stored["password_encrypted"]) == "do-not-store-me-plain"

    inserted_count = len(database.network_sites.inserted)
    with pytest.raises(HTTPException) as foreign_client:
        asyncio.run(networking.create_networking_site({"name": "Foreign", "client_id": "client-b"}, current_user=client_scoped_user))
    with pytest.raises(HTTPException) as unlinked_site:
        asyncio.run(networking.create_networking_site({"name": "Unlinked"}, current_user=_restricted_operator()))

    assert foreign_client.value.status_code == 404
    assert unlinked_site.value.status_code == 403
    assert len(database.network_sites.inserted) == inserted_count

    with pytest.raises(HTTPException) as site_restricted:
        asyncio.run(networking.create_networking_site(
            {"name": "Unapproved new site", "client_id": "client-a"},
            current_user=_restricted_operator(),
        ))
    assert site_restricted.value.status_code == 404
    assert len(database.network_sites.inserted) == inserted_count


def test_legacy_credentials_are_migrated_and_unsafe_controller_origins_are_rejected(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    client_scoped_user = _restricted_operator()
    client_scoped_user["site_scope_ids"] = []
    returned = asyncio.run(networking.get_networking_site("site-legacy", current_user=client_scoped_user))
    stored = next(site for site in database.network_sites.rows if site["id"] == "site-legacy")

    assert "username" not in returned
    assert "password" not in returned
    assert "username" not in stored
    assert "password" not in stored
    assert decrypt_secret(stored["password_encrypted"]) == "legacy-password"
    assert networking._normalise_unifi_controller_url("https://192.168.1.1:8443/") == "https://192.168.1.1:8443"

    for unsafe in (
        "http://127.0.0.1",
        "http://169.254.169.254",
        "http://127.1",
        "https://user:password@example.test",
        "https://controller.example.test/?token=unexpected",
    ):
        with pytest.raises(HTTPException):
            networking._normalise_unifi_controller_url(unsafe)

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("NEXUS_UNIFI_ALLOWED_HOSTS", raising=False)
    with pytest.raises(HTTPException) as unapproved_hostname:
        networking._normalise_unifi_controller_url("https://controller.example.test")
    with pytest.raises(HTTPException) as unapproved_private_ip:
        networking._normalise_unifi_controller_url("https://192.168.1.1:8443")
    with pytest.raises(HTTPException) as unapproved_mapped_private_ip:
        networking._normalise_unifi_controller_url("https://[::ffff:10.0.0.1]")
    monkeypatch.setenv("NEXUS_UNIFI_ALLOWED_HOSTS", "controller.example.test,192.168.1.1,::ffff:10.0.0.1")
    assert networking._normalise_unifi_controller_url("https://controller.example.test") == "https://controller.example.test"
    assert networking._normalise_unifi_controller_url("https://192.168.1.1:8443") == "https://192.168.1.1:8443"
    assert unapproved_hostname.value.status_code == 422
    assert unapproved_private_ip.value.status_code == 422
    assert unapproved_mapped_private_ip.value.status_code == 422


def test_network_dashboard_and_stats_do_not_aggregate_foreign_site_children(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    stats = asyncio.run(networking.get_networking_stats(current_user=_restricted_operator()))
    dashboard = asyncio.run(networking.get_networking_dashboard(current_user=_restricted_operator()))

    assert stats["total_sites"] == 1
    assert stats["total_devices"] == 1
    assert dashboard["summary"]["total_clients"] == 1
    assert [row["site_id"] for row in dashboard["site_bandwidth"]] == ["site-a"]
