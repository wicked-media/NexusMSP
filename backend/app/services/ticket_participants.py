"""Durable, privacy-safe ticket conversation participant records."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import re
from typing import Iterable

from app.database import db


def _normalise_email(value: str) -> str | None:
    email = str(value or "").strip().casefold()
    if not email or len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        return None
    return email


async def sync_ticket_participants(
    *,
    ticket: dict,
    addresses: Iterable[str],
    role: str,
    direction: str,
    delivery_status: str | None = None,
    display_name: str | None = None,
) -> None:
    """Idempotently capture visible conversation parties for a ticket.

    BCC recipients deliberately never reach this service. They remain confined
    to the restricted delivery audit rather than becoming visible ticket data.
    """
    ticket_id = str(ticket.get("id") or "").strip()
    client_id = str(ticket.get("client_id") or "").strip()
    if not ticket_id or not client_id:
        return
    now = datetime.now(timezone.utc).isoformat()
    for raw_email in addresses:
        email = _normalise_email(raw_email)
        if not email:
            continue
        participant_id = "ticket-participant-" + hashlib.sha256(f"{ticket_id}:{email}".encode("utf-8")).hexdigest()[:24]
        updates = {
            "$set": {
                "ticket_id": ticket_id,
                "client_id": client_id,
                "email": email,
                "last_seen_at": now,
                "last_direction": direction,
                "last_delivery_status": delivery_status,
            },
            "$setOnInsert": {
                "id": participant_id,
                "display_name": str(display_name or "").strip(),
                "first_seen_at": now,
            },
            "$addToSet": {"roles": role},
        }
        await db.ticket_participants.update_one({"id": participant_id}, updates, upsert=True)
