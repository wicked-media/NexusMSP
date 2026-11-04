"""Compatibility enforcement for the established Nexus workspace permissions.

The action-permission registry is progressively replacing these module-level
grants.  Existing workspaces still store permissions such as
``permissions.networking.edit``; routes must enforce them server-side while
that migration is under way.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.database import db


async def require_module_permission(current_user: dict, module: str, action: str) -> None:
    """Require a legacy module action and record direct API denials."""
    if current_user.get("is_admin") or str(current_user.get("role") or "").lower() == "admin":
        return
    permissions = current_user.get("permissions") or {}
    module_permissions = permissions.get(module) if isinstance(permissions, dict) else None
    if isinstance(module_permissions, dict) and module_permissions.get(action) is True:
        return
    await db.permission_denials.insert_one({
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "role": current_user.get("role"),
        "permission": f"{module}.{action}",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    })
    raise HTTPException(status_code=403, detail=f"{module.title()} {action} permission required")
