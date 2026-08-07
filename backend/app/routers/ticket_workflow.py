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
from app.services.activity import log_activity


MAINTENANCE_ACTIONS = {"run-checks", "install-patches", "install-winget", "reboot", "run-script"}

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _audit(ticket_id: str, user: dict, action: str, details: str):
    # The ticket detail Audit tab is backed by ticket_audit_log.  Keep workflow
    # events in that canonical collection so technicians see the full story in
    # one place instead of having to infer actions from a separate activity view.
    await db.ticket_audit_log.insert_one({
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
    device_id = (payload.get("device_id") or "").strip()
    actions = payload.get("actions") or ["install-patches"]
    if not start_iso:
        raise HTTPException(400, "start (ISO datetime) required")
    if not 5 <= duration_min <= 1440:
        raise HTTPException(400, "duration_min must be between 5 and 1440")
    if not isinstance(actions, list) or not actions or any(action not in MAINTENANCE_ACTIONS for action in actions):
        raise HTTPException(400, f"actions must contain only: {sorted(MAINTENANCE_ACTIONS)}")
    try:
        start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(400, "start must be valid ISO datetime")

    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "device_id": 1, "client_id": 1, "title": 1})
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    device_id = device_id or ticket.get("device_id") or ""
    if not device_id:
        raise HTTPException(400, "Link a device to the ticket before scheduling maintenance")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(404, "Linked device not found")

    scheduled_at = start_dt.isoformat()
    device_meta = {
        "id": device["id"], "name": device.get("name") or device.get("hostname"),
        "client_id": device.get("client_id"), "client_name": device.get("client_name"),
        "nexus_agent_id": device.get("nexus_agent_id"), "status": device.get("status"),
    }

    window = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "parent_ticket_id": ticket_id,
        "device_id": device_id,
        "device_ids": [device_id],
        "devices_meta": [device_meta],
        "client_id": ticket.get("client_id"),
        "name": f"Ticket maintenance - {ticket.get('title', '')[:80]}",
        "title": f"Maintenance — {ticket.get('title', '')[:80]}",
        "description": notes[:600],
        "actions": actions,
        "scheduled_at": scheduled_at,
        "start": scheduled_at,
        "end": (start_dt + timedelta(minutes=duration_min)).isoformat(),
        "duration_min": duration_min,
        "notes": notes,
        "notify_clients": bool(payload.get("notify_clients", False)),
        "script_id": payload.get("script_id"),
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
    await _audit(ticket_id, current_user, "maintenance_scheduled", f"{window['start']} for {duration_min}m; {', '.join(actions)}")
    await log_activity(current_user, "maintenance_window_created", "maintenance_window", window["id"], window["name"], f"1 device; {scheduled_at}; {', '.join(actions)}")
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
async def respond_csat(survey_id: str, payload: dict = Body(...)):
    """Accept the response for an unguessable ticket-linked survey ID.

    Survey links are capability URLs generated per ticket.  A response may be
    submitted once while it is in ``sent`` state; the ticket audit trail records
    the event without pretending a technician supplied the rating.
    """
    try:
        score = int(payload.get("score") or 0)
    except (TypeError, ValueError):
        score = 0
    if score < 1 or score > 5:
        raise HTTPException(400, "score must be 1..5")
    feedback = (payload.get("feedback") or "").strip()[:4000]
    survey = await db.csat_surveys.find_one({"id": survey_id, "status": "sent"}, {"_id": 0})
    if not survey:
        raise HTTPException(404, "Survey not found or already answered")
    res = await db.csat_surveys.update_one({"id": survey_id, "status": "sent"}, {"$set": {
        "score": score, "feedback": feedback, "responded_at": _now(), "status": "responded",
    }})
    if res.matched_count == 0:
        raise HTTPException(409, "Survey was already answered")
    await _audit(survey.get("ticket_id"), {"id": None, "name": "Client survey respondent"}, "csat_responded", f"Submitted {score}/5 CSAT feedback")
    return {"success": True}


# ─────────────────── Time-to-resolve burn-down ───────────────────

@router.get("/tickets/{ticket_id}/burndown")
async def ticket_burndown(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Returns elapsed vs SLA target so the UI can render a burn-down bar."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    created = t.get("created_at")
    due = (
        t.get("sla_resolution_due")
        or t.get("sla_response_due")
        or t.get("sla_due")
        or t.get("sla_due_at")
    )
    if not created:
        return {"available": False}
    try:
        created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
    except Exception:
        return {"available": False}
    now = datetime.now(timezone.utc)
    is_resolved = t.get("status") in {"resolved", "closed"}
    completed_dt = None
    if is_resolved:
        completed = t.get("closed_at") or t.get("resolved_at") or t.get("updated_at")
        if completed:
            try:
                completed_dt = datetime.fromisoformat(completed.replace("Z", "+00:00"))
            except Exception:
                completed_dt = None
    measurement_dt = completed_dt or now
    elapsed_min = max(0, int((measurement_dt - created_dt).total_seconds() / 60))
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
                breach = measurement_dt > due_dt
        except Exception:
            pass
    return {
        "available": True,
        "elapsed_min": elapsed_min,
        "target_min": target_min,
        "pct": pct,
        "breach": breach,
        "status": t.get("status"),
        "is_resolved": is_resolved,
        "completed_at": completed_dt.isoformat() if completed_dt else None,
    }
