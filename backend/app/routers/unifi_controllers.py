"""
UniFi Network Integration API (per-controller).
Each controller stored in db.unifi_controllers. Calls go to:
  {controller_url}/proxy/network/integration/v1/sites/{network_site_id}/devices  etc.
Auth: X-API-KEY header. Requires UniFi Network 9.0+.
Generated at: UniFi Network → Settings → Control Plane → Integrations.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
import httpx
import uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()


async def _get_controller(controller_id: str) -> dict:
    c = await db.unifi_controllers.find_one({"id": controller_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Controller not found")
    return c


def _safe_url(url: str) -> str:
    return url.rstrip("/")


def _api_base(controller: dict) -> str:
    return f"{_safe_url(controller['controller_url'])}/proxy/network/integration/v1"


async def _net_call(controller: dict, method: str, path: str, json_body: Optional[dict] = None, params=None):
    """Call the per-controller Network Integration API."""
    url = f"{_api_base(controller)}/{path.lstrip('/')}"
    headers = {
        "X-API-KEY": controller["api_key"],
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    verify = bool(controller.get("verify_tls", True))
    try:
        async with httpx.AsyncClient(timeout=30, verify=verify) as client:
            r = await client.request(method, url, headers=headers, json=json_body, params=params)
            if r.status_code in (401, 403):
                raise HTTPException(r.status_code, "API auth failed — check controller URL and API key")
            if r.status_code == 404:
                raise HTTPException(404, f"Endpoint not found: {r.text[:200]}")
            if r.status_code >= 400:
                raise HTTPException(r.status_code, f"Network API error: {r.text[:200]}")
            try:
                return r.json()
            except Exception:
                return {"raw": r.text}
    except HTTPException:
        raise
    except httpx.ConnectError as e:
        raise HTTPException(502, f"Cannot reach controller — check URL/firewall: {str(e)[:160]}")
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Network API request failed: {str(e)[:160]}")


def _data(resp):
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        for k in ("data", "Data", "items"):
            if isinstance(resp.get(k), list):
                return resp[k]
    return []


# ─────────────────────────── CRUD ───────────────────────────

@router.get("/unifi/controllers")
async def list_controllers(current_user: dict = Depends(get_current_user)):
    rows = await db.unifi_controllers.find({}, {"_id": 0, "api_key": 0}).to_list(500)
    # Surface masked key
    for r in rows:
        full = await db.unifi_controllers.find_one({"id": r["id"]}, {"_id": 0, "api_key": 1})
        if full and full.get("api_key"):
            r["api_key_preview"] = f"…{full['api_key'][-4:]}"
    return rows


@router.post("/unifi/controllers")
async def create_controller(data: dict, current_user: dict = Depends(get_current_user)):
    name = (data or {}).get("name", "").strip()
    url = (data or {}).get("controller_url", "").strip()
    api_key = (data or {}).get("api_key", "").strip()
    network_site_id = (data or {}).get("network_site_id", "default").strip() or "default"
    verify_tls = bool((data or {}).get("verify_tls", True))
    notes = (data or {}).get("notes", "").strip()

    if not name or not url or not api_key:
        raise HTTPException(400, "name, controller_url, and api_key are required")

    cid = str(uuid.uuid4())
    doc = {
        "id": cid,
        "name": name,
        "controller_url": _safe_url(url),
        "api_key": api_key,
        "network_site_id": network_site_id,
        "verify_tls": verify_tls,
        "notes": notes,
        "client_id": (data or {}).get("client_id", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name"),
        "last_test_status": None,
        "last_tested_at": None,
        "last_synced_at": None,
    }
    await db.unifi_controllers.insert_one(doc)
    return {"message": "Controller added", "id": cid}


@router.put("/unifi/controllers/{controller_id}")
async def update_controller(controller_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.unifi_controllers.find_one({"id": controller_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Controller not found")
    updates = {}
    for k in ("name", "controller_url", "network_site_id", "notes", "client_id"):
        if k in (data or {}):
            updates[k] = (data[k] or "").strip() if isinstance(data[k], str) else data[k]
    if "verify_tls" in (data or {}):
        updates["verify_tls"] = bool(data["verify_tls"])
    if (data or {}).get("api_key"):
        updates["api_key"] = data["api_key"].strip()
    if "controller_url" in updates:
        updates["controller_url"] = _safe_url(updates["controller_url"])
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    updates["updated_by"] = current_user.get("name")
    await db.unifi_controllers.update_one({"id": controller_id}, {"$set": updates})
    return {"message": "Controller updated"}


@router.delete("/unifi/controllers/{controller_id}")
async def delete_controller(controller_id: str, current_user: dict = Depends(get_current_user)):
    await db.unifi_controllers.delete_one({"id": controller_id})
    return {"message": "Controller removed"}


@router.get("/unifi/controllers/{controller_id}/test")
async def test_controller(controller_id: str, current_user: dict = Depends(get_current_user)):
    c = await _get_controller(controller_id)
    now = datetime.now(timezone.utc).isoformat()
    try:
        sites = _data(await _net_call(c, "GET", "sites"))
        site_count = len(sites)
        await db.unifi_controllers.update_one(
            {"id": controller_id},
            {"$set": {"last_test_status": "ok", "last_tested_at": now}},
        )
        return {"success": True, "message": f"Connected · {site_count} site(s) on this controller", "sites": sites}
    except HTTPException as e:
        await db.unifi_controllers.update_one(
            {"id": controller_id},
            {"$set": {"last_test_status": f"fail:{e.status_code}", "last_tested_at": now}},
        )
        return {"success": False, "message": str(e.detail), "status": e.status_code}


# ─────────────────────────── Data passthrough ───────────────────────────

def _norm_net_device(d: dict) -> dict:
    state = d.get("state") or d.get("status") or "unknown"
    return {
        "id": str(d.get("id") or d.get("_id") or d.get("mac") or ""),
        "mac": d.get("macAddress") or d.get("mac") or "",
        "name": d.get("name") or d.get("model") or "",
        "model": d.get("model") or "",
        "type": d.get("type") or d.get("productLine") or "",
        "status": str(state).lower(),
        "ip": d.get("ipAddress") or d.get("ip") or "",
        "uptime": d.get("uptime") or 0,
        "firmware": d.get("firmwareVersion") or d.get("version") or "",
        "adopted": d.get("adopted", True) if "adopted" in d else True,
        "features": d.get("features") or {},
    }


def _norm_net_client(c: dict) -> dict:
    return {
        "id": str(c.get("id") or c.get("_id") or c.get("mac") or ""),
        "mac": c.get("macAddress") or c.get("mac") or "",
        "name": c.get("name") or c.get("hostname") or "",
        "ip": c.get("ipAddress") or c.get("ip") or "",
        "is_wired": not bool(c.get("isWireless", False)) if "isWireless" in c else bool(c.get("is_wired")),
        "network": c.get("connectedNetwork") or c.get("essid") or "",
        "uplink_mac": c.get("uplinkMac") or c.get("ap_mac") or "",
        "rx_bytes": c.get("rxBytes") or 0,
        "tx_bytes": c.get("txBytes") or 0,
        "signal": c.get("signalDbm") or c.get("rssi") or 0,
        "last_seen": c.get("lastSeen") or "",
        "manufacturer": c.get("manufacturer") or c.get("oui") or "",
    }


@router.get("/unifi/controllers/{controller_id}/devices")
async def get_devices(controller_id: str, current_user: dict = Depends(get_current_user)):
    c = await _get_controller(controller_id)
    site_id = c.get("network_site_id") or "default"
    raw = await _net_call(c, "GET", f"sites/{site_id}/devices")
    return [_norm_net_device(d) for d in _data(raw)]


@router.get("/unifi/controllers/{controller_id}/clients")
async def get_clients(controller_id: str, current_user: dict = Depends(get_current_user)):
    c = await _get_controller(controller_id)
    site_id = c.get("network_site_id") or "default"
    raw = await _net_call(c, "GET", f"sites/{site_id}/clients")
    return [_norm_net_client(x) for x in _data(raw)]


@router.get("/unifi/controllers/{controller_id}/sites")
async def get_network_sites(controller_id: str, current_user: dict = Depends(get_current_user)):
    """List sites visible on this controller (helps when picking network_site_id)."""
    c = await _get_controller(controller_id)
    raw = await _net_call(c, "GET", "sites")
    return _data(raw)


@router.get("/unifi/controllers/{controller_id}/summary")
async def controller_summary(controller_id: str, current_user: dict = Depends(get_current_user)):
    c = await _get_controller(controller_id)
    site_id = c.get("network_site_id") or "default"
    devices, clients = [], []
    error = None
    try:
        devices = [_norm_net_device(d) for d in _data(await _net_call(c, "GET", f"sites/{site_id}/devices"))]
    except HTTPException as e:
        error = str(e.detail)
    try:
        clients = [_norm_net_client(x) for x in _data(await _net_call(c, "GET", f"sites/{site_id}/clients"))]
    except HTTPException as e:
        if not error:
            error = str(e.detail)
    online = sum(1 for d in devices if d["status"] in ("online", "connected"))
    now = datetime.now(timezone.utc).isoformat()
    await db.unifi_controllers.update_one({"id": controller_id}, {"$set": {"last_synced_at": now}})
    return {
        "controller": {"id": c["id"], "name": c["name"], "controller_url": c["controller_url"], "network_site_id": site_id},
        "stats": {
            "devices": len(devices),
            "devices_online": online,
            "clients": len(clients),
            "wifi_clients": sum(1 for x in clients if not x["is_wired"]),
            "wired_clients": sum(1 for x in clients if x["is_wired"]),
        },
        "devices": devices,
        "clients": clients,
        "last_synced_at": now,
        "error": error,
    }


# ─────────────────────────── Actions ───────────────────────────

async def _device_action(controller: dict, device_id: str, action: str, extra: Optional[dict] = None):
    site_id = controller.get("network_site_id") or "default"
    body = {"action": action}
    if extra:
        body.update(extra)
    return await _net_call(controller, "POST", f"sites/{site_id}/devices/{device_id}/actions", json_body=body)


@router.post("/unifi/controllers/{controller_id}/devices/{device_id}/restart")
async def device_restart(controller_id: str, device_id: str, current_user: dict = Depends(get_current_user)):
    c = await _get_controller(controller_id)
    try:
        result = await _device_action(c, device_id, "RESTART")
        await db.unifi_actions.insert_one({
            "controller_id": controller_id, "device_id": device_id, "action": "RESTART",
            "by": current_user.get("name"), "timestamp": datetime.now(timezone.utc).isoformat(), "result": str(result)[:300],
        })
        return {"success": True, "message": "Restart issued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/unifi/controllers/{controller_id}/devices/{device_id}/locate")
async def device_locate(controller_id: str, device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    c = await _get_controller(controller_id)
    enable = (data or {}).get("enable", True)
    action = "LOCATE" if enable else "LOCATE_STOP"
    try:
        result = await _device_action(c, device_id, action)
        await db.unifi_actions.insert_one({
            "controller_id": controller_id, "device_id": device_id, "action": action,
            "by": current_user.get("name"), "timestamp": datetime.now(timezone.utc).isoformat(), "result": str(result)[:300],
        })
        return {"success": True, "message": f"Locate {'on' if enable else 'off'}", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/unifi/controllers/{controller_id}/devices/{device_id}/power-cycle")
async def device_power_cycle(controller_id: str, device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Power-cycle a PoE port. body: {port_idx?: int}"""
    c = await _get_controller(controller_id)
    extra = {}
    if (data or {}).get("port_idx") is not None:
        extra["portIdx"] = int(data["port_idx"])
    try:
        result = await _device_action(c, device_id, "POWER_CYCLE", extra)
        await db.unifi_actions.insert_one({
            "controller_id": controller_id, "device_id": device_id, "action": "POWER_CYCLE",
            "extra": extra, "by": current_user.get("name"),
            "timestamp": datetime.now(timezone.utc).isoformat(), "result": str(result)[:300],
        })
        return {"success": True, "message": "Power-cycle issued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}
