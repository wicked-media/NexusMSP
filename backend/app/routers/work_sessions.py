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
from app.services.ticket_time import create_canonical_ticket_time_entry

router = APIRouter(tags=["Nexus Work Session"])


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ticket_for(ticket_id: str, user: dict, operation: str) -> dict:
    return await assert_record_scope(user, db.tickets, ticket_id, operation=operation, resource_name="Ticket")


def _compact_text(value: object, *, fallback: str, limit: int = 220) -> str:
    """Return a presentation-safe retained value without inventing a result."""
    text = " ".join(str(value or "").split())
    if not text:
        return fallback
    return f"{text[: limit - 1].rstrip()}…" if len(text) > limit else text


def _build_completion_assist(
    ticket: dict,
    device: dict | None,
    recent_activity: list[dict],
    remote_sessions: list[dict],
) -> dict:
    """Build a transparent, deterministic review draft from scoped evidence.

    This deliberately does not call an AI provider or infer completed work.  It
    gives the technician a structured starting point and leaves every outcome,
    customer message, commercial choice and verification claim for review.
    """
    ticket_reference = str(ticket.get("ticket_number") or ticket.get("id") or "Ticket")
    ticket_title = _compact_text(ticket.get("title"), fallback="Untitled request", limit=140)
    reported_issue = _compact_text(ticket.get("description"), fallback="No ticket description was recorded")
    client_label = _compact_text(ticket.get("client_name"), fallback="Client not recorded", limit=120)
    device_label = ""
    evidence: list[dict] = [
        {
            "kind": "ticket",
            "label": "Ticket request",
            "detail": f"{ticket_reference} · {ticket_title}",
            "at": ticket.get("updated_at") or ticket.get("created_at"),
        }
    ]
    if device:
        device_label = _compact_text(
            device.get("name") or device.get("hostname"),
            fallback="Linked managed endpoint",
            limit=140,
        )
        evidence.append(
            {
                "kind": "device",
                "label": "Linked endpoint",
                "detail": device_label,
                "at": device.get("updated_at") or device.get("last_seen"),
            }
        )
    for item in recent_activity[:4]:
        evidence.append(
            {
                "kind": "activity",
                "label": _compact_text(item.get("entity_type") or item.get("action"), fallback="Recorded Nexus activity", limit=80),
                "detail": _compact_text(item.get("details") or item.get("action"), fallback="Recorded client activity", limit=180),
                "at": item.get("created_at"),
            }
        )
    for item in remote_sessions[:3]:
        status = _compact_text(item.get("status"), fallback="recorded", limit=48)
        provider = _compact_text(item.get("provider") or item.get("session_type"), fallback="remote", limit=64)
        evidence.append(
            {
                "kind": "remote",
                "label": "Remote session evidence",
                "detail": f"{provider} · {status}",
                "at": item.get("ended_at") or item.get("connected_at") or item.get("started_at"),
            }
        )

    evidence_summary = "; ".join(item["label"] for item in evidence[:5])
    endpoint_line = f"\nLinked endpoint: {device_label}" if device_label else ""
    return {
        "status": "review_required",
        "message": "Prepared only from scoped Nexus records. Review and replace every bracketed statement before recording the outcome.",
        "evidence": evidence,
        "drafts": {
            "technical_notes": (
                f"Reported request: {reported_issue}{endpoint_line}\n"
                f"Context reviewed: {evidence_summary}.\n\n"
                "Work performed: [Technician to confirm]\n"
                "Technical outcome: [Technician to confirm]\n"
                "Verification evidence: [Technician to confirm]"
            ),
            "customer_summary": (
                f"Hello,\n\nWe reviewed your request: {ticket_title}.\n\n"
                "Current outcome: [Technician to confirm in plain language].\n"
                "Next step: [Confirm completion or describe the accountable follow-up]."
            ),
            "documentation_suggestion": (
                f"Client: {client_label}\nTicket: {ticket_reference} · {ticket_title}\n"
                "Useful record to retain: [Technician to confirm]\n"
                "Owner / review date: [Technician to confirm]"
            ),
            "recurrence_check": (
                "Condition reviewed: [Technician to confirm]\n"
                "Related users, devices or sites to check: [Technician to confirm]\n"
                "Follow-up required: [Create an explicit prevention action only when evidence supports it]"
            ),
        },
    }


async def _recent_remote_evidence(ticket: dict) -> list[dict]:
    """Retrieve only ticket-and-client-bound remote evidence when available.

    Remote evidence enriches a Work Session but must never make the core ticket
    workflow unavailable if the optional collection is temporarily inaccessible.
    """
    collection = getattr(db, "remote_sessions", None)
    if collection is None:
        return []
    try:
        return await collection.find(
            {"ticket_id": ticket["id"], "client_id": ticket.get("client_id")}, {"_id": 0}
        ).sort("started_at", -1).to_list(4)
    except Exception:
        return []


@router.get("/work-sessions/tickets/{ticket_id}")
async def work_session_brief(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ticket = await ticket_for(ticket_id, current_user, "work_session.read")
    device_id = ticket.get("device_id") or (ticket.get("device_ids") or [None])[0]
    # A ticket's linked device ID is context, not an authorisation boundary.
    # Fail closed if an old or malformed ticket points at another client's
    # device rather than disclosing that device in the work-session pack.
    device = await db.devices.find_one(
        {"id": device_id, "client_id": ticket.get("client_id")}, {"_id": 0}
    ) if device_id else None
    active = await db.nexus_work_sessions.find_one({"ticket_id": ticket_id, "status": "active"}, {"_id": 0})
    recent = await db.activity_logs.find({"client_id": ticket.get("client_id")}, {"_id": 0}).sort("created_at", -1).to_list(6)
    remote_sessions = await _recent_remote_evidence(ticket)
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
        "completion_assist": _build_completion_assist(ticket, device, recent, remote_sessions),
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
        if session.get("status") == "completed" and session.get("time_entry_id"):
            # The completion record is a pointer only.  Reconfirm the ticket
            # and client boundary before returning a financial record on an
            # idempotent replay.
            existing_entry = await db.time_entries.find_one(
                {
                    "id": session["time_entry_id"],
                    "ticket_id": ticket["id"],
                    "client_id": ticket.get("client_id"),
                },
                {"_id": 0},
            )
            if existing_entry:
                return {
                    "message": "Work session was already completed. Returning its canonical time entry.",
                    "work_session_id": session_id,
                    "time_entry": existing_entry,
                    "outcome": session.get("outcome") or {},
                    "idempotent_replay": True,
                }
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
    completion_claim_id = str(uuid.uuid4())
    claim = await db.nexus_work_sessions.update_one(
        {"id": session_id, "status": "active"},
        {
            "$set": {
                "status": "completing",
                "completion_claim_id": completion_claim_id,
                "completion_claimed_at": completed_at,
            }
        },
    )
    if claim.modified_count != 1:
        refreshed = await db.nexus_work_sessions.find_one({"id": session_id}, {"_id": 0})
        if refreshed and refreshed.get("status") == "completed" and refreshed.get("time_entry_id"):
            existing_entry = await db.time_entries.find_one(
                {
                    "id": refreshed["time_entry_id"],
                    "ticket_id": ticket["id"],
                    "client_id": ticket.get("client_id"),
                },
                {"_id": 0},
            )
            if existing_entry:
                return {
                    "message": "Work session was already completed. Returning its canonical time entry.",
                    "work_session_id": session_id,
                    "time_entry": existing_entry,
                    "outcome": refreshed.get("outcome") or {},
                    "idempotent_replay": True,
                }
        raise HTTPException(status_code=409, detail="This work session is already being completed; retry shortly")

    # Scope Guardian is a server-side financial boundary. An included,
    # approval-required or unclassified session cannot be turned billable by
    # changing a browser payload.
    billable = billing_classification in {"billable", "project"}
    technician = await db.users.find_one({"id": current_user.get("id")}, {"_id": 0, "hourly_rate": 1})
    try:
        hourly_rate = float((technician or {}).get("hourly_rate") or 75.0)
    except (TypeError, ValueError):
        hourly_rate = 75.0
    try:
        time_entry, created = await create_canonical_ticket_time_entry(
            ticket=ticket,
            actor=current_user,
            minutes=minutes,
            description=technical_notes,
            billable=billable,
            source="nexus_work_session",
            source_reference=session_id,
            hourly_rate=hourly_rate,
            date=completed_at[:10],
            created_at=completed_at,
            extra={
                "billing_classification": billing_classification,
                "work_session_id": session_id,
            },
            database=db,
        )
        await db.tickets.update_one({"id": ticket["id"]}, {"$set": {"updated_at": completed_at}})
        outcome = {"technical_notes": technical_notes, "customer_summary": customer_summary, "verified": bool(data.get("verified")), "documentation_suggestion": str(data.get("documentation_suggestion") or "").strip(), "recurrence_check": str(data.get("recurrence_check") or "").strip(), "billing_classification": billing_classification, "completed_at": completed_at, "completed_by": current_user.get("name") or current_user.get("email")}
        completed = await db.nexus_work_sessions.update_one(
            {"id": session_id, "status": "completing", "completion_claim_id": completion_claim_id},
            {"$set": {"status": "completed", "outcome": outcome, "completed_at": completed_at, "time_entry_id": time_entry["id"]}, "$unset": {"completion_claim_id": "", "completion_claimed_at": ""}},
        )
        if completed.modified_count != 1:
            raise HTTPException(status_code=409, detail="Work session completion could not be finalised safely")
    except Exception:
        await db.nexus_work_sessions.update_one(
            {"id": session_id, "status": "completing", "completion_claim_id": completion_claim_id},
            {"$set": {"status": "active", "completion_failed_at": now()}, "$unset": {"completion_claim_id": "", "completion_claimed_at": ""}},
        )
        raise
    if created:
        await log_activity(current_user, "work_session_completed", "ticket", ticket["id"], ticket.get("ticket_number") or ticket["id"], "Nexus Work Session completion pack reviewed and recorded.", metadata={"client_id": ticket.get("client_id"), "minutes": minutes, "verified": outcome["verified"], "billing_classification": billing_classification, "time_entry_id": time_entry["id"]})
    return {"message": "Work session completed. Time and accountable resolution evidence were recorded.", "work_session_id": session_id, "time_entry": time_entry, "outcome": outcome, "idempotent_replay": not created}
