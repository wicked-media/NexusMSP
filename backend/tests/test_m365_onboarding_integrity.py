"""Focused integrity tests for Microsoft 365 multi-tenant onboarding."""

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

from app.routers import m365  # noqa: E402
from app.services.secret_store import decrypt_secret  # noqa: E402


class SettingsCollection:
    def __init__(self):
        self.saved = None

    async def update_one(self, _query, update, **_kwargs):
        self.saved = update["$set"]["value"]


class FindOneCollection:
    def __init__(self, result=None):
        self.result = result

    async def find_one(self, *_args, **_kwargs):
        return self.result


def test_rotated_partner_credentials_clear_stale_verification(monkeypatch):
    settings = {
        "app_id": "old-app",
        "partner_tenant_id": "partner-tenant",
        "tenant_id": "partner-tenant",
        "app_secret": "old-secret",
        "last_test_status": "success",
        "last_tested_at": "2026-07-01T00:00:00+00:00",
        "verified_at": "2026-07-01T00:00:00+00:00",
        "sync_provider": "m365_partner_center",
    }
    collection = SettingsCollection()

    async def get_settings(**_kwargs):
        return dict(settings)

    async def log_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(m365, "_get_settings", get_settings)
    monkeypatch.setattr(m365, "db", SimpleNamespace(settings=collection))
    monkeypatch.setattr(m365, "log_activity", log_activity)

    result = asyncio.run(m365.update_connection(
        {"app_secret": "rotated-secret", "refresh_token": "rotated-refresh-token"},
        current_user={"name": "Aaron", "role": "admin"},
        _={},
    ))

    assert result["mode"] == "configured_unverified"
    assert "app_secret" not in collection.saved
    assert "refresh_token" not in collection.saved
    assert decrypt_secret(collection.saved["app_secret_encrypted"]) == "rotated-secret"
    assert decrypt_secret(collection.saved["refresh_token_encrypted"]) == "rotated-refresh-token"
    assert collection.saved.get("last_test_status") is None
    assert collection.saved.get("last_tested_at") is None
    assert collection.saved.get("verified_at") is None
    assert collection.saved.get("sync_provider") is None
    assert collection.saved.get("credentials_changed_at")


def test_noncredential_connection_metadata_preserves_last_test(monkeypatch):
    settings = {
        "app_id": "app-id",
        "partner_tenant_id": "partner-tenant",
        "tenant_id": "partner-tenant",
        "app_secret": "secret",
        "app_secret_encrypted": m365.encrypt_secret("secret"),
        "last_test_status": "success",
        "last_tested_at": "2026-07-01T00:00:00+00:00",
    }
    collection = SettingsCollection()

    async def get_settings(**_kwargs):
        return dict(settings)

    async def log_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(m365, "_get_settings", get_settings)
    monkeypatch.setattr(m365, "db", SimpleNamespace(settings=collection))
    monkeypatch.setattr(m365, "log_activity", log_activity)

    asyncio.run(m365.update_connection(
        {"partner_center_account": "operations@example.com"},
        current_user={"name": "Aaron", "role": "admin"},
        _={},
    ))

    assert collection.saved["last_test_status"] == "success"
    assert collection.saved["last_tested_at"] == "2026-07-01T00:00:00+00:00"
    assert "app_secret" not in collection.saved
    assert decrypt_secret(collection.saved["app_secret_encrypted"]) == "secret"


def test_connection_payload_exposes_only_secret_configuration_flags(monkeypatch):
    class TenantCollection:
        async def count_documents(self, _query):
            return 0

    async def get_settings(**_kwargs):
        return {
            "app_id": "app-id",
            "partner_tenant_id": "partner-tenant",
            "app_secret": "partner-secret-value",
            "refresh_token": "refresh-token-value",
        }

    monkeypatch.setattr(m365, "_get_settings", get_settings)
    monkeypatch.setattr(m365, "db", SimpleNamespace(m365_tenants=TenantCollection()))

    payload = asyncio.run(m365._connection_payload())

    assert payload["secret_configured"] is True
    assert payload["refresh_token_configured"] is True
    assert "app_secret" not in payload
    assert "refresh_token" not in payload
    assert "partner-secret-value" not in payload.values()
    assert "refresh-token-value" not in payload.values()


def test_legacy_partner_credentials_are_lazily_encrypted_for_global_workflows(monkeypatch):
    class SettingsCollection:
        def __init__(self):
            self.updates = []

        async def find_one(self, *_args, **_kwargs):
            return {
                "key": "m365_connection",
                "value": {
                    "app_secret": "legacy-partner-secret",
                    "app_secret_encrypted": "",
                    "refresh_token": "legacy-refresh-token",
                },
            }

        async def update_one(self, query, update, **_kwargs):
            self.updates.append((query, update))

    collection = SettingsCollection()
    monkeypatch.setattr(m365, "db", SimpleNamespace(settings=collection))

    settings = asyncio.run(m365._get_settings(migrate_legacy=True))

    assert settings["app_secret"] == "legacy-partner-secret"
    assert settings["refresh_token"] == "legacy-refresh-token"
    migrations = {
        next(iter(update["$set"])): next(iter(update["$set"].values()))
        for _query, update in collection.updates
    }
    assert decrypt_secret(migrations["value.app_secret_encrypted"]) == "legacy-partner-secret"
    assert decrypt_secret(migrations["value.refresh_token_encrypted"]) == "legacy-refresh-token"
    assert all(
        update["$unset"] in (
            {"value.app_secret": ""},
            {"value.refresh_token": ""},
        )
        for _query, update in collection.updates
    )


def test_unreadable_encrypted_partner_secret_does_not_fall_back_to_plaintext(monkeypatch):
    class SettingsCollection:
        def __init__(self):
            self.updates = []

        async def find_one(self, *_args, **_kwargs):
            return {
                "key": "m365_connection",
                "value": {
                    "app_id": "app-id",
                    "partner_tenant_id": "partner-tenant",
                    "app_secret": "stale-plaintext-secret",
                    "app_secret_encrypted": "unreadable-ciphertext",
                },
            }

        async def update_one(self, query, update, **_kwargs):
            self.updates.append((query, update))

    collection = SettingsCollection()
    monkeypatch.setattr(m365, "db", SimpleNamespace(settings=collection))

    settings = asyncio.run(m365._get_settings(migrate_legacy=True))

    assert settings["app_secret"] == ""
    assert m365._connection_status(settings) == "incomplete"
    assert collection.updates[0][1] == {"$unset": {"value.app_secret": ""}}


def test_client_cannot_silently_replace_another_tenant(monkeypatch):
    client = {
        "id": "client-001",
        "name": "Acme",
        "cipp_tenant_id": "tenant-existing",
        "cipp_tenant_display": "Acme Existing",
    }
    monkeypatch.setattr(
        m365,
        "db",
        SimpleNamespace(
            clients=FindOneCollection(client),
            m365_tenant_connections=FindOneCollection(None),
        ),
    )

    with pytest.raises(HTTPException) as conflict:
        asyncio.run(m365._mapping_target_client("tenant-new", "client-001"))

    assert conflict.value.status_code == 409
    assert "already linked" in conflict.value.detail


def test_registry_duplicate_mapping_is_rejected(monkeypatch):
    client = {"id": "client-001", "name": "Acme"}
    duplicate = {"tenant_id": "tenant-existing", "tenant_name": "Acme Existing"}
    monkeypatch.setattr(
        m365,
        "db",
        SimpleNamespace(
            clients=FindOneCollection(client),
            m365_tenant_connections=FindOneCollection(duplicate),
        ),
    )

    with pytest.raises(HTTPException) as conflict:
        asyncio.run(m365._mapping_target_client("tenant-new", "client-001"))

    assert conflict.value.status_code == 409
    assert "onboarding registry" in conflict.value.detail

