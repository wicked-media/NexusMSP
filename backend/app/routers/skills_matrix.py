from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/skills-matrix")
async def get_skills_matrix(current_user: dict = Depends(get_current_user)):
    """Get skills matrix for all technicians."""
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    results = []
    all_skills = set()

    for t in techs:
        skills_doc = await db.tech_skills.find_one({"user_id": t["id"]}, {"_id": 0})
        skills = (skills_doc or {}).get("skills", {})
        certs = (skills_doc or {}).get("certifications", [])
        all_skills.update(skills.keys())

        resolved = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["resolved", "closed"]}})
        results.append({
            "user_id": t["id"], "name": t["name"],
            "skills": skills, "certifications": certs,
            "total_resolved": resolved,
        })

    return {"technicians": results, "all_skills": sorted(all_skills) or ["networking", "server", "cloud", "security", "email", "hardware", "software", "voip"]}


@router.put("/skills-matrix/{user_id}")
async def update_skills(user_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a technician's skills."""
    await db.tech_skills.update_one({"user_id": user_id}, {"$set": {
        "user_id": user_id,
        "skills": data.get("skills", {}),
        "certifications": data.get("certifications", []),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Skills updated"}


@router.get("/skills-matrix/suggest/{ticket_id}")
async def suggest_tech_for_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Suggest the best tech for a ticket based on skills."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "category": 1, "priority": 1, "title": 1})
    if not ticket:
        return {"error": "Ticket not found"}

    cat = ticket.get("category", "general")
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    ranked = []
    for t in techs:
        skills_doc = await db.tech_skills.find_one({"user_id": t["id"]}, {"_id": 0, "skills": 1})
        skill_level = (skills_doc or {}).get("skills", {}).get(cat, 0)
        active = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        score = skill_level * 10 - active * 2
        ranked.append({"user_id": t["id"], "name": t["name"], "skill_level": skill_level, "active_tickets": active, "match_score": score})

    ranked.sort(key=lambda x: x["match_score"], reverse=True)
    return {"ticket": ticket, "suggestions": ranked}
