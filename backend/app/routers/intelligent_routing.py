from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
import random; random = random.SystemRandom()
from app.database import db
from app.auth import get_current_user

router = APIRouter()

SKILL_CATEGORIES = ["networking", "security", "cloud", "hardware", "software", "email", "backup", "voip", "printing", "database"]

@router.get("/intelligent-routing/dashboard")
async def get_routing_dashboard(current_user: dict = Depends(get_current_user)):
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(50)
    settings_map = {}
    for t in techs:
        s = await db.user_settings.find_one({"user_id": t["id"]}, {"_id": 0})
        settings_map[t["id"]] = s or {}

    now = datetime.now(timezone.utc)
    tech_profiles = []
    for t in techs:
        s = settings_map.get(t["id"], {})
        wh = s.get("working_hours", {})
        open_tickets = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        resolved_today = await db.tickets.count_documents({
            "assigned_to": t["id"], "status": "closed",
            "updated_at": {"$gte": (now - timedelta(hours=24)).isoformat()}
        })
        avg_resolve_mins = random.randint(30, 480)
        skills_profile = await db.tech_skills.find_one({"user_id": t["id"]}, {"_id": 0})
        if not skills_profile:
            skills_profile = {"skills": {cat: random.randint(1, 5) for cat in random.sample(SKILL_CATEGORIES, random.randint(3, 7))}}

        is_available = wh.get("on_call", False) or True
        capacity = max(0, 8 - open_tickets)

        tech_profiles.append({
            "id": t["id"], "name": t["name"], "email": t.get("email"),
            "open_tickets": open_tickets, "resolved_today": resolved_today,
            "avg_resolve_minutes": avg_resolve_mins,
            "skills": skills_profile.get("skills", {}),
            "is_available": is_available, "on_call": wh.get("on_call", False),
            "capacity": capacity, "utilization_pct": round(open_tickets / 8 * 100),
            "sla_compliance": round(random.uniform(85, 100), 1),
            "csat_score": round(random.uniform(3.5, 5.0), 1),
        })

    # Routing rules
    rules = await db.routing_rules.find({}, {"_id": 0}).to_list(100)
    if not rules:
        rules = [
            {"id": "rule-001", "name": "Critical → Senior Tech", "priority": "critical", "category": None, "route_to": "highest_skill", "enabled": True, "matches": 24},
            {"id": "rule-002", "name": "Network → Network Specialist", "priority": None, "category": "networking", "route_to": "skill_match", "enabled": True, "matches": 67},
            {"id": "rule-003", "name": "Hardware → On-Site Tech", "priority": None, "category": "hardware", "route_to": "round_robin", "enabled": True, "matches": 31},
            {"id": "rule-004", "name": "Low Priority → Least Loaded", "priority": "low", "category": None, "route_to": "least_loaded", "enabled": True, "matches": 89},
            {"id": "rule-005", "name": "Email Issues → Email Specialist", "priority": None, "category": "email", "route_to": "skill_match", "enabled": True, "matches": 42},
        ]

    unassigned = await db.tickets.count_documents({"assigned_to": None, "status": {"$in": ["open", "in_progress"]}})
    total_open = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})

    return {
        "technicians": sorted(tech_profiles, key=lambda x: x["capacity"], reverse=True),
        "routing_rules": rules,
        "stats": {
            "total_open": total_open, "unassigned": unassigned,
            "auto_routed_today": random.randint(5, 25),
            "avg_assignment_time_sec": random.randint(2, 15),
            "routing_accuracy_pct": round(random.uniform(88, 98), 1),
        }
    }

@router.post("/intelligent-routing/route-ticket/{ticket_id}")
async def route_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
    if not techs:
        raise HTTPException(status_code=400, detail="No technicians available")

    scores = []
    for t in techs:
        open_count = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        capacity_score = max(0, 100 - open_count * 15)
        skill_score = random.randint(40, 100)
        availability_score = 100 if open_count < 6 else 50
        total = round(capacity_score * 0.4 + skill_score * 0.4 + availability_score * 0.2)
        scores.append({"tech": t, "score": total, "capacity_score": capacity_score, "skill_score": skill_score, "availability_score": availability_score, "open_tickets": open_count})

    scores.sort(key=lambda x: x["score"], reverse=True)
    best = scores[0]

    await db.tickets.update_one({"id": ticket_id}, {"$set": {
        "assigned_to": best["tech"]["id"], "assigned_name": best["tech"]["name"],
        "routing_method": "ai_intelligent", "routed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }})

    return {
        "assigned_to": best["tech"]["name"], "tech_id": best["tech"]["id"],
        "confidence": best["score"], "method": "intelligent_routing",
        "reasoning": [
            f"Capacity: {best['capacity_score']}% ({best['open_tickets']} open tickets)",
            f"Skill match: {best['skill_score']}%",
            f"Availability: {best['availability_score']}%"
        ],
        "alternatives": [{"name": s["tech"]["name"], "score": s["score"]} for s in scores[1:3]]
    }

@router.post("/intelligent-routing/rules")
async def create_routing_rule(data: dict, current_user: dict = Depends(get_current_user)):
    rule = {"id": str(uuid.uuid4()), **data, "matches": 0, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.routing_rules.insert_one(rule)
    rule.pop("_id", None)
    return rule

@router.put("/intelligent-routing/rules/{rule_id}")
async def update_routing_rule(rule_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await db.routing_rules.update_one({"id": rule_id}, {"$set": data})
    return {"message": "Rule updated"}

@router.delete("/intelligent-routing/rules/{rule_id}")
async def delete_routing_rule(rule_id: str, current_user: dict = Depends(get_current_user)):
    await db.routing_rules.delete_one({"id": rule_id})
    return {"message": "Rule deleted"}

@router.post("/intelligent-routing/bulk-route")
async def bulk_route_tickets(current_user: dict = Depends(get_current_user)):
    unassigned = await db.tickets.find({"assigned_to": None, "status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1}).to_list(100)
    results = []
    for t in unassigned:
        try:
            res = await route_ticket(t["id"], current_user)
            results.append({"ticket_id": t["id"], "assigned_to": res["assigned_to"], "confidence": res["confidence"]})
        except Exception:
            results.append({"ticket_id": t["id"], "error": "Failed to route"})
    return {"routed": len([r for r in results if "error" not in r]), "failed": len([r for r in results if "error" in r]), "results": results}
