from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

import shutil

# ============== AVATAR UPLOAD ==============

@router.post("/technicians/{tech_id}/avatar")
async def upload_avatar(tech_id: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    """Upload profile picture for a technician"""
    user = await db.users.find_one({"id": tech_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    if current_user["id"] != tech_id:
        caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
        if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
            raise HTTPException(status_code=403, detail="Can only update your own avatar or admin required")
    
    ext = file.filename.split(".")[-1].lower() if file.filename else "png"
    if ext not in ["jpg", "jpeg", "png", "webp", "gif"]:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: jpg, jpeg, png, webp, gif")
    
    filename = f"{tech_id}.{ext}"
    filepath = AVATARS_DIR / filename
    
    # Remove old avatar if different extension
    for old_ext in ["jpg", "jpeg", "png", "webp", "gif"]:
        old_path = AVATARS_DIR / f"{tech_id}.{old_ext}"
        if old_path.exists() and old_path != filepath:
            old_path.unlink()
    
    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)
    
    avatar_updated_at = datetime.now(timezone.utc).isoformat()
    avatar_url = f"/api/uploads/avatars/{filename}?v={uuid.uuid4().hex}"
    await db.users.update_one({"id": tech_id}, {"$set": {
        "avatar": avatar_url,
        "avatar_updated_at": avatar_updated_at,
    }})
    await log_activity(
        current_user,
        "profile_photo_updated",
        "technician",
        tech_id,
        user.get("name", "Technician"),
        "Updated technician profile photo.",
    )
    return {
        "message": "Avatar uploaded",
        "avatar_url": avatar_url,
        "avatar_updated_at": avatar_updated_at,
    }

@router.put("/technicians/{tech_id}/profile")
async def update_tech_profile(tech_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Update technician profile (about_me, hire_date, birthday, etc.)"""
    user = await db.users.find_one({"id": tech_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    if current_user["id"] != tech_id:
        caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
        if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
            raise HTTPException(status_code=403, detail="Unauthorized")
    
    allowed_fields = {"about_me", "hire_date", "birthday", "job_title", "phone", "specialties", "name", "email"}
    update = {k: v for k, v in data.items() if k in allowed_fields}
    if update:
        await db.users.update_one({"id": tech_id}, {"$set": update})

    # Mirror profile-extras to technician_profiles (the source of truth for /team/{id}/profile)
    extra_fields = {"specialties", "certifications", "bio", "timezone", "on_call", "working_hours"}
    extras = {k: v for k, v in data.items() if k in extra_fields}
    if extras:
        extras["user_id"] = tech_id
        extras["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.technician_profiles.update_one(
            {"user_id": tech_id}, {"$set": extras}, upsert=True,
        )
    return {"message": "Profile updated"}

# ============== TECHNICIAN STATUS / HOVER CARD ==============

@router.get("/technicians/{tech_id}/status")
async def get_technician_status(tech_id: str, current_user: dict = Depends(get_current_user)):
    """Get current status for hover card - active sessions, assigned tickets, etc."""
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    
    # Active remote sessions
    active_sessions = await db.remote_sessions.find({"user_id": tech_id, "status": "active"}, {"_id": 0}).to_list(10)
    now = datetime.now(timezone.utc)
    for s in active_sessions:
        try:
            started = datetime.fromisoformat(str(s["started_at"]).replace("Z", "+00:00"))
            s["live_duration_minutes"] = int((now - started).total_seconds() / 60)
        except:
            s["live_duration_minutes"] = 0
    
    # Enrich active sessions with client name from device
    for s in active_sessions:
        device = await db.devices.find_one({"id": s.get("device_id")}, {"_id": 0, "client_name": 1, "client_id": 1, "name": 1})
        if device:
            s["device_name"] = device.get("name", s.get("device_name"))
            s["client_name"] = device.get("client_name", s.get("client_name", ""))
    
    # Assigned open tickets
    assigned_tickets = await db.tickets.find(
        {"assigned_to": tech_id, "status": {"$nin": ["closed", "resolved"]}},
        {"_id": 0, "id": 1, "title": 1, "ticket_number": 1, "priority": 1, "status": 1, "client_name": 1}
    ).to_list(20)
    
    # Determine status
    if active_sessions:
        status_text = f"In remote session with {active_sessions[0].get('client_name', 'a client')}"
        status_type = "remote"
    elif assigned_tickets:
        status_text = f"Working on {len(assigned_tickets)} ticket(s)"
        status_type = "active"
    else:
        status_text = "Available"
        status_type = "available"
    
    # Achievements count
    achievement_count = await db.user_achievements.count_documents({"user_id": tech_id})
    
    return {
        "user_id": tech_id,
        "name": user.get("name"),
        "avatar": user.get("avatar"),
        "job_title": user.get("job_title", ""),
        "status_text": status_text,
        "status_type": status_type,
        "active_sessions": active_sessions,
        "assigned_tickets": assigned_tickets,
        "achievement_count": achievement_count,
        "about_me": user.get("about_me", ""),
    }

