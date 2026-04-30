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


async def _unifi_call(method: str, path: str, params=None, json_body: Optional[dict] = None):
    """params can be a dict OR a list of (key, value) tuples to preserve `hostIds[]` literal brackets."""
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
                # Distinguish read-only key from totally invalid key
                body = (r.text or "").lower()
                if "read" in body or "write" in body or method != "GET":
                    raise HTTPException(403, "UniFi API key is read-only or lacks permission for this action")
                raise HTTPException(r.status_code, "UniFi auth failed — check API key")
            if r.status_code in (404, 405, 501):
                raise HTTPException(r.status_code, f"UniFi endpoint not available on this account: {r.text[:200]}")
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


async def _fetch_devices_for_host(host_id: str = "") -> list:
    """The /v1/devices response can be grouped per host: [{hostId, devices: [...]}] OR flat [device, ...].
    We try with hostIds[] filter first, then fall back to no filter."""
    out = []

    async def _ingest(raw):
        for item in _data(raw):
            if isinstance(item, dict) and isinstance(item.get("devices"), list):
                gid = item.get("hostId") or host_id
                for dev in item["devices"]:
                    out.append(_norm_device(dev, host_id=gid))
            elif isinstance(item, dict):
                # Flat device row
                out.append(_norm_device(item, host_id=item.get("hostId") or host_id))

    if host_id:
        try:
            # Pass as list-of-tuples so httpx keeps the literal `hostIds[]` brackets
            raw = await _unifi_call("GET", "devices", params=[("hostIds[]", host_id)])
            await _ingest(raw)
        except HTTPException:
            pass
    if not out:
        try:
            raw = await _unifi_call("GET", "devices")
            await _ingest(raw)
            if host_id:
                # Filter to this host if we got everything back
                out = [d for d in out if not d.get("host_id") or str(d["host_id"]) == str(host_id)]
        except HTTPException:
            pass
    return out


@router.get("/unifi/sites/{site_id}/devices")
async def list_site_devices(site_id: str, current_user: dict = Depends(get_current_user)):
    """Look up the host owning this site, fetch devices, then filter by site if available.
    Site Manager API doesn't always expose siteId on the device payload — when missing, we
    return all of the host's devices (better than returning empty)."""
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    host_id = target.get("hostId") or ""
    all_devs = await _fetch_devices_for_host(host_id)
    # Soft filter: if any device is tagged with this site, only return matches; otherwise return all
    tagged = [d for d in all_devs if str(d.get("site_id") or "") == str(site_id)]
    return tagged if tagged else all_devs


@router.get("/unifi/devices")
async def list_all_devices(current_user: dict = Depends(get_current_user)):
    """All devices visible to the API key — useful when Site Manager doesn't expose site->device mapping."""
    return await _fetch_devices_for_host("")


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


# ─────────────────────────── Device actions (restart / locate / power-cycle) ───────────────────────────
# The UniFi Site Manager API is officially read-only today. Ubiquiti has begun rolling out
# write endpoints — these handlers attempt the action and surface a clear message if your
# API key lacks write access yet. Track availability at https://unifi.ui.com/api.

async def _device_action(host_id: str, device_id: str, action: str, body: Optional[dict] = None):
    """Try several known endpoint shapes; return the first success or raise.
    Known shapes (varies by EA cohort):
      POST /v1/hosts/{hostId}/devices/{deviceId}/actions  body {action}
      POST /v1/devices/{deviceId}/actions                 body {action, hostId}
      POST /v1/devices/{deviceId}/{action}                no body
    """
    payload = {"action": action, **(body or {})}
    candidates = [
        ("POST", f"hosts/{host_id}/devices/{device_id}/actions", payload),
        ("POST", f"devices/{device_id}/actions", {**payload, "hostId": host_id}),
        ("POST", f"devices/{device_id}/{action}", None),
    ]
    last_err = None
    for method, path, p in candidates:
        try:
            return await _unifi_call(method, path, json_body=p)
        except HTTPException as e:
            last_err = e
            if e.status_code in (401, 403):
                raise  # auth/permission won't fix by trying another path
            continue
    raise last_err or HTTPException(501, "No supported action endpoint on this UniFi account")


@router.post("/unifi/devices/{device_id}/restart")
async def device_restart(device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    host_id = (data or {}).get("host_id", "")
    try:
        result = await _device_action(host_id, device_id, "restart", data)
        await db.unifi_actions.insert_one({
            "action": "restart", "device_id": device_id, "host_id": host_id,
            "by": current_user.get("name"), "timestamp": datetime.now(timezone.utc).isoformat(), "result": str(result)[:300],
        })
        return {"success": True, "message": "Restart issued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/unifi/devices/{device_id}/power-cycle")
async def device_power_cycle(device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Power-cycle a PoE port on the device. body: { host_id, port_idx? }"""
    host_id = (data or {}).get("host_id", "")
    try:
        result = await _device_action(host_id, device_id, "power-cycle", data)
        await db.unifi_actions.insert_one({
            "action": "power-cycle", "device_id": device_id, "host_id": host_id,
            "by": current_user.get("name"), "timestamp": datetime.now(timezone.utc).isoformat(), "result": str(result)[:300],
        })
        return {"success": True, "message": "Power-cycle issued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/unifi/devices/{device_id}/locate")
async def device_locate(device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Toggle the 'locate' LED-blink for the device. body: { host_id, enable?: bool }"""
    host_id = (data or {}).get("host_id", "")
    enable = (data or {}).get("enable", True)
    action = "locate" if enable else "locate-stop"
    try:
        result = await _device_action(host_id, device_id, action, data)
        await db.unifi_actions.insert_one({
            "action": action, "device_id": device_id, "host_id": host_id,
            "by": current_user.get("name"), "timestamp": datetime.now(timezone.utc).isoformat(), "result": str(result)[:300],
        })
        return {"success": True, "message": f"Locate {'on' if enable else 'off'}", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.get("/unifi/actions/log")
async def actions_log(current_user: dict = Depends(get_current_user)):
    rows = await db.unifi_actions.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    return rows

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
