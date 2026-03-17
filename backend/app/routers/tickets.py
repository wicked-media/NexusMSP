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
    
    tickets = await db.tickets.find(query, {"_id": 0}).to_list(1000)
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
    return ticket

@router.post("/tickets", response_model=Ticket)
async def create_ticket(ticket_data: TicketCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": ticket_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    assigned_name = None
    if ticket_data.assigned_to:
        user = await db.users.find_one({"id": ticket_data.assigned_to}, {"_id": 0})
        assigned_name = user['name'] if user else None
    
    sla_hours = {"critical": 2, "high": 4, "medium": 8, "low": 24}
    sla_due = datetime.now(timezone.utc) + timedelta(hours=sla_hours.get(ticket_data.priority, 8))
    
    # Resolve device name
    device_name = None
    if ticket_data.device_id:
        device = await db.devices.find_one({"id": ticket_data.device_id}, {"_id": 0, "name": 1})
        device_name = device['name'] if device else None
    
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
    doc = ticket.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    doc['sla_due'] = doc['sla_due'].isoformat() if doc['sla_due'] else None
    await db.tickets.insert_one(doc)
    await db.clients.update_one({"id": ticket_data.client_id}, {"$inc": {"ticket_count": 1}})
    await log_activity(current_user, "created", "ticket", ticket.id, ticket.title, f"Created ticket {ticket_number} for {client_name}", metadata={"ticket_number": ticket_number, "client_name": client_name, "priority": ticket_data.priority})
    return ticket

@router.put("/tickets/{ticket_id}")
async def update_ticket(ticket_id: str, ticket_data: dict, current_user: dict = Depends(get_current_user)):
    old_ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    ticket_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    # Resolve device name if device_id changed
    if 'device_id' in ticket_data and ticket_data['device_id']:
        device = await db.devices.find_one({"id": ticket_data['device_id']}, {"_id": 0, "name": 1})
        ticket_data['device_name'] = device['name'] if device else None
    elif 'device_id' in ticket_data and not ticket_data['device_id']:
        ticket_data['device_name'] = None
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
    return {"message": "Ticket updated"}

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
    return comments

@router.post("/tickets/{ticket_id}/comments")
async def create_ticket_comment(ticket_id: str, comment_data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "content": comment_data.get("content", ""),
        "is_internal": comment_data.get("is_internal", False),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_comments.insert_one(comment)
    comment.pop("_id", None)
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
    entries = await db.ticket_audit_log.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return entries


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
    
    ticket_email = TicketEmail(
        ticket_id=ticket_id,
        ticket_title=ticket.get('title'),
        from_address=current_user.get('email', ''),
        from_name=current_user.get('name'),
        to_addresses=email_data.to_addresses,
        cc_addresses=email_data.cc_addresses,
        subject=subject,
        body=email_data.body,
        body_type=email_data.body_type,
        client_id=ticket.get('client_id'),
        user_id=current_user['id'],
        user_name=current_user['name'],
        direction="outbound",
        status="pending"
    )
    
    # Send via Resend if configured
    import resend
    resend_key = os.environ.get("RESEND_API_KEY", "")
    sender_email = os.environ.get("SENDER_EMAIL", "tickets@nexusops.io")
    
    if resend_key and not resend_key.startswith("re_test_placeholder"):
        resend.api_key = resend_key
        try:
            params = {
                "from": f"NexusOps <{sender_email}>",
                "to": ticket_email.to_addresses,
                "subject": ticket_email.subject,
                "html": ticket_email.body if ticket_email.body_type == "html" else f"<pre>{ticket_email.body}</pre>",
            }
            if ticket_email.cc_addresses:
                params["cc"] = ticket_email.cc_addresses
            result = await asyncio.to_thread(resend.Emails.send, params)
            ticket_email.status = "sent"
            ticket_email.message_id = result.get("id") if isinstance(result, dict) else None
            ticket_email.sent_at = datetime.now(timezone.utc)
            logger.info(f"Email sent via Resend to {ticket_email.to_addresses}, id={ticket_email.message_id}")
        except Exception as e:
            ticket_email.status = "failed"
            logger.error(f"Resend email failed: {e}")
    else:
        # Demo mode - mark as sent without actually sending
        ticket_email.status = "sent"
        ticket_email.sent_at = datetime.now(timezone.utc)
        logger.info(f"Email marked as sent (demo mode) to {ticket_email.to_addresses}")
    
    doc = ticket_email.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    if doc.get('sent_at'):
        doc['sent_at'] = doc['sent_at'].isoformat()
    await db.ticket_emails.insert_one(doc)
    
    # Add to ticket comments
    await db.ticket_comments.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "user_id": current_user['id'],
        "user_name": current_user['name'],
        "content": f"📧 Email sent to: {', '.join(email_data.to_addresses)}\n\nSubject: {subject}\n\n{email_data.body}",
        "is_internal": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return ticket_email

