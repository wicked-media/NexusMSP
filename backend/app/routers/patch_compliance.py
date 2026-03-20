from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import random

router = APIRouter()

@router.get("/patch-compliance/overview")
async def get_patch_compliance(current_user: dict = Depends(get_current_user)):
    data = await db.patch_compliance.find({}, {"_id": 0}).to_list(500)
    if not data:
        data = await _seed_patch_data()
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "name": 1, "client_name": 1, "patch_status": 1, "pending_patches": 1, "os": 1}).to_list(500)
    total = len(devices)
    current = sum(1 for d in devices if d.get("patch_status") == "current")
    needs_attention = sum(1 for d in devices if d.get("patch_status") == "needs_attention")
    critical = sum(1 for d in devices if d.get("patch_status") == "critical")
    return {
        "summary": {"total_devices": total, "compliant": current, "needs_attention": needs_attention, "critical": critical, "compliance_pct": round(current / total * 100, 1) if total else 0},
        "policies": data,
        "devices": devices,
    }

@router.post("/patch-compliance/policies")
async def create_patch_policy(data: dict, current_user: dict = Depends(get_current_user)):
    policy = {**data, "id": f"pp-{random.randint(1000,9999)}", "created_at": datetime.now(timezone.utc).isoformat(), "created_by": current_user.get("name")}
    await db.patch_compliance.insert_one(policy)
    policy.pop("_id", None)
    return policy

@router.get("/patch-compliance/rings")
async def get_patch_rings(current_user: dict = Depends(get_current_user)):
    return [
        {"id": "ring-1", "name": "Test Ring", "description": "Lab/test devices - patches auto-approved immediately", "delay_days": 0, "device_count": 3, "auto_approve": True},
        {"id": "ring-2", "name": "Early Adopters", "description": "Non-critical workstations, 3-day delay", "delay_days": 3, "device_count": 12, "auto_approve": True},
        {"id": "ring-3", "name": "Broad Deployment", "description": "All standard devices, 7-day delay", "delay_days": 7, "device_count": 35, "auto_approve": True},
        {"id": "ring-4", "name": "Critical Systems", "description": "Servers and critical infra, manual approval required", "delay_days": 14, "device_count": 8, "auto_approve": False},
    ]

async def _seed_patch_data():
    policies = [
        {"id": "pp-001", "name": "Windows Critical Updates", "os_filter": "Windows", "severity_filter": "critical", "auto_approve": True, "delay_days": 3, "ring": "ring-2", "enabled": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "pp-002", "name": "Windows Security Updates", "os_filter": "Windows", "severity_filter": "important", "auto_approve": True, "delay_days": 7, "ring": "ring-3", "enabled": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "pp-003", "name": "Server Patches - Manual", "os_filter": "Windows Server", "severity_filter": "all", "auto_approve": False, "delay_days": 14, "ring": "ring-4", "enabled": True, "created_at": datetime.now(timezone.utc).isoformat()},
        {"id": "pp-004", "name": "Linux Security Updates", "os_filter": "Ubuntu", "severity_filter": "critical", "auto_approve": True, "delay_days": 1, "ring": "ring-1", "enabled": True, "created_at": datetime.now(timezone.utc).isoformat()},
    ]
    for p in policies:
        await db.patch_compliance.insert_one(p)
    return [dict((k, v) for k, v in p.items() if k != "_id") for p in policies]
