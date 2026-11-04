"""Read-only, evidence-led workflow guidance for Nexus technicians."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import assert_record_scope
from app.services.workflow_intelligence import build_ticket_next_best_action


router = APIRouter(prefix="/workflow-intelligence", tags=["Nexus Workflow Intelligence"])


async def _find_one(
    collection: Any,
    query: dict[str, Any],
    projection: dict[str, int],
    *,
    sort: list[tuple[str, int]] | None = None,
) -> dict[str, Any] | None:
    """Keep optional evidence sources non-fatal without widening their scope."""
    try:
        if sort:
            return await collection.find_one(query, projection, sort=sort)
        return await collection.find_one(query, projection)
    except Exception:
        # A missing optional legacy collection must not leave a technician with
        # an endless loader or turn unavailable evidence into a fabricated fact.
        return None


async def _count_documents(collection: Any, query: dict[str, Any]) -> int:
    try:
        return int(await collection.count_documents(query))
    except Exception:
        return 0


@router.get("/tickets/{ticket_id}/next-best-action")
async def ticket_next_best_action(
    ticket_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Compose client-safe ticket/device/session evidence into one hand-off.

    The route creates no persistent decision record.  A technician's later
    ticket, remote, Work Session or approval action remains the authoritative
    evidence in its owning workflow.
    """
    ticket = await assert_record_scope(
        current_user,
        db.tickets,
        ticket_id,
        operation="workflow_intelligence.next_best_action.read",
        resource_name="Ticket",
    )
    client_id = str(ticket.get("client_id") or "").strip()
    linked_device_ids = ticket.get("device_ids")
    fallback_device_id = linked_device_ids[0] if isinstance(linked_device_ids, list) and linked_device_ids else None
    device_id = str(ticket.get("device_id") or fallback_device_id or "").strip()

    # A ticket is the authorisation anchor.  Every correlated record is further
    # constrained to its canonical client ID; an old cross-client device link
    # is intentionally withheld rather than being resolved through its ID.
    device = await _find_one(
        db.devices,
        {"id": device_id, "client_id": client_id},
        {
            "_id": 0,
            "id": 1,
            "client_id": 1,
            "name": 1,
            "hostname": 1,
            "status": 1,
            "last_seen": 1,
            "last_heartbeat": 1,
            "checks_failing": 1,
        },
    ) if device_id and client_id else None

    context_query = {"ticket_id": ticket_id, "client_id": client_id} if client_id else {"ticket_id": ticket_id, "client_id": {"$exists": False}}
    snapshot_query = {"device_id": device_id, "client_id": client_id} if device and client_id else {"device_id": "__nexus_unlinked_device__"}
    related_query = {
        "client_id": client_id,
        "$or": [{"device_id": device_id}, {"device_ids": device_id}],
        "status": {"$in": ["new", "open", "in_progress", "pending"]},
    } if device and client_id else {"id": "__nexus_no_related_ticket__"}

    active_work_session, latest_snapshot, latest_remote_session, related_open_ticket_count = await asyncio.gather(
        _find_one(
            db.nexus_work_sessions,
            {**context_query, "status": "active"},
            {"_id": 0, "id": 1, "ticket_id": 1, "client_id": 1, "status": 1, "started_at": 1, "technician": 1},
            sort=[("started_at", -1)],
        ),
        _find_one(
            db.device_state_snapshots,
            snapshot_query,
            {"_id": 0, "id": 1, "device_id": 1, "client_id": 1, "captured_at": 1, "last_observed_at": 1, "change_count": 1, "changed_categories": 1},
            sort=[("captured_at", -1)],
        ),
        _find_one(
            db.remote_sessions,
            context_query,
            {"_id": 0, "id": 1, "ticket_id": 1, "client_id": 1, "device_id": 1, "status": 1, "started_at": 1, "ended_at": 1},
            sort=[("started_at", -1)],
        ),
        _count_documents(db.tickets, related_query),
    )
    return build_ticket_next_best_action(
        ticket,
        device=device,
        active_work_session=active_work_session,
        latest_snapshot=latest_snapshot,
        latest_remote_session=latest_remote_session,
        related_open_ticket_count=related_open_ticket_count,
    )
