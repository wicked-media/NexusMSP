"""Nexus Work Session: prepare and review a technician completion pack.

The worker records the session and suggested outputs, but never sends a client
message or changes provider state without the technician's explicit review.
"""
from __future__ import annotations

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import assert_record_scope
from app.services.activity import log_activity

router = APIRouter(tags=["Nexus Work Session"])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ticket_for(ticket_id: str, user: dict, operation: str) -> dict:
    return await assert_record_scope(user, db.tickets, ticket_id, operation=operation, resource_name="Ticket")


@router.get("/work-sessions/tickets/{ticket_id}")
async def work_session_brief(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await ticket_for(ticket_id, current_user, "work_session.read")
    device_id = ticket.get("device_id") or (ticket.get("device_ids") or [None])[0]
    device = await db.devices.find_one({"id": device_id}, {"_id": 0}) if device_id else None
    active = await db.nexus_work_sessions.find_one({"ticket_id": ticket_id, "status": "active"}, {"_id": 0})
    recent = await db.activity_logs.find({"client_id": ticket.get("client_id")}, {"_id": 0}).sort("created_at", -1).to_list(6)
    active_contracts = await db.contracts.find({"client_id": ticket.get("client_id"), "status": "active"}, {"_id": 0}).to_list(50)
    contract_id = ticket.get("contract_id") or ticket.get("sla_contract_id")
    contract = next((item for item in active_contracts if item.get("id") == contract_id), None)
    if not contract and len(active_contracts) == 1:
        contract = active_contracts[0]
    contract_type = str((contract or {}).get("contract_type") or (contract or {}).get("type") or "").lower()
    if not contract:
        scope_guardian = {"status": "unclassified", "recommended_classification": "review", "billable_recommendation": False, "contract": None, "reason": "No single active agreement is linked to this ticket. Nexus cannot determine whether the work is included or chargeable.", "next_step": "Choose a classification and link the applicable agreement or approval before completion."}
    elif contract_type == "project" or str(ticket.get("category") or "").lower() == "project":
        scope_guardian = {"status": "project", "recommended_classification": "project", "billable_recommendation": True, "contract": {"id": contract.get("id"), "name": contract.get("name"), "type": contract_type or "project"}, "reason": "The linked agreement or ticket is recorded as project delivery.", "next_step": "Record time against the approved project scope and confirm any change request separately."}
    elif contract_type == "break_fix":
        scope_guardian = {"status": "billable", "recommended_classification": "billable", "billable_recommendation": True, "contract": {"id": contract.get("id"), "name": contract.get("name"), "type": contract_type}, "reason": "The linked agreement is recorded as break/fix. Nexus recommends billable time, subject to technician review.", "next_step": "Confirm the work and rate are correct before completion."}
    else:
        scope_guardian = {"status": "review", "recommended_classification": "review", "billable_recommendation": False, "contract": {"id": contract.get("id"), "name": contract.get("name"), "type": contract_type or "managed_services"}, "reason": "An active managed-service agreement is linked, but retained records do not prove this specific request is included.", "next_step": "Classify the work as included, billable, project, or approval required. Nexus will retain your decision with the time entry."}
    return {
        "ticket": ticket, "device": device, "active_session": active,
        "scope_guardian": scope_guardian,
        "context": {
            "remote_available": bool(device_id),
            "device_id": device_id,
            "recent_changes": [{"title": item.get("details") or item.get("action") or "Recorded activity", "at": item.get("created_at"), "source": item.get("entity_type") or "Nexus"} for item in recent],
            "diagnostic_scope": ["Ticket and client history", "Linked endpoint identity and health", "Recent client activity", "Existing time and work evidence"],
        },
        "boundary": "Nexus prepares time, notes, customer wording and documentation suggestions. Review is required before anything is completed or communicated.",
    }


@router.post("/work-sessions/tickets/{ticket_id}/start")
async def start_work_session(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ticket = await ticket_for(ticket_id, current_user, "work_session.start")
    existing = await db.nexus_work_sessions.find_one({"ticket_id": ticket_id, "status": "active"}, {"_id": 0})
    if existing:
        return {"session": existing, "message": "An active work session already exists for this ticket."}
    session = {"id": str(uuid.uuid4()), "ticket_id": ticket_id, "client_id": ticket.get("client_id"), "device_id": ticket.get("device_id") or (ticket.get("device_ids") or [None])[0], "status": "active", "started_at": now(), "started_by": current_user.get("id"), "technician": current_user.get("name") or current_user.get("email"), "intent": str(data.get("intent") or "Investigate and resolve the ticket").strip()}
    await db.nexus_work_sessions.insert_one(session.copy())
    await db.tickets.update_one({"id": ticket_id, "status": {"$in": ["open", "new"]}}, {"$set": {"status": "in_progress", "updated_at": now()}})
    await log_activity(current_user, "work_session_started", "ticket", ticket_id, ticket.get("ticket_number") or ticket_id, "Nexus Work Session started.", metadata={"client_id": ticket.get("client_id"), "device_id": session.get("device_id")})
    return {"session": session, "message": "Work session started. Nexus is now collecting accountable context."}


@router.post("/work-sessions/{session_id}/complete")
async def complete_work_session(session_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    session = await db.nexus_work_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Work session not found")
    ticket = await ticket_for(session["ticket_id"], current_user, "work_session.complete")
    if session.get("status") != "active":
        raise HTTPException(status_code=409, detail="This work session is already completed")
    minutes = int(data.get("minutes") or 0)
    technical_notes = str(data.get("technical_notes") or "").strip()
    customer_summary = str(data.get("customer_summary") or "").strip()
    billing_classification = str(data.get("billing_classification") or "review").strip().lower()
    if billing_classification not in {"included", "billable", "project", "approval_required", "review"}:
        raise HTTPException(status_code=400, detail="Choose a valid Scope Guardian classification")
    if minutes < 1 or not technical_notes or not customer_summary:
        raise HTTPException(status_code=400, detail="Time, technical notes and customer summary are required")
    completed_at = now()
    time_entry = {"id": str(uuid.uuid4()), "ticket_id": ticket["id"], "ticket_title": ticket.get("title"), "client_id": ticket.get("client_id"), "client_name": ticket.get("client_name"), "user_id": current_user.get("id"), "user_name": current_user.get("name") or current_user.get("email"), "minutes": minutes, "description": technical_notes, "date": completed_at[:10], "billable": bool(data.get("billable", True)), "billing_classification": billing_classification, "invoiced": False, "work_session_id": session_id, "created_at": completed_at}
    await db.time_entries.insert_one(time_entry.copy())
    await db.tickets.update_one({"id": ticket["id"]}, {"$inc": {"total_time_minutes": minutes}, "$set": {"updated_at": completed_at}})
    outcome = {"technical_notes": technical_notes, "customer_summary": customer_summary, "verified": bool(data.get("verified")), "documentation_suggestion": str(data.get("documentation_suggestion") or "").strip(), "recurrence_check": str(data.get("recurrence_check") or "").strip(), "billing_classification": billing_classification, "completed_at": completed_at, "completed_by": current_user.get("name") or current_user.get("email")}
    await db.nexus_work_sessions.update_one({"id": session_id}, {"$set": {"status": "completed", "outcome": outcome, "completed_at": completed_at, "time_entry_id": time_entry["id"]}})
    await log_activity(current_user, "work_session_completed", "ticket", ticket["id"], ticket.get("ticket_number") or ticket["id"], "Nexus Work Session completion pack reviewed and recorded.", metadata={"client_id": ticket.get("client_id"), "minutes": minutes, "verified": outcome["verified"], "billing_classification": billing_classification, "time_entry_id": time_entry["id"]})
    return {"message": "Work session completed. Time and accountable resolution evidence were recorded.", "time_entry": time_entry, "outcome": outcome}
