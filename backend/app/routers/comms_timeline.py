from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

@router.get("/comms-timeline/client/{client_name}")
async def client_timeline(client_name: str, current_user: dict = Depends(get_current_user)):
    events = await db.comms_timeline.find({"client_name": client_name}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    if not events:
        events = await _seed_comms(client_name)
    return {"client_name": client_name, "events": events, "summary": {"total": len(events), "emails": len([e for e in events if e.get("type") == "email"]), "tickets": len([e for e in events if e.get("type") == "ticket"]), "calls": len([e for e in events if e.get("type") == "call"]), "meetings": len([e for e in events if e.get("type") == "meeting"])}}

@router.get("/comms-timeline/overview")
async def comms_overview(current_user: dict = Depends(get_current_user)):
    clients = ["TechStart Inc", "Global Finance Ltd", "HealthCare Plus", "NovaTech Research", "Pacific Schools District"]
    result = []
    for c in clients:
        events = await db.comms_timeline.find({"client_name": c}, {"_id": 0}).to_list(5)
        if not events:
            events = await _seed_comms(c)
        result.append({"client_name": c, "last_contact": events[0].get("timestamp") if events else None, "total_interactions": len(events), "recent": events[:3]})
    return result

async def _seed_comms(client_name):
    types_templates = [
        ("email", "Sent monthly security report", "Alex Thompson"),
        ("ticket", "Resolved printer issue #TK-4521", "Sarah Chen"),
        ("call", "Quarterly check-in call (30 min)", "Alex Thompson"),
        ("meeting", "On-site network review meeting", "Mike Rodriguez"),
        ("email", "Follow-up on backup alert", "Lisa Park"),
        ("ticket", "New user onboarding request", "Jake Wilson"),
        ("call", "Urgent: Server down notification", "Alex Thompson"),
        ("email", "Invoice #INV-2025-0234 sent", "System"),
    ]
    events = []
    for i, (etype, desc, author) in enumerate(types_templates):
        e = {"id": f"ct-{uuid.uuid4().hex[:8]}", "client_name": client_name, "type": etype, "description": desc, "author": author, "timestamp": (datetime.now(timezone.utc) - timedelta(days=i * 3 + random.randint(0, 5))).isoformat(), "direction": random.choice(["inbound", "outbound"])}
        events.append(e)
        await db.comms_timeline.insert_one(e)
    return [{k: v for k, v in e.items() if k != "_id"} for e in events]
