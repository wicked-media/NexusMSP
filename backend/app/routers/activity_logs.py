from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== UNIFIED ACTIVITY LOG ==============

async def log_activity(user: dict, action: str, entity_type: str, entity_id: str, entity_name: str = "", details: str = "", changes: dict = None, metadata: dict = None):
    """Log activity for cross-entity audit trail. Admin-visible only."""
    entry = {
        "id": str(uuid.uuid4()),
        "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "entity_name": entity_name,
        "details": details,
        "changes": changes or {},
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.activity_logs.insert_one(entry)

@router.get("/activity-logs")
async def get_activity_logs(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    technician_id: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
):
    """Get activity logs (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    if technician_id:
        query["user_id"] = technician_id
    logs = await db.activity_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs

@router.get("/activity-logs/entity/{entity_type}/{entity_id}")
async def get_entity_activity_log(entity_type: str, entity_id: str, current_user: dict = Depends(get_current_user)):
    """Get all activity for a specific entity (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    logs = await db.activity_logs.find({"entity_type": entity_type, "entity_id": entity_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs

@router.get("/technicians/{tech_id}/activity")
async def get_technician_activity(tech_id: str, limit: int = 200, current_user: dict = Depends(get_current_user)):
    """Get all activity performed by a technician (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    user = await db.users.find_one({"id": tech_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Technician not found")
    logs = await db.activity_logs.find({"user_id": tech_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    remote_sessions = await db.remote_sessions.find({"user_id": tech_id}, {"_id": 0}).sort("started_at", -1).to_list(200)
    return {
        "technician": {"id": user["id"], "name": user["name"]},
        "activity_logs": logs,
        "remote_sessions": remote_sessions,
    }

