"""
UniFi Site Manager API integration (api.ui.com).

API REFERENCE: https://developer.ui.com/
Auth: X-API-KEY header.

Available endpoints (read-only on Site Manager):
  GET /v1/hosts                       — list UniFi consoles
  GET /v1/hosts/{hostId}              — host details
  GET /v1/sites                       — list sites (with rich `statistics.counts`)
  GET /v1/devices?hostIds[]=<id>      — list devices grouped by host
  GET /v1/isps                        — ISP info (where supported)

Default base is /v1 (stable, 10000 req/min). /ea is Early Access (100 req/min).

Note: Per-site clients/networks/alerts are NOT exposed by the Site Manager API.
We surface client/device counts from the site's `statistics.counts` instead.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional, Any
import httpx
import os

from app.database import db
from app.auth import get_current_user

router = APIRouter()

SETTINGS_KEY = "unifi"
DEFAULT_BASE_URL = "https://api.ui.com/v1"


async def _get_config() -> Optional[dict]:
    cfg = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not cfg or not cfg.get("api_key_full"):
        return None
    return cfg


async def _unifi_call(method: str, path: str, params: Optional[dict] = None, json_body: Optional[dict] = None):
    cfg = await _get_config()
    if not cfg:
        raise HTTPException(503, "UniFi not configured")
    base = (cfg.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    headers = {
        "X-API-KEY": cfg["api_key_full"],
        "Accept": "application/json",
    }
    verify = os.environ.get("ALLOW_SELF_SIGNED_CERTS", "false").lower() != "true"
    try:
        async with httpx.AsyncClient(timeout=30, verify=verify) as client:
            r = await client.request(method, url, headers=headers, params=params, json=json_body)
            if r.status_code in (401, 403):
                raise HTTPException(r.status_code, "UniFi auth failed — check API key")
            if r.status_code == 429:
                raise HTTPException(429, "UniFi rate limit hit — wait and retry")
            if r.status_code >= 400:
                raise HTTPException(r.status_code, f"UniFi API error: {r.text[:200]}")
            try:
                return r.json()
            except Exception:
                return {"raw": r.text}
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        raise HTTPException(502, f"UniFi request failed: {str(e)[:160]}")


def _data(resp: Any) -> list:
    """Site Manager API wraps everything in `{data: [...], httpStatusCode, traceId, nextToken}`."""
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        d = resp.get("data")
        if isinstance(d, list):
            return d
    return []


# ─────────────────────────── Settings ───────────────────────────

@router.get("/unifi/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    cfg = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not cfg:
        return {"configured": False, "base_url": DEFAULT_BASE_URL, "api_key_preview": None, "last_test_status": None, "last_tested_at": None, "last_synced_at": None}
    return {
        "configured": bool(cfg.get("api_key_full")),
        "base_url": cfg.get("base_url") or DEFAULT_BASE_URL,
        "api_key_preview": cfg.get("api_key_preview"),
        "last_test_status": cfg.get("last_test_status"),
        "last_tested_at": cfg.get("last_tested_at"),
        "last_synced_at": cfg.get("last_synced_at"),
    }


@router.get("/unifi/status")
async def get_status(current_user: dict = Depends(get_current_user)):
    return await get_settings(current_user)


@router.post("/unifi/settings")
async def save_settings(data: dict, current_user: dict = Depends(get_current_user)):
    api_key = (data or {}).get("api_key", "").strip()
    base_url = (data or {}).get("base_url", "").strip() or DEFAULT_BASE_URL
    if not api_key:
        raise HTTPException(400, "api_key required")
    preview = f"…{api_key[-4:]}" if len(api_key) >= 4 else "…"
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {
            "type": SETTINGS_KEY,
            "api_key_full": api_key,
            "api_key_preview": preview,
            "base_url": base_url,
            "configured": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name"),
        }},
        upsert=True,
    )
    return {"message": "UniFi settings saved"}


@router.delete("/unifi/settings")
async def delete_settings(current_user: dict = Depends(get_current_user)):
    await db.settings.delete_one({"type": SETTINGS_KEY})
    return {"message": "UniFi credentials removed"}


@router.get("/unifi/test")
async def test_connection(current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    if not cfg:
        return {"success": False, "message": "Not configured"}
    now = datetime.now(timezone.utc).isoformat()
    try:
        data = await _unifi_call("GET", "hosts")
        hosts = _data(data)
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"last_test_status": "ok", "last_tested_at": now}},
        )
        return {"success": True, "message": f"Connected · {len(hosts)} host(s) visible"}
    except HTTPException as e:
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"last_test_status": f"fail:{e.status_code}", "last_tested_at": now}},
        )
        return {"success": False, "message": str(e.detail)[:200]}


# ─────────────────────────── Normalization ───────────────────────────

def _norm_site(s: dict) -> dict:
    meta = s.get("meta") or {}
    stats = (s.get("statistics") or {}).get("counts") or {}
    counts = {
        "total_devices": stats.get("totalDevice", 0),
        "offline_devices": stats.get("offlineDevice", 0),
        "pending_devices": stats.get("pendingDevice", 0),
        "wlan_configured": stats.get("wlanConfigured", 0),
        "lan_configured": stats.get("lanConfigured", 0),
        "guest_clients": stats.get("guestClient", 0),
        "wifi_clients": stats.get("wifiClient", 0),
        "wired_clients": stats.get("wiredClient", 0),
        "critical_notifications": stats.get("criticalNotification", 0),
    }
    online = max(counts["total_devices"] - counts["offline_devices"], 0)
    total_clients = counts["wifi_clients"] + counts["wired_clients"] + counts["guest_clients"]
    internet = (s.get("statistics") or {}).get("internet") or {}
    return {
        "id": str(s.get("id") or s.get("siteId") or ""),
        "name": meta.get("desc") or meta.get("name") or s.get("internalReference") or s.get("id") or "",
        "internal_name": meta.get("name") or s.get("internalReference") or "",
        "host_id": s.get("hostId") or "",
        "is_owner": s.get("isOwner", False),
        "permission": s.get("permission") or "",
        "timezone": meta.get("timezone") or "",
        "gateway_mac": meta.get("gatewayMac") or "",
        "counts": counts,
        "devices_total": counts["total_devices"],
        "devices_online": online,
        "clients_total": total_clients,
        "alerts": counts["critical_notifications"],
        "internet": internet,
    }


def _norm_device(d: dict, host_id: str = "") -> dict:
    """Devices come from /v1/devices grouped under each host's `devices` array."""
    state = d.get("status") or d.get("state")
    if isinstance(state, int):
        state = "online" if state == 1 else "offline"
    if not state:
        # Some shapes use `connectionState`
        cs = d.get("connectionState") or {}
        state = cs.get("state") or "unknown"
    uptime = d.get("uptimeSec") or d.get("uptime") or 0
    return {
        "id": str(d.get("id") or d.get("_id") or d.get("mac") or ""),
        "mac": d.get("mac") or "",
        "name": d.get("name") or d.get("shortname") or d.get("model") or "",
        "model": d.get("model") or d.get("shortname") or d.get("productLine") or "",
        "type": d.get("productLine") or d.get("type") or "",
        "shortname": d.get("shortname") or "",
        "status": str(state).lower(),
        "ip": d.get("ip") or d.get("ipAddress") or "",
        "uptime": uptime,
        "firmware": d.get("version") or d.get("firmwareVersion") or "",
        "firmware_status": d.get("firmwareStatus") or "",
        "adopted": d.get("adopted", True) if "adopted" in d else True,
        "is_console": bool(d.get("isConsole", False)),
        "host_id": host_id or d.get("hostId") or "",
        "site_id": str(d.get("siteId") or ""),
        "startup_time": d.get("startupTime") or "",
        "note": d.get("note") or "",
    }


# ─────────────────────────── Data endpoints ───────────────────────────

@router.get("/unifi/hosts")
async def list_hosts(current_user: dict = Depends(get_current_user)):
    data = await _unifi_call("GET", "hosts")
    return _data(data)


@router.get("/unifi/sites")
async def list_sites(current_user: dict = Depends(get_current_user)):
    data = await _unifi_call("GET", "sites")
    return [_norm_site(s) for s in _data(data)]


async def _fetch_devices_for_host(host_id: str) -> list:
    """The /v1/devices response is grouped per host: [{ hostId, devices: [...] }]."""
    raw = await _unifi_call("GET", "devices", params={"hostIds[]": host_id})
    out = []
    for group in _data(raw):
        gid = group.get("hostId") or host_id
        for dev in group.get("devices") or []:
            out.append(_norm_device(dev, host_id=gid))
    return out


@router.get("/unifi/sites/{site_id}/devices")
async def list_site_devices(site_id: str, current_user: dict = Depends(get_current_user)):
    """Look up the host owning this site, fetch all its devices, then filter to this site."""
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    host_id = target.get("hostId")
    if not host_id:
        return []
    all_devs = await _fetch_devices_for_host(host_id)
    site_devs = [d for d in all_devs if not d.get("site_id") or str(d["site_id"]) == str(site_id)]
    return site_devs


@router.get("/unifi/hosts/{host_id}/devices")
async def list_host_devices(host_id: str, current_user: dict = Depends(get_current_user)):
    return await _fetch_devices_for_host(host_id)


@router.get("/unifi/sites/{site_id}/clients")
async def list_site_clients(site_id: str, current_user: dict = Depends(get_current_user)):
    """Site Manager API does not expose individual client objects. Return aggregate counts from site stats."""
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    counts = (target.get("statistics") or {}).get("counts") or {}
    summary = {
        "wifi": counts.get("wifiClient", 0),
        "wired": counts.get("wiredClient", 0),
        "guest": counts.get("guestClient", 0),
        "total": counts.get("wifiClient", 0) + counts.get("wiredClient", 0) + counts.get("guestClient", 0),
    }
    return {
        "supported": False,
        "summary": summary,
        "message": "Per-client detail is not exposed by the UniFi Site Manager API. Aggregate counts shown.",
        "items": [],
    }


@router.get("/unifi/sites/{site_id}/networks")
async def list_site_networks(site_id: str, current_user: dict = Depends(get_current_user)):
    """SSIDs are not enumerated by the Site Manager API. Return wlan/lan counts."""
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    counts = (target.get("statistics") or {}).get("counts") or {}
    return {
        "supported": False,
        "summary": {
            "wlan_configured": counts.get("wlanConfigured", 0),
            "lan_configured": counts.get("lanConfigured", 0),
        },
        "message": "Detailed SSID/VLAN list is only available from the on-controller Network API. Counts shown.",
        "items": [],
    }


@router.get("/unifi/sites/{site_id}/alerts")
async def list_site_alerts(site_id: str, current_user: dict = Depends(get_current_user)):
    """Site Manager API exposes only critical notification counts, not individual alerts."""
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    counts = (target.get("statistics") or {}).get("counts") or {}
    critical = counts.get("criticalNotification", 0)
    return {
        "supported": False,
        "summary": {"critical_notifications": critical},
        "message": "Individual alert objects are not exposed by the Site Manager API. Counts shown.",
        "items": [],
    }


# ─────────────────────────── Summary / dashboard ───────────────────────────

@router.get("/unifi/summary")
async def unifi_summary(current_user: dict = Depends(get_current_user)):
    """Aggregated summary across every site visible to the API key — no extra API calls beyond /sites."""
    cfg = await _get_config()
    if not cfg:
        return {"configured": False, "message": "UniFi not configured"}

    try:
        sites_raw = await _unifi_call("GET", "sites")
        sites = [_norm_site(s) for s in _data(sites_raw)]
    except HTTPException as e:
        return {"configured": True, "error": str(e.detail)[:200], "sites": []}

    total_devices = sum(s["devices_total"] for s in sites)
    online_devices = sum(s["devices_online"] for s in sites)
    total_clients = sum(s["clients_total"] for s in sites)
    total_alerts = sum(s["alerts"] for s in sites)

    site_rows = [{
        "id": s["id"],
        "name": s["name"],
        "host_id": s["host_id"],
        "devices": s["devices_total"],
        "devices_online": s["devices_online"],
        "clients": s["clients_total"],
        "alerts": s["alerts"],
    } for s in sites]
    # Sort: most devices first
    site_rows.sort(key=lambda x: x["devices"], reverse=True)

    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {"last_synced_at": now}},
    )

    linked = await db.clients.count_documents({"unifi_site_id": {"$exists": True, "$ne": ""}})
    total_clients_nx = await db.clients.count_documents({})

    return {
        "configured": True,
        "last_synced_at": now,
        "stats": {
            "sites": len(sites),
            "devices": total_devices,
            "devices_online": online_devices,
            "clients": total_clients,
            "alerts": total_alerts,
            "linked_clients": linked,
            "coverage_pct": round((linked / total_clients_nx) * 100, 1) if total_clients_nx else 0,
        },
        "sites": site_rows,
    }


# ─────────────────────────── Link UniFi site → NexusOps client ───────────────────────────

@router.post("/clients/{client_id}/link-unifi-site")
async def link_unifi_site(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    site_id = (data or {}).get("site_id")
    if not site_id:
        raise HTTPException(400, "site_id required")
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {
            "unifi_site_id": site_id,
            "unifi_site_name": (data or {}).get("site_name", ""),
            "unifi_host_id": (data or {}).get("host_id", ""),
            "unifi_linked_at": datetime.now(timezone.utc).isoformat(),
            "integrations.unifi": True,
        }},
    )
    return {"message": "UniFi site linked", "client_id": client_id, "site_id": site_id}


@router.delete("/clients/{client_id}/link-unifi-site")
async def unlink_unifi_site(client_id: str, current_user: dict = Depends(get_current_user)):
    await db.clients.update_one(
        {"id": client_id},
        {"$unset": {"unifi_site_id": "", "unifi_site_name": "", "unifi_host_id": "", "unifi_linked_at": ""},
         "$set": {"integrations.unifi": False}},
    )
    return {"message": "UniFi site unlinked"}


@router.get("/unifi/linked-clients")
async def list_linked_clients(current_user: dict = Depends(get_current_user)):
    cursor = db.clients.find(
        {"unifi_site_id": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "name": 1, "unifi_site_id": 1, "unifi_site_name": 1, "unifi_host_id": 1, "unifi_linked_at": 1},
    )
    return await cursor.to_list(1000)
