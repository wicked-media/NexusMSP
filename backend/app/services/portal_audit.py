"""Persist client-portal security and administration events.

Portal activity is written to a dedicated collection for the client workspace
and mirrored into the platform activity ledger so it also appears in the
global audit trail. Secrets, passwords and bearer tokens must never be passed
in metadata.
"""

from datetime import datetime, timezone
from typing import Any
import uuid

from app.database import db


SENSITIVE_METADATA_KEYS = {
    "password",
    "password_hash",
    "temp_password",
    "token",
    "access_token",
    "secret",
    "totp_secret",
}


def safe_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Remove secret-bearing fields before an audit record is persisted."""
    cleaned: dict[str, Any] = {}
    for key, value in (metadata or {}).items():
        if str(key).lower() in SENSITIVE_METADATA_KEYS:
            continue
        if isinstance(value, dict):
            cleaned[key] = safe_metadata(value)
        else:
            cleaned[key] = value
    return cleaned


async def record_portal_event(
    *,
    action: str,
    client_id: str = "",
    client_name: str = "",
    actor: dict | None = None,
    portal_user: dict | None = None,
    outcome: str = "success",
    details: str = "",
    ip_address: str | None = None,
    user_agent: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write one durable portal event and mirror it into the audit ledger."""
    actor = actor or {}
    portal_user = portal_user or {}
    now = datetime.now(timezone.utc).isoformat()
    event_id = str(uuid.uuid4())
    safe = safe_metadata(metadata)
    event = {
        "id": event_id,
        "client_id": client_id or portal_user.get("client_id", ""),
        "client_name": client_name or portal_user.get("client_name", ""),
        "user_id": portal_user.get("id") or actor.get("id") or "",
        "user_name": portal_user.get("name") or actor.get("name") or "Unknown user",
        "user_email": portal_user.get("email") or actor.get("email") or "",
        "actor_type": "technician" if actor else "portal_user",
        "actor_id": actor.get("id") or portal_user.get("id") or "",
        "actor_name": actor.get("name") or portal_user.get("name") or actor.get("email") or portal_user.get("email") or "System",
        "action": action,
        "outcome": outcome if outcome in {"success", "failed", "blocked", "warning"} else "warning",
        "details": details or action.replace("_", " ").capitalize(),
        "ip_address": ip_address,
        "user_agent": (user_agent or "")[:500],
        "metadata": safe,
        "timestamp": now,
    }
    await db.portal_access_logs.insert_one(dict(event))

    activity_action = action if event["outcome"] == "success" else f"{action}_{event['outcome']}"
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": event["actor_id"] or "portal-user",
        "user_name": event["actor_name"],
        "action": activity_action,
        "entity_type": "client_portal",
        "entity_id": event["client_id"],
        "entity_name": event["client_name"] or event["user_email"],
        "details": event["details"],
        "changes": {},
        "metadata": {
            "portal_event_id": event_id,
            "outcome": event["outcome"],
            "portal_user_id": event["user_id"],
            "portal_user_email": event["user_email"],
            **safe,
        },
        "created_at": now,
    })
    return event
