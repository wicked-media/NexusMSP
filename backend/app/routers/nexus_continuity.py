"""Nexus Core continuity policy, restore-point evidence and fresh-host recovery plans.

The web API never performs a live MongoDB overwrite or handles platform
secrets.  Capture and import are performed by the reviewed host recovery
runner, while this workspace records the non-secret policy, evidence, scoped
approval boundary and isolated restore proof that make a server move safe.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.platform_recovery import (
    RECOVERY_COMPONENTS,
    RECOVERY_DESTINATION_IDS,
    RECOVERY_DESTINATIONS,
    REQUIRED_SECRET_IDENTIFIERS,
    RESTORE_RUN_STEPS,
    build_default_profile,
    public_profile,
    public_restore_point,
    public_restore_run,
    recovery_status,
    restore_point_manifest_requirements,
    utc_now,
)
from app.services.scope_permissions import assert_global_scope


router = APIRouter(tags=["Nexus Platform Continuity"])
_CHECKSUM_RE = re.compile(r"^[A-Fa-f0-9]{64}$")
_PROFILE_ID = "default"


def _is_platform_admin(user: dict[str, Any]) -> bool:
    return bool(user.get("is_admin") or str(user.get("role") or "").lower() in {"admin", "owner"})


def _platform_scope_user(user: dict[str, Any]) -> dict[str, Any]:
    return {**user, "is_admin": True} if _is_platform_admin(user) else user


async def _require_platform_operator(user=Depends(get_current_user)) -> dict[str, Any]:
    if not _is_platform_admin(user):
        raise HTTPException(status_code=403, detail="Nexus Platform Recovery administrator permission required")
    return user


async def _assert_recovery_scope(user: dict[str, Any], request: Request, operation: str) -> None:
    await assert_global_scope(_platform_scope_user(user), operation=operation, request=request)


async def _profile_or_default(user: dict[str, Any]) -> dict[str, Any]:
    profile = await db.nexus_platform_backup_profiles.find_one({"id": _PROFILE_ID}, {"_id": 0})
    return profile or build_default_profile(actor=user)


async def _get_restore_point(restore_point_id: str) -> dict[str, Any]:
    point = await db.nexus_platform_restore_points.find_one({"id": str(restore_point_id)}, {"_id": 0})
    if not point:
        raise HTTPException(status_code=404, detail="Platform restore point not found")
    return point


async def _record_event(
    *,
    entity_type: str,
    entity_id: str,
    event_type: str,
    user: dict[str, Any],
    request: Request,
    detail: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    now = utc_now()
    event = {
        "id": str(uuid.uuid4()),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "event_type": event_type,
        "detail": detail,
        "actor_id": user.get("id") or user.get("email") or "Nexus administrator",
        "actor_name": user.get("name") or user.get("email") or "Nexus administrator",
        "correlation_id": getattr(request.state, "correlation_id", None),
        "occurred_at": now,
        "immutable": True,
    }
    await db.nexus_platform_recovery_events.insert_one(event)
    await log_activity(
        user,
        f"nexus_platform_recovery_{event_type}",
        entity_type,
        entity_id,
        "Nexus Platform Recovery",
        detail,
        metadata={"platform_scope": True, **(metadata or {})},
    )


async def _snapshot_inventory() -> dict[str, int]:
    """Collect only non-sensitive count evidence; never serialise platform data."""
    collection_names = ("clients", "contacts", "devices", "tickets", "projects", "invoices", "products", "assets")
    results = await asyncio.gather(*(
        db[name].count_documents({})
        for name in collection_names
    ), return_exceptions=True)
    return {
        name: int(result) if isinstance(result, int) else 0
        for name, result in zip(collection_names, results)
    }


class RecoveryProfileUpdate(BaseModel):
    enabled: bool = False
    destination_type: str = Field(default="", max_length=80)
    destination_name: str = Field(default="", max_length=180)
    cadence: Literal["hourly", "daily", "weekly"] = "daily"
    rpo_hours: int = Field(default=24, ge=1, le=720)
    retention_days: int = Field(default=30, ge=7, le=3650)
    immutable_storage_attested: bool = False
    encryption_attested: bool = False
    include_uploads: bool = True
    include_agent_installers: bool = True
    owner: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=2_000)
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("destination_type")
    @classmethod
    def valid_destination(cls, value: str) -> str:
        value = value.strip()
        if value and value not in RECOVERY_DESTINATION_IDS:
            raise ValueError("Choose an approved recovery destination type")
        return value


class RestorePointRequest(BaseModel):
    kind: Literal["manual", "pre_change", "scheduled"] = "manual"
    reason: str = Field(min_length=3, max_length=1_000)
    idempotency_key: str | None = Field(default=None, max_length=160)


class RestorePointEvidence(BaseModel):
    storage_reference: str = Field(min_length=3, max_length=500)
    package_checksum: str = Field(min_length=64, max_length=64)
    package_bytes: int = Field(ge=1)
    file_count: int = Field(ge=1, le=10_000_000)
    captured_at: str = Field(min_length=10, max_length=80)
    release_reference: str = Field(min_length=2, max_length=240)
    collection_counts: dict[str, int] = Field(default_factory=dict)
    include_uploads: bool = True
    include_agent_installers: bool = True
    note: str = Field(default="", max_length=2_000)

    @field_validator("package_checksum")
    @classmethod
    def valid_checksum(cls, value: str) -> str:
        value = value.strip().lower()
        if not _CHECKSUM_RE.fullmatch(value):
            raise ValueError("Package checksum must be a SHA-256 value")
        return value

    @field_validator("collection_counts")
    @classmethod
    def valid_counts(cls, value: dict[str, int]) -> dict[str, int]:
        clean: dict[str, int] = {}
        for key, count in value.items():
            name = str(key).strip()
            if not name or len(name) > 120 or not isinstance(count, int) or count < 0:
                raise ValueError("Collection counts must use safe names and non-negative integers")
            clean[name] = count
        return clean


class RestoreVerificationCreate(BaseModel):
    restore_point_id: str = Field(min_length=8, max_length=80)
    target_label: str = Field(min_length=3, max_length=240)
    isolated_target_attested: bool
    database_count_match: bool
    artifact_inventory_match: bool
    application_health_verified: bool
    scope_validation_verified: bool
    agent_heartbeat_verified: bool
    secret_identifiers_confirmed: bool
    notes: str = Field(default="", max_length=2_000)


class CutoverPlanCreate(BaseModel):
    restore_point_id: str = Field(min_length=8, max_length=80)
    target_label: str = Field(min_length=3, max_length=240)
    change_reference: str = Field(min_length=3, max_length=240)
    planned_window: str = Field(min_length=3, max_length=240)
    owner: str = Field(min_length=2, max_length=160)
    idempotency_key: str | None = Field(default=None, max_length=160)


@router.get(
    "/nexus-continuity/overview",
    dependencies=[Depends(require_action("platform.recovery.view"))],
)
async def continuity_overview(request: Request, user=Depends(_require_platform_operator)):
    await _assert_recovery_scope(user, request, "nexus-continuity.overview")
    profile, points, runs, cutovers = await asyncio.gather(
        _profile_or_default(user),
        db.nexus_platform_restore_points.find({}, {"_id": 0}).sort("requested_at", -1).to_list(50),
        db.nexus_platform_restore_runs.find({}, {"_id": 0}).sort("created_at", -1).to_list(50),
        db.nexus_platform_cutover_plans.find({}, {"_id": 0}).sort("created_at", -1).to_list(50),
    )
    latest_point = next((item for item in points if item.get("status") in {"captured_unverified", "verified"}), None)
    latest_run = next((item for item in runs if item.get("status") == "passed"), None)
    return {
        "summary": recovery_status(profile, latest_point, latest_run),
        "boundary": (
            "Nexus records recovery policy and evidence here. The browser and API do not create a database dump, "
            "transport a secret, or overwrite a live platform. Capture and fresh-host restore run through the reviewed host runner."
        ),
        "profile": public_profile(profile),
        "destinations": list(RECOVERY_DESTINATIONS),
        "components": list(RECOVERY_COMPONENTS),
        "required_secret_identifiers": list(REQUIRED_SECRET_IDENTIFIERS),
        "manifest_requirements": restore_point_manifest_requirements(),
        "restore_sequence": list(RESTORE_RUN_STEPS),
        "restore_points": [public_restore_point(item) for item in points],
        "restore_runs": [public_restore_run(item) for item in runs],
        "cutover_plans": [public_restore_run(item) for item in cutovers],
        "host_runner": {
            "mode": "operator-runner-required",
            "export_script": "scripts/Export-NexusPlatformRecovery.ps1",
            "import_script": "scripts/Import-NexusPlatformRecovery.ps1",
            "runbook": "docs/PLATFORM_RECOVERY_RUNBOOK.md",
        },
        "generated_at": utc_now(),
    }


@router.put(
    "/nexus-continuity/profile",
    dependencies=[Depends(require_action("platform.recovery.manage"))],
)
async def update_recovery_profile(payload: RecoveryProfileUpdate, request: Request, user=Depends(_require_platform_operator)):
    await _assert_recovery_scope(user, request, "nexus-continuity.profile.update")
    stored_profile = await db.nexus_platform_backup_profiles.find_one({"id": _PROFILE_ID}, {"_id": 0})
    current = stored_profile or build_default_profile(actor=user)
    if payload.expected_version is not None and payload.expected_version != int(current.get("version") or 1):
        raise HTTPException(status_code=409, detail="The recovery policy changed in another session. Refresh before saving.")
    body = payload.model_dump(exclude={"expected_version"})
    if body["enabled"] and not (body["destination_type"] and body["destination_name"] and body["owner"]):
        raise HTTPException(status_code=422, detail="An enabled recovery policy needs a destination type, destination name and named owner")
    if body["enabled"] and not (body["immutable_storage_attested"] and body["encryption_attested"]):
        raise HTTPException(status_code=422, detail="Attest encrypted and immutable off-host storage before enabling the policy")
    now = utc_now()
    profile = {
        **current,
        **body,
        "id": _PROFILE_ID,
        "updated_at": now,
        "updated_by": user.get("id") or user.get("email") or "Nexus administrator",
        "version": int(current.get("version") or 1) + 1,
    }
    query: dict[str, Any] = {"id": _PROFILE_ID}
    if payload.expected_version is not None and stored_profile:
        query["version"] = int(current.get("version") or 1)
    result = await db.nexus_platform_backup_profiles.replace_one(query, profile, upsert=not bool(stored_profile))
    if payload.expected_version is not None and stored_profile and not result.matched_count:
        raise HTTPException(status_code=409, detail="The recovery policy changed in another session. Refresh before saving.")
    await _record_event(
        entity_type="nexus_platform_backup_profile",
        entity_id=_PROFILE_ID,
        event_type="policy_updated",
        user=user,
        request=request,
        detail="Updated non-secret Nexus platform recovery policy. No backup package was created by this browser action.",
        metadata={"enabled": profile["enabled"], "destination_type": profile["destination_type"]},
    )
    return {"profile": public_profile(profile)}


@router.post(
    "/nexus-continuity/restore-points",
    dependencies=[Depends(require_action("platform.recovery.manage"))],
)
async def request_restore_point(payload: RestorePointRequest, request: Request, user=Depends(_require_platform_operator)):
    await _assert_recovery_scope(user, request, "nexus-continuity.restore-point.request")
    profile = await _profile_or_default(user)
    if not public_profile(profile)["configured"]:
        raise HTTPException(status_code=409, detail="Configure and attest the off-host recovery policy before requesting a restore point")
    key = str(payload.idempotency_key or "").strip()
    if key:
        existing = await db.nexus_platform_restore_points.find_one({"idempotency_key": key}, {"_id": 0})
        if existing:
            return {"restore_point": public_restore_point(existing), "idempotent": True}
    now = utc_now()
    point = {
        "id": str(uuid.uuid4()),
        "kind": payload.kind,
        "reason": payload.reason.strip(),
        "idempotency_key": key or None,
        "status": "awaiting_host_capture",
        "profile_version": int(profile.get("version") or 1),
        "requested_at": now,
        "requested_by": user.get("id") or user.get("email") or "Nexus administrator",
        "inventory_before_capture": await _snapshot_inventory(),
        "manifest_requirements": restore_point_manifest_requirements(),
        "capture_boundary": "Host runner must create a validated package, place it in the attested encrypted destination and record a non-secret manifest. Nexus has not captured platform data yet.",
        "evidence": None,
    }
    await db.nexus_platform_restore_points.insert_one(point)
    await _record_event(
        entity_type="nexus_platform_restore_point",
        entity_id=point["id"],
        event_type="capture_requested",
        user=user,
        request=request,
        detail="Requested a platform restore point. The host runner must complete capture; no API backup was created.",
        metadata={"kind": point["kind"]},
    )
    return {"restore_point": public_restore_point(point), "idempotent": False}


@router.post(
    "/nexus-continuity/restore-points/{restore_point_id}/evidence",
    dependencies=[Depends(require_action("platform.recovery.manage"))],
)
async def record_restore_point_evidence(restore_point_id: str, payload: RestorePointEvidence, request: Request, user=Depends(_require_platform_operator)):
    await _assert_recovery_scope(user, request, "nexus-continuity.restore-point.evidence")
    point = await _get_restore_point(restore_point_id)
    if point.get("status") not in {"awaiting_host_capture", "capture_failed"}:
        raise HTTPException(status_code=409, detail="Backup evidence has already been recorded for this restore point")
    evidence = payload.model_dump()
    updated = {
        **point,
        "status": "captured_unverified",
        "evidence": evidence,
        "captured_at": evidence["captured_at"],
        "recorded_at": utc_now(),
        "recorded_by": user.get("id") or user.get("email") or "Nexus administrator",
    }
    result = await db.nexus_platform_restore_points.replace_one(
        {"id": point["id"], "status": point.get("status")},
        updated,
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Restore point status changed in another session. Refresh before recording evidence.")
    await _record_event(
        entity_type="nexus_platform_restore_point",
        entity_id=point["id"],
        event_type="capture_evidence_recorded",
        user=user,
        request=request,
        detail="Recorded non-secret backup manifest evidence. The recovery point is not verified until an isolated restore test passes.",
        metadata={"storage_reference": evidence["storage_reference"], "package_checksum": evidence["package_checksum"]},
    )
    return {"restore_point": public_restore_point(updated)}


@router.post(
    "/nexus-continuity/restore-verifications",
    dependencies=[Depends(require_action("platform.recovery.restore"))],
)
async def record_restore_verification(payload: RestoreVerificationCreate, request: Request, user=Depends(_require_platform_operator)):
    await _assert_recovery_scope(user, request, "nexus-continuity.restore-verification.create")
    point = await _get_restore_point(payload.restore_point_id)
    if point.get("status") != "captured_unverified":
        raise HTTPException(status_code=409, detail="A completed backup manifest is required before recording an isolated restore verification")
    checks = {
        "isolated_target_attested": payload.isolated_target_attested,
        "database_count_match": payload.database_count_match,
        "artifact_inventory_match": payload.artifact_inventory_match,
        "application_health_verified": payload.application_health_verified,
        "scope_validation_verified": payload.scope_validation_verified,
        "agent_heartbeat_verified": payload.agent_heartbeat_verified,
        "secret_identifiers_confirmed": payload.secret_identifiers_confirmed,
    }
    passed = all(checks.values())
    run = {
        "id": str(uuid.uuid4()),
        "restore_point_id": point["id"],
        "target_label": payload.target_label.strip(),
        "status": "passed" if passed else "failed",
        "checks": checks,
        "notes": payload.notes.strip(),
        "created_at": utc_now(),
        "created_by": user.get("id") or user.get("email") or "Nexus administrator",
        "execution_boundary": "operator_attested_isolated_restore",
    }
    await db.nexus_platform_restore_runs.insert_one(run)
    if passed:
        await db.nexus_platform_restore_points.update_one(
            {"id": point["id"], "status": "captured_unverified"},
            {"$set": {"status": "verified", "verified_at": run["created_at"], "verified_by": run["created_by"]}},
        )
    await _record_event(
        entity_type="nexus_platform_restore_run",
        entity_id=run["id"],
        event_type="restore_verification_passed" if passed else "restore_verification_failed",
        user=user,
        request=request,
        detail=(
            "Recorded a passing isolated restore verification. This did not cut over or overwrite the live Nexus platform."
            if passed else "Recorded a failed or incomplete isolated restore verification. Nexus remains unchanged."
        ),
        metadata={"restore_point_id": point["id"], "target_label": run["target_label"]},
    )
    return {"restore_run": public_restore_run(run), "restore_point_status": "verified" if passed else "captured_unverified"}


@router.post(
    "/nexus-continuity/cutover-plans",
    dependencies=[Depends(require_action("platform.recovery.restore"))],
)
async def create_cutover_plan(payload: CutoverPlanCreate, request: Request, user=Depends(_require_platform_operator)):
    await _assert_recovery_scope(user, request, "nexus-continuity.cutover-plan.create")
    point = await _get_restore_point(payload.restore_point_id)
    if point.get("status") != "verified":
        raise HTTPException(status_code=409, detail="A verified isolated restore point is required before preparing a fresh-host cutover plan")
    key = str(payload.idempotency_key or "").strip()
    if key:
        existing = await db.nexus_platform_cutover_plans.find_one({"idempotency_key": key}, {"_id": 0})
        if existing:
            return {"cutover_plan": public_restore_run(existing), "idempotent": True}
    now = utc_now()
    plan = {
        "id": str(uuid.uuid4()),
        "restore_point_id": point["id"],
        "target_label": payload.target_label.strip(),
        "change_reference": payload.change_reference.strip(),
        "planned_window": payload.planned_window.strip(),
        "owner": payload.owner.strip(),
        "idempotency_key": key or None,
        "status": "planned_not_executed",
        "steps": list(RESTORE_RUN_STEPS) + [
            "Create a final pre-cutover restore point of the source host.",
            "Obtain independent change approval, then update traffic only after post-restore checks pass.",
            "Keep the source host available for the documented rollback window; do not destroy it as part of the cutover.",
        ],
        "created_at": now,
        "created_by": user.get("id") or user.get("email") or "Nexus administrator",
        "execution_boundary": "plan_only_no_live_restore",
    }
    await db.nexus_platform_cutover_plans.insert_one(plan)
    await _record_event(
        entity_type="nexus_platform_cutover_plan",
        entity_id=plan["id"],
        event_type="cutover_plan_created",
        user=user,
        request=request,
        detail="Prepared a guarded fresh-host cutover plan. No traffic, service, database or volume was changed.",
        metadata={"restore_point_id": point["id"], "change_reference": plan["change_reference"]},
    )
    return {"cutover_plan": public_restore_run(plan), "idempotent": False}
