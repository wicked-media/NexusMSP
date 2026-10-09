from fastapi import APIRouter, HTTPException, Depends, Body
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_client_scope, assert_global_scope, assert_tenant_record_scope, platform_tenant_id, scoped_query, tenant_scoped_query
from app.models import *

router = APIRouter()


_DEVICE_EVIDENCE_COLLECTIONS = (
    "tickets",
    "alerts",
    "device_events",
    "device_performance",
    "device_software",
    "device_patches",
    "device_network",
    "device_disks",
    "device_chat",
    "device_state_log",
    "device_state_snapshots",
    "device_diagnoses",
    "device_metrics",
    "device_services",
    "device_winupdates",
    "device_health",
    "device_health_history",
    "remote_sessions",
    "remote_session_records",
    "rustdesk_sessions",
    "maintenance_windows",
    "maintenance_window_runs",
    "assets",
)


from app.services.time_utils import now_iso as _now


def _actor_name(current_user: dict) -> str:
    return current_user.get("name") or current_user.get("email") or "Technician"


async def _device_evidence_counts(current_user: dict, device_id: str) -> dict[str, int]:
    """Count retained endpoint evidence without changing any historical link.

    A duplicate merge deliberately keeps source evidence immutable.  These
    counts are also the purge guard: a device with operational evidence must
    be archived, never silently removed from the audit trail.
    """
    counts: dict[str, int] = {}
    for collection_name in _DEVICE_EVIDENCE_COLLECTIONS:
        collection = getattr(db, collection_name, None)
        if collection is None:
            continue
        if collection_name == "tickets":
            filter_query = {"$or": [{"device_id": device_id}, {"device_ids": device_id}]}
        elif collection_name == "maintenance_windows":
            filter_query = {"$or": [{"device_id": device_id}, {"device_ids": device_id}]}
        else:
            filter_query = {"device_id": device_id}
        counts[collection_name] = int(await collection.count_documents(tenant_scoped_query(current_user, filter_query)))
    return counts


def _merge_compatibility(source: dict, survivor: dict) -> None:
    if source.get("id") == survivor.get("id"):
        raise HTTPException(status_code=422, detail="Choose a different managed asset as the surviving record")
    if source.get("client_id") != survivor.get("client_id"):
        raise HTTPException(status_code=409, detail="Only assets from the same client can be merged")
    if survivor.get("archived"):
        raise HTTPException(status_code=409, detail="Restore the surviving asset before merging into it")
    if source.get("merged_into_id") and source.get("merged_into_id") != survivor.get("id"):
        raise HTTPException(status_code=409, detail="This asset was already merged into a different record")
    source_agent = str(source.get("nexus_agent_id") or "").strip()
    survivor_agent = str(survivor.get("nexus_agent_id") or "").strip()
    if source_agent and source_agent != survivor_agent:
        raise HTTPException(
            status_code=409,
            detail="Keep the Nexus Agent-linked asset as the surviving record; merging it into another identity would sever live endpoint provenance",
        )


async def _merge_plan(current_user: dict, source: dict, survivor: dict) -> dict:
    evidence = await _device_evidence_counts(current_user, str(source.get("id") or ""))
    source_assets = await db.assets.find(tenant_scoped_query(current_user, {"device_id": source.get("id")}), {"_id": 0, "id": 1, "name": 1}).to_list(20)
    survivor_assets = await db.assets.find(tenant_scoped_query(current_user, {"device_id": survivor.get("id")}), {"_id": 0, "id": 1, "name": 1}).to_list(20)
    return {
        "source": {"id": source.get("id"), "name": source.get("name"), "status": source.get("status")},
        "survivor": {"id": survivor.get("id"), "name": survivor.get("name"), "status": survivor.get("status")},
        "evidence_counts": evidence,
        "source_inventory_assets": source_assets,
        "survivor_inventory_assets": survivor_assets,
        "history_policy": "Retain all ticket, alert, session, telemetry and inventory links on their original asset for audit provenance.",
        "result": "Archive the duplicate, link it to the surviving asset, and keep its evidence discoverable from the audit trail.",
    }


async def _validate_inventory_device_link(
    current_user: dict,
    *,
    device_id: str | None,
    client_id: str | None,
    asset_id: str | None = None,
    operation: str,
) -> dict | None:
    """Keep canonical inventory links inside the same client boundary.

    ``assets.device_id`` is a stable Nexus relationship, so allowing a form to
    set it without re-checking the endpoint would be a tenant-scope bypass and
    could silently create a duplicate inventory identity.
    """
    resolved_device_id = str(device_id or "").strip()
    if not resolved_device_id:
        return None
    device = await assert_tenant_record_scope(
        current_user,
        db.devices,
        resolved_device_id,
        operation=operation,
        resource_name="Managed asset",
    )
    if not client_id or str(device.get("client_id") or "") != str(client_id):
        raise HTTPException(
            status_code=409,
            detail="An inventory asset linked to an endpoint must use that endpoint's client ownership.",
        )
    linked_assets = await db.assets.find(tenant_scoped_query(current_user, {"device_id": resolved_device_id}), {"_id": 0, "id": 1}).to_list(10)
    if any(str(asset.get("id") or "") != str(asset_id or "") for asset in linked_assets):
        raise HTTPException(status_code=409, detail="This managed asset is already linked to another inventory record")
    return device


def _asset_delete_blocker(asset: dict) -> str | None:
    """Canonical inventory evidence is retained; only empty manual records purge."""
    if asset.get("device_id"):
        return "This inventory record is linked to a managed asset. Use the lifecycle workflow to retain its endpoint evidence."
    if asset.get("contract_id") or asset.get("contract_line_item_id") or asset.get("billing_lock"):
        return "This inventory record is linked to billing or a contract. Remove the governed relationship before deletion."
    return None

# ============== DEVICES ENDPOINTS ==============

@router.get("/devices", response_model=List[Device])
async def get_devices(
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    include_archived: bool = False,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if client_id:
        query["client_id"] = client_id
    # Retired records remain available by direct URL, audit, and the explicit
    # archive view, but must never inflate an active fleet or dashboard count.
    if not include_archived and status != "archived":
        query["archived"] = {"$ne": True}
    
    devices = await db.devices.find(tenant_scoped_query(current_user, scoped_query(current_user, query)), {"_id": 0}).to_list(1000)
    for d in devices:
        for field in ['created_at', 'last_seen']:
            if isinstance(d.get(field), str):
                d[field] = datetime.fromisoformat(d[field])
    return devices

# Static path routes - MUST be defined before {device_id} dynamic route
@router.get("/devices/stale")
async def get_stale_devices_route(hours: int = 24, current_user: dict = Depends(get_current_user)):
    """Get devices that haven't reported in within the specified hours"""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    stale = await db.devices.find(tenant_scoped_query(current_user, scoped_query(current_user, {
        "$and": [
            {"archived": {"$ne": True}},
            {"$or": [
                {"last_heartbeat": {"$lt": cutoff}},
                {"last_heartbeat": {"$exists": False}},
            ]},
        ]
    })), {"_id": 0}).to_list(500)
    return stale

@router.get("/devices/{device_id}")
async def get_device(device_id: str, current_user: dict = Depends(get_current_user)):
    return await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.read", resource_name="Device",
    )

@router.post("/devices", response_model=Device)
async def create_device(device_data: DeviceCreate, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, device_data.client_id, operation="device.create")
    client = await db.clients.find_one(tenant_scoped_query(current_user, {"id": device_data.client_id}), {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client_name = client['name'] if client else None
    
    device = Device(**device_data.model_dump(), client_name=client_name)
    doc = device.model_dump()
    doc["tenant_id"] = platform_tenant_id(current_user)
    doc['created_at'] = doc['created_at'].isoformat()
    doc['last_seen'] = doc['last_seen'].isoformat()
    await db.devices.insert_one(doc)
    await db.clients.update_one(tenant_scoped_query(current_user, {"id": device_data.client_id}), {"$inc": {"device_count": 1}})
    await log_activity(current_user, "created", "device", device.id, device.name, f"Added {device.device_type} '{device.name}' for {client_name}", metadata={"device_type": device.device_type, "client_name": client_name})
    return device

@router.put("/devices/{device_id}")
async def update_device(device_id: str, device_data: dict, current_user: dict = Depends(get_current_user)):
    old_device = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.update", resource_name="Device",
    )
    # This route is deliberately limited to technician-maintained asset
    # identity fields. Agent telemetry and lifecycle state have dedicated,
    # audited paths; allowing arbitrary $set values here would let a generic
    # edit form bypass archive/merge retention rules or sever an agent link.
    editable_fields = {
        "name", "client_id", "device_type", "os", "os_version",
        "ip_address", "serial_number", "mac_address", "manufacturer",
        "model", "processor", "ram_gb", "storage_total_gb", "location",
        "assigned_user", "tags", "notes",
    }
    requested_updates = dict(device_data or {})
    protected_fields = sorted(set(requested_updates) - editable_fields)
    if protected_fields:
        raise HTTPException(
            status_code=422,
            detail=f"These device fields are system-managed and cannot be changed here: {', '.join(protected_fields)}",
        )
    updates = {key: value for key, value in requested_updates.items() if key in editable_fields}
    if not updates:
        raise HTTPException(status_code=422, detail="Provide at least one editable device field")
    if "client_id" in updates:
        new_client_id = updates.get("client_id") or None
        await assert_client_scope(current_user, new_client_id, operation="device.move")
        if new_client_id:
            new_client = await db.clients.find_one(tenant_scoped_query(current_user, {"id": new_client_id}), {"_id": 0, "id": 1, "name": 1})
            if not new_client:
                raise HTTPException(status_code=404, detail="Client not found")
            updates["client_id"] = new_client_id
            updates["client_name"] = new_client.get("name")
        else:
            updates["client_id"] = None
            updates["client_name"] = None
        old_client_id = old_device.get("client_id")
        if old_client_id != new_client_id:
            if old_client_id:
                await db.clients.update_one(tenant_scoped_query(current_user, {"id": old_client_id}), {"$inc": {"device_count": -1}})
            if new_client_id:
                await db.clients.update_one(tenant_scoped_query(current_user, {"id": new_client_id}), {"$inc": {"device_count": 1}})
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.devices.update_one(tenant_scoped_query(current_user, {"id": device_id}), {"$set": updates})
    if result.matched_count != 1:
        raise HTTPException(status_code=409, detail="The managed asset changed before its identity could be saved. Refresh and try again.")
    if old_device:
        change_dict = {}
        for k, v in updates.items():
            if k == "updated_at":
                continue
            if old_device.get(k) != v:
                change_dict[k] = {"old": str(old_device.get(k)), "new": str(v)}
        if change_dict:
            await log_activity(current_user, "updated", "device", device_id, old_device.get("name", ""), f"Updated device fields: {', '.join(change_dict.keys())}", changes=change_dict)
    return {"message": "Device updated"}


@router.put(
    "/devices/{device_id}/patch-ring",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def assign_device_patch_ring(
    device_id: str,
    data: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Assign an asset to a confirmed, tenant-owned patch rollout group.

    A rollout assignment is configuration intent, not patch execution.  It is
    deliberately separate from the generic device editor because changing a
    ring can affect the next provider-backed deployment once that capability
    exists.  The current policy register remains the canonical source of the
    allowed ring names; ``devices.patch_ring`` is only the per-device
    assignment projection.
    """
    await assert_global_scope(current_user, operation="device.patch_ring.assign")
    device = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.patch_ring.assign", resource_name="Device",
    )
    payload = data if isinstance(data, dict) else {}
    requested_ring = str(payload.get("patch_ring") or "").strip()
    reason = str(payload.get("reason") or "").strip()
    if not 3 <= len(reason) <= 1000:
        raise HTTPException(status_code=422, detail="Provide an assignment reason between 3 and 1000 characters")

    policy = None
    if requested_ring:
        policy = await db.patch_compliance.find_one(
            tenant_scoped_query(current_user, {
                "ring": requested_ring,
                "source": "manual",
                "confirmed_at": {"$exists": True},
            }),
            {"_id": 0},
        )
        if not policy:
            raise HTTPException(status_code=404, detail="Choose a confirmed patch rollout group from this tenant's policy register")
        os_filter = str(policy.get("os_filter") or "All operating systems").strip().lower()
        device_os = str(device.get("os") or device.get("os_name") or "").strip().lower()
        if os_filter not in {"", "all operating systems", "all"} and os_filter not in device_os:
            raise HTTPException(
                status_code=422,
                detail=f"The {requested_ring} rollout group is limited to {policy.get('os_filter')}; this asset reports {device.get('os') or 'an unknown operating system'}.",
            )

    previous_ring = str(device.get("patch_ring") or "").strip()
    if previous_ring == requested_ring:
        return {
            "message": "Patch rollout group is already assigned",
            "patch_ring": requested_ring or None,
            "execution_state": "not_deployed",
        }

    assigned_at = _now()
    update = {
        "patch_ring": requested_ring or None,
        "patch_ring_assigned_at": assigned_at,
        "patch_ring_assigned_by": _actor_name(current_user),
        "patch_ring_assignment_reason": reason,
        "updated_at": assigned_at,
    }
    result = await db.devices.update_one(
        tenant_scoped_query(current_user, {"id": device_id}),
        {"$set": update},
    )
    if result.matched_count != 1:
        # Do not report a configuration change when the device disappeared or
        # moved outside the caller's tenant between authorisation and write.
        raise HTTPException(status_code=409, detail="The managed asset changed before its rollout assignment could be saved. Refresh and try again.")
    target_label = requested_ring or "Unassigned"
    await log_activity(
        current_user,
        "updated",
        "device_patch_ring",
        device_id,
        device.get("name", ""),
        f"Changed patch rollout group from {previous_ring or 'Unassigned'} to {target_label}.",
        changes={"patch_ring": {"old": previous_ring or "Unassigned", "new": target_label}},
        metadata={
            "device_id": device_id,
            "client_id": device.get("client_id"),
            "site_id": device.get("site_id"),
            "tenant_id": device.get("tenant_id"),
            "previous_ring": previous_ring or None,
            "patch_ring": requested_ring or None,
            "policy_id": policy.get("id") if policy else None,
            "reason": reason,
            "execution_state": "not_deployed",
        },
    )
    return {
        "message": "Patch rollout group updated. No patch deployment was queued.",
        "patch_ring": requested_ring or None,
        "execution_state": "not_deployed",
    }

@router.delete(
    "/devices/{device_id}",
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def delete_device(device_id: str, current_user: dict = Depends(get_current_user), data: dict = Body(default={})):
    """Permanently remove only an erroneous, unlinked manual asset record.

    Endpoint history is evidence.  Normal retirement uses the archive route;
    this narrow purge is retained for accidental/manual duplicates that never
    acquired an Agent identity or linked operational records.
    """
    device = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.delete", resource_name="Device",
    )
    if device.get("nexus_agent_id"):
        raise HTTPException(
            status_code=409,
            detail="This is a Nexus Agent-linked asset. Archive it to retain the trusted endpoint identity and audit evidence.",
        )
    evidence_counts = await _device_evidence_counts(current_user, device_id)
    retained = {name: count for name, count in evidence_counts.items() if count}
    if retained:
        evidence_label = ", ".join(f"{count} {name.replace('_', ' ')}" for name, count in retained.items())
        raise HTTPException(
            status_code=409,
            detail=f"This asset has retained evidence ({evidence_label}). Archive it instead of permanently deleting it.",
        )
    reason = str(data.get("reason") or "").strip() if isinstance(data, dict) else ""
    if not 3 <= len(reason) <= 1000:
        raise HTTPException(status_code=422, detail="Provide a deletion reason between 3 and 1000 characters")
    if device.get("client_id"):
        await db.clients.update_one(tenant_scoped_query(current_user, {"id": device["client_id"], "device_count": {"$gt": 0}}), {"$inc": {"device_count": -1}})
    await log_activity(
        current_user, "deleted", "device", device_id, device.get("name", ""),
        f"Permanently deleted empty manual asset '{device.get('name', '')}'",
        metadata={"purge": True, "reason": reason, "client_id": device.get("client_id"), "site_id": device.get("site_id"), "tenant_id": device.get("tenant_id"), "device_id": device_id, "method": "manual_asset_purge", "location": device.get("location"), "source": "device_record"},
    )
    result = await db.devices.delete_one(tenant_scoped_query(current_user, {"id": device_id}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device deleted"}


@router.post(
    "/devices/{device_id}/archive",
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def archive_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Retire a managed asset while preserving its endpoint identity and evidence."""
    device = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.archive", resource_name="Device",
    )
    if device.get("archived"):
        return {"message": "Device is already archived", "device_id": device_id, "already_archived": True}

    reason = str((data or {}).get("reason") or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Record a short archive reason so the next technician understands the decision")

    now = _now()
    update = {
        "archived": True,
        "archived_at": now,
        "archived_by": current_user.get("id"),
        "archived_by_name": _actor_name(current_user),
        "archive_reason": reason,
        "archived_status_before": device.get("status"),
        "lifecycle_state": "archived",
        "status": "archived",
        "updated_at": now,
    }
    result = await db.devices.update_one(tenant_scoped_query(current_user, {"id": device_id, "archived": {"$ne": True}}), {"$set": update})
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This asset changed before it could be archived. Refresh and try again.")
    if device.get("client_id"):
        await db.clients.update_one(tenant_scoped_query(current_user, {"id": device["client_id"], "device_count": {"$gt": 0}}), {"$inc": {"device_count": -1}})
    await log_activity(
        current_user, "archived", "device", device_id, device.get("name", ""),
        f"Archived managed asset '{device.get('name', '')}'",
        metadata={"reason": reason, "nexus_agent_id": device.get("nexus_agent_id"), "client_id": device.get("client_id"), "site_id": device.get("site_id"), "tenant_id": device.get("tenant_id"), "device_id": device_id, "method": "archive", "location": device.get("location"), "source": "device_record"},
    )
    return {"message": "Managed asset archived", "device_id": device_id, "archived_at": now}


@router.post(
    "/devices/{device_id}/restore",
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def restore_device(device_id: str, current_user: dict = Depends(get_current_user)):
    """Return an archived, non-merged asset to the active fleet as offline.

    Restore never asserts the endpoint is online: the next trusted Agent or
    remote provider check-in establishes that state independently.
    """
    device = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.restore", resource_name="Device",
    )
    if not device.get("archived"):
        raise HTTPException(status_code=409, detail="This managed asset is already active")
    if device.get("merged_into_id"):
        raise HTTPException(status_code=409, detail="This asset was merged into another record and cannot be restored independently")

    now = _now()
    result = await db.devices.update_one(
        tenant_scoped_query(current_user, {"id": device_id, "archived": True}),
        {
            "$set": {
                "archived": False,
                "lifecycle_state": "active",
                "status": "offline",
                "restored_at": now,
                "restored_by": current_user.get("id"),
                "restored_by_name": _actor_name(current_user),
                "updated_at": now,
            },
            "$unset": {
                "archived_at": "",
                "archived_by": "",
                "archived_by_name": "",
                "archive_reason": "",
                "archived_status_before": "",
            },
        },
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This asset changed before it could be restored. Refresh and try again.")
    if device.get("client_id"):
        await db.clients.update_one(tenant_scoped_query(current_user, {"id": device["client_id"]}), {"$inc": {"device_count": 1}})
    await log_activity(
        current_user, "restored", "device", device_id, device.get("name", ""),
        f"Restored managed asset '{device.get('name', '')}' to the active fleet",
        metadata={"restored_status": "offline"},
    )
    return {"message": "Managed asset restored. Await a trusted check-in before treating it as online.", "device_id": device_id}


@router.get("/devices/{device_id}/merge-candidates")
async def get_device_merge_candidates(device_id: str, current_user: dict = Depends(get_current_user)):
    source = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.merge.candidates", resource_name="Device",
    )
    if source.get("archived"):
        return {"candidates": []}
    query = {"client_id": source.get("client_id"), "id": {"$ne": device_id}, "archived": {"$ne": True}}
    candidates = await db.devices.find(tenant_scoped_query(current_user, scoped_query(current_user, query)), {"_id": 0}).sort("name", 1).to_list(100)
    source_agent = str(source.get("nexus_agent_id") or "").strip()
    visible = []
    for candidate in candidates:
        if candidate.get("merged_into_id"):
            continue
        candidate_agent = str(candidate.get("nexus_agent_id") or "").strip()
        if source_agent and source_agent != candidate_agent:
            continue
        visible.append({
            "id": candidate.get("id"),
            "name": candidate.get("name") or "Unnamed asset",
            "status": candidate.get("status") or "unknown",
            "serial_number": candidate.get("serial_number"),
            "manufacturer": candidate.get("manufacturer"),
            "model": candidate.get("model"),
            "nexus_agent_id": candidate.get("nexus_agent_id"),
        })
    return {"candidates": visible}


@router.get("/devices/{device_id}/merge-preview")
async def get_device_merge_preview(
    device_id: str,
    survivor_id: str,
    current_user: dict = Depends(get_current_user),
):
    source = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.merge.preview", resource_name="Device",
    )
    survivor = await assert_tenant_record_scope(
        current_user, db.devices, survivor_id,
        operation="device.merge.preview", resource_name="Device",
    )
    _merge_compatibility(source, survivor)
    return await _merge_plan(current_user, source, survivor)


@router.post(
    "/devices/{device_id}/merge",
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def merge_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Consolidate a duplicate record without rewriting evidence history."""
    survivor_id = str((data or {}).get("survivor_id") or "").strip()
    if not survivor_id:
        raise HTTPException(status_code=422, detail="Choose the managed asset that should remain active")
    reason = str((data or {}).get("reason") or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Record why these assets are duplicates before merging them")

    source = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.merge", resource_name="Device",
    )
    survivor = await assert_tenant_record_scope(
        current_user, db.devices, survivor_id,
        operation="device.merge", resource_name="Device",
    )
    _merge_compatibility(source, survivor)
    if source.get("merged_into_id") == survivor_id:
        return {
            "message": "This duplicate was already merged into the selected asset",
            "survivor_id": survivor_id,
            "source_id": device_id,
            "already_merged": True,
        }
    if source.get("archived"):
        raise HTTPException(status_code=409, detail="Restore this asset before merging it, or review its existing archive history")

    plan = await _merge_plan(current_user, source, survivor)
    now = _now()
    survivor_result = await db.devices.update_one(
        tenant_scoped_query(current_user, {"id": survivor_id, "archived": {"$ne": True}}),
        {"$addToSet": {"merged_device_ids": device_id}, "$set": {"updated_at": now}},
    )
    if not survivor_result.matched_count:
        raise HTTPException(status_code=409, detail="The surviving asset changed before this merge could begin. Refresh and try again.")
    source_result = await db.devices.update_one(
        tenant_scoped_query(current_user, {"id": device_id, "archived": {"$ne": True}, "merged_into_id": {"$in": [None, ""]}}),
        {"$set": {
            "archived": True,
            "archived_at": now,
            "archived_by": current_user.get("id"),
            "archived_by_name": _actor_name(current_user),
            "archive_reason": f"Merged duplicate into {survivor.get('name') or survivor_id}: {reason}",
            "archived_status_before": source.get("status"),
            "lifecycle_state": "merged",
            "status": "archived",
            "merged_into_id": survivor_id,
            "merged_at": now,
            "merged_by": current_user.get("id"),
            "updated_at": now,
        }},
    )
    if not source_result.matched_count:
        # Compensate the survivor-side alias if a concurrent change won the
        # source update. Historical records are otherwise untouched.
        await db.devices.update_one(tenant_scoped_query(current_user, {"id": survivor_id}), {"$pull": {"merged_device_ids": device_id}})
        raise HTTPException(status_code=409, detail="The duplicate asset changed before it could be merged. Refresh and try again.")
    if source.get("client_id"):
        await db.clients.update_one(tenant_scoped_query(current_user, {"id": source["client_id"], "device_count": {"$gt": 0}}), {"$inc": {"device_count": -1}})
    await log_activity(
        current_user, "merged", "device", device_id, source.get("name", ""),
        f"Merged duplicate managed asset into '{survivor.get('name', '')}'",
        metadata={"survivor_id": survivor_id, "reason": reason, "evidence_counts": plan["evidence_counts"]},
    )
    await log_activity(
        current_user, "merge_received", "device", survivor_id, survivor.get("name", ""),
        f"Received duplicate managed asset '{source.get('name', '')}'",
        metadata={"source_id": device_id, "reason": reason},
    )
    return {
        "message": "Duplicate managed asset merged. The source is archived and all historical evidence is retained.",
        "survivor_id": survivor_id,
        "source_id": device_id,
        "evidence_counts": plan["evidence_counts"],
        "already_merged": False,
    }

@router.get("/devices/{device_id}/detail")
async def get_device_detail(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.detail.read", resource_name="Device",
    )
    software = await db.device_software.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).to_list(500)
    patches = await db.device_patches.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).sort("installed_date", -1).to_list(100)
    events = await db.device_events.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).sort("timestamp", -1).to_list(100)
    performance = await db.device_performance.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).sort("timestamp", -1).to_list(288)
    alerts = await db.alerts.find(
        tenant_scoped_query(current_user, {
            "device_id": device_id,
            "$or": [
                {"status": {"$in": ["active", "open", "triggered"]}},
                {"status": {"$exists": False}},
            ],
        }),
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    tickets = await db.tickets.find(
        tenant_scoped_query(current_user, {"$or": [{"device_id": device_id}, {"device_ids": device_id}]}), {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    network_adapters = await db.device_network.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).to_list(20)
    remote_sessions = await db.remote_sessions.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).sort("started_at", -1).to_list(50)
    activity_logs = await db.activity_logs.find(tenant_scoped_query(current_user, {"entity_type": "device", "entity_id": device_id}), {"_id": 0}).sort("created_at", -1).to_list(100)
    # Keep the hero metric and the detailed alert list on one source of truth.
    # Stored counts can drift after an alert is resolved, so derive the count
    # from the access-scoped active records returned with this response.
    device["alerts_count"] = len(alerts)
    return {
        "device": device,
        "software": software,
        "patches": patches,
        "events": events,
        "performance": performance,
        "alerts": alerts,
        "tickets": tickets,
        "network_adapters": network_adapters,
        "remote_sessions": remote_sessions,
        "activity_logs": activity_logs,
    }

@router.get("/devices/{device_id}/software")
async def get_device_software(device_id: str, current_user: dict = Depends(get_current_user)):
    await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.software.read", resource_name="Device",
    )
    software = await db.device_software.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).to_list(500)
    return software

@router.get("/devices/{device_id}/patches")
async def get_device_patches(device_id: str, current_user: dict = Depends(get_current_user)):
    await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.patches.read", resource_name="Device",
    )
    patches = await db.device_patches.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).sort("installed_date", -1).to_list(200)
    return patches

@router.get("/devices/{device_id}/events")
async def get_device_events(device_id: str, current_user: dict = Depends(get_current_user)):
    await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.events.read", resource_name="Device",
    )
    events = await db.device_events.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).sort("timestamp", -1).to_list(200)
    return events

@router.get("/devices/{device_id}/performance")
async def get_device_performance(device_id: str, current_user: dict = Depends(get_current_user)):
    await assert_tenant_record_scope(
        current_user, db.devices, device_id,
        operation="device.performance.read", resource_name="Device",
    )
    performance = await db.device_performance.find(tenant_scoped_query(current_user, {"device_id": device_id}), {"_id": 0}).sort("timestamp", -1).to_list(288)
    return performance

@router.get("/devices/stats/summary")
async def get_devices_stats(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(scoped_query(current_user, {"archived": {"$ne": True}}), {"_id": 0}).to_list(10000)
    total = len(devices)
    online = len([d for d in devices if d.get("status") == "online"])
    offline = len([d for d in devices if d.get("status") == "offline"])
    warning = len([d for d in devices if d.get("status") == "warning"])
    servers = len([d for d in devices if d.get("device_type") == "server"])
    workstations = len([d for d in devices if d.get("device_type") == "workstation"])
    laptops = len([d for d in devices if d.get("device_type") == "laptop"])
    needs_patching = len([d for d in devices if (d.get("pending_patches") or 0) > 0])
    avg_cpu = sum(d.get("cpu_usage", 0) for d in devices) / max(total, 1)
    avg_ram = sum(d.get("memory_usage", 0) for d in devices) / max(total, 1)
    avg_disk = sum(d.get("disk_usage", 0) for d in devices) / max(total, 1)
    return {
        "total": total, "online": online, "offline": offline, "warning": warning,
        "servers": servers, "workstations": workstations, "laptops": laptops,
        "needs_patching": needs_patching,
        "avg_cpu": round(avg_cpu, 1), "avg_ram": round(avg_ram, 1), "avg_disk": round(avg_disk, 1)
    }

# ============== RMM AGENT HEARTBEAT / REAL-TIME REPORTING ==============

@router.post("/devices/{device_id}/heartbeat")
async def device_heartbeat(device_id: str, data: dict):
    """RMM Agent heartbeat endpoint. Updates device info in real-time.
    Called periodically by the remote agent installed on client devices."""
    raise HTTPException(
        status_code=410,
        detail="Legacy device heartbeat retired. Enrol this endpoint with Nexus Agent and use /api/nexus-agent/heartbeat.",
    )
    device = await db.devices.find_one({"id": device_id})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "last_seen": now,
        "status": "online",
        "last_heartbeat": now,
    }
    
    # System info - map to model field names
    if "hostname" in data:
        update["name"] = data["hostname"]
    if "os_name" in data:
        update["os"] = data["os_name"]
    if "os_version" in data:
        update["os_version"] = data["os_version"]
    if "os_build" in data:
        update["os_build"] = data["os_build"]
    if "architecture" in data:
        update["architecture"] = data["architecture"]
    if "domain" in data:
        update["domain"] = data["domain"]
    if "serial_number" in data:
        update["serial_number"] = data["serial_number"]
    if "manufacturer" in data:
        update["manufacturer"] = data["manufacturer"]
    if "model" in data:
        update["model"] = data["model"]
    if "bios_version" in data:
        update["bios_version"] = data["bios_version"]
    
    # Performance metrics
    if "cpu_usage" in data:
        update["cpu_usage"] = float(data["cpu_usage"])
    if "memory_usage" in data:
        update["memory_usage"] = float(data["memory_usage"])
    if "disk_usage" in data:
        update["disk_usage"] = float(data["disk_usage"])
    if "cpu_temp" in data:
        update["cpu_temp"] = float(data["cpu_temp"])
    
    # Hardware details - map to model fields
    if "total_ram_gb" in data:
        update["ram_gb"] = float(data["total_ram_gb"])
    if "cpu_name" in data:
        update["processor"] = data["cpu_name"]
    if "cpu_cores" in data:
        update["processor_cores"] = int(data["cpu_cores"])
    if "total_disk_gb" in data:
        update["storage_total_gb"] = float(data["total_disk_gb"])
    if "free_disk_gb" in data:
        update["storage_used_gb"] = round(float(data.get("total_disk_gb", 0)) - float(data["free_disk_gb"]), 1)
    
    # Network
    if "ip_address" in data:
        update["ip_address"] = data["ip_address"]
    if "mac_address" in data:
        update["mac_address"] = data["mac_address"]
    if "public_ip" in data:
        update["public_ip"] = data["public_ip"]
    
    # Uptime
    if "uptime_seconds" in data:
        secs = int(data["uptime_seconds"])
        update["uptime_hours"] = round(secs / 3600, 1)
        days = secs // 86400
        hours = (secs % 86400) // 3600
        update["uptime_display"] = f"{days}d {hours}h"
    
    # Logged-in user
    if "logged_in_user" in data:
        update["last_logged_in_user"] = data["logged_in_user"]
    
    # Antivirus / security
    if "antivirus_status" in data:
        update["antivirus_status"] = data["antivirus_status"]
    if "antivirus_name" in data:
        update["antivirus"] = data["antivirus_name"]
    if "firewall_enabled" in data:
        update["firewall_enabled"] = data["firewall_enabled"]
    if "bitlocker_enabled" in data:
        update["bitlocker_enabled"] = data["bitlocker_enabled"]
    
    # Pending updates
    if "pending_patches" in data:
        update["pending_patches"] = int(data["pending_patches"])
    if "last_patch_date" in data:
        update["last_patch_date"] = data["last_patch_date"]
    
    # Installed software count
    if "installed_software_count" in data:
        update["installed_software_count"] = int(data["installed_software_count"])
    
    await db.devices.update_one({"id": device_id}, {"$set": update})
    
    # Store performance snapshot
    perf_entry = {
        "id": str(uuid.uuid4()),
        "device_id": device_id,
        "cpu_usage": data.get("cpu_usage", 0),
        "memory_usage": data.get("memory_usage", 0),
        "disk_usage": data.get("disk_usage", 0),
        "timestamp": now,
    }
    await db.device_performance.insert_one(perf_entry)
    
    # Check for warning thresholds
    status = "online"
    if float(data.get("cpu_usage", 0)) > 90 or float(data.get("memory_usage", 0)) > 90 or float(data.get("disk_usage", 0)) > 95:
        status = "warning"
        update["status"] = "warning"
        await db.devices.update_one({"id": device_id}, {"$set": {"status": "warning"}})
    
    return {"status": "ok", "device_status": status, "next_heartbeat_seconds": 300}

@router.post("/devices/heartbeat/bulk")
async def bulk_device_heartbeat(data: dict):
    """Bulk heartbeat for multiple devices from a single RMM server"""
    raise HTTPException(
        status_code=410,
        detail="Legacy bulk heartbeat retired. Each endpoint must use its own authenticated Nexus Agent identity.",
    )
    devices = data.get("devices", [])
    results = []
    for d in devices:
        device_id = d.get("device_id")
        if not device_id:
            continue
        device = await db.devices.find_one({"id": device_id})
        if not device:
            results.append({"device_id": device_id, "status": "not_found"})
            continue
        now = datetime.now(timezone.utc).isoformat()
        update = {"last_seen": now, "status": "online", "last_heartbeat": now}
        for key in ["cpu_usage", "memory_usage", "disk_usage", "ip_address", "logged_in_user", "uptime_seconds", "os_name", "hostname"]:
            if key in d:
                update[key] = d[key]
        await db.devices.update_one({"id": device_id}, {"$set": update})
        results.append({"device_id": device_id, "status": "ok"})
    return {"processed": len(results), "results": results}


# ============== ASSETS ENDPOINTS ==============

@router.get("/assets", response_model=List[Asset])
async def get_assets(
    asset_type: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if asset_type:
        query["asset_type"] = asset_type
    if client_id:
        query["client_id"] = client_id
    
    assets = await db.assets.find(tenant_scoped_query(current_user, scoped_query(current_user, query)), {"_id": 0}).to_list(1000)
    for a in assets:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
    return assets

@router.get("/assets/stats")
async def get_asset_stats(current_user: dict = Depends(get_current_user)):
    assets = await db.assets.find(tenant_scoped_query(current_user, scoped_query(current_user)), {"_id": 0}).to_list(10000)
    total = len(assets)
    active = len([a for a in assets if a.get("status") == "active"])
    total_value = sum(a.get("cost", 0) for a in assets)
    expiring_soon = 0
    expired = 0
    now = datetime.now()
    for a in assets:
        we = a.get("warranty_expiry")
        if we:
            try:
                exp_dt = datetime.strptime(we, "%Y-%m-%d")
                if exp_dt < now:
                    expired += 1
                elif exp_dt < now + timedelta(days=90):
                    expiring_soon += 1
            except Exception:
                pass
    by_type = {}
    for a in assets:
        t = a.get("asset_type", "other")
        by_type[t] = by_type.get(t, 0) + 1
    return {
        "total": total, "active": active, "total_value": round(total_value, 2),
        "warranty_expiring_soon": expiring_soon, "warranty_expired": expired,
        "by_type": by_type
    }

@router.get("/assets/expiring")
async def get_expiring_assets(current_user: dict = Depends(get_current_user)):
    assets = await db.assets.find(tenant_scoped_query(current_user, scoped_query(current_user)), {"_id": 0}).to_list(10000)
    now = datetime.now()
    cutoff = now + timedelta(days=90)
    expiring = []
    for a in assets:
        we = a.get("warranty_expiry")
        if we:
            try:
                exp_dt = datetime.strptime(we, "%Y-%m-%d")
                if exp_dt < cutoff:
                    a["days_remaining"] = (exp_dt - now).days
                    a["is_expired"] = exp_dt < now
                    expiring.append(a)
            except Exception:
                pass
    return sorted(expiring, key=lambda x: x.get("days_remaining", 999))

@router.get("/assets/{asset_id}")
async def get_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    return await assert_tenant_record_scope(
        current_user, db.assets, asset_id,
        operation="asset.read", resource_name="Asset",
    )

@router.post(
    "/assets",
    response_model=Asset,
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def create_asset(asset_data: AssetCreate, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, asset_data.client_id, operation="asset.create")
    client = await db.clients.find_one(tenant_scoped_query(current_user, {"id": asset_data.client_id}), {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client_name = client['name'] if client else None
    await _validate_inventory_device_link(
        current_user,
        device_id=asset_data.device_id,
        client_id=asset_data.client_id,
        operation="asset.create",
    )
    
    asset = Asset(**asset_data.model_dump(), client_name=client_name)
    doc = asset.model_dump()
    doc["tenant_id"] = platform_tenant_id(current_user)
    doc['created_at'] = doc['created_at'].isoformat()
    await db.assets.insert_one(doc)
    await log_activity(
        current_user, "created", "asset", asset.id, asset.name,
        "Created a governed inventory record.",
        metadata={"client_id": asset.client_id, "device_id": asset.device_id},
    )
    return asset

@router.put(
    "/assets/{asset_id}",
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def update_asset(asset_id: str, asset_data: dict, current_user: dict = Depends(get_current_user)):
    existing = await assert_tenant_record_scope(
        current_user, db.assets, asset_id,
        operation="asset.update", resource_name="Asset",
    )
    updates = dict(asset_data or {})
    editable_fields = {
        "name", "client_id", "device_id", "asset_type", "manufacturer", "model", "serial_number",
        "purchase_date", "warranty_expiry", "warranty_end", "cost", "purchase_cost", "status", "location",
        "assigned_to", "depreciation_rate", "notes", "asset_tag", "category", "vendor", "purchase_order_number",
        "warranty_start", "expected_lifespan_months", "depreciation_method",
    }
    protected_fields = sorted(set(updates) - editable_fields)
    if protected_fields:
        raise HTTPException(
            status_code=422,
            detail=f"These inventory fields are system-managed and cannot be changed here: {', '.join(protected_fields)}",
        )
    next_client_id = updates.get("client_id", existing.get("client_id"))
    next_device_id = updates.get("device_id", existing.get("device_id"))
    if "client_id" in updates and next_client_id != existing.get("client_id"):
        await assert_client_scope(current_user, next_client_id, operation="asset.move")
        next_client = await db.clients.find_one(tenant_scoped_query(current_user, {"id": next_client_id}), {"_id": 0, "id": 1, "name": 1}) if next_client_id else None
        if next_client_id and not next_client:
            raise HTTPException(status_code=404, detail="Client not found")
        updates["client_name"] = next_client.get("name") if next_client else None
    await _validate_inventory_device_link(
        current_user,
        device_id=next_device_id,
        client_id=next_client_id,
        asset_id=asset_id,
        operation="asset.update",
    )
    updates["updated_at"] = _now()
    result = await db.assets.update_one(tenant_scoped_query(current_user, {"id": asset_id}), {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    changes = {key: {"old": existing.get(key), "new": value} for key, value in updates.items() if key != "updated_at" and existing.get(key) != value}
    if changes:
        await log_activity(
            current_user, "updated", "asset", asset_id, str(existing.get("name") or asset_id),
            "Updated a governed inventory record.", changes=changes,
            metadata={"client_id": next_client_id, "device_id": next_device_id},
        )
    return {"message": "Asset updated"}

@router.delete(
    "/assets/{asset_id}",
    dependencies=[Depends(require_action("asset.lifecycle.manage"))],
)
async def delete_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    asset = await assert_tenant_record_scope(
        current_user, db.assets, asset_id,
        operation="asset.delete", resource_name="Asset",
    )
    blocker = _asset_delete_blocker(asset)
    if blocker:
        raise HTTPException(status_code=409, detail=blocker)
    await log_activity(
        current_user, "deleted", "asset", asset_id, str(asset.get("name") or asset_id),
        "Permanently deleted an empty manual inventory record.", metadata={"purge": True, "client_id": asset.get("client_id")},
    )
    result = await db.assets.delete_one(tenant_scoped_query(current_user, {"id": asset_id}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}

