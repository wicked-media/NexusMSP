"""Nexus Backup native control plane.

The first release is intentionally non-executing.  It records tenant- and
client-scoped destination metadata, backup policy, protected-workload intent,
and capability preflight evidence.  It never accepts a storage secret, file
path, backup payload, or restore payload, and it never dispatches the generic
agent command channel as a substitute for a backup engine.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.nexus_backup import (
    REPOSITORY_TYPES,
    SCHEDULES,
    SOURCE_PROFILES,
    WORKLOAD_TYPES,
    capture_release_readiness,
    protection_readiness,
    public_policy,
    public_protection_intent,
    public_repository,
    public_restore_drill,
    utc_now,
)
from app.services.nexus_backup_vault import validate_endpoint_url, verify_connection
from app.services.secret_store import encrypt_secret
from app.services.scope_permissions import (
    assert_client_scope,
    assert_tenant_record_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)


router = APIRouter(tags=["Nexus Backup"])


def _clean_text(value: str) -> str:
    return str(value or "").strip()


def _stable_id(value: str, label: str) -> str:
    value = _clean_text(value)
    if not value:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    return value


class DestinationUpsert(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    destination_type: Literal["nexus_backup_vault", "s3_compatible", "managed_repository"]
    destination_name: str = Field(min_length=2, max_length=160)
    encryption_attested: bool = False
    immutable_storage_attested: bool = False
    restore_verification_attested: bool = False
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("client_id", "destination_name")
    @classmethod
    def non_empty_text(cls, value: str) -> str:
        value = _clean_text(value)
        if not value:
            raise ValueError("A non-empty value is required")
        return value


class BackupProfileCreate(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    site_id: str | None = Field(default=None, max_length=200)
    name: str = Field(min_length=2, max_length=160)
    workload_type: Literal["endpoint_files", "system_image", "server_application"]
    source_profile: Literal["user_data", "business_data", "full_device", "application_aware"]
    schedule: Literal["daily", "weekly"] = "daily"
    retention_days: int = Field(default=30, ge=7, le=3650)
    rpo_hours: int = Field(default=24, ge=1, le=720)
    idempotency_key: str | None = Field(default=None, max_length=160)

    @field_validator("client_id", "name")
    @classmethod
    def valid_required_text(cls, value: str) -> str:
        value = _clean_text(value)
        if not value:
            raise ValueError("A non-empty value is required")
        return value

    @field_validator("site_id", "idempotency_key")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        value = _clean_text(value or "")
        return value or None


class ProfileAssignmentCreate(BaseModel):
    device_id: str = Field(min_length=1, max_length=200)
    destination_id: str = Field(min_length=1, max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=160)

    @field_validator("device_id", "destination_id")
    @classmethod
    def valid_device_id(cls, value: str) -> str:
        value = _clean_text(value)
        if not value:
            raise ValueError("A device ID is required")
        return value

    @field_validator("idempotency_key")
    @classmethod
    def trim_key(cls, value: str | None) -> str | None:
        value = _clean_text(value or "")
        return value or None


class VersionedPreflight(BaseModel):
    expected_version: int = Field(ge=1)
    idempotency_key: str | None = Field(default=None, max_length=160)

    @field_validator("idempotency_key")
    @classmethod
    def trim_key(cls, value: str | None) -> str | None:
        value = _clean_text(value or "")
        return value or None


class RestoreDrillCreate(BaseModel):
    drill_type: Literal["metadata_review", "isolated_restore"] = "metadata_review"
    scheduled_for: str | None = Field(default=None, max_length=64)
    idempotency_key: str | None = Field(default=None, max_length=160)

    @field_validator("scheduled_for", "idempotency_key")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return _clean_text(value or "") or None


class VaultConnectionUpsert(BaseModel):
    endpoint_url: str = Field(min_length=8, max_length=500)
    bucket: str = Field(min_length=3, max_length=255)
    region: str = Field(default="us-east-1", min_length=2, max_length=80)
    access_key_id: str = Field(min_length=3, max_length=500)
    secret_access_key: str = Field(min_length=8, max_length=1000)
    session_token: str | None = Field(default=None, max_length=4000)
    expected_version: int = Field(ge=1)

    @field_validator("endpoint_url", "bucket", "region", "access_key_id", "secret_access_key")
    @classmethod
    def trim_required_vault_values(cls, value: str) -> str:
        value = _clean_text(value or "")
        if not value:
            raise ValueError("A non-empty vault value is required")
        return value

    @field_validator("session_token")
    @classmethod
    def trim_optional_vault_token(cls, value: str | None) -> str | None:
        return _clean_text(value or "") or None


async def _require_client(
    user: dict[str, Any],
    client_id: str,
    *,
    request: Request,
    operation: str,
) -> dict[str, Any]:
    client_id = _stable_id(client_id, "Client ID")
    await assert_client_scope(user, client_id, operation=operation, request=request, mask_not_found=True)
    client = await db.clients.find_one(
        tenant_scoped_query(user, {"id": client_id}),
        {"_id": 0, "id": 1, "site_ids": 1},
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _require_site_if_set(
    user: dict[str, Any],
    *,
    client_id: str,
    site_id: str | None,
    request: Request,
    operation: str,
) -> str | None:
    site_id = _clean_text(site_id or "") or None
    if not site_id:
        return None
    site = await db.sites.find_one(
        tenant_scoped_query(user, {"id": site_id, "client_id": client_id}),
        {"_id": 0, "id": 1},
    )
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await assert_client_scope(user, client_id, site_id=site_id, operation=operation, request=request, mask_not_found=True)
    return site_id


async def _record_event(
    *,
    user: dict[str, Any],
    request: Request,
    event_type: str,
    entity_type: str,
    entity_id: str,
    client_id: str,
    site_id: str | None = None,
    device_id: str | None = None,
    detail: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Write durable, secret-free native Backup activity evidence."""

    now = utc_now()
    tenant_id = platform_tenant_id(user)
    event = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "client_id": client_id,
        "site_id": site_id,
        "device_id": device_id,
        "event_type": event_type,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "detail": detail,
        "actor_id": user.get("id") or user.get("email") or "unknown",
        "actor_name": user.get("name") or user.get("email") or "Unknown technician",
        "correlation_id": getattr(request.state, "correlation_id", None),
        "occurred_at": now,
        "metadata": metadata or {},
    }
    await db.nexus_backup_events.insert_one(event)
    await log_activity(
        user,
        f"nexus_backup_{event_type}",
        entity_type,
        entity_id,
        "Nexus Backup",
        detail,
        metadata={
            "tenant_id": tenant_id,
            "client_id": client_id,
            "site_id": site_id,
            "device_id": device_id,
            **(metadata or {}),
        },
    )


async def _load_readiness(
    user: dict[str, Any],
    *,
    client_id: str,
    device_id: str,
    destination_id: str | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any]]:
    device = await db.devices.find_one(
        tenant_scoped_query(user, {"id": device_id, "client_id": client_id, "archived": {"$ne": True}}),
        {"_id": 0},
    )
    destination = None
    if destination_id:
        destination = await db.nexus_backup_destinations.find_one(
            tenant_scoped_query(user, {"id": destination_id, "client_id": client_id}),
            {"_id": 0},
        )
    return device, destination, protection_readiness(repository=destination, device=device)


async def _load_destination(
    user: dict[str, Any],
    destination_id: str,
    *,
    request: Request,
    operation: str,
) -> dict[str, Any]:
    destination = await assert_tenant_record_scope(
        user,
        db.nexus_backup_destinations,
        destination_id,
        operation=operation,
        request=request,
        resource_name="Nexus Backup destination",
    )
    await assert_client_scope(
        user,
        str(destination.get("client_id") or ""),
        operation=operation,
        request=request,
        mask_not_found=True,
    )
    return destination


@router.get(
    "/nexus-backup/overview",
    dependencies=[Depends(require_action("backup.native.view"))],
)
async def nexus_backup_overview(request: Request, user: dict = Depends(get_current_user)):
    """Return the native Backup control plane without fabricating protection."""

    client_scope = scoped_query(user, {}, site_field=None)
    query = tenant_scoped_query(user, client_scope)
    destinations, profiles, jobs, devices, restore_drills = await asyncio.gather(
        db.nexus_backup_destinations.find(query, {"_id": 0}).sort("updated_at", -1).to_list(250),
        db.nexus_backup_profiles.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500),
        db.nexus_backup_jobs.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500),
        db.devices.find(
            tenant_scoped_query(user, scoped_query(user, {"archived": {"$ne": True}})),
            {"_id": 0, "id": 1, "name": 1, "client_id": 1, "site_id": 1, "nexus_agent_id": 1,
             "agent_runtime_capabilities": 1, "nexus_backup_evidence": 1, "status": 1},
        ).sort("name", 1).to_list(500),
        db.nexus_backup_restore_drills.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500),
    )
    destination_by_id = {str(item.get("id")): item for item in destinations if item.get("id")}
    device_by_id = {str(item.get("id")): item for item in devices if item.get("id")}
    profile_by_id = {str(item.get("id")): item for item in profiles if item.get("id")}

    public_jobs = []
    for job in jobs:
        device = device_by_id.get(str(job.get("device_id") or ""))
        destination = destination_by_id.get(str(job.get("destination_id") or ""))
        readiness = protection_readiness(repository=destination, device=device)
        item = public_protection_intent(
            job,
            readiness,
            capture_release_readiness(intent=job, repository=destination, device=device),
        )
        profile = profile_by_id.get(str(job.get("profile_id") or ""))
        item["profile_name"] = profile.get("name") if profile else None
        item["device_name"] = device.get("name") if device else None
        item["destination_name"] = destination.get("destination_name") if destination else None
        public_jobs.append(item)

    return {
        "summary": {
            "control_plane_state": "capability_inventory",
            "execution_allowed": False,
            "destinations": len(destinations),
            "profiles": len(profiles),
            "protected_workload_intents": len(jobs),
            "verified_restore_points": 0,
            "completed_native_jobs": 0,
            "restore_drills": len(restore_drills),
        },
        "boundary": (
            "Nexus Backup currently records policy, destination attestation, endpoint capability evidence, and protected-workload intent. "
            "It has not read customer files, created a snapshot, transferred backup data, or proven a restore."
        ),
        "agent_contract": {
            "state": "capability_inventory",
            "execution_allowed": False,
            "reserved_capabilities": [
                "nexus_backup_vss_snapshot_v1",
                "nexus_backup_incremental_v1",
                "nexus_backup_restore_v1",
            ],
        },
        "destinations": [public_repository(item) for item in destinations],
        "profiles": [public_policy(item) for item in profiles],
        "workload_intents": public_jobs,
        "restore_drills": [public_restore_drill(item) for item in restore_drills],
        "available_devices": [
            {
                "id": item.get("id"),
                "name": item.get("name") or "Unnamed endpoint",
                "client_id": item.get("client_id"),
                "site_id": item.get("site_id"),
                "status": item.get("status"),
                "agent_enrolled": bool(item.get("nexus_agent_id")),
            }
            for item in devices
        ],
        "generated_at": utc_now(),
    }


@router.post(
    "/nexus-backup/destinations",
    dependencies=[Depends(require_action("backup.native.manage"))],
)
async def upsert_nexus_backup_destination(
    payload: DestinationUpsert,
    request: Request,
    user: dict = Depends(get_current_user),
):
    await _require_client(user, payload.client_id, request=request, operation="nexus-backup.destination.manage")
    if payload.destination_type not in REPOSITORY_TYPES:
        raise HTTPException(status_code=422, detail="Choose a supported Nexus Backup destination type")
    existing = await db.nexus_backup_destinations.find_one(
        tenant_scoped_query(user, {"client_id": payload.client_id, "destination_type": payload.destination_type}),
        {"_id": 0},
    )
    if existing and payload.expected_version is None:
        raise HTTPException(status_code=409, detail="Refresh the destination before saving changes.")
    if existing and int(existing.get("version") or 1) != payload.expected_version:
        raise HTTPException(status_code=409, detail="The destination changed in another session. Refresh before saving.")

    now = utc_now()
    version = int((existing or {}).get("version") or 0) + 1
    destination = {
        **(existing or {}),
        "id": (existing or {}).get("id") or f"nbd-{uuid.uuid4().hex}",
        "tenant_id": platform_tenant_id(user),
        "client_id": payload.client_id,
        "destination_type": payload.destination_type,
        "destination_name": payload.destination_name,
        "encryption_attested": payload.encryption_attested,
        "immutable_storage_attested": payload.immutable_storage_attested,
        "restore_verification_attested": payload.restore_verification_attested,
        "status": "attested" if all((payload.encryption_attested, payload.immutable_storage_attested, payload.restore_verification_attested)) else "not_configured",
        # This must stay unverified until a real server-side storage connector
        # records independent health and immutable-retention evidence.
        "verification_state": "not_verified",
        "execution_allowed": False,
        "updated_at": now,
        "updated_by": user.get("id") or user.get("email") or "unknown",
        "version": version,
    }
    query: dict[str, Any] = {"id": destination["id"]}
    if existing:
        query["version"] = int(existing.get("version") or 1)
    result = await db.nexus_backup_destinations.replace_one(
        tenant_scoped_query(user, query), destination, upsert=not bool(existing)
    )
    if existing and not result.matched_count:
        raise HTTPException(status_code=409, detail="The destination changed in another session. Refresh before saving.")
    await _record_event(
        user=user,
        request=request,
        event_type="destination_saved",
        entity_type="nexus_backup_destination",
        entity_id=destination["id"],
        client_id=payload.client_id,
        detail="Saved non-secret Nexus Backup destination attestation.",
        metadata={"destination_type": payload.destination_type, "version": version},
    )
    return {"destination": public_repository(destination), "message": "Destination attestation saved. Native storage verification is still required."}


@router.put(
    "/nexus-backup/destinations/{destination_id}/connection",
    dependencies=[Depends(require_action("backup.native.manage"))],
)
async def configure_nexus_backup_vault_connection(
    destination_id: str,
    payload: VaultConnectionUpsert,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Store a server-only S3 vault connection, never browser-visible values."""

    destination = await _load_destination(
        user, destination_id, request=request, operation="nexus-backup.destination.connection.manage"
    )
    if destination.get("destination_type") not in {"nexus_backup_vault", "s3_compatible"}:
        raise HTTPException(status_code=422, detail="Only S3-compatible Nexus Backup destinations support this connection contract")
    if int(destination.get("version") or 1) != payload.expected_version:
        raise HTTPException(status_code=409, detail="The destination changed in another session. Refresh before saving its connection.")
    try:
        endpoint_url = validate_endpoint_url(str(payload.endpoint_url or ""))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    now = utc_now()
    credential = {
        "id": f"nbc-{uuid.uuid4().hex}",
        "tenant_id": platform_tenant_id(user),
        "client_id": destination.get("client_id"),
        "destination_id": destination_id,
        "provider": "s3_compatible",
        "endpoint_url_encrypted": encrypt_secret(endpoint_url),
        "bucket_encrypted": encrypt_secret(str(payload.bucket or "").strip()),
        "region": str(payload.region or "us-east-1").strip(),
        "access_key_id_encrypted": encrypt_secret(str(payload.access_key_id or "")),
        "secret_access_key_encrypted": encrypt_secret(str(payload.secret_access_key or "")),
        "session_token_encrypted": encrypt_secret(str(payload.session_token or "")),
        "updated_at": now,
        "updated_by": user.get("id") or user.get("email") or "unknown",
        "version": 1,
    }
    existing = await db.nexus_backup_credentials.find_one(
        tenant_scoped_query(user, {"destination_id": destination_id, "client_id": destination.get("client_id")}), {"_id": 0, "id": 1, "version": 1, "created_at": 1}
    )
    if existing:
        credential.update({"id": existing["id"], "created_at": existing.get("created_at") or now, "version": int(existing.get("version") or 0) + 1})
    else:
        credential["created_at"] = now
    await db.nexus_backup_credentials.replace_one(
        tenant_scoped_query(user, {"id": credential["id"]}), credential, upsert=True
    )
    result = await db.nexus_backup_destinations.update_one(
        tenant_scoped_query(user, {"id": destination_id, "version": payload.expected_version}),
        {"$set": {
            "connection_state": "configured_not_verified",
            "verification_state": "not_verified",
            "updated_at": now,
            "updated_by": user.get("id") or user.get("email") or "unknown",
        }, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="The destination changed in another session. Refresh before saving its connection.")
    await _record_event(
        user=user,
        request=request,
        event_type="vault_connection_configured",
        entity_type="nexus_backup_destination",
        entity_id=destination_id,
        client_id=str(destination.get("client_id")),
        detail="Saved an encrypted server-side S3-compatible vault connection. No bucket data was read or written.",
        metadata={"connection_state": "configured_not_verified"},
    )
    refreshed = {**destination, "connection_state": "configured_not_verified", "verification_state": "not_verified", "updated_at": now, "version": payload.expected_version + 1}
    return {
        "destination": public_repository(refreshed),
        "message": "Server-side vault connection saved. Verify Object Lock and default encryption before a capture pilot.",
    }


@router.post(
    "/nexus-backup/destinations/{destination_id}/verify",
    dependencies=[Depends(require_action("backup.native.manage"))],
)
async def verify_nexus_backup_vault_connection(
    destination_id: str,
    payload: VersionedPreflight,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Perform a server-side, read-only immutable vault verification."""

    destination = await _load_destination(
        user, destination_id, request=request, operation="nexus-backup.destination.verify"
    )
    if int(destination.get("version") or 1) != payload.expected_version:
        raise HTTPException(status_code=409, detail="The destination changed in another session. Refresh before verifying.")
    credential = await db.nexus_backup_credentials.find_one(
        tenant_scoped_query(user, {"destination_id": destination_id, "client_id": destination.get("client_id")}), {"_id": 0}
    )
    verification = await verify_connection(credential)
    now = utc_now()
    verified = bool(verification.get("verified"))
    attested = all((
        destination.get("encryption_attested"),
        destination.get("immutable_storage_attested"),
        destination.get("restore_verification_attested"),
    ))
    result = await db.nexus_backup_destinations.update_one(
        tenant_scoped_query(user, {"id": destination_id, "version": payload.expected_version}),
        {"$set": {
            "verification_state": "verified" if verified else "not_verified",
            "connection_state": str(verification.get("state") or "not_configured"),
            "connector_evidence": {
                "state": str(verification.get("state") or "not_configured"),
                "reason_code": str(verification.get("reason_code") or "unknown"),
                "verified_at": now,
            },
            "status": "verified" if verified and attested else "attested",
            "updated_at": now,
            "updated_by": user.get("id") or user.get("email") or "unknown",
        }, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="The destination changed in another session. Refresh before verifying.")
    await _record_event(
        user=user,
        request=request,
        event_type="vault_verification_recorded",
        entity_type="nexus_backup_destination",
        entity_id=destination_id,
        client_id=str(destination.get("client_id")),
        detail="Recorded server-side immutable vault verification evidence. No backup payload was created or transferred.",
        metadata={"verification_state": "verified" if verified else "not_verified", "reason_code": verification.get("reason_code")},
    )
    refreshed = {
        **destination,
        "verification_state": "verified" if verified else "not_verified",
        "connection_state": str(verification.get("state") or "not_configured"),
        "connector_evidence": {"state": str(verification.get("state") or "not_configured"), "reason_code": str(verification.get("reason_code") or "unknown"), "verified_at": now},
        "status": "verified" if verified and attested else "attested",
        "updated_at": now,
        "version": payload.expected_version + 1,
    }
    return {
        "destination": public_repository(refreshed),
        "verification": {"state": verification.get("state"), "verified": verified, "reason_code": verification.get("reason_code")},
        "message": "Immutable vault verified." if verified else "Vault verification did not meet Nexus immutable-storage requirements.",
    }


@router.post(
    "/nexus-backup/profiles",
    dependencies=[Depends(require_action("backup.native.manage"))],
)
async def create_nexus_backup_profile(
    payload: BackupProfileCreate,
    request: Request,
    user: dict = Depends(get_current_user),
):
    await _require_client(user, payload.client_id, request=request, operation="nexus-backup.profile.create")
    site_id = await _require_site_if_set(
        user, client_id=payload.client_id, site_id=payload.site_id, request=request, operation="nexus-backup.profile.create"
    )
    if payload.workload_type not in WORKLOAD_TYPES or payload.source_profile not in SOURCE_PROFILES or payload.schedule not in SCHEDULES:
        raise HTTPException(status_code=422, detail="Choose supported policy values")
    if payload.idempotency_key:
        duplicate = await db.nexus_backup_profiles.find_one(
            tenant_scoped_query(user, {"client_id": payload.client_id, "idempotency_key": payload.idempotency_key}),
            {"_id": 0},
        )
        if duplicate:
            return {"profile": public_policy(duplicate), "message": "Existing idempotent policy request returned."}

    now = utc_now()
    profile = {
        "id": f"nbp-{uuid.uuid4().hex}",
        "tenant_id": platform_tenant_id(user),
        "client_id": payload.client_id,
        "site_id": site_id,
        "name": payload.name,
        "workload_type": payload.workload_type,
        "source_profile": payload.source_profile,
        "schedule": payload.schedule,
        "retention_days": payload.retention_days,
        "rpo_hours": payload.rpo_hours,
        "state": "draft",
        "idempotency_key": payload.idempotency_key,
        "created_at": now,
        "updated_at": now,
        "created_by": user.get("id") or user.get("email") or "unknown",
        "version": 1,
    }
    await db.nexus_backup_profiles.insert_one(profile)
    await _record_event(
        user=user,
        request=request,
        event_type="profile_created",
        entity_type="nexus_backup_profile",
        entity_id=profile["id"],
        client_id=payload.client_id,
        site_id=site_id,
        detail="Created a Nexus Backup policy draft. No endpoint source was selected or read.",
        metadata={"workload_type": payload.workload_type, "source_profile": payload.source_profile},
    )
    return {"profile": public_policy(profile), "message": "Native Backup policy draft created."}


@router.post(
    "/nexus-backup/profiles/{profile_id}/assignments",
    dependencies=[Depends(require_action("backup.native.manage"))],
)
async def assign_nexus_backup_profile(
    profile_id: str,
    payload: ProfileAssignmentCreate,
    request: Request,
    user: dict = Depends(get_current_user),
):
    profile = await assert_tenant_record_scope(
        user, db.nexus_backup_profiles, profile_id,
        operation="nexus-backup.profile.assign", request=request, resource_name="Nexus Backup profile",
    )
    device = await db.devices.find_one(
        tenant_scoped_query(user, {"id": payload.device_id, "client_id": profile.get("client_id"), "archived": {"$ne": True}}),
        {"_id": 0},
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if profile.get("site_id") and profile.get("site_id") != device.get("site_id"):
        raise HTTPException(status_code=422, detail="The endpoint is outside the policy's site scope")
    await assert_client_scope(
        user, profile.get("client_id"), site_id=device.get("site_id"), operation="nexus-backup.profile.assign", request=request, mask_not_found=True
    )
    if payload.idempotency_key:
        duplicate = await db.nexus_backup_jobs.find_one(
            tenant_scoped_query(user, {"client_id": profile.get("client_id"), "idempotency_key": payload.idempotency_key}),
            {"_id": 0},
        )
        if duplicate:
            destination = await db.nexus_backup_destinations.find_one(
                tenant_scoped_query(user, {"id": duplicate.get("destination_id"), "client_id": profile.get("client_id")}), {"_id": 0}
            ) if duplicate.get("destination_id") else None
            return {
                "workload_intent": public_protection_intent(
                    duplicate, protection_readiness(repository=destination, device=device)
                ),
                "message": "Existing idempotent workload intent returned.",
            }

    destination = await db.nexus_backup_destinations.find_one(
        tenant_scoped_query(user, {"id": payload.destination_id, "client_id": profile.get("client_id")} ),
        {"_id": 0},
    )
    if not destination:
        raise HTTPException(status_code=404, detail="Nexus Backup destination not found for this client")
    readiness = protection_readiness(repository=destination, device=device)
    now = utc_now()
    intent = {
        "id": f"nbj-{uuid.uuid4().hex}",
        "tenant_id": platform_tenant_id(user),
        "client_id": profile.get("client_id"),
        "site_id": device.get("site_id"),
        "device_id": device.get("id"),
        "profile_id": profile.get("id"),
        "destination_id": (destination or {}).get("id"),
        "job_type": "protection_preflight",
        "state": readiness["state"],
        "execution_allowed": False,
        "idempotency_key": payload.idempotency_key,
        "created_at": now,
        "updated_at": now,
        "created_by": user.get("id") or user.get("email") or "unknown",
        "version": 1,
    }
    await db.nexus_backup_jobs.insert_one(intent)
    await _record_event(
        user=user,
        request=request,
        event_type="workload_intent_created",
        entity_type="nexus_backup_job",
        entity_id=intent["id"],
        client_id=profile.get("client_id"),
        site_id=device.get("site_id"),
        device_id=device.get("id"),
        detail="Recorded protected-workload intent; no capture job was dispatched.",
        metadata={"profile_id": profile.get("id"), "destination_id": intent.get("destination_id")},
    )
    return {
        "workload_intent": public_protection_intent(intent, readiness),
        "message": "Protected-workload intent recorded. Native capture remains blocked until the data plane is verified.",
    }


@router.post(
    "/nexus-backup/jobs/{job_id}/preflight",
    dependencies=[Depends(require_action("backup.native.manage"))],
)
async def preflight_nexus_backup_job(
    job_id: str,
    payload: VersionedPreflight,
    request: Request,
    user: dict = Depends(get_current_user),
):
    job = await assert_tenant_record_scope(
        user, db.nexus_backup_jobs, job_id,
        operation="nexus-backup.job.preflight", request=request, resource_name="Nexus Backup job",
    )
    if int(job.get("version") or 1) != payload.expected_version:
        raise HTTPException(status_code=409, detail="The workload intent changed in another session. Refresh before preflight.")
    if payload.idempotency_key and payload.idempotency_key == job.get("last_preflight_key"):
        device, destination, readiness = await _load_readiness(
            user, client_id=str(job.get("client_id")), device_id=str(job.get("device_id")), destination_id=job.get("destination_id")
        )
        return {"workload_intent": public_protection_intent(job, readiness), "message": "Existing idempotent preflight returned."}

    device, destination, readiness = await _load_readiness(
        user, client_id=str(job.get("client_id")), device_id=str(job.get("device_id")), destination_id=job.get("destination_id")
    )
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if not device.get("nexus_agent_id"):
        raise HTTPException(status_code=422, detail="Enrol the Nexus Agent on this endpoint before queuing safe Backup preflight.")
    now = utc_now()
    result = await db.nexus_backup_jobs.update_one(
        tenant_scoped_query(user, {"id": job_id, "version": payload.expected_version}),
        {"$set": {
            "state": "preflight_queued",
            "execution_allowed": False,
            "last_preflight_requested_at": now,
            "last_preflight_key": payload.idempotency_key,
            "updated_at": now,
        }, "$unset": {"preflight_result": "", "preflight_agent_id": "", "preflight_lease_id": "", "preflight_lease_expires_at": ""}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="The workload intent changed in another session. Refresh before preflight.")
    refreshed = {**job, "state": "preflight_queued", "execution_allowed": False, "last_preflight_requested_at": now, "updated_at": now, "version": payload.expected_version + 1}
    await _record_event(
        user=user,
        request=request,
        event_type="preflight_queued",
        entity_type="nexus_backup_job",
        entity_id=job_id,
        client_id=str(job.get("client_id")),
        site_id=job.get("site_id"),
        device_id=job.get("device_id"),
        detail="Queued a non-executing native Backup preflight for the enrolled endpoint.",
        metadata={"execution_allowed": False, "destination_id": (destination or {}).get("id")},
    )
    return {
        "workload_intent": public_protection_intent(refreshed, readiness),
        "message": "Safe preflight queued. The Nexus Agent will not access files, create a snapshot, transfer data, or request a restore.",
    }


@router.post(
    "/nexus-backup/jobs/{job_id}/restore-drills",
    dependencies=[Depends(require_action("backup.native.restore.verify"))],
)
async def schedule_nexus_backup_restore_drill(
    job_id: str,
    payload: RestoreDrillCreate,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Record recovery assurance intent without running a restore.

    An isolated restore cannot be simulated by a UI acknowledgement.  This
    route therefore creates an auditable planned drill only; a future reviewed
    recovery worker must attach immutable evidence before any proof state may
    change.
    """

    job = await assert_tenant_record_scope(
        user, db.nexus_backup_jobs, job_id,
        operation="nexus-backup.restore-drill.schedule", request=request, resource_name="Nexus Backup job",
    )
    if payload.idempotency_key:
        existing = await db.nexus_backup_restore_drills.find_one(
            tenant_scoped_query(user, {"job_id": job_id, "idempotency_key": payload.idempotency_key}), {"_id": 0}
        )
        if existing:
            return {"restore_drill": public_restore_drill(existing), "message": "Existing idempotent restore drill returned."}
    now = utc_now()
    drill = {
        "id": f"nbr-{uuid.uuid4().hex}",
        "tenant_id": platform_tenant_id(user),
        "client_id": job.get("client_id"),
        "site_id": job.get("site_id"),
        "device_id": job.get("device_id"),
        "job_id": job_id,
        "drill_type": payload.drill_type,
        "scheduled_for": payload.scheduled_for,
        "state": "planned",
        "proof_state": "not_proven",
        "execution_allowed": False,
        "idempotency_key": payload.idempotency_key,
        "created_at": now,
        "updated_at": now,
        "created_by": user.get("id") or user.get("email") or "unknown",
        "version": 1,
    }
    await db.nexus_backup_restore_drills.insert_one(drill)
    await _record_event(
        user=user, request=request, event_type="restore_drill_planned", entity_type="nexus_backup_restore_drill",
        entity_id=drill["id"], client_id=str(job.get("client_id")), site_id=job.get("site_id"), device_id=job.get("device_id"),
        detail="Planned a governed native Backup restore drill. No restore was executed.",
        metadata={"job_id": job_id, "drill_type": payload.drill_type, "proof_state": "not_proven"},
    )
    return {"restore_drill": public_restore_drill(drill), "message": "Restore drill planned. Nexus will not claim recovery proof until an isolated restore worker records verified evidence."}


@router.post(
    "/nexus-backup/restore-drills/{drill_id}/cancel",
    dependencies=[Depends(require_action("backup.native.restore.verify"))],
)
async def cancel_nexus_backup_restore_drill(
    drill_id: str,
    payload: VersionedPreflight,
    request: Request,
    user: dict = Depends(get_current_user),
):
    drill = await assert_tenant_record_scope(
        user, db.nexus_backup_restore_drills, drill_id,
        operation="nexus-backup.restore-drill.cancel", request=request, resource_name="Nexus Backup restore drill",
    )
    if int(drill.get("version") or 1) != payload.expected_version:
        raise HTTPException(status_code=409, detail="The restore drill changed in another session. Refresh before cancelling.")
    if drill.get("state") != "planned":
        raise HTTPException(status_code=422, detail="Only a planned restore drill can be cancelled.")
    now = utc_now()
    result = await db.nexus_backup_restore_drills.update_one(
        tenant_scoped_query(user, {"id": drill_id, "version": payload.expected_version}),
        {"$set": {"state": "cancelled", "updated_at": now}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="The restore drill changed in another session. Refresh before cancelling.")
    refreshed = {**drill, "state": "cancelled", "updated_at": now, "version": payload.expected_version + 1}
    await _record_event(
        user=user, request=request, event_type="restore_drill_cancelled", entity_type="nexus_backup_restore_drill",
        entity_id=drill_id, client_id=str(drill.get("client_id")), site_id=drill.get("site_id"), device_id=drill.get("device_id"),
        detail="Cancelled a planned native Backup restore drill before execution.", metadata={"job_id": drill.get("job_id")},
    )
    return {"restore_drill": public_restore_drill(refreshed), "message": "Restore drill cancelled. No restore was executed."}


@router.post(
    "/nexus-backup/jobs/{job_id}/capture",
    dependencies=[Depends(require_action("backup.native.capture.request"))],
)
async def request_nexus_backup_capture(
    job_id: str,
    payload: VersionedPreflight,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Fail closed until a dedicated, reviewed data plane exists.

    The route is intentionally present so automation and UI do not need a
    dangerous later API rewrite; it records the request as blocked rather than
    silently using generic agent commands or file transfer.
    """

    job = await assert_tenant_record_scope(
        user, db.nexus_backup_jobs, job_id,
        operation="nexus-backup.capture.request", request=request, resource_name="Nexus Backup job",
    )
    if int(job.get("version") or 1) != payload.expected_version:
        raise HTTPException(status_code=409, detail="The workload intent changed in another session. Refresh before requesting capture.")
    device, destination, readiness = await _load_readiness(
        user, client_id=str(job.get("client_id")), device_id=str(job.get("device_id")), destination_id=job.get("destination_id")
    )
    if payload.idempotency_key and payload.idempotency_key == job.get("last_capture_request_key"):
        return {
            "workload_intent": public_protection_intent(job, readiness),
            "status": "blocked",
            "external_changes": False,
            "message": "Existing idempotent capture request returned. Nexus did not start a capture.",
        }
    now = utc_now()
    result = await db.nexus_backup_jobs.update_one(
        tenant_scoped_query(user, {"id": job_id, "version": payload.expected_version}),
        {"$set": {
            "state": "blocked",
            "execution_allowed": False,
            "last_capture_request_at": now,
            "last_capture_request_key": payload.idempotency_key,
            "updated_at": now,
        }, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="The workload intent changed in another session. Refresh before requesting capture.")
    refreshed = {**job, "state": "blocked", "execution_allowed": False, "last_capture_request_at": now, "updated_at": now, "version": payload.expected_version + 1}
    await _record_event(
        user=user,
        request=request,
        event_type="capture_blocked",
        entity_type="nexus_backup_job",
        entity_id=job_id,
        client_id=str(job.get("client_id")),
        site_id=job.get("site_id"),
        device_id=job.get("device_id"),
        detail="Capture request was blocked because the native Backup data plane is not released.",
        metadata={"execution_allowed": False, "destination_id": (destination or {}).get("id") if destination else None},
    )
    return {
        "workload_intent": public_protection_intent(refreshed, readiness),
        "status": "blocked",
        "external_changes": False,
        "message": "Nexus did not start a capture. A verified snapshot, transfer, immutable-storage, and restore data plane is required first.",
    }
