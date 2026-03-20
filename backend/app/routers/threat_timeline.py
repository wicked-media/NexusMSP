from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/threat-timeline/events")
async def get_threat_events(current_user: dict = Depends(get_current_user)):
    events = await db.threat_events.find({}, {"_id": 0}).sort("detected_at", -1).to_list(200)
    if not events:
        events = await _seed_threats()
    return events

@router.get("/threat-timeline/event/{event_id}")
async def get_threat_detail(event_id: str, current_user: dict = Depends(get_current_user)):
    event = await db.threat_events.find_one({"id": event_id}, {"_id": 0})
    return event or {"error": "Not found"}

@router.post("/threat-timeline/events/{event_id}/resolve")
async def resolve_threat(event_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    await db.threat_events.update_one({"id": event_id}, {"$set": {"resolved": True, "resolved_by": current_user.get("name"), "resolved_at": datetime.now(timezone.utc).isoformat(), "resolution_notes": data.get("notes", "")}})
    return {"status": "resolved"}

async def _seed_threats():
    now = datetime.now(timezone.utc)
    events = [
        {"id": "thr-001", "type": "persistence", "severity": "critical", "device_id": "dev-003", "device_name": "TECH-SRV-01", "client_name": "TechStart Inc", "title": "Suspicious scheduled task created", "description": "New scheduled task 'WinUpdate32' created pointing to C:\\Users\\Public\\svchost.exe - potential persistence mechanism", "mitre_tactic": "TA0003 - Persistence", "mitre_technique": "T1053.005 - Scheduled Task", "process_chain": ["explorer.exe → cmd.exe → schtasks.exe"], "detected_at": (now - timedelta(hours=2)).isoformat(), "resolved": False, "auto_isolated": False},
        {"id": "thr-002", "type": "lateral_movement", "severity": "high", "device_id": "dev-004", "device_name": "GF-DC-MAIN", "client_name": "Global Finance Ltd", "title": "Unusual RDP connections from workstation", "description": "Multiple RDP sessions initiated from GLOB-WS-001 to domain controller - potential lateral movement", "mitre_tactic": "TA0008 - Lateral Movement", "mitre_technique": "T1021.001 - Remote Desktop Protocol", "process_chain": ["mstsc.exe → multiple targets"], "detected_at": (now - timedelta(hours=6)).isoformat(), "resolved": False, "auto_isolated": False},
        {"id": "thr-003", "type": "malware", "severity": "critical", "device_id": "dev-005", "device_name": "HC-WS-REC01", "client_name": "HealthCare Plus", "title": "Ransomware canary file triggered", "description": "Canary file 'NEXUSOPS_CANARY.docx' was modified/encrypted on HC-WS-REC01 - ransomware activity detected!", "mitre_tactic": "TA0040 - Impact", "mitre_technique": "T1486 - Data Encrypted for Impact", "process_chain": ["unknown.exe → file encryption"], "detected_at": (now - timedelta(hours=1)).isoformat(), "resolved": False, "auto_isolated": True},
        {"id": "thr-004", "type": "credential_access", "severity": "medium", "device_id": "dev-001", "device_name": "AGENT-TEST", "client_name": "Acme Corporation", "title": "LSASS memory access detected", "description": "Process mimikatz.exe attempted to access LSASS memory - credential dumping attempt", "mitre_tactic": "TA0006 - Credential Access", "mitre_technique": "T1003.001 - LSASS Memory", "process_chain": ["powershell.exe → mimikatz.exe → lsass.exe"], "detected_at": (now - timedelta(days=1)).isoformat(), "resolved": True, "resolved_by": "Alex Thompson", "resolved_at": (now - timedelta(hours=20)).isoformat()},
        {"id": "thr-005", "type": "exfiltration", "severity": "high", "device_id": "dev-009", "device_name": "GF-LT-CFO01", "client_name": "Global Finance Ltd", "title": "Large data transfer to external IP", "description": "CFO laptop uploading 2.3GB to unknown cloud storage service - possible data exfiltration", "mitre_tactic": "TA0010 - Exfiltration", "mitre_technique": "T1567 - Exfiltration Over Web Service", "process_chain": ["chrome.exe → mega.nz upload"], "detected_at": (now - timedelta(hours=4)).isoformat(), "resolved": False, "auto_isolated": False},
    ]
    for e in events:
        await db.threat_events.insert_one(e)
    return [dict((k, v) for k, v in e.items() if k != "_id") for e in events]
