"""Native Nexus Backup control-plane policy.

This module deliberately owns *intent and evidence*, not customer bytes.  A
Nexus Backup policy can be reviewed and assigned to a stable endpoint now, but
no route or service in this module reads endpoint files, creates a snapshot,
transports data, or claims that a device is protected.  That boundary keeps the
first native release useful without turning an unfinished data plane into a
recovery promise.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


WORKLOAD_TYPES = frozenset({"endpoint_files", "system_image", "server_application"})
SOURCE_PROFILES = frozenset({"user_data", "business_data", "full_device", "application_aware"})
SCHEDULES = frozenset({"daily", "weekly"})
REPOSITORY_TYPES = frozenset({"nexus_backup_vault", "s3_compatible", "managed_repository"})

# These identifiers describe the product roadmap.  Only the first may be
# reported by the agent capability-inventory release; all execution-capable IDs
# stay reserved until their data-plane implementation and release evidence exist.
CAPABILITY_INVENTORY_V1 = "nexus_backup_capability_v1"
CAPABILITY_PREFLIGHT_V1 = "nexus_backup_preflight_v1"
RESERVED_EXECUTION_CAPABILITIES = (
    "nexus_backup_vss_snapshot_v1",
    "nexus_backup_incremental_v1",
    "nexus_backup_restore_v1",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_repository(repository: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return non-secret repository metadata only.

    Connection credentials, key material, raw provider URLs, and private object
    paths are intentionally not part of this control-plane record.
    """

    if not repository:
        return None
    return {
        "id": repository.get("id"),
        "client_id": repository.get("client_id"),
        "destination_type": repository.get("destination_type"),
        "destination_name": repository.get("destination_name"),
        "status": repository.get("status", "not_configured"),
        "encryption_attested": bool(repository.get("encryption_attested")),
        "immutable_storage_attested": bool(repository.get("immutable_storage_attested")),
        "restore_verification_attested": bool(repository.get("restore_verification_attested")),
        "verification_state": repository.get("verification_state", "not_verified"),
        "connection_state": repository.get("connection_state", "not_configured"),
        "connector_evidence": {
            "state": (repository.get("connector_evidence") or {}).get("state"),
            "reason_code": (repository.get("connector_evidence") or {}).get("reason_code"),
            "verified_at": (repository.get("connector_evidence") or {}).get("verified_at"),
        } if isinstance(repository.get("connector_evidence"), dict) else None,
        "execution_allowed": False,
        "updated_at": repository.get("updated_at"),
        "version": int(repository.get("version") or 1),
    }

def repository_readiness(repository: dict[str, Any] | None) -> dict[str, Any]:
    """Explain why a repository is not a verified backup destination yet."""

    if not repository:
        return {
            "state": "not_configured",
            "label": "Repository not configured",
            "execution_allowed": False,
            "blockers": ["Configure a client-scoped destination before assigning native backup intent."],
        }

    missing = []
    if not repository.get("encryption_attested"):
        missing.append("Encryption has not been attested for this destination.")
    if not repository.get("immutable_storage_attested"):
        missing.append("Immutable retention has not been attested for this destination.")
    if not repository.get("restore_verification_attested"):
        missing.append("A restore-verification plan has not been attested for this destination.")
    if missing:
        return {
            "state": "incomplete_attestation",
            "label": "Repository attestation incomplete",
            "execution_allowed": False,
            "blockers": missing,
        }

    if repository.get("verification_state") == "verified":
        return {
            "state": "verified_no_capture_engine",
            "label": "Immutable vault verified, capture engine not released",
            "execution_allowed": False,
            "blockers": [
                "Nexus verified immutable storage, but the endpoint snapshot and encrypted-transfer data plane is not released.",
            ],
        }

    # Operator attestation is not a storage health check.  The native storage
    # connector must write independent evidence before this becomes verified.
    return {
        "state": "attested_not_verified",
        "label": "Repository attested, connector not verified",
        "execution_allowed": False,
        "blockers": [
            "Nexus has not yet verified an encrypted, immutable storage connector for this destination.",
        ],
    }


def agent_backup_readiness(device: dict[str, Any] | None) -> dict[str, Any]:
    """Assess only the endpoint's reported, non-authoritative capability state."""

    if not device or not device.get("nexus_agent_id"):
        return {
            "state": "agent_not_enrolled",
            "label": "Nexus Agent not enrolled",
            "execution_allowed": False,
            "blockers": ["Enroll the Nexus Agent on this endpoint before native Backup can assess capability."],
        }

    runtime = {
        str(value).strip()
        for value in (device.get("agent_runtime_capabilities") or [])
        if isinstance(value, str) and value.strip()
    }
    evidence = device.get("nexus_backup_evidence") if isinstance(device.get("nexus_backup_evidence"), dict) else {}
    evidence_state = str(evidence.get("state") or "not_reported")
    if CAPABILITY_INVENTORY_V1 not in runtime:
        return {
            "state": "capability_not_reported",
            "label": "Backup capability inventory not reported",
            "execution_allowed": False,
            "blockers": ["Install an agent release that reports the Nexus Backup capability inventory."],
        }
    if evidence_state not in {"inventory_only", "blocked", "unsupported"}:
        return {
            "state": "evidence_not_reported",
            "label": "Backup capability evidence not reported",
            "execution_allowed": False,
            "blockers": ["Wait for a fresh Nexus Backup capability report from the enrolled endpoint."],
        }

    # Capability inventory intentionally stops before file, snapshot, transport
    # or restore work.  Never represent it as protection.
    return {
        "state": "inventory_only",
        "label": "Capability inventory only",
        "execution_allowed": False,
        "observed_at": evidence.get("observed_at") or evidence.get("reported_at"),
        "blockers": [
            "This agent can report Backup readiness only; snapshot, transfer, and restore execution are not released.",
        ],
    }


def protection_readiness(
    *,
    repository: dict[str, Any] | None,
    device: dict[str, Any] | None,
) -> dict[str, Any]:
    """Combine repository and endpoint evidence without upgrading uncertainty."""

    repository_state = repository_readiness(repository)
    agent_state = agent_backup_readiness(device)
    blockers = [*repository_state["blockers"], *agent_state["blockers"]]
    return {
        "state": "blocked",
        "label": "Execution not released",
        "execution_allowed": False,
        "repository": repository_state,
        "agent": agent_state,
        "blockers": blockers,
        "summary": "Nexus recorded a protected-workload intent. No customer data has been read, copied, or declared protected.",
    }


def capture_release_readiness(
    *,
    intent: dict[str, Any],
    repository: dict[str, Any] | None,
    device: dict[str, Any] | None,
) -> dict[str, Any]:
    """Explain the release gates for a real capture without ever enabling one.

    This is deliberately independent from the operator's requested policy.
    A valid policy and a healthy vault are necessary evidence, not authority to
    read endpoint data.  The signed capture worker has not been released.
    """

    blockers: list[str] = []
    repository_state = repository_readiness(repository)
    if repository_state["state"] != "verified_no_capture_engine":
        blockers.extend(repository_state["blockers"])
    runtime = {
        str(value).strip()
        for value in ((device or {}).get("agent_runtime_capabilities") or [])
        if isinstance(value, str) and value.strip()
    }
    preflight = intent.get("preflight_result") if isinstance(intent.get("preflight_result"), dict) else {}
    if CAPABILITY_PREFLIGHT_V1 not in runtime:
        blockers.append("The endpoint has not reported the dedicated Nexus Backup preflight capability.")
    if preflight.get("status") != "inventory_only":
        blockers.append("A fresh lease-bound capability preflight has not completed for this workload intent.")
    blockers.extend([
        "The signed capture worker is not released.",
        "Client envelope-encryption key handling is not released.",
        "Resumable encrypted chunk manifests and immutable retention checks are not released.",
        "An isolated restore verification workflow is not released.",
    ])
    return {
        "state": "blocked",
        "execution_allowed": False,
        "blockers": blockers,
        "required_worker_capabilities": [
            "nexus_backup_vss_snapshot_v1",
            "nexus_backup_incremental_v1",
            "nexus_backup_restore_v1",
        ],
    }


def public_policy(policy: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": policy.get("id"),
        "tenant_id": policy.get("tenant_id"),
        "client_id": policy.get("client_id"),
        "site_id": policy.get("site_id"),
        "name": policy.get("name"),
        "workload_type": policy.get("workload_type"),
        "source_profile": policy.get("source_profile"),
        "schedule": policy.get("schedule"),
        "retention_days": int(policy.get("retention_days") or 0),
        "rpo_hours": int(policy.get("rpo_hours") or 0),
        "state": policy.get("state", "draft"),
        "updated_at": policy.get("updated_at"),
        "version": int(policy.get("version") or 1),
    }


def public_protection_intent(
    intent: dict[str, Any],
    readiness: dict[str, Any],
    capture_release: dict[str, Any] | None = None,
) -> dict[str, Any]:
    preflight = intent.get("preflight_result") if isinstance(intent.get("preflight_result"), dict) else {}
    preflight_evidence = preflight.get("evidence") if isinstance(preflight.get("evidence"), dict) else {}
    return {
        "id": intent.get("id"),
        "tenant_id": intent.get("tenant_id"),
        "client_id": intent.get("client_id"),
        "site_id": intent.get("site_id"),
        "device_id": intent.get("device_id"),
        "policy_id": intent.get("policy_id"),
        "state": intent.get("state", "planned"),
        "created_at": intent.get("created_at"),
        "updated_at": intent.get("updated_at"),
        "last_preflight_at": intent.get("last_preflight_at"),
        "preflight": {
            "status": preflight.get("status"),
            "requested_at": intent.get("last_preflight_requested_at"),
            "completed_at": intent.get("last_preflight_at"),
            "platform": preflight_evidence.get("platform"),
            "vss_state": preflight_evidence.get("vss_state"),
            "volume_capacity_state": preflight_evidence.get("volume_capacity_state"),
        },
        "capture_release": capture_release or {"state": "blocked", "execution_allowed": False, "blockers": []},
        "version": int(intent.get("version") or 1),
        "readiness": readiness,
    }


def public_restore_drill(drill: dict[str, Any]) -> dict[str, Any]:
    """Project recovery-drill governance without claiming a recovery occurred."""

    return {
        "id": drill.get("id"),
        "tenant_id": drill.get("tenant_id"),
        "client_id": drill.get("client_id"),
        "site_id": drill.get("site_id"),
        "device_id": drill.get("device_id"),
        "job_id": drill.get("job_id"),
        "drill_type": drill.get("drill_type"),
        "state": drill.get("state", "planned"),
        "scheduled_for": drill.get("scheduled_for"),
        "created_at": drill.get("created_at"),
        "updated_at": drill.get("updated_at"),
        "version": int(drill.get("version") or 1),
        "execution_allowed": False,
        "proof_state": "not_proven",
    }

