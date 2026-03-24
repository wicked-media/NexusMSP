from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== RUSTDESK REMOTE ACCESS MANAGEMENT ==============

@router.get("/rustdesk/config")
async def get_rustdesk_global_config(current_user: dict = Depends(get_current_user)):
    """Get global RustDesk server configuration"""
    config = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0})
    if not config:
        return {
            "key": "rustdesk_config",
            "value": {
                "server_url": "",
                "api_key": "",
                "relay_server": "",
                "enabled": False,
                "default_password_length": 8,
            }
        }
    return config

@router.post("/rustdesk/config")
async def save_rustdesk_global_config(data: dict, current_user: dict = Depends(get_current_user)):
    """Save global RustDesk server configuration"""
    await db.settings.update_one(
        {"key": "rustdesk_config"},
        {"$set": {"key": "rustdesk_config", "value": data, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user["id"]}},
        upsert=True
    )
    return {"message": "RustDesk configuration saved"}

@router.get("/rustdesk/clients/{client_id}/devices")
async def get_client_rustdesk_devices(client_id: str, current_user: dict = Depends(get_current_user)):
    """Get all RustDesk device configs for a client"""
    devices = await db.rustdesk_devices.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return devices

@router.post("/rustdesk/clients/{client_id}/devices")
async def add_rustdesk_device(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Register a RustDesk device for a client"""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    device_entry = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "device_name": data.get("device_name", ""),
        "rustdesk_id": data.get("rustdesk_id", ""),
        "rustdesk_password": data.get("rustdesk_password", ""),
        "os": data.get("os", ""),
        "status": "configured",
        "last_connected": None,
        "notes": data.get("notes", ""),
        "linked_device_id": data.get("linked_device_id", ""),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.rustdesk_devices.insert_one(device_entry)
    device_entry.pop("_id", None)
    return device_entry

@router.put("/rustdesk/devices/{device_id}")
async def update_rustdesk_device(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update a RustDesk device config"""
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.rustdesk_devices.update_one({"id": device_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="RustDesk device not found")
    return {"message": "RustDesk device updated"}

@router.delete("/rustdesk/devices/{device_id}")
async def delete_rustdesk_device(device_id: str, current_user: dict = Depends(get_current_user)):
    """Remove a RustDesk device config"""
    result = await db.rustdesk_devices.delete_one({"id": device_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="RustDesk device not found")
    return {"message": "RustDesk device removed"}

@router.post("/rustdesk/devices/{device_id}/connect")
async def initiate_rustdesk_connection(device_id: str, current_user: dict = Depends(get_current_user)):
    """Initiate a remote connection to a RustDesk device"""
    device = await db.rustdesk_devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="RustDesk device not found")

    # Update last connected timestamp
    await db.rustdesk_devices.update_one(
        {"id": device_id},
        {"$set": {"last_connected": datetime.now(timezone.utc).isoformat(), "status": "connected"}}
    )

    # Log the connection
    await db.rustdesk_sessions.insert_one({
        "id": str(uuid.uuid4()),
        "device_id": device_id,
        "client_id": device.get("client_id"),
        "rustdesk_id": device.get("rustdesk_id"),
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "status": "initiated",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "ended_at": None,
    })

    return {
        "message": "Connection initiated",
        "rustdesk_id": device.get("rustdesk_id"),
        "rustdesk_password": device.get("rustdesk_password"),
        "connection_url": f"rustdesk://{device.get('rustdesk_id')}",
    }

@router.get("/rustdesk/sessions")
async def get_rustdesk_sessions(
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get RustDesk session history"""
    query = {}
    if client_id:
        query["client_id"] = client_id
    sessions = await db.rustdesk_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(100)
    return sessions


@router.get("/rustdesk/all-devices")
async def get_all_remote_devices(current_user: dict = Depends(get_current_user)):
    """Get all managed devices enriched with their RustDesk registration status"""
    # Get all managed devices
    devices = await db.devices.find({}, {
        "_id": 0, "id": 1, "name": 1, "hostname": 1, "client_id": 1, "client_name": 1,
        "device_type": 1, "os": 1, "status": 1, "ip_address": 1, "rustdesk_id": 1,
    }).to_list(500)
    # Get all registered RustDesk device entries
    rd_devices = await db.rustdesk_devices.find({}, {"_id": 0}).to_list(500)
    rd_by_linked = {r.get("linked_device_id"): r for r in rd_devices if r.get("linked_device_id")}
    rd_by_id = {r.get("id"): r for r in rd_devices}

    enriched = []
    for d in devices:
        rd = rd_by_linked.get(d["id"])
        entry = {
            **d,
            "rd_registered": bool(rd or d.get("rustdesk_id")),
            "rd_id": rd.get("rustdesk_id") if rd else d.get("rustdesk_id"),
            "rd_password": rd.get("rustdesk_password") if rd else None,
            "rd_entry_id": rd.get("id") if rd else None,
            "rd_last_connected": rd.get("last_connected") if rd else None,
            "rd_notes": rd.get("notes") if rd else None,
        }
        enriched.append(entry)

    # Add standalone RustDesk entries not linked to a managed device
    linked_ids = {r.get("linked_device_id") for r in rd_devices if r.get("linked_device_id")}
    for rd in rd_devices:
        if rd.get("linked_device_id") not in [d["id"] for d in devices]:
            enriched.append({
                "id": rd.get("id"),
                "name": rd.get("device_name", "Unlinked Device"),
                "hostname": None,
                "client_id": rd.get("client_id"),
                "client_name": rd.get("client_name"),
                "device_type": "unknown",
                "os": rd.get("os"),
                "status": rd.get("status", "configured"),
                "ip_address": None,
                "rd_registered": True,
                "rd_id": rd.get("rustdesk_id"),
                "rd_password": rd.get("rustdesk_password"),
                "rd_entry_id": rd.get("id"),
                "rd_last_connected": rd.get("last_connected"),
                "rd_notes": rd.get("notes"),
            })

    return enriched


@router.put("/rustdesk/assign/{device_id}")
async def assign_rustdesk_id(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Assign or update a RustDesk ID directly on a managed device, and create/update the rustdesk_devices entry"""
    rd_id = data.get("rustdesk_id", "").strip()
    rd_password = data.get("rustdesk_password", "").strip()
    if not rd_id:
        raise HTTPException(status_code=400, detail="RustDesk ID is required")

    # Update the main device record
    result = await db.devices.update_one({"id": device_id}, {"$set": {"rustdesk_id": rd_id}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Device not found")

    device = await db.devices.find_one({"id": device_id}, {"_id": 0, "name": 1, "client_id": 1, "client_name": 1, "os": 1})

    # Upsert a rustdesk_devices entry linked to this device
    existing = await db.rustdesk_devices.find_one({"linked_device_id": device_id}, {"_id": 0})
    if existing:
        await db.rustdesk_devices.update_one(
            {"linked_device_id": device_id},
            {"$set": {"rustdesk_id": rd_id, "rustdesk_password": rd_password, "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
    else:
        entry = {
            "id": str(uuid.uuid4()), "client_id": device.get("client_id", ""),
            "client_name": device.get("client_name", ""), "device_name": device.get("name", ""),
            "rustdesk_id": rd_id, "rustdesk_password": rd_password, "os": device.get("os", ""),
            "status": "configured", "last_connected": None, "notes": "",
            "linked_device_id": device_id, "created_by": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.rustdesk_devices.insert_one(entry)
        entry.pop("_id", None)

    return {"message": "RustDesk ID assigned", "rustdesk_id": rd_id}


@router.post("/rustdesk/quick-connect")
async def quick_connect(data: dict, current_user: dict = Depends(get_current_user)):
    """Quick connect by RustDesk ID — logs session without requiring device registration"""
    rd_id = data.get("rustdesk_id", "").strip()
    if not rd_id:
        raise HTTPException(status_code=400, detail="RustDesk ID required")

    # Log the session
    await db.rustdesk_sessions.insert_one({
        "id": str(uuid.uuid4()), "device_id": None, "client_id": None,
        "rustdesk_id": rd_id, "user_id": current_user["id"], "user_name": current_user["name"],
        "status": "initiated", "started_at": datetime.now(timezone.utc).isoformat(), "ended_at": None,
    })

    return {"message": "Connection initiated", "rustdesk_id": rd_id, "connection_url": f"rustdesk://{rd_id}"}
