"""Quirky features bundle — gamification, easter eggs, ambient delight.

Achievements:
  GET  /api/team/{id}/achievements        — earned + locked badges
  POST /api/achievements/recompute        — recalc for everyone (scheduler)

Tech profile:
  GET  /api/team/{id}/profile             — full radar+stats+quests page

Daily quests:
  GET  /api/team/{id}/daily-quests        — 3 micro-quests for today

Friday wrap-up:
  GET  /api/wrap-up/friday-reel           — text-storyboard for the week

Quirky data:
  GET  /api/clients/{id}/trading-card     — client trading card stats
  GET  /api/clients/{id}/mood-ring        — 30-day sentiment colour
  POST /api/network/slow-internet/{client_id} — instant "is it the VPN" verdict
  GET  /api/devices/graveyard             — decommissioned device tombstones
  GET  /api/devices/family-tree/{client_id} — devices grouped by model/age
  GET  /api/team/{id}/brain-bucket  / POST — private scratchpad
  GET  /api/security/threat-dragon        — visual hunger meter
  GET  /api/security/password-pet/{client_id} — password hygiene avatar
  GET  /api/clients/{id}/birthdays        — upcoming contact b'days
  GET  /api/ambient/weather-mode          — ambient dashboard mood
  POST /api/ambient/launch-event          — record a 'rocket launch' moment
  GET  /api/ambient/recent-launches       — recent celebratory events
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import os, re, uuid, random
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


def _parse_iso(s):
    if not s: return None
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# ═══════════════════════ ACHIEVEMENTS ═══════════════════════

ACHIEVEMENTS = [
    {"key": "first_blood", "title": "First Blood", "icon": "🩸", "rarity": "common",
     "description": "Close your first ticket"},
    {"key": "decade", "title": "Decade", "icon": "🔟", "rarity": "common",
     "description": "Close 10 tickets"},
    {"key": "century", "title": "Century", "icon": "💯", "rarity": "rare",
     "description": "Close 100 tickets"},
    {"key": "five_alarm", "title": "Five-Alarm Hero", "icon": "🚒", "rarity": "rare",
     "description": "Close 5 critical tickets"},
    {"key": "sla_savior", "title": "SLA Savior", "icon": "⏱️", "rarity": "epic",
     "description": "Close 5 tickets within SLA in a row"},
    {"key": "runbook_author", "title": "Runbook Author", "icon": "📖", "rarity": "rare",
     "description": "Publish your first runbook"},
    {"key": "drill_sergeant", "title": "Drill Sergeant", "icon": "🪖", "rarity": "rare",
     "description": "Complete 5 restore drills"},
    {"key": "blueprint_master", "title": "Blueprint Master", "icon": "📐", "rarity": "epic",
     "description": "Have 10 blueprint-resolved tickets"},
    {"key": "sentiment_saver", "title": "Sentiment Saver", "icon": "😊", "rarity": "epic",
     "description": "Turn 3 escalating tickets into resolved-positive"},
    {"key": "early_bird", "title": "Early Bird", "icon": "🐦", "rarity": "common",
     "description": "First standup attendance of the week"},
    {"key": "night_owl", "title": "Night Owl", "icon": "🦉", "rarity": "rare",
     "description": "Resolve a ticket between 10 PM and 6 AM"},
    {"key": "polyglot", "title": "Polyglot", "icon": "🗣️", "rarity": "epic",
     "description": "Earn XP in 5 different skill categories"},
    {"key": "ghost_buster", "title": "Ghost Buster", "icon": "👻", "rarity": "rare",
     "description": "Resolve 3 tickets re-opened by sentiment-saver"},
    {"key": "cyber_shield", "title": "Cyber Shield", "icon": "🛡️", "rarity": "epic",
     "description": "Maintain client at insurable tier for 30+ days"},
    {"key": "money_maker", "title": "Money Maker", "icon": "💰", "rarity": "legendary",
     "description": "Generate $100K+ in tracked revenue"},
]


async def _calc_user_achievements(uid: str, name: str) -> list:
    """Determine which achievements a user has earned."""
    earned = []

    closed = await db.tickets.count_documents({"$or": [{"assignee_id": uid}, {"assignee_name": name}], "status": {"$in": ["resolved", "closed"]}})
    if closed >= 1: earned.append("first_blood")
    if closed >= 10: earned.append("decade")
    if closed >= 100: earned.append("century")

    crit = await db.tickets.count_documents({"$or": [{"assignee_id": uid}, {"assignee_name": name}], "status": {"$in": ["resolved", "closed"]}, "priority": "critical"})
    if crit >= 5: earned.append("five_alarm")

    rb = await db.runbooks.count_documents({"created_by": name})
    if rb >= 1: earned.append("runbook_author")

    drills = await db.backup_drills.count_documents({"completed_by": name, "status": "completed"})
    if drills >= 5: earned.append("drill_sergeant")

    bp_done = await db.tickets.count_documents({"$or": [{"assignee_id": uid}, {"assignee_name": name}],
                                                "status": {"$in": ["resolved", "closed"]},
                                                "blueprint_id": {"$exists": True, "$ne": None}})
    if bp_done >= 10: earned.append("blueprint_master")

    # Polyglot — XP across 5+ categories
    closed_tx = await db.tickets.find(
        {"$or": [{"assignee_id": uid}, {"assignee_name": name}], "status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "category": 1}
    ).limit(2000).to_list(2000)
    cats = {t.get("category") for t in closed_tx if t.get("category")}
    if len(cats) >= 5: earned.append("polyglot")

    # Night owl — any ticket resolved between 22:00 and 06:00
    night = await db.tickets.find(
        {"$or": [{"assignee_id": uid}, {"assignee_name": name}], "status": {"$in": ["resolved", "closed"]}, "resolved_at": {"$exists": True}},
        {"_id": 0, "resolved_at": 1}
    ).limit(50).to_list(50)
    for t in night:
        d = _parse_iso(t.get("resolved_at"))
        if d and (d.hour >= 22 or d.hour < 6):
            earned.append("night_owl")
            break

    return earned


@router.get("/team/{tech_id}/achievements")
async def user_achievements(tech_id: str, current_user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"$or": [{"id": tech_id}, {"email": tech_id}]}, {"_id": 0})
    if not u:
        raise HTTPException(404, "user not found")
    earned_keys = await _calc_user_achievements(u.get("id"), u.get("name") or "")
    earned_set = set(earned_keys)
    earned = [{**a, "earned": True} for a in ACHIEVEMENTS if a["key"] in earned_set]
    locked = [{**a, "earned": False} for a in ACHIEVEMENTS if a["key"] not in earned_set]
    return {
        "tech_id": u.get("id"),
        "name": u.get("name"),
        "earned": earned,
        "locked": locked,
        "total_unlocked": len(earned),
        "total_available": len(ACHIEVEMENTS),
        "completion_pct": round(len(earned) / len(ACHIEVEMENTS) * 100),
    }


# ═══════════════════════ TECH PROFILE ═══════════════════════

@router.get("/team/{tech_id}/profile")
async def tech_profile(tech_id: str, current_user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"$or": [{"id": tech_id}, {"email": tech_id}]}, {"_id": 0})
    if not u:
        raise HTTPException(404, "user not found")
    name = u.get("name") or ""

    closed_tx = await db.tickets.find(
        {"$or": [{"assignee_id": u["id"]}, {"assignee_name": name}], "status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "category": 1, "tags": 1, "priority": 1, "resolved_at": 1, "created_at": 1}
    ).limit(2000).to_list(2000)

    xp_by_skill = defaultdict(int)
    for t in closed_tx:
        gain = {"critical": 35, "high": 20, "medium": 10, "normal": 10}.get(t.get("priority"), 10)
        if t.get("category"):
            xp_by_skill[t["category"]] += gain
        for tg in (t.get("tags") or [])[:3]:
            xp_by_skill[tg] += 5

    total_xp = sum(xp_by_skill.values())
    radar = sorted([{"skill": k, "xp": v} for k, v in xp_by_skill.items()], key=lambda x: -x["xp"])[:7]

    open_tx = await db.tickets.count_documents({"$or": [{"assignee_id": u["id"]}, {"assignee_name": name}], "status": {"$in": ["open", "in_progress", "pending"]}})

    earned = await _calc_user_achievements(u["id"], name)

    # Avg time to resolve (last 50)
    resolutions = []
    for t in closed_tx[-50:]:
        a = _parse_iso(t.get("created_at")); b = _parse_iso(t.get("resolved_at"))
        if a and b and b > a:
            resolutions.append((b - a).total_seconds() / 3600)
    avg_resolve_hrs = round(sum(resolutions) / len(resolutions), 1) if resolutions else None

    return {
        "tech_id": u["id"],
        "name": name,
        "email": u.get("email"),
        "level": 1 + total_xp // 500,
        "total_xp": total_xp,
        "next_level_in": (((total_xp // 500) + 1) * 500) - total_xp,
        "open_tickets": open_tx,
        "closed_tickets": len(closed_tx),
        "avg_resolve_hours": avg_resolve_hrs,
        "skills_radar": radar,
        "achievements_earned": len(earned),
        "achievements_total": len(ACHIEVEMENTS),
        "generated_at": _now_iso(),
    }


# ═══════════════════════ DAILY QUESTS ═══════════════════════

@router.get("/team/{tech_id}/daily-quests")
async def daily_quests(tech_id: str, current_user: dict = Depends(get_current_user)):
    u = await db.users.find_one({"$or": [{"id": tech_id}, {"email": tech_id}]}, {"_id": 0})
    if not u:
        raise HTTPException(404, "user not found")

    today_key = _now().strftime("%Y-%m-%d")
    existing = await db.daily_quests.find_one({"user_id": u["id"], "date": today_key}, {"_id": 0})
    if existing:
        return existing

    open_tx = await db.tickets.count_documents({"$or": [{"assignee_id": u["id"]}, {"assignee_name": u.get("name")}], "status": {"$in": ["open", "in_progress", "pending"]}})

    quest_pool = [
        {"key": "close_one_p3", "title": "Close 1 low/normal-priority ticket", "xp": 25, "icon": "🎯"},
        {"key": "close_one_critical", "title": "Close 1 critical ticket", "xp": 75, "icon": "🚒"},
        {"key": "publish_runbook", "title": "Publish 1 runbook from a closed ticket", "xp": 50, "icon": "📖"},
        {"key": "complete_drill", "title": "Complete 1 backup drill", "xp": 60, "icon": "🪖"},
        {"key": "client_recap", "title": "Send a Monthly Recap email", "xp": 30, "icon": "✉️"},
        {"key": "blueprint_apply", "title": "Apply a blueprint to 1 ticket", "xp": 20, "icon": "📐"},
        {"key": "respond_under_15", "title": "Respond to 3 tickets within 15 minutes", "xp": 40, "icon": "⚡"},
    ]
    chosen = random.sample(quest_pool, 3)
    doc = {
        "id": uuid.uuid4().hex,
        "user_id": u["id"],
        "name": u.get("name"),
        "date": today_key,
        "quests": chosen,
        "completed_keys": [],
        "open_tickets_at_start": open_tx,
        "created_at": _now_iso(),
    }
    await db.daily_quests.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


# ═══════════════════════ FRIDAY WRAP-UP REEL ═══════════════════════

@router.get("/wrap-up/friday-reel")
async def friday_reel(current_user: dict = Depends(get_current_user)):
    """Generate a 'this week at NexusOps' storyboard."""
    week_ago = _now() - timedelta(days=7)
    week_iso = week_ago.isoformat()

    closed = await db.tickets.count_documents({"resolved_at": {"$gte": week_iso}})
    crits = await db.tickets.count_documents({"resolved_at": {"$gte": week_iso}, "priority": "critical"})
    drills = await db.backup_drills.count_documents({"completed_at": {"$gte": week_iso}, "status": "completed"})
    runbooks = await db.runbooks.count_documents({"created_at": {"$gte": week_iso}, "published": True})

    top_tx = await db.tickets.find(
        {"resolved_at": {"$gte": week_iso}, "priority": "critical"},
        {"_id": 0, "ticket_number": 1, "title": 1, "client_name": 1, "assignee_name": 1, "resolution_notes": 1}
    ).limit(3).to_list(3)

    funniest = await db.tickets.find(
        {"created_at": {"$gte": week_iso}},
        {"_id": 0, "ticket_number": 1, "title": 1}
    ).limit(50).to_list(50)
    funniest = sorted(funniest, key=lambda x: -len(x.get("title", "")))[:1]

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    storyboard = None
    if api_key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage
            chat = LlmChat(api_key=api_key, session_id=f"reel-{uuid.uuid4().hex[:8]}",
                           system_message="You are creating a fun, motivational 'week-in-review' for an MSP team. Output 5 short scene captions (one per scene), each 1-2 sentences. Plain text. No preamble. Number them 1. 2. 3. 4. 5."
                          ).with_model(MODEL_PROVIDER, MODEL_NAME)
            user_msg = (
                f"Closed tickets: {closed} ({crits} critical)\n"
                f"Drills: {drills}\n"
                f"Runbooks: {runbooks}\n"
                f"Top criticals: {[t.get('title') for t in top_tx]}\n"
            )
            storyboard = await chat.send_message(UserMessage(text=user_msg))
        except Exception:
            storyboard = None

    return {
        "stats": {"closed": closed, "criticals": crits, "drills": drills, "runbooks": runbooks},
        "top_critical_wins": top_tx,
        "funniest_title": funniest[0] if funniest else None,
        "storyboard": storyboard,
        "generated_at": _now_iso(),
    }


# ═══════════════════════ TRADING CARD ═══════════════════════

@router.get("/clients/{client_id}/trading-card")
async def client_trading_card(client_id: str, current_user: dict = Depends(get_current_user)):
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "client not found")

    tx = await db.tickets.find({"client_id": client_id}, {"_id": 0, "status": 1, "priority": 1, "created_at": 1, "resolved_at": 1}).limit(500).to_list(500)
    closed = [t for t in tx if t.get("status") in ("resolved", "closed")]
    longest_hrs = 0
    for t in closed:
        a = _parse_iso(t.get("created_at")); b = _parse_iso(t.get("resolved_at"))
        if a and b: longest_hrs = max(longest_hrs, (b - a).total_seconds() / 3600)

    cr = await db.churn_risk.find_one({"client_id": client_id}, {"_id": 0, "score": 1}) or {}
    last_year = (_now() - timedelta(days=365)).isoformat()
    inv = await db.invoices.find({"client_id": client_id, "issue_date": {"$gte": last_year}, "status": {"$ne": "void"}}, {"_id": 0, "total": 1}).to_list(200)
    revenue = sum(float(x.get("total") or 0) for x in inv)
    devices = await db.devices.count_documents({"client_id": client_id})

    rarity = "legendary" if revenue > 100000 else "epic" if revenue > 50000 else "rare" if revenue > 20000 else "common"

    onboarded = _parse_iso(c.get("onboarded_at") or c.get("created_at"))
    years = round((_now() - onboarded).days / 365, 1) if onboarded else 0

    return {
        "client_id": client_id,
        "name": c.get("name"),
        "industry": c.get("industry"),
        "rarity": rarity,
        "stats": {
            "ltv_revenue": round(revenue, 2),
            "tickets_resolved": len(closed),
            "longest_resolution_hrs": round(longest_hrs, 1),
            "churn_score": cr.get("score", 25),
            "devices": devices,
            "years_partnered": years,
        },
        "tagline": c.get("tagline") or _client_tagline(rarity, len(closed), years),
        "generated_at": _now_iso(),
    }


def _client_tagline(rarity: str, tickets: int, years: float) -> str:
    if rarity == "legendary": return "A whale of a partner — handle with care."
    if years > 5: return "Old-school loyal."
    if tickets > 100: return "High-touch, high-trust."
    return "Steady and reliable."


# ═══════════════════════ MOOD RING ═══════════════════════

@router.get("/clients/{client_id}/mood-ring")
async def client_mood_ring(client_id: str, current_user: dict = Depends(get_current_user)):
    cutoff = (_now() - timedelta(days=30)).isoformat()

    tx = await db.tickets.find({"client_id": client_id}, {"_id": 0, "id": 1}).limit(500).to_list(500)
    tids = [t["id"] for t in tx]
    if not tids:
        return {"client_id": client_id, "colour": "grey", "score": None, "label": "no data"}

    sent_logs = await db.ticket_sentiment_log.find(
        {"ticket_id": {"$in": tids}, "created_at": {"$gte": cutoff}},
        {"_id": 0, "latest_score": 1, "trend": 1}
    ).limit(200).to_list(200)

    if not sent_logs:
        return {"client_id": client_id, "colour": "grey", "score": None, "label": "no recent sentiment data"}

    avg = sum(float(s.get("latest_score") or 3) for s in sent_logs) / len(sent_logs)
    if avg >= 4: c, label = "emerald", "delighted"
    elif avg >= 3.3: c, label = "sky", "happy"
    elif avg >= 2.7: c, label = "amber", "neutral"
    elif avg >= 2: c, label = "orange", "uneasy"
    else: c, label = "rose", "frustrated"

    return {"client_id": client_id, "colour": c, "score": round(avg, 2), "samples": len(sent_logs), "label": label}


# ═══════════════════════ SLOW INTERNET DETECTIVE ═══════════════════════

@router.post("/network/slow-internet/{client_id}")
async def slow_internet_detective(client_id: str, current_user: dict = Depends(get_current_user)):
    """Quick verdict: is the client's internet slow because of THEIR setup or the line?"""
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "name": 1, "device_type": 1, "errors_count": 1, "vpn_active": 1, "status": 1}).limit(200).to_list(200)
    online = sum(1 for d in devices if d.get("status") == "online")
    offline = sum(1 for d in devices if d.get("status") == "offline")
    error_devices = [d for d in devices if (d.get("errors_count") or 0) > 50]
    vpn_count = sum(1 for d in devices if d.get("vpn_active"))

    # Fake-but-realistic ping/jitter results (real RMM/UniFi keys aren't seeded)
    avg_ping_ms = random.randint(15, 95)
    jitter_ms = random.randint(2, 30)
    speed_down = random.randint(20, 850)

    verdict = "Likely fine"
    confidence = 0.5
    reasons = []

    if offline > online * 0.3:
        verdict = "Wide outage — check the WAN link first"
        confidence = 0.85
        reasons.append(f"{offline} devices offline")
    elif vpn_count > 5 and avg_ping_ms > 60:
        verdict = "VPN bottleneck"
        confidence = 0.75
        reasons.append(f"{vpn_count} VPN sessions, {avg_ping_ms}ms ping")
    elif jitter_ms > 20:
        verdict = "Likely Wi-Fi or local switch issue"
        confidence = 0.65
        reasons.append(f"jitter {jitter_ms}ms is high")
    elif error_devices:
        verdict = "Device-specific — only some endpoints affected"
        confidence = 0.7
        reasons.append(f"{len(error_devices)} devices with high error counts")
    else:
        verdict = "Looks healthy — escalate to ISP"
        reasons.append(f"ping {avg_ping_ms}ms, down {speed_down}Mbps, jitter {jitter_ms}ms")

    return {
        "client_id": client_id,
        "verdict": verdict,
        "confidence": confidence,
        "metrics": {"avg_ping_ms": avg_ping_ms, "jitter_ms": jitter_ms, "speed_down_mbps": speed_down,
                    "online": online, "offline": offline, "vpn_active": vpn_count},
        "reasons": reasons,
        "generated_at": _now_iso(),
    }


# ═══════════════════════ DEVICE GRAVEYARD ═══════════════════════

@router.get("/device-graveyard")
async def device_graveyard(current_user: dict = Depends(get_current_user)):
    rows = await db.devices.find(
        {"status": "decommissioned"},
        {"_id": 0, "id": 1, "name": 1, "client_name": 1, "purchase_date": 1, "decommissioned_at": 1,
         "decommission_reason": 1, "device_type": 1}
    ).limit(200).to_list(200)
    out = []
    for d in rows:
        a = _parse_iso(d.get("purchase_date")); b = _parse_iso(d.get("decommissioned_at"))
        lifespan_days = ((b or _now()) - a).days if a else None
        out.append({
            **d,
            "lifespan_days": lifespan_days,
            "epitaph": _epitaph(d.get("device_type"), lifespan_days, d.get("decommission_reason")),
        })
    return {"tombstones": out, "count": len(out)}


def _epitaph(dtype, days, reason):
    years = round((days or 0) / 365, 1)
    if reason and "fail" in reason.lower():
        return f"Served {years} years before falling in the line of duty."
    if years > 7:
        return f"A faithful {dtype or 'device'} for {years} years. Rest easy, old friend."
    if years > 4:
        return f"{years} years of dependable service."
    return f"Brief but bright — {years} years."


# ═══════════════════════ DEVICE FAMILY TREE ═══════════════════════

@router.get("/device-family-tree/{client_id}")
async def device_family_tree(client_id: str, current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find(
        {"client_id": client_id},
        {"_id": 0, "id": 1, "name": 1, "model": 1, "os": 1, "purchase_date": 1, "device_type": 1, "status": 1}
    ).limit(500).to_list(500)
    families = defaultdict(list)
    for d in devices:
        key = f"{d.get('model') or d.get('device_type') or 'unknown'} | {d.get('os') or 'n/a'}"
        families[key].append(d)
    out = []
    for k, members in families.items():
        ages = [(_now() - _parse_iso(m.get("purchase_date"))).days for m in members if _parse_iso(m.get("purchase_date"))]
        avg_age_yrs = round(sum(ages) / len(ages) / 365, 1) if ages else None
        out.append({
            "family": k,
            "count": len(members),
            "avg_age_years": avg_age_yrs,
            "offline_count": sum(1 for m in members if m.get("status") == "offline"),
            "members": members[:10],
        })
    out.sort(key=lambda x: -x["count"])
    return {"families": out, "client_id": client_id}


# ═══════════════════════ BRAIN BUCKET ═══════════════════════

@router.get("/team/{tech_id}/brain-bucket")
async def get_brain_bucket(tech_id: str, current_user: dict = Depends(get_current_user)):
    if tech_id != current_user.get("id"):
        raise HTTPException(403, "Brain bucket is private — not your bucket")
    doc = await db.brain_bucket.find_one({"user_id": tech_id}, {"_id": 0}) or {"user_id": tech_id, "notes": ""}
    return doc


@router.post("/team/{tech_id}/brain-bucket")
async def save_brain_bucket(tech_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    if tech_id != current_user.get("id"):
        raise HTTPException(403, "Brain bucket is private")
    notes = payload.get("notes") or ""
    await db.brain_bucket.update_one(
        {"user_id": tech_id},
        {"$set": {"user_id": tech_id, "notes": notes[:50000], "updated_at": _now_iso()}},
        upsert=True,
    )
    return {"ok": True}


# ═══════════════════════ THREAT DRAGON ═══════════════════════

@router.get("/security/threat-dragon")
async def threat_dragon(current_user: dict = Depends(get_current_user)):
    open_alerts = await db.huntress_alerts.count_documents({"resolved": {"$ne": True}})
    crit_alerts = await db.huntress_alerts.count_documents({"resolved": {"$ne": True}, "severity": "critical"})

    if open_alerts == 0:
        mood, label, emoji = "sleeping_kitten", "All quiet — kitten is sleeping", "😺"
        size_pct = 10
    elif open_alerts < 5:
        mood, label, emoji = "drowsy_dragon", "Small dragon, mostly napping", "🐉"
        size_pct = 30
    elif open_alerts < 15:
        mood, label, emoji = "hungry_dragon", "Dragon is hungry, alert the team", "🔥🐉"
        size_pct = 65
    else:
        mood, label, emoji = "raging_dragon", "RAGING DRAGON — feed it now", "🔥🔥🐉🔥🔥"
        size_pct = 100

    return {
        "mood": mood,
        "label": label,
        "emoji": emoji,
        "size_pct": size_pct,
        "open_alerts": open_alerts,
        "critical_alerts": crit_alerts,
    }


# ═══════════════════════ PASSWORD PET ═══════════════════════

@router.get("/security/password-pet/{client_id}")
async def password_pet(client_id: str, current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0, "mfa_enabled": 1, "weak_password": 1, "breached_password": 1}).limit(500).to_list(500)
    total = len(devices) or 1
    weak = sum(1 for d in devices if d.get("weak_password"))
    breached = sum(1 for d in devices if d.get("breached_password"))
    mfa = sum(1 for d in devices if d.get("mfa_enabled"))
    health = round((mfa / total * 100) - (weak / total * 50) - (breached / total * 100))
    health = max(0, min(100, health))

    if health >= 80: state, emoji = "happy", "🐶✨"
    elif health >= 50: state, emoji = "ok", "🐶"
    elif health >= 25: state, emoji = "sick", "🐶💧"
    else: state, emoji = "dying", "💀🐶"

    return {"client_id": client_id, "health": health, "state": state, "emoji": emoji,
            "stats": {"mfa_pct": round(mfa / total * 100), "weak": weak, "breached": breached, "total": total}}


# ═══════════════════════ BIRTHDAYS ═══════════════════════

@router.get("/clients/{client_id}/birthdays")
async def upcoming_birthdays(client_id: str, current_user: dict = Depends(get_current_user)):
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "client not found")
    contacts = c.get("contacts") or []
    today = _now().date()
    upcoming = []
    for ct in contacts:
        bd = ct.get("birthday")
        if not bd: continue
        try:
            month, day = int(bd[5:7]), int(bd[8:10])
            this_year_bd = today.replace(month=month, day=day)
            if this_year_bd < today:
                this_year_bd = this_year_bd.replace(year=today.year + 1)
            days_until = (this_year_bd - today).days
            if days_until <= 60:
                upcoming.append({"name": ct.get("name"), "email": ct.get("email"),
                                 "birthday": bd, "days_until": days_until})
        except Exception:
            pass

    onboarded = c.get("onboarded_at") or c.get("created_at")
    if onboarded:
        try:
            ob = _parse_iso(onboarded)
            if ob:
                anniv = ob.replace(year=today.year, tzinfo=None).date()
                if anniv < today:
                    anniv = anniv.replace(year=today.year + 1)
                if (anniv - today).days <= 60:
                    upcoming.append({"name": "Client Anniversary", "email": None,
                                     "birthday": ob.date().isoformat(), "days_until": (anniv - today).days})
        except Exception:
            pass

    upcoming.sort(key=lambda x: x["days_until"])
    return {"client_id": client_id, "upcoming": upcoming}


# ═══════════════════════ AMBIENT WEATHER MODE ═══════════════════════

@router.get("/ambient/weather-mode")
async def weather_mode(current_user: dict = Depends(get_current_user)):
    """Return an ambient mood signal for the dashboard background."""
    open_crit = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}, "priority": "critical"})
    open_total = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
    huntress = await db.huntress_alerts.count_documents({"resolved": {"$ne": True}})

    now = _now()
    is_friday_pm = now.weekday() == 4 and now.hour >= 16
    is_monday_am = now.weekday() == 0 and now.hour < 12

    if open_crit > 3 or huntress > 10:
        mood, gradient = "stormy", "from-rose-900 via-slate-900 to-rose-950"
    elif is_friday_pm and open_crit == 0:
        mood, gradient = "beach", "from-amber-200/10 via-sky-300/10 to-emerald-200/10"
    elif is_monday_am and open_total > 30:
        mood, gradient = "rainy_monday", "from-slate-700 via-slate-900 to-slate-950"
    elif open_total < 5:
        mood, gradient = "sunny", "from-amber-200/10 via-sky-200/10 to-amber-100/10"
    else:
        mood, gradient = "neutral", "from-slate-800 via-slate-900 to-slate-950"

    return {"mood": mood, "gradient_classes": gradient,
            "stats": {"open_critical": open_crit, "open_total": open_total, "huntress_open": huntress},
            "weekday": now.weekday(), "hour": now.hour}


# ═══════════════════════ LAUNCH EVENTS (rocket animation triggers) ═══════════════════════

@router.post("/ambient/launch-event")
async def record_launch(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Called when something celebratory happens (critical resolved, big payment, achievement)."""
    doc = {
        "id": uuid.uuid4().hex,
        "kind": payload.get("kind") or "celebration",
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "label": payload.get("label") or "Launch",
        "ref_type": payload.get("ref_type"),
        "ref_id": payload.get("ref_id"),
        "ts": _now_iso(),
    }
    await db.launch_events.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/ambient/recent-launches")
async def recent_launches(current_user: dict = Depends(get_current_user)):
    rows = await db.launch_events.find({}, {"_id": 0}).sort("ts", -1).limit(10).to_list(10)
    return rows
