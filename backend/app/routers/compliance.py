from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
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

    # Gather directly observable environment data. Controls without evidence stay
    # explicitly unassessed; they are never silently marked as compliant.
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).to_list(5000)
    device_count = len(devices)
    online = sum(1 for device in devices if device.get("status") == "online")
    assessed_devices = [device for device in devices if device.get("security_assessed_at")]
    device_ids = [device.get("id") for device in devices if device.get("id")]
    software_count = await db.device_software.count_documents({"device_id": {"$in": device_ids}}) if device_ids else 0
    activity_count = await db.activity_logs.count_documents({"device_id": {"$in": device_ids}}) if device_ids else 0
    acronis_count = await db.acronis_devices.count_documents({"client_id": client_id})
    encrypted = lambda device: any(marker in str(device.get("encryption_status") or "").lower() for marker in ("encrypted", "bitlocker on", "protection on"))
    all_assessed = bool(assessed_devices) and len(assessed_devices) == device_count
    all_firewalls = all(device.get("firewall_enabled") for device in assessed_devices) if assessed_devices else False
    all_defender = all(device.get("antivirus_status") == "active" and device.get("defender_real_time_enabled") for device in assessed_devices) if assessed_devices else False
    all_encrypted = all(encrypted(device) for device in assessed_devices) if assessed_devices else False

    # Evaluate each control
    check_results = {
        "devices_inventoried": ("pass" if device_count > 0 else "not_assessed", f"{device_count} device(s) recorded"),
        "software_tracked": ("pass" if software_count > 0 else "not_assessed", f"{software_count} software inventory item(s) collected"),
        "backups_configured": ("pass" if acronis_count > 0 else "not_assessed", f"{acronis_count} backup-enabled device(s) linked"),
        "configs_secure": (("pass" if all_firewalls else "fail") if assessed_devices else "not_assessed", f"Firewall evidence from {len(assessed_devices)}/{device_count} device(s)"),
        "creds_managed": ("not_assessed", "No credential-management evidence source connected"),
        "access_controlled": ("not_assessed", "No identity-provider evidence source connected"),
        "vulns_managed": (("pass" if all_assessed else "not_assessed"), f"Security posture assessed on {len(assessed_devices)}/{device_count} device(s)"),
        "audit_logs": ("pass" if activity_count > 0 else "not_assessed", f"{activity_count} endpoint activity log entry/entries"),
        "email_protected": ("not_assessed", "No email-security evidence source connected"),
        "antimalware": (("pass" if all_defender else "fail") if assessed_devices else "not_assessed", f"Defender evidence from {len(assessed_devices)}/{device_count} device(s)"),
        "recovery_tested": ("not_assessed", "Backup recovery-test evidence not available"),
        "network_managed": ("pass" if online > 0 else "not_assessed", f"{online}/{device_count} device(s) currently online"),
        "data_integrity": ("not_assessed", "No data-integrity evidence source connected"),
        "encryption": (("pass" if all_encrypted else "fail") if assessed_devices else "not_assessed", f"Encryption evidence from {len(assessed_devices)}/{device_count} device(s)"),
        "risk_assessed": ("not_assessed", "No documented risk-assessment evidence connected"),
        "training_done": ("not_assessed", "No training-platform evidence source connected"),
    }

    results = []
    passed = 0
    evaluated = 0
    for ctrl in fw["controls"]:
        status, evidence = check_results.get(ctrl["check"], ("not_assessed", "No evidence mapping configured"))
        if status != "not_assessed":
            evaluated += 1
        if status == "pass":
            passed += 1
        results.append({**ctrl, "status": status, "evidence": evidence})

    score = round((passed / evaluated) * 100) if evaluated else None

    # Save report
    report_id = str(uuid.uuid4())[:8]
    report = {
        "id": report_id, "client_id": client_id, "client_name": client.get("name", ""),
        "framework": framework, "framework_name": fw["name"],
        "score": score, "evidence_score": score,
        "coverage_pct": round((evaluated / max(len(fw["controls"]), 1)) * 100),
        "passed": passed, "evaluated": evaluated, "total": len(fw["controls"]),
        "controls": results,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "scanned_by": current_user.get("name", ""),
        "evidence_state": "assessed" if evaluated else "not_assessed",
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
    """Summarise only evidence captured by real client scans.

    Earlier versions seeded random framework scores. Those figures could look
    credible but were not compliance evidence, so this endpoint now derives
    its scores from the latest persisted scan for each client/framework pair.
    """
    scans = await db.compliance_reports.find({}, {"_id": 0}).sort("scanned_at", -1).to_list(2000)
    latest_by_context: dict[tuple[str, str], dict] = {}
    for scan in scans:
        key = (str(scan.get("client_id") or ""), str(scan.get("framework") or ""))
        if key not in latest_by_context:
            latest_by_context[key] = scan
    latest_scans = list(latest_by_context.values())
    frameworks = []
    for framework_id, definition in COMPLIANCE_FRAMEWORKS.items():
        matched = [scan for scan in latest_scans if scan.get("framework") == framework_id]
        evidence_rows = []
        for scan in matched:
            passed_value = max(int(scan.get("passed") or 0), 0)
            total_value = max(int(scan.get("total") or len(definition["controls"])), 0)
            # Legacy scans did not persist `evaluated`. Their recorded total is
            # the only defensible denominator, rather than showing 0% or an
            # impossible percentage on an executive dashboard.
            evaluated_value = scan.get("evaluated")
            evaluated_value = total_value if evaluated_value is None else max(int(evaluated_value or 0), 0)
            evidence_rows.append((passed_value, evaluated_value, total_value))
        evaluated = sum(row[1] for row in evidence_rows)
        passed = sum(row[0] for row in evidence_rows)
        total = sum(row[2] for row in evidence_rows)
        data_quality_issue = any(passed_value > evaluated_value for passed_value, evaluated_value, _ in evidence_rows)
        frameworks.append({
            "id": framework_id,
            "name": definition["name"],
            "total_controls": len(definition["controls"]),
            "controls_met": passed,
            "evidence_controls": evaluated,
            "evidence_coverage_pct": round((evaluated / max(total, 1)) * 100) if matched else 0,
            # Do not silently clamp malformed evidence to 100%. A missing score
            # is more honest and directs the technician to validate the scan.
            "compliance_pct": round((passed / evaluated) * 100) if evaluated and not data_quality_issue else None,
            "clients_assessed": len({scan.get("client_id") for scan in matched if scan.get("client_id")}),
            "latest_assessed_at": max((scan.get("scanned_at") or "" for scan in matched), default=None),
            "evidence_state": "data_quality_issue" if data_quality_issue else "evidence_available" if matched else "not_assessed",
            "data_quality_issue": data_quality_issue,
        })
    client_latest: dict[str, list[dict]] = {}
    for scan in latest_scans:
        client_latest.setdefault(str(scan.get("client_id") or ""), []).append(scan)
    client_scores = [
        sum(float(scan["score"]) for scan in rows if isinstance(scan.get("score"), (int, float)))
        / sum(1 for scan in rows if isinstance(scan.get("score"), (int, float)))
        for client_id, rows in client_latest.items()
        if client_id and any(isinstance(scan.get("score"), (int, float)) for scan in rows)
    ]
    return {
        "frameworks": frameworks,
        "summary": {
            "total_frameworks": len(frameworks),
            "avg_compliance_pct": round(sum(client_scores) / len(client_scores), 1) if client_scores else None,
            "total_controls": sum(f.get("total_controls", 0) for f in frameworks),
            "controls_met": sum(f.get("controls_met", 0) for f in frameworks),
            "evidence_scans": len(latest_scans),
            "clients_assessed": len(client_scores),
            "compliant_clients": sum(1 for score in client_scores if score >= 85),
            "partially_compliant": sum(1 for score in client_scores if 0 < score < 85),
        },
    }


@router.get("/compliance-frameworks/{framework_id}")
async def get_framework_detail(framework_id: str, current_user: dict = Depends(get_current_user)):
    definition = COMPLIANCE_FRAMEWORKS.get(framework_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Compliance framework not found")
    scans = await db.compliance_reports.find({"framework": framework_id}, {"_id": 0}).sort("scanned_at", -1).to_list(500)
    latest_by_client: dict[str, dict] = {}
    for scan in scans:
        client_id = str(scan.get("client_id") or "")
        if client_id and client_id not in latest_by_client:
            latest_by_client[client_id] = scan
    latest = list(latest_by_client.values())
    return {
        "id": framework_id,
        "name": definition["name"],
        "controls": definition["controls"],
        "clients_assessed": len(latest),
        "latest_scans": latest,
        "evidence_state": "evidence_available" if latest else "not_assessed",
    }


# ============================================================
# Compliance Report Generator (merged from compliance_generator.py)
# ============================================================
@router.get("/compliance-generator/frameworks")
async def get_generator_frameworks(current_user: dict = Depends(get_current_user)):
    return [
        {"id": framework_id, "name": definition["name"], "controls": len(definition["controls"]), "description": "Evidence-backed report available after a client scan"}
        for framework_id, definition in COMPLIANCE_FRAMEWORKS.items()
    ]


@router.get("/compliance-generator/reports")
async def get_generated_reports(current_user: dict = Depends(get_current_user)):
    return await db.compliance_generated_reports.find(
        {"source": "evidence_scan"}, {"_id": 0}
    ).sort("generated_at", -1).to_list(50)


@router.post("/compliance-generator/generate")
async def generate_compliance_report(data: dict, current_user: dict = Depends(get_current_user)):
    scan_id = str(data.get("scan_id") or "").strip()
    if not scan_id:
        raise HTTPException(status_code=400, detail="Run an evidence scan before generating a compliance report")
    scan = await db.compliance_reports.find_one({"id": scan_id}, {"_id": 0})
    if not scan:
        raise HTTPException(status_code=404, detail="Compliance evidence scan not found")
    controls = scan.get("controls") or []
    report = {
        "id": f"cr-{uuid.uuid4().hex[:8]}",
        "source": "evidence_scan",
        "scan_id": scan["id"],
        "client_id": scan.get("client_id"),
        "client_name": scan.get("client_name"),
        "framework": scan.get("framework_name") or scan.get("framework"),
        "framework_id": scan.get("framework"),
        "title": f"{scan.get('framework_name') or scan.get('framework')} evidence report",
        "score": scan.get("score") if isinstance(scan.get("score"), (int, float)) else None,
        "evidence_score": scan.get("evidence_score") if isinstance(scan.get("evidence_score"), (int, float)) else None,
        "evidence_coverage_pct": scan.get("coverage_pct", 0),
        "controls_passed": scan.get("passed", 0),
        "controls_evaluated": scan.get("evaluated", 0),
        "controls_total": scan.get("total", len(controls)),
        "control_snapshot": controls,
        "scanned_at": scan.get("scanned_at"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": current_user.get("name"),
        "evidence_state": scan.get("evidence_state", "not_assessed"),
        "status": "completed" if int(scan.get("evaluated") or 0) else "evidence_gaps",
    }
    await db.compliance_generated_reports.insert_one(report)
    report.pop("_id", None)
    return report
