from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random

router = APIRouter()

@router.get("/soc-feed/events")
async def get_soc_feed(current_user: dict = Depends(get_current_user)):
    events = await db.soc_events.find({}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    if not events:
        events = await _seed_soc_events()
    return events

@router.get("/soc-feed/stats")
async def get_soc_stats(current_user: dict = Depends(get_current_user)):
    events = await db.soc_events.find({}, {"_id": 0}).to_list(500)
    return {"total_events": len(events), "investigations": sum(1 for e in events if e.get("type") == "investigation"), "responses": sum(1 for e in events if e.get("type") == "response"), "resolutions": sum(1 for e in events if e.get("type") == "resolution"), "avg_response_time_min": round(random.uniform(4, 12), 1), "mttr_hours": round(random.uniform(1.5, 4.2), 1)}

async def _seed_soc_events():
    now = datetime.now(timezone.utc)
    analysts = ["Alex T. (L1)", "Sarah C. (L2)", "Mike R. (L3)", "NexusOps AI"]
    events = [
        {"id": "soc-001", "type": "investigation", "analyst": "NexusOps AI", "title": "Automated triage: Suspicious scheduled task on TECH-SRV-01", "description": "AI detected persistence mechanism. Escalating to L2 analyst for human review.", "client_name": "TechStart Inc", "severity": "critical", "timestamp": (now - timedelta(hours=2, minutes=5)).isoformat()},
        {"id": "soc-002", "type": "response", "analyst": "Sarah C. (L2)", "title": "Confirmed malicious: Isolating TECH-SRV-01", "description": "Scheduled task confirmed as malicious. Endpoint isolated. Running remediation playbook.", "client_name": "TechStart Inc", "severity": "critical", "timestamp": (now - timedelta(hours=2)).isoformat()},
        {"id": "soc-003", "type": "investigation", "analyst": "NexusOps AI", "title": "BEC attempt detected on Summit Legal partner account", "description": "Inbox rule forwarding wire transfer emails to external address. Account flagged for immediate review.", "client_name": "Summit Legal Group", "severity": "critical", "timestamp": (now - timedelta(hours=5, minutes=10)).isoformat()},
        {"id": "soc-004", "type": "response", "analyst": "Mike R. (L3)", "title": "BEC remediation complete - Summit Legal", "description": "Malicious inbox rule removed. Password reset forced. MFA re-enrolled. All sessions revoked.", "client_name": "Summit Legal Group", "severity": "critical", "timestamp": (now - timedelta(hours=4, minutes=30)).isoformat()},
        {"id": "soc-005", "type": "resolution", "analyst": "Sarah C. (L2)", "title": "False positive: LSASS access by security tool", "description": "CrowdStrike sensor triggered LSASS access alert on ACME-DC01. Confirmed legitimate security scan.", "client_name": "Acme Corporation", "severity": "low", "timestamp": (now - timedelta(days=1)).isoformat()},
        {"id": "soc-006", "type": "investigation", "analyst": "NexusOps AI", "title": "Ransomware canary triggered on HC-WS-REC01", "description": "Canary file encryption detected. Auto-isolation executed. Forensic data collection in progress.", "client_name": "HealthCare Plus", "severity": "critical", "timestamp": (now - timedelta(hours=1, minutes=5)).isoformat()},
        {"id": "soc-007", "type": "response", "analyst": "Alex T. (L1)", "title": "Data exfiltration investigation - Global Finance CFO laptop", "description": "Analyzing 2.3GB upload to mega.nz from CFO laptop. User contacted for verification.", "client_name": "Global Finance Ltd", "severity": "high", "timestamp": (now - timedelta(hours=3, minutes=45)).isoformat()},
        {"id": "soc-008", "type": "resolution", "analyst": "Alex T. (L1)", "title": "Confirmed authorized: CFO uploading board presentation", "description": "CFO confirmed uploading quarterly board presentation to personal storage. Advisory issued on policy compliance.", "client_name": "Global Finance Ltd", "severity": "info", "timestamp": (now - timedelta(hours=3)).isoformat()},
    ]
    for e in events:
        await db.soc_events.insert_one(e)
    return [dict((k, v) for k, v in e.items() if k != "_id") for e in events]
