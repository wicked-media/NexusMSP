"""Nexus Connect: operational collaboration linked to canonical Nexus objects."""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Literal
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity, ticket_audit
from app.services.chat_access import require_channel_access
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import assert_client_scope


router = APIRouter()

TicketPassMode = Literal["take_over", "assist", "escalate", "consult", "cover", "return", "swarm"]
TRANSFER_MODES = frozenset({"take_over", "escalate", "cover", "return"})
MODE_LABELS = {
    "take_over": "Take over",
    "assist": "Assist",
    "escalate": "Escalate",
    "consult": "Consult",
    "cover": "Cover",
    "return": "Return",
    "swarm": "Swarm",
}


class TicketPassCreate(BaseModel):
    ticket_ref: str = Field(min_length=2, max_length=120)
    to_user_id: str = Field(min_length=1, max_length=120)
    mode: TicketPassMode = "take_over"
    reason: str = Field(min_length=3, max_length=1000)
    work_completed: list[str] = Field(default_factory=list, max_length=20)
    suggested_next_action: str = Field(default="", max_length=1000)
    channel_id: str | None = Field(default=None, max_length=120)


class TicketPassDecision(BaseModel):
    reason: str = Field(default="", max_length=1000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_lines(values: list[str]) -> list[str]:
    return [str(value).strip()[:300] for value in values if str(value).strip()][:20]


async def _ticket_for_user(reference: str, user: dict, operation: str) -> dict:
    ticket = await db.tickets.find_one(
        {"$or": [{"id": reference}, {"ticket_number": reference}]},
        {"_id": 0},
    )
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    await assert_client_scope(
        user,
        ticket.get("client_id"),
        site_id=ticket.get("site_id"),
        operation=operation,
        mask_not_found=True,
    )
    return ticket


async def _ticket_room(ticket: dict, actor: dict, recipient: dict) -> dict:
    existing = await db.chat_channels.find_one(
        {"kind": "object", "object_type": "ticket", "object_id": ticket["id"]},
        {"_id": 0},
    )
    member_ids = {
        value for value in [
            actor.get("id"),
            recipient.get("id"),
            ticket.get("assigned_to") or ticket.get("assignee_id"),
            *(ticket.get("watchers") or []),
        ] if value
    }
    if existing:
        await db.chat_channels.update_one(
            {"id": existing["id"]},
            {"$addToSet": {"member_ids": {"$each": sorted(member_ids)}}, "$set": {"updated_at": _now()}},
        )
        existing["member_ids"] = sorted(set(existing.get("member_ids") or []) | member_ids)
        return existing


    reference = ticket.get("ticket_number") or ticket["id"]
    slug = re.sub(r"[^a-z0-9]+", "-", str(reference).lower()).strip("-")[:48]
    room = {
        "id": uuid.uuid4().hex,
        "name": f"ticket-{slug}",
        "display_name": f"{reference} - {ticket.get('title') or 'Ticket room'}"[:100],
        "description": "Automatic Nexus Connect work room. Assignment and ticket state remain live.",
        "kind": "object",
        "object_type": "ticket",
        "object_id": ticket["id"],
        "object_reference": reference,
        "client_id": ticket.get("client_id"),
        "is_private": True,
        "is_dm": False,
        "member_ids": sorted(member_ids),
        "created_by": actor.get("id"),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.chat_channels.insert_one(dict(room))
    room.pop("_id", None)
    return room


def _pass_view(handoff: dict, ticket: dict | None = None) -> dict:
    return {
        **{key: value for key, value in handoff.items() if key != "_id"},
        "mode_label": MODE_LABELS.get(handoff.get("mode"), "Ticket pass"),
        "transfers_ownership": handoff.get("mode") in TRANSFER_MODES,
        "ticket": {
            "id": (ticket or {}).get("id") or handoff.get("ticket_id"),
            "ticket_number": (ticket or {}).get("ticket_number") or handoff.get("ticket_number"),
            "title": (ticket or {}).get("title") or handoff.get("ticket_title"),
            "status": (ticket or {}).get("status") or handoff.get("ticket_status"),
            "priority": (ticket or {}).get("priority") or handoff.get("ticket_priority"),
            "client_name": (ticket or {}).get("client_name") or handoff.get("client_name"),
            "assigned_to": (ticket or {}).get("assigned_to") or (ticket or {}).get("assignee_id"),
            "assigned_name": (ticket or {}).get("assigned_name") or (ticket or {}).get("assignee_name"),
        },
    }


async def _notify(user_id: str | None, title: str, body: str, handoff: dict) -> None:
    if not user_id:
        return
    await db.notifications.insert_one({
        "id": uuid.uuid4().hex,
        "type": "ticket_pass",
        "title": title,
        "body": body[:300],
        "message": body[:300],
        "ref_type": "ticket_pass",
        "ref_id": handoff["id"],
        "user_id": user_id,
        "target_user_id": user_id,
        "read": False,
        "created_at": _now(),
    })


@router.post("/nexus-connect/ticket-passes")
async def create_ticket_pass(
    payload: TicketPassCreate,
    request: Request,
    current_user: dict = Depends(require_action("ticket.handoff.manage")),
):
    ticket = await _ticket_for_user(payload.ticket_ref, current_user, "nexus_connect:ticket_pass:create")
    if str(ticket.get("status") or "").lower() in {"closed", "resolved"}:
        raise HTTPException(409, "Closed or resolved tickets cannot be passed")
    if payload.to_user_id == current_user.get("id"):
        raise HTTPException(400, "Choose another technician for this ticket pass")

    recipient = await db.users.find_one(
        {"id": payload.to_user_id, "is_active": {"$ne": False}, "archived": {"$ne": True}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "avatar": 1},
    )
    if not recipient:
        raise HTTPException(404, "Receiving technician not found")
    existing = await db.ticket_handoffs.find_one({
        "ticket_id": ticket["id"],
        "to_user_id": recipient["id"],
        "status": "pending",
    }, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(409, "This technician already has a pending pass for the ticket")

    room = await _ticket_room(ticket, current_user, recipient)
    origin_channel = None
    if payload.channel_id and payload.channel_id != room["id"]:
        origin_channel = await require_channel_access(payload.channel_id, current_user)
    now = _now()
    handoff = {
        "id": uuid.uuid4().hex,
        "ticket_id": ticket["id"],
        "ticket_number": ticket.get("ticket_number") or ticket["id"],
        "ticket_title": ticket.get("title") or "Untitled ticket",
        "ticket_status": ticket.get("status") or "open",
        "ticket_priority": ticket.get("priority") or "medium",
        "client_id": ticket.get("client_id"),
        "client_name": ticket.get("client_name"),
        "from_user_id": current_user.get("id"),
        "from_user_name": current_user.get("name") or current_user.get("email") or "Technician",
        "from_assigned_to": ticket.get("assigned_to") or ticket.get("assignee_id"),
        "to_user_id": recipient["id"],
        "to_user_name": recipient.get("name") or recipient.get("email") or "Technician",
        "mode": payload.mode,
        "reason": payload.reason.strip(),
        "work_completed": _clean_lines(payload.work_completed),
        "suggested_next_action": payload.suggested_next_action.strip(),
        "status": "pending",
        "channel_id": room["id"],
        "created_at": now,
        "updated_at": now,
    }
    await db.ticket_handoffs.insert_one(dict(handoff))
    message_ids = []
    for destination in [room, *([origin_channel] if origin_channel else [])]:
        message = {
            "id": uuid.uuid4().hex,
            "channel_id": destination["id"],
            "user_id": current_user.get("id"),
            "user_name": current_user.get("name"),
            "avatar_url": current_user.get("avatar"),
            "body": f"{handoff['from_user_name']} proposed {MODE_LABELS[payload.mode].lower()} for /ticket {handoff['ticket_number']} to @{handoff['to_user_name']}.",
            "object_refs": [{"type": "ticket", "id": ticket["id"], "reference": handoff["ticket_number"]}],
            "action_card": {"kind": "ticket_pass", "id": handoff["id"]},
            "ts": now,
            "edited": False,
            "reactions": {},
        }
        await db.chat_messages.insert_one(dict(message))
        message_ids.append(message["id"])
        await db.chat_channels.update_one({"id": destination["id"]}, {"$set": {"updated_at": now, "last_message_at": now}})
    await db.ticket_handoffs.update_one({"id": handoff["id"]}, {"$set": {"message_id": message_ids[0], "message_ids": message_ids, "origin_channel_id": (origin_channel or {}).get("id")}})
    handoff.update({"message_id": message_ids[0], "message_ids": message_ids, "origin_channel_id": (origin_channel or {}).get("id")})
    await _notify(recipient["id"], f"Ticket pass from {handoff['from_user_name']}", f"{handoff['ticket_number']}: {handoff['reason']}", handoff)
    await ticket_audit(ticket["id"], current_user, "handoff_requested", f"{MODE_LABELS[payload.mode]} requested for {handoff['to_user_name']}: {handoff['reason']}")
    await log_activity(current_user, "requested", "ticket_handoff", handoff["id"], handoff["ticket_number"], handoff["reason"], metadata={"client_id": ticket.get("client_id"), "ticket_id": ticket["id"], "to_user_id": recipient["id"], "mode": payload.mode})
    await emit_platform_event(subject="ticket.handoff.requested", source="nexus.connect", payload={"handoff_id": handoff["id"], "ticket_id": ticket["id"], "to_user_id": recipient["id"], "mode": payload.mode}, actor=current_user, client_id=ticket.get("client_id"), correlation_id=request_correlation_id(request), partition_key=ticket["id"])
    return {"message": "Ticket pass sent", "room": {key: room.get(key) for key in ("id", "display_name", "object_reference")}, "handoff": _pass_view(handoff, ticket)}


@router.get("/nexus-connect/ticket-passes/{handoff_id}")
async def get_ticket_pass(handoff_id: str, current_user: dict = Depends(require_action("ticket.handoff.manage"))):
    handoff = await db.ticket_handoffs.find_one({"id": handoff_id}, {"_id": 0})
    if not handoff:
        raise HTTPException(404, "Ticket pass not found")
    ticket = await _ticket_for_user(handoff["ticket_id"], current_user, "nexus_connect:ticket_pass:view")
    if handoff.get("channel_id"):
        await require_channel_access(handoff["channel_id"], current_user)
    return _pass_view(handoff, ticket)


@router.post("/nexus-connect/ticket-passes/{handoff_id}/accept")
async def accept_ticket_pass(
    handoff_id: str,
    request: Request,
    current_user: dict = Depends(require_action("ticket.handoff.manage")),
):
    handoff = await db.ticket_handoffs.find_one_and_update(
        {"id": handoff_id, "to_user_id": current_user.get("id"), "status": "pending"},
        {"$set": {"status": "accepting", "updated_at": _now()}},
        return_document=ReturnDocument.AFTER,
    )
    if not handoff:
        raise HTTPException(409, "This ticket pass is unavailable or has already been answered")
    ticket = await _ticket_for_user(handoff["ticket_id"], current_user, "nexus_connect:ticket_pass:accept")
    now = _now()

    if handoff.get("mode") in TRANSFER_MODES:
        owner_filter: dict = {"assigned_to": handoff.get("from_assigned_to")} if handoff.get("from_assigned_to") else {"$or": [{"assigned_to": None}, {"assigned_to": {"$exists": False}}]}
        result = await db.tickets.update_one(
            {"id": ticket["id"], "status": {"$nin": ["closed", "resolved"]}, **owner_filter},
            {"$set": {
                "assigned_to": current_user.get("id"),
                "assigned_name": current_user.get("name"),
                "assignee_id": current_user.get("id"),
                "assignee_name": current_user.get("name"),
                "assigned_at": now,
                "updated_at": now,
            }},
        )
        if not result.matched_count:
            await db.ticket_handoffs.update_one({"id": handoff_id, "status": "accepting"}, {"$set": {"status": "stale", "updated_at": now, "resolution_reason": "Ticket ownership or lifecycle changed before acceptance."}})
            raise HTTPException(409, "Ticket ownership changed before this pass was accepted. Review the live ticket and create a new pass if required")
    else:
        await db.tickets.update_one({"id": ticket["id"]}, {"$addToSet": {"watchers": current_user.get("id")}, "$set": {"updated_at": now}})

    await db.ticket_handoffs.update_one({"id": handoff_id, "status": "accepting"}, {"$set": {"status": "accepted", "responded_at": now, "responded_by": current_user.get("id"), "updated_at": now}})
    await db.presence_state.update_one(
        {"user_id": handoff.get("from_user_id"), "busy_state": {"$in": [f"ticket:{ticket['id']}", f"ticket:{handoff.get('ticket_number')}"]}},
        {"$set": {"busy_state": None, "busy_state_changed_at": now}},
    )
    await _notify(handoff.get("from_user_id"), f"{current_user.get('name')} accepted {handoff.get('ticket_number')}", f"{MODE_LABELS.get(handoff.get('mode'), 'Ticket pass')} accepted", handoff)
    await ticket_audit(ticket["id"], current_user, "handoff_accepted", f"Accepted {MODE_LABELS.get(handoff.get('mode'), 'ticket pass')} from {handoff.get('from_user_name')}")
    await log_activity(current_user, "accepted", "ticket_handoff", handoff_id, handoff.get("ticket_number"), f"Accepted from {handoff.get('from_user_name')}", metadata={"client_id": ticket.get("client_id"), "ticket_id": ticket["id"], "mode": handoff.get("mode")})
    await emit_platform_event(subject="ticket.handoff.accepted", source="nexus.connect", payload={"handoff_id": handoff_id, "ticket_id": ticket["id"], "mode": handoff.get("mode")}, actor=current_user, client_id=ticket.get("client_id"), correlation_id=request_correlation_id(request), partition_key=ticket["id"])
    updated = await db.ticket_handoffs.find_one({"id": handoff_id}, {"_id": 0})
    fresh_ticket = await db.tickets.find_one({"id": ticket["id"]}, {"_id": 0})
    return {"message": "Ticket pass accepted", "handoff": _pass_view(updated or handoff, fresh_ticket or ticket)}


@router.post("/nexus-connect/ticket-passes/{handoff_id}/decline")
async def decline_ticket_pass(
    handoff_id: str,
    request: Request,
    payload: TicketPassDecision = Body(default=TicketPassDecision()),
    current_user: dict = Depends(require_action("ticket.handoff.manage")),
):
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(400, "A brief decline reason is required")
    now = _now()
    handoff = await db.ticket_handoffs.find_one_and_update(
        {"id": handoff_id, "to_user_id": current_user.get("id"), "status": "pending"},
        {"$set": {"status": "declined", "resolution_reason": reason, "responded_at": now, "responded_by": current_user.get("id"), "updated_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    if not handoff:
        raise HTTPException(409, "This ticket pass is unavailable or has already been answered")
    ticket = await _ticket_for_user(handoff["ticket_id"], current_user, "nexus_connect:ticket_pass:decline")
    await _notify(handoff.get("from_user_id"), f"{current_user.get('name')} declined {handoff.get('ticket_number')}", reason, handoff)
    await ticket_audit(ticket["id"], current_user, "handoff_declined", f"Declined {MODE_LABELS.get(handoff.get('mode'), 'ticket pass')}: {reason}")
    await log_activity(current_user, "declined", "ticket_handoff", handoff_id, handoff.get("ticket_number"), reason, metadata={"client_id": ticket.get("client_id"), "ticket_id": ticket["id"], "mode": handoff.get("mode")})
    await emit_platform_event(subject="ticket.handoff.declined", source="nexus.connect", payload={"handoff_id": handoff_id, "ticket_id": ticket["id"], "mode": handoff.get("mode"), "reason": reason}, actor=current_user, client_id=ticket.get("client_id"), correlation_id=request_correlation_id(request), partition_key=ticket["id"])
    return {"message": "Ticket pass declined", "handoff": _pass_view(handoff, ticket)}
