"""Governed tenant-scoped labour-type configuration and safe ticket selection."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.labour_types import (
    build_labour_type,
    build_labour_type_patch,
    ensure_labour_type_indexes,
    labour_type_tenant_id,
    public_labour_type,
)
from app.services.scope_permissions import assert_global_scope, tenant_scoped_query


router = APIRouter()
_CONFIGURATION_ACTION = "platform.configuration.manage"


def _expected_version(payload: dict) -> int:
    try:
        value = int(payload.get("expected_version"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="expected_version is required") from None
    if value < 1:
        raise HTTPException(status_code=422, detail="expected_version must be at least 1")
    return value


@router.get("/labour-types/available")
async def list_available_labour_types(current_user: dict = Depends(get_current_user)):
    """Return active types to authorised ticket-time workflows.

    Labour types are tenant-owned MSP configuration rather than client records.
    Their safe selection fields are intentionally available to authenticated
    technicians within their own tenant; configuration changes remain
    separately globally authorised below.
    """
    await ensure_labour_type_indexes(database=db)
    records = await db.labour_types.find(
        tenant_scoped_query(current_user, {"is_active": True}), {"_id": 0}
    ).sort([("sort_order", 1), ("name", 1)]).to_list(250)
    return [public_labour_type(record) for record in records]


@router.get(
    "/labour-types",
    dependencies=[Depends(require_action(_CONFIGURATION_ACTION))],
)
async def list_labour_types(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="labour_type.list", request=request)
    await ensure_labour_type_indexes(database=db)
    records = await db.labour_types.find(tenant_scoped_query(current_user), {"_id": 0}).sort(
        [("is_active", -1), ("sort_order", 1), ("name", 1)]
    ).to_list(500)
    return [public_labour_type(record, include_inactive=True) for record in records]


@router.post(
    "/labour-types",
    dependencies=[Depends(require_action(_CONFIGURATION_ACTION))],
)
async def create_labour_type(payload: dict, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="labour_type.create", request=request)
    await ensure_labour_type_indexes(database=db)
    tenant_id = labour_type_tenant_id(current_user.get("tenant_id"))
    record = build_labour_type(payload, actor=current_user, tenant_id=tenant_id)
    await db.labour_types.insert_one(record)
    await log_activity(
        current_user,
        "created",
        "labour_type",
        record["id"],
        record["name"],
        "Created a labour type",
        metadata={
            "tenant_id": tenant_id,
            "code": record["code"],
            "billable_default": record["billable_default"],
        },
    )
    return public_labour_type(record, include_inactive=True)


@router.put(
    "/labour-types/{labour_type_id}",
    dependencies=[Depends(require_action(_CONFIGURATION_ACTION))],
)
async def update_labour_type(labour_type_id: str, payload: dict, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="labour_type.update", request=request)
    expected_version = _expected_version(payload)
    record_query = tenant_scoped_query(current_user, {"id": labour_type_id})
    existing = await db.labour_types.find_one(record_query, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Labour type not found")
    patch = build_labour_type_patch(payload, actor=current_user)
    patch["version"] = expected_version + 1
    result = await db.labour_types.update_one(
        tenant_scoped_query(current_user, {"id": labour_type_id, "version": expected_version}),
        {"$set": patch},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This labour type changed elsewhere. Refresh and review before saving.")
    updated = {**existing, **patch}
    await log_activity(
        current_user,
        "updated",
        "labour_type",
        labour_type_id,
        updated["name"],
        "Updated a labour type",
        metadata={"changed_fields": sorted(key for key in patch if key not in {"updated_at", "updated_by", "version"})},
    )
    return public_labour_type(updated, include_inactive=True)


@router.delete(
    "/labour-types/{labour_type_id}",
    dependencies=[Depends(require_action(_CONFIGURATION_ACTION))],
)
async def archive_labour_type(labour_type_id: str, expected_version: int, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="labour_type.archive", request=request)
    record_query = tenant_scoped_query(current_user, {"id": labour_type_id})
    existing = await db.labour_types.find_one(record_query, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Labour type not found")
    if int(existing.get("version") or 1) != expected_version:
        raise HTTPException(status_code=409, detail="This labour type changed elsewhere. Refresh and review before archiving.")
    if not existing.get("is_active", True):
        return public_labour_type(existing, include_inactive=True)
    patch = {
        "is_active": False,
        "version": expected_version + 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("id"),
    }
    result = await db.labour_types.update_one(
        tenant_scoped_query(current_user, {"id": labour_type_id, "version": expected_version}),
        {"$set": patch},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This labour type changed elsewhere. Refresh and review before archiving.")
    updated = {**existing, **patch}
    await log_activity(current_user, "archived", "labour_type", labour_type_id, updated["name"], "Archived a labour type")
    return public_labour_type(updated, include_inactive=True)
