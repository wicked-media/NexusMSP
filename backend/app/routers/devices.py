from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== DEVICES ENDPOINTS ==============

@router.get("/devices", response_model=List[Device])
async def get_devices(
    status: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if client_id:
        query["client_id"] = client_id
    
    devices = await db.devices.find(query, {"_id": 0}).to_list(1000)
    for d in devices:
        for field in ['created_at', 'last_seen']:
            if isinstance(d.get(field), str):
                d[field] = datetime.fromisoformat(d[field])
    return devices

@router.get("/devices/{device_id}")
async def get_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device

@router.post("/devices", response_model=Device)
async def create_device(device_data: DeviceCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": device_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    device = Device(**device_data.model_dump(), client_name=client_name)
    doc = device.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['last_seen'] = doc['last_seen'].isoformat()
    await db.devices.insert_one(doc)
    await db.clients.update_one({"id": device_data.client_id}, {"$inc": {"device_count": 1}})
    await log_activity(current_user, "created", "device", device.id, device.name, f"Added {device.device_type} '{device.name}' for {client_name}", metadata={"device_type": device.device_type, "client_name": client_name})
    return device

@router.put("/devices/{device_id}")
async def update_device(device_id: str, device_data: dict, current_user: dict = Depends(get_current_user)):
    old_device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    result = await db.devices.update_one({"id": device_id}, {"$set": device_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    if old_device:
        change_dict = {}
        for k, v in device_data.items():
            if old_device.get(k) != v:
                change_dict[k] = {"old": str(old_device.get(k)), "new": str(v)}
        if change_dict:
            await log_activity(current_user, "updated", "device", device_id, old_device.get("name", ""), f"Updated device fields: {', '.join(change_dict.keys())}", changes=change_dict)
    return {"message": "Device updated"}

@router.delete("/devices/{device_id}")
async def delete_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if device:
        await db.clients.update_one({"id": device['client_id']}, {"$inc": {"device_count": -1}})
        await log_activity(current_user, "deleted", "device", device_id, device.get("name", ""), f"Deleted device '{device.get('name', '')}'")
    result = await db.devices.delete_one({"id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device deleted"}

@router.get("/devices/{device_id}/detail")
async def get_device_detail(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    software = await db.device_software.find({"device_id": device_id}, {"_id": 0}).to_list(500)
    patches = await db.device_patches.find({"device_id": device_id}, {"_id": 0}).sort("installed_date", -1).to_list(100)
    events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    performance = await db.device_performance.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(288)
    alerts = await db.alerts.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    tickets = await db.tickets.find({"device_id": device_id}, {"_id": 0}).to_list(50)
    network_adapters = await db.device_network.find({"device_id": device_id}, {"_id": 0}).to_list(20)
    remote_sessions = await db.remote_sessions.find({"device_id": device_id}, {"_id": 0}).sort("started_at", -1).to_list(50)
    activity_logs = await db.activity_logs.find({"entity_type": "device", "entity_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {
        "device": device,
        "software": software,
        "patches": patches,
        "events": events,
        "performance": performance,
        "alerts": alerts,
        "tickets": tickets,
        "network_adapters": network_adapters,
        "remote_sessions": remote_sessions,
        "activity_logs": activity_logs,
    }

@router.get("/devices/{device_id}/software")
async def get_device_software(device_id: str, current_user: dict = Depends(get_current_user)):
    software = await db.device_software.find({"device_id": device_id}, {"_id": 0}).to_list(500)
    return software

@router.get("/devices/{device_id}/patches")
async def get_device_patches(device_id: str, current_user: dict = Depends(get_current_user)):
    patches = await db.device_patches.find({"device_id": device_id}, {"_id": 0}).sort("installed_date", -1).to_list(200)
    return patches

@router.get("/devices/{device_id}/events")
async def get_device_events(device_id: str, current_user: dict = Depends(get_current_user)):
    events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return events

@router.get("/devices/{device_id}/performance")
async def get_device_performance(device_id: str, current_user: dict = Depends(get_current_user)):
    performance = await db.device_performance.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(288)
    return performance

@router.get("/devices/stats/summary")
async def get_devices_stats(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({}, {"_id": 0}).to_list(10000)
    total = len(devices)
    online = len([d for d in devices if d.get("status") == "online"])
    offline = len([d for d in devices if d.get("status") == "offline"])
    warning = len([d for d in devices if d.get("status") == "warning"])
    servers = len([d for d in devices if d.get("device_type") == "server"])
    workstations = len([d for d in devices if d.get("device_type") == "workstation"])
    laptops = len([d for d in devices if d.get("device_type") == "laptop"])
    needs_patching = len([d for d in devices if (d.get("pending_patches") or 0) > 0])
    avg_cpu = sum(d.get("cpu_usage", 0) for d in devices) / max(total, 1)
    avg_ram = sum(d.get("memory_usage", 0) for d in devices) / max(total, 1)
    avg_disk = sum(d.get("disk_usage", 0) for d in devices) / max(total, 1)
    return {
        "total": total, "online": online, "offline": offline, "warning": warning,
        "servers": servers, "workstations": workstations, "laptops": laptops,
        "needs_patching": needs_patching,
        "avg_cpu": round(avg_cpu, 1), "avg_ram": round(avg_ram, 1), "avg_disk": round(avg_disk, 1)
    }


# ============== ASSETS ENDPOINTS ==============

@router.get("/assets", response_model=List[Asset])
async def get_assets(
    asset_type: Optional[str] = None,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if asset_type:
        query["asset_type"] = asset_type
    if client_id:
        query["client_id"] = client_id
    
    assets = await db.assets.find(query, {"_id": 0}).to_list(1000)
    for a in assets:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
    return assets

@router.get("/assets/stats")
async def get_asset_stats(current_user: dict = Depends(get_current_user)):
    assets = await db.assets.find({}, {"_id": 0}).to_list(10000)
    total = len(assets)
    active = len([a for a in assets if a.get("status") == "active"])
    total_value = sum(a.get("cost", 0) for a in assets)
    expiring_soon = 0
    expired = 0
    now = datetime.now()
    for a in assets:
        we = a.get("warranty_expiry")
        if we:
            try:
                exp_dt = datetime.strptime(we, "%Y-%m-%d")
                if exp_dt < now:
                    expired += 1
                elif exp_dt < now + timedelta(days=90):
                    expiring_soon += 1
            except:
                pass
    by_type = {}
    for a in assets:
        t = a.get("asset_type", "other")
        by_type[t] = by_type.get(t, 0) + 1
    return {
        "total": total, "active": active, "total_value": round(total_value, 2),
        "warranty_expiring_soon": expiring_soon, "warranty_expired": expired,
        "by_type": by_type
    }

@router.get("/assets/expiring")
async def get_expiring_assets(current_user: dict = Depends(get_current_user)):
    assets = await db.assets.find({}, {"_id": 0}).to_list(10000)
    now = datetime.now()
    cutoff = now + timedelta(days=90)
    expiring = []
    for a in assets:
        we = a.get("warranty_expiry")
        if we:
            try:
                exp_dt = datetime.strptime(we, "%Y-%m-%d")
                if exp_dt < cutoff:
                    a["days_remaining"] = (exp_dt - now).days
                    a["is_expired"] = exp_dt < now
                    expiring.append(a)
            except:
                pass
    return sorted(expiring, key=lambda x: x.get("days_remaining", 999))

@router.get("/assets/{asset_id}")
async def get_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    asset = await db.assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset

@router.post("/assets", response_model=Asset)
async def create_asset(asset_data: AssetCreate, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": asset_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    asset = Asset(**asset_data.model_dump(), client_name=client_name)
    doc = asset.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.assets.insert_one(doc)
    return asset

@router.put("/assets/{asset_id}")
async def update_asset(asset_id: str, asset_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.assets.update_one({"id": asset_id}, {"$set": asset_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset updated"}

@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.assets.delete_one({"id": asset_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}

