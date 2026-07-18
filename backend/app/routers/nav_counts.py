"""
Cross-module notification counts for sidebar nav badges.
Single lightweight endpoint polled every 60s.
"""
from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/nav-counts")
async def nav_counts(current_user: dict = Depends(get_current_user)):
    """Return a dict of nav-path → notification count for sidebar badges."""
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(hours=24)).isoformat()

    # Tickets — open + critical + breached
    open_tickets = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
    critical_tickets = await db.tickets.count_documents({
        "priority": {"$in": ["critical", "urgent", "p1"]},
        "status": {"$in": ["open", "in_progress"]},
    })
    breached = await db.tickets.count_documents({
        "sla_due_at": {"$lt": now.isoformat()},
        "status": {"$in": ["open", "in_progress"]},
    })

    # Devices — offline + warning
    offline = await db.devices.count_documents({"status": "offline"})
    warning = await db.devices.count_documents({
        "$or": [
            {"cpu_load": {"$gte": 90}},
            {"memory_pct": {"$gte": 90}},
            {"disk_pct": {"$gte": 90}},
            {"checks_failing": {"$gt": 0}},
        ]
    })

    # Alerts active
    try:
        alerts = await db.alerts.count_documents({"status": "active"})
    except Exception:
        alerts = 0

    # Approvals pending
    try:
        approvals = await db.approvals.count_documents({"status": "pending"})
    except Exception:
        approvals = 0

    # Pending invoices/AR
    try:
        unpaid = await db.invoices.count_documents({"status": {"$in": ["sent", "overdue"]}})
    except Exception:
        unpaid = 0

    # Backup failures
    try:
        backup_fail = await db.backup_jobs.count_documents({"status": "failed", "updated_at": {"$gte": day_ago}})
    except Exception:
        backup_fail = 0

    # Unread chats
    try:
        chats = await db.chat_messages.count_documents({
            "recipient_id": current_user.get("id"),
            "read": {"$ne": True},
        })
    except Exception:
        chats = 0

    # Pending technician invites
    try:
        invites = await db.tech_invites.count_documents({"status": "pending"})
    except Exception:
        invites = 0

    counts = {
        "/tickets":      critical_tickets + breached,
        "/devices":      offline + warning,
        "/security":     alerts,
        "/approvals":    approvals,
        "/invoices":     unpaid,
        "/billing":      unpaid,
        "/team-chat":    chats,
        "/tech-command": invites,
        "/backup":       backup_fail,
        # Detail rollups (so users see the count even when the parent is collapsed)
        "_meta": {
            "open_tickets": open_tickets,
            "breached": breached,
            "critical": critical_tickets,
            "offline": offline,
            "warning": warning,
            "alerts": alerts,
        },
    }
    return counts
