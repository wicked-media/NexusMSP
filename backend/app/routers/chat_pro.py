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


# ============================================================================
# TYPING INDICATOR
# ============================================================================
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
