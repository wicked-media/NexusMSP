from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_client_scope, scoped_query
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


@router.post(
    "/time-entries/generate-invoice",
    dependencies=[Depends(require_action("billing.invoice.create"))],
)
async def generate_invoice_from_time(data: dict, current_user: dict = Depends(get_current_user)):
    """Generate one auditable draft invoice from previously uninvoiced time."""
    client_name = data.get("client_name", "")
    entry_ids = data.get("entry_ids", [])
    if not client_name and not entry_ids:
        raise HTTPException(status_code=400, detail="Provide client_name or entry_ids")

    query = {"billable": True, "invoiced": {"$ne": True}}
    if entry_ids:
        query["id"] = {"$in": entry_ids}
    elif client_name:
        query["client_name"] = client_name
    entries = await db.time_entries.find(
        scoped_query(current_user, query, site_field=None),
        {"_id": 0},
    ).to_list(500)
    if not entries:
        raise HTTPException(status_code=404, detail="No uninvoiced billable time entries found")

    client_ids = {str(e.get("client_id") or "").strip() for e in entries}
    if "" in client_ids or len(client_ids) != 1:
        raise HTTPException(
            status_code=422,
            detail="Selected time entries must belong to one identified client",
        )
    client_id = next(iter(client_ids))
    await assert_client_scope(current_user, client_id, operation="time.invoice.generate")

    invoice_id = f"INV-{uuid.uuid4().hex[:6].upper()}"
    claimed_entries = []
    for entry in entries:
        result = await db.time_entries.update_one(
            {"id": entry["id"], "billable": True, "invoiced": {"$ne": True}},
            {"$set": {
                "invoiced": True,
                "invoice_id": invoice_id,
                "invoiced_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        if result.modified_count == 1:
            claimed_entries.append(entry)
    entries = claimed_entries
    if not entries:
        raise HTTPException(status_code=409, detail="The selected time entries were already invoiced")

    total_minutes = sum(e.get("minutes", 0) for e in entries)
    def entry_amount(entry: dict) -> float:
        stored = entry.get("total_amount")
        if stored is not None and float(stored) > 0:
            return round(float(stored), 2)
        return round((float(entry.get("minutes") or 0) / 60) * float(entry.get("hourly_rate") or 75), 2)

    total_amount = sum(entry_amount(e) for e in entries)
    line_items = []
    for e in entries:
        hrs = round(e.get("minutes", 0) / 60, 2)
        line_items.append({
            "description": f'{e.get("ticket_title", "N/A")} - {e.get("description", "")}',
            "hours": hrs,
            "rate": e.get("hourly_rate", 75),
            "amount": entry_amount(e),
            "date": e.get("date", ""),
            "tech": e.get("user_name", ""),
        })

    invoice = {
        "id": invoice_id,
        "client_id": client_id,
        "client_name": client_name or entries[0].get("client_name", "Unknown"),
        "status": "draft",
        "total_hours": round(total_minutes / 60, 2),
        "total_amount": round(total_amount, 2),
        "line_items": line_items,
        "entry_count": len(entries),
        "generated_from": "time_tracking",
        "ticket_ids": sorted({e.get("ticket_id") for e in entries if e.get("ticket_id")}),
        "source_refs": [
            {
                "type": "time_entry",
                "id": e["id"],
                "ticket_id": e.get("ticket_id"),
                "remote_session_id": e.get("remote_session_id"),
            }
            for e in entries
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", "Admin"),
    }
    try:
        await db.invoices.insert_one(invoice)
    except Exception:
        await db.time_entries.update_many(
            {"id": {"$in": [e["id"] for e in entries]}, "invoice_id": invoice_id},
            {"$set": {"invoiced": False}, "$unset": {"invoice_id": "", "invoiced_at": ""}},
        )
        raise
    invoice.pop("_id", None)

    await log_activity(
        current_user,
        "invoice_generated_from_time",
        "invoice",
        invoice_id,
        invoice_id,
        f"Generated draft invoice from {len(entries)} billable time entr{'y' if len(entries) == 1 else 'ies'}.",
        metadata={
            "client_id": client_id,
            "time_entry_ids": [e["id"] for e in entries],
            "ticket_ids": invoice["ticket_ids"],
            "total_amount": invoice["total_amount"],
        },
    )

    return invoice


@router.post("/time-entries/bulk")
async def bulk_create_time_entries(data: dict, current_user: dict = Depends(get_current_user)):
    """Create multiple time entries at once"""
    entries_data = data.get("entries", [])
    if not entries_data:
        raise HTTPException(status_code=400, detail="No entries provided")
    created = []
    for ed in entries_data:
        entry = {
            "id": f"TE-{uuid.uuid4().hex[:8]}",
            "ticket_id": ed.get("ticket_id", ""),
            "ticket_title": ed.get("ticket_title", ""),
            "user_id": ed.get("user_id", current_user.get("id", "")),
            "user_name": ed.get("user_name", current_user.get("name", "")),
            "client_id": ed.get("client_id", ""),
            "client_name": ed.get("client_name", ""),
            "minutes": ed.get("minutes", 0),
            "description": ed.get("description", ""),
            "billable": ed.get("billable", True),
            "date": ed.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
            "hourly_rate": ed.get("hourly_rate", 75),
            "total_amount": round(ed.get("minutes", 0) / 60 * ed.get("hourly_rate", 75), 2) if ed.get("billable", True) else 0,
            "category": ed.get("category", "general"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.time_entries.insert_one(entry)
        entry.pop("_id", None)
        created.append(entry)
    return {"created": len(created), "entries": created}

