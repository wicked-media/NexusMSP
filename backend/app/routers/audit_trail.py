from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()

@router.get("/audit-trail/events")
async def get_audit_events(current_user: dict = Depends(get_current_user)):
    events = await db.audit_trail.find({}, {"_id": 0}).sort("timestamp", -1).to_list(500)
    if not events:
        events = await _seed_audit()
    return events

@router.get("/audit-trail/by-user/{user_name}")
async def get_audit_by_user(user_name: str, current_user: dict = Depends(get_current_user)):
    return await db.audit_trail.find({"user": {"$regex": user_name, "$options": "i"}}, {"_id": 0}).sort("timestamp", -1).to_list(100)

@router.get("/audit-trail/summary")
async def get_audit_summary(current_user: dict = Depends(get_current_user)):
    events = await db.audit_trail.find({}, {"_id": 0}).to_list(1000)
    users = {}
    categories = {}
    for e in events:
        u = e.get("user", "Unknown")
        c = e.get("category", "other")
        users[u] = users.get(u, 0) + 1
        categories[c] = categories.get(c, 0) + 1
    return {"total_events": len(events), "by_user": [{"user": k, "count": v} for k, v in sorted(users.items(), key=lambda x: -x[1])], "by_category": [{"category": k, "count": v} for k, v in sorted(categories.items(), key=lambda x: -x[1])]}

async def _seed_audit():
    now = datetime.now(timezone.utc)
    events = [
        {"id": "aud-001", "user": "Alex Thompson", "action": "login", "category": "auth", "description": "Logged in from 203.45.67.10", "ip_address": "203.45.67.10", "timestamp": (now - timedelta(hours=1)).isoformat()},
        {"id": "aud-002", "user": "Alex Thompson", "action": "device_isolated", "category": "security", "description": "Isolated device TECH-SRV-01 due to threat detection", "target": "TECH-SRV-01", "timestamp": (now - timedelta(hours=2)).isoformat()},
        {"id": "aud-003", "user": "Sarah Chen", "action": "ticket_created", "category": "tickets", "description": "Created P1 ticket: Ransomware canary triggered on HC-WS-REC01", "target": "TKT-2026-0847", "timestamp": (now - timedelta(hours=1, minutes=30)).isoformat()},
        {"id": "aud-004", "user": "Mike Rodriguez", "action": "password_reset", "category": "security", "description": "Reset password for partner@summitlegal.com (BEC response)", "target": "partner@summitlegal.com", "timestamp": (now - timedelta(hours=4, minutes=30)).isoformat()},
        {"id": "aud-005", "user": "System", "action": "playbook_executed", "category": "automation", "description": "Ransomware Response playbook auto-executed on HC-WS-REC01", "target": "pb-001", "timestamp": (now - timedelta(hours=1, minutes=5)).isoformat()},
        {"id": "aud-006", "user": "Alex Thompson", "action": "mfa_enforced", "category": "security", "description": "MFA enforcement policy set for HealthCare Plus (14 day deadline)", "target": "client-004", "timestamp": (now - timedelta(hours=6)).isoformat()},
        {"id": "aud-007", "user": "Sarah Chen", "action": "client_created", "category": "clients", "description": "New client onboarded: Quantum Dental Group", "target": "client-015", "timestamp": (now - timedelta(days=2)).isoformat()},
        {"id": "aud-008", "user": "Alex Thompson", "action": "invoice_sent", "category": "billing", "description": "Invoice INV-2026-0134 sent to Acme Corporation ($4,500)", "target": "INV-2026-0134", "timestamp": (now - timedelta(days=1)).isoformat()},
        {"id": "aud-009", "user": "System", "action": "backup_failed", "category": "monitoring", "description": "Backup job failed for GF-DC-MAIN (disk space insufficient)", "target": "bj-004", "timestamp": (now - timedelta(hours=8)).isoformat()},
        {"id": "aud-010", "user": "Mike Rodriguez", "action": "suppression_rule_created", "category": "monitoring", "description": "Created alert suppression rule: Known CrowdStrike False Positive", "target": "asr-004", "timestamp": (now - timedelta(days=15)).isoformat()},
    ]
    for e in events:
        await db.audit_trail.insert_one(e)
    return [dict((k, v) for k, v in e.items() if k != "_id") for e in events]
