from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
import uuid, random

router = APIRouter()

@router.get("/ransomware-canary/status")
async def get_canary_status(current_user: dict = Depends(get_current_user)):
    canaries = await db.ransomware_canaries.find({}, {"_id": 0}).to_list(500)
    if not canaries:
        canaries = await _seed_canaries()
    triggers = await db.canary_triggers.find({}, {"_id": 0}).sort("triggered_at", -1).to_list(50)
    deployed = len(canaries)
    active = sum(1 for c in canaries if c.get("status") == "active")
    triggered = len(triggers)
    return {"summary": {"deployed": deployed, "active": active, "triggered": triggered, "unresolved": sum(1 for t in triggers if not t.get("resolved"))}, "canaries": canaries, "triggers": triggers}

@router.post("/ransomware-canary/deploy")
async def deploy_canary(data: dict, current_user: dict = Depends(get_current_user)):
    canary = {"id": f"canary-{uuid.uuid4().hex[:8]}", "device_id": data["device_id"], "device_name": data.get("device_name", ""), "client_name": data.get("client_name", ""), "file_path": data.get("file_path", "C:\\Users\\Public\\Documents\\NEXUSOPS_CANARY.docx"), "status": "active", "deployed_at": datetime.now(timezone.utc).isoformat(), "deployed_by": current_user.get("name")}
    await db.ransomware_canaries.insert_one(canary)
    canary.pop("_id", None)
    return canary

async def _seed_canaries():
    now = datetime.now(timezone.utc)
    devices = await db.devices.find({"type": {"$in": ["workstation", "server", "laptop"]}}, {"_id": 0, "id": 1, "name": 1, "client_name": 1}).to_list(50)
    canaries = []
    for i, d in enumerate(devices[:20]):
        canaries.append({"id": f"canary-{i+1:03d}", "device_id": d["id"], "device_name": d["name"], "client_name": d["client_name"], "file_path": random.choice(["C:\\Users\\Public\\Documents\\NEXUSOPS_CANARY.docx", "/opt/canary/NEXUSOPS_CANARY.pdf", "C:\\Shares\\Public\\CANARY_FILE.xlsx"]), "status": "active", "deployed_at": (now - timedelta(days=random.randint(1, 90))).isoformat(), "deployed_by": "Alex Thompson", "last_verified": (now - timedelta(hours=random.randint(1, 48))).isoformat()})
    for c in canaries:
        await db.ransomware_canaries.insert_one(c)
    # Seed one trigger
    trigger = {"id": "trig-001", "canary_id": "canary-003", "device_id": devices[2]["id"] if len(devices) > 2 else "dev-005", "device_name": devices[2]["name"] if len(devices) > 2 else "HC-WS-REC01", "client_name": devices[2]["client_name"] if len(devices) > 2 else "HealthCare Plus", "file_path": "C:\\Users\\Public\\Documents\\NEXUSOPS_CANARY.docx", "triggered_at": (now - timedelta(hours=1)).isoformat(), "trigger_type": "file_encrypted", "resolved": False, "auto_isolated": True}
    await db.canary_triggers.insert_one(trigger)
    return [dict((k, v) for k, v in c.items() if k != "_id") for c in canaries]
