"""Truthful integration configuration and verification status overview.

The catalogue intentionally distinguishes an available Nexus capability from a
configured provider and a provider that has supplied fresh evidence.  It is an
operations-health index; connector credential configuration belongs in
Settings, while the operational work remains in the owning workspace.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.m365_provider_visibility import (
    m365_provider_tenant_query,
    visible_m365_provider_tenant_ids,
)
from app.services.scope_permissions import scoped_query, tenant_scoped_query
from app.services.supabase_storage import is_configured, storage_status


router = APIRouter()


def _configured(doc: dict[str, Any] | None, *fields: str) -> bool:
    return bool(doc) and all(bool(doc.get(field)) for field in fields)


def _tenant_id(value: Any) -> str | None:
    tenant_id = str(value or "").strip()
    return tenant_id or None


def _visible_site_manager_settings(settings: dict[str, Any], current_user: dict) -> dict[str, Any]:
    """A tenant-owned Site Manager tile must not reveal another tenant's state."""
    actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
    owner_tenant_id = _tenant_id(settings.get("site_manager_tenant_id"))
    if actor_tenant_id and owner_tenant_id != actor_tenant_id:
        return {}
    return settings


def _timestamp(value: Any):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _connection_state(configured: bool, last_test_status: Any = None, last_synced_at: Any = None) -> str:
    """A saved credential is never presented as a verified connection."""
    if not configured:
        return "not_configured"
    test = str(last_test_status or "").lower()
    if any(token in test for token in ("fail", "error", "denied", "invalid", "unauthor")):
        return "failed"
    if any(token in test for token in ("success", "connected", "passed", "healthy")):
        return "verified"
    synced = _timestamp(last_synced_at)
    if synced:
        return "stale" if datetime.now(timezone.utc) - synced > timedelta(hours=24) else "verified"
    return "configured_unverified"


async def _get_settings(current_user: dict, stype: str) -> dict[str, Any]:
    """Return a platform-owned provider configuration without legacy bleed.

    Provider credentials and their health state belong to the MSP platform,
    rather than to whichever technician happens to open the catalogue.  The
    platform partition keeps an explicitly tenant-bound MSP from seeing the
    configured/not-configured state of another MSP's providers, while retaining
    the reviewed ``nexus-local`` compatibility path for the existing install.
    """
    return await _platform_setting(current_user, {"type": stype})


def _platform_configuration_query(current_user: dict, query: dict[str, Any]) -> dict[str, Any]:
    """Read connector configuration through the Nexus platform partition.

    Partner and provider settings are owned by an MSP platform, not a customer
    Microsoft tenant.  ``tenant_scoped_query`` keeps untagged legacy settings
    visible only to the documented ``nexus-local`` installation and fails
    closed for an explicitly platform-bound actor.
    """
    return tenant_scoped_query(
        current_user,
        query,
        tenant_field="platform_tenant_id",
    )


async def _platform_setting(current_user: dict, query: dict[str, Any]) -> dict[str, Any]:
    return await db.settings.find_one(
        _platform_configuration_query(current_user, query),
        {"_id": 0},
    ) or {}


async def _platform_record(current_user: dict, collection_name: str, query: dict[str, Any]) -> dict[str, Any]:
    """Load a platform-owned native-service record without cross-tenant fallbacks."""
    collection = getattr(db, collection_name, None)
    if collection is None:
        return {}
    return await collection.find_one(
        _platform_configuration_query(current_user, query),
        {"_id": 0},
    ) or {}


def _scoped_agent_query(current_user: dict, query: dict[str, Any]) -> dict[str, Any]:
    """Constrain native endpoint evidence to the actor's platform and clients."""
    return tenant_scoped_query(
        current_user,
        scoped_query(current_user, query, site_field=None),
    )


async def _latest_agent_evidence(current_user: dict, query: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return one safe heartbeat datum, never endpoint inventory or tokens."""
    agents = getattr(db, "nexus_agents", None)
    if agents is None:
        return {}
    rows = await agents.find(
        _scoped_agent_query(current_user, {"is_active": True, **(query or {})}),
        {"_id": 0, "last_seen": 1, "agent_version": 1, "nexus_elevate.state": 1},
    ).sort("last_seen", -1).to_list(1)
    return rows[0] if rows else {}


def _nexus_agent_binary_info() -> dict[str, Any]:
    """Use the Agent's existing release evidence without exposing its binary."""
    try:
        # The Agent router is the existing source of truth for release
        # fingerprinting.  This lazy import avoids a router-import cycle at
        # application startup.
        from app.routers.nexus_agent import _binary_info

        return _binary_info()
    except (ImportError, OSError):
        return {"exists": False, "version": None}


async def _microsoft_connector_evidence(current_user: dict) -> tuple[dict[str, Any], int]:
    """Return Partner Center config plus client-visible Graph evidence only."""
    settings, visible_tenant_ids = await asyncio.gather(
        _platform_setting(current_user, {"key": "m365_connection"}),
        visible_m365_provider_tenant_ids(current_user, database=db),
    )
    tenants = getattr(db, "m365_tenants", None)
    graph_evidence = 0
    if tenants is not None:
        graph_evidence = await tenants.count_documents(
            m365_provider_tenant_query(
                visible_tenant_ids,
                {"source": "m365_graph", "graph_verified": True},
            )
        )
    return settings, graph_evidence


async def _artifact_storage_status() -> dict[str, Any]:
    """Keep a slow artifact provider from delaying the whole catalogue."""
    try:
        return await asyncio.wait_for(storage_status(), timeout=5.0)
    except asyncio.TimeoutError:
        return {
            "configured": is_configured(),
            "ready": False,
            "detail": "Supabase Storage status check timed out.",
        }


def _configured_yeastar_query(current_user: dict) -> dict[str, Any]:
    """Limit the voice tile to PBXs the current actor may actually operate.

    The catalogue only needs connection-state evidence.  Matching credential
    presence in Mongo keeps the secret out of the returned projection, and the
    query preserves both client and platform boundaries.
    """
    return tenant_scoped_query(
        current_user,
        scoped_query(
            current_user,
            {
                "enabled": {"$ne": False},
                "pbx_url": {"$nin": ["", None]},
                "client_api_id": {"$nin": ["", None]},
                "client_secret": {"$nin": ["", None]},
            },
            site_field=None,
        ),
    )


def _tile(*, key: str, name: str, category: str, description: str, configured: bool, last_synced_at: Any = None, last_test_status: Any = None, command_center: str | None = None, settings_anchor: str | None = None, settings_path: str | None = None, management_owner: str = "settings_configuration", evidence: dict[str, Any] | None = None) -> dict:
    return {
        "key": key, "name": name, "category": category, "description": description,
        "configured": configured, "connection_state": _connection_state(configured, last_test_status, last_synced_at),
        "last_synced_at": last_synced_at, "last_test_status": last_test_status,
        "command_center": command_center, "settings_anchor": settings_anchor, "settings_path": settings_path,
        # A tile has one primary owner.  UIs can still offer a secondary link
        # to the other surface, but should not duplicate configuration forms.
        "management_owner": management_owner,
        "evidence": evidence or {},
    }


@router.get("/integrations-overview")
async def integrations_overview(current_user: dict = Depends(get_current_user)):
    """Expose configured vs verified state without returning secrets or guessing health."""
    setting_types = ["huntress", "hudu", "acronis", "pax8", "stripe", "o365_mailbox", "sms", "xero", "splynx", "syncro", "suped", "domotz", "unifi"]
    setting_documents = await asyncio.gather(
        *(_get_settings(current_user, setting_type) for setting_type in setting_types)
    )
    settings = dict(zip(setting_types, setting_documents, strict=True))
    unifi_settings = _visible_site_manager_settings(settings["unifi"], current_user)
    pax8_value = settings["pax8"].get("value") if isinstance(settings["pax8"].get("value"), dict) else {}

    (
        cipp_settings,
        synergy_settings,
        elevate_settings,
        artifact_storage,
        agent_evidence,
        elevate_evidence,
        microsoft_evidence,
    ) = await asyncio.gather(
        _platform_setting(current_user, {"type": "cipp"}),
        _platform_setting(current_user, {"key": "synergy_wholesale_config"}),
        _platform_record(current_user, "nexus_elevate_settings", {"_id": "nexus_elevate"}),
        _artifact_storage_status(),
        _latest_agent_evidence(current_user),
        _latest_agent_evidence(current_user, {"nexus_elevate.state": "active"}),
        _microsoft_connector_evidence(current_user),
    )
    microsoft_settings, graph_verified_tenants = microsoft_evidence
    microsoft_value = microsoft_settings.get("value") if isinstance(microsoft_settings.get("value"), dict) else {}
    synergy_value = synergy_settings.get("value") if isinstance(synergy_settings.get("value"), dict) else {}
    agent_binary = _nexus_agent_binary_info()
    agent_binary_available = bool(agent_binary.get("exists"))
    agent_available = agent_binary_available or bool(agent_evidence.get("last_seen"))
    elevate_enabled = bool(elevate_settings) and bool(elevate_settings.get("native_enabled", True))
    elevate_available = elevate_enabled and (agent_binary_available or bool(elevate_evidence.get("last_seen")))
    artifact_ready = bool(artifact_storage.get("ready")) and not bool(artifact_storage.get("public"))
    artifact_test_status = (
        "success"
        if artifact_ready
        else "failed"
        if artifact_storage.get("configured")
        else None
    )

    yeastar_collection = getattr(db, "yeastar_pbxs", None)
    yeastar_pbxs = (
        await yeastar_collection.find(
            _configured_yeastar_query(current_user),
            {"_id": 0, "last_sync": 1, "status": 1},
        ).to_list(500)
        if yeastar_collection is not None
        else []
    )
    yeastar_configured = bool(yeastar_pbxs)
    latest_yeastar_sync = max((pbx.get("last_sync") or "" for pbx in yeastar_pbxs), default="")
    yeastar_status = "failed" if any(pbx.get("status") in {"offline", "authentication_failed"} for pbx in yeastar_pbxs) else None

    tiles = [
        _tile(key="microsoft_partner_center", name="Microsoft Partner Center", category="security", description="CSP customer discovery and tenant onboarding. Graph and GDAP action authority stay separately verified in Nexus Control Plane.", configured=bool(microsoft_value.get("app_id") and (microsoft_value.get("partner_tenant_id") or microsoft_value.get("tenant_id")) and (microsoft_value.get("app_secret_encrypted") or microsoft_value.get("app_secret"))), last_synced_at=microsoft_value.get("last_synced"), last_test_status=microsoft_value.get("last_test_status"), command_center="/control-plane?module=microsoft365&view=connections", settings_path="/control-plane?module=microsoft365&view=connections", management_owner="operations_health", evidence={"graph_verified_tenant_count": graph_verified_tenants, "graph_action_access_proven": graph_verified_tenants > 0}),
        _tile(key="cipp", name="CIPP compatibility adapter", category="security", description="Optional compatibility adapter for an existing CIPP deployment. Nexus remains the operational workspace and does not treat the adapter as native Graph proof.", configured=bool(cipp_settings.get("base_url") and (cipp_settings.get("api_key_encrypted") or cipp_settings.get("api_key_full"))), last_synced_at=cipp_settings.get("last_synced_at"), last_test_status=cipp_settings.get("last_test_status"), command_center="/control-plane?module=microsoft365&view=connections", settings_anchor="cipp-settings-card", management_owner="settings_configuration"),
        _tile(key="huntress", name="Huntress", category="security", description="Managed Detection & Response", configured=_configured(settings["huntress"], "api_key", "secret_key"), last_synced_at=settings["huntress"].get("last_synced_at"), last_test_status=settings["huntress"].get("last_test_status"), command_center="/security-dashboard", settings_anchor="huntress-settings-card"),
        _tile(key="hudu", name="Hudu", category="documentation", description="IT documentation & credential reference", configured=_configured(settings["hudu"], "url", "api_key_full"), last_synced_at=settings["hudu"].get("last_synced_at"), last_test_status=settings["hudu"].get("last_test_status"), command_center="/hudu", settings_anchor="hudu-settings-card"),
        _tile(key="acronis", name="Acronis Cyber Cloud", category="backup", description="Backup & disaster recovery", configured=_configured(settings["acronis"], "api_url", "client_id", "client_secret"), last_synced_at=settings["acronis"].get("last_synced_at"), last_test_status=settings["acronis"].get("last_test_status"), command_center="/backup-center", settings_anchor="acronis-settings-card"),
        _tile(key="pax8", name="Pax8", category="billing", description="CSP and Microsoft licence synchronisation", configured=bool(pax8_value.get("enabled") or settings["pax8"].get("client_id")), last_synced_at=pax8_value.get("last_sync_at") or settings["pax8"].get("last_sync_at"), last_test_status=pax8_value.get("last_test_result") or settings["pax8"].get("last_test_result"), command_center="/pax8", settings_anchor="pax8-settings-card"),
        _tile(key="domotz", name="Domotz", category="network", description="Network monitoring", configured=bool(settings["domotz"].get("api_key")), last_synced_at=settings["domotz"].get("last_sync_at"), last_test_status=settings["domotz"].get("last_test_status"), command_center="/domotz", settings_path="/domotz"),
        _tile(key="stripe", name="Stripe", category="payments", description="Payment processing", configured=bool(settings["stripe"].get("api_key") or settings["stripe"].get("secret_key")), last_test_status=settings["stripe"].get("last_test_status"), settings_anchor="stripe-settings-card"),
        _tile(key="xero", name="Xero", category="accounting", description="Accounting and invoice push", configured=bool(settings["xero"].get("access_token") and settings["xero"].get("tenant_id")), last_synced_at=settings["xero"].get("last_sync_at"), last_test_status=settings["xero"].get("last_test_status"), command_center="/invoices", settings_anchor="xero-settings-card"),
        _tile(key="yeastar", name="Yeastar Voice", category="voice", description="Client-linked PBXs, extension governance, and recurring billing", configured=yeastar_configured, last_synced_at=latest_yeastar_sync, last_test_status=yeastar_status, command_center="/voice"),
        _tile(key="microsoft365", name="Microsoft 365 Email", category="email", description="Shared mailboxes, intake, and role-based outbound delivery", configured=bool(settings["o365_mailbox"].get("enabled") and settings["o365_mailbox"].get("connected")), last_synced_at=settings["o365_mailbox"].get("last_graph_sync"), last_test_status=settings["o365_mailbox"].get("last_outbound_test_status"), command_center="/email", settings_path="/settings?tab=mailbox"),
        _tile(key="sms", name="MobileMessage SMS", category="messaging", description="Two-way SMS", configured=_configured(settings["sms"], "api_key", "api_secret"), last_test_status=settings["sms"].get("last_test_status"), settings_anchor="sms-settings-card"),
        _tile(key="splynx", name="Splynx", category="isp", description="ISP billing", configured=bool(settings["splynx"].get("url") and settings["splynx"].get("api_key")), last_synced_at=settings["splynx"].get("last_sync_at"), last_test_status=settings["splynx"].get("last_test_status"), settings_anchor="splynx-settings-card"),
        _tile(key="syncro", name="Syncro", category="psa-sync", description="Legacy PSA sync", configured=_configured(settings["syncro"], "api_key", "subdomain"), last_synced_at=settings["syncro"].get("last_sync_at"), last_test_status=settings["syncro"].get("last_test_status"), settings_anchor="syncro-settings-card"),
        _tile(key="suped", name="Suped DMARC", category="security", description="DMARC and email authentication monitoring", configured=bool(settings["suped"].get("api_key")), last_synced_at=settings["suped"].get("last_sync_at"), last_test_status=settings["suped"].get("last_test_status"), command_center="/suped", settings_anchor="suped-settings-card"),
        _tile(key="unifi", name="UniFi Site Manager", category="network", description="Hosted network sites, devices, clients, and alerts", configured=bool(unifi_settings.get("site_manager_api_key_encrypted") or unifi_settings.get("api_key_full")), last_synced_at=unifi_settings.get("site_manager_last_synced_at") or unifi_settings.get("last_synced_at"), last_test_status=unifi_settings.get("site_manager_last_test_status") or unifi_settings.get("last_test_status"), command_center="/unifi", settings_anchor="unifi-settings-card"),
        _tile(key="synergy_wholesale", name="Synergy Wholesale", category="network", description="Governed domains, DNS, hosting, cPanel, SSL certificates and commercial lifecycle workflows.", configured=bool(synergy_value.get("reseller_id") and synergy_value.get("wsdl") and synergy_value.get("api_key_encrypted")), last_synced_at=synergy_value.get("last_synced_at"), last_test_status=synergy_value.get("last_test_status"), command_center="/web-studio", settings_anchor="synergy-wholesale-settings-card", management_owner="settings_configuration", evidence={"credential_storage": "server_encrypted" if synergy_value.get("api_key_encrypted") else "not_configured"}),
        _tile(key="supabase_artifacts", name="Private Artifact Storage", category="documentation", description="Private Supabase Storage for generated documents, customer files, ticket evidence and reports. MongoDB remains the metadata source of truth.", configured=bool(artifact_storage.get("configured")), last_test_status=artifact_test_status, settings_anchor="supabase-storage-card", management_owner="settings_configuration", evidence={"private_bucket_ready": artifact_ready}),
        _tile(key="nexus_agent", name="NexusOps Agent", category="remote-access", description="Native endpoint agent release and scoped heartbeat evidence for managed assets.", configured=agent_available, last_synced_at=agent_evidence.get("last_seen"), command_center="/nexus-agent", settings_anchor="nexus-agent-settings-card", management_owner="operations_health", evidence={"release_available": agent_binary_available, "release_version": agent_binary.get("version"), "fresh_agent_evidence": bool(agent_evidence.get("last_seen"))}),
        _tile(key="nexus_elevate", name="Nexus Elevate", category="security", description="Native, approval-bound privilege elevation through eligible Nexus Agent endpoints.", configured=elevate_available, last_synced_at=elevate_evidence.get("last_seen"), command_center="/nexus-elevate", settings_anchor="nexus-elevate-settings-card", management_owner="operations_health", evidence={"release_available": agent_binary_available, "active_agent_evidence": bool(elevate_evidence.get("last_seen")), "native_enabled": elevate_enabled}),
    ]
    total = len(tiles)
    configured_count = sum(tile["configured"] for tile in tiles)
    verified_count = sum(tile["connection_state"] == "verified" for tile in tiles)
    attention_count = sum(tile["connection_state"] in {"configured_unverified", "failed", "stale"} for tile in tiles)
    return {"total": total, "configured_count": configured_count, "verified_count": verified_count, "attention_count": attention_count, "coverage_pct": round((configured_count / total) * 100) if total else 0, "tiles": tiles}
