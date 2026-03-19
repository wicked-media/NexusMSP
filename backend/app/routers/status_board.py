from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/status-board/{client_id}")
async def get_public_status_board(client_id: str):
    """Public endpoint - no auth required. Shows client's ticket status."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "email": 1, "id": 1})
    if not client:
        return {"error": "Client not found", "found": False}

    # Open tickets
    open_tickets = await db.tickets.find(
        {"client_id": client_id, "status": {"$in": ["open", "in_progress", "waiting_on_client"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1,
         "created_at": 1, "assigned_to_name": 1}
    ).sort("created_at", -1).to_list(50)

    # Recently resolved (last 30 days)
    resolved = await db.tickets.find(
        {"client_id": client_id, "status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "resolved_at": 1, "created_at": 1}
    ).sort("resolved_at", -1).to_list(10)

    # Active incidents (critical/high priority open)
    incidents = [t for t in open_tickets if t.get("priority") in ["critical", "high"]]

    # Upcoming work (field jobs)
    upcoming = await db.field_jobs.find(
        {"customer_name": client.get("name", ""), "field_status": {"$nin": ["completed", "cancelled"]}},
        {"_id": 0, "id": 1, "job_number": 1, "description": 1, "scheduled_date": 1,
         "scheduled_time": 1, "field_status": 1, "assigned_to_name": 1}
    ).sort("scheduled_date", 1).to_list(10)

    # Estimates awaiting approval
    estimates = await db.estimates.find(
        {"client_id": client_id, "status": {"$in": ["published", "sent"]}},
        {"_id": 0, "id": 1, "estimate_number": 1, "title": 1, "total": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(10)

    # Overall status
    overall = "operational"
    if len(incidents) > 0:
        overall = "degraded" if len(incidents) <= 2 else "major_outage"

    return {
        "found": True,
        "client_name": client.get("name", ""),
        "overall_status": overall,
        "open_tickets": open_tickets,
        "active_incidents": incidents,
        "recently_resolved": resolved,
        "upcoming_work": upcoming,
        "pending_estimates": estimates,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "stats": {
            "open_count": len(open_tickets),
            "incident_count": len(incidents),
            "resolved_count": len(resolved),
            "upcoming_count": len(upcoming),
        }
    }


@router.post("/status-board/{client_id}/approve-estimate/{estimate_id}")
async def approve_estimate_from_portal(client_id: str, estimate_id: str):
    """Public endpoint for clients to approve estimates."""
    est = await db.estimates.find_one({"id": estimate_id, "client_id": client_id}, {"_id": 0})
    if not est:
        return {"error": "Estimate not found"}
    if est.get("status") not in ["published", "sent"]:
        return {"error": "Estimate cannot be approved in its current state"}

    await db.estimates.update_one({"id": estimate_id}, {"$set": {
        "status": "approved",
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "approved_by_client": True,
    }})
    return {"message": "Estimate approved", "estimate_number": est.get("estimate_number")}
