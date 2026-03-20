from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/maintenance-scheduler/schedules")
async def get_maintenance_schedules(current_user: dict = Depends(get_current_user)):
    data = await db.maintenance_schedules.find({}, {"_id": 0}).to_list(200)
    if not data:
        data = await _seed_maintenance_data()
    return data

@router.post("/maintenance-scheduler/schedules")
async def create_schedule(data: dict, current_user: dict = Depends(get_current_user)):
    schedule = {**data, "id": f"ms-{uuid.uuid4().hex[:8]}", "created_by": current_user.get("name"), "created_at": datetime.now(timezone.utc).isoformat(), "status": "scheduled", "last_run": None, "run_count": 0}
    await db.maintenance_schedules.insert_one(schedule)
    schedule.pop("_id", None)
    return schedule

@router.put("/maintenance-scheduler/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.maintenance_schedules.update_one({"id": schedule_id}, {"$set": data})
    return {"status": "updated"}

@router.delete("/maintenance-scheduler/schedules/{schedule_id}")
async def delete_schedule(schedule_id: str, current_user: dict = Depends(get_current_user)):
    await db.maintenance_schedules.delete_one({"id": schedule_id})
    return {"status": "deleted"}

@router.get("/maintenance-scheduler/history")
async def get_maintenance_history(current_user: dict = Depends(get_current_user)):
    history = await db.maintenance_history.find({}, {"_id": 0}).sort("executed_at", -1).to_list(100)
    if not history:
        now = datetime.now(timezone.utc)
        history = [
            {"id": "mh-001", "schedule_id": "ms-001", "name": "Sunday Server Patching - Acme", "client_name": "Acme Corporation", "status": "completed", "executed_at": (now - timedelta(days=3)).isoformat(), "duration_minutes": 45, "pre_script_status": "success", "post_script_status": "success", "devices_affected": 3, "notes": "All patches applied successfully"},
            {"id": "mh-002", "schedule_id": "ms-002", "name": "Nightly Backup Verification - GF", "client_name": "Global Finance Ltd", "status": "completed", "executed_at": (now - timedelta(days=1)).isoformat(), "duration_minutes": 12, "pre_script_status": "success", "post_script_status": "success", "devices_affected": 5, "notes": "All backups verified"},
            {"id": "mh-003", "schedule_id": "ms-003", "name": "Weekly Disk Cleanup - TechStart", "client_name": "TechStart Inc", "status": "failed", "executed_at": (now - timedelta(days=2)).isoformat(), "duration_minutes": 8, "pre_script_status": "success", "post_script_status": "failed", "devices_affected": 2, "notes": "Post-script failed on TECH-DOCKER-01: permission denied"},
        ]
        for h in history:
            await db.maintenance_history.insert_one(h)
        history = [dict((k, v) for k, v in h.items() if k != "_id") for h in history]
    return history

async def _seed_maintenance_data():
    now = datetime.now(timezone.utc)
    schedules = [
        {"id": "ms-001", "name": "Sunday Server Patching - Acme", "client_id": "client-001", "client_name": "Acme Corporation", "recurrence": "weekly", "day_of_week": "Sunday", "time": "02:00", "duration_estimate_minutes": 60, "target_devices": ["dev-001", "dev-008"], "pre_script": "Check-BackupStatus.ps1", "post_script": "Verify-Services.ps1", "notify_on_failure": True, "notify_email": "it@acme.com", "status": "scheduled", "created_by": "Alex Thompson", "created_at": (now - timedelta(days=60)).isoformat(), "run_count": 8, "last_run": (now - timedelta(days=3)).isoformat()},
        {"id": "ms-002", "name": "Nightly Backup Verification - GF", "client_id": "client-003", "client_name": "Global Finance Ltd", "recurrence": "daily", "time": "04:00", "duration_estimate_minutes": 15, "target_devices": ["dev-004", "dev-009"], "pre_script": None, "post_script": "Verify-Backups.ps1", "notify_on_failure": True, "notify_email": "helpdesk@globalfin.com", "status": "scheduled", "created_by": "Sarah Chen", "created_at": (now - timedelta(days=45)).isoformat(), "run_count": 44, "last_run": (now - timedelta(days=1)).isoformat()},
        {"id": "ms-003", "name": "Weekly Disk Cleanup - TechStart", "client_id": "client-002", "client_name": "TechStart Inc", "recurrence": "weekly", "day_of_week": "Saturday", "time": "03:00", "duration_estimate_minutes": 30, "target_devices": ["dev-003", "dev-010"], "pre_script": "Check-DiskSpace.sh", "post_script": "Verify-Cleanup.sh", "notify_on_failure": True, "notify_email": "support@techstart.io", "status": "scheduled", "created_by": "Mike Rodriguez", "created_at": (now - timedelta(days=30)).isoformat(), "run_count": 4, "last_run": (now - timedelta(days=2)).isoformat()},
        {"id": "ms-004", "name": "Monthly Certificate Rotation", "client_id": "client-003", "client_name": "Global Finance Ltd", "recurrence": "monthly", "day_of_month": 1, "time": "01:00", "duration_estimate_minutes": 20, "target_devices": ["dev-004"], "pre_script": "Backup-Certs.ps1", "post_script": "Verify-Certs.ps1", "notify_on_failure": True, "notify_email": "helpdesk@globalfin.com", "status": "scheduled", "created_by": "Alex Thompson", "created_at": (now - timedelta(days=90)).isoformat(), "run_count": 3, "last_run": (now - timedelta(days=20)).isoformat()},
        {"id": "ms-005", "name": "Quarterly Firmware Updates", "client_id": "client-001", "client_name": "Acme Corporation", "recurrence": "quarterly", "time": "03:00", "duration_estimate_minutes": 120, "target_devices": ["dev-008"], "pre_script": "Backup-Config.py", "post_script": "Verify-Connectivity.py", "notify_on_failure": True, "status": "scheduled", "created_by": "Sarah Chen", "created_at": (now - timedelta(days=180)).isoformat(), "run_count": 2, "last_run": (now - timedelta(days=45)).isoformat()},
    ]
    for s in schedules:
        await db.maintenance_schedules.insert_one(s)
    return [dict((k, v) for k, v in s.items() if k != "_id") for s in schedules]
