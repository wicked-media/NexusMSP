"""Platform-application fallbacks for Microsoft sign-in and dispatch calendar.

When a deployment provides the one-click Microsoft application, user SSO and
the dispatch calendar reuse it instead of demanding a per-installation Azure
app registration.  These tests also lock the calendar credential vault: tokens
are encrypted at rest and legacy plaintext copies are migrated away, and the
frontend redirect fallback chain no longer points at a stale dev host.
"""

import asyncio
import copy
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import microsoft_sso, smart_scheduling  # noqa: E402
from app.services import microsoft_graph_connection  # noqa: E402
from app.services.secret_store import decrypt_secret, encrypt_secret  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch):
    for name in ("MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET", "MICROSOFT_OAUTH_TENANT_ID", "MICROSOFT_CONNECT_REDIRECT_URI", "FRONTEND_URL", "REACT_APP_BACKEND_URL"):
        monkeypatch.delenv(name, raising=False)


class _Settings:
    """Settings fake addressing docs by ``type`` or ``key`` like Mongo."""

    def __init__(self, docs=None):
        self.docs = {}
        for document in (docs or []):
            self.docs[self._key(document)] = copy.deepcopy(document)
        self.updates = []

    @staticmethod
    def _key(document):
        return document.get("type") or document.get("key")

    async def find_one(self, query, _projection=None):
        wanted = query.get("type") or query.get("key")
        return copy.deepcopy(self.docs.get(wanted))

    async def update_one(self, query, update, **kwargs):
        self.updates.append((copy.deepcopy(query), copy.deepcopy(update)))
        wanted = query.get("type") or query.get("key")
        document = self.docs.setdefault(wanted, {"key": wanted})
        for field, value in (update.get("$set") or {}).items():
            if field == "value":
                document["value"] = value
            else:
                document[field] = value
        return SimpleNamespace(matched_count=1)


def _db(settings):
    return SimpleNamespace(settings=settings)


def _install(monkeypatch, settings):
    fake_db = _db(settings)
    monkeypatch.setattr(microsoft_sso, "db", fake_db)
    monkeypatch.setattr(smart_scheduling, "db", fake_db)
    monkeypatch.setattr(microsoft_graph_connection, "db", fake_db)


def _mail_connection_document(tenant="tenant-from-mail"):
    return {
        "type": microsoft_graph_connection.CONNECTION_SETTINGS_TYPE,
        "status": "connected",
        "tenant_id": tenant,
        "client_id": "platform-app-id",
        "connected_account": "ada@contoso.com",
    }


def _request():
    return SimpleNamespace(base_url="https://nexus.example/")


# ============== SSO PLATFORM-APP FALLBACK ==============


def test_sso_status_is_disabled_without_any_application(monkeypatch):
    _install(monkeypatch, _Settings())

    assert asyncio.run(microsoft_sso.get_sso_status()) == {"enabled": False}


def test_sso_status_enables_from_platform_app_and_connected_tenant(monkeypatch):
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "platform-app-id")
    _install(monkeypatch, _Settings([_mail_connection_document()]))

    assert asyncio.run(microsoft_sso.get_sso_status()) == {"enabled": True}


def test_sso_status_stays_disabled_without_a_tenant_constraint(monkeypatch):
    # Sign-in must never open to arbitrary directories: the platform
    # application alone is not enough without a configured or connected tenant.
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "platform-app-id")
    _install(monkeypatch, _Settings())

    assert asyncio.run(microsoft_sso.get_sso_status()) == {"enabled": False}


def test_sso_explicit_disable_is_not_overridden_by_platform_app(monkeypatch):
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "platform-app-id")
    settings = _Settings([
        _mail_connection_document(),
        {"type": "microsoft_sso", "enabled": False, "tenant_id": "", "client_id": ""},
    ])
    _install(monkeypatch, settings)

    assert asyncio.run(microsoft_sso.get_sso_status()) == {"enabled": False}
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(microsoft_sso.microsoft_login(_request()))
    assert excinfo.value.status_code == 400


def test_sso_status_from_manual_stored_settings_is_unchanged(monkeypatch):
    settings = _Settings([{
        "type": "microsoft_sso", "enabled": True,
        "tenant_id": "contoso-tenant", "client_id": "manual-app-id", "client_secret": "manual-secret",
    }])
    _install(monkeypatch, settings)

    assert asyncio.run(microsoft_sso.get_sso_status()) == {"enabled": True}


def test_sso_login_uses_platform_app_and_connected_tenant(monkeypatch):
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "platform-app-id")
    _install(monkeypatch, _Settings([_mail_connection_document()]))

    response = asyncio.run(microsoft_sso.microsoft_login(_request()))
    parsed = urlparse(response.headers["location"])
    query = parse_qs(parsed.query)

    assert parsed.path.startswith("/tenant-from-mail/oauth2/v2.0/authorize")
    assert query["client_id"] == ["platform-app-id"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"]


def test_organisation_tenant_prefers_explicit_tenant_over_connected_tenant(monkeypatch):
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "platform-app-id")
    monkeypatch.setenv("MICROSOFT_OAUTH_TENANT_ID", "explicit-tenant")
    _install(monkeypatch, _Settings([_mail_connection_document()]))

    assert asyncio.run(microsoft_graph_connection.organisation_tenant_id()) == "explicit-tenant"


# ============== DISPATCH CALENDAR ==============


def test_calendar_config_falls_back_to_platform_app(monkeypatch):
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "platform-app-id")
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_SECRET", "platform-secret")
    _install(monkeypatch, _Settings([_mail_connection_document()]))

    config = asyncio.run(smart_scheduling._microsoft_calendar_config())

    assert config["client_id"] == "platform-app-id"
    assert config["client_secret"] == "platform-secret"
    assert config["tenant_id"] == "tenant-from-mail"


def test_calendar_config_requires_an_application_and_tenant(monkeypatch):
    _install(monkeypatch, _Settings())

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(smart_scheduling._microsoft_calendar_config())

    assert excinfo.value.status_code == 400


def test_frontend_url_prefers_environment_then_request_host(monkeypatch):
    assert smart_scheduling._frontend_url(_request()) == "https://nexus.example"

    monkeypatch.setenv("REACT_APP_BACKEND_URL", "https://app.example")
    assert smart_scheduling._frontend_url(_request()) == "https://app.example"

    monkeypatch.setenv("FRONTEND_URL", "https://front.example/")
    assert smart_scheduling._frontend_url(_request()) == "https://front.example"


def test_calendar_access_token_reads_and_vaults_legacy_plaintext_tokens(monkeypatch):
    now = datetime.now(timezone.utc)
    settings = _Settings([
        {"key": "dispatch_calendar_connection", "value": {"connected": True, "provider": "microsoft365"}},
        {"key": "dispatch_calendar_credentials", "value": {
            "access_token": "legacy-plain-access",
            "refresh_token": "legacy-plain-refresh",
            "expires_at": (now + timedelta(hours=1)).isoformat(),
            "scope": "Calendars.ReadWrite",
        }},
    ])
    _install(monkeypatch, settings)

    token, connection = asyncio.run(smart_scheduling._microsoft_calendar_access_token())

    assert token == "legacy-plain-access"
    assert connection["connected"] is True
    stored = settings.docs["dispatch_calendar_credentials"]["value"]
    assert "access_token" not in stored
    assert "refresh_token" not in stored
    assert stored["access_token_encrypted"] != "legacy-plain-access"
    assert decrypt_secret(stored["access_token_encrypted"]) == "legacy-plain-access"
    assert decrypt_secret(stored["refresh_token_encrypted"]) == "legacy-plain-refresh"


def test_calendar_refresh_stores_only_encrypted_tokens(monkeypatch):
    now = datetime.now(timezone.utc)
    settings = _Settings([
        {"key": "dispatch_calendar_connection", "value": {"connected": True, "provider": "microsoft365"}},
        {"key": "dispatch_calendar_credentials", "value": {
            "access_token_encrypted": encrypt_secret("expired-access"),
            "refresh_token_encrypted": encrypt_secret("stored-refresh"),
            "expires_at": (now - timedelta(minutes=5)).isoformat(),
            "scope": "Calendars.ReadWrite",
        }},
    ])
    _install(monkeypatch, settings)
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "platform-app-id")
    monkeypatch.setenv("MICROSOFT_OAUTH_TENANT_ID", "explicit-tenant")

    captured = {}

    class _FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600, "scope": "Calendars.ReadWrite"}

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def post(self, url, data=None, **_kwargs):
            captured["url"] = url
            captured["data"] = data
            return _FakeResponse()

    monkeypatch.setattr("httpx.AsyncClient", lambda *args, **kwargs: _FakeClient())

    token, _connection = asyncio.run(smart_scheduling._microsoft_calendar_access_token())

    assert token == "new-access"
    assert captured["data"]["grant_type"] == "refresh_token"
    assert captured["data"]["refresh_token"] == "stored-refresh"
    assert "/explicit-tenant/oauth2/v2.0/token" in captured["url"]
    stored = settings.docs["dispatch_calendar_credentials"]["value"]
    assert "access_token" not in stored and "refresh_token" not in stored
    assert decrypt_secret(stored["access_token_encrypted"]) == "new-access"
    assert decrypt_secret(stored["refresh_token_encrypted"]) == "new-refresh"
