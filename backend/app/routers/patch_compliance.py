"""Patch evidence and policy register.

NexusMSP can report the patch observations supplied by enrolled agents and keep
an auditable policy register.  It does not create sample rollout rings or claim
that a configuration has deployed patches until an execution provider exists.
"""

from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_global_scope, effective_scope, scoped_query


router = APIRouter()
# Patch compliance is a statement about evidence, not a convenient view of
# whatever happens to be present in the devices collection.  The compact
# Nexus Agent heartbeat is the primary source today; a future verified RMM
# provider can use the same contract without making browser-created data look
# like endpoint evidence.
TRUSTED_SOURCES = {"nexus-agent", "rmm-agent", "provider"}
FRESH_OBSERVATION_SECONDS = 15 * 60


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _agent_source(device: dict) -> str | None:
    source = str(device.get("source") or device.get("telemetry_source") or "").lower()
    if source in TRUSTED_SOURCES:
        return source
    if device.get("nexus_agent_id"):
        return "nexus-agent"
    return None


def _parse_observed_at(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _observation_state(device: dict, *, now: datetime | None = None) -> tuple[str, str | None]:
    """Return patch-evidence freshness, never generic heartbeat freshness."""
    now = now or datetime.now(timezone.utc)
    if str(device.get("patch_evidence_state") or "").lower() != "reported":
        return "not_assessed", None
    if str(device.get("patch_evidence_source") or "").lower() not in TRUSTED_SOURCES:
        return "not_assessed", None
    observed = _parse_observed_at(device.get("patch_evidence_observed_at"))
    if observed is None:
        return "not_assessed", None
    age_seconds = (now - observed).total_seconds()
    # A client- or provider-supplied future time must not turn uncertain data
    # into a valid compliance assessment.
    if age_seconds < -60:
        return "not_assessed", None
    state = "assessed" if age_seconds <= FRESH_OBSERVATION_SECONDS else "stale"
    return state, observed.isoformat()


def _confirmed_policy(policy: dict) -> bool:
    return str(policy.get("source") or "").lower() == "manual" and bool(policy.get("confirmed_at"))


def _safe_number(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


async def _observed_devices(current_user: dict) -> list[dict]:
    # Device IDs are the server-side access boundary for older child patch
    # collections which do not consistently carry client_id themselves.
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(1000)
    trusted_devices = [device for device in devices if _agent_source(device)]

    observed = []
    for device in trusted_devices:
        device_id = str(device.get("id") or "")
        assessment_state, observed_at = _observation_state(device)
        reported_pending = _safe_number(device.get("pending_patches"))
        # The signed agent's current summary is authoritative for compliance.
        # Detailed child rows remain diagnostic evidence, but may lag or be
        # absent, so they must never replace a reported zero with a stale count.
        pending_count = reported_pending
        if assessment_state != "assessed":
            # Keep old observations visible as stale, but never include them
            # in the compliance numerator or present them as current.
            patch_status = "stale" if assessment_state == "stale" else "not_assessed"
            pending_count = None
        elif pending_count is None:
            assessment_state = "not_assessed"
            patch_status = "not_assessed"
        elif pending_count == 0:
            assessment_state = "assessed"
            patch_status = "current"
        else:
            assessment_state = "assessed"
            # The agent's compact payload does not currently carry CVSS
            # severity, so pending updates must not be labelled critical.
            patch_status = "needs_attention"
        observed.append({
            "id": device_id,
            "name": device.get("name") or device.get("hostname") or "Unnamed device",
            "client_name": device.get("client_name", ""),
            "os": device.get("os") or device.get("os_name") or "",
            "source": _agent_source(device),
            "last_seen": device.get("last_seen") or device.get("last_heartbeat"),
            "patch_ring": str(device.get("patch_ring") or ""),
            "pending_patches": pending_count,
            "patch_status": patch_status,
            "assessment_state": assessment_state,
            "observed_at": observed_at,
        })
    return observed


async def _policy_rows() -> tuple[list[dict], int]:
    rows = await db.patch_compliance.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    confirmed = [row for row in rows if _confirmed_policy(row)]
    legacy_unverified = len(rows) - len(confirmed)
    return confirmed, legacy_unverified


def _policy_view(policy: dict) -> dict:
    return {
        **policy,
        "enforcement_state": "not_deployed",
        "enforcement_message": "This is an auditable policy record. Connect a patch execution provider before it can deploy updates.",
    }


@router.get("/patch-compliance/overview")
async def get_patch_compliance(current_user: dict = Depends(get_current_user)):
    can_view_global_policy = effective_scope(current_user)["mode"] == "all"
    policies, legacy_unverified = await _policy_rows() if can_view_global_policy else ([], 0)
    devices = await _observed_devices(current_user)
    assessed = [device for device in devices if device["assessment_state"] == "assessed"]
    current = sum(1 for device in assessed if device["patch_status"] == "current")
    needs_attention = sum(1 for device in assessed if device["patch_status"] == "needs_attention")
    return {
        "summary": {
            "total_devices": len(devices),
            "assessed_devices": len(assessed),
            "compliant": current,
            "needs_attention": needs_attention,
            "critical": 0,
            "compliance_pct": round((current / len(assessed)) * 100, 1) if assessed else None,
            "evidence_state": "assessed" if assessed else "not_assessed",
            "legacy_unverified_policies": legacy_unverified,
        },
        "policies": [_policy_view(policy) for policy in policies],
        "policy_register_access": can_view_global_policy,
        "devices": devices,
        "message": (
            "No fresh agent-reported patch state is available yet."
            if not assessed
            else "Patch state is based on the most recent trusted agent observation."
        ) + (" Global policy records are visible only to authorised global operators." if not can_view_global_policy else ""),
    }


@router.get("/patch-compliance/rings")
async def get_patch_rings(current_user: dict = Depends(get_current_user)):
    if effective_scope(current_user)["mode"] != "all":
        # Rollout policies are organisation-wide configuration, not a customer
        # data source.  Restricted technicians retain their scoped evidence
        # view but cannot infer other customers' deployment strategy.
        return []
    policies, _ = await _policy_rows()
    devices = await _observed_devices(current_user)
    ring_names = sorted({str(policy.get("ring") or "").strip() for policy in policies if str(policy.get("ring") or "").strip()})
    rings = []
    for ring in ring_names:
        ring_policies = [policy for policy in policies if policy.get("ring") == ring]
        ring_devices = [device for device in devices if str(device.get("patch_ring") or "") == ring]
        rings.append({
            "id": ring.lower().replace(" ", "-") or str(uuid.uuid4()),
            "name": ring,
            "description": f"{len(ring_policies)} confirmed policy record(s); deployment requires a connected execution provider.",
            "delay_days": min((_safe_number(policy.get("delay_days")) or 0 for policy in ring_policies), default=0),
            "device_count": len(ring_devices),
            "auto_approve": any(bool(policy.get("auto_approve")) for policy in ring_policies),
            "enforcement_state": "not_deployed",
        })
    return rings


def _validate_policy(data: dict) -> dict:
    name = str(data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Policy name is required")
    delay = _safe_number(data.get("delay_days", 0))
    if delay is None or delay > 365:
        raise HTTPException(status_code=400, detail="Delay must be between 0 and 365 days")
    return {
        "name": name,
        "os_filter": str(data.get("os_filter") or "All operating systems").strip(),
        "severity_filter": str(data.get("severity_filter") or "security").strip(),
        "ring": str(data.get("ring") or "").strip(),
        "delay_days": delay,
        "auto_approve": bool(data.get("auto_approve")),
        "enabled": bool(data.get("enabled", True)),
        "notes": str(data.get("notes") or "").strip()[:2000],
    }


@router.post(
    "/patch-compliance/policies",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def create_patch_policy(data: dict, current_user: dict = Depends(get_current_user)):
    # Existing policy rows are tenant-wide configuration records, not
    # customer-scoped copies.  A restricted technician must not create or
    # alter a global rollout rule from a single customer's context.
    await assert_global_scope(current_user, operation="patch_policy.create")
    policy = {
        "id": f"pp-{uuid.uuid4().hex[:10]}",
        **_validate_policy(data),
        "source": "manual",
        "created_at": _now(),
        "confirmed_at": _now(),
        "created_by": current_user.get("name") or current_user.get("email") or current_user.get("id", ""),
    }
    await db.patch_compliance.insert_one(policy)
    await log_activity(
        current_user,
        "created",
        "patch_policy",
        policy["id"],
        policy["name"],
        "Created a confirmed global patch-policy record.",
        metadata={"ring": policy["ring"], "execution_state": "not_deployed"},
    )
    return _policy_view(policy)


@router.put(
    "/patch-compliance/policies/{policy_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def update_patch_policy(policy_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="patch_policy.update")
    existing = await db.patch_compliance.find_one({"id": policy_id}, {"_id": 0})
    if not existing or not _confirmed_policy(existing):
        raise HTTPException(status_code=404, detail="Confirmed policy record not found")
    update = {
        **_validate_policy({**existing, **data}),
        "confirmed_at": _now(),
        "updated_at": _now(),
        "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id", ""),
    }
    await db.patch_compliance.update_one({"id": policy_id}, {"$set": update})
    await log_activity(
        current_user,
        "updated",
        "patch_policy",
        policy_id,
        str(existing.get("name") or policy_id),
        "Updated a confirmed global patch-policy record.",
        changes={key: {"old": existing.get(key), "new": update.get(key)} for key in update if existing.get(key) != update.get(key)},
        metadata={"execution_state": "not_deployed"},
    )
    return _policy_view({**existing, **update})


@router.delete(
    "/patch-compliance/policies/{policy_id}",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def delete_patch_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="patch_policy.delete")
    existing = await db.patch_compliance.find_one({"id": policy_id}, {"_id": 0})
    if not existing or not _confirmed_policy(existing):
        raise HTTPException(status_code=404, detail="Confirmed policy record not found")
    await db.patch_compliance.delete_one({"id": policy_id})
    await log_activity(
        current_user,
        "deleted",
        "patch_policy",
        policy_id,
        str(existing.get("name") or policy_id),
        "Deleted a confirmed global patch-policy record.",
        metadata={"execution_state": "not_deployed"},
    )
    return {"message": "Policy record removed", "id": policy_id}
