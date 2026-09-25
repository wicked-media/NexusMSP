from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import json
import math
import uuid
import os
import asyncio
import logging
from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, Field
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.avatar_enrichment import attach_user_avatars
from app.services.action_permissions import assert_action_permission, require_action
from app.services.labour_types import labour_snapshot, resolve_labour_type
from app.services.scope_permissions import (
    assert_client_scope,
    assert_record_scope,
    assert_tenant_record_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)
from app.services.ticket_conversation import sanitise_ticket_rich_text
from app.services.ticket_subscriptions import ensure_ticket_subscription_indexes, notify_ticket_subscribers
from app.services.upload_security import upload_is_releasable
from app.services.ticket_time import (
    create_canonical_ticket_time_entry,
    list_ticket_time_history,
    sync_ticket_time_cache,
)
from app.models import *

logger = logging.getLogger(__name__)
router = APIRouter()
_CONVERSATION_INDEXED_DATABASE_IDS: set[int] = set()


class TicketConversationTime(BaseModel):
    """Technician-controlled input for one optional conversation time record."""

    model_config = ConfigDict(extra="forbid")

    minutes: int = Field(ge=1, le=1_440)
    labour_type_id: Optional[str] = Field(default=None, max_length=100)
    billable: Optional[bool] = None
    description: Optional[str] = Field(default=None, max_length=500)
    performed_at: Optional[datetime] = None


class TicketConversationEntryCreate(BaseModel):
    """One idempotent, auditable ticket update with optional time evidence."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=50_000)
    visibility: Literal["internal", "public"] = "internal"
    notify_client: bool = False
    to_addresses: List[str] = Field(default_factory=list, max_length=25)
    subject_label: str = Field(default="Update", max_length=80)
    status_after: Optional[Literal["open", "in_progress", "on_hold", "resolved"]] = None
    idempotency_key: str = Field(min_length=16, max_length=128)
    time: Optional[TicketConversationTime] = None


class TicketSubscriptionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str = Field(min_length=1, max_length=120)
    subscribed: bool


@router.get("/tickets/subscribed")
async def list_my_subscribed_tickets(current_user: dict = Depends(get_current_user)):
    """Return ticket work explicitly followed by the signed-in technician.

    A subscription is only a delivery preference. Each resulting ticket is
    still filtered by the caller's tenant and client scope before it reaches
    the dashboard, so following a ticket can never become a visibility grant.
    """
    tenant_id = platform_tenant_id(current_user)
    await ensure_ticket_subscription_indexes()
    subscriptions = await db.ticket_subscriptions.find(
        {"tenant_id": tenant_id, "user_id": str(current_user.get("id") or ""), "active": True},
        {"_id": 0, "ticket_id": 1, "created_at": 1, "updated_at": 1},
    ).to_list(250)
    ticket_ids = [str(row.get("ticket_id")) for row in subscriptions if row.get("ticket_id")]
    if not ticket_ids:
        return {"tickets": [], "total": 0}
    tickets = await db.tickets.find(
        scoped_query(current_user, tenant_scoped_query(current_user, {"id": {"$in": ticket_ids}})),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1,
         "client_id": 1, "client_name": 1, "assigned_to": 1, "assigned_name": 1,
         "updated_at": 1, "created_at": 1},
    ).sort("updated_at", -1).to_list(100)
    return {"tickets": tickets, "total": len(tickets)}


@router.get("/tickets/{ticket_id}/nexus-elevate")
async def get_ticket_nexus_elevate(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Return safe, ticket-local Elevate evidence after ticket scope is proven."""
    ticket = await _ticket_in_tenant_scope(ticket_id, current_user, "ticket.audit.read")
    device_ids = list(dict.fromkeys([
        *[str(value) for value in ticket.get("device_ids") or [] if value],
        *([str(ticket["device_id"])] if ticket.get("device_id") else []),
    ]))
    requests, devices = await asyncio.gather(
        db.nexus_elevate_requests.find(
            tenant_scoped_query(current_user, {"ticket_id": ticket["id"], "client_id": ticket.get("client_id")}),
            {"_id": 0, "id": 1, "device_id": 1, "hostname": 1, "program_name": 1, "status": 1,
             "requested_at": 1, "approval_due_at": 1, "approval_escalated_at": 1, "approved_at": 1, "approved_until": 1, "executed_at": 1,
             "execution_exit_code": 1, "denial_reason": 1, "expiration_reason": 1},
        ).sort("requested_at", -1).to_list(100),
        db.devices.find(
            tenant_scoped_query(current_user, {"id": {"$in": device_ids}, "client_id": ticket.get("client_id")}),
            {"_id": 0, "id": 1, "nexus_agent_id": 1},
        ).to_list(100),
    )
    device_agent_ids = [str(device.get("nexus_agent_id")) for device in devices if device.get("nexus_agent_id")]
    agents = await db.nexus_agents.find(
        tenant_scoped_query(current_user, {"id": {"$in": device_agent_ids}, "client_id": ticket.get("client_id"), "is_active": True}),
        {"_id": 0, "id": 1, "hostname": 1, "last_seen": 1, "nexus_elevate": 1},
    ).to_list(100) if device_agent_ids else []
    linked_agents = [
        {
            "id": agent.get("id"), "hostname": agent.get("hostname") or "Managed endpoint",
            "last_seen": agent.get("last_seen"),
            "elevate_state": (agent.get("nexus_elevate") or {}).get("state") or "not_ready",
        }
        for agent in agents
    ]
    return {
        "ticket_id": ticket["id"], "requests": requests, "linked_agents": linked_agents,
        "can_open_elevate": bool(linked_agents),
    }


@router.get("/tickets/{ticket_id}/subscribers")
async def get_ticket_subscribers(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await _ticket_in_tenant_scope(ticket_id, current_user, "ticket.comment.read")
    await ensure_ticket_subscription_indexes()
    records = await db.ticket_subscriptions.find(
        {"tenant_id": platform_tenant_id(current_user), "ticket_id": ticket["id"], "active": True},
        {"_id": 0, "user_id": 1, "created_at": 1, "created_by": 1},
    ).to_list(100)
    user_ids = [str(record.get("user_id")) for record in records if record.get("user_id")]
    user_query = {"id": {"$in": user_ids}, "is_active": {"$ne": False}}
    tenant_id = platform_tenant_id(current_user)
    if tenant_id != "nexus-local":
        user_query["tenant_id"] = tenant_id
    else:
        user_query["$or"] = [{"tenant_id": "nexus-local"}, {"tenant_id": {"$exists": False}}]
    users = await db.users.find(
        user_query,
        {"_id": 0, "id": 1, "name": 1, "email": 1, "avatar": 1},
    ).to_list(100)
    profiles = {str(user["id"]): user for user in users}
    subscribers = [{**record, "user": profiles.get(str(record.get("user_id")))} for record in records if profiles.get(str(record.get("user_id")))]
    return {"ticket_id": ticket["id"], "subscribers": subscribers, "subscribed": str(current_user.get("id")) in user_ids}


@router.put("/tickets/{ticket_id}/subscribers", dependencies=[Depends(require_action("ticket.conversation.create"))])
async def update_ticket_subscriber(ticket_id: str, payload: TicketSubscriptionUpdate, current_user: dict = Depends(get_current_user)):
    ticket = await _ticket_in_tenant_scope(ticket_id, current_user, "ticket.comment.create")
    if payload.user_id != str(current_user.get("id")):
        await assert_action_permission(current_user, "ticket.handoff.manage")
    tenant_id = platform_tenant_id(current_user)
    target_query = {"id": payload.user_id, "is_active": {"$ne": False}}
    if tenant_id != "nexus-local":
        target_query["tenant_id"] = tenant_id
    else:
        target_query["$or"] = [{"tenant_id": "nexus-local"}, {"tenant_id": {"$exists": False}}]
    target = await db.users.find_one(target_query, {"_id": 0, "id": 1, "name": 1})
    if not target:
        raise HTTPException(status_code=422, detail="Choose an active Nexus technician")
    await ensure_ticket_subscription_indexes()
    scope = {"tenant_id": tenant_id, "ticket_id": ticket["id"], "user_id": payload.user_id}
    now = datetime.now(timezone.utc).isoformat()
    if payload.subscribed:
        await db.ticket_subscriptions.update_one(scope, {"$set": {"active": True, "updated_at": now}, "$setOnInsert": {"id": str(uuid.uuid4()), "client_id": ticket.get("client_id"), "site_id": ticket.get("site_id"), "created_at": now, "created_by": str(current_user.get("id") or "")}}, upsert=True)
    else:
        await db.ticket_subscriptions.update_one(scope, {"$set": {"active": False, "updated_at": now, "removed_by": str(current_user.get("id") or "")}})
    technician_name = str(target.get("name") or "technician").strip()
    await ticket_audit(
        ticket["id"],
        current_user,
        "ticket_subscriber_added" if payload.subscribed else "ticket_subscriber_removed",
        f"{'Subscribed' if payload.subscribed else 'Unsubscribed'} {technician_name} {'to' if payload.subscribed else 'from'} ticket updates",
        metadata={
            "subscriber_user_id": str(target["id"]),
            "subscriber_name": technician_name,
            "subscription_active": payload.subscribed,
        },
    )
    return await get_ticket_subscribers(ticket_id, current_user)


@router.get("/tickets/{ticket_id}/handover")
async def get_ticket_handover(ticket_id: str, hours: int = 0, current_user: dict = Depends(get_current_user)):
    from app.services.ticket_handover import build_handover
    from app.services.scope_permissions import tenant_scoped_query
    if hours not in (0, 24, 168):
        raise HTTPException(status_code=422, detail="Choose all recent notes, 24 hours or 7 days")
    ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.comment.read")
    # Compose evidence only after authorising the parent; also constrain explicit
    # tenant ownership so a mismatched child document cannot leak across tenants.
    comments, children, subscription_records = await asyncio.gather(
        db.ticket_comments.find(tenant_scoped_query(current_user, {"ticket_id": ticket_id}),
            {"_id": 0, "id": 1, "content": 1, "created_at": 1, "user_name": 1, "is_internal": 1, "visibility": 1}).sort("created_at", -1).to_list(200),
        db.tickets.find(tenant_scoped_query(current_user, {"parent_id": ticket_id, "client_id": ticket.get("client_id")}),
            {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1}).to_list(100),
        db.ticket_subscriptions.find(
            {"tenant_id": platform_tenant_id(current_user), "ticket_id": ticket_id, "active": True},
            {"_id": 0, "user_id": 1, "created_at": 1},
        ).to_list(100),
    )
    since = datetime.now(timezone.utc) - timedelta(hours=hours) if hours else None
    subscriber_ids = [str(record.get("user_id")) for record in subscription_records if record.get("user_id")]
    subscriber_query: dict[str, Any] = {"id": {"$in": subscriber_ids}, "is_active": {"$ne": False}}
    tenant_id = platform_tenant_id(current_user)
    if tenant_id == "nexus-local":
        subscriber_query["$or"] = [{"tenant_id": "nexus-local"}, {"tenant_id": {"$exists": False}}]
    else:
        subscriber_query["tenant_id"] = tenant_id
    subscriber_profiles = await db.users.find(
        subscriber_query,
        {"_id": 0, "id": 1, "name": 1, "avatar": 1},
    ).to_list(100) if subscriber_ids else []
    profiles_by_id = {str(profile["id"]): profile for profile in subscriber_profiles}
    handover = build_handover(ticket, comments, children, since=since)
    handover["subscribers"] = [
        {"user_id": record["user_id"], "user": profiles_by_id[str(record["user_id"])]}
        for record in subscription_records
        if str(record.get("user_id")) in profiles_by_id
    ]
    elevation_rows = await db.nexus_elevate_requests.find(
        tenant_scoped_query(current_user, {"ticket_id": ticket["id"], "client_id": ticket.get("client_id")}),
        {"_id": 0, "id": 1, "program_name": 1, "hostname": 1, "status": 1, "approval_due_at": 1, "approval_escalated_at": 1, "approved_until": 1, "requested_at": 1, "executed_at": 1, "denial_reason": 1, "expiration_reason": 1},
    ).sort("requested_at", -1).to_list(20) if hasattr(db, "nexus_elevate_requests") else []
    handover["elevation"] = [
        {
            "id": row.get("id"), "program_name": row.get("program_name") or "Elevation request",
            "hostname": row.get("hostname") or "Managed endpoint", "status": row.get("status") or "unknown",
            "approval_due_at": row.get("approval_due_at"), "approval_escalated_at": row.get("approval_escalated_at"),
            "approved_until": row.get("approved_until"), "requested_at": row.get("requested_at"),
            "executed_at": row.get("executed_at"),
        }
        for row in elevation_rows
    ]
    handover["scope"] = handover["scope"].replace(
        "active subscriber roster only.",
        "active subscriber roster and ticket-linked Nexus Elevate lifecycle evidence only.",
    )
    return handover


async def _ticket_in_scope(ticket_id: str, current_user: dict, operation: str) -> dict:
    return await assert_record_scope(
        current_user,
        db.tickets,
        ticket_id,
        operation=operation,
        resource_name="Ticket",
    )


async def _ticket_in_tenant_scope(
    ticket_id: str,
    current_user: dict,
    operation: str,
    *,
    request: Request | None = None,
) -> dict:
    """Use the newer tenant-aware boundary for new ticket child records."""
    return await assert_tenant_record_scope(
        current_user,
        db.tickets,
        ticket_id,
        operation=operation,
        request=request,
        resource_name="Ticket",
    )


def _ticket_time_rate(value: Any) -> float:
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return 75.0
    return round(rate, 4) if math.isfinite(rate) and rate >= 0 else 75.0


async def _ticket_time_actor(current_user: dict) -> tuple[dict, float]:
    """Derive the technician and their fallback rate from trusted records."""
    user_id = str(current_user.get("id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Authenticated technician identity is required")
    stored = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1, "email": 1, "hourly_rate": 1})
    return (
        {
            "id": user_id,
            "name": (stored or {}).get("name") or current_user.get("name"),
            "email": (stored or {}).get("email") or current_user.get("email"),
        },
        _ticket_time_rate((stored or {}).get("hourly_rate", 75.0)),
    )


def _conversation_fingerprint(payload: TicketConversationEntryCreate, *, content: str) -> str:
    """Bind a browser retry key to one exact, safe workflow request."""
    time_payload = payload.time.model_dump(mode="json") if payload.time else None
    safe = {
        "content": content,
        "visibility": payload.visibility,
        "notify_client": payload.notify_client,
        "to_addresses": sorted({address.strip().lower() for address in payload.to_addresses if address.strip()}),
        "subject_label": payload.subject_label.strip(),
        "status_after": payload.status_after or "",
        "time": time_payload,
    }
    encoded = json.dumps(safe, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return sha256(encoded.encode("utf-8")).hexdigest()


def _normalise_ticket_recipient(value: Any) -> str:
    """Reject malformed mailboxes before a ticket update reaches a provider."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return validate_email(raw, check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise HTTPException(status_code=422, detail="Every customer recipient must be a valid email address") from exc


async def _ticket_comment_recipients(ticket: dict, current_user: dict, requested: list[str]) -> list[str]:
    """Resolve only ticket/client-owned customer routes for a public update.

    A technician may select a known ticket contact or client contact, but the
    ticket conversation endpoint must not become a generic outbound-email
    relay. The final recipient list is normalised, de-duplicated and bounded
    to the authorised customer record before any time or delivery side effect.
    """
    client = await db.clients.find_one(
        tenant_scoped_query(current_user, {"id": ticket.get("client_id")}),
        {"_id": 0, "contacts": 1, "email": 1},
    )
    known_by_lower: dict[str, str] = {}

    def add_known(value: Any) -> None:
        address = _normalise_ticket_recipient(value)
        if address:
            known_by_lower.setdefault(address.lower(), address)

    add_known(ticket.get("contact_email"))
    add_known((client or {}).get("email"))
    for contact in ((client or {}).get("contacts") or []):
        add_known(contact.get("email"))

    selected: list[str] = []
    for raw_address in requested:
        address = _normalise_ticket_recipient(raw_address)
        if not address:
            continue
        if address.lower() not in known_by_lower:
            raise HTTPException(
                status_code=422,
                detail="Customer updates can only be emailed to contacts recorded on this ticket or client.",
            )
        if address.lower() not in {item.lower() for item in selected}:
            selected.append(known_by_lower[address.lower()])
    if selected:
        return selected

    contact_id = str(ticket.get("contact_id") or "").strip()
    if contact_id:
        contact = next(
            (
                item
                for item in ((client or {}).get("contacts") or [])
                if str(item.get("id") or item.get("name") or "") == contact_id
            ),
            None,
        )
        if contact:
            address = _normalise_ticket_recipient(contact.get("email"))
            if address:
                return [address]
    contact_address = _normalise_ticket_recipient(ticket.get("contact_email"))
    if contact_address:
        return [contact_address]
    client_address = _normalise_ticket_recipient((client or {}).get("email"))
    return [client_address] if client_address else []


def _performed_at(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise HTTPException(status_code=422, detail="Performed time must include a timezone")
    normalised = value.astimezone(timezone.utc)
    now = datetime.now(timezone.utc)
    if normalised > now + timedelta(minutes=5):
        raise HTTPException(status_code=422, detail="Performed time cannot be in the future")
    if normalised < now - timedelta(days=3660):
        raise HTTPException(status_code=422, detail="Performed time is too far in the past")
    return normalised.isoformat()


async def _ensure_ticket_conversation_action_indexes() -> None:
    """Protect the retry ledger without making comments a second source of truth."""
    database_id = id(db)
    if database_id in _CONVERSATION_INDEXED_DATABASE_IDS:
        return
    collection = db.ticket_conversation_actions
    create_index = getattr(collection, "create_index", None)
    if not callable(create_index):
        return
    await create_index(
        [("tenant_id", 1), ("ticket_id", 1), ("user_id", 1), ("idempotency_key", 1)],
        name="ticket_conversation_action_idempotency",
        unique=True,
    )
    await create_index(
        [("ticket_id", 1), ("created_at", -1)],
        name="ticket_conversation_action_history",
    )
    _CONVERSATION_INDEXED_DATABASE_IDS.add(database_id)


async def _set_ticket_activity(ticket: dict, actor: dict, *, public: bool, at: str) -> None:
    update = {
        "updated_at": at,
        "last_activity_at": at,
        "last_activity_by_id": actor.get("id"),
        "last_activity_by_name": actor.get("name"),
    }
    if public:
        update["last_technician_reply_at"] = at
    await db.tickets.update_one(
        tenant_scoped_query(actor, {"id": ticket["id"], "client_id": ticket.get("client_id")}),
        {"$set": update},
    )


async def _attach_client_branding(tickets: list[dict]) -> None:
    """Resolve current client branding so ticket views never carry a stale logo."""
    client_ids = {ticket.get("client_id") for ticket in tickets if ticket.get("client_id")}
    if not client_ids:
        return
    clients = await db.clients.find(
        {"id": {"$in": list(client_ids)}},
        {"_id": 0, "id": 1, "logo_url": 1},
    ).to_list(len(client_ids))
    logos = {client["id"]: client.get("logo_url") for client in clients}
    for ticket in tickets:
        ticket["client_logo_url"] = logos.get(ticket.get("client_id"))


async def _assert_project_plan_parent_can_close(ticket: dict) -> None:
    """Keep a generated project parent ticket open until required delivery work closes.

    The project plan is intentionally enforced in the domain API rather than in
    the UI: a technician can update ticket status from the queue, API, or an
    automation. Optional child tickets do not block parent close-out.
    """
    if ticket.get("project_ticket_plan_role") != "parent":
        return

    child_ticket_ids = list(dict.fromkeys(ticket.get("child_ticket_ids") or []))
    if not child_ticket_ids:
        return

    child_tickets = await db.tickets.find(
        {
            "id": {"$in": child_ticket_ids},
            "client_id": ticket.get("client_id"),
            "$or": [
                {"project_ticket_plan_required": {"$ne": False}},
                {"project_ticket_plan_required": {"$exists": False}},
            ],
        },
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1},
    ).to_list(len(child_ticket_ids))
    terminal_statuses = {"resolved", "closed", "completed"}
    remaining = [
        child for child in child_tickets
        if (child.get("status") or "open").lower() not in terminal_statuses
    ]
    if not remaining:
        return

    examples = ", ".join(
        f"{child.get('ticket_number') or child.get('id')} ({child.get('status') or 'open'})"
        for child in remaining[:3]
    )
    suffix = f" Examples: {examples}." if examples else ""
    raise HTTPException(
        status_code=409,
        detail=(
            f"Project delivery is still in progress: {len(remaining)} required child "
            f"ticket{'s' if len(remaining) != 1 else ''} must be completed before "
            f"this parent ticket can be closed.{suffix}"
        ),
    )


async def _place_project_task_into_review(ticket: dict, current_user: dict, completed_at: str) -> None:
    """Turn completed delivery work into an independently-reviewable project task.

    Ticket closure proves that the technician finished the work item. It does
    not bypass the project's independent-review rule, so the corresponding
    project task moves to ``review`` instead of directly to ``completed``.
    """
    if ticket.get("project_ticket_plan_role") != "child" or not ticket.get("project_id"):
        return

    result = await db.project_tasks.update_one(
        {
            "project_id": ticket["project_id"],
            "ticket_id": ticket.get("id"),
            "status": {"$nin": ["review", "completed"]},
        },
        {
            "$set": {
                "status": "review",
                "completed_at": completed_at,
                "implemented_by": current_user.get("id") or current_user.get("email"),
                "implemented_by_name": current_user.get("name") or current_user.get("email"),
                "implemented_at": completed_at,
                "reviewed_by": None,
                "reviewed_by_name": None,
                "reviewed_at": None,
                "review_result": None,
                "review_notes": None,
            }
        },
    )
    if result.modified_count:
        await ticket_audit(
            ticket["id"],
            current_user,
            "project_task_ready_for_review",
            "Linked project task moved to independent review after ticket completion",
        )


# ============== TICKETS ENDPOINTS ==============

@router.get("/tickets", response_model=List[Ticket])
async def get_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority
    if client_id:
        query["client_id"] = client_id
    
    # The general queue hides old closed tickets, but a client-specific lookup is
    # an audit view and must retain the customer's complete ticket history.
    if not status and not client_id:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        query["$or"] = [
            {"status": {"$nin": ["closed"]}},
            {"status": "closed", "updated_at": {"$gte": cutoff}}
        ]
    
    tickets = await db.tickets.find(scoped_query(current_user, query), {"_id": 0}).to_list(1000)
    await attach_user_avatars(tickets, id_fields=("assigned_to",), output_field="assignee_avatar")
    await _attach_client_branding(tickets)
    for t in tickets:
        for field in ['created_at', 'updated_at', 'sla_due']:
            if isinstance(t.get(field), str):
                t[field] = datetime.fromisoformat(t[field])
    return tickets

@router.get("/tickets/note-counts")
async def get_ticket_note_counts(current_user: dict = Depends(get_current_user)):
    open_tickets = await db.tickets.find(
        scoped_query(current_user, {"status": {"$in": ["open", "in_progress"]}}),
        {"_id": 0, "id": 1},
    ).to_list(10000)
    result = {}
    for t in open_tickets:
        nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        result[t["id"]] = nc
    return result

# Import the ticket viewers from event_bus module
from app.routers.event_bus import _ticket_viewers

@router.get("/tickets/active-viewers")
async def get_active_viewers_proxy(current_user: dict = Depends(get_current_user)):
    """Get all tickets currently being viewed and by whom"""
    allowed = {
        ticket["id"]
        for ticket in await db.tickets.find(
            scoped_query(current_user),
            {"_id": 0, "id": 1},
        ).to_list(10000)
    }
    result = {}
    for ticket_id, viewers in _ticket_viewers.items():
        if viewers and ticket_id in allowed:
            result[ticket_id] = list(viewers.values())
    return result

@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.read")
    await attach_user_avatars([ticket], id_fields=("assigned_to",), output_field="assignee_avatar")
    await _attach_client_branding([ticket])
    return ticket

@router.post("/tickets", response_model=Ticket)
async def create_ticket(ticket_data: TicketCreate, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, ticket_data.client_id, operation="ticket.create")
    client = await db.clients.find_one({"id": ticket_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    if ticket_data.client_id and not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # The client account owns the service tier. Capture its policy on the
    # ticket when it is created so SLA handling and reporting stay consistent.
    inherited_tier = None
    if client and client.get("service_tier_id"):
        inherited_tier = await db.service_tiers.find_one(
            {"id": client["service_tier_id"], "is_active": True},
            {"_id": 0},
        )
    
    assigned_name = None
    if ticket_data.assigned_to:
        user = await db.users.find_one({"id": ticket_data.assigned_to}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="Assigned technician not found")
        assigned_name = user['name'] if user else None
    
    sla_hours = {"critical": 2, "high": 4, "medium": 8, "low": 24}

    # ── Service Catalog wiring: if service_code on payload, override priority/SLA/category/assignee
    service_code = (ticket_data.model_dump().get("service_code") or "").strip()
    service_doc = None
    if service_code:
        service_doc = await db.service_catalog.find_one({"$or": [{"code": service_code}, {"id": service_code}], "is_active": {"$ne": False}}, {"_id": 0})
        if service_doc:
            # Override priority if not explicitly set in the request
            if ticket_data.priority == "medium":
                ticket_data.priority = service_doc.get("default_priority", "medium")
            # Use service-defined SLA
            sla_resp = float(service_doc.get("sla_response_hours") or 0)
            sla_resolve = float(service_doc.get("sla_resolve_hours") or 0)
            sla_hours[ticket_data.priority] = sla_resolve or sla_hours.get(ticket_data.priority, 8)

    tier_resolution_minutes = int((inherited_tier or {}).get("resolution_sla_minutes") or 0)
    sla_due = datetime.now(timezone.utc) + timedelta(
        minutes=tier_resolution_minutes or (sla_hours.get(ticket_data.priority, 8) * 60)
    )
    
    # Resolve device name(s)
    device_name = None
    if ticket_data.device_id:
        device = await db.devices.find_one({"id": ticket_data.device_id}, {"_id": 0, "name": 1, "client_id": 1})
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        if device.get("client_id") != ticket_data.client_id:
            raise HTTPException(status_code=400, detail="Linked devices must belong to the ticket client")
        device_name = device['name'] if device else None

    # Multi-device: ensure device_id is included in device_ids, and resolve device_names parallel array
    device_ids = list(ticket_data.device_ids or [])
    if ticket_data.device_id and ticket_data.device_id not in device_ids:
        device_ids.insert(0, ticket_data.device_id)
    device_names = []
    if device_ids:
        found_devices = await db.devices.find(
            {"id": {"$in": device_ids}, "client_id": ticket_data.client_id},
            {"_id": 0, "id": 1, "name": 1},
        ).to_list(500)
        if len({device.get("id") for device in found_devices}) != len(set(device_ids)):
            raise HTTPException(status_code=400, detail="Every linked device must belong to the ticket client")
        devices_by_id = {device["id"]: device for device in found_devices}
        device_names = [
            devices_by_id[device_id].get("name") or device_id
            for device_id in device_ids
        ]
    
    # Generate ticket number using configurable scheme
    from app.routers.ticket_suggestions import generate_ticket_number
    ticket_number = await generate_ticket_number(
        ticket_data.ticket_type, tenant_id=platform_tenant_id(current_user)
    )
    
    ticket = Ticket(
        **ticket_data.model_dump(),
        ticket_number=ticket_number,
        client_name=client_name,
        assigned_name=assigned_name,
        device_name=device_name,
        sla_due=sla_due
    )
    ticket.client_logo_url = client.get("logo_url") if client else None
    # Override with normalized multi-device arrays
    ticket.device_ids = device_ids
    ticket.device_names = device_names
    doc = ticket.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    doc['sla_due'] = doc['sla_due'].isoformat() if doc['sla_due'] else None
    if inherited_tier:
        doc.update({
            "service_tier_id": inherited_tier["id"],
            "service_tier_name": inherited_tier.get("name"),
            "service_tier_source": "client",
            "tier_response_sla_minutes": inherited_tier.get("response_sla_minutes"),
            "tier_resolution_sla_minutes": inherited_tier.get("resolution_sla_minutes"),
        })
    await db.tickets.insert_one(doc)
    await db.clients.update_one({"id": ticket_data.client_id}, {"$inc": {"ticket_count": 1}})
    await ticket_audit(ticket.id, current_user, "created", f"Created ticket {ticket_number}")

    # Auto-apply default blueprint if the client has one (Syncro-style worksheet auto-apply)
    try:
        if client and client.get("default_blueprint_id"):
            bp = await db.blueprints.find_one({"id": client["default_blueprint_id"], "active": True}, {"_id": 0})
            if bp:
                from app.routers.blueprints import _hydrate_ticket_with_blueprint
                _hydrate_ticket_with_blueprint(doc, bp)
                doc["blueprint_applied_at"] = datetime.now(timezone.utc).isoformat()
                doc["blueprint_applied_by"] = "auto"
                await db.tickets.update_one(
                    {"id": doc["id"]},
                    {"$set": {k: doc[k] for k in (
                        "priority", "category", "status", "assignee_id", "sla_minutes",
                        "blueprint_id", "blueprint_name", "blueprint_require_completion",
                        "blueprint_fields", "blueprint_checklist",
                        "blueprint_applied_at", "blueprint_applied_by",
                    ) if k in doc}},
                )
    except Exception as e:
        logger.warning(f"Failed to auto-apply blueprint: {e}")

    await log_activity(current_user, "created", "ticket", ticket.id, ticket.title, f"Created ticket {ticket_number} for {client_name}", metadata={"ticket_number": ticket_number, "client_name": client_name, "priority": ticket_data.priority})

    # Persist service catalog metadata on the ticket if it was applied
    if service_doc:
        await db.tickets.update_one(
            {"id": ticket.id},
            {"$set": {
                "service_code": service_doc.get("code"),
                "service_name": service_doc.get("name"),
                "service_id": service_doc.get("id"),
                "billable_unit_price": float(service_doc.get("billing_unit_price") or 0),
                "billable_unit": service_doc.get("billing_unit", "each"),
                "sla_response_hours": float(service_doc.get("sla_response_hours") or 0),
                "sla_resolve_hours": float(service_doc.get("sla_resolve_hours") or 0),
            }}
        )

    # Notify subscribed Slack/Teams/Discord channels
    try:
        from app.services.notify_publish import fire
        prio_emoji = {"critical": "🚨", "high": "⚠️", "medium": "📋", "low": "🟢"}.get(ticket_data.priority, "📋")
        fire("ticket_created", f"{prio_emoji} *New {ticket_data.priority} ticket* {ticket_number}\n*{client_name}* — {ticket.title}")
    except Exception as e:
        logger.warning(f"notify_publish failed: {e}")
    
    # Auto-ping relevant team members
    try:
        from app.routers.ticket_ping import get_team_for_ticket, send_ping_notification
        if not ticket_data.assigned_to:
            team = await get_team_for_ticket(doc)
            if team:
                await send_ping_notification(team, doc, "new_ticket")
    except Exception as e:
        logger.warning(f"Failed to send ticket ping: {e}")
    
    return ticket

@router.put("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, ticket_data: dict, current_user: dict = Depends(get_current_user)):
    old_ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.update")
    target_client_id = ticket_data.get("client_id", old_ticket.get("client_id"))
    await assert_client_scope(current_user, target_client_id, operation="ticket.move")
    if target_client_id != old_ticket.get("client_id"):
        target_client = await db.clients.find_one({"id": target_client_id}, {"_id": 0, "name": 1, "logo_url": 1})
        if not target_client:
            raise HTTPException(status_code=404, detail="Client not found")
        ticket_data["client_name"] = target_client.get("name")
        ticket_data["client_logo_url"] = target_client.get("logo_url")
    now_iso = datetime.now(timezone.utc).isoformat()
    ticket_data['updated_at'] = now_iso
    # Auto-close: when marked as resolved, automatically set to closed
    resolution_requested = ticket_data.get("status") == "resolved"
    if resolution_requested:
        ticket_data["status"] = "closed"
    # A closure is an audit event, not simply a queue state. Retain who closed
    # it, when it happened, and that it was resolved through the normal flow.
    if ticket_data.get("status") == "closed" and old_ticket and old_ticket.get("status") != "closed":
        await _assert_project_plan_parent_can_close(old_ticket)
        ticket_data.update({
            "resolved_at": old_ticket.get("resolved_at") or now_iso,
            "closed_at": now_iso,
            "resolved_by": old_ticket.get("resolved_by") or current_user.get("id") or current_user.get("email"),
            "resolved_by_name": old_ticket.get("resolved_by_name") or current_user.get("name") or current_user.get("email"),
            "closed_by": current_user.get("id") or current_user.get("email"),
            "closed_by_name": current_user.get("name") or current_user.get("email"),
            "resolution_status": "resolved_and_closed" if resolution_requested else "closed",
        })
    # Blueprint gate: if ticket has a require_completion blueprint, block close/resolve until
    # required checklist items are done and required fields are filled.
    if ticket_data.get("status") in ("resolved", "closed") and old_ticket and old_ticket.get("blueprint_require_completion"):
        cl = old_ticket.get("blueprint_checklist") or []
        missing_items = [c.get("label") for c in cl if c.get("required") and not c.get("done")]
        # Resolve required worksheet field labels too
        bp = await db.blueprints.find_one({"id": old_ticket.get("blueprint_id")}, {"_id": 0, "fields": 1}) if old_ticket.get("blueprint_id") else None
        required_fields = [f for f in ((bp or {}).get("fields") or []) if f.get("required")]
        fvals = old_ticket.get("blueprint_fields") or {}
        missing_fields = [f["label"] for f in required_fields if not str(fvals.get(f["key"], "") or "").strip()]
        if missing_items or missing_fields:
            raise HTTPException(
                status_code=400,
                detail=f"Blueprint incomplete. Missing checklist: {', '.join(missing_items) or 'none'}. Missing fields: {', '.join(missing_fields) or 'none'}",
            )
    # Resolve device name if device_id changed
    if 'device_id' in ticket_data and ticket_data['device_id']:
        device = await db.devices.find_one(
            {"id": ticket_data['device_id'], "client_id": target_client_id},
            {"_id": 0, "name": 1},
        )
        if not device:
            raise HTTPException(status_code=400, detail="Linked devices must belong to the ticket client")
        ticket_data['device_name'] = device['name'] if device else None
    elif 'device_id' in ticket_data and not ticket_data['device_id']:
        ticket_data['device_name'] = None
    if "device_ids" in ticket_data:
        requested_device_ids = list(dict.fromkeys(ticket_data.get("device_ids") or []))
        found_devices = await db.devices.find(
            {"id": {"$in": requested_device_ids}, "client_id": target_client_id},
            {"_id": 0, "id": 1, "name": 1},
        ).to_list(500) if requested_device_ids else []
        devices_by_id = {device["id"]: device for device in found_devices}
        if len(devices_by_id) != len(requested_device_ids):
            raise HTTPException(status_code=400, detail="Every linked device must belong to the ticket client")
        ticket_data["device_ids"] = requested_device_ids
        ticket_data["device_names"] = [
            devices_by_id[device_id].get("name") or device_id
            for device_id in requested_device_ids
        ]
    if 'assigned_to' in ticket_data:
        if ticket_data['assigned_to']:
            assignee = await db.users.find_one({"id": ticket_data['assigned_to']}, {"_id": 0, "name": 1})
            if not assignee:
                raise HTTPException(status_code=404, detail="Assigned technician not found")
            ticket_data['assigned_name'] = assignee.get('name')
            ticket_data['assigned_at'] = datetime.now(timezone.utc).isoformat()
        else:
            ticket_data['assigned_name'] = None
    ticket_update_query = {"id": ticket_id}
    if target_client_id != old_ticket.get("client_id"):
        # Automation note creation keeps a brief, parent-document lock while
        # it writes a separate child note. A client move must race safely with
        # that action rather than splitting the ticket and its audit evidence
        # across customer scopes.
        ticket_update_query.update({
            "client_id": old_ticket.get("client_id"),
            "automation_note_lock": {"$exists": False},
        })
    result = await db.tickets.update_one(ticket_update_query, {"$set": ticket_data})
    if result.matched_count == 0:
        if target_client_id != old_ticket.get("client_id"):
            raise HTTPException(
                status_code=409,
                detail="This ticket has a protected automation note in progress. Retry the customer change shortly.",
            )
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket_data.get("status") == "closed" and old_ticket.get("status") != "closed":
        await _place_project_task_into_review(old_ticket, current_user, now_iso)
    if old_ticket:
        changes = []
        change_dict = {}
        for k, v in ticket_data.items():
            if k != "updated_at" and old_ticket.get(k) != v:
                changes.append(f"{k}: {old_ticket.get(k)} -> {v}")
                change_dict[k] = {"old": str(old_ticket.get(k)), "new": str(v)}
        if changes:
            await ticket_audit(ticket_id, current_user, "updated", "; ".join(changes))
            await log_activity(current_user, "updated", "ticket", ticket_id, old_ticket.get("title", ""), "; ".join(changes), changes=change_dict)
        # Auto CSAT: when transitioning to closed for the first time
        try:
            became_closed = ticket_data.get("status") == "closed" and old_ticket.get("status") != "closed"
            if became_closed and not old_ticket.get("csat_sent"):
                contact = old_ticket.get("contact_email") or old_ticket.get("requester_email")
                if contact:
                    import uuid as _uuid
                    survey_id = _uuid.uuid4().hex
                    await db.csat_surveys.insert_one({
                        "id": survey_id,
                        "ticket_id": ticket_id,
                        "ticket_number": old_ticket.get("ticket_number"),
                        "client_id": old_ticket.get("client_id"),
                        "client_name": old_ticket.get("client_name"),
                        "contact_email": contact,
                        "status": "sent",
                        "sent_at": datetime.now(timezone.utc).isoformat(),
                        "sent_by_id": "system",
                        "sent_by_name": "Auto-CSAT (on close)",
                    })
                    await db.tickets.update_one({"id": ticket_id}, {"$set": {"csat_sent": True, "csat_sent_at": datetime.now(timezone.utc).isoformat()}})
        except Exception as e:
            logger.warning(f"Auto-CSAT failed for {ticket_id}: {e}")
    # Return the persisted record so every client surface immediately reflects
    # lifecycle automation (in particular resolved -> closed) without a stale UI state.
    updated_ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    return {"message": "Ticket updated", "ticket": updated_ticket}

@router.post("/tickets/{ticket_id}/devices")
async def add_ticket_device(ticket_id: str, body: dict, current_user: dict = Depends(get_current_user)):
    """Link an additional device to a ticket (Syncro-style multi-asset linking)."""
    device_id = (body or {}).get("device_id")
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id required")
    ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.device.link")
    device = await db.devices.find_one(
        {"id": device_id, "client_id": ticket.get("client_id")},
        {"_id": 0, "name": 1, "id": 1},
    )
    if not device:
        raise HTTPException(status_code=400, detail="Linked devices must belong to the ticket client")
    device_ids = list(ticket.get("device_ids") or [])
    # Backfill from legacy device_id field
    if ticket.get("device_id") and ticket["device_id"] not in device_ids:
        device_ids.append(ticket["device_id"])
    if device_id in device_ids:
        return {"message": "Device already linked", "device_ids": device_ids}
    device_ids.append(device_id)
    # Refresh names parallel array
    cursor = db.devices.find({"id": {"$in": device_ids}}, {"_id": 0, "id": 1, "name": 1})
    id_to_name = {}
    async for d in cursor:
        id_to_name[d["id"]] = d.get("name") or d["id"]
    device_names = [id_to_name.get(did, did) for did in device_ids]
    update = {
        "device_ids": device_ids,
        "device_names": device_names,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # Promote to primary if no primary yet
    if not ticket.get("device_id"):
        update["device_id"] = device_id
        update["device_name"] = device.get("name") or device_id
    await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    await ticket_audit(ticket_id, current_user, "device_linked", f"Linked device {device.get('name') or device_id}")
    return {"message": "Device linked", "device_ids": device_ids, "device_names": device_names}


@router.delete("/tickets/{ticket_id}/devices/{device_id}")
async def remove_ticket_device(ticket_id: str, device_id: str, current_user: dict = Depends(get_current_user)):
    """Unlink a device from a ticket."""
    ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.device.unlink")
    device_ids = list(ticket.get("device_ids") or [])
    if ticket.get("device_id") and ticket["device_id"] not in device_ids:
        device_ids.append(ticket["device_id"])
    if device_id not in device_ids:
        raise HTTPException(status_code=404, detail="Device not linked to this ticket")
    device_ids = [d for d in device_ids if d != device_id]
    cursor = db.devices.find({"id": {"$in": device_ids}}, {"_id": 0, "id": 1, "name": 1}) if device_ids else None
    id_to_name = {}
    if cursor:
        async for d in cursor:
            id_to_name[d["id"]] = d.get("name") or d["id"]
    device_names = [id_to_name.get(did, did) for did in device_ids]
    update = {
        "device_ids": device_ids,
        "device_names": device_names,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # If primary was removed, promote the first remaining device
    if ticket.get("device_id") == device_id:
        if device_ids:
            update["device_id"] = device_ids[0]
            update["device_name"] = id_to_name.get(device_ids[0], device_ids[0])
        else:
            update["device_id"] = None
            update["device_name"] = None
    await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    await ticket_audit(ticket_id, current_user, "device_unlinked", f"Unlinked device {device_id}")
    return {"message": "Device unlinked", "device_ids": device_ids, "device_names": device_names}


@router.delete("/tickets/{ticket_id}")
async def delete_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.delete")
    await db.clients.update_one({"id": ticket['client_id']}, {"$inc": {"ticket_count": -1}})
    await log_activity(current_user, "deleted", "ticket", ticket_id, ticket.get("title", ""), f"Deleted ticket {ticket.get('ticket_number', '')}")
    result = await db.tickets.delete_one({"id": ticket_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"message": "Ticket deleted"}

# ============== TICKET COMMENTS/NOTES ENDPOINTS ==============

@router.get("/tickets/{ticket_id}/comments")
async def get_ticket_comments(ticket_id: str, current_user: dict = Depends(get_current_user)):
    await _ticket_in_scope(ticket_id, current_user, "ticket.comment.read")
    comments = await db.ticket_comments.find(
        tenant_scoped_query(current_user, {"ticket_id": ticket_id}), {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return await attach_user_avatars(comments)

@router.post(
    "/tickets/{ticket_id}/comments",
    dependencies=[Depends(require_action("ticket.conversation.create"))],
)
async def create_ticket_comment(ticket_id: str, comment_data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await _ticket_in_tenant_scope(ticket_id, current_user, "ticket.comment.create")
    content, content_text = sanitise_ticket_rich_text(comment_data.get("content"))

    visibility = str(comment_data.get("visibility") or "").strip().lower()
    is_internal = bool(comment_data.get("is_internal", visibility != "public"))
    if visibility not in {"internal", "public"}:
        visibility = "internal" if is_internal else "public"
    is_internal = visibility == "internal"
    if not is_internal:
        await assert_action_permission(current_user, "ticket.public_update.send")
    notify_client = bool(comment_data.get("notify_client", False)) and not is_internal

    recipients = await _ticket_comment_recipients(
        ticket,
        current_user,
        comment_data.get("to_addresses") or [],
    ) if notify_client else []
    if notify_client and not recipients:
        raise HTTPException(
            status_code=400,
            detail="This public update has no recipient. Add an email address or publish it to the client portal without email.",
        )

    subject_label = str(comment_data.get("subject_label") or "Update").strip() or "Update"
    subject = str(comment_data.get("subject") or "").strip()
    if not subject:
        subject = f"{subject_label}: [{ticket.get('ticket_number', ticket_id)}] {ticket.get('title', 'Service request')}"

    delivery = {}
    if notify_client:
        from app.routers.email_signatures import append_default_signature
        from app.routers.email_utils import send_email

        body, body_type, _ = await append_default_signature(
            body=content,
            body_type="html" if "<" in content else "text",
            current_user=current_user,
            subject=subject,
            ticket_id=ticket_id,
        )
        delivery = await send_email(
            recipients,
            subject,
            body if body_type == "html" else f"<pre>{body}</pre>",
            category="ticket_comments",
            client_id=ticket.get("client_id"),
            related_type="ticket",
            related_id=ticket_id,
            initiated_by=current_user.get("id"),
            initiated_by_name=current_user.get("name"),
            thread_key=f"ticket:{ticket_id}",
        )
        from app.services.ticket_participants import sync_ticket_participants
        await sync_ticket_participants(
            ticket=ticket,
            addresses=recipients,
            role="recipient",
            direction="outbound",
            delivery_status=delivery.get("status"),
        )

    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "tenant_id": platform_tenant_id(current_user),
        "client_id": ticket.get("client_id"),
        "site_id": ticket.get("site_id"),
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "avatar_url": current_user.get("avatar"),
        "content": content,
        "content_text": content_text,
        "content_format": "tiptap_html.v1",
        "is_internal": is_internal,
        "visibility": visibility,
        "portal_visible": not is_internal,
        "client_notified": notify_client,
        "to_addresses": recipients if notify_client else [],
        "subject": subject if not is_internal else "",
        "subject_label": subject_label if not is_internal else "",
        "delivery_status": delivery.get("status") if notify_client else "portal_only" if not is_internal else "internal",
        "delivery_message": delivery.get("message", "") if notify_client else "",
        "delivery_id": (delivery.get("delivery_id") or delivery.get("email_id")) if notify_client else None,
        "sender_mailbox": delivery.get("sender") if notify_client else None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_comments.insert_one(dict(comment))
    try:
        await notify_ticket_subscribers(ticket=ticket, comment=comment, actor_id=current_user.get("id"))
    except Exception:
        logger.exception("ticket subscriber notification failed ticket_id=%s comment_id=%s", ticket_id, comment["id"])
    # Queue recovery relies on explicit activity evidence rather than treating
    # a missing response field as customer silence. Record every technician
    # update, and only record a reply when a customer-visible update was made.
    activity_at = comment["created_at"]
    activity_update = {
        "updated_at": activity_at,
        "last_activity_at": activity_at,
        "last_activity_by_id": current_user.get("id"),
        "last_activity_by_name": current_user.get("name"),
    }
    if not is_internal:
        activity_update["last_technician_reply_at"] = activity_at
    await db.tickets.update_one(
        {"id": ticket_id, "client_id": ticket.get("client_id")},
        {"$set": activity_update},
    )
    await ticket_audit(
        ticket_id,
        current_user,
        "public_update_added" if not is_internal else "internal_note_added",
        (
            f"Published client update to {', '.join(recipients)} ({comment['delivery_status']})"
            if notify_client
            else "Published client-visible portal update"
            if not is_internal
            else "Added internal technician note"
        ),
    )

    status_after = str(comment_data.get("status_after") or "").strip().lower()
    if status_after in {"open", "in_progress", "on_hold", "resolved"}:
        await update_ticket(ticket_id, {"status": status_after}, current_user)
        comment["status_after"] = "closed" if status_after == "resolved" else status_after
    return comment


@router.post(
    "/tickets/{ticket_id}/conversation-entries",
    dependencies=[Depends(require_action("ticket.conversation.create"))],
)
async def create_ticket_conversation_entry(
    ticket_id: str,
    payload: TicketConversationEntryCreate,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Create one rich ticket update and its optional canonical time record.

    The retry ledger is operational evidence only.  ``ticket_comments`` stays
    authoritative for the conversation and ``time_entries`` stays
    authoritative for commercial time.  The ledger coordinates both writes so
    a browser retry cannot silently duplicate work or billable minutes.
    """
    ticket = await _ticket_in_tenant_scope(
        ticket_id,
        current_user,
        "ticket.conversation.create",
        request=request,
    )
    if payload.visibility == "public":
        await assert_action_permission(current_user, "ticket.public_update.send", request=request)
    if payload.time:
        await assert_action_permission(current_user, "ticket.time.create", request=request)

    content, content_text = sanitise_ticket_rich_text(payload.content)
    resolved_recipients = []
    if payload.visibility == "public" and payload.notify_client:
        resolved_recipients = await _ticket_comment_recipients(ticket, current_user, payload.to_addresses)
        if not resolved_recipients:
            raise HTTPException(
                status_code=422,
                detail="This public update has no recipient. Add an email address or publish it to the client portal without email.",
            )
    fingerprint = _conversation_fingerprint(payload, content=content)
    tenant_id = platform_tenant_id(current_user)

    async def prepare_time_context() -> dict[str, Any]:
        """Validate commercial input before reserving a new retry key."""
        actor, fallback_rate = await _ticket_time_actor(current_user)
        labour_type = await resolve_labour_type(
            payload.time.labour_type_id,
            tenant_id=tenant_id,
            database=db,
        )
        commercial = labour_snapshot(
            labour_type,
            fallback_rate=fallback_rate,
            requested_billable=payload.time.billable,
        )
        return {
            "actor": actor,
            "commercial": commercial,
            "performed_at": _performed_at(payload.time.performed_at),
        }

    action_query = {
        "tenant_id": tenant_id,
        "ticket_id": ticket["id"],
        "user_id": current_user.get("id"),
        "idempotency_key": payload.idempotency_key,
    }
    await _ensure_ticket_conversation_action_indexes()
    action = await db.ticket_conversation_actions.find_one(action_query, {"_id": 0})
    replay = bool(action)
    if action and action.get("payload_fingerprint") != fingerprint:
        raise HTTPException(
            status_code=409,
            detail="This update key was already used for different content. Refresh the ticket before trying again.",
        )
    prepared_time = await prepare_time_context() if payload.time and not action else None
    if not action:
        now = datetime.now(timezone.utc).isoformat()
        action = {
            "id": str(uuid.uuid4()),
            **action_query,
            "client_id": ticket.get("client_id"),
            "site_id": ticket.get("site_id"),
            "visibility": payload.visibility,
            "payload_fingerprint": fingerprint,
            "has_time": bool(payload.time),
            "comment_id": None,
            "time_entry_id": None,
            "delivery_status": "not_requested",
            "created_at": now,
            "updated_at": now,
        }
        try:
            await db.ticket_conversation_actions.insert_one(dict(action))
        except Exception:
            # A concurrent click is a replay only when it carries the exact
            # same stable browser key and fingerprint.
            action = await db.ticket_conversation_actions.find_one(action_query, {"_id": 0})
            if not action:
                raise
            if action.get("payload_fingerprint") != fingerprint:
                raise HTTPException(
                    status_code=409,
                    detail="This update key was already used for different content. Refresh the ticket before trying again.",
                )
            replay = True

    action_scope = {"id": action["id"], **action_query}
    time_entry = None
    time_created = False
    if payload.time:
        existing_time_id = str(action.get("time_entry_id") or "").strip()
        if existing_time_id:
            time_entry = await db.time_entries.find_one(
                {
                    "id": existing_time_id,
                    "tenant_id": tenant_id,
                    "ticket_id": ticket["id"],
                    "client_id": ticket.get("client_id"),
                },
                {"_id": 0},
            )
        if not time_entry:
            time_context = prepared_time or await prepare_time_context()
            actor = time_context["actor"]
            commercial = time_context["commercial"]
            performed_at = time_context["performed_at"]
            time_extra = {
                **commercial["extra"],
                "tenant_id": tenant_id,
                "conversation_action_id": action["id"],
                "performed_at": performed_at,
            }
            time_entry, time_created = await create_canonical_ticket_time_entry(
                ticket=ticket,
                actor=actor,
                minutes=payload.time.minutes,
                description=(payload.time.description or content_text)[:500],
                billable=commercial["billable"],
                source="ticket_conversation",
                source_reference=action["id"],
                idempotency_key=f"ticket_conversation:{action['id']}",
                hourly_rate=commercial["hourly_rate"],
                date=performed_at[:10] if performed_at else None,
                extra={key: value for key, value in time_extra.items() if value is not None},
                database=db,
            )
        else:
            commercial = {
                "extra": {
                    "labour_type_name": time_entry.get("labour_type_name") or "Technician default",
                }
            }
        if action.get("time_entry_id") != time_entry["id"]:
            await db.ticket_conversation_actions.update_one(
                action_scope,
                {"$set": {"time_entry_id": time_entry["id"], "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            action["time_entry_id"] = time_entry["id"]
        if time_created:
            labour_name = commercial["extra"].get("labour_type_name") or "Technician default"
            await ticket_audit(
                ticket["id"],
                current_user,
                "time_logged",
                f"Logged {payload.time.minutes} minutes · {labour_name}",
            )

    comment = None
    comment_id = str(action.get("comment_id") or "").strip()
    if comment_id:
        comment = await db.ticket_comments.find_one(
            tenant_scoped_query(current_user, {"id": comment_id, "ticket_id": ticket["id"]}),
            {"_id": 0},
        )
    if not comment:
        comment = await db.ticket_comments.find_one(
            tenant_scoped_query(current_user, {"ticket_id": ticket["id"], "conversation_action_id": action["id"]}),
            {"_id": 0},
        )
    if not comment:
        now = datetime.now(timezone.utc).isoformat()
        public = payload.visibility == "public"
        comment = {
            "id": str(uuid.uuid4()),
            "ticket_id": ticket["id"],
            "tenant_id": tenant_id,
            "client_id": ticket.get("client_id"),
            "site_id": ticket.get("site_id"),
            "conversation_action_id": action["id"],
            "time_entry_id": time_entry.get("id") if time_entry else None,
            "idempotency_key": payload.idempotency_key,
            "user_id": current_user.get("id"),
            "user_name": current_user.get("name"),
            "avatar_url": current_user.get("avatar"),
            "content": content,
            "content_text": content_text,
            "content_format": "tiptap_html.v1",
            "is_internal": not public,
            "visibility": payload.visibility,
            "portal_visible": public,
            "client_notified": bool(public and payload.notify_client),
            "to_addresses": [],
            "subject": "",
            "subject_label": "",
            "delivery_status": "pending" if public and payload.notify_client else "portal_only" if public else "internal",
            "delivery_message": "",
            "delivery_id": None,
            "sender_mailbox": None,
            "source": "ticket_conversation",
            "created_at": now,
        }
        if public:
            subject_label = payload.subject_label.strip() or "Update"
            comment.update(
                {
                    "to_addresses": resolved_recipients if payload.notify_client else [],
                    "subject_label": subject_label,
                    "subject": f"{subject_label}: [{ticket.get('ticket_number', ticket_id)}] {ticket.get('title', 'Service request')}",
                }
            )
        await db.ticket_comments.insert_one(dict(comment))
        try:
            await notify_ticket_subscribers(ticket=ticket, comment=comment, actor_id=current_user.get("id"))
        except Exception:
            logger.exception("ticket subscriber notification failed ticket_id=%s comment_id=%s", ticket["id"], comment["id"])
        await db.ticket_conversation_actions.update_one(
            action_scope,
            {"$set": {"comment_id": comment["id"], "updated_at": now}},
        )
        action["comment_id"] = comment["id"]
        await _set_ticket_activity(ticket, current_user, public=public, at=now)
        await ticket_audit(
            ticket["id"],
            current_user,
            "public_update_added" if public else "internal_note_added",
            "Published client-visible portal update" if public else "Added internal technician note",
        )

    # The comment is intentionally durable before an outbound provider call.
    # Claim the one delivery attempt in Mongo so duplicate browser retries do
    # not send duplicate client email.  A process that dies while ``sending``
    # leaves explicit recovery evidence rather than guessing that it is safe
    # to resend.
    delivery_status = comment.get("delivery_status")
    if payload.visibility == "public" and payload.notify_client and delivery_status == "pending":
        attempt_at = datetime.now(timezone.utc).isoformat()
        claimed = await db.ticket_comments.update_one(
            tenant_scoped_query(current_user, {"id": comment["id"], "ticket_id": ticket["id"], "delivery_status": "pending"}),
            {"$set": {"delivery_status": "sending", "delivery_attempted_at": attempt_at}},
        )
        if claimed.matched_count:
            await db.ticket_conversation_actions.update_one(
                action_scope,
                {"$set": {"delivery_status": "sending", "delivery_attempted_at": attempt_at, "updated_at": attempt_at}},
            )
            try:
                from app.routers.email_signatures import append_default_signature
                from app.routers.email_utils import send_email

                body, body_type, _ = await append_default_signature(
                    body=comment["content"],
                    body_type="html",
                    current_user=current_user,
                    subject=comment["subject"],
                    ticket_id=ticket["id"],
                )
                delivery = await send_email(
                    comment["to_addresses"],
                    comment["subject"],
                    body if body_type == "html" else f"<pre>{body}</pre>",
                    category="ticket_comments",
                    client_id=ticket.get("client_id"),
                    related_type="ticket",
                    related_id=ticket["id"],
                    initiated_by=current_user.get("id"),
                    initiated_by_name=current_user.get("name"),
                    thread_key=f"ticket:{ticket['id']}",
                )
                delivery_patch = {
                    "delivery_status": delivery.get("status") or "failed",
                    "delivery_message": delivery.get("message", ""),
                    "delivery_id": delivery.get("delivery_id") or delivery.get("email_id"),
                    "sender_mailbox": delivery.get("sender"),
                    "delivery_completed_at": datetime.now(timezone.utc).isoformat(),
                }
            except Exception:
                logger.exception("ticket conversation delivery state is unknown action_id=%s", action["id"])
                delivery_patch = {
                    "delivery_status": "attempt_unknown",
                    "delivery_message": "Nexus could not confirm the provider outcome. Do not resend automatically.",
                    "delivery_completed_at": datetime.now(timezone.utc).isoformat(),
                }
            else:
                try:
                    from app.services.ticket_participants import sync_ticket_participants

                    await sync_ticket_participants(
                        ticket=ticket,
                        addresses=comment["to_addresses"],
                        role="recipient",
                        direction="outbound",
                        delivery_status=delivery_patch["delivery_status"],
                    )
                except Exception:
                    # Sending is already provider-confirmed. Preserve that
                    # fact and leave explicit evidence for a later participant
                    # reconciliation instead of misrepresenting delivery.
                    logger.exception("ticket participant sync failed action_id=%s", action["id"])
                    delivery_patch["participant_sync_status"] = "failed"
            await db.ticket_comments.update_one(
                tenant_scoped_query(current_user, {"id": comment["id"], "ticket_id": ticket["id"]}),
                {"$set": delivery_patch},
            )
            await db.ticket_conversation_actions.update_one(
                action_scope,
                {"$set": {**delivery_patch, "updated_at": datetime.now(timezone.utc).isoformat()}},
            )
            comment.update(delivery_patch)
        else:
            comment = await db.ticket_comments.find_one(tenant_scoped_query(current_user, {"id": comment["id"], "ticket_id": ticket["id"]}), {"_id": 0}) or comment

    if payload.status_after and not action.get("status_transitioned"):
        await update_ticket(ticket["id"], {"status": payload.status_after}, current_user)
        transitioned_at = datetime.now(timezone.utc).isoformat()
        await db.ticket_conversation_actions.update_one(
            action_scope,
            {"$set": {"status_transitioned": True, "updated_at": transitioned_at}},
        )
        comment["status_after"] = "closed" if payload.status_after == "resolved" else payload.status_after

    return {
        "comment": comment,
        "time_entry": time_entry,
        "time_logged": bool(time_entry),
        "idempotent_replay": replay and not time_created,
        "status_after": comment.get("status_after"),
    }

# ============== TICKET CHILD/PARENT ENDPOINTS ==============

@router.get("/tickets/{ticket_id}/children")
async def get_child_tickets(ticket_id: str, current_user: dict = Depends(get_current_user)):
    parent = await _ticket_in_scope(ticket_id, current_user, "ticket.children.read")
    children = await db.tickets.find(
        {"parent_id": ticket_id, "client_id": parent.get("client_id")},
        {"_id": 0},
    ).to_list(100)
    return children

@router.post("/tickets/{ticket_id}/children")
async def create_child_ticket(ticket_id: str, ticket_data: dict, current_user: dict = Depends(get_current_user)):
    parent = await _ticket_in_scope(ticket_id, current_user, "ticket.child.create")
    from app.routers.ticket_suggestions import generate_ticket_number
    child_number = await generate_ticket_number(
        ticket_data.get("ticket_type", parent.get("ticket_type", "incident")),
        tenant_id=platform_tenant_id(current_user),
    )
    child = Ticket(
        ticket_number=child_number,
        title=ticket_data.get("title", ""),
        description=ticket_data.get("description", ""),
        client_id=parent["client_id"],
        client_name=parent.get("client_name"),
        priority=ticket_data.get("priority", parent.get("priority", "medium")),
        category=parent.get("category", "support"),
        assigned_to=ticket_data.get("assigned_to", parent.get("assigned_to")),
        parent_id=ticket_id,
        tags=ticket_data.get("tags", []),
    )
    child_dict = child.model_dump()
    child_dict["created_at"] = child_dict["created_at"].isoformat()
    child_dict["updated_at"] = child_dict["updated_at"].isoformat()
    if child_dict.get("sla_due"):
        child_dict["sla_due"] = child_dict["sla_due"].isoformat()
    await db.tickets.insert_one(child_dict)
    child_dict.pop("_id", None)
    await ticket_audit(ticket_id, current_user, "child_created", f"Child ticket {child_dict['ticket_number']} created")
    return child_dict

@router.post("/tickets/{ticket_id}/link")
async def link_ticket(ticket_id: str, link_data: dict, current_user: dict = Depends(get_current_user)):
    child_id = link_data.get("child_id")
    if not child_id:
        raise HTTPException(status_code=400, detail="child_id required")
    parent = await _ticket_in_scope(ticket_id, current_user, "ticket.link")
    child = await _ticket_in_scope(child_id, current_user, "ticket.link")
    if child.get("client_id") != parent.get("client_id"):
        raise HTTPException(status_code=400, detail="Linked tickets must belong to the same client")
    await db.tickets.update_one({"id": child_id}, {"$set": {"parent_id": ticket_id}})
    await ticket_audit(ticket_id, current_user, "ticket_linked", f"Linked ticket {child_id}")
    return {"message": "Tickets linked"}

# ============== TICKET MERGE ENDPOINT ==============

@router.post("/tickets/{ticket_id}/merge")
async def merge_tickets(ticket_id: str, merge_data: dict, current_user: dict = Depends(get_current_user)):
    merge_ids = merge_data.get("merge_ids", [])
    if not merge_ids:
        raise HTTPException(status_code=400, detail="merge_ids required")
    from app.services.ticket_merging import merge_tickets as merge_ticket_records
    result = await merge_ticket_records(
        primary_ticket_id=ticket_id,
        secondary_ticket_ids=merge_ids,
        current_user=current_user,
    )
    return {"message": f"Merged {result['merged_count']} ticket(s)", **result}

# ============== TICKET TIME TRACKING ==============

@router.get("/tickets/{ticket_id}/time-entries")
async def get_ticket_time_entries(ticket_id: str, current_user: dict = Depends(get_current_user)):
    await _ticket_in_scope(ticket_id, current_user, "ticket.time.read")
    # ``time_entries`` owns billable time.  Retain old ticket-local entries in
    # the returned timeline as clearly labelled, non-billable historical
    # evidence instead of silently deleting them or letting them affect totals.
    await sync_ticket_time_cache(ticket_id, database=db)
    return await list_ticket_time_history(ticket_id, database=db)

@router.post(
    "/tickets/{ticket_id}/time-entries",
    dependencies=[Depends(require_action("ticket.time.create"))],
)
async def add_ticket_time_entry(ticket_id: str, entry_data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.time.create")
    try:
        minutes = int(entry_data.get("minutes") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Minutes must be a whole number")
    if minutes < 1:
        raise HTTPException(status_code=422, detail="Minutes must be at least one")
    actor, fallback_rate = await _ticket_time_actor(current_user)
    labour_type = await resolve_labour_type(
        entry_data.get("labour_type_id"),
        tenant_id=platform_tenant_id(current_user),
        database=db,
    )
    commercial = labour_snapshot(
        labour_type,
        fallback_rate=fallback_rate,
        requested_billable=entry_data.get("billable") if "billable" in entry_data else None,
    )
    raw_performed_at = entry_data.get("performed_at")
    performed_at = None
    if raw_performed_at:
        try:
            performed_at = _performed_at(datetime.fromisoformat(str(raw_performed_at).replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=422, detail="Performed time must be an ISO date-time") from None
    idempotency_key = str(entry_data.get("idempotency_key") or "").strip() or None
    extra = {
        **commercial["extra"],
        "tenant_id": platform_tenant_id(current_user),
        "performed_at": performed_at,
    }
    if entry_data.get("category"):
        extra["category"] = str(entry_data.get("category"))[:100]
    entry, created = await create_canonical_ticket_time_entry(
        ticket=ticket,
        actor=actor,
        minutes=minutes,
        description=str(entry_data.get("description") or ""),
        billable=commercial["billable"],
        source="ticket_workspace",
        idempotency_key=idempotency_key,
        hourly_rate=commercial["hourly_rate"],
        date=performed_at[:10] if performed_at else entry_data.get("date"),
        extra={key: value for key, value in extra.items() if value is not None},
        database=db,
    )
    if created:
        await ticket_audit(
            ticket_id,
            current_user,
            "time_logged",
            f"Logged {minutes} minutes · {commercial['extra'].get('labour_type_name') or 'Technician default'}",
        )
    entry["idempotent_replay"] = not created
    return entry

# ============== TICKET AUDIT LOG ==============

async def ticket_audit(
    ticket_id: str,
    user: dict,
    action: str,
    details: str,
    metadata: Optional[Dict[str, Any]] = None,
):
    """Append immutable ticket activity with optional structured evidence."""
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "action": action,
        "details": details,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_audit_log.insert_one(entry)


def _ticket_audit_display_entry(entry: dict) -> dict:
    """Normalise central audit evidence for the ticket-local activity view."""
    result = dict(entry)
    if result.get("action") in {"ticket_attachment_added", "ticket_attachment_deleted", "ticket_attachment_downloaded"} and not result.get("details"):
        metadata = result.get("metadata") or {}
        filename = metadata.get("filename") or result.get("entity_name") or "attachment"
        verb = {
            "ticket_attachment_added": "Attached",
            "ticket_attachment_deleted": "Removed",
            "ticket_attachment_downloaded": "Downloaded",
        }[result.get("action")]
        source = metadata.get("source")
        result["details"] = f"{verb} {filename}" + (f" · source: {source.replace('_', ' ')}" if source else "")
    return result

@router.get("/tickets/{ticket_id}/audit-log")
async def get_ticket_audit_log(ticket_id: str, current_user: dict = Depends(get_current_user)):
    await _ticket_in_scope(ticket_id, current_user, "ticket.audit.read")
    # ``ticket_audit`` was used by early workflow/device features.  Merge it
    # once at read time so existing history remains visible while all new
    # records are written to ``ticket_audit_log``.
    current, legacy, central = await asyncio.gather(
        db.ticket_audit_log.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(500),
        db.ticket_audit.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(500),
        db.audit_logs.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(500),
    )
    entries_by_id = {
        entry.get("id"): _ticket_audit_display_entry(entry)
        for entry in [*current, *legacy, *central]
        if entry.get("id")
    }
    return sorted(entries_by_id.values(), key=lambda entry: entry.get("created_at") or "", reverse=True)


# ============== CANNED RESPONSES ==============

@router.get("/canned-responses")
async def get_canned_responses(current_user: dict = Depends(get_current_user)):
    responses = await db.canned_responses.find({}, {"_id": 0}).to_list(500)
    return responses

@router.post("/canned-responses")
async def create_canned_response(data: dict, current_user: dict = Depends(get_current_user)):
    response = {
        "id": str(uuid.uuid4()),
        "title": data.get("title", ""),
        "content": data.get("content", ""),
        "category": data.get("category", "general"),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.canned_responses.insert_one(response)
    response.pop("_id", None)
    return response

@router.delete("/canned-responses/{response_id}")
async def delete_canned_response(response_id: str, current_user: dict = Depends(get_current_user)):
    await db.canned_responses.delete_one({"id": response_id})
    return {"message": "Deleted"}


# ============== TICKET EMAIL ENDPOINTS ==============

@router.get("/tickets/{ticket_id}/participants")
async def get_ticket_participants(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Visible people involved in this ticket conversation; BCC is intentionally excluded."""
    await _ticket_in_scope(ticket_id, current_user, "ticket.participants.read")
    return await db.ticket_participants.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("last_seen_at", -1).to_list(100)

@router.get("/tickets/{ticket_id}/emails")
async def get_ticket_emails(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Get all emails associated with a ticket"""
    await _ticket_in_scope(ticket_id, current_user, "ticket.email.read")
    
    emails = await db.ticket_emails.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return emails

@router.post("/tickets/{ticket_id}/emails")
async def send_ticket_email(ticket_id: str, email_data: TicketEmailCreate, current_user: dict = Depends(get_current_user)):
    """Send an email from a ticket"""
    ticket = await _ticket_in_scope(ticket_id, current_user, "ticket.email.send")
    
    subject = email_data.subject or f"Re: [{ticket.get('ticket_number', '')}] {ticket.get('title', '')}"

    # Apply the signed-in technician's default rich signature server-side.
    # A marker makes this safe for drafts/retries and scope selects new/reply.
    from app.routers.email_signatures import append_default_signature
    body, body_type, _signature_id = await append_default_signature(
        body=email_data.body,
        body_type=email_data.body_type,
        current_user=current_user,
        subject=subject,
        ticket_id=ticket_id,
    )

    attachment_ids = list(dict.fromkeys(str(value).strip() for value in email_data.attachment_ids if str(value).strip()))
    if len(attachment_ids) > 10:
        raise HTTPException(status_code=400, detail="A ticket email can include at most 10 retained attachments")
    email_attachments = []
    if attachment_ids:
        from app.services.supabase_storage import read_artifact
        attachments = await db.ticket_attachments.find(
            {"ticket_id": ticket_id, "id": {"$in": attachment_ids}}, {"_id": 0}
        ).to_list(len(attachment_ids))
        by_id = {attachment.get("id"): attachment for attachment in attachments}
        missing = [attachment_id for attachment_id in attachment_ids if attachment_id not in by_id]
        if missing:
            raise HTTPException(status_code=404, detail="One or more selected ticket attachments are unavailable")
        total_size = 0
        for attachment_id in attachment_ids:
            attachment = by_id[attachment_id]
            if not upload_is_releasable(attachment):
                raise HTTPException(status_code=423, detail="A selected attachment has not passed security scanning")
            artifact_path = (attachment.get("artifact_storage") or {}).get("object_path")
            if not artifact_path:
                raise HTTPException(status_code=409, detail=f"{attachment.get('filename', 'Attachment')} is not available in private storage")
            artifact = await read_artifact(artifact_path)
            if not artifact:
                raise HTTPException(status_code=404, detail=f"{attachment.get('filename', 'Attachment')} is unavailable")
            content, stored_content_type = artifact
            total_size += len(content)
            if total_size > 20 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Selected attachments exceed the 20MB email safety limit")
            email_attachments.append({
                "filename": attachment.get("filename") or "attachment",
                "content": content,
                "content_type": stored_content_type or attachment.get("content_type") or "application/octet-stream",
            })

    ticket_email = TicketEmail(
        ticket_id=ticket_id,
        ticket_title=ticket.get('title'),
        from_address=current_user.get('email', ''),
        from_name=current_user.get('name'),
        to_addresses=email_data.to_addresses,
        cc_addresses=email_data.cc_addresses,
        bcc_addresses=email_data.bcc_addresses,
        attachment_ids=attachment_ids,
        attachment_count=len(email_attachments),
        subject=subject,
        body=body,
        body_type=body_type,
        client_id=ticket.get('client_id'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        direction="outbound",
        status="pending"
    )
    
    from app.routers.email_utils import send_email
    delivery = await send_email(
        ticket_email.to_addresses,
        ticket_email.subject,
        ticket_email.body if ticket_email.body_type == "html" else f"<pre>{ticket_email.body}</pre>",
        category="ticket_replies",
        cc_addresses=ticket_email.cc_addresses,
        bcc_addresses=ticket_email.bcc_addresses,
        attachments=email_attachments,
        client_id=ticket.get("client_id"),
        related_type="ticket",
        related_id=ticket_id,
        initiated_by=current_user.get("id"),
        initiated_by_name=current_user.get("name"),
        thread_key=f"ticket:{ticket_id}",
    )
    ticket_email.status = delivery.get("status", "failed")
    ticket_email.message_id = delivery.get("email_id")
    if ticket_email.status == "sent":
        ticket_email.sent_at = datetime.now(timezone.utc)
    
    doc = ticket_email.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('sent_at'):
        doc['sent_at'] = doc['sent_at'].isoformat()
    doc['delivery_status'] = delivery.get('status', 'failed')
    doc['delivery_message'] = delivery.get('message', '')
    doc['sender_mailbox'] = delivery.get('sender')
    await db.ticket_emails.insert_one(doc)
    activity_at = doc.get("sent_at") or doc["created_at"]
    activity_update = {
        "updated_at": activity_at,
        "last_activity_at": activity_at,
        "last_activity_by_id": current_user.get("id"),
        "last_activity_by_name": current_user.get("name"),
    }
    if ticket_email.status == "sent":
        activity_update["last_technician_reply_at"] = activity_at
    await db.tickets.update_one(
        {"id": ticket_id, "client_id": ticket.get("client_id")},
        {"$set": activity_update},
    )
    from app.services.ticket_participants import sync_ticket_participants
    await sync_ticket_participants(
        ticket=ticket,
        addresses=ticket_email.to_addresses,
        role="recipient",
        direction="outbound",
        delivery_status=delivery.get("status"),
    )
    await sync_ticket_participants(
        ticket=ticket,
        addresses=ticket_email.cc_addresses,
        role="cc",
        direction="outbound",
        delivery_status=delivery.get("status"),
    )
    
    return ticket_email

