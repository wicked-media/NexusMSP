"""
Cross-module notification counts for sidebar nav badges.
Single lightweight endpoint polled every 60s.
"""
from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
from app.routers import chat_presence
from app.services.scope_permissions import scoped_query

router = APIRouter()


@router.get("/nav-counts")
async def nav_counts(current_user: dict = Depends(get_current_user)):
    """Return a dict of nav-path → notification count for sidebar badges."""
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(hours=24)).isoformat()

    # Tickets — open + critical + breached
    open_tickets = await db.tickets.count_documents(
        scoped_query(current_user, {"status": {"$in": ["open", "in_progress"]}})
    )
    critical_tickets = await db.tickets.count_documents(
        scoped_query(current_user, {
            "priority": {"$in": ["critical", "urgent", "p1"]},
            "status": {"$in": ["open", "in_progress"]},
        })
    )
    breached = await db.tickets.count_documents(
        scoped_query(current_user, {
            "sla_due_at": {"$lt": now.isoformat()},
            "status": {"$in": ["open", "in_progress"]},
        })
    )

    # Devices — offline + warning
    offline = await db.devices.count_documents(
        scoped_query(current_user, {"status": "offline"})
    )
    warning = await db.devices.count_documents(
        scoped_query(current_user, {
            "$or": [
                {"cpu_load": {"$gte": 90}},
                {"memory_pct": {"$gte": 90}},
                {"disk_pct": {"$gte": 90}},
                {"checks_failing": {"$gt": 0}},
            ]
        })
    )

    # Alerts active
    try:
        alerts = await db.alerts.count_documents(
            scoped_query(current_user, {"status": "active"})
        )
    except Exception:
        alerts = 0

    # Approvals pending
    try:
        approvals = await db.approvals.count_documents(
            scoped_query(current_user, {"status": "pending"}, site_field=None)
        )
    except Exception:
        approvals = 0

    # Pending invoices/AR
    try:
        unpaid = await db.invoices.count_documents(
            scoped_query(current_user, {"status": {"$in": ["sent", "overdue"]}})
        )
    except Exception:
        unpaid = 0

    # Backup failures
    try:
        backup_fail = await db.backup_jobs.count_documents(
            scoped_query(
                current_user,
                {"status": "failed", "updated_at": {"$gte": day_ago}},
                site_field=None,
            )
        )
    except Exception:
        backup_fail = 0

    # Unread chats
    try:
        unread_by_channel = await chat_presence.unread_counts(current_user=current_user)
        chats = sum(int(count or 0) for count in unread_by_channel.values())
    except Exception:
        chats = 0

    counts = {
        "/tickets":      critical_tickets + breached,
        "/devices":      offline + warning,
        "/security-dashboard": alerts,
        # The sidebar aggregates a parent badge with its child badges. Keep
        # this on the Billing & Finance parent only so unpaid AR is not shown
        # twice when the invoice child is present.
        "/billing-dashboard": unpaid,
        "/team-chat":    chats,
        "/backup-center": backup_fail,
        # Detail rollups (so users see the count even when the parent is collapsed)
        "_meta": {
            "open_tickets": open_tickets,
            "breached": breached,
            "critical": critical_tickets,
            "offline": offline,
            "warning": warning,
            "alerts": alerts,
            "pending_approvals": approvals,
        },
    }
    return counts
