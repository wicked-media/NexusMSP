from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== SCHEDULING ENDPOINTS ==============

@router.get("/schedule")
async def get_schedule(current_user: dict = Depends(get_current_user)):
    entries = await db.schedule_entries.find({}, {"_id": 0}).to_list(5000)
    return entries

@router.post("/schedule")
async def create_schedule_entry(entry_data: dict, current_user: dict = Depends(get_current_user)):
    entry = {
        "id": str(uuid.uuid4()),
        "ticket_id": entry_data.get("ticket_id"),
        "ticket_number": entry_data.get("ticket_number", ""),
        "ticket_title": entry_data.get("ticket_title", ""),
        "technician_id": entry_data.get("technician_id"),
        "technician_name": entry_data.get("technician_name", ""),
        "start": entry_data.get("start"),
        "end": entry_data.get("end"),
        "notes": entry_data.get("notes", ""),
        "color": entry_data.get("color", "#3B82F6"),
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.schedule_entries.insert_one(entry)
    entry.pop("_id", None)
    return entry

@router.put("/schedule/{entry_id}")
async def update_schedule_entry(entry_id: str, entry_data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"start", "end", "technician_id", "technician_name", "notes", "color"}
    update = {k: v for k, v in entry_data.items() if k in allowed}
    await db.schedule_entries.update_one({"id": entry_id}, {"$set": update})
    return {"message": "Schedule entry updated"}

@router.delete("/schedule/{entry_id}")
async def delete_schedule_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    await db.schedule_entries.delete_one({"id": entry_id})
    return {"message": "Schedule entry deleted"}

