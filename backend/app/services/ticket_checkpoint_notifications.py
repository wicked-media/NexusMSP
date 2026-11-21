"""In-app alerts for client-visible ticket promises that have come due.

The ticket's ``next_checkpoint_at`` field remains the sole authority for the
promise.  This service projects one notification per promised checkpoint and
settles that projection when a client-visible update fulfils the promise; it
never writes the conversation itself.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
import uuid

from pymongo.errors import DuplicateKeyError

from app.database import db


logger = logging.getLogger(__name__)

TICKET_CHECKPOINT_DUE = "ticket_checkpoint_due"
_CLOSED_TICKET_STATUSES = ("resolved", "closed", "cancelled")
_CHECKPOINT_FIELDS = (
    "next_checkpoint_at",
    "next_checkpoint_set_at",
    "next_checkpoint_set_by",
    "next_checkpoint_set_by_name",
)
_INDEXED_DATABASE_IDS: set[int] = set()


def _checkpoint_value(value: Any) -> str:
    """Return the exact promised timestamp in the format the writer stores."""
    if isinstance(value, datetime):
        normalised = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return normalised.astimezone(timezone.utc).isoformat()
    return str(value or "").strip()


async def ensure_ticket_checkpoint_notification_indexes() -> None:
    """Protect the per-promise dedupe key against concurrent generators."""
    database_id = id(db)
    if database_id in _INDEXED_DATABASE_IDS:
        return
    try:
        await db.notifications.create_index(
            "dedupe_key",
            unique=True,
            partialFilterExpression={"dedupe_key": {"$exists": True}},
            name="ticket_checkpoint_notification_dedupe",
        )
    except Exception:
        # Index creation is a concurrency guard, not a reason to withhold a
        # notification.  Mongo will retry on the next pass.
        logger.exception("Could not ensure ticket checkpoint notification index")
        return
    _INDEXED_DATABASE_IDS.add(database_id)


async def notify_due_ticket_checkpoints(*, limit: int = 100) -> dict[str, int]:
    """Create one in-app alert for each promised checkpoint that is now due.

    The notification is deduplicated by ticket, tenant, recipient and the exact
    promised time.  Moving a promise to a new time therefore creates a new alert,
    while retries and frequent polling cannot duplicate the same one.
    """
    await ensure_ticket_checkpoint_notification_indexes()
    now = datetime.now(timezone.utc)
    due = await db.tickets.find(
        {
            "status": {"$nin": list(_CLOSED_TICKET_STATUSES)},
            "next_checkpoint_at": {"$exists": True, "$ne": None, "$lte": now.isoformat()},
        },
        {
            "_id": 0,
            "id": 1,
            "tenant_id": 1,
            "client_id": 1,
            "site_id": 1,
            "assigned_to": 1,
            "title": 1,
            "ticket_number": 1,
            "next_checkpoint_at": 1,
        },
    ).sort("next_checkpoint_at", 1).to_list(limit)

    created = 0
    for ticket in due:
        ticket_id = str(ticket.get("id") or "").strip()
        checkpoint_at = _checkpoint_value(ticket.get("next_checkpoint_at"))
        if not ticket_id or not checkpoint_at:
            continue

        tenant_id = str(ticket.get("tenant_id") or "nexus-local").strip() or "nexus-local"
        recipient = str(ticket.get("assigned_to") or "all").strip() or "all"
        label = str(ticket.get("ticket_number") or ticket_id).strip()[:80]
        notification = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "client_id": ticket.get("client_id"),
            "site_id": ticket.get("site_id"),
            "user_id": recipient,
            "type": TICKET_CHECKPOINT_DUE,
            "title": f"Promised update due · {label}",
            "message": (
                f"{label} reached the update time Nexus promised the client. "
                "Publish an update or set a new promise."
            ),
            "ref_id": ticket_id,
            "ref_type": "ticket",
            "action_url": f"/tickets?ticket={ticket_id}",
            "action_label": "Open ticket",
            "checkpoint_at": checkpoint_at,
            "dedupe_key": f"ticket_checkpoint:{tenant_id}:{ticket_id}:{recipient}:{checkpoint_at}",
            "severity": "critical",
            "source": "ticket_checkpoint",
            "read": False,
            "created_at": now.isoformat(),
        }
        try:
            result = await db.notifications.update_one(
                {
                    "tenant_id": tenant_id,
                    "user_id": recipient,
                    "type": TICKET_CHECKPOINT_DUE,
                    "ref_id": ticket_id,
                    "checkpoint_at": checkpoint_at,
                },
                {"$setOnInsert": notification},
                upsert=True,
            )
        except DuplicateKeyError:
            # A concurrent worker/API poll won the same promise first.
            continue
        if not getattr(result, "upserted_id", None):
            continue

        # A due read and an update publish can overlap.  Re-read the ticket
        # after the insert: if the promise was cleared or moved in between, the
        # alert is already historical and must not remain an unread item.
        current_ticket = await db.tickets.find_one(
            {"id": ticket_id},
            {"_id": 0, "tenant_id": 1, "next_checkpoint_at": 1, "status": 1},
        )
        current_tenant = str((current_ticket or {}).get("tenant_id") or "nexus-local").strip() or "nexus-local"
        current_checkpoint = _checkpoint_value((current_ticket or {}).get("next_checkpoint_at"))
        still_current = bool(
            current_ticket
            and current_tenant == tenant_id
            and str(current_ticket.get("status") or "").lower() not in _CLOSED_TICKET_STATUSES
            and current_checkpoint == checkpoint_at
        )
        if not still_current:
            await db.notifications.update_one(
                {
                    "tenant_id": tenant_id,
                    "user_id": recipient,
                    "type": TICKET_CHECKPOINT_DUE,
                    "ref_id": ticket_id,
                    "checkpoint_at": checkpoint_at,
                    "resolved_at": {"$exists": False},
                },
                {"$set": {
                    "read": True,
                    "resolved_at": datetime.now(timezone.utc).isoformat(),
                    "resolution": "promise_superseded",
                }},
            )
            continue
        created += 1

    return {"checked": len(due), "created": created}


async def acknowledge_client_visible_update(
    ticket: dict[str, Any],
    *,
    tenant_id: str,
    published_before: str | None,
    actor: dict[str, Any] | None = None,
    comment_id: str | None = None,
    clear_existing_promise: bool = True,
) -> dict[str, Any]:
    """Settle a ticket's promised checkpoint after a client-visible update.

    The alert is resolved for every technician who could see it, and an older
    promise is cleared because the client has now received the update.  The
    ``published_before`` boundary is the publication time of the conversation
    entry, not the time a retry is handled: a delayed replay must never resolve
    an alert or clear a promise that another technician created afterwards.

    Only the notification's delivery state and the fulfilled promise are
    touched here.  ``ticket_comments`` remains authoritative for the published
    update and ``ticket_audit_log`` records the workflow evidence.
    """
    ticket_id = str(ticket.get("id") or "").strip()
    tenant_id = str(tenant_id or "").strip()
    if not ticket_id or not tenant_id:
        return {"alerts_resolved": 0, "promise_cleared": False, "cleared_checkpoint_at": None}

    resolved_at = datetime.now(timezone.utc).isoformat()
    alert_query: dict[str, Any] = {
        "tenant_id": tenant_id,
        "type": TICKET_CHECKPOINT_DUE,
        "ref_id": ticket_id,
        "resolved_at": {"$exists": False},
    }
    client_id = str(ticket.get("client_id") or "").strip()
    if client_id:
        alert_query["client_id"] = client_id
    if published_before:
        alert_query["checkpoint_at"] = {"$lte": published_before}

    actor_id = str((actor or {}).get("id") or "").strip()
    alert_update: dict[str, Any] = {
        "$set": {
            "read": True,
            "resolved_at": resolved_at,
            "resolution": "client_update_published",
            "resolved_by": actor_id or None,
            "resolved_by_name": (actor or {}).get("name"),
            "resolved_comment_id": comment_id or None,
        },
    }
    if actor_id:
        alert_update["$addToSet"] = {"read_by": actor_id}

    alerts_resolved = 0
    alert_result = await db.notifications.update_many(alert_query, alert_update)
    alerts_resolved = int(getattr(alert_result, "modified_count", 0) or 0)

    promise_cleared = False
    cleared_checkpoint_at = None
    promised_at = _checkpoint_value(ticket.get("next_checkpoint_at"))
    if clear_existing_promise:
        promise_query: dict[str, Any] = {
            "id": ticket_id,
            "tenant_id": tenant_id,
            "next_checkpoint_at": {"$exists": True, "$ne": None},
        }
        if client_id:
            promise_query["client_id"] = client_id
        if published_before:
            promise_query["$or"] = [
                {"next_checkpoint_set_at": {"$exists": False}},
                {"next_checkpoint_set_at": None},
                {"next_checkpoint_set_at": {"$lte": published_before}},
            ]
        promise_result = await db.tickets.update_one(
            promise_query,
            {"$unset": {field: "" for field in _CHECKPOINT_FIELDS}},
        )
        promise_cleared = bool(getattr(promise_result, "modified_count", 0))
        if promise_cleared:
            cleared_checkpoint_at = promised_at

    return {
        "alerts_resolved": alerts_resolved,
        "promise_cleared": promise_cleared,
        "cleared_checkpoint_at": cleared_checkpoint_at,
    }


async def settle_closed_ticket_checkpoint(
    ticket: dict[str, Any],
    *,
    tenant_id: str,
    actor: dict[str, Any] | None = None,
    resolution: str | None = None,
    database: Any | None = None,
) -> dict[str, Any]:
    """Settle a ticket's promise when it is resolved or closed.

    A completed ticket has no next client update to promise, so closing it
    clears any remaining checkpoint and removes its due alerts from the
    outstanding queue.  The write is best-effort cleanup: a notification
    projection failure must not turn a successful ticket closure into an API
    error.  Callers pass their database handle so the same tenant-scoped store
    is used by the route and its tests.
    """
    store = database if database is not None else db
    empty = {
        "alerts_resolved": 0,
        "promise_cleared": False,
        "cleared_checkpoint_at": None,
        "resolution": None,
    }
    ticket_id = str(ticket.get("id") or "").strip()
    tenant_id = str(tenant_id or "").strip()
    status = str(ticket.get("status") or "").strip().lower()
    if not ticket_id or not tenant_id or status not in _CLOSED_TICKET_STATUSES:
        return empty

    resolution = resolution or (
        "ticket_resolved"
        if status == "resolved" or ticket.get("resolution_status") == "resolved_and_closed"
        else "ticket_closed"
    )
    try:
        now = datetime.now(timezone.utc).isoformat()
        client_id = str(ticket.get("client_id") or "").strip()
        actor_id = str((actor or {}).get("id") or "").strip()

        alert_query: dict[str, Any] = {
            "tenant_id": tenant_id,
            "type": TICKET_CHECKPOINT_DUE,
            "ref_id": ticket_id,
            "resolved_at": {"$exists": False},
        }
        if client_id:
            alert_query["client_id"] = client_id
        alert_update: dict[str, Any] = {
            "$set": {
                "read": True,
                "resolved_at": now,
                "resolution": resolution,
                "resolved_by": actor_id or None,
                "resolved_by_name": (actor or {}).get("name"),
            },
        }
        if actor_id:
            alert_update["$addToSet"] = {"read_by": actor_id}
        alert_result = await store.notifications.update_many(alert_query, alert_update)

        promise_query: dict[str, Any] = {
            "id": ticket_id,
            "tenant_id": tenant_id,
            "status": {"$in": list(_CLOSED_TICKET_STATUSES)},
            "next_checkpoint_at": {"$exists": True, "$ne": None},
        }
        if client_id:
            promise_query["client_id"] = client_id
        promised_at = _checkpoint_value(ticket.get("next_checkpoint_at"))
        promise_result = await store.tickets.update_one(
            promise_query,
            {"$unset": {field: "" for field in _CHECKPOINT_FIELDS}},
        )
        promise_cleared = bool(getattr(promise_result, "modified_count", 0))
    except Exception:
        logger.exception(
            "Could not settle ticket checkpoint on closure ticket_id=%s status=%s",
            ticket.get("id"),
            ticket.get("status"),
        )
        return empty

    return {
        "alerts_resolved": int(getattr(alert_result, "modified_count", 0) or 0),
        "promise_cleared": promise_cleared,
        "cleared_checkpoint_at": promised_at if promise_cleared else None,
        "resolution": resolution,
    }


async def ticket_checkpoint_notification_scheduler() -> None:
    """Keep due-promise alerts current even when no browser is polling."""
    await asyncio.sleep(20)
    while True:
        try:
            summary = await notify_due_ticket_checkpoints()
            if summary["created"]:
                logger.info(
                    "Ticket checkpoint notifications: %s due, %s created",
                    summary["checked"],
                    summary["created"],
                )
        except Exception:
            logger.exception("Ticket checkpoint notification worker failed")
        await asyncio.sleep(60)
