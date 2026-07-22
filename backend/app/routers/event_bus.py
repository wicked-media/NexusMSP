from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import uuid
import json
import asyncio
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# In-memory event store for SSE
_event_subscribers: Dict[str, asyncio.Queue] = {}
_ticket_viewers: Dict[str, Dict[str, dict]] = {}

# ============== REAL-TIME EVENT BUS ==============

@router.post("/events/publish")
async def publish_event(data: dict, current_user: dict = Depends(get_current_user)):
    """Publish an event to all subscribers"""
    event = {
        "id": str(uuid.uuid4()),
        "type": data.get("type", "general"),
        "source": data.get("source", "system"),
        "payload": data.get("payload", {}),
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    
    await db.events.insert_one({**event})
    
    for user_id, queue in list(_event_subscribers.items()):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass
    
    return {"message": "Event published", "event_id": event["id"]}

@router.get("/events/stream")
async def event_stream(request: Request, current_user: dict = Depends(get_current_user)):
    """SSE endpoint for real-time events"""
    user_id = current_user["id"]
    queue = asyncio.Queue(maxsize=100)
    _event_subscribers[user_id] = queue
    
    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"
        finally:
            _event_subscribers.pop(user_id, None)
    
    return StreamingResponse(generate(), media_type="text/event-stream")

@router.get("/events/recent")
async def get_recent_events(
    event_type: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if event_type:
        query["type"] = event_type
    events = await db.events.find(query, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return events

# ============== TICKET VIEWER TRACKING ==============

@router.post("/tickets/{ticket_id}/viewing")
async def mark_viewing_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Mark that a user is currently viewing a ticket"""
    if ticket_id not in _ticket_viewers:
        _ticket_viewers[ticket_id] = {}
    
    _ticket_viewers[ticket_id][current_user["id"]] = {
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "avatar_url": current_user.get("avatar"),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    
    for uid, queue in list(_event_subscribers.items()):
        try:
            queue.put_nowait({
                "type": "ticket_viewing",
                "payload": {
                    "ticket_id": ticket_id,
                    "viewers": list(_ticket_viewers.get(ticket_id, {}).values()),
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except asyncio.QueueFull:
            pass
    
    return {"message": "Viewing status updated"}

@router.post("/tickets/{ticket_id}/stop-viewing")
async def stop_viewing_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Mark that a user stopped viewing a ticket"""
    if ticket_id in _ticket_viewers:
        _ticket_viewers[ticket_id].pop(current_user["id"], None)
        if not _ticket_viewers[ticket_id]:
            del _ticket_viewers[ticket_id]
    
    for uid, queue in list(_event_subscribers.items()):
        try:
            queue.put_nowait({
                "type": "ticket_viewing",
                "payload": {
                    "ticket_id": ticket_id,
                    "viewers": list(_ticket_viewers.get(ticket_id, {}).values()),
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except asyncio.QueueFull:
            pass
    
    return {"message": "Viewing status cleared"}

@router.get("/tickets/active-viewers")
async def get_all_active_viewers(current_user: dict = Depends(get_current_user)):
    """Get all tickets currently being viewed and by whom"""
    result = {}
    for ticket_id, viewers in _ticket_viewers.items():
        if viewers:
            result[ticket_id] = list(viewers.values())
    return result
