"""Regression coverage for UniFi controller scope, secret, and egress boundaries."""

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

from app.routers import networking, unifi_controllers  # noqa: E402
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
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

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


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            clients=_Collection([
                {"id": "client-a", "name": "Client A", "tenant_id": "tenant-a"},
                {"id": "client-b", "name": "Client B", "tenant_id": "tenant-b"},
            ]),
            unifi_controllers=_Collection([
                {
                    "id": "controller-a",
                    "name": "A Controller",
                    "client_id": "client-a",
                    "tenant_id": "tenant-a",
                    "controller_url": "https://192.168.1.10:8443",
                    "network_site_id": "default",
                    "api_key_encrypted": encrypt_secret("client-a-secret"),
                    "verify_tls": True,
                },
                {
                    "id": "controller-b",
                    "name": "B Controller",
                    "client_id": "client-b",
                    "tenant_id": "tenant-b",
                    "controller_url": "https://192.168.2.10:8443",
                    "network_site_id": "default",
                    "api_key_encrypted": encrypt_secret("client-b-secret"),
                    "verify_tls": True,
                },
            ]),
            unifi_actions=_Collection(),
            audit_logs=_Collection(),
            permission_denials=_Collection(),
            scope_denials=_Collection(),
        )


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


def _global_operator() -> dict:
    return {"id": "admin-1", "name": "Administrator", "role": "admin", "is_admin": True, "tenant_id": "tenant-a"}


def _install_database(monkeypatch, database: _Database):
    monkeypatch.setattr(unifi_controllers, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(module_permissions, "db", database)


def test_scoped_controller_list_and_direct_access_mask_foreign_controllers(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    visible = asyncio.run(unifi_controllers.list_controllers(current_user=_restricted_operator()))
    assert [controller["id"] for controller in visible] == ["controller-a"]
    assert "api_key" not in visible[0]
    assert "api_key_encrypted" not in visible[0]
    assert visible[0]["api_key_preview"] == "...cret"

    async def unexpected_provider_call(*_args, **_kwargs):
        raise AssertionError("foreign controller must not reach the provider")

    monkeypatch.setattr(unifi_controllers, "_net_call", unexpected_provider_call)
    with pytest.raises(HTTPException) as foreign:
        asyncio.run(unifi_controllers.controller_summary("controller-b", current_user=_restricted_operator()))

    assert foreign.value.status_code == 404
    assert database.scope_denials.rows[-1]["client_id"] == "client-b"


def test_create_encrypts_credentials_and_rejects_unscoped_or_unsafe_targets(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    created = asyncio.run(unifi_controllers.create_controller({
        "name": "New A Controller",
        "client_id": "client-a",
        "controller_url": "https://192.168.20.10:8443/",
        "network_site_id": "default",
        "api_key": "never-store-this-plain",
    }, current_user=_restricted_operator()))
    stored = next(row for row in database.unifi_controllers.rows if row["id"] == created["id"])
    assert stored["controller_url"] == "https://192.168.20.10:8443"
    assert "api_key" not in stored
    assert decrypt_secret(stored["api_key_encrypted"]) == "never-store-this-plain"
    assert stored["client_id"] == "client-a"
    assert stored["tenant_id"] == "tenant-a"

    with pytest.raises(HTTPException) as global_controller:
        asyncio.run(unifi_controllers.create_controller({
            "name": "Unlinked",
            "controller_url": "https://192.168.20.11",
            "api_key": "key",
        }, current_user=_restricted_operator()))
    with pytest.raises(HTTPException) as unsafe_controller:
        asyncio.run(unifi_controllers.create_controller({
            "name": "Unsafe",
            "client_id": "client-a",
            "controller_url": "http://127.0.0.1",
            "api_key": "key",
        }, current_user=_restricted_operator()))

    assert global_controller.value.status_code == 403
    assert unsafe_controller.value.status_code == 422


def test_legacy_plaintext_key_is_migrated_only_after_authorised_read(monkeypatch):
    database = _Database()
    database.unifi_controllers.rows.append({
        "id": "legacy-global",
        "name": "Legacy",
        "controller_url": "https://operator:secret@controller.example.test/?token=secret",
        "network_site_id": "default",
        "api_key": "legacy-secret",
    })
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as foreign_legacy:
        asyncio.run(unifi_controllers.controller_summary("legacy-global", current_user=_restricted_operator()))
    assert foreign_legacy.value.status_code == 404
    legacy = next(row for row in database.unifi_controllers.rows if row["id"] == "legacy-global")
    assert legacy["api_key"] == "legacy-secret"

    legacy_operator = _global_operator()
    legacy_operator.pop("tenant_id")
    visible = asyncio.run(unifi_controllers.list_controllers(current_user=legacy_operator))
    public = next(row for row in visible if row["id"] == "legacy-global")
    legacy = next(row for row in database.unifi_controllers.rows if row["id"] == "legacy-global")
    assert legacy["client_id"] is None
    assert "api_key" not in legacy
    assert decrypt_secret(legacy["api_key_encrypted"]) == "legacy-secret"
    assert public["controller_url"] == ""
    assert "api_key_encrypted" not in public


def test_update_cannot_reassign_controller_client_ownership(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as transfer:
        asyncio.run(unifi_controllers.update_controller(
            "controller-a",
            {"client_id": "client-b"},
            current_user=_restricted_operator(),
        ))

    assert transfer.value.status_code == 422
    assert database.unifi_controllers.update_calls == []


def test_device_actions_are_scoped_audited_and_use_an_encoded_provider_path(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    calls = []

    async def provider_call(_controller, method, path, **_kwargs):
        calls.append((method, path))
        return {"accepted": True, "api_key": "must-not-escape"}

    monkeypatch.setattr(unifi_controllers, "_net_call", provider_call)
    result = asyncio.run(unifi_controllers.device_restart(
        "controller-a",
        "switch/one",
        current_user=_restricted_operator(),
    ))

    assert result == {"success": True, "message": "Restart issued"}
    assert calls == [("POST", "sites/default/devices/switch%2Fone/actions")]
    action = database.unifi_actions.inserted[-1]
    assert action["client_id"] == "client-a"
    assert action["device_id"] == "switch%2Fone"
    assert database.audit_logs.inserted[-1]["client_id"] == "client-a"
    assert "api_key" not in str(database.unifi_actions.inserted[-1])


def test_permission_is_checked_before_controller_lookup(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    denied_user = _restricted_operator()
    denied_user["permissions"] = {"networking": {"view": False}}

    with pytest.raises(HTTPException) as denied:
        asyncio.run(unifi_controllers.get_devices("controller-a", current_user=denied_user))

    assert denied.value.status_code == 403
    assert database.permission_denials.rows[-1]["permission"] == "networking.view"


def test_tenant_bound_administrator_cannot_list_or_operate_another_tenant_controller(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    visible = asyncio.run(unifi_controllers.list_controllers(current_user=_global_operator()))
    assert [controller["id"] for controller in visible] == ["controller-a"]

    async def unexpected_provider_call(*_args, **_kwargs):
        raise AssertionError("cross-tenant controller must not reach the provider")

    monkeypatch.setattr(unifi_controllers, "_net_call", unexpected_provider_call)
    with pytest.raises(HTTPException) as foreign:
        asyncio.run(unifi_controllers.controller_summary("controller-b", current_user=_global_operator()))
    assert foreign.value.status_code == 404
    assert database.scope_denials.rows[-1]["tenant_id"] == "tenant-b"


def test_short_credentials_are_rejected_and_never_fully_exposed_in_previews(monkeypatch):
    database = _Database()
    database.unifi_controllers.rows[0]["api_key_encrypted"] = encrypt_secret("short")
    _install_database(monkeypatch, database)

    visible = asyncio.run(unifi_controllers.list_controllers(current_user=_restricted_operator()))
    assert visible[0]["api_key_preview"] == "configured"

    with pytest.raises(HTTPException) as short_key:
        asyncio.run(unifi_controllers.create_controller({
            "name": "Too Short",
            "client_id": "client-a",
            "controller_url": "https://192.168.20.10",
            "api_key": "short",
        }, current_user=_restricted_operator()))
    assert short_key.value.status_code == 422


def test_production_egress_requires_allowlisting_non_global_cgnat_targets(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("NEXUS_UNIFI_ALLOWED_HOSTS", raising=False)

    with pytest.raises(HTTPException) as blocked:
        networking._normalise_unifi_controller_url("http://100.64.0.1")

    assert blocked.value.status_code == 422
