"""Account-owned technician onboarding APIs.

This router deliberately does not reuse client onboarding.  It records a
technician's first-use workflow acknowledgement against their own stable user
record and exposes a compact administrator view for Team Hub.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.technician_onboarding import (
    complete_technician_onboarding_step,
    get_or_create_technician_onboarding,
    technician_onboarding_summary,
)


router = APIRouter(prefix="/technician-onboarding", tags=["technician-onboarding"])


def _is_admin(user: dict[str, Any]) -> bool:
    return user.get("is_admin") in (True, 1) or str(user.get("role") or "").lower() == "admin"


def _unique_technicians(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse legacy duplicate user documents for the admin readiness view.

    The onboarding document is account-owned, so more than one row with the
    same stable Nexus user ID must never make one person appear as multiple
    people or inflate the readiness summary.  The database query is already
    sorted for display; retain its first valid record deterministically and
    exclude malformed records that have no stable user identity.
    """
    unique: dict[str, dict[str, Any]] = {}
    for row in rows:
        technician_id = str(row.get("id") or "").strip()
        if technician_id:
            unique.setdefault(technician_id, row)
    return list(unique.values())


async def _load_technician(technician_id: str) -> dict[str, Any]:
    technician = await db.users.find_one({"id": str(technician_id)}, {"_id": 0, "password_hash": 0})
    if not technician:
        raise HTTPException(status_code=404, detail="Technician not found")
    return technician


async def _require_self_or_admin(technician_id: str, current_user: dict[str, Any]) -> dict[str, Any]:
    if str(technician_id) != str(current_user.get("id") or "") and not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="You can only view your own onboarding evidence")
    return await _load_technician(technician_id)


def _response(technician: dict[str, Any], onboarding: dict[str, Any], *, changed: bool | None = None) -> dict[str, Any]:
    response = {
        "technician": {
            "id": str(technician.get("id") or ""),
            "name": technician.get("name") or "Technician",
            "role": technician.get("role") or "technician",
        },
        "onboarding": onboarding,
    }
    if changed is not None:
        response["changed"] = changed
    return response


@router.get("/me")
async def get_my_technician_onboarding(current_user: dict = Depends(get_current_user)):
    """Return (and lazily initialise) the signed-in technician's checklist."""
    technician = await _load_technician(str(current_user.get("id") or ""))
    onboarding = await get_or_create_technician_onboarding(db, technician)
    return _response(technician, onboarding)


@router.post("/me/steps/{step_id}/complete")
async def complete_my_technician_onboarding_step(
    step_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Record a single self-attested first-use workflow acknowledgement."""
    technician = await _load_technician(str(current_user.get("id") or ""))
    try:
        onboarding, changed = await complete_technician_onboarding_step(
            db,
            technician=technician,
            step_id=step_id,
            acknowledged=data.get("acknowledged"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # The user document contains the atomic primary evidence.  Mirror only a
    # concise, secret-free summary into the existing cross-platform audit log.
    if changed:
        await log_activity(
            technician,
            "technician_onboarding_step_completed",
            "technician_onboarding",
            technician["id"],
            technician.get("name") or "Technician",
            f"Completed first-use workflow step: {step_id}",
            metadata={
                "step_id": step_id,
                "onboarding_version": onboarding.get("version"),
                "evidence_type": "technician_attestation",
                "is_compliant": onboarding.get("is_compliant"),
            },
        )
    return _response(technician, onboarding, changed=changed)


@router.get("/technicians")
async def list_technician_onboarding(current_user: dict = Depends(get_current_user)):
    """Provide Team Hub with a deliberately compact compliance view."""
    if not _is_admin(current_user):
        raise HTTPException(status_code=403, detail="Administrator access required")
    technicians = await db.users.find(
        {},
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "role": 1,
            "archived": 1,
            "is_active": 1,
            "technician_onboarding": 1,
        },
    ).sort("name", 1).to_list(1000)
    rows = [
        {**technician_onboarding_summary(technician), "archived": bool(technician.get("archived")), "is_active": technician.get("is_active", True)}
        for technician in _unique_technicians(technicians)
    ]
    return {
        "technicians": rows,
        "summary": {
            "total": len(rows),
            "compliant": sum(1 for row in rows if row["is_compliant"]),
            "required": sum(1 for row in rows if row["must_complete_before_operational_work"]),
        },
    }


@router.get("/technicians/{technician_id}")
async def get_technician_onboarding(technician_id: str, current_user: dict = Depends(get_current_user)):
    """Let a technician see their own evidence, or an administrator review it."""
    technician = await _require_self_or_admin(technician_id, current_user)
    onboarding = await get_or_create_technician_onboarding(db, technician)
    return _response(technician, onboarding)
