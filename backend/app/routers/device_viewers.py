from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# In-memory store for active device remote sessions (technician viewing)
_device_viewers = {}  # { device_id: { user_id: { user_name, started_at } } }


@router.post("/devices/{device_id}/start-remote-viewing")
async def start_remote_viewing(device_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a technician as actively remote-viewing a device"""
    if device_id not in _device_viewers:
        _device_viewers[device_id] = {}
    _device_viewers[device_id][current_user["id"]] = {
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"message": "Now viewing device", "viewers": list(_device_viewers[device_id].values())}


@router.post("/devices/{device_id}/stop-remote-viewing")
async def stop_remote_viewing(device_id: str, current_user: dict = Depends(get_current_user)):
    """Remove technician from active device viewers"""
    if device_id in _device_viewers:
        _device_viewers[device_id].pop(current_user["id"], None)
        if not _device_viewers[device_id]:
            del _device_viewers[device_id]
    return {"message": "Stopped viewing device"}


@router.get("/devices/active-remote-viewers")
async def get_active_remote_viewers(current_user: dict = Depends(get_current_user)):
    """Get all devices currently being remotely viewed and by which technicians"""
    result = {}
    for device_id, viewers in _device_viewers.items():
        if viewers:
            result[device_id] = list(viewers.values())
    return result
