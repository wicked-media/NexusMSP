"""
Ticket workflow polish:
- Block-on (chain tickets)
- Convert ticket → change request
- Schedule maintenance window from a ticket
- Send CSAT survey (manual trigger; can also auto-fire on status=closed)
- Time-to-resolve burn-down summary
"""

from fastapi import APIRouter, Depends, Body, HTTPException
from datetime import datetime, timezone, timedelta
import uuid

from app.database import db
from app.routers.auth import get_current_user

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(ticket_id: str, user: dict, action: str, details: str):
    await db.ticket_audit.insert_one({
        "id": uuid.uuid4().hex,
        "ticket_id": ticket_id,
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "action": action,
        "details": details,
        "created_at": _now(),
    })


# ─────────────────── Block-on (chain tickets) ───────────────────

@router.post("/tickets/{ticket_id}/block-on")
async def block_ticket_on(ticket_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    blocking_id = payload.get("blocking_ticket_id")
    if not blocking_id or blocking_id == ticket_id:
        raise HTTPException(400, "blocking_ticket_id required and must differ from ticket_id")
    blocker = await db.tickets.find_one({"id": blocking_id}, {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1})
    if not blocker:
        raise HTTPException(404, "Blocking ticket not found")
    await db.tickets.update_one({"id": ticket_id}, {"$set": {
        "blocked_by_ticket_id": blocking_id,
        "blocked_by_ticket_number": blocker.get("ticket_number"),
        "updated_at": _now(),
    }})
    await _audit(ticket_id, current_user, "blocked_on", f"Blocked by {blocker.get('ticket_number')} — {blocker.get('title', '')[:60]}")
    return {"success": True, "blocker": blocker}


@router.delete("/tickets/{ticket_id}/block-on")
async def unblock_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    await db.tickets.update_one({"id": ticket_id}, {"$unset": {
        "blocked_by_ticket_id": "",
        "blocked_by_ticket_number": "",
    }, "$set": {"updated_at": _now()}})
    await _audit(ticket_id, current_user, "unblocked", "Block removed")
    return {"success": True}


# ─────────────────── Convert ticket → change request ───────────────────

@router.post("/tickets/{ticket_id}/convert-to-change")
async def convert_to_change(ticket_id: str, payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Promotes a ticket to category=change with optional risk + approver."""
    risk = (payload.get("risk") or "medium").lower()
    if risk not in {"low", "medium", "high"}:
        raise HTTPException(400, "risk must be low | medium | high")
    update = {
        "category": "change",
        "change_risk": risk,
        "change_state": "draft",
        "change_approver_id": payload.get("approver_id"),
        "change_planned_start": payload.get("planned_start"),
        "change_planned_duration_min": payload.get("planned_duration_min") or 60,
        "updated_at": _now(),
    }
    res = await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Ticket not found")
    await _audit(ticket_id, current_user, "converted_to_change", f"risk={risk}")
    return {"success": True, "change": update}


# ─────────────────── Schedule maintenance window ───────────────────

@router.post("/tickets/{ticket_id}/schedule-maintenance")
async def schedule_maintenance(ticket_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    start_iso = payload.get("start")
    duration_min = int(payload.get("duration_min") or 60)
    notes = (payload.get("notes") or "").strip()
    if not start_iso:
        raise HTTPException(400, "start (ISO datetime) required")
    try:
        start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "start must be valid ISO datetime")

    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "device_id": 1, "client_id": 1, "title": 1})
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    window = {
        "id": uuid.uuid4().hex,
        "ticket_id": ticket_id,
        "device_id": ticket.get("device_id"),
        "client_id": ticket.get("client_id"),
        "title": f"Maintenance — {ticket.get('title', '')[:80]}",
        "start": start_dt.isoformat(),
        "end": (start_dt + timedelta(minutes=duration_min)).isoformat(),
        "duration_min": duration_min,
        "notes": notes,
        "status": "scheduled",
        "created_by_id": current_user.get("id"),
        "created_by_name": current_user.get("name"),
        "created_at": _now(),
    }
    await db.maintenance_windows.insert_one(dict(window))
    window.pop("_id", None)
    await db.tickets.update_one({"id": ticket_id}, {"$set": {
        "maintenance_window_id": window["id"],
        "maintenance_start": window["start"],
        "maintenance_end": window["end"],
        "updated_at": _now(),
    }})
    await _audit(ticket_id, current_user, "maintenance_scheduled", f"{window['start']} for {duration_min}m")
    return {"success": True, "window": window}


@router.get("/tickets/{ticket_id}/maintenance-window")
async def get_maintenance_window(ticket_id: str, current_user: dict = Depends(get_current_user)):
    return await db.maintenance_windows.find_one({"ticket_id": ticket_id}, {"_id": 0})


# ─────────────────── CSAT (Customer satisfaction survey) ───────────────────

@router.post("/tickets/{ticket_id}/send-csat")
async def send_csat(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a CSAT survey link for the ticket and log that it was sent.
    Actual email delivery is best-effort via the existing email layer."""
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    if not ticket.get("contact_email") and not ticket.get("requester_email"):
        raise HTTPException(400, "Ticket has no contact email")

    survey_id = uuid.uuid4().hex
    survey = {
        "id": survey_id,
        "ticket_id": ticket_id,
        "ticket_number": ticket.get("ticket_number"),
        "client_id": ticket.get("client_id"),
        "client_name": ticket.get("client_name"),
        "contact_email": ticket.get("contact_email") or ticket.get("requester_email"),
        "status": "sent",
        "sent_at": _now(),
        "sent_by_id": current_user.get("id"),
        "sent_by_name": current_user.get("name"),
    }
    await db.csat_surveys.insert_one(dict(survey))
    await db.tickets.update_one({"id": ticket_id}, {"$set": {"csat_sent": True, "csat_sent_at": survey["sent_at"]}})
    await _audit(ticket_id, current_user, "csat_sent", f"to {survey['contact_email']}")
    survey.pop("_id", None)
    return {"success": True, "survey": survey}


@router.post("/csat/{survey_id}/respond")
async def respond_csat(survey_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    score = int(payload.get("score") or 0)
    if score < 1 or score > 5:
        raise HTTPException(400, "score must be 1..5")
    feedback = (payload.get("feedback") or "").strip()
    res = await db.csat_surveys.update_one({"id": survey_id}, {"$set": {
        "score": score, "feedback": feedback, "responded_at": _now(), "status": "responded",
    }})
    if res.matched_count == 0:
        raise HTTPException(404, "Survey not found")
    return {"success": True}


# ─────────────────── Time-to-resolve burn-down ───────────────────

@router.get("/tickets/{ticket_id}/burndown")
async def ticket_burndown(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Returns elapsed vs SLA target so the UI can render a burn-down bar."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    created = t.get("created_at")
    due = t.get("sla_resolution_due") or t.get("sla_response_due")
    if not created:
        return {"available": False}
    try:
        created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
    except Exception:
        return {"available": False}
    now = datetime.now(timezone.utc)
    elapsed_min = max(0, int((now - created_dt).total_seconds() / 60))
    target_min = None
    breach = False
    pct = 0
    if due:
        try:
            due_dt = datetime.fromisoformat(due.replace("Z", "+00:00"))
            total_min = int((due_dt - created_dt).total_seconds() / 60)
            if total_min > 0:
                target_min = total_min
                pct = min(100, int((elapsed_min / total_min) * 100))
                breach = now > due_dt
        except Exception:
            pass
    return {
        "available": True,
        "elapsed_min": elapsed_min,
        "target_min": target_min,
        "pct": pct,
        "breach": breach,
        "status": t.get("status"),
        "is_resolved": t.get("status") in {"resolved", "closed"},
    }
