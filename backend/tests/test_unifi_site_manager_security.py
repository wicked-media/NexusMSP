"""Security regression coverage for the MSP-wide UniFi Site Manager routes."""

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

from app.routers import unifi  # noqa: E402
from app.services import module_permissions, scope_permissions  # noqa: E402
from app.services.secret_store import decrypt_secret, encrypt_secret  # noqa: E402


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
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            if "$ne" in expected and actual == expected["$ne"]:
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
        self.indexes: list[tuple] = []

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
            document = {key: value for key, value in query.items() if not isinstance(value, dict)}
            document.update(deepcopy(update.get("$set", {})))
            self.rows.append(document)
            self.inserted.append(document)
            return SimpleNamespace(matched_count=0, modified_count=0)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def count_documents(self, query: dict):
        return sum(1 for row in self.rows if _matches(row, query))

    async def create_index(self, keys, **kwargs):
        self.indexes.append((deepcopy(keys), deepcopy(kwargs)))
        return kwargs.get("name")


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            settings=_Collection([{
                "type": "unifi",
                "controller_url": "https://192.168.10.10:8443",
                "api_key_encrypted": encrypt_secret("direct-controller-secret"),
                "api_key_full": "legacy-site-manager-secret",
                "base_url": "https://api.ui.com/v1",
            }]),
            clients=_Collection([
                {"id": "client-a", "name": "Client A", "tenant_id": "tenant-a"},
                {"id": "client-b", "name": "Client B", "tenant_id": "tenant-b"},
            ]),
            unifi_actions=_Collection(),
            unifi_site_cache=_Collection(),
            audit_logs=_Collection(),
            permission_denials=_Collection(),
            scope_denials=_Collection(),
        )


def _global_operator(tenant_id: str = "tenant-a") -> dict:
    return {"id": f"admin-{tenant_id}", "name": "Administrator", "role": "admin", "is_admin": True, "tenant_id": tenant_id}


def _restricted_operator() -> dict:
    return {
        "id": "tech-a",
        "name": "Technician A",
        "role": "technician",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "permissions": {"networking": {"view": True, "create": True, "edit": True, "delete": True}},
    }


def _install_database(monkeypatch, database: _Database):
    monkeypatch.setattr(unifi, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(module_permissions, "db", database)


def _bind_site_manager() -> None:
    asyncio.run(unifi.save_settings({
        "api_key": "test-site-manager-key",
        "base_url": "https://api.ui.com/v1",
    }, current_user=_global_operator()))


def test_legacy_credentials_require_an_explicit_tenant_bound_resave(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(unifi.get_settings(current_user=_restricted_operator()))
    assert denied.value.status_code == 403
    assert database.settings.rows[0]["api_key_full"] == "legacy-site-manager-secret"

    settings = asyncio.run(unifi.get_settings(current_user=_global_operator()))
    stored = database.settings.rows[0]
    assert settings == {
        "configured": False,
        "migration_required": True,
        "base_url": unifi.DEFAULT_BASE_URL,
        "api_key_preview": None,
        "last_test_status": None,
        "last_tested_at": None,
        "last_synced_at": None,
    }
    assert stored["api_key_full"] == "legacy-site-manager-secret"
    assert unifi.SITE_MANAGER_TENANT_FIELD not in stored

    _bind_site_manager()
    stored = database.settings.rows[0]
    assert stored[unifi.SITE_MANAGER_TENANT_FIELD] == "tenant-a"
    assert "api_key_full" not in stored
    assert decrypt_secret(stored[unifi.SITE_MANAGER_KEY_FIELD]) == "test-site-manager-key"
    assert decrypt_secret(stored["api_key_encrypted"]) == "direct-controller-secret"


def test_site_manager_settings_encrypt_and_never_delete_direct_controller_settings(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    asyncio.run(unifi.save_settings({
        "api_key": "new-site-manager-key",
        "base_url": "https://api.ui.com/ea/",
    }, current_user=_global_operator()))
    stored = database.settings.rows[0]
    assert decrypt_secret(stored[unifi.SITE_MANAGER_KEY_FIELD]) == "new-site-manager-key"
    assert stored[unifi.SITE_MANAGER_BASE_URL_FIELD] == "https://api.ui.com/ea"
    assert "api_key_full" not in stored
    assert decrypt_secret(stored["api_key_encrypted"]) == "direct-controller-secret"

    asyncio.run(unifi.delete_settings(current_user=_global_operator()))
    stored = database.settings.rows[0]
    assert unifi.SITE_MANAGER_KEY_FIELD not in stored
    assert stored["controller_url"] == "https://192.168.10.10:8443"
    assert decrypt_secret(stored["api_key_encrypted"]) == "direct-controller-secret"

    with pytest.raises(HTTPException) as unsafe:
        asyncio.run(unifi.save_settings({
            "api_key": "key",
            "base_url": "http://127.0.0.1:8000",
        }, current_user=_global_operator()))
    assert unsafe.value.status_code == 422


def test_site_manager_preview_never_discloses_an_accepted_short_credential(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    asyncio.run(unifi.save_settings({
        "api_key": "abcd",
        "base_url": "https://api.ui.com/v1",
    }, current_user=_global_operator()))

    assert database.settings.rows[0][unifi.SITE_MANAGER_PREVIEW_FIELD] == "configured"


def test_direct_controller_settings_do_not_get_claimed_by_a_status_read(monkeypatch):
    database = _Database()
    database.settings.rows[0].pop("api_key_full")
    database.settings.rows[0].pop("base_url")
    _install_database(monkeypatch, database)

    status = asyncio.run(unifi.get_settings(current_user=_global_operator("tenant-a")))
    assert status["configured"] is False
    assert status["migration_required"] is False
    assert unifi.SITE_MANAGER_TENANT_FIELD not in database.settings.rows[0]

    asyncio.run(unifi.save_settings({
        "api_key": "tenant-b-site-manager-key",
        "base_url": "https://api.ui.com/v1",
    }, current_user=_global_operator("tenant-b")))
    assert database.settings.rows[0][unifi.SITE_MANAGER_TENANT_FIELD] == "tenant-b"


def test_site_manager_tenant_boundary_masks_foreign_clients_and_action_history(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    _bind_site_manager()
    database.unifi_actions.rows.extend([
        {"id": "action-a", "tenant_id": "tenant-a", "action": "restart", "result": "token=historic-provider-token"},
        {"id": "action-b", "tenant_id": "tenant-b", "action": "restart", "result": "token=tenant-b-token"},
    ])

    async def provider_sites(*_args, **_kwargs):
        raise AssertionError("foreign client must be rejected before a provider call")

    monkeypatch.setattr(unifi, "_unifi_paged", provider_sites)
    with pytest.raises(HTTPException) as denied:
        asyncio.run(unifi.link_unifi_site(
            "client-b",
            {"site_id": "provider-site-b"},
            current_user=_global_operator("tenant-a"),
        ))
    assert denied.value.status_code == 404

    actions = asyncio.run(unifi.actions_log(current_user=_global_operator("tenant-a")))
    assert actions == [{"id": "action-a", "tenant_id": "tenant-a", "action": "restart"}]
    assert "historic-provider-token" not in str(actions)

    with pytest.raises(HTTPException) as other_tenant:
        asyncio.run(unifi.get_settings(current_user=_global_operator("tenant-b")))
    assert other_tenant.value.status_code == 404


def test_client_link_is_verified_and_uses_canonical_provider_metadata(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    _bind_site_manager()

    async def provider_sites(*_args, **_kwargs):
        return [{"id": "provider-site-a", "hostId": "host-a", "meta": {"name": "Canonical Site"}}]

    monkeypatch.setattr(unifi, "_unifi_paged", provider_sites)
    linked = asyncio.run(unifi.link_unifi_site(
        "client-a",
        {"site_id": "provider-site-a", "site_name": "Attacker Name", "host_id": "attacker-host"},
        current_user=_global_operator(),
    ))
    client = database.clients.rows[0]
    assert linked["site_id"] == "provider-site-a"
    assert client["unifi_site_name"] == "Canonical Site"
    assert client["unifi_host_id"] == "host-a"
    assert database.clients.indexes[-1][1]["unique"] is True

    database.clients.rows[1]["unifi_site_id"] = "provider-site-a"
    with pytest.raises(HTTPException) as duplicate:
        asyncio.run(unifi.link_unifi_site(
            "client-a",
            {"site_id": "provider-site-a"},
            current_user=_global_operator(),
        ))
    assert duplicate.value.status_code == 409


def test_actions_are_global_audited_and_cannot_override_the_server_action(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    _bind_site_manager()
    calls = []

    async def provider_call(method, path, params=None, json_body=None):
        calls.append((method, path, json_body))
        return {"accepted": True, "token": "never-return"}

    monkeypatch.setattr(unifi, "_unifi_call", provider_call)
    result = asyncio.run(unifi.device_restart(
        "device/one",
        {"host_id": "host-a", "action": "power-cycle", "portIdx": 999},
        current_user=_global_operator(),
    ))
    assert result == {"success": True, "message": "Restart issued"}
    assert calls[0] == ("POST", "hosts/host-a/devices/device%2Fone/actions", {"action": "restart"})
    assert database.unifi_actions.inserted[-1]["success"] is True
    assert database.audit_logs.inserted[-1]["operation"] == "unifi.site_manager.device_restart"

    with pytest.raises(HTTPException) as restricted:
        asyncio.run(unifi.device_restart("device-a", {}, current_user=_restricted_operator()))
    assert restricted.value.status_code == 403


def test_summary_cache_has_both_nexus_client_and_provider_site_identity(monkeypatch):
    database = _Database()
    database.clients.rows[0]["unifi_site_id"] = "provider-site-a"
    _install_database(monkeypatch, database)
    _bind_site_manager()

    async def provider_call(method, path, params=None, json_body=None):
        assert (method, path) == ("GET", "sites")
        return {"data": [{
            "id": "provider-site-a",
            "hostId": "host-a",
            "meta": {"name": "Canonical Site"},
            "statistics": {"counts": {"totalDevice": 4, "offlineDevice": 1, "wifiClient": 2, "wiredClient": 1}},
        }]}

    monkeypatch.setattr(unifi, "_unifi_call", provider_call)
    summary = asyncio.run(unifi.unifi_summary(current_user=_global_operator()))
    cache = database.unifi_site_cache.inserted[-1]
    assert summary["stats"]["sites"] == 1
    assert cache["site_id"] == "provider-site-a"
    assert cache["client_id"] == "client-a"
    assert cache["tenant_id"] == "tenant-a"
