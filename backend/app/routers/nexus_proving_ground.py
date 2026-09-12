"""Nexus Proving Ground — scoped evidence over governed automation simulations."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import evaluate_action_permission, require_action
from app.services.nexus_proving_ground import compose_proving_ground
from app.services.scope_permissions import effective_scope, scoped_query, tenant_scoped_query


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
