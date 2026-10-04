"""Tech delight layer: hidden badges, pet evolution, streaks, seasons and fun.

Everything here is either derived from authoritative operational records
(tickets, points ledger, checklist runs) or stored in a small auditable state
blob on the user document (``users.fun_state``).  Event-earned hidden badges
reuse the existing ``user_achievements`` award store, so badge evidence stays
in one place and flows through the merged profile badges automatically.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.tech_rewards import award_points

# ============== HIDDEN ("GLITCHED") BADGES ==============
# Locked versions render masked ("???") on the profile until earned.

HIDDEN_BADGES = [
    {"key": "glitch_sudo", "title": "Privilege Escalator", "icon": "🐧", "rarity": "rare",
     "description": "Typed `sudo` into the command palette. Bold move."},
    {"key": "glitch_graveyard", "title": "Graveyard Shift", "icon": "🌙", "rarity": "rare",
     "description": "Closed a ticket between 03:00 and 03:59."},
    {"key": "glitch_the_answer", "title": "The Answer", "icon": "🎲", "rarity": "epic",
     "description": "Left a resolution note of exactly 42 characters."},
    {"key": "glitch_friday13", "title": "Triskaidekaphile", "icon": "🐈‍⬛", "rarity": "rare",
     "description": "Visited the team profile on Friday the 13th."},
    {"key": "glitch_lucky", "title": "Lucky Packet", "icon": "🍀", "rarity": "legendary",
     "description": "Hit the lucky coin jackpot."},
]

# Derived (non-hidden) delight badges recomputed from ticket history.
DERIVED_BADGES = [
    {"key": "perfect_week", "title": "Perfect Week", "icon": "🗓️", "rarity": "epic",
     "description": "Closed tickets on 7 consecutive days."},
]

# Easter-egg keys a client can ping -> hidden badge awarded (None = toast only).
EVENT_EGG_KEYS: dict[str, str | None] = {
    "sudo": "glitch_sudo",
    "friday_13": "glitch_friday13",
    "april_fools": None,
}

HIDDEN_BADGE_TITLES = {badge["key"]: badge["title"] for badge in [*HIDDEN_BADGES, *DERIVED_BADGES]}
HIDDEN_KEYS = {badge["key"] for badge in HIDDEN_BADGES}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _ticket_owner_query(user_id: str, name: str) -> dict:
    return {
        "$or": [{"assigned_to": user_id}, {"assigned_name": name}],
        "status": {"$in": ["resolved", "closed"]},
    }


# ============== HIDDEN BADGE EVIDENCE ==============

async def derived_badge_keys(db: Any, user_id: str, name: str) -> set[str]:
    """Hidden/derived badge keys earned from authoritative ticket history."""
    keys: set[str] = set()
    rows = await db.tickets.find(
        _ticket_owner_query(user_id, name),
        {"_id": 0, "resolved_at": 1, "resolution_notes": 1},
    ).limit(1000).to_list(1000)

    days: set[str] = set()
    for row in rows:
        resolved = _parse_iso(row.get("resolved_at"))
        if resolved:
            if 3 <= resolved.hour < 4:
                keys.add("glitch_graveyard")
            days.add(resolved.date().isoformat())
        if len(str(row.get("resolution_notes") or "").strip()) == 42:
            keys.add("glitch_the_answer")

    # Perfect Week: a closed ticket on each of the last 7 calendar days.
    today = _utcnow().date()
    if all((today - timedelta(days=offset)).isoformat() in days for offset in range(7)):
        keys.add("perfect_week")
    return keys


async def award_hidden_badge(db: Any, user: dict, key: str) -> dict:
    """Idempotently award an event-earned hidden badge through the award store."""
    existing = await db.user_achievements.find_one(
        {"user_id": user["id"], "achievement_id": key}, {"_id": 0}
    )
    if existing:
        return {"awarded": False, "achievement_id": key, "reason": "already_owned"}
    await db.user_achievements.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_name": user.get("name"),
        "achievement_id": key,
        "achievement_name": HIDDEN_BADGE_TITLES.get(key, key),
        "awarded_by": "System",
        "awarded_at": _iso(_utcnow()),
        "note": "Hidden badge",
    })
    return {"awarded": True, "achievement_id": key}


# ============== PET EVOLUTION ==============

PET_EVOLUTION_STAGES = [
    (0, 1, "Stage I"),
    (2_000, 2, "Stage II · Grown"),
    (10_000, 3, "Stage III · Veteran"),
    (25_000, 4, "Stage IV · Legend"),
]


def pet_evolution(lifetime_points: int) -> dict:
    """Stage of a companion pet derived from lifetime points."""
    lifetime_points = max(0, int(lifetime_points or 0))
    stage, label, next_at = 1, "Stage I", None
    for index, (threshold, rank, name) in enumerate(PET_EVOLUTION_STAGES):
        if lifetime_points >= threshold:
            stage, label = rank, name
            next_at = PET_EVOLUTION_STAGES[index + 1][0] if index + 1 < len(PET_EVOLUTION_STAGES) else None
    return {"stage": stage, "label": label, "next_at": next_at, "lifetime_points": lifetime_points}


# ============== FUN STATE (users.fun_state) ==============

async def fun_state(db: Any, user_id: str) -> dict:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "fun_state": 1}) or {}
    state = user.get("fun_state") or {}
    return state if isinstance(state, dict) else {}


async def update_fun_state(db: Any, user_id: str, updates: dict) -> None:
    await db.users.update_one({"id": user_id}, {"$set": {f"fun_state.{key}": value for key, value in updates.items()}})


# ============== LUCKY COIN ==============

async def lucky_coin(db: Any, user: dict, tenant_id: str) -> dict:
    """One small points drop per day, with a rare jackpot."""
    state = await fun_state(db, user["id"])
    today = _utcnow().date().isoformat()
    if state.get("coin_last") == today:
        return {"available": False, "message": "The coin needs to recharge. Come back tomorrow."}
    jackpot = secrets.randbelow(100) == 0
    amount = 25 if jackpot else 1 + secrets.randbelow(5)
    entry = await award_points(
        db,
        user_id=user["id"],
        tenant_id=tenant_id,
        delta=amount,
        kind="earn",
        reason="lucky coin jackpot" if jackpot else "lucky coin",
        actor={"id": "system", "name": "Lucky Coin"},
    )
    await update_fun_state(db, user["id"], {"coin_last": today})
    result = {"available": True, "amount": amount, "jackpot": jackpot, "balance_after": entry["balance_after"]}
    if jackpot:
        result.update(await award_hidden_badge(db, user, "glitch_lucky"))
    return result


# ============== WHEEL OF TICKETS ==============

async def wheel_spin(db: Any, user: dict, tenant_id: str) -> dict:
    """Assign the oldest unassigned in-scope open ticket to the caller."""
    from app.services.scope_permissions import tenant_scoped_query

    query = tenant_scoped_query(user, {
        "$or": [{"assigned_to": None}, {"assigned_to": ""}, {"assigned_to": {"$exists": False}}],
        "status": {"$nin": ["resolved", "closed"]},
    })
    rows = await db.tickets.find(query, {"_id": 0}).sort("created_at", 1).limit(1).to_list(1)
    if not rows:
        return {"ticket": None, "message": "The queue is clear — nothing to spin for."}
    ticket = rows[0]
    now = _iso(_utcnow())
    await db.tickets.update_one(
        {"id": ticket["id"]},
        {"$set": {"assigned_to": user["id"], "assigned_name": user.get("name") or "", "updated_at": now}},
    )
    state = await fun_state(db, user["id"])
    last = _parse_iso(state.get("wheel_last"))
    streak = int(state.get("wheel_streak") or 0) + 1 if last and (_utcnow() - last) < timedelta(hours=24) else 1
    updates = {"wheel_streak": streak, "wheel_last": now}
    bonus = None
    if streak % 5 == 0:
        entry = await award_points(
            db, user_id=user["id"], tenant_id=tenant_id, delta=5, kind="earn",
            reason=f"wheel streak {streak}", actor={"id": "system", "name": "Wheel of Tickets"},
        )
        bonus = entry["balance_after"]
    await update_fun_state(db, user["id"], updates)
    return {
        "ticket": {
            "id": ticket.get("id"), "ticket_number": ticket.get("ticket_number"),
            "title": ticket.get("title"), "client_name": ticket.get("client_name"),
            "priority": ticket.get("priority"), "created_at": ticket.get("created_at"),
        },
        "wheel_streak": streak,
        "streak_bonus_points": 5 if bonus is not None else 0,
        "balance_after": bonus,
        "message": f"Ticket #{ticket.get('ticket_number')} is yours. Streak: {streak}.",
    }


# ============== FOCUS MODE ==============

async def set_focus(db: Any, user: dict, minutes: int) -> dict:
    minutes = max(5, min(int(minutes or 60), 480))
    until = _utcnow() + timedelta(minutes=minutes)
    await update_fun_state(db, user["id"], {"focus_until": _iso(until), "focus_started": _iso(_utcnow())})
    return {"active": True, "focus_until": _iso(until), "minutes": minutes}


async def end_focus(db: Any, user: dict, tenant_id: str) -> dict:
    state = await fun_state(db, user["id"])
    started = _parse_iso(state.get("focus_started"))
    elapsed = (_utcnow() - started).total_seconds() / 60 if started else 0.0
    await update_fun_state(db, user["id"], {"focus_until": None, "focus_started": None})
    result = {"active": False, "elapsed_minutes": round(elapsed, 1), "deep_work_points": 0}
    if elapsed >= 25 and state.get("focus_reward_day") != _utcnow().date().isoformat():
        entry = await award_points(
            db, user_id=user["id"], tenant_id=tenant_id, delta=5, kind="earn",
            reason="deep work session", actor={"id": "system", "name": "Focus Mode"},
        )
        await update_fun_state(db, user["id"], {"focus_reward_day": _utcnow().date().isoformat()})
        result["deep_work_points"] = 5
        result["balance_after"] = entry["balance_after"]
    return result


# ============== ACTIVITY STREAK ==============

async def activity_streak(db: Any, user_id: str, name: str) -> dict:
    """Consecutive days (ending today or yesterday) with a ticket or points event."""
    days: set[str] = set()
    tickets = await db.tickets.find(
        _ticket_owner_query(user_id, name), {"_id": 0, "resolved_at": 1}
    ).limit(2000).to_list(2000)
    for row in tickets:
        resolved = _parse_iso(row.get("resolved_at"))
        if resolved:
            days.add(resolved.date().isoformat())
    ledger = await db.tech_points_ledger.find({"user_id": user_id}, {"_id": 0, "created_at": 1}).limit(1000).to_list(1000)
    for row in ledger:
        created = _parse_iso(row.get("created_at"))
        if created:
            days.add(created.date().isoformat())

    today = _utcnow().date()
    start = today if today.isoformat() in days else today - timedelta(days=1)
    streak = 0
    cursor = start
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)
    return {"days": streak, "perfect_week": streak >= 7, "active_days": len(days)}


# ============== SEASONS & HALL OF FAME ==============

async def season_standings(db: Any, tenant_id: str, *, months: int = 6) -> dict:
    """Monthly points standings derived from the append-only ledger."""
    async def standings_for(month_key: str) -> list[dict]:
        rows = await db.tech_points_ledger.find(
            {"tenant_id": tenant_id, "delta": {"$gt": 0}, "created_at": {"$regex": f"^{month_key}"}},
            {"_id": 0, "user_id": 1, "delta": 1},
        ).limit(5000).to_list(5000)
        totals: dict[str, int] = {}
        for row in rows:
            totals[row["user_id"]] = totals.get(row["user_id"], 0) + int(row.get("delta") or 0)
        ordered = sorted(totals.items(), key=lambda item: item[1], reverse=True)[:10]
        names: dict[str, str] = {}
        if ordered:
            users = await db.users.find({"id": {"$in": [uid for uid, _ in ordered]}}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
            names = {u["id"]: u.get("name") or u["id"] for u in users}
        return [{"user_id": uid, "name": names.get(uid, uid), "points": points} for uid, points in ordered]

    now = _utcnow()
    current_key = now.strftime("%Y-%m")
    current = await standings_for(current_key)
    hall = []
    for offset in range(1, max(1, months)):
        month = (now.replace(day=1) - timedelta(days=30 * offset)).strftime("%Y-%m")
        ranked = await standings_for(month)
        if ranked:
            hall.append({"month": month, "winner": ranked[0]})
    return {"season": current_key, "standings": current, "hall_of_fame": hall}


# ============== WIN WALL ==============

async def win_wall(db: Any, user: dict, *, limit: int = 12) -> list[dict]:
    """Recent closed tickets celebrated as wins (criticals and fast saves first)."""
    from app.services.scope_permissions import tenant_scoped_query

    rows = await db.tickets.find(
        tenant_scoped_query(user, {"status": {"$in": ["resolved", "closed"]}}),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "priority": 1,
         "assigned_name": 1, "created_at": 1, "resolved_at": 1},
    ).sort("resolved_at", -1).limit(limit).to_list(limit)
    wins = []
    for row in rows:
        created = _parse_iso(row.get("created_at"))
        resolved = _parse_iso(row.get("resolved_at"))
        fast = bool(created and resolved and (resolved - created) < timedelta(hours=4))
        priority = str(row.get("priority") or "").lower()
        kind = "critical" if priority == "critical" else ("sla" if fast else "close")
        wins.append({**row, "kind": kind})
    return wins


# ============== NETWORK WEATHER ==============

async def network_weather(db: Any, user: dict) -> dict:
    """Per-client weather derived from live device status and last-seen telemetry."""
    from app.services.scope_permissions import tenant_scoped_query

    rows = await db.devices.find(
        tenant_scoped_query(user, {}), {"_id": 0, "client_name": 1, "status": 1, "last_seen": 1}
    ).limit(500).to_list(500)
    now = _utcnow()
    groups: dict[str, dict] = {}
    for row in rows:
        name = str(row.get("client_name") or "Unassigned")
        group = groups.setdefault(name, {"client_name": name, "devices": 0, "offline": 0, "stale": 0})
        group["devices"] += 1
        status = str(row.get("status") or "").lower()
        last_seen = _parse_iso(row.get("last_seen"))
        if status in {"offline", "down", "disconnected"}:
            group["offline"] += 1
        if not last_seen or (now - last_seen) > timedelta(hours=24):
            group["stale"] += 1
    for group in groups.values():
        total = max(1, group["devices"])
        if group["offline"] / total > 0.2:
            group["weather"] = "stormy"
        elif group["stale"] / total > 0.2:
            group["weather"] = "foggy"
        elif group["offline"] or group["stale"]:
            group["weather"] = "cloudy"
        else:
            group["weather"] = "sunny"
    return {"clients": sorted(groups.values(), key=lambda g: (g["weather"] != "sunny", g["client_name"]))}


# ============== CHECKLIST SPEEDRUNS ==============

async def speedruns(db: Any, user: dict, template_id: str) -> dict:
    """Fastest completed onboarding-checklist runs for a template."""
    rows = await db.onboarding_checklist_runs.find(
        {"template_id": template_id, "status": "completed"},
        {"_id": 0, "id": 1, "technician_id": 1, "technician_name": 1,
         "started_at": 1, "completed_at": 1, "created_at": 1, "updated_at": 1},
    ).limit(200).to_list(200)
    scored = []
    for row in rows:
        started = _parse_iso(row.get("started_at") or row.get("created_at"))
        completed = _parse_iso(row.get("completed_at") or row.get("updated_at"))
        if not started or not completed or completed <= started:
            continue
        scored.append({
            "run_id": row.get("id"),
            "technician_id": row.get("technician_id"),
            "technician_name": row.get("technician_name") or row.get("technician_id"),
            "seconds": int((completed - started).total_seconds()),
            "completed_at": row.get("completed_at") or row.get("updated_at"),
        })
    scored.sort(key=lambda row: row["seconds"])
    personal = [row for row in scored if row.get("technician_id") == user.get("id")]
    return {
        "template_id": template_id,
        "leaderboard": scored[:5],
        "personal_best": personal[0] if personal else None,
        "runs_timed": len(scored),
    }
