from fastapi import APIRouter, Depends
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone

router = APIRouter(prefix="/tech-utilization", tags=["Technician Utilization"])

@router.get("/dashboard")
async def get_utilization_dashboard(user=Depends(get_current_user)):
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0}).to_list(20)
    time_entries = await db.time_entries.find({}, {"_id": 0}).to_list(5000)
    
    results = []
    for tech in techs:
        tech_entries = [e for e in time_entries if e.get("user_id") == tech["id"]]
        total_minutes = sum(e.get("minutes", 0) for e in tech_entries)
        billable_minutes = sum(e.get("minutes", 0) for e in tech_entries if e.get("billable"))
        non_billable_minutes = total_minutes - billable_minutes
        total_revenue = sum(e.get("total_amount", 0) for e in tech_entries if e.get("billable"))
        
        # Assume 8h workday, 20 days/month = 9600 min/month available
        available_minutes = 9600
        utilization = round((billable_minutes / available_minutes) * 100, 1) if available_minutes > 0 else 0
        
        active_tickets = await db.tickets.count_documents({"assigned_to": tech["id"], "status": {"$in": ["open", "in_progress"]}})
        resolved_tickets = await db.tickets.count_documents({"assigned_to": tech["id"], "status": {"$in": ["resolved", "closed"]}})
        
        results.append({
            "user_id": tech["id"], "name": tech.get("name", ""),
            "job_title": tech.get("job_title", ""), "hourly_rate": tech.get("hourly_rate", 0),
            "total_hours": round(total_minutes / 60, 1),
            "billable_hours": round(billable_minutes / 60, 1),
            "non_billable_hours": round(non_billable_minutes / 60, 1),
            "utilization_pct": utilization,
            "revenue_generated": round(total_revenue, 2),
            "active_tickets": active_tickets,
            "resolved_tickets": resolved_tickets,
            "entries_count": len(tech_entries),
        })
    
    total_billable = sum(r["billable_hours"] for r in results)
    total_hours = sum(r["total_hours"] for r in results)
    total_revenue = sum(r["revenue_generated"] for r in results)
    
    return {
        "summary": {
            "total_techs": len(results),
            "total_hours_logged": round(total_hours, 1),
            "total_billable_hours": round(total_billable, 1),
            "avg_utilization": round(sum(r["utilization_pct"] for r in results) / max(len(results), 1), 1),
            "total_revenue": round(total_revenue, 2),
        },
        "technicians": sorted(results, key=lambda x: x["utilization_pct"], reverse=True),
    }
