"""Focused security regressions for legacy Microsoft integration configuration."""

import asyncio
import copy
import inspect
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import microsoft_config  # noqa: E402
from app.services import action_permissions, scope_permissions  # noqa: E402


class _Settings:
    def __init__(self, documents=None):
        self.documents = documents or {}
        self.find_calls = []
        self.updates = []

    async def find_one(self, query, _projection=None):
        self.find_calls.append(query)
        document = self.documents.get(query.get("type"))
        return copy.deepcopy(document) if document else None

    async def update_one(self, query, update, **kwargs):
        self.updates.append((query, update, kwargs))


class _Denials:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(row)


class _ExplodingDatabase:
    def __getattr__(self, _name):
        raise AssertionError("Disabled legacy Microsoft 365 evidence routes must not access persistence")


def _db(settings=None):
    return SimpleNamespace(settings=settings or _Settings())


def _request(path="/api/settings/cipp"):
    return SimpleNamespace(
        method="GET",
        url=SimpleNamespace(path=path),
        state=SimpleNamespace(correlation_id="corr-microsoft-config-security"),
    )


def _admin():
    return {"id": "admin-1", "name": "Admin", "role": "admin"}


def _platform_admin(tenant_id="platform-a"):
    return {"id": "admin-1", "name": "Admin", "role": "admin", "tenant_id": tenant_id}


def _restricted_user():
    return {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _route_permission(path, method):
    route = next(
        candidate
        for candidate in microsoft_config.router.routes
        if candidate.path == path and method in candidate.methods
    )
    dependency = route.dependencies[0].dependency
    return inspect.getclosurevars(dependency).nonlocals["permission_id"]


def _legacy_settings_document(settings_type):
    return {
        "type": settings_type,
        "enabled": True,
        "tenant_id": "partner-tenant-id",
        "client_id": "application-client-id",
        "api_url": "https://provider.example/api",
        "tenant_filter": "contoso.example",
        "redirect_uri": "https://nexus.example/callback",
        "last_test_status": "verified",
        "api_key": "must-never-reach-browser-api-key",
        "apiKey": "must-never-reach-browser-api-key-camel",
        "api_key_full": "must-never-reach-browser-api-key-full",
        "api_key_preview": "must-never-reach-browser-api-key-preview",
        "api_key_encrypted": "must-never-reach-browser-api-key-ciphertext",
        "api_secret": "must-never-reach-browser-api-secret",
        "app_secret": "must-never-reach-browser-app-secret",
        "client_secret": "must-never-reach-browser-client-secret",
        "clientSecret": "must-never-reach-browser-client-secret-camel",
        "client_secret_encrypted": "must-never-reach-browser-client-secret-ciphertext",
        "refresh_token": "must-never-reach-browser-refresh-token",
        "webhook_url": "https://hooks.example/secret-webhook",
        "webhookUrl": "https://hooks.example/secret-webhook-camel",
        "headers": {"Authorization": "Bearer must-never-reach-browser"},
        "connection": {
            "token": "must-never-reach-browser-nested-token",
            "auth": "must-never-reach-browser-nested-auth",
            "healthy": True,
        },
    }


@pytest.mark.parametrize(
    ("settings_type", "handler", "configured_flags"),
    [
        ("cipp", microsoft_config.get_cipp_settings, {"api_key_configured": True}),
        (
            "microsoft365",
            microsoft_config.get_m365_settings,
            {"client_secret_configured": True},
        ),
        (
            "microsoft_teams",
            microsoft_config.get_teams_settings,
            {"client_secret_configured": True, "webhook_configured": True},
        ),
    ],
)
def test_legacy_integration_reads_return_safe_state_not_credentials(
    monkeypatch, settings_type, handler, configured_flags
):
    document = _legacy_settings_document(settings_type)
    monkeypatch.setattr(microsoft_config, "db", _db(_Settings({settings_type: document})))

    response = asyncio.run(handler(_request(), _admin()))

    assert response["type"] == settings_type
    assert response["enabled"] is True
    assert response["tenant_id"] == "partner-tenant-id"
    assert response["last_test_status"] == "verified"
    assert response["connection"] == {"healthy": True}
    assert response["api_url"] == "https://provider.example/api"
    assert response["redirect_uri"] == "https://nexus.example/callback"
    assert {key: response[key] for key in configured_flags} == configured_flags

    response_text = repr(response)
    for secret in (
        "must-never-reach-browser-api-key",
        "must-never-reach-browser-api-key-camel",
        "must-never-reach-browser-api-key-full",
        "must-never-reach-browser-api-key-preview",
        "must-never-reach-browser-api-key-ciphertext",
        "must-never-reach-browser-api-secret",
        "must-never-reach-browser-app-secret",
        "must-never-reach-browser-client-secret",
        "must-never-reach-browser-client-secret-camel",
        "must-never-reach-browser-client-secret-ciphertext",
        "must-never-reach-browser-refresh-token",
        "secret-webhook",
        "must-never-reach-browser-nested-token",
        "must-never-reach-browser-nested-auth",
        "must-never-reach-browser",
    ):
        assert secret not in response_text


@pytest.mark.parametrize(
    ("handler", "expected"),
    [
        (
            microsoft_config.get_cipp_settings,
            {
                "type": "cipp",
                "enabled": False,
                "api_url": "",
                "tenant_filter": "",
                "api_key_configured": False,
            },
        ),
        (
            microsoft_config.get_m365_settings,
            {
                "type": "microsoft365",
                "enabled": False,
                "tenant_id": "",
                "client_id": "",
                "redirect_uri": "",
                "client_secret_configured": False,
            },
        ),
        (
            microsoft_config.get_teams_settings,
            {
                "type": "microsoft_teams",
                "enabled": False,
                "tenant_id": "",
                "client_id": "",
                "client_secret_configured": False,
                "webhook_configured": False,
            },
        ),
    ],
)
def test_missing_legacy_integration_settings_expose_only_safe_empty_state(monkeypatch, handler, expected):
    monkeypatch.setattr(microsoft_config, "db", _db())

    response = asyncio.run(handler(_request(), _admin()))

    assert response == expected


def test_legacy_integration_routes_declare_high_privilege_action_permissions():
    assert _route_permission("/settings/cipp", "GET") == "m365.tenant.manage"
    assert _route_permission("/settings/cipp", "PUT") == "m365.tenant.manage"
    assert _route_permission("/settings/microsoft365", "GET") == "m365.tenant.manage"
    assert _route_permission("/settings/microsoft365", "PUT") == "m365.tenant.manage"
    assert _route_permission("/settings/microsoft-teams", "GET") == "platform.configuration.manage"
    assert _route_permission("/settings/microsoft-teams", "PUT") == "platform.configuration.manage"
    assert _route_permission("/clients/{client_id}/m365-sync", "POST") == "m365.tenant.manage"
    assert _route_permission("/clients/{client_id}/m365-users", "GET") == "m365.tenant.manage"


def test_action_permission_dependency_blocks_unauthorised_cipp_settings_read(monkeypatch):
    async def denied(_user, permission_id):
        return {"allowed": False, "permission": permission_id, "source": "test"}

    denials = _Denials()
    monkeypatch.setattr(action_permissions, "evaluate_action_permission", denied)
    monkeypatch.setattr(action_permissions, "db", SimpleNamespace(permission_denials=denials))
    monkeypatch.setattr(microsoft_config, "db", _db())

    app = FastAPI()
    app.include_router(microsoft_config.router)
    app.dependency_overrides[microsoft_config.get_current_user] = _admin

    with TestClient(app) as client:
        response = client.get("/settings/cipp")

    assert response.status_code == 403
    assert response.headers["X-Required-Permission"] == "m365.tenant.manage"
    assert denials.rows[0]["permission"] == "m365.tenant.manage"


def test_restricted_scope_cannot_read_or_write_global_integration_settings(monkeypatch):
    async def allowed(_user, permission_id):
        return {"allowed": True, "permission": permission_id, "source": "test"}

    settings = _Settings({"cipp": _legacy_settings_document("cipp")})
    scope_denials = _Denials()
    monkeypatch.setattr(microsoft_config, "db", _db(settings))
    monkeypatch.setattr(action_permissions, "evaluate_action_permission", allowed)
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=scope_denials))

    app = FastAPI()
    app.include_router(microsoft_config.router)
    app.dependency_overrides[microsoft_config.get_current_user] = _restricted_user

    with TestClient(app) as client:
        read_response = client.get("/settings/cipp")
        write_response = client.put("/settings/cipp", json={"enabled": True})

    assert read_response.status_code == 403
    assert write_response.status_code == 403
    assert settings.find_calls == []
    assert settings.updates == []
    assert [row["operation"] for row in scope_denials.rows] == [
        "m365.legacy_settings.cipp.read",
        "m365.legacy_settings.cipp.write",
    ]


def test_legacy_cipp_write_keeps_secret_out_of_audit_evidence(monkeypatch):
    settings = _Settings()
    audit_events = []

    async def capture_audit(*args, **kwargs):
        audit_events.append((args, kwargs))

    monkeypatch.setattr(microsoft_config, "db", _db(settings))
    monkeypatch.setattr(microsoft_config, "log_activity", capture_audit)

    response = asyncio.run(
        microsoft_config.update_cipp_settings(
            {"enabled": True, "api_key": "must-not-be-audited"},
            _request("/api/settings/cipp"),
            _admin(),
        )
    )

    assert response == {"message": "CIPP settings updated"}
    assert settings.updates[0][1]["$set"]["api_key"] == "must-not-be-audited"
    assert "must-not-be-audited" not in repr(audit_events)
    assert audit_events[0][0][1:5] == (
        "integration_settings_updated",
        "integration",
        "cipp",
        "CIPP",
    )


def test_explicit_platform_legacy_settings_reads_and_writes_are_partitioned(monkeypatch):
    settings = _Settings({"cipp": _legacy_settings_document("cipp")})
    monkeypatch.setattr(microsoft_config, "db", _db(settings))

    async def ignore_audit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(microsoft_config, "log_activity", ignore_audit)

    asyncio.run(microsoft_config.get_cipp_settings(_request(), _platform_admin()))
    asyncio.run(
        microsoft_config.update_cipp_settings(
            {"enabled": True, "api_key": "test-key"},
            _request("/api/settings/cipp"),
            _platform_admin(),
        )
    )

    expected_query = {"type": "cipp", "platform_tenant_id": "platform-a"}
    assert settings.find_calls == [expected_query]
    assert settings.updates[0][0] == expected_query
    assert settings.updates[0][1]["$set"]["platform_tenant_id"] == "platform-a"


def test_legacy_cipp_mock_sync_is_retired_before_any_database_access(monkeypatch):
    monkeypatch.setattr(microsoft_config, "db", _ExplodingDatabase())

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            microsoft_config.sync_cipp_tenants(
                _request("/api/cipp/sync-tenants"),
                _admin(),
            )
        )

    assert error.value.status_code == 409
    assert "provider-verified" in error.value.detail


def test_legacy_manual_m365_evidence_routes_are_disabled_before_any_database_access(monkeypatch):
    monkeypatch.setattr(microsoft_config, "db", _ExplodingDatabase())

    with pytest.raises(HTTPException) as sync_error:
        asyncio.run(
            microsoft_config.sync_client_m365(
                "client-a",
                {"users": [{"upn": "unverified@example.com"}]},
                _request("/api/clients/client-a/m365-sync"),
                _admin(),
            )
        )
    with pytest.raises(HTTPException) as read_error:
        asyncio.run(
            microsoft_config.get_client_m365_users(
                "client-a",
                _request("/api/clients/client-a/m365-users"),
                _admin(),
            )
        )

    assert sync_error.value.status_code == 409
    assert read_error.value.status_code == 409
    assert sync_error.value.detail == microsoft_config._LEGACY_M365_SYNC_DISABLED
    assert read_error.value.detail == microsoft_config._LEGACY_M365_SYNC_DISABLED
