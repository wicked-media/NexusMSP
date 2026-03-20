from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random

router = APIRouter()

@router.get("/third-party-patching/overview")
async def get_third_party_overview(current_user: dict = Depends(get_current_user)):
    apps = await db.third_party_apps.find({}, {"_id": 0}).to_list(500)
    if not apps:
        apps = await _seed_apps()
    total = len(apps)
    current = sum(1 for a in apps if a.get("status") == "current")
    outdated = sum(1 for a in apps if a.get("status") == "outdated")
    return {"summary": {"total_apps": total, "current": current, "outdated": outdated, "critical_updates": sum(1 for a in apps if a.get("update_severity") == "critical"), "compliance_pct": round(current / total * 100, 1) if total else 0}, "apps": apps}

@router.get("/third-party-patching/policies")
async def get_app_policies(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "tpp-001", "app_name": "Google Chrome", "auto_update": True, "ring": "immediate", "enabled": True},
        {"id": "tpp-002", "app_name": "Adobe Acrobat Reader", "auto_update": True, "ring": "3-day-delay", "enabled": True},
        {"id": "tpp-003", "app_name": "Zoom Workplace", "auto_update": True, "ring": "7-day-delay", "enabled": True},
        {"id": "tpp-004", "app_name": "Java Runtime", "auto_update": False, "ring": "manual", "enabled": True},
        {"id": "tpp-005", "app_name": "7-Zip", "auto_update": True, "ring": "immediate", "enabled": True},
    ]

async def _seed_apps():
    apps_catalog = [
        ("Google Chrome", "132.0.6834.159", "132.0.6834.110", "high"), ("Mozilla Firefox", "135.0.1", "134.0", "medium"),
        ("Adobe Acrobat Reader", "24.005.20320", "24.004.20220", "critical"), ("Zoom Workplace", "6.3.6", "6.3.2", "medium"),
        ("7-Zip", "24.09", "24.09", None), ("VLC Media Player", "3.0.21", "3.0.20", "low"),
        ("Java Runtime (JRE)", "8u431", "8u421", "critical"), ("Python", "3.13.1", "3.12.4", "low"),
        (".NET Runtime", "9.0.1", "8.0.11", "medium"), ("Node.js", "22.13.1", "20.18.0", "low"),
        ("PuTTY", "0.82", "0.81", "high"), ("WinSCP", "6.3.6", "6.3.1", "medium"),
        ("Notepad++", "8.7.4", "8.6.9", "low"), ("Git for Windows", "2.47.1", "2.46.0", "medium"),
        ("TeamViewer", "15.62.4", "15.61.3", "high"),
    ]
    devices = await db.devices.find({"type": {"$in": ["workstation", "laptop", "server"]}}, {"_id": 0, "id": 1, "name": 1, "client_name": 1}).to_list(200)
    apps = []
    for d in devices[:40]:
        num_apps = random.randint(3, 8)
        for app_name, latest, old, severity in random.sample(apps_catalog, min(num_apps, len(apps_catalog))):
            is_current = random.random() > 0.35
            apps.append({"id": f"tpa-{len(apps)+1:04d}", "device_id": d["id"], "device_name": d["name"], "client_name": d["client_name"], "app_name": app_name, "installed_version": latest if is_current else old, "latest_version": latest, "status": "current" if is_current else "outdated", "update_severity": None if is_current else severity, "last_checked": datetime.now(timezone.utc).isoformat()})
    for a in apps:
        await db.third_party_apps.insert_one(a)
    return [dict((k, v) for k, v in a.items() if k != "_id") for a in apps]
