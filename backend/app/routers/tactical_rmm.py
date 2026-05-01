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
    """body: { script_id?: int, command?: string, shell?: 'powershell'|'cmd'|'python'|'bash', timeout?: int, args?: list, cwd?: str, label?: str }

    Captures stdout/stderr/exit_code into db.trmm_runs so the UI can render a
    scrollback buffer even though the TRMM REST API is request/response (not
    a true PTY).
    """
    import uuid as _uuid
    run_id = f"trmm-run-{_uuid.uuid4().hex[:10]}"
    started = datetime.now(timezone.utc)
    label = (data or {}).get("label") or ""
    shell = (data or {}).get("shell", "powershell")
    cmd_preview = (data or {}).get("command") or f"script_id={data.get('script_id')}"

    base_doc = {
        "id": run_id,
        "agent_id": agent_id,
        "by": current_user.get("name"),
        "started_at": started.isoformat(),
        "shell": shell,
        "command": cmd_preview[:2000],
        "label": label[:120],
        "status": "running",
    }
    await db.trmm_runs.insert_one(base_doc)

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
                "shell": shell,
                "timeout": data.get("timeout", 60),
            }
            result = await _trmm_call("POST", f"agents/{agent_id}/cmd/", json_body=payload)

        # TRMM returns either a string of output, or { stdout, stderr, retcode }.
        stdout, stderr, retcode = "", "", None
        if isinstance(result, dict):
            stdout = str(result.get("stdout") or result.get("output") or result.get("raw") or "")
            stderr = str(result.get("stderr") or "")
            retcode = result.get("retcode")
        elif isinstance(result, str):
            stdout = result
        elif isinstance(result, list):
            stdout = "\n".join(str(x) for x in result)

        finished = datetime.now(timezone.utc)
        await db.trmm_runs.update_one({"id": run_id}, {"$set": {
            "stdout": stdout[:200000],
            "stderr": stderr[:60000],
            "retcode": retcode,
            "finished_at": finished.isoformat(),
            "duration_ms": int((finished - started).total_seconds() * 1000),
            "status": "failed" if (retcode not in (None, 0) or stderr) else "ok",
        }})
        await _audit("run-script", agent_id, current_user.get("name"), result)
        return {
            "success": True,
            "run_id": run_id,
            "stdout": stdout,
            "stderr": stderr,
            "retcode": retcode,
            "duration_ms": int((finished - started).total_seconds() * 1000),
            "result": result,
        }
    except HTTPException as e:
        await db.trmm_runs.update_one({"id": run_id}, {"$set": {
            "stderr": str(e.detail)[:4000],
            "retcode": None,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "status": "error",
        }})
        return {"success": False, "run_id": run_id, "message": str(e.detail), "status": e.status_code}


@router.get("/trmm/agents/{agent_id}/runs")
async def agent_runs(agent_id: str, limit: int = 50, current_user: dict = Depends(get_current_user)):
    return await db.trmm_runs.find({"agent_id": agent_id}, {"_id": 0}).sort("started_at", -1).to_list(limit)


@router.get("/trmm/runs/{run_id}")
async def run_detail(run_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.trmm_runs.find_one({"id": run_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Run not found")
    return doc


# ─────────────────────────── Scripts library ───────────────────────────

@router.get("/trmm/scripts")
async def list_scripts(current_user: dict = Depends(get_current_user)):
    raw = await _trmm_call("GET", "scripts/")
    items = _data(raw)
    norm = []
    for s in items:
        norm.append({
            "id": s.get("id") or s.get("pk"),
            "name": s.get("name") or "",
            "description": s.get("description") or "",
            "shell": s.get("shell") or "powershell",
            "category": s.get("category") or "",
            "favorite": bool(s.get("favorite", False)),
            "default_timeout": s.get("default_timeout") or 90,
            "args": s.get("args") or [],
            "script_type": s.get("script_type") or "",
            "syntax": s.get("syntax") or "",
            "filename": s.get("filename") or "",
            "tags": s.get("tags") or [],
        })
    return norm


@router.get("/trmm/scripts/{script_id}")
async def get_script_detail(script_id: int, current_user: dict = Depends(get_current_user)):
    raw = await _trmm_call("GET", f"scripts/{script_id}/")
    if not isinstance(raw, dict):
        raise HTTPException(502, "Unexpected TRMM response")
    return {
        "id": raw.get("id") or raw.get("pk"),
        "name": raw.get("name") or "",
        "description": raw.get("description") or "",
        "shell": raw.get("shell") or "powershell",
        "category": raw.get("category") or "",
        "default_timeout": raw.get("default_timeout") or 90,
        "args": raw.get("args") or [],
        "script_body": raw.get("script_body") or raw.get("code") or "",
        "script_type": raw.get("script_type") or "",
        "filename": raw.get("filename") or "",
        "tags": raw.get("tags") or [],
    }


@router.post("/trmm/scripts/{script_id}/favorite")
async def toggle_script_favorite(script_id: int, data: dict, current_user: dict = Depends(get_current_user)):
    """Local favorites (stored in NexusOps, not TRMM) for quick-access scripts per user."""
    fav = bool((data or {}).get("favorite", True))
    user = current_user.get("name") or "unknown"
    if fav:
        await db.trmm_script_favorites.update_one(
            {"user": user, "script_id": script_id},
            {"$set": {"user": user, "script_id": script_id, "added_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
    else:
        await db.trmm_script_favorites.delete_one({"user": user, "script_id": script_id})
    return {"success": True, "favorite": fav}


@router.get("/trmm/scripts/favorites/mine")
async def my_script_favorites(current_user: dict = Depends(get_current_user)):
    user = current_user.get("name") or "unknown"
    docs = await db.trmm_script_favorites.find({"user": user}, {"_id": 0}).to_list(200)
    return [d["script_id"] for d in docs]


# ─────────────────────────── Services ───────────────────────────

@router.get("/trmm/agents/{agent_id}/services")
async def agent_services(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        raw = await _trmm_call("GET", f"agents/{agent_id}/services/")
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "services": []}
    items = _data(raw) or (raw if isinstance(raw, list) else [])
    norm = []
    for s in items:
        norm.append({
            "name": s.get("name") or s.get("ServiceName") or "",
            "display_name": s.get("display_name") or s.get("DisplayName") or s.get("name") or "",
            "status": (s.get("status") or s.get("Status") or "").lower(),
            "start_type": s.get("start_type") or s.get("StartType") or "",
            "description": s.get("description") or s.get("Description") or "",
            "pid": s.get("pid") or s.get("Pid") or 0,
            "username": s.get("username") or s.get("UserName") or "",
        })
    return {"success": True, "services": norm}


@router.post("/trmm/agents/{agent_id}/services/{service_name}/{action}")
async def agent_service_action(agent_id: str, service_name: str, action: str, current_user: dict = Depends(get_current_user)):
    if action not in {"start", "stop", "restart"}:
        raise HTTPException(400, "action must be start|stop|restart")
    try:
        result = await _trmm_call("POST", f"services/{agent_id}/{service_name}/{action}/")
        await _audit(f"svc-{action}", agent_id, current_user.get("name"), f"{service_name}: {str(result)[:200]}")
        return {"success": True, "message": f"{action} queued for {service_name}", "result": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


# ─────────────────────────── Processes ───────────────────────────

@router.get("/trmm/agents/{agent_id}/processes")
async def agent_processes(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        raw = await _trmm_call("GET", f"agents/{agent_id}/processes/")
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "processes": []}
    items = _data(raw) or (raw if isinstance(raw, list) else [])
    norm = []
    for p in items:
        norm.append({
            "pid": p.get("pid") or p.get("Pid") or 0,
            "name": p.get("name") or p.get("Name") or "",
            "cpu_percent": p.get("cpu_percent") or p.get("CpuPercent") or 0,
            "mem_mb": p.get("mem_mb") or round((p.get("MemoryUsage") or 0) / (1024 * 1024), 1) if p.get("MemoryUsage") else (p.get("mem_mb") or 0),
            "username": p.get("username") or p.get("UserName") or "",
        })
    return {"success": True, "processes": norm}


@router.post("/trmm/agents/{agent_id}/processes/{pid}/kill")
async def kill_process(agent_id: str, pid: int, current_user: dict = Depends(get_current_user)):
    try:
        result = await _trmm_call("POST", f"agents/{agent_id}/processes/{pid}/")
        await _audit("kill-process", agent_id, current_user.get("name"), f"pid={pid}: {str(result)[:200]}")
        return {"success": True, "message": f"Killed pid {pid}"}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


# ─────────────────────────── Software inventory & Patches ───────────────────────────

@router.get("/trmm/agents/{agent_id}/software")
async def agent_software(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        raw = await _trmm_call("GET", f"software/{agent_id}/")
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "software": []}
    items = _data(raw) or (raw if isinstance(raw, list) else (raw.get("software", []) if isinstance(raw, dict) else []))
    norm = []
    for s in items:
        norm.append({
            "name": s.get("name") or s.get("DisplayName") or "",
            "version": s.get("version") or s.get("DisplayVersion") or "",
            "publisher": s.get("publisher") or s.get("Publisher") or "",
            "install_date": s.get("install_date") or s.get("InstallDate") or "",
        })
    return {"success": True, "software": norm}


@router.get("/trmm/agents/{agent_id}/winupdates")
async def agent_winupdates(agent_id: str, current_user: dict = Depends(get_current_user)):
    try:
        raw = await _trmm_call("GET", f"winupdate/{agent_id}/")
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "updates": []}
    items = _data(raw) or (raw if isinstance(raw, list) else [])
    norm = []
    for u in items:
        norm.append({
            "guid": u.get("guid") or u.get("id") or "",
            "kb": u.get("kb") or "",
            "title": u.get("title") or "",
            "severity": u.get("severity") or "",
            "installed": bool(u.get("installed", False)),
            "downloaded": bool(u.get("downloaded", False)),
            "date_installed": u.get("date_installed") or "",
        })
    return {"success": True, "updates": norm}


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


# ─────────────────────────── Multi-agent broadcast ───────────────────────────
# Run one command or script against many agents concurrently. Each agent's
# execution is persisted as a regular `trmm_runs` entry (so it shows up in the
# per-agent workspace) PLUS a broadcast document that links them together.
# The UI polls GET /api/trmm/broadcasts/{id} for live progress.

import asyncio as _asyncio
import uuid as _uuid


async def _execute_broadcast_one(agent_id: str, shell: str, command: str, script_id: Optional[int],
                                  args: list, timeout: int, label: str, user_name: str, broadcast_id: str) -> dict:
    run_id = f"trmm-run-{_uuid.uuid4().hex[:10]}"
    started = datetime.now(timezone.utc)
    await db.trmm_runs.insert_one({
        "id": run_id,
        "agent_id": agent_id,
        "by": user_name,
        "started_at": started.isoformat(),
        "shell": shell,
        "command": (command or f"script_id={script_id}")[:2000],
        "label": label[:120],
        "broadcast_id": broadcast_id,
        "status": "running",
    })
    try:
        if script_id:
            payload = {"script": int(script_id), "args": args, "timeout": timeout}
            result = await _trmm_call("POST", f"agents/{agent_id}/runscript/", json_body=payload)
        else:
            payload = {"cmd": command, "shell": shell, "timeout": timeout}
            result = await _trmm_call("POST", f"agents/{agent_id}/cmd/", json_body=payload)

        stdout, stderr, retcode = "", "", None
        if isinstance(result, dict):
            stdout = str(result.get("stdout") or result.get("output") or result.get("raw") or "")
            stderr = str(result.get("stderr") or "")
            retcode = result.get("retcode")
        elif isinstance(result, str):
            stdout = result
        elif isinstance(result, list):
            stdout = "\n".join(str(x) for x in result)

        finished = datetime.now(timezone.utc)
        status = "failed" if (retcode not in (None, 0) or stderr) else "ok"
        await db.trmm_runs.update_one({"id": run_id}, {"$set": {
            "stdout": stdout[:200000], "stderr": stderr[:60000], "retcode": retcode,
            "finished_at": finished.isoformat(),
            "duration_ms": int((finished - started).total_seconds() * 1000),
            "status": status,
        }})
        return {
            "agent_id": agent_id, "run_id": run_id, "status": status, "retcode": retcode,
            "duration_ms": int((finished - started).total_seconds() * 1000),
            "stdout_preview": stdout[:500], "stderr_preview": stderr[:500],
        }
    except HTTPException as e:
        await db.trmm_runs.update_one({"id": run_id}, {"$set": {
            "stderr": str(e.detail)[:4000], "retcode": None,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "status": "error",
        }})
        return {"agent_id": agent_id, "run_id": run_id, "status": "error", "message": str(e.detail)}
    except Exception as e:
        await db.trmm_runs.update_one({"id": run_id}, {"$set": {
            "stderr": str(e)[:4000], "retcode": None,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "status": "error",
        }})
        return {"agent_id": agent_id, "run_id": run_id, "status": "error", "message": str(e)}


async def _run_broadcast(broadcast_id: str, agent_ids: list, shell: str, command: str,
                         script_id: Optional[int], args: list, timeout: int, label: str,
                         user_name: str, concurrency: int = 8):
    """Background task. Updates db.trmm_broadcasts.agent_results as each agent finishes."""
    sem = _asyncio.Semaphore(concurrency)

    async def _worker(aid: str):
        async with sem:
            res = await _execute_broadcast_one(aid, shell, command, script_id, args, timeout, label, user_name, broadcast_id)
            await db.trmm_broadcasts.update_one(
                {"id": broadcast_id},
                {
                    "$set": {f"agent_map.{aid}": res},
                    "$inc": {"completed": 1, ("succeeded" if res.get("status") == "ok" else "failed_count"): 1},
                }
            )
            return res

    tasks = [_worker(aid) for aid in agent_ids]
    await _asyncio.gather(*tasks, return_exceptions=True)
    await db.trmm_broadcasts.update_one(
        {"id": broadcast_id},
        {"$set": {"status": "complete", "completed_at": datetime.now(timezone.utc).isoformat()}}
    )
    # Push Slack/Teams summary (best-effort, never raises)
    try:
        await _send_broadcast_notification(broadcast_id)
    except Exception:
        pass


@router.post("/trmm/broadcast")
async def start_broadcast(data: dict, current_user: dict = Depends(get_current_user)):
    """Kick off a concurrent run across many TRMM agents.

    body: {
        agent_ids: [str],
        command?: str,
        script_id?: int,
        args?: list,
        shell?: 'powershell'|'cmd'|'bash'|'python',
        timeout?: int,
        label?: str,
        concurrency?: int  (default 8, clamped to 1..20)
    }
    """
    cfg = await _get_config()
    if not cfg:
        raise HTTPException(503, "Tactical RMM not configured")

    agent_ids = [a for a in (data.get("agent_ids") or []) if a]
    if not agent_ids:
        raise HTTPException(400, "agent_ids is required")
    if len(agent_ids) > 200:
        raise HTTPException(400, "Too many agents (max 200)")
    command = (data.get("command") or "").strip()
    script_id = data.get("script_id")
    if not command and not script_id:
        raise HTTPException(400, "Provide a command or script_id")
    shell = data.get("shell", "powershell")
    timeout = int(data.get("timeout", 60))
    label = (data.get("label") or (f"broadcast · {command[:50]}" if command else f"broadcast · script {script_id}"))[:160]
    concurrency = max(1, min(20, int(data.get("concurrency", 8))))

    broadcast_id = f"bcast-{_uuid.uuid4().hex[:12]}"
    doc = {
        "id": broadcast_id,
        "agent_ids": agent_ids,
        "total": len(agent_ids),
        "completed": 0,
        "succeeded": 0,
        "failed_count": 0,
        "shell": shell,
        "command": command[:4000],
        "script_id": script_id,
        "args": (data.get("args") or [])[:32],
        "timeout": timeout,
        "label": label,
        "concurrency": concurrency,
        "status": "running",
        "by": current_user.get("name") or "unknown",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "agent_map": {aid: {"agent_id": aid, "status": "queued"} for aid in agent_ids},
    }
    await db.trmm_broadcasts.insert_one(doc)
    doc.pop("_id", None)

    await _audit("broadcast", f"{len(agent_ids)}-agents", current_user.get("name"), label)

    # Fire-and-forget background execution
    _asyncio.create_task(_run_broadcast(
        broadcast_id, agent_ids, shell, command, script_id,
        data.get("args") or [], timeout, label, current_user.get("name") or "unknown", concurrency,
    ))

    return {"success": True, "broadcast_id": broadcast_id, "total": len(agent_ids)}


@router.get("/trmm/broadcasts/{broadcast_id}")
async def broadcast_status(broadcast_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.trmm_broadcasts.find_one({"id": broadcast_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Broadcast not found")
    # Flatten agent_map dict -> list for UI rendering convenience
    amap = doc.get("agent_map") or {}
    doc["agents"] = [amap.get(aid, {"agent_id": aid, "status": "queued"}) for aid in doc.get("agent_ids", [])]
    return doc


@router.get("/trmm/broadcasts")
async def list_broadcasts(limit: int = 20, current_user: dict = Depends(get_current_user)):
    cursor = db.trmm_broadcasts.find({}, {"_id": 0, "agent_map": 0}).sort("started_at", -1).limit(limit)
    return await cursor.to_list(limit)


# ─────────────────────────── Scheduled broadcasts ───────────────────────────
# Queue a broadcast for a later time (patch Tuesday, maintenance window).
# The scheduler in server.py calls execute_due_scheduled_broadcasts() every 30s.


@router.post("/trmm/scheduled-broadcasts")
async def create_scheduled_broadcast(data: dict, current_user: dict = Depends(get_current_user)):
    """body: {
        agent_ids: [str],
        command?: str, script_id?: int, args?: list, shell?: str, timeout?: int,
        concurrency?: int, label?: str,
        run_at: ISO datetime string (UTC or with TZ),
        repeat?: 'once' | 'daily' | 'weekly' (default 'once'),
    }
    """
    cfg = await _get_config()
    if not cfg:
        raise HTTPException(503, "Tactical RMM not configured")
    agent_ids = [a for a in (data.get("agent_ids") or []) if a]
    if not agent_ids:
        raise HTTPException(400, "agent_ids required")
    if len(agent_ids) > 200:
        raise HTTPException(400, "Too many agents (max 200)")
    command = (data.get("command") or "").strip()
    script_id = data.get("script_id")
    if not command and not script_id:
        raise HTTPException(400, "Provide a command or script_id")
    run_at = data.get("run_at")
    if not run_at:
        raise HTTPException(400, "run_at is required (ISO datetime)")
    try:
        run_at_dt = datetime.fromisoformat(run_at.replace("Z", "+00:00"))
        if run_at_dt.tzinfo is None:
            run_at_dt = run_at_dt.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(400, "run_at must be a valid ISO datetime")

    repeat = (data.get("repeat") or "once").lower()
    if repeat not in {"once", "daily", "weekly"}:
        raise HTTPException(400, "repeat must be once|daily|weekly")

    sched_id = f"sched-{_uuid.uuid4().hex[:12]}"
    doc = {
        "id": sched_id,
        "agent_ids": agent_ids,
        "command": command[:4000],
        "script_id": script_id,
        "args": (data.get("args") or [])[:32],
        "shell": data.get("shell", "powershell"),
        "timeout": int(data.get("timeout", 60)),
        "concurrency": max(1, min(20, int(data.get("concurrency", 8)))),
        "label": (data.get("label") or "")[:160],
        "run_at": run_at_dt.isoformat(),
        "repeat": repeat,
        "status": "pending",
        "created_by": current_user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_run_at": None,
        "last_broadcast_id": None,
        "runs_count": 0,
    }
    await db.trmm_scheduled_broadcasts.insert_one(doc)
    doc.pop("_id", None)
    await _audit("schedule-broadcast", sched_id, current_user.get("name"), f"{len(agent_ids)} agents @ {run_at_dt.isoformat()} · {repeat}")
    return {"success": True, "id": sched_id, "run_at": run_at_dt.isoformat(), "repeat": repeat}


@router.get("/trmm/scheduled-broadcasts")
async def list_scheduled_broadcasts(include_completed: bool = False, current_user: dict = Depends(get_current_user)):
    q = {} if include_completed else {"status": {"$in": ["pending", "scheduled"]}}
    cursor = db.trmm_scheduled_broadcasts.find(q, {"_id": 0}).sort("run_at", 1)
    return await cursor.to_list(200)


@router.get("/trmm/scheduled-broadcasts/{sched_id}")
async def get_scheduled_broadcast(sched_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.trmm_scheduled_broadcasts.find_one({"id": sched_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Scheduled broadcast not found")
    return doc


@router.delete("/trmm/scheduled-broadcasts/{sched_id}")
async def cancel_scheduled_broadcast(sched_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.trmm_scheduled_broadcasts.update_one(
        {"id": sched_id, "status": {"$in": ["pending", "scheduled"]}},
        {"$set": {"status": "cancelled", "cancelled_at": datetime.now(timezone.utc).isoformat(), "cancelled_by": current_user.get("name")}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Not found or already executed")
    await _audit("cancel-schedule", sched_id, current_user.get("name"), "")
    return {"success": True}


async def execute_due_scheduled_broadcasts():
    """Called by the server-wide scheduler. Executes any scheduled broadcast
    whose run_at is in the past AND status is pending. For repeating schedules,
    bumps run_at to the next occurrence on success."""
    now = datetime.now(timezone.utc)
    cursor = db.trmm_scheduled_broadcasts.find({
        "status": {"$in": ["pending", "scheduled"]},
        "run_at": {"$lte": now.isoformat()},
    }, {"_id": 0})
    docs = await cursor.to_list(50)
    if not docs:
        return 0

    cfg = await _get_config()
    if not cfg:
        # TRMM not configured → skip this cycle, don't mark as failed (user may
        # be in the middle of setting it up).
        return 0

    fired = 0
    for s in docs:
        try:
            broadcast_id = f"bcast-{_uuid.uuid4().hex[:12]}"
            bdoc = {
                "id": broadcast_id,
                "agent_ids": s["agent_ids"],
                "total": len(s["agent_ids"]),
                "completed": 0, "succeeded": 0, "failed_count": 0,
                "shell": s.get("shell", "powershell"),
                "command": (s.get("command") or "")[:4000],
                "script_id": s.get("script_id"),
                "args": s.get("args", []),
                "timeout": s.get("timeout", 60),
                "label": s.get("label") or f"scheduled · {s['id']}",
                "concurrency": s.get("concurrency", 8),
                "status": "running",
                "by": f"scheduler ({s.get('created_by') or 'system'})",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "agent_map": {aid: {"agent_id": aid, "status": "queued"} for aid in s["agent_ids"]},
                "scheduled_id": s["id"],
            }
            await db.trmm_broadcasts.insert_one(bdoc)
            _asyncio.create_task(_run_broadcast(
                broadcast_id, s["agent_ids"], s.get("shell", "powershell"),
                s.get("command") or "", s.get("script_id"),
                s.get("args") or [], s.get("timeout", 60), bdoc["label"],
                f"scheduler ({s.get('created_by') or 'system'})",
                s.get("concurrency", 8),
            ))

            update = {
                "$set": {
                    "last_broadcast_id": broadcast_id,
                    "last_run_at": now.isoformat(),
                },
                "$inc": {"runs_count": 1},
            }
            repeat = s.get("repeat", "once")
            if repeat == "daily":
                from datetime import timedelta
                next_at = datetime.fromisoformat(s["run_at"].replace("Z", "+00:00")) + timedelta(days=1)
                while next_at <= now:
                    next_at += timedelta(days=1)
                update["$set"]["run_at"] = next_at.isoformat()
                update["$set"]["status"] = "pending"
            elif repeat == "weekly":
                from datetime import timedelta
                next_at = datetime.fromisoformat(s["run_at"].replace("Z", "+00:00")) + timedelta(days=7)
                while next_at <= now:
                    next_at += timedelta(days=7)
                update["$set"]["run_at"] = next_at.isoformat()
                update["$set"]["status"] = "pending"
            else:
                update["$set"]["status"] = "completed"
                update["$set"]["completed_at"] = now.isoformat()

            await db.trmm_scheduled_broadcasts.update_one({"id": s["id"]}, update)
            fired += 1
        except Exception as e:
            await db.trmm_scheduled_broadcasts.update_one(
                {"id": s["id"]},
                {"$set": {"last_error": str(e)[:500], "last_run_at": now.isoformat()}}
            )

    return fired


# ─────────────────────────── Notifications (Slack / Teams) ───────────────────────────
# After every broadcast finishes, push a summary card to configured webhooks.

NOTIF_KEY = "tactical_rmm_notifications"


@router.get("/trmm/notifications/settings")
async def get_notif_settings(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": NOTIF_KEY}, {"_id": 0}) or {}
    return {
        "slack_webhook_url": doc.get("slack_webhook_url") or "",
        "teams_webhook_url": doc.get("teams_webhook_url") or "",
        "notify_on": doc.get("notify_on", "all"),  # all | failures | none
        "include_per_agent": bool(doc.get("include_per_agent", True)),
        "configured": bool(doc.get("slack_webhook_url") or doc.get("teams_webhook_url")),
    }


@router.post("/trmm/notifications/settings")
async def save_notif_settings(data: dict, current_user: dict = Depends(get_current_user)):
    notify_on = (data.get("notify_on") or "all").lower()
    if notify_on not in {"all", "failures", "none"}:
        raise HTTPException(400, "notify_on must be all|failures|none")
    payload = {
        "type": NOTIF_KEY,
        "slack_webhook_url": (data.get("slack_webhook_url") or "").strip(),
        "teams_webhook_url": (data.get("teams_webhook_url") or "").strip(),
        "notify_on": notify_on,
        "include_per_agent": bool(data.get("include_per_agent", True)),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("name"),
    }
    await db.settings.update_one({"type": NOTIF_KEY}, {"$set": payload}, upsert=True)
    return {"success": True, "configured": bool(payload["slack_webhook_url"] or payload["teams_webhook_url"])}


def _build_slack_blocks(b: dict) -> dict:
    label = b.get("label") or (b.get("command") or f"script {b.get('script_id')}")[:80]
    fail = b.get("failed_count", 0)
    ok = b.get("succeeded", 0)
    total = b.get("total", 0)
    color = "#22c55e" if fail == 0 else ("#f59e0b" if ok > 0 else "#ef4444")
    icon = ":white_check_mark:" if fail == 0 else (":warning:" if ok > 0 else ":rotating_light:")
    fields = [
        {"type": "mrkdwn", "text": f"*Total*\n{total}"},
        {"type": "mrkdwn", "text": f"*Succeeded*\n{ok}"},
        {"type": "mrkdwn", "text": f"*Failed*\n{fail}"},
        {"type": "mrkdwn", "text": f"*Concurrency*\n{b.get('concurrency', '?')}"},
    ]
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{icon} TRMM broadcast: {label[:120]}"}},
        {"type": "section", "fields": fields},
    ]
    if b.get("command"):
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"`{b['command'][:200]}` _({b.get('shell','?')})_"}]})
    if b.get("by"):
        blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": f"by *{b['by']}* · started {b.get('started_at','')}"}]})
    return {"attachments": [{"color": color, "blocks": blocks}]}


def _build_teams_card(b: dict) -> dict:
    label = b.get("label") or (b.get("command") or f"script {b.get('script_id')}")[:80]
    fail = b.get("failed_count", 0)
    ok = b.get("succeeded", 0)
    total = b.get("total", 0)
    color = "00B050" if fail == 0 else ("FFA500" if ok > 0 else "D9534F")
    return {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "themeColor": color,
        "summary": f"TRMM broadcast: {label}",
        "sections": [
            {
                "activityTitle": f"**TRMM broadcast: {label[:120]}**",
                "activitySubtitle": f"by {b.get('by','—')} · started {b.get('started_at','')}",
                "facts": [
                    {"name": "Total", "value": str(total)},
                    {"name": "Succeeded", "value": str(ok)},
                    {"name": "Failed", "value": str(fail)},
                    {"name": "Concurrency", "value": str(b.get('concurrency', '?'))},
                ] + ([{"name": "Command", "value": f"`{b['command'][:200]}`"}] if b.get("command") else []),
                "markdown": True,
            }
        ],
    }


async def _send_broadcast_notification(broadcast_id: str):
    """Called after a broadcast finishes to push to Slack/Teams. Tolerant of missing config."""
    settings = await db.settings.find_one({"type": NOTIF_KEY}, {"_id": 0})
    if not settings:
        return
    notify_on = settings.get("notify_on", "all")
    if notify_on == "none":
        return
    bdoc = await db.trmm_broadcasts.find_one({"id": broadcast_id}, {"_id": 0})
    if not bdoc:
        return
    if notify_on == "failures" and bdoc.get("failed_count", 0) == 0:
        return

    sent = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        slack = settings.get("slack_webhook_url")
        if slack:
            try:
                r = await client.post(slack, json=_build_slack_blocks(bdoc))
                sent.append({"target": "slack", "status": r.status_code})
            except Exception as e:
                sent.append({"target": "slack", "error": str(e)[:200]})
        teams = settings.get("teams_webhook_url")
        if teams:
            try:
                r = await client.post(teams, json=_build_teams_card(bdoc))
                sent.append({"target": "teams", "status": r.status_code})
            except Exception as e:
                sent.append({"target": "teams", "error": str(e)[:200]})

    if sent:
        await db.trmm_broadcasts.update_one(
            {"id": broadcast_id},
            {"$set": {"notifications": sent, "notified_at": datetime.now(timezone.utc).isoformat()}},
        )


@router.post("/trmm/notifications/test")
async def test_notification(data: dict, current_user: dict = Depends(get_current_user)):
    """Sends a fake broadcast summary to whichever channel(s) are configured.
    Body: { target: 'slack' | 'teams' | 'both' (default both) }"""
    target = (data.get("target") or "both").lower()
    settings = await db.settings.find_one({"type": NOTIF_KEY}, {"_id": 0}) or {}
    if not settings.get("slack_webhook_url") and not settings.get("teams_webhook_url"):
        raise HTTPException(400, "No webhook configured")

    fake = {
        "id": "test-broadcast",
        "label": "TRMM notification test",
        "command": "Get-Service Spooler",
        "shell": "powershell",
        "total": 5,
        "succeeded": 4,
        "failed_count": 1,
        "concurrency": 8,
        "by": current_user.get("name") or "test",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    results = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        if target in ("slack", "both") and settings.get("slack_webhook_url"):
            try:
                r = await client.post(settings["slack_webhook_url"], json=_build_slack_blocks(fake))
                results.append({"target": "slack", "status": r.status_code, "ok": 200 <= r.status_code < 300})
            except Exception as e:
                results.append({"target": "slack", "error": str(e)[:200], "ok": False})
        if target in ("teams", "both") and settings.get("teams_webhook_url"):
            try:
                r = await client.post(settings["teams_webhook_url"], json=_build_teams_card(fake))
                results.append({"target": "teams", "status": r.status_code, "ok": 200 <= r.status_code < 300})
            except Exception as e:
                results.append({"target": "teams", "error": str(e)[:200], "ok": False})

    success = bool(results) and all(r.get("ok") for r in results)
    return {"success": success, "results": results}
