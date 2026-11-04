"""Contracts for the one-click Microsoft 365 mail connection.

The one-click grant replaces the manual Azure application setup for leads and
ticket email: an admin signs in with Microsoft, admin consent covers the mail
scopes, and Nexus stores the delegated tokens encrypted.  These tests lock the
authorization request shape, the encrypted-at-rest token handling, the refresh
rotation behaviour and the promise that no token material reaches the browser.
"""

import asyncio
import base64
import copy
import json
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

from app.routers import email_utils, microsoft_connect  # noqa: E402
from app.services import microsoft_graph_connection  # noqa: E402
from app.services.secret_store import decrypt_secret, encrypt_secret  # noqa: E402

RAW_ACCESS = "raw-access-token-value"
RAW_REFRESH = "raw-refresh-token-value"
RAW_ROTATED_REFRESH = "rotated-refresh-token-value"


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch):
    for name in ("MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET", "MICROSOFT_OAUTH_TENANT_ID", "MICROSOFT_CONNECT_REDIRECT_URI"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("FRONTEND_URL", "https://nexus.example")


class _Settings:
    def __init__(self, docs=None):
        self.docs = {key: copy.deepcopy(value) for key, value in (docs or {}).items()}
        self.updates = []

    async def find_one(self, query, _projection=None):
        return copy.deepcopy(self.docs.get(query.get("type")))

    async def update_one(self, query, update, **kwargs):
        self.updates.append((copy.deepcopy(query), copy.deepcopy(update), kwargs))
        key = query.get("type")
        doc = self.docs.setdefault(key, {"type": key})
        for field, value in (update.get("$set") or {}).items():
            doc[field] = value
        for field in (update.get("$unset") or {}):
            doc.pop(field, None)
        return SimpleNamespace(matched_count=1)


class _Rows:
    def __init__(self, row=None):
        self.rows = []
        self._row = row

    async def find_one(self, query, _projection=None):
        if self._row is None:
            return None
        wanted = query.get("id")
        if wanted is not None and wanted != self._row.get("id"):
            return None
        return copy.deepcopy(self._row)

    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))


def _db(settings=None, caller=None, activity=None):
    return SimpleNamespace(
        settings=settings or _Settings(),
        users=caller or _Rows({"id": "admin-1", "name": "Ada Admin", "role": "admin"}),
        activity_logs=activity or _Rows(),
    )


def _install(monkeypatch, fake_db):
    monkeypatch.setattr(microsoft_connect, "db", fake_db)
    monkeypatch.setattr(microsoft_graph_connection, "db", fake_db)
    monkeypatch.setattr(email_utils, "db", fake_db)


def _request(path="/api/settings/microsoft-connect/callback"):
    return SimpleNamespace(base_url="https://nexus.example/")


def _admin():
    return {"id": "admin-1", "name": "Ada Admin", "role": "admin"}


def _tech():
    return {"id": "tech-1", "name": "Terry Tech", "role": "tech"}


def _id_token(tid="tenant-from-id-token"):
    def segment(payload):
        return base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii").rstrip("=")

    return f"{segment({'alg': 'none'})}.{segment({'tid': tid})}.signature"


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class _FakeClient:
    def __init__(self, harness):
        self._harness = harness

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def post(self, url, data=None, **_kwargs):
        return self._harness.dispatch("POST", url, data)

    async def get(self, url, **_kwargs):
        return self._harness.dispatch("GET", url, None)


class _FakeHttpx:
    """Route table of (method, url substring) -> response for httpx calls."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def client(self, *_args, **_kwargs):
        return _FakeClient(self)

    def dispatch(self, method, url, data):
        self.calls.append((method, url, copy.deepcopy(data)))
        for route_method, fragment, response in self.routes:
            if route_method == method and fragment in url:
                return response
        raise AssertionError(f"Unexpected outbound request: {method} {url}")


def _install_httpx(monkeypatch, routes):
    harness = _FakeHttpx(routes)
    monkeypatch.setattr("httpx.AsyncClient", harness.client)
    return harness


def _sso_settings(**overrides):
    document = {"type": "microsoft_sso", "tenant_id": "contoso-tenant", "client_id": "app-client-id", "client_secret": "app-client-secret"}
    document.update(overrides)
    return document


def _connected_document(**overrides):
    document = {
        "type": microsoft_graph_connection.CONNECTION_SETTINGS_TYPE,
        "status": "connected",
        "tenant_id": "tenant-from-id-token",
        "client_id": "app-client-id",
        "connected_account": "ada@contoso.com",
        "connected_account_name": "Ada Admin",
        "microsoft_user_id": "ms-user-1",
        "scopes": ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Send", "Mail.Read"],
        "access_token_encrypted": encrypt_secret(RAW_ACCESS),
        "refresh_token_encrypted": encrypt_secret(RAW_REFRESH),
        "token_expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "connected_by": "admin-1",
        "connected_by_name": "Ada Admin",
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }
    document.update(overrides)
    return document


def _start_connect(monkeypatch):
    response = asyncio.run(microsoft_connect.start_microsoft_connect(_request(), _admin()))
    query = parse_qs(urlparse(response["authorization_url"]).query)
    return response, query["state"][0]


# ============== AUTHORIZATION REQUEST ==============


def test_connect_start_requires_admin(monkeypatch):
    _install(monkeypatch, _db(_Settings({"microsoft_sso": _sso_settings()})))

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(microsoft_connect.start_microsoft_connect(_request(), _tech()))

    assert excinfo.value.status_code == 403


def test_connect_start_requires_configured_application(monkeypatch):
    _install(monkeypatch, _db(_Settings()))

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(microsoft_connect.start_microsoft_connect(_request(), _admin()))

    assert excinfo.value.status_code == 409


def test_connect_start_builds_admin_consent_url_with_mail_scopes(monkeypatch):
    _install(monkeypatch, _db(_Settings({"microsoft_sso": _sso_settings()})))

    response, _state = _start_connect(monkeypatch)
    parsed = urlparse(response["authorization_url"])
    query = parse_qs(parsed.query)

    assert parsed.netloc == "login.microsoftonline.com"
    assert parsed.path.startswith("/contoso-tenant/oauth2/v2.0/authorize")
    assert query["prompt"] == ["admin_consent"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"] and query["state"]
    assert query["redirect_uri"] == ["https://nexus.example/api/settings/microsoft-connect/callback"]
    scopes = query["scope"][0].split()
    for scope in ("offline_access", "User.Read", "Mail.Send", "Mail.Read"):
        assert scope in scopes
    assert set(response["permissions"]) == {"User.Read", "Mail.Send", "Mail.Read"}


def test_deployment_application_takes_precedence(monkeypatch):
    monkeypatch.setenv("MICROSOFT_OAUTH_CLIENT_ID", "deployment-app-id")
    monkeypatch.setenv("MICROSOFT_OAUTH_TENANT_ID", "deployment-tenant")
    _install(monkeypatch, _db(_Settings({"microsoft_sso": _sso_settings()})))

    response, _state = _start_connect(monkeypatch)
    parsed = urlparse(response["authorization_url"])
    query = parse_qs(parsed.query)

    assert parsed.path.startswith("/deployment-tenant/oauth2/v2.0/authorize")
    assert query["client_id"] == ["deployment-app-id"]


# ============== CALLBACK ==============


def test_connect_callback_rejects_unknown_state(monkeypatch):
    settings = _Settings({"microsoft_sso": _sso_settings()})
    _install(monkeypatch, _db(settings))

    response = asyncio.run(microsoft_connect.complete_microsoft_connect(_request(), code="auth-code", state="bogus-state"))

    assert "microsoft_connect_error=invalid_or_expired_state" in response.headers["location"]
    assert settings.updates == []


def test_connect_callback_stores_encrypted_tokens_and_audits(monkeypatch):
    settings = _Settings({"microsoft_sso": _sso_settings()})
    activity = _Rows()
    fake_db = _db(settings, activity=activity)
    _install(monkeypatch, fake_db)
    harness = _install_httpx(monkeypatch, [
        ("POST", "/oauth2/v2.0/token", _FakeResponse(200, {
            "access_token": RAW_ACCESS,
            "refresh_token": RAW_REFRESH,
            "expires_in": 3600,
            "scope": "openid profile email offline_access User.Read Mail.Send Mail.Read",
            "id_token": _id_token("tenant-from-id-token"),
        })),
        ("GET", "graph.microsoft.com/v1.0/me", _FakeResponse(200, {
            "id": "ms-user-1", "displayName": "Ada Admin", "mail": "ada@contoso.com", "userPrincipalName": "ada@contoso.com",
        })),
    ])
    _response, state = _start_connect(monkeypatch)

    callback = asyncio.run(microsoft_connect.complete_microsoft_connect(_request(), code="auth-code", state=state))

    assert callback.headers["location"].endswith("/settings?tab=mailbox&microsoft_connected=1")
    stored = settings.docs[microsoft_graph_connection.CONNECTION_SETTINGS_TYPE]
    assert stored["status"] == "connected"
    assert stored["tenant_id"] == "tenant-from-id-token"
    assert stored["connected_account"] == "ada@contoso.com"
    assert "Mail.Send" in stored["scopes"]
    # Tokens are encrypted at rest and never stored in the clear.
    assert stored["access_token_encrypted"] != RAW_ACCESS
    assert stored["refresh_token_encrypted"] != RAW_REFRESH
    assert decrypt_secret(stored["access_token_encrypted"]) == RAW_ACCESS
    assert decrypt_secret(stored["refresh_token_encrypted"]) == RAW_REFRESH
    assert RAW_REFRESH not in repr(stored)
    assert activity.rows and activity.rows[0]["action"] == "microsoft_mail_connected"

    token_call = next(call for call in harness.calls if call[0] == "POST")
    assert token_call[2]["code_verifier"]
    assert token_call[2]["grant_type"] == "authorization_code"


def test_connect_callback_reports_provider_errors_without_persisting(monkeypatch):
    settings = _Settings({"microsoft_sso": _sso_settings()})
    _install(monkeypatch, _db(settings))
    _install_httpx(monkeypatch, [
        ("POST", "/oauth2/v2.0/token", _FakeResponse(400, {"error": "invalid_grant"})),
    ])
    _response, state = _start_connect(monkeypatch)

    callback = asyncio.run(microsoft_connect.complete_microsoft_connect(_request(), code="auth-code", state=state))

    assert "microsoft_connect_error=token_exchange_failed" in callback.headers["location"]
    assert microsoft_graph_connection.CONNECTION_SETTINGS_TYPE not in settings.docs


# ============== SAFE STATUS & DISCONNECT ==============


def test_connection_status_never_exposes_token_material(monkeypatch):
    document = _connected_document(
        access_token_encrypted=encrypt_secret("must-never-reach-browser-access"),
        refresh_token_encrypted=encrypt_secret("must-never-reach-browser-refresh"),
    )
    settings = _Settings({
        microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: document,
        "microsoft_sso": _sso_settings(),
    })
    _install(monkeypatch, _db(settings))

    response = asyncio.run(microsoft_connect.get_microsoft_connect_connection(_admin()))

    assert response["connected"] is True
    assert response["connected_account"] == "ada@contoso.com"
    assert response["app_configured"] is True
    response_text = repr(response)
    for secret in ("must-never-reach-browser-access", "must-never-reach-browser-refresh", RAW_ACCESS, RAW_REFRESH):
        assert secret not in response_text
    assert "access_token_encrypted" not in response
    assert "refresh_token_encrypted" not in response


def test_disconnect_removes_token_material_and_audits(monkeypatch):
    settings = _Settings({microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: _connected_document()})
    activity = _Rows()
    _install(monkeypatch, _db(settings, activity=activity))

    response = asyncio.run(microsoft_connect.delete_microsoft_connect_connection(_admin()))

    assert response["connected"] is False
    stored = settings.docs[microsoft_graph_connection.CONNECTION_SETTINGS_TYPE]
    assert stored["status"] == "disconnected"
    assert "access_token_encrypted" not in stored
    assert "refresh_token_encrypted" not in stored
    assert activity.rows and activity.rows[0]["action"] == "microsoft_mail_disconnected"


# ============== TOKEN ACQUISITION ==============


def test_delegated_token_is_reused_without_network_calls(monkeypatch):
    _install(monkeypatch, _db(_Settings({microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: _connected_document()})))
    harness = _install_httpx(monkeypatch, [])

    token, mode = asyncio.run(microsoft_graph_connection.acquire_graph_access_token())

    assert (token, mode) == (RAW_ACCESS, "delegated")
    assert harness.calls == []


def test_expired_delegated_token_refresh_persists_rotated_refresh_token(monkeypatch):
    settings = _Settings({microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: _connected_document(
        token_expires_at=(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
    )})
    _install(monkeypatch, _db(settings))
    harness = _install_httpx(monkeypatch, [
        ("POST", "/oauth2/v2.0/token", _FakeResponse(200, {
            "access_token": "new-access-token",
            "refresh_token": RAW_ROTATED_REFRESH,
            "expires_in": 3600,
        })),
    ])

    token = asyncio.run(microsoft_graph_connection.get_delegated_access_token())

    assert token == "new-access-token"
    stored = settings.docs[microsoft_graph_connection.CONNECTION_SETTINGS_TYPE]
    assert decrypt_secret(stored["refresh_token_encrypted"]) == RAW_ROTATED_REFRESH
    assert decrypt_secret(stored["access_token_encrypted"]) == "new-access-token"
    refresh_call = harness.calls[0]
    assert refresh_call[2]["grant_type"] == "refresh_token"
    assert refresh_call[2]["refresh_token"] == RAW_REFRESH


def test_failed_refresh_requires_reconnect_and_returns_no_token(monkeypatch):
    settings = _Settings({microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: _connected_document(
        token_expires_at=(datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),
    )})
    _install(monkeypatch, _db(settings))
    _install_httpx(monkeypatch, [
        ("POST", "/oauth2/v2.0/token", _FakeResponse(400, {"error": "invalid_grant"})),
    ])

    token = asyncio.run(microsoft_graph_connection.get_delegated_access_token())

    assert token is None
    stored = settings.docs[microsoft_graph_connection.CONNECTION_SETTINGS_TYPE]
    assert stored["status"] == "reauth_required"
    assert stored["last_error_code"] == "token_refresh_failed"


def test_acquire_prefers_delegated_grant_over_app_only_secret(monkeypatch):
    docs = {
        microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: _connected_document(),
        "o365_mailbox": {"type": "o365_mailbox", "tenant_id": "t", "client_id": "c", "client_secret_encrypted": encrypt_secret("legacy-secret")},
    }
    _install(monkeypatch, _db(_Settings(docs)))
    harness = _install_httpx(monkeypatch, [])

    token, mode = asyncio.run(microsoft_graph_connection.acquire_graph_access_token())

    assert (token, mode) == (RAW_ACCESS, "delegated")
    assert harness.calls == []


def test_acquire_falls_back_to_app_only_client_credentials(monkeypatch):
    docs = {
        "o365_mailbox": {"type": "o365_mailbox", "tenant_id": "legacy-tenant", "client_id": "legacy-client", "client_secret_encrypted": encrypt_secret("legacy-secret")},
    }
    _install(monkeypatch, _db(_Settings(docs)))
    harness = _install_httpx(monkeypatch, [
        ("POST", "/oauth2/v2.0/token", _FakeResponse(200, {"access_token": "app-only-token"})),
    ])

    token, mode = asyncio.run(microsoft_graph_connection.acquire_graph_access_token())

    assert (token, mode) == ("app-only-token", "app_only")
    assert harness.calls[0][2]["grant_type"] == "client_credentials"
    assert harness.calls[0][2]["client_secret"] == "legacy-secret"


def test_acquire_returns_none_without_any_credential(monkeypatch):
    _install(monkeypatch, _db(_Settings()))
    _install_httpx(monkeypatch, [])

    token, mode = asyncio.run(microsoft_graph_connection.acquire_graph_access_token())

    assert (token, mode) == (None, "")


# ============== SHARED DELIVERY CONFIG ==============


def test_email_delivery_config_uses_delegated_connection_without_manual_setup(monkeypatch):
    _install(monkeypatch, _db(_Settings({microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: _connected_document()})))

    config = asyncio.run(email_utils._load_microsoft365_config())

    assert config is not None
    assert config["connection_mode"] == "delegated"
    assert config["sender_email"] == "ada@contoso.com"
    assert config["connected_account"] == "ada@contoso.com"


def test_email_delivery_config_keeps_legacy_app_only_path(monkeypatch):
    legacy = {
        "type": "o365_mailbox",
        "enabled": True,
        "connected": True,
        "tenant_id": "legacy-tenant",
        "client_id": "legacy-client",
        "client_secret_encrypted": encrypt_secret("legacy-secret"),
        "outbound_mailbox_email": "support@contoso.com",
    }
    _install(monkeypatch, _db(_Settings({"o365_mailbox": legacy})))

    config = asyncio.run(email_utils._load_microsoft365_config())

    assert config is not None
    assert config["connection_mode"] == "app_only"
    assert config["sender_email"] == "support@contoso.com"

    broken = copy.deepcopy(legacy)
    broken.pop("client_secret_encrypted")
    _install(monkeypatch, _db(_Settings({"o365_mailbox": broken})))
    assert asyncio.run(email_utils._load_microsoft365_config()) is None


def test_email_delivery_config_is_absent_without_any_connection(monkeypatch):
    _install(monkeypatch, _db(_Settings()))

    assert asyncio.run(email_utils._load_microsoft365_config()) is None


# ============== OUTBOUND SEND PATH ==============


def _send_db(settings):
    return SimpleNamespace(
        settings=settings,
        users=_Rows({"id": "admin-1", "name": "Ada Admin", "role": "admin"}),
        activity_logs=_Rows(),
        email_delivery_log=_Rows(),
        client_communication_events=_Rows(),
        clients=_Rows(None),
        contacts=_Rows(None),
        client_contacts=_Rows(None),
    )


@pytest.mark.parametrize(
    ("connected_account", "sender_override", "expected_path"),
    [
        ("ada@contoso.com", "", "https://graph.microsoft.com/v1.0/me/sendMail"),
        ("ada@contoso.com", "support@contoso.com", "https://graph.microsoft.com/v1.0/users/support@contoso.com/sendMail"),
    ],
)
def test_send_email_uses_delegated_grant_and_sends_as_expected_account(
    monkeypatch, connected_account, sender_override, expected_path
):
    docs = {microsoft_graph_connection.CONNECTION_SETTINGS_TYPE: _connected_document(connected_account=connected_account)}
    if sender_override:
        docs["o365_mailbox"] = {"type": "o365_mailbox", "outbound_mailbox_email": sender_override}
    fake_db = _send_db(_Settings(docs))
    _install(monkeypatch, fake_db)
    harness = _install_httpx(monkeypatch, [
        ("POST", "/sendMail", _FakeResponse(202, {})),
    ])

    result = asyncio.run(email_utils.send_email("lead@contoso.com", "Following up", "<p>Hello</p>", category="lead_responses"))

    assert result["status"] == "sent"
    method, url, _payload = harness.calls[0]
    assert (method, url) == ("POST", expected_path)
    delivered = fake_db.email_delivery_log.rows[0]
    assert delivered["status"] == "sent"
    assert RAW_ACCESS not in repr(delivered)
