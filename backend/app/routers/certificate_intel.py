"""Certificate & Domain Intelligence — merged tool for roadmap #488-free wave (#489/#493).

A derived, workspace-scoped read model over the canonical domain and
certificate records Nexus already owns (`db.domains`, `db.ssl_certificates`).
It never becomes a second source of truth: expiry risk, dangerous-change
review and portfolio exposure are computed from retained evidence, and review
decisions are recorded as separate governance records so the source records
stay authoritative.

All reads are workspace-scoped; review writes are audited.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.certificate_intelligence import (
    classify_change,
    expiry_risk,
    exposure_score,
)
from app.services.scope_permissions import assert_client_scope, scoped_query

router = APIRouter(prefix="/certificate-intel", tags=["Certificate & Domain Intelligence"])


class ChangeReview(BaseModel):
    model_config = {"extra": "forbid"}

    record_id: str = Field(min_length=1, max_length=120)
    kind: str = Field(min_length=1, max_length=60)
    client_id: Optional[str] = None
    outcome: str = Field(default="reviewed", max_length=40)
    note: Optional[str] = Field(default=None, max_length=500)


def _normalise_record(record: dict, record_type: str) -> dict:
    """Map canonical storage fields onto the intelligence model's fields."""
    return {
        **record,
        "record_type": record_type,
        "name": record.get("name") or record.get("domain") or record.get("common_name") or "unnamed",
        "expires_at": record.get("expires_at") or record.get("expiry_date"),
    }


async def _load_records(current_user: dict, client_id: str | None) -> list[dict]:
    query = scoped_query(current_user, {"client_id": client_id} if client_id else {}, site_field=None)
    domains = await db.domains.find(query, {"_id": 0}).to_list(1000)
    certs = await db.ssl_certificates.find(query, {"_id": 0}).to_list(1000)
    return [_normalise_record(r, "domain") for r in domains] + [
        _normalise_record(r, "certificate") for r in certs
    ]


async def _merge_reviews(records: list[dict], current_user: dict) -> list[dict]:
    """Mark dangerous changes reviewed when governance evidence exists."""
    reviews = await db.certificate_intel_reviews.find(
        scoped_query(current_user, {}, site_field=None), {"_id": 0}
    ).to_list(2000)
    reviewed = {(r.get("record_id"), r.get("kind")) for r in reviews}
    merged = []
    for record in records:
        changes = [
            {**change, "reviewed": change.get("reviewed") or (record.get("id"), change.get("kind")) in reviewed}
            for change in (record.get("changes") or [])
        ]
        merged.append({**record, "changes": changes})
    return merged


@router.get("/portfolio")
async def get_portfolio(
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Portfolio expiry risk and dangerous-change backlog across domains and certificates."""
    if client_id:
        await assert_client_scope(current_user, client_id, operation="certificate_intel.portfolio", mask_not_found=True)
    records = await _merge_reviews(await _load_records(current_user, client_id), current_user)
    portfolio = exposure_score(records)
    by_type = {
        record_type: exposure_score([r for r in records if r["record_type"] == record_type])
        for record_type in ("domain", "certificate")
    }
    return {
        "portfolio": portfolio,
        "by_type": by_type,
        "boundary": (
            "Derived read model over retained domain and certificate evidence. "
            "It never scans, never changes a provider, and keeps unknown expiry distinct from safe."
        ),
    }


@router.get("/expiring")
async def get_expiring(
    within_days: int = 90,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Records at or below the requested expiry horizon, soonest first, with reasons."""
    if client_id:
        await assert_client_scope(current_user, client_id, operation="certificate_intel.expiring", mask_not_found=True)
    within_days = max(0, min(within_days, 365))
    records = await _load_records(current_user, client_id)
    at_risk = []
    for record in records:
        risk = expiry_risk(record.get("expires_at"))
        if risk["days_remaining"] is not None and risk["days_remaining"] <= within_days:
            at_risk.append({
                "id": record.get("id"),
                "name": record["name"],
                "record_type": record["record_type"],
                "client_id": record.get("client_id", ""),
                "expires_at": record.get("expires_at"),
                "risk": risk,
            })
    at_risk.sort(key=lambda item: item["risk"]["days_remaining"])
    return {"within_days": within_days, "count": len(at_risk), "records": at_risk}


@router.get("/dangerous-changes")
async def get_dangerous_changes(current_user: dict = Depends(get_current_user)):
    """Every retained dangerous DNS/registration change with its explanation and review state."""
    records = await _merge_reviews(await _load_records(current_user, None), current_user)
    changes = exposure_score(records)["unreviewed_dangerous_changes"]
    known_kinds = {kind: classify_change(kind) for kind in set(c["kind"] for c in changes)}
    return {"count": len(changes), "changes": changes, "known_kinds": known_kinds}


@router.post("/changes/review")
async def review_change(
    payload: ChangeReview,
    current_user: dict = Depends(get_current_user),
):
    """Record review evidence for a dangerous change. Source records stay untouched."""
    classified = classify_change(payload.kind)
    if not classified:
        raise HTTPException(status_code=422, detail="Unknown change kind")
    if payload.client_id:
        await assert_client_scope(
            current_user, payload.client_id, operation="certificate_intel.review", mask_not_found=True
        )
    review = {
        "record_id": payload.record_id,
        "kind": payload.kind,
        "client_id": payload.client_id or "",
        "outcome": payload.outcome,
        "note": payload.note or "",
        "reviewed_by": current_user["id"],
        "reviewed_by_name": current_user.get("name", ""),
    }
    await db.certificate_intel_reviews.insert_one(dict(review))
    await log_activity(
        current_user,
        "certificate_intel.review",
        "certificate_intel",
        payload.record_id,
        payload.record_id,
        details=f"Reviewed {payload.kind}: {payload.outcome}",
    )
    return {"status": "recorded", "review": {k: v for k, v in review.items()}, "explanation": classified["explanation"]}
