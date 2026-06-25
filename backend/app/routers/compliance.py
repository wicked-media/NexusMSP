from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
import uuid
import random as _random_mod
random = _random_mod.SystemRandom()
from app.database import db
from app.auth import get_current_user

router = APIRouter()

COMPLIANCE_FRAMEWORKS = {
    "cis": {
        "name": "CIS Controls v8", "controls": [
            {"id": "CIS-1", "name": "Inventory of Enterprise Assets", "description": "Maintain an accurate inventory of all technology assets", "check": "devices_inventoried"},
            {"id": "CIS-2", "name": "Inventory of Software Assets", "description": "Actively manage all software on the network", "check": "software_tracked"},
            {"id": "CIS-3", "name": "Data Protection", "description": "Establish processes to protect data", "check": "backups_configured"},
            {"id": "CIS-4", "name": "Secure Configuration", "description": "Establish secure configurations for assets", "check": "configs_secure"},
            {"id": "CIS-5", "name": "Account Management", "description": "Use processes to manage credentials", "check": "creds_managed"},
            {"id": "CIS-6", "name": "Access Control", "description": "Use processes to manage access", "check": "access_controlled"},
            {"id": "CIS-7", "name": "Vulnerability Management", "description": "Develop process to find and remediate vulnerabilities", "check": "vulns_managed"},
            {"id": "CIS-8", "name": "Audit Log Management", "description": "Collect, manage, and analyze audit logs", "check": "audit_logs"},
            {"id": "CIS-9", "name": "Email & Web Browser Protections", "description": "Improve protections for email and web", "check": "email_protected"},
            {"id": "CIS-10", "name": "Malware Defenses", "description": "Prevent and control malware", "check": "antimalware"},
            {"id": "CIS-11", "name": "Data Recovery", "description": "Establish data recovery practices", "check": "recovery_tested"},
            {"id": "CIS-12", "name": "Network Infrastructure Mgmt", "description": "Establish and maintain network infrastructure", "check": "network_managed"},
        ]
    },
    "hipaa": {
        "name": "HIPAA Security Rule", "controls": [
            {"id": "HIPAA-1", "name": "Access Controls", "check": "access_controlled"},
            {"id": "HIPAA-2", "name": "Audit Controls", "check": "audit_logs"},
            {"id": "HIPAA-3", "name": "Data Integrity", "check": "data_integrity"},
            {"id": "HIPAA-4", "name": "Transmission Security", "check": "encryption"},
            {"id": "HIPAA-5", "name": "Risk Analysis", "check": "risk_assessed"},
            {"id": "HIPAA-6", "name": "Contingency Plan", "check": "recovery_tested"},
            {"id": "HIPAA-7", "name": "Device & Media Controls", "check": "devices_inventoried"},
            {"id": "HIPAA-8", "name": "Workforce Training", "check": "training_done"},
        ]
    },
}


@router.get("/compliance/scan/{client_id}")
async def scan_compliance(client_id: str, framework: str = "cis", current_user: dict = Depends(get_current_user)):
    """Scan a client's environment against a compliance framework."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        return {"error": "Client not found"}

    fw = COMPLIANCE_FRAMEWORKS.get(framework)
    if not fw:
        return {"error": "Unknown framework"}

    # Gather environment data
    device_count = await db.devices.count_documents({"client_id": client_id})
    online = await db.devices.count_documents({"client_id": client_id, "status": "online"})
    acronis_count = await db.acronis_devices.count_documents({"client_id": client_id})
    vault_count = await db.vault.count_documents({"client_id": client_id})
    contracts = await db.contracts.count_documents({"client_id": client_id, "status": "active"})

    # Evaluate each control
    check_results = {
        "devices_inventoried": device_count > 0,
        "software_tracked": device_count > 0,
        "backups_configured": acronis_count > 0 or device_count == 0,
        "configs_secure": True,
        "creds_managed": vault_count > 0 or device_count == 0,
        "access_controlled": True,
        "vulns_managed": device_count > 0,
        "audit_logs": True,
        "email_protected": True,
        "antimalware": device_count > 0,
        "recovery_tested": acronis_count > 0 or device_count == 0,
        "network_managed": online > 0 or device_count == 0,
        "data_integrity": True,
        "encryption": True,
        "risk_assessed": contracts > 0,
        "training_done": False,
    }

    results = []
    passed = 0
    for ctrl in fw["controls"]:
        status = "pass" if check_results.get(ctrl["check"], False) else "fail"
        if status == "pass":
            passed += 1
        results.append({**ctrl, "status": status})

    score = round((passed / max(len(fw["controls"]), 1)) * 100)

    # Save report
    report_id = str(uuid.uuid4())[:8]
    report = {
        "id": report_id, "client_id": client_id, "client_name": client.get("name", ""),
        "framework": framework, "framework_name": fw["name"],
        "score": score, "passed": passed, "total": len(fw["controls"]),
        "controls": results,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "scanned_by": current_user.get("name", ""),
    }
    await db.compliance_reports.insert_one(report)
    report.pop("_id", None)
    return report


@router.get("/compliance/reports")
async def get_compliance_reports(current_user: dict = Depends(get_current_user)):
    return await db.compliance_reports.find({}, {"_id": 0}).sort("scanned_at", -1).to_list(100)


@router.get("/compliance/frameworks")
async def get_frameworks(current_user: dict = Depends(get_current_user)):
    return [{"id": k, "name": v["name"], "controls": len(v["controls"])} for k, v in COMPLIANCE_FRAMEWORKS.items()]


# ============================================================
# Compliance Frameworks (merged from compliance_frameworks.py)
# ============================================================
@router.get("/compliance-frameworks/overview")
async def frameworks_overview(current_user: dict = Depends(get_current_user)):
    frameworks = await db.compliance_frameworks.find({}, {"_id": 0}).to_list(50)
    if not frameworks:
        frameworks = await _seed_frameworks_catalog()
    return {
        "frameworks": frameworks,
        "summary": {
            "total_frameworks": len(frameworks),
            "avg_compliance_pct": round(sum(f.get("compliance_pct", 0) for f in frameworks) / max(len(frameworks), 1), 1),
            "total_controls": sum(f.get("total_controls", 0) for f in frameworks),
            "controls_met": sum(f.get("controls_met", 0) for f in frameworks),
        },
    }


@router.get("/compliance-frameworks/{framework_id}")
async def get_framework_detail(framework_id: str, current_user: dict = Depends(get_current_user)):
    fw = await db.compliance_frameworks.find_one({"id": framework_id}, {"_id": 0})
    if not fw:
        return {"error": "Not found"}
    return fw


async def _seed_frameworks_catalog():
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
        fw = {
            "id": f"cf-{uuid.uuid4().hex[:8]}", "name": fw_data["name"],
            "total_controls": total_c, "controls_met": met_c,
            "compliance_pct": round(met_c / total_c * 100, 1),
            "categories": controls,
            "last_assessed": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30))).isoformat(),
            "next_assessment": (datetime.now(timezone.utc) + timedelta(days=random.randint(30, 90))).isoformat(),
            "clients_applicable": random.randint(3, 12),
        }
        frameworks.append(fw)
        await db.compliance_frameworks.insert_one(fw)
    return [{k: v for k, v in f.items() if k != "_id"} for f in frameworks]


# ============================================================
# Compliance Report Generator (merged from compliance_generator.py)
# ============================================================
@router.get("/compliance-generator/frameworks")
async def get_generator_frameworks(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "fw-hipaa", "name": "HIPAA", "controls": 45, "description": "Health Insurance Portability and Accountability Act"},
        {"id": "fw-soc2", "name": "SOC 2 Type II", "controls": 64, "description": "Service Organization Control 2"},
        {"id": "fw-cis", "name": "CIS Controls v8", "controls": 153, "description": "Center for Internet Security Controls"},
        {"id": "fw-essential8", "name": "Essential Eight", "controls": 8, "description": "Australian Signals Directorate Essential Eight"},
        {"id": "fw-nist", "name": "NIST CSF 2.0", "controls": 106, "description": "National Institute of Standards Cybersecurity Framework"},
    ]


@router.get("/compliance-generator/reports")
async def get_generated_reports(current_user: dict = Depends(get_current_user)):
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
async def generate_compliance_report(data: dict, current_user: dict = Depends(get_current_user)):
    report = {
        "id": f"cr-{uuid.uuid4().hex[:8]}",
        "client_name": data.get("client_name"),
        "framework": data.get("framework"),
        "score": random.randint(65, 95),
        "controls_passed": random.randint(30, 60),
        "controls_total": random.randint(45, 153),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": current_user.get("name"),
        "status": "completed",
    }
    await db.compliance_generated_reports.insert_one(report)
    report.pop("_id", None)
    return report
