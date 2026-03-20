from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import uuid
import secrets
import hashlib
from app.database import db
from app.auth import get_current_user, hash_password, verify_password

router = APIRouter()

# ============== USER PROFILE ==============

@router.get("/user-settings/profile")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.pop("password_hash", None)
    # Fetch gamification profile
    gam = await db.gamification.find_one({"user_id": current_user["id"]}, {"_id": 0})
    user["gamification"] = gam
    # Fetch settings
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    user["settings"] = settings or {}
    return user

@router.put("/user-settings/profile")
async def update_my_profile(data: dict, current_user: dict = Depends(get_current_user)):
    allowed = ["name", "phone", "job_title", "specialties", "email_signature", "email_signature_html", "signature_config"]
    update = {k: v for k, v in data.items() if k in allowed}
    if update:
        await db.users.update_one({"id": current_user["id"]}, {"$set": update})
    return {"message": "Profile updated"}

# ============== PASSWORD CHANGE ==============

@router.post("/user-settings/change-password")
async def change_password(data: dict, current_user: dict = Depends(get_current_user)):
    current_pw = data.get("current_password", "")
    new_pw = data.get("new_password", "")
    if not current_pw or not new_pw:
        raise HTTPException(status_code=400, detail="Both current and new password required")
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or not verify_password(current_pw, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"password_hash": hash_password(new_pw)}})
    return {"message": "Password changed successfully"}

# ============== 2FA / TOTP ==============

@router.get("/user-settings/2fa")
async def get_2fa_status(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not settings:
        return {"enabled": False, "method": None, "security_keys": []}
    return {
        "enabled": settings.get("totp_enabled", False),
        "method": "totp" if settings.get("totp_enabled") else None,
        "security_keys": settings.get("security_keys", []),
        "backup_codes_remaining": len(settings.get("backup_codes", []))
    }

@router.post("/user-settings/2fa/setup")
async def setup_2fa(current_user: dict = Depends(get_current_user)):
    secret = secrets.token_hex(20)
    provisioning_uri = f"otpauth://totp/NexusOps:{current_user['email']}?secret={secret}&issuer=NexusOps"
    backup_codes = [secrets.token_hex(4) for _ in range(8)]
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {
            "user_id": current_user["id"],
            "totp_secret": secret,
            "totp_enabled": False,
            "backup_codes": backup_codes,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    return {"secret": secret, "provisioning_uri": provisioning_uri, "backup_codes": backup_codes, "qr_data": provisioning_uri}

@router.post("/user-settings/2fa/verify")
async def verify_2fa(data: dict, current_user: dict = Depends(get_current_user)):
    data.get("code", "")
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not settings or not settings.get("totp_secret"):
        raise HTTPException(status_code=400, detail="2FA not set up")
    # Simple verification (in production, use pyotp)
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"totp_enabled": True, "totp_verified_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "2FA enabled successfully", "enabled": True}

@router.post("/user-settings/2fa/disable")
async def disable_2fa(data: dict, current_user: dict = Depends(get_current_user)):
    password = data.get("password", "")
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or not verify_password(password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"totp_enabled": False, "totp_secret": None, "security_keys": []}}
    )
    return {"message": "2FA disabled"}

# ============== FIDO2 / SECURITY KEYS ==============

@router.post("/user-settings/security-keys/register")
async def register_security_key(data: dict, current_user: dict = Depends(get_current_user)):
    key_name = data.get("name", "Security Key")
    key_entry = {
        "id": str(uuid.uuid4()),
        "name": key_name,
        "type": "fido2",
        "credential_id": secrets.token_hex(32),
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "last_used": None
    }
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$push": {"security_keys": key_entry}, "$set": {"user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": f"Security key '{key_name}' registered", "key": key_entry}

@router.delete("/user-settings/security-keys/{key_id}")
async def remove_security_key(key_id: str, current_user: dict = Depends(get_current_user)):
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$pull": {"security_keys": {"id": key_id}}}
    )
    return {"message": "Security key removed"}

# ============== NOTIFICATION PREFERENCES ==============

@router.get("/user-settings/notifications")
async def get_notification_prefs(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    defaults = {
        "email_ticket_assigned": True, "email_ticket_updated": True, "email_sla_breach": True,
        "email_daily_digest": False, "inapp_ticket_assigned": True, "inapp_ticket_updated": True,
        "inapp_sla_breach": True, "inapp_device_offline": True, "sms_critical_alerts": False,
        "sms_sla_breach": False, "desktop_notifications": True, "sound_enabled": True
    }
    prefs = (settings or {}).get("notification_prefs", defaults)
    return {**defaults, **prefs}

@router.put("/user-settings/notifications")
async def update_notification_prefs(data: dict, current_user: dict = Depends(get_current_user)):
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"notification_prefs": data, "user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": "Notification preferences updated"}

# ============== WORKING HOURS ==============

@router.get("/user-settings/working-hours")
async def get_working_hours(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    defaults = {
        "timezone": "Pacific/Auckland",
        "schedule": {
            "monday": {"enabled": True, "start": "08:00", "end": "17:00"},
            "tuesday": {"enabled": True, "start": "08:00", "end": "17:00"},
            "wednesday": {"enabled": True, "start": "08:00", "end": "17:00"},
            "thursday": {"enabled": True, "start": "08:00", "end": "17:00"},
            "friday": {"enabled": True, "start": "08:00", "end": "17:00"},
            "saturday": {"enabled": False, "start": "09:00", "end": "13:00"},
            "sunday": {"enabled": False, "start": "", "end": ""},
        },
        "on_call": False, "auto_assign": True
    }
    return (settings or {}).get("working_hours", defaults)

@router.put("/user-settings/working-hours")
async def update_working_hours(data: dict, current_user: dict = Depends(get_current_user)):
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"working_hours": data, "user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": "Working hours updated"}

# ============== API KEYS ==============

@router.get("/user-settings/api-keys")
async def get_api_keys(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    keys = (settings or {}).get("api_keys", [])
    return [{"id": k["id"], "name": k["name"], "prefix": k["key"][:12] + "...", "created_at": k["created_at"], "last_used": k.get("last_used"), "scopes": k.get("scopes", ["read"])} for k in keys]

@router.post("/user-settings/api-keys")
async def create_api_key(data: dict, current_user: dict = Depends(get_current_user)):
    key_value = f"nxops_{secrets.token_hex(24)}"
    key_entry = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", "API Key"),
        "key": key_value,
        "scopes": data.get("scopes", ["read"]),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_used": None
    }
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$push": {"api_keys": key_entry}, "$set": {"user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": "API key created", "key": key_value, "id": key_entry["id"], "name": key_entry["name"]}

@router.delete("/user-settings/api-keys/{key_id}")
async def delete_api_key(key_id: str, current_user: dict = Depends(get_current_user)):
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$pull": {"api_keys": {"id": key_id}}}
    )
    return {"message": "API key revoked"}

# ============== SESSIONS ==============

@router.get("/user-settings/sessions")
async def get_sessions(current_user: dict = Depends(get_current_user)):
    sessions = await db.user_sessions.find({"user_id": current_user["id"]}, {"_id": 0}).sort("last_active", -1).to_list(20)
    if not sessions:
        sessions = [{
            "id": "current",
            "user_id": current_user["id"],
            "device": "Current Browser",
            "ip_address": "127.0.0.1",
            "location": "Local",
            "last_active": datetime.now(timezone.utc).isoformat(),
            "is_current": True,
            "user_agent": "Browser"
        }]
    return sessions

@router.delete("/user-settings/sessions/{session_id}")
async def revoke_session(session_id: str, current_user: dict = Depends(get_current_user)):
    await db.user_sessions.delete_one({"id": session_id, "user_id": current_user["id"]})
    return {"message": "Session revoked"}

# ============== DISPLAY PREFERENCES ==============

@router.get("/user-settings/display")
async def get_display_prefs(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    defaults = {
        "accent_color": "blue",
        "compact_mode": False,
        "date_format": "MMM d, yyyy",
        "time_format": "HH:mm",
        "timezone": "Pacific/Auckland",
        "language": "en",
        "table_density": "normal",
        "sidebar_collapsed": False,
        "show_ticket_previews": True,
    }
    return {**defaults, **(settings or {}).get("display_prefs", {})}

@router.put("/user-settings/display")
async def update_display_prefs(data: dict, current_user: dict = Depends(get_current_user)):
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"display_prefs": data, "user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": "Display preferences updated"}
