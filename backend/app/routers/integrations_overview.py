"""
Unified Integrations Overview — one endpoint that returns the status of every
3rd-party integration configured in NexusOps.
"""
from fastapi import APIRouter, Depends
from typing import Any, Dict

from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _configured(doc: Dict[str, Any] | None, *fields: str) -> bool:
    if not doc:
        return False
    return all(bool(doc.get(f)) for f in fields)


async def _get_settings(stype: str) -> Dict[str, Any]:
    doc = await db.settings.find_one({"type": stype}, {"_id": 0}) or {}
    return doc


@router.get("/integrations-overview")
async def integrations_overview(current_user: dict = Depends(get_current_user)):
    """Return a list of integration status tiles for the command deck."""
    huntress = await _get_settings("huntress")
    hudu = await _get_settings("hudu")
    acronis = await _get_settings("acronis")
    pax8 = await _get_settings("pax8")
    stripe = await _get_settings("stripe")
    resend = await _get_settings("resend")
    sms = await _get_settings("sms")
    xero = await _get_settings("xero")
    splynx = await _get_settings("splynx")
    syncro = await _get_settings("syncro")
    suped = await _get_settings("suped")
    domotz = await _get_settings("domotz")

    tiles = [
        {
            "key": "huntress",
            "name": "Huntress",
            "category": "security",
            "description": "Managed Detection & Response",
            "configured": _configured(huntress, "api_key", "secret_key"),
            "last_synced_at": huntress.get("last_synced_at"),
            "last_test_status": huntress.get("last_test_status"),
            "command_center": "/security-dashboard",
            "settings_anchor": "huntress-settings-card",
        },
        {
            "key": "hudu",
            "name": "Hudu",
            "category": "documentation",
            "description": "IT documentation & passwords",
            "configured": _configured(hudu, "url", "api_key_full"),
            "last_synced_at": hudu.get("last_synced_at"),
            "last_test_status": hudu.get("last_test_status"),
            "command_center": "/hudu",
            "settings_anchor": "hudu-settings-card",
        },
        {
            "key": "acronis",
            "name": "Acronis Cyber Cloud",
            "category": "backup",
            "description": "Backup & disaster recovery",
            "configured": _configured(acronis, "datacenter_url", "client_id", "client_secret"),
            "last_synced_at": acronis.get("last_synced_at"),
            "last_test_status": acronis.get("last_test_status"),
            "command_center": "/backup-command-center",
            "settings_anchor": "acronis-settings-card",
        },
        {
            "key": "pax8",
            "name": "Pax8",
            "category": "billing",
            "description": "CSP / Microsoft licenses",
            "configured": bool(pax8.get("value", {}).get("enabled") or pax8.get("client_id")),
            "last_synced_at": (pax8.get("value", {}) or {}).get("last_sync_at") or pax8.get("last_sync_at"),
            "last_test_status": (pax8.get("value", {}) or {}).get("last_test_result") or pax8.get("last_test_result"),
            "command_center": "/pax8",
            "settings_anchor": "pax8-settings-card",
        },
        {
            "key": "domotz",
            "name": "Domotz",
            "category": "network",
            "description": "Network monitoring",
            "configured": bool(domotz.get("api_key")),
            "last_synced_at": domotz.get("last_sync_at"),
            "last_test_status": domotz.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "domotz-settings-card",
        },
        {
            "key": "stripe",
            "name": "Stripe",
            "category": "payments",
            "description": "Payment processing",
            "configured": bool(stripe.get("api_key") or stripe.get("secret_key")),
            "last_synced_at": None,
            "last_test_status": stripe.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "stripe-settings-card",
        },
        {
            "key": "xero",
            "name": "Xero",
            "category": "accounting",
            "description": "Accounting + invoice push",
            "configured": bool(xero.get("access_token") or xero.get("tenant_id")),
            "last_synced_at": xero.get("last_sync_at"),
            "last_test_status": xero.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "xero-settings-card",
        },
        {
            "key": "resend",
            "name": "Resend",
            "category": "email",
            "description": "Transactional email",
            "configured": bool(resend.get("api_key")),
            "last_synced_at": None,
            "last_test_status": resend.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "resend-settings-card",
        },
        {
            "key": "sms",
            "name": "MobileMessage SMS",
            "category": "messaging",
            "description": "Two-way SMS",
            "configured": bool(sms.get("api_key") and sms.get("api_secret")),
            "last_synced_at": None,
            "last_test_status": sms.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "sms-settings-card",
        },
        {
            "key": "splynx",
            "name": "Splynx",
            "category": "isp",
            "description": "ISP billing",
            "configured": bool(splynx.get("api_key") or splynx.get("url")),
            "last_synced_at": None,
            "last_test_status": splynx.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "splynx-settings-card",
        },
        {
            "key": "syncro",
            "name": "Syncro",
            "category": "psa-sync",
            "description": "Legacy PSA sync",
            "configured": bool(syncro.get("api_key") and syncro.get("subdomain")),
            "last_synced_at": syncro.get("last_sync_at"),
            "last_test_status": syncro.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "syncro-settings-card",
        },
        {
            "key": "suped",
            "name": "Suped DMARC",
            "category": "security",
            "description": "DMARC / email auth monitoring",
            "configured": bool(suped.get("api_key")),
            "last_synced_at": suped.get("last_sync_at"),
            "last_test_status": suped.get("last_test_status"),
            "command_center": None,
            "settings_anchor": "suped-settings-card",
        },
    ]

    total = len(tiles)
    configured = sum(1 for t in tiles if t["configured"])
    return {
        "total": total,
        "configured_count": configured,
        "coverage_pct": round((configured / total) * 100) if total else 0,
        "tiles": tiles,
    }
