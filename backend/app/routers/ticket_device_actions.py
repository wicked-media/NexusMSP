"""
Ticket → Device action wrappers.

Every action is queued on the NexusOps Agent linked to the ticket's device, and
automatically posts an internal ticket note + audit row so the action is
auditable in-context.
"""

from fastapi import APIRouter, Depends, Body, HTTPException, Query
from datetime import datetime, timezone
import uuid
import logging
import asyncio

from app.database import db
from app.routers.auth import get_current_user
from app.routers.nexus_agent import queue_command_for_device, _audit as _agent_audit

router = APIRouter()
logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _ticket_with_agent(ticket_id: str, device_id: str | None = None) -> tuple[dict, dict]:
    """Resolve ticket → linked device. Raises 404/400 cleanly. Returns (ticket, device)."""
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
    if not device.get("nexus_agent_id"):
        raise HTTPException(400, f"Device '{device.get('hostname') or device.get('name')}' has no NexusOps Agent installed")
    return ticket, device


async def _post_action_note(ticket_id: str, user: dict, action_label: str, detail: str = ""):
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
    _, device = await _ticket_with_agent(ticket_id, device_id)
    cmd_id = await queue_command_for_device(device, "reboot", {"delay_sec": 30}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Reboot queued", f"{device.get('name')} via NexusOps Agent")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/shutdown")
async def device_shutdown(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, device = await _ticket_with_agent(ticket_id, device_id)
    cmd_id = await queue_command_for_device(device, "shutdown", {"delay_sec": 60}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Shutdown queued", f"{device.get('name')} · 60s grace")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/wol")
async def device_wake_on_lan(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Wake-on-LAN requires a LAN proxy agent — log the intent."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    await _post_action_note(ticket_id, current_user, "Wake-on-LAN requested", f"{device.get('name', '')} — requires LAN proxy agent")
    return {"success": False, "message": "Wake-on-LAN not yet wired to a LAN proxy. Action logged on the ticket."}


@router.post("/tickets/{ticket_id}/device/run-checks")
async def device_run_checks(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Trigger an immediate telemetry refresh (no-op ping at the moment)."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    cmd_id = await queue_command_for_device(device, "ping", {}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Telemetry refresh queued", device.get("name", ""))
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/install-patches")
async def device_install_patches(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, device = await _ticket_with_agent(ticket_id, device_id)
    # Requires PSWindowsUpdate module on the endpoint
    script = "if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) { Install-PackageProvider NuGet -Force; Install-Module PSWindowsUpdate -Force -SkipPublisherCheck }; Import-Module PSWindowsUpdate; Get-WindowsUpdate -Install -AcceptAll -IgnoreReboot"
    cmd_id = await queue_command_for_device(device, "run_script", {"shell": "powershell", "script": script, "timeout_sec": 3600}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Patch install queued", f"{device.get('name','')} — Windows updates")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/send-message")
async def device_send_message(ticket_id: str, payload: dict = Body(...), device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Pop a message on the user's screen via msg.exe."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    title = (payload.get("title") or "Message from IT").strip().replace("'", "")
    body = (payload.get("body") or "").strip().replace("'", "")
    if not body:
        raise HTTPException(400, "body required")
    script = f"msg * /TIME:60 '{title}: {body}'"
    cmd_id = await queue_command_for_device(device, "run_script", {"shell": "powershell", "script": script, "timeout_sec": 30}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Message sent to user", f"{device.get('name','')} — \"{body[:120]}\"")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/run-script")
async def device_run_script(ticket_id: str, payload: dict = Body(...), device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Generic script runner — pass {shell, script, timeout_sec}."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    shell = payload.get("shell", "powershell")
    script = (payload.get("script") or "").strip()
    if not script:
        raise HTTPException(400, "script required")
    timeout = int(payload.get("timeout_sec") or 120)
    cmd_id = await queue_command_for_device(device, "run_script", {"shell": shell, "script": script, "timeout_sec": timeout}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Script queued", f"{device.get('name','')} ({shell})")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/kill-process")
async def device_kill_process(ticket_id: str, payload: dict = Body(...), device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    _, device = await _ticket_with_agent(ticket_id, device_id)
    pid = int(payload.get("pid") or 0)
    if pid <= 0:
        raise HTTPException(400, "pid required")
    cmd_id = await queue_command_for_device(device, "kill_process", {"pid": pid}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Process kill queued", f"PID {pid}")
    return {"success": True, "command_id": cmd_id}


# ─────────────────────── Remote control (Splashtop — Phase 4) ───────────────────────

@router.get("/tickets/{ticket_id}/device/remote-url")
async def device_remote_url(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Splashtop session URL — implementation pending Splashtop API integration."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    await _post_action_note(ticket_id, current_user, "Remote control requested", f"{device.get('name','')} — Splashtop integration pending")
    return {"success": False, "message": "Splashtop integration not yet wired. Coming in Phase 4."}


# ─────────────────────── Linked devices listing (for cockpit) ───────────────────────

@router.get("/tickets/{ticket_id}/devices")
async def list_ticket_devices(ticket_id: str, current_user: dict = Depends(get_current_user)):
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
            "nexus_agent_id": d.get("nexus_agent_id"),
            "has_agent": bool(d.get("nexus_agent_id")),
            "is_primary": d.get("id") == primary,
        })
    devices.sort(key=lambda x: (not x["is_primary"], (x.get("name") or "").lower()))
    return {"primary_id": primary, "devices": devices}


# ─────────────────────── Fan-out ───────────────────────

@router.post("/tickets/{ticket_id}/device/fanout/{action}")
async def device_fanout(ticket_id: str, action: str, payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Run a single action against every linked device that has a NexusOps Agent."""
    allowed = {"run-checks", "install-patches", "reboot", "shutdown", "send-message"}
    if action not in allowed:
        raise HTTPException(400, f"Action must be one of {sorted(allowed)}")

    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    primary = ticket.get("device_id")
    ids = list(ticket.get("device_ids") or [])
    if primary and primary not in ids:
        ids.insert(0, primary)
    if not ids:
        return {"results": [], "summary": {"total": 0, "ok": 0, "failed": 0, "skipped": 0}}

    cursor = db.devices.find({"id": {"$in": ids}}, {"_id": 0})
    targets = [d async for d in cursor]

    async def _run_one(d: dict) -> dict:
        name = d.get("name") or d.get("hostname") or d.get("id")
        if not d.get("nexus_agent_id"):
            return {"device_id": d["id"], "device_name": name, "status": "skipped", "message": "No NexusOps Agent"}
        if action in ("reboot", "shutdown", "send-message") and d.get("status") != "online":
            return {"device_id": d["id"], "device_name": name, "status": "skipped", "message": "Offline"}
        try:
            kind_map = {"reboot": "reboot", "shutdown": "shutdown", "run-checks": "ping", "install-patches": "run_script", "send-message": "run_script"}
            cmd_payload: dict = {}
            if action == "install-patches":
                cmd_payload = {"shell": "powershell", "script": "Get-WindowsUpdate -Install -AcceptAll -IgnoreReboot", "timeout_sec": 3600}
            elif action == "send-message":
                title = (payload.get("title") or "Message from IT").replace("'", "")
                body = (payload.get("body") or "").replace("'", "")
                if not body:
                    return {"device_id": d["id"], "device_name": name, "status": "failed", "message": "body required"}
                cmd_payload = {"shell": "powershell", "script": f"msg * /TIME:60 '{title}: {body}'", "timeout_sec": 30}
            cmd_id = await queue_command_for_device(d, kind_map[action], cmd_payload, current_user.get("email") or "fanout")
            return {"device_id": d["id"], "device_name": name, "status": "ok", "command_id": cmd_id}
        except Exception as e:
            return {"device_id": d["id"], "device_name": name, "status": "failed", "message": str(e)[:200]}

    results = await asyncio.gather(*[_run_one(d) for d in targets])
    ok = sum(1 for r in results if r["status"] == "ok")
    failed = sum(1 for r in results if r["status"] == "failed")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    detail = f"{ok} succeeded · {failed} failed · {skipped} skipped"
    await _post_action_note(ticket_id, current_user, f"Fan-out: {action}", detail)
    return {"action": action, "results": results, "summary": {"total": len(results), "ok": ok, "failed": failed, "skipped": skipped}}
