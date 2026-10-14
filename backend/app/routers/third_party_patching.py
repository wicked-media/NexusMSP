"""Third-party application patch evidence.

This surface reports only observations supplied by a configured provider or
Nexus Agent. It must never seed random security data on a GET request.
"""

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import scoped_query

router = APIRouter()

def _public_observation(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "device_id": row.get("device_id"),
        "device_name": row.get("device_name") or "Managed endpoint",
        "client_id": row.get("client_id"),
        "client_name": row.get("client_name") or "",
        "app_name": row.get("app_name") or "Unknown application",
        "installed_version": row.get("installed_version") or "",
        "latest_version": row.get("latest_version") or "",
        "status": row.get("status") if row.get("status") in {"current", "outdated", "unknown"} else "unknown",
        "update_severity": row.get("update_severity"),
        "observed_at": row.get("observed_at") or row.get("last_checked"),
        "source": row.get("source") or "unverified",
    }

@router.get("/third-party-patching/overview")
async def get_third_party_overview(current_user: dict = Depends(get_current_user)):
    """Return only client-bound observations; no provider means no evidence."""
    rows = await db.third_party_apps.find(
        scoped_query(current_user, {"client_id": {"$exists": True}, "device_id": {"$exists": True}}),
        {"_id": 0},
    ).to_list(500)
    apps = [_public_observation(row) for row in rows if row.get("client_id") and row.get("device_id")]
    total = len(apps)
    current = sum(1 for app in apps if app["status"] == "current")
    outdated = sum(1 for app in apps if app["status"] == "outdated")
    return {
        "summary": {
            "total_apps": total,
            "current": current,
            "outdated": outdated,
            "critical_updates": sum(1 for app in apps if app.get("update_severity") == "critical"),
            "compliance_pct": round(current / total * 100, 1) if total else None,
            "evidence_state": "observed" if total else "not_configured",
        },
        "apps": apps,
        "message": (
            "Third-party patch posture is based on client-bound provider or agent observations."
            if total else
            "No third-party patch provider observations are configured. Nexus will not invent application patch posture."
        ),
    }

@router.get("/third-party-patching/policies")
async def get_app_policies(current_user: dict = Depends(get_current_user)):
    return {
        "execution_state": "not_configured",
        "message": "These are planning templates. Configure an execution provider before Nexus can enforce third-party patching.",
        "policies": [
            {"id": "chrome", "app_name": "Google Chrome", "recommended_ring": "immediate", "template_only": True},
            {"id": "acrobat-reader", "app_name": "Adobe Acrobat Reader", "recommended_ring": "3-day-delay", "template_only": True},
            {"id": "zoom", "app_name": "Zoom Workplace", "recommended_ring": "7-day-delay", "template_only": True},
            {"id": "java", "app_name": "Java Runtime", "recommended_ring": "manual", "template_only": True},
            {"id": "7zip", "app_name": "7-Zip", "recommended_ring": "immediate", "template_only": True},
        ],
    }
