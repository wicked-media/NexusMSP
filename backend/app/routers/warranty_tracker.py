from fastapi import APIRouter, Depends
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/warranty/overview")
async def warranty_overview(current_user: dict = Depends(get_current_user)):
    """Get warranty status for all devices."""
    devices = await db.devices.find({}, {"_id": 0, "id": 1, "hostname": 1, "device_type": 1,
                                          "manufacturer": 1, "model": 1, "serial_number": 1,
                                          "warranty_expiry": 1, "client_name": 1, "client_id": 1}).to_list(500)
    now = datetime.now(timezone.utc)
    expired = []
    expiring_soon = []
    active = []
    unknown = []

    for d in devices:
        exp = d.get("warranty_expiry")
        if not exp:
            unknown.append({**d, "warranty_status": "unknown"})
            continue
        try:
            exp_date = datetime.fromisoformat(exp.replace("Z", "+00:00")) if "T" in exp else datetime.strptime(exp, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            days_left = (exp_date - now).days
            if days_left < 0:
                expired.append({**d, "warranty_status": "expired", "days_expired": abs(days_left)})
            elif days_left < 90:
                expiring_soon.append({**d, "warranty_status": "expiring_soon", "days_left": days_left})
            else:
                active.append({**d, "warranty_status": "active", "days_left": days_left})
        except Exception:
            unknown.append({**d, "warranty_status": "unknown"})

    expiring_soon.sort(key=lambda x: x.get("days_left", 999))

    return {
        "expired": expired, "expiring_soon": expiring_soon,
        "active": active, "unknown": unknown,
        "stats": {
            "total": len(devices), "active": len(active),
            "expiring_soon": len(expiring_soon), "expired": len(expired),
            "unknown": len(unknown),
        },
    }


@router.put("/warranty/{device_id}")
async def update_warranty(device_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update warranty expiry for a device."""
    await db.devices.update_one({"id": device_id}, {"$set": {"warranty_expiry": data.get("warranty_expiry", "")}})
    return {"message": "Warranty updated"}
