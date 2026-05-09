"""Chat Pro — extends existing /chat/* with: reactions, threads, edit/delete, pin, search, file uploads."""
from fastapi import APIRouter, HTTPException, Depends, Body
from datetime import datetime, timezone
import uuid, re, base64
from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================================================================
# REACTIONS
# ============================================================================
@router.post("/chat/messages/{msg_id}/reactions")
async def toggle_reaction(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {emoji: '👍'}. Toggles user reaction."""
    emoji = (payload.get("emoji") or "").strip()
    if not emoji:
        raise HTTPException(400, "emoji required")
    msg = await db.chat_messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")
    reactions = msg.get("reactions") or {}
    users = list(reactions.get(emoji) or [])
    uid = current_user.get("id")
    if uid in users:
        users.remove(uid)
    else:
        users.append(uid)
    if users:
        reactions[emoji] = users
    else:
        reactions.pop(emoji, None)
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"reactions": reactions}})
    return {"reactions": reactions}


# ============================================================================
# THREAD REPLIES
# ============================================================================
@router.post("/chat/messages/{msg_id}/reply")
async def reply_in_thread(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    parent = await db.chat_messages.find_one({"id": msg_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Parent not found")
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": parent["channel_id"],
        "thread_id": msg_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "body": body[:5000],
        "mentions": re.findall(r"@([\w._-]+)", body),
        "ts": _now(),
        "edited": False,
        "reactions": {},
    }
    await db.chat_messages.insert_one(dict(msg))
    # Increment thread reply count on parent
    await db.chat_messages.update_one(
        {"id": msg_id},
        {"$inc": {"thread_count": 1}, "$set": {"last_thread_reply_ts": msg["ts"]}}
    )
    msg.pop("_id", None)
    return msg


@router.get("/chat/messages/{msg_id}/thread")
async def get_thread(msg_id: str, current_user: dict = Depends(get_current_user)):
    parent = await db.chat_messages.find_one({"id": msg_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Not found")
    replies = await db.chat_messages.find({"thread_id": msg_id}, {"_id": 0}).sort("ts", 1).to_list(500)
    return {"parent": parent, "replies": replies}


# ============================================================================
# EDIT / DELETE
# ============================================================================
@router.put("/chat/messages/{msg_id}")
async def edit_message(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    msg = await db.chat_messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Not found")
    if msg.get("user_id") != current_user.get("id"):
        raise HTTPException(403, "Cannot edit others' messages")
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    await db.chat_messages.update_one(
        {"id": msg_id},
        {"$set": {"body": body[:5000], "edited": True, "edited_at": _now()}}
    )
    return {"ok": True}


@router.delete("/chat/messages/{msg_id}")
async def delete_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    msg = await db.chat_messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Not found")
    if msg.get("user_id") != current_user.get("id") and current_user.get("role") not in ("admin", "owner"):
        raise HTTPException(403, "Cannot delete")
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"deleted": True, "body": "[message deleted]", "deleted_at": _now()}})
    return {"ok": True}


# ============================================================================
# PIN / UNPIN
# ============================================================================
@router.post("/chat/messages/{msg_id}/pin")
async def pin_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"pinned": True, "pinned_by": current_user.get("name"), "pinned_at": _now()}})
    return {"ok": True}


@router.post("/chat/messages/{msg_id}/unpin")
async def unpin_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"pinned": False}})
    return {"ok": True}


@router.get("/chat/channels/{channel_id}/pinned")
async def list_pinned(channel_id: str, current_user: dict = Depends(get_current_user)):
    rows = await db.chat_messages.find({"channel_id": channel_id, "pinned": True}, {"_id": 0}).sort("ts", -1).to_list(50)
    return rows


# ============================================================================
# SEARCH
# ============================================================================
@router.get("/chat/search")
async def search_messages(q: str, channel_id: str = None, current_user: dict = Depends(get_current_user)):
    if not q.strip():
        return []
    query = {"body": {"$regex": re.escape(q), "$options": "i"}, "deleted": {"$ne": True}}
    if channel_id:
        query["channel_id"] = channel_id
    rows = await db.chat_messages.find(query, {"_id": 0}).sort("ts", -1).limit(100).to_list(100)
    return rows


# ============================================================================
# FILE UPLOAD (base64 → store in Mongo, returns URL)
# ============================================================================
@router.post("/chat/channels/{channel_id}/upload")
async def upload_file(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {filename, content_type, base64}. Stores file inline + posts message with link."""
    fname = (payload.get("filename") or "file").strip()
    ctype = payload.get("content_type") or "application/octet-stream"
    b64 = payload.get("base64") or ""
    try:
        size = len(base64.b64decode(b64))
    except Exception:
        raise HTTPException(400, "Invalid base64")
    if size > 10 * 1024 * 1024:
        raise HTTPException(400, "Max 10 MB")
    file_id = uuid.uuid4().hex
    await db.chat_files.insert_one({
        "id": file_id,
        "filename": fname,
        "content_type": ctype,
        "size": size,
        "data_b64": b64,
        "uploaded_by": current_user.get("id"),
        "uploaded_at": _now(),
    })
    body = f"📎 [{fname}]({fname}) · {round(size/1024)} KB"
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "body": body,
        "ts": _now(),
        "edited": False,
        "reactions": {},
        "attachment": {"file_id": file_id, "filename": fname, "content_type": ctype, "size": size, "is_image": ctype.startswith("image/")},
    }
    await db.chat_messages.insert_one(dict(msg))
    msg.pop("_id", None)
    return msg


@router.get("/chat/files/{file_id}")
async def download_file(file_id: str, current_user: dict = Depends(get_current_user)):
    f = await db.chat_files.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise HTTPException(404, "Not found")
    return f


@router.put("/chat/channels/{channel_id}/members")
async def update_members(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {member_ids: [...]} — replaces channel membership."""
    members = payload.get("member_ids") or []
    if current_user.get("id") not in members:
        members.append(current_user.get("id"))
    await db.chat_channels.update_one({"id": channel_id}, {"$set": {"member_ids": members, "updated_at": _now()}})
    return {"ok": True, "member_ids": members}


@router.delete("/chat/channels/{channel_id}")
async def delete_channel(channel_id: str, current_user: dict = Depends(get_current_user)):
    ch = await db.chat_channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404, "Not found")
    # Only created_by or admin can delete
    if ch.get("created_by") and ch.get("created_by") != current_user.get("id") and current_user.get("role") not in ("admin", "owner"):
        raise HTTPException(403, "Cannot delete this channel")
    await db.chat_channels.delete_one({"id": channel_id})
    await db.chat_messages.delete_many({"channel_id": channel_id})
    return {"ok": True}


@router.post("/chat/group-dm")
async def create_group_dm(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {member_ids: [...], name?}. Creates a private group chat with multiple members."""
    members = payload.get("member_ids") or []
    if current_user.get("id") not in members:
        members.append(current_user.get("id"))
    if len(members) < 2:
        raise HTTPException(400, "Need at least 2 members for a group chat")
    # Build deterministic ID from sorted members so same group resolves to same channel
    sig = "-".join(sorted(members))
    existing = await db.chat_channels.find_one({"group_signature": sig}, {"_id": 0})
    if existing:
        return existing
    name = (payload.get("name") or "").strip()
    if not name:
        # Build name from member names
        users = await db.users.find({"id": {"$in": members}}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
        names = [u["name"].split()[0] for u in users if u.get("id") != current_user.get("id")]
        name = ", ".join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else "")
    doc = {
        "id": uuid.uuid4().hex,
        "name": name,
        "kind": "group_dm",
        "is_private": True,
        "is_dm": True,
        "is_group_dm": True,
        "member_ids": members,
        "group_signature": sig,
        "created_by": current_user.get("id"),
        "created_at": _now(),
    }
    await db.chat_channels.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/chat/channels-preview")
async def channels_preview(current_user: dict = Depends(get_current_user)):
    """Returns channels with last-message preview + unread count for sidebar rich rendering."""
    uid = current_user.get("id")
    channels = await db.chat_channels.find(
        {"$or": [{"kind": "team", "member_ids": {"$size": 0}}, {"member_ids": uid}]},
        {"_id": 0}
    ).sort("updated_at", -1).to_list(200)
    results = []
    for ch in channels:
        last_msg = await db.chat_messages.find_one(
            {"channel_id": ch["id"], "thread_id": {"$exists": False}, "deleted": {"$ne": True}},
            {"_id": 0}, sort=[("ts", -1)]
        )
        read_state = await db.chat_read_state.find_one({"user_id": uid, "channel_id": ch["id"]}, {"_id": 0})
        last_read_ts = (read_state or {}).get("last_read_ts") or "1970-01-01T00:00:00+00:00"
        unread = await db.chat_messages.count_documents({
            "channel_id": ch["id"],
            "thread_id": {"$exists": False},
            "ts": {"$gt": last_read_ts},
            "user_id": {"$ne": uid},
            "deleted": {"$ne": True},
        })
        results.append({
            **ch,
            "last_message": {
                "body": (last_msg.get("body") or "")[:120] if last_msg else "",
                "user_name": last_msg.get("user_name") if last_msg else "",
                "ts": last_msg.get("ts") if last_msg else None,
            } if last_msg else None,
            "unread_count": unread,
        })
    return results


# ============================================================================
# TICKET ↔ CHAT BIDIRECTIONAL LINKING
# ============================================================================
@router.get("/chat/ticket-card/{ticket_number}")
async def ticket_card(ticket_number: str, current_user: dict = Depends(get_current_user)):
    """Lightweight ticket info for inline embeds in chat (mentions like /ticket T-XXX)."""
    t = await db.tickets.find_one({"$or": [{"ticket_number": ticket_number}, {"id": ticket_number}]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    return {
        "id": t.get("id"),
        "ticket_number": t.get("ticket_number"),
        "title": t.get("title"),
        "status": t.get("status"),
        "priority": t.get("priority"),
        "client_name": t.get("client_name"),
        "assigned_to_name": t.get("assigned_to_name"),
        "service_name": t.get("service_name"),
        "created_at": t.get("created_at"),
    }


@router.post("/chat/discuss-ticket/{ticket_number}")
async def discuss_ticket(ticket_number: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Post a 'Discuss this ticket' message into a channel. Body: {channel_id?}.
    If no channel given, posts to #ops or first public channel. Returns the message."""
    t = await db.tickets.find_one({"$or": [{"ticket_number": ticket_number}, {"id": ticket_number}]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    channel_id = payload.get("channel_id")
    if not channel_id:
        ch = await db.chat_channels.find_one({"$or": [{"name": "ops"}, {"name": "general"}], "is_private": {"$ne": True}}, {"_id": 0})
        if not ch:
            ch = await db.chat_channels.find_one({"is_private": {"$ne": True}, "is_dm": {"$ne": True}}, {"_id": 0})
        if not ch:
            raise HTTPException(400, "No public channel available — create one first")
        channel_id = ch["id"]
    body = f"💬 Let's discuss /ticket {t.get('ticket_number')} — *{t.get('title')}* ({t.get('priority')}, {t.get('client_name')})"
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "body": body,
        "ts": _now(),
        "edited": False,
        "reactions": {},
        "ticket_refs": [t.get("ticket_number")],
    }
    await db.chat_messages.insert_one(dict(msg))
    msg.pop("_id", None)
    return {"channel_id": channel_id, "message_id": msg["id"], "message": msg}

@router.post("/chat/channels/{channel_id}/typing")
async def typing(channel_id: str, current_user: dict = Depends(get_current_user)):
    await db.chat_typing.update_one(
        {"channel_id": channel_id, "user_id": current_user.get("id")},
        {"$set": {"channel_id": channel_id, "user_id": current_user.get("id"), "user_name": current_user.get("name"), "ts": _now()}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/chat/channels/{channel_id}/typing")
async def get_typing(channel_id: str, current_user: dict = Depends(get_current_user)):
    cutoff = (datetime.now(timezone.utc).timestamp() - 5)  # within last 5 seconds
    rows = await db.chat_typing.find({"channel_id": channel_id}, {"_id": 0}).to_list(50)
    active = []
    for r in rows:
        if r.get("user_id") == current_user.get("id"):
            continue
        try:
            t = datetime.fromisoformat(r["ts"]).timestamp()
            if t >= cutoff:
                active.append({"user_id": r["user_id"], "user_name": r["user_name"]})
        except Exception:
            pass
    return active
