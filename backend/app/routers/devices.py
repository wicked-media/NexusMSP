from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.scope_permissions import assert_client_scope, assert_record_scope, scoped_query
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
    
    devices = await db.devices.find(scoped_query(current_user, query), {"_id": 0}).to_list(1000)
    for d in devices:
        for field in ['created_at', 'last_seen']:
            if isinstance(d.get(field), str):
                d[field] = datetime.fromisoformat(d[field])
    return devices

# Static path routes - MUST be defined before {device_id} dynamic route
@router.get("/devices/stale")
async def get_stale_devices_route(hours: int = 24, current_user: dict = Depends(get_current_user)):
    """Get devices that haven't reported in within the specified hours"""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    stale = await db.devices.find(scoped_query(current_user, {
        "$or": [
            {"last_heartbeat": {"$lt": cutoff}},
            {"last_heartbeat": {"$exists": False}},
        ]
    }), {"_id": 0}).to_list(500)
    return stale

@router.get("/devices/{device_id}")
async def get_device(device_id: str, current_user: dict = Depends(get_current_user)):
    return await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.read", resource_name="Device",
    )

@router.post("/devices", response_model=Device)
async def create_device(device_data: DeviceCreate, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, device_data.client_id, operation="device.create")
    client = await db.clients.find_one({"id": device_data.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
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
    old_device = await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.update", resource_name="Device",
    )
    updates = dict(device_data or {})
    if "client_id" in updates:
        new_client_id = updates.get("client_id") or None
        await assert_client_scope(current_user, new_client_id, operation="device.move")
        if new_client_id:
            new_client = await db.clients.find_one({"id": new_client_id}, {"_id": 0, "id": 1, "name": 1})
            if not new_client:
                raise HTTPException(status_code=404, detail="Client not found")
            updates["client_id"] = new_client_id
            updates["client_name"] = new_client.get("name")
        else:
            updates["client_id"] = None
            updates["client_name"] = None
        old_client_id = old_device.get("client_id")
        if old_client_id != new_client_id:
            if old_client_id:
                await db.clients.update_one({"id": old_client_id}, {"$inc": {"device_count": -1}})
            if new_client_id:
                await db.clients.update_one({"id": new_client_id}, {"$inc": {"device_count": 1}})
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.devices.update_one({"id": device_id}, {"$set": updates})
    if old_device:
        change_dict = {}
        for k, v in updates.items():
            if k == "updated_at":
                continue
            if old_device.get(k) != v:
                change_dict[k] = {"old": str(old_device.get(k)), "new": str(v)}
        if change_dict:
            await log_activity(current_user, "updated", "device", device_id, old_device.get("name", ""), f"Updated device fields: {', '.join(change_dict.keys())}", changes=change_dict)
    return {"message": "Device updated"}

@router.delete("/devices/{device_id}")
async def delete_device(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.delete", resource_name="Device",
    )
    if device.get("client_id"):
        await db.clients.update_one({"id": device["client_id"]}, {"$inc": {"device_count": -1}})
    await log_activity(current_user, "deleted", "device", device_id, device.get("name", ""), f"Deleted device '{device.get('name', '')}'")
    result = await db.devices.delete_one({"id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"message": "Device deleted"}

@router.get("/devices/{device_id}/detail")
async def get_device_detail(device_id: str, current_user: dict = Depends(get_current_user)):
    device = await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.detail.read", resource_name="Device",
    )
    software = await db.device_software.find({"device_id": device_id}, {"_id": 0}).to_list(500)
    patches = await db.device_patches.find({"device_id": device_id}, {"_id": 0}).sort("installed_date", -1).to_list(100)
    events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(100)
    performance = await db.device_performance.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(288)
    alerts = await db.alerts.find(
        {
            "device_id": device_id,
            "$or": [
                {"status": {"$in": ["active", "open", "triggered"]}},
                {"status": {"$exists": False}},
            ],
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    tickets = await db.tickets.find(
        {"$or": [{"device_id": device_id}, {"device_ids": device_id}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    network_adapters = await db.device_network.find({"device_id": device_id}, {"_id": 0}).to_list(20)
    remote_sessions = await db.remote_sessions.find({"device_id": device_id}, {"_id": 0}).sort("started_at", -1).to_list(50)
    activity_logs = await db.activity_logs.find({"entity_type": "device", "entity_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    # Keep the hero metric and the detailed alert list on one source of truth.
    # Stored counts can drift after an alert is resolved, so derive the count
    # from the access-scoped active records returned with this response.
    device["alerts_count"] = len(alerts)
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
    await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.software.read", resource_name="Device",
    )
    software = await db.device_software.find({"device_id": device_id}, {"_id": 0}).to_list(500)
    return software

@router.get("/devices/{device_id}/patches")
async def get_device_patches(device_id: str, current_user: dict = Depends(get_current_user)):
    await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.patches.read", resource_name="Device",
    )
    patches = await db.device_patches.find({"device_id": device_id}, {"_id": 0}).sort("installed_date", -1).to_list(200)
    return patches

@router.get("/devices/{device_id}/events")
async def get_device_events(device_id: str, current_user: dict = Depends(get_current_user)):
    await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.events.read", resource_name="Device",
    )
    events = await db.device_events.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return events

@router.get("/devices/{device_id}/performance")
async def get_device_performance(device_id: str, current_user: dict = Depends(get_current_user)):
    await assert_record_scope(
        current_user, db.devices, device_id,
        operation="device.performance.read", resource_name="Device",
    )
    performance = await db.device_performance.find({"device_id": device_id}, {"_id": 0}).sort("timestamp", -1).to_list(288)
    return performance

@router.get("/devices/stats/summary")
async def get_devices_stats(current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(scoped_query(current_user), {"_id": 0}).to_list(10000)
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

# ============== RMM AGENT HEARTBEAT / REAL-TIME REPORTING ==============

@router.post("/devices/{device_id}/heartbeat")
async def device_heartbeat(device_id: str, data: dict):
    """RMM Agent heartbeat endpoint. Updates device info in real-time.
    Called periodically by the remote agent installed on client devices."""
    raise HTTPException(
        status_code=410,
        detail="Legacy device heartbeat retired. Enrol this endpoint with Nexus Agent and use /api/nexus-agent/heartbeat.",
    )
    device = await db.devices.find_one({"id": device_id})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "last_seen": now,
        "status": "online",
        "last_heartbeat": now,
    }
    
    # System info - map to model field names
    if "hostname" in data:
        update["name"] = data["hostname"]
    if "os_name" in data:
        update["os"] = data["os_name"]
    if "os_version" in data:
        update["os_version"] = data["os_version"]
    if "os_build" in data:
        update["os_build"] = data["os_build"]
    if "architecture" in data:
        update["architecture"] = data["architecture"]
    if "domain" in data:
        update["domain"] = data["domain"]
    if "serial_number" in data:
        update["serial_number"] = data["serial_number"]
    if "manufacturer" in data:
        update["manufacturer"] = data["manufacturer"]
    if "model" in data:
        update["model"] = data["model"]
    if "bios_version" in data:
        update["bios_version"] = data["bios_version"]
    
    # Performance metrics
    if "cpu_usage" in data:
        update["cpu_usage"] = float(data["cpu_usage"])
    if "memory_usage" in data:
        update["memory_usage"] = float(data["memory_usage"])
    if "disk_usage" in data:
        update["disk_usage"] = float(data["disk_usage"])
    if "cpu_temp" in data:
        update["cpu_temp"] = float(data["cpu_temp"])
    
    # Hardware details - map to model fields
    if "total_ram_gb" in data:
        update["ram_gb"] = float(data["total_ram_gb"])
    if "cpu_name" in data:
        update["processor"] = data["cpu_name"]
    if "cpu_cores" in data:
        update["processor_cores"] = int(data["cpu_cores"])
    if "total_disk_gb" in data:
        update["storage_total_gb"] = float(data["total_disk_gb"])
    if "free_disk_gb" in data:
        update["storage_used_gb"] = round(float(data.get("total_disk_gb", 0)) - float(data["free_disk_gb"]), 1)
    
    # Network
    if "ip_address" in data:
        update["ip_address"] = data["ip_address"]
    if "mac_address" in data:
        update["mac_address"] = data["mac_address"]
    if "public_ip" in data:
        update["public_ip"] = data["public_ip"]
    
    # Uptime
    if "uptime_seconds" in data:
        secs = int(data["uptime_seconds"])
        update["uptime_hours"] = round(secs / 3600, 1)
        days = secs // 86400
        hours = (secs % 86400) // 3600
        update["uptime_display"] = f"{days}d {hours}h"
    
    # Logged-in user
    if "logged_in_user" in data:
        update["last_logged_in_user"] = data["logged_in_user"]
    
    # Antivirus / security
    if "antivirus_status" in data:
        update["antivirus_status"] = data["antivirus_status"]
    if "antivirus_name" in data:
        update["antivirus"] = data["antivirus_name"]
    if "firewall_enabled" in data:
        update["firewall_enabled"] = data["firewall_enabled"]
    if "bitlocker_enabled" in data:
        update["bitlocker_enabled"] = data["bitlocker_enabled"]
    
    # Pending updates
    if "pending_patches" in data:
        update["pending_patches"] = int(data["pending_patches"])
    if "last_patch_date" in data:
        update["last_patch_date"] = data["last_patch_date"]
    
    # Installed software count
    if "installed_software_count" in data:
        update["installed_software_count"] = int(data["installed_software_count"])
    
    await db.devices.update_one({"id": device_id}, {"$set": update})
    
    # Store performance snapshot
    perf_entry = {
        "id": str(uuid.uuid4()),
        "device_id": device_id,
        "cpu_usage": data.get("cpu_usage", 0),
        "memory_usage": data.get("memory_usage", 0),
        "disk_usage": data.get("disk_usage", 0),
        "timestamp": now,
    }
    await db.device_performance.insert_one(perf_entry)
    
    # Check for warning thresholds
    status = "online"
    if float(data.get("cpu_usage", 0)) > 90 or float(data.get("memory_usage", 0)) > 90 or float(data.get("disk_usage", 0)) > 95:
        status = "warning"
        update["status"] = "warning"
        await db.devices.update_one({"id": device_id}, {"$set": {"status": "warning"}})
    
    return {"status": "ok", "device_status": status, "next_heartbeat_seconds": 300}

@router.post("/devices/heartbeat/bulk")
async def bulk_device_heartbeat(data: dict):
    """Bulk heartbeat for multiple devices from a single RMM server"""
    raise HTTPException(
        status_code=410,
        detail="Legacy bulk heartbeat retired. Each endpoint must use its own authenticated Nexus Agent identity.",
    )
    devices = data.get("devices", [])
    results = []
    for d in devices:
        device_id = d.get("device_id")
        if not device_id:
            continue
        device = await db.devices.find_one({"id": device_id})
        if not device:
            results.append({"device_id": device_id, "status": "not_found"})
            continue
        now = datetime.now(timezone.utc).isoformat()
        update = {"last_seen": now, "status": "online", "last_heartbeat": now}
        for key in ["cpu_usage", "memory_usage", "disk_usage", "ip_address", "logged_in_user", "uptime_seconds", "os_name", "hostname"]:
            if key in d:
                update[key] = d[key]
        await db.devices.update_one({"id": device_id}, {"$set": update})
        results.append({"device_id": device_id, "status": "ok"})
    return {"processed": len(results), "results": results}


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
    
    assets = await db.assets.find(scoped_query(current_user, query), {"_id": 0}).to_list(1000)
    for a in assets:
        if isinstance(a.get('created_at'), str):
            a['created_at'] = datetime.fromisoformat(a['created_at'])
    return assets

@router.get("/assets/stats")
async def get_asset_stats(current_user: dict = Depends(get_current_user)):
    assets = await db.assets.find(scoped_query(current_user), {"_id": 0}).to_list(10000)
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
    assets = await db.assets.find(scoped_query(current_user), {"_id": 0}).to_list(10000)
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
    return await assert_record_scope(
        current_user, db.assets, asset_id,
        operation="asset.read", resource_name="Asset",
    )

@router.post("/assets", response_model=Asset)
async def create_asset(asset_data: AssetCreate, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, asset_data.client_id, operation="asset.create")
    client = await db.clients.find_one({"id": asset_data.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client_name = client['name'] if client else None
    
    asset = Asset(**asset_data.model_dump(), client_name=client_name)
    doc = asset.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.assets.insert_one(doc)
    return asset

@router.put("/assets/{asset_id}")
async def update_asset(asset_id: str, asset_data: dict, current_user: dict = Depends(get_current_user)):
    existing = await assert_record_scope(
        current_user, db.assets, asset_id,
        operation="asset.update", resource_name="Asset",
    )
    if "client_id" in asset_data and asset_data.get("client_id") != existing.get("client_id"):
        await assert_client_scope(current_user, asset_data.get("client_id"), operation="asset.move")
    result = await db.assets.update_one({"id": asset_id}, {"$set": asset_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset updated"}

@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: str, current_user: dict = Depends(get_current_user)):
    await assert_record_scope(
        current_user, db.assets, asset_id,
        operation="asset.delete", resource_name="Asset",
    )
    result = await db.assets.delete_one({"id": asset_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}

