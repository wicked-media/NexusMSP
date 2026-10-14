from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.achievement_catalog import ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_POINTS
from app.services.achievement_engine import run_achievement_check
from app.services.tech_rewards import award_points
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

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
    return await run_achievement_check(
        db, user, tenant_id=platform_tenant_id(current_user), actor=current_user
    )


@router.post("/achievements/recompute")
async def recompute_all_achievements(current_user: dict = Depends(get_current_user)):
    """Retro-award sweep: run the badge engine across every team member.

    Idempotent — already-earned badges are never duplicated — so it is safe for
    schedulers and for the one-time backfill of historical work.
    """
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    users = await db.users.find(tenant_scoped_query(current_user, {}), {"_id": 0}).to_list(2000)
    tenant_id = platform_tenant_id(current_user)
    per_user = []
    totals = {"users_processed": len(users), "badges_awarded": 0, "points_earned": 0}
    for user in users:
        result = await run_achievement_check(db, user, tenant_id=tenant_id, actor=current_user)
        if result["newly_awarded"]:
            per_user.append({
                "user_id": user["id"],
                "name": user.get("name"),
                "newly_awarded": result["newly_awarded"],
                "points_earned": result["points_earned"],
            })
            totals["badges_awarded"] += len(result["newly_awarded"])
            totals["points_earned"] += result["points_earned"]
    await log_activity(
        current_user, "achievements.recomputed", "achievement", "recompute",
        details=f"Retro-awarded {totals['badges_awarded']} badges across {totals['users_processed']} users",
    )
    return {**totals, "users_with_new_awards": per_user}

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

