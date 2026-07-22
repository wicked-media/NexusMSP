from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db


router = APIRouter()

OPEN_TICKET_STATUSES = ["open", "pending", "in_progress", "on_hold", "waiting", "waiting_on_client"]


def _as_utc(value):
    """Return a timezone-aware timestamp for a persisted value, or None."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _ticket_sla(ticket: dict, now: datetime) -> dict:
    """Expose only a stored SLA target; never infer one from ticket priority."""
    due = _as_utc(ticket.get("sla_due") or ticket.get("sla_due_at"))
    if due is None:
        return {
            "sla_state": "not_assessed",
            "sla_remaining_seconds": None,
            "sla_breached": False,
        }
    remaining = int((due - now).total_seconds())
    return {
        "sla_state": "breached" if remaining < 0 else "measured",
        "sla_remaining_seconds": max(0, remaining),
        "sla_breached": remaining < 0,
        "sla_due": due.isoformat(),
    }


def _presence_from_record(record: dict | None, now: datetime) -> dict:
    """Use the same heartbeat semantics as Team Chat, while retaining the source."""
    if not record:
        return {"presence": "not_reported", "seconds_since_heartbeat": None, "work_item": None}

    seconds = None
    heartbeat = _as_utc(record.get("last_heartbeat"))
    if heartbeat:
        seconds = max(0, int((now - heartbeat).total_seconds()))

    manual_state = record.get("manual_state")
    if seconds is None or seconds > 300:
        state = "offline"
    elif manual_state in {"dnd", "break", "away"}:
        state = manual_state
    elif record.get("busy_state"):
        state = "busy"
    elif seconds > 45:
        state = "away"
    else:
        state = "active"
    return {
        "presence": state,
        "seconds_since_heartbeat": seconds,
        "work_item": record.get("busy_state"),
    }


@router.get("/wallboard/data")
async def get_wallboard_data(current_user: dict = Depends(get_current_user)):
    """Operational wallboard backed by recorded ticket, device and chat evidence."""
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()

    open_tickets = await db.tickets.find(
        {"status": {"$in": OPEN_TICKET_STATUSES}},
        {
            "_id": 0,
            "id": 1,
            "title": 1,
            "status": 1,
            "priority": 1,
            "client_name": 1,
            "assigned_to": 1,
            "assigned_to_name": 1,
            "assignee_id": 1,
            "assignee_name": 1,
            "created_at": 1,
            "ticket_number": 1,
            "sla_due": 1,
            "sla_due_at": 1,
        },
    ).sort("created_at", -1).to_list(100)

    for ticket in open_tickets:
        ticket.update(_ticket_sla(ticket, now))
        ticket["assigned_to_name"] = ticket.get("assigned_to_name") or ticket.get("assignee_name")

    critical = sum(1 for ticket in open_tickets if ticket.get("priority") in {"critical", "urgent", "p1"})
    high = sum(1 for ticket in open_tickets if ticket.get("priority") == "high")
    measured_slas = sum(1 for ticket in open_tickets if ticket.get("sla_state") != "not_assessed")
    breached_slas = sum(1 for ticket in open_tickets if ticket.get("sla_breached"))

    techs = await db.users.find(
        {"role": {"$in": ["technician", "admin"]}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(100)
    tech_ids = [tech.get("id") for tech in techs if tech.get("id")]
    presence_rows = await db.presence_state.find(
        {"user_id": {"$in": tech_ids}},
        {"_id": 0, "user_id": 1, "last_heartbeat": 1, "manual_state": 1, "busy_state": 1},
    ).to_list(200)
    presence_by_user = {row.get("user_id"): row for row in presence_rows}

    tech_status = []
    for tech in techs:
        tech_id = tech.get("id")
        active = await db.tickets.count_documents(
            {
                "$or": [{"assigned_to": tech_id}, {"assignee_id": tech_id}],
                "status": "in_progress",
            }
        )
        total = await db.tickets.count_documents(
            {
                "$or": [{"assigned_to": tech_id}, {"assignee_id": tech_id}],
                "status": {"$in": OPEN_TICKET_STATUSES},
            }
        )
        workload = "at_capacity" if active >= 3 else "active" if active else "queued" if total else "clear"
        tech_status.append(
            {
                "id": tech_id,
                "name": tech.get("name") or "Unnamed technician",
                "active_tickets": active,
                "total_open": total,
                "workload_state": workload,
                **_presence_from_record(presence_by_user.get(tech_id), now),
            }
        )

    device_rows = await db.devices.find(
        {},
        {
            "_id": 0,
            "status": 1,
            "last_heartbeat": 1,
            "agent_version": 1,
            "trmm_agent_id": 1,
            "has_agent": 1,
        },
    ).to_list(5000)
    enrolled_devices = [
        device
        for device in device_rows
        if device.get("last_heartbeat") or device.get("agent_version") or device.get("trmm_agent_id") or device.get("has_agent")
    ]
    online = sum(1 for device in enrolled_devices if device.get("status") == "online")
    offline = sum(1 for device in enrolled_devices if device.get("status") == "offline")
    availability_pct = round((online / len(enrolled_devices)) * 100, 1) if enrolled_devices else None
    alerts = await db.predictive_alerts.count_documents({"status": "active"})

    resolved_today = await db.tickets.count_documents({"resolved_at": {"$regex": f"^{today}"}})
    recent_activity = await db.activity_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(8)

    return {
        "timestamp": now.isoformat(),
        "data_sources": {
            "tickets": "Persisted service records",
            "sla": "Stored ticket SLA due dates only",
            "technicians": "Team Chat heartbeat and ticket workload",
            "devices": "Enrolled agent or linked RMM device records",
        },
        "tickets": {
            "open": len(open_tickets),
            "critical": critical,
            "high": high,
            "resolved_today": resolved_today,
            "sla_measured": measured_slas,
            "sla_breached": breached_slas,
            "queue": open_tickets[:20],
        },
        "technicians": tech_status,
        "devices": {
            "inventory_total": len(device_rows),
            "enrolled": len(enrolled_devices),
            "unmonitored": len(device_rows) - len(enrolled_devices),
            "online": online,
            "offline": offline,
            "availability_pct": availability_pct,
            "active_alerts": alerts,
        },
        "recent_activity": recent_activity,
    }


@router.get("/wallboard/public")
async def get_public_wallboard():
    """Limited TV wallboard data; device availability only covers enrolled endpoints."""
    now = datetime.now(timezone.utc)
    open_count = await db.tickets.count_documents({"status": {"$in": OPEN_TICKET_STATUSES}})
    critical = await db.tickets.count_documents(
        {"priority": {"$in": ["critical", "urgent", "p1"]}, "status": {"$in": OPEN_TICKET_STATUSES}}
    )
    device_rows = await db.devices.find(
        {}, {"_id": 0, "status": 1, "last_heartbeat": 1, "agent_version": 1, "trmm_agent_id": 1, "has_agent": 1}
    ).to_list(5000)
    enrolled = [
        device
        for device in device_rows
        if device.get("last_heartbeat") or device.get("agent_version") or device.get("trmm_agent_id") or device.get("has_agent")
    ]
    online = sum(1 for device in enrolled if device.get("status") == "online")
    today = now.date().isoformat()
    resolved_today = await db.tickets.count_documents({"resolved_at": {"$regex": f"^{today}"}})

    return {
        "timestamp": now.isoformat(),
        "open_tickets": open_count,
        "critical_tickets": critical,
        "resolved_today": resolved_today,
        "devices_total": len(device_rows),
        "devices_enrolled": len(enrolled),
        "devices_online": online,
        "availability_pct": round((online / len(enrolled)) * 100, 1) if enrolled else None,
    }
