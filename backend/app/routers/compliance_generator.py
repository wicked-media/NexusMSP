from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/compliance-generator/frameworks")
async def get_frameworks(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "fw-hipaa", "name": "HIPAA", "controls": 45, "description": "Health Insurance Portability and Accountability Act"},
        {"id": "fw-soc2", "name": "SOC 2 Type II", "controls": 64, "description": "Service Organization Control 2"},
        {"id": "fw-cis", "name": "CIS Controls v8", "controls": 153, "description": "Center for Internet Security Controls"},
        {"id": "fw-essential8", "name": "Essential Eight", "controls": 8, "description": "Australian Signals Directorate Essential Eight"},
        {"id": "fw-nist", "name": "NIST CSF 2.0", "controls": 106, "description": "National Institute of Standards Cybersecurity Framework"},
    ]

@router.get("/compliance-generator/reports")
async def get_compliance_reports(current_user: dict = Depends(get_current_user)):
    reports = await db.compliance_generated_reports.find({}, {"_id": 0}).sort("generated_at", -1).to_list(50)
    if not reports:
        now = datetime.now(timezone.utc)
        reports = [
            {"id": "cr-001", "client_name": "Global Finance Ltd", "framework": "SOC 2 Type II", "score": 87, "controls_passed": 56, "controls_total": 64, "generated_at": (now - timedelta(days=7)).isoformat(), "generated_by": "Alex Thompson", "status": "completed"},
            {"id": "cr-002", "client_name": "HealthCare Plus", "framework": "HIPAA", "score": 72, "controls_passed": 32, "controls_total": 45, "generated_at": (now - timedelta(days=14)).isoformat(), "generated_by": "Sarah Chen", "status": "completed"},
            {"id": "cr-003", "client_name": "Acme Corporation", "framework": "CIS Controls v8", "score": 81, "controls_passed": 124, "controls_total": 153, "generated_at": (now - timedelta(days=3)).isoformat(), "generated_by": "Alex Thompson", "status": "completed"},
        ]
        for r in reports:
            await db.compliance_generated_reports.insert_one(r)
        reports = [dict((k, v) for k, v in r.items() if k != "_id") for r in reports]
    return reports

@router.post("/compliance-generator/generate")
async def generate_report(data: dict, current_user: dict = Depends(get_current_user)):
    report = {"id": f"cr-{uuid.uuid4().hex[:8]}", "client_name": data.get("client_name"), "framework": data.get("framework"), "score": random.randint(65, 95), "controls_passed": random.randint(30, 60), "controls_total": random.randint(45, 153), "generated_at": datetime.now(timezone.utc).isoformat(), "generated_by": current_user.get("name"), "status": "completed"}
    await db.compliance_generated_reports.insert_one(report)
    report.pop("_id", None)
    return report
