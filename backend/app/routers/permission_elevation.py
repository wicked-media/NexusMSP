"""
Just-in-Time (JIT) Permission Elevation — temporary elevated access for techs
with auto-expiry, audit, and break-glass mode.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
from app.database import db
from app.auth import get_current_user
from app.routers.tech_intel import _log_audit

router = APIRouter()


def _ensure_admin(caller: dict):
    if caller.get("role") != "admin" and not caller.get("is_admin"):
        raise HTTPException(status_code=403, detail="Only admins can manage elevations")


async def _get_caller(current_user: dict) -> dict:
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "password_hash": 0})
    if not caller:
        raise HTTPException(status_code=401, detail="Caller not found")
    return caller


@router.post("/permission-elevation/grant")
async def grant_elevation(data: dict, current_user: dict = Depends(get_current_user)):
    """
    Body: { "tech_id":"...", "preset":"Senior Engineer", "duration_minutes":240, "reason":"..." }
    Elevates tech to a target preset for N minutes, then auto-reverts.
    """
    caller = await _get_caller(current_user)
    _ensure_admin(caller)

    from app.routers.technicians import PERMISSION_PRESETS
    tech_id = data.get("tech_id")
    preset = data.get("preset")
    duration = int(data.get("duration_minutes") or 60)
    reason = data.get("reason") or "Manual JIT grant"

    if not tech_id or preset not in PERMISSION_PRESETS:
        raise HTTPException(status_code=400, detail="tech_id and valid preset required")
    if duration < 5 or duration > 24 * 60:
        raise HTTPException(status_code=400, detail="Duration must be 5-1440 minutes")

    tech = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not tech:
        raise HTTPException(status_code=404, detail="Tech not found")

    expires = datetime.now(timezone.utc) + timedelta(minutes=duration)
    elevation_id = f"elev-{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    record = {
        "id": elevation_id,
        "tech_id": tech_id,
        "tech_name": tech.get("name"),
        "preset": preset,
        "previous_permissions": tech.get("permissions") or {},
        "previous_title": tech.get("job_title"),
        "granted_by_id": caller.get("id"),
        "granted_by_name": caller.get("name"),
        "reason": reason,
        "granted_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires.isoformat(),
        "active": True,
        "revoked_at": None,
        "auto_reverted": False,
    }

    await db.permission_elevations.insert_one(record)
    await db.users.update_one(
        {"id": tech_id},
        {"$set": {
            "permissions": PERMISSION_PRESETS[preset],
            "active_elevation_id": elevation_id,
            "active_elevation_expires": expires.isoformat(),
        }},
    )

    await _log_audit(caller, "elevation_granted", tech_id, tech.get("name"), {
        "preset": preset, "duration_minutes": duration, "reason": reason, "elevation_id": elevation_id,
    })

    record.pop("previous_permissions", None)
    return record


@router.delete("/permission-elevation/{elevation_id}")
async def revoke_elevation(elevation_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke an active elevation early."""
    caller = await _get_caller(current_user)
    _ensure_admin(caller)
    elev = await db.permission_elevations.find_one({"id": elevation_id}, {"_id": 0})
    if not elev or not elev.get("active"):
        raise HTTPException(status_code=404, detail="Active elevation not found")

    await db.users.update_one(
        {"id": elev["tech_id"]},
        {"$set": {
            "permissions": elev.get("previous_permissions") or {},
            "active_elevation_id": None,
            "active_elevation_expires": None,
        }},
    )
    await db.permission_elevations.update_one(
        {"id": elevation_id},
        {"$set": {"active": False, "revoked_at": datetime.now(timezone.utc).isoformat()}},
    )
    await _log_audit(caller, "elevation_revoked", elev["tech_id"], elev.get("tech_name"), {"elevation_id": elevation_id})
    return {"message": "Elevation revoked"}


@router.get("/permission-elevation/active")
async def list_active(current_user: dict = Depends(get_current_user)):
    """List active elevations and lazily auto-revert any that have expired."""
    now = datetime.now(timezone.utc)
    active = await db.permission_elevations.find({"active": True}, {"_id": 0, "previous_permissions": 0}).to_list(100)
    out = []
    for e in active:
        try:
            exp = datetime.fromisoformat(e["expires_at"].replace("Z", "+00:00"))
        except Exception:
            exp = now
        if exp <= now:
            # Auto-revert
            full = await db.permission_elevations.find_one({"id": e["id"]}, {"_id": 0})
            await db.users.update_one(
                {"id": e["tech_id"]},
                {"$set": {
                    "permissions": (full or {}).get("previous_permissions") or {},
                    "active_elevation_id": None,
                    "active_elevation_expires": None,
                }},
            )
            await db.permission_elevations.update_one(
                {"id": e["id"]},
                {"$set": {"active": False, "auto_reverted": True, "revoked_at": now.isoformat()}},
            )
            continue
        e["expires_in_minutes"] = max(0, int((exp - now).total_seconds() / 60))
        out.append(e)
    return {"active": out}


@router.post("/permission-elevation/break-glass")
async def break_glass(data: dict, current_user: dict = Depends(get_current_user)):
    """
    Self-grant full admin for emergency response. Heavily audited.
    Body: { "duration_minutes":15, "reason":"..." }
    """
    caller = await _get_caller(current_user)
    duration = int(data.get("duration_minutes") or 15)
    reason = (data.get("reason") or "").strip()
    if not reason or len(reason) < 10:
        raise HTTPException(status_code=400, detail="A detailed reason (10+ chars) is required for break-glass")
    if duration < 5 or duration > 60:
        raise HTTPException(status_code=400, detail="Break-glass capped at 60 minutes")

    expires = datetime.now(timezone.utc) + timedelta(minutes=duration)
    elevation_id = f"bg-{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    record = {
        "id": elevation_id,
        "tech_id": caller["id"],
        "tech_name": caller.get("name"),
        "preset": "BREAK_GLASS_ADMIN",
        "previous_permissions": caller.get("permissions") or {},
        "previous_is_admin": bool(caller.get("is_admin")),
        "previous_title": caller.get("job_title"),
        "granted_by_id": caller["id"],
        "granted_by_name": caller.get("name"),
        "reason": reason,
        "granted_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires.isoformat(),
        "active": True,
        "break_glass": True,
        "revoked_at": None,
        "auto_reverted": False,
    }
    await db.permission_elevations.insert_one(record)
    await db.users.update_one(
        {"id": caller["id"]},
        {"$set": {
            "is_admin": True,
            "active_elevation_id": elevation_id,
            "active_elevation_expires": expires.isoformat(),
        }},
    )
    await _log_audit(caller, "break_glass_activated", caller["id"], caller.get("name"), {
        "duration_minutes": duration, "reason": reason, "elevation_id": elevation_id,
    })
    record.pop("previous_permissions", None)
    return record
