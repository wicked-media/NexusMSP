"""Nexus Switchboard: evidence-first migration planning.

This router intentionally stops before a provider import boundary.  A plan may
record source readiness, mappings, exceptions and cutover evidence, but it
never calls an external provider or changes canonical Nexus business records.
That makes the first release useful for a controlled MSP migration without
turning an unreviewed connector into a bulk-write engine.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.nexus_switchboard import (
    OBJECT_SCOPE_IDS,
    PROVIDER_IDS,
    SWITCHBOARD_PROVIDERS,
    STAGE_LABELS,
    build_plan,
    evidence_for_plan,
    public_plan,
    recalculate_plan,
    utc_now,
)
from app.services.scope_permissions import assert_global_scope


router = APIRouter(tags=["Nexus Switchboard"])


def _is_platform_admin(user: dict[str, Any]) -> bool:
    return bool(user.get("is_admin") or str(user.get("role") or "").lower() in {"admin", "owner"})


def _platform_scope_user(user: dict[str, Any]) -> dict[str, Any]:
    """Owners are global operators but older scope code recognises only admins."""
    return {**user, "is_admin": True} if _is_platform_admin(user) else user


async def _require_platform_operator(user=Depends(get_current_user)) -> dict[str, Any]:
    if not _is_platform_admin(user):
        raise HTTPException(status_code=403, detail="Nexus Switchboard administrator permission required")
    return user


async def _assert_switchboard_scope(user: dict[str, Any], request: Request, operation: str) -> None:
    await assert_global_scope(_platform_scope_user(user), operation=operation, request=request)


async def _get_plan(plan_id: str) -> dict[str, Any]:
    plan = await db.nexus_switchboard_plans.find_one({"id": str(plan_id)}, {"_id": 0})
    if not plan:
        raise HTTPException(status_code=404, detail="Migration plan not found")
    return recalculate_plan(plan)


async def _record_event(
    *,
    plan: dict[str, Any],
    event_type: str,
    user: dict[str, Any],
    request: Request,
    detail: str,
) -> None:
    now = utc_now()
    event = {
        "id": str(uuid.uuid4()),
        "plan_id": plan["id"],
        "event_type": event_type,
        "detail": detail,
        "actor_id": user.get("id") or user.get("email") or "Nexus administrator",
        "actor_name": user.get("name") or user.get("email") or "Nexus administrator",
        "correlation_id": getattr(request.state, "correlation_id", None),
        "occurred_at": now,
        "immutable": True,
    }
    await db.nexus_switchboard_events.insert_one(event)
    await log_activity(
        user,
        f"nexus_switchboard_{event_type}",
        "nexus_switchboard_plan",
        plan["id"],
        plan.get("name") or "Migration plan",
        detail,
        metadata={"provider": plan.get("provider"), "stage": plan.get("stage"), "execution_boundary": "planning_only"},
    )


class SwitchboardPlanCreate(BaseModel):
    name: str = Field(min_length=3, max_length=140)
    provider: str = Field(min_length=2, max_length=64)
    scope: list[str] = Field(min_length=1, max_length=7)
    notes: str = Field(default="", max_length=2_000)
    idempotency_key: str | None = Field(default=None, max_length=160)

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        value = value.strip()
        if value not in PROVIDER_IDS:
            raise ValueError("Choose an approved Switchboard source")
        return value

    @field_validator("scope")
    @classmethod
    def validate_scope(cls, value: list[str]) -> list[str]:
        clean = sorted({item.strip().lower() for item in value if item and item.strip().lower() in OBJECT_SCOPE_IDS})
        if not clean:
            raise ValueError("Choose at least one supported migration object scope")
        return clean


class SwitchboardPlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=140)
    provider: str | None = Field(default=None, min_length=2, max_length=64)
    scope: list[str] | None = Field(default=None, min_length=1, max_length=7)
    notes: str | None = Field(default=None, max_length=2_000)
    source_readiness: dict[str, Any] | None = None
    mappings: list[dict[str, Any]] | None = Field(default=None, max_length=7)
    exceptions: list[dict[str, Any]] | None = Field(default=None, max_length=100)
    reconciliation: list[dict[str, Any]] | None = Field(default=None, max_length=20)
    cutover: list[dict[str, Any]] | None = Field(default=None, max_length=20)
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("provider")
    @classmethod
    def validate_optional_provider(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if value not in PROVIDER_IDS:
            raise ValueError("Choose an approved Switchboard source")
        return value

    @field_validator("scope")
    @classmethod
    def validate_optional_scope(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        clean = sorted({item.strip().lower() for item in value if item and item.strip().lower() in OBJECT_SCOPE_IDS})
        if not clean:
            raise ValueError("Choose at least one supported migration object scope")
        return clean


class SwitchboardReview(BaseModel):
    decision: Literal["reviewed", "reopen"]
    note: str = Field(default="", max_length=2_000)
    expected_version: int | None = Field(default=None, ge=1)


@router.get(
    "/nexus-switchboard/overview",
    dependencies=[Depends(require_action("platform.migration.view"))],
)
async def switchboard_overview(request: Request, user=Depends(_require_platform_operator)):
    await _assert_switchboard_scope(user, request, "nexus-switchboard.overview")
    plans = await db.nexus_switchboard_plans.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    public_plans = [public_plan(recalculate_plan(item)) for item in plans]
    open_exceptions = sum(int((item.get("counts") or {}).get("exceptions_open") or 0) for item in public_plans)
    mappings_reviewed = sum(int((item.get("counts") or {}).get("mapping_reviewed") or 0) for item in public_plans)
    providers_planned = len({item.get("provider") for item in public_plans if item.get("provider")})
    return {
        "summary": {
            "plans": len(public_plans),
            "review_ready": sum(1 for item in public_plans if item.get("status") == "review_ready"),
            "open_exceptions": open_exceptions,
            "providers_planned": providers_planned,
            # Short aliases retain compatibility with the shared workspace metric
            # convention without making a second source of truth.
            "exceptions": open_exceptions,
            "mappings": mappings_reviewed,
            "providers": providers_planned,
        },
        "boundary": (
            "Nexus Switchboard currently records a governed migration plan only. Opening this workspace, "
            "saving a plan or marking a checklist item never calls Syncro, Halo, NinjaOne, ConnectWise, "
            "Autotask, Hudu, IT Glue or any other source—and never writes canonical Nexus records."
        ),
        "providers": list(SWITCHBOARD_PROVIDERS),
        "object_scopes": [
            {"id": object_id, "label": object_id.replace("_", " ").title()}
            for object_id in sorted(OBJECT_SCOPE_IDS)
        ],
        "stages": [{"id": stage, "label": label} for stage, label in STAGE_LABELS.items()],
        "capabilities": {
            "provider_connection": "not_available",
            "inventory_read": "not_available",
            "canonical_import": "not_available",
            "reconciliation_plan": "available",
            "cutover_evidence": "available",
            "migration_proof": "available",
        },
        "plans": public_plans,
        "generated_at": utc_now(),
    }


@router.post(
    "/nexus-switchboard/plans",
    dependencies=[Depends(require_action("platform.migration.manage"))],
)
async def create_switchboard_plan(payload: SwitchboardPlanCreate, request: Request, user=Depends(_require_platform_operator)):
    await _assert_switchboard_scope(user, request, "nexus-switchboard.create")
    body = payload.model_dump()
    key = str(body.get("idempotency_key") or "").strip()
    if key:
        existing = await db.nexus_switchboard_plans.find_one({"idempotency_key": key}, {"_id": 0})
        if existing:
            return {"plan": public_plan(recalculate_plan(existing)), "idempotent": True}
    plan = build_plan(plan_id=str(uuid.uuid4()), payload=body, actor=user)
    await db.nexus_switchboard_plans.insert_one(plan)
    await _record_event(
        plan=plan,
        event_type="plan_created",
        user=user,
        request=request,
        detail="Created an evidence-first migration plan. No provider connection, discovery or import was started.",
    )
    return {"plan": public_plan(plan), "idempotent": False}


@router.put(
    "/nexus-switchboard/plans/{plan_id}",
    dependencies=[Depends(require_action("platform.migration.manage"))],
)
async def update_switchboard_plan(plan_id: str, payload: SwitchboardPlanUpdate, request: Request, user=Depends(_require_platform_operator)):
    await _assert_switchboard_scope(user, request, "nexus-switchboard.update")
    current = await _get_plan(plan_id)
    if payload.expected_version is not None and payload.expected_version != current.get("version"):
        raise HTTPException(status_code=409, detail="This migration plan changed in another session. Refresh it before saving.")
    changed = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
    candidate = {**current, **changed}
    plan = recalculate_plan(candidate, actor=user)
    replace_query = {"id": plan_id}
    if payload.expected_version is not None:
        replace_query["version"] = current.get("version")
    result = await db.nexus_switchboard_plans.replace_one(replace_query, plan)
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This migration plan changed in another session. Refresh it before saving.")
    await _record_event(
        plan=plan,
        event_type="plan_updated",
        user=user,
        request=request,
        detail="Updated migration planning evidence. No provider connection, discovery or import was started.",
    )
    return {"plan": public_plan(plan)}


@router.post(
    "/nexus-switchboard/plans/{plan_id}/review",
    dependencies=[Depends(require_action("platform.migration.manage"))],
)
async def review_switchboard_plan(plan_id: str, payload: SwitchboardReview, request: Request, user=Depends(_require_platform_operator)):
    await _assert_switchboard_scope(user, request, "nexus-switchboard.review")
    current = await _get_plan(plan_id)
    if payload.expected_version is not None and payload.expected_version != current.get("version"):
        raise HTTPException(status_code=409, detail="This migration plan changed in another session. Refresh it before reviewing.")
    now = utc_now()
    candidate = {
        **current,
        "review": {
            "status": payload.decision,
            "note": payload.note.strip(),
            "reviewed_at": now,
            "reviewed_by": user.get("id") or user.get("email") or "Nexus administrator",
        },
    }
    plan = recalculate_plan(candidate, actor=user, now=now)
    replace_query = {"id": plan_id}
    if payload.expected_version is not None:
        replace_query["version"] = current.get("version")
    result = await db.nexus_switchboard_plans.replace_one(replace_query, plan)
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This migration plan changed in another session. Refresh it before reviewing.")
    await _record_event(
        plan=plan,
        event_type="plan_reviewed" if payload.decision == "reviewed" else "plan_reopened",
        user=user,
        request=request,
        detail=(
            "Recorded a migration-plan review. This is not approval to import or cut over."
            if payload.decision == "reviewed" else "Reopened the migration-plan review; no provider action was run."
        ),
    )
    return {"plan": public_plan(plan)}


@router.get(
    "/nexus-switchboard/plans/{plan_id}/evidence",
    dependencies=[Depends(require_action("platform.migration.view"))],
)
async def switchboard_plan_evidence(plan_id: str, request: Request, user=Depends(_require_platform_operator)):
    await _assert_switchboard_scope(user, request, "nexus-switchboard.evidence")
    plan = await _get_plan(plan_id)
    events = await db.nexus_switchboard_events.find({"plan_id": plan["id"]}, {"_id": 0}).sort("occurred_at", -1).to_list(100)
    return {
        "plan": public_plan(plan),
        "items": evidence_for_plan(plan),
        "events": events,
        "boundary": "Evidence shows preparation only. Nexus Switchboard has not queried a source or imported an object from this plan.",
    }
