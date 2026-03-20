from fastapi import APIRouter, Depends, Body
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/live-chat", tags=["Live Chat"])

@router.get("/sessions")
async def get_chat_sessions(user=Depends(get_current_user)):
    sessions = await db.chat_sessions.find({}, {"_id": 0}).sort("updated_at", -1).to_list(100)
    return sessions

@router.get("/sessions/{session_id}")
async def get_session_messages(session_id: str, user=Depends(get_current_user)):
    session = await db.chat_sessions.find_one({"id": session_id}, {"_id": 0})
    messages = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("sent_at", 1).to_list(500)
    return {"session": session, "messages": messages}

@router.post("/sessions")
async def create_chat_session(payload: dict = Body(...), user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4())[:8],
        "client_id": payload.get("client_id", ""),
        "client_name": payload.get("client_name", ""),
        "visitor_name": payload.get("visitor_name", "Anonymous"),
        "visitor_email": payload.get("visitor_email", ""),
        "subject": payload.get("subject", ""),
        "status": "active",
        "assigned_to": user.get("id", ""),
        "assigned_name": user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.chat_sessions.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}

@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, payload: dict = Body(...), user=Depends(get_current_user)):
    msg = {
        "id": str(uuid.uuid4())[:8],
        "session_id": session_id,
        "sender_type": "agent",
        "sender_name": user.get("name", "Agent"),
        "sender_id": user.get("id", ""),
        "content": payload.get("content", ""),
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.chat_messages.insert_one(msg)
    await db.chat_sessions.update_one({"id": session_id}, {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}})
    return {k: v for k, v in msg.items() if k != "_id"}

@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str, user=Depends(get_current_user)):
    await db.chat_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "closed", "closed_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Session closed"}

@router.post("/sessions/{session_id}/create-ticket")
async def create_ticket_from_chat(session_id: str, user=Depends(get_current_user)):
    session = await db.chat_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        return {"error": "Session not found"}
    
    messages = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).to_list(100)
    transcript = "\n".join([f"{m.get('sender_name', 'Unknown')}: {m.get('content', '')}" for m in messages])
    
    ticket = {
        "id": f"TKT-CHAT-{str(uuid.uuid4())[:6].upper()}",
        "title": session.get("subject") or f"Chat inquiry from {session.get('visitor_name', 'visitor')}",
        "description": f"Created from live chat session.\n\nTranscript:\n{transcript}",
        "client_id": session.get("client_id", ""),
        "client_name": session.get("client_name", ""),
        "priority": "medium",
        "status": "open",
        "category": "support",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "source": "live_chat",
        "chat_session_id": session_id,
    }
    await db.tickets.insert_one(ticket)
    
    return {"ticket_id": ticket["id"], "message": "Ticket created from chat"}

@router.get("/widget-config")
async def get_widget_config(user=Depends(get_current_user)):
    return {
        "enabled": True,
        "greeting": "Hi! How can we help you today?",
        "offline_message": "We're currently offline. Leave a message and we'll get back to you.",
        "theme_color": "#2563eb",
        "position": "bottom-right",
    }
