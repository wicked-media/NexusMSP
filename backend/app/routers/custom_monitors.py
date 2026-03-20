from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/custom-monitors/list")
async def get_monitors(current_user: dict = Depends(get_current_user)):
    monitors = await db.custom_monitors.find({}, {"_id": 0}).to_list(200)
    if not monitors:
        monitors = await _seed_monitors()
    return monitors

@router.post("/custom-monitors/create")
async def create_monitor(data: dict, current_user: dict = Depends(get_current_user)):
    monitor = {**data, "id": f"cm-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "enabled": True, "alert_count": 0, "last_triggered": None}
    await db.custom_monitors.insert_one(monitor)
    monitor.pop("_id", None)
    return monitor

@router.put("/custom-monitors/{monitor_id}")
async def update_monitor(monitor_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.custom_monitors.update_one({"id": monitor_id}, {"$set": data})
    return {"status": "updated"}

@router.delete("/custom-monitors/{monitor_id}")
async def delete_monitor(monitor_id: str, current_user: dict = Depends(get_current_user)):
    await db.custom_monitors.delete_one({"id": monitor_id})
    return {"status": "deleted"}

async def _seed_monitors():
    now = datetime.now(timezone.utc)
    monitors = [
        {"id": "cm-001", "name": "CPU Sustained High", "description": "Alert when CPU usage exceeds 90% for 10+ minutes", "type": "threshold", "metric": "cpu_usage", "threshold": 90, "duration_minutes": 10, "scope": "all_servers", "alert_severity": "warning", "auto_ticket": True, "enabled": True, "alert_count": 23, "last_triggered": (now - timedelta(hours=4)).isoformat(), "created_by": "Alex Thompson", "created_at": (now - timedelta(days=60)).isoformat()},
        {"id": "cm-002", "name": "Disk Space Critical", "description": "Alert when any disk reaches 95% capacity", "type": "threshold", "metric": "disk_used_pct", "threshold": 95, "scope": "all", "alert_severity": "critical", "auto_ticket": True, "enabled": True, "alert_count": 8, "last_triggered": (now - timedelta(days=2)).isoformat(), "created_by": "Alex Thompson", "created_at": (now - timedelta(days=90)).isoformat()},
        {"id": "cm-003", "name": "Windows Event Log - Security", "description": "Monitor for Event ID 4625 (failed logon) > 20 in 5 minutes", "type": "event_log", "event_source": "Security", "event_id": 4625, "threshold_count": 20, "duration_minutes": 5, "scope": "all_windows", "alert_severity": "high", "auto_ticket": True, "enabled": True, "alert_count": 5, "created_by": "Sarah Chen", "created_at": (now - timedelta(days=45)).isoformat()},
        {"id": "cm-004", "name": "DNS Service Check", "description": "Alert if DNS service stops on domain controllers", "type": "service", "service_name": "DNS", "expected_state": "running", "scope": "domain_controllers", "alert_severity": "critical", "auto_ticket": True, "enabled": True, "alert_count": 2, "created_by": "Mike Rodriguez", "created_at": (now - timedelta(days=30)).isoformat()},
        {"id": "cm-005", "name": "RAM Usage Warning", "description": "Alert when RAM exceeds 85% for 15 minutes", "type": "threshold", "metric": "ram_usage", "threshold": 85, "duration_minutes": 15, "scope": "all", "alert_severity": "warning", "auto_ticket": False, "enabled": True, "alert_count": 41, "last_triggered": (now - timedelta(hours=1)).isoformat(), "created_by": "Alex Thompson", "created_at": (now - timedelta(days=60)).isoformat()},
        {"id": "cm-006", "name": "SSL Certificate Expiry", "description": "Alert 30 days before SSL certificate expiration", "type": "certificate", "threshold_days": 30, "scope": "all_servers", "alert_severity": "warning", "auto_ticket": True, "enabled": True, "alert_count": 3, "created_by": "Sarah Chen", "created_at": (now - timedelta(days=20)).isoformat()},
    ]
    for m in monitors:
        await db.custom_monitors.insert_one(m)
    return [dict((k, v) for k, v in m.items() if k != "_id") for m in monitors]
