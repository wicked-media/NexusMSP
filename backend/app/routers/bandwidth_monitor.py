from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import assert_record_scope, platform_tenant_id, scoped_query
from app.services.module_permissions import require_module_permission
import uuid
from urllib.parse import urlsplit

router = APIRouter()

_NETWORK_SITE_SECRET_FIELDS = {
    "username",
    "password",
    "api_key",
    "username_encrypted",
    "password_encrypted",
    "api_key_encrypted",
}


def _public_network_site(site: dict) -> dict:
    """Redact controller credentials when a site is embedded in bandwidth data."""
    public = dict(site)
    public.pop("_id", None)
    for field in _NETWORK_SITE_SECRET_FIELDS:
        public.pop(field, None)
    raw_url = str(public.get("controller_url") or "").strip()
    try:
        parsed_url = urlsplit(raw_url) if raw_url else None
    except ValueError:
        parsed_url = None
        public["controller_url"] = ""
    if parsed_url and (parsed_url.username or parsed_url.password or parsed_url.query or parsed_url.fragment):
        public["controller_url"] = ""
    return public


async def _scoped_network_site(site_id: str, current_user: dict, *, operation: str) -> dict:
    """Authorize against the Nexus network-site ID, not UniFi's site alias."""
    return await assert_record_scope(
        current_user,
        db.network_sites,
        site_id,
        site_field="id",
        operation=operation,
        resource_name="Network site",
    )


async def _network_sites_in_scope(current_user: dict) -> list[dict]:
    return await db.network_sites.find(
        scoped_query(current_user, field="client_id", site_field="id"),
        {"_id": 0},
    ).to_list(1000)

@router.get("/bandwidth-monitor/overview")
async def get_bandwidth_overview(current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    sites = await _network_sites_in_scope(current_user)
    site_ids = [site["id"] for site in sites]
    data = await db.bandwidth_data.find(
        {"site_id": {"$in": site_ids}, "source": {"$exists": True, "$ne": "demo_placeholder"}},
        {"_id": 0},
    ).to_list(500)
    return {
        "sites": [_public_network_site(site) for site in sites],
        "bandwidth_data": data,
        "meta": {
            "data_status": "current" if data else "empty",
            "source": "controller_telemetry",
            "observed_at": datetime.now(timezone.utc).isoformat(),
        },
    }

@router.get("/bandwidth-monitor/site/{site_id}")
async def get_site_bandwidth(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    await _scoped_network_site(site_id, current_user, operation="bandwidth.site.read")
    data = await db.bandwidth_data.find(
        {"site_id": site_id, "source": {"$exists": True, "$ne": "demo_placeholder"}},
        {"_id": 0},
    ).sort("timestamp", -1).to_list(288)
    return {
        "samples": data,
        "meta": {
            "data_status": "current" if data else "empty",
            "source": "controller_telemetry",
            "observed_at": datetime.now(timezone.utc).isoformat(),
        },
    }

@router.get("/bandwidth-monitor/alerts")
async def get_bandwidth_alerts(current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    sites = await _network_sites_in_scope(current_user)
    site_ids = [site["id"] for site in sites]
    alerts = await db.bandwidth_alerts.find(
        {"site_id": {"$in": site_ids}, "source": {"$ne": "demo_placeholder"}},
        {"_id": 0},
    ).sort("detected_at", -1).to_list(100)
    return {
        "alerts": alerts,
        "meta": {
            "data_status": "current" if alerts else "empty",
            "source": "controller_telemetry",
            "observed_at": datetime.now(timezone.utc).isoformat(),
        },
    }

@router.post("/bandwidth-monitor/alerts/{alert_id}/resolve")
async def resolve_bandwidth_alert(alert_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Resolve a bandwidth alert and retain a technician-attributed audit record."""
    await require_module_permission(current_user, "networking", "edit")
    alert = await db.bandwidth_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Bandwidth alert not found")
    await _scoped_network_site(
        str(alert.get("site_id") or ""),
        current_user,
        operation="bandwidth.alert.resolve",
    )

    now = datetime.now(timezone.utc).isoformat()
    note = (data or {}).get("note", "").strip()
    update = {
        "resolved": True,
        "resolved_at": now,
        "resolved_by": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        "resolution_note": note,
    }
    await db.bandwidth_alerts.update_one({"id": alert_id, "site_id": alert.get("site_id")}, {"$set": update})
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(current_user),
        "client_id": alert.get("client_id"),
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email"),
        "action": "resolve",
        "entity_type": "bandwidth_alert",
        "entity_id": alert_id,
        "entity_name": alert.get("site_name") or alert.get("site_id") or alert_id,
        "metadata": {"severity": alert.get("severity"), "type": alert.get("type"), "note": note},
        "created_at": now,
    })
    return {"message": "Bandwidth alert resolved", "alert": {**alert, **update}}

@router.get("/bandwidth-monitor/top-talkers/{site_id}")
async def get_top_talkers(site_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    await _scoped_network_site(site_id, current_user, operation="bandwidth.top_talkers.read")
    clients = await db.network_clients.find({"site_id": site_id}, {"_id": 0}).to_list(50)
    sorted_clients = sorted(clients, key=lambda c: (c.get("rx_bytes", 0) + c.get("tx_bytes", 0)), reverse=True)
    return sorted_clients[:10]
