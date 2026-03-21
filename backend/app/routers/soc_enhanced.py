from fastapi import APIRouter, Depends, HTTPException
from app.database import db
from app.routers.auth import get_current_user
from datetime import datetime, timezone, timedelta
import uuid
import random

router = APIRouter(tags=["Huntress Integration"])

# Mock data generator for when no API key is configured
def generate_mock_agents(count=25):
    hostnames = ["WS-ACME-", "SRV-TECH-", "PC-SUMMIT-", "DC-LEGAL-", "LT-APEX-", "WS-BYTE-", "SRV-CLOUD-", "PC-NOVA-"]
    os_list = ["Windows 11 Pro 23H2", "Windows 10 Enterprise", "Windows Server 2022", "Windows Server 2019", "macOS 14.2 Sonoma", "Windows 11 Enterprise"]
    statuses = ["online", "online", "online", "online", "online", "offline", "isolated", "needs_attention"]
    agents = []
    for i in range(count):
        prefix = random.choice(hostnames)
        status = random.choice(statuses)
        agents.append({
            "id": f"agent-{uuid.uuid4().hex[:8]}",
            "hostname": f"{prefix}{random.randint(100,999)}",
            "external_ip": f"203.0.{random.randint(1,255)}.{random.randint(1,255)}",
            "internal_ip": f"192.168.{random.randint(1,10)}.{random.randint(10,254)}",
            "os": random.choice(os_list),
            "agent_version": f"0.14.{random.randint(1,9)}",
            "status": status,
            "last_seen": (datetime.now(timezone.utc) - timedelta(minutes=random.randint(0, 1440 if status == "offline" else 15))).isoformat(),
            "organization": random.choice(["Acme Corp", "TechStart Inc", "Summit Legal Group", "Apex Dynamics", "ByteForge Labs", "CloudNine Solutions"]),
            "edr_version": f"2.{random.randint(0,5)}.{random.randint(0,9)}",
            "platform": random.choice(["windows", "windows", "windows", "macos"]),
            "isolated": status == "isolated",
            "tags": random.sample(["production", "server", "workstation", "critical", "vip", "remote"], k=random.randint(1, 3)),
        })
    return agents


def generate_mock_incidents(count=12):
    titles = [
        "Suspicious PowerShell execution detected",
        "Credential dumping attempt via LSASS",
        "Ransomware encryption behavior detected",
        "Unauthorized RDP brute-force attempt",
        "Malicious DLL injection in svchost.exe",
        "Cobalt Strike beacon communication",
        "Suspicious scheduled task creation",
        "LOLBin abuse: certutil downloading payload",
        "Persistence via registry run key",
        "Lateral movement via PsExec detected",
        "Phishing payload executed from Outlook",
        "Mimikatz credential harvesting attempt",
        "Suspicious WMI remote execution",
        "UAC bypass via fodhelper.exe",
        "Base64 encoded PowerShell command",
    ]
    severities = ["critical", "critical", "high", "high", "high", "medium", "medium", "medium", "low", "low"]
    statuses = ["new", "new", "investigating", "investigating", "remediated", "closed"]
    mitre = ["T1059.001", "T1003.001", "T1486", "T1110", "T1055.001", "T1071.001", "T1053.005", "T1105", "T1547.001", "T1570"]
    incidents = []
    for i in range(count):
        sev = random.choice(severities)
        status = random.choice(statuses)
        incidents.append({
            "id": f"inc-{uuid.uuid4().hex[:8]}",
            "title": random.choice(titles),
            "severity": sev,
            "status": status,
            "hostname": f"WS-{random.choice(['ACME','TECH','SUMMIT','APEX'])}-{random.randint(100,999)}",
            "organization": random.choice(["Acme Corp", "TechStart Inc", "Summit Legal Group"]),
            "created_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 168))).isoformat(),
            "updated_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 24))).isoformat(),
            "description": f"Huntress SOC detected suspicious activity on endpoint. MITRE ATT&CK: {random.choice(mitre)}. Immediate investigation recommended.",
            "mitre_attack": random.choice(mitre),
            "indicators": [f"SHA256:{uuid.uuid4().hex}", f"IP:{random.randint(45,220)}.{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}"],
            "remediation_steps": [
                "Isolate the affected endpoint immediately",
                "Collect memory dump and event logs",
                "Scan with updated AV signatures",
                "Check for lateral movement indicators",
                "Reset compromised credentials",
                "Review and block malicious IPs/domains",
            ][:random.randint(2, 5)],
            "assigned_to": random.choice([None, "Aaron Buckanen", "Tech Support"]),
            "ticket_id": None if status in ["new", "investigating"] else f"TK-{random.randint(1000,9999)}",
        })
    return sorted(incidents, key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3}[x["severity"]])


def generate_mock_summary(agents, incidents):
    online = len([a for a in agents if a["status"] == "online"])
    offline = len([a for a in agents if a["status"] == "offline"])
    isolated = len([a for a in agents if a["status"] == "isolated"])
    needs_attn = len([a for a in agents if a["status"] == "needs_attention"])
    open_inc = len([i for i in incidents if i["status"] in ["new", "investigating"]])
    critical_inc = len([i for i in incidents if i["severity"] == "critical" and i["status"] in ["new", "investigating"]])
    return {
        "total_agents": len(agents),
        "online": online,
        "offline": offline,
        "isolated": isolated,
        "needs_attention": needs_attn,
        "health_pct": round(online / max(len(agents), 1) * 100),
        "total_incidents": len(incidents),
        "open_incidents": open_inc,
        "critical_incidents": critical_inc,
        "resolved_last_24h": random.randint(1, 5),
        "avg_response_time_min": random.randint(3, 15),
        "threats_blocked_30d": random.randint(20, 150),
    }


@router.get("/huntress/settings")
async def get_huntress_settings(user=Depends(get_current_user)):
    settings = await db.integration_settings.find_one({"type": "huntress"}, {"_id": 0})
    if not settings:
        return {"type": "huntress", "configured": False, "api_key": "", "secret_key": "", "base_url": "https://api.huntress.io/v1", "auto_sync": False, "sync_interval_min": 15, "last_sync": None}
    settings.pop("secret_key_raw", None)
    return settings


@router.put("/huntress/settings")
async def save_huntress_settings(body: dict, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    settings = {
        "type": "huntress",
        "configured": bool(body.get("api_key")),
        "api_key": body.get("api_key", ""),
        "secret_key": body.get("secret_key", "")[:4] + "****" if body.get("secret_key") else "",
        "secret_key_raw": body.get("secret_key", ""),
        "base_url": body.get("base_url", "https://api.huntress.io/v1"),
        "auto_sync": body.get("auto_sync", False),
        "sync_interval_min": body.get("sync_interval_min", 15),
        "updated_at": now,
        "updated_by": user.get("name", "System"),
    }
    await db.integration_settings.update_one({"type": "huntress"}, {"$set": settings}, upsert=True)
    return {"message": "Huntress settings saved", "configured": settings["configured"]}


@router.get("/huntress/test-connection")
async def test_huntress_connection(user=Depends(get_current_user)):
    settings = await db.integration_settings.find_one({"type": "huntress"}, {"_id": 0})
    if not settings or not settings.get("configured"):
        return {"connected": False, "message": "Not configured - using mock data", "mock": True}
    # In production, would make real API call here
    return {"connected": False, "message": "API key saved but live connection not yet implemented - using mock data", "mock": True}


@router.get("/huntress/dashboard")
async def get_huntress_dashboard(user=Depends(get_current_user)):
    """Main Huntress dashboard with all data."""
    agents = generate_mock_agents(25)
    incidents = generate_mock_incidents(12)
    summary = generate_mock_summary(agents, incidents)
    orgs = {}
    for a in agents:
        org = a["organization"]
        if org not in orgs:
            orgs[org] = {"name": org, "agents": 0, "online": 0, "incidents": 0}
        orgs[org]["agents"] += 1
        if a["status"] == "online":
            orgs[org]["online"] += 1
    for inc in incidents:
        org = inc["organization"]
        if org in orgs:
            orgs[org]["incidents"] += 1
    return {
        "summary": summary,
        "agents": agents,
        "incidents": incidents,
        "organizations": list(orgs.values()),
        "mock_data": True,
    }


@router.get("/huntress/agents")
async def get_huntress_agents(user=Depends(get_current_user)):
    return generate_mock_agents(30)


@router.get("/huntress/incidents")
async def get_huntress_incidents(user=Depends(get_current_user)):
    return generate_mock_incidents(15)


@router.get("/soc/dashboard")
async def get_soc_dashboard(user=Depends(get_current_user)):
    """Aggregated SOC dashboard from all sources."""
    agents = generate_mock_agents(30)
    incidents = generate_mock_incidents(15)
    summary = generate_mock_summary(agents, incidents)

    # Get persisted alerts from DB
    db_alerts = await db.soc_alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)

    # Dark web mock
    dark_web = [
        {"id": f"dw-{uuid.uuid4().hex[:6]}", "type": "credential_leak", "source": "Dark Web Forum", "severity": "high", "details": f"Email found in breach: admin@{random.choice(['acmecorp','techstart','summitlegal'])}.com", "found_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 72))).isoformat()}
        for _ in range(random.randint(2, 5))
    ]

    # Vulnerability summary
    vuln_summary = {
        "critical": random.randint(2, 8), "high": random.randint(5, 15),
        "medium": random.randint(10, 30), "low": random.randint(15, 50),
        "last_scan": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 24))).isoformat(),
    }

    return {
        "huntress": summary,
        "agents": agents[:10],
        "incidents": incidents[:8],
        "persisted_alerts": db_alerts[:20],
        "dark_web_alerts": dark_web,
        "vulnerability_summary": vuln_summary,
        "compliance_score": random.randint(65, 95),
        "identity_threats": random.randint(0, 5),
        "phishing_tests_running": random.randint(0, 3),
        "mock_data": True,
    }


@router.get("/soc/alerts")
async def get_soc_alerts(user=Depends(get_current_user)):
    """Get all SOC alerts from all sources."""
    db_alerts = await db.soc_alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    # Merge with mock Huntress incidents
    incidents = generate_mock_incidents(10)
    for inc in incidents:
        # Check if not already in DB
        exists = any(a.get("source_id") == inc["id"] for a in db_alerts)
        if not exists:
            db_alerts.append({
                "id": f"alert-{inc['id']}",
                "source": "huntress",
                "source_id": inc["id"],
                "title": inc["title"],
                "severity": inc["severity"],
                "status": inc["status"] if inc["status"] in ["new", "investigating", "remediated", "closed"] else "new",
                "hostname": inc["hostname"],
                "organization": inc["organization"],
                "description": inc["description"],
                "mitre_attack": inc.get("mitre_attack"),
                "indicators": inc.get("indicators", []),
                "remediation_steps": inc.get("remediation_steps", []),
                "created_at": inc["created_at"],
                "assigned_to": inc.get("assigned_to"),
                "ticket_id": inc.get("ticket_id"),
            })
    db_alerts.sort(key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(x.get("severity", "low"), 4))
    return db_alerts


@router.post("/soc/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "investigating", "acknowledged_by": user.get("name"), "acknowledged_at": now}},
        upsert=True
    )
    return {"message": "Alert acknowledged", "status": "investigating"}


@router.post("/soc/alerts/{alert_id}/create-ticket")
async def create_ticket_from_alert(alert_id: str, body: dict, user=Depends(get_current_user)):
    """Create a ticket from a SOC alert."""
    now = datetime.now(timezone.utc).isoformat()
    ticket_id = str(uuid.uuid4())
    ticket_num = f"SEC-{random.randint(1000,9999)}"

    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_num,
        "title": body.get("title", f"Security Alert: {alert_id}"),
        "description": body.get("description", ""),
        "ticket_type": "incident",
        "priority": body.get("priority", "high"),
        "status": "open",
        "source": "soc_alert",
        "soc_alert_id": alert_id,
        "created_by": user["id"],
        "created_by_name": user.get("name", "System"),
        "created_at": now,
        "updated_at": now,
    }
    ticket_doc = {k: v for k, v in ticket.items()}
    await db.tickets.insert_one(ticket_doc)

    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"ticket_id": ticket_id, "ticket_number": ticket_num, "status": "investigating"}},
        upsert=True
    )
    return {"message": f"Ticket {ticket_num} created", "ticket_id": ticket_id, "ticket_number": ticket_num}


@router.post("/soc/alerts/{alert_id}/isolate")
async def isolate_endpoint(alert_id: str, body: dict, user=Depends(get_current_user)):
    """Isolate an endpoint from a SOC alert."""
    now = datetime.now(timezone.utc).isoformat()
    hostname = body.get("hostname", "Unknown")
    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"isolated": True, "isolated_by": user.get("name"), "isolated_at": now},
         "$push": {"actions": {"type": "isolate", "by": user.get("name"), "at": now, "hostname": hostname}}},
        upsert=True
    )
    await db.soc_isolation_log.insert_one({
        "id": str(uuid.uuid4()), "alert_id": alert_id, "hostname": hostname,
        "action": "isolate", "by": user.get("name"), "at": now,
    })
    return {"message": f"Endpoint {hostname} isolated", "isolated": True}


@router.post("/soc/alerts/{alert_id}/remediate")
async def remediate_alert(alert_id: str, body: dict, user=Depends(get_current_user)):
    """Mark alert as remediated with notes."""
    now = datetime.now(timezone.utc).isoformat()
    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "remediated", "remediated_by": user.get("name"), "remediated_at": now,
                  "remediation_notes": body.get("notes", "")},
         "$push": {"actions": {"type": "remediate", "by": user.get("name"), "at": now, "notes": body.get("notes", "")}}},
        upsert=True
    )
    return {"message": "Alert remediated", "status": "remediated"}


@router.post("/soc/alerts/{alert_id}/close")
async def close_alert(alert_id: str, body: dict, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.soc_alerts.update_one(
        {"id": alert_id},
        {"$set": {"status": "closed", "closed_by": user.get("name"), "closed_at": now,
                  "close_reason": body.get("reason", "Resolved")}},
        upsert=True
    )
    return {"message": "Alert closed"}


# --- Endpoint Security ---
@router.get("/soc/endpoints")
async def get_endpoint_security(user=Depends(get_current_user)):
    agents = generate_mock_agents(30)
    for a in agents:
        a["av_status"] = random.choice(["active", "active", "active", "outdated", "disabled"])
        a["firewall"] = random.choice(["enabled", "enabled", "enabled", "disabled"])
        a["encryption"] = random.choice(["bitlocker", "bitlocker", "filevault", "none"])
        a["patch_status"] = random.choice(["up_to_date", "up_to_date", "pending", "critical_missing"])
        a["last_scan"] = (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 48))).isoformat()
        a["risk_score"] = random.randint(0, 100)
    return agents


@router.post("/soc/endpoints/{agent_id}/scan")
async def trigger_endpoint_scan(agent_id: str, user=Depends(get_current_user)):
    return {"message": f"Scan initiated on {agent_id}", "status": "scanning"}


@router.post("/soc/endpoints/{agent_id}/isolate")
async def isolate_single_endpoint(agent_id: str, user=Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    await db.soc_isolation_log.insert_one({
        "id": str(uuid.uuid4()), "agent_id": agent_id,
        "action": "isolate", "by": user.get("name"), "at": now,
    })
    return {"message": f"Endpoint {agent_id} isolated from network", "isolated": True}


@router.post("/soc/endpoints/{agent_id}/unisolate")
async def unisolate_endpoint(agent_id: str, user=Depends(get_current_user)):
    return {"message": f"Endpoint {agent_id} restored to network", "isolated": False}


# --- Dark Web Monitor ---
@router.get("/soc/dark-web")
async def get_dark_web_alerts(user=Depends(get_current_user)):
    domains = ["acmecorp.com", "techstart.io", "summitlegal.com", "apexdynamics.net", "byteforge.dev"]
    breach_sources = ["Dark Web Forum", "Paste Site", "Telegram Channel", "Ransomware Blog", "Credential Market", "Data Dump"]
    alerts = []
    for i in range(random.randint(5, 15)):
        domain = random.choice(domains)
        alerts.append({
            "id": f"dw-{uuid.uuid4().hex[:8]}",
            "type": random.choice(["credential_leak", "domain_mention", "data_breach", "executive_impersonation", "brand_abuse"]),
            "severity": random.choice(["critical", "high", "high", "medium", "medium", "low"]),
            "source": random.choice(breach_sources),
            "domain": domain,
            "details": f"{'Credentials' if random.random() > 0.5 else 'Mention'} found for {random.choice(['admin','ceo','it.support','billing','sales'])}@{domain}",
            "found_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 720))).isoformat(),
            "status": random.choice(["new", "new", "reviewed", "actioned", "dismissed"]),
            "affected_users": random.randint(1, 25),
            "breach_name": random.choice(["MegaLeak2026", "CorpDump", "ShadowBreach", "PhishPaste", None]),
        })
    alerts.sort(key=lambda x: x["found_at"], reverse=True)
    return {"alerts": alerts, "monitored_domains": domains, "total_findings": len(alerts), "mock_data": True}


# --- Vulnerability Scanner ---
@router.get("/soc/vulnerabilities")
async def get_vulnerabilities(user=Depends(get_current_user)):
    cves = ["CVE-2025-21298", "CVE-2025-0282", "CVE-2024-55591", "CVE-2025-24813", "CVE-2024-50623",
            "CVE-2025-22457", "CVE-2025-29824", "CVE-2024-49138", "CVE-2025-30406", "CVE-2024-20439"]
    vulns = []
    for i in range(random.randint(15, 30)):
        sev = random.choice(["critical", "critical", "high", "high", "medium", "medium", "medium", "low", "low"])
        vulns.append({
            "id": f"vuln-{uuid.uuid4().hex[:8]}",
            "cve": random.choice(cves),
            "title": f"{'Remote Code Execution' if sev == 'critical' else 'Elevation of Privilege' if sev == 'high' else 'Information Disclosure' if sev == 'medium' else 'Denial of Service'} in {random.choice(['Windows Kernel','Exchange Server','IIS','SQL Server','Edge Browser','Office','Defender'])}",
            "severity": sev,
            "cvss": round(random.uniform(3.0, 10.0), 1),
            "affected_hosts": random.randint(1, 20),
            "status": random.choice(["open", "open", "patching", "patched", "accepted_risk"]),
            "discovered_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 60))).isoformat(),
            "patch_available": random.choice([True, True, True, False]),
            "exploited_in_wild": sev in ["critical", "high"] and random.random() > 0.5,
        })
    vulns.sort(key=lambda x: x["cvss"], reverse=True)
    return {"vulnerabilities": vulns, "summary": {
        "critical": len([v for v in vulns if v["severity"] == "critical"]),
        "high": len([v for v in vulns if v["severity"] == "high"]),
        "medium": len([v for v in vulns if v["severity"] == "medium"]),
        "low": len([v for v in vulns if v["severity"] == "low"]),
        "total_hosts_affected": len(set(random.randint(1, 30) for _ in vulns)),
    }, "mock_data": True}


# --- Phishing Simulation ---
@router.get("/soc/phishing")
async def get_phishing_campaigns(user=Depends(get_current_user)):
    campaigns = []
    templates = ["Fake Invoice", "Password Reset", "IT Support", "CEO Wire Transfer", "Shared Document", "Benefits Update"]
    for i in range(random.randint(3, 6)):
        sent = random.randint(20, 100)
        opened = random.randint(int(sent * 0.3), int(sent * 0.8))
        clicked = random.randint(0, int(opened * 0.4))
        reported = random.randint(0, int(sent * 0.3))
        campaigns.append({
            "id": f"phish-{uuid.uuid4().hex[:6]}",
            "name": f"{random.choice(templates)} - {random.choice(['Q1','Q2','Q3','Q4'])} 2026",
            "template": random.choice(templates),
            "status": random.choice(["completed", "completed", "active", "scheduled"]),
            "sent": sent, "opened": opened, "clicked": clicked, "reported": reported,
            "click_rate": round(clicked / max(sent, 1) * 100, 1),
            "report_rate": round(reported / max(sent, 1) * 100, 1),
            "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(1, 90))).isoformat(),
            "organization": random.choice(["Acme Corp", "TechStart Inc", "All Organizations"]),
        })
    return {"campaigns": campaigns, "overall_click_rate": round(sum(c["click_rate"] for c in campaigns) / max(len(campaigns), 1), 1), "mock_data": True}


# --- Identity Threat ---
@router.get("/soc/identity-threats")
async def get_identity_threats(user=Depends(get_current_user)):
    threats = []
    types = ["impossible_travel", "brute_force", "mfa_fatigue", "token_theft", "privilege_escalation", "suspicious_login", "password_spray"]
    for i in range(random.randint(5, 12)):
        threats.append({
            "id": f"idt-{uuid.uuid4().hex[:6]}",
            "type": random.choice(types),
            "severity": random.choice(["critical", "high", "high", "medium", "low"]),
            "user": f"{random.choice(['john.smith','jane.doe','admin','ceo','it.support','billing'])}@{random.choice(['acmecorp','techstart','summitlegal'])}.com",
            "details": f"{'Impossible travel' if random.random() > 0.5 else 'Suspicious login'} from {random.choice(['Russia','China','Nigeria','VPN','Tor Exit Node'])}",
            "source_ip": f"{random.randint(45,220)}.{random.randint(1,255)}.{random.randint(1,255)}.{random.randint(1,255)}",
            "location": random.choice(["Moscow, RU", "Beijing, CN", "Lagos, NG", "Unknown (VPN)", "Tor Network"]),
            "status": random.choice(["new", "new", "investigating", "resolved", "false_positive"]),
            "detected_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 168))).isoformat(),
            "mfa_status": random.choice(["bypassed", "challenged", "not_configured", "passed"]),
        })
    threats.sort(key=lambda x: {"critical": 0, "high": 1, "medium": 2, "low": 3}[x["severity"]])
    return {"threats": threats, "summary": {
        "total": len(threats),
        "critical": len([t for t in threats if t["severity"] == "critical"]),
        "mfa_gaps": random.randint(2, 10),
        "compromised_accounts": random.randint(0, 3),
    }, "mock_data": True}


# --- Smart Automation ---
@router.get("/automation/settings")
async def get_automation_settings(user=Depends(get_current_user)):
    settings = await db.automation_settings.find_one({"type": "global"}, {"_id": 0})
    if not settings:
        return {
            "type": "global",
            "thank_you_detection": True,
            "thank_you_keywords": ["thanks", "thank you", "ty", "cheers", "appreciated", "thx"],
            "stale_ticket_days": 3,
            "stale_ticket_enabled": True,
            "stale_ticket_auto_ping": True,
            "billing_recon_enabled": True,
            "billing_recon_schedule": "weekly",
        }
    return settings


@router.put("/automation/settings")
async def save_automation_settings(body: dict, user=Depends(get_current_user)):
    body["type"] = "global"
    body["updated_at"] = datetime.now(timezone.utc).isoformat()
    body["updated_by"] = user.get("name")
    await db.automation_settings.update_one({"type": "global"}, {"$set": body}, upsert=True)
    return {"message": "Automation settings saved"}


@router.post("/automation/check-thank-you")
async def check_thank_you_responses(user=Depends(get_current_user)):
    """Scan open tickets for thank-you responses and auto-close them."""
    settings = await db.automation_settings.find_one({"type": "global"}, {"_id": 0})
    keywords = (settings or {}).get("thank_you_keywords", ["thanks", "thank you", "ty", "cheers"])
    open_tickets = await db.tickets.find(
        {"status": {"$in": ["open", "waiting_on_client", "resolved"]}},
        {"_id": 0, "id": 1, "title": 1, "conversations": 1, "status": 1}
    ).to_list(500)
    closed_count = 0
    for ticket in open_tickets:
        convos = ticket.get("conversations", [])
        if not convos:
            continue
        last_msg = convos[-1] if convos else {}
        msg_text = (last_msg.get("message", "") or "").lower().strip()
        if len(msg_text) < 50 and any(kw in msg_text for kw in keywords):
            await db.tickets.update_one({"id": ticket["id"]}, {
                "$set": {"status": "closed", "closed_at": datetime.now(timezone.utc).isoformat(), "closed_reason": "auto_thank_you"},
                "$push": {"conversations": {"message": "Auto-closed: Client sent a thank-you response.", "sender": "system", "created_at": datetime.now(timezone.utc).isoformat()}}
            })
            closed_count += 1
    return {"message": f"Scanned {len(open_tickets)} tickets, auto-closed {closed_count}", "closed": closed_count, "scanned": len(open_tickets)}


@router.post("/automation/check-stale-tickets")
async def check_stale_tickets(user=Depends(get_current_user)):
    """Find stale tickets and send reminders."""
    settings = await db.automation_settings.find_one({"type": "global"}, {"_id": 0})
    stale_days = (settings or {}).get("stale_ticket_days", 3)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=stale_days)).isoformat()
    stale = await db.tickets.find(
        {"status": {"$in": ["open", "waiting_on_client"]}, "updated_at": {"$lt": cutoff}},
        {"_id": 0, "id": 1, "title": 1, "ticket_number": 1, "client_name": 1, "updated_at": 1}
    ).to_list(200)
    pinged = 0
    for ticket in stale:
        await db.tickets.update_one({"id": ticket["id"]}, {
            "$push": {"conversations": {"message": f"Automated reminder: This ticket has had no activity for {stale_days}+ days. Please provide an update or this ticket may be auto-closed.", "sender": "system", "created_at": datetime.now(timezone.utc).isoformat()}},
            "$set": {"last_stale_ping": datetime.now(timezone.utc).isoformat()}
        })
        pinged += 1
    return {"message": f"Found {len(stale)} stale tickets, sent {pinged} reminders", "stale_count": len(stale), "pinged": pinged}


@router.get("/automation/billing-recon")
async def get_billing_reconciliation(user=Depends(get_current_user)):
    """Reconcile RMM agent counts against contract line items."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
    contracts = await db.contracts.find({"status": "active"}, {"_id": 0}).to_list(500)
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "client_id": 1, "status": 1}).to_list(5000)

    recon = []
    for client in clients:
        client_contracts = [c for c in contracts if c.get("client_id") == client["id"]]
        client_devices = [d for d in devices if d.get("client_id") == client["id"]]
        contracted_seats = sum(int(c.get("seats", 0) or c.get("quantity", 0) or 0) for c in client_contracts)
        actual_agents = len(client_devices)
        if contracted_seats > 0 or actual_agents > 0:
            diff = actual_agents - contracted_seats
            recon.append({
                "client_id": client["id"],
                "client_name": client["name"],
                "contracted_seats": contracted_seats,
                "actual_agents": actual_agents,
                "difference": diff,
                "status": "match" if diff == 0 else "over" if diff > 0 else "under",
                "revenue_impact": round(diff * 5.0, 2),
            })
    recon.sort(key=lambda x: abs(x["difference"]), reverse=True)
    total_over = sum(r["difference"] for r in recon if r["status"] == "over")
    total_under = sum(abs(r["difference"]) for r in recon if r["status"] == "under")
    return {
        "reconciliation": recon,
        "summary": {
            "total_clients": len(recon),
            "matched": len([r for r in recon if r["status"] == "match"]),
            "over_provisioned": len([r for r in recon if r["status"] == "over"]),
            "under_provisioned": len([r for r in recon if r["status"] == "under"]),
            "total_over_agents": total_over,
            "total_under_agents": total_under,
            "potential_revenue_loss": round(total_over * 5.0, 2),
        },
        "mock_data": False,
    }
