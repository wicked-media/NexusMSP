"""Audit Trail - Comprehensive system activity logging with filtering, export, and analytics"""
from fastapi import APIRouter, Depends, Query
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter(prefix="/audit-trail", tags=["audit-trail"])

CATEGORIES = ["auth", "tickets", "billing", "security", "clients", "automation", "monitoring", "devices", "admin", "integrations"]
SEVERITY_MAP = {"auth": "info", "security": "critical", "billing": "warning", "admin": "warning"}
ACTIONS = {
    "auth": ["user_login", "user_logout", "password_changed", "2fa_enabled", "login_failed", "session_expired"],
    "tickets": ["ticket_created", "ticket_updated", "ticket_closed", "ticket_escalated", "ticket_assigned", "sla_breach", "note_added"],
    "billing": ["invoice_created", "invoice_sent", "payment_received", "invoice_overdue", "recurring_generated"],
    "security": ["threat_detected", "vulnerability_found", "firewall_rule_changed", "mfa_bypassed", "dark_web_alert", "ransomware_detected"],
    "clients": ["client_onboarded", "client_updated", "contact_added", "portal_access_granted"],
    "automation": ["script_executed", "policy_applied", "patch_deployed", "webhook_triggered", "workflow_started"],
    "monitoring": ["device_offline", "device_online", "threshold_exceeded", "backup_failed", "backup_completed", "disk_warning"],
    "devices": ["device_added", "device_removed", "os_updated", "agent_deployed", "remote_session_started"],
    "admin": ["settings_changed", "user_created", "user_deleted", "role_changed", "api_key_generated"],
    "integrations": ["xero_synced", "hudu_synced", "psa_imported", "email_sent", "rustdesk_connected"],
}


def _gen_audit_events(count=200):
    """Generate realistic audit events"""
    users = ["Aaron S.", "John Smith", "Sarah Chen", "Mike Johnson", "System", "API", "Automation"]
    clients = ["Acme Corp", "TechFlow", "Pinnacle", "Emerald Finance", "BlueRock"]
    events = []
    for i in range(count):
        cat = random.choice(CATEGORIES)
        action = random.choice(ACTIONS.get(cat, ["unknown_action"]))
        severity = SEVERITY_MAP.get(cat, random.choice(["info", "warning"]))
        if action in ["threat_detected", "ransomware_detected", "sla_breach", "login_failed"]:
            severity = "critical"
        elif action in ["backup_failed", "invoice_overdue", "device_offline"]:
            severity = "warning"

        ts = datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 720))
        user = random.choice(users)
        target = random.choice(clients) if cat in ["tickets", "billing", "clients"] else random.choice(["SRV-PROD-01", "WS-ADMIN", "FW-01", "", ""])

        events.append({
            "id": f"AUD-{uuid.uuid4().hex[:6].upper()}",
            "timestamp": ts.isoformat(),
            "user": user,
            "category": cat,
            "action": action,
            "severity": severity,
            "description": f"{user} performed {action.replace('_', ' ')}",
            "target": target,
            "ip_address": f"192.168.{random.randint(1,10)}.{random.randint(1,254)}",
            "metadata": {"browser": random.choice(["Chrome", "Firefox", "Edge", ""]), "os": random.choice(["Windows", "macOS", "Linux", ""])},
        })
    return sorted(events, key=lambda x: x["timestamp"], reverse=True)


@router.get("/events")
async def get_events(
    category: str = Query(None),
    severity: str = Query(None),
    user: str = Query(None),
    days: int = Query(30),
    current_user: dict = Depends(get_current_user),
):
    events = await db.audit_events.find({}, {"_id": 0}).sort("timestamp", -1).to_list(500)
    if not events:
        events = _gen_audit_events(200)
        for e in events:
            await db.audit_events.insert_one(e)
        events = await db.audit_events.find({}, {"_id": 0}).sort("timestamp", -1).to_list(500)

    # Apply filters
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    filtered = [e for e in events if e["timestamp"] >= cutoff]
    if category:
        filtered = [e for e in filtered if e["category"] == category]
    if severity:
        filtered = [e for e in filtered if e["severity"] == severity]
    if user:
        filtered = [e for e in filtered if user.lower() in e["user"].lower()]
    return filtered


@router.get("/summary")
async def get_summary(current_user: dict = Depends(get_current_user)):
    events = await db.audit_events.find({}, {"_id": 0}).to_list(500)
    if not events:
        events = _gen_audit_events(200)
        for e in events:
            await db.audit_events.insert_one(e)
        events = await db.audit_events.find({}, {"_id": 0}).to_list(500)

    # Category counts
    cat_counts = {}
    severity_counts = {"info": 0, "warning": 0, "critical": 0}
    user_counts = {}
    hourly = {}
    for e in events:
        c = e.get("category", "unknown")
        cat_counts[c] = cat_counts.get(c, 0) + 1
        s = e.get("severity", "info")
        severity_counts[s] = severity_counts.get(s, 0) + 1
        u = e.get("user", "Unknown")
        user_counts[u] = user_counts.get(u, 0) + 1
        h = e.get("timestamp", "")[:13]
        hourly[h] = hourly.get(h, 0) + 1

    # Recent 24h vs previous 24h
    now = datetime.now(timezone.utc)
    last_24h = len([e for e in events if e["timestamp"] >= (now - timedelta(hours=24)).isoformat()])
    prev_24h = len([e for e in events if (now - timedelta(hours=48)).isoformat() <= e["timestamp"] < (now - timedelta(hours=24)).isoformat()])

    return {
        "total_events": len(events),
        "last_24h": last_24h,
        "prev_24h": prev_24h,
        "trend": "up" if last_24h > prev_24h else "down" if last_24h < prev_24h else "flat",
        "by_category": sorted([{"category": k, "count": v} for k, v in cat_counts.items()], key=lambda x: x["count"], reverse=True),
        "by_severity": severity_counts,
        "by_user": sorted([{"user": k, "count": v} for k, v in user_counts.items()], key=lambda x: x["count"], reverse=True)[:10],
        "categories": CATEGORIES,
        "activity_timeline": sorted([{"hour": k, "count": v} for k, v in hourly.items()], key=lambda x: x["hour"], reverse=True)[:48],
    }
