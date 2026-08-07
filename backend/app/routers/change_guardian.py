"""Nexus Change Guardian API.

Provides a scoped, auditable dependency preview before endpoint fleet changes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.change_guardian import DEVICE_ACTIONS, build_device_change_preview
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import scoped_query


router = APIRouter()


class ChangePreviewRequest(BaseModel):
    action: str
    entity_type: str = "device"
    entity_ids: list[str] = Field(min_length=1, max_length=200)


@router.post("/change-guardian/preview")
async def preview_change_impact(
    payload: ChangePreviewRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    if payload.entity_type != "device":
        raise HTTPException(status_code=400, detail="The current Change Guardian rollout supports managed assets")
    if payload.action not in DEVICE_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported change action: {payload.action}")

    target_ids = sorted({str(value).strip() for value in payload.entity_ids if str(value).strip()})
    devices = await db.devices.find(
        scoped_query(current_user, {"id": {"$in": target_ids}}),
        {"_id": 0},
    ).to_list(500)
    if len(devices) != len(target_ids):
        raise HTTPException(status_code=404, detail="One or more selected targets are unavailable")

    client_ids = sorted({str(row.get("client_id")) for row in devices if row.get("client_id")})
    now = datetime.now(timezone.utc)
    tickets = await db.tickets.find(
        {
            "$or": [
                {"device_id": {"$in": target_ids}},
                {"device_ids": {"$in": target_ids}},
            ],
            "status": {"$in": ["open", "in_progress", "pending", "waiting", "new"]},
        },
        {"_id": 0},
    ).to_list(500)
    sessions = await db.remote_sessions.find(
        {
            "device_id": {"$in": target_ids},
            "status": {"$in": ["active", "connected", "connecting", "started", "in_progress"]},
        },
        {"_id": 0},
    ).to_list(500)
    backups = await db.backup_jobs.find(
        {
            "device_id": {"$in": target_ids},
            "status": {"$in": ["running", "in_progress", "verifying", "restoring"]},
        },
        {"_id": 0},
    ).to_list(500)
    alerts = await db.alerts.find(
        {
            "device_id": {"$in": target_ids},
            "status": {"$in": ["active", "open", "triggered", "new"]},
        },
        {"_id": 0},
    ).to_list(1000)
    maintenance_windows = await db.maintenance_windows.find(
        {
            "device_ids": {"$in": target_ids},
            "status": {"$in": ["scheduled", "running", "in_progress"]},
        },
        {"_id": 0},
    ).to_list(500)
    clients = await db.clients.find(
        {"id": {"$in": client_ids}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(500)

    preview = build_device_change_preview(
        action=payload.action,
        requested_ids=target_ids,
        devices=devices,
        clients=clients,
        tickets=tickets,
        sessions=sessions,
        backups=backups,
        alerts=alerts,
        maintenance_windows=maintenance_windows,
        assessed_at=now.isoformat(),
    )
    preview_id = str(uuid.uuid4())
    correlation_id = request_correlation_id(request)
    expires_at = now + timedelta(minutes=10)
    record = {
        "id": preview_id,
        "entity_type": "device",
        "entity_ids": target_ids,
        "action": payload.action,
        "client_ids": client_ids,
        "risk": preview["risk"],
        "scope": preview["scope"],
        "gates": preview["gates"],
        "created_by_id": current_user.get("id"),
        "created_by_name": current_user.get("name") or current_user.get("email"),
        "correlation_id": correlation_id,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "consumed_at": None,
    }
    await db.change_guardian_previews.insert_one(record)
    await emit_platform_event(
        subject="change.guardian.previewed",
        source="nexus.change-guardian",
        actor=current_user,
        client_id=client_ids[0] if len(client_ids) == 1 else None,
        correlation_id=correlation_id,
        payload={
            "preview_id": preview_id,
            "action": payload.action,
            "entity_type": "device",
            "entity_ids": target_ids,
            "client_ids": client_ids,
            "risk_level": preview["risk"]["level"],
            "risk_score": preview["risk"]["score"],
            "execution_allowed": preview["execution_allowed"],
        },
        retention_days=365,
    )
    return {
        **preview,
        "preview_id": preview_id,
        "expires_at": expires_at.isoformat(),
    }

