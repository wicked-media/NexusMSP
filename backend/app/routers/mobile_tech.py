from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

# ─── Mobile Tech Dashboard ───

@router.get("/mobile-tech/my-day")
async def my_day(current_user: dict = Depends(get_current_user)):
    """Technician's daily view - optimized for mobile"""
    tickets = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}}, {"_id": 0}).to_list(20)
    if not tickets:
        tickets = _mock_tickets()
    assigned = [t for t in tickets if t.get("assigned_to") in ["Alex Thompson", "current_user"]][:8]
    return {
        "date": datetime.now(timezone.utc).strftime("%A, %B %d"),
        "tech_name": current_user.get("name", "Alex Thompson"),
        "assigned_tickets": assigned or _mock_tickets()[:5],
        "stats": {
            "tickets_today": random.randint(3, 8),
            "completed_today": random.randint(1, 4),
            "avg_response_min": random.randint(8, 25),
            "satisfaction": round(random.uniform(4.2, 5.0), 1),
        },
        "schedule": [
            {"time": "09:00", "type": "ticket", "title": "Server Migration - TechStart Inc", "location": "Remote", "priority": "high"},
            {"time": "10:30", "type": "onsite", "title": "Network Switch Install", "location": "42 Market St", "priority": "medium"},
            {"time": "13:00", "type": "ticket", "title": "Email Delivery Issues", "location": "Remote", "priority": "low"},
            {"time": "14:30", "type": "meeting", "title": "QBR Prep - RetailMax", "location": "Teams", "priority": "medium"},
            {"time": "16:00", "type": "ticket", "title": "Printer Setup x3", "location": "15 Park Ave", "priority": "low"},
        ],
        "quick_actions": ["New Ticket", "Time Entry", "Take Photo", "Scan Asset", "Call Client"],
    }


@router.get("/mobile-tech/queue")
async def tech_queue(current_user: dict = Depends(get_current_user)):
    return {
        "queue": _mock_tickets()[:10],
        "filters": {"statuses": ["open", "in_progress", "waiting"], "priorities": ["critical", "high", "medium", "low"]},
    }


@router.post("/mobile-tech/time-entry")
async def quick_time_entry(body: dict, current_user: dict = Depends(get_current_user)):
    entry = {
        "entry_id": str(uuid.uuid4())[:8],
        "tech": current_user.get("name", "Alex Thompson"),
        "ticket_id": body.get("ticket_id", ""),
        "duration_min": body.get("duration_min", 30),
        "notes": body.get("notes", ""),
        "billable": body.get("billable", True),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.time_entries.insert_one({**entry})
    return {"status": "logged", "entry": entry}


@router.get("/mobile-tech/notifications")
async def tech_notifications(current_user: dict = Depends(get_current_user)):
    return {
        "notifications": [
            {"id": "n1", "type": "escalation", "title": "SLA breach warning", "message": "Ticket #4521 approaching 4h response SLA", "time": "2m ago", "read": False},
            {"id": "n2", "type": "assignment", "title": "New ticket assigned", "message": "Critical: Server down at Global Finance Ltd", "time": "15m ago", "read": False},
            {"id": "n3", "type": "update", "title": "Client replied", "message": "RetailMax updated ticket #4518 with new info", "time": "32m ago", "read": True},
            {"id": "n4", "type": "system", "title": "Patch deployment complete", "message": "Ring 2 deployment finished - 98% success", "time": "1h ago", "read": True},
            {"id": "n5", "type": "approval", "title": "Change request approved", "message": "CR-2024-089: Network switch upgrade approved", "time": "2h ago", "read": True},
        ],
        "unread_count": 2,
    }


def _mock_tickets():
    clients = ["TechStart Inc", "RetailMax", "Global Finance Ltd", "Summit Hotels", "Cascade Media"]
    types = ["Server Issue", "Network Problem", "Email Issue", "Printer Setup", "VPN Access", "Software Install", "Backup Failure"]
    return [
        {
            "ticket_id": f"TK-{random.randint(4500, 4600)}",
            "title": f"{random.choice(types)} - {random.choice(clients)}",
            "client": random.choice(clients),
            "priority": random.choice(["critical", "high", "medium", "low"]),
            "status": random.choice(["open", "in_progress"]),
            "assigned_to": "Alex Thompson",
            "created_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(1, 48))).isoformat(),
            "sla_remaining": f"{random.randint(1, 8)}h",
        }
        for _ in range(10)
    ]
