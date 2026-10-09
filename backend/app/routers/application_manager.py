"""Nexus Application Manager API boundary.

This router exposes evidence-first application inventory, the global approval
register, and scoped implementation planning.  It intentionally does not
dispatch endpoint commands or call a package-management provider.
"""

from __future__ import annotations

from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import evaluate_action_permission, require_action
from app.services.activity import log_activity
from app.services.application_manager import (
    build_application_overview,
    clean_text,
    public_action_plan,
    utc_now,
)
from app.services.roadmap_tools import promotion_gate
from app.services.scope_permissions import (
    assert_client_scope,
    assert_global_scope,
    assert_tenant_record_scope,
    effective_scope,
    scoped_query,
    tenant_scoped_query,
)


router = APIRouter(tags=["Nexus Application Manager"])


def _tenant_id(current_user: dict) -> str:
    """Return the stable tenant boundary for newly owned App Manager data."""
    return clean_text(current_user.get("tenant_id"), limit=120) or "nexus-local"


def _tenant_scoped_query(current_user: dict, query: dict | None = None) -> dict:
    """Combine current client/site scope with an explicit tenant boundary."""
    scoped = scoped_query(current_user, query or {}, site_field=None)
    return {"$and": [scoped, {"tenant_id": _tenant_id(current_user)}]}


def _operational_tenant_query(current_user: dict, query: dict | None = None) -> dict:
    """Scope source evidence by both tenant and the caller's client/site grant."""
    return tenant_scoped_query(current_user, scoped_query(current_user, query or {}))


class ApplicationPolicyPayload(BaseModel):
    application_name: str = Field(min_length=1, max_length=300)
    publisher: str = Field(default="", max_length=300)
    approval_state: Literal["approved", "restricted", "review"] = "review"
    target_version: str = Field(default="", max_length=120)
    rollout_ring: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2_000)

    @field_validator("application_name", "publisher", "target_version", "rollout_ring", "notes")
    @classmethod
    def clean_fields(cls, value: str) -> str:
        return value.strip()


class ApplicationActionPlanPayload(BaseModel):
    action_type: Literal["update", "uninstall"]
    application_name: str = Field(min_length=1, max_length=300)
    publisher: str = Field(default="", max_length=300)
    device_ids: list[str] = Field(min_length=1, max_length=50)
    reason: str = Field(min_length=3, max_length=1_000)
    ticket_id: str | None = Field(default=None, max_length=120)
    idempotency_key: str = Field(min_length=8, max_length=160)

    @field_validator("application_name", "publisher", "reason", "ticket_id", "idempotency_key")
    @classmethod
    def clean_text_fields(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value

    @field_validator("device_ids")
    @classmethod
    def clean_device_ids(cls, value: list[str]) -> list[str]:
        cleaned = sorted({item.strip() for item in value if isinstance(item, str) and item.strip()})
        if not cleaned:
            raise ValueError("Choose at least one endpoint")
        return cleaned


async def _authorise_filters(
    *,
    current_user: dict,
    request: Request,
    client_id: str | None,
    device_id: str | None,
) -> None:
    """Treat direct filters as server-side resource access, not UI hints."""
    if client_id:
        scope = effective_scope(current_user)
        # A client-only filter is safe for a site-restricted technician because
        # the subsequent device query still carries the explicit site boundary.
        # Do not fabricate a site ID merely to satisfy ``assert_client_scope``.
        if scope["mode"] != "all" and str(client_id) not in scope["client_ids"]:
            await assert_client_scope(
                current_user,
                client_id,
                operation="application_manager.client_filter",
                request=request,
                mask_not_found=True,
            )
    if device_id:
        await assert_tenant_record_scope(
            current_user,
            db.devices,
            device_id,
            operation="application_manager.device_filter",
            request=request,
            resource_name="Device",
        )


@router.get("/application-manager/overview")
async def application_manager_overview(
    request: Request,
    client_id: str | None = Query(default=None, max_length=120),
    device_id: str | None = Query(default=None, max_length=120),
    current_user: dict = Depends(get_current_user),
):
    """Return application evidence within the caller's client/site scope."""
    await _authorise_filters(
        current_user=current_user,
        request=request,
        client_id=client_id,
        device_id=device_id,
    )
    include_policies = effective_scope(current_user)["mode"] == "all"
    policy_permission = await evaluate_action_permission(current_user, "platform.configuration.manage")
    plan_permission = await evaluate_action_permission(current_user, "device.command.execute")
    overview = await build_application_overview(
        db,
        current_user,
        scoped_query=_operational_tenant_query,
        tenant_query=tenant_scoped_query,
        client_id=client_id,
        device_id=device_id,
        include_policies=include_policies,
        tenant_id=_tenant_id(current_user),
    )
    overview["permissions"] = {
        "can_record_policy": bool(include_policies and policy_permission["allowed"]),
        "can_stage_plan": bool(plan_permission["allowed"]),
    }
    return overview


async def _ticket_reference_in_scope(
    current_user: dict,
    ticket_reference: str,
    *,
    request: Request,
) -> dict:
    """Resolve a stable ticket ID or displayed ticket number inside tenant scope."""
    reference = clean_text(ticket_reference, limit=120)
    ticket = await db.tickets.find_one(
        tenant_scoped_query(
            current_user,
            {"$or": [{"id": reference}, {"ticket_number": reference}]},
        ),
        {"_id": 0},
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await assert_client_scope(
        current_user,
        ticket.get("client_id"),
        site_id=ticket.get("site_id"),
        operation="application_manager.action_plan.ticket",
        request=request,
        mask_not_found=True,
    )
    return ticket


@router.get("/application-manager/action-plans")
async def list_application_action_plans(
    current_user: dict = Depends(get_current_user),
):
    """List retained plans only; a plan is never evidence of endpoint change."""
    rows = await db.application_manager_action_plans.find(
        _tenant_scoped_query(current_user),
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    return {
        "plans": [public_action_plan(row) for row in rows],
        "execution_boundary": "Application Manager retains governed plans only. A connected execution provider and approval workflow are required before any endpoint change can be dispatched.",
    }


@router.post(
    "/application-manager/policies",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_application_policy(
    payload: ApplicationPolicyPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Record an organisation-wide approval policy without enabling enforcement."""
    await assert_global_scope(
        current_user,
        operation="application_manager.policy.create",
        request=request,
    )
    now = utc_now()
    policy = {
        "id": f"app-policy-{uuid.uuid4().hex[:16]}",
        "tenant_id": _tenant_id(current_user),
        **payload.model_dump(),
        "created_at": now,
        "updated_at": now,
        "created_by": current_user.get("id") or current_user.get("email") or "Nexus operator",
        "created_by_name": current_user.get("name") or current_user.get("email") or "Nexus operator",
        "enforcement_state": "not_deployed",
    }
    await db.application_manager_policies.insert_one(policy)
    await log_activity(
        current_user,
        "application_policy_created",
        "application_policy",
        policy["id"],
        policy["application_name"],
        "Recorded an Application Manager approval policy. No endpoint action was dispatched.",
        metadata={
            "approval_state": policy["approval_state"],
            "rollout_ring": policy["rollout_ring"],
            "execution_state": "not_deployed",
            "correlation_id": getattr(request.state, "correlation_id", None),
        },
    )
    return {
        "policy": {
            **{key: value for key, value in policy.items() if key not in {"_id", "created_by"}},
            "enforcement_message": "Policy recorded. Configure a verified execution provider before relying on it to deploy software.",
        }
    }


@router.put(
    "/application-manager/policies/{policy_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def update_application_policy(
    policy_id: str,
    payload: ApplicationPolicyPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Revise one global approval record while retaining actor/time evidence."""
    await assert_global_scope(
        current_user,
        operation="application_manager.policy.update",
        request=request,
    )
    existing = await db.application_manager_policies.find_one(
        {"id": policy_id, "tenant_id": _tenant_id(current_user)},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Application approval record not found")
    update = {
        **payload.model_dump(),
        "updated_at": utc_now(),
        "updated_by": current_user.get("id") or current_user.get("email") or "Nexus operator",
        "updated_by_name": current_user.get("name") or current_user.get("email") or "Nexus operator",
        "enforcement_state": "not_deployed",
    }
    await db.application_manager_policies.update_one(
        {"id": policy_id, "tenant_id": _tenant_id(current_user)},
        {"$set": update},
    )
    policy = {**existing, **update}
    await log_activity(
        current_user,
        "application_policy_updated",
        "application_policy",
        policy_id,
        policy["application_name"],
        "Updated an Application Manager approval policy. No endpoint action was dispatched.",
        changes={key: {"old": existing.get(key), "new": update.get(key)} for key in type(payload).model_fields if existing.get(key) != update.get(key)},
        metadata={
            "approval_state": policy["approval_state"],
            "rollout_ring": policy["rollout_ring"],
            "execution_state": "not_deployed",
            "correlation_id": getattr(request.state, "correlation_id", None),
        },
    )
    return {
        "policy": {
            **policy,
            "enforcement_message": "Policy updated. Configure a verified execution provider before relying on it to deploy software.",
        }
    }


@router.post(
    "/application-manager/action-plans",
    dependencies=[Depends(require_action("device.command.execute"))],
)
async def create_application_action_plan(
    payload: ApplicationActionPlanPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Stage a one-client/site application change plan; do not dispatch it."""
    targets: list[dict] = []
    for device_id in payload.device_ids:
        device = await assert_tenant_record_scope(
            current_user,
            db.devices,
            device_id,
            operation="application_manager.action_plan.create",
            request=request,
            resource_name="Device",
        )
        targets.append({
            "device_id": clean_text(device.get("id"), limit=120),
            "device_name": clean_text(device.get("name") or device.get("hostname")) or "Managed endpoint",
            "client_id": clean_text(device.get("client_id"), limit=120),
            "site_id": clean_text(device.get("site_id"), limit=120),
        })

    client_ids = {target["client_id"] for target in targets}
    site_ids = {target["site_id"] for target in targets}
    if len(client_ids) != 1 or not next(iter(client_ids), ""):
        raise HTTPException(status_code=422, detail="Stage application work for one client at a time")
    if len(site_ids) != 1 or not next(iter(site_ids), ""):
        raise HTTPException(status_code=422, detail="Stage application work for one recorded site at a time")
    client_id = next(iter(client_ids))
    site_id = next(iter(site_ids))

    if payload.ticket_id:
        ticket = await _ticket_reference_in_scope(current_user, payload.ticket_id, request=request)
        if clean_text(ticket.get("client_id"), limit=120) != client_id:
            raise HTTPException(status_code=422, detail="The linked ticket must belong to the same client as every target endpoint")

    existing = await db.application_manager_action_plans.find_one(
        {
            "idempotency_key": payload.idempotency_key,
            "created_by": current_user.get("id") or current_user.get("email") or "Nexus operator",
            "tenant_id": _tenant_id(current_user),
        },
        {"_id": 0},
    )
    if existing:
        await assert_client_scope(
            current_user,
            clean_text(existing.get("client_id"), limit=120),
            site_id=clean_text(existing.get("site_id"), limit=120),
            operation="application_manager.action_plan.idempotent_read",
            request=request,
            mask_not_found=True,
        )
        return {"plan": public_action_plan(existing), "idempotent": True}

    now = utc_now()
    plan = {
        "id": f"app-plan-{uuid.uuid4().hex[:16]}",
        "tenant_id": _tenant_id(current_user),
        "action_type": payload.action_type,
        "application_name": payload.application_name,
        "publisher": payload.publisher,
        "client_id": client_id,
        "site_id": site_id,
        "ticket_id": clean_text((ticket or {}).get("id"), limit=120) if payload.ticket_id else "",
        "targets": [{"device_id": target["device_id"], "device_name": target["device_name"]} for target in targets],
        "reason": payload.reason,
        "idempotency_key": payload.idempotency_key,
        "approval_required": True,
        "approval_state": "not_requested",
        "execution_state": "not_configured",
        "created_at": now,
        "created_by": current_user.get("id") or current_user.get("email") or "Nexus operator",
        "created_by_name": current_user.get("name") or current_user.get("email") or "Nexus operator",
        "correlation_id": getattr(request.state, "correlation_id", None),
    }
    await db.application_manager_action_plans.insert_one(plan)
    await log_activity(
        current_user,
        "application_action_plan_created",
        "application_action_plan",
        plan["id"],
        plan["application_name"],
        "Recorded a governed application action plan. No endpoint command or provider deployment was dispatched.",
        metadata={
            "action_type": plan["action_type"],
            "client_id": client_id,
            "site_id": site_id,
            "target_count": len(targets),
            "ticket_id": plan["ticket_id"],
            "approval_state": "not_requested",
            "execution_state": "not_configured",
            "correlation_id": plan["correlation_id"],
        },
    )
    return {"plan": public_action_plan(plan), "idempotent": False}


# ── Lifecycle rings (roadmap #500, Nexus Application Manager, merged tool) ──
# Staged rollout evidence for one application version: test ring, canary,
# pilot, broad. A ring may only be created when every earlier ring has
# recorded verification evidence, and rollback evidence is always retained.
# Rings are governance records only; no endpoint command is dispatched here.

class LifecycleRingPayload(BaseModel):
    application_name: str = Field(min_length=1, max_length=120)
    version: str = Field(min_length=1, max_length=60)
    kind: Literal["test", "canary", "pilot", "broad"]
    cohort: str = Field(default="", max_length=120)
    verification: str = Field(min_length=1, max_length=500)
    rollback_plan: str = Field(min_length=1, max_length=500)


class RingEvidencePayload(BaseModel):
    evidence_note: str = Field(min_length=1, max_length=500)


def _public_ring(row: dict) -> dict:
    return {key: value for key, value in row.items() if key != "_id"}


@router.get("/application-manager/lifecycle-rings")
async def list_lifecycle_rings(
    current_user: dict = Depends(get_current_user),
):
    """List retained staged-rollout rings grouped by application and version."""
    rows = await db.application_manager_lifecycle_rings.find(
        _tenant_scoped_query(current_user),
        {"_id": 0},
    ).sort([("application_name", 1), ("version", 1), ("created_at", 1)]).to_list(500)
    plans: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        plans.setdefault((row.get("application_name"), row.get("version")), []).append(_public_ring(row))
    return {
        "plans": [
            {
                "application_name": application,
                "version": version,
                "rings": rings,
                "rollout_complete": bool(rings) and all(ring.get("status") in {"verified", "completed"} for ring in rings),
            }
            for (application, version), rings in sorted(plans.items())
        ],
        "execution_boundary": "Lifecycle rings retain staged-rollout governance and verification evidence only. A connected execution provider is required before any endpoint deployment.",
    }


@router.post(
    "/application-manager/lifecycle-rings",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_lifecycle_ring(
    payload: LifecycleRingPayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Open one rollout ring once every earlier ring is verified."""
    await assert_global_scope(
        current_user,
        operation="application_manager.lifecycle_ring.create",
        request=request,
    )
    existing = await db.application_manager_lifecycle_rings.find(
        {
            "application_name": payload.application_name,
            "version": payload.version,
            "tenant_id": _tenant_id(current_user),
        },
        {"_id": 0},
    ).to_list(16)
    gate = promotion_gate(existing, payload.kind)
    if not gate["allowed"]:
        raise HTTPException(status_code=422, detail=gate["reason"])
    now = utc_now()
    ring = {
        "id": f"app-ring-{uuid.uuid4().hex[:16]}",
        "tenant_id": _tenant_id(current_user),
        "application_name": clean_text(payload.application_name, limit=120),
        "version": clean_text(payload.version, limit=60),
        "kind": payload.kind,
        "cohort": clean_text(payload.cohort, limit=120),
        "verification": clean_text(payload.verification, limit=500),
        "rollback_plan": clean_text(payload.rollback_plan, limit=500),
        "status": "staging",
        "verification_evidence": [],
        "rollback_evidence": [],
        "created_at": now,
        "created_by": current_user.get("id") or current_user.get("email") or "Nexus operator",
        "created_by_name": current_user.get("name") or current_user.get("email") or "Nexus operator",
        "correlation_id": getattr(request.state, "correlation_id", None),
    }
    await db.application_manager_lifecycle_rings.insert_one(ring)
    await log_activity(
        current_user,
        "application_lifecycle_ring_created",
        "application_lifecycle_ring",
        ring["id"],
        f"{ring['application_name']} {ring['version']}",
        f"Opened the {ring['kind']} rollout ring. No endpoint command or provider deployment was dispatched.",
        metadata={
            "kind": ring["kind"],
            "gate": gate["reason"],
            "execution_state": "not_configured",
            "correlation_id": ring["correlation_id"],
        },
    )
    return {"ring": _public_ring(ring), "gate": gate}


@router.post(
    "/application-manager/lifecycle-rings/{ring_id}/verify",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def verify_lifecycle_ring(
    ring_id: str,
    payload: RingEvidencePayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Retain verification evidence that unblocks the next rollout ring."""
    await assert_global_scope(
        current_user,
        operation="application_manager.lifecycle_ring.verify",
        request=request,
    )
    existing = await db.application_manager_lifecycle_rings.find_one(
        {"id": ring_id, "tenant_id": _tenant_id(current_user)},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Lifecycle ring not found")
    if existing.get("status") == "rolled_back":
        raise HTTPException(status_code=422, detail="A rolled-back ring cannot be verified; create a replacement ring")
    now = utc_now()
    evidence = {
        "note": clean_text(payload.evidence_note, limit=500),
        "verified_at": now,
        "verified_by": current_user.get("id") or current_user.get("email") or "Nexus operator",
    }
    update = {
        "status": "verified",
        "verification_evidence": [*existing.get("verification_evidence", []), evidence],
        "updated_at": now,
    }
    await db.application_manager_lifecycle_rings.update_one(
        {"id": ring_id, "tenant_id": _tenant_id(current_user)},
        {"$set": update},
    )
    await log_activity(
        current_user,
        "application_lifecycle_ring_verified",
        "application_lifecycle_ring",
        ring_id,
        f"{existing.get('application_name')} {existing.get('version')}",
        payload.evidence_note.strip(),
        metadata={"kind": existing.get("kind"), "correlation_id": getattr(request.state, "correlation_id", None)},
    )
    return {"ring": _public_ring({**existing, **update})}


@router.post(
    "/application-manager/lifecycle-rings/{ring_id}/rollback",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def rollback_lifecycle_ring(
    ring_id: str,
    payload: RingEvidencePayload,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Record rollback evidence for one ring and stop its staged rollout."""
    await assert_global_scope(
        current_user,
        operation="application_manager.lifecycle_ring.rollback",
        request=request,
    )
    existing = await db.application_manager_lifecycle_rings.find_one(
        {"id": ring_id, "tenant_id": _tenant_id(current_user)},
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Lifecycle ring not found")
    now = utc_now()
    evidence = {
        "note": clean_text(payload.evidence_note, limit=500),
        "rolled_back_at": now,
        "rolled_back_by": current_user.get("id") or current_user.get("email") or "Nexus operator",
    }
    update = {
        "status": "rolled_back",
        "rollback_evidence": [*existing.get("rollback_evidence", []), evidence],
        "updated_at": now,
    }
    await db.application_manager_lifecycle_rings.update_one(
        {"id": ring_id, "tenant_id": _tenant_id(current_user)},
        {"$set": update},
    )
    await log_activity(
        current_user,
        "application_lifecycle_ring_rolled_back",
        "application_lifecycle_ring",
        ring_id,
        f"{existing.get('application_name')} {existing.get('version')}",
        payload.evidence_note.strip(),
        metadata={"kind": existing.get("kind"), "correlation_id": getattr(request.state, "correlation_id", None)},
    )
    return {"ring": _public_ring({**existing, **update})}
