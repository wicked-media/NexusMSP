"""Governed remote-access runtime for Nexus Remote.

Remote providers are transports.  This service owns the durable MSP evidence:
client scope, ticket association, consent, technician identity, session
lifecycle, time entry, ticket note, platform events and endpoint repair.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import ceil
from typing import Any
from urllib.parse import urlparse
import uuid

from fastapi import HTTPException

from app.database import db
from app.models import TimeEntry
from app.routers.nexus_agent import queue_command_for_device
from app.services.activity import log_activity
from app.services.platform_foundation import emit_platform_event


REMOTE_POLICY_DEFAULTS: dict[str, Any] = {
    "default_provider": "rustdesk",
    "allow_fallback": True,
    "require_consent": True,
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
ACTIVE_SESSION_STATUSES = frozenset({"authorised", "active", "ending"})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _provider_host(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw if "://" in raw else f"//{raw}")
    return str(parsed.hostname or "").strip()


def build_rustdesk_uri(rustdesk_id: Any, relay_server: Any = None, server_url: Any = None) -> str:
    """Build a native URI without ever embedding an unattended password."""

    remote_id = str(rustdesk_id or "").strip()
    if not remote_id:
        raise HTTPException(status_code=409, detail="This device has no RustDesk identity")
    host = _provider_host(relay_server) or _provider_host(server_url)
    return f"rustdesk://{remote_id}@{host}" if host else f"rustdesk://{remote_id}"


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


async def remote_policy() -> dict[str, Any]:
    stored = await db.settings.find_one({"type": "remote_access_policy"}, {"_id": 0}) or {}
    return {**REMOTE_POLICY_DEFAULTS, **stored}


async def rustdesk_config() -> dict[str, Any]:
    typed = await db.settings.find_one({"type": "rustdesk"}, {"_id": 0}) or {}
    legacy = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0}) or {}
    legacy_value = legacy.get("value") if isinstance(legacy.get("value"), dict) else {}
    return {
        **legacy_value,
        **{
            key: value
            for key, value in typed.items()
            if key != "_id" and value not in (None, "")
        },
    }


async def provider_is_active(provider_id: str) -> bool:
    if provider_id == "rustdesk":
        config = await rustdesk_config()
        return bool(config.get("server_url") and config.get("enabled", True))
    if provider_id == "trmm":
        config = await db.settings.find_one({"type": "tactical_rmm"}, {"_id": 0}) or {}
        return bool(config.get("base_url") and config.get("api_key_full"))
    config = await db.settings.find_one({"type": f"remote_{provider_id}"}, {"_id": 0}) or {}
    return bool(config.get("active"))


async def provider_device_id(device: dict, provider_id: str) -> str:
    if provider_id == "rustdesk":
        direct = str(device.get("rustdesk_id") or "").strip()
        if direct:
            return direct
        mapping = await db.rustdesk_devices.find_one(
            {
                "$or": [
                    {"linked_device_id": device.get("id")},
                    {"device_id": device.get("id")},
                ]
            },
            {"_id": 0, "rustdesk_id": 1},
        )
        return str((mapping or {}).get("rustdesk_id") or "").strip()
    if provider_id == "trmm":
        return str(device.get("trmm_agent_id") or "").strip()
    identifiers = device.get("remote_provider_ids") or {}
    return str(
        identifiers.get(provider_id)
        or device.get(f"{provider_id}_id")
        or device.get(f"{provider_id}_uuid")
        or ""
    ).strip()


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


async def _connection_handoff(provider: str, provider_id: str) -> dict[str, Any]:
    if provider == "rustdesk":
        config = await rustdesk_config()
        return {
            "launch_mode": "native_client",
            "connection_url": build_rustdesk_uri(
                provider_id,
                config.get("relay_server"),
                config.get("server_url"),
            ),
            "web_client_url": str(config.get("server_url") or "").strip() or None,
            "relay_server": _provider_host(config.get("relay_server") or config.get("server_url")) or None,
        }
    if provider == "splashtop":
        return {
            "launch_mode": "provider_handoff",
            "connection_url": None,
            "web_client_url": None,
            "relay_server": None,
        }
    return {
        "launch_mode": "provider_handoff",
        "connection_url": None,
        "web_client_url": None,
        "relay_server": None,
    }


async def start_remote_session(
    *,
    device: dict,
    user: dict,
    data: dict,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    await ensure_remote_runtime_indexes()
    policy = await remote_policy()
    provider = str(
        data.get("provider")
        or device.get("remote_provider")
        or policy["default_provider"]
    ).strip().lower()
    if provider == "inherit":
        provider = str(policy["default_provider"])
    if provider not in {"rustdesk", "splashtop", "trmm"}:
        raise HTTPException(status_code=422, detail="Unsupported remote provider")

    ticket_id = str(data.get("ticket_id") or "").strip() or None
    ticket = await validate_ticket_for_remote(ticket_id, device) if ticket_id else None
    if policy["require_ticket_reference"] and not ticket:
        raise HTTPException(
            status_code=422,
            detail="A linked ticket is required before starting a remote session",
        )

    consent_confirmed = bool(data.get("consent_confirmed"))
    consent_method = str(data.get("consent_method") or "attended_prompt").strip().lower()
    if consent_method not in CONSENT_METHODS:
        raise HTTPException(status_code=422, detail="Choose a supported consent method")
    if policy["require_consent"] and not consent_confirmed:
        raise HTTPException(
            status_code=422,
            detail="End-user consent must be confirmed before starting a remote session",
        )
    if not await provider_is_active(provider):
        raise HTTPException(
            status_code=409,
            detail=f"{provider.title()} is not enabled in Remote Access settings",
        )

    remote_id = await provider_device_id(device, provider)
    if not remote_id:
        raise HTTPException(
            status_code=409,
            detail=f"This device has not been enrolled in {provider.title()}",
        )

    idempotency_key = str(data.get("idempotency_key") or "").strip() or None
    if idempotency_key:
        existing = await db.remote_sessions.find_one(
            {"user_id": user.get("id"), "idempotency_key": idempotency_key},
            {"_id": 0},
        )
        if existing:
            handoff = await _connection_handoff(existing["provider"], existing["provider_device_id"])
            return {"session": existing, "provider": existing["provider"], **handoff, "reused": True}

    client = await db.clients.find_one({"id": device.get("client_id")}, {"_id": 0}) or {}
    now = utc_now()
    session = {
        "id": str(uuid.uuid4()),
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
        "rustdesk_id": remote_id if provider == "rustdesk" else device.get("rustdesk_id"),
        "ticket_id": ticket_id,
        "ticket_number": (ticket or {}).get("ticket_number"),
        "purpose": str(data.get("purpose") or "Technician support session").strip()[:500],
        "consent_required": bool(policy["require_consent"]),
        "consent_confirmed": consent_confirmed,
        "consent_method": consent_method if consent_confirmed else None,
        "consent_confirmed_at": now if consent_confirmed else None,
        "launch_status": "ready" if provider == "rustdesk" else "handoff_required",
        "device_type": device.get("device_type", "workstation"),
        "create_time_entry": bool(data.get("create_time_entry", policy["auto_create_time_entry"])),
        "idempotency_key": idempotency_key,
        "correlation_id": correlation_id,
        "started_at": now,
        "opened_at": None,
        "last_heartbeat_at": None,
        "ended_at": None,
        "duration_minutes": 0,
    }
    await db.remote_sessions.insert_one(dict(session))
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
            "consent_method": session["consent_method"],
        },
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
            "provider": provider,
            "status": "authorised",
        },
    )
    handoff = await _connection_handoff(provider, remote_id)
    return {
        "session": session,
        "provider": provider,
        **handoff,
        "reused": False,
        "message": (
            "Launch is authorised and recorded. Open the RustDesk client to continue."
            if provider == "rustdesk"
            else f"Open this endpoint from the {provider.title()} technician console."
        ),
    }


async def mark_remote_session_opened(session: dict, user: dict) -> dict:
    if session.get("status") == "ended":
        raise HTTPException(status_code=409, detail="This remote session has already ended")
    if str(session.get("user_id")) != str(user.get("id")) and not (
        user.get("is_admin") or str(user.get("role") or "").lower() == "admin"
    ):
        raise HTTPException(status_code=403, detail="Only the session technician can confirm this launch")
    now = utc_now()
    await db.remote_sessions.update_one(
        {"id": session["id"]},
        {"$set": {
            "status": "active",
            "launch_status": "launched",
            "opened_at": session.get("opened_at") or now,
            "last_heartbeat_at": now,
        }},
    )
    return {
        **session,
        "status": "active",
        "launch_status": "launched",
        "opened_at": session.get("opened_at") or now,
        "last_heartbeat_at": now,
    }


async def heartbeat_remote_session(session: dict, user: dict) -> dict:
    if session.get("status") not in ACTIVE_SESSION_STATUSES:
        raise HTTPException(status_code=409, detail="This remote session is no longer active")
    if str(session.get("user_id")) != str(user.get("id")):
        raise HTTPException(status_code=403, detail="Only the session technician can update its heartbeat")
    now = utc_now()
    await db.remote_sessions.update_one(
        {"id": session["id"]},
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
    started = parse_datetime(session.get("opened_at") or session.get("started_at")) or now_dt
    duration = max(1, ceil(max(0.0, (now_dt - started).total_seconds()) / 60))
    notes = str(data.get("notes") or data.get("summary") or "").strip()[:2000]
    lock_action = str(data.get("lock_action_on_disconnect") or "no_change").strip()
    if lock_action not in {"locked", "unlocked", "no_change"}:
        raise HTTPException(status_code=422, detail="Choose locked, unlocked, or no change")

    updates = {
        "status": "ended",
        "launch_status": "completed",
        "ended_at": now_dt.isoformat(),
        "duration_minutes": duration,
        "notes": notes or None,
        "was_locked_before_disconnect": data.get("was_locked_before_disconnect"),
        "lock_action_on_disconnect": lock_action,
        "ended_by": user.get("id"),
        "ended_by_name": user.get("name") or user.get("email"),
    }

    policy = await remote_policy()
    ticket = None
    time_entry_doc = None
    if session.get("ticket_id"):
        ticket = await db.tickets.find_one({"id": session["ticket_id"]}, {"_id": 0})
    create_time_entry = bool(
        data.get(
            "create_time_entry",
            session.get("create_time_entry", policy["auto_create_time_entry"]),
        )
    )
    if ticket and create_time_entry:
        existing_entry = await db.time_entries.find_one(
            {"remote_session_id": session["id"]},
            {"_id": 0},
        )
        if existing_entry:
            time_entry_doc = existing_entry
        else:
            technician = await db.users.find_one(
                {"id": str(session.get("user_id") or user.get("id"))},
                {"_id": 0, "hourly_rate": 1},
            )
            hourly_rate = float((technician or {}).get("hourly_rate") or 75.0)
            billable = bool(data.get("billable", True))
            entry = TimeEntry(
                ticket_id=ticket["id"],
                ticket_title=ticket.get("title"),
                client_id=session.get("client_id") or ticket.get("client_id"),
                client_name=session.get("client_name") or ticket.get("client_name"),
                user_id=str(session.get("user_id") or user.get("id")),
                user_name=session.get("user_name") or user.get("name"),
                description=notes or f"Remote support on {session.get('device_name') or 'managed endpoint'}",
                minutes=duration,
                hourly_rate=hourly_rate,
                total_amount=round((duration / 60) * hourly_rate, 2) if billable else 0.0,
                billable=billable,
                invoiced=False,
            )
            time_entry_doc = entry.model_dump()
            time_entry_doc["created_at"] = entry.created_at.isoformat()
            time_entry_doc["remote_session_id"] = session["id"]
            time_entry_doc["source"] = "nexus_remote"
            await db.time_entries.insert_one(dict(time_entry_doc))
        updates["time_entry_id"] = time_entry_doc["id"]

    if ticket and policy["auto_ticket_note"]:
        detail = (
            f"Remote support session completed on **{session.get('device_name') or session['device_id']}** "
            f"via {str(session.get('provider') or 'remote').title()} ({duration} min)."
        )
        if notes:
            detail += f"\n\nOutcome: {notes}"
        await db.ticket_notes.insert_one({
            "id": str(uuid.uuid4()),
            "ticket_id": ticket["id"],
            "user_id": user.get("id"),
            "user_name": user.get("name") or user.get("email"),
            "content": detail,
            "is_internal": True,
            "is_system_action": True,
            "remote_session_id": session["id"],
            "created_at": now_dt.isoformat(),
        })
        await db.ticket_audit_log.insert_one({
            "id": str(uuid.uuid4()),
            "ticket_id": ticket["id"],
            "user_id": user.get("id"),
            "user_name": user.get("name") or user.get("email"),
            "action": "remote_session_ended",
            "details": f"{session.get('device_name') or session['device_id']} · {duration} min · {lock_action}",
            "remote_session_id": session["id"],
            "created_at": now_dt.isoformat(),
        })

    await db.remote_sessions.update_one({"id": session["id"]}, {"$set": updates})
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
            "status": "ended",
        },
    )
    ended = {**session, **updates}
    return {
        "message": "Session ended and evidence saved",
        "session": ended,
        "duration_minutes": duration,
        "time_entry_id": updates.get("time_entry_id"),
    }


async def remote_health_for_device(device: dict) -> dict[str, Any]:
    policy = await remote_policy()
    provider = str(device.get("remote_provider") or policy["default_provider"])
    if provider == "inherit":
        provider = str(policy["default_provider"])
    remote_id = await provider_device_id(device, provider)
    provider_active = await provider_is_active(provider)
    agent = None
    if device.get("nexus_agent_id"):
        agent = await db.nexus_agents.find_one(
            {"id": device["nexus_agent_id"], "is_active": True},
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
            "id": "provider",
            "label": f"{provider.title()} provider",
            "status": "healthy" if provider_active else "blocked",
            "detail": "Enabled and configured" if provider_active else "Provider settings are incomplete",
        },
        {
            "id": "identity",
            "label": "Remote identity",
            "status": "healthy" if remote_id else "blocked",
            "detail": f"Identity {remote_id}" if remote_id else "No remote identity is linked",
        },
        {
            "id": "agent",
            "label": "Nexus Agent heartbeat",
            "status": "healthy" if agent_online else ("attention" if agent else "unavailable"),
            "detail": (
                f"Checked in {age_seconds}s ago"
                if agent_online
                else ("Agent is stale or offline" if agent else "No Nexus Agent is linked")
            ),
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
        "ready": bool(provider_active and remote_id),
        "agent_online": agent_online,
        "last_checked_at": utc_now(),
        "checks": checks,
        "repair_available": bool(agent_online),
        "policy": {
            "auto_repair": bool(policy["auto_repair"]),
            "repair_cooldown_minutes": int(policy["repair_cooldown_minutes"]),
        },
    }
    await db.devices.update_one(
        {"id": device.get("id")},
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
    if not health["agent_online"]:
        raise HTTPException(
            status_code=409,
            detail="Nexus Agent is offline; remote repair cannot be safely queued",
        )
    policy = await remote_policy()
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
