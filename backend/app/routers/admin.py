from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== AUDIT LOG ENDPOINTS ==============

@router.get("/audit-logs")
async def get_audit_logs(
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    if user_id:
        query["user_id"] = user_id
    if action:
        query["action"] = action
    
    logs = await db.audit_logs.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs

# ============== TECHNICIAN SCHEDULING ENDPOINTS ==============

@router.get("/schedule")
async def get_schedules(
    user_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if user_id:
        query["user_id"] = user_id
    if date_from:
        query["date"] = {"$gte": date_from}
    if date_to:
        if "date" in query:
            query["date"]["$lte"] = date_to
        else:
            query["date"] = {"$lte": date_to}
    
    schedules = await db.schedules.find(query, {"_id": 0}).sort("date", 1).to_list(1000)
    return schedules

@router.post("/schedule")
async def create_schedule_entry(schedule_data: dict, current_user: dict = Depends(get_current_user)):
    user_name = None
    user = await db.users.find_one({"id": schedule_data.get('user_id')}, {"_id": 0})
    user_name = user['name'] if user else None
    
    client_name = None
    if schedule_data.get('client_id'):
        client = await db.clients.find_one({"id": schedule_data['client_id']}, {"_id": 0})
        client_name = client['name'] if client else None
    
    date = schedule_data.get('date')
    start_time = schedule_data.get('start_time')
    end_time = schedule_data.get('end_time')
    if not date or not start_time or not end_time:
        raise HTTPException(status_code=400, detail="Date, start time, and end time are required")
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="End time must be later than start time")

    # A booking is never silently double-booked.  The frontend can show this
    # response as an approval step; the reason becomes part of the ticket and
    # organisation audit trail when an authorised user proceeds.
    occupied_types = ["appointment", "pto", "blocked", "on_call"]
    overlaps = await db.schedules.find({
        "user_id": schedule_data.get("user_id"),
        "date": date,
        "event_type": {"$in": occupied_types},
        "start_time": {"$lt": end_time},
        "end_time": {"$gt": start_time},
    }, {"_id": 0}).to_list(50)
    nearby_query = {
        "date": date,
        "event_type": "appointment",
        "start_time": {"$lt": end_time},
        "end_time": {"$gt": start_time},
        "user_id": {"$ne": schedule_data.get("user_id")},
    }
    if schedule_data.get("location"):
        nearby_query["location"] = {"$regex": f"^{__import__('re').escape(schedule_data['location'])}$", "$options": "i"}
    nearby = await db.schedules.find(nearby_query, {"_id": 0}).to_list(50)
    conflicts = {"overlaps": overlaps, "nearby": nearby}
    has_conflict = bool(overlaps or nearby)
    override_reason = (schedule_data.get("override_reason") or "").strip()
    if has_conflict and not schedule_data.get("approve_conflict"):
        raise HTTPException(status_code=409, detail={
            "message": "This booking overlaps an existing commitment or a technician is already at the same location.",
            "conflicts": conflicts,
            "requires_approval_note": True,
        })
    if has_conflict and not override_reason:
        raise HTTPException(status_code=400, detail="An approval note is required to proceed with a scheduling conflict")

    schedule = TechnicianSchedule(
        user_id=schedule_data.get('user_id'),
        user_name=user_name,
        date=date,
        start_time=start_time,
        end_time=end_time,
        event_type=schedule_data.get('event_type', 'appointment'),
        title=schedule_data.get('title'),
        description=schedule_data.get('description'),
        client_id=schedule_data.get('client_id'),
        client_name=client_name,
        ticket_id=schedule_data.get('ticket_id'),
        location=schedule_data.get('location')
    )
    doc = schedule.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['calendar_sync_state'] = 'queued' if schedule_data.get('sync_to_calendar', True) else 'not_requested'
    doc['conflict_approved'] = bool(has_conflict and schedule_data.get('approve_conflict'))
    doc['approval_note'] = override_reason if doc['conflict_approved'] else None
    await db.schedules.insert_one(doc)

    # A calendar connection is operational only when the booking reaches Graph.
    # The helper persists the precise state so dispatch can surface any action
    # needed rather than implying a queued booking was delivered.
    if schedule_data.get('sync_to_calendar', True):
        from app.routers.smart_scheduling import sync_schedule_to_microsoft
        calendar_result = await sync_schedule_to_microsoft(doc)
        doc['calendar_sync_state'] = calendar_result.get('state', doc['calendar_sync_state'])
        doc['calendar_event_id'] = calendar_result.get('event_id')
        doc['calendar_last_synced_at'] = calendar_result.get('synced_at')
        doc['calendar_sync_error'] = calendar_result.get('error')

    ticket_id = schedule_data.get('ticket_id')
    details = f"Appointment booked for {date} {start_time}-{end_time} with {user_name or 'assigned technician'}"
    if schedule_data.get('location'):
        details += f" at {schedule_data['location']}"
    if doc['conflict_approved']:
        details += f". Scheduling conflict approved: {override_reason}"
    if doc['calendar_sync_state'] == 'synced':
        details += ". Microsoft 365 calendar updated"
    elif doc['calendar_sync_state'] in {'not_connected', 'authentication_failed', 'failed'}:
        details += f". Microsoft 365 calendar requires attention ({doc['calendar_sync_state'].replace('_', ' ')})"
    if ticket_id:
        await db.ticket_comments.insert_one({
            "id": str(uuid.uuid4()), "ticket_id": ticket_id,
            "author_id": current_user.get("id", ""), "author_name": current_user.get("name", ""),
            "content": f"[Scheduling] {details}", "is_internal": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await ticket_audit(ticket_id, current_user, "appointment_scheduled", details)
    await log_activity(current_user, "appointment_scheduled", "schedule", doc["id"], doc.get("title") or "Appointment", details, metadata={"ticket_id": ticket_id, "conflict_approved": doc['conflict_approved']})
    doc.pop('_id', None)
    return doc

@router.put("/schedule/{schedule_id}")
async def update_schedule_entry(schedule_id: str, schedule_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.schedules.update_one({"id": schedule_id}, {"$set": schedule_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule entry not found")
    return {"message": "Schedule updated"}

@router.delete("/schedule/{schedule_id}")
async def delete_schedule_entry(schedule_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.schedules.delete_one({"id": schedule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Schedule entry not found")
    return {"message": "Schedule deleted"}

# ============== ON-CALL ROTATION ENDPOINTS ==============

@router.get("/on-call")
async def get_on_call_rotations(current_user: dict = Depends(get_current_user)):
    rotations = await db.on_call_rotations.find({}, {"_id": 0}).to_list(100)
    return rotations

@router.post("/on-call")
async def create_on_call_rotation(rotation_data: dict, current_user: dict = Depends(get_current_user)):
    rotation = OnCallRotation(
        name=rotation_data.get('name'),
        description=rotation_data.get('description'),
        rotation_type=rotation_data.get('rotation_type', 'weekly'),
        team_members=rotation_data.get('team_members', []),
        rotation_start_day=rotation_data.get('rotation_start_day', 0),
        rotation_start_time=rotation_data.get('rotation_start_time', '08:00'),
        escalation_timeout_minutes=rotation_data.get('escalation_timeout_minutes', 30),
        enabled=rotation_data.get('enabled', True)
    )
    doc = rotation.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.on_call_rotations.insert_one(doc)
    return rotation

@router.get("/on-call/current")
async def get_current_on_call(current_user: dict = Depends(get_current_user)):
    """Get currently on-call technician"""
    rotations = await db.on_call_rotations.find({"enabled": True}, {"_id": 0}).to_list(10)
    on_call = []
    for r in rotations:
        if r['team_members']:
            current_tech_id = r['team_members'][r['current_index'] % len(r['team_members'])]
            tech = await db.users.find_one({"id": current_tech_id}, {"_id": 0})
            on_call.append({
                "rotation_name": r['name'],
                "technician_id": current_tech_id,
                "technician_name": tech['name'] if tech else None,
                "technician_email": tech['email'] if tech else None
            })
    return on_call

# ============== CUSTOM FIELDS ENDPOINTS ==============

@router.get("/custom-fields")
async def get_custom_fields(entity_type: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    
    fields = await db.custom_fields.find(query, {"_id": 0}).sort("order", 1).to_list(100)
    return fields

@router.post("/custom-fields")
async def create_custom_field(field_data: dict, current_user: dict = Depends(get_current_user)):
    field = CustomFieldDefinition(
        entity_type=field_data.get('entity_type'),
        field_name=field_data.get('field_name'),
        field_label=field_data.get('field_label'),
        field_type=field_data.get('field_type', 'text'),
        dropdown_options=field_data.get('dropdown_options', []),
        is_required=field_data.get('is_required', False),
        is_visible_portal=field_data.get('is_visible_portal', False),
        default_value=field_data.get('default_value'),
        order=field_data.get('order', 0)
    )
    doc = field.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.custom_fields.insert_one(doc)
    return field

@router.delete("/custom-fields/{field_id}")
async def delete_custom_field(field_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.custom_fields.delete_one({"id": field_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Custom field not found")
    return {"message": "Custom field deleted"}

# ============== WEBHOOKS ENDPOINTS ==============

@router.get("/webhooks")
async def get_webhooks(current_user: dict = Depends(get_current_user)):
    webhooks = await db.webhooks.find({}, {"_id": 0}).to_list(100)
    return webhooks

@router.post("/webhooks")
async def create_webhook(webhook_data: dict, current_user: dict = Depends(get_current_user)):
    webhook = Webhook(
        name=webhook_data.get('name'),
        url=webhook_data.get('url'),
        secret=webhook_data.get('secret'),
        events=webhook_data.get('events', []),
        is_active=webhook_data.get('is_active', True),
        headers=webhook_data.get('headers', {})
    )
    doc = webhook.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.webhooks.insert_one(doc)
    return webhook

@router.put("/webhooks/{webhook_id}")
async def update_webhook(webhook_id: str, webhook_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.webhooks.update_one({"id": webhook_id}, {"$set": webhook_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Webhook updated"}

@router.delete("/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.webhooks.delete_one({"id": webhook_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return {"message": "Webhook deleted"}

@router.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: str, current_user: dict = Depends(get_current_user)):
    webhook = await db.webhooks.find_one({"id": webhook_id}, {"_id": 0})
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    
    try:
        async with httpx.AsyncClient() as http_client:
            response = await http_client.post(
                webhook['url'],
                json={"event": "test", "message": "Webhook test from NexusOps"},
                headers=webhook.get('headers', {}),
                timeout=10
            )
        
        await db.webhooks.update_one(
            {"id": webhook_id},
            {"$set": {"last_triggered": datetime.now(timezone.utc).isoformat(), "last_status": response.status_code}}
        )
        return {"success": response.status_code < 400, "status_code": response.status_code}
    except Exception as e:
        await db.webhooks.update_one(
            {"id": webhook_id},
            {"$inc": {"failure_count": 1}}
        )
        return {"success": False, "error": str(e)}

# ============== SITES / LOCATIONS ENDPOINTS ==============

@router.get("/sites")
async def get_sites(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    
    sites = await db.sites.find(query, {"_id": 0}).sort("name", 1).to_list(1000)
    return sites

@router.post("/sites")
async def create_site(site_data: dict, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": site_data.get('client_id')}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    site = Site(
        client_id=client['id'],
        client_name=client['name'],
        name=site_data.get('name'),
        address=site_data.get('address'),
        city=site_data.get('city'),
        state=site_data.get('state'),
        postal_code=site_data.get('postal_code'),
        country=site_data.get('country', 'USA'),
        phone=site_data.get('phone'),
        is_primary=site_data.get('is_primary', False),
        timezone=site_data.get('timezone', 'America/New_York'),
        notes=site_data.get('notes')
    )
    doc = site.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.sites.insert_one(doc)
    return site

@router.put("/sites/{site_id}")
async def update_site(site_id: str, site_data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.sites.update_one({"id": site_id}, {"$set": site_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"message": "Site updated"}

@router.delete("/sites/{site_id}")
async def delete_site(site_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.sites.delete_one({"id": site_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Site not found")
    return {"message": "Site deleted"}

