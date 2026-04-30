"""
UniFi Site Manager API (hosted by Ubiquiti at api.ui.com) integration.
Auth: X-API-KEY header.
Docs: https://developer.ui.com/site-manager-api/
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
import httpx
import os

from app.database import db
from app.auth import get_current_user

router = APIRouter()

SETTINGS_KEY = "unifi"
DEFAULT_BASE_URL = "https://api.ui.com/ea"  # Early Access path; /v1 also works for some accounts


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
        "Content-Type": "application/json",
    }
    verify = os.environ.get("ALLOW_SELF_SIGNED_CERTS", "false").lower() != "true"
    try:
        async with httpx.AsyncClient(timeout=30, verify=verify) as client:
            r = await client.request(method, url, headers=headers, params=params, json=json_body)
            if r.status_code == 401 or r.status_code == 403:
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


def _unwrap(data):
    """UniFi responses are often {data: [...]} or {sites: [...]} or just [...]."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("data", "sites", "hosts", "devices", "clients", "alerts", "networks", "events", "Results", "items"):
            if isinstance(data.get(k), list):
                return data[k]
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
    """Alias of /unifi/settings for parity with other integrations."""
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
        hosts = _unwrap(data)
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
    return {
        "id": str(s.get("id") or s.get("siteId") or s.get("site_id") or s.get("_id") or ""),
        "name": s.get("desc") or s.get("name") or s.get("displayName") or s.get("internalName") or "",
        "host_id": s.get("hostId") or s.get("host_id") or s.get("host") or "",
        "internal_name": s.get("internalName") or s.get("internal_name") or "",
        "status": s.get("status") or s.get("health") or "unknown",
        "meta": {k: v for k, v in s.items() if k not in ("id", "name", "desc", "_id")},
    }


def _norm_device(d: dict) -> dict:
    state = d.get("state") or d.get("status")
    if isinstance(state, int):
        state = "online" if state == 1 else "offline"
    return {
        "id": str(d.get("id") or d.get("_id") or d.get("mac") or ""),
        "mac": d.get("mac") or "",
        "name": d.get("name") or d.get("hostname") or d.get("model") or "",
        "model": d.get("model") or d.get("type") or "",
        "type": d.get("type") or d.get("deviceType") or "",
        "status": (state or "unknown"),
        "ip": d.get("ip") or d.get("lanIp") or "",
        "uptime": d.get("uptime") or 0,
        "firmware": d.get("version") or d.get("firmware") or "",
        "adopted": d.get("adopted", True),
        "site_id": str(d.get("siteId") or d.get("site_id") or ""),
        "last_seen": d.get("last_seen") or d.get("lastSeen") or "",
        "num_clients": d.get("num_sta") or d.get("numClients") or 0,
    }


def _norm_client(c: dict) -> dict:
    return {
        "id": str(c.get("id") or c.get("_id") or c.get("mac") or ""),
        "mac": c.get("mac") or "",
        "name": c.get("name") or c.get("hostname") or c.get("displayName") or "",
        "ip": c.get("ip") or c.get("fixed_ip") or "",
        "is_wired": bool(c.get("is_wired") or c.get("isWired")),
        "network": c.get("network") or c.get("essid") or "",
        "ap_mac": c.get("ap_mac") or c.get("apMac") or "",
        "rx_bytes": c.get("rx_bytes") or 0,
        "tx_bytes": c.get("tx_bytes") or 0,
        "signal": c.get("signal") or c.get("rssi") or 0,
        "last_seen": c.get("last_seen") or c.get("lastSeen") or "",
        "first_seen": c.get("first_seen") or c.get("firstSeen") or "",
        "manufacturer": c.get("oui") or c.get("manufacturer") or "",
    }


def _norm_alert(a: dict) -> dict:
    return {
        "id": str(a.get("id") or a.get("_id") or ""),
        "type": a.get("type") or a.get("key") or "",
        "severity": a.get("severity") or ("critical" if a.get("archived") is False else "info"),
        "message": a.get("msg") or a.get("message") or a.get("description") or "",
        "timestamp": a.get("time") or a.get("timestamp") or a.get("datetime") or "",
        "archived": a.get("archived", False),
        "site_id": str(a.get("site_id") or a.get("siteId") or ""),
    }


# ─────────────────────────── Data endpoints ───────────────────────────

@router.get("/unifi/hosts")
async def list_hosts(current_user: dict = Depends(get_current_user)):
    data = await _unifi_call("GET", "hosts")
    return _unwrap(data)


@router.get("/unifi/sites")
async def list_sites(current_user: dict = Depends(get_current_user)):
    data = await _unifi_call("GET", "sites")
    sites = [_norm_site(s) for s in _unwrap(data)]
    return sites


@router.get("/unifi/sites/{site_id}/devices")
async def list_site_devices(site_id: str, current_user: dict = Depends(get_current_user)):
    # Many Site Manager implementations use hostId-prefixed device endpoints
    try:
        data = await _unifi_call("GET", f"sites/{site_id}/devices")
    except HTTPException:
        # Fallback: some revisions expose /devices?siteId=
        data = await _unifi_call("GET", "devices", params={"siteId": site_id})
    return [_norm_device(d) for d in _unwrap(data)]


@router.get("/unifi/sites/{site_id}/clients")
async def list_site_clients(site_id: str, current_user: dict = Depends(get_current_user)):
    try:
        data = await _unifi_call("GET", f"sites/{site_id}/clients")
    except HTTPException:
        data = await _unifi_call("GET", "clients", params={"siteId": site_id})
    return [_norm_client(c) for c in _unwrap(data)]


@router.get("/unifi/sites/{site_id}/alerts")
async def list_site_alerts(site_id: str, current_user: dict = Depends(get_current_user)):
    try:
        data = await _unifi_call("GET", f"sites/{site_id}/alerts")
    except HTTPException:
        data = await _unifi_call("GET", "alerts", params={"siteId": site_id})
    alerts = [_norm_alert(a) for a in _unwrap(data)]
    # Most-recent first when timestamps present
    alerts.sort(key=lambda x: str(x.get("timestamp", "")), reverse=True)
    return alerts


@router.get("/unifi/sites/{site_id}/networks")
async def list_site_networks(site_id: str, current_user: dict = Depends(get_current_user)):
    try:
        data = await _unifi_call("GET", f"sites/{site_id}/networks")
    except HTTPException:
        data = await _unifi_call("GET", "networks", params={"siteId": site_id})
    nets = _unwrap(data)
    return [{
        "id": str(n.get("id") or n.get("_id") or ""),
        "name": n.get("name") or n.get("ssid") or "",
        "ssid": n.get("ssid") or n.get("name") or "",
        "enabled": n.get("enabled", True),
        "security": n.get("security") or n.get("x_passphrase_mode") or "",
        "num_clients": n.get("num_sta") or 0,
        "vlan": n.get("vlan") or n.get("vlan_id") or "",
    } for n in nets]


@router.get("/unifi/sites/{site_id}/events")
async def list_site_events(site_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)):
    try:
        data = await _unifi_call("GET", f"sites/{site_id}/events", params={"limit": limit})
    except HTTPException:
        data = await _unifi_call("GET", "events", params={"siteId": site_id, "limit": limit})
    return _unwrap(data)[:limit]


# ─────────────────────────── Summary / dashboard ───────────────────────────

@router.get("/unifi/summary")
async def unifi_summary(current_user: dict = Depends(get_current_user)):
    """Aggregated summary across every site visible to the API key."""
    cfg = await _get_config()
    if not cfg:
        return {"configured": False, "message": "UniFi not configured"}

    try:
        sites_raw = await _unifi_call("GET", "sites")
        sites = [_norm_site(s) for s in _unwrap(sites_raw)]
    except HTTPException as e:
        return {"configured": True, "error": str(e.detail)[:200], "sites": []}

    total_devices = 0
    online_devices = 0
    total_clients = 0
    total_alerts = 0
    site_rows = []
    for s in sites[:100]:
        devs = []
        clients = []
        alerts = []
        try:
            devs = [_norm_device(d) for d in _unwrap(await _unifi_call("GET", f"sites/{s['id']}/devices"))]
        except Exception:
            pass
        try:
            clients = [_norm_client(c) for c in _unwrap(await _unifi_call("GET", f"sites/{s['id']}/clients"))]
        except Exception:
            pass
        try:
            alerts = [_norm_alert(a) for a in _unwrap(await _unifi_call("GET", f"sites/{s['id']}/alerts"))]
            alerts = [a for a in alerts if not a.get("archived")]
        except Exception:
            pass

        online = sum(1 for d in devs if d["status"] in ("online", "1", "connected"))
        total_devices += len(devs)
        online_devices += online
        total_clients += len(clients)
        total_alerts += len(alerts)

        site_rows.append({
            "id": s["id"],
            "name": s["name"],
            "host_id": s["host_id"],
            "devices": len(devs),
            "devices_online": online,
            "clients": len(clients),
            "alerts": len(alerts),
        })

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
