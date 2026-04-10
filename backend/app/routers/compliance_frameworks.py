from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/compliance-frameworks/overview")
async def frameworks_overview(current_user: dict = Depends(get_current_user)):
    frameworks = await db.compliance_frameworks.find({}, {"_id": 0}).to_list(50)
    if not frameworks:
        frameworks = await _seed_frameworks()
    return {"frameworks": frameworks, "summary": {"total_frameworks": len(frameworks), "avg_compliance_pct": round(sum(f.get("compliance_pct", 0) for f in frameworks) / max(len(frameworks), 1), 1), "total_controls": sum(f.get("total_controls", 0) for f in frameworks), "controls_met": sum(f.get("controls_met", 0) for f in frameworks)}}

@router.get("/compliance-frameworks/{framework_id}")
async def get_framework_detail(framework_id: str, current_user: dict = Depends(get_current_user)):
    fw = await db.compliance_frameworks.find_one({"id": framework_id}, {"_id": 0})
    if not fw:
        return {"error": "Not found"}
    return fw

async def _seed_frameworks():
    fws = [
        {"name": "NIST 800-171", "controls": [("AC - Access Control", 22, 18), ("AU - Audit", 9, 7), ("CM - Config Mgmt", 9, 6), ("IA - Identification", 11, 9), ("IR - Incident Response", 3, 3), ("MA - Maintenance", 6, 4), ("MP - Media Protection", 9, 7), ("PE - Physical", 6, 5), ("PS - Personnel", 2, 2), ("RA - Risk Assessment", 3, 2), ("SC - System Comms", 16, 11), ("SI - System Integrity", 7, 5)]},
        {"name": "CIS Controls v8", "controls": [("Inventory & Control of Enterprise Assets", 5, 4), ("Inventory of Software Assets", 7, 5), ("Data Protection", 14, 10), ("Secure Config of Assets", 12, 8), ("Account Management", 6, 5), ("Access Control Management", 8, 6), ("Continuous Vulnerability Mgmt", 7, 5), ("Audit Log Management", 12, 9), ("Email & Browser Protections", 7, 5), ("Malware Defenses", 7, 6), ("Data Recovery", 5, 4), ("Network Infrastructure", 8, 5)]},
        {"name": "SOC 2 Type II", "controls": [("CC1 - Control Environment", 4, 4), ("CC2 - Communication", 3, 3), ("CC3 - Risk Assessment", 4, 3), ("CC5 - Control Activities", 3, 2), ("CC6 - Logical Access", 8, 6), ("CC7 - System Operations", 5, 4), ("CC8 - Change Management", 3, 2), ("CC9 - Risk Mitigation", 2, 2), ("A1 - Availability", 3, 2), ("C1 - Confidentiality", 2, 2), ("PI1 - Privacy", 8, 5)]},
        {"name": "HIPAA", "controls": [("Administrative Safeguards", 12, 9), ("Physical Safeguards", 4, 3), ("Technical Safeguards", 5, 4), ("Organizational Requirements", 4, 3), ("Breach Notification", 3, 3)]},
    ]
    frameworks = []
    for fw_data in fws:
        controls = []
        total_c = 0
        met_c = 0
        for cat_name, total, met in fw_data["controls"]:
            total_c += total
            met_c += met
            controls.append({"category": cat_name, "total": total, "met": met, "pct": round(met / total * 100, 1)})
        fw = {"id": f"cf-{uuid.uuid4().hex[:8]}", "name": fw_data["name"], "total_controls": total_c, "controls_met": met_c, "compliance_pct": round(met_c / total_c * 100, 1), "categories": controls, "last_assessed": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30))).isoformat(), "next_assessment": (datetime.now(timezone.utc) + timedelta(days=random.randint(30, 90))).isoformat(), "clients_applicable": random.randint(3, 12)}
        frameworks.append(fw)
        await db.compliance_frameworks.insert_one(fw)
    return [{k: v for k, v in f.items() if k != "_id"} for f in frameworks]
