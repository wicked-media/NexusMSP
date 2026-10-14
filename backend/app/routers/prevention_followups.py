"""Client-scoped prevention proposals following a completed Work Session.

These endpoints are deliberately *not* a remediation runner.  They retain the
technician's recurrence evidence and candidate scope so a later governed
workflow can be created deliberately, with its own approvals and safeguards.
"""

from __future__ import annotations

from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.prevention_followups import (
    FOLLOW_UP_COLLECTION,
    create_prevention_follow_up,
    normalise_candidate_device_ids,
)
from app.services.scope_permissions import assert_client_scope


router = APIRouter(tags=["Nexus Prevention Follow-up"])


async def _scoped_work_session_and_ticket(
    session_id: str,
    user: dict[str, Any],
    *,
    operation: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Load linked Work Session/Ticket evidence without crossing client scope."""
    session = await db.nexus_work_sessions.find_one({"id": str(session_id)}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Work session not found")
    ticket_id = str(session.get("ticket_id") or "").strip()
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0}) if ticket_id else None
    if not ticket:
        raise HTTPException(status_code=409, detail="The Work Session no longer has a source ticket")
    client_id = str(ticket.get("client_id") or "").strip()
    if not client_id or client_id != str(session.get("client_id") or "").strip():
        raise HTTPException(status_code=409, detail="The Work Session no longer has a safe client scope")
    await assert_client_scope(
        user,
        client_id,
        site_id=ticket.get("site_id"),
        operation=operation,
        mask_not_found=True,
    )
    return session, ticket


async def _source_device_id(session: dict[str, Any], ticket: dict[str, Any]) -> str | None:
    """Retain a source-device reference only if it still belongs to the client."""
    device_id = str(session.get("device_id") or "").strip()
    if not device_id:
        return None
    query: dict[str, Any] = {"id": device_id, "client_id": ticket.get("client_id")}
    if ticket.get("site_id"):
        query["site_id"] = ticket.get("site_id")
    device = await db.devices.find_one(
        query,
        {"_id": 0, "id": 1},
    )
    return device_id if device else None


async def _validate_candidate_devices(data: dict[str, Any], ticket: dict[str, Any]) -> list[str]:
    candidate_ids = normalise_candidate_device_ids(data.get("candidate_device_ids"))
    if not candidate_ids:
        return []
    query: dict[str, Any] = {"id": {"$in": candidate_ids}, "client_id": ticket.get("client_id")}
    if ticket.get("site_id"):
        query["site_id"] = ticket.get("site_id")
    devices = await db.devices.find(
        query,
        {"_id": 0, "id": 1},
    ).to_list(len(candidate_ids))
    found_ids = {str(device.get("id")) for device in devices}
    if found_ids != set(candidate_ids):
        # Do not reveal whether a missing ID exists on another client.
        raise HTTPException(status_code=422, detail="Every candidate endpoint must belong to the source client")
    return candidate_ids


async def _record_ticket_audit(
    *,
    ticket: dict[str, Any],
    user: dict[str, Any],
    follow_up: dict[str, Any],
) -> None:
    """Keep the proposal visible from the source ticket without executing it."""
    collection = getattr(db, "ticket_audit_log", None)
    if collection is None:
        return
    await collection.insert_one(
        {
            "id": str(uuid.uuid4()),
            "ticket_id": ticket.get("id"),
            "client_id": ticket.get("client_id"),
            "user_id": user.get("id") or "",
            "user_name": user.get("name") or user.get("email") or "",
            "action": "prevention_follow_up_proposed",
            "details": "Prevention follow-up proposed for review. No remediation was scheduled or executed.",
            "prevention_follow_up_id": follow_up.get("id"),
            "created_at": follow_up.get("created_at"),
        }
    )


@router.get("/work-sessions/{session_id}/prevention-follow-ups")
async def list_work_session_prevention_follow_ups(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List review-only proposals attached to one scoped Work Session."""
    session, ticket = await _scoped_work_session_and_ticket(
        session_id,
        current_user,
        operation="work_session.prevention_follow_up.read",
    )
    collection = getattr(db, FOLLOW_UP_COLLECTION)
    follow_ups = await collection.find(
        {
            "work_session_id": session.get("id"),
            "ticket_id": ticket.get("id"),
            "client_id": ticket.get("client_id"),
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return {
        "work_session_id": session.get("id"),
        "follow_ups": follow_ups,
        "boundary": "These are review-only prevention proposals. Nexus has not scheduled or executed remediation.",
    }


@router.post("/work-sessions/{session_id}/prevention-follow-ups", status_code=201)
async def propose_work_session_prevention_follow_up(
    session_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Create a human-reviewed prevention follow-up for completed work only."""
    session, ticket = await _scoped_work_session_and_ticket(
        session_id,
        current_user,
        operation="work_session.prevention_follow_up.create",
    )
    if str(session.get("status") or "") != "completed":
        raise HTTPException(status_code=409, detail="Complete the Work Session before proposing prevention follow-up")
    candidate_device_ids = await _validate_candidate_devices(data, ticket)
    follow_up, created = await create_prevention_follow_up(
        database=db,
        work_session=session,
        ticket=ticket,
        actor=current_user,
        data=data,
        candidate_device_ids=candidate_device_ids,
        source_device_id=await _source_device_id(session, ticket),
    )
    if created:
        await _record_ticket_audit(ticket=ticket, user=current_user, follow_up=follow_up)
        await log_activity(
            current_user,
            "prevention_follow_up_proposed",
            "work_session",
            str(session.get("id") or ""),
            follow_up.get("title") or "Prevention follow-up",
            "Prevention follow-up proposed for review. No remediation was scheduled or executed.",
            metadata={
                "client_id": ticket.get("client_id"),
                "ticket_id": ticket.get("id"),
                "prevention_follow_up_id": follow_up.get("id"),
                "candidate_device_count": len(follow_up.get("candidate_device_ids") or []),
                "auto_remediation": False,
            },
        )
    return {
        "follow_up": follow_up,
        "idempotent_replay": not created,
        "message": (
            "Prevention follow-up proposed for review. No remediation was scheduled or executed."
            if created
            else "Returning the original prevention follow-up; no new remediation was scheduled or executed."
        ),
        "next_step": "Review the evidence, then deliberately create a governed ticket, change or remediation campaign if it is justified.",
    }


@router.get("/prevention-follow-ups/{follow_up_id}")
async def get_prevention_follow_up(
    follow_up_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Read a proposed follow-up only when its client scope is accessible."""
    collection = getattr(db, FOLLOW_UP_COLLECTION)
    follow_up = await collection.find_one({"id": str(follow_up_id)}, {"_id": 0})
    if not follow_up:
        raise HTTPException(status_code=404, detail="Prevention follow-up not found")
    await assert_client_scope(
        current_user,
        follow_up.get("client_id"),
        site_id=follow_up.get("site_id"),
        operation="work_session.prevention_follow_up.read",
        mask_not_found=True,
    )
    return {
        "follow_up": follow_up,
        "boundary": "This proposal is non-executable. It has not approved, scheduled or performed remediation.",
    }
