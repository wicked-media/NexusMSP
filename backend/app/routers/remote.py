from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional, Any
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.scope_permissions import (
    assert_tenant_record_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)
from app.services.activity import log_activity
from app.services.platform_foundation import request_correlation_id
from app.services.remote_runtime import (
    end_remote_session_record,
    heartbeat_remote_session,
    mark_remote_session_opened,
    provider_device_id,
    queue_remote_repair,
    remote_health_for_device,
    remote_policy,
    start_remote_session,
)
from app.services.native_remote import expire_overdue_grants, fleet_device_readiness
from app.models import *

router = APIRouter()

NATIVE_REMOTE_HEARTBEAT_STALE_SECONDS = 20

# Session risk is an explainable read of the governed session record, never a
# second source of authority: it adds no evidence, it only cites what the
# session already recorded so a technician can act on the list, not a number.
# Business hours are evaluated in UTC and are deliberately explicit.
NATIVE_REMOTE_BUSINESS_HOURS_UTC = (7, 19)
NATIVE_REMOTE_LONG_SESSION_MINUTES = 120
NATIVE_REMOTE_GENERIC_PURPOSE = "technician support session"
NATIVE_REMOTE_STEP_UP_SCORE = 50
NATIVE_REMOTE_READINESS_LABELS = {
    "ready": "Ready",
    "not_enrolled": "Agent not enrolled",
    "agent_unavailable": "Linked Agent inactive",
    "agent_offline": "Agent offline or stale",
    "companion_required": "Remote Companion not installed",
    "readiness_unreported": "Companion readiness not reported",
    "waiting_for_user_session": "Awaiting signed-in user session",
    "waiting_for_policy": "Applying remote policy",
    "integrity_unverified": "Companion integrity unverified",
    "unsupported_platform": "Unsupported endpoint platform",
    "trust_reenrollment_required": "Agent trust re-enrolment required",
}
NATIVE_REMOTE_RISK_WEIGHTS = {
    "control_consent_unconfirmed": 25,
    "standing_authorisation": 22,
    "consent_missing": 20,
    "interactive_control": 18,
    "no_ticket_context": 12,
    "server_control": 10,
    "long_session": 8,
    "generic_purpose": 8,
    "outside_business_hours": 6,
}


def _parse_utc(value: Any) -> datetime | None:
    """Read a recorded ISO timestamp as timezone-aware UTC, or None."""
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _native_session_minutes(session: dict) -> int | None:
    started = _parse_utc(session.get("started_at"))
    if started is None:
        return None
    ended = _parse_utc(session.get("ended_at")) or datetime.now(timezone.utc)
    return max(0, int((ended - started).total_seconds() // 60))


def _native_session_risk(session: dict) -> dict:
    """Explainable session risk derived only from the governed session record.

    Each factor reports whether it raised the score and why. Terminal sessions
    are still scored so the ledger can explain a completed session, but an
    ended session never demands step-up.
    """
    if session.get("provider") != "nexus":
        return {"native_risk": {"score": 0, "band": "not_native", "requires_step_up": False, "factors": []}}

    control = session.get("access_mode") == "control"
    purpose = str(session.get("purpose") or "").strip()
    started = _parse_utc(session.get("started_at"))
    minutes = _native_session_minutes(session)
    active = session.get("status") in {"authorised", "active", "ending"}
    ticket_reference = session.get("ticket_number") or session.get("ticket_id") or session.get("work_session_id")

    factors: list[dict[str, Any]] = []

    def add(key: str, label: str, is_raised: bool, raised_detail: str, satisfied_detail: str) -> None:
        factors.append({
            "key": key,
            "label": label,
            "state": "raised" if is_raised else "satisfied",
            "weight": NATIVE_REMOTE_RISK_WEIGHTS[key],
            "detail": raised_detail if is_raised else satisfied_detail,
        })

    add(
        "interactive_control",
        "Interactive control",
        control,
        "Mouse and keyboard input is authorised for this session.",
        "View-only: endpoint input stays disabled.",
    )
    add(
        "control_consent_unconfirmed",
        "Control consent confirmation",
        control and not session.get("control_consent_confirmed"),
        "Control mode is recorded without a confirmed control-consent record.",
        "Control consent matches the recorded access mode.",
    )
    add(
        "consent_missing",
        "Customer consent",
        bool(session.get("consent_required", True)) and not session.get("consent_confirmed"),
        "Attended customer consent is required but not recorded.",
        "Attended consent is recorded for this session.",
    )
    add(
        "standing_authorisation",
        "Standing authorisation",
        bool(session.get("standing_authorisation")),
        "Standing authorisation allows unattended access without a local prompt.",
        "A local attended prompt is required for this session.",
    )
    add(
        "no_ticket_context",
        "Ticket context",
        not ticket_reference,
        "Session is not attached to a ticket or work session.",
        f"Attached to {ticket_reference}.",
    )
    add(
        "generic_purpose",
        "Recorded purpose",
        purpose.lower() in {"", NATIVE_REMOTE_GENERIC_PURPOSE},
        "The recorded purpose is the generic default.",
        "A specific purpose is recorded.",
    )
    add(
        "server_control",
        "Server-class endpoint",
        control and "server" in str(session.get("device_type") or "").lower(),
        "Interactive control is authorised against a server-class endpoint.",
        "Not an interactive-control session on a server-class endpoint.",
    )
    add(
        "long_session",
        "Session duration",
        bool(active and minutes is not None and minutes > NATIVE_REMOTE_LONG_SESSION_MINUTES),
        f"The session has run for {minutes} minutes." if minutes is not None else "The session has run longer than the expected window.",
        "Duration is within the expected window.",
    )
    low_hour, high_hour = NATIVE_REMOTE_BUSINESS_HOURS_UTC
    add(
        "outside_business_hours",
        "Business hours (UTC)",
        bool(started is not None and not (low_hour <= started.hour < high_hour)),
        f"Started at {started.strftime('%H:%M')} UTC, outside {low_hour:02d}:00–{high_hour:02d}:00 UTC." if started else "Start time is not recorded.",
        f"Started at {started.strftime('%H:%M')} UTC, inside business hours." if started else "Business hours not evaluated.",
    )

    score = min(100, sum(factor["weight"] for factor in factors if factor["state"] == "raised"))
    band = "low" if score < 25 else "medium" if score < 50 else "elevated" if score < 75 else "high"
    return {
        "native_risk": {
            "score": score,
            "band": band,
            "requires_step_up": bool(active and score >= NATIVE_REMOTE_STEP_UP_SCORE),
            "raised_count": sum(1 for factor in factors if factor["state"] == "raised"),
            "factors": factors,
        }
    }


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


async def _remote_policy(current_user: dict):
    return await remote_policy(platform_tenant_id(current_user))


def _device_provider_id(device: dict, provider_id: str) -> Optional[str]:
    if provider_id == "rustdesk":
        return device.get("rustdesk_id")
    ids = device.get("remote_provider_ids") or {}
    return ids.get(provider_id) or device.get(f"{provider_id}_id") or device.get(f"{provider_id}_uuid")


@router.get("/remote-access/policy")
async def get_remote_access_policy(current_user: dict = Depends(get_current_user)):
    return await _remote_policy(current_user)


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
    updates.update({
        "type": "remote_access_policy",
        "tenant_id": platform_tenant_id(current_user),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.settings.update_one(
        {"type": "remote_access_policy", "tenant_id": platform_tenant_id(current_user)},
        {"$set": updates},
        upsert=True,
    )
    await log_activity(
        current_user,
        "remote_policy_updated",
        "settings",
        "remote_access_policy",
        "Nexus Remote",
        "Updated governed remote-access policy",
        metadata={"updated_fields": sorted(key for key in updates if key not in {"type", "updated_at"})},
    )
    return await _remote_policy(current_user)


@router.get("/devices/{device_id}/remote-options")
async def get_device_remote_options(device_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    device = await _remote_device_in_scope(
        device_id,
        current_user,
        operation="device.remote.view",
        request=request,
    )
    policy = await _remote_policy(current_user)
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

@router.get("/remote/fleet-readiness")
async def get_remote_fleet_readiness(
    client_id: Optional[str] = None,
    limit: int = 1000,
    current_user: dict = Depends(get_current_user),
):
    """Return one tenant-scoped native readiness read model for the fleet.

    This is a derived view. It never issues a grant, mutates a device or widens
    access; it only batches the same Agent/Companion evidence a technician
    would see after opening each endpoint individually. Active native sessions
    are joined by device so an operator can distinguish "blocked" from
    "already in use" without leaving the fleet view.
    """
    tenant_id = platform_tenant_id(current_user)
    await expire_overdue_grants(tenant_id=tenant_id)
    bounded_limit = max(1, min(int(limit or 1000), 2000))
    device_query = {"archived": {"$ne": True}}
    if client_id:
        device_query["client_id"] = client_id
    devices = await db.devices.find(
        tenant_scoped_query(current_user, scoped_query(current_user, device_query)),
        {
            "_id": 0, "id": 1, "name": 1, "hostname": 1, "client_id": 1,
            "client_name": 1, "site_id": 1, "device_type": 1, "status": 1,
            "nexus_agent_id": 1,
        },
    ).sort("name", 1).to_list(bounded_limit)
    endpoints = await fleet_device_readiness(devices, tenant_id)

    sessions = await db.remote_sessions.find(
        tenant_scoped_query(current_user, scoped_query(current_user, {
            "provider": "nexus",
            "status": {"$in": ["authorised", "active", "ending"]},
            "ended_at": None,
        })),
        {"_id": 0, "id": 1, "device_id": 1, "user_name": 1, "access_mode": 1,
         "status": 1, "started_at": 1, "transport_state": 1, "capture_freshness": 1},
    ).sort("started_at", -1).to_list(500)
    active_by_device: dict[str, dict] = {}
    for session in sessions:
        active_by_device.setdefault(str(session.get("device_id") or ""), session)

    for endpoint in endpoints:
        active = active_by_device.get(str(endpoint.get("device_id") or ""))
        endpoint["active_session"] = ({
            "id": active.get("id"),
            "technician_name": active.get("user_name"),
            "access_mode": active.get("access_mode"),
            "status": active.get("status"),
            "started_at": active.get("started_at"),
            "transport_state": active.get("transport_state"),
            "capture_freshness": active.get("capture_freshness"),
        } if active else None)

    state_counts: dict[str, int] = {}
    for endpoint in endpoints:
        state = str(endpoint.get("state") or "unknown")
        state_counts[state] = state_counts.get(state, 0) + 1
    ready = state_counts.get("ready", 0)
    blocked = max(0, len(endpoints) - ready)
    total = len(endpoints)

    blockers: dict[str, dict] = {}
    for endpoint in endpoints:
        if endpoint.get("ready"):
            continue
        state = str(endpoint.get("state") or "unknown")
        group = blockers.setdefault(state, {
            "state": state,
            "label": NATIVE_REMOTE_READINESS_LABELS.get(state, "Readiness unavailable"),
            "count": 0,
            "detail": endpoint.get("detail"),
            "examples": [],
        })
        group["count"] += 1
        if len(group["examples"]) < 3:
            group["examples"].append({
                "device_id": endpoint.get("device_id"),
                "device_name": endpoint.get("device_name"),
                "client_id": endpoint.get("client_id"),
            })

    endpoints.sort(key=lambda endpoint: (
        0 if endpoint.get("active_session") else 1,
        0 if not endpoint.get("ready") else 1,
        str(endpoint.get("device_name") or "").lower(),
    ))
    attention = [endpoint for endpoint in endpoints if not endpoint.get("ready") or endpoint.get("active_session")][:50]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total_endpoints": total,
            "ready": ready,
            "blocked": blocked,
            "ready_percentage": round((ready / total) * 100, 1) if total else 0.0,
            "agent_online": total - sum(
                state_counts.get(state, 0)
                for state in ("not_enrolled", "agent_unavailable", "agent_offline", "trust_reenrollment_required")
            ),
            "active_sessions": len(sessions),
            "control_sessions": sum(1 for session in sessions if session.get("access_mode") == "control"),
            "unattended_ready": sum(1 for endpoint in endpoints if endpoint.get("unattended_ready")),
            "states": [
                {
                    "state": state,
                    "label": NATIVE_REMOTE_READINESS_LABELS.get(state, state.replace("_", " ")),
                    "count": count,
                }
                for state, count in sorted(state_counts.items(), key=lambda item: (-item[1], item[0]))
            ],
        },
        "blockers": sorted(blockers.values(), key=lambda blocker: (-blocker["count"], blocker["state"])),
        "attention_endpoints": attention,
        "endpoints": endpoints,
        "sample": {"limit": bounded_limit, "returned": total},
    }


@router.get("/remote/sessions")
async def get_remote_sessions(
    device_id: Optional[str] = None,
    status: Optional[str] = None,
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    ticket_id: Optional[str] = None,
    started_after: Optional[str] = None,
    started_before: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    current_user: dict = Depends(get_current_user)
):
    await expire_overdue_grants(tenant_id=platform_tenant_id(current_user))
    query = {}
    if device_id:
        query["device_id"] = device_id
    if status:
        query["status"] = status
    if user_id:
        query["user_id"] = user_id
    if client_id:
        query["client_id"] = client_id
    if ticket_id:
        query["ticket_id"] = ticket_id
    start_bound = _parse_utc(started_after) if started_after else None
    end_bound = _parse_utc(started_before) if started_before else None
    if started_after and start_bound is None:
        raise HTTPException(status_code=422, detail="started_after must be an ISO-8601 timestamp")
    if started_before and end_bound is None:
        raise HTTPException(status_code=422, detail="started_before must be an ISO-8601 timestamp")
    if start_bound or end_bound:
        started_window = {}
        if start_bound:
            started_window["$gte"] = start_bound.isoformat()
        if end_bound:
            started_window["$lte"] = end_bound.isoformat()
        query["started_at"] = started_window
    bounded_limit = max(1, min(int(limit or 200), 500))
    bounded_offset = max(0, int(offset or 0))

    sessions = await db.remote_sessions.find(
        tenant_scoped_query(current_user, scoped_query(current_user, query)), {"_id": 0}
    ).sort("started_at", -1).skip(bounded_offset).to_list(bounded_limit)
    return [
        {**session, **_native_session_freshness(session), **_native_session_risk(session)}
        for session in sessions
    ]


@router.get("/remote/sessions/{session_id}")
async def get_remote_session_detail(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return the complete governed evidence for one remote session.

    The list view is intentionally summary-sized. This detail read keeps the
    session, its signed-grant lifecycle and its canonical time entries on one
    scoped boundary so an auditor does not have to correlate separate lists.
    """
    await expire_overdue_grants(tenant_id=platform_tenant_id(current_user))
    session = await assert_tenant_record_scope(
        current_user,
        db.remote_sessions,
        session_id,
        operation="device.remote.view",
        resource_name="Remote session",
    )
    tenant_id = platform_tenant_id(current_user)
    grant = await db.native_remote_grants.find_one(
        tenant_scoped_query(current_user, {"tenant_id": tenant_id, "session_id": session_id}),
        {"_id": 0, "id": 1, "status": 1, "issued_at": 1, "expires_at": 1,
         "delivered_at": 1, "acknowledged_at": 1, "revoked_at": 1, "key_id": 1},
    )
    time_entries = await db.time_entries.find(
        tenant_scoped_query(current_user, {"remote_session_id": session_id}),
        {"_id": 0},
    ).sort("created_at", 1).to_list(100)
    return {
        **session,
        **_native_session_freshness(session),
        **_native_session_risk(session),
        "grant": grant,
        "time_entries": time_entries,
    }

@router.get("/remote/active-sessions")
async def get_active_remote_sessions(current_user: dict = Depends(get_current_user)):
    """Get all currently active remote sessions"""
    await expire_overdue_grants(tenant_id=platform_tenant_id(current_user))
    query = tenant_scoped_query(
        current_user,
        scoped_query(current_user, {"status": {"$in": ["authorised", "active", "ending"]}}),
    )
    sessions = await db.remote_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(100)
    # Calculate live duration for active sessions
    now = datetime.now(timezone.utc)
    for s in sessions:
        try:
            started = datetime.fromisoformat(str(s["started_at"]).replace("Z", "+00:00"))
            s["live_duration_minutes"] = int((now - started).total_seconds() / 60)
        except Exception:
            s["live_duration_minutes"] = 0
        s.update(_native_session_freshness(s))
        s.update(_native_session_risk(s))
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
    bounded_limit = max(1, min(int(limit or 100), 500))
    sessions = await db.remote_sessions.find(
        tenant_scoped_query(current_user, scoped_query(current_user, {"user_id": tech_id})),
        {"_id": 0},
    ).sort("started_at", -1).to_list(bounded_limit)
    active_count = sum(1 for s in sessions if s.get("status") in {"authorised", "active", "ending"})
    total_minutes = sum(s.get("duration_minutes", 0) for s in sessions if s.get("status") == "ended")
    unique_devices = len(set(s.get("device_id") for s in sessions))
    return {
        "sessions": sessions,
        "active_count": active_count,
        "total_sessions": len(sessions),
        "total_minutes": total_minutes,
        "unique_devices": unique_devices,
        "limit": bounded_limit,
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

