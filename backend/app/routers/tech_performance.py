from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/reports/technician-performance")
async def get_technician_performance(current_user: dict = Depends(get_current_user)):
    """Get performance metrics for all technicians"""
    users = await db.users.find({"role": {"$in": ["admin", "technician"]}}, {"_id": 0}).to_list(50)
    now = datetime.now(timezone.utc)
    cutoff_30 = (now - timedelta(days=30)).isoformat()

    results = []
    for u in users:
        uid = u["id"]
        total_assigned = await db.tickets.count_documents({"assigned_to": uid})
        resolved = await db.tickets.count_documents({"assigned_to": uid, "status": {"$in": ["resolved", "closed"]}})
        open_count = await db.tickets.count_documents({"assigned_to": uid, "status": {"$in": ["open", "in_progress"]}})
        recent = await db.tickets.count_documents({"assigned_to": uid, "created_at": {"$gte": cutoff_30}})

        # Time entries
        time_entries = await db.time_entries.find({"user_id": uid}, {"_id": 0}).to_list(500)
        total_minutes = sum(int(t.get("minutes", 0)) for t in time_entries)
        billable = sum(int(t.get("minutes", 0)) for t in time_entries if t.get("billable"))

        # Average resolution (estimated)
        resolution_rate = round((resolved / total_assigned * 100) if total_assigned > 0 else 0, 1)

        results.append({
            "user_id": uid,
            "user_name": u.get("name", ""),
            "role": u.get("role", ""),
            "total_assigned": total_assigned,
            "resolved": resolved,
            "open_tickets": open_count,
            "recent_30d": recent,
            "resolution_rate": resolution_rate,
            "total_hours": round(total_minutes / 60, 1),
            "billable_hours": round(billable / 60, 1),
            "utilization": round((billable / total_minutes * 100) if total_minutes > 0 else 0, 1),
        })

    results.sort(key=lambda x: x["resolution_rate"], reverse=True)
    return {"technicians": results}


@router.get("/reports/csat")
async def get_csat_report(current_user: dict = Depends(get_current_user)):
    """Get CSAT survey results"""
    surveys = await db.csat_surveys.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    if surveys:
        avg_score = round(sum(s.get("score", 0) for s in surveys) / len(surveys), 1)
        promoters = sum(1 for s in surveys if s.get("score", 0) >= 9)
        detractors = sum(1 for s in surveys if s.get("score", 0) <= 6)
        nps = round(((promoters - detractors) / len(surveys)) * 100) if surveys else 0
    else:
        avg_score = 0
        nps = 0

    return {
        "surveys": surveys[:50],
        "total_responses": len(surveys),
        "average_score": avg_score,
        "nps_score": nps,
    }


@router.post("/tickets/{ticket_id}/send-csat")
async def send_csat_survey(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Send CSAT survey for a resolved ticket"""
    import uuid
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Ticket not found")

    survey = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "ticket_number": ticket.get("ticket_number", ""),
        "client_id": ticket.get("client_id"),
        "client_name": ticket.get("client_name", ""),
        "assigned_to": ticket.get("assigned_to"),
        "assigned_to_name": ticket.get("assigned_to_name", ""),
        "status": "pending",
        "score": None,
        "feedback": None,
        "sent_at": datetime.now(timezone.utc).isoformat(),
        "responded_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.csat_surveys.insert_one(survey)
    survey.pop("_id", None)
    return survey


@router.post("/csat/{survey_id}/respond")
async def respond_to_survey(survey_id: str, data: dict):
    """Submit a CSAT response (public endpoint for clients)"""
    result = await db.csat_surveys.update_one(
        {"id": survey_id, "status": "pending"},
        {"$set": {
            "score": data.get("score", 0),
            "feedback": data.get("feedback", ""),
            "status": "completed",
            "responded_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    if result.matched_count == 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Survey not found or already completed")
    return {"message": "Thank you for your feedback!"}
