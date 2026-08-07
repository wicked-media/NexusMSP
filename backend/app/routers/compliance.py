from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from datetime import datetime, timezone, timedelta
from pathlib import Path
import uuid
from app.database import db, UPLOADS_DIR
from app.auth import get_current_user

router = APIRouter()

COMPLIANCE_EVIDENCE_DIR = UPLOADS_DIR / "compliance-evidence"
COMPLIANCE_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
COMPLIANCE_EVIDENCE_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".csv", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".md"}
COMPLIANCE_ISSUE_STATUSES = {"open", "in_progress", "ready_for_review", "resolved", "accepted_risk"}
COMPLIANCE_ISSUE_SEVERITIES = {"low", "medium", "high", "critical"}
COMPLIANCE_POLICY_STATUSES = {"draft", "in_review", "approved", "retired"}

POLICY_TEMPLATES = {
    "information-security": {"name": "Information Security Policy", "category": "Governance", "frameworks": ["iso27001", "soc2", "nist_csf"], "purpose": "Define the organisation's security objectives, responsibilities and governance model."},
    "access-control": {"name": "Access Control Policy", "category": "Identity", "frameworks": ["essential8", "iso27001", "soc2", "pci_dss"], "purpose": "Govern identity lifecycle, least privilege, MFA, privileged access and periodic access review."},
    "incident-response": {"name": "Incident Response Policy", "category": "Resilience", "frameworks": ["iso27001", "soc2", "nist_csf", "gdpr", "apra_cps234"], "purpose": "Define incident preparation, triage, containment, notification, recovery and lessons learned."},
    "business-continuity": {"name": "Business Continuity and Disaster Recovery Policy", "category": "Resilience", "frameworks": ["iso27001", "soc2", "nist_csf", "apra_cps234"], "purpose": "Set recovery priorities, backup requirements, restore testing and continuity responsibilities."},
    "vendor-risk": {"name": "Third-Party Risk Management Policy", "category": "Supply chain", "frameworks": ["iso27001", "soc2", "nist_csf", "apra_cps234"], "purpose": "Govern supplier due diligence, contracting, ongoing monitoring and secure offboarding."},
    "acceptable-use": {"name": "Acceptable Use Policy", "category": "People", "frameworks": ["iso27001", "soc2", "hipaa"], "purpose": "Define appropriate use of company systems, information, internet, email and collaboration services."},
    "data-governance": {"name": "Data Classification, Retention and Disposal Policy", "category": "Privacy and data", "frameworks": ["iso27001", "gdpr", "hipaa", "pci_dss"], "purpose": "Classify information and govern handling, retention, disposal and recovery requirements."},
    "privacy": {"name": "Privacy and Personal Information Policy", "category": "Privacy and data", "frameworks": ["gdpr", "iso27001", "hipaa"], "purpose": "Govern lawful collection, use, disclosure, access, correction and deletion of personal information."},
    "vulnerability": {"name": "Vulnerability and Patch Management Policy", "category": "Security operations", "frameworks": ["essential8", "iso27001", "soc2", "nist_csf", "pci_dss"], "purpose": "Define scanning, prioritisation, remediation targets, exceptions and verification."},
    "change-management": {"name": "Change Management Policy", "category": "Operations", "frameworks": ["iso27001", "soc2"], "purpose": "Require risk assessment, testing, approval, rollback planning and evidence for production changes."},
    "ai-governance": {"name": "Responsible AI Use and Governance Policy", "category": "AI governance", "frameworks": ["iso42001", "nist_ai_rmf"], "purpose": "Govern approved AI use, data handling, human oversight, testing, monitoring and incident response."},
}


async def _write_compliance_audit(current_user: dict, action: str, entity_id: str, entity_name: str, metadata: dict | None = None, entity_type: str = "compliance_issue"):
    await db.audit_logs.insert_one({
        "id": f"audit-{uuid.uuid4().hex[:12]}",
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name") or current_user.get("email") or "Unknown user",
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


def _policy_template_content(template: dict, organisation_name: str = "the organisation") -> str:
    return (
        f"# {template['name']}\n\n"
        f"## Purpose\n{template['purpose']}\n\n"
        f"## Scope\nThis policy applies to {organisation_name}, its workforce, managed systems, information and relevant third parties.\n\n"
        "## Policy requirements\n- Responsibilities and accountable owners must be documented.\n"
        "- Controls must be proportionate to risk and supported by verifiable evidence.\n"
        "- Exceptions require an owner, business justification, compensating controls, expiry date and approval.\n"
        "- Suspected breaches must be reported through the incident-management process.\n\n"
        "## Evidence and monitoring\nNexusMSP records mapped controls, evidence scans, issues, approvals and review history. Missing evidence remains unassessed.\n\n"
        "## Review\nReview at least annually and after material legal, operational, technology or threat changes.\n"
    )

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

# These are readiness templates, not claims that NexusMSP certifies a customer.
# They provide an MSP-friendly path into the most common programmes while the
# custom framework builder below covers industry, contractual and local needs.
COMPLIANCE_FRAMEWORKS.update({
    "essential8": {
        "name": "Essential Eight", "region": "Australia", "category": "Cyber security", "template_state": "readiness_template", "controls": [
            {"id": "E8-1", "name": "Application control", "description": "Prevent execution of unapproved applications", "check": "software_tracked"},
            {"id": "E8-2", "name": "Patch applications", "description": "Identify and remediate application vulnerabilities", "check": "vulns_managed"},
            {"id": "E8-3", "name": "Configure Microsoft Office macros", "description": "Restrict macros from untrusted sources", "check": "office_macros"},
            {"id": "E8-4", "name": "User application hardening", "description": "Harden browsers and user-facing applications", "check": "configs_secure"},
            {"id": "E8-5", "name": "Restrict administrative privileges", "description": "Control and review privileged access", "check": "access_controlled"},
            {"id": "E8-6", "name": "Patch operating systems", "description": "Identify and remediate operating-system vulnerabilities", "check": "vulns_managed"},
            {"id": "E8-7", "name": "Multi-factor authentication", "description": "Require MFA for sensitive and remote access", "check": "mfa_enforced"},
            {"id": "E8-8", "name": "Regular backups", "description": "Protect and test restoration of important data", "check": "recovery_tested"},
        ],
    },
    "iso27001": {
        "name": "ISO/IEC 27001", "region": "Global", "category": "Information security", "template_state": "readiness_template", "controls": [
            {"id": "ISO-5.9", "name": "Inventory of information and assets", "check": "devices_inventoried"},
            {"id": "ISO-5.15", "name": "Access control", "check": "access_controlled"},
            {"id": "ISO-5.19", "name": "Supplier relationships", "check": "vendors_assessed"},
            {"id": "ISO-5.24", "name": "Incident management planning", "check": "incident_ready"},
            {"id": "ISO-8.7", "name": "Protection against malware", "check": "antimalware"},
            {"id": "ISO-8.8", "name": "Management of technical vulnerabilities", "check": "vulns_managed"},
            {"id": "ISO-8.13", "name": "Information backup", "check": "backups_configured"},
            {"id": "ISO-8.15", "name": "Logging", "check": "audit_logs"},
        ],
    },
    "soc2": {
        "name": "SOC 2", "region": "Global", "category": "Trust services", "template_state": "readiness_template", "controls": [
            {"id": "SOC2-CC6", "name": "Logical and physical access", "check": "access_controlled"},
            {"id": "SOC2-CC7", "name": "System operations and monitoring", "check": "audit_logs"},
            {"id": "SOC2-CC8", "name": "Change management", "check": "changes_governed"},
            {"id": "SOC2-A1", "name": "Availability and recovery", "check": "recovery_tested"},
            {"id": "SOC2-C1", "name": "Confidential information protection", "check": "encryption"},
        ],
    },
    "nist_csf": {
        "name": "NIST Cybersecurity Framework 2.0", "region": "Global", "category": "Cyber security", "template_state": "readiness_template", "controls": [
            {"id": "CSF-GV", "name": "Govern", "check": "risk_assessed"},
            {"id": "CSF-ID", "name": "Identify", "check": "devices_inventoried"},
            {"id": "CSF-PR", "name": "Protect", "check": "configs_secure"},
            {"id": "CSF-DE", "name": "Detect", "check": "audit_logs"},
            {"id": "CSF-RS", "name": "Respond", "check": "incident_ready"},
            {"id": "CSF-RC", "name": "Recover", "check": "recovery_tested"},
        ],
    },
    "pci_dss": {
        "name": "PCI DSS 4.0", "region": "Global", "category": "Payment security", "template_state": "readiness_template", "controls": [
            {"id": "PCI-1", "name": "Network security controls", "check": "network_managed"},
            {"id": "PCI-2", "name": "Secure configurations", "check": "configs_secure"},
            {"id": "PCI-3", "name": "Protect stored account data", "check": "encryption"},
            {"id": "PCI-5", "name": "Protect against malware", "check": "antimalware"},
            {"id": "PCI-6", "name": "Secure systems and software", "check": "vulns_managed"},
            {"id": "PCI-7", "name": "Restrict access by business need", "check": "access_controlled"},
            {"id": "PCI-10", "name": "Log and monitor access", "check": "audit_logs"},
        ],
    },
    "gdpr": {
        "name": "GDPR", "region": "European Union", "category": "Privacy", "template_state": "readiness_template", "controls": [
            {"id": "GDPR-30", "name": "Records of processing activities", "check": "data_inventory"},
            {"id": "GDPR-32A", "name": "Access and confidentiality", "check": "access_controlled"},
            {"id": "GDPR-32B", "name": "Encryption and resilience", "check": "encryption"},
            {"id": "GDPR-32D", "name": "Security testing", "check": "vulns_managed"},
            {"id": "GDPR-33", "name": "Breach response", "check": "incident_ready"},
        ],
    },
    "iso42001": {
        "name": "ISO/IEC 42001", "region": "Global", "category": "AI governance", "template_state": "readiness_template", "controls": [
            {"id": "AI-4", "name": "AI management system context", "check": "ai_inventory"},
            {"id": "AI-6", "name": "AI risk planning", "check": "risk_assessed"},
            {"id": "AI-8", "name": "AI operational controls", "check": "ai_monitored"},
            {"id": "AI-9", "name": "AI performance evaluation", "check": "ai_reviewed"},
            {"id": "AI-A10", "name": "Third-party AI services", "check": "vendors_assessed"},
        ],
    },
    "nist_ai_rmf": {
        "name": "NIST AI RMF", "region": "Global", "category": "AI governance", "template_state": "readiness_template", "controls": [
            {"id": "AI-GOVERN", "name": "Govern AI risks", "check": "risk_assessed"},
            {"id": "AI-MAP", "name": "Map AI context and impacts", "check": "ai_inventory"},
            {"id": "AI-MEASURE", "name": "Measure AI risk", "check": "ai_reviewed"},
            {"id": "AI-MANAGE", "name": "Manage AI risk", "check": "ai_monitored"},
        ],
    },
    "apra_cps234": {
        "name": "APRA CPS 234", "region": "Australia", "category": "Prudential security", "template_state": "readiness_template", "controls": [
            {"id": "CPS234-1", "name": "Information security capability", "check": "risk_assessed"},
            {"id": "CPS234-2", "name": "Information asset identification", "check": "devices_inventoried"},
            {"id": "CPS234-3", "name": "Control implementation", "check": "configs_secure"},
            {"id": "CPS234-4", "name": "Incident notification readiness", "check": "incident_ready"},
            {"id": "CPS234-5", "name": "Control testing", "check": "vulns_managed"},
            {"id": "CPS234-6", "name": "Third-party security", "check": "vendors_assessed"},
        ],
    },
})

EVIDENCE_CHECKS = {
    "manual": "Manual evidence or attestation",
    "devices_inventoried": "Managed asset inventory",
    "software_tracked": "Software inventory",
    "backups_configured": "Backup coverage",
    "recovery_tested": "Restore validation",
    "configs_secure": "Endpoint secure configuration",
    "creds_managed": "Credential-management evidence",
    "access_controlled": "Identity and privileged access",
    "mfa_enforced": "Multi-factor authentication",
    "vulns_managed": "Vulnerability and patch posture",
    "audit_logs": "Audit and activity logs",
    "email_protected": "Email-security posture",
    "antimalware": "Endpoint malware protection",
    "network_managed": "Managed network evidence",
    "encryption": "Endpoint encryption",
    "data_integrity": "Data-integrity evidence",
    "risk_assessed": "Risk assessment",
    "training_done": "Security-awareness training",
    "vendors_assessed": "Third-party risk review",
    "incident_ready": "Incident response readiness",
    "changes_governed": "Change management evidence",
    "data_inventory": "Data and processing inventory",
    "ai_inventory": "AI system inventory",
    "ai_monitored": "AI system monitoring",
    "ai_reviewed": "AI impact and performance review",
    "office_macros": "Microsoft Office macro policy",
}


async def _custom_frameworks():
    rows = await db.compliance_custom_frameworks.find({"archived": {"$ne": True}}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return {row["id"]: row for row in rows if row.get("id")}


async def _framework_definition(framework_id: str):
    if framework_id in COMPLIANCE_FRAMEWORKS:
        return COMPLIANCE_FRAMEWORKS[framework_id]
    return (await _custom_frameworks()).get(framework_id)


async def _sync_compliance_issues(report: dict, current_user: dict):
    """Turn scan gaps into owned work and verify them when evidence recovers."""
    now = datetime.now(timezone.utc)
    actor = current_user.get("name") or current_user.get("email") or "Nexus assurance engine"
    for control in report.get("controls") or []:
        key = {
            "client_id": report.get("client_id"),
            "framework_id": report.get("framework"),
            "control_id": control.get("id"),
            "source": "evidence_scan",
        }
        existing = await db.compliance_issues.find_one(key, {"_id": 0})
        if control.get("status") == "pass":
            if existing and existing.get("status") not in {"resolved", "accepted_risk"}:
                await db.compliance_issues.update_one({"id": existing["id"]}, {"$set": {
                    "status": "resolved",
                    "resolution": "Automatically verified by a later evidence scan.",
                    "resolved_at": now.isoformat(),
                    "resolved_by": actor,
                    "verified_scan_id": report.get("id"),
                    "updated_at": now.isoformat(),
                }})
            continue
        severity = "high" if control.get("status") == "fail" else "medium"
        due_days = 14 if severity == "high" else 30
        issue_data = {
            "title": f"{control.get('id')} - {control.get('name')}",
            "client_name": report.get("client_name"),
            "framework_name": report.get("framework_name"),
            "control_name": control.get("name"),
            "severity": severity,
            "latest_evidence": control.get("evidence") or "No evidence captured",
            "latest_scan_id": report.get("id"),
            "last_observed_at": report.get("scanned_at") or now.isoformat(),
            "updated_at": now.isoformat(),
        }
        if existing:
            if existing.get("status") == "resolved":
                issue_data.update({"status": "open", "reopened_at": now.isoformat(), "resolution": None, "resolved_at": None})
            await db.compliance_issues.update_one({"id": existing["id"]}, {"$set": issue_data})
        else:
            issue = {
                "id": f"issue-{uuid.uuid4().hex[:12]}", **key, **issue_data,
                "status": "open", "owner": "Unassigned",
                "due_date": (now + timedelta(days=due_days)).date().isoformat(),
                "treatment": "remediate", "description": control.get("description") or "Close the observed control evidence gap.",
                "attachments": [], "history": [{"at": now.isoformat(), "by": actor, "action": "created_from_scan", "scan_id": report.get("id")}],
                "created_at": now.isoformat(), "created_by": actor,
            }
            await db.compliance_issues.insert_one(issue)


@router.get("/compliance/scan/{client_id}")
async def scan_compliance(client_id: str, framework: str = "cis", current_user: dict = Depends(get_current_user)):
    """Scan a client's environment against a compliance framework."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        return {"error": "Client not found"}

    fw = await _framework_definition(framework)
    if not fw:
        raise HTTPException(status_code=404, detail="Unknown compliance framework")

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
        "mfa_enforced": ("not_assessed", "No identity-provider MFA evidence source connected"),
        "vendors_assessed": ("not_assessed", "No third-party risk evidence connected"),
        "incident_ready": ("not_assessed", "No approved incident-response exercise or plan evidence connected"),
        "changes_governed": ("not_assessed", "No linked change-management evidence connected"),
        "data_inventory": ("not_assessed", "No data-processing inventory evidence connected"),
        "ai_inventory": ("not_assessed", "No AI system inventory evidence connected"),
        "ai_monitored": ("not_assessed", "No AI monitoring evidence connected"),
        "ai_reviewed": ("not_assessed", "No AI impact or performance review evidence connected"),
        "office_macros": ("not_assessed", "No Microsoft Office macro-policy evidence connected"),
        "manual": ("not_assessed", "Manual evidence has not been attached"),
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
    await _sync_compliance_issues(report, current_user)
    return report


@router.get("/compliance/reports")
async def get_compliance_reports(current_user: dict = Depends(get_current_user)):
    return await db.compliance_reports.find({}, {"_id": 0}).sort("scanned_at", -1).to_list(100)


@router.get("/compliance/frameworks")
async def get_frameworks(current_user: dict = Depends(get_current_user)):
    custom = await _custom_frameworks()
    combined = {**COMPLIANCE_FRAMEWORKS, **custom}
    return [{
        "id": framework_id,
        "name": definition["name"],
        "controls": len(definition.get("controls") or []),
        "category": definition.get("category", "Custom"),
        "region": definition.get("region", "Organisation"),
        "template_state": definition.get("template_state", "custom" if framework_id in custom else "readiness_template"),
        "custom": framework_id in custom,
        "version": definition.get("version", 1),
    } for framework_id, definition in combined.items()]


@router.get("/compliance/evidence-checks")
async def get_evidence_checks(current_user: dict = Depends(get_current_user)):
    return [{"id": key, "name": value} for key, value in EVIDENCE_CHECKS.items()]


@router.get("/compliance/custom-frameworks")
async def list_custom_frameworks(current_user: dict = Depends(get_current_user)):
    return list((await _custom_frameworks()).values())


@router.post("/compliance/custom-frameworks")
async def create_custom_framework(data: dict, current_user: dict = Depends(get_current_user)):
    name = str(data.get("name") or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Framework name must be at least 3 characters")
    framework_id = f"custom-{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    framework = {
        "id": framework_id,
        "name": name,
        "description": str(data.get("description") or "").strip(),
        "category": str(data.get("category") or "Custom").strip() or "Custom",
        "region": str(data.get("region") or "Organisation").strip() or "Organisation",
        "authority": str(data.get("authority") or "Internal or contractual requirement").strip(),
        "template_state": "custom",
        "version": 1,
        "controls": [],
        "created_at": now,
        "updated_at": now,
        "created_by": current_user.get("name") or current_user.get("email") or "Unknown user",
        "archived": False,
    }
    await db.compliance_custom_frameworks.insert_one(framework)
    framework.pop("_id", None)
    await db.audit_logs.insert_one({
        "id": f"audit-{uuid.uuid4().hex[:12]}", "action": "compliance_framework_created",
        "target_type": "compliance_framework", "target_id": framework_id, "target_name": name,
        "actor_name": framework["created_by"], "timestamp": now,
    })
    return framework


@router.put("/compliance/custom-frameworks/{framework_id}")
async def update_custom_framework(framework_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.compliance_custom_frameworks.find_one({"id": framework_id, "archived": {"$ne": True}}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Custom framework not found")
    update = {}
    for field in ("name", "description", "category", "region", "authority"):
        if field in data:
            update[field] = str(data.get(field) or "").strip()
    if "name" in update and len(update["name"]) < 3:
        raise HTTPException(status_code=400, detail="Framework name must be at least 3 characters")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    update["version"] = int(existing.get("version") or 1) + 1
    await db.compliance_custom_frameworks.update_one({"id": framework_id}, {"$set": update})
    return await db.compliance_custom_frameworks.find_one({"id": framework_id}, {"_id": 0})


@router.post("/compliance/custom-frameworks/{framework_id}/controls")
async def add_custom_control(framework_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    framework = await db.compliance_custom_frameworks.find_one({"id": framework_id, "archived": {"$ne": True}}, {"_id": 0})
    if not framework:
        raise HTTPException(status_code=404, detail="Custom framework not found")
    name = str(data.get("name") or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Control name must be at least 3 characters")
    evidence_check = str(data.get("check") or "manual")
    if evidence_check not in EVIDENCE_CHECKS:
        raise HTTPException(status_code=400, detail="Unknown evidence check")
    control = {
        "id": str(data.get("reference") or f"CTRL-{len(framework.get('controls') or []) + 1:03d}").strip(),
        "name": name,
        "description": str(data.get("description") or "").strip(),
        "check": evidence_check,
        "evidence_guidance": str(data.get("evidence_guidance") or "").strip(),
        "owner_role": str(data.get("owner_role") or "Compliance owner").strip(),
        "frequency": str(data.get("frequency") or "continuous").strip(),
        "mapped_frameworks": [str(item) for item in (data.get("mapped_frameworks") or []) if str(item).strip()],
    }
    controls = [*(framework.get("controls") or []), control]
    now = datetime.now(timezone.utc).isoformat()
    await db.compliance_custom_frameworks.update_one({"id": framework_id}, {"$set": {"controls": controls, "updated_at": now}, "$inc": {"version": 1}})
    return control


@router.get("/compliance/programs")
async def list_compliance_programs(current_user: dict = Depends(get_current_user)):
    programs = await db.compliance_programs.find({"archived": {"$ne": True}}, {"_id": 0}).sort("updated_at", -1).to_list(1000)
    for program in programs:
        scans = await db.compliance_reports.find({
            "client_id": program.get("client_id"), "framework": {"$in": program.get("framework_ids") or []},
        }, {"_id": 0}).sort("scanned_at", -1).to_list(500)
        latest = {}
        for scan in scans:
            latest.setdefault(scan.get("framework"), scan)
        scores = [float(scan["score"]) for scan in latest.values() if isinstance(scan.get("score"), (int, float))]
        program["progress_pct"] = round(sum(scores) / len(scores)) if scores else 0
        program["frameworks_assessed"] = len(latest)
        program["open_gaps"] = sum(
            1 for scan in latest.values() for control in (scan.get("controls") or [])
            if control.get("status") in ("fail", "not_assessed")
        )
        program["status"] = "monitoring" if latest else "planning"
        program["last_evidence_at"] = max((scan.get("scanned_at") or "" for scan in latest.values()), default=None)
    return programs


@router.post("/compliance/programs")
async def create_compliance_program(data: dict, current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    framework_ids = [str(item).strip() for item in (data.get("framework_ids") or []) if str(item).strip()]
    if not client_id or not framework_ids:
        raise HTTPException(status_code=400, detail="Choose a customer and at least one framework")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Customer not found")
    available = {**COMPLIANCE_FRAMEWORKS, **(await _custom_frameworks())}
    unknown = [item for item in framework_ids if item not in available]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown framework: {unknown[0]}")
    now = datetime.now(timezone.utc).isoformat()
    program = {
        "id": f"program-{uuid.uuid4().hex[:10]}", "client_id": client_id, "client_name": client.get("name") or client_id,
        "name": str(data.get("name") or f"{client.get('name') or 'Customer'} compliance programme").strip(),
        "framework_ids": framework_ids, "framework_names": [available[item]["name"] for item in framework_ids],
        "owner": str(data.get("owner") or current_user.get("name") or "Unassigned").strip(),
        "target_date": str(data.get("target_date") or "").strip() or None,
        "scope": str(data.get("scope") or "All managed users, devices and connected services").strip(),
        "status": "planning", "progress_pct": 0, "open_gaps": 0,
        "created_at": now, "updated_at": now, "created_by": current_user.get("name") or current_user.get("email"), "archived": False,
    }
    await db.compliance_programs.insert_one(program)
    program.pop("_id", None)
    return program


@router.get("/compliance/issues")
async def list_compliance_issues(
    client_id: str | None = None,
    program_id: str | None = None,
    status: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    query: dict = {"archived": {"$ne": True}}
    if client_id:
        query["client_id"] = client_id
    if program_id:
        query["program_id"] = program_id
    if status and status != "all":
        query["status"] = status
    rows = await db.compliance_issues.find(query, {"_id": 0}).sort([("status", 1), ("due_date", 1), ("updated_at", -1)]).to_list(2000)
    today = datetime.now(timezone.utc).date().isoformat()
    for row in rows:
        row["overdue"] = bool(row.get("due_date") and row["due_date"] < today and row.get("status") not in {"resolved", "accepted_risk"})
    return rows


@router.post("/compliance/issues")
async def create_compliance_issue(data: dict, current_user: dict = Depends(get_current_user)):
    title = str(data.get("title") or "").strip()
    client_id = str(data.get("client_id") or "").strip()
    if len(title) < 3 or not client_id:
        raise HTTPException(status_code=400, detail="Choose a customer and enter an issue title")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Customer not found")
    severity = str(data.get("severity") or "medium").lower()
    if severity not in COMPLIANCE_ISSUE_SEVERITIES:
        raise HTTPException(status_code=400, detail="Unknown issue severity")
    now = datetime.now(timezone.utc).isoformat()
    actor = current_user.get("name") or current_user.get("email") or "Unknown user"
    issue = {
        "id": f"issue-{uuid.uuid4().hex[:12]}", "title": title,
        "client_id": client_id, "client_name": client.get("name") or client_id,
        "program_id": str(data.get("program_id") or "").strip() or None,
        "framework_id": str(data.get("framework_id") or "").strip() or None,
        "framework_name": str(data.get("framework_name") or "").strip() or None,
        "control_id": str(data.get("control_id") or "").strip() or None,
        "description": str(data.get("description") or "").strip(),
        "severity": severity, "status": "open",
        "owner": str(data.get("owner") or "Unassigned").strip() or "Unassigned",
        "due_date": str(data.get("due_date") or "").strip() or None,
        "treatment": str(data.get("treatment") or "remediate").strip(),
        "source": "manual", "attachments": [],
        "history": [{"at": now, "by": actor, "action": "created"}],
        "created_at": now, "updated_at": now, "created_by": actor, "archived": False,
    }
    await db.compliance_issues.insert_one(issue)
    issue.pop("_id", None)
    await _write_compliance_audit(current_user, "compliance_issue_created", issue["id"], title, {"client_id": client_id, "severity": severity})
    return issue


@router.put("/compliance/issues/{issue_id}")
async def update_compliance_issue(issue_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    issue = await db.compliance_issues.find_one({"id": issue_id, "archived": {"$ne": True}}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Compliance issue not found")
    update = {}
    for field in ("title", "description", "owner", "due_date", "treatment", "resolution"):
        if field in data:
            update[field] = str(data.get(field) or "").strip() or None
    if "severity" in data:
        severity = str(data.get("severity") or "").lower()
        if severity not in COMPLIANCE_ISSUE_SEVERITIES:
            raise HTTPException(status_code=400, detail="Unknown issue severity")
        update["severity"] = severity
    if "status" in data:
        status = str(data.get("status") or "").lower()
        if status not in COMPLIANCE_ISSUE_STATUSES:
            raise HTTPException(status_code=400, detail="Unknown issue status")
        if status in {"resolved", "accepted_risk"} and len(str(data.get("resolution") or issue.get("resolution") or "").strip()) < 5:
            raise HTTPException(status_code=400, detail="Record a resolution or risk-acceptance justification")
        update["status"] = status
        if status == "in_progress" and str(update.get("owner") or issue.get("owner") or "").strip() in {"", "Unassigned"}:
            update["owner"] = current_user.get("name") or current_user.get("email") or "Assigned technician"
        if status in {"resolved", "accepted_risk"}:
            update["resolved_at"] = datetime.now(timezone.utc).isoformat()
            update["resolved_by"] = current_user.get("name") or current_user.get("email")
    now = datetime.now(timezone.utc).isoformat()
    update["updated_at"] = now
    history = {"at": now, "by": current_user.get("name") or current_user.get("email") or "Unknown user", "action": "updated", "changes": sorted(update.keys())}
    await db.compliance_issues.update_one({"id": issue_id}, {"$set": update, "$push": {"history": history}})
    await _write_compliance_audit(current_user, "compliance_issue_updated", issue_id, update.get("title") or issue.get("title") or issue_id, {"changes": sorted(update.keys()), "status": update.get("status")})
    return await db.compliance_issues.find_one({"id": issue_id}, {"_id": 0})


@router.post("/compliance/issues/{issue_id}/attachments")
async def upload_compliance_issue_attachment(
    issue_id: str,
    file: UploadFile = File(...),
    note: str = Form(""),
    current_user: dict = Depends(get_current_user),
):
    issue = await db.compliance_issues.find_one({"id": issue_id, "archived": {"$ne": True}}, {"_id": 0})
    if not issue:
        raise HTTPException(status_code=404, detail="Compliance issue not found")
    extension = Path(file.filename or "").suffix.lower()
    if extension not in COMPLIANCE_EVIDENCE_EXTENSIONS:
        raise HTTPException(status_code=422, detail="Upload a PDF, image, CSV, Office document, text or Markdown evidence file")
    content = await file.read()
    if not content or len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="Evidence files must be between 1 byte and 20 MB")
    stored_name = f"{uuid.uuid4().hex}{extension}"
    (COMPLIANCE_EVIDENCE_DIR / stored_name).write_bytes(content)
    now = datetime.now(timezone.utc).isoformat()
    attachment = {
        "id": f"evidence-{uuid.uuid4().hex[:12]}", "name": Path(file.filename or stored_name).name,
        "url": f"/api/uploads/compliance-evidence/{stored_name}", "content_type": file.content_type or "application/octet-stream",
        "size": len(content), "note": str(note or "").strip(),
        "uploaded_by": current_user.get("id"), "uploaded_by_name": current_user.get("name") or current_user.get("email"), "uploaded_at": now,
    }
    await db.compliance_issues.update_one({"id": issue_id}, {"$push": {"attachments": attachment, "history": {"at": now, "by": attachment["uploaded_by_name"], "action": "evidence_attached", "evidence_id": attachment["id"]}}, "$set": {"updated_at": now}})
    await _write_compliance_audit(current_user, "compliance_evidence_attached", issue_id, issue.get("title") or issue_id, {"attachment": attachment["name"]})
    return attachment


@router.get("/compliance/policy-templates")
async def list_compliance_policy_templates(current_user: dict = Depends(get_current_user)):
    return [{"id": template_id, **template} for template_id, template in POLICY_TEMPLATES.items()]


@router.get("/compliance/policies")
async def list_compliance_policies(
    client_id: str | None = None,
    status: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    query: dict = {"archived": {"$ne": True}}
    if client_id:
        query["client_id"] = client_id
    if status and status != "all":
        query["status"] = status
    policies = await db.compliance_policies.find(query, {"_id": 0}).sort([("status", 1), ("next_review_date", 1), ("updated_at", -1)]).to_list(1000)
    today = datetime.now(timezone.utc).date().isoformat()
    for policy in policies:
        policy["review_overdue"] = bool(policy.get("next_review_date") and policy["next_review_date"] < today and policy.get("status") == "approved")
        policy["acknowledgement_count"] = len(policy.get("acknowledgements") or [])
    return policies


@router.post("/compliance/policies")
async def create_compliance_policy(data: dict, current_user: dict = Depends(get_current_user)):
    template_id = str(data.get("template_id") or "").strip()
    template = POLICY_TEMPLATES.get(template_id)
    name = str(data.get("name") or (template or {}).get("name") or "").strip()
    if len(name) < 3:
        raise HTTPException(status_code=400, detail="Choose a template or enter a policy name")
    client_id = str(data.get("client_id") or "").strip() or None
    client_name = None
    if client_id:
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
        if not client:
            raise HTTPException(status_code=404, detail="Customer not found")
        client_name = client.get("name") or client_id
    now = datetime.now(timezone.utc).isoformat()
    actor = current_user.get("name") or current_user.get("email") or "Unknown user"
    policy = {
        "id": f"policy-{uuid.uuid4().hex[:12]}", "template_id": template_id or None,
        "name": name, "category": str(data.get("category") or (template or {}).get("category") or "Governance").strip(),
        "client_id": client_id, "client_name": client_name,
        "owner": str(data.get("owner") or actor).strip(),
        "approver": str(data.get("approver") or "Compliance approver").strip(),
        "review_frequency_months": max(1, min(int(data.get("review_frequency_months") or 12), 36)),
        "framework_ids": [str(item) for item in (data.get("framework_ids") or (template or {}).get("frameworks") or []) if str(item).strip()],
        "purpose": str(data.get("purpose") or (template or {}).get("purpose") or "").strip(),
        "content": str(data.get("content") or _policy_template_content(template or {"name": name, "purpose": str(data.get("purpose") or "Define the required governance and control expectations.")}, client_name or "the organisation")).strip(),
        "status": "draft", "version": 1, "acknowledgements": [], "revisions": [],
        "created_at": now, "updated_at": now, "created_by": actor, "archived": False,
    }
    await db.compliance_policies.insert_one(policy)
    policy.pop("_id", None)
    await _write_compliance_audit(current_user, "compliance_policy_created", policy["id"], name, {"client_id": client_id, "template_id": template_id}, "compliance_policy")
    return policy


@router.put("/compliance/policies/{policy_id}")
async def update_compliance_policy(policy_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    policy = await db.compliance_policies.find_one({"id": policy_id, "archived": {"$ne": True}}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Compliance policy not found")
    update = {}
    for field in ("name", "category", "owner", "approver", "purpose", "content"):
        if field in data:
            update[field] = str(data.get(field) or "").strip()
    if "framework_ids" in data:
        update["framework_ids"] = [str(item) for item in (data.get("framework_ids") or []) if str(item).strip()]
    if "review_frequency_months" in data:
        update["review_frequency_months"] = max(1, min(int(data.get("review_frequency_months") or 12), 36))
    requested_status = str(data.get("status") or "").strip()
    if requested_status:
        if requested_status not in {"draft", "in_review", "retired"}:
            raise HTTPException(status_code=400, detail="Use the approval workflow to approve a policy")
        update["status"] = requested_status
    content_changed = any(field in update for field in ("name", "purpose", "content", "framework_ids"))
    now = datetime.now(timezone.utc).isoformat()
    if content_changed:
        update["version"] = int(policy.get("version") or 1) + 1
        update["status"] = "draft"
        update["approved_at"] = None
        update["approved_by"] = None
    update["updated_at"] = now
    revision = {"version": policy.get("version", 1), "status": policy.get("status"), "content": policy.get("content", ""), "captured_at": now, "captured_by": current_user.get("name") or current_user.get("email")}
    await db.compliance_policies.update_one({"id": policy_id}, {"$set": update, "$push": {"revisions": revision}})
    await _write_compliance_audit(current_user, "compliance_policy_updated", policy_id, update.get("name") or policy.get("name") or policy_id, {"version": update.get("version", policy.get("version")), "changes": sorted(update.keys())}, "compliance_policy")
    return await db.compliance_policies.find_one({"id": policy_id}, {"_id": 0})


@router.post("/compliance/policies/{policy_id}/approve")
async def approve_compliance_policy(policy_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    policy = await db.compliance_policies.find_one({"id": policy_id, "archived": {"$ne": True}}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Compliance policy not found")
    if len(str(policy.get("content") or "").strip()) < 100:
        raise HTTPException(status_code=400, detail="Complete the policy content before approval")
    approval_note = str(data.get("approval_note") or "").strip()
    if len(approval_note) < 5:
        raise HTTPException(status_code=400, detail="Record the approval rationale")
    now = datetime.now(timezone.utc)
    months = max(1, min(int(policy.get("review_frequency_months") or 12), 36))
    next_review = (now + timedelta(days=months * 30)).date().isoformat()
    actor = current_user.get("name") or current_user.get("email") or "Unknown user"
    approval = {"at": now.isoformat(), "by": actor, "note": approval_note, "version": policy.get("version", 1)}
    await db.compliance_policies.update_one({"id": policy_id}, {"$set": {
        "status": "approved", "approved_at": now.isoformat(), "approved_by": actor,
        "approval_note": approval_note, "next_review_date": next_review, "updated_at": now.isoformat(),
    }, "$push": {"approvals": approval}})
    await _write_compliance_audit(current_user, "compliance_policy_approved", policy_id, policy.get("name") or policy_id, {"version": policy.get("version"), "next_review_date": next_review}, "compliance_policy")
    return await db.compliance_policies.find_one({"id": policy_id}, {"_id": 0})


@router.post("/compliance/policies/{policy_id}/acknowledge")
async def acknowledge_compliance_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    policy = await db.compliance_policies.find_one({"id": policy_id, "archived": {"$ne": True}}, {"_id": 0})
    if not policy:
        raise HTTPException(status_code=404, detail="Compliance policy not found")
    if policy.get("status") != "approved":
        raise HTTPException(status_code=409, detail="Only approved policies can be acknowledged")
    user_id = current_user.get("id") or current_user.get("email")
    existing = next((item for item in (policy.get("acknowledgements") or []) if item.get("user_id") == user_id and item.get("version") == policy.get("version")), None)
    if existing:
        return existing
    acknowledgement = {"user_id": user_id, "user_name": current_user.get("name") or current_user.get("email"), "version": policy.get("version"), "acknowledged_at": datetime.now(timezone.utc).isoformat()}
    await db.compliance_policies.update_one({"id": policy_id}, {"$push": {"acknowledgements": acknowledgement}})
    await _write_compliance_audit(current_user, "compliance_policy_acknowledged", policy_id, policy.get("name") or policy_id, {"version": policy.get("version")}, "compliance_policy")
    return acknowledgement


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
    custom = await _custom_frameworks()
    definitions = {**COMPLIANCE_FRAMEWORKS, **custom}
    frameworks = []
    for framework_id, definition in definitions.items():
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
            "category": definition.get("category", "Custom"),
            "region": definition.get("region", "Organisation"),
            "template_state": definition.get("template_state", "custom" if framework_id in custom else "readiness_template"),
            "custom": framework_id in custom,
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
    definition = await _framework_definition(framework_id)
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
    custom = await _custom_frameworks()
    definitions = {**COMPLIANCE_FRAMEWORKS, **custom}
    return [
        {"id": framework_id, "name": definition["name"], "controls": len(definition["controls"]), "description": "Evidence-backed report available after a client scan"}
        for framework_id, definition in definitions.items()
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
