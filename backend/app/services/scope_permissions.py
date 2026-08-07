"""Client and site scope evaluation for technician access.

Production access is fail closed. Administrators and users explicitly assigned
``all`` retain full client access; missing or invalid scope configuration is
treated as an empty restricted scope instead of silently granting every client.
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
    administrator = user.get("is_admin") in (True, 1) or str(user.get("role") or "").lower() == "admin"
    has_explicit_scope = "client_scope_mode" in user
    stored_mode = str(user.get("client_scope_mode") or "").strip().lower()
    mode = "all" if administrator else stored_mode if has_explicit_scope and stored_mode in VALID_SCOPE_MODES else "restricted"
    return {
        "mode": mode,
        "client_ids": [] if mode == "all" else normalise_scope_ids(user.get("client_scope_ids")),
        "site_ids": [] if mode == "all" else normalise_scope_ids(user.get("site_scope_ids")),
        "administrator": administrator,
        "source": "administrator" if administrator else ("explicit-technician-scope" if has_explicit_scope and stored_mode in VALID_SCOPE_MODES else "fail-closed-unassigned"),
    }


def scope_query(user: dict[str, Any], field: str = "client_id") -> dict[str, Any]:
    scope = effective_scope(user)
    if scope["mode"] == "all":
        return {}
    return {field: {"$in": scope["client_ids"]}}


def scoped_query(
    user: dict[str, Any],
    query: dict[str, Any] | None = None,
    *,
    field: str = "client_id",
    site_field: str | None = "site_id",
) -> dict[str, Any]:
    """Combine an operational query with the current user's client/site boundary."""
    operational = dict(query or {})
    scope = effective_scope(user)
    if scope["mode"] == "all":
        return operational
    boundaries = [{field: {"$in": scope["client_ids"]}}]
    if site_field and scope["site_ids"]:
        boundaries.append({site_field: {"$in": scope["site_ids"]}})
    clauses = ([operational] if operational else []) + boundaries
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


async def assert_client_scope(
    user: dict[str, Any],
    client_id: str | None,
    *,
    site_id: str | None = None,
    operation: str | None = None,
    request: Request | None = None,
    mask_not_found: bool = False,
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
    if mask_not_found:
        raise HTTPException(status_code=404, detail="Resource not found")

    raise HTTPException(
        status_code=403,
        detail="Your client and site scope does not allow this operation",
    )


async def assert_global_scope(
    user: dict[str, Any],
    *,
    operation: str | None = None,
    request: Request | None = None,
) -> dict[str, Any]:
    """Require an explicitly global client scope for cross-client operations."""
    scope = effective_scope(user)
    if scope["mode"] == "all":
        return scope
    return await assert_client_scope(
        user,
        None,
        operation=operation,
        request=request,
    )


async def assert_record_scope(
    user: dict[str, Any],
    collection: Any,
    record_id: str,
    *,
    id_field: str = "id",
    client_field: str = "client_id",
    site_field: str = "site_id",
    operation: str | None = None,
    request: Request | None = None,
    resource_name: str = "Resource",
) -> dict[str, Any]:
    """Load an owned record and enforce its client/site boundary.

    Foreign records deliberately produce the same 404 response as missing
    records so URL tampering cannot be used to enumerate another client.
    """
    record = await collection.find_one({id_field: str(record_id)}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found")
    await assert_client_scope(
        user,
        record.get(client_field),
        site_id=record.get(site_field),
        operation=operation,
        request=request,
        mask_not_found=True,
    )
    return record
