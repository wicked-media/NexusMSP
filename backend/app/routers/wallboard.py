from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/wallboard/data")
async def get_wallboard_data(current_user: dict = Depends(get_current_user)):
    """Get all data for the NOC wallboard display."""
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()

    # Ticket stats
    open_tickets = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "waiting_on_client"]}},
        {"_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "client_name": 1,
         "assigned_to_name": 1, "created_at": 1, "ticket_number": 1}
    ).sort("created_at", -1).to_list(50)

    critical = [t for t in open_tickets if t.get("priority") == "critical"]
    high = [t for t in open_tickets if t.get("priority") == "high"]

    # SLA countdown
    for t in open_tickets:
        created = t.get("created_at", "")
        if created:
            try:
                ct = datetime.fromisoformat(created.replace("Z", "+00:00"))
                sla_hours = {"critical": 2, "high": 4, "medium": 8, "low": 24}.get(t.get("priority", "medium"), 8)
                deadline = ct + timedelta(hours=sla_hours)
                remaining = (deadline - now).total_seconds()
                t["sla_remaining_seconds"] = max(0, int(remaining))
                t["sla_breached"] = remaining < 0
            except Exception:
                t["sla_remaining_seconds"] = 0
                t["sla_breached"] = False

    # Tech availability
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    tech_status = []
    for t in techs:
        active = await db.tickets.count_documents({"assigned_to": t["id"], "status": "in_progress"})
        total = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        tech_status.append({
            "id": t["id"], "name": t["name"],
            "active_tickets": active, "total_open": total,
            "status": "busy" if active >= 3 else "active" if active > 0 else "available",
        })

    # Device health
    total_devices = await db.devices.count_documents({})
    online = await db.devices.count_documents({"status": "online"})
    offline = await db.devices.count_documents({"status": "offline"})
    alerts = await db.predictive_alerts.count_documents({"status": "active"})

    # Today's stats
    resolved_today = await db.tickets.count_documents({"resolved_at": {"$regex": f"^{today}"}})

    # Recent activity
    recent_activity = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(10)

    return {
        "timestamp": now.isoformat(),
        "tickets": {
            "open": len(open_tickets), "critical": len(critical), "high": len(high),
            "resolved_today": resolved_today,
            "queue": open_tickets[:20],
        },
        "technicians": tech_status,
        "devices": {
            "total": total_devices, "online": online, "offline": offline,
            "uptime_pct": round((online / max(total_devices, 1)) * 100, 1),
            "active_alerts": alerts,
        },
        "recent_activity": recent_activity[:8],
    }


@router.get("/wallboard/public")
async def get_public_wallboard():
    """Public wallboard data (no auth) - limited data for TV display."""
    now = datetime.now(timezone.utc)
    open_count = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
    critical = await db.tickets.count_documents({"priority": "critical", "status": {"$in": ["open", "in_progress"]}})
    total_devices = await db.devices.count_documents({})
    online = await db.devices.count_documents({"status": "online"})
    today = now.date().isoformat()
    resolved_today = await db.tickets.count_documents({"resolved_at": {"$regex": f"^{today}"}})

    return {
        "timestamp": now.isoformat(),
        "open_tickets": open_count, "critical_tickets": critical,
        "resolved_today": resolved_today,
        "devices_total": total_devices, "devices_online": online,
        "uptime_pct": round((online / max(total_devices, 1)) * 100, 1),
    }
