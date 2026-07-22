"""Audited Nexus Agent command-console sessions.

This is deliberately not a simulated or streaming shell. Commands are queued
to an enrolled online agent and become visible only when that endpoint returns
its actual stdout, stderr and exit code.
"""

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.database import db
from app.routers.nexus_agent import queue_command_for_device, require_agent_operator
from app.services.activity import log_activity


router = APIRouter()
VALID_SHELLS = {"powershell", "cmd"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_admin(user: dict) -> bool:
    return bool(user.get("is_admin") or str(user.get("role") or "").lower() in {"admin", "owner"})


def _session_scope(session_id: str, user: dict) -> dict:
    query = {"id": session_id}
    if not _is_admin(user):
        query["user_id"] = user.get("id")
    return query


@router.get("/device-terminal/sessions")
async def get_terminal_sessions(current_user: dict = Depends(require_agent_operator)):
    query = {} if _is_admin(current_user) else {"user_id": current_user.get("id")}
    return await db.terminal_sessions.find(query, {"_id": 0, "commands": 0}).sort("started_at", -1).to_list(50)


@router.get("/device-terminal/sessions/{session_id}")
async def get_terminal_session(session_id: str, current_user: dict = Depends(require_agent_operator)):
    session = await db.terminal_sessions.find_one(_session_scope(session_id, current_user), {"_id": 0})
    if not session:
        raise HTTPException(404, "Command session not found")
    return session


@router.post("/device-terminal/sessions")
async def create_terminal_session(data: dict, current_user: dict = Depends(require_agent_operator)):
    device_id = str(data.get("device_id") or "").strip()
    shell = str(data.get("session_type") or "powershell").lower()
    if not device_id:
        raise HTTPException(400, "device_id required")
    if shell not in VALID_SHELLS:
        raise HTTPException(400, "Choose PowerShell or CMD for the Nexus Agent command console")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Managed asset not found")
    if not device.get("nexus_agent_id"):
        raise HTTPException(409, "Nexus Agent is not enrolled on this asset")

    session = {
        "id": f"term-{uuid.uuid4().hex[:12]}",
        "device_id": device_id,
        "agent_id": device["nexus_agent_id"],
        "device_name": device.get("name") or "Managed asset",
        "client_name": device.get("client_name") or "",
        "session_type": shell,
        "status": "active",
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email") or "Technician",
        "started_at": _now(),
        "ended_at": None,
        "commands": [],
        "ip_address": device.get("ip_address") or "",
        "os": device.get("os") or "",
    }
    await db.terminal_sessions.insert_one(session)
    await log_activity(current_user, "agent_command_session_opened", "device", device_id, session["device_name"], f"{shell} command console opened", metadata={"session_id": session["id"], "agent_id": session["agent_id"]})
    return session


@router.post("/device-terminal/sessions/{session_id}/execute")
async def execute_command(session_id: str, data: dict, current_user: dict = Depends(require_agent_operator)):
    session = await db.terminal_sessions.find_one(_session_scope(session_id, current_user), {"_id": 0})
    if not session or session.get("status") != "active":
        raise HTTPException(409, "An active command session is required")
    command = str(data.get("command") or "").strip()
    if not command:
        raise HTTPException(400, "Command required")
    if len(command) > 12000:
        raise HTTPException(400, "Command exceeds the 12,000 character limit")

    device = await db.devices.find_one({"id": session["device_id"]}, {"_id": 0})
    if not device or device.get("nexus_agent_id") != session.get("agent_id"):
        raise HTTPException(409, "The asset's Nexus Agent association has changed; open a new command session")

    command_id = await queue_command_for_device(
        device,
        "run_powershell" if session["session_type"] == "powershell" else "run_cmd",
        {"script": command, "command": command, "timeout_sec": 900},
        queued_by=current_user.get("email") or current_user.get("id") or "command-console",
    )
    if not command_id:
        raise HTTPException(409, "Nexus Agent is not available")
    entry = {"id": command_id, "command": command, "status": "queued", "queued_at": _now()}
    await db.terminal_sessions.update_one({"id": session_id}, {"$push": {"commands": entry}, "$set": {"last_command_at": entry["queued_at"]}})
    await db.nexus_agent_commands.update_one({"id": command_id}, {"$set": {"terminal_session_id": session_id, "terminal_command_id": command_id}})
    await log_activity(current_user, "agent_command_queued", "device", device["id"], session["device_name"], command[:240], metadata={"session_id": session_id, "command_id": command_id, "shell": session["session_type"]})
    return {"command_id": command_id, "status": "queued", "message": "Queued for the live Nexus Agent"}


@router.post("/device-terminal/sessions/{session_id}/end")
async def end_terminal_session(session_id: str, current_user: dict = Depends(require_agent_operator)):
    session = await db.terminal_sessions.find_one(_session_scope(session_id, current_user), {"_id": 0})
    if not session:
        raise HTTPException(404, "Command session not found")
    if session.get("status") != "active":
        raise HTTPException(409, "Command session is already closed")
    await db.terminal_sessions.update_one({"id": session_id}, {"$set": {"status": "ended", "ended_at": _now(), "ended_by": current_user.get("id")}})
    await log_activity(current_user, "agent_command_session_closed", "device", session["device_id"], session.get("device_name", ""), "Command console closed", metadata={"session_id": session_id})
    return {"message": "Command session ended"}
