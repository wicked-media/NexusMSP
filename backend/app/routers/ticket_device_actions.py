"""
Ticket → Device action wrappers.

Every action is run against the TRMM agent linked to the ticket's device, and
automatically posts an internal ticket note + audit row so the action is
auditable in-context (rather than buried in a separate TRMM log).

This is the cockpit that turns a ticket into a remote-control panel.
"""

from fastapi import APIRouter, Depends, Body, HTTPException, Query
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


async def _ticket_with_agent(ticket_id: str, device_id: str | None = None) -> tuple[dict, str, dict]:
    """Resolve ticket → linked device → TRMM agent_id.

    If device_id is provided, that explicit device is targeted (must be linked to the
    ticket via device_id or device_ids). Otherwise the ticket's primary device_id is used.
    Raises 404/400 cleanly. Returns (ticket, agent_id, device_doc).
    """
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    primary = ticket.get("device_id")
    linked = list(ticket.get("device_ids") or [])
    if primary and primary not in linked:
        linked.append(primary)
    target_id = device_id or primary
    if not target_id:
        raise HTTPException(400, "This ticket has no device linked. Link a device first.")
    if device_id and device_id not in linked:
        raise HTTPException(400, f"Device {device_id} is not linked to this ticket")
    device = await db.devices.find_one({"id": target_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Linked device not found")
    agent_id = device.get("trmm_agent_id")
    if not agent_id:
        raise HTTPException(400, f"Device '{device.get('hostname') or device.get('name')}' is not linked to a TRMM agent")
    return ticket, agent_id, device


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
async def device_reboot(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, device = await _ticket_with_agent(ticket_id, device_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/reboot/")
    await _audit("reboot", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Reboot triggered", f"{device.get('name', agent_id)} via TRMM")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/shutdown")
async def device_shutdown(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, device = await _ticket_with_agent(ticket_id, device_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/cmd/", json_body={"cmd": "shutdown /s /t 60", "shell": "cmd", "timeout": 60})
    await _audit("shutdown", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Shutdown triggered", f"{device.get('name', agent_id)} · 60s grace")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/wol")
async def device_wake_on_lan(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Wake-on-LAN — TRMM doesn't expose this directly; we log the intent and return 501.
    Implementations can hook this to a LAN agent or UniFi controller separately."""
    _, _agent_id, device = await _ticket_with_agent(ticket_id, device_id)
    await _post_action_note(ticket_id, current_user, "Wake-on-LAN requested", f"{device.get('name','')} — Note: requires a LAN proxy agent — pending integration")
    return {"success": False, "message": "Wake-on-LAN not yet wired to a LAN proxy. Action logged on the ticket."}


@router.post("/tickets/{ticket_id}/device/run-checks")
async def device_run_checks(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, device = await _ticket_with_agent(ticket_id, device_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/runchecks/")
    await _audit("run-checks", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Checks triggered", f"{device.get('name','')} — all monitoring checks running now")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/install-patches")
async def device_install_patches(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, device = await _ticket_with_agent(ticket_id, device_id)
    result = await _trmm_call("POST", f"agents/{agent_id}/installpatches/")
    await _audit("install-patches", agent_id, current_user.get("name"), result)
    await _post_action_note(ticket_id, current_user, "Patch install started", f"{device.get('name','')} — Windows updates installing now")
    return {"success": True, "result": result}


@router.post("/tickets/{ticket_id}/device/send-message")
async def device_send_message(ticket_id: str, payload: dict = Body(...), device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Pop a message on the user's screen via TRMM broadcast (single agent)."""
    _, agent_id, device = await _ticket_with_agent(ticket_id, device_id)
    title = (payload.get("title") or "Message from IT").strip()
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    result = await _trmm_call("POST", "core/sendnotification/", json_body={"agent_ids": [agent_id], "title": title, "message": body})
    await _post_action_note(ticket_id, current_user, "Message sent to user", f"{device.get('name','')} — \"{body[:120]}\"")
    return {"success": True, "result": result}


# ─────────────────────── Remote control ───────────────────────

@router.get("/tickets/{ticket_id}/device/remote-url")
async def device_remote_url(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """One-time MeshCentral URLs for control/terminal/file."""
    _, agent_id, device = await _ticket_with_agent(ticket_id, device_id)
    try:
        result = await _trmm_call("GET", f"agents/{agent_id}/meshcentral/")
        await _post_action_note(ticket_id, current_user, "Remote control session opened", f"{device.get('name','')} — via MeshCentral")
        return {"success": True, "urls": result}
    except HTTPException as e:
        return {"success": False, "message": str(e.detail), "status": e.status_code}


# ─────────────────────── Read endpoints (services / processes / patches) ───────────────────────

@router.get("/tickets/{ticket_id}/device/services")
async def device_services(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, _ = await _ticket_with_agent(ticket_id, device_id)
    return await _trmm_call("GET", f"services/{agent_id}/")


@router.post("/tickets/{ticket_id}/device/services/{service_name}/{action}")
async def device_service_action(ticket_id: str, service_name: str, action: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    if action not in {"start", "stop", "restart"}:
        raise HTTPException(400, "action must be start | stop | restart")
    _, agent_id, _ = await _ticket_with_agent(ticket_id, device_id)
    result = await _trmm_call("POST", f"services/{agent_id}/{service_name}/{action}/")
    await _post_action_note(ticket_id, current_user, f"Service {action}", service_name)
    return {"success": True, "result": result}


@router.get("/tickets/{ticket_id}/device/processes")
async def device_processes(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, _ = await _ticket_with_agent(ticket_id, device_id)
    raw = await _trmm_call("GET", f"agents/{agent_id}/processes/")
    return _data(raw)


@router.post("/tickets/{ticket_id}/device/processes/{pid}/kill")
async def device_kill_process(ticket_id: str, pid: int, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, _ = await _ticket_with_agent(ticket_id, device_id)
    result = await _trmm_call("DELETE", f"agents/{agent_id}/processes/{pid}/")
    await _post_action_note(ticket_id, current_user, "Process killed", f"PID {pid}")
    return {"success": True, "result": result}


@router.get("/tickets/{ticket_id}/device/winupdates")
async def device_winupdates(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, agent_id, _ = await _ticket_with_agent(ticket_id, device_id)
    raw = await _trmm_call("GET", f"winupdate/{agent_id}/")
    return _data(raw)


@router.get("/tickets/{ticket_id}/device/agent")
async def device_agent_summary(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Live agent details — CPU, RAM, disk, uptime, etc."""
    _, agent_id, _ = await _ticket_with_agent(ticket_id, device_id)
    return await _trmm_call("GET", f"agents/{agent_id}/")


@router.get("/tickets/{ticket_id}/device/checks")
async def device_failing_checks(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """All checks for the linked device, with failing ones highlighted."""
    _, agent_id, _ = await _ticket_with_agent(ticket_id, device_id)
    raw = await _trmm_call("GET", f"agents/{agent_id}/checks/")
    return _data(raw)


# ─────────────────────── Linked devices listing (for cockpit) ───────────────────────

@router.get("/tickets/{ticket_id}/devices")
async def list_ticket_devices(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Return every device linked to this ticket with a quick status snapshot."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    primary = ticket.get("device_id")
    ids = list(ticket.get("device_ids") or [])
    if primary and primary not in ids:
        ids.insert(0, primary)
    if not ids:
        return {"primary_id": None, "devices": []}
    cursor = db.devices.find({"id": {"$in": ids}}, {"_id": 0})
    devices = []
    async for d in cursor:
        devices.append({
            "id": d.get("id"),
            "name": d.get("name") or d.get("hostname") or d.get("id"),
            "hostname": d.get("hostname"),
            "status": d.get("status"),
            "os_name": d.get("os_name") or d.get("os"),
            "ip_address": d.get("ip_address"),
            "device_type": d.get("device_type"),
            "last_seen": d.get("last_seen"),
            "trmm_agent_id": d.get("trmm_agent_id"),
            "has_agent": bool(d.get("trmm_agent_id")),
            "is_primary": d.get("id") == primary,
        })
    # Order: primary first, then by name
    devices.sort(key=lambda x: (not x["is_primary"], (x.get("name") or "").lower()))
    return {"primary_id": primary, "devices": devices}
