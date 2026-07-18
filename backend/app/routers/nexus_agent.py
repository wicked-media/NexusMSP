"""
NexusOps Agent Ã¢â‚¬â€ backend router.

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
    POST   /api/nexus-agent/installers/build           Ã¢â‚¬â€ generate installer for a client
    GET    /api/nexus-agent/installers/{token}/download Ã¢â‚¬â€ download installer ZIP (public, token-protected)
    GET    /api/nexus-agent/binary/latest              Ã¢â‚¬â€ latest agent .exe (public)
    GET    /api/nexus-agent/settings                   Ã¢â‚¬â€ admin settings
    PUT    /api/nexus-agent/settings                   Ã¢â‚¬â€ update settings
"""
from __future__ import annotations

import io
import json
import hashlib
import logging
import os
import secrets
import time
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

logger = logging.getLogger("nexus_agent")
router = APIRouter(tags=["NexusOps Agent"])

ONLINE_WINDOW_SECONDS = 180
MAX_FLEET_TARGETS = 200

# Where the compiled Windows agent binary lives. Production can set
# NEXUS_AGENT_BINARY; local development uses the repository's agent/dist.
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_LOCAL_AGENT_BINARY = _PROJECT_ROOT / "agent" / "dist" / "nexus-agent.exe"
_CONTAINER_AGENT_BINARY = Path("/app/agent/dist/nexus-agent.exe")
AGENT_BINARY_PATH = Path(os.environ["NEXUS_AGENT_BINARY"]) if os.environ.get("NEXUS_AGENT_BINARY") else (
    _CONTAINER_AGENT_BINARY if _CONTAINER_AGENT_BINARY.exists() else _LOCAL_AGENT_BINARY
)
AGENT_VERSION = os.environ.get("NEXUS_AGENT_VERSION") or "0.1.0-dev"

# Cached binary fingerprint (computed lazily; invalidated when mtime changes).
_binary_cache: dict[str, Any] = {"mtime": 0, "sha256": "", "size": 0}


def _binary_info() -> dict[str, Any]:
    """Return {version, sha256, size, exists} for the current Windows binary.
    Re-computes the SHA256 only when the file mtime changes."""
    if not AGENT_BINARY_PATH.exists():
        return {"version": AGENT_VERSION, "sha256": "", "size": 0, "exists": False}
    st = AGENT_BINARY_PATH.stat()
    if _binary_cache["mtime"] != st.st_mtime or not _binary_cache["sha256"]:
        h = hashlib.sha256()
        with AGENT_BINARY_PATH.open("rb") as fp:
            for chunk in iter(lambda: fp.read(1024 * 64), b""):
                h.update(chunk)
        _binary_cache.update({"mtime": st.st_mtime, "sha256": h.hexdigest(), "size": st.st_size})
    return {"version": AGENT_VERSION, "sha256": _binary_cache["sha256"], "size": _binary_cache["size"], "exists": True}

# Installer archives are stored locally by default. Set NEXUS_AGENT_INSTALLER_DIR
# to a mounted volume in production; no third-party object storage is required.
APP_NAME = "nexusops"
INSTALLER_STORAGE_DIR = Path(os.environ.get("NEXUS_AGENT_INSTALLER_DIR", _PROJECT_ROOT / "data" / "agent-installers"))


def _storage_put(path: str, data: bytes, content_type: str = "application/zip") -> dict | None:
    try:
        target = INSTALLER_STORAGE_DIR / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {"path": str(target), "content_type": content_type}
    except Exception as e:
        logger.warning("[nexus-agent] storage put failed for %s: %s", path, e)
        return None


def _storage_get(path: str) -> bytes | None:
    try:
        target = INSTALLER_STORAGE_DIR / path
        if target.exists():
            return target.read_bytes()
    except Exception as e:
        logger.warning("[nexus-agent] storage get failed for %s: %s", path, e)
    return None


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _online_cutoff() -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=ONLINE_WINDOW_SECONDS)).isoformat()


def _is_online(last_seen: Any) -> bool:
    try:
        last = datetime.fromisoformat(str(last_seen or "").replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - last).total_seconds() < ONLINE_WINDOW_SECONDS
    except (TypeError, ValueError):
        return False


def _is_agent_admin(user: dict) -> bool:
    role = str(user.get("role") or "").lower()
    return bool(user.get("is_admin") or role in {"admin", "owner"})


def _can_execute_agent_commands(user: dict) -> bool:
    if _is_agent_admin(user):
        return True
    permissions = user.get("permissions") or {}
    return bool((permissions.get("agent_commands") or {}).get("execute"))


async def require_agent_operator(user=Depends(get_current_user)) -> dict:
    if not _can_execute_agent_commands(user):
        raise HTTPException(403, "Agent command permission required")
    return user


def _batch_scope(batch_id: str, user: dict) -> dict[str, Any]:
    query: dict[str, Any] = {"batch_id": batch_id}
    if not _is_agent_admin(user):
        identities = [value for value in {user.get("id"), user.get("email")} if value]
        query["queued_by"] = {"$in": identities}
    return query


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
# Public helpers Ã¢â‚¬â€ used by device_intel.bulk_action and ticket_device_actions
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
    agent = await db.nexus_agents.find_one({
        "id": nid,
        "is_active": True,
        "last_seen": {"$gte": _online_cutoff()},
    }, {"_id": 1})
    if not agent:
        raise HTTPException(409, "NexusOps Agent is offline; command was not queued")
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
    kind: Literal["run_script", "run_powershell", "run_cmd", "reboot", "shutdown", "kill_process", "ping"]
    payload: dict = Field(default_factory=dict)
    include_offline: bool = False


class CommandResult(BaseModel):
    id: str
    status: Literal["ok", "error", "timeout"]
    exit_code: int = 0
    stdout: str = Field(default="", max_length=70_000)
    stderr: str = Field(default="", max_length=20_000)
    duration_ms: int = Field(default=0, ge=0, le=86_400_000)


class InstallerBuildRequest(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=500)


class NexusAgentSettings(BaseModel):
    heartbeat_secs: int = Field(default=60, ge=15, le=3600)
    poll_secs: int = Field(default=10, ge=2, le=300)
    server_url: str = Field(default="", max_length=2048)  # full https URL the agent should call back to
    splashtop_enabled: bool = False
    splashtop_deploy_code_default: str = Field(default="", max_length=500)
    auto_update_enabled: bool = True
    winget_enabled: bool = False
    winget_allowed_ids: list[str] = Field(default_factory=list, max_length=100)


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

    # Idempotency Ã¢â‚¬â€ try to find an existing agent for (hostname, client_id, mac)
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


def _agent_device_telemetry(snapshot: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Translate the lightweight agent heartbeat into the schema used by Devices.

    The agent deliberately reports a compact cross-platform snapshot.  Keeping
    the translation here makes agent-enrolled endpoints look identical to
    devices reported by the legacy full inventory agent.
    """
    disks = snapshot.get("disks") or []
    nics = snapshot.get("nics") or []
    disk_percent = max((float(d.get("percent") or 0) for d in disks), default=0)
    total_gb = round(sum(float(d.get("total_gb") or 0) for d in disks), 2)
    used_gb = round(sum(float(d.get("used_gb") or 0) for d in disks), 2)
    uptime_seconds = int(snapshot.get("uptime_sec") or 0)

    # Prefer a routable IPv4 address. Link-local addresses are not useful for
    # a technician trying to identify or reach the endpoint.
    ip_address = ""
    for nic in nics:
        for address in nic.get("ipv4") or []:
            value = str(address).split("/")[0]
            if value and not value.startswith(("127.", "169.254.")) and ":" not in value:
                ip_address = value
                break
        if ip_address:
            break

    device_update = {
        # DeviceDetailPage gauges use these canonical names.
        "cpu_usage": float(snapshot.get("cpu_percent") or 0),
        "memory_usage": float(snapshot.get("mem_percent") or 0),
        "disk_usage": disk_percent,
        # Keep the compact list-view fields in sync as well.
        "cpu_load": float(snapshot.get("cpu_percent") or 0),
        "memory_pct": float(snapshot.get("mem_percent") or 0),
        "disk_pct": disk_percent,
        "processor": str(snapshot.get("cpu_model") or "").strip(),
        "processor_cores": int(snapshot.get("cpu_count") or 0),
        "ram_gb": round(float(snapshot.get("mem_total_mb") or 0) / 1024, 1),
        "storage_total_gb": total_gb,
        "storage_used_gb": used_gb,
        "storage_free_gb": round(total_gb - used_gb, 2),
        "uptime_sec": uptime_seconds,
        "uptime_hours": round(uptime_seconds / 3600, 1),
        "uptime_display": f"{uptime_seconds // 86400}d {(uptime_seconds % 86400) // 3600}h",
    }
    if snapshot.get("boot_time"):
        device_update["last_reboot"] = datetime.fromtimestamp(int(snapshot["boot_time"]), tz=timezone.utc).isoformat()
    if snapshot.get("os_version"):
        device_update["os_build"] = str(snapshot["os_version"]).split("Build ")[-1]
    if ip_address:
        device_update["ip_address"] = ip_address

    security = snapshot.get("security") or {}
    if security:
        defender_enabled = bool(security.get("defender_enabled"))
        realtime_enabled = bool(security.get("real_time_enabled"))
        firewall_enabled = bool(security.get("firewall_enabled"))
        signature_age = int(security.get("signature_age_days") or 0)
        pending_updates = int(security.get("pending_update_count") or 0)
        encryption = str(security.get("encryption_status") or "Unknown")
        # Transparent scoring: 40 Defender + 20 signatures + 20 firewall +
        # 10 patch status + 10 encryption. Each input remains visible in UI.
        score = 0
        score += 40 if defender_enabled and realtime_enabled else 0
        score += 20 if signature_age <= 3 else (10 if signature_age <= 7 else 0)
        score += 20 if firewall_enabled else 0
        score += 10 if pending_updates == 0 else 0
        score += 10 if any(marker in encryption.lower() for marker in ("encrypted", "bitlocker on", "protection on")) else 0
        device_update.update({
            "security_assessed_at": _now(),
            "compliance_score": score,
            "antivirus": "Microsoft Defender" if security.get("defender_installed") else "Not detected",
            "antivirus_status": "active" if defender_enabled and realtime_enabled else "inactive",
            "edr_status": "active" if defender_enabled and realtime_enabled else "inactive",
            "defender_real_time_enabled": realtime_enabled,
            "defender_signature_age_days": signature_age,
            "firewall_enabled": firewall_enabled,
            "encryption_status": encryption,
            "pending_patches": pending_updates,
        })
    hardware = snapshot.get("hardware") or {}
    if hardware:
        device_update.update({key: str(hardware.get(key) or "") for key in ("manufacturer", "model", "serial_number", "bios_version", "domain")})

    disk_records = [
        {
            "id": str(uuid.uuid4()),
            "drive_letter": disk.get("device") or disk.get("mount") or "",
            "mount_point": disk.get("mount") or disk.get("device") or "",
            "file_system": disk.get("fs_type") or "",
            "total_gb": round(float(disk.get("total_gb") or 0), 2),
            "used_gb": round(float(disk.get("used_gb") or 0), 2),
            "free_gb": round(float(disk.get("total_gb") or 0) - float(disk.get("used_gb") or 0), 2),
            "usage_percent": round(float(disk.get("percent") or 0), 2),
            "disk_type": "Unknown",
            "smart_status": "Unknown",
        }
        for disk in disks
    ]
    network_records = [
        {
            "id": str(uuid.uuid4()),
            "adapter_name": nic.get("name") or "Unknown adapter",
            "mac_address": nic.get("mac") or "",
            "ip_address": next((str(v).split("/")[0] for v in (nic.get("ipv4") or []) if ":" not in str(v) and not str(v).startswith("169.254.")), ""),
            "subnet": next((str(v).split("/")[1] for v in (nic.get("ipv4") or []) if ":" not in str(v) and "/" in str(v)), ""),
            "ip_addresses": nic.get("ipv4") or [], "type": nic.get("type") or "ethernet",
            "status": nic.get("status") or "down", "gateway": nic.get("gateway") or "",
            "dns": nic.get("dns") or [], "speed_mbps": nic.get("speed_mbps") or 0,
        }
        for nic in nics
    ]
    return device_update, disk_records, network_records


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
              "uptime_sec", "security", "software", "hardware"):
        if k in snap:
            update[k] = snap[k]
    update["disks"] = snap.get("disks", [])
    update["nics"] = snap.get("nics", [])
    await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": update})

    # Mirror into devices collection so the existing /devices page sees live data.
    try:
        telemetry, disk_records, network_records = _agent_device_telemetry(snap)
        await db.devices.update_one(
            {"nexus_agent_id": agent["id"]},
            {"$set": {
                "status": "online",
                "last_seen": now,
                "hostname": snap.get("hostname", agent.get("hostname", "")),
                "name": snap.get("hostname", agent.get("hostname", "")) or "Unnamed",
                "os_name": snap.get("os_platform") or snap.get("os") or agent.get("os", ""),
                "os": snap.get("os_platform") or snap.get("os") or agent.get("os", ""),
                "os_version": snap.get("os_version", ""),
                "mac_address": agent.get("primary_mac", ""),
                "agent_version": p.agent_version or agent.get("agent_version", ""),
                "source": "nexus-agent",
                **telemetry,
            }},
        )
        mirrored_device = await db.devices.find_one({"nexus_agent_id": agent["id"]}, {"_id": 0, "id": 1})
        if mirrored_device and mirrored_device.get("id"):
            device_id = mirrored_device["id"]
            await db.device_disks.delete_many({"device_id": device_id})
            if disk_records:
                for record in disk_records:
                    record.update({"device_id": device_id, "last_updated": now})
                await db.device_disks.insert_many(disk_records)
            await db.device_network.delete_many({"device_id": device_id})
            if network_records:
                for record in network_records:
                    record.update({"device_id": device_id, "last_updated": now})
                await db.device_network.insert_many(network_records)
            await db.device_performance.insert_one({
                "id": str(uuid.uuid4()), "device_id": device_id, "timestamp": now,
                "cpu": telemetry["cpu_usage"], "memory": telemetry["memory_usage"], "disk": telemetry["disk_usage"],
                "cpu_usage": telemetry["cpu_usage"], "memory_usage": telemetry["memory_usage"], "disk_usage": telemetry["disk_usage"],
            })
            security = snap.get("security") or {}
            if security.get("pending_updates") is not None:
                await db.device_patches.delete_many({"device_id": device_id, "source": "windows-update-agent", "status": "pending"})
                pending = security.get("pending_updates") or []
                if pending:
                    await db.device_patches.insert_many([{
                        "id": str(uuid.uuid4()), "device_id": device_id,
                        "title": str(patch.get("title") or "Windows Update"),
                        "kb_article": str(patch.get("kb") or ""),
                        "status": "pending", "source": "windows-update-agent",
                        "reboot_required": bool(patch.get("reboot_required")), "detected_at": now,
                    } for patch in pending])
            software = snap.get("software") or []
            if software:
                await db.device_software.delete_many({"device_id": device_id, "source": "nexus-agent"})
                await db.device_software.insert_many([{
                    "id": str(uuid.uuid4()), "device_id": device_id,
                    "name": str(app.get("name") or "Unknown application"),
                    "version": str(app.get("version") or ""),
                    "publisher": str(app.get("publisher") or ""),
                    "install_date": str(app.get("install_date") or ""),
                    "size_mb": float(app.get("size_mb") or 0),
                    "category": "installed_application", "source": "nexus-agent",
                    "last_inventory_at": now,
                } for app in software])
                await db.devices.update_one({"id": device_id}, {"$set": {"installed_software_count": len(software)}})
            # Keep a compact, technician-useful trailÃ¢â‚¬â€not one noisy event per
            # minute. Heartbeat inventory is summarised at most once per hour.
            last_audit = agent.get("last_device_audit_at")
            should_audit = True
            if last_audit:
                try:
                    should_audit = (datetime.now(timezone.utc) - datetime.fromisoformat(str(last_audit).replace("Z", "+00:00"))).total_seconds() >= 3600
                except (TypeError, ValueError):
                    pass
            if should_audit:
                await log_activity(
                    {"id": "nexus-agent", "name": "NexusOps Agent"}, "agent_check_in", "device", device_id,
                    snap.get("hostname") or "Endpoint",
                    f"Inventory check-in: {len(snap.get('software') or [])} applications, {len(snap.get('disks') or [])} drives, {len(snap.get('nics') or [])} adapters.",
                    metadata={"source": "nexus-agent", "security_assessed": bool(snap.get("security")), "pending_updates": (snap.get("security") or {}).get("pending_update_count", 0)},
                )
                await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"last_device_audit_at": now}})
            last_event = agent.get("last_device_event_at")
            should_event = True
            if last_event:
                try:
                    should_event = (datetime.now(timezone.utc) - datetime.fromisoformat(str(last_event).replace("Z", "+00:00"))).total_seconds() >= 3600
                except (TypeError, ValueError):
                    pass
            if should_event:
                security = snap.get("security") or {}
                await db.device_events.insert_one({
                    "id": str(uuid.uuid4()), "device_id": device_id, "event_type": "agent_check_in",
                    "message": f"NexusOps Agent checked in Ã‚Â· CPU {telemetry['cpu_usage']:.0f}% Ã‚Â· memory {telemetry['memory_usage']:.0f}% Ã‚Â· {security.get('pending_update_count', 0)} updates pending.",
                    "severity": "info", "timestamp": now, "source": "nexus-agent",
                })
                await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"last_device_event_at": now}})
    except Exception:
        logger.exception("[nexus-agent] failed to mirror heartbeat into device inventory")

    # Evaluate monitoring rules after the mirrored device telemetry is current.
    # The evaluator owns duration/cooldown state, so regular heartbeats cannot
    # create duplicate alerts or tickets.
    try:
        mirrored = await db.devices.find_one({"nexus_agent_id": agent["id"]}, {"_id": 0, "id": 1})
        if mirrored and mirrored.get("id"):
            from app.routers.alert_rules import evaluate_alert_rules
            await evaluate_alert_rules(device_ids=[mirrored["id"]], create_actions=True, actor="nexus-agent")
    except Exception as exc:
        logger.warning("[nexus-agent] monitoring evaluation failed: %s", exc)

    # Write a heartbeat history row (lightweight Ã¢â‚¬â€ for sparklines)
    try:
        await db.nexus_agent_heartbeats.insert_one({
            "device_id": agent["id"],
            "at": now,
            "cpu_percent": snap.get("cpu_percent", 0),
            "mem_percent": snap.get("mem_percent", 0),
        })
    except Exception:
        pass

    # Auto-update advertisement
    update_info = None
    settings = await db.nexus_agent_settings.find_one({"_id": "settings"}) or {}
    auto_update_enabled = settings.get("auto_update_enabled", True)
    if auto_update_enabled:
        info = _binary_info()
        agent_ver = (p.agent_version or "").strip()
        if info["exists"] and agent_ver and agent_ver != info["version"]:
            update_info = {
                "version": info["version"],
                "url": "/api/nexus-agent/binary/latest",
                "sha256": info["sha256"],
                "size": info["size"],
            }

    return {"ok": True, "update": update_info, "server_time": now}


@router.get("/nexus-agent/commands/poll")
async def commands_poll(x_agent_token: str | None = Header(None)):
    agent = await _verify_agent_token(db, x_agent_token)
    # Read candidates, then atomically claim each one. The status predicate on
    # update prevents overlapping polls from dispatching the same command twice.
    pending = await db.nexus_agent_commands.find({
        "device_id": agent["id"],
        "status": "pending",
    }).to_list(length=20)
    out: list[dict] = []
    for c in pending:
        claimed = await db.nexus_agent_commands.update_one(
            {"_id": c["_id"], "status": "pending"},
            {"$set": {"status": "dispatched", "dispatched_at": _now()}},
        )
        if claimed.modified_count == 1:
            if c.get("script_execution_id"):
                await db.script_executions.update_one({"id": c["script_execution_id"], "status": "pending"}, {"$set": {
                    "status": "running", "started_at": _now(),
                }})
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
    # Maintenance windows queue commands asynchronously; reconcile the window
    # record when the agent returns instead of leaving a permanent "queued".
    try:
        maintenance_run = await db.maintenance_window_runs.find_one({"command_id": res.id}, {"_id": 0, "window_id": 1})
        if maintenance_run:
            run_status = "ok" if res.status == "ok" else "failed"
            await db.maintenance_window_runs.update_one({"command_id": res.id}, {"$set": {
                "status": run_status, "message": f"Agent command {res.status} (exit code {res.exit_code})", "finished_at": _now(),
            }})
            runs = await db.maintenance_window_runs.find({"window_id": maintenance_run["window_id"]}, {"_id": 0, "status": 1}).to_list(500)
            counts = {"queued": 0, "ok": 0, "failed": 0, "skipped": 0}
            for run in runs:
                counts[run.get("status", "skipped")] = counts.get(run.get("status", "skipped"), 0) + 1
            await db.maintenance_windows.update_one({"id": maintenance_run["window_id"]}, {"$set": {"summary_counts": counts, "reconciled_at": _now()}})
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile maintenance command")
    try:
        mirrored = await db.devices.find_one({"nexus_agent_id": agent["id"]}, {"_id": 0, "id": 1, "name": 1})
        command = await db.nexus_agent_commands.find_one({"id": res.id, "device_id": agent["id"]}, {"_id": 0, "kind": 1})
        if mirrored:
            outcome = "completed" if res.status == "ok" else res.status
            await log_activity(
                {"id": "nexus-agent", "name": "NexusOps Agent"}, "agent_command", "device", mirrored["id"], mirrored.get("name", "Endpoint"),
                f"{command.get('kind', 'agent command') if command else 'Agent command'} {outcome} (exit code {res.exit_code}, {res.duration_ms} ms).",
                metadata={"command_id": res.id, "status": res.status, "exit_code": res.exit_code},
            )
            await db.device_events.insert_one({
                "id": str(uuid.uuid4()), "device_id": mirrored["id"], "event_type": "script_executed",
                "message": f"{command.get('kind', 'Agent command') if command else 'Agent command'} {outcome} (exit code {res.exit_code}).",
                "severity": "info" if res.status == "ok" else "error", "timestamp": _now(), "source": "nexus-agent",
            })
    except Exception:
        logger.exception("[nexus-agent] failed to write command audit entry")
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
    for a in agents:
        a.pop("_id", None)
        a["online"] = _is_online(a.get("last_seen"))
    return agents


@router.get("/nexus-agent/agents/{device_id}")
async def get_agent(device_id: str, user=Depends(require_agent_operator)):
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
async def queue_command(device_id: str, req: CommandRequest, user=Depends(require_agent_operator)):
    agent_query: dict[str, Any] = {"id": device_id, "is_active": True}
    if not req.include_offline:
        agent_query["last_seen"] = {"$gte": _online_cutoff()}
    agent = await db.nexus_agents.find_one(agent_query)
    if not agent:
        detail = "agent is offline; set include_offline=true to queue for later" if not req.include_offline else "agent not found"
        raise HTTPException(409 if not req.include_offline else 404, detail)
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
async def agent_commands(
    device_id: str,
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_agent_operator),
):
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
                   "1) Right-click install.bat Ã¢â€ â€™ Run as Administrator\n"
                   "2) Agent will register itself as the 'NexusOpsAgent' Windows service\n"
                   "3) Within 60 seconds the device will appear in NexusOps Ã¢â€ â€™ Devices\n\n"
                   "To remove: run uninstall.bat as Administrator.\n")
    return buf.getvalue()


@router.post("/nexus-agent/installers/build")
async def build_installer(req: InstallerBuildRequest, request: Request, user=Depends(require_agent_operator)):
    client = await db.clients.find_one({"id": req.client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(404, "client not found")

    # Load admin settings for server_url (fallback to request origin)
    settings = await db.nexus_agent_settings.find_one({"_id": "settings"}) or {}
    server_url = str(settings.get("server_url") or "").strip()
    if not server_url:
        host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
        server_url = f"{scheme}://{host}" if host else str(request.base_url)
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

    # Store on local installer storage (with a download token) and record a manifest entry
    download_token = secrets.token_urlsafe(20)
    storage_path = f"{APP_NAME}/agent-installers/{req.client_id}/{download_token}.zip"
    put_result = _storage_put(storage_path, zip_bytes, content_type="application/zip")

    manifest = {
        "id": str(uuid.uuid4()),
        "client_id": req.client_id,
        "client_name": client["name"],
        "enrollment_token": enrollment_token,
        "server_url": server_url,
        "storage_path": storage_path if put_result else "",
        "download_token": download_token,
        "size_bytes": len(zip_bytes),
        "created_at": _now(),
        "created_by": user.get("email") or user.get("id"),
        "agent_version": AGENT_VERSION,
        "is_deleted": False,
    }
    await db.nexus_agent_installers.insert_one(manifest)

    # Keep a direct local request on its real scheme (HTTP in local development),
    # while still respecting the public origin supplied by a reverse proxy.
    api_base = str(request.base_url).rstrip("/")
    fwd_host = request.headers.get("x-forwarded-host")
    fwd_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    if fwd_host:
        api_base = f"{fwd_proto}://{fwd_host}"
    return {
        "id": manifest["id"],
        "download_url": f"{api_base}/api/nexus-agent/installers/{download_token}/download",
        "filename": f"NexusOpsAgent_{client['name'].replace(' ', '_')}.zip",
        "size_bytes": len(zip_bytes),
        "agent_version": AGENT_VERSION,
        "server_url": server_url,
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
            raise HTTPException(500, "agent binary missing Ã¢â‚¬â€ rebuild required")
        zip_bytes = _build_installer_zip(
            client_id=manifest["client_id"],
            client_name=manifest["client_name"],
            enrollment_token=manifest["enrollment_token"],
            server_url=str(manifest.get("server_url") or "").strip(),
            binary_bytes=AGENT_BINARY_PATH.read_bytes(),
        )
    filename = f"NexusOpsAgent_{manifest['client_name'].replace(' ', '_')}.zip"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=zip_bytes, media_type="application/zip", headers=headers)


@router.get("/nexus-agent/installers")
async def list_installers(client_id: str | None = None, user=Depends(require_agent_operator)):
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


@router.get("/nexus-agent/version")
async def version_manifest():
    """Returns the current latest-binary version + SHA256 + size. Used by agents
    for auto-update verification (also embedded in heartbeat responses)."""
    return _binary_info()


# ----------------------------------------------------------------------
# FLEET OPERATIONS Ã¢â‚¬â€ the differentiator surface
# ----------------------------------------------------------------------

@router.get("/nexus-agent/fleet/version-distribution")
async def fleet_version_distribution(user=Depends(get_current_user)):
    """Version-distribution donut data for the Fleet Control Room."""
    pipeline = [
        {"$match": {"is_active": True}},
        {"$group": {"_id": {"$ifNull": ["$agent_version", "unknown"]}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    rows = []
    async for r in db.nexus_agents.aggregate(pipeline):
        rows.append({"version": r["_id"], "count": r["count"]})
    latest = _binary_info()["version"]
    total = sum(r["count"] for r in rows) or 1
    for r in rows:
        r["pct"] = round(r["count"] * 100 / total, 1)
        r["is_latest"] = r["version"] == latest
    return {
        "latest_version": latest,
        "total_agents": sum(r["count"] for r in rows),
        "rows": rows,
    }


@router.get("/nexus-agent/fleet/activity")
async def fleet_activity(
    limit: int = Query(60, ge=1, le=200),
    user=Depends(get_current_user),
):
    """Bloomberg-style ticker of recent fleet events: enrollments + commands +
    heartbeat anomalies. Most-recent first."""
    events: list[dict] = []
    # Recent enrollments
    cur = db.nexus_agent_audit.find({"kind": {"$in": ["enroll", "re-enroll"]}}, {"_id": 0}).sort("at", -1).limit(20)
    async for a in cur:
        p = a.get("payload") or {}
        events.append({
            "kind": "enrollment",
            "label": "ENROLLED" if a["kind"] == "enroll" else "RE-ENROLLED",
            "at": a.get("at"),
            "device_id": p.get("device_id"),
            "hostname": p.get("hostname") or "",
            "client_id": p.get("client_id"),
            "tone": "emerald",
        })
    # Recent commands
    cur = db.nexus_agent_commands.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    async for c in cur:
        events.append({
            "kind": "command",
            "label": (c.get("kind") or "?").upper(),
            "at": c.get("completed_at") or c.get("dispatched_at") or c.get("created_at"),
            "device_id": c.get("device_id"),
            "status": c.get("status"),
            "by": c.get("queued_by"),
            "tone": "emerald" if c.get("status") == "ok" else "rose" if c.get("status") == "error" else "amber" if c.get("status") == "timeout" else "cyan",
        })
    # Use immutable heartbeat rows so the feed represents actual events rather
    # than repeatedly presenting each agent's mutable last_seen value as new.
    cur = db.nexus_agent_heartbeats.find({}, {"_id": 0}).sort("at", -1).limit(20)
    async for heartbeat in cur:
        events.append({
            "kind": "heartbeat",
            "label": "HEARTBEAT",
            "at": heartbeat.get("at"),
            "device_id": heartbeat.get("device_id"),
            "cpu_percent": heartbeat.get("cpu_percent"),
            "mem_percent": heartbeat.get("mem_percent"),
            "tone": "cyan",
        })
    # Hydrate hostname for command events
    ids = list({e.get("device_id") for e in events if e.get("device_id") and not e.get("hostname")})
    if ids:
        host_map = {}
        cur = db.nexus_agents.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "hostname": 1, "client_id": 1})
        async for a in cur:
            host_map[a["id"]] = {"hostname": a.get("hostname"), "client_id": a.get("client_id")}
        for e in events:
            m = host_map.get(e.get("device_id"))
            if m:
                e["hostname"] = e.get("hostname") or m.get("hostname")
                e["client_id"] = e.get("client_id") or m.get("client_id")

    events.sort(key=lambda e: e.get("at") or "", reverse=True)
    return {"events": events[:limit]}


@router.get("/nexus-agent/fleet/recent-enrollments")
async def fleet_recent_enrollments(
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    cur = db.nexus_agents.find({}, {"_id": 0, "agent_token": 0}).sort("enrolled_at", -1).limit(limit)
    rows = await cur.to_list(length=limit)
    agent_ids = [row.get("id") for row in rows if row.get("id")]
    device_ids: dict[str, str] = {}
    if agent_ids:
        devices = db.devices.find(
            {"nexus_agent_id": {"$in": agent_ids}},
            {"_id": 0, "id": 1, "nexus_agent_id": 1},
        )
        async for device in devices:
            if device.get("nexus_agent_id") and device.get("id"):
                device_ids[device["nexus_agent_id"]] = device["id"]
    for row in rows:
        row["online"] = _is_online(row.get("last_seen"))
        row["device_record_id"] = device_ids.get(row.get("id"))
    return rows


class FleetScriptRequest(BaseModel):
    device_ids: list[str] = Field(default_factory=list, max_length=MAX_FLEET_TARGETS)
    client_id: str | None = Field(default=None, max_length=200)  # target every online agent for this client
    shell: Literal["powershell", "cmd", "bash"] = "powershell"
    script: str = Field(min_length=1, max_length=50_000)
    timeout_sec: int = Field(default=120, ge=1, le=900)
    include_offline: bool = False


@router.post("/nexus-agent/fleet/run-script")
async def fleet_run_script(req: FleetScriptRequest, user=Depends(require_agent_operator)):
    """Fan out a single script across many endpoints in parallel.
    Returns a batch_id + the list of queued command IDs so the UI can stream results."""
    if not (req.script or "").strip():
        raise HTTPException(400, "script required")

    base_query: dict[str, Any] = {"is_active": True}
    if not req.include_offline:
        base_query["last_seen"] = {"$gte": _online_cutoff()}

    targets: list[dict] = []
    requested_ids = list(dict.fromkeys(req.device_ids))
    if req.device_ids:
        cur = db.nexus_agents.find(
            {**base_query, "id": {"$in": requested_ids}},
            {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "os": 1, "last_seen": 1},
        )
        targets = await cur.to_list(length=len(requested_ids))
    elif req.client_id:
        cur = db.nexus_agents.find(
            {**base_query, "client_id": req.client_id},
            {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "os": 1, "last_seen": 1},
        )
        targets = await cur.to_list(length=MAX_FLEET_TARGETS + 1)
        if len(targets) > MAX_FLEET_TARGETS:
            raise HTTPException(400, f"fleet scripts are limited to {MAX_FLEET_TARGETS} devices per batch")
    else:
        raise HTTPException(400, "device_ids or client_id required")

    if not targets:
        detail = "No selected agents are currently online" if not req.include_offline else "No active agents matched"
        raise HTTPException(409, detail)

    batch_id = str(uuid.uuid4())
    payload = {"shell": req.shell, "script": req.script, "timeout_sec": req.timeout_sec, "batch_id": batch_id}
    now = _now()
    queued_by = user.get("email") or user.get("id")
    docs: list[dict] = []
    for t in targets:
        cmd_id = str(uuid.uuid4())
        docs.append({
            "id": cmd_id,
            "device_id": t["id"],
            "hostname": t.get("hostname"),
            "kind": "run_script",
            "payload": payload,
            "status": "pending",
            "queued_by": queued_by,
            "created_at": now,
            "batch_id": batch_id,
        })
    try:
        await db.nexus_agent_commands.insert_many(docs, ordered=True)
    except Exception as exc:
        await db.nexus_agent_commands.delete_many({"batch_id": batch_id, "status": "pending"})
        logger.exception("[nexus-agent] failed to queue fleet batch %s", batch_id)
        raise HTTPException(500, "Unable to queue the complete fleet batch") from exc

    cmd_ids = [doc["id"] for doc in docs]
    matched_ids = {target["id"] for target in targets}
    skipped_ids = [device_id for device_id in requested_ids if device_id not in matched_ids]
    await _audit(db, "fleet_script", {
        "batch_id": batch_id,
        "count": len(cmd_ids),
        "skipped_count": len(skipped_ids),
        "shell": req.shell,
        "script_sha256": hashlib.sha256(req.script.encode("utf-8")).hexdigest(),
        "by": queued_by,
    })
    return {
        "batch_id": batch_id,
        "command_ids": cmd_ids,
        "targets": [{"id": t["id"], "hostname": t.get("hostname")} for t in targets],
        "skipped_device_ids": skipped_ids,
    }


@router.get("/nexus-agent/fleet/batch/{batch_id}")
async def fleet_batch_status(batch_id: str, user=Depends(require_agent_operator)):
    cur = db.nexus_agent_commands.find(_batch_scope(batch_id, user), {"_id": 0}).sort("created_at", 1)
    cmds = await cur.to_list(length=MAX_FLEET_TARGETS)
    if not cmds:
        raise HTTPException(404, "batch not found")
    counts = {"pending": 0, "dispatched": 0, "ok": 0, "error": 0, "timeout": 0, "cancelled": 0}
    for c in cmds:
        s = c.get("status", "pending")
        counts[s] = counts.get(s, 0) + 1
    return {"batch_id": batch_id, "total": len(cmds), "counts": counts, "commands": cmds}


@router.post("/nexus-agent/fleet/batch/{batch_id}/cancel")
async def fleet_batch_cancel(batch_id: str, user=Depends(require_agent_operator)):
    scope = _batch_scope(batch_id, user)
    existing = await db.nexus_agent_commands.find_one(scope, {"_id": 1})
    if not existing:
        raise HTTPException(404, "batch not found")
    result = await db.nexus_agent_commands.update_many(
        {**scope, "status": "pending"},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": _now(),
            "cancelled_by": user.get("email") or user.get("id"),
        }},
    )
    # Scripts queued from the Scripting workspace are delivered through this
    # same agent channel. Mirror the real agent result back into the execution
    # history so technicians see completion, exit code and captured output.
    try:
        command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"]},
            {"_id": 0, "script_execution_id": 1, "dispatched_at": 1},
        )
        execution_id = (command or {}).get("script_execution_id")
        if execution_id:
            now = _now()
            final_status = "completed" if res.status == "ok" else ("timeout" if res.status == "timeout" else "failed")
            output = res.stdout or ""
            error_output = res.stderr or ""
            await db.script_executions.update_one({"id": execution_id}, {"$set": {
                "status": final_status,
                "exit_code": res.exit_code,
                "output": output,
                "error_output": error_output,
                "duration_ms": res.duration_ms,
                "duration_seconds": round(res.duration_ms / 1000, 3),
                "started_at": (command or {}).get("dispatched_at") or now,
                "completed_at": now,
            }})
    except Exception:
        logger.exception("[nexus-agent] failed to mirror script execution result")
    await _audit(db, "fleet_script_cancel", {
        "batch_id": batch_id,
        "cancelled_count": result.modified_count,
        "by": user.get("email") or user.get("id"),
    })
    return {"batch_id": batch_id, "cancelled": result.modified_count}


# ----------------------------------------------------------------------
# ADMIN SETTINGS
# ----------------------------------------------------------------------

@router.get("/nexus-agent/settings")
async def get_settings(user=Depends(require_agent_operator)):
    s = await db.nexus_agent_settings.find_one({"_id": "settings"}, {"_id": 0}) or {}
    return {
        "heartbeat_secs": s.get("heartbeat_secs", 60),
        "poll_secs": s.get("poll_secs", 10),
        "server_url": s.get("server_url", ""),
        "splashtop_enabled": s.get("splashtop_enabled", False),
        "splashtop_deploy_code_default": s.get("splashtop_deploy_code_default", ""),
        "auto_update_enabled": s.get("auto_update_enabled", True),
        "winget_enabled": s.get("winget_enabled", False),
        "winget_allowed_ids": s.get("winget_allowed_ids", []),
        "agent_version": AGENT_VERSION,
        "agent_binary_exists": AGENT_BINARY_PATH.exists(),
        "agent_binary_sha256": _binary_info()["sha256"],
        "agent_binary_size": _binary_info()["size"],
    }


@router.put("/nexus-agent/settings")
async def put_settings(payload: NexusAgentSettings, user=Depends(require_agent_operator)):
    await db.nexus_agent_settings.update_one(
        {"_id": "settings"},
        {"$set": {
            "heartbeat_secs": payload.heartbeat_secs,
            "poll_secs": payload.poll_secs,
            "server_url": payload.server_url,
            "splashtop_enabled": payload.splashtop_enabled,
            "splashtop_deploy_code_default": payload.splashtop_deploy_code_default,
            "auto_update_enabled": payload.auto_update_enabled,
            "winget_enabled": payload.winget_enabled,
            "winget_allowed_ids": [item.strip() for item in payload.winget_allowed_ids if item.strip()],
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
    assessed_devices = await db.devices.count_documents({"security_assessed_at": {"$exists": True, "$ne": None}})
    managed_devices = await db.devices.count_documents({})
    assessed_rows = await db.devices.find(
        {"security_assessed_at": {"$exists": True, "$ne": None}}, {"_id": 0, "pending_patches": 1}
    ).to_list(5000)
    pending_updates = sum(int(row.get("pending_patches") or 0) for row in assessed_rows)
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
        "assessed_devices": assessed_devices,
        "managed_devices": managed_devices,
        "pending_updates": pending_updates,
        "by_client": [{"client_id": r["_id"], "count": r["count"]} for r in by_client],
        "agent_version": AGENT_VERSION,
    }
