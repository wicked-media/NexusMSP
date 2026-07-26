from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()

@router.get("/morning-checks")
async def get_morning_checks(current_user: dict = Depends(get_current_user)):
    """Aggregate all critical morning check data for MSP NOC team"""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    yesterday = (now - timedelta(days=1)).isoformat()

    # 1. Device Health
    all_devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "hostname": 1, "status": 1, "client_name": 1, "device_type": 1, "last_seen": 1, "os": 1}).to_list(1000)
    online = [d for d in all_devices if d.get("status") == "online"]
    offline = [d for d in all_devices if d.get("status") == "offline"]
    warning = [d for d in all_devices if d.get("status") in ("warning", "degraded")]

    # 2. Open Tickets (critical/high, unassigned, SLA breaches)
    open_tickets = await db.tickets.find({"status": {"$in": ["open", "in_progress", "on_hold"]}}, {"_id": 0, "id": 1, "title": 1, "priority": 1, "status": 1, "client_name": 1, "assigned_to": 1, "assigned_name": 1, "sla_due": 1, "created_at": 1}).to_list(500)
    critical_tickets = [t for t in open_tickets if t.get("priority") in ("critical", "high")]
    unassigned = [t for t in open_tickets if not t.get("assigned_to")]
    sla_breaches = [t for t in open_tickets if t.get("sla_due") and t["sla_due"] < now.isoformat() and t.get("status") not in ("closed", "resolved")]
    overnight_tickets = await db.tickets.find({"created_at": {"$gte": yesterday}, "status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1, "title": 1, "priority": 1, "client_name": 1, "created_at": 1}).to_list(100)

    # 3. Backup Status
    backups = await db.backup_jobs.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "last_run": 1, "next_run": 1, "type": 1}).to_list(500)
    backup_failed = [b for b in backups if b.get("status") in ("failed", "error")]
    backup_warning = [b for b in backups if b.get("status") == "warning"]
    backup_success = [b for b in backups if b.get("status") in ("success", "completed")]

    # 4. Security Alerts
    alerts = await db.security_alerts.find({"created_at": {"$gte": yesterday}}, {"_id": 0}).sort("created_at", -1).to_list(50)
    critical_alerts = [a for a in alerts if a.get("severity") in ("critical", "high")]

    # 5. Yeastar Phone Status (client-linked PBXs only)
    yeastar_pbxs = await db.yeastar_pbxs.find(
        {"enabled": {"$ne": False}},
        {"_id": 0, "status": 1, "pbx_url": 1, "client_api_id": 1, "client_secret": 1},
    ).to_list(500)
    yeastar_configured = any(
        pbx.get("pbx_url") and pbx.get("client_api_id") and pbx.get("client_secret")
        for pbx in yeastar_pbxs
    )

    # 6. Client Health Summary
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    client_health = []
    for client in clients[:30]:
        c_devices = [d for d in all_devices if d.get("client_name") == client["name"]]
        c_offline = [d for d in c_devices if d.get("status") == "offline"]
        c_tickets = [t for t in open_tickets if t.get("client_name") == client["name"]]
        c_critical = [t for t in c_tickets if t.get("priority") in ("critical", "high")]
        c_backups_failed = [b for b in backup_failed if b.get("client_name") == client["name"]]
        issues = len(c_offline) + len(c_critical) + len(c_backups_failed)
        status = "red" if issues >= 3 or len(c_critical) > 0 or len(c_backups_failed) > 0 else "amber" if issues >= 1 or len(c_offline) > 0 else "green"
        if c_devices or c_tickets:
            client_health.append({
                "client_name": client["name"],
                "status": status,
                "devices_total": len(c_devices),
                "devices_offline": len(c_offline),
                "open_tickets": len(c_tickets),
                "critical_tickets": len(c_critical),
                "backups_failed": len(c_backups_failed),
            })
    client_health.sort(key=lambda c: {"red": 0, "amber": 1, "green": 2}.get(c["status"], 3))

    # 7. Scheduled Tasks for Today
    tasks_today = await db.scheduled_tasks.find({"enabled": True}, {"_id": 0, "id": 1, "name": 1, "script_name": 1, "schedule_type": 1, "schedule_time": 1, "last_run": 1}).to_list(100)

    # 8. Recurring Invoices Due
    rec_due = await db.xero_recurring.find({"status": "active", "next_generation": {"$lte": today_str}}, {"_id": 0, "id": 1, "client_name": 1, "description": 1, "amount": 1, "next_generation": 1}).to_list(50)

    # 9. Patch Status
    patch_stats = await db.patches.find({"status": "pending"}, {"_id": 0}).to_list(100)
    critical_patches = [p for p in patch_stats if p.get("severity") in ("critical", "important")]

    # 10. Overdue Invoices
    overdue_invoices = await db.xero_invoices.find({"status": "AUTHORISED", "due_date": {"$lt": today_str}}, {"_id": 0, "id": 1, "invoice_number": 1, "client_name": 1, "amount_due": 1, "due_date": 1}).to_list(100)

    # Calculate overall health score
    total_issues = len(offline) + len(critical_tickets) + len(sla_breaches) + len(backup_failed) + len(critical_alerts)
    max_issues = max(len(all_devices), 1) + max(len(open_tickets), 1)
    health_score = max(0, min(100, int(100 - (total_issues / max(max_issues * 0.1, 1)) * 100)))

    return {
        "timestamp": now.isoformat(),
        "health_score": health_score,
        "devices": {
            "total": len(all_devices),
            "online": len(online),
            "offline": len(offline),
            "warning": len(warning),
            "offline_list": [{"id": d.get("id", ""), "name": d.get("name") or d.get("hostname", "Unknown"), "client_name": d.get("client_name", ""), "device_type": d.get("device_type", ""), "last_seen": d.get("last_seen", "")} for d in offline[:20]],
        },
        "tickets": {
            "total_open": len(open_tickets),
            "critical_high": len(critical_tickets),
            "unassigned": len(unassigned),
            "sla_breaches": len(sla_breaches),
            "overnight_new": len(overnight_tickets),
            "critical_list": [{"id": t["id"], "title": t["title"], "priority": t.get("priority"), "client_name": t.get("client_name", ""), "status": t.get("status"), "assigned_name": t.get("assigned_name", "")} for t in critical_tickets[:15]],
            "sla_breach_list": [{"id": t["id"], "title": t["title"], "client_name": t.get("client_name", ""), "sla_due": t.get("sla_due", "")} for t in sla_breaches[:10]],
            "overnight_list": [{"id": t["id"], "title": t["title"], "priority": t.get("priority"), "client_name": t.get("client_name", ""), "created_at": t.get("created_at", "")} for t in overnight_tickets[:10]],
        },
        "backups": {
            "total": len(backups),
            "success": len(backup_success),
            "failed": len(backup_failed),
            "warning": len(backup_warning),
            "failed_list": [{"name": b.get("name", ""), "client_name": b.get("client_name", ""), "last_run": b.get("last_run", ""), "type": b.get("type", "")} for b in backup_failed[:10]],
        },
        "security": {
            "alerts_24h": len(alerts),
            "critical_alerts": len(critical_alerts),
            "alert_list": [{"id": a.get("id", ""), "title": a.get("title", a.get("message", "")), "severity": a.get("severity", ""), "created_at": a.get("created_at", "")} for a in critical_alerts[:10]],
        },
        "phones": {
            "configured": yeastar_configured,
            "pbx_count": len(yeastar_pbxs),
            "online": len([pbx for pbx in yeastar_pbxs if pbx.get("status") == "online"]),
            "attention": len([pbx for pbx in yeastar_pbxs if pbx.get("status") != "online"]),
        },
        "client_health": client_health,
        "scheduled_tasks": [{"name": t.get("name", ""), "script_name": t.get("script_name", ""), "schedule_time": t.get("schedule_time", ""), "last_run": t.get("last_run", "")} for t in tasks_today[:10]],
        "recurring_due": [{"client_name": r.get("client_name", ""), "description": r.get("description", ""), "amount": r.get("amount", 0)} for r in rec_due],
        "patches_pending": len(critical_patches),
        "overdue_invoices": {
            "count": len(overdue_invoices),
            "total_amount": sum(i.get("amount_due", 0) for i in overdue_invoices),
            "list": [{"invoice_number": i.get("invoice_number", ""), "client_name": i.get("client_name", ""), "amount_due": i.get("amount_due", 0), "due_date": i.get("due_date", "")} for i in overdue_invoices[:10]],
        },
    }
