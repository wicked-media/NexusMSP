from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/executive-reports/list")
async def list_reports(current_user: dict = Depends(get_current_user)):
    reports = await db.executive_reports.find({}, {"_id": 0}).sort("generated_at", -1).to_list(50)
    if not reports:
        reports = await _seed_reports()
    return reports

@router.post("/executive-reports/generate")
async def generate_report(data: dict, current_user: dict = Depends(get_current_user)):
    r = {"id": f"er-{uuid.uuid4().hex[:8]}", "client_name": data.get("client_name", "All Clients"), "report_type": data.get("report_type", "monthly"), "period": data.get("period", datetime.now(timezone.utc).strftime("%B %Y")), "status": "generating", "generated_at": datetime.now(timezone.utc).isoformat(), "generated_by": current_user.get("name")}
    await db.executive_reports.insert_one(r)
    r.pop("_id", None)
    return r

@router.get("/executive-reports/{report_id}")
async def get_report_detail(report_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.executive_reports.find_one({"id": report_id}, {"_id": 0})
    if not r:
        return {"error": "Not found"}
    return r

async def _seed_reports():
    clients = ["TechStart Inc", "Global Finance Ltd", "HealthCare Plus", "NovaTech Research"]
    reports = []
    for c in clients:
        r = {"id": f"er-{uuid.uuid4().hex[:8]}", "client_name": c, "report_type": "monthly", "period": (datetime.now(timezone.utc) - timedelta(days=15)).strftime("%B %Y"), "status": "completed", "generated_at": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(), "generated_by": "System",
             "sections": {
                 "security_score": random.randint(65, 95), "uptime_pct": round(random.uniform(99.5, 99.99), 2),
                 "tickets_opened": random.randint(5, 30), "tickets_resolved": random.randint(5, 28),
                 "avg_resolution_hours": round(random.uniform(1, 8), 1), "sla_compliance_pct": round(random.uniform(90, 100), 1),
                 "patch_compliance_pct": round(random.uniform(80, 100), 1), "devices_monitored": random.randint(10, 50),
                 "critical_incidents": random.randint(0, 3), "recommendations": ["Update firmware on all switches", "Enable MFA for remaining 3 users", "Schedule hardware refresh for 2 aging workstations"]}}
        reports.append(r)
        await db.executive_reports.insert_one(r)
    return [{k: v for k, v in r.items() if k != "_id"} for r in reports]
