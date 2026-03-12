from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== ACHIEVEMENT BADGE SYSTEM ==============

ACHIEVEMENT_DEFINITIONS = [
    {"id": "first_ticket", "name": "First Resolve", "description": "Closed your first ticket", "icon": "trophy", "category": "tickets", "threshold": 1, "color": "#22c55e"},
    {"id": "ticket_10", "name": "Problem Solver", "description": "Closed 10 tickets", "icon": "target", "category": "tickets", "threshold": 10, "color": "#3b82f6"},
    {"id": "ticket_50", "name": "Resolution Machine", "description": "Closed 50 tickets", "icon": "zap", "category": "tickets", "threshold": 50, "color": "#8b5cf6"},
    {"id": "ticket_100", "name": "Century Club", "description": "Closed 100 tickets", "icon": "award", "category": "tickets", "threshold": 100, "color": "#f59e0b"},
    {"id": "ticket_500", "name": "Legend", "description": "Closed 500 tickets", "icon": "crown", "category": "tickets", "threshold": 500, "color": "#ef4444"},
    {"id": "ticket_1000", "name": "Ticket Titan", "description": "Closed 1,000 tickets", "icon": "gem", "category": "tickets", "threshold": 1000, "color": "#ec4899"},
    {"id": "first_invoice", "name": "Revenue Starter", "description": "Created your first invoice", "icon": "dollar-sign", "category": "invoices", "threshold": 1, "color": "#22c55e"},
    {"id": "invoice_25", "name": "Billing Pro", "description": "Created 25 invoices", "icon": "credit-card", "category": "invoices", "threshold": 25, "color": "#3b82f6"},
    {"id": "invoice_100", "name": "Finance Wizard", "description": "Created 100 invoices", "icon": "banknote", "category": "invoices", "threshold": 100, "color": "#f59e0b"},
    {"id": "remote_10", "name": "Remote Rookie", "description": "Completed 10 remote sessions", "icon": "monitor", "category": "remote", "threshold": 10, "color": "#06b6d4"},
    {"id": "remote_100", "name": "Remote Hero", "description": "Completed 100 remote sessions", "icon": "wifi", "category": "remote", "threshold": 100, "color": "#8b5cf6"},
    {"id": "tenure_1yr", "name": "Year One", "description": "1 year with the company", "icon": "calendar", "category": "tenure", "threshold": 365, "color": "#22c55e"},
    {"id": "tenure_3yr", "name": "Veteran", "description": "3 years with the company", "icon": "shield", "category": "tenure", "threshold": 1095, "color": "#3b82f6"},
    {"id": "tenure_5yr", "name": "Half Decade", "description": "5 years with the company", "icon": "star", "category": "tenure", "threshold": 1825, "color": "#f59e0b"},
    {"id": "tenure_10yr", "name": "Decade Hero", "description": "10 years with the company", "icon": "crown", "category": "tenure", "threshold": 3650, "color": "#ef4444"},
    {"id": "birthday", "name": "Birthday Star", "description": "It's your birthday!", "icon": "cake", "category": "celebration", "threshold": 0, "color": "#ec4899"},
    {"id": "speed_demon", "name": "Speed Demon", "description": "Average ticket resolution under 2 hours", "icon": "rocket", "category": "special", "threshold": 0, "color": "#f97316"},
    {"id": "multitasker", "name": "Multitasker", "description": "Worked on 5+ tickets in a single day", "icon": "layers", "category": "special", "threshold": 5, "color": "#14b8a6"},
]

@router.get("/achievements")
async def get_achievement_definitions(current_user: dict = Depends(get_current_user)):
    """Get all achievement badge definitions"""
    custom = await db.achievement_definitions.find({}, {"_id": 0}).to_list(200)
    return ACHIEVEMENT_DEFINITIONS + custom

@router.post("/achievements/custom")
async def create_custom_achievement(data: dict, current_user: dict = Depends(get_current_user)):
    """Admin creates a custom achievement badge"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    ach = {
        "id": f"custom_{str(uuid.uuid4())[:8]}",
        "name": data.get("name", "Custom Badge"),
        "description": data.get("description", ""),
        "icon": data.get("icon", "award"),
        "category": "custom",
        "threshold": 0,
        "color": data.get("color", "#8b5cf6"),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.achievement_definitions.insert_one({**ach})
    return ach

@router.get("/technicians/{tech_id}/achievements")
async def get_technician_achievements(tech_id: str, current_user: dict = Depends(get_current_user)):
    """Get all achievements earned by a technician"""
    earned = await db.user_achievements.find({"user_id": tech_id}, {"_id": 0}).to_list(500)
    return earned

@router.post("/technicians/{tech_id}/achievements/award")
async def award_achievement(tech_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Admin awards a badge to a technician"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    user = await db.users.find_one({"id": tech_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    achievement_id = data.get("achievement_id")
    existing = await db.user_achievements.find_one({"user_id": tech_id, "achievement_id": achievement_id})
    if existing:
        return {"message": "Already earned", "already_earned": True}
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": tech_id,
        "user_name": user.get("name"),
        "achievement_id": achievement_id,
        "achievement_name": data.get("achievement_name", achievement_id),
        "awarded_by": current_user.get("name", "System"),
        "awarded_at": datetime.now(timezone.utc).isoformat(),
        "note": data.get("note", ""),
    }
    await db.user_achievements.insert_one(entry)
    # Remove MongoDB _id before returning
    entry.pop("_id", None)
    return {"message": "Achievement awarded", "achievement": entry}

@router.post("/technicians/{tech_id}/achievements/check")
async def check_achievements(tech_id: str, current_user: dict = Depends(get_current_user)):
    """Auto-check and award milestone achievements for a technician"""
    user = await db.users.find_one({"id": tech_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    
    earned = await db.user_achievements.find({"user_id": tech_id}, {"_id": 0}).to_list(500)
    earned_ids = {e["achievement_id"] for e in earned}
    newly_awarded = []
    
    # Count ticket closures
    closed_tickets = await db.tickets.count_documents({"assigned_to": tech_id, "status": {"$in": ["closed", "resolved"]}})
    for ach in ACHIEVEMENT_DEFINITIONS:
        if ach["category"] == "tickets" and ach["id"] not in earned_ids and closed_tickets >= ach["threshold"]:
            entry = {"id": str(uuid.uuid4()), "user_id": tech_id, "user_name": user.get("name"), "achievement_id": ach["id"], "achievement_name": ach["name"], "awarded_by": "System", "awarded_at": datetime.now(timezone.utc).isoformat(), "note": f"Auto-awarded: {closed_tickets} tickets closed"}
            await db.user_achievements.insert_one(entry)
            newly_awarded.append(ach["name"])
    
    # Count invoices
    invoices_created = await db.activity_logs.count_documents({"user_id": tech_id, "entity_type": "invoice", "action": "created"})
    for ach in ACHIEVEMENT_DEFINITIONS:
        if ach["category"] == "invoices" and ach["id"] not in earned_ids and invoices_created >= ach["threshold"]:
            entry = {"id": str(uuid.uuid4()), "user_id": tech_id, "user_name": user.get("name"), "achievement_id": ach["id"], "achievement_name": ach["name"], "awarded_by": "System", "awarded_at": datetime.now(timezone.utc).isoformat(), "note": f"Auto-awarded: {invoices_created} invoices created"}
            await db.user_achievements.insert_one(entry)
            newly_awarded.append(ach["name"])
    
    # Count remote sessions
    remote_count = await db.remote_sessions.count_documents({"user_id": tech_id, "status": "ended"})
    for ach in ACHIEVEMENT_DEFINITIONS:
        if ach["category"] == "remote" and ach["id"] not in earned_ids and remote_count >= ach["threshold"]:
            entry = {"id": str(uuid.uuid4()), "user_id": tech_id, "user_name": user.get("name"), "achievement_id": ach["id"], "achievement_name": ach["name"], "awarded_by": "System", "awarded_at": datetime.now(timezone.utc).isoformat(), "note": f"Auto-awarded: {remote_count} remote sessions"}
            await db.user_achievements.insert_one(entry)
            newly_awarded.append(ach["name"])
    
    # Check tenure
    hire_date = user.get("hire_date")
    if hire_date:
        try:
            hd = datetime.fromisoformat(hire_date)
            days_employed = (datetime.now(timezone.utc) - hd).days
            for ach in ACHIEVEMENT_DEFINITIONS:
                if ach["category"] == "tenure" and ach["id"] not in earned_ids and days_employed >= ach["threshold"]:
                    entry = {"id": str(uuid.uuid4()), "user_id": tech_id, "user_name": user.get("name"), "achievement_id": ach["id"], "achievement_name": ach["name"], "awarded_by": "System", "awarded_at": datetime.now(timezone.utc).isoformat(), "note": f"Auto-awarded: {days_employed} days employed"}
                    await db.user_achievements.insert_one(entry)
                    newly_awarded.append(ach["name"])
        except:
            pass
    
    # Check birthday
    birthday = user.get("birthday")
    if birthday and "birthday" not in earned_ids:
        try:
            today = datetime.now(timezone.utc)
            bd = datetime.fromisoformat(birthday)
            if bd.month == today.month and bd.day == today.day:
                entry = {"id": str(uuid.uuid4()), "user_id": tech_id, "user_name": user.get("name"), "achievement_id": "birthday", "achievement_name": "Birthday Star", "awarded_by": "System", "awarded_at": datetime.now(timezone.utc).isoformat(), "note": "Happy Birthday!"}
                await db.user_achievements.insert_one(entry)
                newly_awarded.append("Birthday Star")
        except:
            pass
    
    return {"newly_awarded": newly_awarded, "total_earned": len(earned_ids) + len(newly_awarded)}

@router.delete("/technicians/{tech_id}/achievements/{achievement_id}")
async def revoke_achievement(tech_id: str, achievement_id: str, current_user: dict = Depends(get_current_user)):
    """Admin revokes a badge"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    result = await db.user_achievements.delete_one({"user_id": tech_id, "achievement_id": achievement_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Achievement not found")
    return {"message": "Achievement revoked"}

