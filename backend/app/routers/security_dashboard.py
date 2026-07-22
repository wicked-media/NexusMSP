"""Compatibility endpoints for Security Dashboard consumers.

The primary Security Operations Center reads from the provider integrations directly.
These endpoints remain for API consumers, but only return persisted Nexus evidence —
never generated scores or invented threat history.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db

router = APIRouter()


def _is_open(record: dict) -> bool:
    return str(record.get("status") or "").lower() not in {"resolved", "closed", "remediated", "dismissed"}


@router.get("/security-dashboard/overview")
async def get_security_overview(current_user: dict = Depends(get_current_user)):
    """Return an evidence-backed security summary for legacy API consumers."""
    devices = await db.devices.find({}, {"_id": 0}).to_list(5000)
    assessed = [device for device in devices if device.get("security_assessed_at")]
    managed = [device for device in devices if device.get("nexus_agent_id")]
    assessed_scores = [
        float(device["compliance_score"])
        for device in assessed
        if isinstance(device.get("compliance_score"), (int, float))
    ]
    patched = sum(1 for device in assessed if int(device.get("pending_patches") or 0) == 0)
    soc_alerts = await db.soc_alerts.find({}, {"_id": 0}).to_list(5000)
    threat_events = await db.threat_events.find({}, {"_id": 0}).to_list(5000)
    active_alerts = [alert for alert in soc_alerts if _is_open(alert)]
    active_events = [event for event in threat_events if _is_open(event) and not event.get("resolved")]
    canary_triggers = await db.canary_triggers.count_documents({"resolved": False})
    incidents = sorted(
        [*active_alerts, *active_events],
        key=lambda item: item.get("created_at") or item.get("detected_at") or item.get("triggered_at") or "",
        reverse=True,
    )[:10]

    return {
        "summary": {
            "total_endpoints": len(devices),
            "managed_endpoints": len(managed),
            "security_assessed_endpoints": len(assessed),
            "unassessed_endpoints": len(devices) - len(assessed),
            "fully_patched": patched,
            "patch_compliance_pct": round(patched / len(assessed) * 100, 1) if assessed else None,
            "active_threats": len(active_alerts) + len(active_events),
            "identity_alerts": None,
            "identity_source_configured": False,
            "canary_triggers": canary_triggers,
            "security_score": round(sum(assessed_scores) / len(assessed_scores), 1) if assessed_scores else None,
            "endpoints_online": sum(1 for device in managed if device.get("status") == "online"),
            "evidence_state": "assessed" if assessed else "not_assessed",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "recent_incidents": incidents,
        "devices_at_risk": [
            {
                "id": device.get("id"), "name": device.get("name"), "client_name": device.get("client_name"),
                "status": device.get("status"), "patch_status": device.get("patch_status"), "pending_patches": device.get("pending_patches"),
            }
            for device in assessed
            if int(device.get("pending_patches") or 0) > 0
        ][:15],
        "source": "persisted-nexus-evidence",
    }


@router.get("/security-dashboard/score-trend")
async def get_score_trend(current_user: dict = Depends(get_current_user)):
    """Return recorded snapshots only. An empty list explicitly means no history exists."""
    snapshots = await db.security_dashboard_snapshots.find({}, {"_id": 0}).sort("recorded_at", -1).to_list(180)
    snapshots.reverse()
    return [
        {
            "date": item.get("recorded_at") or item.get("date"),
            "score": item.get("security_score"),
            "threats": item.get("active_threats"),
        }
        for item in snapshots
        if item.get("recorded_at") or item.get("date")
    ]
