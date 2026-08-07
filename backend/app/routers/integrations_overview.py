"""Truthful integration configuration and verification status overview."""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db


router = APIRouter()


def _configured(doc: dict[str, Any] | None, *fields: str) -> bool:
    return bool(doc) and all(bool(doc.get(field)) for field in fields)


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


async def _get_settings(stype: str) -> dict[str, Any]:
    return await db.settings.find_one({"type": stype}, {"_id": 0}) or {}


def _tile(*, key: str, name: str, category: str, description: str, configured: bool, last_synced_at: Any = None, last_test_status: Any = None, command_center: str | None = None, settings_anchor: str | None = None, settings_path: str | None = None) -> dict:
    return {
        "key": key, "name": name, "category": category, "description": description,
        "configured": configured, "connection_state": _connection_state(configured, last_test_status, last_synced_at),
        "last_synced_at": last_synced_at, "last_test_status": last_test_status,
        "command_center": command_center, "settings_anchor": settings_anchor, "settings_path": settings_path,
    }


@router.get("/integrations-overview")
async def integrations_overview(current_user: dict = Depends(get_current_user)):
    """Expose configured vs verified state without returning secrets or guessing health."""
    setting_types = ["huntress", "hudu", "acronis", "pax8", "stripe", "o365_mailbox", "sms", "xero", "splynx", "syncro", "suped", "domotz", "rustdesk", "cipp", "unifi"]
    settings = {setting_type: await _get_settings(setting_type) for setting_type in setting_types}
    rustdesk_legacy = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0}) or {}
    rustdesk_legacy_value = rustdesk_legacy.get("value") if isinstance(rustdesk_legacy.get("value"), dict) else {}
    pax8_value = settings["pax8"].get("value") if isinstance(settings["pax8"].get("value"), dict) else {}
    yeastar_collection = getattr(db, "yeastar_pbxs", None)
    yeastar_pbxs = (
        await yeastar_collection.find({}, {"_id": 0, "pbx_url": 1, "client_api_id": 1, "client_secret": 1, "enabled": 1, "last_sync": 1, "status": 1}).to_list(500)
        if yeastar_collection is not None
        else []
    )
    yeastar_configured = any(
        pbx.get("enabled", True) and pbx.get("pbx_url") and pbx.get("client_api_id") and pbx.get("client_secret")
        for pbx in yeastar_pbxs
    )
    latest_yeastar_sync = max((pbx.get("last_sync") or "" for pbx in yeastar_pbxs), default="")
    yeastar_status = "failed" if any(pbx.get("status") in {"offline", "authentication_failed"} for pbx in yeastar_pbxs) else None

    tiles = [
        _tile(key="rustdesk", name="RustDesk", category="remote-access", description="Self-hosted remote access for managed endpoints", configured=bool(settings["rustdesk"].get("server_url") or rustdesk_legacy_value.get("server_url")), last_synced_at=settings["rustdesk"].get("last_sync") or rustdesk_legacy_value.get("last_auto_sync") or rustdesk_legacy_value.get("last_sync"), last_test_status=settings["rustdesk"].get("last_test_status") or rustdesk_legacy_value.get("last_test_status"), command_center="/remote-access", settings_path="/remote-access"),
        _tile(key="cipp", name="Nexus Control Plane - Microsoft 365", category="security", description="Multi-tenant identity, licensing, security, and governed Microsoft operations", configured=_configured(settings["cipp"], "base_url", "api_key_full"), last_synced_at=settings["cipp"].get("last_synced_at"), last_test_status=settings["cipp"].get("last_test_status"), command_center="/control-plane?module=microsoft365&view=connections", settings_anchor="cipp-settings-card"),
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
        _tile(key="unifi", name="UniFi Site Manager", category="network", description="Hosted network sites, devices, clients, and alerts", configured=bool(settings["unifi"].get("api_key_full")), last_synced_at=settings["unifi"].get("last_synced_at"), last_test_status=settings["unifi"].get("last_test_status"), command_center="/unifi", settings_anchor="unifi-settings-card"),
    ]
    total = len(tiles)
    configured_count = sum(tile["configured"] for tile in tiles)
    verified_count = sum(tile["connection_state"] == "verified" for tile in tiles)
    attention_count = sum(tile["connection_state"] in {"configured_unverified", "failed", "stale"} for tile in tiles)
    return {"total": total, "configured_count": configured_count, "verified_count": verified_count, "attention_count": attention_count, "coverage_pct": round((configured_count / total) * 100) if total else 0, "tiles": tiles}
