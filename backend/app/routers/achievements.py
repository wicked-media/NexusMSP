from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit
from app.services.achievement_catalog import ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_POINTS
from app.services.tech_rewards import award_points
from app.services.scope_permissions import platform_tenant_id
from app.models import *

router = APIRouter()

# ============== ACHIEVEMENT BADGE SYSTEM ==============

# Badge definitions and category points live in app.services.achievement_catalog
# (single source of truth shared with the technician profile surface).

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
    # Hook the achievement into the points economy so techs can save for pets/skins.
    definition = next((a for a in ACHIEVEMENT_DEFINITIONS if a["id"] == achievement_id), None)
    points = int(data.get("points") or ACHIEVEMENT_POINTS.get((definition or {}).get("category", "custom"), 75))
    ledger_entry = await award_points(
        db,
        user_id=tech_id,
        tenant_id=platform_tenant_id(current_user),
        delta=points,
        kind="earn",
        reason=f"Achievement unlocked: {entry['achievement_name']}",
        actor=current_user,
        reference_id=f"achievement:{achievement_id}",
    )
    return {"message": "Achievement awarded", "achievement": entry, "points_awarded": points, "points_balance": ledger_entry["balance_after"]}

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
    
    # Milestone categories driven by their own accountable evidence.
    milestone_metrics = [
        ("workshop", await db.workshop_jobs.count_documents({"assigned_to": tech_id, "repair_status": "collected"}), "workshop jobs completed"),
        ("field", await db.field_jobs.count_documents({"assigned_to": tech_id, "field_status": "completed"}), "field jobs completed"),
        ("onboarding", await db.onboarding_checklist_runs.count_documents({"technician_id": tech_id, "status": "completed"}), "onboarding checklists completed"),
    ]
    points_ledger = await db.tech_points_ledger.find({"user_id": tech_id}, {"_id": 0}).to_list(5000)
    lifetime_points = sum(int(e.get("delta") or 0) for e in points_ledger if int(e.get("delta") or 0) > 0)
    milestone_metrics.append(("points", lifetime_points, "lifetime points earned"))
    for category, metric, label in milestone_metrics:
        for ach in ACHIEVEMENT_DEFINITIONS:
            if ach["category"] == category and ach["id"] not in earned_ids and metric >= ach["threshold"] > 0:
                entry = {"id": str(uuid.uuid4()), "user_id": tech_id, "user_name": user.get("name"), "achievement_id": ach["id"], "achievement_name": ach["name"], "awarded_by": "System", "awarded_at": datetime.now(timezone.utc).isoformat(), "note": f"Auto-awarded: {metric} {label}"}
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
    
    points_earned = 0
    if newly_awarded:
        ledger_entry = await award_points(
            db,
            user_id=tech_id,
            tenant_id=platform_tenant_id(current_user),
            delta=len(newly_awarded) * 75,
            kind="earn",
            reason=f"Achievements unlocked: {', '.join(newly_awarded[:5])}",
            actor=current_user,
            reference_id=f"achievements-check:{tech_id}:{len(earned_ids) + len(newly_awarded)}",
        )
        points_earned = ledger_entry["delta"]
    return {"newly_awarded": newly_awarded, "total_earned": len(earned_ids) + len(newly_awarded), "points_earned": points_earned}

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

