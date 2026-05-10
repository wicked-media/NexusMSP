"""
Ticket → Device action wrappers.

Every action is run against the TRMM agent linked to the ticket's device, and
automatically posts an internal ticket note + audit row so the action is
auditable in-context (rather than buried in a separate TRMM log).

This is the cockpit that turns a ticket into a remote-control panel.
"""

from fastapi import APIRouter, Depends, Body, HTTPException
from datetime import datetime, timezone
import uuid
import logging

from app.database import db
from app.routers.auth import get_current_user
from app.routers.tactical_rmm import _trmm_call, _data, _audit

router = APIRouter()
logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _ticket_with_agent(ticket_id: str) -> tuple[dict, str]:
    """Resolve ticket → linked device → TRMM agent_id. Raises 404/400 cleanly."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    device_id = ticket.get("device_id")
    if not device_id:
        raise HTTPException(400, "This ticket has no device linked. Link a device first.")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Linked device not found")
    agent_id = device.get("trmm_agent_id")
    if not agent_id:
        raise HTTPException(400, f"Device '{device.get('hostname') or device.get('name')}' is not linked to a TRMM agent")
    return ticket, agent_id


async def _post_action_note(ticket_id: str, user: dict, action_label: str, detail: str = ""):
    """Append an internal note + audit row so the action is visible in the conversation timeline."""
    body = f"⚙️ **{action_label}**" + (f" — {detail}" if detail else "")
    await db.ticket_notes.insert_one({
        "id": uuid.uuid4().hex,
        "ticket_id": ticket_id,
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "content": body,
        "is_internal": True,
        "is_system_action": True,
        "created_at": _now(),
    })
    await db.ticket_audit.insert_one({
        "id": uuid.uuid4().hex,
        "ticket_id": ticket_id,
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "action": "device_action",
        "details": f"{action_label}{(' — ' + detail) if detail else ''}",
        "created_at": _now(),
    })


# ─────────────────────── Power actions ───────────────────────

@router.post("/tickets/{ticket_id}/device/reboot")
async def device_reboot(ticket_id: str, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/reboot/")
    await _audit("reboot", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Reboot triggered", "via TRMM")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/shutdown")
async def device_shutdown(ticket_id: str, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/cmd/", json_body={"cmd": "shutdown /s /t 60", "shell": "cmd", "timeout": 60})
    await _audit("shutdown", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Shutdown triggered", "60s grace via TRMM")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/wol")
async def device_wake_on_lan(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Wake-on-LAN — TRMM doesn't expose this directly; we log the intent and return 501.
    Implementations can hook this to a LAN agent or UniFi controller separately."""
    ticket, agent_id = await _ticket_with_agent(ticket_id)
    await _post_action_note(ticket_id, current_user, "Wake-on-LAN requested", "Note: requires a LAN proxy agent — pending integration")
    return {"success": False, "message": "Wake-on-LAN not yet wired to a LAN proxy. Action logged on the ticket."}


@router.post("/tickets/{ticket_id}/device/run-checks")
async def device_run_checks(ticket_id: str, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/runchecks/")
    await _audit("run-checks", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Checks triggered", "all monitoring checks running now")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/install-patches")
async def device_install_patches(ticket_id: str, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/installpatches/")
    await _audit("install-patches", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Patch install started", "Windows updates installing now")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/send-message")
async def device_send_message(ticket_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Pop a message on the user's screen via TRMM broadcast (single agent)."""
    _, agent_id = await _ticket_with_agent(ticket_id)
    title = (payload.get("title") or "Message from IT").strip()
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    result = await _trmm_call("POST", "core/sendnotification/", json_body={"agent_ids": [agent_id], "title": title, "message": body})
    await _post_action_note(ticket_id, current_user, "Message sent to user", f"\"{body[:120]}\"")
    return {"success": True, "result": result}


# ─────────────────────── Remote control ───────────────────────

@router.get("/tickets/{ticket_id}/device/remote-url")
async def device_remote_url(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """One-time MeshCentral URLs for control/terminal/file."""
    ticket, agent_id = await _ticket_with_agent(ticket_id)
    try:
        result = await _trmm_call("GET", f"agents/{agent_id}/meshcentral/")
        await _post_action_note(ticket_id, current_user, "Remote control session opened", "via MeshCentral")
        return {"success": True, "urls": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


# ─────────────────────── Read endpoints (services / processes / patches) ───────────────────────

@router.get("/tickets/{ticket_id}/device/services")
async def device_services(ticket_id: str, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    return await _trmm_call("GET", f"services/{agent_id}/")


@router.post("/tickets/{ticket_id}/device/services/{service_name}/{action}")
async def device_service_action(ticket_id: str, service_name: str, action: str, current_user: dict = Depends(get_current_user)):
    if action not in {"start", "stop", "restart"}:
        raise HTTPException(400, "action must be start | stop | restart")
    _, agent_id = await _ticket_with_agent(ticket_id)
    result = await _trmm_call("POST", f"services/{agent_id}/{service_name}/{action}/")
    await _post_action_note(ticket_id, current_user, f"Service {action}", service_name)
    return {"success": True, "result": result}


@router.get("/tickets/{ticket_id}/device/processes")
async def device_processes(ticket_id: str, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    raw = await _trmm_call("GET", f"agents/{agent_id}/processes/")
    return _data(raw)


@router.post("/tickets/{ticket_id}/device/processes/{pid}/kill")
async def device_kill_process(ticket_id: str, pid: int, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    result = await _trmm_call("DELETE", f"agents/{agent_id}/processes/{pid}/")
    await _post_action_note(ticket_id, current_user, "Process killed", f"PID {pid}")
    return {"success": True, "result": result}


@router.get("/tickets/{ticket_id}/device/winupdates")
async def device_winupdates(ticket_id: str, current_user: dict = Depends(get_current_user)):
    _, agent_id = await _ticket_with_agent(ticket_id)
    raw = await _trmm_call("GET", f"winupdate/{agent_id}/")
    return _data(raw)


@router.get("/tickets/{ticket_id}/device/agent")
async def device_agent_summary(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Live agent details — CPU, RAM, disk, uptime, etc."""
    _, agent_id = await _ticket_with_agent(ticket_id)
    return await _trmm_call("GET", f"agents/{agent_id}/")


@router.get("/tickets/{ticket_id}/device/checks")
async def device_failing_checks(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """All checks for the linked device, with failing ones highlighted."""
    _, agent_id = await _ticket_with_agent(ticket_id)
    raw = await _trmm_call("GET", f"agents/{agent_id}/checks/")
    return _data(raw)
