"""Authoritative tenant-scoped labour-type configuration for ticket time.

``labour_types`` is a commercial configuration collection owned by one Nexus
platform tenant at a time.  It does not own any historical financial entries:
a time entry snapshots the selected type's safe label, code and rate at write
time, so later configuration changes cannot silently rewrite past billing
evidence.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import math
import re
import uuid

from fastapi import HTTPException

from app.database import db as default_db
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query


COLLECTION = "labour_types"
_INDEXED_DATABASE_IDS: set[int] = set()
_CODE_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9_-]{0,23}$")


def labour_type_tenant_id(value: Any) -> str:
    """Return the stable tenant partition for a labour-type operation.

    Labour types were introduced after the platform tenancy boundary, but a
    local installation may still contain early documents without a tenant
    marker.  ``platform_tenant_id`` gives this service the same compatibility
    rule as the rest of Nexus: only the documented local partition can see
    legacy unbound rows; an explicitly tenant-bound actor cannot.
    """
    return platform_tenant_id({"tenant_id": value})


def labour_type_tenant_query(tenant_id: Any, query: dict[str, Any] | None = None) -> dict[str, Any]:
    """Scope a labour-type query to exactly one Nexus tenant partition."""
    return tenant_scoped_query({"tenant_id": labour_type_tenant_id(tenant_id)}, query)


def _text(value: Any, field: str, *, maximum: int, required: bool = False) -> str:
    result = str(value or "").strip()
    if required and not result:
        raise HTTPException(status_code=422, detail=f"{field} is required")
    if len(result) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} must be {maximum} characters or fewer")
    return result


def _bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in {0, 1}:
        return bool(value)
    raise HTTPException(status_code=422, detail=f"{field} must be a boolean")


def _money(value: Any, field: str = "Hourly rate") -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a number") from None
    if not math.isfinite(amount) or amount < 0 or amount > 1_000_000:
        raise HTTPException(status_code=422, detail=f"{field} must be a finite non-negative value")
    return round(amount, 4)


def _sort_order(value: Any) -> int:
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Sort order must be a whole number") from None
    if result < 0 or result > 100_000:
        raise HTTPException(status_code=422, detail="Sort order must be between 0 and 100000")
    return result


def public_labour_type(record: dict[str, Any], *, include_inactive: bool = False) -> dict[str, Any]:
    """Expose only configuration data required by the operator experience."""
    response = {
        "id": str(record.get("id") or ""),
        "name": str(record.get("name") or "Labour type"),
        "code": str(record.get("code") or ""),
        "description": str(record.get("description") or ""),
        "hourly_rate": float(record.get("hourly_rate") or 0),
        "billable_default": bool(record.get("billable_default", True)),
        "sort_order": int(record.get("sort_order") or 0),
        "version": int(record.get("version") or 1),
    }
    if include_inactive:
        response["is_active"] = bool(record.get("is_active", True))
        response["updated_at"] = record.get("updated_at")
        response["updated_by"] = record.get("updated_by")
    return response


async def ensure_labour_type_indexes(*, database: Any = default_db) -> None:
    database_id = id(database)
    if database_id in _INDEXED_DATABASE_IDS:
        return
    collection = database.labour_types
    create_index = getattr(collection, "create_index", None)
    if not callable(create_index):
        return
    # Keep any original global indexes in place: deleting or replacing an
    # index is a migration operation and must not happen opportunistically at
    # runtime.  New names and tenant-leading keys enforce the intended shape
    # for all records created from this release onward.
    await create_index(
        [("tenant_id", 1), ("id", 1)],
        name="labour_type_tenant_id_unique",
        unique=True,
    )
    await create_index(
        [("tenant_id", 1), ("is_active", 1), ("sort_order", 1), ("name", 1)],
        name="labour_type_tenant_available",
    )
    _INDEXED_DATABASE_IDS.add(database_id)


async def resolve_labour_type(
    labour_type_id: Any,
    *,
    tenant_id: str,
    database: Any = default_db,
) -> dict[str, Any] | None:
    """Load an active labour type for a time-entry snapshot.

    A missing type means the technician's server-side default rate remains in
    force. An inactive or unknown explicit type is rejected: it must never
    silently fall back and create a commercial record the technician did not
    select.
    """
    identifier = str(labour_type_id or "").strip()
    if not identifier:
        return None
    record = await database.labour_types.find_one(
        labour_type_tenant_query(tenant_id, {"id": identifier, "is_active": True}),
        {"_id": 0},
    )
    if not record:
        raise HTTPException(status_code=422, detail="The selected labour type is unavailable")
    return record


def labour_snapshot(record: dict[str, Any] | None, *, fallback_rate: float, requested_billable: Any) -> dict[str, Any]:
    """Create immutable commercial values for one time entry.

    The browser cannot choose a rate. It may explicitly override the billable
    default, which is validated rather than truthiness-coerced.
    """
    if record is None:
        if requested_billable is None:
            billable = True
        else:
            billable = _bool(requested_billable, "Billable")
        return {
            "hourly_rate": _money(fallback_rate),
            "billable": billable,
            "extra": {
                "labour_type_id": None,
                "labour_type_name": "Technician default",
                "labour_type_code": "",
            },
        }

    if requested_billable is None:
        billable = _bool(record.get("billable_default", True), "Labour type billable default")
    else:
        billable = _bool(requested_billable, "Billable")
    return {
        "hourly_rate": _money(record.get("hourly_rate")),
        "billable": billable,
        "extra": {
            "labour_type_id": str(record.get("id") or ""),
            "labour_type_name": str(record.get("name") or "Labour type"),
            "labour_type_code": str(record.get("code") or ""),
            "labour_type_rate": _money(record.get("hourly_rate")),
        },
    }


def build_labour_type(
    payload: dict[str, Any],
    *,
    actor: dict[str, Any],
    tenant_id: str,
) -> dict[str, Any]:
    name = _text(payload.get("name"), "Name", maximum=100, required=True)
    code = _text(payload.get("code"), "Code", maximum=24).upper()
    if code and not _CODE_PATTERN.fullmatch(code):
        raise HTTPException(status_code=422, detail="Code may use only A-Z, 0-9, hyphens and underscores")
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "tenant_id": labour_type_tenant_id(tenant_id),
        "name": name,
        "code": code,
        "description": _text(payload.get("description"), "Description", maximum=300),
        "hourly_rate": _money(payload.get("hourly_rate")),
        "billable_default": _bool(payload.get("billable_default", True), "Billable default"),
        "is_active": _bool(payload.get("is_active", True), "Active"),
        "sort_order": _sort_order(payload.get("sort_order", 0)),
        "version": 1,
        "created_at": now,
        "created_by": actor.get("id"),
        "updated_at": now,
        "updated_by": actor.get("id"),
    }


def build_labour_type_patch(payload: dict[str, Any], *, actor: dict[str, Any]) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if "name" in payload:
        patch["name"] = _text(payload.get("name"), "Name", maximum=100, required=True)
    if "code" in payload:
        code = _text(payload.get("code"), "Code", maximum=24).upper()
        if code and not _CODE_PATTERN.fullmatch(code):
            raise HTTPException(status_code=422, detail="Code may use only A-Z, 0-9, hyphens and underscores")
        patch["code"] = code
    if "description" in payload:
        patch["description"] = _text(payload.get("description"), "Description", maximum=300)
    if "hourly_rate" in payload:
        patch["hourly_rate"] = _money(payload.get("hourly_rate"))
    if "billable_default" in payload:
        patch["billable_default"] = _bool(payload.get("billable_default"), "Billable default")
    if "is_active" in payload:
        patch["is_active"] = _bool(payload.get("is_active"), "Active")
    if "sort_order" in payload:
        patch["sort_order"] = _sort_order(payload.get("sort_order"))
    if not patch:
        raise HTTPException(status_code=422, detail="No editable labour-type fields were provided")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    patch["updated_by"] = actor.get("id")
    return patch
