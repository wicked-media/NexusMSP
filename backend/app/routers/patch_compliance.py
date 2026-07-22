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


router = APIRouter()
TRUSTED_SOURCES = {"nexus-agent", "rmm-agent", "agent", "api-agent", "provider"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _agent_source(device: dict) -> str | None:
    source = str(device.get("source") or device.get("telemetry_source") or "").lower()
    if source in TRUSTED_SOURCES:
        return source
    if device.get("nexus_agent_id"):
        return "nexus-agent"
    if device.get("last_heartbeat"):
        return "api-agent"
    return None


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


async def _observed_devices() -> list[dict]:
    devices = await db.devices.find({}, {"_id": 0}).to_list(1000)
    trusted_devices = [device for device in devices if _agent_source(device)]
    ids = [device.get("id") for device in trusted_devices if device.get("id")]
    patch_rows = await db.device_patches.find({"device_id": {"$in": ids}}, {"_id": 0}).to_list(5000) if ids else []
    pending_by_device: dict[str, list[dict]] = {}
    for patch in patch_rows:
        source = str(patch.get("source") or "").lower()
        if source not in TRUSTED_SOURCES and source != "windows-update-agent":
            continue
        if str(patch.get("status") or "").lower() != "pending":
            continue
        pending_by_device.setdefault(str(patch.get("device_id") or ""), []).append(patch)

    observed = []
    for device in trusted_devices:
        device_id = str(device.get("id") or "")
        reported_pending = _safe_number(device.get("pending_patches"))
        patch_rows_for_device = pending_by_device.get(device_id, [])
        # A counted patch record is stronger evidence than a summary count.
        pending_count = len(patch_rows_for_device) if patch_rows_for_device else reported_pending
        if pending_count is None:
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
    policies, legacy_unverified = await _policy_rows()
    devices = await _observed_devices()
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
        "devices": devices,
        "message": "No agent-reported patch state is available yet." if not assessed else "Patch state is based on the most recent trusted agent observation.",
    }


@router.get("/patch-compliance/rings")
async def get_patch_rings(current_user: dict = Depends(get_current_user)):
    policies, _ = await _policy_rows()
    devices = await _observed_devices()
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


@router.post("/patch-compliance/policies")
async def create_patch_policy(data: dict, current_user: dict = Depends(get_current_user)):
    policy = {
        "id": f"pp-{uuid.uuid4().hex[:10]}",
        **_validate_policy(data),
        "source": "manual",
        "created_at": _now(),
        "confirmed_at": _now(),
        "created_by": current_user.get("name") or current_user.get("email") or current_user.get("id", ""),
    }
    await db.patch_compliance.insert_one(policy)
    return _policy_view(policy)


@router.put("/patch-compliance/policies/{policy_id}")
async def update_patch_policy(policy_id: str, data: dict, current_user: dict = Depends(get_current_user)):
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
    return _policy_view({**existing, **update})


@router.delete("/patch-compliance/policies/{policy_id}")
async def delete_patch_policy(policy_id: str, current_user: dict = Depends(get_current_user)):
    existing = await db.patch_compliance.find_one({"id": policy_id}, {"_id": 0})
    if not existing or not _confirmed_policy(existing):
        raise HTTPException(status_code=404, detail="Confirmed policy record not found")
    await db.patch_compliance.delete_one({"id": policy_id})
    return {"message": "Policy record removed", "id": policy_id}
