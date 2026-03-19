from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# XP rewards
XP_REWARDS = {
    "ticket_resolved": 50, "ticket_closed": 30, "first_response": 20,
    "sla_met": 40, "critical_resolved": 100, "client_praise": 75,
    "fast_resolution": 60, "workshop_completed": 45, "field_job_completed": 55,
    "streak_bonus": 25, "daily_login": 5,
}

BADGES = [
    {"id": "first_responder", "name": "First Responder", "description": "Respond to 50+ tickets first", "icon": "zap", "threshold": 50, "metric": "first_responses", "color": "#f59e0b"},
    {"id": "speed_demon", "name": "Speed Demon", "description": "Resolve 20+ tickets under 30 min", "icon": "timer", "threshold": 20, "metric": "fast_resolutions", "color": "#ef4444"},
    {"id": "client_champion", "name": "Client Champion", "description": "Receive 10+ client praises", "icon": "heart", "threshold": 10, "metric": "client_praises", "color": "#ec4899"},
    {"id": "iron_streak", "name": "Iron Streak", "description": "7-day resolution streak", "icon": "flame", "threshold": 7, "metric": "current_streak", "color": "#f97316"},
    {"id": "centurion", "name": "Centurion", "description": "Resolve 100+ tickets", "icon": "shield", "threshold": 100, "metric": "tickets_resolved", "color": "#8b5cf6"},
    {"id": "night_owl", "name": "Night Owl", "description": "Resolve 10+ tickets after hours", "icon": "moon", "threshold": 10, "metric": "after_hours_resolutions", "color": "#6366f1"},
    {"id": "multi_tool", "name": "Multi-Tool", "description": "Handle all ticket types (SLA, Workshop, Field)", "icon": "wrench", "threshold": 3, "metric": "ticket_types_handled", "color": "#14b8a6"},
    {"id": "zero_reopen", "name": "Zero Reopen", "description": "50+ tickets without reopens", "icon": "check-circle", "threshold": 50, "metric": "no_reopen_streak", "color": "#22c55e"},
]

LEVELS = [
    {"level": 1, "title": "Rookie", "min_xp": 0},
    {"level": 2, "title": "Technician", "min_xp": 200},
    {"level": 3, "title": "Specialist", "min_xp": 500},
    {"level": 4, "title": "Expert", "min_xp": 1000},
    {"level": 5, "title": "Master", "min_xp": 2000},
    {"level": 6, "title": "Grandmaster", "min_xp": 5000},
    {"level": 7, "title": "Legend", "min_xp": 10000},
]


def get_level(xp):
    lvl = LEVELS[0]
    for lv in LEVELS:
        if xp >= lv["min_xp"]:
            lvl = lv
    next_lvl = None
    for lv in LEVELS:
        if lv["min_xp"] > xp:
            next_lvl = lv
            break
    return {**lvl, "next_level": next_lvl}


@router.get("/gamification/leaderboard")
async def get_leaderboard(current_user: dict = Depends(get_current_user)):
    """Get the full leaderboard with XP, levels, badges."""
    profiles = await db.gamification.find({}, {"_id": 0}).sort("total_xp", -1).to_list(100)
    for p in profiles:
        p["level_info"] = get_level(p.get("total_xp", 0))
        earned = []
        for b in BADGES:
            if p.get("metrics", {}).get(b["metric"], 0) >= b["threshold"]:
                earned.append(b)
        p["badges_earned"] = earned
    return profiles


@router.get("/gamification/profile/{user_id}")
async def get_tech_profile(user_id: str, current_user: dict = Depends(get_current_user)):
    """Get a technician's gamification profile."""
    profile = await db.gamification.find_one({"user_id": user_id}, {"_id": 0})
    if not profile:
        profile = {"user_id": user_id, "total_xp": 0, "metrics": {}, "xp_history": [], "activity_heatmap": {}}
    profile["level_info"] = get_level(profile.get("total_xp", 0))
    earned = []
    for b in BADGES:
        if profile.get("metrics", {}).get(b["metric"], 0) >= b["threshold"]:
            earned.append(b)
    profile["badges_earned"] = earned
    profile["all_badges"] = BADGES
    return profile


@router.get("/gamification/activity/{user_id}")
async def get_activity_heatmap(user_id: str, current_user: dict = Depends(get_current_user)):
    """Get activity heatmap data (GitHub-style contribution graph)."""
    profile = await db.gamification.find_one({"user_id": user_id}, {"_id": 0})
    heatmap = (profile or {}).get("activity_heatmap", {})
    # Fill last 365 days
    today = datetime.now(timezone.utc).date()
    result = {}
    for i in range(365):
        d = (today - timedelta(days=i)).isoformat()
        result[d] = heatmap.get(d, 0)
    return result


@router.post("/gamification/award-xp")
async def award_xp(data: dict, current_user: dict = Depends(get_current_user)):
    """Award XP to a technician."""
    user_id = data.get("user_id")
    action = data.get("action", "ticket_resolved")
    xp = XP_REWARDS.get(action, 10)
    custom_xp = data.get("xp")
    if custom_xp:
        xp = custom_xp
    reason = data.get("reason", action.replace("_", " ").title())

    today = datetime.now(timezone.utc).date().isoformat()
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1})

    await db.gamification.update_one(
        {"user_id": user_id},
        {
            "$inc": {"total_xp": xp, f"activity_heatmap.{today}": 1},
            "$set": {
                "user_name": (user or {}).get("name", "Unknown"),
                "last_active": datetime.now(timezone.utc).isoformat(),
            },
            "$push": {
                "xp_history": {
                    "$each": [{"action": action, "xp": xp, "reason": reason,
                              "awarded_at": datetime.now(timezone.utc).isoformat()}],
                    "$slice": -100  # Keep last 100
                }
            },
        },
        upsert=True,
    )
    # Update metrics
    metric_map = {
        "ticket_resolved": "tickets_resolved", "first_response": "first_responses",
        "fast_resolution": "fast_resolutions", "client_praise": "client_praises",
        "workshop_completed": "tickets_resolved", "field_job_completed": "tickets_resolved",
    }
    if action in metric_map:
        await db.gamification.update_one(
            {"user_id": user_id},
            {"$inc": {f"metrics.{metric_map[action]}": 1}}
        )

    profile = await db.gamification.find_one({"user_id": user_id}, {"_id": 0})
    return {"xp_awarded": xp, "total_xp": profile.get("total_xp", 0), "level_info": get_level(profile.get("total_xp", 0))}


@router.get("/gamification/stats")
async def get_gamification_stats(current_user: dict = Depends(get_current_user)):
    """Get overall gamification stats."""
    profiles = await db.gamification.find({}, {"_id": 0}).to_list(200)
    total_xp = sum(p.get("total_xp", 0) for p in profiles)
    top_tech = max(profiles, key=lambda x: x.get("total_xp", 0)) if profiles else None
    return {
        "total_techs": len(profiles),
        "total_xp_awarded": total_xp,
        "top_tech": top_tech.get("user_name", "N/A") if top_tech else "N/A",
        "top_xp": top_tech.get("total_xp", 0) if top_tech else 0,
        "badges_available": len(BADGES),
        "levels": LEVELS,
    }


@router.post("/gamification/recalculate/{user_id}")
async def recalculate_gamification(user_id: str, current_user: dict = Depends(get_current_user)):
    """Recalculate a tech's gamification from ticket history."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "name": 1})
    if not user:
        return {"error": "User not found"}

    resolved = await db.tickets.count_documents({"assigned_to": user_id, "status": {"$in": ["resolved", "closed"]}})
    ws_completed = await db.workshop_jobs.count_documents({"assigned_to": user_id, "repair_status": "collected"})
    fj_completed = await db.field_jobs.count_documents({"assigned_to": user_id, "field_status": "completed"})

    xp = resolved * 50 + ws_completed * 45 + fj_completed * 55
    types_handled = set()
    if resolved > 0:
        types_handled.add("sla")
    if ws_completed > 0:
        types_handled.add("workshop")
    if fj_completed > 0:
        types_handled.add("field")

    await db.gamification.update_one(
        {"user_id": user_id},
        {"$set": {
            "user_name": user.get("name", "Unknown"),
            "total_xp": xp,
            "metrics": {
                "tickets_resolved": resolved + ws_completed + fj_completed,
                "ticket_types_handled": len(types_handled),
            },
            "recalculated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {"recalculated": True, "total_xp": xp, "level_info": get_level(xp)}
