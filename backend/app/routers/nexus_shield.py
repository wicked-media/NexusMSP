"""Nexus Shield endpoint-protection management plane.

This router deliberately distinguishes verified Nexus Agent evidence from
monitoring policy.  It must never claim that a device has been remediated or
isolated merely because a desired control is enabled in the workspace.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db

router = APIRouter()

POLICY_KEY = "nexus_shield_policies"

DEFAULT_POLICIES = [
    {
        "id": "defender_health",
        "name": "Microsoft Defender health",
        "description": "Alert when an assessed Windows endpoint reports Defender or real-time protection inactive.",
        "evidence": "Nexus Agent security telemetry",
        "enabled": True,
        "mode": "monitor",
    },
    {
        "id": "firewall_posture",
        "name": "Firewall posture",
        "description": "Keep agent-reported Windows firewall state visible in the Shield response queue.",
        "evidence": "Nexus Agent security telemetry",
        "enabled": True,
        "mode": "monitor",
    },
    {
        "id": "encryption_posture",
        "name": "Disk encryption posture",
        "description": "Highlight assessed endpoints that do not report encrypted local storage.",
        "evidence": "Nexus Agent security telemetry",
        "enabled": True,
        "mode": "monitor",
    },
    {
        "id": "patch_exposure",
        "name": "Patch exposure",
        "description": "Surface endpoints with a critical update backlog for technician review.",
        "evidence": "Nexus Agent update telemetry",
        "enabled": True,
        "mode": "monitor",
    },
    {
        "id": "nexus_canary",
        "name": "Nexus Canary integrity detection",
        "description": "Deploy and track protected decoy files. A changed or missing file creates an auditable response signal.",
        "evidence": "Nexus Agent canary loop",
        "enabled": True,
        "mode": "active_detection",
    },
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_policies() -> list[dict[str, Any]]:
    stored = await db.settings.find_one({"key": POLICY_KEY}, {"_id": 0}) or {}
    stored_by_id = {
        item.get("id"): item
        for item in ((stored.get("value") or {}).get("policies") or [])
        if isinstance(item, dict) and item.get("id")
    }
    return [{**policy, **{"enabled": bool(stored_by_id.get(policy["id"], {}).get("enabled", policy["enabled"]))}} for policy in DEFAULT_POLICIES]


def _device_risks(device: dict[str, Any]) -> list[dict[str, Any]]:
    """Generate evidence-based response items without inventing device state."""
    if not device.get("security_assessed_at"):
        return []
    risks: list[dict[str, Any]] = []
    name = device.get("name") or device.get("hostname") or device.get("id", "Endpoint")
    common = {"device_id": device.get("id"), "device_name": name, "client_id": device.get("client_id"), "client_name": device.get("client_name") or "Unassigned client"}
    if device.get("antivirus_status") != "active" or not device.get("defender_real_time_enabled"):
        risks.append({**common, "id": f"{device.get('id')}:defender", "control": "Defender health", "severity": "high", "reason": "Microsoft Defender real-time protection reports inactive."})
    if not device.get("firewall_enabled"):
        risks.append({**common, "id": f"{device.get('id')}:firewall", "control": "Firewall posture", "severity": "high", "reason": "The endpoint reports its firewall is not enabled."})
    encryption = str(device.get("encryption_status") or "").lower()
    if not any(marker in encryption for marker in ("encrypted", "bitlocker on", "protection on")):
        risks.append({**common, "id": f"{device.get('id')}:encryption", "control": "Disk encryption", "severity": "medium", "reason": "The endpoint does not report encrypted local storage."})
    if int(device.get("pending_patches") or 0) > 10:
        risks.append({**common, "id": f"{device.get('id')}:patches", "control": "Patch exposure", "severity": "medium", "reason": f"{int(device.get('pending_patches') or 0)} pending updates reported by the agent."})
    return risks


@router.get("/nexus-shield/overview")
async def get_nexus_shield_overview(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    canaries = await db.ransomware_canaries.find({"deployment_source": "nexus-agent"}, {"_id": 0}).to_list(5000)
    canary_ids = [canary.get("id") for canary in canaries if canary.get("id")]
    triggers = await db.canary_triggers.find(
        {"canary_id": {"$in": canary_ids}, "resolved": False}, {"_id": 0}
    ).sort("triggered_at", -1).to_list(100) if canary_ids else []
    policies = await _get_policies()
    enabled_policies = {policy["id"] for policy in policies if policy.get("enabled")}

    enrolled = [device for device in devices if device.get("nexus_agent_id")]
    assessed = [device for device in devices if device.get("security_assessed_at")]
    risk_queue = []
    for device in devices:
        for risk in _device_risks(device):
            policy_id = {"Defender health": "defender_health", "Firewall posture": "firewall_posture", "Disk encryption": "encryption_posture", "Patch exposure": "patch_exposure"}.get(risk.get("control"))
            if policy_id in enabled_policies:
                risk_queue.append(risk)
    if "nexus_canary" in enabled_policies:
        for trigger in triggers:
            risk_queue.append({
                "id": trigger.get("id"), "control": "Nexus Canary", "severity": "critical",
                "reason": trigger.get("reason") or "Canary integrity changed.",
                "device_id": trigger.get("device_id"), "device_name": trigger.get("device_name") or "Managed endpoint",
                "client_id": trigger.get("client_id"), "client_name": trigger.get("client_name") or "Unassigned client",
                "trigger_id": trigger.get("id"), "triggered_at": trigger.get("triggered_at"),
            })
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    risk_queue.sort(key=lambda item: (severity_order.get(item.get("severity"), 9), item.get("device_name") or ""))

    return {
        "generated_at": _now(),
        "coverage": {
            "managed_assets": len(devices),
            "agent_enrolled": len(enrolled),
            "shield_enrolled": sum(1 for item in devices if item.get("nexus_shield_enabled")),
            "agent_verified": len(assessed),
            "defender_healthy": sum(1 for item in assessed if item.get("antivirus_status") == "active" and item.get("defender_real_time_enabled")),
            "firewall_enabled": sum(1 for item in assessed if item.get("firewall_enabled")),
            "encrypted": sum(1 for item in assessed if any(marker in str(item.get("encryption_status") or "").lower() for marker in ("encrypted", "bitlocker on", "protection on"))),
        },
        "canary": {
            "deployed": len(canaries),
            "healthy": sum(1 for item in canaries if item.get("status") == "healthy"),
            "pending": sum(1 for item in canaries if item.get("status") in {"queued", "active"}),
            "triggered": sum(1 for item in canaries if item.get("status") == "triggered"),
            "unresolved": len(triggers),
        },
        "policies": policies,
        "risk_queue": risk_queue[:100],
        "capability_note": "Nexus Shield currently provides Nexus Agent-verified posture evidence, active Nexus Canary integrity detection, and auditable response workflows. Endpoint enforcement is intentionally not represented as active until a separately reviewed agent control is installed.",
    }


@router.get("/nexus-shield/policies")
async def get_nexus_shield_policies(current_user: dict = Depends(get_current_user)):
    return {"policies": await _get_policies(), "updated_at": _now()}


@router.put("/nexus-shield/policies")
async def update_nexus_shield_policies(data: dict[str, Any], current_user: dict = Depends(get_current_user)):
    incoming = data.get("policies") or []
    if not isinstance(incoming, list):
        raise HTTPException(status_code=422, detail="Policies must be provided as a list")
    valid_ids = {policy["id"] for policy in DEFAULT_POLICIES}
    updates: list[dict[str, Any]] = []
    for item in incoming:
        if not isinstance(item, dict) or item.get("id") not in valid_ids:
            raise HTTPException(status_code=422, detail="One or more Nexus Shield policies are invalid")
        updates.append({"id": item["id"], "enabled": bool(item.get("enabled"))})
    await db.settings.update_one(
        {"key": POLICY_KEY},
        {"$set": {"key": POLICY_KEY, "value": {"policies": updates}, "updated_at": _now(), "updated_by": current_user.get("id")}},
        upsert=True,
    )
    return {"message": "Nexus Shield monitoring policies saved", "policies": await _get_policies()}
