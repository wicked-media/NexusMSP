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

    async def get_settings():
        return dict(settings)

    async def log_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(m365, "_get_settings", get_settings)
    monkeypatch.setattr(m365, "db", SimpleNamespace(settings=collection))
    monkeypatch.setattr(m365, "log_activity", log_activity)

    asyncio.run(m365.update_connection(
        {"app_secret": "rotated-secret"},
        current_user={"name": "Aaron"},
        _={},
    ))

    assert collection.saved["app_secret"] == "rotated-secret"
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
        "last_test_status": "success",
        "last_tested_at": "2026-07-01T00:00:00+00:00",
    }
    collection = SettingsCollection()

    async def get_settings():
        return dict(settings)

    async def log_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(m365, "_get_settings", get_settings)
    monkeypatch.setattr(m365, "db", SimpleNamespace(settings=collection))
    monkeypatch.setattr(m365, "log_activity", log_activity)

    asyncio.run(m365.update_connection(
        {"partner_center_account": "operations@example.com"},
        current_user={"name": "Aaron"},
        _={},
    ))

    assert collection.saved["last_test_status"] == "success"
    assert collection.saved["last_tested_at"] == "2026-07-01T00:00:00+00:00"


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

