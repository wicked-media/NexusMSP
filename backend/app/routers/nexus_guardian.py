"""Nexus Guardian — the Nexus-branded adaptive SOC workspace API.

Unlike third-party MDR consoles, Guardian is built on evidence Nexus already
owns (Defender posture, agent detections, SOC alerts) and adapts to how each
technician triages. All reads are workspace-scoped; feedback is stored per
tenant so learning never crosses a customer boundary.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.nexus_guardian import (
    adaptive_suggestions,
    defender_posture,
    learn_from_feedback,
    rank_queue,
)
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter()

DISPOSITIONS = {"true_positive", "false_positive", "accepted_risk"}


class GuardianFeedback(BaseModel):
    model_config = {"extra": "forbid"}

    signal: str = Field(min_length=1, max_length=120)
    disposition: str = Field(min_length=1, max_length=40)
    client_id: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=500)


async def _load_feedback_profile(tenant_id: str) -> dict:
    profile = await db.nexus_guardian_profiles.find_one({"tenant_id": tenant_id}, {"_id": 0})
    return profile or {"tenant_id": tenant_id, "signal_weights": {}, "disposition_counts": {}}


@router.get("/nexus-guardian/triage-queue")
async def get_triage_queue(
    limit: int = 50,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Adaptive, explainable triage queue over stored SOC alerts."""
    query = scoped_query(current_user, {"client_id": client_id} if client_id else {}, site_field=None)
    alerts = await db.soc_alerts.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    profile = await _load_feedback_profile(current_user.get("tenant_id", ""))
    ranked = rank_queue(alerts, profile)
    return {
        "count": len(ranked[: max(1, min(limit, 200))]),
        "queue": ranked[: max(1, min(limit, 200))],
        "adaptive": {
            "signal_weights": profile.get("signal_weights", {}),
            "suggestions": adaptive_suggestions(profile),
        },
    }


@router.get("/nexus-guardian/posture")
async def get_posture(current_user: dict = Depends(get_current_user)):
    """Windows Defender posture across enrolled endpoints. Unassessed is never 'healthy'."""
    devices = await db.devices.find(scoped_query(current_user, {}, site_field=None), {"_id": 0}).to_list(5000)
    return {"defender": defender_posture(devices)}


@router.get("/nexus-guardian/insights")
async def get_insights(current_user: dict = Depends(get_current_user)):
    """What Guardian has learned from this tenant's own triage behaviour."""
    profile = await _load_feedback_profile(current_user.get("tenant_id", ""))
    return {
        "signal_weights": profile.get("signal_weights", {}),
        "disposition_counts": profile.get("disposition_counts", {}),
        "suggestions": adaptive_suggestions(profile),
        "updated_at": profile.get("updated_at"),
    }


@router.post("/nexus-guardian/feedback")
async def record_feedback(
    payload: GuardianFeedback,
    current_user: dict = Depends(get_current_user),
):
    """Record a triage disposition; Guardian adapts future ranking from it."""
    if payload.disposition not in DISPOSITIONS:
        raise HTTPException(status_code=422, detail=f"disposition must be one of {sorted(DISPOSITIONS)}")
    if payload.client_id:
        await assert_client_scope(
            current_user, payload.client_id, operation="nexus_guardian.feedback", mask_not_found=True
        )

    tenant_id = current_user.get("tenant_id", "")
    profile = await _load_feedback_profile(tenant_id)
    try:
        updated = learn_from_feedback(profile, payload.signal, payload.disposition)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    await db.nexus_guardian_profiles.replace_one(
        {"tenant_id": tenant_id}, updated, upsert=True
    )
    await log_activity(
        current_user,
        "nexus_guardian.feedback",
        "nexus_guardian",
        payload.signal,
        payload.signal,
        details=f"Recorded {payload.disposition} for signal {payload.signal}",
    )
    return {
        "status": "recorded",
        "signal": payload.signal,
        "disposition": payload.disposition,
        "signal_weights": updated.get("signal_weights", {}),
        "suggestions": adaptive_suggestions(updated),
    }
