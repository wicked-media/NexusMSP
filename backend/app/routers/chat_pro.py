"""Chat Pro — extends existing /chat/* with: reactions, threads, edit/delete, pin, search, file uploads."""
from fastapi import APIRouter, HTTPException, Depends, Body
from fastapi.responses import Response
from datetime import datetime, timezone
import asyncio, uuid, re, base64
from pathlib import Path
from urllib.parse import quote
from app.database import db
from app.auth import get_current_user
from app.services.chat_access import (
    channel_visibility_query,
    enrich_channels,
    ensure_default_channels,
    is_chat_admin,
    require_channel_access,
    require_message_access,
)
from app.services.avatar_enrichment import attach_user_avatars

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
    if not emoji or len(emoji) > 16 or "." in emoji or "$" in emoji:
        raise HTTPException(400, "emoji required")
    msg, _ = await require_message_access(msg_id, current_user)
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
    parent, _ = await require_message_access(msg_id, current_user)
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": parent["channel_id"],
        "thread_id": msg_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "avatar_url": current_user.get("avatar"),
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
    await db.chat_channels.update_one(
        {"id": parent["channel_id"]},
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    # A thread is deliberately excluded from the channel's unread counter to
    # keep the conversation list quiet.  Alert the original poster directly
    # instead, so a follow-up cannot be lost in a high-volume channel.
    parent_user_id = parent.get("user_id")
    if parent_user_id and parent_user_id != current_user.get("id"):
        await db.notifications.insert_one({
            "id": uuid.uuid4().hex,
            "user_id": parent_user_id,
            "type": "thread_reply",
            "title": f"💬 {current_user.get('name')} replied in your thread",
            "message": body[:200],
            "ref_type": "chat_channel",
            "ref_id": parent["channel_id"],
            "thread_id": msg_id,
            "read": False,
            "created_at": _now(),
        })
    msg.pop("_id", None)
    return msg


@router.get("/chat/messages/{msg_id}/thread")
async def get_thread(msg_id: str, current_user: dict = Depends(get_current_user)):
    parent, _ = await require_message_access(msg_id, current_user)
    replies = await db.chat_messages.find({"thread_id": msg_id}, {"_id": 0}).sort("ts", 1).to_list(500)
    return {"parent": (await attach_user_avatars([parent]))[0], "replies": await attach_user_avatars(replies)}


# ============================================================================
# EDIT / DELETE
# ============================================================================
@router.put("/chat/messages/{msg_id}")
async def edit_message(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    msg, _ = await require_message_access(msg_id, current_user)
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
    msg, _ = await require_message_access(msg_id, current_user)
    if msg.get("user_id") != current_user.get("id") and not is_chat_admin(current_user):
        raise HTTPException(403, "Cannot delete")
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"deleted": True, "body": "[message deleted]", "deleted_at": _now()}})
    return {"ok": True}


# ============================================================================
# PIN / UNPIN
# ============================================================================
@router.post("/chat/messages/{msg_id}/pin")
async def pin_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    await require_message_access(msg_id, current_user)
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"pinned": True, "pinned_by": current_user.get("name"), "pinned_at": _now()}})
    return {"ok": True}


@router.post("/chat/messages/{msg_id}/unpin")
async def unpin_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    await require_message_access(msg_id, current_user)
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"pinned": False}})
    return {"ok": True}


@router.get("/chat/channels/{channel_id}/pinned")
async def list_pinned(channel_id: str, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    rows = await db.chat_messages.find({"channel_id": channel_id, "pinned": True}, {"_id": 0}).sort("ts", -1).to_list(50)
    return await attach_user_avatars(rows)


@router.get("/chat/channels/{channel_id}/files")
async def list_channel_files(channel_id: str, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    rows = await db.chat_messages.find(
        {
            "channel_id": channel_id,
            "attachment.file_id": {"$exists": True},
            "deleted": {"$ne": True},
        },
        {"_id": 0},
    ).sort("ts", -1).limit(100).to_list(100)
    return await attach_user_avatars(rows)


# ============================================================================
# SEARCH
# ============================================================================
@router.get("/chat/search")
async def search_messages(q: str, channel_id: str = None, current_user: dict = Depends(get_current_user)):
    term = q.strip()
    if not term:
        return []
    if len(term) > 100:
        raise HTTPException(400, "Search is limited to 100 characters")

    await ensure_default_channels()

    visible_channels: list[dict]
    if channel_id:
        visible_channels = [await require_channel_access(channel_id, current_user)]
    else:
        visible_channels = await db.chat_channels.find(
            channel_visibility_query(current_user),
            {"_id": 0},
        ).to_list(200)
    visible_channels = await enrich_channels(visible_channels, current_user)
    channel_map = {channel["id"]: channel for channel in visible_channels}
    query = {
        "channel_id": {"$in": list(channel_map)},
        "body": {"$regex": re.escape(term), "$options": "i"},
        "deleted": {"$ne": True},
    }
    rows = await db.chat_messages.find(query, {"_id": 0}).sort("ts", -1).limit(100).to_list(100)
    for row in rows:
        channel = channel_map.get(row.get("channel_id")) or {}
        row["channel_name"] = channel.get("display_name") or channel.get("name")
        row["channel_kind"] = channel.get("kind")
    return await attach_user_avatars(rows)


# ============================================================================
# FILE UPLOAD (base64 → store in Mongo, returns URL)
# ============================================================================
@router.post("/chat/channels/{channel_id}/upload")
async def upload_file(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {filename, content_type, base64}. Stores file inline + posts message with link."""
    await require_channel_access(channel_id, current_user)
    fname = Path((payload.get("filename") or "file").strip()).name[:200]
    ctype = payload.get("content_type") or "application/octet-stream"
    b64 = payload.get("base64") or ""
    try:
        decoded = base64.b64decode(b64, validate=True)
        size = len(decoded)
    except Exception:
        raise HTTPException(400, "Invalid base64")
    if size == 0:
        raise HTTPException(400, "File is empty")
    if size > 10 * 1024 * 1024:
        raise HTTPException(400, "Max 10 MB")
    file_id = uuid.uuid4().hex
    await db.chat_files.insert_one({
        "id": file_id,
        "filename": fname,
        "content_type": ctype,
        "size": size,
        "data_b64": b64,
        "channel_id": channel_id,
        "uploaded_by": current_user.get("id"),
        "uploaded_at": _now(),
    })
    body = f"📎 [{fname}]({fname}) · {round(size/1024)} KB"
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "avatar_url": current_user.get("avatar"),
        "body": body,
        "ts": _now(),
        "edited": False,
        "reactions": {},
        "attachment": {"file_id": file_id, "filename": fname, "content_type": ctype, "size": size, "is_image": ctype.startswith("image/")},
    }
    await db.chat_messages.insert_one(dict(msg))
    await db.chat_channels.update_one(
        {"id": channel_id},
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    msg.pop("_id", None)
    return msg


@router.get("/chat/files/{file_id}")
async def download_file(file_id: str, current_user: dict = Depends(get_current_user)):
    f = await db.chat_files.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise HTTPException(404, "Not found")
    channel_id = f.get("channel_id")
    if not channel_id:
        legacy_message = await db.chat_messages.find_one({"attachment.file_id": file_id}, {"_id": 0, "channel_id": 1})
        channel_id = (legacy_message or {}).get("channel_id")
        if not channel_id:
            raise HTTPException(403, "Attachment is missing channel access metadata")
        await db.chat_files.update_one({"id": file_id}, {"$set": {"channel_id": channel_id}})
    await require_channel_access(channel_id, current_user)
    try:
        content = base64.b64decode(f.get("data_b64") or "", validate=True)
    except Exception as exc:
        raise HTTPException(500, "Stored attachment is invalid") from exc
    filename = quote(f.get("filename") or "attachment")
    safe_types = {"image/png", "image/jpeg", "image/gif", "application/pdf", "text/plain"}
    media_type = f.get("content_type") if f.get("content_type") in safe_types else "application/octet-stream"
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.put("/chat/channels/{channel_id}/members")
async def update_members(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {member_ids: [...]} — replaces channel membership."""
    channel = await require_channel_access(channel_id, current_user)
    if channel.get("kind") in {"dm", "group_dm"}:
        raise HTTPException(400, "Direct-chat membership cannot be changed here")
    if not (is_chat_admin(current_user) or channel.get("created_by") == current_user.get("id")):
        raise HTTPException(403, "Only the channel owner can manage members")
    if channel.get("is_private") is not True:
        raise HTTPException(400, "Public channels include all active staff")
    requested = payload.get("member_ids") or []
    if not isinstance(requested, list) or len(requested) > 100:
        raise HTTPException(400, "member_ids must contain at most 100 users")
    members = list(dict.fromkeys(str(member) for member in requested if member))
    if current_user.get("id") not in members:
        members.append(current_user.get("id"))
    await db.chat_channels.update_one({"id": channel_id}, {"$set": {"member_ids": members, "updated_at": _now()}})
    return {"ok": True, "member_ids": members}


@router.delete("/chat/channels/{channel_id}")
async def delete_channel(channel_id: str, current_user: dict = Depends(get_current_user)):
    ch = await require_channel_access(channel_id, current_user)
    is_legacy_default = (ch.get("kind") or "team") == "team" and ch.get("name") in {"general", "random"}
    if ch.get("created_by") == "system" or is_legacy_default:
        raise HTTPException(403, "Default channels cannot be deleted")
    # Only created_by or admin can delete
    if ch.get("created_by") != current_user.get("id") and not is_chat_admin(current_user):
        raise HTTPException(403, "Cannot delete this channel")
    await db.chat_channels.delete_one({"id": channel_id})
    await db.chat_messages.delete_many({"channel_id": channel_id})
    return {"ok": True}


@router.post("/chat/group-dm")
async def create_group_dm(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {member_ids: [...], name?}. Creates a private group chat with multiple members."""
    requested = payload.get("member_ids") or []
    if not isinstance(requested, list) or len(requested) > 49:
        raise HTTPException(400, "Choose between 2 and 49 teammates")
    members = list(dict.fromkeys(str(member) for member in requested if member))
    if current_user.get("id") not in members:
        members.append(current_user.get("id"))
    if len(members) < 2:
        raise HTTPException(400, "Need at least 2 members for a group chat")
    valid_members = await db.users.count_documents({
        "id": {"$in": members},
        "is_active": {"$ne": False},
    })
    if valid_members != len(members):
        raise HTTPException(400, "One or more selected teammates are unavailable")
    # Build deterministic ID from sorted members so same group resolves to same channel
    sig = "-".join(sorted(members))
    existing = await db.chat_channels.find_one({"group_signature": sig}, {"_id": 0})
    if existing:
        return (await enrich_channels([existing], current_user))[0]
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
        "updated_at": _now(),
    }
    await db.chat_channels.insert_one(dict(doc))
    doc.pop("_id", None)
    return (await enrich_channels([doc], current_user))[0]


@router.get("/chat/channels-preview")
async def channels_preview(current_user: dict = Depends(get_current_user)):
    """Returns channels with last-message preview + unread count for sidebar rich rendering."""
    uid = current_user.get("id")
    await ensure_default_channels()
    channels = await db.chat_channels.find(
        channel_visibility_query(current_user),
        {"_id": 0}
    ).sort("updated_at", -1).to_list(200)
    channels = await enrich_channels(channels, current_user)
    channel_ids = [channel["id"] for channel in channels]
    if not channel_ids:
        return []

    read_rows = await db.chat_read_state.find(
        {"user_id": uid, "channel_id": {"$in": channel_ids}},
        {"_id": 0, "channel_id": 1, "last_read_at": 1},
    ).to_list(200)
    read_by_channel = {row["channel_id"]: row.get("last_read_at") for row in read_rows}

    last_by_channel: dict[str, dict] = {}
    pipeline = [
        {"$match": {
            "channel_id": {"$in": channel_ids},
            "thread_id": {"$exists": False},
            "deleted": {"$ne": True},
        }},
        {"$sort": {"ts": -1}},
        {"$group": {"_id": "$channel_id", "message": {"$first": "$$ROOT"}}},
    ]
    async for row in db.chat_messages.aggregate(pipeline):
        last_by_channel[row["_id"]] = row["message"]

    async def _unread_count(channel_id: str) -> int:
        last_read_at = read_by_channel.get(channel_id) or "1970-01-01T00:00:00+00:00"
        return await db.chat_messages.count_documents({
            "channel_id": channel_id,
            "thread_id": {"$exists": False},
            "ts": {"$gt": last_read_at},
            "user_id": {"$ne": uid},
            "deleted": {"$ne": True},
        })

    unread_counts = await asyncio.gather(*[_unread_count(channel_id) for channel_id in channel_ids])
    results = []
    for ch, unread in zip(channels, unread_counts):
        last_msg = last_by_channel.get(ch["id"])
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


@router.get("/chat/invoice-card/{invoice_number}")
async def invoice_card(invoice_number: str, current_user: dict = Depends(get_current_user)):
    """Safe, lightweight invoice context for /invoice references in team chat."""
    invoice = await db.invoices.find_one(
        {"$or": [{"invoice_number": invoice_number}, {"id": invoice_number}]}, {"_id": 0}
    )
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    total = float(invoice.get("total", 0) or 0)
    paid = float(invoice.get("amount_paid", 0) or 0)
    return {
        "id": invoice.get("id"),
        "invoice_number": invoice.get("invoice_number") or invoice.get("id"),
        "client_name": invoice.get("client_name"),
        "payment_status": invoice.get("payment_status") or "unpaid",
        "total": total,
        "amount_due": max(0, round(total - paid, 2)),
        "due_date": invoice.get("due_date"),
    }


@router.get("/chat/po-card/{po_number}")
async def po_card(po_number: str, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"$or": [{"po_number": po_number}, {"id": po_number}]}, {"_id": 0})
    if not po:
        raise HTTPException(404, "Purchase order not found")
    return {"id": po.get("id"), "po_number": po.get("po_number") or po.get("id"), "vendor": po.get("vendor"), "status": po.get("status") or "draft", "total": float(po.get("total", 0) or 0), "expected_delivery": po.get("expected_delivery")}


@router.get("/chat/reference-search")
async def reference_search(kind: str, q: str = "", current_user: dict = Depends(get_current_user)):
    """Small, scoped picker used while composing /ticket and /invoice references."""
    kind = kind.lower().strip()
    needle = q.strip()
    if kind not in {"ticket", "invoice", "po"}:
        raise HTTPException(400, "kind must be ticket, invoice, or po")
    if kind == "ticket":
        query = {"$or": [
            {"ticket_number": {"$regex": needle, "$options": "i"}},
            {"title": {"$regex": needle, "$options": "i"}},
            {"client_name": {"$regex": needle, "$options": "i"}},
        ]} if needle else {}
        rows = await db.tickets.find(query, {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "status": 1}).sort("updated_at", -1).to_list(8)
        return [{"id": row.get("id"), "reference": row.get("ticket_number") or row.get("id"), "title": row.get("title") or "Untitled ticket", "subtitle": f"{row.get('client_name') or 'No client'} · {row.get('status') or 'open'}"} for row in rows]
    if kind == "po":
        query = {"$or": [{"po_number": {"$regex": needle, "$options": "i"}}, {"vendor": {"$regex": needle, "$options": "i"}}]} if needle else {}
        rows = await db.purchase_orders.find(query, {"_id": 0, "id": 1, "po_number": 1, "vendor": 1, "status": 1, "total": 1}).sort("created_at", -1).to_list(8)
        return [{"id": row.get("id"), "reference": row.get("po_number") or row.get("id"), "title": row.get("vendor") or "Purchase order", "subtitle": f"{row.get('status') or 'draft'} · ${float(row.get('total', 0) or 0):.2f}"} for row in rows]
    query = {"$or": [
        {"invoice_number": {"$regex": needle, "$options": "i"}},
        {"client_name": {"$regex": needle, "$options": "i"}},
    ]} if needle else {}
    rows = await db.invoices.find(query, {"_id": 0, "id": 1, "invoice_number": 1, "client_name": 1, "payment_status": 1, "total": 1}).sort("created_at", -1).to_list(8)
    return [{"id": row.get("id"), "reference": row.get("invoice_number") or row.get("id"), "title": row.get("client_name") or "Invoice", "subtitle": f"{row.get('payment_status') or 'unpaid'} · ${float(row.get('total', 0) or 0):.2f}"} for row in rows]


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
    await require_channel_access(channel_id, current_user)
    body = f"💬 Let's discuss /ticket {t.get('ticket_number')} — *{t.get('title')}* ({t.get('priority')}, {t.get('client_name')})"
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "avatar_url": current_user.get("avatar"),
        "body": body,
        "ts": _now(),
        "edited": False,
        "reactions": {},
        "ticket_refs": [t.get("ticket_number")],
    }
    await db.chat_messages.insert_one(dict(msg))
    await db.chat_channels.update_one(
        {"id": channel_id},
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    msg.pop("_id", None)
    return {"channel_id": channel_id, "message_id": msg["id"], "message": msg}

@router.post("/chat/channels/{channel_id}/typing")
async def typing(channel_id: str, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    await db.chat_typing.update_one(
        {"channel_id": channel_id, "user_id": current_user.get("id")},
        {"$set": {"channel_id": channel_id, "user_id": current_user.get("id"), "user_name": current_user.get("name"), "avatar_url": current_user.get("avatar"), "ts": _now()}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/chat/channels/{channel_id}/typing")
async def get_typing(channel_id: str, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    cutoff = (datetime.now(timezone.utc).timestamp() - 5)  # within last 5 seconds
    rows = await db.chat_typing.find({"channel_id": channel_id}, {"_id": 0}).to_list(50)
    active = []
    for r in rows:
        if r.get("user_id") == current_user.get("id"):
            continue
        try:
            t = datetime.fromisoformat(r["ts"]).timestamp()
            if t >= cutoff:
                active.append({"user_id": r["user_id"], "user_name": r["user_name"], "avatar_url": r.get("avatar_url")})
        except Exception:
            pass
    return active
