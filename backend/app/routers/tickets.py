from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
import os
import asyncio
import logging
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.avatar_enrichment import attach_user_avatars
from app.models import *

logger = logging.getLogger(__name__)
router = APIRouter()

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
    
    tickets = await db.tickets.find(query, {"_id": 0}).to_list(1000)
    await attach_user_avatars(tickets, id_fields=("assigned_to",), output_field="assignee_avatar")
    for t in tickets:
        for field in ['created_at', 'updated_at', 'sla_due']:
            if isinstance(t.get(field), str):
                t[field] = datetime.fromisoformat(t[field])
    return tickets

@router.get("/tickets/note-counts")
async def get_ticket_note_counts(current_user: dict = Depends(get_current_user)):
    open_tickets = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1}).to_list(10000)
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
    result = {}
    for ticket_id, viewers in _ticket_viewers.items():
        if viewers:
            result[ticket_id] = list(viewers.values())
    return result

@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await attach_user_avatars([ticket], id_fields=("assigned_to",), output_field="assignee_avatar")
    return ticket

@router.post("/tickets", response_model=Ticket)
async def create_ticket(ticket_data: TicketCreate, current_user: dict = Depends(get_current_user)):
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
        device = await db.devices.find_one({"id": ticket_data.device_id}, {"_id": 0, "name": 1})
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        device_name = device['name'] if device else None

    # Multi-device: ensure device_id is included in device_ids, and resolve device_names parallel array
    device_ids = list(ticket_data.device_ids or [])
    if ticket_data.device_id and ticket_data.device_id not in device_ids:
        device_ids.insert(0, ticket_data.device_id)
    device_names = []
    if device_ids:
        cursor = db.devices.find({"id": {"$in": device_ids}}, {"_id": 0, "id": 1, "name": 1})
        async for d in cursor:
            device_names.append(d.get("name") or d.get("id"))
    
    # Generate ticket number using configurable scheme
    from app.routers.ticket_suggestions import generate_ticket_number
    ticket_number = await generate_ticket_number(ticket_data.ticket_type)
    
    ticket = Ticket(
        **ticket_data.model_dump(),
        ticket_number=ticket_number,
        client_name=client_name,
        assigned_name=assigned_name,
        device_name=device_name,
        sla_due=sla_due
    )
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
    old_ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    now_iso = datetime.now(timezone.utc).isoformat()
    ticket_data['updated_at'] = now_iso
    # Auto-close: when marked as resolved, automatically set to closed
    resolution_requested = ticket_data.get("status") == "resolved"
    if resolution_requested:
        ticket_data["status"] = "closed"
    # A closure is an audit event, not simply a queue state. Retain who closed
    # it, when it happened, and that it was resolved through the normal flow.
    if ticket_data.get("status") == "closed" and old_ticket and old_ticket.get("status") != "closed":
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
        device = await db.devices.find_one({"id": ticket_data['device_id']}, {"_id": 0, "name": 1})
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        ticket_data['device_name'] = device['name'] if device else None
    elif 'device_id' in ticket_data and not ticket_data['device_id']:
        ticket_data['device_name'] = None
    if 'assigned_to' in ticket_data:
        if ticket_data['assigned_to']:
            assignee = await db.users.find_one({"id": ticket_data['assigned_to']}, {"_id": 0, "name": 1})
            if not assignee:
                raise HTTPException(status_code=404, detail="Assigned technician not found")
            ticket_data['assigned_name'] = assignee.get('name')
            ticket_data['assigned_at'] = datetime.now(timezone.utc).isoformat()
        else:
            ticket_data['assigned_name'] = None
    result = await db.tickets.update_one({"id": ticket_id}, {"$set": ticket_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
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
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0, "name": 1, "id": 1})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
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
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
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
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if ticket:
        await db.clients.update_one({"id": ticket['client_id']}, {"$inc": {"ticket_count": -1}})
        await log_activity(current_user, "deleted", "ticket", ticket_id, ticket.get("title", ""), f"Deleted ticket {ticket.get('ticket_number', '')}")
    result = await db.tickets.delete_one({"id": ticket_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {"message": "Ticket deleted"}

# ============== TICKET COMMENTS/NOTES ENDPOINTS ==============

@router.get("/tickets/{ticket_id}/comments")
async def get_ticket_comments(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    comments = await db.ticket_comments.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return await attach_user_avatars(comments)

@router.post("/tickets/{ticket_id}/comments")
async def create_ticket_comment(ticket_id: str, comment_data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    content = str(comment_data.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write an update before publishing")

    visibility = str(comment_data.get("visibility") or "").strip().lower()
    is_internal = bool(comment_data.get("is_internal", visibility != "public"))
    if visibility not in {"internal", "public"}:
        visibility = "internal" if is_internal else "public"
    is_internal = visibility == "internal"
    notify_client = bool(comment_data.get("notify_client", False)) and not is_internal

    recipients = [
        str(address or "").strip()
        for address in (comment_data.get("to_addresses") or [])
        if str(address or "").strip()
    ]
    if notify_client and not recipients:
        contact_email = str(ticket.get("contact_email") or "").strip()
        if contact_email:
            recipients.append(contact_email)
    if notify_client and not recipients and ticket.get("contact_id"):
        client = await db.clients.find_one({"id": ticket.get("client_id")}, {"_id": 0, "contacts": 1})
        contact = next(
            (
                item for item in ((client or {}).get("contacts") or [])
                if str(item.get("id") or item.get("name") or "") == str(ticket.get("contact_id"))
            ),
            None,
        )
        if contact and str(contact.get("email") or "").strip():
            recipients.append(str(contact["email"]).strip())
    if notify_client and not recipients:
        client = await db.clients.find_one({"id": ticket.get("client_id")}, {"_id": 0, "email": 1})
        if client and str(client.get("email") or "").strip():
            recipients.append(str(client["email"]).strip())
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
        )

    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "avatar_url": current_user.get("avatar"),
        "content": content,
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

# ============== TICKET CHILD/PARENT ENDPOINTS ==============

@router.get("/tickets/{ticket_id}/children")
async def get_child_tickets(ticket_id: str, current_user: dict = Depends(get_current_user)):
    children = await db.tickets.find({"parent_id": ticket_id}, {"_id": 0}).to_list(100)
    return children

@router.post("/tickets/{ticket_id}/children")
async def create_child_ticket(ticket_id: str, ticket_data: dict, current_user: dict = Depends(get_current_user)):
    parent = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not parent:
        raise HTTPException(status_code=404, detail="Parent ticket not found")
    from app.routers.ticket_suggestions import generate_ticket_number
    child_number = await generate_ticket_number(ticket_data.get("ticket_type", parent.get("ticket_type", "incident")))
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
    result = await db.tickets.update_one({"id": child_id}, {"$set": {"parent_id": ticket_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Child ticket not found")
    await ticket_audit(ticket_id, current_user, "ticket_linked", f"Linked ticket {child_id}")
    return {"message": "Tickets linked"}

# ============== TICKET MERGE ENDPOINT ==============

@router.post("/tickets/{ticket_id}/merge")
async def merge_tickets(ticket_id: str, merge_data: dict, current_user: dict = Depends(get_current_user)):
    merge_ids = merge_data.get("merge_ids", [])
    if not merge_ids:
        raise HTTPException(status_code=400, detail="merge_ids required")
    target = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Target ticket not found")
    for mid in merge_ids:
        source = await db.tickets.find_one({"id": mid}, {"_id": 0})
        if source:
            await db.tickets.update_one({"id": mid}, {"$set": {"status": "closed", "merged_into": ticket_id}})
            src_comments = await db.ticket_comments.find({"ticket_id": mid}, {"_id": 0}).to_list(500)
            for c in src_comments:
                c["ticket_id"] = ticket_id
                c["content"] = f"[Merged from {source.get('ticket_number', mid)}] {c.get('content', '')}"
                c["id"] = str(uuid.uuid4())
                await db.ticket_comments.insert_one(c)
            await ticket_audit(ticket_id, current_user, "ticket_merged", f"Merged {source.get('ticket_number', mid)} into this ticket")
    return {"message": f"Merged {len(merge_ids)} tickets"}

# ============== TICKET TIME TRACKING ==============

@router.get("/tickets/{ticket_id}/time-entries")
async def get_ticket_time_entries(ticket_id: str, current_user: dict = Depends(get_current_user)):
    entries = await db.ticket_time_entries.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return entries

@router.post("/tickets/{ticket_id}/time-entries")
async def add_ticket_time_entry(ticket_id: str, entry_data: dict, current_user: dict = Depends(get_current_user)):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "minutes": entry_data.get("minutes", 0),
        "description": entry_data.get("description", ""),
        "billable": entry_data.get("billable", True),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_time_entries.insert_one(entry)
    entry.pop("_id", None)
    total_min = entry["minutes"]
    existing = await db.ticket_time_entries.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(5000)
    total_min = sum(e.get("minutes", 0) for e in existing)
    await db.tickets.update_one({"id": ticket_id}, {"$set": {"total_time_minutes": total_min}})
    await ticket_audit(ticket_id, current_user, "time_logged", f"Logged {entry_data.get('minutes',0)} minutes")
    return entry

# ============== TICKET AUDIT LOG ==============

async def ticket_audit(ticket_id: str, user: dict, action: str, details: str):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "action": action,
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_audit_log.insert_one(entry)

@router.get("/tickets/{ticket_id}/audit-log")
async def get_ticket_audit_log(ticket_id: str, current_user: dict = Depends(get_current_user)):
    # ``ticket_audit`` was used by early workflow/device features.  Merge it
    # once at read time so existing history remains visible while all new
    # records are written to ``ticket_audit_log``.
    current, legacy = await asyncio.gather(
        db.ticket_audit_log.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(500),
        db.ticket_audit.find({"ticket_id": ticket_id}, {"_id": 0}).to_list(500),
    )
    entries_by_id = {entry.get("id"): entry for entry in [*current, *legacy] if entry.get("id")}
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

@router.get("/tickets/{ticket_id}/emails")
async def get_ticket_emails(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Get all emails associated with a ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    emails = await db.ticket_emails.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return emails

@router.post("/tickets/{ticket_id}/emails")
async def send_ticket_email(ticket_id: str, email_data: TicketEmailCreate, current_user: dict = Depends(get_current_user)):
    """Send an email from a ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
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

    ticket_email = TicketEmail(
        ticket_id=ticket_id,
        ticket_title=ticket.get('title'),
        from_address=current_user.get('email', ''),
        from_name=current_user.get('name'),
        to_addresses=email_data.to_addresses,
        cc_addresses=email_data.cc_addresses,
        bcc_addresses=email_data.bcc_addresses,
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
        client_id=ticket.get("client_id"),
        related_type="ticket",
        related_id=ticket_id,
        initiated_by=current_user.get("id"),
        initiated_by_name=current_user.get("name"),
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
    
    return ticket_email

