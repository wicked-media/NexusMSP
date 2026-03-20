from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()

@router.get("/identity-threats/overview")
async def get_identity_overview(current_user: dict = Depends(get_current_user)):
    threats = await db.identity_threats.find({}, {"_id": 0}).sort("detected_at", -1).to_list(200)
    if not threats:
        threats = await _seed_identity_threats()
    active = [t for t in threats if not t.get("resolved")]
    return {"summary": {"total_alerts": len(threats), "active": len(active), "critical": sum(1 for t in active if t.get("severity") == "critical"), "high": sum(1 for t in active if t.get("severity") == "high")}, "threats": threats}

@router.post("/identity-threats/{threat_id}/resolve")
async def resolve_identity_threat(threat_id: str, current_user: dict = Depends(get_current_user)):
    await db.identity_threats.update_one({"id": threat_id}, {"$set": {"resolved": True, "resolved_by": current_user.get("name"), "resolved_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "resolved"}

async def _seed_identity_threats():
    now = datetime.now(timezone.utc)
    threats = [
        {"id": "idt-001", "type": "impossible_travel", "severity": "high", "tenant": "Acme Corporation", "provider": "Azure AD", "user_email": "john.smith@acme.com", "title": "Impossible travel detected", "description": "Login from New York (10:00 AM) and Shanghai (10:45 AM) - physically impossible travel", "source_ips": ["203.45.67.10", "116.25.88.142"], "detected_at": (now - timedelta(hours=3)).isoformat(), "resolved": False},
        {"id": "idt-002", "type": "rogue_oauth", "severity": "critical", "tenant": "Global Finance Ltd", "provider": "Microsoft 365", "user_email": "cfo@globalfin.com", "title": "Suspicious OAuth app consent", "description": "User consented to 'DocuSync Pro' app requesting Mail.ReadWrite and Files.ReadWrite.All permissions", "app_name": "DocuSync Pro", "permissions_requested": ["Mail.ReadWrite", "Files.ReadWrite.All", "User.Read"], "detected_at": (now - timedelta(hours=1)).isoformat(), "resolved": False},
        {"id": "idt-003", "type": "bec", "severity": "critical", "tenant": "Summit Legal Group", "provider": "Microsoft 365", "user_email": "partner@summitlegal.com", "title": "Business Email Compromise suspected", "description": "Inbox rule created to forward all emails containing 'wire transfer' to external address", "rule_details": "Forward to: partner-legal@protonmail.com when subject contains 'wire transfer'", "detected_at": (now - timedelta(hours=5)).isoformat(), "resolved": False},
        {"id": "idt-004", "type": "session_hijack", "severity": "high", "tenant": "TechStart Inc", "provider": "Google Workspace", "user_email": "dev@techstart.io", "title": "Session token reuse from new location", "description": "Existing session token used from a new IP/location that doesn't match original authentication", "detected_at": (now - timedelta(hours=8)).isoformat(), "resolved": True, "resolved_by": "Sarah Chen"},
        {"id": "idt-005", "type": "brute_force", "severity": "medium", "tenant": "HealthCare Plus", "provider": "Azure AD", "user_email": "admin@hcplus.org", "title": "Brute force login attempts", "description": "127 failed login attempts from 5 different IPs in the last 30 minutes", "attempt_count": 127, "source_ips": ["185.143.0.5", "185.143.0.12", "91.234.56.78", "45.67.89.100", "23.45.67.89"], "detected_at": (now - timedelta(hours=12)).isoformat(), "resolved": True, "resolved_by": "Mike Rodriguez"},
    ]
    for t in threats:
        await db.identity_threats.insert_one(t)
    return [dict((k, v) for k, v in t.items() if k != "_id") for t in threats]
