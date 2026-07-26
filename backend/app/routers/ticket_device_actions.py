"""
Ticket → Device action wrappers.

Every action is queued on the NexusOps Agent linked to the ticket's device, and
automatically posts an internal ticket note + audit row so the action is
auditable in-context.
"""

from fastapi import APIRouter, Depends, Body, HTTPException, Query, Request
from datetime import datetime, timezone
import uuid
import logging
import asyncio

from app.database import db
from app.routers.auth import get_current_user
from app.routers.nexus_agent import queue_command_for_device, require_agent_operator, _audit as _agent_audit
from app.services.action_permissions import require_action
from app.services.platform_foundation import request_correlation_id
from app.services.remote_runtime import start_remote_session
from app.services.scope_permissions import assert_client_scope

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
    # Keep device actions alongside all other ticket activity for the Audit tab.
    await db.ticket_audit_log.insert_one({
        "id": uuid.uuid4().hex,
        "ticket_id": ticket_id,
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "action": "device_action",
        "details": f"{action_label}{(' — ' + detail) if detail else ''}",
        "created_at": _now(),
    })


# ─────────────────────── Power actions ───────────────────────

@router.post("/tickets/{ticket_id}/device/reboot", dependencies=[Depends(require_action("device.command.execute"))])
async def device_reboot(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(require_agent_operator)):
    _, device = await _ticket_with_agent(ticket_id, device_id)
    cmd_id = await queue_command_for_device(device, "reboot", {"delay_sec": 30}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Reboot queued", f"{device.get('name')} via NexusOps Agent")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/shutdown", dependencies=[Depends(require_action("device.command.execute"))])
async def device_shutdown(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(require_agent_operator)):
    _, device = await _ticket_with_agent(ticket_id, device_id)
    cmd_id = await queue_command_for_device(device, "shutdown", {"delay_sec": 60}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Shutdown queued", f"{device.get('name')} · 60s grace")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/wol", dependencies=[Depends(require_action("device.command.execute"))])
async def device_wake_on_lan(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Wake-on-LAN requires a LAN proxy agent — log the intent."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    await _post_action_note(ticket_id, current_user, "Wake-on-LAN requested", f"{device.get('name', '')} — requires LAN proxy agent")
    return {"success": False, "message": "Wake-on-LAN not yet wired to a LAN proxy. Action logged on the ticket."}


@router.post("/tickets/{ticket_id}/device/run-checks", dependencies=[Depends(require_action("device.command.execute"))])
async def device_run_checks(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(require_agent_operator)):
    """Trigger an immediate telemetry refresh (no-op ping at the moment)."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    cmd_id = await queue_command_for_device(device, "ping", {}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Telemetry refresh queued", device.get("name", ""))
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/install-patches", dependencies=[Depends(require_action("device.command.execute"))])
async def device_install_patches(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(require_agent_operator)):
    _, device = await _ticket_with_agent(ticket_id, device_id)
    # Requires PSWindowsUpdate module on the endpoint
    script = "if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) { Install-PackageProvider NuGet -Force; Install-Module PSWindowsUpdate -Force -SkipPublisherCheck }; Import-Module PSWindowsUpdate; Get-WindowsUpdate -Install -AcceptAll -IgnoreReboot"
    cmd_id = await queue_command_for_device(device, "run_script", {"shell": "powershell", "script": script, "timeout_sec": 3600}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Patch install queued", f"{device.get('name','')} — Windows updates")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/send-message", dependencies=[Depends(require_action("device.command.execute"))])
async def device_send_message(ticket_id: str, payload: dict = Body(...), device_id: str | None = Query(None), current_user: dict = Depends(require_agent_operator)):
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


@router.post("/tickets/{ticket_id}/device/run-script", dependencies=[Depends(require_action("device.command.execute"))])
async def device_run_script(ticket_id: str, payload: dict = Body(...), device_id: str | None = Query(None), current_user: dict = Depends(require_agent_operator)):
    """Generic script runner — pass {shell, script, timeout_sec}."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    shell = payload.get("shell", "powershell")
    script = (payload.get("script") or "").strip()
    if not script:
        raise HTTPException(400, "script required")
    if shell not in {"powershell", "cmd", "bash"}:
        raise HTTPException(400, "shell must be powershell, cmd, or bash")
    if len(script) > 50_000:
        raise HTTPException(400, "script is limited to 50000 characters")
    timeout = int(payload.get("timeout_sec") or 120)
    if timeout < 1 or timeout > 900:
        raise HTTPException(400, "timeout_sec must be between 1 and 900")
    cmd_id = await queue_command_for_device(device, "run_script", {"shell": shell, "script": script, "timeout_sec": timeout}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Script queued", f"{device.get('name','')} ({shell})")
    return {"success": True, "command_id": cmd_id}


@router.post("/tickets/{ticket_id}/device/kill-process", dependencies=[Depends(require_action("device.command.execute"))])
async def device_kill_process(ticket_id: str, payload: dict = Body(...), device_id: str | None = Query(None), current_user: dict = Depends(require_agent_operator)):
    _, device = await _ticket_with_agent(ticket_id, device_id)
    pid = int(payload.get("pid") or 0)
    if pid <= 0:
        raise HTTPException(400, "pid required")
    cmd_id = await queue_command_for_device(device, "kill_process", {"pid": pid}, current_user.get("email") or "system")
    await _post_action_note(ticket_id, current_user, "Process kill queued", f"PID {pid}")
    return {"success": True, "command_id": cmd_id}


# ─────────────────────── Remote control (Splashtop — Phase 4) ───────────────────────

@router.get("/tickets/{ticket_id}/device/legacy-remote-url", include_in_schema=False)
async def device_remote_url(ticket_id: str, device_id: str | None = Query(None), current_user: dict = Depends(get_current_user)):
    """Splashtop session URL — implementation pending Splashtop API integration."""
    _, device = await _ticket_with_agent(ticket_id, device_id)
    await _post_action_note(ticket_id, current_user, "Remote control requested", f"{device.get('name','')} — Splashtop integration pending")
    return {"success": False, "message": "Splashtop integration not yet wired. Coming in Phase 4."}


@router.get("/tickets/{ticket_id}/device/remote-url")
async def governed_device_remote_url(ticket_id: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Use the linked asset Remote action so consent and session evidence are captured.",
    )


@router.post("/tickets/{ticket_id}/devices/{device_id}/legacy-remote-connect", include_in_schema=False)
async def ticket_device_remote_connect(ticket_id: str, device_id: str, current_user: dict = Depends(get_current_user)):
    raise HTTPException(status_code=410, detail="Legacy remote launch is retired; use the governed Remote action")
    """Create an auditable RustDesk connection from a linked ticket asset.

    This deliberately does not require the NexusOps Agent: a managed asset can
    still be remoted through its configured RustDesk identity.
    """
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    linked = list(ticket.get("device_ids") or [])
    if ticket.get("device_id") and ticket["device_id"] not in linked:
        linked.append(ticket["device_id"])
    if device_id not in linked:
        raise HTTPException(400, "Device is not linked to this ticket")

    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Linked device not found")
    mapping = await db.rustdesk_devices.find_one({"linked_device_id": device_id}, {"_id": 0})
    rustdesk_id = (device.get("rustdesk_id") or (mapping or {}).get("rustdesk_id") or "").strip()
    if not rustdesk_id:
        raise HTTPException(409, "No RustDesk identity is configured for this asset")

    config_row = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0})
    config = (config_row or {}).get("value") or {}
    relay = str(config.get("relay_server") or config.get("server_url") or "").strip().rstrip("/")
    relay_host = relay.replace("https://", "").replace("http://", "").split("/")[0].split(":")[0]
    connection_url = f"rustdesk://{rustdesk_id}@{relay_host}" if relay_host else f"rustdesk://{rustdesk_id}"

    await db.rustdesk_sessions.insert_one({
        "id": uuid.uuid4().hex,
        "device_id": device_id,
        "client_id": device.get("client_id") or ticket.get("client_id"),
        "ticket_id": ticket_id,
        "rustdesk_id": rustdesk_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "status": "initiated",
        "started_at": _now(),
        "ended_at": None,
    })
    await _post_action_note(ticket_id, current_user, "Remote session initiated", f"{device.get('name') or device.get('hostname') or device_id} via RustDesk")
    return {
        "success": True,
        "device_name": device.get("name") or device.get("hostname") or device_id,
        "rustdesk_id": rustdesk_id,
        "connection_url": connection_url,
        "web_client_url": str(config.get("server_url") or "").strip() or None,
        "relay_server": relay_host or None,
    }


@router.post(
    "/tickets/{ticket_id}/devices/{device_id}/remote-connect",
    dependencies=[Depends(require_action("device.remote.start"))],
)
async def governed_ticket_device_remote_connect(
    ticket_id: str,
    device_id: str,
    request: Request,
    payload: dict | None = Body(default=None),
    current_user: dict = Depends(get_current_user),
):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    linked = {str(item) for item in (ticket.get("device_ids") or []) if item}
    if ticket.get("device_id"):
        linked.add(str(ticket["device_id"]))
    if device_id not in linked:
        raise HTTPException(400, "Device is not linked to this ticket")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Linked device not found")
    await assert_client_scope(
        current_user,
        device.get("client_id") or ticket.get("client_id"),
        site_id=device.get("site_id"),
        operation="device.remote.start",
        request=request,
    )
    data = {
        **(payload or {}),
        "ticket_id": ticket_id,
        "purpose": (payload or {}).get("purpose")
        or f"Support for ticket {ticket.get('ticket_number') or ticket_id}",
    }
    result = await start_remote_session(
        device=device,
        user=current_user,
        data=data,
        correlation_id=request_correlation_id(request),
    )
    return {
        "success": True,
        "device_name": device.get("name") or device.get("hostname") or device_id,
        **result,
    }


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

@router.post("/tickets/{ticket_id}/device/fanout/{action}", dependencies=[Depends(require_action("device.command.execute"))])
async def device_fanout(ticket_id: str, action: str, payload: dict = Body(default={}), current_user: dict = Depends(require_agent_operator)):
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
