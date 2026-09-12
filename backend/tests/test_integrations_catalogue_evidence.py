"""Focused regression coverage for the truthful Integration catalogue."""

from __future__ import annotations

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

from app.routers import integrations_overview  # noqa: E402


def _contains(value, expected):
    if value == expected:
        return True
    if isinstance(value, dict):
        return any(_contains(item, expected) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains(item, expected) for item in value)
    return False


def _has_field_condition(value, field, expected):
    if isinstance(value, dict):
        if value.get(field) == expected:
            return True
        return any(_has_field_condition(item, field, expected) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_has_field_condition(item, field, expected) for item in value)
    return False


class _Cursor:
    def __init__(self, rows=None):
        self.rows = rows or []

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _Settings:
    def __init__(self, captured):
        self.captured = captured

    async def find_one(self, query, _projection):
        self.captured.append(query)
        # Legacy generic tiles are irrelevant to this focused regression.
        if _contains(query, {"key": "rustdesk_config"}):
            return {}

        # Every new connector's configuration is platform-bound in this test.
        if not _contains(query, {"platform_tenant_id": "platform-a"}):
            return None
        if _contains(query, {"type": "cipp"}):
            return {
                "base_url": "https://cipp.example.test/api",
                "api_key_encrypted": "cipp-secret-ciphertext",
                "last_test_status": "success",
            }
        if _contains(query, {"key": "m365_connection"}):
            return {
                "value": {
                    "app_id": "partner-app-id",
                    "partner_tenant_id": "partner-tenant-id",
                    "app_secret_encrypted": "m365-secret-ciphertext",
                    "last_test_status": "success",
                }
            }
        if _contains(query, {"key": "synergy_wholesale_config"}):
            return {
                "value": {
                    "reseller_id": "reseller-a",
                    "wsdl": "https://synergy.example.test/api.wsdl",
                    "api_key_encrypted": "synergy-secret-ciphertext",
                }
            }
        return None


class _ElevateSettings:
    def __init__(self, captured):
        self.captured = captured

    async def find_one(self, query, _projection):
        self.captured.append(query)
        if _contains(query, {"platform_tenant_id": "platform-a"}):
            return {"native_enabled": True}
        return None


class _Agents:
    def __init__(self, captured):
        self.captured = captured

    def find(self, query, _projection):
        self.captured.append(query)
        if _contains(query, {"nexus_elevate.state": "active"}):
            return _Cursor([{"last_seen": "2026-09-04T10:00:00+00:00", "nexus_elevate": {"state": "active"}}])
        return _Cursor([{"last_seen": "2026-09-04T10:01:00+00:00", "agent_version": "0.1.11-endpoint-readiness"}])


class _ProviderTenants:
    def __init__(self, captured):
        self.captured = captured

    async def count_documents(self, query):
        self.captured.append(query)
        return 2


class _Rows:
    def __init__(self, captured):
        self.captured = captured

    def find(self, query, _projection):
        self.captured.append(query)
        return _Cursor()


class _Database:
    def __init__(self, captured):
        self.settings = _Settings(captured["settings"])
        self.nexus_elevate_settings = _ElevateSettings(captured["elevate_settings"])
        self.nexus_agents = _Agents(captured["agents"])
        self.m365_tenants = _ProviderTenants(captured["m365_tenants"])
        self.yeastar_pbxs = _Rows(captured["yeastar_pbxs"])


async def _visible_m365_provider_tenant_ids(*_args, **_kwargs):
    return {"entra-a"}


async def _ready_private_artifact_storage():
    return {"configured": True, "ready": True, "public": False, "bucket": "nexus-artifacts"}


def test_catalogue_exposes_real_new_connectors_without_leaking_secrets(monkeypatch):
    captured = {"settings": [], "elevate_settings": [], "agents": [], "m365_tenants": [], "yeastar_pbxs": []}
    monkeypatch.setattr(integrations_overview, "db", _Database(captured))
    monkeypatch.setattr(integrations_overview, "visible_m365_provider_tenant_ids", _visible_m365_provider_tenant_ids)
    monkeypatch.setattr(integrations_overview, "storage_status", _ready_private_artifact_storage)
    monkeypatch.setattr(
        integrations_overview,
        "_nexus_agent_binary_info",
        lambda: {"exists": True, "version": "0.1.11-endpoint-readiness"},
    )

    result = asyncio.run(
        integrations_overview.integrations_overview(
            {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}
        )
    )
    tiles = {tile["key"]: tile for tile in result["tiles"]}

    assert result["total"] == 21
    assert {
        "synergy_wholesale",
        "supabase_artifacts",
        "nexus_agent",
        "nexus_elevate",
        "microsoft_partner_center",
    }.issubset(tiles)
    assert tiles["microsoft_partner_center"]["connection_state"] == "verified"
    assert tiles["microsoft_partner_center"]["evidence"]["graph_verified_tenant_count"] == 2
    assert tiles["cipp"]["name"] == "CIPP compatibility adapter"
    assert tiles["synergy_wholesale"]["connection_state"] == "configured_unverified"
    assert tiles["supabase_artifacts"]["connection_state"] == "verified"
    assert tiles["nexus_agent"]["management_owner"] == "operations_health"
    assert tiles["nexus_elevate"]["management_owner"] == "operations_health"
    assert tiles["synergy_wholesale"]["settings_anchor"] == "synergy-wholesale-settings-card"
    assert tiles["supabase_artifacts"]["settings_anchor"] == "supabase-storage-card"

    # The browser receives configuration state and evidence summaries only.
    payload = repr(result)
    for secret in ("cipp-secret-ciphertext", "m365-secret-ciphertext", "synergy-secret-ciphertext"):
        assert secret not in payload

    # Connector configuration must use the Nexus platform partition, whereas
    # Graph evidence uses the mapped Entra tenant identifier.
    for query in captured["settings"]:
        if any(
            _contains(query, selector)
            for selector in (
                {"type": "cipp"},
                {"key": "m365_connection"},
                {"key": "synergy_wholesale_config"},
            )
        ):
            assert _contains(query, {"platform_tenant_id": "platform-a"})
    assert _contains(captured["m365_tenants"][0], {"tenant_id": {"$in": ["entra-a"]}})
    assert not _contains(captured["m365_tenants"][0], {"tenant_id": "platform-a"})
    assert _contains(captured["yeastar_pbxs"][0], {"tenant_id": "platform-a"})
    assert _has_field_condition(captured["yeastar_pbxs"][0], "client_secret", {"$nin": ["", None]})


def test_platform_bound_actor_cannot_inherit_legacy_or_foreign_connector_settings(monkeypatch):
    captured = {"settings": [], "elevate_settings": [], "agents": [], "m365_tenants": [], "yeastar_pbxs": []}
    monkeypatch.setattr(integrations_overview, "db", _Database(captured))
    monkeypatch.setattr(integrations_overview, "visible_m365_provider_tenant_ids", _visible_m365_provider_tenant_ids)
    monkeypatch.setattr(integrations_overview, "storage_status", _ready_private_artifact_storage)
    monkeypatch.setattr(integrations_overview, "_nexus_agent_binary_info", lambda: {"exists": True, "version": "0.1.11"})

    result = asyncio.run(
        integrations_overview.integrations_overview(
            {"id": "admin-b", "role": "admin", "tenant_id": "platform-b"}
        )
    )
    tiles = {tile["key"]: tile for tile in result["tiles"]}

    assert tiles["cipp"]["configured"] is False
    assert tiles["microsoft_partner_center"]["configured"] is False
    assert tiles["synergy_wholesale"]["configured"] is False
    assert all(
        not _contains(query, {"platform_tenant_id": "platform-a"})
        for query in captured["settings"]
    )
    assert all(
        _contains(query, {"platform_tenant_id": "platform-b"})
        for query in captured["settings"]
    )
