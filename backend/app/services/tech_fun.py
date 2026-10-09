"""Tech delight layer: hidden badges, pet evolution, streaks, seasons and fun.

Everything here is either derived from authoritative operational records
(tickets, points ledger, checklist runs) or stored in a small auditable state
blob on the user document (``users.fun_state``).  Event-earned hidden badges
reuse the existing ``user_achievements`` award store, so badge evidence stays
in one place and flows through the merged profile badges automatically.
"""

from __future__ import annotations

import re
import secrets
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.qol_tools import dns_verdict
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
    {"key": "glitch_firewall", "title": "Actually, It Was The Firewall", "icon": "🧱", "rarity": "legendary",
     "description": "Said the words 'it was the firewall'. You were right."},
    {"key": "uptime_unicorn", "title": "Uptime Unicorn", "icon": "🦄", "rarity": "legendary",
     "description": "Met a machine running for a full year without an unexpected outage."},
]

# Derived (non-hidden) delight badges recomputed from ticket history.
DERIVED_BADGES = [
    {"key": "perfect_week", "title": "Perfect Week", "icon": "🗓️", "rarity": "epic",
     "description": "Closed tickets on 7 consecutive days."},
    {"key": "ticket_zero", "title": "Ticket Zero", "icon": "🎯", "rarity": "legendary",
     "description": "Cleared your queue: closed tickets, nothing open."},
    {"key": "printer_whisperer", "title": "The Printer Whisperer", "icon": "🖨️", "rarity": "epic",
     "description": "Resolved 100 printer incidents."},
    {"key": "it_was_dns", "title": "It Was DNS", "icon": "🌐", "rarity": "rare",
     "description": "Of course it was."},
    {"key": "connectivity_veteran", "title": "DNS Wasn't The Problem", "icon": "🔌", "rarity": "epic",
     "description": "Diagnosed 100 connectivity incidents."},
    {"key": "reboot_ritual", "title": "Have You Tried Turning It Off And On Again?", "icon": "🔌", "rarity": "epic",
     "description": "Performed 1,000 successful reboots."},
    {"key": "patch_survivor", "title": "Patch Tuesday Survivor", "icon": "🩹", "rarity": "rare",
     "description": "Closed tickets on Patch Tuesday itself."},
]

# Easter-egg keys a client can ping -> hidden badge awarded (None = toast only).
EVENT_EGG_KEYS: dict[str, str | None] = {
    "sudo": "glitch_sudo",
    "friday_13": "glitch_friday13",
    "april_fools": None,
    "firewall": "glitch_firewall",
    "dns": None,
    "coffee": None,
    "printer_reliability": None,
    "printer": None,
    "microsoft_licensing": None,
    "why": None,
    "rm_rf": None,
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
        {"_id": 0, "resolved_at": 1, "resolution_notes": 1, "title": 1},
    ).limit(1000).to_list(1000)

    days: set[str] = set()
    printer = dns_hits = connectivity = patch_tuesday = 0
    for row in rows:
        title = str(row.get("title") or "").lower()
        notes = str(row.get("resolution_notes") or "").strip()
        resolved = _parse_iso(row.get("resolved_at"))
        if resolved:
            if 3 <= resolved.hour < 4:
                keys.add("glitch_graveyard")
            days.add(resolved.date().isoformat())
            # Patch Tuesday: the second Tuesday of a month.
            if resolved.weekday() == 1 and 8 <= resolved.day <= 14:
                patch_tuesday += 1
        if len(notes) == 42:
            keys.add("glitch_the_answer")
        if "printer" in title or "print" in title.split():
            printer += 1
        if "dns" in title or "dns" in notes.lower():
            dns_hits += 1
        if re.search(r"connectivity|network|internet|vpn|wifi|wi-fi|offline", title):
            connectivity += 1

    if printer >= 100:
        keys.add("printer_whisperer")
    if dns_hits >= 1:
        keys.add("it_was_dns")
    if connectivity >= 100:
        keys.add("connectivity_veteran")
    if patch_tuesday >= 1 or any("patch" in str(r.get("title") or "").lower() for r in rows):
        keys.add("patch_survivor")

    # Ticket Zero: work completed, nothing currently open.
    open_count = await db.tickets.count_documents(
        {"$or": [{"assigned_to": user_id}, {"assigned_name": name}], "status": {"$nin": ["resolved", "closed"]}}
    )
    if rows and open_count == 0:
        keys.add("ticket_zero")

    # Reboot ritual: agent-executed reboots plus reboot-flavoured ticket closes.
    reboots = await db.nexus_agent_commands.count_documents(
        {"$or": [{"action": {"$regex": "reboot|restart"}}, {"command": {"$regex": "reboot|restart", "$options": "i"}}]}
    )
    reboot_tickets = sum(1 for r in rows if re.search(r"reboot|restart", str(r.get("title") or ""), re.IGNORECASE))
    if reboots + reboot_tickets >= 1000:
        keys.add("reboot_ritual")

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


# ============== TICKET BOSS BATTLES ==============

async def boss_battles(db: Any, user: dict, *, min_age_days: int = 30, limit: int = 5) -> list[dict]:
    """Tickets that have been open absurdly long, presented as boss fights."""
    from app.services.scope_permissions import tenant_scoped_query

    cutoff = _iso(_utcnow() - timedelta(days=min_age_days))
    rows = await db.tickets.find(
        tenant_scoped_query(user, {"status": {"$nin": ["resolved", "closed"]}, "created_at": {"$lt": cutoff}}),
        {"_id": 0},
    ).sort("created_at", 1).limit(limit).to_list(limit)
    battles = []
    for row in rows:
        created = _parse_iso(row.get("created_at"))
        age_days = (_utcnow() - created).days if created else 0
        notes = await db.ticket_comments.count_documents({"ticket_id": row.get("id")})
        battles.append({
            "id": row.get("id"),
            "ticket_number": row.get("ticket_number"),
            "title": row.get("title"),
            "client_name": row.get("client_name"),
            "priority": row.get("priority"),
            "open_days": age_days,
            "notes": notes,
            "assigned_name": row.get("assigned_name"),
            "battle_rank": "legendary" if age_days >= 90 else "epic" if age_days >= 60 else "elite",
        })
    return battles


# ============== DEVICE PERSONALITY ==============

async def device_personality(db: Any, user: dict, device_id: str) -> dict:
    """A little generated history for a long-lived machine."""
    from app.services.scope_permissions import tenant_scoped_query

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}
    created = _parse_iso(device.get("purchase_date") or device.get("created_at"))
    age_days = (_utcnow() - created).days if created else None
    incidents = await db.tickets.count_documents(
        {"$or": [{"device_id": device_id}, {"device_hostname": device.get("hostname")}, {"device_name": device.get("hostname")}]}
    )
    reboots = await db.nexus_agent_commands.count_documents(
        {"device_id": device_id, "$or": [{"action": {"$regex": "reboot|restart"}}, {"command": {"$regex": "reboot|restart", "$options": "i"}}]}
    )
    result = {
        "found": True,
        "device_id": device_id,
        "hostname": device.get("hostname") or device.get("name") or device_id,
        "status": device.get("status"),
        "age_days": age_days,
        "incidents_survived": incidents,
        "reboots": reboots,
        "assessment": "",
        "replacement_note": None,
    }
    if age_days is not None and age_days >= 365 and str(device.get("status") or "").lower() not in {"decommissioned", "retired"}:
        # Evidence: this machine has stayed in service for a full year.
        result["unicorn"] = True
    if age_days is not None and age_days >= 7 * 365:
        result["assessment"] = "Please let this machine retire."
        result["replacement_note"] = f"Replacement overdue by roughly {age_days - 3 * 365} days."
    elif age_days is not None and age_days >= 5 * 365:
        result["assessment"] = "A veteran of many incidents. Start the retirement conversation."
    else:
        result["assessment"] = "Still earning its keep."

    # Technician-mode quips: honest observations about genuinely old estate.
    quips = []
    os_name = str(device.get("os") or "") + " " + str(device.get("os_version") or "")
    if "xp" in os_name.lower():
        quips.append("Nexus has contacted a museum.")
    elif "windows 7" in os_name.lower() or "windows server 2008" in os_name.lower():
        quips.append("Archaeological artefact discovered.")
    try:
        uptime_hours = float(device.get("uptime_hours") or 0)
    except (TypeError, ValueError):
        uptime_hours = 0.0
    if uptime_hours >= 2000 * 24:
        quips.append("🦖 Prehistoric Process Detected. This server remembers Internet Explorer.")
    try:
        disk = float(device.get("disk_usage") or 0)
    except (TypeError, ValueError):
        disk = 0.0
    if disk >= 99:
        quips.append("Storage strategy currently consists of hope.")
    if created and created < datetime(2017, 1, 20, tzinfo=timezone.utc):
        quips.append("Firmware released while Obama was President. Perhaps we should discuss this.")
    result["quips"] = quips
    return result


def _ticket_number_value(raw: Any) -> int:
    """Numeric part of a ticket number (real installs use forms like SR-0002)."""
    match = re.search(r"(\d+)", str(raw or ""))
    return int(match.group(1)) if match else 0


# ============== QUEUE CELEBRATIONS ==============

async def celebrations(db: Any, user: dict, name: str) -> dict:
    """Queue status that makes the last close of the day feel earned."""
    open_count = await db.tickets.count_documents(
        {"$or": [{"assigned_to": user.get("id")}, {"assigned_name": name}], "status": {"$nin": ["resolved", "closed"]}}
    )
    closed_count = await db.tickets.count_documents(_ticket_owner_query(str(user.get("id") or ""), name))
    top = await db.tickets.find({}, {"_id": 0, "ticket_number": 1}).sort("ticket_number", -1).limit(1).to_list(1)
    latest = _ticket_number_value(top[0].get("ticket_number")) if top else 0
    next_global = ((latest // 1000) + 1) * 1000
    return {
        "inbox_zero": open_count == 0 and closed_count > 0,
        "open_count": open_count,
        "closed_count": closed_count,
        "latest_ticket_number": latest,
        "next_global_milestone": next_global,
        "milestone_distance": max(0, next_global - latest),
    }


# ============== SHIFT INTELLIGENCE: GO HOME / WEEKEND / CAUGHT UP ==============

async def can_i_go_home(db: Any, user: dict, name: str) -> dict:
    """The end-of-day checklist, answered honestly from live evidence."""
    from app.services.scope_permissions import tenant_scoped_query

    since = _iso(_utcnow() - timedelta(hours=24))
    checks = []

    open_p1 = await db.tickets.count_documents(
        tenant_scoped_query(user, {"priority": "critical", "status": {"$nin": ["resolved", "closed"]}})
    )
    checks.append({"label": "No P1 tickets", "ok": open_p1 == 0, "detail": f"{open_p1} critical ticket(s) still open." if open_p1 else "No critical tickets open."})

    servers = await db.devices.find(
        tenant_scoped_query(user, {"device_type": {"$regex": "server", "$options": "i"}}),
        {"_id": 0, "id": 1, "hostname": 1, "name": 1, "status": 1},
    ).limit(50).to_list(50)
    offline = [s for s in servers if str(s.get("status") or "").lower() not in {"online", "healthy", "ok"}]
    checks.append({"label": "Servers online", "ok": not offline,
                   "detail": ", ".join(str(s.get("hostname") or s.get("name") or s.get("id")) for s in offline[:3]) + (" not reporting." if offline else "All servers reporting.")})

    failed_backups = await db.backup_jobs.count_documents({"status": {"$regex": "fail", "$options": "i"}, "started_at": {"$gte": since}})
    checks.append({"label": "Backups healthy", "ok": failed_backups == 0,
                   "detail": f"{failed_backups} failed backup job(s) in the last 24h." if failed_backups else "No failed backup jobs recorded in the last 24h."})

    active_sessions = await db.remote_sessions.count_documents({"status": {"$in": ["active", "connected", "in_progress"]}})
    checks.append({"label": "No unattended remote sessions", "ok": active_sessions == 0,
                   "detail": f"{active_sessions} session(s) still active." if active_sessions else "No active remote sessions recorded."})

    open_crit_alerts = await db.alerts.count_documents(
        tenant_scoped_query(user, {"severity": {"$regex": "critical", "$options": "i"}, "status": {"$nin": ["resolved", "auto_resolved", "closed"]}})
    )
    checks.append({"label": "No critical alerts burning", "ok": open_crit_alerts == 0,
                   "detail": f"{open_crit_alerts} critical alert(s) unresolved." if open_crit_alerts else "Nothing on fire."})

    blockers = [c for c in checks if not c["ok"]]
    return {
        "go_home": not blockers,
        "verdict": "YES. GO HOME. 🏠" if not blockers else "Not quite.",
        "checks": checks,
        "blockers": [c["label"] for c in blockers],
    }


async def weekend_risk(db: Any, user: dict) -> dict:
    """What could ruin the weekend, derived from live device and job state."""
    from app.services.scope_permissions import tenant_scoped_query

    items = []
    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0}).limit(300).to_list(300)
    soon = _utcnow() + timedelta(days=3)
    for device in devices:
        hostname = str(device.get("hostname") or device.get("name") or device.get("id") or "device")
        try:
            disk = float(device.get("disk_usage") or 0)
        except (TypeError, ValueError):
            disk = 0.0
        if disk >= 90:
            items.append({"kind": "disk", "severity": "high" if disk >= 95 else "medium",
                          "title": f"{hostname} disk: {int(disk)}%",
                          "detail": "Storage strategy currently consists of hope." if disk >= 99 else "Free space before the weekend.",
                          "device_id": device.get("id")})
        warranty = _parse_iso(device.get("warranty_expiry"))
        if warranty and warranty <= soon:
            expired = warranty < _utcnow()
            items.append({"kind": "warranty", "severity": "high" if expired else "medium",
                          "title": f"{hostname} warranty {'expired' if expired else 'expires'} {warranty.date().isoformat()}",
                          "detail": "This machine is out of cover — one failure from an emergency purchase." if expired else "Renew or replace before it becomes an emergency.",
                          "device_id": device.get("id")})
        if str(device.get("status") or "").lower() in {"offline", "down", "disconnected"}:
            items.append({"kind": "offline", "severity": "high", "title": f"{hostname} is offline",
                          "detail": "Confirm this is expected before disappearing.", "device_id": device.get("id")})
        last_patch = _parse_iso(device.get("last_patch_date"))
        if last_patch and (_utcnow() - last_patch) > timedelta(days=60):
            items.append({"kind": "patching", "severity": "low", "title": f"{hostname} unpatched for {(_utcnow() - last_patch).days} days",
                          "detail": "Schedule patching next week.", "device_id": device.get("id")})
    failed_backups = await db.backup_jobs.find(
        {"status": {"$regex": "fail", "$options": "i"}, "started_at": {"$gte": _iso(_utcnow() - timedelta(hours=31))}}, {"_id": 0}
    ).limit(10).to_list(10)
    for job in failed_backups:
        items.append({"kind": "backup", "severity": "high",
                      "title": f"Backup failed: {job.get('client_name') or job.get('job_name') or job.get('id')}",
                      "detail": "No successful run in the last 31 hours.", "client_id": job.get("client_id")})
    order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda item: order.get(item["severity"], 3))
    return {"count": len(items), "items": items,
            "verdict": "Clear enough to disappear. 🍺" if not items else f"{len(items)} thing(s) worth checking before you disappear."}


async def caught_up(db: Any, user: dict, name: str, hours: int = 24) -> dict:
    """What did I miss? — the return-from-absence digest (and Monday damage report)."""
    from app.services.scope_permissions import tenant_scoped_query

    since = _iso(_utcnow() - timedelta(hours=max(1, min(hours, 24 * 14))))
    alerts_total = await db.alerts.count_documents({"created_at": {"$gte": since}})
    alerts_resolved = await db.alerts.count_documents(
        {"created_at": {"$gte": since}, "status": {"$in": ["resolved", "auto_resolved", "closed"]}}
    )
    tickets_updated = await db.tickets.count_documents(
        {"$or": [{"assigned_to": user.get("id")}, {"assigned_name": name}], "updated_at": {"$gte": since}}
    )
    need_rows = await db.tickets.find(
        tenant_scoped_query(user, {"status": {"$nin": ["resolved", "closed"]}, "priority": {"$in": ["critical", "high"]}}),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "client_name": 1},
    ).sort("created_at", 1).limit(6).to_list(6)
    noise = alerts_total - alerts_resolved
    return {
        "window_hours": hours,
        "alerts_total": alerts_total,
        "alerts_resolved": alerts_resolved,
        "tickets_updated": tickets_updated,
        "need_to_know": need_rows,
        "verdict": "You didn't miss much." if alerts_resolved >= noise else f"{noise} alert(s) still need attention.",
    }


# ============== OPERATIONAL MEMORY ==============

async def pin_memory(db: Any, user: dict, *, object_type: str, object_id: str, text: str) -> dict:
    entry = {
        "id": str(uuid.uuid4()),
        "tenant_id": user.get("tenant_id") or "nexus-local",
        "object_type": str(object_type or "").strip()[:40],
        "object_id": str(object_id or "").strip()[:64],
        "text": str(text or "").strip()[:2000],
        "pinned_by": user.get("id"),
        "pinned_by_name": user.get("name"),
        "created_at": _iso(_utcnow()),
        "archived": False,
    }
    await db.nexus_memory.insert_one(entry)
    entry.pop("_id", None)
    return entry


async def list_memory(db: Any, user: dict, object_type: str, object_id: str) -> list[dict]:
    rows = await db.nexus_memory.find(
        {"tenant_id": user.get("tenant_id") or "nexus-local", "object_type": object_type,
         "object_id": object_id, "archived": False}, {"_id": 0},
    ).sort("created_at", -1).limit(50).to_list(50)
    return rows


# ============== CHANGE RISK SCORE ==============

async def change_risk_score(db: Any, user: dict, *, device_id: str, description: str) -> dict:
    """Deterministic, explainable risk score for a proposed change."""
    from app.services.scope_permissions import tenant_scoped_query

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}
    score = 0
    reasons = []
    if "server" in str(device.get("device_type") or "").lower() or "server" in str(device.get("hostname") or "").lower():
        score += 25
        reasons.append("Production server.")
    try:
        if float(device.get("disk_usage") or 0) >= 90 or float(device.get("cpu_usage") or 0) >= 90:
            score += 10
            reasons.append("Device is already under resource pressure.")
    except (TypeError, ValueError):
        pass
    recent_backup = await db.backup_jobs.count_documents(
        {"device_id": device_id, "status": {"$regex": "success", "$options": "i"}, "started_at": {"$gte": _iso(_utcnow() - timedelta(days=7))}}
    )
    if not recent_backup:
        score += 15
        reasons.append("No recent configuration/job backup evidence for this device.")
    window = await db.maintenance_windows.count_documents(
        {"starts_at": {"$lte": _iso(_utcnow())}, "ends_at": {"$gte": _iso(_utcnow())}}
    )
    if not window:
        score += 15
        reasons.append("Outside a maintenance window.")
    uptime = device.get("uptime_hours")
    try:
        if uptime is not None and float(uptime) > 90 * 24:
            score += 10
            reasons.append("Long uptime — a change may force a disruptive restart.")
    except (TypeError, ValueError):
        pass
    prior = await db.change_management.count_documents({"device_id": device_id})
    if not prior:
        score += 10
        reasons.append("This change has not been performed on this device before.")
    score = max(0, min(100, score))
    band = "Low" if score < 30 else "Moderate" if score < 55 else "High" if score < 75 else "Critical"
    return {
        "found": True,
        "device_id": device_id,
        "description": description,
        "score": score,
        "band": band,
        "reasons": reasons,
        "recommendation": "Proceed with normal care." if score < 30 else "Schedule inside a maintenance window and capture a snapshot first." if score < 75 else "Do not proceed without a rollback plan and explicit approval.",
    }


# ============== NOPE FEEDBACK / NEXUS LABS ==============

async def record_feedback(db: Any, user: dict, *, source_type: str, source_id: str, verdict: str, note: str) -> dict:
    entry = {
        "id": str(uuid.uuid4()),
        "tenant_id": user.get("tenant_id") or "nexus-local",
        "source_type": str(source_type or "")[:40],
        "source_id": str(source_id or "")[:64],
        "verdict": str(verdict or "")[:40],
        "note": str(note or "").strip()[:1000],
        "created_by": user.get("id"),
        "created_by_name": user.get("name"),
        "created_at": _iso(_utcnow()),
    }
    await db.nexus_feedback.insert_one(entry)
    entry.pop("_id", None)
    return entry


LABS_FLAGS = ["predictive_ticketing", "autonomous_diagnosis", "natural_language_control", "failure_prediction", "experimental_remediation"]


async def labs_flags(db: Any) -> dict:
    doc = await db.settings.find_one({"type": "nexus_labs"}, {"_id": 0}) or {}
    stored = doc.get("flags") if isinstance(doc.get("flags"), dict) else {}
    return {flag: bool(stored.get(flag)) for flag in LABS_FLAGS}


async def set_labs_flags(db: Any, updates: dict) -> dict:
    current = await labs_flags(db)
    merged = {**current, **{flag: bool(value) for flag, value in (updates or {}).items() if flag in LABS_FLAGS}}
    await db.settings.update_one({"type": "nexus_labs"}, {"$set": {"type": "nexus_labs", "flags": merged}}, upsert=True)
    return merged


# ============== CONTEXT-AWARE: WHY THIS ALERT / BLAST RADIUS ==============

_RESOURCE_FAMILY = re.compile(r"cpu|memory|ram|disk|performance|latency|slow", re.I)
_SECURITY_FAMILY = re.compile(r"process|malware|virus|security|intrusion|firewall", re.I)


async def alert_triage(db: Any, user: dict, alert_id: str) -> dict:
    """Why am I looking at this? / Should I care? — a verdict from live context."""
    from app.services.scope_permissions import tenant_scoped_query

    alert = await db.alerts.find_one(tenant_scoped_query(user, {"id": alert_id}), {"_id": 0})
    if not alert:
        return {"found": False}
    now = _utcnow()
    family = str(alert.get("alert_type") or "")
    text = f"{family} {alert.get('message') or ''}"
    device_id = alert.get("device_id")
    device_name = alert.get("device_name") or alert.get("device_hostname")

    # Precedent: the same alert family on the same device.
    prior_query: dict = {"alert_type": family} if family else {}
    if device_id:
        prior_query["device_id"] = device_id
    elif device_name:
        prior_query["device_name"] = device_name
    prior_rows = await db.alerts.find(prior_query, {"_id": 0}).to_list(200)
    prior = [row for row in prior_rows if row.get("id") != alert_id]
    week_ago = _iso(now - timedelta(days=7))
    recent = [row for row in prior if str(row.get("created_at") or "") >= week_ago]

    if not prior:
        why_now = "First occurrence of this alert family on this device — no historical precedent."
    elif recent:
        why_now = f"Recurring: occurred {len(recent) + 1} times on this device in the last 7 days."
    else:
        why_now = f"Seen {len(prior)} time(s) before on this device; this is the first since."

    reasons = []
    verdict = "Watch"

    # Should I care? A resource alert during a running/recent backup is expected load.
    if _RESOURCE_FAMILY.search(text):
        backup_query: dict = {"started_at": {"$gte": _iso(now - timedelta(minutes=30))}}
        if device_id:
            backup_query["device_id"] = device_id
        elif device_name:
            backup_query["device_hostname"] = device_name
        backup = await db.backup_jobs.find_one(backup_query, {"_id": 0})
        if backup:
            verdict = "Ignore"
            reasons.append("Backup/compression activity is running on this device. Expected behaviour.")
            if backup.get("estimated_minutes"):
                reasons.append(f"Estimated completion in ~{backup['estimated_minutes']} minutes.")
        elif recent:
            verdict = "Investigate"
            reasons.append("Resource pressure is recurring, not a one-off load spike.")
        else:
            reasons.append("Resource alert outside any known job window — watch the next sample.")

    if _SECURITY_FAMILY.search(text) and not prior:
        verdict = "Investigate"
        reasons.append("Unrecognised activity with no historical precedent on this device.")

    if verdict == "Watch" and recent:
        verdict = "Investigate"
        reasons.append("The same alert family is repeating on this device.")

    return {
        "found": True,
        "alert": {key: alert.get(key) for key in ("id", "alert_type", "message", "severity", "status", "created_at", "device_id", "device_name", "client_name")},
        "why_now": why_now,
        "verdict": verdict,
        "reasons": reasons or ["Nothing in the surrounding context changes the picture yet."],
    }


async def blast_radius(db: Any, user: dict, device_id: str) -> dict:
    """If this fails → what is affected? Derived only from relationships we can evidence."""
    from app.services.scope_permissions import tenant_scoped_query

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}
    hostname = device.get("hostname") or device.get("name") or device_id
    ref_clause = [{"device_id": device_id}]
    if hostname:
        ref_clause += [{"device_hostname": hostname}, {"device_name": hostname}]

    open_tickets = await db.tickets.count_documents(
        tenant_scoped_query(user, {"$or": ref_clause, "status": {"$nin": ["resolved", "closed"]}})
    )
    sessions = await db.remote_sessions.count_documents({"device_id": device_id, "status": {"$in": ["active", "connected", "in_progress"]}})
    open_alerts = await db.alerts.count_documents(
        tenant_scoped_query(user, {"$or": ref_clause, "status": {"$nin": ["resolved", "auto_resolved", "closed"]}})
    )
    site = device.get("site_name") or device.get("site_id")
    co_resident = 0
    if device.get("client_id"):
        co_resident = await db.devices.count_documents(
            tenant_scoped_query(user, {"client_id": device.get("client_id"), "id": {"$ne": device_id}})
        )
    impacts = [
        f"{open_tickets} open ticket(s) reference this device — work in flight is at risk.",
        f"{sessions} technician session(s) active right now.",
        f"{open_alerts} open alert(s) already on it.",
        f"{co_resident} other device(s) share this customer" + (f"/site ({site})." if site else "."),
    ]
    return {
        "found": True,
        "device_id": device_id,
        "hostname": hostname,
        "client_id": device.get("client_id"),
        "client_name": device.get("client_name"),
        "site": site,
        "headline": f"If {hostname} fails → {device.get('client_name') or 'this customer'}{f' / {site}' if site else ''} is affected.",
        "impacts": impacts,
        "open_tickets": open_tickets,
        "active_sessions": sessions,
        "open_alerts": open_alerts,
        "co_resident_devices": co_resident,
    }


# ============== "BEFORE YOU TOUCH IT" WORK LOCKS ==============

async def acquire_work_lock(db: Any, user: dict, name: str, *, device_id: str, ticket_id: str = "", note: str = "", minutes: int = 30, force: bool = False) -> dict:
    now = _utcnow()
    tenant = user.get("tenant_id") or "nexus-local"
    held = await db.work_locks.find_one(
        {"tenant_id": tenant, "device_id": device_id, "expires_at": {"$gt": _iso(now)}}, {"_id": 0}
    )
    if held and held.get("user_id") != user.get("id") and not force:
        return {"acquired": False, "held_by": held.get("display_name") or "another technician",
                "ticket_id": held.get("ticket_id"), "note": held.get("note"), "expires_at": held.get("expires_at")}
    taken_from = held.get("display_name") if held and held.get("user_id") != user.get("id") else None
    lock = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant,
        "device_id": device_id,
        "user_id": user.get("id"),
        "display_name": name,
        "ticket_id": ticket_id[:64],
        "note": note.strip()[:500],
        "acquired_at": _iso(now),
        "expires_at": _iso(now + timedelta(minutes=max(5, min(minutes, 240)))),
    }
    await db.work_locks.update_one(
        {"tenant_id": tenant, "device_id": device_id}, {"$set": lock}, upsert=True
    )
    lock.pop("_id", None)
    return {"acquired": True, "lock": lock, "taken_from": taken_from}


async def work_lock_status(db: Any, user: dict, device_id: str) -> dict:
    """Before you touch it: who else is here, what is scheduled, what is open."""
    from app.services.scope_permissions import tenant_scoped_query

    now = _utcnow()
    tenant = user.get("tenant_id") or "nexus-local"
    held = await db.work_locks.find_one(
        {"tenant_id": tenant, "device_id": device_id, "expires_at": {"$gt": _iso(now)}}, {"_id": 0}
    )
    window = await db.maintenance_windows.find_one(
        {"starts_at": {"$lte": _iso(now)}, "ends_at": {"$gte": _iso(now)}}, {"_id": 0}
    )
    open_tickets = await db.tickets.find(
        tenant_scoped_query(user, {"$or": [{"device_id": device_id}], "status": {"$nin": ["resolved", "closed"]}}),
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "assigned_name": 1},
    ).limit(5).to_list(5)
    blockers = []
    if held and held.get("user_id") != user.get("id"):
        blockers.append(f"⚠ {held.get('display_name') or 'Another technician'} is currently working on this device"
                        + (f" ({held.get('ticket_id')})" if held.get("ticket_id") else "") + ".")
    if window:
        blockers.append(f"A maintenance window is active ({window.get('name') or 'scheduled maintenance'}).")
    for ticket in open_tickets:
        who = ticket.get("assigned_name") or "unassigned"
        blockers.append(f"{ticket.get('ticket_number') or ticket.get('id')} is active on this device — {who}.")
    return {
        "device_id": device_id,
        "safe_to_proceed": not blockers,
        "blockers": blockers,
        "held_by": (held or {}).get("display_name") if held and held.get("user_id") != user.get("id") else None,
        "held_until": (held or {}).get("expires_at") if held else None,
    }


# ============== HANDOVER ==============

async def handover(db: Any, user: dict, name: str) -> dict:
    """The 5 PM digest: what is active, what waits, what runs, who should take what."""
    now = _utcnow()
    active = await db.tickets.find(
        {"$or": [{"assigned_to": user.get("id")}, {"assigned_name": name}],
         "status": {"$nin": ["resolved", "closed"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "priority": 1, "due_date": 1},
    ).limit(20).to_list(20)
    vendor = [row for row in active if "vendor" in f"{row.get('title')} {row.get('category', '')}".lower()]
    tomorrow = _iso(now + timedelta(days=2))
    today = _iso(now)
    follow_ups = [row for row in active if row.get("due_date") and today <= str(row["due_date"]) <= tomorrow]
    running = await db.nexus_agent_commands.find(
        {"user_id": user.get("id"), "status": {"$in": ["running", "pending", "queued"]}}, {"_id": 0, "id": 1, "device_id": 1, "action": 1, "command": 1}
    ).limit(5).to_list(5)

    recommendation = None
    if active:
        top = active[0]
        clause = [{"device_id": top.get("device_id")}, {"device_hostname": top.get("device_hostname")}]
        prior_close = await db.tickets.find_one(
            {"$or": clause, "status": {"$in": ["resolved", "closed"]}, "assigned_name": {"$nin": [name, None]}}, {"_id": 0}
        )
        if prior_close and prior_close.get("assigned_name"):
            recommendation = f"Nexus recommends handing {top.get('ticket_number') or top.get('id')} to {prior_close['assigned_name']} — they resolved the previous occurrence."

    return {
        "generated_at": _iso(now),
        "active_issues": active,
        "customer_waiting": [row for row in active if row.get("priority") in {"critical", "high"}],
        "vendor_escalations": vendor,
        "running": running,
        "follow_ups": follow_ups,
        "recommendation": recommendation,
    }


# ============== "WHY IS THIS CUSTOMER EXPENSIVE?" ==============

async def customer_cost_report(db: Any, user: dict, client_id: str) -> dict:
    """Support demand versus peers, cost drivers, and an honest avoidable-cost estimate."""
    from app.services.scope_permissions import tenant_scoped_query

    client = await db.clients.find_one(tenant_scoped_query(user, {"$or": [{"id": client_id}, {"name": client_id}]}), {"_id": 0})
    if not client:
        return {"found": False}
    cid = client.get("id")
    tickets = await db.tickets.find(tenant_scoped_query(user, {"client_id": cid}), {"_id": 0}).to_list(2000)
    total = len(tickets)
    if not total:
        return {"found": True, "client_id": cid, "client_name": client.get("name"), "total_tickets": 0,
                "demand_ratio": 0.0, "drivers": [], "verdict": "No support demand recorded — suspiciously quiet."}

    # Peer demand: tickets per customer across the tenant.
    per_client: dict[str, int] = {}
    for row in await db.tickets.find(tenant_scoped_query(user, {}), {"_id": 0, "client_id": 1}).to_list(5000):
        key = row.get("client_id") or "unknown"
        per_client[key] = per_client.get(key, 0) + 1
    peers = sorted(count for key, count in per_client.items() if key != cid and count > 0)
    median = peers[len(peers) // 2] if peers else max(total, 1)
    ratio = round(total / max(median, 1), 1)

    by_category: dict[str, int] = {}
    hours = 0.0
    for row in tickets:
        category = str(row.get("category") or "uncategorised")
        by_category[category] = by_category.get(category, 0) + 1
        try:
            hours += float(row.get("total_time_minutes") or 0) / 60.0
        except (TypeError, ValueError):
            pass
    drivers = [
        {"category": category, "tickets": count, "share_pct": round(100.0 * count / total)}
        for category, count in sorted(by_category.items(), key=lambda item: -item[1])[:4]
    ]
    avg_rate = 0.0
    rate_rows = await db.users.find({}, {"_id": 0, "hourly_rate": 1}).to_list(200)
    rates = [float(r["hourly_rate"]) for r in rate_rows if r.get("hourly_rate")]
    avg_rate = sum(rates) / len(rates) if rates else 0.0
    delivery_cost = round(hours * avg_rate)
    excess_share = max(0.0, (total - median) / total) if total > median else 0.0
    avoidable = round(delivery_cost * excess_share)

    return {
        "found": True,
        "client_id": cid,
        "client_name": client.get("name"),
        "total_tickets": total,
        "peer_median_tickets": median,
        "demand_ratio": ratio,
        "drivers": drivers,
        "support_hours": round(hours, 1),
        "estimated_delivery_cost": delivery_cost,
        "estimated_avoidable_cost": avoidable,
        "verdict": (f"{client.get('name')} generates {ratio}× the support demand of comparable customers."
                    if ratio >= 1.5 else f"{client.get('name')} is in line with comparable customers ({ratio}× median demand)."),
        "recommendation": ("Propose targeted projects against the top drivers above — the demand is concentrated, not random."
                           if ratio >= 1.5 and drivers else "Nothing anomalous; keep the agreement as-is."),
    }


# ============== "IS IT DNS?" ==============

def _resolve_host(host: str) -> tuple[bool, float, list[str]]:
    """One real DNS resolution with timing (monkeypatchable in tests)."""
    started = datetime.now(timezone.utc).timestamp()
    try:
        infos = socket.getaddrinfo(host, None)
        addresses = sorted({info[4][0] for info in infos})
        elapsed = (datetime.now(timezone.utc).timestamp() - started) * 1000
        return True, elapsed, addresses
    except OSError:
        elapsed = (datetime.now(timezone.utc).timestamp() - started) * 1000
        return False, elapsed, []


async def is_it_dns(db: Any, user: dict) -> dict:
    """Run the DNS chain on real names in scope and answer YES/NO."""
    from app.services.scope_permissions import tenant_scoped_query

    hosts: list[str] = []
    devices = await db.devices.find(tenant_scoped_query(user, {}), {"_id": 0, "hostname": 1}).limit(25).to_list(25)
    for device in devices:
        hostname = str(device.get("hostname") or "").strip()
        if hostname and "." in hostname and hostname not in hosts:
            hosts.append(hostname)
    if len(hosts) < 3:
        clients = await db.clients.find(tenant_scoped_query(user, {}), {"_id": 0, "domain": 1, "website": 1}).limit(10).to_list(10)
        for client in clients:
            for field in ("domain", "website"):
                value = str(client.get(field) or "").strip().replace("https://", "").replace("http://", "").split("/")[0]
                if value and "." in value and value not in hosts:
                    hosts.append(value)
    results = []
    for host in hosts[:5]:
        ok, ms, addresses = _resolve_host(host)
        results.append({"host": host, "ok": ok, "ms": ms, "addresses": addresses})
    verdict = dns_verdict(results)
    verdict["tested_hosts"] = [r["host"] for r in results]
    return verdict


# ============== VERIFY USER REPORT (Reality Check) ==============

async def verify_user_report(db: Any, user: dict, device_id: str, window_hours: int = 24) -> dict:
    """Evidence summary for a user's connectivity claim — facts, not accusations."""
    from app.services.scope_permissions import tenant_scoped_query

    device = await db.devices.find_one(tenant_scoped_query(user, {"id": device_id}), {"_id": 0})
    if not device:
        return {"found": False}
    window_start = _utcnow() - timedelta(hours=max(1, min(window_hours, 168)))
    since = _iso(window_start)
    sessions = await db.remote_sessions.count_documents(
        {"device_id": device_id, "started_at": {"$gte": since}}
    )
    alerts = await db.alerts.count_documents(
        {"device_id": device_id, "created_at": {"$gte": since}}
    )
    last_seen = _parse_iso(device.get("last_seen"))
    seen_ago = round((_utcnow() - last_seen).total_seconds() / 60) if last_seen else None
    evidence = [
        {"source": "device telemetry", "detail": f"Last seen {seen_ago} minute(s) ago." if seen_ago is not None else "No recent telemetry."},
        {"source": "remote sessions", "detail": f"{sessions} managed session(s) in the last {window_hours}h."},
        {"source": "monitoring", "detail": f"{alerts} alert(s) recorded in the window."},
    ]
    if seen_ago is not None and seen_ago <= 15 and sessions > 0:
        verdict = "Device evidence does not support a sustained outage in this window."
    elif seen_ago is not None and seen_ago > 60:
        verdict = "There is a telemetry gap consistent with the reported interruption."
    else:
        verdict = "Evidence is partial — review the timeline before responding to the customer."
    return {
        "found": True,
        "device_id": device_id,
        "hostname": device.get("hostname") or device.get("name") or device_id,
        "window_hours": window_hours,
        "sessions_in_window": sessions,
        "alerts_in_window": alerts,
        "last_seen_minutes_ago": seen_ago,
        "evidence": evidence,
        "verdict": verdict,
    }
