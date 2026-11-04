"""Scoped API for the evidence-first Windows Health Engine."""

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services import windows_health
from app.services.scope_permissions import assert_tenant_record_scope, scoped_query, tenant_scoped_query

router = APIRouter(prefix="/windows-health", tags=["Windows Health"])
_DEVICE_PROJECTION = {"_id": 0, "id": 1, "client_id": 1, "site_id": 1, "name": 1, "hostname": 1, "os": 1, "os_platform": 1, "platform": 1, "telemetry": 1, "cpu_usage": 1, "memory_usage": 1, "disk_usage": 1, "self_heal": 1, "patch_evidence": 1, "windows_operations": 1}


async def _commands(device_ids: list[str], user: dict) -> dict[str, list[dict]]:
    if not device_ids:
        return {}
    rows = await db.nexus_agent_commands.find(tenant_scoped_query(user, scoped_query(user, {"device_id": {"$in": device_ids}})), {"_id": 0, "device_id": 1, "status": 1, "kind": 1, "exit_code": 1, "created_at": 1, "completed_at": 1, "duration_ms": 1}).sort("created_at", -1).to_list(2000)
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("device_id") or ""), []).append(row)
    return grouped


@router.get("/fleet")
async def get_windows_health_fleet(current_user: dict = Depends(get_current_user)) -> dict:
    devices = await db.devices.find(tenant_scoped_query(current_user, scoped_query(current_user)), _DEVICE_PROJECTION).to_list(5000)
    return windows_health.fleet(devices, await _commands([str(row.get("id")) for row in devices if row.get("id")], current_user))


@router.get("/devices/{device_id}")
async def get_windows_health_device(device_id: str, current_user: dict = Depends(get_current_user)) -> dict:
    device = await assert_tenant_record_scope(current_user, db.devices, device_id, operation="windows_health.read", resource_name="Device")
    return windows_health.assess(device, (await _commands([device_id], current_user)).get(device_id, []))
