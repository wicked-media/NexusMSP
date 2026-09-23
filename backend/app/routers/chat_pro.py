"""Chat Pro — extends existing /chat/* with: reactions, threads, edit/delete, pin, search, file uploads."""
from fastapi import APIRouter, HTTPException, Depends, Body
from fastapi.responses import Response
from datetime import datetime, timezone
import asyncio, uuid, re, base64, os
from pathlib import Path
from urllib.parse import quote
from urllib.parse import urlparse
import httpx
from app.database import db
from app.auth import get_current_user
from app.services.chat_access import (
    channel_visibility_query,
    enrich_channels,
    ensure_default_channels,
    is_chat_admin,
    live_update_recipients,
    require_channel_access,
    require_message_access,
)
from app.services.chat_live import publish_channel_update
from app.services.scope_permissions import assert_client_scope, platform_tenant_id, scoped_query, tenant_scoped_query
from app.services.avatar_enrichment import attach_user_avatars

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def record_channel_event(channel: dict, actor: dict, event_type: str, details: dict | None = None) -> None:
    """Append non-content channel governance evidence without changing chat truth."""
    await db.chat_channel_events.insert_one({
        "id": uuid.uuid4().hex,
        "tenant_id": str(actor.get("tenant_id") or "nexus-local"),
        "channel_id": channel["id"],
        "event_type": event_type,
        "actor_id": actor.get("id"),
        "actor_name": actor.get("name") or "Nexus operator",
        "details": details or {},
        "created_at": _now(),
    })


def _tenor_asset_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname == "media.tenor.com"


@router.get("/chat/gifs")
async def search_tenor_gifs(q: str = "", current_user: dict = Depends(get_current_user)):
    """Return a safe, minimal Tenor result set without exposing the API key."""
    api_key = os.environ.get("TENOR_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "GIF search is not configured. Add TENOR_API_KEY to enable it.")
    query = q.strip()
    if len(query) > 100:
        raise HTTPException(400, "GIF search is limited to 100 characters")
    endpoint = "https://tenor.googleapis.com/v2/search" if query else "https://tenor.googleapis.com/v2/featured"
    params = {"key": api_key, "client_key": os.environ.get("NEXUS_TENOR_CLIENT_KEY", "nexus_msp"), "limit": 24, "media_filter": "tinygif,gif"}
    if query:
        params["q"] = query
    try:
        async with httpx.AsyncClient(timeout=7.0, follow_redirects=False) as client:
            response = await client.get(endpoint, params=params)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(502, "GIF search is temporarily unavailable") from exc
    results = []
    for row in response.json().get("results") or []:
        formats = row.get("media_formats") or {}
        preview = (formats.get("tinygif") or {}).get("url")
        original = (formats.get("gif") or {}).get("url")
        if not (_tenor_asset_url(str(preview or "")) and _tenor_asset_url(str(original or ""))):
            continue
        results.append({"id": str(row.get("id") or ""), "title": str(row.get("content_description") or "GIF")[:160], "preview_url": preview, "url": original})
    return {"provider": "tenor", "results": results}


@router.post("/chat/channels/{channel_id}/gifs")
async def share_tenor_gif(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    channel = await require_channel_access(channel_id, current_user)
    gif_id = str(payload.get("id") or "")
    preview_url, url = str(payload.get("preview_url") or ""), str(payload.get("url") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", gif_id) or not (_tenor_asset_url(preview_url) and _tenor_asset_url(url)):
        raise HTTPException(400, "Invalid GIF asset")
    msg = {"id": uuid.uuid4().hex, "tenant_id": platform_tenant_id(current_user), "channel_id": channel_id, "user_id": current_user.get("id"), "user_name": current_user.get("name"), "avatar_url": current_user.get("avatar"), "body": "", "ts": _now(), "edited": False, "reactions": {}, "attachment": {"provider": "tenor", "provider_id": gif_id, "filename": str(payload.get("title") or "GIF")[:160], "is_image": True, "is_external": True, "preview_url": preview_url, "url": url}}
    await db.chat_messages.insert_one(dict(msg))
    await db.chat_channels.update_one(tenant_scoped_query(current_user, {"id": channel_id}), {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}})
    publish_channel_update(channel_id, "gif.shared", live_update_recipients(channel))
    return msg


# ============================================================================
# REACTIONS
# ============================================================================
@router.post("/chat/messages/{msg_id}/reactions")
async def toggle_reaction(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Body: {emoji: '👍'}. Toggles user reaction."""
    emoji = (payload.get("emoji") or "").strip()
    if not emoji or len(emoji) > 16 or "." in emoji or "$" in emoji:
        raise HTTPException(400, "emoji required")
    msg, channel = await require_message_access(msg_id, current_user)
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
    await db.chat_messages.update_one(tenant_scoped_query(current_user, {"id": msg_id}), {"$set": {"reactions": reactions}})
    publish_channel_update(channel["id"], "message.reaction", live_update_recipients(channel))
    return {"reactions": reactions}


# ============================================================================
# THREAD REPLIES
# ============================================================================
@router.post("/chat/messages/{msg_id}/reply")
async def reply_in_thread(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    parent, channel = await require_message_access(msg_id, current_user)
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    msg = {
        "id": uuid.uuid4().hex,
        "tenant_id": platform_tenant_id(current_user),
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
        tenant_scoped_query(current_user, {"id": msg_id}),
        {"$inc": {"thread_count": 1}, "$set": {"last_thread_reply_ts": msg["ts"]}}
    )
    await db.chat_channels.update_one(
        tenant_scoped_query(current_user, {"id": parent["channel_id"]}),
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    publish_channel_update(channel["id"], "thread.reply", live_update_recipients(channel))
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
    replies = await db.chat_messages.find(tenant_scoped_query(current_user, {"thread_id": msg_id}), {"_id": 0}).sort("ts", 1).to_list(500)
    return {"parent": (await attach_user_avatars([parent]))[0], "replies": await attach_user_avatars(replies)}


# ============================================================================
# EDIT / DELETE
# ============================================================================
@router.put("/chat/messages/{msg_id}")
async def edit_message(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    msg, channel = await require_message_access(msg_id, current_user)
    if msg.get("user_id") != current_user.get("id"):
        raise HTTPException(403, "Cannot edit others' messages")
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    await db.chat_messages.update_one(
        tenant_scoped_query(current_user, {"id": msg_id}),
        {"$set": {"body": body[:5000], "edited": True, "edited_at": _now()}}
    )
    publish_channel_update(channel["id"], "message.edited", live_update_recipients(channel))
    return {"ok": True}


@router.delete("/chat/messages/{msg_id}")
async def delete_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    msg, channel = await require_message_access(msg_id, current_user)
    if msg.get("user_id") != current_user.get("id") and not is_chat_admin(current_user):
        raise HTTPException(403, "Cannot delete")
    await db.chat_messages.update_one(tenant_scoped_query(current_user, {"id": msg_id}), {"$set": {"deleted": True, "body": "[message deleted]", "deleted_at": _now()}})
    publish_channel_update(channel["id"], "message.deleted", live_update_recipients(channel))
    return {"ok": True}


# ============================================================================
# PIN / UNPIN
# ============================================================================
@router.post("/chat/messages/{msg_id}/pin")
async def pin_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    _, channel = await require_message_access(msg_id, current_user)
    await db.chat_messages.update_one(tenant_scoped_query(current_user, {"id": msg_id}), {"$set": {"pinned": True, "pinned_by": current_user.get("name"), "pinned_at": _now()}})
    publish_channel_update(channel["id"], "message.pinned", live_update_recipients(channel))
    return {"ok": True}


@router.post("/chat/messages/{msg_id}/unpin")
async def unpin_message(msg_id: str, current_user: dict = Depends(get_current_user)):
    _, channel = await require_message_access(msg_id, current_user)
    await db.chat_messages.update_one(tenant_scoped_query(current_user, {"id": msg_id}), {"$set": {"pinned": False}})
    publish_channel_update(channel["id"], "message.unpinned", live_update_recipients(channel))
    return {"ok": True}


@router.get("/chat/channels/{channel_id}/pinned")
async def list_pinned(channel_id: str, current_user: dict = Depends(get_current_user)):
    channel = await require_channel_access(channel_id, current_user)
    rows = await db.chat_messages.find(tenant_scoped_query(current_user, {"channel_id": channel_id, "pinned": True}), {"_id": 0}).sort("ts", -1).to_list(50)
    return await attach_user_avatars(rows)


@router.get("/chat/channels/{channel_id}/files")
async def list_channel_files(channel_id: str, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    rows = await db.chat_messages.find(
        tenant_scoped_query(current_user, {
            "channel_id": channel_id,
            "attachment.file_id": {"$exists": True},
            "deleted": {"$ne": True},
        }),
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

    await ensure_default_channels(current_user)

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
    query = tenant_scoped_query(current_user, {
        "channel_id": {"$in": list(channel_map)},
        "body": {"$regex": re.escape(term), "$options": "i"},
        "deleted": {"$ne": True},
    })
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
        "tenant_id": platform_tenant_id(current_user),
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
        "tenant_id": platform_tenant_id(current_user),
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
        tenant_scoped_query(current_user, {"id": channel_id}),
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    publish_channel_update(channel_id, "attachment.created", live_update_recipients(channel))
    msg.pop("_id", None)
    return msg


@router.get("/chat/files/{file_id}")
async def download_file(file_id: str, current_user: dict = Depends(get_current_user)):
    f = await db.chat_files.find_one(tenant_scoped_query(current_user, {"id": file_id}), {"_id": 0})
    if not f:
        raise HTTPException(404, "Not found")
    channel_id = f.get("channel_id")
    if not channel_id:
        legacy_message = await db.chat_messages.find_one(tenant_scoped_query(current_user, {"attachment.file_id": file_id}), {"_id": 0, "channel_id": 1})
        channel_id = (legacy_message or {}).get("channel_id")
        if not channel_id:
            raise HTTPException(403, "Attachment is missing channel access metadata")
        await db.chat_files.update_one(tenant_scoped_query(current_user, {"id": file_id}), {"$set": {"channel_id": channel_id}})
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
        raise HTTPException(403, "Only the channel owner or an admin can manage members")
    if channel.get("is_private") is not True:
        raise HTTPException(400, "Public channels include all active staff")
    requested = payload.get("member_ids") or []
    if not isinstance(requested, list) or len(requested) > 100:
        raise HTTPException(400, "member_ids must contain at most 100 users")
    members = list(dict.fromkeys(str(member) for member in requested if member))
    if current_user.get("id") not in members:
        members.append(current_user.get("id"))
    active_members = await db.users.count_documents({"id": {"$in": members}, "is_active": {"$ne": False}})
    if active_members != len(members):
        raise HTTPException(400, "One or more selected technicians are unavailable")
    await db.chat_channels.update_one({"id": channel_id}, {"$set": {"member_ids": members, "updated_at": _now()}})
    await record_channel_event(channel, current_user, "members.updated", {"member_count": len(members)})
    publish_channel_update(channel_id, "channel.members.updated", members)
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
    await db.chat_channels.update_one(
        tenant_scoped_query(current_user, {"id": channel_id}),
        {"$set": {"deleted": True, "deleted_at": _now(), "deleted_by": current_user.get("id")}},
    )
    await record_channel_event(ch, current_user, "channel.archived")
    # Keep posts and attachments intact for authorised audit/recovery; the
    # channel disappears from every normal visibility query immediately.
    return {"ok": True, "archived": True}


@router.get("/chat/channels/archived")
async def list_archived_channels(current_user: dict = Depends(get_current_user)):
    """Show recoverable team-channel archives to their owner or a chat admin."""
    query = {"deleted": True, "kind": "team"}
    if not is_chat_admin(current_user):
        query["created_by"] = current_user.get("id")
    rows = await db.chat_channels.find(query, {"_id": 0}).sort("deleted_at", -1).to_list(100)
    return await enrich_channels(rows, current_user)


@router.post("/chat/channels/{channel_id}/restore")
async def restore_channel(channel_id: str, current_user: dict = Depends(get_current_user)):
    channel = await db.chat_channels.find_one({"id": channel_id, "deleted": True}, {"_id": 0})
    if not channel or channel.get("kind") != "team":
        raise HTTPException(404, "Archived channel not found")
    if not (is_chat_admin(current_user) or channel.get("created_by") == current_user.get("id")):
        raise HTTPException(403, "Only the channel owner or an admin can restore this channel")
    now = _now()
    await db.chat_channels.update_one({"id": channel_id}, {"$set": {"deleted": False, "restored_at": now, "restored_by": current_user.get("id"), "updated_at": now}})
    await record_channel_event(channel, current_user, "channel.restored")
    restored = {**channel, "deleted": False, "updated_at": now}
    publish_channel_update(channel_id, "channel.restored", live_update_recipients(restored))
    return restored


@router.post("/chat/channels/{channel_id}/ownership")
async def transfer_channel_ownership(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    channel = await require_channel_access(channel_id, current_user)
    if channel.get("kind") != "team":
        raise HTTPException(400, "Only team channels have transferable ownership")
    if not (is_chat_admin(current_user) or channel.get("created_by") == current_user.get("id")):
        raise HTTPException(403, "Only the channel owner or an admin can transfer ownership")
    if channel.get("created_by") == "system":
        raise HTTPException(400, "Default channel ownership cannot be transferred")
    owner_id = str(payload.get("owner_id") or "").strip()
    owner = await db.users.find_one({"id": owner_id, "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1})
    if not owner:
        raise HTTPException(400, "Choose an active technician")
    now = _now()
    await db.chat_channels.update_one({"id": channel_id}, {"$set": {"created_by": owner_id, "owner_name": owner.get("name"), "updated_at": now}})
    updated = {**channel, "created_by": owner_id, "owner_name": owner.get("name"), "updated_at": now}
    await record_channel_event(channel, current_user, "ownership.transferred", {"new_owner_id": owner_id, "new_owner_name": owner.get("name")})
    publish_channel_update(channel_id, "channel.ownership.updated", live_update_recipients(updated))
    return updated


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
    existing = await db.chat_channels.find_one(tenant_scoped_query(current_user, {"group_signature": sig}), {"_id": 0})
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
        "tenant_id": platform_tenant_id(current_user),
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
    await ensure_default_channels(current_user)
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
    preference_rows = await db.chat_user_preferences.find(
        {
            "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
            "user_id": uid,
            "channel_id": {"$in": channel_ids},
        },
        {"_id": 0, "channel_id": 1, "is_saved": 1, "is_muted": 1, "notify_level": 1, "mute_until": 1},
    ).to_list(200)
    preferences_by_channel = {row["channel_id"]: row for row in preference_rows}

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
            "is_saved": bool((preferences_by_channel.get(ch["id"]) or {}).get("is_saved")),
            "is_muted": bool((preferences_by_channel.get(ch["id"]) or {}).get("is_muted")),
            "notify_level": (preferences_by_channel.get(ch["id"]) or {}).get("notify_level") or "mentions",
            "mute_until": (preferences_by_channel.get(ch["id"]) or {}).get("mute_until"),
            "last_message": {
                "body": (last_msg.get("body") or "")[:120] if last_msg else "",
                "user_name": last_msg.get("user_name") if last_msg else "",
                "ts": last_msg.get("ts") if last_msg else None,
            } if last_msg else None,
            "unread_count": unread,
        })
    return results


@router.put("/chat/channels/{channel_id}/preference")
async def update_channel_preference(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Set the caller's saved/muted view state for one accessible conversation."""
    await require_channel_access(channel_id, current_user)
    requested = {key: payload[key] for key in ("is_saved", "is_muted") if key in payload}
    if any(not isinstance(value, bool) for value in requested.values()):
        raise HTTPException(400, "Saved and muted settings must be booleans")
    if "notify_level" in payload:
        notify_level = str(payload.get("notify_level") or "").lower()
        if notify_level not in {"all", "mentions", "none"}:
            raise HTTPException(400, "Notification level must be all, mentions, or none")
        requested["notify_level"] = notify_level
        requested["is_muted"] = notify_level == "none"
    if "mute_until" in payload:
        mute_until = payload.get("mute_until")
        if mute_until is not None:
            try:
                mute_until = datetime.fromisoformat(str(mute_until).replace("Z", "+00:00"))
            except ValueError as exc:
                raise HTTPException(400, "mute_until must be an ISO timestamp") from exc
            if mute_until <= datetime.now(timezone.utc):
                raise HTTPException(400, "mute_until must be in the future")
            requested["mute_until"] = mute_until.isoformat()
        else:
            requested["mute_until"] = None
    if not requested:
        raise HTTPException(400, "Provide one or more conversation preferences")
    now = _now()
    await db.chat_user_preferences.update_one(
        {
            "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
            "user_id": current_user.get("id"),
            "channel_id": channel_id,
        },
        {"$set": {**requested, "updated_at": now}, "$setOnInsert": {
            "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
            "user_id": current_user.get("id"),
            "channel_id": channel_id,
            "created_at": now,
        }},
        upsert=True,
    )
    return {"channel_id": channel_id, **requested}


# ============================================================================
# TICKET ↔ CHAT BIDIRECTIONAL LINKING
# ============================================================================
@router.get("/chat/ticket-card/{ticket_number}")
async def ticket_card(ticket_number: str, current_user: dict = Depends(get_current_user)):
    """Lightweight ticket info for inline embeds in chat (mentions like /ticket T-XXX)."""
    t = await db.tickets.find_one({"$or": [{"ticket_number": ticket_number}, {"id": ticket_number}]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    await assert_client_scope(current_user, t.get("client_id"), operation="chat:ticket_card", mask_not_found=True)
    return {
        "id": t.get("id"),
        "ticket_number": t.get("ticket_number"),
        "title": t.get("title"),
        "status": t.get("status"),
        "priority": t.get("priority"),
        "client_name": t.get("client_name"),
        "assigned_to_name": t.get("assigned_name") or t.get("assignee_name") or t.get("assigned_to_name"),
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
    await assert_client_scope(current_user, invoice.get("client_id"), operation="chat:invoice_card", mask_not_found=True)
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
    await assert_client_scope(current_user, po.get("client_id"), operation="chat:po_card", mask_not_found=True)
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
        rows = await db.tickets.find(scoped_query(current_user, query), {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "status": 1}).sort("updated_at", -1).to_list(8)
        return [{"id": row.get("id"), "reference": row.get("ticket_number") or row.get("id"), "title": row.get("title") or "Untitled ticket", "subtitle": f"{row.get('client_name') or 'No client'} · {row.get('status') or 'open'}"} for row in rows]
    if kind == "po":
        query = {"$or": [{"po_number": {"$regex": needle, "$options": "i"}}, {"vendor": {"$regex": needle, "$options": "i"}}]} if needle else {}
        rows = await db.purchase_orders.find(scoped_query(current_user, query), {"_id": 0, "id": 1, "po_number": 1, "vendor": 1, "status": 1, "total": 1}).sort("created_at", -1).to_list(8)
        return [{"id": row.get("id"), "reference": row.get("po_number") or row.get("id"), "title": row.get("vendor") or "Purchase order", "subtitle": f"{row.get('status') or 'draft'} · ${float(row.get('total', 0) or 0):.2f}"} for row in rows]
    query = {"$or": [
        {"invoice_number": {"$regex": needle, "$options": "i"}},
        {"client_name": {"$regex": needle, "$options": "i"}},
    ]} if needle else {}
    rows = await db.invoices.find(scoped_query(current_user, query), {"_id": 0, "id": 1, "invoice_number": 1, "client_name": 1, "payment_status": 1, "total": 1}).sort("created_at", -1).to_list(8)
    return [{"id": row.get("id"), "reference": row.get("invoice_number") or row.get("id"), "title": row.get("client_name") or "Invoice", "subtitle": f"{row.get('payment_status') or 'unpaid'} · ${float(row.get('total', 0) or 0):.2f}"} for row in rows]


@router.post("/chat/discuss-ticket/{ticket_number}")
async def discuss_ticket(ticket_number: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Post a 'Discuss this ticket' message into a channel. Body: {channel_id?}.
    If no channel given, posts to #ops or first public channel. Returns the message."""
    t = await db.tickets.find_one({"$or": [{"ticket_number": ticket_number}, {"id": ticket_number}]}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    await assert_client_scope(current_user, t.get("client_id"), operation="chat:discuss_ticket", mask_not_found=True)
    channel_id = payload.get("channel_id")
    if not channel_id:
        ch = await db.chat_channels.find_one(tenant_scoped_query(current_user, {"$or": [{"name": "ops"}, {"name": "general"}], "is_private": {"$ne": True}}), {"_id": 0})
        if not ch:
            ch = await db.chat_channels.find_one(tenant_scoped_query(current_user, {"is_private": {"$ne": True}, "is_dm": {"$ne": True}}), {"_id": 0})
        if not ch:
            raise HTTPException(400, "No public channel available — create one first")
        channel_id = ch["id"]
    channel = await require_channel_access(channel_id, current_user)
    body = f"💬 Let's discuss /ticket {t.get('ticket_number')} — *{t.get('title')}* ({t.get('priority')}, {t.get('client_name')})"
    msg = {
        "id": uuid.uuid4().hex,
        "tenant_id": platform_tenant_id(current_user),
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
        tenant_scoped_query(current_user, {"id": channel_id}),
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    publish_channel_update(channel_id, "message.created", live_update_recipients(channel))
    msg.pop("_id", None)
    return {"channel_id": channel_id, "message_id": msg["id"], "message": msg}

@router.post("/chat/channels/{channel_id}/typing")
async def typing(channel_id: str, current_user: dict = Depends(get_current_user)):
    channel = await require_channel_access(channel_id, current_user)
    await db.chat_typing.update_one(
        {"channel_id": channel_id, "user_id": current_user.get("id")},
        {"$set": {"channel_id": channel_id, "user_id": current_user.get("id"), "user_name": current_user.get("name"), "avatar_url": current_user.get("avatar"), "ts": _now()}},
        upsert=True,
    )
    publish_channel_update(channel_id, "typing.updated", live_update_recipients(channel))
    return {"ok": True}


@router.patch("/chat/channels/{channel_id}")
async def update_channel_details(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Rename a governed team channel or update its purpose statement."""
    channel = await require_channel_access(channel_id, current_user)
    if channel.get("kind") != "team":
        raise HTTPException(400, "Only team channels have editable channel details")
    if not (is_chat_admin(current_user) or channel.get("created_by") == current_user.get("id")):
        raise HTTPException(403, "Only the channel owner or an admin can edit channel details")
    changes = {}
    if "description" in payload:
        changes["description"] = str(payload.get("description") or "").strip()[:240]
    if "name" in payload:
        name = re.sub(r"-+", "-", str(payload.get("name") or "").strip().lower().replace(" ", "-"))
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,49}", name):
            raise HTTPException(400, "Channel names must be 2-50 letters, numbers, dashes, or underscores")
        if name != channel.get("name"):
            duplicate = await db.chat_channels.find_one(tenant_scoped_query(current_user, {"name": name, "kind": "team", "id": {"$ne": channel_id}, "deleted": {"$ne": True}}), {"_id": 1})
            if duplicate:
                raise HTTPException(409, "A channel with that name already exists")
            changes.update({"name": name, "display_name": name.replace("-", " ").title()})
            if channel.get("created_by") == "system" and channel.get("name") in {"general", "ops", "service-desk", "alerts", "random"}:
                changes["default_key"] = channel["name"]
    if not changes:
        raise HTTPException(400, "Provide a channel name and/or description")
    changes["updated_at"] = _now()
    await db.chat_channels.update_one(tenant_scoped_query(current_user, {"id": channel_id}), {"$set": changes})
    updated = {**channel, **changes}
    audit_details = {key: changes[key] for key in ("name", "display_name", "description") if key in changes}
    await record_channel_event(channel, current_user, "details.updated", audit_details)
    publish_channel_update(channel_id, "channel.details.updated", live_update_recipients(updated))
    return updated


@router.get("/chat/channels/{channel_id}/activity")
async def channel_activity(channel_id: str, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    return await db.chat_channel_events.find({
        "channel_id": channel_id,
        "tenant_id": str(current_user.get("tenant_id") or "nexus-local"),
    }, {"_id": 0}).sort("created_at", -1).to_list(100)


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
