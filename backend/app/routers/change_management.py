from datetime import date, datetime, timezone
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth import get_current_user
from app.database import db

router = APIRouter(prefix="/change-management", tags=["Change Management"])

VALID_CATEGORIES = {"standard", "normal", "emergency", "expedited"}
VALID_RISKS = {"low", "medium", "high"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_change(change_id: str) -> dict:
    change = await db.change_requests.find_one({"id": change_id}, {"_id": 0})
    if not change:
        raise HTTPException(404, "Change request not found")
    return change


def _recorded_actor(user: dict) -> str:
    return user.get("name") or user.get("email") or user.get("id") or "Unknown technician"


def _optional_date(value: object) -> str:
    """Return a persisted ISO date or reject ambiguous schedule values."""
    scheduled_date = str(value or "").strip()
    if not scheduled_date:
        return ""
    try:
        return date.fromisoformat(scheduled_date).isoformat()
    except ValueError as exc:
        raise HTTPException(400, "Planned date must use YYYY-MM-DD") from exc


async def _transition_change(change: dict, expected_status: str, update: dict) -> None:
    """Apply a lifecycle transition only when the stored status still matches.

    The status condition makes two simultaneous reviewers harmless: the first
    recorded transition wins and the second receives a conflict instead of
    overwriting the audit trail.
    """
    result = await db.change_requests.update_one(
        {"id": change["id"], "status": expected_status},
        update,
    )
    if not result.matched_count:
        raise HTTPException(409, "This change was updated by another technician. Refresh and review its current status.")


async def _write_audit(user: dict, action: str, change: dict, metadata: dict | None = None) -> None:
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user.get("id"),
        "user_name": user.get("name") or user.get("email") or user.get("id"),
        "action": action,
        "entity_type": "change_request",
        "entity_id": change["id"],
        "entity_name": change.get("title") or "Change request",
        "metadata": {"client_id": change.get("client_id"), "client_name": change.get("client_name"), "risk_level": change.get("risk_level"), **(metadata or {})},
        "created_at": _now(),
    })


def _event(user: dict, action: str, note: str = "") -> dict:
    return {
        "action": action,
        "note": note,
        "by": user.get("name") or user.get("email") or user.get("id"),
        "by_id": user.get("id"),
        "at": _now(),
    }


@router.get("")
async def list_changes(user=Depends(get_current_user)):
    return await db.change_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.get("/stats")
async def get_change_stats(user=Depends(get_current_user)):
    all_changes = await db.change_requests.find({}, {"_id": 0}).to_list(500)
    return {
        "total": len(all_changes),
        "pending_review": sum(change.get("status") == "pending_review" for change in all_changes),
        "approved": sum(change.get("status") == "approved" for change in all_changes),
        "implementing": sum(change.get("status") == "implementing" for change in all_changes),
        "completed": sum(change.get("status") == "completed" for change in all_changes),
        "rejected": sum(change.get("status") == "rejected" for change in all_changes),
        "rollback": sum(change.get("status") == "rollback" for change in all_changes),
        "by_category": {category: sum(change.get("category") == category for change in all_changes) for category in VALID_CATEGORIES},
        "by_risk": {risk: sum(change.get("risk_level") == risk for change in all_changes) for risk in VALID_RISKS},
    }


@router.get("/{change_id}")
async def get_change(change_id: str, user=Depends(get_current_user)):
    return await _get_change(change_id)


@router.post("")
async def create_change_request(payload: dict = Body(...), user=Depends(get_current_user)):
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    category = str(payload.get("category") or "standard").lower()
    risk_level = str(payload.get("risk_level") or "medium").lower()
    impact = str(payload.get("impact") or "").strip()
    rollback_plan = str(payload.get("rollback_plan") or "").strip()
    if len(title) < 5:
        raise HTTPException(400, "Provide a clear change title (at least 5 characters)")
    if len(description) < 12:
        raise HTTPException(400, "Describe the requested change (at least 12 characters)")
    if category not in VALID_CATEGORIES:
        raise HTTPException(400, f"category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")
    if risk_level not in VALID_RISKS:
        raise HTTPException(400, f"risk_level must be one of: {', '.join(sorted(VALID_RISKS))}")
    if category != "standard" and len(impact) < 8:
        raise HTTPException(400, "Record an impact assessment for non-standard changes")
    if risk_level in {"medium", "high"} and len(rollback_plan) < 8:
        raise HTTPException(400, "Record a rollback plan for medium and high-risk changes")

    client_id = str(payload.get("client_id") or "").strip()
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1}) if client_id else None
    if client_id and not client:
        raise HTTPException(404, "Selected client was not found")
    now = _now()
    doc = {
        "id": f"CHG-{uuid.uuid4().hex[:6].upper()}",
        "title": title,
        "description": description,
        "category": category,
        "risk_level": risk_level,
        "impact": impact,
        "rollback_plan": rollback_plan,
        "client_id": client_id,
        "client_name": (client or {}).get("name") or str(payload.get("client_name") or ""),
        "devices_affected": payload.get("devices_affected") or [],
        "scheduled_date": _optional_date(payload.get("scheduled_date")),
        "maintenance_window": str(payload.get("maintenance_window") or "").strip()[:160],
        "status": "pending_review",
        "requested_by": _recorded_actor(user),
        "requested_by_id": user.get("id"),
        "approvals": [],
        "activity": [_event(user, "submitted", "Change request submitted for review")],
        "created_at": now,
        "updated_at": now,
    }
    await db.change_requests.insert_one(doc)
    await _write_audit(user, "change_request_submitted", doc)
    return doc


@router.post("/{change_id}/approve")
async def approve_change(change_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    change = await _get_change(change_id)
    if change.get("status") != "pending_review":
        raise HTTPException(409, "Only changes awaiting review can be approved")
    note = str(payload.get("note") or "").strip()
    if len(note) < 8:
        raise HTTPException(400, "Record the approval rationale or CAB reference (at least 8 characters)")
    if change.get("requested_by_id") and change.get("requested_by_id") == user.get("id"):
        raise HTTPException(403, "The requesting technician cannot approve their own change")
    now = _now()
    approval = {"user": _recorded_actor(user), "user_id": user.get("id"), "action": "approved", "note": note, "at": now}
    await _transition_change(change, "pending_review", {"$set": {"status": "approved", "approved_at": now, "approved_by": user.get("id"), "approved_by_name": _recorded_actor(user), "updated_at": now}, "$push": {"approvals": approval, "activity": _event(user, "approved", note)}})
    if change.get("workflow_id"):
        await db.workflows.update_one(
            {"id": change["workflow_id"]},
            {"$set": {"approval_status": "approved", "approved_change_id": change_id, "updated_at": now}},
        )
    await _write_audit(user, "change_request_approved", change, {"note": note or None})
    return {"message": "Change approved", "status": "approved"}


@router.post("/{change_id}/reject")
async def reject_change(change_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    change = await _get_change(change_id)
    if change.get("status") != "pending_review":
        raise HTTPException(409, "Only changes awaiting review can be rejected")
    reason = str(payload.get("reason") or "").strip()
    if len(reason) < 8:
        raise HTTPException(400, "Record a rejection reason of at least 8 characters")
    if change.get("requested_by_id") and change.get("requested_by_id") == user.get("id"):
        raise HTTPException(403, "The requesting technician cannot reject their own change")
    now = _now()
    await _transition_change(change, "pending_review", {"$set": {"status": "rejected", "rejection_reason": reason, "rejected_at": now, "rejected_by": user.get("id"), "rejected_by_name": _recorded_actor(user), "updated_at": now}, "$push": {"approvals": {"user": _recorded_actor(user), "user_id": user.get("id"), "action": "rejected", "note": reason, "at": now}, "activity": _event(user, "rejected", reason)}})
    if change.get("workflow_id"):
        await db.workflows.update_one(
            {"id": change["workflow_id"]},
            {"$set": {"approval_status": "rejected", "updated_at": now}},
        )
    await _write_audit(user, "change_request_rejected", change, {"reason": reason})
    return {"message": "Change rejected", "status": "rejected"}


@router.post("/{change_id}/implement")
async def start_implementation(change_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    change = await _get_change(change_id)
    if change.get("status") != "approved":
        raise HTTPException(409, "Only approved changes can enter implementation")
    note = str(payload.get("note") or "").strip()
    if len(note) < 8:
        raise HTTPException(400, "Record the implementation owner, handover, or pre-check evidence (at least 8 characters)")
    now = _now()
    await _transition_change(change, "approved", {"$set": {"status": "implementing", "implementation_started": now, "implementation_started_by": user.get("id"), "implementation_started_by_name": _recorded_actor(user), "updated_at": now}, "$push": {"activity": _event(user, "implementation_started", note)}})
    await _write_audit(user, "change_request_implementation_started", change, {"note": note or None})
    return {"message": "Implementation started", "status": "implementing"}


@router.post("/{change_id}/complete")
async def complete_change(change_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    change = await _get_change(change_id)
    if change.get("status") != "implementing":
        raise HTTPException(409, "Only an implementing change can be completed")
    notes = str(payload.get("notes") or "").strip()
    if len(notes) < 8:
        raise HTTPException(400, "Record implementation and validation evidence (at least 8 characters)")
    now = _now()
    await _transition_change(change, "implementing", {"$set": {"status": "completed", "completion_notes": notes, "completed_at": now, "completed_by": user.get("id"), "completed_by_name": _recorded_actor(user), "updated_at": now}, "$push": {"activity": _event(user, "completed", notes)}})
    await _write_audit(user, "change_request_completed", change, {"completion_notes": notes})
    return {"message": "Change completed", "status": "completed"}


@router.post("/{change_id}/rollback")
async def rollback_change(change_id: str, payload: dict = Body(default={}), user=Depends(get_current_user)):
    change = await _get_change(change_id)
    if change.get("status") != "implementing":
        raise HTTPException(409, "Only an implementing change can be rolled back")
    notes = str(payload.get("notes") or "").strip()
    if len(notes) < 8:
        raise HTTPException(400, "Record the rollback reason and outcome (at least 8 characters)")
    now = _now()
    await _transition_change(change, "implementing", {"$set": {"status": "rollback", "rollback_notes": notes, "rolled_back_at": now, "rolled_back_by": user.get("id"), "rolled_back_by_name": _recorded_actor(user), "updated_at": now}, "$push": {"activity": _event(user, "rolled_back", notes)}})
    if change.get("workflow_id"):
        await db.workflows.update_one(
            {"id": change["workflow_id"]},
            {"$set": {"enabled": False, "approval_status": "rolled_back", "updated_at": now}},
        )
    await _write_audit(user, "change_request_rolled_back", change, {"rollback_notes": notes})
    return {"message": "Change rolled back", "status": "rollback"}
