"""Nexus Flow Intelligence — friction, outcome contracts and investigation continuity.

Three tools that remove the friction between discovering a problem, proving it
was fixed and handing the work on. Each is delivered inside a workspace that
already owns its problem space rather than as a new destination:

* **Friction Radar** derives workflow-friction opportunities from the aggregate
  usage counts the workspaces already record. Reads are tenant-scoped and return
  summed counts only — never a technician, client or record.
* **Outcome Contract** is attached to a ticket from the ticket workspace. It
  states the business outcome, preconditions, dependencies, acceptable
  interruption, verification method and rollback, and separates the requested
  outcome from the method the technician chose.
* **Breadcrumb Rescue** preserves an investigation's reasoning state and flags
  the conclusions the record has moved past.

Nothing here executes anything on an endpoint, and nothing here claims a repair
succeeded because a command exited zero.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.nexus_flow import (
    BREADCRUMB_KINDS,
    FRICTION_KINDS,
    VERIFICATION_KINDS,
    breadcrumb_resume,
    closeout_gate,
    contains_credential_material,
    contract_status,
    friction_opportunities,
    investigation_health,
    verification_verdict,
)
from app.services.scope_permissions import effective_scope, platform_tenant_id, tenant_scoped_query

router = APIRouter(tags=["Nexus Flow Intelligence"])

_MAX_EVIDENCE_ROWS = 4000
_MAX_BREADCRUMBS = 200
_MAX_CHANGE_ROWS = 100
_MAX_TEXT = 500
_MAX_ESTIMATE_DAYS = 365


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(current_user: dict[str, Any]) -> str:
    return str(current_user.get("id") or current_user.get("email") or "Nexus operator")


def _client_visible(current_user: dict[str, Any], client_id: Any) -> bool:
    """Server-side client scope check, independent of any frontend filtering."""
    if not client_id:
        return True
    scope = effective_scope(current_user)
    if scope["mode"] == "all":
        return True
    return str(client_id) in {str(value) for value in scope["client_ids"]}


async def _load_ticket(current_user: dict[str, Any], ticket_id: str) -> dict[str, Any]:
    clean_id = str(ticket_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=422, detail="A ticket ID is required")
    ticket = await db.tickets.find_one(tenant_scoped_query(current_user, {"id": clean_id}), {"_id": 0})
    if not ticket or not _client_visible(current_user, ticket.get("client_id")):
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def _clean_text(value: Any, *, field: str, maximum: int = _MAX_TEXT) -> str:
    text = str(value or "").strip()
    if len(text) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} is limited to {maximum} characters")
    if contains_credential_material(text):
        raise HTTPException(
            status_code=422,
            detail=f"{field} stores references only; credential material is never accepted",
        )
    return text


def _clean_scope_ref(value: Any) -> str | None:
    ref = _clean_text(value, field="scope reference", maximum=80)
    return ref or None


# ── Friction Radar ───────────────────────────────────────────────────────────


async def _aggregate_usage(current_user: dict[str, Any], workspace: str | None) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"surface": "action"}
    if workspace:
        query["workspace"] = workspace
    rows = await db.workspace_learning_signals.find(
        tenant_scoped_query(current_user, query),
        {"_id": 0, "workspace": 1, "target": 1, "count": 1, "last_used_at": 1},
    ).to_list(_MAX_EVIDENCE_ROWS)
    aggregate: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        name = str(row.get("workspace") or "").strip().lower()
        target = str(row.get("target") or "").strip().lower()
        if not name or not target:
            continue
        entry = aggregate.setdefault(
            (name, target),
            {"workspace": name, "target": target, "count": 0, "last_used_at": None},
        )
        entry["count"] += int(row.get("count") or 0)
        last_used = row.get("last_used_at")
        if last_used and (entry["last_used_at"] is None or str(last_used) > str(entry["last_used_at"])):
            entry["last_used_at"] = last_used
    return list(aggregate.values())


def _public_proposal(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "opportunity_id": row.get("opportunity_id"),
        "kind": row.get("kind"),
        "workspace": row.get("workspace"),
        "target": row.get("target"),
        "proposed_solution": row.get("proposed_solution"),
        "evidence_note": row.get("evidence_note"),
        "status": row.get("status"),
        "review": row.get("review"),
        "created_at": row.get("created_at"),
    }


class FrictionProposalPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    opportunity_id: str = Field(min_length=3, max_length=160)
    kind: Literal["repeated_navigation", "concentrated_usage"]
    workspace: str | None = Field(default=None, max_length=48)
    target: str = Field(min_length=1, max_length=48)
    proposed_solution: str = Field(min_length=5, max_length=300)
    evidence_note: str = Field(min_length=5, max_length=500)


class FrictionReviewPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approved", "rejected"]
    evidence_note: str = Field(min_length=5, max_length=500)


@router.get("/flow-intelligence/friction")
async def friction_radar(
    workspace: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Return aggregate workflow-friction opportunities for this tenant.

    Every figure is derived inside the caller's tenant partition from counters
    the workspaces already hold, and every opportunity is explicitly a proposal
    for human review — Nexus never publishes a workflow change on its own.
    """
    clean_workspace = str(workspace or "").strip().lower() or None
    rows = await _aggregate_usage(current_user, clean_workspace)
    opportunities = friction_opportunities(rows)
    proposals = await db.nexus_flow_proposals.find(
        tenant_scoped_query(current_user, {}),
        {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return {
        "opportunities": opportunities,
        "proposals": [_public_proposal(row) for row in proposals],
        "kinds": list(FRICTION_KINDS),
        "evidence_rows": len(rows),
        "boundary": (
            "Friction Radar reads summed usage counts only. It never records arbitrary employee activity, "
            "never identifies or ranks a technician, and proposes workflow improvements for human review "
            "instead of publishing them itself."
        ),
    }


@router.post("/flow-intelligence/friction/proposals")
async def propose_friction_fix(
    payload: FrictionProposalPayload,
    current_user: dict = Depends(get_current_user),
):
    """Record a proposed workflow improvement for one friction opportunity."""
    note = _clean_text(payload.evidence_note, field="Evidence note")
    if contains_credential_material(note) or contains_credential_material(payload.proposed_solution):
        raise HTTPException(
            status_code=422,
            detail="Flow Intelligence stores references only; credential material is never accepted",
        )
    existing = await db.nexus_flow_proposals.find_one(
        tenant_scoped_query(current_user, {"opportunity_id": payload.opportunity_id, "status": "proposed"}),
        {"_id": 0},
    )
    if existing:
        raise HTTPException(status_code=409, detail="A proposal for this opportunity is already awaiting review")
    now = _now_iso()
    proposal = {
        "id": f"flow-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "opportunity_id": payload.opportunity_id,
        "kind": payload.kind,
        "workspace": (payload.workspace or "").strip().lower() or None,
        "target": payload.target.strip().lower(),
        "proposed_solution": payload.proposed_solution.strip(),
        "evidence_note": note,
        "status": "proposed",
        "review": None,
        "created_at": now,
        "created_by": _actor(current_user),
    }
    await db.nexus_flow_proposals.insert_one(dict(proposal))
    await log_activity(
        current_user,
        "nexus_flow.friction_proposed",
        "nexus_flow_proposal",
        proposal["id"],
        proposal["target"],
        details=note,
        metadata={"kind": payload.kind, "opportunity_id": payload.opportunity_id},
    )
    return _public_proposal(proposal)


@router.post("/flow-intelligence/friction/proposals/{proposal_id}/review")
async def review_friction_proposal(
    proposal_id: str,
    payload: FrictionReviewPayload,
    current_user: dict = Depends(get_current_user),
):
    """Approve or reject a proposed workflow improvement with retained evidence."""
    row = await db.nexus_flow_proposals.find_one(
        tenant_scoped_query(current_user, {"id": str(proposal_id or "").strip()}),
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if row.get("status") != "proposed":
        raise HTTPException(status_code=422, detail="This proposal has already been reviewed")
    review_note = _clean_text(payload.evidence_note, field="Review note")
    if contains_credential_material(review_note):
        raise HTTPException(
            status_code=422,
            detail="Flow Intelligence stores references only; credential material is never accepted",
        )
    review = {
        "decision": payload.decision,
        "evidence_note": review_note,
        "reviewed_at": _now_iso(),
        "reviewed_by": _actor(current_user),
    }
    await db.nexus_flow_proposals.update_one(
        tenant_scoped_query(current_user, {"id": row["id"]}),
        {"$set": {"status": payload.decision, "review": review}},
    )
    await log_activity(
        current_user,
        "nexus_flow.friction_reviewed",
        "nexus_flow_proposal",
        row["id"],
        str(row.get("target") or ""),
        details=f"Proposal {payload.decision}: {review['evidence_note']}",
        metadata={"decision": payload.decision},
    )
    return _public_proposal({**row, "status": payload.decision, "review": review})


# ── Outcome Contract ─────────────────────────────────────────────────────────


class OutcomeContractPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: str = Field(min_length=5, max_length=500)
    preconditions: str = Field(min_length=1, max_length=500)
    dependencies: list[str] = Field(default_factory=list)
    acceptable_interruption: str = Field(min_length=1, max_length=300)
    verification_method: Literal["automated_test", "technician_witnessed", "customer_confirmed", "monitoring_evidence"]
    rollback: str = Field(min_length=1, max_length=500)
    evidence_days: int = Field(default=14, ge=1, le=365)


class OutcomeVerificationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["automated_test", "technician_witnessed", "customer_confirmed", "monitoring_evidence"]
    evidence_note: str = Field(min_length=5, max_length=500)
    evidence_days: int = Field(default=14, ge=1, le=365)


def _public_contract(row: dict[str, Any] | None, *, now: datetime | None = None) -> dict[str, Any]:
    if not row:
        return {"contract": None, "status": None, "closeout_gate": closeout_gate(None, now=now)}
    status = contract_status(row, now=now)
    return {
        "contract": {
            "id": row.get("id"),
            "ticket_id": row.get("ticket_id"),
            "outcome": row.get("outcome"),
            "preconditions": row.get("preconditions"),
            "dependencies": row.get("dependencies") or [],
            "acceptable_interruption": row.get("acceptable_interruption"),
            "verification_method": row.get("verification_method"),
            "rollback": row.get("rollback"),
            "evidence_days": row.get("evidence_days"),
            "verified_at": row.get("verified_at"),
            "evidence_expires_at": row.get("evidence_expires_at"),
            "verification_kind": row.get("verification_kind"),
            "verification_history": row.get("verification_history") or [],
            "updated_at": row.get("updated_at"),
        },
        "status": status,
        "closeout_gate": closeout_gate(row, now=now),
    }


@router.get("/flow-intelligence/tickets/{ticket_id}/outcome-contract")
async def get_outcome_contract(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Return the ticket's outcome contract, its standing and the close-out gate."""
    ticket = await _load_ticket(current_user, ticket_id)
    row = await db.nexus_outcome_contracts.find_one(
        tenant_scoped_query(current_user, {"ticket_id": ticket["id"]}),
        {"_id": 0},
    )
    return {
        "ticket_id": ticket["id"],
        "verification_kinds": list(VERIFICATION_KINDS),
        **_public_contract(row),
    }


@router.put("/flow-intelligence/tickets/{ticket_id}/outcome-contract")
async def set_outcome_contract(
    ticket_id: str,
    payload: OutcomeContractPayload,
    current_user: dict = Depends(get_current_user),
):
    """Set or replace the machine-checkable outcome contract for one ticket.

    An incomplete contract is stored but its standing is ``insufficient`` — it
    cannot verify anything or support a resolved close-out.
    """
    ticket = await _load_ticket(current_user, ticket_id)
    dependencies = [_clean_text(item, field="Dependency", maximum=120) for item in payload.dependencies][:12]
    now = _now_iso()
    contract = {
        "id": f"oct-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "ticket_id": ticket["id"],
        "client_id": ticket.get("client_id"),
        "outcome": _clean_text(payload.outcome, field="Outcome"),
        "preconditions": _clean_text(payload.preconditions, field="Preconditions"),
        "dependencies": [item for item in dependencies if item],
        "acceptable_interruption": _clean_text(payload.acceptable_interruption, field="Acceptable interruption"),
        "verification_method": payload.verification_method,
        "rollback": _clean_text(payload.rollback, field="Rollback"),
        "evidence_days": int(payload.evidence_days),
        "verified_at": None,
        "evidence_expires_at": None,
        "verification_kind": None,
        "verification_history": [],
        "created_at": now,
        "created_by": _actor(current_user),
        "updated_at": now,
    }
    existing = await db.nexus_outcome_contracts.find_one(
        tenant_scoped_query(current_user, {"ticket_id": ticket["id"]}),
        {"_id": 0},
    )
    if existing:
        contract["id"] = existing.get("id") or contract["id"]
        contract["verification_history"] = existing.get("verification_history") or []
        contract["created_at"] = existing.get("created_at") or now
        await db.nexus_outcome_contracts.update_one(
            tenant_scoped_query(current_user, {"ticket_id": ticket["id"]}),
            {"$set": contract},
        )
    else:
        await db.nexus_outcome_contracts.insert_one(dict(contract))
    await log_activity(
        current_user,
        "nexus_flow.outcome_contract_set",
        "ticket",
        ticket["id"],
        str(ticket.get("ticket_number") or ticket["id"]),
        details=f"Outcome contract set: {contract['outcome']}",
        metadata={"verification_method": payload.verification_method, "evidence_days": int(payload.evidence_days)},
    )
    return {"ticket_id": ticket["id"], "verification_kinds": list(VERIFICATION_KINDS), **_public_contract(contract)}


@router.post("/flow-intelligence/tickets/{ticket_id}/outcome-contract/verify")
async def verify_outcome_contract(
    ticket_id: str,
    payload: OutcomeVerificationPayload,
    current_user: dict = Depends(get_current_user),
):
    """Record verification evidence for the ticket's outcome contract.

    Raw material for the close-out gate: a technician cannot mark the outcome
    proven while the contract itself is incomplete, and the evidence expires.
    """
    ticket = await _load_ticket(current_user, ticket_id)
    row = await db.nexus_outcome_contracts.find_one(
        tenant_scoped_query(current_user, {"ticket_id": ticket["id"]}),
        {"_id": 0},
    )
    if not row:
        raise HTTPException(status_code=404, detail="This ticket has no outcome contract to verify")
    verdict = verification_verdict(
        row,
        kind=payload.kind,
        evidence_note=payload.evidence_note,
        evidence_days=payload.evidence_days,
    )
    if not verdict["accepted"]:
        raise HTTPException(status_code=422, detail=verdict["reason"])
    history = list(row.get("verification_history") or [])
    history.append(
        {
            "kind": verdict["verification_kind"],
            "evidence_note": verdict["evidence_note"],
            "verified_at": verdict["verified_at"],
            "evidence_expires_at": verdict["evidence_expires_at"],
            "verified_by": _actor(current_user),
        }
    )
    update = {
        "verified_at": verdict["verified_at"],
        "evidence_expires_at": verdict["evidence_expires_at"],
        "verification_kind": verdict["verification_kind"],
        "verification_history": history[-20:],
        "updated_at": _now_iso(),
    }
    await db.nexus_outcome_contracts.update_one(
        tenant_scoped_query(current_user, {"ticket_id": ticket["id"]}),
        {"$set": update},
    )
    await log_activity(
        current_user,
        "nexus_flow.outcome_verified",
        "ticket",
        ticket["id"],
        str(ticket.get("ticket_number") or ticket["id"]),
        details=verdict["evidence_note"],
        metadata={"verification_kind": verdict["verification_kind"], "evidence_expires_at": verdict["evidence_expires_at"]},
    )
    return {
        "ticket_id": ticket["id"],
        "verification_kinds": list(VERIFICATION_KINDS),
        **_public_contract({**row, **update}),
    }


# ── Breadcrumb Rescue ────────────────────────────────────────────────────────


class BreadcrumbPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["hypothesis", "tested", "ruled_out", "finding", "next_step", "change"]
    text: str = Field(min_length=3, max_length=400)
    scope_ref: str | None = Field(default=None, max_length=80)


def _public_breadcrumb(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "kind": row.get("kind"),
        "text": row.get("text"),
        "scope_ref": row.get("scope_ref"),
        "created_at": row.get("created_at"),
        "created_by": row.get("created_by"),
    }


async def _load_changes(current_user: dict[str, Any], ticket: dict[str, Any], since: str | None) -> list[dict[str, Any]]:
    """Read the changes that may have invalidated an earlier conclusion.

    Only the ticket's own activity plus activity against its linked client and
    device is considered, inside the caller's tenant. Nothing outside the
    ticket's own scope can make a conclusion stale.
    """
    refs = sorted(
        {
            str(value)
            for value in [ticket.get("id"), ticket.get("client_id"), ticket.get("device_id")]
            if value
        }
    )
    if not refs:
        return []
    query: dict[str, Any] = {"entity_id": {"$in": refs}}
    if since:
        query["created_at"] = {"$gt": since}
    rows = await db.activity_logs.find(
        tenant_scoped_query(current_user, query),
        {"_id": 0, "entity_id": 1, "action": 1, "details": 1, "created_at": 1, "timestamp": 1, "entity_name": 1},
    ).sort("created_at", -1).to_list(_MAX_CHANGE_ROWS)
    changes: list[dict[str, Any]] = []
    for row in rows:
        at = row.get("created_at") or row.get("timestamp")
        if not at:
            continue
        action = str(row.get("action") or "").strip()
        summary = str(row.get("details") or "").strip() or f"{action.replace('.', ' ').replace('_', ' ').strip() or 'A change'} on {row.get('entity_name') or row.get('entity_id')}"
        changes.append({"scope_ref": str(row.get("entity_id") or ""), "at": str(at), "summary": summary})
    return changes


async def _load_breadcrumbs(current_user: dict[str, Any], ticket_id: str) -> list[dict[str, Any]]:
    return await db.nexus_breadcrumbs.find(
        tenant_scoped_query(current_user, {"ticket_id": ticket_id}),
        {"_id": 0},
    ).sort("created_at", 1).to_list(_MAX_BREADCRUMBS)


@router.get("/flow-intelligence/tickets/{ticket_id}/breadcrumbs")
async def get_breadcrumbs(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Reconstruct the investigation and flag the conclusions that may be stale."""
    ticket = await _load_ticket(current_user, ticket_id)
    breadcrumbs = await _load_breadcrumbs(current_user, ticket["id"])
    since = str(breadcrumbs[0].get("created_at") or "") if breadcrumbs else None
    changes = await _load_changes(current_user, ticket, since or None)
    resumed = breadcrumb_resume(breadcrumbs, changes=changes)
    return {
        "ticket_id": ticket["id"],
        "kinds": list(BREADCRUMB_KINDS),
        "breadcrumbs": [_public_breadcrumb(row) for row in breadcrumbs],
        "changes_considered": len(changes),
        **resumed,
    }


@router.get("/flow-intelligence/tickets/{ticket_id}/investigation-health")
async def get_investigation_health(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Dead End Detector — is this investigation still reducing uncertainty?

    Built from the same breadcrumbs the technician already records, so it needs
    no new telemetry and no employer monitoring. The answer is advisory: Nexus
    reports the evidence and one different test to try.
    """
    ticket = await _load_ticket(current_user, ticket_id)
    breadcrumbs = await _load_breadcrumbs(current_user, ticket["id"])
    health = investigation_health(breadcrumbs)
    return {
        "ticket_id": ticket["id"],
        "breadcrumbs_considered": len(breadcrumbs),
        **health,
    }


@router.post("/flow-intelligence/tickets/{ticket_id}/breadcrumbs")
async def record_breadcrumb(
    ticket_id: str,
    payload: BreadcrumbPayload,
    current_user: dict = Depends(get_current_user),
):
    """Record one step of a technician's reasoning against the ticket."""
    ticket = await _load_ticket(current_user, ticket_id)
    row = {
        "id": f"bcr-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "ticket_id": ticket["id"],
        "client_id": ticket.get("client_id"),
        "kind": payload.kind,
        "text": _clean_text(payload.text, field="Breadcrumb", maximum=400),
        "scope_ref": _clean_scope_ref(payload.scope_ref),
        "created_at": _now_iso(),
        "created_by": _actor(current_user),
    }
    await db.nexus_breadcrumbs.insert_one(dict(row))
    await log_activity(
        current_user,
        "nexus_flow.breadcrumb_recorded",
        "ticket",
        ticket["id"],
        str(ticket.get("ticket_number") or ticket["id"]),
        details=f"{payload.kind}: {row['text']}",
        metadata={"kind": payload.kind},
    )
    return _public_breadcrumb(row)
