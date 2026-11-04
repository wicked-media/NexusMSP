from datetime import datetime, timezone
import uuid
from app.database import db
from app.services.scope_permissions import platform_tenant_id

# Re-exported for legacy importers; the canonical list lives in
# app.services.achievement_catalog so every surface shares one source.
from app.services.achievement_catalog import ACHIEVEMENT_DEFINITIONS  # noqa: F401


async def log_activity(user: dict, action: str, entity_type: str, entity_id: str, entity_name: str = "", details: str = "", changes: dict = None, metadata: dict = None):
    """Log activity for cross-entity audit trail. Admin-visible only."""
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "details": details,
        "changes": changes or {},
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.activity_logs.insert_one(entry)


async def ticket_audit(ticket_id: str, user: dict, action: str, details: str = ""):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "tenant_id": platform_tenant_id(user),
        "user_id": user.get("id", ""),
        "user_name": user.get("name", ""),
        "action": action,
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.ticket_audit_log.insert_one(entry)
