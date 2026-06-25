"""Ticket meta operations — change customer (re-parent ticket), bulk customer
change, restore previous customer if mis-assigned.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
import uuid

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

router = APIRouter()


def _now():
    return datetime.now(timezone.utc).isoformat()


@router.post("/tickets/{ticket_id}/change-customer")
async def change_customer(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Reassign a ticket to a different client. Captures a history entry, updates linked
    contact (if it now belongs to the new client), and posts an audit comment."""
    new_client_id = data.get("client_id")
    if not new_client_id:
        raise HTTPException(400, "client_id required")
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    new_client = await db.clients.find_one({"id": new_client_id}, {"_id": 0})
    if not new_client:
        raise HTTPException(404, "Target client not found")

    old_client_id = ticket.get("client_id")
    old_client_name = ticket.get("client_name")

    if old_client_id == new_client_id:
        return {"success": True, "no_change": True}

    new_contact_id = data.get("contact_id")
    new_contact_name = None
    if new_contact_id:
        c = await db.client_contacts.find_one({"id": new_contact_id, "client_id": new_client_id}, {"_id": 0})
        if c:
            new_contact_name = c.get("name")

    history_entry = {
        "id": str(uuid.uuid4()),
        "ts": _now(),
        "from_client_id": old_client_id,
        "from_client_name": old_client_name,
        "to_client_id": new_client_id,
        "to_client_name": new_client.get("name"),
        "changed_by": current_user.get("name"),
        "reason": (data.get("reason") or "").strip()[:240],
    }

    update = {
        "client_id": new_client_id,
        "client_name": new_client.get("name"),
        "updated_at": _now(),
    }
    # Clear contact link unless explicitly provided (it would belong to old client otherwise)
    if new_contact_id and new_contact_name:
        update["contact_id"] = new_contact_id
        update["contact_name"] = new_contact_name
    else:
        update["contact_id"] = None
        update["contact_name"] = None

    await db.tickets.update_one({"id": ticket_id}, {
        "$set": update,
        "$push": {"customer_history": history_entry},
    })

    # Audit comment
    comment_text = (
        f"📋 Customer changed: **{old_client_name or 'Unassigned'}** → **{new_client.get('name')}**"
        + (f"\nReason: {history_entry['reason']}" if history_entry["reason"] else "")
    )
    await db.ticket_comments.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "author": current_user.get("name"),
        "author_id": current_user.get("id"),
        "content": comment_text,
        "kind": "customer_changed",
        "created_at": _now(),
    })
    await db.tickets.update_one({"id": ticket_id}, {"$inc": {"comments_count": 1}})
    await log_activity(current_user, "customer_changed", "ticket", ticket_id,
                       ticket.get("ticket_number", ""),
                       f"{old_client_name or '—'} → {new_client.get('name')}")

    fresh = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    return {"success": True, "ticket": fresh, "history_entry": history_entry}


@router.get("/tickets/{ticket_id}/customer-history")
async def customer_history(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "customer_history": 1})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    return ticket.get("customer_history", [])


@router.post("/tickets/{ticket_id}/revert-customer")
async def revert_customer(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """One-click revert to the previous customer (uses the latest history entry)."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    history = ticket.get("customer_history") or []
    if not history:
        raise HTTPException(400, "No previous customer to revert to")
    last = history[-1]
    prev_id = last.get("from_client_id")
    if not prev_id:
        raise HTTPException(400, "Previous customer record incomplete")
    return await change_customer(ticket_id, {"client_id": prev_id, "reason": "Reverted previous change"}, current_user)
