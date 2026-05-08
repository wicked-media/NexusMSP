"""
Team-shared ticket pins (Outage Room / Incident Command).
Anyone in the team can pin a ticket to make it visible on the Dashboard NOC strip.
Only the original pinner or an admin can unpin.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
from typing import Optional
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/team-pins")
async def list_team_pins(current_user: dict = Depends(get_current_user)):
    """Get all team-pinned tickets, hydrated with ticket details."""
    pins = await db.team_pins.find({}, {"_id": 0}).sort("pinned_at", -1).to_list(50)
    if not pins:
        return {"pins": [], "count": 0}

    ticket_ids = [p["ticket_id"] for p in pins]
    ticket_docs = await db.tickets.find(
        {"id": {"$in": ticket_ids}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "status": 1,
         "client_name": 1, "sla_due": 1, "assigned_name": 1, "category": 1}
    ).to_list(50)
    ticket_map = {t["id"]: t for t in ticket_docs}

    hydrated = []
    for p in pins:
        t = ticket_map.get(p["ticket_id"])
        if t:
            hydrated.append({
                **t,
                "pinned_by": p.get("pinned_by"),
                "pinned_by_name": p.get("pinned_by_name"),
                "pinned_at": p.get("pinned_at"),
                "note": p.get("note", ""),
                "reason": p.get("reason", "outage"),
            })
    return {"pins": hydrated, "count": len(hydrated)}


@router.post("/team-pins/ticket/{ticket_id}")
async def team_pin_ticket(ticket_id: str, body: Optional[dict] = None, current_user: dict = Depends(get_current_user)):
    """Pin a ticket for the whole team."""
    body = body or {}
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "title": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    existing = await db.team_pins.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if existing:
        return {"message": "Already pinned by team", "team_pinned": True, "by": existing.get("pinned_by_name")}
    pin = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "pinned_by": current_user["id"],
        "pinned_by_name": current_user.get("name") or current_user.get("email"),
        "pinned_at": datetime.now(timezone.utc).isoformat(),
        "note": body.get("note", ""),
        "reason": body.get("reason", "outage"),
    }
    await db.team_pins.insert_one(pin.copy())
    return {"message": "Pinned for team", "team_pinned": True, "pin": pin}


@router.delete("/team-pins/ticket/{ticket_id}")
async def team_unpin_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Unpin a ticket from team. Only the original pinner or admin can unpin."""
    existing = await db.team_pins.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not pinned")
    is_admin = (current_user.get("role") or "").lower() == "admin"
    if existing.get("pinned_by") != current_user["id"] and not is_admin:
        raise HTTPException(
            status_code=403,
            detail=f"Only {existing.get('pinned_by_name')} or an admin can unpin this",
        )
    await db.team_pins.delete_one({"ticket_id": ticket_id})
    return {"message": "Unpinned from team", "team_pinned": False}


@router.get("/team-pins/ticket/{ticket_id}/status")
async def team_pin_status(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Check if a ticket is pinned by the team and who pinned it."""
    existing = await db.team_pins.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not existing:
        return {"team_pinned": False}
    return {
        "team_pinned": True,
        "pinned_by": existing.get("pinned_by"),
        "pinned_by_name": existing.get("pinned_by_name"),
        "pinned_at": existing.get("pinned_at"),
        "note": existing.get("note", ""),
        "reason": existing.get("reason", "outage"),
        "can_unpin": existing.get("pinned_by") == current_user["id"] or (current_user.get("role") or "").lower() == "admin",
    }
