from fastapi import APIRouter, Depends, Body, HTTPException, Header
from app.database import db
from app.auth import get_current_user
from app.services.scope_permissions import assert_client_scope, scoped_query, tenant_scoped_query
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/live-chat", tags=["Live Chat"])

# Ephemeral presence is intentionally separate from the durable transcript.
# Each participant must refresh their state while composing; stale records are
# ignored so a closed browser or agent never leaves a false typing indicator.
_typing_by_session: dict[str, dict[str, dict]] = {}


def _active_typers(session_id: str, exclude_user_id: str | None = None) -> list[dict]:
    now = datetime.now(timezone.utc)
    active: list[dict] = []
    for participant in _typing_by_session.get(session_id, {}).values():
        try:
            updated = datetime.fromisoformat(str(participant.get("updated_at") or "").replace("Z", "+00:00"))
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            if (now - updated).total_seconds() < 8 and participant.get("user_id") != exclude_user_id:
                active.append({key: participant.get(key) for key in ("user_id", "name", "role")})
        except (TypeError, ValueError):
            continue
    return active


async def _require_session(session_id: str, user: dict, *, active: bool = False) -> dict:
    """Load a tenant/client-authorised support conversation for a technician."""
    session = await db.chat_sessions.find_one(tenant_scoped_query(user, {"id": session_id}), {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await assert_client_scope(user, session.get("client_id"), operation="live_chat.session", mask_not_found=True)
    if active and session.get("status") != "active":
        raise HTTPException(status_code=409, detail="This chat session is closed")
    return session


async def _require_active_session(session_id: str, user: dict) -> dict:
    return await _require_session(session_id, user, active=True)


async def _mirror_ticket_chat_activity(
    session: dict,
    *,
    event_type: str,
    content: str,
    actor_name: str,
    actor_id: str = "",
    occurred_at: str | None = None,
) -> None:
    """Keep post-ticket chat activity visible in the ticket's private audit trail."""
    ticket_id = session.get("ticket_id")
    if not ticket_id:
        return

    now = occurred_at or datetime.now(timezone.utc).isoformat()
    labels = {
        "visitor_message": "Client message",
        "technician_message": "Technician reply",
        "transferred": "Chat transferred",
        "closed": "Chat closed",
        "ticket_created": "Ticket linked to live chat",
    }
    label = labels.get(event_type, "Live chat activity")
    note_content = f"Live Chat | {label}\n\n{content}".strip()
    await db.ticket_notes.insert_one({
        "id": uuid.uuid4().hex,
        "ticket_id": ticket_id,
        "user_id": actor_id,
        "user_name": actor_name or "Nexus Live Chat",
        "content": note_content,
        "is_internal": True,
        "is_system_action": True,
        "source": "live_chat",
        "chat_session_id": session.get("id"),
        "created_at": now,
    })
    await db.ticket_audit_log.insert_one({
        "id": uuid.uuid4().hex,
        "ticket_id": ticket_id,
        "user_id": actor_id,
        "user_name": actor_name or "Nexus Live Chat",
        "action": "live_chat_activity",
        "details": f"{label}: {content[:180]}",
        "chat_session_id": session.get("id"),
        "created_at": now,
    })


async def _agent_live_chat_session(x_agent_token: str | None) -> dict:
    if not x_agent_token:
        raise HTTPException(status_code=401, detail="missing agent token")
    agent = await db.nexus_agents.find_one({"agent_token": x_agent_token, "is_active": True}, {"_id": 0})
    if not agent:
        raise HTTPException(status_code=401, detail="invalid agent token")
    session = await db.chat_sessions.find_one({"agent_device_id": agent["id"], "status": "active"}, {"_id": 0})
    if session:
        return session
    now = datetime.now(timezone.utc).isoformat()
    session = {
        "id": str(uuid.uuid4())[:8], "agent_device_id": agent["id"],
        "tenant_id": agent.get("tenant_id") or "nexus-local",
        "client_id": agent.get("client_id", ""), "client_name": agent.get("client_name", ""),
        "visitor_name": agent.get("hostname") or "Device user", "subject": "Nexus Agent live support",
        "priority": "normal", "status": "active", "assigned_to": "", "assigned_name": "",
        "created_at": now, "updated_at": now,
    }
    await db.chat_sessions.insert_one(session)
    session.pop("_id", None)
    return session


@router.get("/agent/session")
async def get_agent_session(x_agent_token: str | None = Header(default=None)):
    """Local companion bridge: no browser ever receives the agent token."""
    session = await _agent_live_chat_session(x_agent_token)
    messages = await db.chat_messages.find({"session_id": session["id"]}, {"_id": 0}).sort("sent_at", 1).to_list(500)
    await db.chat_messages.update_many({"session_id": session["id"], "sender_type": "agent"}, {"$set": {"read": True}})
    return {"session": session, "messages": messages, "typing_users": _active_typers(session["id"])}


@router.post("/agent/session/messages")
async def send_agent_visitor_message(payload: dict = Body(...), x_agent_token: str | None = Header(default=None)):
    session = await _agent_live_chat_session(x_agent_token)
    content = str(payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="message content required")
    now = datetime.now(timezone.utc).isoformat()
    msg = {"id": str(uuid.uuid4())[:8], "session_id": session["id"], "sender_type": "visitor", "sender_name": session["visitor_name"], "content": content, "read": False, "sent_at": now}
    await db.chat_messages.insert_one(msg)
    await db.chat_sessions.update_one({"id": session["id"]}, {"$set": {"updated_at": now}})
    await _mirror_ticket_chat_activity(
        session,
        event_type="visitor_message",
        content=content,
        actor_name=session.get("visitor_name") or "Client",
        occurred_at=now,
    )
    _typing_by_session.get(session["id"], {}).pop("visitor", None)
    msg.pop("_id", None)
    return msg


@router.post("/agent/session/typing")
async def set_agent_visitor_typing(payload: dict = Body(...), x_agent_token: str | None = Header(default=None)):
    session = await _agent_live_chat_session(x_agent_token)
    typers = _typing_by_session.setdefault(session["id"], {})
    if payload.get("typing"):
        typers["visitor"] = {"user_id": "visitor", "name": session["visitor_name"], "role": "client", "updated_at": datetime.now(timezone.utc).isoformat()}
    else:
        typers.pop("visitor", None)
    return {"typing_users": _active_typers(session["id"], "visitor")}

# ====== Default canned responses (seed if empty) ======
LEGACY_REMOTE_CANNED_CONTENT = "I'd like to remote into your device to investigate. Please accept the RustDesk prompt when it appears."
NEXUS_REMOTE_CANNED_CONTENT = "I'd like to start a Nexus Remote support session to investigate. Please accept the Nexus Remote request when it appears."

DEFAULT_CANNED_RESPONSES = [
    {"shortcut": "/hello", "title": "Greeting", "content": "Hi {visitor}, thanks for reaching out. How can I help today?"},
    {"shortcut": "/check", "title": "Investigating", "content": "Let me check that for you — one moment, please."},
    {"shortcut": "/eta", "title": "ETA", "content": "I've escalated this to our team. Expected resolution within {eta}."},
    {"shortcut": "/ticket", "title": "Ticket created", "content": "I've created a ticket for this issue. You'll receive updates via email."},
    {"shortcut": "/pw-reset", "title": "Password reset", "content": "To reset your password, please visit the account page and click 'Forgot password'."},
    {"shortcut": "/thanks", "title": "Thanks/closing", "content": "Glad I could help! Is there anything else I can assist with today?"},
    {"shortcut": "/remote", "title": "Remote session", "content": NEXUS_REMOTE_CANNED_CONTENT},
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
    sessions = await db.chat_sessions.find(tenant_scoped_query(user, scoped_query(user, query)), {"_id": 0}).sort("updated_at", -1).to_list(500)
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


@router.post("/devices/{device_id}/open")
async def open_device_chat(device_id: str, user=Depends(get_current_user)):
    """Open the single, auditable live-support session bound to an asset."""
    device = await db.devices.find_one(tenant_scoped_query(user, scoped_query(user, {"id": device_id})), {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Asset not found")
    agent_id = device.get("nexus_agent_id")
    if not agent_id:
        raise HTTPException(status_code=409, detail="This asset does not have a NexusOps Agent enrolled")
    agent = await db.nexus_agents.find_one(tenant_scoped_query(user, scoped_query(user, {"id": agent_id, "is_active": True})), {"_id": 0})
    if not agent:
        raise HTTPException(status_code=409, detail="The enrolled NexusOps Agent is unavailable")
    session = await db.chat_sessions.find_one({"agent_device_id": agent_id, "status": "active"}, {"_id": 0})
    now = datetime.now(timezone.utc).isoformat()
    if not session:
        session = {
            "id": str(uuid.uuid4())[:8], "agent_device_id": agent_id, "asset_id": device_id,
            "tenant_id": user.get("tenant_id") or "nexus-local",
            "client_id": device.get("client_id", ""), "client_name": device.get("client_name", ""),
            "visitor_name": agent.get("hostname") or device.get("name") or "Device user",
            "subject": f"Device support — {device.get('name') or agent.get('hostname') or 'asset'}",
            "priority": "normal", "status": "active", "assigned_to": user.get("id", ""),
            "assigned_name": user.get("name", ""), "created_at": now, "updated_at": now,
        }
        await db.chat_sessions.insert_one(session)
        session.pop("_id", None)
        await db.chat_messages.insert_one({"id": str(uuid.uuid4())[:8], "session_id": session["id"], "sender_type": "system", "sender_name": "NexusMSP", "content": f"{user.get('name') or 'A technician'} opened live support for this asset.", "read": True, "sent_at": now})
    elif not session.get("assigned_to"):
        await db.chat_sessions.update_one({"id": session["id"]}, {"$set": {"assigned_to": user.get("id", ""), "assigned_name": user.get("name", ""), "updated_at": now}})
        session["assigned_to"], session["assigned_name"] = user.get("id", ""), user.get("name", "")
    return {"session": session, "asset": {"id": device_id, "name": device.get("name"), "online": bool(agent.get("last_seen"))}}


@router.get("/stats")
async def chat_stats(user=Depends(get_current_user)):
    scoped_sessions = tenant_scoped_query(user, scoped_query(user))
    active = await db.chat_sessions.count_documents(tenant_scoped_query(user, scoped_query(user, {"status": "active"})))
    closed = await db.chat_sessions.count_documents(tenant_scoped_query(user, scoped_query(user, {"status": "closed"})))
    mine = await db.chat_sessions.count_documents(tenant_scoped_query(user, scoped_query(user, {"status": "active", "assigned_to": user.get("id", "")})))
    unassigned = await db.chat_sessions.count_documents(tenant_scoped_query(user, scoped_query(user, {"status": "active", "$or": [{"assigned_to": ""}, {"assigned_to": None}]})))
    session_rows = await db.chat_sessions.find(scoped_sessions, {"_id": 0, "id": 1}).to_list(5000)
    session_ids = [row.get("id") for row in session_rows if row.get("id")]
    total_msgs_today = await db.chat_messages.count_documents(
        {"session_id": {"$in": session_ids}, "sent_at": {"$gte": datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()}}
    )
    return {"active": active, "closed": closed, "mine": mine, "unassigned": unassigned, "messages_today": total_msgs_today}


@router.get("/sessions/{session_id}")
async def get_session_messages(session_id: str, user=Depends(get_current_user)):
    session = await _require_session(session_id, user)
    messages = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("sent_at", 1).to_list(1000)

    # Mark visitor messages as read when agent opens the session
    await db.chat_messages.update_many(
        {"session_id": session_id, "sender_type": "visitor", "read": {"$ne": True}},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc).isoformat()}}
    )

    # Enrich session with client context
    context = {"open_tickets": 0, "devices": 0, "last_ticket": None, "endpoint": None}
    if session.get("client_id"):
        context["open_tickets"] = await db.tickets.count_documents({"client_id": session["client_id"], "status": {"$nin": ["closed", "resolved"]}})
        context["devices"] = await db.devices.count_documents({"client_id": session["client_id"]})
        last_t = await db.tickets.find_one(
            {"client_id": session["client_id"]}, {"_id": 0, "id": 1, "title": 1, "status": 1, "created_at": 1},
            sort=[("created_at", -1)]
        )
        context["last_ticket"] = last_t

    # A device-originated chat is tied to one managed endpoint. Its verified
    # Elevate lifecycle belongs in the technician's immediate support context.
    endpoint = None
    if session.get("asset_id"):
        endpoint = await db.devices.find_one({"id": session["asset_id"]}, {"_id": 0})
    if not endpoint and session.get("agent_device_id"):
        endpoint = await db.devices.find_one({"nexus_agent_id": session["agent_device_id"]}, {"_id": 0})
    if endpoint:
        context["endpoint"] = {
            "id": endpoint.get("id"),
            "name": endpoint.get("name") or endpoint.get("hostname") or "Managed endpoint",
            "agent_id": endpoint.get("nexus_agent_id") or session.get("agent_device_id"),
            "elevate_state": endpoint.get("nexus_elevate_state") or "not_activated",
            "elevate_last_error": endpoint.get("nexus_elevate_last_error"),
        }

    return {"session": session, "messages": messages, "context": context}


@router.post("/sessions")
async def create_chat_session(payload: dict = Body(...), user=Depends(get_current_user)):
    await assert_client_scope(user, payload.get("client_id"), operation="live_chat.session.create")
    doc = {
        "id": str(uuid.uuid4())[:8],
        "tenant_id": user.get("tenant_id") or "nexus-local",
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
    session = await _require_active_session(session_id, user)
    content = str(payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message content is required")
    msg = {
        "id": str(uuid.uuid4())[:8],
        "session_id": session_id,
        "sender_type": "agent",
        "sender_name": user.get("name", "Agent"),
        "sender_id": user.get("id", ""),
        "content": content[:5000],
        "read": True,  # agent's own messages are "read"
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.chat_messages.insert_one(msg)
    await db.chat_sessions.update_one(
        {"id": session_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat(), "last_agent_reply_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _mirror_ticket_chat_activity(
        session,
        event_type="technician_message",
        content=content,
        actor_name=user.get("name") or "Technician",
        actor_id=user.get("id") or "",
        occurred_at=msg["sent_at"],
    )
    _typing_by_session.get(session_id, {}).pop(str(user.get("id") or ""), None)
    return {k: v for k, v in msg.items() if k != "_id"}


@router.post("/sessions/{session_id}/typing")
async def set_session_typing(session_id: str, payload: dict = Body(...), user=Depends(get_current_user)):
    """Refresh or clear the authenticated technician's composing state."""
    await _require_active_session(session_id, user)
    user_id = str(user.get("id") or "")
    participants = _typing_by_session.setdefault(session_id, {})
    if payload.get("typing"):
        participants[user_id] = {
            "user_id": user_id,
            "name": user.get("name") or "Technician",
            "role": "technician",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    else:
        participants.pop(user_id, None)
    return {"typing_users": _active_typers(session_id, user_id)}


@router.get("/sessions/{session_id}/typing")
async def get_session_typing(session_id: str, user=Depends(get_current_user)):
    await _require_session(session_id, user)
    return {"typing_users": _active_typers(session_id, str(user.get("id") or ""))}


@router.post("/sessions/{session_id}/close")
async def close_session(session_id: str, user=Depends(get_current_user)):
    session = await _require_session(session_id, user)
    if session.get("status") == "closed":
        return {"message": "Session already closed", "already_closed": True}
    now = datetime.now(timezone.utc).isoformat()
    await db.chat_sessions.update_one(
        {"id": session_id},
        {"$set": {"status": "closed", "closed_at": now,
                  "closed_by": user.get("name", ""), "updated_at": now}}
    )
    closing_note = f"Closed by {user.get('name') or 'Technician'}"
    await db.chat_messages.insert_one({
        "id": str(uuid.uuid4())[:8],
        "session_id": session_id,
        "sender_type": "system",
        "sender_name": "NexusMSP",
        "content": closing_note,
        "read": True,
        "sent_at": now,
    })
    await _mirror_ticket_chat_activity(
        session,
        event_type="closed",
        content=closing_note,
        actor_name=user.get("name") or "Technician",
        actor_id=user.get("id") or "",
        occurred_at=now,
    )
    _typing_by_session.pop(session_id, None)
    return {"message": "Session closed"}


@router.post("/sessions/{session_id}/transfer")
async def transfer_session(session_id: str, payload: dict = Body(...), user=Depends(get_current_user)):
    """Transfer an active chat session to another agent/team."""
    session = await _require_active_session(session_id, user)
    target_user_id = payload.get("agent_id")
    if not target_user_id:
        raise HTTPException(status_code=400, detail="agent_id required")
    target = await db.users.find_one(
        tenant_scoped_query(user, {"id": target_user_id, "is_active": {"$ne": False}, "archived": {"$ne": True}}),
        {"_id": 0, "id": 1, "name": 1},
    )
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
    await _mirror_ticket_chat_activity(
        session,
        event_type="transferred",
        content=f"Transferred from {user.get('name') or 'Technician'} to {target['name']}" + (f": {payload.get('note')}" if payload.get("note") else ""),
        actor_name=user.get("name") or "Technician",
        actor_id=user.get("id") or "",
        occurred_at=now,
    )
    return {"message": f"Transferred to {target['name']}", "assigned_to": target["id"], "assigned_name": target["name"]}


@router.post("/sessions/{session_id}/create-ticket")
async def create_ticket_from_chat(session_id: str, user=Depends(get_current_user)):
    session = await _require_session(session_id, user)
    if session.get("ticket_id"):
        return {"ticket_id": session["ticket_id"], "message": "Existing ticket linked to this chat", "existing": True}

    messages = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).to_list(200)
    transcript = "\n".join([f"[{m.get('sent_at', '')[:16]}] {m.get('sender_name', 'Unknown')}: {m.get('content', '')}" for m in messages])

    now = datetime.now(timezone.utc).isoformat()
    ticket = {
        "id": f"TKT-CHAT-{str(uuid.uuid4())[:6].upper()}",
        "tenant_id": user.get("tenant_id") or "nexus-local",
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
    await _mirror_ticket_chat_activity(
        {**session, "ticket_id": ticket["id"]},
        event_type="ticket_created",
        content=f"{ticket['id']} created from this live chat session.",
        actor_name=user.get("name") or "Technician",
        actor_id=user.get("id") or "",
        occurred_at=now,
    )

    return {"ticket_id": ticket["id"], "message": "Ticket created from chat"}


# ====== Canned Responses ======
async def _upgrade_legacy_remote_canned_response(user: dict) -> None:
    """Replace only Nexus's retired default; leave tenant customisations intact."""
    await db.chat_canned_responses.update_many(
        tenant_scoped_query(user, {"shortcut": "/remote", "content": LEGACY_REMOTE_CANNED_CONTENT}),
        {"$set": {"content": NEXUS_REMOTE_CANNED_CONTENT, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )


@router.get("/canned-responses")
async def list_canned_responses(user=Depends(get_current_user)):
    await _upgrade_legacy_remote_canned_response(user)
    scope = tenant_scoped_query(user)
    docs = await db.chat_canned_responses.find(scope, {"_id": 0}).sort("shortcut", 1).to_list(200)
    if not docs:
        # seed defaults
        for r in DEFAULT_CANNED_RESPONSES:
            await db.chat_canned_responses.insert_one({"id": str(uuid.uuid4())[:8], "tenant_id": user.get("tenant_id") or "nexus-local", **r, "created_at": datetime.now(timezone.utc).isoformat()})
        docs = await db.chat_canned_responses.find(scope, {"_id": 0}).sort("shortcut", 1).to_list(200)
    return docs


@router.post("/canned-responses")
async def create_canned_response(payload: dict = Body(...), user=Depends(get_current_user)):
    shortcut = str(payload.get("shortcut") or "").strip().lower()
    content = str(payload.get("content") or "").strip()
    if not shortcut.startswith("/") or len(shortcut) > 50 or not content or len(content) > 5000:
        raise HTTPException(status_code=400, detail="Provide a slash shortcut and a response up to 5,000 characters")
    if await db.chat_canned_responses.find_one(tenant_scoped_query(user, {"shortcut": shortcut}), {"_id": 1}):
        raise HTTPException(status_code=409, detail="That canned-response shortcut already exists")
    doc = {
        "id": str(uuid.uuid4())[:8],
        "tenant_id": user.get("tenant_id") or "nexus-local",
        "shortcut": shortcut,
        "title": str(payload.get("title") or "").strip()[:160],
        "content": content,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": user.get("name", ""),
    }
    await db.chat_canned_responses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.delete("/canned-responses/{cid}")
async def delete_canned_response(cid: str, user=Depends(get_current_user)):
    res = await db.chat_canned_responses.delete_one(tenant_scoped_query(user, {"id": cid}))
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


@router.get("/agents")
async def list_available_agents(user=Depends(get_current_user)):
    """List users available to receive transfers."""
    users = await db.users.find(
        tenant_scoped_query(user, {"$or": [{"role": "admin"}, {"role": "tech"}, {"is_admin": True}], "is_active": {"$ne": False}, "archived": {"$ne": True}}),
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
