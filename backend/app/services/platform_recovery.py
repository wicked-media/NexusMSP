"""Contracts for Nexus Core continuity and fresh-host recovery planning.

The API owns recovery policy and evidence metadata.  It intentionally does not
run ``mongodump``/``mongorestore`` or overwrite a live database: those actions
belong to the separately reviewed host recovery runner where volumes, object
storage, secrets and maintenance controls can be handled safely.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


RECOVERY_DESTINATIONS = (
    {"id": "nexus_backup_vault", "label": "Nexus Backup Vault"},
    {"id": "object_lock_storage", "label": "Object Lock storage"},
    {"id": "managed_backup_repository", "label": "Managed backup repository"},
    {"id": "other_approved", "label": "Other approved encrypted destination"},
)
RECOVERY_DESTINATION_IDS = frozenset(item["id"] for item in RECOVERY_DESTINATIONS)

RECOVERY_COMPONENTS = (
    {
        "id": "mongodb",
        "label": "MongoDB application data",
        "required": True,
        "detail": "NexusMSP’s current authoritative operational and business-record store.",
    },
    {
        "id": "uploads",
        "label": "Private uploads and generated artefacts",
        "required": True,
        "detail": "Customer documents, attachments and generated records kept in Nexus persistent storage.",
    },
    {
        "id": "agent_installers",
        "label": "Nexus Agent installer artefacts",
        "required": True,
        "detail": "Persisted installer and deployment artefacts needed for a controlled recovery or re-enrolment.",
    },
    {
        "id": "release_manifest",
        "label": "Release and configuration manifest",
        "required": True,
        "detail": "Non-secret image/version and configuration identifiers used to rebuild a compatible target host.",
    },
)

REQUIRED_SECRET_IDENTIFIERS = (
    {
        "id": "NEXUS_SECRET_ENCRYPTION_KEY",
        "label": "Nexus secret-encryption key",
        "detail": "Required from the approved secret manager to decrypt existing encrypted provider credentials. Never place this key in a recovery package.",
    },
    {
        "id": "JWT_SECRET",
        "label": "Nexus authentication signing secret",
        "detail": "Retain or rotate through the approved incident plan; do not embed it in a portable package.",
    },
    {
        "id": "WEB_STUDIO_ENCRYPTION_KEY",
        "label": "Web Studio encryption key",
        "detail": "Required if encrypted Web Studio provider settings are expected to remain usable after the move.",
    },
)

RESTORE_RUN_STEPS = (
    "Install the approved Nexus release on an isolated host or database target.",
    "Obtain required secrets through the approved secret-management process; do not upload them to Nexus.",
    "Run the host recovery runner against the selected verified restore point into isolated data and volume paths.",
    "Compare Mongo collection counts, package checksums, upload and installer inventory, app health, scoped login and agent-heartbeat evidence.",
    "Record the isolated verification result; only then prepare a separately approved cutover window.",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_default_profile(*, actor: dict[str, Any], now: str | None = None) -> dict[str, Any]:
    now = now or utc_now()
    return {
        "id": "default",
        "enabled": False,
        "destination_type": "",
        "destination_name": "",
        "cadence": "daily",
        "rpo_hours": 24,
        "retention_days": 30,
        "immutable_storage_attested": False,
        "encryption_attested": False,
        "include_uploads": True,
        "include_agent_installers": True,
        "owner": "",
        "notes": "",
        "created_at": now,
        "created_by": actor.get("id") or actor.get("email") or "Nexus administrator",
        "updated_at": now,
        "updated_by": actor.get("id") or actor.get("email") or "Nexus administrator",
        "version": 1,
    }


def public_profile(profile: dict[str, Any] | None) -> dict[str, Any]:
    source = profile or {}
    return {
        "id": source.get("id") or "default",
        "enabled": bool(source.get("enabled")),
        "destination_type": str(source.get("destination_type") or ""),
        "destination_name": str(source.get("destination_name") or ""),
        "cadence": str(source.get("cadence") or "daily"),
        "rpo_hours": int(source.get("rpo_hours") or 24),
        "retention_days": int(source.get("retention_days") or 30),
        "immutable_storage_attested": bool(source.get("immutable_storage_attested")),
        "encryption_attested": bool(source.get("encryption_attested")),
        "include_uploads": bool(source.get("include_uploads", True)),
        "include_agent_installers": bool(source.get("include_agent_installers", True)),
        "owner": str(source.get("owner") or ""),
        "notes": str(source.get("notes") or ""),
        "updated_at": source.get("updated_at"),
        "updated_by": source.get("updated_by"),
        "version": int(source.get("version") or 1),
        "configured": bool(
            source.get("enabled")
            and source.get("destination_type")
            and source.get("destination_name")
            and source.get("immutable_storage_attested")
            and source.get("encryption_attested")
        ),
    }


def public_restore_point(point: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in point.items() if key not in {"_id", "host_runner_token", "secret_values"}}


def public_restore_run(run: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in run.items() if key not in {"_id", "host_runner_token", "secret_values"}}


def recovery_status(profile: dict[str, Any] | None, latest_point: dict[str, Any] | None, latest_run: dict[str, Any] | None) -> dict[str, Any]:
    safe_profile = public_profile(profile)
    if not safe_profile["configured"]:
        status = "not_configured"
        detail = "No attested off-host backup policy is configured yet. Nexus cannot claim that the platform is recoverable."
    elif not latest_point or latest_point.get("status") in {"awaiting_host_capture", "capture_failed"}:
        status = "capture_required"
        detail = "A policy exists, but no completed host-captured recovery point has been retained."
    elif not latest_run or latest_run.get("status") != "passed":
        status = "restore_verification_required"
        detail = "A recovery point is recorded, but an isolated restore verification has not passed."
    else:
        status = "verified"
        detail = "The latest recorded recovery point has passed an isolated verification. Continue to monitor RPO and retention evidence."
    return {"status": status, "detail": detail, "profile": safe_profile}


def restore_point_manifest_requirements() -> list[dict[str, Any]]:
    return [
        {"id": "package_checksum", "label": "Package checksum", "required": True},
        {"id": "collection_counts", "label": "Mongo collection counts", "required": True},
        {"id": "upload_inventory", "label": "Uploads inventory", "required": True},
        {"id": "installer_inventory", "label": "Installer inventory", "required": True},
        {"id": "release_manifest", "label": "Release manifest", "required": True},
        {"id": "secret_identifiers", "label": "Required secret identifiers only", "required": True},
    ]
