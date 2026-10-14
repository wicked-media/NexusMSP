"""Nexus Access — privileged-access brokering tool inside the Nexus Elevate workspace.

This router is the merged home for roadmap feature #488 (Nexus Access). Nexus
Elevate already brokers just-in-time privileged access with approvals, expiry
and session evidence; this adds the missing credential-rotation boundaries so
an MSP can govern *when* each managed credential rotates and evidence the
rotation — without Nexus ever receiving, storing or replaying credential
material. Requests carrying anything that looks like credential material are
refused outright.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.action_permissions import require_action
from app.services.roadmap_tools import find_sensitive_keys, rotation_schedule
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query


router = APIRouter(tags=["Nexus Access"])

INTERVAL_LIMITS = Field(ge=1, le=365)


class _NoCredentialMaterial(BaseModel):
    """Shared boundary: refuse anything shaped like credential material."""

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def _refuse_credential_material(cls, data: Any) -> Any:
        if isinstance(data, dict):
            offending = find_sensitive_keys(data)
            if offending:
                raise ValueError(
                    "Nexus Access records rotation boundaries and evidence only; "
                    f"credential material is never accepted (offending fields: {', '.join(offending)})"
                )
        return data


class RotationBoundaryIn(_NoCredentialMaterial):
    label: str = Field(min_length=3, max_length=120)
    provider: str = Field(min_length=1, max_length=60)
    scope: Literal["tenant", "client", "device"] = "tenant"
    client_id: str = Field(default="", max_length=120)
    device_id: str = Field(default="", max_length=120)
    interval_days: int = INTERVAL_LIMITS
    owner: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=500)


class RotationRecordIn(_NoCredentialMaterial):
    evidence_note: str = Field(min_length=1, max_length=500)
    rotated_at: datetime | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _boundary_query(current_user: dict[str, Any]) -> dict[str, Any]:
    return tenant_scoped_query(current_user, {})


def _public_boundary(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    schedule = rotation_schedule(row.get("last_rotated_at"), int(row.get("interval_days") or 30), now)
    return {
        "id": row.get("id"),
        "label": row.get("label"),
        "provider": row.get("provider"),
        "scope": row.get("scope"),
        "client_id": row.get("client_id") or "",
        "device_id": row.get("device_id") or "",
        "interval_days": row.get("interval_days"),
        "owner": row.get("owner") or "",
        "notes": row.get("notes") or "",
        "rotation_count": int(row.get("rotation_count") or 0),
        **schedule,
    }


@router.get("/nexus-access/rotation-boundaries")
async def list_rotation_boundaries(current_user: dict = Depends(get_current_user)):
    """List this tenant's credential-rotation boundaries with live due state."""
    rows = await db.nexus_access_rotation_boundaries.find(
        _boundary_query(current_user), {"_id": 0}
    ).sort([("label", 1)]).to_list(500)
    now = _now()
    return {"boundaries": [_public_boundary(row, now) for row in rows], "count": len(rows)}


@router.post(
    "/nexus-access/rotation-boundaries",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_rotation_boundary(
    payload: RotationBoundaryIn,
    current_user: dict = Depends(get_current_user),
):
    """Register one credential-rotation boundary (never credential material)."""
    if payload.scope == "client" and not payload.client_id.strip():
        raise HTTPException(status_code=422, detail="Client-scoped boundaries require a client_id")
    if payload.scope == "device" and not payload.device_id.strip():
        raise HTTPException(status_code=422, detail="Device-scoped boundaries require a device_id")
    now = _now()
    document = {
        "id": f"rotb-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "label": payload.label.strip(),
        "provider": payload.provider.strip(),
        "scope": payload.scope,
        "client_id": payload.client_id.strip(),
        "device_id": payload.device_id.strip(),
        "interval_days": payload.interval_days,
        "owner": payload.owner.strip(),
        "notes": payload.notes.strip(),
        "rotation_count": 0,
        "last_rotated_at": None,
        "created_by": str(current_user.get("id") or ""),
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await db.nexus_access_rotation_boundaries.insert_one(dict(document))
    await log_activity(
        current_user,
        "nexus_access.rotation_boundary_created",
        "rotation_boundary",
        document["id"],
        document["label"],
        details=f"{document['provider']} rotates every {document['interval_days']} days ({document['scope']} scope)",
    )
    return _public_boundary(document, now)


@router.post(
    "/nexus-access/rotation-boundaries/{boundary_id}/record-rotation",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def record_rotation(
    boundary_id: str,
    payload: RotationRecordIn,
    current_user: dict = Depends(get_current_user),
):
    """Evidence one completed rotation and advance the boundary's schedule."""
    query = tenant_scoped_query(current_user, {"id": boundary_id})
    row = await db.nexus_access_rotation_boundaries.find_one(query, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Rotation boundary not found")
    rotated_at = (payload.rotated_at or _now()).astimezone(timezone.utc)
    update = {
        "last_rotated_at": rotated_at.isoformat(),
        "rotation_count": int(row.get("rotation_count") or 0) + 1,
        "updated_at": _now().isoformat(),
    }
    await db.nexus_access_rotation_boundaries.update_one(query, {"$set": update})
    event = {
        "id": f"rote-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "boundary_id": boundary_id,
        "evidence_note": payload.evidence_note.strip(),
        "rotated_at": rotated_at.isoformat(),
        "recorded_by": str(current_user.get("id") or ""),
    }
    await db.nexus_access_rotation_events.insert_one(dict(event))
    await log_activity(
        current_user,
        "nexus_access.rotation_recorded",
        "rotation_boundary",
        boundary_id,
        str(row.get("label") or ""),
        details=payload.evidence_note.strip(),
    )
    merged = {**row, **update}
    return _public_boundary(merged, _now())


@router.get("/nexus-access/overview")
async def nexus_access_overview(current_user: dict = Depends(get_current_user)):
    """Summarise brokered privileged access and rotation readiness in one view."""
    rows = await db.nexus_access_rotation_boundaries.find(
        _boundary_query(current_user), {"_id": 0}
    ).to_list(500)
    now = _now()
    public = [_public_boundary(row, now) for row in rows]
    due = [row for row in public if row["due"]]
    overdue = [row for row in public if row["overdue"]]
    active_requests = await db.nexus_elevate_requests.count_documents(
        tenant_scoped_query(current_user, {"status": {"$in": ["approved", "active", "in_review"]}})
    )
    return {
        "boundaries_total": len(public),
        "rotations_due": len(due),
        "rotations_overdue": len(overdue),
        "due_boundaries": [
            {"id": row["id"], "label": row["label"], "provider": row["provider"], "overdue": row["overdue"]}
            for row in sorted(due, key=lambda item: item["next_due_at"])[:10]
        ],
        "active_access_requests": active_requests,
        "policy": [
            "Nexus brokers privileged access; it never collects, stores or replays credential material.",
            "Rotation boundaries record schedule and evidence only.",
            "Just-in-time grants, approvals, expiry and session evidence remain owned by Nexus Elevate.",
        ],
    }
