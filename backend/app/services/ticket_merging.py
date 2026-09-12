"""Canonical, scope-safe ticket merge behaviour.

All public merge routes delegate here so a ticket merge has one auditable
meaning regardless of whether it starts from the ticket workspace, a legacy
tool, or a Pro Pack shortcut.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable
import uuid

from fastapi import HTTPException

from app.database import db
from app.services.scope_permissions import assert_record_scope
from app.services.ticket_time import sync_ticket_time_cache


async def _ticket_in_scope(ticket_id: str, current_user: dict, operation: str) -> dict:
    return await assert_record_scope(
        current_user,
        db.tickets,
        str(ticket_id),
        operation=operation,
        resource_name="Ticket",
    )


async def _audit(ticket_id: str, current_user: dict, action: str, details: str, now: str) -> None:
    await db.ticket_audit_log.insert_one(
        {
            "id": str(uuid.uuid4()),
            "ticket_id": ticket_id,
            "user_id": current_user.get("id", "system"),
            "user_name": current_user.get("name", "System"),
            "action": action,
            "details": details,
            "created_at": now,
        }
    )


async def merge_tickets(
    *,
    primary_ticket_id: str,
    secondary_ticket_ids: Iterable[str],
    current_user: dict,
    operation: str = "ticket.merge",
) -> dict:
    """Merge same-client tickets without discarding their operational record.

    The primary ticket remains the active source of work. Comments, legacy
    notes, attachment links and time entries are retained on it with immutable
    provenance back to their original ticket. The source tickets remain closed
    records rather than being deleted.
    """
    primary = await _ticket_in_scope(primary_ticket_id, current_user, operation)
    primary_id = primary["id"]
    source_ids = list(
        dict.fromkeys(
            str(ticket_id).strip()
            for ticket_id in secondary_ticket_ids
            if ticket_id is not None and str(ticket_id).strip() and str(ticket_id).strip() != primary_id
        )
    )
    if not source_ids:
        raise HTTPException(status_code=400, detail="Choose at least one different ticket to merge")

    sources = []
    for source_id in source_ids:
        source = await _ticket_in_scope(source_id, current_user, operation)
        if source.get("client_id") != primary.get("client_id"):
            raise HTTPException(status_code=400, detail="Merged tickets must belong to the same client")
        if source.get("merged_into") and source.get("merged_into") != primary_id:
            raise HTTPException(status_code=409, detail="A selected ticket was already merged into another ticket")
        sources.append(source)

    now = datetime.now(timezone.utc).isoformat()
    merged, already_merged = [], []
    for source in sources:
        source_id = source["id"]
        if source.get("merged_into") == primary_id:
            already_merged.append(source_id)
            continue

        provenance = {
            "merged_from_ticket_id": source_id,
            "merged_from_ticket_number": source.get("ticket_number") or source_id,
            "merged_at": now,
        }
        for collection_name in ("ticket_comments", "ticket_notes", "ticket_attachments", "ticket_time_entries"):
            await db[collection_name].update_many(
                {"ticket_id": source_id},
                {"$set": {"ticket_id": primary_id, **provenance}},
            )
        # Canonical billable time lives in ``time_entries``.  Preserve the
        # source ticket identity as immutable provenance while rebinding the
        # ticket relationship used by totals and invoices.  Legacy
        # ``ticket_time_entries`` above remain visible history only.
        await db.time_entries.update_many(
            {"ticket_id": source_id, "client_id": primary.get("client_id")},
            {
                "$set": {
                    "ticket_id": primary_id,
                    "ticket_title": primary.get("title"),
                    **provenance,
                }
            },
        )
        await sync_ticket_time_cache(source_id, database=db, calculated_at=now)

        await db.tickets.update_one(
            {"id": source_id},
            {
                "$set": {
                    "status": "closed",
                    "closed_at": now,
                    "closed_reason": f"Merged into {primary.get('ticket_number') or primary_id}",
                    "merged_into": primary_id,
                    "merged_at": now,
                    "merged_by": current_user.get("id"),
                    "updated_at": now,
                }
            },
        )
        await _audit(
            source_id,
            current_user,
            "ticket_merged_into",
            f"Merged into {primary.get('ticket_number') or primary_id}",
            now,
        )
        await _audit(
            primary_id,
            current_user,
            "ticket_merged",
            f"Merged {source.get('ticket_number') or source_id} into this ticket",
            now,
        )
        await db.merge_logs.insert_one(
            {
                "id": f"mlog-{uuid.uuid4().hex[:8]}",
                "primary_ticket_id": primary_id,
                "secondary_ticket_id": source_id,
                "primary_title": primary.get("title", ""),
                "secondary_title": source.get("title", ""),
                "client_id": primary.get("client_id"),
                "client_name": primary.get("client_name", ""),
                "merged_by": current_user.get("name", ""),
                "merged_by_id": current_user.get("id"),
                "merged_at": now,
            }
        )
        merged.append(source_id)

    if merged:
        await db.tickets.update_one(
            {"id": primary_id},
            {
                "$addToSet": {"merged_from": {"$each": merged}},
                "$set": {"updated_at": now},
            },
        )
        await sync_ticket_time_cache(primary_id, database=db, calculated_at=now)

    return {
        "primary_ticket_id": primary_id,
        "merged_ticket_ids": merged,
        "already_merged_ticket_ids": already_merged,
        "merged_count": len(merged),
    }
