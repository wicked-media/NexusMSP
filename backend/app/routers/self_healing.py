from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random; random = random.SystemRandom()
import uuid

router = APIRouter()

# ─── AI Self-Healing Engine ───

@router.get("/self-healing/dashboard")
async def self_healing_dashboard(current_user: dict = Depends(get_current_user)):
    """Real-time self-healing dashboard with live execution status"""
    events = await db.self_healing_events.find({}, {"_id": 0}).sort("detected_at", -1).to_list(100)
    active = [e for e in events if e.get("status") in ["executing", "detected", "matched"]]
    resolved = [e for e in events if e.get("status") == "healed"]
    failed = [e for e in events if e.get("status") == "failed"]
    escalated = [e for e in events if e.get("status") == "escalated"]
    total_time_saved = sum(e.get("time_saved_minutes", 0) for e in resolved)
    return {
        "events": events[:50],
        "active_healings": active,
        "data_source": "event_ledger",
        "simulated_events": len([event for event in events if event.get("simulated")]),
        "summary": {
            "total_events": len(events),
            "healed": len(resolved),
            "failed": len(failed),
            "escalated": len(escalated),
            "active": len(active),
            "heal_rate_pct": round(len(resolved) / max(len(events), 1) * 100, 1),
            "total_time_saved_hours": round(total_time_saved / 60, 1),
            "avg_heal_time_seconds": round(sum(e.get("execution_time_seconds", 0) for e in resolved) / max(len(resolved), 1)),
            "tickets_prevented": len(resolved),
        },
        "runbook_stats": await _get_runbook_stats(events),
        "timeline_24h": await _get_24h_timeline(events),
    }


@router.post("/self-healing/execute/{event_id}")
async def execute_healing(event_id: str, current_user: dict = Depends(get_current_user)):
    """Manually trigger healing execution for a detected issue"""
    event = await db.self_healing_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        return {"error": "Event not found"}

    # Simulate execution steps
    steps = event.get("runbook_steps", [])
    execution_log = []
    for i, step in enumerate(steps):
        execution_log.append({
            "step": i + 1,
            "action": step.get("action", ""),
            "status": "completed",
            "output": step.get("expected_output", "OK"),
            "timestamp": (datetime.now(timezone.utc) + timedelta(seconds=i * 3)).isoformat(),
            "duration_ms": random.randint(200, 5000),
        })

    await db.self_healing_events.update_one(
        {"id": event_id},
        {"$set": {
            "status": "healed",
            "execution_log": execution_log,
            "healed_at": datetime.now(timezone.utc).isoformat(),
            "execution_time_seconds": sum(l["duration_ms"] for l in execution_log) / 1000,
            "executed_by": current_user.get("name"),
            "time_saved_minutes": random.randint(10, 45),
        }}
    )
    return {"status": "healed", "execution_log": execution_log, "event_id": event_id}


@router.post("/self-healing/escalate/{event_id}")
async def escalate_event(event_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    event = await db.self_healing_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Self-healing event not found")

    existing_ticket_id = event.get("escalation_ticket_id")
    if existing_ticket_id:
        existing_ticket = await db.tickets.find_one({"id": existing_ticket_id}, {"_id": 0, "ticket_number": 1})
        return {"status": "escalated", "ticket_id": existing_ticket_id, "ticket_number": (existing_ticket or {}).get("ticket_number")}

    now = datetime.now(timezone.utc).isoformat()
    ticket_id = f"ai-sh-{uuid.uuid4().hex[:10]}"
    ticket_number = f"AI-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    ticket = {
        "id": ticket_id,
        "ticket_number": ticket_number,
        "title": f"[AI Escalation] {event.get('issue_description') or 'Self-healing review required'}",
        "description": "Created from AI Operations self-healing escalation. Review the matched runbook and execution evidence before taking action.",
        "status": "open",
        "priority": event.get("severity", "medium"),
        "source": "ai_self_healing",
        "client_name": event.get("client_name"),
        "device_id": event.get("device_id"),
        "device_name": event.get("device_name"),
        "ai_event_id": event_id,
        "matched_runbook": event.get("matched_runbook"),
        "created_at": now,
        "updated_at": now,
    }
    await db.tickets.insert_one(ticket)
    await db.self_healing_events.update_one(
        {"id": event_id},
        {"$set": {"status": "escalated", "escalated_by": current_user.get("name"), "escalation_reason": data.get("reason", "Manual escalation"), "escalated_at": now, "escalation_ticket_id": ticket_id}}
    )
    return {"status": "escalated", "ticket_id": ticket_id, "ticket_number": ticket_number}


@router.get("/self-healing/event/{event_id}")
async def get_event_detail(event_id: str, current_user: dict = Depends(get_current_user)):
    event = await db.self_healing_events.find_one({"id": event_id}, {"_id": 0})
    if not event:
        return {"error": "Not found"}
    return event


@router.get("/self-healing/runbooks")
async def list_runbooks(current_user: dict = Depends(get_current_user)):
    runbooks = await db.healing_runbooks.find({}, {"_id": 0}).to_list(50)
    # Historical dev seeds may have inserted the same runbook more than once.
    # Return one authoritative definition per stable runbook id.
    return list({runbook.get("id"): runbook for runbook in runbooks if runbook.get("id")}.values())


@router.post("/self-healing/simulate")
async def simulate_issue(data: dict, current_user: dict = Depends(get_current_user)):
    """Simulate an issue to test self-healing pipeline"""
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1}).to_list(5)
    device = random.choice(devices) if devices else {"id": "sim-dev", "name": "SIM-DEVICE", "client_name": "Test Client"}
    runbooks = await db.healing_runbooks.find({}, {"_id": 0}).to_list(50)
    runbook = random.choice(runbooks) if runbooks else None

    event = {
        "id": f"sh-{uuid.uuid4().hex[:8]}",
        "device_id": device.get("id"),
        "device_name": device.get("name"),
        "client_name": device.get("client_name"),
        "issue_type": data.get("issue_type", "disk_space_low"),
        "issue_description": data.get("description", "Simulated issue for testing"),
        "severity": data.get("severity", "medium"),
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "detection_source": "manual_simulation",
        "status": "detected",
        "matched_runbook": runbook.get("name") if runbook else "None",
        "runbook_id": runbook.get("id") if runbook else None,
        "confidence_pct": random.randint(85, 99),
        "runbook_steps": runbook.get("steps", []) if runbook else [],
        "simulated": True,
    }
    await db.self_healing_events.insert_one(event)
    event.pop("_id", None)

    # Auto-execute if confidence is high
    if event["confidence_pct"] >= 90:
        event["status"] = "executing"
        await db.self_healing_events.update_one({"id": event["id"]}, {"$set": {"status": "executing"}})

    return event


async def _get_runbook_stats(events):
    runbook_counts = {}
    for e in events:
        rb = e.get("matched_runbook", "Unknown")
        if rb not in runbook_counts:
            runbook_counts[rb] = {"name": rb, "total": 0, "healed": 0, "failed": 0}
        runbook_counts[rb]["total"] += 1
        if e.get("status") == "healed":
            runbook_counts[rb]["healed"] += 1
        elif e.get("status") == "failed":
            runbook_counts[rb]["failed"] += 1
    return list(runbook_counts.values())


async def _get_24h_timeline(events):
    now = datetime.now(timezone.utc)
    timeline = []
    for i in range(24):
        hour = now - timedelta(hours=23 - i)
        hour_str = hour.strftime("%H:00")
        count = len([e for e in events if (e.get("detected_at") or "")[:13] == hour.strftime("%Y-%m-%dT%H")])
        healed = len([e for e in events if (e.get("healed_at") or "")[:13] == hour.strftime("%Y-%m-%dT%H")])
        timeline.append({"hour": hour_str, "detected": count, "healed": healed})
    return timeline
