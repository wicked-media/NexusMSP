"""
NexusOps Agent — backend router.

Endpoints:
  AGENT-FACING (auth via X-Agent-Token):
    POST /api/nexus-agent/enroll
    POST /api/nexus-agent/heartbeat
    GET  /api/nexus-agent/commands/poll
    POST /api/nexus-agent/command-result

  ADMIN-FACING (auth via JWT Bearer):
    GET    /api/nexus-agent/agents
    GET    /api/nexus-agent/agents/{device_id}
    POST   /api/nexus-agent/agents/{device_id}/command
    GET    /api/nexus-agent/agents/{device_id}/commands
    POST   /api/nexus-agent/installers/build           — generate installer for a client
    GET    /api/nexus-agent/installers/{token}/download — download installer ZIP (public, token-protected)
    GET    /api/nexus-agent/binary/latest              — latest agent .exe (public)
    GET    /api/nexus-agent/settings                   — admin settings
    PUT    /api/nexus-agent/settings                   — update settings
"""
from __future__ import annotations

import io
import json
import logging
import os
import secrets
import time
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.database import db
from app.auth import get_current_user

logger = logging.getLogger("nexus_agent")
router = APIRouter(tags=["NexusOps Agent"])

# Where the compiled Windows agent binary lives in the backend filesystem.
AGENT_BINARY_PATH = Path(os.environ.get("NEXUS_AGENT_BINARY") or "/app/agent/dist/nexus-agent.exe")
AGENT_VERSION = "0.1.0-dev"

# Emergent object storage prefix (for hosting installer ZIPs)
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "nexusops"
_storage_key: str | None = None


def _init_storage() -> str | None:
    """Initialize Emergent object storage once and reuse session key."""
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json().get("storage_key")
        logger.info("[nexus-agent] storage initialised")
        return _storage_key
    except Exception as e:
        logger.warning("[nexus-agent] storage init failed: %s", e)
        return None


def _storage_put(path: str, data: bytes, content_type: str = "application/zip") -> dict | None:
    key = _init_storage()
    if not key:
        return None
    try:
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning("[nexus-agent] storage put failed for %s: %s", path, e)
        return None


def _storage_get(path: str) -> bytes | None:
    key = _init_storage()
    if not key:
        return None
    try:
        r = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60,
        )
        if r.status_code == 200:
            return r.content
    except Exception as e:
        logger.warning("[nexus-agent] storage get failed for %s: %s", path, e)
    return None


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _verify_agent_token(db, x_agent_token: str | None) -> dict:
    if not x_agent_token:
        raise HTTPException(401, "missing agent token")
    agent = await db.nexus_agents.find_one({"agent_token": x_agent_token, "is_active": True})
    if not agent:
        raise HTTPException(401, "invalid agent token")
    return agent


async def _audit(db, kind: str, payload: dict) -> None:
    try:
        await db.nexus_agent_audit.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind,
            "payload": payload,
            "at": _now(),
        })
    except Exception:
        pass


# ----------------------------------------------------------------------
# Public helpers — used by device_intel.bulk_action and ticket_device_actions
# ----------------------------------------------------------------------

async def get_nexus_agent_for_device(device_doc: dict) -> dict | None:
    """Given a `devices` doc, return the live nexus_agents doc, or None."""
    nid = device_doc.get("nexus_agent_id")
    if not nid:
        return None
    return await db.nexus_agents.find_one({"id": nid, "is_active": True})


async def queue_command_for_device(device_doc: dict, kind: str, payload: dict, queued_by: str = "system") -> str | None:
    """Queue a command against the nexus-agent linked to this device.
    Returns the command id, or None if device has no agent."""
    nid = device_doc.get("nexus_agent_id")
    if not nid:
        return None
    cmd_id = str(uuid.uuid4())
    await db.nexus_agent_commands.insert_one({
        "id": cmd_id,
        "device_id": nid,
        "kind": kind,
        "payload": payload or {},
        "status": "pending",
        "queued_by": queued_by,
        "created_at": _now(),
    })
    return cmd_id


# ----------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------

class EnrollRequest(BaseModel):
    enrollment_token: str
    client_id: str = ""
    hostname: str = ""
    os: str = ""
    arch: str = ""
    os_version: str = ""
    mac: str = ""
    agent_version: str = ""


class EnrollResponse(BaseModel):
    agent_token: str
    device_id: str


class HeartbeatPayload(BaseModel):
    agent_version: str = ""
    snapshot: dict = Field(default_factory=dict)


class CommandRequest(BaseModel):
    kind: str  # run_script | run_powershell | run_cmd | reboot | shutdown | kill_process | ping
    payload: dict = Field(default_factory=dict)


class CommandResult(BaseModel):
    id: str
    status: str
    exit_code: int = 0
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0


class InstallerBuildRequest(BaseModel):
    client_id: str
    note: str = ""


class NexusAgentSettings(BaseModel):
    heartbeat_secs: int = 60
    poll_secs: int = 10
    server_url: str = ""           # full https URL the agent should call back to
    splashtop_enabled: bool = False
    splashtop_deploy_code_default: str = ""


# ----------------------------------------------------------------------
# AGENT-FACING ENDPOINTS  (X-Agent-Token auth)
# ----------------------------------------------------------------------

@router.post("/nexus-agent/enroll", response_model=EnrollResponse)
async def enroll(req: EnrollRequest):
    # Look up enrollment token
    tok = await db.nexus_agent_enrollment_tokens.find_one({"token": req.enrollment_token, "is_active": True})
    if not tok:
        raise HTTPException(401, "invalid or revoked enrollment token")
    if tok.get("expires_at") and tok["expires_at"] < _now():
        raise HTTPException(401, "enrollment token expired")

    client_id = tok.get("client_id") or req.client_id or ""

    # Idempotency — try to find an existing agent for (hostname, client_id, mac)
    existing = None
    if req.hostname:
        existing = await db.nexus_agents.find_one({
            "client_id": client_id,
            "hostname": req.hostname,
        })

    if existing:
        # Rotate token
        new_token = secrets.token_urlsafe(32)
        await db.nexus_agents.update_one(
            {"id": existing["id"]},
            {"$set": {
                "agent_token": new_token,
                "is_active": True,
                "last_seen": _now(),
                "os": req.os, "arch": req.arch,
                "os_version": req.os_version,
                "agent_version": req.agent_version,
                "primary_mac": req.mac,
            }},
        )
        await _audit(db, "re-enroll", {"device_id": existing["id"], "client_id": client_id})
        await _sync_to_devices(db, existing["id"], client_id, req)
        return EnrollResponse(agent_token=new_token, device_id=existing["id"])

    device_id = str(uuid.uuid4())
    agent_token = secrets.token_urlsafe(32)
    doc = {
        "id": device_id,
        "client_id": client_id,
        "hostname": req.hostname,
        "os": req.os,
        "arch": req.arch,
        "os_version": req.os_version,
        "primary_mac": req.mac,
        "agent_version": req.agent_version,
        "agent_token": agent_token,
        "is_active": True,
        "enrolled_at": _now(),
        "last_seen": _now(),
        "source": "nexus-agent",
    }
    await db.nexus_agents.insert_one(doc)
    await _audit(db, "enroll", {"device_id": device_id, "client_id": client_id, "hostname": req.hostname})
    await _sync_to_devices(db, device_id, client_id, req)
    return EnrollResponse(agent_token=agent_token, device_id=device_id)


async def _sync_to_devices(db, nexus_device_id: str, client_id: str, req: "EnrollRequest"):
    """Mirror the nexus agent into the existing `devices` collection so it appears
    on the standard Devices page without any UI changes."""
    client_name = ""
    try:
        c = await db.clients.find_one({"id": client_id}, {"name": 1})
        if c:
            client_name = c.get("name", "")
    except Exception:
        pass
    device_filter = {"nexus_agent_id": nexus_device_id}
    update = {
        "$set": {
            "nexus_agent_id": nexus_device_id,
            "client_id": client_id,
            "client_name": client_name,
            "hostname": req.hostname or "",
            "name": req.hostname or "Unnamed",
            "os_name": req.os or "windows",
            "os_version": req.os_version or "",
            "primary_mac": req.mac or "",
            "agent_version": req.agent_version or "",
            "status": "online",
            "last_seen": _now(),
            "source": "nexus-agent",
        },
        "$setOnInsert": {
            "id": str(uuid.uuid4()),
            "created_at": _now(),
            "device_type": "workstation",
        },
    }
    await db.devices.update_one(device_filter, update, upsert=True)


@router.post("/nexus-agent/heartbeat")
async def heartbeat(p: HeartbeatPayload, x_agent_token: str | None = Header(None)):
    agent = await _verify_agent_token(db, x_agent_token)
    snap = p.snapshot or {}
    now = _now()
    update = {
        "last_seen": now,
        "agent_version": p.agent_version or agent.get("agent_version", ""),
        "online": True,
    }
    # Top-level snapshot fields useful for list views
    for k in ("hostname", "os", "os_version", "os_platform", "arch",
              "cpu_percent", "cpu_count", "cpu_model",
              "mem_total_mb", "mem_used_mb", "mem_percent",
              "uptime_sec"):
        if k in snap:
            update[k] = snap[k]
    update["disks"] = snap.get("disks", [])
    update["nics"] = snap.get("nics", [])
    await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": update})

    # Mirror into devices collection so the existing /devices page sees live data.
    try:
        first_disk_pct = 0
        if snap.get("disks"):
            first_disk_pct = max((d.get("percent") or 0) for d in snap["disks"])
        await db.devices.update_one(
            {"nexus_agent_id": agent["id"]},
            {"$set": {
                "status": "online",
                "last_seen": now,
                "hostname": snap.get("hostname", agent.get("hostname", "")),
                "name": snap.get("hostname", agent.get("hostname", "")) or "Unnamed",
                "os_name": snap.get("os_platform") or snap.get("os") or agent.get("os", ""),
                "os_version": snap.get("os_version", ""),
                "cpu_load": snap.get("cpu_percent", 0),
                "memory_pct": snap.get("mem_percent", 0),
                "disk_pct": first_disk_pct,
                "uptime_sec": snap.get("uptime_sec", 0),
                "agent_version": p.agent_version or agent.get("agent_version", ""),
                "source": "nexus-agent",
            }},
        )
    except Exception:
        pass

    # Write a heartbeat history row (lightweight — for sparklines)
    try:
        await db.nexus_agent_heartbeats.insert_one({
            "device_id": agent["id"],
            "at": now,
            "cpu_percent": snap.get("cpu_percent", 0),
            "mem_percent": snap.get("mem_percent", 0),
        })
    except Exception:
        pass
    return {"ok": True}


@router.get("/nexus-agent/commands/poll")
async def commands_poll(x_agent_token: str | None = Header(None)):
    agent = await _verify_agent_token(db, x_agent_token)
    # Atomically claim any pending commands for this device
    pending = await db.nexus_agent_commands.find({
        "device_id": agent["id"],
        "status": "pending",
    }).to_list(length=20)
    out: list[dict] = []
    for c in pending:
        await db.nexus_agent_commands.update_one(
            {"_id": c["_id"]},
            {"$set": {"status": "dispatched", "dispatched_at": _now()}},
        )
        out.append({"id": c["id"], "kind": c["kind"], "payload": c.get("payload") or {}})
    return {"commands": out}


@router.post("/nexus-agent/command-result")
async def command_result(res: CommandResult, x_agent_token: str | None = Header(None)):
    agent = await _verify_agent_token(db, x_agent_token)
    await db.nexus_agent_commands.update_one(
        {"id": res.id, "device_id": agent["id"]},
        {"$set": {
            "status": res.status,
            "exit_code": res.exit_code,
            "stdout": res.stdout,
            "stderr": res.stderr,
            "duration_ms": res.duration_ms,
            "completed_at": _now(),
        }},
    )
    return {"ok": True}


# ----------------------------------------------------------------------
# ADMIN-FACING ENDPOINTS  (JWT Bearer auth)
# ----------------------------------------------------------------------

@router.get("/nexus-agent/agents")
async def list_agents(client_id: str | None = None, user=Depends(get_current_user)):
    q: dict[str, Any] = {}
    if client_id:
        q["client_id"] = client_id
    cursor = db.nexus_agents.find(q, {"agent_token": 0}).sort("last_seen", -1)
    agents = await cursor.to_list(length=2000)
    now = datetime.now(timezone.utc)
    for a in agents:
        a.pop("_id", None)
        try:
            last = datetime.fromisoformat(a.get("last_seen", "").replace("Z", "+00:00"))
            a["online"] = (now - last).total_seconds() < 180
        except Exception:
            a["online"] = False
    return agents


@router.get("/nexus-agent/agents/{device_id}")
async def get_agent(device_id: str, user=Depends(get_current_user)):
    agent = await db.nexus_agents.find_one({"id": device_id}, {"agent_token": 0, "_id": 0})
    if not agent:
        raise HTTPException(404, "agent not found")
    # Recent commands
    cmds = await db.nexus_agent_commands.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(length=50)
    # Heartbeat history (last 60 points)
    hb = await db.nexus_agent_heartbeats.find({"device_id": device_id}, {"_id": 0}).sort("at", -1).to_list(length=60)
    hb.reverse()
    return {"agent": agent, "commands": cmds, "heartbeats": hb}


@router.post("/nexus-agent/agents/{device_id}/command")
async def queue_command(device_id: str, req: CommandRequest, user=Depends(get_current_user)):
    agent = await db.nexus_agents.find_one({"id": device_id, "is_active": True})
    if not agent:
        raise HTTPException(404, "agent not found")
    cmd_id = str(uuid.uuid4())
    doc = {
        "id": cmd_id,
        "device_id": device_id,
        "kind": req.kind,
        "payload": req.payload or {},
        "status": "pending",
        "queued_by": user.get("email") or user.get("id"),
        "created_at": _now(),
    }
    await db.nexus_agent_commands.insert_one(doc)
    await _audit(db, "queue", {"cmd_id": cmd_id, "device_id": device_id, "kind": req.kind, "by": doc["queued_by"]})
    return {"id": cmd_id, "status": "pending"}


@router.get("/nexus-agent/agents/{device_id}/commands")
async def agent_commands(device_id: str, limit: int = 50, user=Depends(get_current_user)):
    cur = db.nexus_agent_commands.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1)
    return await cur.to_list(length=limit)


# ----------------------------------------------------------------------
# INSTALLER BUILDER
# ----------------------------------------------------------------------

def _build_installer_zip(client_id: str, client_name: str, enrollment_token: str, server_url: str, binary_bytes: bytes) -> bytes:
    """Build a ZIP containing nexus-agent.exe + config.json + install.bat."""
    config = {
        "server_url": server_url,
        "enrollment_token": enrollment_token,
        "client_id": client_id,
        "client_name": client_name,
        "heartbeat_secs": 60,
        "poll_secs": 10,
    }
    install_bat = (
        "@echo off\r\n"
        "REM NexusOps Agent installer\r\n"
        "setlocal\r\n"
        "set INSTDIR=%ProgramFiles%\\NexusOps Agent\r\n"
        "echo Installing NexusOps Agent to %INSTDIR%\r\n"
        "if not exist \"%INSTDIR%\" mkdir \"%INSTDIR%\"\r\n"
        "copy /Y \"%~dp0nexus-agent.exe\" \"%INSTDIR%\\nexus-agent.exe\" >nul\r\n"
        "copy /Y \"%~dp0config.json\"     \"%INSTDIR%\\config.json\"     >nul\r\n"
        "cd /d \"%INSTDIR%\"\r\n"
        "\"%INSTDIR%\\nexus-agent.exe\" -run install\r\n"
        "if errorlevel 1 (\r\n"
        "  echo Install failed. Run this script as Administrator.\r\n"
        "  exit /b 1\r\n"
        ")\r\n"
        "echo NexusOps Agent installed and started.\r\n"
        "endlocal\r\n"
    )
    uninstall_bat = (
        "@echo off\r\n"
        "set INSTDIR=%ProgramFiles%\\NexusOps Agent\r\n"
        "\"%INSTDIR%\\nexus-agent.exe\" -run uninstall\r\n"
        "rd /S /Q \"%INSTDIR%\" 2>nul\r\n"
        "echo NexusOps Agent uninstalled.\r\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("nexus-agent.exe", binary_bytes)
        z.writestr("config.json", json.dumps(config, indent=2))
        z.writestr("install.bat", install_bat)
        z.writestr("uninstall.bat", uninstall_bat)
        z.writestr("README.txt",
                   "NexusOps Agent\n\n"
                   "1) Right-click install.bat → Run as Administrator\n"
                   "2) Agent will register itself as the 'NexusOpsAgent' Windows service\n"
                   "3) Within 60 seconds the device will appear in NexusOps → Devices\n\n"
                   "To remove: run uninstall.bat as Administrator.\n")
    return buf.getvalue()


@router.post("/nexus-agent/installers/build")
async def build_installer(req: InstallerBuildRequest, request: Request, user=Depends(get_current_user)):
    client = await db.clients.find_one({"id": req.client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(404, "client not found")

    # Load admin settings for server_url (fallback to request origin)
    settings = await db.nexus_agent_settings.find_one({"_id": "settings"}) or {}
    server_url = settings.get("server_url") or str(request.url).rsplit("/api/", 1)[0]
    server_url = server_url.rstrip("/")

    # Read the compiled binary
    if not AGENT_BINARY_PATH.exists():
        raise HTTPException(500, f"agent binary missing at {AGENT_BINARY_PATH}; run `make windows` in /app/agent")
    binary_bytes = AGENT_BINARY_PATH.read_bytes()

    # Mint an enrollment token bound to this client
    enrollment_token = secrets.token_urlsafe(28)
    await db.nexus_agent_enrollment_tokens.insert_one({
        "token": enrollment_token,
        "client_id": req.client_id,
        "client_name": client["name"],
        "is_active": True,
        "created_at": _now(),
        "created_by": user.get("email") or user.get("id"),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
        "note": req.note or "",
    })

    # Build the ZIP
    zip_bytes = _build_installer_zip(
        client_id=req.client_id,
        client_name=client["name"],
        enrollment_token=enrollment_token,
        server_url=server_url,
        binary_bytes=binary_bytes,
    )

    # Store on Emergent object storage (with a download token) and record a manifest entry
    download_token = secrets.token_urlsafe(20)
    storage_path = f"{APP_NAME}/agent-installers/{req.client_id}/{download_token}.zip"
    put_result = _storage_put(storage_path, zip_bytes, content_type="application/zip")

    manifest = {
        "id": str(uuid.uuid4()),
        "client_id": req.client_id,
        "client_name": client["name"],
        "enrollment_token": enrollment_token,
        "storage_path": storage_path if put_result else "",
        "download_token": download_token,
        "size_bytes": len(zip_bytes),
        "created_at": _now(),
        "created_by": user.get("email") or user.get("id"),
        "agent_version": AGENT_VERSION,
        "is_deleted": False,
    }
    await db.nexus_agent_installers.insert_one(manifest)

    api_base = str(request.url).rsplit("/api/", 1)[0].rstrip("/")
    # Prefer X-Forwarded-Host (set by reverse proxy) so download URL points at public domain.
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    fwd_proto = request.headers.get("x-forwarded-proto") or "https"
    if fwd_host:
        api_base = f"{fwd_proto}://{fwd_host}"
    return {
        "id": manifest["id"],
        "download_url": f"{api_base}/api/nexus-agent/installers/{download_token}/download",
        "filename": f"NexusOpsAgent_{client['name'].replace(' ', '_')}.zip",
        "size_bytes": len(zip_bytes),
        "agent_version": AGENT_VERSION,
        "enrollment_token": enrollment_token,
    }


@router.get("/nexus-agent/installers/{token}/download")
async def installer_download(token: str):
    manifest = await db.nexus_agent_installers.find_one({"download_token": token, "is_deleted": False})
    if not manifest:
        raise HTTPException(404, "installer not found")
    # Try storage first, fall back to live-rebuild
    zip_bytes: bytes | None = None
    if manifest.get("storage_path"):
        zip_bytes = _storage_get(manifest["storage_path"])
    if not zip_bytes:
        # Rebuild on the fly
        if not AGENT_BINARY_PATH.exists():
            raise HTTPException(500, "agent binary missing — rebuild required")
        zip_bytes = _build_installer_zip(
            client_id=manifest["client_id"],
            client_name=manifest["client_name"],
            enrollment_token=manifest["enrollment_token"],
            server_url=(await db.nexus_agent_settings.find_one({"_id": "settings"}) or {}).get("server_url") or "",
            binary_bytes=AGENT_BINARY_PATH.read_bytes(),
        )
    filename = f"NexusOpsAgent_{manifest['client_name'].replace(' ', '_')}.zip"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=zip_bytes, media_type="application/zip", headers=headers)


@router.get("/nexus-agent/installers")
async def list_installers(client_id: str | None = None, user=Depends(get_current_user)):
    q: dict[str, Any] = {"is_deleted": False}
    if client_id:
        q["client_id"] = client_id
    cur = db.nexus_agent_installers.find(q, {"_id": 0}).sort("created_at", -1)
    return await cur.to_list(length=200)


@router.get("/nexus-agent/binary/latest")
async def latest_binary():
    if not AGENT_BINARY_PATH.exists():
        raise HTTPException(404, "agent binary not built; run `make windows` in /app/agent")
    return Response(
        content=AGENT_BINARY_PATH.read_bytes(),
        media_type="application/vnd.microsoft.portable-executable",
        headers={"Content-Disposition": 'attachment; filename="nexus-agent.exe"'},
    )


# ----------------------------------------------------------------------
# ADMIN SETTINGS
# ----------------------------------------------------------------------

@router.get("/nexus-agent/settings")
async def get_settings(user=Depends(get_current_user)):
    s = await db.nexus_agent_settings.find_one({"_id": "settings"}, {"_id": 0}) or {}
    return {
        "heartbeat_secs": s.get("heartbeat_secs", 60),
        "poll_secs": s.get("poll_secs", 10),
        "server_url": s.get("server_url", ""),
        "splashtop_enabled": s.get("splashtop_enabled", False),
        "splashtop_deploy_code_default": s.get("splashtop_deploy_code_default", ""),
        "agent_version": AGENT_VERSION,
        "agent_binary_exists": AGENT_BINARY_PATH.exists(),
    }


@router.put("/nexus-agent/settings")
async def put_settings(payload: NexusAgentSettings, user=Depends(get_current_user)):
    await db.nexus_agent_settings.update_one(
        {"_id": "settings"},
        {"$set": {
            "heartbeat_secs": payload.heartbeat_secs,
            "poll_secs": payload.poll_secs,
            "server_url": payload.server_url,
            "splashtop_enabled": payload.splashtop_enabled,
            "splashtop_deploy_code_default": payload.splashtop_deploy_code_default,
            "updated_at": _now(),
            "updated_by": user.get("email") or user.get("id"),
        }},
        upsert=True,
    )
    return {"ok": True}


@router.get("/nexus-agent/stats")
async def stats(user=Depends(get_current_user)):
    total = await db.nexus_agents.count_documents({"is_active": True})
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=3)).isoformat()
    online = await db.nexus_agents.count_documents({"is_active": True, "last_seen": {"$gte": cutoff}})
    cmds_pending = await db.nexus_agent_commands.count_documents({"status": "pending"})
    by_client = await db.nexus_agents.aggregate([
        {"$match": {"is_active": True}},
        {"$group": {"_id": "$client_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 12},
    ]).to_list(length=12)
    return {
        "total_agents": total,
        "online_agents": online,
        "offline_agents": max(0, total - online),
        "pending_commands": cmds_pending,
        "by_client": [{"client_id": r["_id"], "count": r["count"]} for r in by_client],
        "agent_version": AGENT_VERSION,
    }
