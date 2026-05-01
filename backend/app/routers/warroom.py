"""Live Incident War Room.

When a P1 fires, one URL becomes a shared battle-station with:
  • Affected client + devices
  • Past similar incidents (string-matched; future: vector search)
  • Live tech chat (polling-based)
  • Running ETA + status
  • A public-facing slug the client can bookmark (no auth required)
  • Escalation Ladder paging — fires in tiers with ack tracking

Data model: db.war_rooms
  {
    id, public_slug, title, severity, status, summary, eta,
    ticket_id, client_id, client_name, affected_device_ids,
    participants: [{name, joined_at}],
    messages: [{id, author, kind:'chat'|'status'|'system', body, ts}],
    similar_incidents: [{ticket_id, title, resolution, resolved_at}],
    pages: [{id, tech_id, name, tier, channels:[], status:'pending'|'sent'|'ack'|'escalated', 
             ack_token, sent_at, ack_at, ack_by_name}],
    auto_escalate: bool, next_escalation_at, escalation_tier,
    created_by, created_at, resolved_at, resolved_notes
  }
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import os
import uuid
import secrets
import httpx
from app.database import db
from app.auth import get_current_user

router = APIRouter()

STATUS_ORDER = ["investigating", "identified", "monitoring", "resolved"]


async def _find_similar_incidents(client_id: str, title: str, limit: int = 5) -> list:
    """Return up to N past resolved tickets from the same client with overlapping title tokens."""
    tokens = [t.lower() for t in (title or "").split() if len(t) > 3][:6]
    if not tokens:
        return []
    q = {"client_id": client_id, "status": "resolved"}
    docs = await db.tickets.find(q, {"_id": 0, "id": 1, "title": 1, "resolution": 1, "resolved_at": 1}).sort("resolved_at", -1).limit(300).to_list(300)
    scored = []
    for d in docs:
        t = (d.get("title") or "").lower()
        score = sum(1 for tok in tokens if tok in t)
        if score > 0:
            scored.append((score, d))
    scored.sort(key=lambda x: -x[0])
    out = []
    for score, d in scored[:limit]:
        out.append({
            "ticket_id": d["id"],
            "title": d.get("title"),
            "resolution": (d.get("resolution") or "")[:400],
            "resolved_at": d.get("resolved_at"),
        })
    return out


def _sys_msg(body: str, author: str = "system") -> dict:
    return {
        "id": f"m-{uuid.uuid4().hex[:10]}",
        "author": author,
        "kind": "system",
        "body": body,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/warroom")
async def create_warroom(data: dict, current_user: dict = Depends(get_current_user)):
    """Body: { title, severity?, summary?, ticket_id?, client_id?, affected_device_ids?: [] }

    Auto-populates client_name, similar_incidents, and a public_slug for client bookmark.
    """
    title = (data.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "title is required")

    client_id = data.get("client_id")
    client_name = None
    ticket = None
    if data.get("ticket_id"):
        ticket = await db.tickets.find_one({"id": data["ticket_id"]}, {"_id": 0})
        if ticket and not client_id:
            client_id = ticket.get("client_id")
    if client_id:
        c = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
        if c:
            client_name = c.get("name")

    similar = await _find_similar_incidents(client_id, title) if client_id else []

    now = datetime.now(timezone.utc).isoformat()
    wr_id = f"wr-{uuid.uuid4().hex[:12]}"
    slug = secrets.token_urlsafe(8)
    doc = {
        "id": wr_id,
        "public_slug": slug,
        "title": title[:220],
        "severity": (data.get("severity") or "P1").upper(),
        "status": "investigating",
        "summary": (data.get("summary") or "")[:2000],
        "eta": (data.get("eta") or "")[:120],
        "ticket_id": data.get("ticket_id"),
        "client_id": client_id,
        "client_name": client_name,
        "affected_device_ids": (data.get("affected_device_ids") or [])[:100],
        "participants": [{"name": current_user.get("name") or "unknown", "joined_at": now}],
        "similar_incidents": similar,
        "messages": [
            _sys_msg(f"War room opened by {current_user.get('name')} · severity {(data.get('severity') or 'P1').upper()}"),
        ],
        "created_by": current_user.get("name"),
        "created_at": now,
        "resolved_at": None,
        "resolved_notes": None,
    }
    await db.war_rooms.insert_one(doc)
    doc.pop("_id", None)
    return {"success": True, "war_room": doc}


@router.get("/warroom")
async def list_warrooms(include_resolved: bool = False, limit: int = 50, current_user: dict = Depends(get_current_user)):
    q = {} if include_resolved else {"status": {"$ne": "resolved"}}
    cursor = db.war_rooms.find(q, {"_id": 0, "messages": 0, "similar_incidents": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(limit)


@router.get("/warroom/{wr_id}")
async def get_warroom(wr_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "War room not found")
    # Hydrate affected_devices with current status
    if doc.get("affected_device_ids"):
        devs = await db.devices.find(
            {"id": {"$in": doc["affected_device_ids"]}},
            {"_id": 0, "id": 1, "name": 1, "status": 1, "ip_address": 1, "client_name": 1}
        ).to_list(200)
        doc["affected_devices"] = devs
    return doc


@router.post("/warroom/{wr_id}/messages")
async def post_message(wr_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    body = (data.get("body") or "").strip()
    if not body:
        raise HTTPException(400, "body required")
    kind = data.get("kind", "chat")
    if kind not in {"chat", "status"}:
        kind = "chat"
    msg = {
        "id": f"m-{uuid.uuid4().hex[:10]}",
        "author": current_user.get("name") or "unknown",
        "kind": kind,
        "body": body[:4000],
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    # Add participant if new
    name = current_user.get("name") or "unknown"
    await db.war_rooms.update_one(
        {"id": wr_id, "participants.name": {"$ne": name}},
        {"$push": {"participants": {"name": name, "joined_at": msg["ts"]}}}
    )
    await db.war_rooms.update_one({"id": wr_id}, {"$push": {"messages": msg}})
    return {"success": True, "message": msg}


@router.post("/warroom/{wr_id}/status")
async def update_status(wr_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: { status?, eta?, summary? }. Writes a system message on status change."""
    patch = {}
    msgs = []
    wr = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0, "status": 1, "eta": 1})
    if not wr:
        raise HTTPException(404, "Not found")

    if "status" in data:
        new_status = data["status"]
        if new_status not in STATUS_ORDER:
            raise HTTPException(400, f"status must be in {STATUS_ORDER}")
        if new_status != wr.get("status"):
            patch["status"] = new_status
            msgs.append(_sys_msg(f"Status changed to **{new_status}** by {current_user.get('name')}"))
            if new_status == "resolved":
                patch["resolved_at"] = datetime.now(timezone.utc).isoformat()
    if "eta" in data:
        eta = str(data["eta"] or "")[:120]
        if eta != (wr.get("eta") or ""):
            patch["eta"] = eta
            if eta:
                msgs.append(_sys_msg(f"ETA updated: {eta}"))
    if "summary" in data:
        patch["summary"] = str(data["summary"] or "")[:2000]
    if not patch:
        return {"success": True, "no_change": True}

    update = {"$set": patch}
    if msgs:
        update["$push"] = {"messages": {"$each": msgs}}
    await db.war_rooms.update_one({"id": wr_id}, update)
    doc = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0})
    return {"success": True, "war_room": doc}


@router.post("/warroom/{wr_id}/resolve")
async def resolve_warroom(wr_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    notes = (data or {}).get("resolved_notes", "")
    now = datetime.now(timezone.utc).isoformat()
    await db.war_rooms.update_one(
        {"id": wr_id},
        {
            "$set": {"status": "resolved", "resolved_at": now, "resolved_notes": notes[:4000]},
            "$push": {"messages": _sys_msg(f"War room resolved by {current_user.get('name')}{(': ' + notes[:200]) if notes else ''}")}
        }
    )
    doc = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return {"success": True, "war_room": doc}


# ─────────────────────────── Client-facing PUBLIC view ───────────────────────────
# Zero-auth endpoint, accessed via slug only. Returns a reduced safe payload
# (no tech chat messages unless kind='status'/'system').

@router.get("/warroom/public/{slug}")
async def public_view(slug: str):
    doc = await db.war_rooms.find_one({"public_slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    # Filter to status updates + system messages only (hide internal tech chat)
    safe_messages = [m for m in (doc.get("messages") or []) if m.get("kind") in ("status", "system")]
    return {
        "title": doc.get("title"),
        "severity": doc.get("severity"),
        "status": doc.get("status"),
        "summary": doc.get("summary"),
        "eta": doc.get("eta"),
        "client_name": doc.get("client_name"),
        "created_at": doc.get("created_at"),
        "resolved_at": doc.get("resolved_at"),
        "resolved_notes": doc.get("resolved_notes"),
        "timeline": safe_messages,
    }


# ─────────────────────────── ESCALATION LADDER (Paging) ───────────────────────────
# Paging fires across Slack/Teams/SMS/Email/push with a magic-link ack token.
# Each page starts 'pending' → 'sent' when dispatched → 'ack' when the tech responds
# → 'escalated' if no ack within the tier's grace period.

PAGING_TIER_GRACE_MINUTES = 5  # default time to wait for ack before escalating


async def _public_base_url() -> str:
    """Best-effort resolve a public URL for magic ack links."""
    return os.environ.get("PUBLIC_APP_URL") or os.environ.get("REACT_APP_BACKEND_URL") or ""


async def _dispatch_page(wr: dict, page: dict, tech: dict) -> dict:
    """Fire across configured channels. Returns channel-level results.
    Gracefully stubs channels that are not configured so paging never blocks.
    """
    base = await _public_base_url()
    ack_url = f"{base.rstrip('/')}/api/warroom/page/ack/{page['ack_token']}" if base else f"/api/warroom/page/ack/{page['ack_token']}"
    public_url = f"{base.rstrip('/')}/warroom/public/{wr.get('public_slug','')}" if base else f"/warroom/public/{wr.get('public_slug','')}"
    body = (
        f"🚨 WAR ROOM PAGE · {wr.get('severity','P1')} · {wr.get('title','')}\n"
        f"Client: {wr.get('client_name') or '—'}\n"
        f"Status: {wr.get('status')}\n"
        f"Public status: {public_url}\n"
        f"👉 Ack (I'm on it): {ack_url}"
    )
    results = {}

    channels = page.get("channels") or tech.get("preferred_channels") or ["email"]

    # Slack — use an MSP-level webhook from settings (shared)
    if "slack" in channels:
        try:
            setting = await db.settings.find_one({"key": "notifications_slack"}, {"_id": 0}) or {}
            webhook = (setting.get("value") or {}).get("webhook_url")
            if webhook:
                async with httpx.AsyncClient(timeout=6.0) as c:
                    await c.post(webhook, json={"text": f"<@{tech.get('slack_handle','')}> {body}"})
                results["slack"] = "sent"
            else:
                results["slack"] = "no_webhook"
        except Exception as e:
            results["slack"] = f"err:{str(e)[:80]}"

    # Teams — incoming webhook
    if "teams" in channels:
        try:
            setting = await db.settings.find_one({"key": "notifications_teams"}, {"_id": 0}) or {}
            webhook = (setting.get("value") or {}).get("webhook_url")
            if webhook:
                async with httpx.AsyncClient(timeout=6.0) as c:
                    await c.post(webhook, json={"text": body})
                results["teams"] = "sent"
            else:
                results["teams"] = "no_webhook"
        except Exception as e:
            results["teams"] = f"err:{str(e)[:80]}"

    # SMS — MobileMessage, if configured
    if "sms" in channels and tech.get("mobile"):
        try:
            setting = await db.settings.find_one({"key": "mobilemessage"}, {"_id": 0}) or {}
            v = setting.get("value") or {}
            if v.get("username") and v.get("password"):
                async with httpx.AsyncClient(timeout=6.0) as c:
                    await c.post(
                        "https://api.mobilemessage.com.au/v1/messages",
                        auth=(v["username"], v["password"]),
                        json={"messages": [{"to": tech["mobile"], "message": body[:450], "sender": v.get("sender") or "NexusOps"}]},
                    )
                results["sms"] = "sent"
            else:
                results["sms"] = "no_config"
        except Exception as e:
            results["sms"] = f"err:{str(e)[:80]}"

    # Email — record a notification; email router handles transport elsewhere
    if "email" in channels and tech.get("email"):
        try:
            await db.notifications.insert_one({
                "id": f"nf-{uuid.uuid4().hex[:10]}",
                "kind": "warroom_page",
                "to_email": tech["email"],
                "to_name": tech.get("name"),
                "subject": f"[PAGE] {wr.get('severity','P1')} · {wr.get('title','')}",
                "body": body,
                "war_room_id": wr.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "queued",
            })
            results["email"] = "queued"
        except Exception as e:
            results["email"] = f"err:{str(e)[:80]}"

    # Push — in-app notification for the tech user account if one exists by email
    if "push" in channels:
        try:
            user = None
            if tech.get("email"):
                user = await db.users.find_one({"email": tech["email"]}, {"_id": 0, "id": 1})
            if user:
                await db.notifications.insert_one({
                    "id": f"nf-{uuid.uuid4().hex[:10]}",
                    "kind": "warroom_page_push",
                    "user_id": user["id"],
                    "war_room_id": wr.get("id"),
                    "title": f"🚨 PAGE · {wr.get('title','')}",
                    "body": body[:280],
                    "ack_url": ack_url,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "read": False,
                })
                results["push"] = "sent"
            else:
                results["push"] = "no_user"
        except Exception as e:
            results["push"] = f"err:{str(e)[:80]}"

    return results


@router.post("/warroom/{wr_id}/page")
async def page_techs(wr_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: { tech_ids: [], channels?: ['slack','sms',...], auto_escalate?: bool,
                grace_minutes?: 5 }

    If `auto_escalate=True`, only Tier-1 techs are paged now; a `next_escalation_at`
    timestamp is set so the background scheduler rolls to Tier 2 → Tier 3 on no-ack.
    Otherwise every provided tech gets paged immediately.
    """
    wr = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0})
    if not wr:
        raise HTTPException(404, "War room not found")

    tech_ids = data.get("tech_ids") or []
    channels = data.get("channels") or None
    auto_escalate = bool(data.get("auto_escalate"))
    grace = int(data.get("grace_minutes") or PAGING_TIER_GRACE_MINUTES)

    if not tech_ids and not auto_escalate:
        raise HTTPException(400, "tech_ids required (or set auto_escalate=true)")

    techs = await db.tech_roster.find({"id": {"$in": tech_ids}} if tech_ids else {"active": True}, {"_id": 0}).to_list(200)
    if not techs:
        raise HTTPException(400, "No matching technicians")

    # Auto-escalate: start with Tier-1 only (page all supplied techs at tier 1)
    tier1_ids = set()
    if auto_escalate:
        tier1 = [t for t in techs if int(t.get("escalation_tier", 2)) == 1]
        if not tier1:
            # No tier-1 in roster — fall back to lowest tier present
            min_tier = min(int(t.get("escalation_tier", 2)) for t in techs)
            tier1 = [t for t in techs if int(t.get("escalation_tier", 2)) == min_tier]
        tier1_ids = {t["id"] for t in tier1}

    new_pages = []
    now = datetime.now(timezone.utc)
    for tech in techs:
        should_send_now = (tech["id"] in tier1_ids) if auto_escalate else True
        page = {
            "id": f"pg-{uuid.uuid4().hex[:10]}",
            "tech_id": tech["id"],
            "name": tech.get("name"),
            "tier": int(tech.get("escalation_tier", 2)),
            "channels": channels or tech.get("preferred_channels") or ["email"],
            "status": "pending" if not should_send_now else "sent",
            "ack_token": secrets.token_urlsafe(16),
            "sent_at": now.isoformat() if should_send_now else None,
            "ack_at": None,
            "ack_by_name": None,
            "dispatch_results": None,
        }
        if should_send_now:
            try:
                page["dispatch_results"] = await _dispatch_page(wr, page, tech)
            except Exception as e:
                page["dispatch_results"] = {"error": str(e)[:120]}
        new_pages.append(page)

    next_escalate = (now + timedelta(minutes=grace)).isoformat() if auto_escalate else None

    await db.war_rooms.update_one(
        {"id": wr_id},
        {
            "$push": {
                "pages": {"$each": new_pages},
                "messages": _sys_msg(
                    f"{current_user.get('name')} paged {len(new_pages)} tech(s) "
                    f"({'auto-escalating' if auto_escalate else 'direct blast'})"
                ),
            },
            "$set": {
                "auto_escalate": auto_escalate,
                "next_escalation_at": next_escalate,
                "escalation_tier": 1 if auto_escalate else None,
                "grace_minutes": grace,
            },
        },
    )
    doc = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0})
    return {"success": True, "war_room": doc}


@router.get("/warroom/page/ack/{token}")
async def ack_page(token: str):
    """Magic-link acknowledge — no auth required. Clicked from SMS/email/slack."""
    wr = await db.war_rooms.find_one({"pages.ack_token": token}, {"_id": 0})
    if not wr:
        raise HTTPException(404, "Invalid or expired ack link")

    page = next((p for p in (wr.get("pages") or []) if p.get("ack_token") == token), None)
    if not page:
        raise HTTPException(404, "Page not found")
    if page.get("status") == "ack":
        return _ack_html(wr, page, already=True)

    now = datetime.now(timezone.utc).isoformat()
    await db.war_rooms.update_one(
        {"id": wr["id"], "pages.ack_token": token},
        {
            "$set": {
                "pages.$.status": "ack",
                "pages.$.ack_at": now,
                "pages.$.ack_by_name": page.get("name"),
                "next_escalation_at": None,  # someone ack'd; stop escalating
            },
            "$push": {
                "messages": _sys_msg(f"✅ {page.get('name')} acknowledged the page"),
                "participants": {"name": page.get("name") or "on-call", "joined_at": now},
            },
        },
    )
    return _ack_html(wr, page, already=False)


def _ack_html(wr: dict, page: dict, already: bool):
    """Plain-HTML response so techs clicking from SMS/email land on a friendly confirmation."""
    from fastapi.responses import HTMLResponse
    title = wr.get("title", "")
    name = page.get("name", "")
    already_line = "<p style='color:#f59e0b'>This page was already acknowledged.</p>" if already else ""
    body = f"""
    <html><body style="font-family:system-ui,-apple-system,sans-serif;background:#09090b;color:#e4e4e7;
    padding:48px;max-width:640px;margin:0 auto;text-align:center">
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <h1 style="font-weight:300;margin:0 0 8px">Thanks, {name}.</h1>
      <p style="color:#a1a1aa">You're marked as on it for this incident:</p>
      <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:16px;
      margin:20px 0;text-align:left">
        <div style="font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px">
          {wr.get('severity','P1')} · {wr.get('status','investigating')}
        </div>
        <div style="font-size:18px;font-weight:500">{title}</div>
        <div style="color:#a1a1aa;font-size:13px;margin-top:4px">{wr.get('client_name') or ''}</div>
      </div>
      {already_line}
      <p style="font-size:12px;color:#71717a">You can close this window. The war room has been notified.</p>
    </body></html>
    """
    return HTMLResponse(body)


@router.post("/warroom/{wr_id}/page/{page_id}/resend")
async def resend_page(wr_id: str, page_id: str, current_user: dict = Depends(get_current_user)):
    wr = await db.war_rooms.find_one({"id": wr_id}, {"_id": 0})
    if not wr:
        raise HTTPException(404, "Not found")
    page = next((p for p in (wr.get("pages") or []) if p.get("id") == page_id), None)
    if not page:
        raise HTTPException(404, "Page not found")
    tech = await db.tech_roster.find_one({"id": page["tech_id"]}, {"_id": 0})
    if not tech:
        raise HTTPException(404, "Tech not in roster anymore")
    results = await _dispatch_page(wr, page, tech)
    now = datetime.now(timezone.utc).isoformat()
    await db.war_rooms.update_one(
        {"id": wr_id, "pages.id": page_id},
        {"$set": {"pages.$.status": "sent", "pages.$.sent_at": now, "pages.$.dispatch_results": results}},
    )
    return {"success": True, "dispatch_results": results}


async def warroom_escalation_tick():
    """Background task — call from server startup loop.
    Walks active war rooms with auto_escalate=True and whose next_escalation_at has passed.
    Promotes pending pages one tier at a time (1→2→3) until acked or all sent.
    """
    now = datetime.now(timezone.utc)
    cursor = db.war_rooms.find({
        "status": {"$ne": "resolved"},
        "auto_escalate": True,
        "next_escalation_at": {"$lte": now.isoformat()},
    }, {"_id": 0})
    rooms = await cursor.to_list(50)
    for wr in rooms:
        # Skip if any tech already ack'd
        if any(p.get("status") == "ack" for p in (wr.get("pages") or [])):
            await db.war_rooms.update_one({"id": wr["id"]}, {"$set": {"next_escalation_at": None}})
            continue

        cur_tier = int(wr.get("escalation_tier") or 1)
        next_tier = cur_tier + 1
        if next_tier > 3:
            await db.war_rooms.update_one({"id": wr["id"]}, {"$set": {"next_escalation_at": None}})
            continue

        promoted = 0
        for page in (wr.get("pages") or []):
            if page.get("status") == "pending" and int(page.get("tier", 2)) == next_tier:
                tech = await db.tech_roster.find_one({"id": page["tech_id"]}, {"_id": 0})
                if not tech:
                    continue
                try:
                    results = await _dispatch_page(wr, page, tech)
                except Exception as e:
                    results = {"error": str(e)[:120]}
                await db.war_rooms.update_one(
                    {"id": wr["id"], "pages.id": page["id"]},
                    {"$set": {
                        "pages.$.status": "sent",
                        "pages.$.sent_at": now.isoformat(),
                        "pages.$.dispatch_results": results,
                    }},
                )
                promoted += 1

        grace = int(wr.get("grace_minutes") or PAGING_TIER_GRACE_MINUTES)
        new_next = (now + timedelta(minutes=grace)).isoformat() if next_tier < 3 else None
        await db.war_rooms.update_one(
            {"id": wr["id"]},
            {
                "$set": {"escalation_tier": next_tier, "next_escalation_at": new_next},
                "$push": {"messages": _sys_msg(f"⏫ Auto-escalated to Tier {next_tier} ({promoted} tech(s) paged)")},
            },
        )
