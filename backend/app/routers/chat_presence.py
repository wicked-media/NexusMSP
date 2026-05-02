"""Internal staff chat with LED presence + slash commands.

Endpoints:
  Presence:
    POST /api/presence/heartbeat       — client pings every 15s; sets status
    GET  /api/presence                  — everyone's live status
    POST /api/presence/status           — manual state (active/busy/dnd/break/away)

  Channels & DMs:
    GET  /api/chat/channels             — list channels visible to me
    POST /api/chat/channels             — create channel
    POST /api/chat/dm/{user_id}         — get-or-create a DM with another user
    POST /api/chat/channels/{id}/messages — send message
    GET  /api/chat/channels/{id}/messages?since=iso — fetch recent
    POST /api/chat/channels/{id}/read   — mark all read for me
    GET  /api/chat/unread               — unread counts per channel

  Slash commands:
    POST /api/chat/slash {channel_id, raw}  — process /command

LED computation rule (frontend):
  - active (green pulse): heartbeat <30s ago, no busy_state
  - on_ticket (red): busy_state startswith "ticket:" or "remote:" or "warroom:"
  - dnd/break (orange): manual_state = dnd|break
  - away (yellow pulse): heartbeat 30s-5min ago
  - off_shift (white): out of tech_roster shift_start..shift_end
  - offline (grey): heartbeat > 60s ago
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone, timedelta
import os, re, uuid
from typing import Optional

from app.database import db
from app.auth import get_current_user

router = APIRouter()

MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-sonnet-4-5-20250929"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


# ═══════════════════════ PRESENCE ═══════════════════════

@router.post("/presence/heartbeat")
async def heartbeat(payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Client calls this every 15s. Optionally include a busy_state hint
    e.g. {"busy_state": "ticket:TKT-001"} when on a ticket detail page."""
    busy = payload.get("busy_state")
    doc = {
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "user_email": current_user.get("email"),
        "last_heartbeat": _now_iso(),
        "busy_state": busy,
    }
    await db.presence_state.update_one({"user_id": doc["user_id"]}, {"$set": doc}, upsert=True)
    return {"ok": True, "ts": doc["last_heartbeat"]}


@router.post("/presence/status")
async def set_status(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Manually set status: active | dnd | break | away."""
    state = (payload.get("manual_state") or "").lower()
    if state not in ("active", "dnd", "break", "away", ""):
        raise HTTPException(400, "invalid manual_state")
    patch = {"manual_state": state or None, "manual_state_set_at": _now_iso()}
    await db.presence_state.update_one(
        {"user_id": current_user.get("id")},
        {"$set": patch},
        upsert=True,
    )
    return {"ok": True}


@router.get("/presence")
async def list_presence(current_user: dict = Depends(get_current_user)):
    rows = await db.presence_state.find({}, {"_id": 0}).to_list(500)
    now = _now()
    enriched = []
    for r in rows:
        last = r.get("last_heartbeat")
        delta = None
        if last:
            try:
                d = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                if not d.tzinfo: d = d.replace(tzinfo=timezone.utc)
                delta = (now - d).total_seconds()
            except Exception:
                delta = None
        # Compute LED
        led = "offline"
        if delta is None or delta > 60:
            led = "offline"
        elif r.get("manual_state") == "dnd":
            led = "dnd"
        elif r.get("manual_state") == "break":
            led = "break"
        elif r.get("busy_state"):
            led = "busy"
        elif delta > 300:
            led = "away"
        else:
            led = "active"
        enriched.append({
            **r,
            "seconds_since_heartbeat": int(delta) if delta is not None else None,
            "led": led,
        })
    return {"users": enriched, "generated_at": _now_iso()}


# ═══════════════════════ CHANNELS & DMs ═══════════════════════

async def _ensure_channel(name: str, kind: str = "team", member_ids: Optional[list] = None) -> dict:
    existing = await db.chat_channels.find_one({"name": name, "kind": kind}, {"_id": 0})
    if existing:
        return existing
    doc = {
        "id": uuid.uuid4().hex,
        "name": name,
        "kind": kind,
        "member_ids": member_ids or [],  # empty list = open to all staff
        "created_at": _now_iso(),
    }
    await db.chat_channels.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/chat/channels")
async def list_channels(current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id")
    # Default channels exist for everyone
    await _ensure_channel("general", "team")
    await _ensure_channel("random", "team")
    rows = await db.chat_channels.find(
        {"$or": [
            {"kind": "team", "member_ids": {"$size": 0}},
            {"member_ids": uid},
        ]},
        {"_id": 0},
    ).sort("created_at", 1).to_list(200)
    return rows


@router.post("/chat/channels")
async def create_channel(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    name = (payload.get("name") or "").strip().lower().replace(" ", "-")
    if not name:
        raise HTTPException(400, "name required")
    members = payload.get("member_ids") or []
    if current_user.get("id") not in members:
        members.append(current_user.get("id"))
    doc = await _ensure_channel(name, payload.get("kind") or "team", members)
    return doc


@router.post("/chat/dm/{user_id}")
async def get_or_create_dm(user_id: str, current_user: dict = Depends(get_current_user)):
    me = current_user.get("id")
    if user_id == me:
        raise HTTPException(400, "cannot DM yourself")
    pair = sorted([me, user_id])
    name = f"dm:{pair[0]}:{pair[1]}"
    other = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "name": 1, "email": 1})
    if not other:
        raise HTTPException(404, "user not found")
    doc = await _ensure_channel(name, "dm", pair)
    doc["display_name"] = other.get("name") or other.get("email")
    return doc


@router.post("/chat/channels/{channel_id}/messages")
async def send_message(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    ch = await db.chat_channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404, "channel not found")

    # Detect mentions (@email or @name)
    mentions = re.findall(r"@([\w._-]+)", body)

    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "body": body[:5000],
        "mentions": mentions,
        "ts": _now_iso(),
        "edited": False,
        "reactions": {},
    }
    await db.chat_messages.insert_one(dict(msg))
    msg.pop("_id", None)

    # Push notifications for mentioned users
    for m in mentions:
        u = await db.users.find_one(
            {"$or": [{"email": {"$regex": f"^{m}@", "$options": "i"}}, {"name": {"$regex": m, "$options": "i"}}]},
            {"_id": 0, "id": 1, "name": 1},
        )
        if u and u.get("id") != current_user.get("id"):
            await db.notifications.insert_one({
                "id": uuid.uuid4().hex,
                "type": "chat_mention",
                "title": f"💬 {current_user.get('name')} mentioned you",
                "body": body[:200],
                "ref_type": "chat_channel",
                "ref_id": channel_id,
                "target_user_id": u.get("id"),
                "read": False,
                "created_at": _now_iso(),
            })
    return msg


@router.get("/chat/channels/{channel_id}/messages")
async def list_messages(channel_id: str, since: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    q = {"channel_id": channel_id}
    if since:
        q["ts"] = {"$gt": since}
    rows = await db.chat_messages.find(q, {"_id": 0}).sort("ts", 1).limit(200).to_list(200)
    return rows


@router.post("/chat/channels/{channel_id}/read")
async def mark_read(channel_id: str, current_user: dict = Depends(get_current_user)):
    await db.chat_read_state.update_one(
        {"channel_id": channel_id, "user_id": current_user.get("id")},
        {"$set": {"channel_id": channel_id, "user_id": current_user.get("id"), "last_read_at": _now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/chat/unread")
async def unread_counts(current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id")
    reads = await db.chat_read_state.find({"user_id": uid}, {"_id": 0}).to_list(200)
    last_read_by_ch = {r["channel_id"]: r.get("last_read_at") for r in reads}
    channels = await db.chat_channels.find(
        {"$or": [{"kind": "team", "member_ids": {"$size": 0}}, {"member_ids": uid}]},
        {"_id": 0, "id": 1},
    ).to_list(200)
    out = {}
    for ch in channels:
        cid = ch["id"]
        last = last_read_by_ch.get(cid)
        q = {"channel_id": cid, "user_id": {"$ne": uid}}
        if last:
            q["ts"] = {"$gt": last}
        c = await db.chat_messages.count_documents(q)
        out[cid] = c
    return out


@router.post("/chat/messages/{msg_id}/react")
async def react(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    emoji = (payload.get("emoji") or "").strip()
    if not emoji:
        raise HTTPException(400, "emoji required")
    msg = await db.chat_messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "message not found")
    reactions = msg.get("reactions") or {}
    voters = set(reactions.get(emoji, []))
    uid = current_user.get("id")
    if uid in voters: voters.discard(uid)
    else: voters.add(uid)
    reactions[emoji] = list(voters)
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"reactions": reactions}})
    return {"reactions": reactions}


# ═══════════════════════ SLASH COMMANDS ═══════════════════════

@router.post("/chat/slash")
async def slash(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    raw = (payload.get("raw") or "").strip()
    channel_id = payload.get("channel_id")
    if not raw.startswith("/") or not channel_id:
        raise HTTPException(400, "raw must start with / and channel_id required")

    parts = raw[1:].split()
    cmd = parts[0].lower() if parts else ""
    args = parts[1:]

    if cmd == "assign" and len(args) >= 2:
        # /assign @bob TKT-001
        who = args[0].lstrip("@")
        ticket_no = args[1]
        u = await db.users.find_one({"$or": [{"name": {"$regex": who, "$options": "i"}}, {"email": {"$regex": who, "$options": "i"}}]}, {"_id": 0})
        t = await db.tickets.find_one({"ticket_number": ticket_no}, {"_id": 0})
        if u and t:
            await db.tickets.update_one({"id": t["id"]}, {"$set": {"assignee_id": u["id"], "assignee_name": u.get("name")}})
            return await _post_system_msg(channel_id, f"✅ {ticket_no} assigned to {u.get('name')}")
        return await _post_system_msg(channel_id, f"❌ Couldn't assign — user or ticket not found")

    if cmd == "summarize":
        # AI summary of recent channel messages
        msgs = await db.chat_messages.find({"channel_id": channel_id}, {"_id": 0}).sort("ts", -1).limit(40).to_list(40)
        if not msgs:
            return await _post_system_msg(channel_id, "Nothing to summarize.")
        msgs.reverse()
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            return await _post_system_msg(channel_id, "AI not configured.")
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=api_key, session_id=f"slash-{uuid.uuid4().hex[:8]}",
                       system_message="You are a chat assistant. Summarize the conversation into 3-5 concise bullet points. Plain text. No preamble.").with_model(MODEL_PROVIDER, MODEL_NAME)
        text = "\n".join([f"{m.get('user_name')}: {m.get('body')}" for m in msgs])
        summary = await chat.send_message(UserMessage(text=text))
        return await _post_system_msg(channel_id, f"📝 *Thread summary:*\n{summary}")

    if cmd == "page" and args:
        sev = args[0].lower()
        await db.notifications.insert_one({
            "id": uuid.uuid4().hex,
            "type": "chat_page",
            "title": f"📟 PAGE ({sev.upper()})",
            "body": f"{current_user.get('name')} paged the team in chat",
            "ref_type": "chat_channel",
            "ref_id": channel_id,
            "read": False,
            "created_at": _now_iso(),
        })
        return await _post_system_msg(channel_id, f"📟 Team paged: {sev}")

    if cmd == "help":
        return await _post_system_msg(channel_id, "Slash commands: /assign @user TKT-### · /summarize · /page <severity> · /help")

    return await _post_system_msg(channel_id, f"Unknown command: /{cmd}. Try /help.")


async def _post_system_msg(channel_id: str, body: str) -> dict:
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": "system",
        "user_name": "NexusOps",
        "body": body,
        "is_system": True,
        "ts": _now_iso(),
        "reactions": {},
    }
    await db.chat_messages.insert_one(dict(msg))
    msg.pop("_id", None)
    return msg
