"""Governed first-party remote-access runtime for Nexus Remote."""

from __future__ import annotations

from datetime import datetime, timezone
from math import ceil
from typing import Any
import uuid

from fastapi import HTTPException

from app.database import db
from app.routers.nexus_agent import queue_command_for_device
from app.services.activity import log_activity
from app.services.platform_foundation import emit_platform_event
from app.services.native_remote import (
    device_readiness as native_device_readiness,
    grant_for_session,
    issue_grant,
    revoke_grant,
)
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query
from app.services.ticket_time import create_canonical_ticket_time_entry, sync_ticket_time_cache


REMOTE_POLICY_DEFAULTS: dict[str, Any] = {
    "default_provider": "nexus",
    "allow_fallback": False,
    "require_consent": True,
    "allow_standing_authorisation": False,
    "require_ticket_reference": False,
    "auto_create_time_entry": True,
    "auto_ticket_note": True,
    "auto_repair": True,
    "repair_cooldown_minutes": 30,
}

SESSION_TYPES = frozenset({"remote_desktop", "terminal", "file_transfer"})
CONSENT_METHODS = frozenset(
    {"attended_prompt", "verbal", "standing_authorisation", "emergency_override"}
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _record_ticket_remote_audit(
    *,
    ticket_id: str | None,
    user: dict,
    action: str,
    details: str,
    remote_session_id: str,
) -> None:
    """Keep governed remote evidence visible in the linked ticket history.

    A remote session has its own audit trail, but a technician working from a
    ticket should not need to leave that ticket to establish whether access was
    merely authorised, actually connected, or ended without service time.  The
    helper deliberately writes through the runtime database so local/unit
    tests and production share the same durable record boundary.
    """
    if not ticket_id:
        return
    collection = getattr(db, "ticket_audit_log", None)
    if collection is None:
        return
    await collection.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(user),
        "ticket_id": ticket_id,
        "user_id": user.get("id") or "",
        "user_name": user.get("name") or user.get("email") or "",
        "action": action,
        "details": details,
        "remote_session_id": remote_session_id,
        "created_at": utc_now(),
    })


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def normalise_session_type(value: Any) -> str:
    candidate = str(value or "remote_desktop").strip().lower()
    if candidate not in SESSION_TYPES:
        raise HTTPException(status_code=422, detail="Choose remote desktop, terminal, or file transfer")
    return candidate


def ticket_links_device(ticket: dict, device_id: str) -> bool:
    linked = {str(item) for item in (ticket.get("device_ids") or []) if item}
    if ticket.get("device_id"):
        linked.add(str(ticket["device_id"]))
    return str(device_id) in linked


async def ensure_remote_runtime_indexes() -> None:
    await db.remote_sessions.create_index("id", unique=True, name="remote_session_id_unique")
    await db.remote_sessions.create_index(
        [("device_id", 1), ("started_at", -1)],
        name="remote_session_device_time",
    )
    await db.remote_sessions.create_index(
        [("client_id", 1), ("status", 1), ("started_at", -1)],
        name="remote_session_client_status_time",
    )
    await db.remote_sessions.create_index(
        [("ticket_id", 1), ("started_at", -1)],
        name="remote_session_ticket_time",
    )
    await db.remote_sessions.create_index(
        [("user_id", 1), ("idempotency_key", 1)],
        sparse=True,
        name="remote_session_user_idempotency",
    )
    await db.remote_repairs.create_index("id", unique=True, name="remote_repair_id_unique")
    await db.remote_repairs.create_index(
        [("device_id", 1), ("requested_at", -1)],
        name="remote_repair_device_time",
    )


async def remote_policy(tenant_id: str | None = None) -> dict[str, Any]:
    """Load the governed remote policy inside one Nexus platform partition."""
    tenant_id = str(tenant_id or "nexus-local").strip() or "nexus-local"
    stored = await db.settings.find_one(
        {"type": "remote_access_policy", "tenant_id": tenant_id}, {"_id": 0}
    ) or {}
    if not stored and tenant_id == "nexus-local":
        stored = await db.settings.find_one(
            {"type": "remote_access_policy", "tenant_id": {"$exists": False}}, {"_id": 0}
        ) or {}
    return {
        **REMOTE_POLICY_DEFAULTS,
        **stored,
        "default_provider": "nexus",
        "allow_fallback": False,
        "require_consent": True,
        "allow_standing_authorisation": bool(stored.get("allow_standing_authorisation", False)),
    }


async def provider_is_active(provider_id: str) -> bool:
    return provider_id == "nexus"


async def provider_device_id(device: dict, provider_id: str) -> str:
    if provider_id == "nexus":
        return str(device.get("nexus_agent_id") or "").strip()
    return ""


async def validate_ticket_for_remote(ticket_id: str, device: dict) -> dict:
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Related ticket not found")
    ticket_client = str(ticket.get("client_id") or "")
    device_client = str(device.get("client_id") or "")
    if ticket_client and device_client and ticket_client != device_client:
        raise HTTPException(
            status_code=409,
            detail="The related ticket belongs to a different client",
        )
    if not ticket_links_device(ticket, str(device.get("id") or "")):
        raise HTTPException(
            status_code=409,
            detail="Link this device to the ticket before starting remote access",
        )
    return ticket


async def validate_work_session_for_remote(
    work_session_id: str,
    *,
    ticket: dict,
    device: dict,
    user: dict,
) -> dict:
    """Confirm that a remote handoff belongs to one active work session.

    Work Session owns the final time entry for its guided technician journey.
    This lookup deliberately validates the durable Nexus IDs again rather than
    trusting a URL or browser-provided work-session reference.
    """
    work_session = await db.nexus_work_sessions.find_one(
        {"id": work_session_id}, {"_id": 0}
    )
    if not work_session:
        raise HTTPException(status_code=404, detail="Related Work Session not found")
    if work_session.get("status") != "active":
        raise HTTPException(
            status_code=409,
            detail="The related Work Session is no longer active",
        )
    if str(work_session.get("ticket_id") or "") != str(ticket.get("id") or ""):
        raise HTTPException(
            status_code=409,
            detail="The related Work Session belongs to a different ticket",
        )
    if not (
        str(work_session.get("client_id") or "")
        and str(work_session.get("client_id")) == str(ticket.get("client_id") or "")
        and str(work_session.get("client_id")) == str(device.get("client_id") or "")
    ):
        raise HTTPException(
            status_code=409,
            detail="The related Work Session is not scoped to this client and endpoint",
        )
    if str(work_session.get("started_by") or "") != str(user.get("id") or ""):
        raise HTTPException(
            status_code=403,
            detail="The related Work Session belongs to another technician",
        )
    return work_session


async def work_session_time_owner_for_remote(session: dict, ticket: dict | None) -> dict | None:
    """Return a re-validated Work Session that owns remote-session time.

    Remote session records are durable and can outlive the active Work
    Session.  Only a matching active/completing/completed record for the same
    ticket, client and technician suppresses remote auto-time at close.
    Historical or malformed session links remain on the normal remote-time
    path instead of silently dropping billable evidence.
    """
    work_session_id = str(session.get("work_session_id") or "").strip()
    if not work_session_id or not ticket:
        return None
    work_session = await db.nexus_work_sessions.find_one(
        {"id": work_session_id}, {"_id": 0}
    )
    if not work_session or work_session.get("status") not in {"active", "completing", "completed"}:
        return None
    client_id = str(session.get("client_id") or "")
    if not (
        str(work_session.get("ticket_id") or "") == str(ticket.get("id") or "")
        and client_id
        and client_id == str(ticket.get("client_id") or "")
        and client_id == str(work_session.get("client_id") or "")
        and str(work_session.get("started_by") or "") == str(session.get("user_id") or "")
    ):
        return None
    return work_session


async def _connection_handoff(provider: str, provider_id: str) -> dict[str, Any]:
    if provider == "nexus":
        return {
            "launch_mode": "nexus_native",
            "connection_url": None,
            "web_client_url": None,
            "relay_server": None,
        }
    raise HTTPException(status_code=410, detail="Third-party remote transports are retired")


async def start_remote_session(
    *,
    device: dict,
    user: dict,
    data: dict,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    await ensure_remote_runtime_indexes()
    policy = await remote_policy(platform_tenant_id(user))
    provider = str(
        data.get("provider")
        or device.get("remote_provider")
        or policy["default_provider"]
    ).strip().lower()
    if provider == "inherit":
        provider = str(policy["default_provider"])
    if provider != "nexus":
        raise HTTPException(
            status_code=410,
            detail="Third-party remote transports are retired. Use Nexus Native Remote.",
        )
    requested_mode = str(data.get("mode") or "view").strip().lower()
    if requested_mode not in {"view", "control"}:
        raise HTTPException(status_code=422, detail="Choose a supported Nexus Native Remote access mode")

    ticket_id = str(data.get("ticket_id") or "").strip() or None
    ticket = await validate_ticket_for_remote(ticket_id, device) if ticket_id else None
    if policy["require_ticket_reference"] and not ticket:
        raise HTTPException(
            status_code=422,
            detail="A linked ticket is required before starting a remote session",
        )
    work_session_id = str(data.get("work_session_id") or "").strip() or None
    if work_session_id and not ticket:
        raise HTTPException(
            status_code=422,
            detail="A linked ticket is required when continuing a Nexus Work Session",
        )
    work_session = await validate_work_session_for_remote(
        work_session_id,
        ticket=ticket,
        device=device,
        user=user,
    ) if work_session_id else None

    consent_confirmed = bool(data.get("consent_confirmed"))
    consent_method = str(data.get("consent_method") or "attended_prompt").strip().lower()
    if consent_method not in CONSENT_METHODS:
        raise HTTPException(status_code=422, detail="Choose a supported consent method")
    standing_authorisation = consent_method == "standing_authorisation"
    if standing_authorisation and not (
        policy.get("allow_standing_authorisation")
        and bool(device.get("remote_unattended_access_enabled"))
    ):
        raise HTTPException(
            status_code=422,
            detail="Standing authorisation is not enabled for this managed endpoint",
        )
    if not consent_confirmed:
        raise HTTPException(
            status_code=422,
            detail="Confirm the applicable endpoint authorisation before starting a remote session",
        )
    control_consent_confirmed = bool(data.get("control_consent_confirmed"))
    if requested_mode == "control" and not control_consent_confirmed:
        raise HTTPException(status_code=422, detail="Confirm that interactive control requires fresh endpoint approval")
    if requested_mode == "control" and standing_authorisation:
        raise HTTPException(status_code=422, detail="Interactive control cannot use standing authorisation")
    remote_id = await provider_device_id(device, provider)
    if not remote_id:
        raise HTTPException(
            status_code=409,
            detail="This device is not linked to an enrolled Nexus Agent",
        )
    readiness = await native_device_readiness(device, platform_tenant_id(user))
    if not readiness.get("ready"):
        raise HTTPException(status_code=409, detail=readiness.get("detail") or "Nexus Remote Companion is not ready")
    if standing_authorisation and not readiness.get("unattended_ready"):
        raise HTTPException(
            status_code=409,
            detail="Upgrade the Nexus Remote Companion before using standing authorisation",
        )

    idempotency_key = str(data.get("idempotency_key") or "").strip() or None
    if idempotency_key:
        existing = await db.remote_sessions.find_one(
            {"tenant_id": platform_tenant_id(user), "user_id": user.get("id"), "idempotency_key": idempotency_key},
            {"_id": 0},
        )
        if existing:
            if (existing.get("device_id") != device.get("id")
                    or existing.get("ticket_id") != ticket_id
                    or existing.get("access_mode") != requested_mode
                    or bool(existing.get("standing_authorisation")) != standing_authorisation
                    or existing.get("status") not in {"authorised", "active"}):
                raise HTTPException(status_code=409, detail="Idempotency key belongs to a different or closed remote request")
            handoff = await _connection_handoff(existing["provider"], existing["provider_device_id"])
            grant = await grant_for_session(
                tenant_id=platform_tenant_id(user), session_id=existing["id"]
            )
            return {"session": existing, "provider": existing["provider"], "grant": grant, **handoff, "reused": True}

    client = await db.clients.find_one(tenant_scoped_query(user, {"id": device.get("client_id")}), {"_id": 0}) or {}
    now = utc_now()
    session = {
        "id": str(uuid.uuid4()),
        "tenant_id": platform_tenant_id(user),
        "device_id": str(device.get("id") or ""),
        "device_name": device.get("name") or device.get("hostname"),
        "client_id": device.get("client_id"),
        "client_name": client.get("name") or device.get("client_name"),
        "site_id": device.get("site_id"),
        "user_id": user.get("id"),
        "user_name": user.get("name") or user.get("email"),
        "session_type": normalise_session_type(data.get("session_type")),
        "status": "authorised",
        "provider": provider,
        "provider_device_id": remote_id,
        "ticket_id": ticket_id,
        "ticket_number": (ticket or {}).get("ticket_number"),
        "work_session_id": (work_session or {}).get("id"),
        "time_entry_owner": "nexus_work_session" if work_session else "nexus_remote",
        "purpose": str(data.get("purpose") or "Technician support session").strip()[:500],
        "consent_required": bool(policy["require_consent"]),
        "consent_confirmed": consent_confirmed,
        "consent_method": consent_method if consent_confirmed else None,
        "consent_confirmed_at": now if consent_confirmed else None,
        "control_consent_confirmed": control_consent_confirmed if requested_mode == "control" else False,
        "local_prompt_required": not standing_authorisation,
        "standing_authorisation": standing_authorisation,
        "launch_status": "awaiting_agent",
        "access_mode": requested_mode,
        "authorisation_audited": False,
        "device_type": device.get("device_type", "workstation"),
        # A valid Work Session owns the single canonical time entry for this
        # technician journey.  Do not let a crafted browser payload turn the
        # remote close into a second billable record.
        "create_time_entry": False if work_session else bool(data.get("create_time_entry", policy["auto_create_time_entry"])),
        "idempotency_key": idempotency_key,
        "correlation_id": correlation_id,
        "started_at": now,
        "opened_at": None,
        "last_heartbeat_at": None,
        "ended_at": None,
        "duration_minutes": 0,
    }
    await db.remote_sessions.insert_one(dict(session))
    try:
        grant = await issue_grant(
            session=session,
            user=user,
            mode=session["access_mode"],
            consent_required=not standing_authorisation,
        )
    except Exception:
        await db.remote_sessions.update_one(
            tenant_scoped_query(user, {"id": session["id"]}),
            {"$set": {"status": "failed", "launch_status": "grant_failed", "ended_at": utc_now()}},
        )
        raise
    # This is a display projection of the authoritative grant expiry, not a
    # second grant record. It lets technician workflows show the fixed signed
    # session limit without exposing any grant payload or signature.
    session["native_grant_expires_at"] = grant.get("expires_at")
    await db.remote_sessions.update_one(
        {"id": session["id"], "tenant_id": session["tenant_id"], "status": "authorised"},
        {"$set": {"native_grant_expires_at": session["native_grant_expires_at"]}},
    )
    await log_activity(
        user,
        "remote_authorised",
        "device",
        session["device_id"],
        session["device_name"] or "",
        f"Authorised {provider.title()} {session['session_type']} session",
        metadata={
            "session_id": session["id"],
            "provider": provider,
            "ticket_id": ticket_id,
            "work_session_id": session.get("work_session_id"),
            "consent_method": session["consent_method"],
        },
    )
    await _record_ticket_remote_audit(
        ticket_id=session.get("ticket_id"),
        user=user,
        action="remote_session_authorised",
        details=(
            f"Authorised {provider.title()} {session['session_type'].replace('_', ' ')} "
            f"on {session.get('device_name') or session['device_id']} "
            f"with {session['consent_method'] or 'recorded'} consent."
        ),
        remote_session_id=session["id"],
    )
    await emit_platform_event(
        subject="remote.session.started",
        source="nexus.remote",
        actor=user,
        client_id=session.get("client_id"),
        correlation_id=correlation_id,
        idempotency_key=f"remote-session-started:{session['id']}",
        partition_key=session.get("client_id") or session["device_id"],
        payload={
            "session_id": session["id"],
            "device_id": session["device_id"],
            "ticket_id": ticket_id,
            "work_session_id": session.get("work_session_id"),
            "provider": provider,
            "status": "authorised",
        },
    )
    await db.remote_sessions.update_one(
        {"id": session["id"], "tenant_id": session["tenant_id"], "status": "authorised"},
        {"$set": {"authorisation_audited": True}},
    )
    session["authorisation_audited"] = True
    handoff = await _connection_handoff(provider, remote_id)
    return {
        "session": session,
        "provider": provider,
        "grant": grant,
        **handoff,
        "reused": False,
        "message": "Nexus Native grant issued. Waiting for the enrolled endpoint companion.",
    }


async def mark_remote_session_opened(
    session: dict,
    user: dict,
    *,
    correlation_id: str | None = None,
) -> dict:
    """Record a technician confirmation that the remote desktop actually opened.

    A native protocol handoff only tells the browser that it *attempted* to
    launch a provider.  It is not proof that a connection was established, so
    the explicit confirmation below is the boundary at which an authorised
    session becomes active and begins eligible service-time measurement.
    """
    if session.get("provider") == "nexus":
        raise HTTPException(status_code=409, detail="Native sessions require verified transport evidence; browser confirmation cannot activate billing")
    if session.get("status") == "ended":
        raise HTTPException(status_code=409, detail="This remote session has already ended")
    if str(session.get("user_id")) != str(user.get("id")) and not (
        user.get("is_admin") or str(user.get("role") or "").lower() == "admin"
    ):
        raise HTTPException(status_code=403, detail="Only the session technician can confirm this launch")
    if session.get("status") == "active" and session.get("opened_at"):
        return session
    now = utc_now()
    await db.remote_sessions.update_one(
        tenant_scoped_query(user, {"id": session["id"]}),
        {"$set": {
            "status": "active",
            "launch_status": "launched",
            "opened_at": session.get("opened_at") or now,
            "last_heartbeat_at": now,
            "opened_by": user.get("id"),
            "opened_by_name": user.get("name") or user.get("email"),
            "opened_confirmation": "technician_attested",
        }},
    )
    opened = {
        **session,
        "status": "active",
        "launch_status": "launched",
        "opened_at": session.get("opened_at") or now,
        "last_heartbeat_at": now,
        "opened_by": user.get("id"),
        "opened_by_name": user.get("name") or user.get("email"),
        "opened_confirmation": "technician_attested",
    }
    await _record_ticket_remote_audit(
        ticket_id=session.get("ticket_id"),
        user=user,
        action="remote_session_connected",
        details=(
            f"Technician confirmed {str(session.get('provider') or 'remote').title()} "
            f"connected to {session.get('device_name') or session.get('device_id')}"
        ),
        remote_session_id=session["id"],
    )
    await log_activity(
        user,
        "remote_connected",
        "device",
        session.get("device_id", ""),
        session.get("device_name", ""),
        "Technician confirmed the governed remote connection opened",
        metadata={
            "session_id": session["id"],
            "provider": session.get("provider"),
            "ticket_id": session.get("ticket_id"),
            "confirmation": "technician_attested",
        },
    )
    await emit_platform_event(
        subject="remote.session.connected",
        source="nexus.remote",
        actor=user,
        client_id=session.get("client_id"),
        correlation_id=correlation_id or session.get("correlation_id"),
        idempotency_key=f"remote-session-connected:{session['id']}",
        partition_key=session.get("client_id") or session.get("device_id"),
        payload={
            "session_id": session["id"],
            "device_id": session.get("device_id"),
            "ticket_id": session.get("ticket_id"),
            "provider": session.get("provider"),
            "confirmation": "technician_attested",
            "status": "active",
        },
    )
    return opened


async def heartbeat_remote_session(session: dict, user: dict) -> dict:
    if session.get("status") != "active" or not session.get("opened_at"):
        raise HTTPException(
            status_code=409,
            detail="Confirm the remote connection opened before sending session heartbeats",
        )
    if str(session.get("user_id")) != str(user.get("id")):
        raise HTTPException(status_code=403, detail="Only the session technician can update its heartbeat")
    now = utc_now()
    await db.remote_sessions.update_one(
        tenant_scoped_query(user, {"id": session["id"]}),
        {"$set": {"status": "active", "last_heartbeat_at": now}},
    )
    return {"id": session["id"], "status": "active", "last_heartbeat_at": now}


async def end_remote_session_record(
    *,
    session: dict,
    user: dict,
    data: dict,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    if session.get("provider") == "nexus":
        if session.get("tenant_id") != platform_tenant_id(user):
            raise HTTPException(status_code=404, detail="Remote session not found")
        administrator = bool(user.get("is_admin") or str(user.get("role") or "").lower() == "admin")
        if str(session.get("user_id")) != str(user.get("id")) and not administrator:
            raise HTTPException(status_code=403, detail="Only the session technician or an administrator can end it")
        await revoke_grant(
            tenant_id=session["tenant_id"], session_id=session["id"],
            actor_id=str(user.get("id") or ""), reason=str(data.get("notes") or "Session ended"),
        )
    if session.get("status") == "ended":
        return {
            "message": "Session already ended",
            "session": session,
            "duration_minutes": int(session.get("duration_minutes") or 0),
            "time_entry_id": session.get("time_entry_id"),
        }
    administrator = bool(user.get("is_admin") or str(user.get("role") or "").lower() == "admin")
    if str(session.get("user_id")) != str(user.get("id")) and not administrator:
        raise HTTPException(status_code=403, detail="Only the session technician or an administrator can end it")

    now_dt = datetime.now(timezone.utc)
    # A successful native-URI launch is not observable from the browser.  Do
    # not infer a live support session (or billable minutes) until the
    # technician has explicitly confirmed that the provider connection opened.
    launch_confirmed = bool(session.get("opened_at")) and session.get("status") in {"active", "ending"}
    started = parse_datetime(session.get("opened_at")) if launch_confirmed else None
    duration = (
        max(1, ceil(max(0.0, (now_dt - started).total_seconds()) / 60))
        if started
        else 0
    )
    notes = str(data.get("notes") or data.get("summary") or "").strip()[:2000]
    lock_action = str(data.get("lock_action_on_disconnect") or "no_change").strip()
    if lock_action not in {"locked", "unlocked", "no_change"}:
        raise HTTPException(status_code=422, detail="Choose locked, unlocked, or no change")

    updates = {
        "status": "ended",
        "launch_status": "completed" if launch_confirmed else "not_confirmed",
        "launch_confirmed": launch_confirmed,
        "ended_at": now_dt.isoformat(),
        "duration_minutes": duration,
        "notes": notes or None,
        "was_locked_before_disconnect": data.get("was_locked_before_disconnect"),
        "lock_action_on_disconnect": lock_action,
        "ended_by": user.get("id"),
        "ended_by_name": user.get("name") or user.get("email"),
    }
    if session.get("provider") == "nexus":
        # Revocation immediately removes the relay frame. Keep the durable
        # session evidence equally unambiguous: an ended native session cannot
        # continue to present its last transport state as connected.
        updates.update({
            "transport_state": "disconnected",
            "transport_detail": "session ended by technician",
            "last_transport_disconnect_at": now_dt.isoformat(),
        })

    policy = await remote_policy(platform_tenant_id(user))
    ticket = None
    time_entry_doc = None
    if session.get("ticket_id"):
        ticket = await db.tickets.find_one(tenant_scoped_query(user, {"id": session["ticket_id"]}), {"_id": 0})
    work_session_time_owner = await work_session_time_owner_for_remote(session, ticket)
    create_time_entry = bool(
        data.get(
            "create_time_entry",
            session.get("create_time_entry", policy["auto_create_time_entry"]),
        )
    )
    if not launch_confirmed:
        create_time_entry = False
        updates["time_entry_suppressed_by"] = "launch_not_confirmed"
        updates["time_entry_owner"] = "none"
    if work_session_time_owner and launch_confirmed:
        # The linked Work Session is the one reviewed, commercialised and
        # recorded time path.  Retain remote evidence without creating a
        # second canonical entry when the remote session ends.
        create_time_entry = False
        updates["time_entry_suppressed_by"] = "nexus_work_session"
        updates["time_entry_owner"] = "nexus_work_session"
    if ticket and create_time_entry:
        existing_entry = await db.time_entries.find_one(
            tenant_scoped_query(user, {"remote_session_id": session["id"]}),
            {"_id": 0},
        )
        if existing_entry:
            time_entry_doc = existing_entry
            await sync_ticket_time_cache(ticket["id"], database=db)
        else:
            technician = await db.users.find_one(
                tenant_scoped_query(user, {"id": str(session.get("user_id") or user.get("id"))}),
                {"_id": 0, "hourly_rate": 1},
            )
            try:
                hourly_rate = float((technician or {}).get("hourly_rate") or 75.0)
            except (TypeError, ValueError):
                hourly_rate = 75.0
            billable = bool(data.get("billable", True))
            time_ticket = {
                **ticket,
                "client_id": session.get("client_id") or ticket.get("client_id"),
                "client_name": session.get("client_name") or ticket.get("client_name"),
            }
            time_entry_doc, _ = await create_canonical_ticket_time_entry(
                ticket=time_ticket,
                actor={
                    "id": str(session.get("user_id") or user.get("id")),
                    "name": session.get("user_name") or user.get("name"),
                    "email": user.get("email"),
                },
                minutes=duration,
                description=notes or f"Remote support on {session.get('device_name') or 'managed endpoint'}",
                billable=billable,
                source="nexus_remote",
                source_reference=session["id"],
                hourly_rate=hourly_rate,
                created_at=now_dt.isoformat(),
                extra={"remote_session_id": session["id"]},
                database=db,
            )
        updates["time_entry_id"] = time_entry_doc["id"]

    if launch_confirmed:
        detail = (
            f"Remote support session completed on **{session.get('device_name') or session['device_id']}** "
            f"via {str(session.get('provider') or 'remote').title()} ({duration} min)."
        )
        if work_session_time_owner:
            detail += "\n\nTime remains in the linked Nexus Work Session for technician review and completion."
        if notes:
            detail += f"\n\nOutcome: {notes}"
    else:
        detail = (
            f"Remote support was authorised for **{session.get('device_name') or session['device_id']}** "
            f"via {str(session.get('provider') or 'remote').title()}, but the connection was not confirmed. "
            "No service time was recorded."
        )
        if notes:
            detail += f"\n\nTechnician note: {notes}"

    if ticket and policy["auto_ticket_note"]:
        await db.ticket_notes.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": platform_tenant_id(user),
            "ticket_id": ticket["id"],
            "user_id": user.get("id"),
            "user_name": user.get("name") or user.get("email"),
            "content": detail,
            "is_internal": True,
            "is_system_action": True,
            "remote_session_id": session["id"],
            "created_at": now_dt.isoformat(),
        })

    await db.remote_sessions.update_one(tenant_scoped_query(user, {"id": session["id"]}), {"$set": updates})
    await _record_ticket_remote_audit(
        ticket_id=session.get("ticket_id"),
        user=user,
        action="remote_session_ended",
        details=(
            f"{session.get('device_name') or session['device_id']} · "
            f"{duration} min · {lock_action} · "
            f"{'connection confirmed' if launch_confirmed else 'connection not confirmed; no time recorded'}"
        ),
        remote_session_id=session["id"],
    )
    await log_activity(
        user,
        "remote_disconnect",
        "device",
        session.get("device_id", ""),
        session.get("device_name", ""),
        f"Ended remote session ({duration} min)",
        metadata={
            "session_id": session["id"],
            "duration_minutes": duration,
            "ticket_id": session.get("ticket_id"),
            "time_entry_id": updates.get("time_entry_id"),
            "work_session_id": session.get("work_session_id"),
            "time_entry_owner": updates.get("time_entry_owner") or session.get("time_entry_owner"),
            "lock_action": lock_action,
        },
    )
    await emit_platform_event(
        subject="remote.session.ended",
        source="nexus.remote",
        actor=user,
        client_id=session.get("client_id"),
        correlation_id=correlation_id or session.get("correlation_id"),
        idempotency_key=f"remote-session-ended:{session['id']}",
        partition_key=session.get("client_id") or session.get("device_id"),
        payload={
            "session_id": session["id"],
            "device_id": session.get("device_id"),
            "ticket_id": session.get("ticket_id"),
            "duration_minutes": duration,
            "time_entry_id": updates.get("time_entry_id"),
            "work_session_id": session.get("work_session_id"),
            "time_entry_owner": updates.get("time_entry_owner") or session.get("time_entry_owner"),
            "status": "ended",
        },
    )
    ended = {**session, **updates}
    return {
        "message": (
            "Session ended and evidence saved"
            if launch_confirmed
            else "Session authorisation ended; no time was recorded because the connection was not confirmed"
        ),
        "session": ended,
        "duration_minutes": duration,
        "time_entry_id": updates.get("time_entry_id"),
        "time_entry_suppressed_by": updates.get("time_entry_suppressed_by"),
    }


async def remote_health_for_device(device: dict) -> dict[str, Any]:
    policy = await remote_policy(str(device.get("tenant_id") or "nexus-local"))
    provider = "nexus"
    remote_id = await provider_device_id(device, provider)
    device_tenant = str(device.get("tenant_id") or "nexus-local")
    readiness = await native_device_readiness(device, device_tenant)
    agent = None
    if device.get("nexus_agent_id"):
        agent = await db.nexus_agents.find_one(
            tenant_scoped_query({"tenant_id": device_tenant}, {"id": device["nexus_agent_id"], "is_active": True}),
            {"_id": 0, "id": 1, "last_seen": 1, "agent_version": 1, "self_repair": 1},
        )
    last_seen = parse_datetime((agent or {}).get("last_seen"))
    age_seconds = (
        max(0, int((datetime.now(timezone.utc) - last_seen).total_seconds()))
        if last_seen
        else None
    )
    agent_online = age_seconds is not None and age_seconds <= 300
    checks = [
        {
            "id": "trust",
            "label": "Nexus trust boundary",
            "status": "healthy",
            "detail": "Short-lived signed grants and local consent are enforced",
        },
        {
            "id": "identity",
            "label": "Remote identity",
            "status": "healthy" if remote_id else "blocked",
            "detail": f"Identity {remote_id}" if remote_id else "No remote identity is linked",
        },
        {
            "id": "companion",
            "label": "Remote Companion",
            "status": "healthy" if readiness.get("ready") else "blocked",
            "detail": readiness.get("detail"),
        },
    ]
    if any(item["status"] == "blocked" for item in checks):
        status = "blocked"
    elif any(item["status"] in {"attention", "unavailable"} for item in checks):
        status = "attention"
    else:
        status = "healthy"
    result = {
        "device_id": device.get("id"),
        "device_name": device.get("name") or device.get("hostname"),
        "client_id": device.get("client_id"),
        "provider": provider,
        "provider_device_id": remote_id or None,
        "status": status,
        "ready": bool(readiness.get("ready")),
        "agent_online": agent_online,
        "last_checked_at": utc_now(),
        "checks": checks,
        "repair_available": False,
        "policy": {
            "auto_repair": bool(policy["auto_repair"]),
            "repair_cooldown_minutes": int(policy["repair_cooldown_minutes"]),
        },
    }
    await db.devices.update_one(
        tenant_scoped_query({"tenant_id": device_tenant}, {"id": device.get("id")}),
        {"$set": {
            "remote_health": status,
            "remote_health_checked_at": result["last_checked_at"],
        }},
    )
    return result


async def queue_remote_repair(
    *,
    device: dict,
    user: dict,
    reason: str,
    automatic: bool = False,
) -> dict[str, Any]:
    await ensure_remote_runtime_indexes()
    health = await remote_health_for_device(device)
    if health["provider"] == "nexus":
        raise HTTPException(
            status_code=409,
            detail="Nexus Native self-repair will be enabled with the signed Remote Companion package",
        )
    if not health["agent_online"]:
        raise HTTPException(
            status_code=409,
            detail="Nexus Agent is offline; remote repair cannot be safely queued",
        )
    policy = await remote_policy(str(device.get("tenant_id") or "nexus-local"))
    cooldown = max(5, int(policy["repair_cooldown_minutes"]))
    recent = await db.remote_repairs.find_one(
        {"device_id": device.get("id"), "status": {"$in": ["queued", "running"]}},
        {"_id": 0},
        sort=[("requested_at", -1)],
    )
    if recent:
        requested = parse_datetime(recent.get("requested_at"))
        if requested and (datetime.now(timezone.utc) - requested).total_seconds() < cooldown * 60:
            return {**recent, "reused": True}

    repair_id = str(uuid.uuid4())
    command_id = await queue_command_for_device(
        device,
        "remote_repair",
        {
            "reason": str(reason or "Remote access health remediation")[:500],
            "provider": health["provider"],
        },
        queued_by=user.get("email") or user.get("name") or "nexus-remote",
    )
    repair = {
        "id": repair_id,
        "device_id": device.get("id"),
        "device_name": device.get("name") or device.get("hostname"),
        "client_id": device.get("client_id"),
        "provider": health["provider"],
        "command_id": command_id,
        "status": "queued",
        "reason": str(reason or "Remote access health remediation")[:500],
        "automatic": bool(automatic),
        "requested_by": user.get("id") or "system",
        "requested_by_name": user.get("name") or user.get("email") or "Nexus Remote",
        "requested_at": utc_now(),
        "preflight": health,
    }
    await db.remote_repairs.insert_one(dict(repair))
    await log_activity(
        user,
        "remote_repair_queued",
        "device",
        str(device.get("id") or ""),
        repair["device_name"] or "",
        "Queued Nexus Remote repair through the endpoint agent",
        metadata={"repair_id": repair_id, "command_id": command_id, "automatic": automatic},
    )
    await emit_platform_event(
        subject="remote.repair.queued",
        source="nexus.remote",
        actor=user,
        client_id=device.get("client_id"),
        idempotency_key=f"remote-repair-queued:{repair_id}",
        partition_key=device.get("client_id") or device.get("id"),
        payload={
            "repair_id": repair_id,
            "device_id": device.get("id"),
            "command_id": command_id,
            "provider": health["provider"],
        },
    )
    return repair
