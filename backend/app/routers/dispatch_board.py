from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity, ticket_audit

router = APIRouter()


@router.get("/dispatch/board")
async def get_dispatch_board(current_user: dict = Depends(get_current_user)):
    """Return live dispatch lanes, capacity, and transparent assignment suggestions."""
    jobs_raw = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "on_hold"]}},
        {
            "_id": 0, "id": 1, "title": 1, "description": 1, "status": 1, "priority": 1,
            "client_name": 1, "client_id": 1, "assigned_to": 1, "assigned_to_name": 1,
            "assigned_name": 1, "ticket_number": 1, "ticket_type": 1, "created_at": 1,
            "updated_at": 1, "category": 1,
        },
    ).sort("created_at", 1).to_list(100)

    jobs = []
    for job in jobs_raw:
        job["title"] = job.get("title") or job.get("description", "Untitled")[:80]
        job["priority"] = job.get("priority", "medium")
        job["client_name"] = job.get("client_name", "")
        job["assigned_name"] = job.get("assigned_to_name") or job.get("assigned_name") or ""
        jobs.append(job)

    today = datetime.now(timezone.utc).date().isoformat()
    techs = await db.users.find(
        {"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(100)
    tech_data = []
    for tech in techs:
        active = await db.tickets.count_documents({"assigned_to": tech["id"], "status": "in_progress"})
        open_count = await db.tickets.count_documents({"assigned_to": tech["id"], "status": {"$in": ["open", "in_progress", "on_hold"]}})
        scheduled_today = await db.schedules.count_documents({
            "user_id": tech["id"], "date": today,
            "event_type": {"$in": ["appointment", "pto", "blocked", "on_call"]},
        })
        skills = await db.tech_skills.find_one({"user_id": tech["id"]}, {"_id": 0, "skills": 1})
        load = open_count + scheduled_today
        tech_data.append({
            "id": tech["id"], "name": tech["name"], "active_jobs": active,
            "total_open": open_count, "current_tickets": open_count,
            "scheduled_today": scheduled_today, "available": load < 5,
            "status": "busy" if load >= 5 else "active" if load > 0 else "available",
            "skills": (skills or {}).get("skills", {}), "capacity": max(0, 5 - load),
        })

    unassigned = [job for job in jobs if not job.get("assigned_to")]
    dispatched = [job for job in jobs if job.get("assigned_to")]
    suggestions = []
    for job in unassigned[:20]:
        category = job.get("category", "general")
        candidates = [tech for tech in tech_data if tech["status"] != "busy"]
        candidates.sort(key=lambda tech: (-tech.get("skills", {}).get(category, 0), tech["total_open"], tech["scheduled_today"]))
        best = candidates[0] if candidates else None
        suggestions.append({
            "job_id": job["id"], "job_title": job["title"],
            "suggested_tech_id": best["id"] if best else None,
            "suggested_tech_name": best["name"] if best else "No available technician",
            "reason": f"Best skill match for {category}; {best['capacity']} capacity remaining" if best else "All technicians are at capacity",
        })

    return {
        "jobs": jobs, "unassigned": unassigned, "dispatched": dispatched,
        "technicians": tech_data, "suggestions": suggestions,
        "stats": {
            "total_jobs": len(jobs), "unassigned": len(unassigned),
            "available_techs": len([tech for tech in tech_data if tech["available"]]),
        },
    }


@router.post("/dispatch/assign")
async def dispatch_assign(data: dict, current_user: dict = Depends(get_current_user)):
    """Assign or reassign a live ticket and preserve its operational history."""
    ticket_id = (data.get("ticket_id") or "").strip()
    tech_id = (data.get("tech_id") or "").strip()
    if not ticket_id or not tech_id:
        raise HTTPException(status_code=400, detail="A ticket and technician are required")

    ticket = await db.tickets.find_one(
        {"id": ticket_id}, {"_id": 0, "id": 1, "title": 1, "ticket_number": 1, "assigned_to": 1, "assigned_to_name": 1},
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    tech = await db.users.find_one(
        {"id": tech_id, "role": {"$in": ["technician", "admin"]}}, {"_id": 0, "name": 1},
    )
    if not tech:
        raise HTTPException(status_code=404, detail="Technician not found")

    now = datetime.now(timezone.utc).isoformat()
    prior_name = ticket.get("assigned_to_name") or "Unassigned"
    action = "ticket_reassigned" if ticket.get("assigned_to") else "ticket_dispatched"
    details = f"Assigned to {tech.get('name', '')} from {prior_name}."
    await db.tickets.update_one({"id": ticket_id}, {"$set": {
        "assigned_to": tech_id, "assigned_to_name": tech.get("name", ""),
        "assigned_name": tech.get("name", ""), "dispatched_at": now,
        "dispatched_by": current_user.get("name", ""), "updated_at": now,
    }})
    await ticket_audit(ticket_id, current_user, action, details)
    await log_activity(
        current_user, action, "ticket", ticket_id,
        ticket.get("ticket_number") or ticket.get("title") or ticket_id,
        details, metadata={"technician_id": tech_id, "technician_name": tech.get("name", "")},
    )
    return {"message": f"Assigned to {tech.get('name', '')}", "ticket_id": ticket_id, "technician": tech}
