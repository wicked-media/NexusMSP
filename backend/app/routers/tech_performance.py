from fastapi import APIRouter, Depends, HTTPException
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
    """Retired: it scored a 1-5 CSAT scale as NPS and had no callers."""
    raise HTTPException(
        status_code=410,
        detail="CSAT reporting moved to GET /api/csat/dashboard (average, distribution, by_tech).",
    )
