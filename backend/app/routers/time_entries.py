from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== TIME ENTRIES ENDPOINTS ==============

@router.get("/time-entries", response_model=List[TimeEntry])
async def get_time_entries(
    ticket_id: Optional[str] = None,
    user_id: Optional[str] = None,
    client_id: Optional[str] = None,
    billable: Optional[bool] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if ticket_id:
        query["ticket_id"] = ticket_id
    if user_id:
        query["user_id"] = user_id
    if client_id:
        query["client_id"] = client_id
    if billable is not None:
        query["billable"] = billable
    
    entries = await db.time_entries.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for e in entries:
        if isinstance(e.get('created_at'), str):
            e['created_at'] = datetime.fromisoformat(e['created_at'])
    return entries

@router.post("/time-entries", response_model=TimeEntry)
async def create_time_entry(entry_data: TimeEntryCreate, current_user: dict = Depends(get_current_user)):
    ticket = await db.tickets.find_one({"id": entry_data.ticket_id}, {"_id": 0})
    user = await db.users.find_one({"id": entry_data.user_id}, {"_id": 0})
    
    hourly_rate = user.get('hourly_rate', 75.0) if user else 75.0
    total_amount = (entry_data.minutes / 60) * hourly_rate if entry_data.billable else 0
    
    entry = TimeEntry(
        **entry_data.model_dump(),
        ticket_title=ticket['title'] if ticket else None,
        client_id=ticket['client_id'] if ticket else None,
        client_name=ticket['client_name'] if ticket else None,
        user_name=user['name'] if user else None,
        hourly_rate=hourly_rate,
        total_amount=total_amount
    )
    doc = entry.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.time_entries.insert_one(doc)
    
    # Update ticket total time
    if ticket:
        await db.tickets.update_one(
            {"id": entry_data.ticket_id},
            {"$inc": {"total_time_minutes": entry_data.minutes}}
        )
    
    return entry

@router.put("/time-entries/{entry_id}")
async def update_time_entry(entry_id: str, entry_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.time_entries.update_one({"id": entry_id}, {"$set": entry_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Time entry not found")
    return {"message": "Time entry updated"}

@router.delete("/time-entries/{entry_id}")
async def delete_time_entry(entry_id: str, current_user: dict = Depends(get_current_user)):
    entry = await db.time_entries.find_one({"id": entry_id}, {"_id": 0})
    if entry:
        await db.tickets.update_one(
            {"id": entry['ticket_id']},
            {"$inc": {"total_time_minutes": -entry['minutes']}}
        )
    result = await db.time_entries.delete_one({"id": entry_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Time entry not found")
    return {"message": "Time entry deleted"}

# ============== TIME TRACKING ENHANCED ==============

@router.get("/time-entries/weekly-summary")
async def get_weekly_time_summary(current_user: dict = Depends(get_current_user)):
    week_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = week_start - timedelta(days=week_start.weekday())
    entries = await db.time_entries.find({"date": {"$gte": week_start.strftime('%Y-%m-%d')}}, {"_id": 0}).to_list(10000)
    by_user = {}
    for e in entries:
        uid = e.get("user_id", "unknown")
        if uid not in by_user:
            by_user[uid] = {"user_id": uid, "user_name": e.get("user_name", ""), "total_minutes": 0, "billable_minutes": 0, "entries": 0}
        by_user[uid]["total_minutes"] += e.get("minutes", 0)
        if e.get("billable"):
            by_user[uid]["billable_minutes"] += e.get("minutes", 0)
        by_user[uid]["entries"] += 1
    by_day = {}
    for e in entries:
        d = e.get("date", "")[:10]
        if d not in by_day:
            by_day[d] = {"date": d, "total_minutes": 0, "billable_minutes": 0, "entries": 0}
        by_day[d]["total_minutes"] += e.get("minutes", 0)
        if e.get("billable"):
            by_day[d]["billable_minutes"] += e.get("minutes", 0)
        by_day[d]["entries"] += 1
    total = sum(e.get("minutes", 0) for e in entries)
    billable = sum(e.get("minutes", 0) for e in entries if e.get("billable"))
    return {
        "week_start": week_start.strftime('%Y-%m-%d'),
        "total_hours": round(total / 60, 1),
        "billable_hours": round(billable / 60, 1),
        "non_billable_hours": round((total - billable) / 60, 1),
        "by_user": list(by_user.values()),
        "by_day": sorted(by_day.values(), key=lambda x: x["date"]),
        "total_entries": len(entries),
    }

