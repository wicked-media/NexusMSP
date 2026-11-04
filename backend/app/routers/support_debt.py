"""Nexus Support Debt — the recurring work behind repeated tickets.

Reads only what Nexus already owns: tenant-scoped tickets and the canonical
ticket time entries. It creates no collection, assigns no blame and executes
nothing on an endpoint. Every figure is derived inside the caller's tenant and
client scope, and the recorded-value basis is disclosed rather than assumed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import scoped_query, tenant_scoped_query
from app.services.support_debt import (
    SUPPORT_DEBT_MIN_OCCURRENCES,
    SUPPORT_DEBT_WINDOW_DAYS,
    labour_by_ticket,
    support_debt_signatures,
    support_debt_totals,
)

router = APIRouter(tags=["Nexus Support Debt"])

_MAX_TICKETS = 6000
_MAX_TIME_ENTRIES = 20000

SUPPORT_DEBT_BOUNDARY = (
    "Support Debt groups tickets into recurring work shapes by stable client ID and a normalised title, then "
    "projects the labour they consumed to a year. Nexus never invents a labour rate: a signature shows cost only "
    "over time entries that carry recorded value and discloses whether that basis is complete, partial or absent. "
    "It is a pattern about work, never about a person, and it proposes nothing that would change a customer record."
)


def _by_client(signatures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in signatures:
        key = str(row.get("client_id") or "")
        bucket = grouped.setdefault(
            key,
            {
                "client_id": key,
                "client_name": row.get("client_name") or "",
                "signatures": 0,
                "annual_hours": 0.0,
                "annual_cost": 0.0,
                "costed_signatures": 0,
            },
        )
        bucket["signatures"] += 1
        bucket["annual_hours"] += float(row.get("annual_hours") or 0)
        if row.get("annual_cost") is not None:
            bucket["annual_cost"] += float(row["annual_cost"])
            bucket["costed_signatures"] += 1
    rows = []
    for bucket in grouped.values():
        rows.append({
            **bucket,
            "annual_hours": round(bucket["annual_hours"], 1),
            "annual_cost": round(bucket["annual_cost"], 2) if bucket["costed_signatures"] else None,
        })
    rows.sort(key=lambda item: (-(item["annual_cost"] or 0), -item["annual_hours"], item["client_id"]))
    return rows[:25]


@router.get("/support-debt/overview")
async def support_debt_overview(
    window_days: int = SUPPORT_DEBT_WINDOW_DAYS,
    min_occurrences: int = SUPPORT_DEBT_MIN_OCCURRENCES,
    current_user: dict = Depends(get_current_user),
):
    """Return the MSP's recurring-work signatures and what they cost a year."""
    if not 30 <= int(window_days) <= 365:
        raise HTTPException(status_code=422, detail="window_days must be between 30 and 365")
    if not 2 <= int(min_occurrences) <= 20:
        raise HTTPException(status_code=422, detail="min_occurrences must be between 2 and 20")
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=int(window_days))).isoformat()

    tickets = await db.tickets.find(
        tenant_scoped_query(
            current_user,
            scoped_query(current_user, {"created_at": {"$gte": cutoff}}, site_field=None),
        ),
        {"_id": 0, "id": 1, "title": 1, "client_id": 1, "client_name": 1, "category": 1, "created_at": 1},
    ).to_list(_MAX_TICKETS)

    entries = await db.time_entries.find(
        tenant_scoped_query(
            current_user,
            scoped_query(
                current_user,
                {"ticket_id": {"$exists": True, "$ne": ""}},
                site_field=None,
            ),
        ),
        {"_id": 0, "ticket_id": 1, "minutes": 1, "hours": 1, "total_amount": 1, "amount": 1, "rate": 1},
    ).to_list(_MAX_TIME_ENTRIES)

    labour = labour_by_ticket(entries)
    signatures = support_debt_signatures(
        tickets,
        labour,
        min_occurrences=int(min_occurrences),
        window_days=int(window_days),
        now=now,
    )
    totals = support_debt_totals(signatures)

    return {
        "window_days": int(window_days),
        "min_occurrences": int(min_occurrences),
        "signatures": signatures,
        "totals": totals,
        "by_client": _by_client(signatures),
        "evidence": {
            "tickets_considered": len(tickets),
            "time_entries_considered": len(entries),
            "tickets_with_recorded_labour": len(labour),
        },
        "boundary": SUPPORT_DEBT_BOUNDARY,
    }
