"""Client and site scope evaluation for technician access.

Existing NexusMSP users pre-date scoped access. Missing scope fields therefore
retain full client access, while an explicit ``restricted`` mode is deny by
default and only permits the selected clients and (optionally) sites.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request

from app.database import db


VALID_SCOPE_MODES = frozenset({"all", "restricted"})


def normalise_scope_ids(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple, set, frozenset)):
        return []
    return sorted({str(item).strip() for item in value if item is not None and str(item).strip()})


def normalise_scope_payload(data: dict[str, Any]) -> dict[str, Any]:
    mode = str(data.get("client_scope_mode") or "all").strip().lower()
    if mode not in VALID_SCOPE_MODES:
        raise HTTPException(status_code=400, detail="Client scope must be all clients or selected clients")
    return {
        "client_scope_mode": mode,
        "client_scope_ids": normalise_scope_ids(data.get("client_scope_ids")),
        "site_scope_ids": normalise_scope_ids(data.get("site_scope_ids")),
    }


def effective_scope(user: dict[str, Any]) -> dict[str, Any]:
    administrator = bool(user.get("is_admin") or str(user.get("role") or "").lower() == "admin")
    stored_mode = str(user.get("client_scope_mode") or "all").strip().lower()
    mode = "all" if administrator or stored_mode not in VALID_SCOPE_MODES else stored_mode
    return {
        "mode": mode,
        "client_ids": [] if mode == "all" else normalise_scope_ids(user.get("client_scope_ids")),
        "site_ids": [] if mode == "all" else normalise_scope_ids(user.get("site_scope_ids")),
        "administrator": administrator,
        "source": "administrator" if administrator else ("explicit-technician-scope" if "client_scope_mode" in user else "legacy-compatible-all-clients"),
    }


def scope_query(user: dict[str, Any], field: str = "client_id") -> dict[str, Any]:
    scope = effective_scope(user)
    if scope["mode"] == "all":
        return {}
    return {field: {"$in": scope["client_ids"]}}


async def assert_client_scope(
    user: dict[str, Any],
    client_id: str | None,
    *,
    site_id: str | None = None,
    operation: str | None = None,
    request: Request | None = None,
) -> dict[str, Any]:
    """Require the current technician's explicit client/site boundary.

    A missing client ID is allowed for full-access users but denied for a
    restricted technician because NexusMSP cannot prove the target is in scope.
    An empty site list means every site belonging to an allowed client.
    """
    scope = effective_scope(user)
    if scope["mode"] == "all":
        return scope

    client_allowed = bool(client_id and str(client_id) in scope["client_ids"])
    site_allowed = not site_id or not scope["site_ids"] or str(site_id) in scope["site_ids"]
    if client_allowed and site_allowed:
        return scope

    await db.scope_denials.insert_one(
        {
            "user_id": user.get("id"),
            "user_name": user.get("name"),
            "role": user.get("role"),
            "client_id": client_id,
            "site_id": site_id,
            "operation": operation,
            "method": request.method if request else None,
            "path": request.url.path if request else None,
            "correlation_id": getattr(request.state, "correlation_id", None) if request else None,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    required = f"client:{client_id or 'linked-client-required'}"
    if site_id:
        required = f"{required};site:{site_id}"
    raise HTTPException(
        status_code=403,
        detail="Your client and site scope does not allow this operation",
        headers={"X-Required-Client-Scope": required},
    )
