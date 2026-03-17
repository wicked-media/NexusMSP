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
