from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import uuid
import secrets
import hashlib
import base64
import hmac
import struct
import time
from app.database import db
from app.auth import get_current_user, hash_password, verify_password, password_policy_error

router = APIRouter()


def _totp_code(secret_b32: str, counter: int) -> str:
    padding = "=" * ((8 - len(secret_b32) % 8) % 8)
    key = base64.b32decode(secret_b32 + padding)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return str(value).zfill(6)


def _valid_totp(secret_b32: str, code: str) -> bool:
    if not secret_b32 or not code:
        return False
    counter = int(time.time() // 30)
    return any(hmac.compare_digest(code, _totp_code(secret_b32, counter + shift)) for shift in (-1, 0, 1))

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
    policy_error = password_policy_error(new_pw, current_user.get("email", ""))
    if policy_error:
        raise HTTPException(status_code=400, detail=policy_error)
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or not verify_password(current_pw, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    await db.users.update_one({"id": current_user["id"]}, {"$set": {"password_hash": hash_password(new_pw)}})
    return {"message": "Password changed successfully"}

# ============== 2FA / TOTP ==============

@router.get("/user-settings/2fa")
async def get_2fa_status(current_user: dict = Depends(get_current_user)):
    enrollment = await db.user_2fa.find_one({"user_id": current_user["id"]}, {"_id": 0})
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0}) or {}
    return {
        "enabled": bool(enrollment and enrollment.get("verified")),
        "method": "totp" if enrollment and enrollment.get("verified") else None,
        "security_keys": settings.get("security_keys", []),
        "backup_codes_remaining": 0,
    }

@router.post("/user-settings/2fa/setup")
async def setup_2fa(current_user: dict = Depends(get_current_user)):
    secret = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    provisioning_uri = f"otpauth://totp/NexusOps:{current_user['email']}?secret={secret}&issuer=NexusOps&algorithm=SHA1&digits=6&period=30"
    await db.user_2fa.update_one(
        {"user_id": current_user["id"]},
        {"$set": {
            "user_id": current_user["id"],
            "secret": secret,
            "verified": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )
    return {"secret": secret, "provisioning_uri": provisioning_uri, "qr_data": provisioning_uri}

@router.post("/user-settings/2fa/verify")
async def verify_2fa(data: dict, current_user: dict = Depends(get_current_user)):
    enrollment = await db.user_2fa.find_one({"user_id": current_user["id"]}, {"_id": 0})
    if not enrollment or not enrollment.get("secret"):
        raise HTTPException(status_code=400, detail="2FA not set up")
    if not _valid_totp(enrollment["secret"], (data.get("code") or "").strip()):
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    await db.user_2fa.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"verified": True, "verified_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "2FA enabled successfully", "enabled": True}

@router.post("/user-settings/2fa/disable")
async def disable_2fa(data: dict, current_user: dict = Depends(get_current_user)):
    password = data.get("password", "")
    user = await db.users.find_one({"id": current_user["id"]})
    if not user or not verify_password(password, user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    await db.user_2fa.delete_one({"user_id": current_user["id"]})
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
        "inapp_ticket_assigned": True, "inapp_ticket_updated": True,
        "inapp_ticket_escalated": True, "inapp_sla_breach": True, "inapp_sla_warning": True,
        "inapp_device_offline": True, "inapp_contract_renewal": True, "inapp_new_lead": True,
        "inapp_email_received": True,
    }
    prefs = (settings or {}).get("notification_prefs", defaults)
    return {**defaults, **prefs}

@router.put("/user-settings/notifications")
async def update_notification_prefs(data: dict, current_user: dict = Depends(get_current_user)):
    allowed_keys = {
        "inapp_ticket_assigned", "inapp_ticket_updated", "inapp_ticket_escalated",
        "inapp_sla_breach", "inapp_sla_warning", "inapp_device_offline",
        "inapp_contract_renewal", "inapp_new_lead", "inapp_email_received",
    }
    safe_prefs = {key: bool(value) for key, value in data.items() if key in allowed_keys}
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"notification_prefs": safe_prefs, "user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": "Notification preferences updated"}

# ============== WORKING HOURS ==============

@router.get("/user-settings/working-hours")
async def get_working_hours(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    defaults = {
        "timezone": "Australia/Sydney",
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
    timezone_name = data.get("timezone") or "Australia/Sydney"
    try:
        ZoneInfo(timezone_name)
    except Exception:
        raise HTTPException(status_code=400, detail="Choose a valid timezone")
    schedule = data.get("schedule") or {}
    allowed_days = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
    clean_schedule = {}
    for day, value in schedule.items():
        if day not in allowed_days or not isinstance(value, dict):
            continue
        enabled = bool(value.get("enabled"))
        start, end = str(value.get("start") or ""), str(value.get("end") or "")
        if enabled and (not start or not end or start >= end):
            raise HTTPException(status_code=400, detail=f"{day.title()} must have an end time after its start time")
        clean_schedule[day] = {"enabled": enabled, "start": start, "end": end}
    clean_hours = {
        "timezone": timezone_name,
        "schedule": clean_schedule,
        "on_call": bool(data.get("on_call")),
        "auto_assign": data.get("auto_assign", True) is not False,
    }
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"working_hours": clean_hours, "user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": "Working hours updated"}

# ============== DISPLAY PREFERENCES ==============

@router.get("/user-settings/display")
async def get_display_prefs(current_user: dict = Depends(get_current_user)):
    settings = await db.user_settings.find_one({"user_id": current_user["id"]}, {"_id": 0})
    defaults = {
        "accent_color": "blue",
        "compact_mode": False,
        "date_format": "MMM d, yyyy",
        "time_format": "HH:mm",
        "timezone": "Australia/Sydney",
        "language": "en",
        "table_density": "normal",
        "sidebar_collapsed": False,
        "show_ticket_previews": True,
        "toast_position": "top-right",
        "toast_style": "nexus",
        "toast_duration": 4500,
        "toast_density": "comfortable",
    }
    return {**defaults, **(settings or {}).get("display_prefs", {})}

@router.put("/user-settings/display")
async def update_display_prefs(data: dict, current_user: dict = Depends(get_current_user)):
    allowed_positions = {"top-right", "top-left", "bottom-right", "bottom-left"}
    allowed_styles = {"nexus", "minimal", "compact"}
    allowed_durations = {3000, 4500, 6500, 9000}
    allowed_densities = {"comfortable", "compact"}
    if "toast_position" in data and data["toast_position"] not in allowed_positions:
        raise HTTPException(status_code=400, detail="Unsupported notification position")
    if "toast_style" in data and data["toast_style"] not in allowed_styles:
        raise HTTPException(status_code=400, detail="Unsupported notification style")
    if "toast_duration" in data and int(data["toast_duration"]) not in allowed_durations:
        raise HTTPException(status_code=400, detail="Unsupported notification duration")
    if "toast_density" in data and data["toast_density"] not in allowed_densities:
        raise HTTPException(status_code=400, detail="Unsupported notification density")
    await db.user_settings.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"display_prefs": data, "user_id": current_user["id"]}},
        upsert=True
    )
    return {"message": "Display preferences updated"}
