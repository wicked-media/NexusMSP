"""Indexes for the central, append-only Nexus audit trail.

These indexes are intentionally limited to observed read paths: client
timelines, ticket evidence, administrative investigation and actor/action
reviews. They are idempotent and do not alter audit documents or retention.
"""

from __future__ import annotations

from typing import Any

from app.database import db


async def ensure_audit_log_indexes(collection: Any | None = None) -> None:
    """Create the measured indexes required by central audit read paths."""
    collection = collection or db.audit_logs
    await collection.create_index(
        [("entity_type", 1), ("entity_id", 1), ("created_at", -1)],
        name="audit_entity_timeline",
    )
    await collection.create_index(
        [("client_id", 1), ("created_at", -1)],
        name="audit_client_timeline",
    )
    await collection.create_index(
        [("ticket_id", 1), ("created_at", -1)],
        name="audit_ticket_timeline",
    )
    await collection.create_index(
        [("action", 1), ("created_at", -1)],
        name="audit_action_timeline",
    )
    await collection.create_index(
        [("user_id", 1), ("created_at", -1)],
        name="audit_actor_timeline",
    )
    await collection.create_index(
        [("metadata.client_id", 1), ("created_at", -1)],
        name="audit_metadata_client_timeline",
    )
