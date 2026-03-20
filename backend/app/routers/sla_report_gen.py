from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/sla-report-gen/reports")
async def get_sla_reports(current_user: dict = Depends(get_current_user)):
    reports = await db.sla_generated_reports.find({}, {"_id": 0}).sort("generated_at", -1).to_list(50)
    if not reports:
        reports = await _seed_reports()
    return reports

@router.post("/sla-report-gen/generate")
async def generate_sla_report(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    report = {"id": f"slar-{uuid.uuid4().hex[:8]}", "client_name": data.get("client_name"), "client_id": data.get("client_id"), "period": data.get("period", "last_month"), "metrics": {"uptime_pct": round(random.uniform(99.2, 99.99), 2), "avg_response_time_min": round(random.uniform(5, 25), 1), "avg_resolution_time_hours": round(random.uniform(2, 12), 1), "tickets_resolved": random.randint(15, 60), "sla_met_pct": round(random.uniform(90, 99), 1), "csat_avg": round(random.uniform(3.8, 5.0), 1)}, "generated_at": now.isoformat(), "generated_by": current_user.get("name"), "status": "completed"}
    await db.sla_generated_reports.insert_one(report)
    report.pop("_id", None)
    return report

async def _seed_reports():
    now = datetime.now(timezone.utc)
    reports = [
        {"id": "slar-001", "client_name": "Acme Corporation", "client_id": "client-001", "period": "January 2026", "metrics": {"uptime_pct": 99.87, "avg_response_time_min": 8.3, "avg_resolution_time_hours": 4.2, "tickets_resolved": 34, "sla_met_pct": 97.1, "csat_avg": 4.6}, "generated_at": (now - timedelta(days=20)).isoformat(), "generated_by": "Alex Thompson", "status": "completed"},
        {"id": "slar-002", "client_name": "Global Finance Ltd", "client_id": "client-003", "period": "January 2026", "metrics": {"uptime_pct": 99.99, "avg_response_time_min": 4.1, "avg_resolution_time_hours": 2.8, "tickets_resolved": 52, "sla_met_pct": 99.2, "csat_avg": 4.8}, "generated_at": (now - timedelta(days=18)).isoformat(), "generated_by": "Sarah Chen", "status": "completed"},
        {"id": "slar-003", "client_name": "HealthCare Plus", "client_id": "client-004", "period": "January 2026", "metrics": {"uptime_pct": 99.72, "avg_response_time_min": 12.5, "avg_resolution_time_hours": 6.1, "tickets_resolved": 28, "sla_met_pct": 92.9, "csat_avg": 4.1}, "generated_at": (now - timedelta(days=15)).isoformat(), "generated_by": "Alex Thompson", "status": "completed"},
    ]
    for r in reports:
        await db.sla_generated_reports.insert_one(r)
    return [dict((k, v) for k, v in r.items() if k != "_id") for r in reports]
