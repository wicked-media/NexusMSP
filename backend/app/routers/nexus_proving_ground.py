"""Nexus Proving Ground — scoped evidence over governed automation simulations."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import evaluate_action_permission, require_action
from app.services.activity import log_activity
from app.services.nexus_proving_ground import compose_proving_ground
from app.services.roadmap_tools import BENCH_KINDS, bench_verdict, find_sensitive_keys
from app.services.scope_permissions import effective_scope, platform_tenant_id, scoped_query, tenant_scoped_query


router = APIRouter(tags=["Nexus Proving Ground"])


def _workflow_query(current_user: dict[str, Any]) -> dict[str, Any]:
    """Build the canonical, fail-closed workflow visibility query.

    Older workflows without a structured scope are treated as global by the
    Automation Studio.  A restricted user must not gain access through a stale
    top-level ``client_id`` on one of those records.
    """
    scope = effective_scope(current_user)
    base = {"archived": {"$ne": True}}
    if scope["mode"] == "all":
        return tenant_scoped_query(current_user, base)
    client_ids = scope["client_ids"]
    if not client_ids:
        return tenant_scoped_query(current_user, {"id": {"$in": []}})
    return tenant_scoped_query(current_user, {
        "$and": [
            base,
            {"scope.type": "client", "scope.client_id": {"$in": client_ids}},
        ]
    })


async def _readiness_evidence(current_user: dict[str, Any]) -> dict[str, Any]:
    """Expose global release evidence only to a permitted global actor."""
    scope = effective_scope(current_user)
    permission = await evaluate_action_permission(current_user, "platform.readiness.view")
    if scope["mode"] != "all" or not permission["allowed"]:
        return {
            "state": "not_authorised",
            "label": "Launch-gate evidence is restricted",
            "detail": "Your role can review scoped proving evidence, but not the MSP-wide production-readiness register.",
            "items": [],
        }
    rows = await db.production_readiness_items.find(
        tenant_scoped_query(current_user, {"production_blocker": True}),
        {"_id": 0, "id": 1, "title": 1, "status": 1, "test_result": 1, "severity": 1, "owner": 1, "target_release": 1, "updated_at": 1},
    ).sort([("severity", 1), ("updated_at", -1)]).to_list(30)
    return {
        "state": "observed",
        "label": "Production-readiness evidence",
        "detail": "This register is global MSP launch evidence, separate from any client workflow approval.",
        "items": rows,
    }


@router.get(
    "/nexus-proving-ground/overview",
    dependencies=[Depends(require_action("automation.workflow.view"))],
)
async def proving_ground_overview(current_user: dict = Depends(get_current_user)):
    """Return retained, scope-safe evidence for safely proving a workflow."""
    simulations_query = tenant_scoped_query(current_user, scoped_query(current_user, site_field=None))
    runs_query = tenant_scoped_query(current_user, scoped_query(current_user, site_field=None))
    approvals_query = tenant_scoped_query(
        current_user,
        scoped_query(
            current_user,
            {"workflow_id": {"$exists": True}, "status": {"$in": ["pending_review", "approved", "rejected"]}},
            site_field=None,
        ),
    )
    workflows, simulations, runs, approvals, readiness = await asyncio.gather(
        db.workflows.find(_workflow_query(current_user), {"_id": 0}).sort("updated_at", -1).to_list(200),
        db.workflow_simulations.find(simulations_query, {"_id": 0}).sort("simulated_at", -1).to_list(200),
        db.workflow_runs.find(runs_query, {"_id": 0}).sort("updated_at", -1).to_list(200),
        db.change_requests.find(approvals_query, {"_id": 0}).sort("created_at", -1).to_list(200),
        _readiness_evidence(current_user),
    )
    return compose_proving_ground(
        workflows=workflows,
        simulations=simulations,
        runs=runs,
        approvals=approvals,
        readiness=readiness,
    )


# ── Pre-rollout bench (roadmap #502, Nexus Test Environment, merged tool) ──
# Representative, non-production simulations for scripts, packages, policies,
# automations, agent updates and connectors before broad rollout. The bench
# never executes on endpoints: it proves the declared candidate metadata
# satisfies the gates that make a simulation meaningful for that kind, and
# retains the verdict as evidence. Candidate payloads refuse credential
# material outright.


class BenchCandidatePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: Literal["script", "package", "policy", "automation", "agent_update", "connector"]
    name: str = Field(min_length=3, max_length=120)
    representative_scope: str = Field(min_length=3, max_length=200)
    candidate: dict[str, Any] = Field(default_factory=dict)


class BenchPromotePayload(BaseModel):
    evidence_note: str = Field(min_length=1, max_length=500)


def _clean_candidate(payload: BenchCandidatePayload) -> dict[str, Any]:
    data = dict(payload.candidate or {})
    if len(data) > 12:
        raise HTTPException(status_code=422, detail="Candidate metadata is limited to 12 fields")
    offending = find_sensitive_keys(data)
    if offending:
        raise HTTPException(
            status_code=422,
            detail=f"The bench accepts references only; credential material is never accepted (offending fields: {', '.join(offending)})",
        )
    for key, value in data.items():
        if isinstance(value, str) and len(value) > 500:
            raise HTTPException(status_code=422, detail=f"Candidate field {key!r} exceeds 500 characters")
    return {**data, "name": payload.name.strip(), "representative_scope": payload.representative_scope.strip()}


def _public_run(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "kind": row.get("kind"),
        "name": row.get("name"),
        "representative_scope": row.get("representative_scope"),
        "verdict": row.get("verdict"),
        "checks": row.get("checks"),
        "checks_passed": row.get("checks_passed"),
        "checks_total": row.get("checks_total"),
        "status": row.get("status"),
        "clearance": row.get("clearance"),
        "created_at": row.get("created_at"),
    }


@router.get(
    "/nexus-proving-ground/pre-rollout-runs",
    dependencies=[Depends(require_action("automation.workflow.view"))],
)
async def list_pre_rollout_runs(current_user: dict = Depends(get_current_user)):
    """List retained pre-rollout simulation runs within the caller's scope."""
    rows = await db.nexus_bench_runs.find(
        tenant_scoped_query(current_user, scoped_query(current_user, site_field=None)),
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return {
        "runs": [_public_run(row) for row in rows],
        "kinds": list(BENCH_KINDS),
        "boundary": "The bench simulates candidate readiness from declared metadata. It never executes scripts, packages, policies, automations, agent updates or connectors on managed endpoints.",
    }


@router.post(
    "/nexus-proving-ground/pre-rollout-runs",
    dependencies=[Depends(require_action("automation.workflow.simulate"))],
)
async def create_pre_rollout_run(
    payload: BenchCandidatePayload,
    current_user: dict = Depends(get_current_user),
):
    """Record one representative non-production simulation verdict."""
    candidate = _clean_candidate(payload)
    result = bench_verdict(payload.kind, candidate)
    now = datetime.now(timezone.utc).isoformat()
    run = {
        "id": f"bench-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "kind": payload.kind,
        "name": payload.name.strip(),
        "representative_scope": payload.representative_scope.strip(),
        "candidate": {key: value for key, value in candidate.items() if key not in {"name", "representative_scope"}},
        "verdict": result["verdict"],
        "checks": result["checks"],
        "checks_passed": result["checks_passed"],
        "checks_total": result["checks_total"],
        "status": "simulated",
        "clearance": None,
        "created_at": now,
        "created_by": str(current_user.get("id") or current_user.get("email") or "Nexus operator"),
    }
    await db.nexus_bench_runs.insert_one(dict(run))
    await log_activity(
        current_user, "nexus_bench.pre_rollout_simulated", "nexus_bench_run",
        run["id"], run["name"],
        details=f"Simulated {payload.kind} candidate readiness; verdict {result['verdict']}.",
        metadata={"verdict": result["verdict"], "checks_passed": result["checks_passed"], "checks_total": result["checks_total"]},
    )
    return _public_run(run)


@router.post(
    "/nexus-proving-ground/pre-rollout-runs/{run_id}/clear",
    dependencies=[Depends(require_action("automation.workflow.approve"))],
)
async def clear_pre_rollout_run(
    run_id: str,
    payload: BenchPromotePayload,
    current_user: dict = Depends(get_current_user),
):
    """Clear a passed simulation for rollout with retained approval evidence."""
    row = await db.nexus_bench_runs.find_one(
        tenant_scoped_query(current_user, {"id": run_id}), {"_id": 0}
    )
    if not row:
        raise HTTPException(status_code=404, detail="Pre-rollout run not found")
    if row.get("verdict") != "pass":
        raise HTTPException(status_code=422, detail="Only a run with a passing verdict can be cleared for rollout")
    if row.get("status") == "cleared_for_rollout":
        raise HTTPException(status_code=422, detail="This run is already cleared for rollout")
    now = datetime.now(timezone.utc).isoformat()
    clearance = {
        "evidence_note": payload.evidence_note.strip(),
        "cleared_at": now,
        "cleared_by": str(current_user.get("id") or current_user.get("email") or "Nexus operator"),
    }
    await db.nexus_bench_runs.update_one(
        tenant_scoped_query(current_user, {"id": run_id}),
        {"$set": {"status": "cleared_for_rollout", "clearance": clearance}},
    )
    await log_activity(
        current_user, "nexus_bench.pre_rollout_cleared", "nexus_bench_run",
        run_id, str(row.get("name") or ""),
        details=payload.evidence_note.strip(),
        metadata={"kind": row.get("kind"), "verdict": row.get("verdict")},
    )
    return _public_run({**row, "status": "cleared_for_rollout", "clearance": clearance})
