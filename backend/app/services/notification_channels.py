"""Safe persistence and delivery helpers for operational notification channels.

Incoming webhook URLs are bearer-style credentials for most providers.  Nexus
stores them encrypted, never serialises them to a browser, and upgrades legacy
plain-text records only when a trusted backend delivery path uses them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.database import db
from app.services.secret_store import decrypt_secret, encrypt_secret
from app.services.webhook_security import validate_legacy_webhook_url


SUPPORTED_NOTIFICATION_KINDS = frozenset({"slack", "teams", "discord"})
# Only advertise events that Nexus currently publishes.  Add a value here only
# with the corresponding producer and an end-to-end delivery test.
SUPPORTED_NOTIFICATION_EVENTS = frozenset({"ticket_created"})


def normalise_notification_channel_input(data: dict[str, Any]) -> dict[str, Any]:
    """Validate one notification-channel submission without retaining secrets."""
    name = str(data.get("name") or "").strip() or "New channel"
    if len(name) > 120:
        raise ValueError("Channel name must be 120 characters or fewer")

    kind = str(data.get("kind") or "slack").strip().lower()
    if kind not in SUPPORTED_NOTIFICATION_KINDS:
        raise ValueError("Choose Slack, Microsoft Teams, or Discord")

    webhook_url = validate_legacy_webhook_url(data.get("webhook_url"))
    raw_events = data.get("events") or ["ticket_created"]
    if not isinstance(raw_events, list):
        raise ValueError("Notification events must be a list")
    events = sorted({str(event or "").strip() for event in raw_events if str(event or "").strip()})
    if not events:
        events = ["ticket_created"]
    unsupported = sorted(set(events) - SUPPORTED_NOTIFICATION_EVENTS)
    if unsupported:
        raise ValueError(
            "Only ticket-created delivery is available until Nexus publishes the selected event type"
        )

    return {
        "name": name,
        "kind": kind,
        "events": events,
        "webhook_url_encrypted": encrypt_secret(webhook_url),
    }


def public_notification_channel(document: dict[str, Any]) -> dict[str, Any]:
    """Return safe channel metadata without exposing a reusable webhook URL."""
    stored_events = [str(event) for event in (document.get("events") or [])]
    active_events = [event for event in stored_events if event in SUPPORTED_NOTIFICATION_EVENTS]
    return {
        "id": str(document.get("id") or ""),
        "name": str(document.get("name") or "New channel"),
        "kind": str(document.get("kind") or "slack"),
        "events": active_events,
        "needs_event_review": bool(set(stored_events) - SUPPORTED_NOTIFICATION_EVENTS),
        "is_active": bool(document.get("is_active", True)),
        "created_at": document.get("created_at"),
        "updated_at": document.get("updated_at"),
        "webhook_configured": bool(
            document.get("webhook_url_encrypted") or document.get("webhook_url")
        ),
    }


async def resolve_notification_webhook_url(channel: dict[str, Any]) -> str:
    """Resolve a channel URL exclusively for trusted server-side delivery.

    Legacy records are upgraded in place after validation.  Invalid or
    undecryptable records return an empty value so a publisher can fail safely
    without leaking a credential into logs or an API response.
    """
    encrypted = str(channel.get("webhook_url_encrypted") or "")
    if encrypted:
        return decrypt_secret(encrypted)

    legacy_url = str(channel.get("webhook_url") or "").strip()
    if not legacy_url:
        return ""
    try:
        canonical_url = validate_legacy_webhook_url(legacy_url)
    except ValueError:
        return ""

    channel_id = str(channel.get("id") or "")
    if channel_id:
        await db.notify_channels.update_one(
            {"id": channel_id},
            {
                "$set": {
                    "webhook_url_encrypted": encrypt_secret(canonical_url),
                    "secret_migrated_at": datetime.now(timezone.utc).isoformat(),
                },
                "$unset": {"webhook_url": ""},
            },
        )
    return canonical_url
