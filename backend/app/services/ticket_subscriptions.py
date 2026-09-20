"""Tenant-scoped ticket subscriptions and in-app delivery evidence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import uuid

from app.database import db


async def ensure_ticket_subscription_indexes() -> None:
    await db.ticket_subscriptions.create_index(
        [("tenant_id", 1), ("ticket_id", 1), ("user_id", 1)],
        unique=True,
        name="ticket_subscription_unique",
    )


async def notify_ticket_subscribers(*, ticket: dict[str, Any], comment: dict[str, Any], actor_id: str | None) -> int:
    """Create one durable in-app notification per subscriber and comment.

    This deliberately has no email side effect: personal notification settings
    and external delivery channels remain separate policies. A unique comment
    fingerprint means retries cannot notify a handover group twice.
    """
    tenant_id = str(ticket.get("tenant_id") or "nexus-local")
    ticket_id = str(ticket.get("id") or comment.get("ticket_id") or "")
    comment_id = str(comment.get("id") or "")
    if not ticket_id or not comment_id:
        return 0
    await ensure_ticket_subscription_indexes()
    subscribers = await db.ticket_subscriptions.find(
        {"tenant_id": tenant_id, "ticket_id": ticket_id, "active": True},
        {"_id": 0, "user_id": 1},
    ).to_list(100)
    created = 0
    author = str(comment.get("user_name") or comment.get("sender_name") or "A ticket participant")[:160]
    visibility = "internal note" if bool(comment.get("is_internal")) else "reply"
    ticket_label = str(ticket.get("ticket_number") or ticket_id)[:80]
    for subscriber in subscribers:
        user_id = str(subscriber.get("user_id") or "")
        if not user_id or user_id == str(actor_id or ""):
            continue
        result = await db.notifications.update_one(
            {
                "user_id": user_id,
                "type": "ticket_subscription_update",
                "ref_id": ticket_id,
                "comment_id": comment_id,
            },
            {"$setOnInsert": {
                "id": str(uuid.uuid4()),
                "tenant_id": tenant_id,
                "user_id": user_id,
                "type": "ticket_subscription_update",
                "title": f"Ticket update · {ticket_label}",
                "message": f"{author} added a {visibility} on {ticket.get('title') or 'a subscribed ticket'}.",
                "ref_id": ticket_id,
                "ref_type": "ticket",
                "comment_id": comment_id,
                "severity": "info",
                "read": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        created += int(bool(getattr(result, "upserted_id", None)))
    return created
