"""
Tactical RMM (TRMM) integration.
Self-hosted RMM at user-supplied TRMM URL.
Auth: X-API-KEY header (TRMM API key generated at Settings → Global Settings → API Keys).
Docs: https://docs.tacticalrmm.com/api/

This module is fully wired but inert until /trmm/settings is configured.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
import httpx
import os

from app.database import db
from app.auth import get_current_user

router = APIRouter()

SETTINGS_KEY = "tactical_rmm"


async def _get_config() -> Optional[dict]:
    cfg = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not cfg or not cfg.get("api_key_full") or not cfg.get("base_url"):
        return None
    return cfg


async def _trmm_call(method: str, path: str, params=None, json_body: Optional[dict] = None):
    cfg = await _get_config()
    if not cfg:
        raise HTTPException(503, "Tactical RMM not configured")
    base = cfg["base_url"].rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    headers = {
        "X-API-KEY": cfg["api_key_full"],
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    verify = bool(cfg.get("verify_tls", True))
    try:
        async with httpx.AsyncClient(timeout=30, verify=verify) as client:
            r = await client.request(method, url, headers=headers, params=params, json=json_body)
            if r.status_code in (401, 403):
                raise HTTPException(r.status_code, "TRMM auth failed — check API key")
            if r.status_code == 404:
                raise HTTPException(404, f"TRMM endpoint not found: {r.text[:200]}")
            if r.status_code == 429:
                raise HTTPException(429, "TRMM rate limit hit")
            if r.status_code >= 400:
                raise HTTPException(r.status_code, f"TRMM API error: {r.text[:200]}")
            try:
                return r.json()
            except Exception:
                return {"raw": r.text}
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        raise HTTPException(502, f"TRMM request failed: {str(e)[:160]}")


def _data(resp):
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        for k in ("results", "data", "items"):
            if isinstance(resp.get(k), list):
                return resp[k]
    return []


# ─────────────────────────── Settings ───────────────────────────

@router.get("/trmm/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    cfg = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not cfg:
        return {"configured": False, "base_url": "", "api_key_preview": None, "verify_tls": True, "last_test_status": None, "last_tested_at": None, "last_synced_at": None}
    return {
        "configured": bool(cfg.get("api_key_full")),
        "base_url": cfg.get("base_url", ""),
        "api_key_preview": cfg.get("api_key_preview"),
        "verify_tls": cfg.get("verify_tls", True),
        "last_test_status": cfg.get("last_test_status"),
        "last_tested_at": cfg.get("last_tested_at"),
        "last_synced_at": cfg.get("last_synced_at"),
    }


@router.get("/trmm/status")
async def get_status(current_user: dict = Depends(get_current_user)):
    return await get_settings(current_user)


@router.post("/trmm/settings")
async def save_settings(data: dict, current_user: dict = Depends(get_current_user)):
    base_url = (data or {}).get("base_url", "").strip()
    api_key = (data or {}).get("api_key", "").strip()
    verify_tls = bool((data or {}).get("verify_tls", True))
    if not base_url or not api_key:
        raise HTTPException(400, "base_url and api_key required")
    preview = f"…{api_key[-4:]}" if len(api_key) >= 4 else "…"
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {
            "type": SETTINGS_KEY,
            "base_url": base_url.rstrip("/"),
            "api_key_full": api_key,
            "api_key_preview": preview,
            "verify_tls": verify_tls,
            "configured": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name"),
        }},
        upsert=True,
    )
    return {"message": "Tactical RMM settings saved"}


@router.delete("/trmm/settings")
async def delete_settings(current_user: dict = Depends(get_current_user)):
    await db.settings.delete_one({"type": SETTINGS_KEY})
    return {"message": "TRMM credentials removed"}


@router.get("/trmm/test")
async def test_connection(current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    if not cfg:
        return {"success": False, "message": "Not configured"}
    now = datetime.now(timezone.utc).isoformat()
    try:
        agents = await _trmm_call("GET", "agents/")
        cnt = len(_data(agents))
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"last_test_status": "ok", "last_tested_at": now}},
        )
        return {"success": True, "message": f"Connected · {cnt} agent(s) visible"}
    except HTTPException as e:
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"last_test_status": f"fail:{e.status_code}", "last_tested_at": now}},
        )
        return {"success": False, "message": str(e.detail)[:200]}


# ─────────────────────────── Normalization ───────────────────────────

def _norm_agent(a: dict) -> dict:
    state = "online" if a.get("status") in ("online", True, 1) else (a.get("status") or "offline")
    return {
        "id": str(a.get("agent_id") or a.get("id") or a.get("pk") or ""),
        "agent_id": a.get("agent_id") or "",
        "hostname": a.get("hostname") or "",
        "client": a.get("client") or a.get("client_name") or "",
        "site": a.get("site") or a.get("site_name") or "",
        "status": str(state).lower(),
        "operating_system": a.get("operating_system") or a.get("os") or "",
        "plat": a.get("plat") or a.get("platform") or "",
        "public_ip": a.get("public_ip") or "",
        "local_ips": a.get("local_ips") or "",
        "cpu_load": a.get("cpu_load") or 0,
        "used_ram": a.get("used_ram") or 0,
        "boot_time": a.get("boot_time") or "",
        "last_seen": a.get("last_seen") or "",
        "version": a.get("version") or "",
        "needs_reboot": bool(a.get("needs_reboot", False)),
        "checks_failing": a.get("checks_failing") or 0,
        "patches_pending": a.get("patches_pending") or 0,
        "logged_in_username": a.get("logged_in_username") or "",
        "alert_template": a.get("alert_template"),
    }


def _norm_client(c: dict) -> dict:
    return {
        "id": str(c.get("id") or c.get("pk") or ""),
        "name": c.get("name") or c.get("client") or "",
        "site_count": c.get("site_count") or 0,
        "agent_count": c.get("agent_count") or 0,
    }


# ─────────────────────────── Data endpoints ───────────────────────────

@router.get("/trmm/agents")
async def list_agents(current_user: dict = Depends(get_current_user)):
    raw = await _trmm_call("GET", "agents/")
    return [_norm_agent(a) for a in _data(raw)]


@router.get("/trmm/agents/{agent_id}")
async def get_agent(agent_id: str, current_user: dict = Depends(get_current_user)):
    raw = await _trmm_call("GET", f"agents/{agent_id}/")
    if isinstance(raw, dict) and not isinstance(raw.get("results"), list):
        return _norm_agent(raw)
    return raw


@router.get("/trmm/clients")
async def list_clients(current_user: dict = Depends(get_current_user)):
    raw = await _trmm_call("GET", "clients/")
    return [_norm_client(c) for c in _data(raw)]


@router.get("/trmm/checks")
async def list_checks(agent_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    path = f"agents/{agent_id}/checks/" if agent_id else "checks/"
    raw = await _trmm_call("GET", path)
    return _data(raw)


@router.get("/trmm/alerts")
async def list_alerts(current_user: dict = Depends(get_current_user)):
    raw = await _trmm_call("GET", "alerts/")
    return _data(raw)


@router.get("/trmm/summary")
async def trmm_summary(current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    if not cfg:
        return {"configured": False, "message": "Tactical RMM not configured", "stats": {"agents": 0, "online": 0, "offline": 0, "alerts": 0, "checks_failing": 0, "patches_pending": 0, "needs_reboot": 0}}
    try:
        agents = [_norm_agent(a) for a in _data(await _trmm_call("GET", "agents/"))]
    except HTTPException as e:
        return {"configured": True, "error": str(e.detail), "stats": {}}
    online = sum(1 for a in agents if a["status"] == "online")
    offline = len(agents) - online
    alerts_total = sum(a["checks_failing"] for a in agents)
    patches = sum(a["patches_pending"] for a in agents)
    needs_reboot = sum(1 for a in agents if a["needs_reboot"])
    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": SETTINGS_KEY}, {"$set": {"last_synced_at": now}})
    linked = await db.devices.count_documents({"trmm_agent_id": {"$exists": True, "$ne": ""}})
    return {
        "configured": True,
        "last_synced_at": now,
        "stats": {
            "agents": len(agents),
            "online": online,
            "offline": offline,
            "alerts": alerts_total,
            "patches_pending": patches,
            "needs_reboot": needs_reboot,
            "linked_devices": linked,
        },
        "agents": agents[:200],
    }


# ─────────────────────────── Actions ───────────────────────────

async def _audit(action: str, agent_id: str, by: str, result):
    await db.trmm_actions.insert_one({
        "action": action, "agent_id": agent_id, "by": by,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "result_preview": str(result)[:400],
    })


@router.post("/trmm/agents/{agent_id}/reboot")
async def agent_reboot(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        result = await _trmm_call("POST", f"agents/{agent_id}/reboot/")
        await _audit("reboot", agent_id, current_user.get("name"), result)
        return {"success": True, "message": "Reboot issued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/trmm/agents/{agent_id}/shutdown")
async def agent_shutdown(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        # TRMM exposes shutdown via the same shell exec
        result = await _trmm_call("POST", f"agents/{agent_id}/cmd/", json_body={"cmd": "shutdown /s /t 60", "shell": "cmd", "timeout": 60})
        await _audit("shutdown", agent_id, current_user.get("name"), result)
        return {"success": True, "message": "Shutdown command issued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/trmm/agents/{agent_id}/run-script")
async def agent_run_script(agent_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """body: { script_id?: int, command?: string, shell?: 'powershell'|'cmd'|'python'|'bash', timeout?: int, args?: list }"""
    try:
        if data.get("script_id"):
            payload = {
                "script": int(data["script_id"]),
                "args": data.get("args", []),
                "timeout": data.get("timeout", 90),
            }
            result = await _trmm_call("POST", f"agents/{agent_id}/runscript/", json_body=payload)
        else:
            payload = {
                "cmd": data.get("command", ""),
                "shell": data.get("shell", "powershell"),
                "timeout": data.get("timeout", 60),
            }
            result = await _trmm_call("POST", f"agents/{agent_id}/cmd/", json_body=payload)
        await _audit("run-script", agent_id, current_user.get("name"), result)
        return {"success": True, "message": "Script executed", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/trmm/agents/{agent_id}/run-checks")
async def agent_run_checks(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        result = await _trmm_call("POST", f"agents/{agent_id}/runchecks/")
        await _audit("run-checks", agent_id, current_user.get("name"), result)
        return {"success": True, "message": "Checks queued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.post("/trmm/agents/{agent_id}/install-patches")
async def agent_install_patches(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        result = await _trmm_call("POST", f"winupdate/{agent_id}/install/")
        await _audit("install-patches", agent_id, current_user.get("name"), result)
        return {"success": True, "message": "Patch install queued", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.get("/trmm/agents/{agent_id}/remote-url")
async def agent_remote_url(agent_id: str, current_user: dict = Depends(get_current_user)):
    """Returns the MeshCentral / TacticalRMM remote URL for this agent.
    TRMM exposes /agents/{id}/meshcentral/ which returns a one-time URL."""
    try:
        result = await _trmm_call("GET", f"agents/{agent_id}/meshcentral/")
        # Response usually contains { control: '...', terminal: '...', file: '...' }
        return {"success": True, "urls": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


@router.get("/trmm/actions/log")
async def actions_log(current_user: dict = Depends(get_current_user)):
    return await db.trmm_actions.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)


# ─────────────────────────── Device ↔ Agent linking ───────────────────────────

@router.post("/devices/{device_id}/link-trmm-agent")
async def link_trmm_agent(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    dev = await db.devices.find_one({"id": device_id}, {"_id": 0, "id": 1})
    if not dev:
        raise HTTPException(404, "Device not found")
    agent_id = (data or {}).get("agent_id")
    if not agent_id:
        raise HTTPException(400, "agent_id required")
    await db.devices.update_one(
        {"id": device_id},
        {"$set": {
            "trmm_agent_id": agent_id,
            "trmm_hostname": (data or {}).get("hostname", ""),
            "trmm_linked_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"message": "TRMM agent linked"}


@router.delete("/devices/{device_id}/link-trmm-agent")
async def unlink_trmm_agent(device_id: str, current_user: dict = Depends(get_current_user)):
    await db.devices.update_one(
        {"id": device_id},
        {"$unset": {"trmm_agent_id": "", "trmm_hostname": "", "trmm_linked_at": ""}},
    )
    return {"message": "TRMM agent unlinked"}


@router.get("/trmm/linked-devices")
async def list_linked_devices(current_user: dict = Depends(get_current_user)):
    cursor = db.devices.find(
        {"trmm_agent_id": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "name": 1, "trmm_agent_id": 1, "trmm_hostname": 1, "trmm_linked_at": 1, "client_name": 1},
    )
    return await cursor.to_list(1000)


# ─────────────────────────── Auto-link (hostname / IP matcher) ───────────────────────────

def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _agent_ips(agent: dict) -> list:
    ips = []
    pub = agent.get("public_ip") or ""
    if pub:
        ips.append(pub.strip())
    local = agent.get("local_ips") or ""
    if isinstance(local, str):
        for chunk in local.replace(",", " ").split():
            chunk = chunk.strip()
            if chunk and chunk not in ips:
                ips.append(chunk)
    elif isinstance(local, list):
        for chunk in local:
            if chunk and str(chunk) not in ips:
                ips.append(str(chunk).strip())
    return [i for i in ips if i]


@router.post("/trmm/auto-link")
async def auto_link_agents(data: Optional[dict] = None, current_user: dict = Depends(get_current_user)):
    """One-click matcher that pairs TRMM agents to NexusOps devices by hostname (case-insensitive) and IP.

    Body (optional): { "dry_run": bool, "overwrite": bool }
    - dry_run=true returns the proposed matches without persisting
    - overwrite=true re-links devices that already have a trmm_agent_id
    """
    cfg = await _get_config()
    if not cfg:
        raise HTTPException(503, "Tactical RMM not configured")
    body = data or {}
    dry_run = bool(body.get("dry_run", False))
    overwrite = bool(body.get("overwrite", False))

    raw_agents = await _trmm_call("GET", "agents/")
    agents = [_norm_agent(a) for a in _data(raw_agents)]

    devices = await db.devices.find(
        {}, {"_id": 0, "id": 1, "name": 1, "ip_address": 1, "hostname": 1, "trmm_agent_id": 1, "client_name": 1}
    ).to_list(5000)

    # Build lookup tables
    by_host = {}
    by_ip = {}
    for d in devices:
        for h in {_norm(d.get("name")), _norm(d.get("hostname"))}:
            if h:
                by_host.setdefault(h, []).append(d)
        ip = (d.get("ip_address") or "").strip()
        if ip:
            by_ip.setdefault(ip, []).append(d)

    matched, skipped, unmatched, ambiguous = [], [], [], []
    seen_device_ids = set()
    now = datetime.now(timezone.utc).isoformat()

    for ag in agents:
        ag_host = _norm(ag.get("hostname"))
        ag_ips = _agent_ips(ag)
        ag_id = ag.get("agent_id") or ag.get("id")
        if not ag_id:
            continue

        candidates = []
        # Try hostname first (highest confidence)
        if ag_host and ag_host in by_host:
            candidates = list(by_host[ag_host])
        # Then fall back to IP
        if not candidates:
            for ip in ag_ips:
                if ip in by_ip:
                    candidates.extend(by_ip[ip])
        # Dedupe by device id
        seen_ids = set()
        unique = []
        for c in candidates:
            if c["id"] not in seen_ids:
                seen_ids.add(c["id"])
                unique.append(c)

        if not unique:
            unmatched.append({"agent_id": ag_id, "hostname": ag.get("hostname"), "client": ag.get("client")})
            continue
        if len(unique) > 1:
            ambiguous.append({
                "agent_id": ag_id, "hostname": ag.get("hostname"),
                "candidates": [{"id": c["id"], "name": c["name"]} for c in unique],
            })
            continue

        dev = unique[0]
        if dev["id"] in seen_device_ids:
            skipped.append({"device_id": dev["id"], "agent_id": ag_id, "reason": "device already paired in this run"})
            continue
        existing = dev.get("trmm_agent_id")
        if existing and existing != ag_id and not overwrite:
            skipped.append({
                "device_id": dev["id"], "device_name": dev["name"],
                "agent_id": ag_id, "reason": f"already linked to {existing}",
            })
            continue
        if existing == ag_id:
            skipped.append({"device_id": dev["id"], "agent_id": ag_id, "reason": "already linked (no change)"})
            continue

        match_type = "hostname" if ag_host and ag_host == _norm(dev.get("name")) else (
            "hostname" if ag_host and ag_host == _norm(dev.get("hostname")) else "ip"
        )
        matched.append({
            "device_id": dev["id"], "device_name": dev["name"],
            "agent_id": ag_id, "agent_hostname": ag.get("hostname"),
            "client": ag.get("client") or dev.get("client_name"),
            "match_type": match_type,
        })
        seen_device_ids.add(dev["id"])

        if not dry_run:
            await db.devices.update_one(
                {"id": dev["id"]},
                {"$set": {
                    "trmm_agent_id": ag_id,
                    "trmm_hostname": ag.get("hostname") or "",
                    "trmm_linked_at": now,
                    "trmm_linked_by": current_user.get("name") or "auto-link",
                    "trmm_match_type": match_type,
                }},
            )

    if not dry_run and matched:
        await db.trmm_actions.insert_one({
            "action": "auto-link",
            "agent_id": f"{len(matched)}-pairs",
            "by": current_user.get("name"),
            "timestamp": now,
            "result_preview": f"matched={len(matched)} skipped={len(skipped)} ambiguous={len(ambiguous)} unmatched={len(unmatched)}",
        })

    return {
        "success": True,
        "dry_run": dry_run,
        "overwrite": overwrite,
        "stats": {
            "agents_total": len(agents),
            "devices_total": len(devices),
            "matched": len(matched),
            "skipped": len(skipped),
            "ambiguous": len(ambiguous),
            "unmatched": len(unmatched),
        },
        "matched": matched,
        "skipped": skipped,
        "ambiguous": ambiguous,
        "unmatched": unmatched[:50],
    }
