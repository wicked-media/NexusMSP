from datetime import datetime, timezone
from pathlib import PureWindowsPath
from typing import Any
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException

from app.auth import get_current_user
from app.database import db
from app.routers.nexus_agent import _audit, _is_online, _verify_agent_token

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _write_security_audit(
    action: str,
    entity_id: str,
    metadata: dict[str, Any],
    user: dict[str, Any] | None = None,
) -> None:
    """Keep canary lifecycle events visible in the platform-wide audit trail."""
    actor = user or {"id": "nexus-agent", "name": "Nexus Agent"}
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": actor.get("id") or "nexus-agent",
        "user_name": actor.get("name") or actor.get("email") or "Nexus Agent",
        "action": action,
        "entity_type": "ransomware_canary",
        "entity_id": entity_id,
        "entity_name": "Ransomware canary",
        "metadata": metadata,
        "created_at": _now(),
    })


def _default_canary_path(canary_id: str) -> str:
    return str(PureWindowsPath(r"C:\Users\Public\Documents") / f"NexusMSP-{canary_id}-Canary.txt")


@router.get("/ransomware-canary/status")
async def get_canary_status(current_user: dict = Depends(get_current_user)):
    canaries = await db.ransomware_canaries.find(
        {"deployment_source": "nexus-agent"}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    canary_ids = [item["id"] for item in canaries]
    triggers = await db.canary_triggers.find(
        {"canary_id": {"$in": canary_ids}}, {"_id": 0}
    ).sort("triggered_at", -1).to_list(100) if canary_ids else []
    unresolved = [item for item in triggers if not item.get("resolved")]
    return {
        "summary": {
            "deployed": len(canaries),
            "healthy": sum(1 for item in canaries if item.get("status") == "healthy"),
            "pending": sum(1 for item in canaries if item.get("status") in {"queued", "active"}),
            "triggered": sum(1 for item in canaries if item.get("status") == "triggered"),
            "unresolved": len(unresolved),
        },
        "canaries": canaries,
        "triggers": triggers,
    }


@router.post("/ransomware-canary/deploy")
async def deploy_canary(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    agent_id = str(data.get("agent_id") or "").strip()
    if not agent_id:
        raise HTTPException(400, "Choose an enrolled Nexus Agent")
    agent = await db.nexus_agents.find_one({"id": agent_id, "is_active": True}, {"_id": 0})
    if not agent:
        raise HTTPException(404, "Nexus Agent not found")
    if not _is_online(agent.get("last_seen")):
        raise HTTPException(409, "Nexus Agent is offline; wait for a fresh heartbeat before deploying a canary")
    platform = str(agent.get("os_name") or agent.get("os") or "").lower()
    if platform and "windows" not in platform:
        raise HTTPException(400, "Ransomware canaries are currently supported on Windows Nexus Agents only")
    existing = await db.ransomware_canaries.find_one({
        "agent_id": agent_id,
        "deployment_source": "nexus-agent",
        "status": {"$in": ["queued", "active", "healthy", "triggered"]},
    }, {"_id": 0, "id": 1, "device_name": 1, "status": 1})
    if existing:
        device_name = existing.get("device_name") or agent.get("hostname") or agent_id
        raise HTTPException(
            409,
            f"{device_name} already has an active Nexus Canary ({existing.get('status') or 'registered'})",
        )
    canary_id = f"canary-{uuid.uuid4().hex[:12]}"
    requested_path = str(data.get("file_path") or "").strip() or _default_canary_path(canary_id)
    path = PureWindowsPath(requested_path)
    if not path.is_absolute() or path.suffix.lower() != ".txt":
        raise HTTPException(400, "Canary files must use an absolute Windows .txt path")
    mirrored = await db.devices.find_one({"nexus_agent_id": agent_id}, {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1}) or {}
    canary = {
        "id": canary_id,
        "agent_id": agent_id,
        "device_id": mirrored.get("id") or agent_id,
        "device_name": mirrored.get("name") or agent.get("hostname") or agent_id,
        "client_id": mirrored.get("client_id") or agent.get("client_id"),
        "client_name": mirrored.get("client_name") or agent.get("client_name") or "Unassigned client",
        "file_path": str(path),
        "status": "queued",
        "deployment_source": "nexus-agent",
        "created_at": _now(),
        "created_by": current_user.get("email") or current_user.get("id"),
    }
    command_id = str(uuid.uuid4())
    command = {
        "id": command_id,
        "device_id": agent_id,
        "kind": "canary_deploy",
        "payload": {"canary_id": canary_id, "canary_path": str(path)},
        "status": "pending",
        "queued_by": current_user.get("email") or current_user.get("id"),
        "created_at": _now(),
    }
    await db.ransomware_canaries.insert_one(canary)
    await db.nexus_agent_commands.insert_one(command)
    await _audit(db, "canary_deploy_queued", {"canary_id": canary_id, "device_id": agent_id, "command_id": command_id})
    await _write_security_audit("ransomware_canary_deploy_queued", canary_id, {
        "command_id": command_id,
        "device_id": canary["device_id"],
        "device_name": canary["device_name"],
        "client_id": canary.get("client_id"),
        "client_name": canary.get("client_name"),
        "file_path": canary["file_path"],
    }, current_user)
    return {"canary": canary, "command_id": command_id}


@router.post("/ransomware-canary/agent/events")
async def record_agent_canary_event(data: dict[str, Any], x_agent_token: str | None = Header(None)):
    agent = await _verify_agent_token(db, x_agent_token)
    canary_id = str(data.get("canary_id") or "").strip()
    status = str(data.get("status") or "").strip().lower()
    if not canary_id or status not in {"healthy", "triggered"}:
        raise HTTPException(400, "A valid canary id and state are required")
    canary = await db.ransomware_canaries.find_one(
        {"id": canary_id, "agent_id": agent["id"], "deployment_source": "nexus-agent"}, {"_id": 0}
    )
    if not canary:
        raise HTTPException(404, "Canary is not registered to this Nexus Agent")
    actual_sha = str(data.get("actual_sha256") or "").strip().lower()
    event_at = _now()
    if status == "healthy":
        expected_sha = str(canary.get("expected_sha256") or "").strip().lower()
        if not expected_sha or actual_sha != expected_sha:
            raise HTTPException(400, "Healthy canary events must match the registered fingerprint")
        await db.ransomware_canaries.update_one({"id": canary_id}, {"$set": {
            "status": "healthy", "last_verified": event_at, "last_actual_sha256": actual_sha, "last_event_reason": "",
        }})
        return {"ok": True, "status": "healthy"}
    reason = str(data.get("reason") or "Canary integrity changed").strip()[:500]
    await db.ransomware_canaries.update_one({"id": canary_id}, {"$set": {
        "status": "triggered", "triggered_at": event_at, "last_actual_sha256": actual_sha, "last_event_reason": reason,
    }})
    existing = await db.canary_triggers.find_one({"canary_id": canary_id, "resolved": False}, {"_id": 0})
    if not existing:
        trigger = {
            "id": f"canary-trigger-{uuid.uuid4().hex[:12]}",
            "canary_id": canary_id,
            "agent_id": agent["id"],
            "device_id": canary.get("device_id"),
            "device_name": canary.get("device_name"),
            "client_id": canary.get("client_id"),
            "client_name": canary.get("client_name"),
            "file_path": canary.get("file_path"),
            "triggered_at": event_at,
            "trigger_type": "integrity_changed",
            "reason": reason,
            "resolved": False,
            "auto_isolated": False,
        }
        await db.canary_triggers.insert_one(trigger)
        await _audit(db, "canary_triggered", {"canary_id": canary_id, "device_id": canary.get("device_id"), "reason": reason})
        await _write_security_audit("ransomware_canary_triggered", canary_id, {
            "trigger_id": trigger["id"],
            "device_id": canary.get("device_id"),
            "device_name": canary.get("device_name"),
            "client_id": canary.get("client_id"),
            "client_name": canary.get("client_name"),
            "reason": reason,
        })
    return {"ok": True, "status": "triggered"}


@router.post("/ransomware-canary/triggers/{trigger_id}/resolve")
async def resolve_canary_trigger(trigger_id: str, data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    note = str(data.get("note") or "").strip()
    if len(note) < 8:
        raise HTTPException(400, "Record an investigation note of at least 8 characters")
    trigger = await db.canary_triggers.find_one({"id": trigger_id}, {"_id": 0})
    if not trigger:
        raise HTTPException(404, "Canary alert not found")
    if trigger.get("resolved"):
        raise HTTPException(409, "Canary alert is already resolved")
    await db.canary_triggers.update_one({"id": trigger_id}, {"$set": {
        "resolved": True,
        "resolved_at": _now(),
        "resolved_by": current_user.get("email") or current_user.get("id"),
        "resolution_note": note,
    }})
    await _audit(db, "canary_trigger_resolved", {"trigger_id": trigger_id, "canary_id": trigger.get("canary_id"), "note": note})
    await _write_security_audit("ransomware_canary_trigger_resolved", trigger.get("canary_id") or trigger_id, {
        "trigger_id": trigger_id,
        "device_id": trigger.get("device_id"),
        "client_id": trigger.get("client_id"),
        "note": note,
    }, current_user)
    return {"ok": True}
