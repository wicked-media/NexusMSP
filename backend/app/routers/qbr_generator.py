from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random, uuid

router = APIRouter()

@router.get("/qbr-generator/list")
async def list_qbrs(current_user: dict = Depends(get_current_user)):
    qbrs = await db.qbr_reports.find({}, {"_id": 0}).sort("generated_at", -1).to_list(50)
    if not qbrs:
        qbrs = await _seed_qbrs()
    return qbrs

@router.post("/qbr-generator/generate")
async def generate_qbr(data: dict, current_user: dict = Depends(get_current_user)):
    client = data.get("client_name", "All Clients")
    qbr = {"id": f"qbr-{uuid.uuid4().hex[:8]}", "client_name": client, "quarter": data.get("quarter", "Q1 2025"), "status": "generating", "generated_at": datetime.now(timezone.utc).isoformat(), "generated_by": current_user.get("name")}
    await db.qbr_reports.insert_one(qbr)
    qbr.pop("_id", None)
    return qbr

async def _seed_qbrs():
    clients = ["TechStart Inc", "Global Finance Ltd", "HealthCare Plus", "NovaTech Research"]
    qbrs = []
    for c in clients:
        q = {"id": f"qbr-{uuid.uuid4().hex[:8]}", "client_name": c, "quarter": "Q4 2025", "status": "completed", "generated_at": (datetime.now(timezone.utc) - timedelta(days=15)).isoformat(), "generated_by": "AI System",
             "sections": {"executive_summary": f"Strong quarter for {c}. Security posture improved 12% with zero critical incidents.", "security_posture": {"score": random.randint(72, 95), "change": f"+{random.randint(3, 15)}%", "incidents": random.randint(0, 3), "patches_applied": random.randint(50, 200)},
                          "uptime": {"pct": round(random.uniform(99.5, 99.99), 2), "downtime_minutes": random.randint(5, 60)},
                          "tickets": {"opened": random.randint(15, 60), "resolved": random.randint(15, 58), "avg_resolution_hours": round(random.uniform(1, 6), 1), "sla_met_pct": round(random.uniform(92, 100), 1)},
                          "recommendations": [f"Upgrade {random.randint(2, 5)} aging workstations", "Enable MFA for remaining accounts", "Schedule DR test for next quarter", "Consider upgrading to managed backup tier 2"]}}
        qbrs.append(q)
        await db.qbr_reports.insert_one(q)
    return [{k: v for k, v in q.items() if k != "_id"} for q in qbrs]
