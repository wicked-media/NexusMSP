"""Security regression coverage for the canonical Huntress credential owner."""

import asyncio
import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import huntress  # noqa: E402
from app.services.secret_store import decrypt_secret  # noqa: E402


class _Settings:
    def __init__(self):
        self.document = None
        self.updates = []

    async def find_one(self, _query, _projection=None):
        return dict(self.document) if self.document else None

    async def update_one(self, _query, update, upsert=False):
        self.updates.append((dict(_query), dict(update), upsert))
        self.document = {**(self.document or {}), **update.get("$set", {})}
        for field in update.get("$unset", {}):
            self.document.pop(field, None)


class _Database:
    def __init__(self):
        self.settings = _Settings()


def test_huntress_save_encrypts_both_credentials_and_removes_plaintext(monkeypatch):
    database = _Database()
    monkeypatch.setattr(huntress, "db", database)

    async def allow(*_args, **_kwargs):
        return None

    monkeypatch.setattr(huntress, "_require_global_huntress_access", allow)
    monkeypatch.setattr(huntress, "require_module_permission", allow)

    asyncio.run(huntress.save_huntress_settings(
        {"api_key": "provider-api-key", "secret_key": "provider-secret-key"},
        {"id": "admin-1", "name": "Administrator"},
    ))

    document = database.settings.document
    assert document["api_key_encrypted"] != "provider-api-key"
    assert document["secret_key_encrypted"] != "provider-secret-key"
    assert decrypt_secret(document["api_key_encrypted"]) == "provider-api-key"
    assert decrypt_secret(document["secret_key_encrypted"]) == "provider-secret-key"
    assert "api_key" not in document
    assert "secret_key" not in document


def test_huntress_credentials_read_from_encrypted_schema(monkeypatch):
    database = _Database()
    monkeypatch.setattr(huntress, "db", database)

    async def allow(*_args, **_kwargs):
        return None

    monkeypatch.setattr(huntress, "_require_global_huntress_access", allow)
    monkeypatch.setattr(huntress, "require_module_permission", allow)
    asyncio.run(huntress.save_huntress_settings(
        {"api_key": "provider-api-key", "secret_key": "provider-secret-key"},
        {"id": "admin-1", "name": "Administrator"},
    ))

    assert asyncio.run(huntress._get_creds()) == {
        "api_key": "provider-api-key",
        "secret_key": "provider-secret-key",
    }
