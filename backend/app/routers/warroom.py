"""Live Incident War Room.

When a P1 fires, one URL becomes a shared battle-station with:
  • Affected client + devices
  • Past similar incidents (string-matched; future: vector search)
  • Live tech chat (polling-based)
  • Running ETA + status
  • A public-facing slug the client can bookmark (no auth required)

Data model: db.war_rooms
  {
    id, public_slug, title, severity, status, summary, eta,
    ticket_id, client_id, client_name, affected_device_ids,
    participants: [{name, joined_at}],
    messages: [{id, author, kind:'chat'|'status'|'system', body, ts}],
    similar_incidents: [{ticket_id, title, resolution, resolved_at}],
    created_by, created_at, resolved_at, resolved_notes
  }
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
import uuid
import secrets
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
