from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.action_permissions import require_action
from app.services.scope_permissions import (
    assert_tenant_record_scope,
    platform_tenant_id,
    scope_query,
    tenant_scoped_query,
)
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.platform_foundation import request_correlation_id
from app.services.remote_runtime import (
    REMOTE_POLICY_DEFAULTS,
    end_remote_session_record,
    heartbeat_remote_session,
    mark_remote_session_opened,
    provider_device_id,
    queue_remote_repair,
    remote_health_for_device,
    remote_policy,
    start_remote_session,
)
from app.models import *

router = APIRouter()

NATIVE_REMOTE_HEARTBEAT_STALE_SECONDS = 20


def _native_session_freshness(session: dict) -> dict:
    """Expose derived capture freshness without changing session authority."""
    if session.get("provider") != "nexus" or session.get("status") != "active":
        return {"capture_freshness": "not_active", "capture_age_seconds": None}
    try:
        observed = datetime.fromisoformat(str(session.get("last_heartbeat_at") or "").replace("Z", "+00:00"))
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=timezone.utc)
        age = max(0, int((datetime.now(timezone.utc) - observed).total_seconds()))
    except (TypeError, ValueError):
        return {"capture_freshness": "unknown", "capture_age_seconds": None}
    return {
        "capture_freshness": "fresh" if age <= NATIVE_REMOTE_HEARTBEAT_STALE_SECONDS else "stale",
        "capture_age_seconds": age,
    }


async def _remote_device_in_scope(
    device_id: str,
    current_user: dict,
    *,
    operation: str,
    request: Request | None = None,
) -> dict:
    """Load an endpoint only inside the caller's tenant and client scope."""
    return await assert_tenant_record_scope(
        current_user,
        db.devices,
        device_id,
        operation=operation,
        request=request,
        resource_name="Device",
    )


async def _remote_policy():
    return await remote_policy()


def _device_provider_id(device: dict, provider_id: str) -> Optional[str]:
    if provider_id == "rustdesk":
        return device.get("rustdesk_id")
    ids = device.get("remote_provider_ids") or {}
    return ids.get(provider_id) or device.get(f"{provider_id}_id") or device.get(f"{provider_id}_uuid")


@router.get("/remote-access/policy")
async def get_remote_access_policy(current_user: dict = Depends(get_current_user)):
    return await _remote_policy()


@router.put("/remote-access/policy", dependencies=[Depends(require_action("device.remote.configure"))])
async def save_remote_access_policy(data: dict, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not user or (user.get("role") != "admin" and not user.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    allowed = {
        "default_provider",
        "allow_fallback",
        "require_consent",
        "allow_standing_authorisation",
        "require_ticket_reference",
        "auto_create_time_entry",
        "auto_ticket_note",
        "auto_repair",
        "repair_cooldown_minutes",
    }
    updates = {key: value for key, value in data.items() if key in allowed}
    if updates.get("default_provider") not in (None, "nexus"):
        raise HTTPException(status_code=422, detail="Nexus Native is the only supported remote provider")
    updates.update({"type": "remote_access_policy", "updated_at": datetime.now(timezone.utc).isoformat()})
    await db.settings.update_one({"type": "remote_access_policy"}, {"$set": updates}, upsert=True)
    await log_activity(
        current_user,
        "remote_policy_updated",
        "settings",
        "remote_access_policy",
        "Nexus Remote",
        "Updated governed remote-access policy",
        metadata={"updated_fields": sorted(key for key in updates if key not in {"type", "updated_at"})},
    )
    return await _remote_policy()


@router.get("/devices/{device_id}/remote-options")
async def get_device_remote_options(device_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.remote.view",
        request=request,
    )
    policy = await _remote_policy()
    assigned = "nexus"
    provider_device_identifier = await provider_device_id(device, "nexus")
    from app.services.native_remote import device_readiness
    readiness = await device_readiness(device, platform_tenant_id(current_user))
    providers = [{
        "id": "nexus",
        "name": "Nexus Native",
        "active": True,
        "assigned": True,
        "selected": True,
        "device_identifier": provider_device_identifier,
        "ready": bool(readiness.get("ready")),
        "reason": None if readiness.get("ready") else readiness.get("detail"),
        "state": readiness.get("state"),
        "unattended_enabled": bool(device.get("remote_unattended_access_enabled")),
        "unattended_ready": bool(readiness.get("unattended_ready")),
    }]
    return {"device_id": device_id, "assigned_provider": assigned, "policy": policy, "providers": providers}


@router.put("/devices/{device_id}/remote-access", dependencies=[Depends(require_action("device.remote.configure"))])
async def save_device_remote_access(device_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    provider = data.get("remote_provider", "nexus")
    if provider not in ("inherit", "nexus"):
        raise HTTPException(status_code=422, detail="Third-party remote providers are retired")
    now = datetime.now(timezone.utc).isoformat()
    updates = {
        "remote_provider": provider,
        "remote_access_updated_at": now,
    }
    if "unattended_access_enabled" in data:
        requested = data["unattended_access_enabled"]
        if not isinstance(requested, bool):
            raise HTTPException(status_code=422, detail="Unattended access must be a boolean setting")
        if requested and data.get("standing_authorisation_acknowledged") is not True:
            raise HTTPException(status_code=422, detail="Confirm standing authorisation before enabling unattended access")
        updates.update({
            "remote_unattended_access_enabled": requested,
            "remote_unattended_access_updated_at": now,
            "remote_unattended_access_updated_by": str(current_user.get("id") or ""),
        })
    await db.devices.update_one({"id": device_id}, {"$set": updates})
    await log_activity(
        current_user,
        "remote_device_configured",
        "device",
        device_id,
        device.get("name", ""),
        f"Remote provider assignment changed to {provider}",
        metadata={"remote_provider": provider, "unattended_access_enabled": updates.get("remote_unattended_access_enabled")},
    )
    return await get_device_remote_options(device_id, request, current_user)


@router.post("/devices/{device_id}/remote-sessions/start", dependencies=[Depends(require_action("device.remote.start"))])
async def start_provider_remote_session(device_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.remote.start",
        request=request,
    )
    return await start_remote_session(
        device=device,
        user=current_user,
        data=data,
        correlation_id=request_correlation_id(request),
    )

# ============== NEXUS NATIVE REMOTE COMPATIBILITY ENDPOINTS ==============

@router.get("/remote/status")
async def get_remote_status(current_user: dict = Depends(get_current_user)):
    return {"configured": True, "provider": "nexus", "native": True}

@router.post(
    "/remote/settings",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def save_remote_settings(settings: dict, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="External transport settings are retired. Nexus Native uses the enrolled Nexus Agent.",
    )

@router.get("/remote/settings")
async def get_remote_settings(current_user: dict = Depends(get_current_user)):
    return {"configured": True, "provider": "nexus", "native": True, "settings_managed_by": "nexus_agent"}

@router.get("/remote/agents")
async def get_remote_agents(current_user: dict = Depends(get_current_user)):
    """The first-party capability ships only through the enrolled Nexus Agent."""
    return [{
        "id": "nexus-agent",
        "name": "Nexus Agent with Remote Companion",
        "provider": "nexus",
        "download_url": None,
        "manage_url": "/nexus-agent",
        "instructions": "Build and deploy the signed Nexus Agent package, then confirm native_remote_v1 readiness.",
    }]



@router.post("/remote/sessions", dependencies=[Depends(require_action("device.remote.start"))])
async def create_remote_session(device_id: str, request: Request, session_type: str = "remote_desktop", current_user: dict = Depends(get_current_user)):
    """Retired bypass retained as an explicit migration response."""
    raise HTTPException(
        status_code=410,
        detail=(
            "This legacy session endpoint is retired because it bypassed consent and provider evidence. "
            f"Use POST /devices/{device_id}/remote-sessions/start."
        ),
    )

@router.get("/remote/sessions")
async def get_remote_sessions(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = scope_query(current_user)
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    if user_id:
        query["user_id"] = user_id
    
    sessions = await db.remote_sessions.find(
        tenant_scoped_query(current_user, query), {"_id": 0}
    ).sort("started_at", -1).to_list(200)
    return [{**session, **_native_session_freshness(session)} for session in sessions]

@router.get("/remote/active-sessions")
async def get_active_remote_sessions(current_user: dict = Depends(get_current_user)):
    """Get all currently active remote sessions"""
    query = tenant_scoped_query(
        current_user,
        {**scope_query(current_user), "status": {"$in": ["authorised", "active", "ending"]}},
    )
    sessions = await db.remote_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(100)
    # Calculate live duration for active sessions
    now = datetime.now(timezone.utc)
    for s in sessions:
        try:
            started = datetime.fromisoformat(str(s["started_at"]).replace("Z", "+00:00"))
            s["live_duration_minutes"] = int((now - started).total_seconds() / 60)
        except:
            s["live_duration_minutes"] = 0
        s.update(_native_session_freshness(s))
    return sessions

@router.post("/remote/sessions/{session_id}/opened")
async def confirm_remote_session_opened(
    session_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    session = await assert_tenant_record_scope(
        current_user,
        db.remote_sessions,
        session_id,
        operation="device.remote.start",
        request=request,
        resource_name="Remote session",
    )
    return await mark_remote_session_opened(
        session,
        current_user,
        correlation_id=request_correlation_id(request),
    )


@router.post("/remote/sessions/{session_id}/heartbeat")
async def remote_session_heartbeat(
    session_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    session = await assert_tenant_record_scope(
        current_user,
        db.remote_sessions,
        session_id,
        operation="device.remote.start",
        request=request,
        resource_name="Remote session",
    )
    return await heartbeat_remote_session(session, current_user)


@router.put(
    "/remote/sessions/{session_id}/end",
    dependencies=[Depends(require_action("device.remote.end"))],
)
async def end_remote_session(
    session_id: str,
    request: Request,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    session = await assert_tenant_record_scope(
        current_user,
        db.remote_sessions,
        session_id,
        operation="device.remote.end",
        request=request,
        resource_name="Remote session",
    )
    return await end_remote_session_record(
        session=session,
        user=current_user,
        data=data or {},
        correlation_id=request_correlation_id(request),
    )

@router.get("/devices/{device_id}/remote-sessions")
async def get_device_remote_sessions(device_id: str, request: Request, limit: int = 50, current_user: dict = Depends(get_current_user)):
    """Get remote session history for a specific device"""
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.remote.view",
        request=request,
    )
    sessions = await db.remote_sessions.find(
        tenant_scoped_query(
            current_user,
            {"device_id": device_id, "client_id": device.get("client_id")},
        ),
        {"_id": 0},
    ).sort("started_at", -1).to_list(limit)
    active_count = sum(1 for s in sessions if s.get("status") in {"authorised", "active", "ending"})
    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions if s.get("status") == "ended")
    return {
        "sessions": sessions,
        "active_count": active_count,
        "total_sessions": len(sessions),
        "total_minutes": total_minutes,
    }


@router.get("/devices/{device_id}/remote-health")
async def get_device_remote_health(
    device_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.remote.health",
        request=request,
    )
    return await remote_health_for_device(device)


@router.post(
    "/devices/{device_id}/remote-repair",
    dependencies=[Depends(require_action("device.remote.repair"))],
)
async def repair_device_remote_access(
    device_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.remote.repair",
        request=request,
    )
    return await queue_remote_repair(
        device=device,
        user=current_user,
        reason=str(data.get("reason") or "Technician requested remote-access repair"),
    )

@router.get("/technicians/{tech_id}/remote-sessions")
async def get_technician_remote_sessions(tech_id: str, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get remote session history for a specific technician"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin") and current_user["id"] != tech_id):
        raise HTTPException(status_code=403, detail="Admin access required")
    sessions = await db.remote_sessions.find(
        tenant_scoped_query(current_user, {**scope_query(current_user), "user_id": tech_id}),
        {"_id": 0},
    ).sort("started_at", -1).to_list(limit)
    active_count = sum(1 for s in sessions if s.get("status") in {"authorised", "active", "ending"})
    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions if s.get("status") == "ended")
    unique_devices = len(set(s.get("device_id") for s in sessions))
    return {
        "sessions": sessions,
        "active_count": active_count,
        "total_sessions": len(sessions),
        "total_minutes": total_minutes,
        "unique_devices": unique_devices,
    }

# ============== DEVICE CHAT ENDPOINTS ==============

@router.get("/devices/{device_id}/chat")
async def get_device_chat(device_id: str, limit: int = 100, current_user: dict = Depends(get_current_user)):
    """Get chat messages for a device"""
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.chat.read",
    )
    messages = await db.device_chat.find(
        tenant_scoped_query(
            current_user,
            {"device_id": device_id, "client_id": device.get("client_id")},
        ),
        {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    
    return {"device": device, "messages": list(reversed(messages))}

@router.post("/devices/{device_id}/chat")
async def send_device_chat_message(device_id: str, message_data: DeviceChatMessageCreate, current_user: dict = Depends(get_current_user)):
    """Send a chat message to a device"""
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.chat.send",
    )
    chat_message = DeviceChatMessage(
        device_id=device_id,
        device_name=device.get('name'),
        client_id=device.get('client_id'),
        client_name=device.get('client_name'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        message=message_data.message,
        message_type=message_data.message_type,
        direction="outbound"
    )
    doc = chat_message.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc["tenant_id"] = platform_tenant_id(current_user)
    await db.device_chat.insert_one(doc)
    
    return chat_message

@router.post(
    "/devices/{device_id}/chat/command",
    dependencies=[Depends(require_action("device.command.execute"))],
)
async def send_device_command(device_id: str, command: str, current_user: dict = Depends(get_current_user)):
    """Retire the simulated command composer in favour of Nexus Terminal."""
    raise HTTPException(
        status_code=410,
        detail="Device Chat commands are retired; use Nexus Terminal & Files for an audited Nexus Agent command session.",
    )

@router.post("/devices/{device_id}/chat/file")
async def send_device_file(device_id: str, filename: str, file_url: str, current_user: dict = Depends(get_current_user)):
    """Retire the ungoverned URL-based transfer shim.

    Files must be staged through the enrolled Nexus Agent so the server can
    scan, bind and audit the artifact before an endpoint can retrieve it.
    """
    raise HTTPException(
        status_code=410,
        detail="URL-based device chat transfers are retired; use the governed Nexus Agent file-transfer workflow.",
    )

@router.delete("/devices/{device_id}/chat")
async def clear_device_chat(device_id: str, current_user: dict = Depends(get_current_user)):
    """Clear chat history for a device"""
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.chat.clear",
    )
    result = await db.device_chat.delete_many(
        tenant_scoped_query(
            current_user,
            {"device_id": device_id, "client_id": device.get("client_id")},
        )
    )
    return {"message": f"Cleared {result.deleted_count} messages"}

