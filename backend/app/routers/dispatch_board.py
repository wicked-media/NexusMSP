from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/dispatch/board")
async def get_dispatch_board(current_user: dict = Depends(get_current_user)):
    """Intelligent dispatch board - all open jobs with tech locations and assignments."""
    # Open tickets/jobs needing dispatch
    jobs = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress"]}, "ticket_type": {"$in": ["field_job", "workshop", "sla", None]}},
        {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "client_name": 1, "client_id": 1,
         "assigned_to": 1, "assigned_to_name": 1, "ticket_type": 1, "created_at": 1, "category": 1}
    ).sort("created_at", 1).to_list(100)

    # Technicians with skills and load
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    tech_data = []
    for t in techs:
        active = await db.tickets.count_documents({"assigned_to": t["id"], "status": "in_progress"})
        total = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        skills = await db.tech_skills.find_one({"user_id": t["id"]}, {"_id": 0, "skills": 1})
        tech_data.append({
            "id": t["id"], "name": t["name"],
            "active_jobs": active, "total_open": total,
            "status": "busy" if active >= 3 else "active" if active > 0 else "available",
            "skills": (skills or {}).get("skills", {}),
            "capacity": max(0, 5 - total),
        })

    # Suggest assignments for unassigned jobs
    unassigned = [j for j in jobs if not j.get("assigned_to")]
    suggestions = []
    for job in unassigned[:10]:
        cat = job.get("category", "general")
        available = [t for t in tech_data if t["status"] != "busy"]
        available.sort(key=lambda t: (-t.get("skills", {}).get(cat, 0), t["total_open"]))
        best = available[0] if available else None
        suggestions.append({
            "job_id": job["id"], "job_title": job["title"],
            "suggested_tech_id": best["id"] if best else None,
            "suggested_tech_name": best["name"] if best else "No available tech",
            "reason": f"Best skill match for {cat}, {best['capacity']} capacity" if best else "All techs busy",
        })

    return {
        "jobs": jobs, "technicians": tech_data,
        "suggestions": suggestions,
        "stats": {
            "total_jobs": len(jobs), "unassigned": len(unassigned),
            "available_techs": len([t for t in tech_data if t["status"] == "available"]),
        },
    }


@router.post("/dispatch/assign")
async def dispatch_assign(data: dict, current_user: dict = Depends(get_current_user)):
    """Assign a job to a technician."""
    ticket_id = data.get("ticket_id")
    tech_id = data.get("tech_id")
    tech = await db.users.find_one({"id": tech_id}, {"_id": 0, "name": 1})
    if not tech:
        return {"error": "Technician not found"}
    await db.tickets.update_one({"id": ticket_id}, {"$set": {
        "assigned_to": tech_id, "assigned_to_name": tech.get("name", ""),
        "dispatched_at": datetime.now(timezone.utc).isoformat(),
        "dispatched_by": current_user.get("name", ""),
    }})
    return {"message": f"Assigned to {tech.get('name','')}"}
