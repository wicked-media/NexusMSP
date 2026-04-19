"""
Coffee Break Mode — a technician-facing SLA pause with auto-resume.
While active: tech's assigned tickets' SLA timers pause; dashboard shows a cute banner.
Used for lunches, meetings, deep-work sprints, or actual coffee.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()

VALID_REASONS = {"coffee", "lunch", "meeting", "focus", "break", "eod", "other"}


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat() if dt else None


@router.get("/coffee-break/status")
async def my_status(current_user: dict = Depends(get_current_user)):
    """Return the logged-in tech's current coffee-break state."""
    uid = current_user.get("id", "")
    doc = await db.coffee_breaks.find_one(
        {"user_id": uid, "active": True}, {"_id": 0}
    )
    if not doc:
        return {"active": False}
    ends_at = doc.get("ends_at")
    remaining_sec = 0
    if ends_at:
        try:
            remaining_sec = max(0, int((datetime.fromisoformat(ends_at) - _now()).total_seconds()))
        except Exception:
            remaining_sec = 0
    # Auto-expire if ended
    if ends_at and remaining_sec == 0:
        await db.coffee_breaks.update_one(
            {"id": doc["id"]},
            {"$set": {"active": False, "ended_at": _iso(_now()), "ended_reason": "auto_expired"}},
        )
        return {"active": False, "just_ended": True}

    return {
        "active": True,
        "id": doc.get("id"),
        "reason": doc.get("reason"),
        "duration_minutes": doc.get("duration_minutes"),
        "started_at": doc.get("started_at"),
        "ends_at": ends_at,
        "remaining_seconds": remaining_sec,
    }


@router.post("/coffee-break/start")
async def start_break(data: dict, current_user: dict = Depends(get_current_user)):
    """
    body: { "duration_minutes": 15, "reason": "coffee|lunch|meeting|focus|break|other" }
    """
    uid = current_user.get("id", "")
    duration = int((data or {}).get("duration_minutes", 15))
    if duration < 1 or duration > 240:
        raise HTTPException(400, "duration_minutes must be between 1 and 240")
    reason = (data or {}).get("reason", "coffee")
    if reason not in VALID_REASONS:
        reason = "break"

    # End any existing active break first
    await db.coffee_breaks.update_many(
        {"user_id": uid, "active": True},
        {"$set": {"active": False, "ended_at": _iso(_now()), "ended_reason": "superseded"}},
    )

    now = _now()
    ends = now + timedelta(minutes=duration)
    rec = {
        "id": f"cb-{uuid.uuid4().hex[:8]}",
        "user_id": uid,
        "user_name": current_user.get("name"),
        "reason": reason,
        "duration_minutes": duration,
        "started_at": _iso(now),
        "ends_at": _iso(ends),
        "active": True,
        "sla_paused": True,
    }
    await db.coffee_breaks.insert_one(rec)

    # Stamp all currently-assigned open tickets with sla_paused flag
    result = await db.tickets.update_many(
        {"assigned_to": uid, "status": {"$in": ["open", "in_progress"]}},
        {"$set": {"sla_paused": True, "sla_pause_reason": reason, "sla_paused_at": _iso(now)}},
    )
    rec["paused_tickets"] = result.modified_count
    rec.pop("_id", None)
    return rec


@router.post("/coffee-break/end")
async def end_break(current_user: dict = Depends(get_current_user)):
    """Manually end the current active break."""
    uid = current_user.get("id", "")
    doc = await db.coffee_breaks.find_one({"user_id": uid, "active": True}, {"_id": 0})
    if not doc:
        return {"active": False, "note": "no active break"}

    now = _now()
    await db.coffee_breaks.update_one(
        {"id": doc["id"]},
        {"$set": {"active": False, "ended_at": _iso(now), "ended_reason": "manual"}},
    )
    # Unpause their tickets
    await db.tickets.update_many(
        {"assigned_to": uid, "sla_paused": True},
        {"$set": {"sla_paused": False, "sla_resumed_at": _iso(now)}, "$unset": {"sla_pause_reason": ""}},
    )
    return {"active": False, "ended_at": _iso(now)}


@router.get("/coffee-break/active-users")
async def active_users(current_user: dict = Depends(get_current_user)):
    """Team status board — who's currently on a break (for leaderboard / scheduler view)."""
    now = _now()
    actives = await db.coffee_breaks.find({"active": True}, {"_id": 0}).to_list(100)
    out = []
    for a in actives:
        ends_at = a.get("ends_at")
        remaining = 0
        if ends_at:
            try:
                remaining = max(0, int((datetime.fromisoformat(ends_at) - now).total_seconds()))
            except Exception:
                pass
        # Auto-expire expired ones on the fly
        if ends_at and remaining == 0:
            await db.coffee_breaks.update_one(
                {"id": a["id"]},
                {"$set": {"active": False, "ended_at": _iso(now), "ended_reason": "auto_expired"}},
            )
            continue
        out.append({
            "user_id": a.get("user_id"),
            "user_name": a.get("user_name"),
            "reason": a.get("reason"),
            "started_at": a.get("started_at"),
            "ends_at": ends_at,
            "remaining_seconds": remaining,
        })
    return out


@router.get("/coffee-break/history")
async def history(limit: int = 20, current_user: dict = Depends(get_current_user)):
    uid = current_user.get("id", "")
    rows = await db.coffee_breaks.find({"user_id": uid}, {"_id": 0}).sort("started_at", -1).to_list(max(1, min(100, limit)))
    return rows
