from fastapi import APIRouter, Depends, Body, HTTPException
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/live-chat", tags=["Live Chat"])

# ====== Default canned responses (seed if empty) ======
DEFAULT_CANNED_RESPONSES = [
    {"shortcut": "/hello", "title": "Greeting", "content": "Hi {visitor}, thanks for reaching out. How can I help today?"},
    {"shortcut": "/check", "title": "Investigating", "content": "Let me check that for you — one moment, please."},
    {"shortcut": "/eta", "title": "ETA", "content": "I've escalated this to our team. Expected resolution within {eta}."},
    {"shortcut": "/ticket", "title": "Ticket created", "content": "I've created a ticket for this issue. You'll receive updates via email."},
    {"shortcut": "/pw-reset", "title": "Password reset", "content": "To reset your password, please visit the account page and click 'Forgot password'."},
    {"shortcut": "/thanks", "title": "Thanks/closing", "content": "Glad I could help! Is there anything else I can assist with today?"},
    {"shortcut": "/remote", "title": "Remote session", "content": "I'd like to remote into your device to investigate. Please accept the RustDesk prompt when it appears."},
]


@router.get("/sessions")
async def get_chat_sessions(
    status: str = None, search: str = None, assigned_to: str = None,
    user=Depends(get_current_user)
):
    query = {}
    if status:
        query["status"] = status
    if assigned_to:
        query["assigned_to"] = assigned_to
    if search:
        rx = {"$regex": search, "$options": "i"}
        query["$or"] = [{"visitor_name": rx}, {"client_name": rx}, {"subject": rx}, {"visitor_email": rx}]
    sessions = await db.chat_sessions.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
    # Enrich with unread count + last message preview
    for s in sessions:
        last = await db.chat_messages.find_one(
            {"session_id": s["id"]}, {"_id": 0}, sort=[("sent_at", -1)]
        )
        s["last_message"] = (last.get("content", "")[:100] if last else "")
        s["last_message_at"] = last.get("sent_at") if last else s.get("updated_at")
        s["unread_count"] = await db.chat_messages.count_documents(
            {"session_id": s["id"], "sender_type": "visitor", "read": False}
        )
    return sessions


@router.get("/stats")
async def chat_stats(user=Depends(get_current_user)):
    active = await db.chat_sessions.count_documents({"status": "active"})
    closed = await db.chat_sessions.count_documents({"status": "closed"})
    mine = await db.chat_sessions.count_documents({"status": "active", "assigned_to": user.get("id", "")})
    unassigned = await db.chat_sessions.count_documents({"status": "active", "$or": [{"assigned_to": ""}, {"assigned_to": None}]})
    total_msgs_today = await db.chat_messages.count_documents(
        {"sent_at": {"$gte": datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()}}
    )
    return {"active": active, "closed": closed, "mine": mine, "unassigned": unassigned, "messages_today": total_msgs_today}


@router.get("/sessions/{session_id}")
async def get_session_messages(session_id: str, user=Depends(get_current_user)):
    session = await db.chat_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("sent_at", 1).to_list(1000)

    # Mark visitor messages as read when agent opens the session
    await db.chat_messages.update_many(
        {"session_id": session_id, "sender_type": "visitor", "read": {"$ne": True}},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )

    # Enrich session with client context
    context = {"open_tickets": 0, "devices": 0, "last_ticket": None}
    if session.get("client_id"):
        context["open_tickets"] = await db.tickets.count_documents({"client_id": session["client_id"], "status": {"$nin": ["closed", "resolved"]}})
        context["devices"] = await db.devices.count_documents({"client_id": session["client_id"]})
        last_t = await db.tickets.find_one(
            {"client_id": session["client_id"]}, {"_id": 0, "id": 1, "title": 1, "status": 1, "created_at": 1},
            sort=[("created_at", -1)]
        )
        context["last_ticket"] = last_t

    return {"session": session, "messages": messages, "context": context}


@router.post("/sessions")
async def create_chat_session(payload: dict = Body(...), user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4())[:8],
        "client_id": payload.get("client_id", ""),
        "client_name": payload.get("client_name", ""),
        "visitor_name": payload.get("visitor_name", "Anonymous"),
        "visitor_email": payload.get("visitor_email", ""),
        "subject": payload.get("subject", ""),
        "priority": payload.get("priority", "normal"),
        "tags": payload.get("tags", []),
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
        "read": True,  # agent's own messages are "read"
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.chat_messages.insert_one(msg)
    await db.chat_sessions.update_one(
        {"id": session_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat(), "last_agent_reply_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {k: v for k, v in msg.items() if k != "_id"}


@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str, user=Depends(get_current_user)):
    await db.chat_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "closed", "closed_at": datetime.now(timezone.utc).isoformat(),
                  "closed_by": user.get("name", ""), "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Session closed"}


@router.post("/sessions/{session_id}/transfer")
async def transfer_session(session_id: str, payload: dict = Body(...), user=Depends(get_current_user)):
    """Transfer an active chat session to another agent/team."""
    target_user_id = payload.get("agent_id")
    if not target_user_id:
        raise HTTPException(status_code=400, detail="agent_id required")
    target = await db.users.find_one({"id": target_user_id}, {"_id": 0, "id": 1, "name": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target agent not found")

    now = datetime.now(timezone.utc).isoformat()
    await db.chat_sessions.update_one(
        {"id": session_id},
        {"$set": {"assigned_to": target["id"], "assigned_name": target["name"], "updated_at": now},
         "$push": {"transfer_history": {"from_name": user.get("name", ""), "to_name": target["name"],
                                        "note": payload.get("note", ""), "transferred_at": now}}}
    )
    # System message marking transfer
    await db.chat_messages.insert_one({
        "id": str(uuid.uuid4())[:8],
        "session_id": session_id,
        "sender_type": "system",
        "sender_name": "System",
        "content": f"Session transferred from {user.get('name', '')} to {target['name']}" + (f" — {payload.get('note')}" if payload.get('note') else ""),
        "read": True,
        "sent_at": now,
    })
    return {"message": f"Transferred to {target['name']}", "assigned_to": target["id"], "assigned_name": target["name"]}


@router.post("/sessions/{session_id}/create-ticket")
async def create_ticket_from_chat(session_id: str, user=Depends(get_current_user)):
    session = await db.chat_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).to_list(200)
    transcript = "\n".join([f"[{m.get('sent_at', '')[:16]}] {m.get('sender_name', 'Unknown')}: {m.get('content', '')}" for m in messages])

    now = datetime.now(timezone.utc).isoformat()
    ticket = {
        "id": f"TKT-CHAT-{str(uuid.uuid4())[:6].upper()}",
        "title": session.get("subject") or f"Chat inquiry from {session.get('visitor_name', 'visitor')}",
        "description": f"Created from live chat session.\n\nTranscript:\n{transcript}",
        "client_id": session.get("client_id", ""),
        "client_name": session.get("client_name", ""),
        "priority": session.get("priority", "medium"),
        "status": "open",
        "category": "support",
        "created_at": now,
        "updated_at": now,
        "source": "live_chat",
        "chat_session_id": session_id,
        "assigned_to_name": session.get("assigned_name", ""),
    }
    await db.tickets.insert_one(ticket)
    await db.chat_sessions.update_one({"id": session_id}, {"$set": {"ticket_id": ticket["id"], "updated_at": now}})

    return {"ticket_id": ticket["id"], "message": "Ticket created from chat"}


# ====== Canned Responses ======
@router.get("/canned-responses")
async def list_canned_responses(user=Depends(get_current_user)):
    docs = await db.chat_canned_responses.find({}, {"_id": 0}).sort("shortcut", 1).to_list(200)
    if not docs:
        # seed defaults
        for r in DEFAULT_CANNED_RESPONSES:
            await db.chat_canned_responses.insert_one({"id": str(uuid.uuid4())[:8], **r, "created_at": datetime.now(timezone.utc).isoformat()})
        docs = await db.chat_canned_responses.find({}, {"_id": 0}).sort("shortcut", 1).to_list(200)
    return docs


@router.post("/canned-responses")
async def create_canned_response(payload: dict = Body(...), user=Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4())[:8],
        "shortcut": payload.get("shortcut", ""),
        "title": payload.get("title", ""),
        "content": payload.get("content", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("name", ""),
    }
    await db.chat_canned_responses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.delete("/canned-responses/{cid}")
async def delete_canned_response(cid: str, user=Depends(get_current_user)):
    res = await db.chat_canned_responses.delete_one({"id": cid})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


@router.get("/agents")
async def list_available_agents(user=Depends(get_current_user)):
    """List users available to receive transfers."""
    users = await db.users.find(
        {"$or": [{"role": "admin"}, {"role": "tech"}, {"is_admin": True}]},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1}
    ).to_list(200)
    return users


@router.get("/widget-config")
async def get_widget_config(user=Depends(get_current_user)):
    return {
        "enabled": True,
        "greeting": "Hi! How can we help you today?",
        "offline_message": "We're currently offline. Leave a message and we'll get back to you.",
        "theme_color": "#2563eb",
        "position": "bottom-right",
    }
