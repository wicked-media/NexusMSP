"""Customer-to-technician chat connection policy and persistence.

This module deliberately layers customer connections over the existing
``chat_channels``/``chat_messages`` contract.  Technicians therefore keep the
same Team Chat experience, while portal users get a separately authenticated,
client-bound view of the exact same conversation.

The portal user is *not* inserted into ``users`` merely to make a direct chat
work.  Portal identity remains authoritative in ``portal_users`` and the
channel carries the stable portal-user and client IDs needed to enforce that
boundary.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import uuid
from typing import Any

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from app.database import db
from app.services.activity import log_activity
from app.services.portal_audit import record_portal_event
from app.services.scope_permissions import effective_scope, normalise_scope_ids


STAFF_CHAT_ROLES = frozenset({"admin", "owner", "technician", "engineer"})
MAX_IDENTIFIER_LENGTH = 200
MAX_SUBJECT_LENGTH = 160
MAX_MESSAGE_LENGTH = 2_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_identifier(value: Any, *, label: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned or len(cleaned) > MAX_IDENTIFIER_LENGTH:
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return cleaned


def _client_id(portal_user: dict) -> str:
    return _clean_identifier(portal_user.get("client_id"), label="client context")


def _is_active_staff(user: dict) -> bool:
    return (
        str(user.get("role") or "").strip().lower() in STAFF_CHAT_ROLES
        and user.get("is_active") is not False
        and user.get("active") is not False
        and user.get("archived") is not True
        and user.get("customer_chat_enabled") is not False
    )


def customer_chat_allowed_client_ids(technician: dict) -> list[str] | None:
    """Return explicitly reachable client IDs for customer chat.

    ``None`` means the account has an explicitly global operational scope;
    ``[]`` means it must not receive customer chats.  Keeping this separate
    lets Team Chat revoke a previously-open client conversation immediately
    when a technician's scope or customer-chat entitlement changes.
    """
    if not _is_active_staff(technician):
        return []
    explicit_chat_clients = technician.get("customer_chat_client_ids")
    if explicit_chat_clients is not None:
        return normalise_scope_ids(explicit_chat_clients)
    scope = effective_scope(technician)
    return None if scope["mode"] == "all" else scope["client_ids"]


def technician_is_eligible_for_client(technician: dict, client_id: str) -> bool:
    """Return only explicitly client-scoped, customer-chat eligible staff.

    An unscoped non-administrator is deliberately ineligible.  This preserves
    the same fail-closed client boundary that governs operational access: an
    account cannot receive a customer's direct request simply because it has a
    technician-looking title.
    """
    client_id = str(client_id or "").strip()
    if not client_id:
        return False
    allowed_client_ids = customer_chat_allowed_client_ids(technician)
    return allowed_client_ids is None or client_id in allowed_client_ids


async def _portal_client(portal_user: dict) -> dict:
    client_id = _client_id(portal_user)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1, "tenant_id": 1})
    if not client:
        # A portal session without a canonical client record must not be able
        # to create a loosely-bound customer chat record.
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _tenant_id(portal_user: dict, client: dict) -> str:
    return str(client.get("tenant_id") or portal_user.get("tenant_id") or "").strip()


def _technician_projection() -> dict:
    return {
        "_id": 0,
        "id": 1,
        "name": 1,
        "email": 1,
        "avatar": 1,
        "role": 1,
        "title": 1,
        "job_title": 1,
        "specialties": 1,
        "skills": 1,
        "is_active": 1,
        "active": 1,
        "archived": 1,
        "customer_chat_enabled": 1,
        "customer_chat_client_ids": 1,
        "client_scope_mode": 1,
        "client_scope_ids": 1,
        "site_scope_ids": 1,
        "is_admin": 1,
    }


def _present_technician(technician: dict, *, favourite: bool) -> dict:
    raw_specialties = technician.get("specialties") or technician.get("skills") or []
    specialties = [str(item).strip() for item in raw_specialties if str(item).strip()] if isinstance(raw_specialties, list) else []
    return {
        "id": technician.get("id"),
        "name": technician.get("name") or technician.get("email") or "Nexus technician",
        "role": technician.get("role") or "technician",
        "title": technician.get("title") or technician.get("job_title") or "Technician",
        "avatar": technician.get("avatar"),
        "specialties": specialties[:12],
        "availability": "available",  # Presence is layered in by the UI; do not leak another client's work state here.
        "is_favourite": favourite,
        "can_request_chat": True,
    }


async def _favourite_ids(*, portal_user_id: str, client_id: str) -> set[str]:
    rows = await db.customer_technician_favorites.find(
        {"portal_user_id": portal_user_id, "client_id": client_id},
        {"_id": 0, "technician_id": 1},
    ).to_list(500)
    return {str(row.get("technician_id")) for row in rows if row.get("technician_id")}


async def list_portal_technicians(portal_user: dict, *, favourites_only: bool = False) -> dict:
    client = await _portal_client(portal_user)
    client_id = str(client["id"])
    portal_user_id = _clean_identifier(portal_user.get("id"), label="portal user")
    favourites = await _favourite_ids(portal_user_id=portal_user_id, client_id=client_id)
    rows = await db.users.find(
        {"is_active": {"$ne": False}, "archived": {"$ne": True}},
        _technician_projection(),
    ).to_list(500)
    technicians = [
        _present_technician(row, favourite=str(row.get("id")) in favourites)
        for row in rows
        if technician_is_eligible_for_client(row, client_id)
    ]
    if favourites_only:
        technicians = [row for row in technicians if row["is_favourite"]]
    technicians.sort(key=lambda item: (not item["is_favourite"], str(item["name"]).lower(), str(item["id"])))
    return {"client_id": client_id, "technicians": technicians}


async def _eligible_technician_for_portal(portal_user: dict, technician_id: str) -> tuple[dict, dict]:
    client = await _portal_client(portal_user)
    client_id = str(client["id"])
    technician = await db.users.find_one({"id": technician_id}, _technician_projection())
    if not technician or not technician_is_eligible_for_client(technician, client_id):
        # Do not disclose whether the supplied ID belongs to another client or
        # an otherwise unavailable employee.
        raise HTTPException(status_code=404, detail="Technician not available")
    return client, technician


def _favourite_document_id(*, portal_user_id: str, client_id: str, technician_id: str) -> str:
    material = f"nexus-customer-chat-favourite:v1:{client_id}:{portal_user_id}:{technician_id}"
    return f"customer-chat-favourite-{hashlib.sha256(material.encode('utf-8')).hexdigest()[:40]}"


async def set_portal_favourite(portal_user: dict, technician_id: str, *, favourite: bool) -> dict:
    technician_id = _clean_identifier(technician_id, label="technician")
    client, technician = await _eligible_technician_for_portal(portal_user, technician_id)
    client_id = str(client["id"])
    portal_user_id = _clean_identifier(portal_user.get("id"), label="portal user")
    favourite_id = _favourite_document_id(
        portal_user_id=portal_user_id,
        client_id=client_id,
        technician_id=technician_id,
    )
    existing = await db.customer_technician_favorites.find_one({"_id": favourite_id}, {"_id": 0, "id": 1})
    now = _now()
    if favourite:
        await db.customer_technician_favorites.update_one(
            {"_id": favourite_id},
            {
                "$set": {
                    "id": favourite_id,
                    "client_id": client_id,
                    "tenant_id": _tenant_id(portal_user, client),
                    "portal_user_id": portal_user_id,
                    "technician_id": technician_id,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        changed = not bool(existing)
    else:
        deleted = await db.customer_technician_favorites.delete_one(
            {"_id": favourite_id, "portal_user_id": portal_user_id, "client_id": client_id}
        )
        changed = bool(getattr(deleted, "deleted_count", 0))

    await record_portal_event(
        action="customer_technician_favourite_changed",
        client_id=client_id,
        client_name=client.get("name", ""),
        portal_user=portal_user,
        details=f"Favourite technician {'saved' if favourite else 'removed'}",
        metadata={"technician_id": technician_id, "favourite": bool(favourite), "changed": changed},
    )
    return {
        "technician_id": technician_id,
        "technician_name": technician.get("name") or technician.get("email") or "Nexus technician",
        "is_favourite": bool(favourite),
        "changed": changed,
    }


def _pending_key(*, client_id: str, portal_user_id: str, technician_id: str) -> str:
    material = f"nexus-customer-chat-request:v1:{client_id}:{portal_user_id}:{technician_id}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


async def _validated_context(raw_context: Any, *, client_id: str) -> dict[str, str]:
    if raw_context is None:
        return {}
    if not isinstance(raw_context, dict):
        raise HTTPException(status_code=422, detail="Context must be an object")
    unexpected = set(raw_context) - {"ticket_id", "device_id"}
    if unexpected:
        raise HTTPException(status_code=422, detail="Context contains unsupported fields")

    context: dict[str, str] = {}
    if raw_context.get("ticket_id") is not None:
        ticket_id = _clean_identifier(raw_context.get("ticket_id"), label="ticket")
        ticket = await db.tickets.find_one({"id": ticket_id, "client_id": client_id}, {"_id": 0, "id": 1})
        if not ticket:
            raise HTTPException(status_code=404, detail="Related record not available")
        context["ticket_id"] = ticket_id
    if raw_context.get("device_id") is not None:
        device_id = _clean_identifier(raw_context.get("device_id"), label="device")
        device = await db.devices.find_one({"id": device_id, "client_id": client_id}, {"_id": 0, "id": 1})
        if not device:
            raise HTTPException(status_code=404, detail="Related record not available")
        context["device_id"] = device_id
    return context


def _safe_request(record: dict) -> dict:
    """Return a request payload without internal de-duplication keys."""
    return {
        "id": record.get("id"),
        "client_id": record.get("client_id"),
        "client_name": record.get("client_name") or "",
        "technician_id": record.get("technician_id"),
        "technician_name": record.get("technician_name") or "Nexus technician",
        "portal_user_id": record.get("portal_user_id"),
        "requester_name": record.get("requester_name") or "Customer contact",
        "requester_email": record.get("requester_email") or "",
        "subject": record.get("subject") or "Direct chat request",
        "message": record.get("message") or "",
        "context": dict(record.get("context") or {}),
        "status": record.get("status") or "pending",
        "response": record.get("response") or "",
        "channel_id": record.get("channel_id"),
        "created_at": record.get("created_at"),
        "resolved_at": record.get("resolved_at"),
        "resolved_by": record.get("resolved_by"),
    }


async def create_portal_request(portal_user: dict, payload: dict) -> dict:
    technician_id = _clean_identifier((payload or {}).get("technician_id"), label="technician")
    raw_message = str((payload or {}).get("message") or "").strip()
    if not raw_message or len(raw_message) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=422, detail=f"Message must be between 1 and {MAX_MESSAGE_LENGTH} characters")
    subject = str((payload or {}).get("subject") or "Direct chat request").strip()
    if not subject or len(subject) > MAX_SUBJECT_LENGTH:
        raise HTTPException(status_code=422, detail=f"Subject must be between 1 and {MAX_SUBJECT_LENGTH} characters")

    client, technician = await _eligible_technician_for_portal(portal_user, technician_id)
    client_id = str(client["id"])
    portal_user_id = _clean_identifier(portal_user.get("id"), label="portal user")
    favourite_ids = await _favourite_ids(portal_user_id=portal_user_id, client_id=client_id)
    if technician_id not in favourite_ids:
        # A direct customer connection is deliberate: a portal user chooses
        # the technician first, then asks that person to approve contact.
        # This prevents an API caller from turning the directory into an
        # unsolicited staff-messaging surface.
        raise HTTPException(status_code=422, detail="Follow the technician before requesting a direct chat")
    context = await _validated_context((payload or {}).get("context"), client_id=client_id)
    key = _pending_key(client_id=client_id, portal_user_id=portal_user_id, technician_id=technician_id)
    existing = await db.customer_technician_chat_requests.find_one(
        {"pending_key": key, "status": "pending"}, {"_id": 0}
    )
    if existing:
        return {"request": _safe_request(existing), "reused": True}

    now = _now()
    request_id = uuid.uuid4().hex
    record = {
        "id": request_id,
        "client_id": client_id,
        "client_name": str(client.get("name") or "")[:200],
        "tenant_id": _tenant_id(portal_user, client),
        "portal_user_id": portal_user_id,
        "requester_name": str(portal_user.get("name") or portal_user.get("email") or "Customer contact")[:200],
        "requester_email": str(portal_user.get("email") or "")[:320],
        "technician_id": technician_id,
        "technician_name": str(technician.get("name") or technician.get("email") or "Nexus technician")[:200],
        "subject": subject,
        "message": raw_message,
        "context": context,
        "status": "pending",
        "pending_key": key,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.customer_technician_chat_requests.insert_one(dict(record))
        reused = False
    except DuplicateKeyError:
        # The unique partial index makes simultaneous browser retries converge
        # on the one live request instead of spamming a technician.
        existing = await db.customer_technician_chat_requests.find_one(
            {"pending_key": key, "status": "pending"}, {"_id": 0}
        )
        if not existing:
            raise
        return {"request": _safe_request(existing), "reused": True}

    await db.notifications.insert_one({
        "id": uuid.uuid4().hex,
        "type": "customer_direct_chat_request",
        "title": "New customer chat request",
        "message": f"{record['requester_name']} requested a direct chat.",
        "ref_type": "customer_technician_chat_request",
        "ref_id": request_id,
        "user_id": technician_id,
        "target_user_id": technician_id,
        "read": False,
        "created_at": now,
    })
    await record_portal_event(
        action="customer_technician_chat_requested",
        client_id=client_id,
        client_name=client.get("name", ""),
        portal_user=portal_user,
        details="Customer requested an approved direct technician chat",
        metadata={"request_id": request_id, "technician_id": technician_id, "context": context},
    )
    return {"request": _safe_request(record), "reused": reused}


async def list_portal_requests(portal_user: dict) -> dict:
    client = await _portal_client(portal_user)
    client_id = str(client["id"])
    portal_user_id = _clean_identifier(portal_user.get("id"), label="portal user")
    rows = await db.customer_technician_chat_requests.find(
        {"client_id": client_id, "portal_user_id": portal_user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"requests": [_safe_request(row) for row in rows]}


def _client_direct_signature(record: dict) -> str:
    material = ":".join(
        (
            "nexus-client-direct:v1",
            str(record.get("client_id") or ""),
            str(record.get("portal_user_id") or ""),
            str(record.get("technician_id") or ""),
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


async def _get_or_create_client_direct_channel(record: dict, technician: dict) -> tuple[dict, bool]:
    signature = _client_direct_signature(record)
    existing = await db.chat_channels.find_one({"client_direct_signature": signature}, {"_id": 0})
    if existing:
        return existing, False
    now = _now()
    customer_name = str(record.get("requester_name") or "Customer contact")[:200]
    channel = {
        "id": uuid.uuid4().hex,
        "name": f"customer-direct-{signature[:12]}",
        "display_name": customer_name,
        "description": "Approved customer direct conversation",
        "kind": "client_direct",
        "is_private": True,
        "is_dm": True,
        # Only the chosen technician is a Team Chat member. The portal
        # participant is authorized through the portal-specific route below.
        "member_ids": [str(record["technician_id"])],
        "client_id": str(record["client_id"]),
        "tenant_id": str(record.get("tenant_id") or ""),
        "client_name": str(record.get("client_name") or "")[:200],
        "portal_user_id": str(record["portal_user_id"]),
        "customer_user_id": str(record["portal_user_id"]),
        "customer_name": customer_name,
        "customer_email": str(record.get("requester_email") or "")[:320],
        "technician_id": str(record["technician_id"]),
        "technician_name": str(technician.get("name") or technician.get("email") or "Nexus technician")[:200],
        "source_request_id": str(record["id"]),
        "request_context": dict(record.get("context") or {}),
        "client_direct_signature": signature,
        "created_by": str(record["technician_id"]),
        "created_at": now,
        "updated_at": now,
        "last_message_at": now,
    }
    try:
        await db.chat_channels.insert_one(dict(channel))
    except DuplicateKeyError:
        existing = await db.chat_channels.find_one({"client_direct_signature": signature}, {"_id": 0})
        if not existing:
            raise
        return existing, False

    system_message = {
        "id": uuid.uuid4().hex,
        "channel_id": channel["id"],
        "user_id": "system",
        "user_name": "Nexus",
        "body": "Direct chat approved. Keep customer-impacting decisions linked to the relevant ticket or workflow.",
        "message_type": "system",
        "ts": now,
        "edited": False,
        "reactions": {},
        "client_id": channel["client_id"],
        "portal_user_id": channel["portal_user_id"],
    }
    await db.chat_messages.insert_one(system_message)
    return channel, True


def _decision(value: Any) -> str:
    decision = str(value or "").strip().lower()
    if decision not in {"accept", "decline"}:
        raise HTTPException(status_code=422, detail="Decision must be accept or decline")
    return decision


async def list_technician_requests(current_user: dict) -> dict:
    technician_id = _clean_identifier(current_user.get("id"), label="technician")
    if not _is_active_staff(current_user):
        raise HTTPException(status_code=403, detail="Technician chat access is not enabled")
    rows = await db.customer_technician_chat_requests.find(
        {"technician_id": technician_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    # The inbox is customer data, not a technician-global notification feed.
    # A later scope or entitlement change must revoke old request visibility as
    # well as the resulting channel itself.
    requests = [
        _safe_request(row)
        for row in rows
        if technician_is_eligible_for_client(current_user, str(row.get("client_id") or ""))
    ]
    return {
        "requests": requests,
        "summary": {
            "pending": sum(1 for row in requests if row["status"] == "pending"),
            "accepted": sum(1 for row in requests if row["status"] == "accepted"),
            "declined": sum(1 for row in requests if row["status"] == "declined"),
        },
    }


async def decide_technician_request(current_user: dict, request_id: str, payload: dict) -> dict:
    technician_id = _clean_identifier(current_user.get("id"), label="technician")
    if not _is_active_staff(current_user):
        raise HTTPException(status_code=403, detail="Technician chat access is not enabled")
    request_id = _clean_identifier(request_id, label="chat request")
    record = await db.customer_technician_chat_requests.find_one(
        {"id": request_id, "technician_id": technician_id}, {"_id": 0}
    )
    if not record:
        # Do not reveal requests assigned to another technician.
        raise HTTPException(status_code=404, detail="Chat request not found")
    if not technician_is_eligible_for_client(current_user, str(record.get("client_id") or "")):
        # A technician who no longer has this customer in scope cannot inspect
        # or decide a previously delivered direct-chat request.
        raise HTTPException(status_code=404, detail="Chat request not found")
    decision = _decision((payload or {}).get("decision"))
    response = str((payload or {}).get("response") or "").strip()
    if len(response) > MAX_MESSAGE_LENGTH:
        raise HTTPException(status_code=422, detail=f"Response must be at most {MAX_MESSAGE_LENGTH} characters")
    expected_status = "accepted" if decision == "accept" else "declined"

    if record.get("status") != "pending":
        if record.get("status") == expected_status:
            return {"request": _safe_request(record), "changed": False, "channel_id": record.get("channel_id")}
        raise HTTPException(status_code=409, detail="Chat request has already been decided")

    channel: dict | None = None
    channel_created = False
    if decision == "accept":
        channel, channel_created = await _get_or_create_client_direct_channel(record, current_user)

    now = _now()
    patch: dict[str, Any] = {
        "status": expected_status,
        "response": response,
        "resolved_at": now,
        "resolved_by": technician_id,
        "resolved_by_name": str(current_user.get("name") or current_user.get("email") or "Nexus technician")[:200],
        "updated_at": now,
    }
    if channel:
        patch["channel_id"] = channel["id"]
    result = await db.customer_technician_chat_requests.update_one(
        {"id": request_id, "technician_id": technician_id, "status": "pending"},
        {"$set": patch, "$unset": {"pending_key": ""}},
    )
    if not getattr(result, "modified_count", 0):
        latest = await db.customer_technician_chat_requests.find_one(
            {"id": request_id, "technician_id": technician_id}, {"_id": 0}
        )
        # A simultaneous decline can win after this accept path creates its
        # channel but before the conditional request-state update.  Compensate
        # only a channel created by this attempt so a declined request never
        # leaves a usable orphan conversation behind.
        if channel_created and channel and (not latest or latest.get("status") != "accepted"):
            await db.chat_messages.delete_many({"channel_id": channel["id"]})
            await db.chat_channels.delete_one({"id": channel["id"], "source_request_id": request_id})
        if latest and latest.get("status") == expected_status:
            return {"request": _safe_request(latest), "changed": False, "channel_id": latest.get("channel_id")}
        raise HTTPException(status_code=409, detail="Chat request was updated; refresh and try again")

    record.update(patch)
    await log_activity(
        current_user,
        f"customer_direct_chat_request_{expected_status}",
        "customer_technician_chat_request",
        request_id,
        record.get("subject") or "Direct chat request",
        details=f"Customer direct chat request {expected_status}",
        metadata={
            "client_id": record.get("client_id"),
            "portal_user_id": record.get("portal_user_id"),
            "technician_id": technician_id,
            "channel_id": record.get("channel_id"),
        },
    )
    await record_portal_event(
        action=f"customer_technician_chat_{expected_status}",
        client_id=str(record.get("client_id") or ""),
        portal_user={
            "id": record.get("portal_user_id"),
            "name": record.get("requester_name"),
            "email": record.get("requester_email"),
        },
        actor=current_user,
        details=f"Technician {expected_status} customer direct chat request",
        metadata={"request_id": request_id, "technician_id": technician_id, "channel_id": record.get("channel_id")},
    )
    return {"request": _safe_request(record), "changed": True, "channel_id": record.get("channel_id")}


async def _portal_channel(portal_user: dict, channel_id: str) -> dict:
    client_id = _client_id(portal_user)
    portal_user_id = _clean_identifier(portal_user.get("id"), label="portal user")
    channel_id = _clean_identifier(channel_id, label="conversation")
    channel = await db.chat_channels.find_one(
        {
            "id": channel_id,
            "kind": "client_direct",
            "client_id": client_id,
            "portal_user_id": portal_user_id,
        },
        {"_id": 0},
    )
    if not channel:
        # Same response for an unknown, revoked, or other-client conversation.
        raise HTTPException(status_code=404, detail="Conversation not found")
    return channel


def _safe_conversation(channel: dict) -> dict:
    return {
        "id": channel.get("id"),
        "channel_id": channel.get("id"),
        "client_id": channel.get("client_id"),
        "technician_id": channel.get("technician_id"),
        "technician_name": channel.get("technician_name") or "Nexus technician",
        "customer_name": channel.get("customer_name") or "Customer contact",
        "status": "active",
        "source_request_id": channel.get("source_request_id"),
        "updated_at": channel.get("updated_at"),
        "last_message_at": channel.get("last_message_at"),
    }


async def list_portal_conversations(portal_user: dict) -> dict:
    client_id = _client_id(portal_user)
    portal_user_id = _clean_identifier(portal_user.get("id"), label="portal user")
    rows = await db.chat_channels.find(
        {"kind": "client_direct", "client_id": client_id, "portal_user_id": portal_user_id},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(100)
    return {"conversations": [_safe_conversation(row) for row in rows]}


async def list_portal_messages(portal_user: dict, channel_id: str) -> dict:
    channel = await _portal_channel(portal_user, channel_id)
    rows = await db.chat_messages.find(
        {"channel_id": channel["id"], "deleted": {"$ne": True}}, {"_id": 0}
    ).sort("ts", 1).to_list(200)
    return {"channel": _safe_conversation(channel), "messages": rows}


async def send_portal_message(portal_user: dict, channel_id: str, payload: dict) -> dict:
    channel = await _portal_channel(portal_user, channel_id)
    body = str((payload or {}).get("body") or "").strip()
    if not body or len(body) > 5_000:
        raise HTTPException(status_code=422, detail="Message must be between 1 and 5000 characters")
    now = _now()
    message = {
        "id": uuid.uuid4().hex,
        "channel_id": channel["id"],
        "user_id": f"portal:{portal_user.get('id')}",
        "portal_user_id": str(portal_user.get("id") or ""),
        "actor_type": "portal_user",
        "user_name": str(portal_user.get("name") or portal_user.get("email") or "Customer contact")[:200],
        "avatar_url": portal_user.get("avatar"),
        "body": body,
        "ts": now,
        "edited": False,
        "reactions": {},
        "client_id": channel.get("client_id"),
    }
    await db.chat_messages.insert_one(dict(message))
    await db.chat_channels.update_one(
        {"id": channel["id"], "client_id": channel.get("client_id"), "portal_user_id": portal_user.get("id")},
        {"$set": {"updated_at": now, "last_message_at": now}},
    )
    technician_id = channel.get("technician_id")
    if technician_id:
        await db.notifications.insert_one({
            "id": uuid.uuid4().hex,
            "type": "customer_direct_chat_message",
            "title": f"New message from {message['user_name']}",
            "message": body[:200],
            "ref_type": "chat_channel",
            "ref_id": channel["id"],
            "user_id": technician_id,
            "target_user_id": technician_id,
            "read": False,
            "created_at": now,
        })
    await record_portal_event(
        action="customer_direct_chat_message_sent",
        client_id=str(channel.get("client_id") or ""),
        portal_user=portal_user,
        details="Customer sent a message in an approved direct chat",
        metadata={"channel_id": channel["id"], "technician_id": technician_id},
    )
    return message


async def initialize_customer_chat_storage() -> None:
    """Indexes keep pending requests and direct-channel creation idempotent."""
    await db.customer_technician_favorites.create_index(
        [("client_id", 1), ("portal_user_id", 1), ("technician_id", 1)], unique=True
    )
    await db.customer_technician_chat_requests.create_index(
        [("pending_key", 1)], unique=True, partialFilterExpression={"status": "pending"}
    )
    await db.customer_technician_chat_requests.create_index(
        [("technician_id", 1), ("status", 1), ("created_at", -1)]
    )
    await db.customer_technician_chat_requests.create_index(
        [("client_id", 1), ("portal_user_id", 1), ("created_at", -1)]
    )
    await db.chat_channels.create_index(
        [("client_direct_signature", 1)], unique=True,
        partialFilterExpression={"kind": "client_direct"},
    )
