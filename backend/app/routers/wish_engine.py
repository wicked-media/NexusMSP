"""Wish Engine routes — capture the unmet need, review the shared pattern, promote it.

Reads and writes are tenant-scoped server-side, a technician only ever sees their
own verbatim text plus cluster counts, and a cluster reaches the Nexus Ideas
registry only after a person records a disposition and the evidence behind it.

Nothing here executes anything, changes a customer record, or evaluates a person.
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
from app.services.nexus_flow import contains_credential_material
from app.services.nexus_ideas import create_idea
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query
from app.services.wish_engine import (
    WISH_MAX_CONTEXT_REF,
    WISH_MAX_TEXT,
    WISH_MIN_TEXT,
    WISH_CLUSTER_MIN_OCCURRENCES,
    WISH_MAX_SURFACE,
    suggest_disposition,
    wish_engine_snapshot,
    wish_promotion_axes,
    wish_signature,
)

router = APIRouter(tags=["Nexus Wish Engine"])

_MAX_ROWS = 2000
_MAX_EVIDENCE_NOTE = 500


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor(current_user: dict[str, Any]) -> str:
    return str(current_user.get("id") or current_user.get("email") or "Nexus operator")


def _actor_name(current_user: dict[str, Any]) -> str:
    return str(current_user.get("name") or current_user.get("email") or "Nexus operator")


def _clean_text(value: Any, *, field: str, minimum: int = 1, maximum: int) -> str:
    text = str(value or "").strip()
    if len(text) < minimum:
        raise HTTPException(status_code=422, detail=f"{field} needs at least {minimum} characters")
    if len(text) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} is limited to {maximum} characters")
    if contains_credential_material(text):
        raise HTTPException(
            status_code=422,
            detail=f"{field} stores references only; credential material is never accepted",
        )
    return text


def _public_wish(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "text": row.get("text"),
        "surface": row.get("surface"),
        "signature": row.get("signature"),
        "context_ref": row.get("context_ref"),
        "created_at": row.get("created_at"),
    }


async def _load_wishes(current_user: dict[str, Any]) -> list[dict[str, Any]]:
    return await db.nexus_wish_requests.find(
        tenant_scoped_query(current_user, {}),
        {"_id": 0, "id": 1, "text": 1, "surface": 1, "signature": 1, "context_ref": 1, "created_at": 1, "created_by": 1},
    ).sort("created_at", -1).to_list(_MAX_ROWS)


async def _load_decisions(current_user: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = await db.nexus_wish_dispositions.find(
        tenant_scoped_query(current_user, {}),
        {"_id": 0},
    ).to_list(_MAX_ROWS)
    return {str(row.get("signature") or ""): row for row in rows if row.get("signature")}


async def _snapshot(current_user: dict[str, Any]) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    wishes = await _load_wishes(current_user)
    decisions = await _load_decisions(current_user)
    snapshot = wish_engine_snapshot(wishes, recorded=decisions)
    return snapshot, decisions


def _find_cluster(snapshot: dict[str, Any], signature: str) -> dict[str, Any]:
    wanted = str(signature or "").strip().lower()
    if not wanted:
        raise HTTPException(status_code=422, detail="A cluster signature is required")
    for cluster in snapshot.get("clusters") or []:
        if str(cluster.get("signature")) == wanted:
            return cluster
    raise HTTPException(status_code=404, detail="This request shape is not currently clustered")


class WishPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=WISH_MIN_TEXT, max_length=WISH_MAX_TEXT)
    surface: str = Field(min_length=2, max_length=WISH_MAX_SURFACE)
    context_ref: str | None = Field(default=None, max_length=WISH_MAX_CONTEXT_REF)


class DispositionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    disposition: Literal["shortcut", "product_change", "automation", "forge_tool", "documentation"]
    evidence_note: str = Field(min_length=5, max_length=_MAX_EVIDENCE_NOTE)


class PromotionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=3, max_length=120)
    summary: str = Field(min_length=10, max_length=600)
    horizon: str = Field(default="explore", max_length=16)


@router.get("/wish-engine/wishes")
async def wish_engine_overview(current_user: dict = Depends(get_current_user)):
    """Return the caller's own requests and the tenant's shared request patterns.

    ``mine`` is the only place a verbatim request is quoted; a cluster reaches the
    reviewer queue only once at least two technicians reported the same shape.
    """
    wishes = await _load_wishes(current_user)
    decisions = await _load_decisions(current_user)
    snapshot = wish_engine_snapshot(wishes, recorded=decisions)
    actor = _actor(current_user)
    mine = [_public_wish(row) for row in wishes if str(row.get("created_by") or "") == actor]
    suggestions = {row["signature"]: suggest_disposition(row.get("text")) for row in mine if row.get("signature")}
    return {
        "mine": [{**wish, "suggestion": suggestions.get(str(wish.get("signature") or ""))} for wish in mine],
        "dispositions": snapshot["dispositions"],
        **{key: value for key, value in snapshot.items() if key != "dispositions"},
    }


@router.post("/wish-engine/wishes")
async def report_wish(payload: WishPayload, current_user: dict = Depends(get_current_user)):
    """Record one technician's unmet need, with the surface it was felt on."""
    text = _clean_text(payload.text, field="The request", minimum=WISH_MIN_TEXT, maximum=WISH_MAX_TEXT)
    surface = _clean_text(payload.surface, field="Surface", maximum=WISH_MAX_SURFACE).lower()
    context_ref = None
    if payload.context_ref:
        context_ref = _clean_text(
            payload.context_ref, field="Context reference", maximum=WISH_MAX_CONTEXT_REF
        )
    signature = wish_signature(text)
    now = _now_iso()
    row = {
        "id": f"wsh-{uuid.uuid4().hex[:12]}",
        "tenant_id": platform_tenant_id(current_user),
        "text": text,
        "surface": surface,
        "context_ref": context_ref,
        "signature": signature,
        "created_at": now,
        "created_by": _actor(current_user),
    }
    await db.nexus_wish_requests.insert_one(dict(row))
    await log_activity(
        current_user,
        "wish_engine.wish_reported",
        "nexus_wish_request",
        row["id"],
        surface,
        details=f"Unmet need reported from the {surface} workspace",
        metadata={"signature": signature},
    )
    snapshot, _ = await _snapshot(current_user)
    cluster = next(
        (
            item
            for item in snapshot["clusters"]
            if signature in {str(value) for value in (item.get("member_signatures") or [])}
            or str(item.get("signature")) == signature
        ),
        None,
    )
    suggestion = suggest_disposition(text)
    return {
        "wish": _public_wish(row),
        "suggestion": suggestion,
        "clustered": bool(cluster),
        "cluster": cluster,
        "cluster_min_occurrences": WISH_CLUSTER_MIN_OCCURRENCES,
        "boundary": (
            "This request is recorded against the surface it was felt on. It is quoted to reviewers only once at "
            "least one other technician reports the same shape; until then it stays with you and appears only as a count."
        ),
    }


@router.post("/wish-engine/clusters/{signature}/disposition")
async def record_disposition(
    signature: str,
    payload: DispositionPayload,
    current_user: dict = Depends(get_current_user),
):
    """Record what a reviewed request shape should become, with its evidence."""
    snapshot, decisions = await _snapshot(current_user)
    cluster = _find_cluster(snapshot, signature)
    existing = decisions.get(str(cluster["signature"]))
    if existing and existing.get("idea_id"):
        raise HTTPException(
            status_code=409,
            detail="This request shape has already been promoted; a delivered change cannot be re-dispositioned",
        )
    note = _clean_text(
        payload.evidence_note, field="Evidence note", minimum=5, maximum=_MAX_EVIDENCE_NOTE
    )
    now = _now_iso()
    decision = {
        "id": str((existing or {}).get("id") or f"wshd-{uuid.uuid4().hex[:12]}"),
        "tenant_id": platform_tenant_id(current_user),
        "signature": cluster["signature"],
        "disposition": payload.disposition,
        "evidence_note": note,
        "occurrences_at_decision": int(cluster.get("occurrences") or 0),
        "reporter_count_at_decision": int(cluster.get("reporter_count") or 0),
        "decided_at": now,
        "decided_by": _actor_name(current_user),
    }
    if existing:
        await db.nexus_wish_dispositions.update_one(
            tenant_scoped_query(current_user, {"id": existing["id"]}), {"$set": decision}
        )
    else:
        await db.nexus_wish_dispositions.insert_one(dict(decision))
    await log_activity(
        current_user,
        "wish_engine.disposition_recorded",
        "nexus_wish_disposition",
        decision["id"],
        cluster["signature"],
        details=f"Request shape routed to {payload.disposition}: {note}",
        metadata={
            "disposition": payload.disposition,
            "occurrences": int(cluster.get("occurrences") or 0),
        },
    )
    refreshed, _ = await _snapshot(current_user)
    updated = _find_cluster(refreshed, cluster["signature"])
    return {"cluster": updated, "disposition": updated.get("disposition")}


@router.post("/wish-engine/clusters/{signature}/promote")
async def promote_cluster(
    signature: str,
    payload: PromotionPayload,
    current_user: dict = Depends(get_current_user),
):
    """Write a reviewed request shape into the Nexus Ideas registry.

    Promotion captures a *candidate*, not an approved feature: the idea enters the
    registry as ``captured`` and the existing roadmap promotion policy still
    applies. Nexus will not promote a shape nobody has dispositioned.
    """
    snapshot, decisions = await _snapshot(current_user)
    cluster = _find_cluster(snapshot, signature)
    recorded = decisions.get(str(cluster["signature"]))
    gate = cluster.get("promotion") or {}
    if not gate.get("allowed"):
        raise HTTPException(status_code=422, detail=gate.get("reason") or "This request cannot be promoted yet")
    disposition = str(gate.get("disposition") or recorded.get("disposition"))
    axes = list(wish_promotion_axes(disposition))
    idea = await create_idea(
        {
            "title": payload.title.strip(),
            "category": gate.get("category") or "general",
            "summary": payload.summary.strip(),
            "horizon": str(payload.horizon or "explore").strip().lower(),
            "value_axes": {axis: True for axis in axes},
            "dependencies": ["core-platform"],
        },
        current_user,
    )
    # ``create_idea`` stamps every idea with the foundation source; this idea came
    # from the field, so the origin and the reviewed shape travel with it.
    await db.nexus_ideas.update_one(
        {"id": idea["id"]},
        {
            "$set": {
                "source": "wish-engine",
                "wish_signature": cluster["signature"],
                "wish_occurrences": int(cluster.get("occurrences") or 0),
                "wish_reporter_count": int(cluster.get("reporter_count") or 0),
                "wish_surfaces": list(cluster.get("surfaces") or []),
                "wish_disposition": disposition,
            }
        },
    )
    now = _now_iso()
    await db.nexus_wish_dispositions.update_one(
        tenant_scoped_query(current_user, {"id": recorded["id"]}),
        {
            "$set": {
                "idea_id": idea["id"],
                "idea_title": idea["title"],
                "promoted_at": now,
                "promoted_by": _actor_name(current_user),
            }
        },
    )
    await log_activity(
        current_user,
        "wish_engine.promoted",
        "nexus_idea",
        idea["id"],
        idea["title"],
        details=f"Request shape promoted from {int(cluster.get('occurrences') or 0)} report(s): {idea['title']}",
        metadata={
            "signature": cluster["signature"],
            "disposition": disposition,
            "value_axes": axes,
        },
    )
    refreshed, _ = await _snapshot(current_user)
    return {
        "cluster": _find_cluster(refreshed, cluster["signature"]),
        "idea": {
            "id": idea["id"],
            "title": idea["title"],
            "category": idea["category"],
            "status": idea["status"],
            "horizon": idea["horizon"],
            "value_axes": idea["value_axes"],
            "source": "wish-engine",
        },
        "policy": (
            "Promotion captures a candidate in the Nexus Ideas registry. It does not approve, schedule or release "
            "the work; dependencies, evidence, an owner and a release gate are still required."
        ),
    }
