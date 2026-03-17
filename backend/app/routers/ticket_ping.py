from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
import asyncio
import logging
from app.database import db
from app.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

# ============== TICKET AUTO-PING & ESCALATION ==============

@router.get("/settings/ticket-ping")
async def get_ticket_ping_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "ticket_ping"}, {"_id": 0})
    return settings or {
        "type": "ticket_ping",
        "enabled": True,
        "ping_interval_minutes": 30,
        "escalation_timeout_hours": 24,
        "escalation_to": "admin",
        "ping_on_create": True,
        "ping_until_picked_up": True,
        "category_teams": {},
        "sla_teams": {},
        "escalation_contacts": [],
        "updated_at": None,
    }

@router.put("/settings/ticket-ping")
async def update_ticket_ping_settings(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    data["type"] = "ticket_ping"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "ticket_ping"}, {"$set": data}, upsert=True)
    return {"message": "Ticket ping settings updated"}

@router.get("/settings/ticket-ping/team-mappings")
async def get_team_mappings(current_user: dict = Depends(get_current_user)):
    """Get the current category → team and SLA → team mappings"""
    settings = await db.settings.find_one({"type": "ticket_ping"}, {"_id": 0})
    if not settings:
        settings = {}
    
    users = await db.users.find({}, {"_id": 0, "id": 1, "name": 1, "role": 1, "specialties": 1, "is_admin": 1}).to_list(100)
    
    return {
        "category_teams": settings.get("category_teams", {}),
        "sla_teams": settings.get("sla_teams", {}),
        "escalation_contacts": settings.get("escalation_contacts", []),
        "available_users": [{"id": u["id"], "name": u["name"], "role": u.get("role", ""), "is_admin": u.get("is_admin", False)} for u in users],
    }

@router.put("/settings/ticket-ping/team-mappings")
async def update_team_mappings(data: dict, current_user: dict = Depends(get_current_user)):
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if "category_teams" in data:
        update["category_teams"] = data["category_teams"]
    if "sla_teams" in data:
        update["sla_teams"] = data["sla_teams"]
    if "escalation_contacts" in data:
        update["escalation_contacts"] = data["escalation_contacts"]
    
    await db.settings.update_one({"type": "ticket_ping"}, {"$set": update}, upsert=True)
    return {"message": "Team mappings updated"}

async def send_ping_notification(user_ids: list, ticket: dict, ping_type: str = "new_ticket"):
    """Send ping notifications to specified users"""
    now = datetime.now(timezone.utc).isoformat()
    ticket_number = ticket.get("ticket_number", "")
    title = ticket.get("title", "")
    priority = ticket.get("priority", "medium")
    category = ticket.get("category", "")
    client_name = ticket.get("client_name", "")
    
    if ping_type == "new_ticket":
        message = f"New {priority.upper()} ticket [{ticket_number}] from {client_name}: {title}"
    elif ping_type == "reminder":
        message = f"REMINDER: Ticket [{ticket_number}] still unassigned - {title} ({client_name})"
    elif ping_type == "escalation":
        message = f"ESCALATED: Ticket [{ticket_number}] unassigned for 24h+ - {title} ({client_name})"
    else:
        message = f"Ticket [{ticket_number}]: {title}"
    
    for user_id in user_ids:
        notif = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "message": message,
            "type": f"ticket_ping_{ping_type}",
            "ticket_id": ticket.get("id", ""),
            "priority": priority,
            "category": category,
            "read": False,
            "created_at": now,
        }
        await db.notifications.insert_one(notif)
    
    # Log ping
    await db.ticket_pings.insert_one({
        "id": str(uuid.uuid4()),
        "ticket_id": ticket.get("id", ""),
        "ticket_number": ticket_number,
        "ping_type": ping_type,
        "user_ids": user_ids,
        "message": message,
        "created_at": now,
    })

async def get_team_for_ticket(ticket: dict) -> list:
    """Determine which team members should be pinged for a ticket"""
    settings = await db.settings.find_one({"type": "ticket_ping"}, {"_id": 0})
    if not settings:
        return []
    
    user_ids = set()
    category = ticket.get("category", "")
    priority = ticket.get("priority", "medium")
    
    # Check category mapping
    category_teams = settings.get("category_teams", {})
    if category and category in category_teams:
        user_ids.update(category_teams[category])
    
    # Check SLA/priority mapping
    sla_teams = settings.get("sla_teams", {})
    if priority in sla_teams:
        user_ids.update(sla_teams[priority])
    
    # If no specific team found, ping all active technicians
    if not user_ids:
        users = await db.users.find({"is_active": True, "role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1}).to_list(50)
        user_ids.update(u["id"] for u in users)
    
    return list(user_ids)

@router.post("/tickets/trigger-ping/{ticket_id}")
async def manually_trigger_ping(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Manually trigger a ping for a specific ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    team = await get_team_for_ticket(ticket)
    if team:
        await send_ping_notification(team, ticket, "reminder")
    
    return {"message": f"Ping sent to {len(team)} team members", "pinged": len(team)}

@router.get("/tickets/{ticket_id}/ping-history")
async def get_ticket_ping_history(ticket_id: str, current_user: dict = Depends(get_current_user)):
    pings = await db.ticket_pings.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return pings

@router.post("/tickets/{ticket_id}/pick-up")
async def pick_up_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """A technician picks up (claims) an unassigned ticket"""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    
    if ticket.get("assigned_to") and ticket["assigned_to"] != current_user["id"]:
        raise HTTPException(status_code=400, detail="Ticket already assigned to another technician")
    
    await db.tickets.update_one({"id": ticket_id}, {"$set": {
        "assigned_to": current_user["id"],
        "assigned_name": current_user["name"],
        "status": "in_progress" if ticket.get("status") == "open" else ticket.get("status"),
        "picked_up_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    
    return {"message": f"Ticket picked up by {current_user['name']}"}

# ============== BACKGROUND PING CHECKER ==============

async def check_unassigned_tickets():
    """Background task: check for unassigned tickets and send pings / escalations"""
    settings = await db.settings.find_one({"type": "ticket_ping"}, {"_id": 0})
    if not settings or not settings.get("enabled", True):
        return {"checked": 0, "pinged": 0, "escalated": 0}
    
    ping_interval = settings.get("ping_interval_minutes", 30)
    escalation_hours = settings.get("escalation_timeout_hours", 24)
    
    now = datetime.now(timezone.utc)
    cutoff_ping = (now - timedelta(minutes=ping_interval)).isoformat()
    cutoff_escalation = (now - timedelta(hours=escalation_hours)).isoformat()
    
    # Find unassigned open tickets
    unassigned = await db.tickets.find({
        "status": {"$in": ["open"]},
        "$or": [
            {"assigned_to": None},
            {"assigned_to": ""},
            {"assigned_to": {"$exists": False}},
        ]
    }, {"_id": 0}).to_list(200)
    
    pinged = 0
    escalated = 0
    
    for ticket in unassigned:
        ticket_id = ticket["id"]
        created_at = ticket.get("created_at", now.isoformat())
        
        # Check last ping for this ticket
        last_ping = await db.ticket_pings.find_one(
            {"ticket_id": ticket_id},
            {"_id": 0}
        )
        if last_ping:
            last_ping_list = await db.ticket_pings.find(
                {"ticket_id": ticket_id},
            ).sort("created_at", -1).to_list(1)
            last_ping = last_ping_list[0] if last_ping_list else None
        
        should_ping = True
        if last_ping:
            last_ping_time = last_ping.get("created_at", "")
            if last_ping_time > cutoff_ping:
                should_ping = False
        
        # Check if needs escalation (created > escalation_hours ago)
        if created_at < cutoff_escalation:
            # Check if already escalated
            existing_esc = await db.ticket_pings.find_one({"ticket_id": ticket_id, "ping_type": "escalation"}, {"_id": 0})
            if not existing_esc:
                escalation_contacts = settings.get("escalation_contacts", [])
                if not escalation_contacts:
                    admins = await db.users.find({"$or": [{"role": "admin"}, {"is_admin": True}]}, {"_id": 0, "id": 1}).to_list(10)
                    escalation_contacts = [a["id"] for a in admins]
                
                if escalation_contacts:
                    await send_ping_notification(escalation_contacts, ticket, "escalation")
                    # Also update ticket priority
                    await db.tickets.update_one({"id": ticket_id}, {"$set": {
                        "priority": "critical" if ticket.get("priority") != "critical" else "critical",
                        "escalated": True,
                        "escalated_at": now.isoformat(),
                        "updated_at": now.isoformat(),
                    }})
                    escalated += 1
                    continue
        
        if should_ping:
            team = await get_team_for_ticket(ticket)
            if team:
                ping_type = "new_ticket" if not last_ping else "reminder"
                await send_ping_notification(team, ticket, ping_type)
                pinged += 1
    
    return {"checked": len(unassigned), "pinged": pinged, "escalated": escalated}

@router.post("/tickets/check-escalations")
async def run_escalation_check(current_user: dict = Depends(get_current_user)):
    """Manually trigger the escalation checker"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await check_unassigned_tickets()
    return result
