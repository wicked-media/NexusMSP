"""Internal staff chat with LED presence + slash commands.

Endpoints:
  Presence:
    POST /api/presence/heartbeat       â€” client pings every 15s; sets status
    GET  /api/presence                  â€” everyone's live status
    POST /api/presence/status           â€” manual state (active/busy/dnd/break/away)

  Channels & DMs:
    GET  /api/chat/channels             â€” list channels visible to me
    POST /api/chat/channels             â€” create channel
    POST /api/chat/dm/{user_id}         â€” get-or-create a DM with another user
    POST /api/chat/channels/{id}/messages â€” send message
    GET  /api/chat/channels/{id}/messages?since=iso â€” fetch recent
    POST /api/chat/channels/{id}/read   â€” mark all read for me
    GET  /api/chat/unread               â€” unread counts per channel

  Slash commands:
    POST /api/chat/slash {channel_id, raw}  â€” process /command

LED computation rule (frontend):
  - active (green pulse): heartbeat <30s ago, no busy_state
  - on_ticket (red): busy_state startswith "ticket:" or "remote:" or "warroom:"
  - dnd/break (orange): manual_state = dnd|break
  - away (yellow pulse): heartbeat 30s-5min ago
  - off_shift (white): out of tech_roster shift_start..shift_end
  - offline (grey): heartbeat > 60s ago
"""
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from datetime import datetime, timezone, timedelta
import asyncio, os, re, uuid
from typing import Optional

from app.database import db
from app.auth import get_current_user
from app.services.activity import ticket_audit
from app.services.chat_access import (
    channel_visibility_query,
    enrich_channels,
    ensure_default_channels,
    require_channel_access,
)

router = APIRouter()

MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-sonnet-4-5-20250929"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• PRESENCE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/presence/heartbeat")
async def heartbeat(payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Client calls this every 15s. Optionally include a busy_state hint
    e.g. {"busy_state": "ticket:TKT-001"} when on a ticket detail page."""
    doc = {
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "user_email": current_user.get("email"),
        "last_heartbeat": _now_iso(),
    }
    # A general keep-alive must not clear the route-aware busy state sent by
    # the app shell. Chat sends an empty heartbeat while it is open.
    if "busy_state" in payload:
        next_busy_state = payload.get("busy_state")
        previous = await db.presence_state.find_one({"user_id": doc["user_id"]}, {"_id": 0, "busy_state": 1})
        previous_busy_state = (previous or {}).get("busy_state")
        doc["busy_state"] = next_busy_state
        # Record only transitions, not every heartbeat. This is the audit trail
        # behind the technician activity indicators in Chat.
        if previous_busy_state != next_busy_state:
            await db.work_activity_audit.insert_one({
                "id": uuid.uuid4().hex,
                "user_id": doc["user_id"],
                "user_name": doc["user_name"],
                "event": "viewed" if next_busy_state else "left",
                "work_item": next_busy_state or previous_busy_state,
                "previous_work_item": previous_busy_state,
                "created_at": doc["last_heartbeat"],
            })
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
        if delta is None or delta > 300:
            led = "offline"
        elif r.get("manual_state") == "dnd":
            led = "dnd"
        elif r.get("manual_state") == "break":
            led = "break"
        elif r.get("manual_state") == "away":
            led = "away"
        elif r.get("busy_state"):
            led = "busy"
        elif delta > 45:
            led = "away"
        else:
            led = "active"
        enriched.append({
            **r,
            "seconds_since_heartbeat": int(delta) if delta is not None else None,
            "led": led,
        })
    return {"users": enriched, "generated_at": _now_iso()}


@router.get("/presence/work-activity")
async def work_activity(
    work_item: str = Query(..., min_length=3, max_length=200),
    limit: int = Query(6, ge=1, le=25),
    current_user: dict = Depends(get_current_user),
):
    """Recent open/leave history for one linked operational record.

    The heartbeat handler writes only state transitions, keeping this concise
    enough to show in context on a chat-linked ticket, invoice, or PO.
    """
    rows = await db.work_activity_audit.find(
        {"work_item": work_item}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return {"work_item": work_item, "events": rows}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• CHANNELS & DMs â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async def _ensure_channel(
    name: str,
    kind: str = "team",
    member_ids: Optional[list] = None,
    **extra,
) -> dict:
    existing = await db.chat_channels.find_one({"name": name, "kind": kind}, {"_id": 0})
    if existing:
        return existing
    doc = {
        "id": uuid.uuid4().hex,
        "name": name,
        "kind": kind,
        "member_ids": member_ids or [],  # empty list = open to all staff
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        **extra,
    }
    await db.chat_channels.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/chat/channels")
async def list_channels(current_user: dict = Depends(get_current_user)):
    await ensure_default_channels()
    rows = await db.chat_channels.find(
        channel_visibility_query(current_user),
        {"_id": 0},
    ).sort("created_at", 1).to_list(200)
    return await enrich_channels(rows, current_user)


@router.post("/chat/channels")
async def create_channel(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    name = re.sub(r"-+", "-", (payload.get("name") or "").strip().lower().replace(" ", "-"))
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,49}", name):
        raise HTTPException(400, "Channel names must be 2-50 letters, numbers, dashes, or underscores")
    if await db.chat_channels.find_one({"name": name, "kind": "team"}, {"_id": 1}):
        raise HTTPException(409, "A channel with that name already exists")

    is_private = bool(payload.get("is_private"))
    requested_members = payload.get("member_ids") or []
    if not isinstance(requested_members, list) or len(requested_members) > 100:
        raise HTTPException(400, "member_ids must contain at most 100 users")
    members = list(dict.fromkeys(str(member) for member in requested_members if member)) if is_private else []
    if is_private and current_user.get("id") not in members:
        members.append(current_user.get("id"))
    if is_private:
        valid_members = await db.users.count_documents({
            "id": {"$in": members},
            "is_active": {"$ne": False},
        })
        if valid_members != len(members):
            raise HTTPException(400, "One or more selected teammates are unavailable")

    now = _now_iso()
    doc = {
        "id": uuid.uuid4().hex,
        "name": name,
        "display_name": name.replace("-", " ").title(),
        "description": str(payload.get("description") or "").strip()[:240],
        "kind": "team",
        "is_private": is_private,
        "is_dm": False,
        "member_ids": members,
        "created_by": current_user.get("id"),
        "created_at": now,
        "updated_at": now,
    }
    await db.chat_channels.insert_one(dict(doc))
    return (await enrich_channels([doc], current_user))[0]


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
    doc = await _ensure_channel(
        name,
        "dm",
        pair,
        is_private=True,
        is_dm=True,
        created_by=me,
    )
    return (await enrich_channels([doc], current_user))[0]


@router.post("/chat/channels/{channel_id}/messages")
async def send_message(channel_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    ch = await require_channel_access(channel_id, current_user)

    # Detect mentions (@email or @name) and special @channel / @here broadcasts
    raw_mentions = re.findall(r"@([\w._-]+)", body)
    broadcast_tokens = {m.lower() for m in raw_mentions if m.lower() in {"channel", "here", "everyone"}}
    broadcast = bool(broadcast_tokens)
    mentions = [m for m in raw_mentions if m.lower() not in {"channel", "here", "everyone"}]

    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": channel_id,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "body": body[:5000],
        "mentions": mentions,
        "broadcast": broadcast,
        "ts": _now_iso(),
        "edited": False,
        "reactions": {},
    }
    await db.chat_messages.insert_one(dict(msg))
    await db.chat_channels.update_one(
        {"id": channel_id},
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    msg.pop("_id", None)

    notified_ids = set()
    # A private channel must never disclose a message through a notification to
    # someone who cannot open that channel.  Team channels intentionally have
    # no member list, so their eligible audience is the active team.
    eligible_ids = set(ch.get("member_ids") or [])
    if not eligible_ids:
        active_users = await db.users.find(
            {"is_active": {"$ne": False}, "archived": {"$ne": True}},
            {"_id": 0, "id": 1},
        ).to_list(500)
        eligible_ids = {row.get("id") for row in active_users if row.get("id")}

    # Push notifications for explicit @user mentions
    for m in mentions:
        handle = m.lower()
        candidates = await db.users.find(
            {"id": {"$in": list(eligible_ids)}, "is_active": {"$ne": False}, "archived": {"$ne": True}},
            {"_id": 0, "id": 1, "name": 1, "email": 1},
        ).to_list(500)
        # The composer inserts an email handle, which is unambiguous.  Keep a
        # normalized name fallback for people who type a name by hand.
        u = next((row for row in candidates if str(row.get("email") or "").split("@", 1)[0].lower() == handle), None)
        if not u:
            u = next((row for row in candidates if re.sub(r"[\\s._-]+", "", str(row.get("name") or "").lower()) == re.sub(r"[\\s._-]+", "", handle)), None)
        if u and u.get("id") and u.get("id") != current_user.get("id") and u["id"] not in notified_ids:
            notified_ids.add(u["id"])
            await db.notifications.insert_one({
                "id": uuid.uuid4().hex,
                "type": "chat_mention",
                "title": f"ðŸ’¬ {current_user.get('name')} mentioned you",
                "body": body[:200],
                "message": body[:200],
                "ref_type": "chat_channel",
                "ref_id": channel_id,
                "user_id": u.get("id"),
                "target_user_id": u.get("id"),
                "read": False,
                "created_at": _now_iso(),
            })

    # @channel / @here / @everyone â€” notify every channel member
    if broadcast:
        member_ids = list(eligible_ids)
        # @here is intentionally narrower than @channel: only technicians
        # currently active in Nexus receive it. If both are present, the
        # explicit channel-wide mention wins.
        if "here" in broadcast_tokens and not ({"channel", "everyone"} & broadcast_tokens):
            presence_rows = await db.presence_state.find(
                {"user_id": {"$in": member_ids}},
                {"_id": 0, "user_id": 1, "last_heartbeat": 1, "manual_state": 1},
            ).to_list(500)
            active_ids = set()
            for row in presence_rows:
                try:
                    seen_at = datetime.fromisoformat(str(row.get("last_heartbeat") or "").replace("Z", "+00:00"))
                    is_recent = (_now() - seen_at).total_seconds() <= 60
                except Exception:
                    is_recent = False
                if is_recent and row.get("manual_state") not in {"dnd", "break", "away"}:
                    active_ids.add(row.get("user_id"))
            member_ids = [uid for uid in member_ids if uid in active_ids]
        ch_label = ch.get("name") or "channel"
        for uid in member_ids:
            if not uid or uid == current_user.get("id") or uid in notified_ids:
                continue
            notified_ids.add(uid)
            await db.notifications.insert_one({
                "id": uuid.uuid4().hex,
                "type": "chat_broadcast",
                "title": f"ðŸ“¢ {current_user.get('name')} pinged #{ch_label}",
                "body": body[:200],
                "message": body[:200],
                "ref_type": "chat_channel",
                "ref_id": channel_id,
                "user_id": uid,
                "target_user_id": uid,
                "read": False,
                "created_at": _now_iso(),
            })
    return msg


@router.get("/chat/channels/{channel_id}/messages")
async def list_messages(channel_id: str, since: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    q = {"channel_id": channel_id}
    if since:
        q["ts"] = {"$gt": since}
    rows = await db.chat_messages.find(q, {"_id": 0}).sort("ts", -1).limit(200).to_list(200)
    rows.reverse()
    return rows


@router.post("/chat/channels/{channel_id}/read")
async def mark_read(channel_id: str, current_user: dict = Depends(get_current_user)):
    await require_channel_access(channel_id, current_user)
    read_at = _now_iso()
    await db.chat_read_state.update_one(
        {"channel_id": channel_id, "user_id": current_user.get("id")},
        {"$set": {"channel_id": channel_id, "user_id": current_user.get("id"), "last_read_at": read_at}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/chat/channels/{channel_id}/read-receipts")
async def channel_read_receipts(channel_id: str, current_user: dict = Depends(get_current_user)):
    """Read cursors for a conversation, used to render per-message receipts."""
    await require_channel_access(channel_id, current_user)
    rows = await db.chat_read_state.find(
        {"channel_id": channel_id}, {"_id": 0, "user_id": 1, "last_read_at": 1}
    ).to_list(200)
    user_ids = [row.get("user_id") for row in rows if row.get("user_id")]
    users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    names = {user.get("id"): user.get("name") or "Technician" for user in users}
    return [{**row, "user_name": names.get(row.get("user_id"), "Technician")} for row in rows]


@router.get("/chat/unread")
async def unread_counts(current_user: dict = Depends(get_current_user)):
    await ensure_default_channels()
    uid = current_user.get("id")
    reads = await db.chat_read_state.find({"user_id": uid}, {"_id": 0}).to_list(200)
    last_read_by_ch = {r["channel_id"]: r.get("last_read_at") for r in reads}
    channels = await db.chat_channels.find(
        channel_visibility_query(current_user),
        {"_id": 0, "id": 1},
    ).to_list(200)
    async def _count(ch: dict) -> tuple[str, int]:
        cid = ch["id"]
        last = last_read_by_ch.get(cid)
        q = {
            "channel_id": cid,
            "user_id": {"$ne": uid},
            "thread_id": {"$exists": False},
            "deleted": {"$ne": True},
        }
        if last:
            q["ts"] = {"$gt": last}
        return cid, await db.chat_messages.count_documents(q)

    counts = await asyncio.gather(*[_count(channel) for channel in channels])
    return dict(counts)


@router.post("/chat/messages/{msg_id}/react")
async def react(msg_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    emoji = (payload.get("emoji") or "").strip()
    if not emoji or len(emoji) > 16 or "." in emoji or "$" in emoji:
        raise HTTPException(400, "emoji required")
    msg = await db.chat_messages.find_one({"id": msg_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "message not found")
    await require_channel_access(msg.get("channel_id"), current_user)
    reactions = msg.get("reactions") or {}
    voters = set(reactions.get(emoji, []))
    uid = current_user.get("id")
    if uid in voters: voters.discard(uid)
    else: voters.add(uid)
    reactions[emoji] = list(voters)
    await db.chat_messages.update_one({"id": msg_id}, {"$set": {"reactions": reactions}})
    return {"reactions": reactions}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SLASH COMMANDS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/chat/slash")
async def slash(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    raw = (payload.get("raw") or "").strip()
    channel_id = payload.get("channel_id")
    if not raw.startswith("/") or not channel_id:
        raise HTTPException(400, "raw must start with / and channel_id required")
    await require_channel_access(channel_id, current_user)

    parts = raw[1:].split()
    cmd = parts[0].lower() if parts else ""
    args = parts[1:]

    # A single reference links the work item into the conversation. Keep this
    # distinct from the multi-argument /ticket command below, which updates a
    # ticket field.
    if cmd in {"ticket", "invoice", "po"} and len(args) == 1:
        reference = args[0]
        collection, number_field, label = {
            "ticket": (db.tickets, "ticket_number", "Ticket"),
            "invoice": (db.invoices, "invoice_number", "Invoice"),
            "po": (db.purchase_orders, "po_number", "Purchase order"),
        }[cmd]
        item = await collection.find_one(
            {"$or": [{number_field: reference}, {"id": reference}]},
            {"_id": 0, "id": 1, number_field: 1},
        )
        if not item:
            return await _post_system_msg(channel_id, f"{label} {reference} not found")
        canonical_reference = item.get(number_field) or item.get("id")
        return await _post_system_msg(
            channel_id,
            f"{label} linked by {current_user.get('name')}: /{cmd} {canonical_reference}",
        )

    if cmd == "assign" and len(args) >= 2:
        # /assign @bob TKT-001
        who = args[0].lstrip("@")
        ticket_no = args[1]
        u = await db.users.find_one({"$or": [{"name": {"$regex": who, "$options": "i"}}, {"email": {"$regex": who, "$options": "i"}}]}, {"_id": 0})
        t = await db.tickets.find_one({"ticket_number": ticket_no}, {"_id": 0})
        if u and t:
            await db.tickets.update_one({"id": t["id"]}, {"$set": {
                "assigned_to": u["id"], "assigned_name": u.get("name"),
                # Retain these aliases for older integrations that still read them.
                "assignee_id": u["id"], "assignee_name": u.get("name"),
                "updated_at": _now_iso(),
            }})
            await ticket_audit(t["id"], current_user, "assigned", f"Assigned to {u.get('name')} from Team Chat")
            return await _post_system_msg(channel_id, f"âœ… {ticket_no} assigned to {u.get('name')}")
        return await _post_system_msg(channel_id, f"âŒ Couldn't assign â€” user or ticket not found")

    if cmd == "ticket" and len(args) >= 3:
        # /ticket TKT-001 status closed     |   /ticket TKT-001 priority high
        ticket_no = args[0]
        field = args[1].lower()
        value = " ".join(args[2:]).lower().replace(" ", "_")
        valid = {
            "status": {"open", "in_progress", "on_hold", "resolved", "closed", "pending"},
            "priority": {"low", "medium", "high", "critical"},
        }
        if field not in valid:
            return await _post_system_msg(channel_id, f"âŒ Unknown field '{field}'. Use: status | priority")
        if value not in valid[field]:
            return await _post_system_msg(channel_id, f"âŒ Invalid {field} '{value}'. Allowed: {', '.join(sorted(valid[field]))}")
        t = await db.tickets.find_one({"ticket_number": ticket_no}, {"_id": 0})
        if not t:
            return await _post_system_msg(channel_id, f"âŒ Ticket {ticket_no} not found")
        await db.tickets.update_one({"id": t["id"]}, {"$set": {field: value, "updated_at": _now_iso()}})
        await ticket_audit(t["id"], current_user, "updated", f"{field.replace('_', ' ')} changed to {value} from Team Chat")
        emoji = {"closed": "ðŸ”’", "resolved": "âœ…", "in_progress": "ðŸŸ¡", "on_hold": "â¸ï¸", "open": "ðŸ”“", "pending": "â³",
                 "critical": "ðŸš¨", "high": "ðŸ”¥", "medium": "ðŸŸ¦", "low": "ðŸŸ¢"}.get(value, "ðŸ”§")
        return await _post_system_msg(channel_id, f"{emoji} {ticket_no} â€” {field} â†’ **{value}** by {current_user.get('name')}")

    if cmd == "close" and args:
        ticket_no = args[0]
        t = await db.tickets.find_one({"ticket_number": ticket_no}, {"_id": 0})
        if not t:
            return await _post_system_msg(channel_id, f"âŒ Ticket {ticket_no} not found")
        await db.tickets.update_one({"id": t["id"]}, {"$set": {"status": "closed", "updated_at": _now_iso()}})
        await ticket_audit(t["id"], current_user, "updated", "Status changed to closed from Team Chat")
        return await _post_system_msg(channel_id, f"ðŸ”’ {ticket_no} closed by {current_user.get('name')}")

    if cmd == "sla" and args:
        ticket_no = args[0]
        t = await db.tickets.find_one({"ticket_number": ticket_no}, {"_id": 0})
        if not t:
            return await _post_system_msg(channel_id, f"âŒ Ticket {ticket_no} not found")
        from datetime import datetime, timezone as _tz
        def _fmt_left(due_iso):
            if not due_iso:
                return "â€”"
            try:
                due = datetime.fromisoformat(due_iso.replace("Z", "+00:00"))
            except Exception:
                return "â€”"
            mins = int((due - datetime.now(_tz.utc)).total_seconds() / 60)
            if mins <= 0:
                return f"â›” breached by {abs(mins)}m"
            if mins < 60:
                return f"â±ï¸ {mins}m left"
            return f"â±ï¸ {mins // 60}h {mins % 60}m left"
        resp = _fmt_left(t.get("sla_response_due"))
        res = _fmt_left(t.get("sla_resolution_due"))
        body = (
            f"ðŸ“Š **SLA â€” {ticket_no}** ({t.get('priority', 'medium')})\n"
            f"â€¢ Response: {resp}\n"
            f"â€¢ Resolution: {res}\n"
            f"â€¢ Status: {t.get('status', 'open')}"
        )
        return await _post_system_msg(channel_id, body)

    if cmd == "note" and len(args) >= 2:
        # /note TKT-001 the rest of the message becomes the internal note
        ticket_no = args[0]
        note_body = " ".join(args[1:])
        t = await db.tickets.find_one({"ticket_number": ticket_no}, {"_id": 0})
        if not t:
            return await _post_system_msg(channel_id, f"âŒ Ticket {ticket_no} not found")
        await db.ticket_notes.insert_one({
            "id": uuid.uuid4().hex,
            "ticket_id": t["id"],
            "user_id": current_user.get("id"),
            "user_name": current_user.get("name"),
            "content": note_body,
            "is_internal": True,
            "created_at": _now_iso(),
        })
        await ticket_audit(t["id"], current_user, "internal_note_added", "Added internal note from Team Chat")
        return await _post_system_msg(channel_id, f"ðŸ“ Note added to {ticket_no} by {current_user.get('name')}: _{note_body[:80]}{'â€¦' if len(note_body) > 80 else ''}_")

    if cmd == "summarize":
        # AI summary of recent channel messages
        msgs = await db.chat_messages.find({"channel_id": channel_id}, {"_id": 0}).sort("ts", -1).limit(40).to_list(40)
        if not msgs:
            return await _post_system_msg(channel_id, "Nothing to summarize.")
        msgs.reverse()
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return await _post_system_msg(channel_id, "AI not configured.")
        from app.services.ai_provider import LlmChat, UserMessage
        chat = LlmChat(api_key=api_key, session_id=f"slash-{uuid.uuid4().hex[:8]}",
                       system_message="You are a chat assistant. Summarize the conversation into 3-5 concise bullet points. Plain text. No preamble.").with_model(MODEL_PROVIDER, MODEL_NAME)
        text = "\n".join([f"{m.get('user_name')}: {m.get('body')}" for m in msgs])
        summary = await chat.send_message(UserMessage(text=text))
        return await _post_system_msg(channel_id, f"ðŸ“ *Thread summary:*\n{summary}")

    if cmd == "page" and args:
        sev = args[0].lower()
        await db.notifications.insert_one({
            "id": uuid.uuid4().hex,
            "type": "chat_page",
            "title": f"ðŸ“Ÿ PAGE ({sev.upper()})",
            "body": f"{current_user.get('name')} paged the team in chat",
            "ref_type": "chat_channel",
            "ref_id": channel_id,
            "read": False,
            "created_at": _now_iso(),
        })
        return await _post_system_msg(channel_id, f"ðŸ“Ÿ Team paged: {sev}")

    if cmd == "help":
        return await _post_system_msg(channel_id, (
            "ðŸ› ï¸ **Slash commands**\n"
            "â€¢ `/ticket TKT-### status <open|in_progress|on_hold|resolved|closed>` â€” change status\n"
            "â€¢ `/ticket TKT-### priority <low|medium|high|critical>` â€” change priority\n"
            "â€¢ `/close TKT-###` â€” quick close\n"
            "â€¢ `/assign @user TKT-###` â€” assign ticket\n"
            "â€¢ `/ticket|invoice|po <reference>` â€” link a work item\n"
            "â€¢ `/sla TKT-###` â€” show SLA timers\n"
            "â€¢ `/note TKT-### <body>` â€” add internal note\n"
            "â€¢ `/summarize` â€” AI summary of last 40 messages\n"
            "â€¢ `/page <severity>` â€” page the team\n"
            "â€¢ `/help` â€” this list"
        ))

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
    await db.chat_channels.update_one(
        {"id": channel_id},
        {"$set": {"updated_at": msg["ts"], "last_message_at": msg["ts"]}},
    )
    msg.pop("_id", None)
    return msg
