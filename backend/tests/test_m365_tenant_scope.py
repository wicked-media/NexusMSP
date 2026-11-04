"""Focused Microsoft 365 evidence-scope regression tests."""

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
from app.services import scope_permissions  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    async def to_list(self, *_args, **_kwargs):
        return list(self.rows)


class _Collection:
    def __init__(self, name, rows, captured):
        self.name = name
        self.rows = rows
        self.captured = captured

    def find(self, query, _projection=None):
        self.captured.setdefault(self.name, []).append(query)
        return _Cursor(self.rows)


class _Denials:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(row)


def _restricted_user():
    return {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _m365_db(captured, *, client_rows=None, connection_rows=None, tenant_rows=None, user_rows=None):
    return SimpleNamespace(
        clients=_Collection("clients", client_rows or [], captured),
        m365_tenant_connections=_Collection("connections", connection_rows or [], captured),
        m365_tenants=_Collection("tenants", tenant_rows or [], captured),
        m365_users=_Collection("users", user_rows or [], captured),
    )


def _contains(value, expected):
    if value == expected:
        return True
    if isinstance(value, dict):
        return any(_contains(item, expected) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains(item, expected) for item in value)
    return False


def test_restricted_technician_resolves_tenants_only_from_authorised_nexus_links(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        m365,
        "db",
        _m365_db(
            captured,
            client_rows=[{"id": "client-a", "cipp_tenant_id": "tenant-client-link"}],
            connection_rows=[{"client_id": "client-a", "tenant_id": "tenant-registry-link"}],
            tenant_rows=[
                {
                    "client_id": "client-a",
                    "tenant_id": "tenant-provider-link",
                    "id": "legacy-provider-record-id",
                }
            ],
        ),
    )

    tenant_ids = asyncio.run(m365._visible_tenant_ids(_restricted_user()))

    assert tenant_ids == {
        "tenant-client-link",
        "tenant-registry-link",
        "tenant-provider-link",
        "legacy-provider-record-id",
    }
    # The shared visibility resolver combines the client scope with the Nexus
    # platform partition and repeats evidence lookups to exclude conflicting
    # owners.  Assert the security boundaries rather than its internal query
    # shape.
    assert _contains(captured["clients"][0], {"id": {"$in": ["client-a"]}})
    assert _contains(captured["clients"][0], {"tenant_id": {"$exists": False}})
    assert captured["connections"][0] == {"client_id": {"$in": ["client-a"]}}
    assert _contains(captured["tenants"][0], {"client_id": {"$in": ["client-a"]}})
    assert _contains(captured["tenants"][0], {"source": {"$in": ["m365_graph", "m365_partner_center"]}})


def test_restricted_m365_user_list_is_constrained_by_resolved_tenant_ids(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        m365,
        "db",
        _m365_db(
            captured,
            client_rows=[{"id": "client-a", "cipp_tenant_id": "tenant-a"}],
        ),
    )

    assert asyncio.run(m365.list_users(current_user=_restricted_user())) == []
    assert captured["users"] == [
        {
            "$and": [
                {"source": {"$in": ["m365_graph", "m365_partner_center"]}},
                {"tenant_id": {"$in": ["tenant-a"]}},
            ]
        }
    ]


def test_foreign_microsoft_tenant_selector_is_masked_and_audited(monkeypatch):
    captured = {}
    denials = _Denials()
    monkeypatch.setattr(
        m365,
        "db",
        _m365_db(
            captured,
            client_rows=[{"id": "client-a", "cipp_tenant_id": "tenant-a"}],
        ),
    )
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            m365._scope_tenant_or_404(
                _restricted_user(),
                "tenant-b",
                operation="m365.user.read",
            )
        )

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "m365.user.read"
    assert denials.rows[0]["client_id"] is None


def test_global_administrator_retains_existing_unfiltered_provider_query():
    visible = asyncio.run(m365._visible_tenant_ids({"id": "admin-1", "role": "admin"}))

    assert visible is None
    assert m365._evidence_query_for_tenants(visible, {"tenant_id": "tenant-a"}) == {
        "source": {"$in": ["m365_graph", "m365_partner_center"]},
        "tenant_id": "tenant-a",
    }


def test_explicit_platform_connector_query_never_falls_back_to_legacy_settings():
    query = m365._m365_connection_settings_query(
        {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}
    )

    assert _contains(query, {"key": "m365_connection"})
    assert _contains(query, {"platform_tenant_id": "platform-a"})
    assert not _contains(query, {"platform_tenant_id": {"$exists": False}})


def test_partner_center_discovery_does_not_unlock_graph_access():
    graph_verified, access_state = m365._tenant_access_state(
        {
            "tenant_id": "tenant-a",
            "source": "m365_partner_center",
            "graph_verified": False,
            "consent_method": "gdap",
        },
        set(),
    )

    assert graph_verified is False
    assert access_state == "gdap_required"


def test_scoped_onboarding_hides_global_partner_connection_configuration(monkeypatch):
    connection = {
        "app_id": "global-app-id",
        "tenant_id": "global-tenant-id",
        "partner_tenant_id": "global-tenant-id",
        "partner_center_account": "operations@example.test",
        "admin_consent_redirect_uri": "https://nexus.example.test/callback",
        "connection_strategy": "partner_center",
        "last_test_status": "success",
        "last_discovery_at": "2026-09-04T00:00:00+00:00",
        "secret_configured": True,
        "refresh_token_configured": True,
        "mode": "configured_unverified",
        "telemetry_available": False,
    }

    async def connection_payload(*_args, **_kwargs):
        return dict(connection)

    monkeypatch.setattr(m365, "_connection_payload", connection_payload)
    monkeypatch.setattr(m365, "db", _m365_db({}))

    restricted = asyncio.run(m365.get_onboarding(current_user=_restricted_user()))
    administrator = asyncio.run(
        m365.get_onboarding(current_user={"id": "admin-1", "role": "admin"})
    )

    assert restricted["connection"] == {
        "secret_configured": True,
        "refresh_token_configured": True,
        "mode": "configured_unverified",
        "telemetry_available": False,
    }
    assert administrator["connection"] == connection


@pytest.mark.parametrize(
    ("endpoint", "kwargs", "operation"),
    [
        (m365.get_connection, {}, "m365.connection.read"),
        (m365.update_connection, {"data": {}, "_": {}}, "m365.connection.write"),
        (m365.test_connection, {"_": {}}, "m365.connection.test"),
        (m365.discover_partner_customers, {"_": {}}, "m365.onboarding.discover"),
    ],
)
def test_partner_center_connection_routes_require_global_scope(monkeypatch, endpoint, kwargs, operation):
    denials = _Denials()
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(endpoint(current_user=_restricted_user(), **kwargs))

    assert exc.value.status_code == 403
    assert len(denials.rows) == 1
    denial = denials.rows[0]
    assert {key: denial[key] for key in (
        "user_id", "user_name", "role", "client_id", "site_id", "operation",
        "method", "path", "correlation_id",
    )} == {
        "user_id": "tech-1",
        "user_name": "Restricted Tech",
        "role": "technician",
        "client_id": None,
        "site_id": None,
        "operation": operation,
        "method": None,
        "path": None,
        "correlation_id": None,
    }
    assert denial["occurred_at"]


def test_tenant_mapping_requires_global_scope_before_any_registry_read(monkeypatch):
    denials = _Denials()
    monkeypatch.setattr(scope_permissions, "db", SimpleNamespace(scope_denials=denials))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            m365.map_tenant_to_client(
                "m365-tenant-foreign",
                {"client_id": "client-a", "reason": "Initial reviewed mapping"},
                current_user=_restricted_user(),
                _={},
            )
        )

    assert exc.value.status_code == 403
    assert denials.rows[0]["operation"] == "m365.onboarding.tenant.map"
