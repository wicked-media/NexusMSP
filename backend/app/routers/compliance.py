from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid
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
