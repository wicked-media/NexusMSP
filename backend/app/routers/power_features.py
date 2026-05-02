"""Power Features — 24 compounding composites on top of the Mega Bundle.

Chain reactions / automations:
  1  smart_assign           POST /api/tickets/{id}/smart-assign
  2  doppel_resolution       GET /api/tickets/{id}/doppelganger-resolution
  3  sentiment_apology_queue POST /api/ai/apology-queue/scan
  4  sla_auto_page          POST /api/sla-radar/auto-page
  5  promise_reconcile      POST /api/payment-promises/reconcile
  6  cognitive_rebalance     GET /api/team/{tech_id}/rebalance-suggestions
  7  patch_pause_trmm       POST /api/patches/anomalies/{patch_id}/pause-trmm

Revenue amplifiers:
  8  unbilled_dollars        GET /api/finance/unbilled-dollars
  9  revenue_at_risk         GET /api/finance/revenue-at-risk
 10  pricing_compliance      GET /api/finance/pricing-compliance

Unified screens:
 11  command_center          GET /api/command-center
 12  client_dossier_pdf      GET /api/clients/{id}/dossier.pdf
 13  monday_prep             GET /api/briefings/monday-prep

Gamification:
 14  team_leaderboard        GET /api/team/leaderboard
 15  drill_streaks           GET /api/team/streaks

Retention:
 16  monthly_recap           GET /api/clients/{id}/monthly-recap
 17  insurance_action_plan   GET /api/clients/{id}/insurance-action-plan
 18  pre_call_brief          GET /api/clients/{id}/pre-call-brief

AI extensions:
 19  daily_tech_briefing     GET /api/team/{id}/daily-briefing
 20  scope_drift             GET /api/tickets/{id}/scope-drift
 21  quality_audit          POST /api/tickets/quality-audit

Operations moonshots:
 22  capacity_forecast       GET /api/forecasting/capacity
 23  client_benchmark        GET /api/clients/{id}/benchmark
 24  schedule_insurance     POST /api/security/insurance-vault/schedule
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import Response
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import os
import re
import json
import uuid
import random
from typing import Optional

from app.database import db
from app.auth import get_current_user

router = APIRouter()

MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-sonnet-4-5-20250929"


async def _llm(system: str, user_msg: str, session_prefix: str = "pow") -> str:
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(503, "AI not configured")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    chat = LlmChat(
        api_key=api_key,
        session_id=f"{session_prefix}-{uuid.uuid4().hex[:8]}",
        system_message=system,
    ).with_model(MODEL_PROVIDER, MODEL_NAME)
    raw = await chat.send_message(UserMessage(text=user_msg))
    return raw.strip() if isinstance(raw, str) else str(raw)


def _safe_json(text: str) -> dict:
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(s) -> Optional[datetime]:
    if not s:
        return None
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


# ═══════════════════════ 1. SMART ASSIGN ═══════════════════════

@router.post("/tickets/{ticket_id}/smart-assign")
async def smart_assign(ticket_id: str, current_user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")

    category = t.get("category") or "general"
    tags = t.get("tags") or []

    # Load techs + compute scores
    techs = await db.users.find(
        {"role": {"$in": ["technician", "admin", "tech", "engineer"]}},
        {"_id": 0, "id": 1, "name": 1, "email": 1}
    ).to_list(200)

    roster = await db.tech_roster.find({"active": {"$ne": False}}, {"_id": 0}).to_list(200)
    roster_by_email = {r.get("email"): r for r in roster if r.get("email")}

    # Compute load for each tech
    open_tx = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "pending", "waiting"]}},
        {"_id": 0, "assignee_id": 1, "assignee_name": 1, "priority": 1}
    ).to_list(2000)

    load = defaultdict(int)
    for x in open_tx:
        key = x.get("assignee_id") or x.get("assignee_name")
        if not key:
            continue
        w = {"critical": 10, "high": 5, "medium": 3, "normal": 3}.get(x.get("priority"), 2)
        load[key] += w

    # Pull XP from closed tickets per tech per category
    closed = await db.tickets.find(
        {"status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "assignee_id": 1, "assignee_name": 1, "category": 1, "tags": 1}
    ).to_list(3000)

    xp_by_tech = defaultdict(lambda: defaultdict(int))
    for c in closed:
        key = c.get("assignee_id") or c.get("assignee_name")
        if not key:
            continue
        if c.get("category"):
            xp_by_tech[key][c["category"]] += 10
        for tg in (c.get("tags") or [])[:3]:
            xp_by_tech[key][tg] += 5

    candidates = []
    for tech in techs:
        keys = [tech["id"], tech.get("name"), tech.get("email")]
        tech_xp = 0
        for k in keys:
            tech_xp += xp_by_tech[k].get(category, 0)
            for tg in tags:
                tech_xp += xp_by_tech[k].get(tg, 0)

        tech_load = max(load[tech["id"]], load[tech.get("name")], load[tech.get("email")])
        on_call = roster_by_email.get(tech.get("email"), {}).get("on_call", True)
        available = roster_by_email.get(tech.get("email"), {}).get("active", True)

        # Score: higher XP good, lower load good. Huge penalty if load > 60 (burnout).
        score = tech_xp - tech_load * 2
        if tech_load > 60:
            score -= 200
        if not on_call:
            score -= 50
        if not available:
            score -= 500

        candidates.append({
            "tech_id": tech["id"],
            "name": tech.get("name"),
            "email": tech.get("email"),
            "xp_for_category": tech_xp,
            "current_load": tech_load,
            "on_call": on_call,
            "score": score,
            "reason": f"XP {tech_xp} in {category}, load {tech_load}, {'on-call' if on_call else 'off-shift'}",
        })

    candidates.sort(key=lambda x: -x["score"])
    if not candidates:
        raise HTTPException(400, "No technicians available")

    return {
        "ticket_id": ticket_id,
        "top_pick": candidates[0],
        "alternatives": candidates[1:4],
        "total_candidates": len(candidates),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 2. DOPPELGÄNGER RESOLUTION SUGGEST ═══════════════════════

@router.get("/tickets/{ticket_id}/doppelganger-resolution")
async def doppelganger_resolution(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Return the resolution of the most similar closed ticket as a copy-paste suggestion."""
    target = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Ticket not found")

    title = (target.get("title") or "").lower()
    keywords = [w for w in re.findall(r"[a-z0-9]{4,}", title)
                if w not in {"ticket", "issue", "problem", "error", "with", "from", "this", "test"}][:6]
    if not keywords:
        return {"suggestion": None, "reason": "Insufficient keywords"}

    regex = "|".join(re.escape(k) for k in keywords)
    candidates = await db.tickets.find(
        {"id": {"$ne": ticket_id},
         "status": {"$in": ["resolved", "closed"]},
         "resolution_notes": {"$exists": True, "$ne": ""},
         "$or": [
             {"title": {"$regex": regex, "$options": "i"}},
             {"description": {"$regex": regex, "$options": "i"}},
         ]},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "resolution_notes": 1, "resolved_at": 1}
    ).limit(20).to_list(20)

    target_set = set(keywords)
    best = None
    best_sim = 0
    for c in candidates:
        ctext = ((c.get("title") or "") + " " + (c.get("resolution_notes") or "")).lower()
        ctokens = set(re.findall(r"[a-z0-9]{4,}", ctext))
        overlap = len(target_set & ctokens)
        if overlap > best_sim:
            best_sim = overlap
            best = c

    if not best:
        return {"suggestion": None, "reason": "No similar resolved ticket found"}

    return {
        "ticket_id": ticket_id,
        "suggestion": {
            "ticket_id": best["id"],
            "ticket_number": best.get("ticket_number"),
            "title": best.get("title"),
            "resolution_notes": best.get("resolution_notes"),
            "resolved_at": best.get("resolved_at"),
            "similarity_score": round(best_sim / max(len(target_set), 1) * 100),
        },
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 3. SENTIMENT → APOLOGY QUEUE ═══════════════════════

@router.post("/ai/apology-queue/scan")
async def apology_queue_scan(current_user: dict = Depends(get_current_user)):
    """Scan sentiment log for escalations in the last 24h and queue apology drafts to review."""
    cutoff = (_now() - timedelta(hours=24)).isoformat()

    rows = await db.ticket_sentiment_log.find(
        {"created_at": {"$gte": cutoff}, "flag": "escalating"},
        {"_id": 0}
    ).sort("created_at", -1).limit(100).to_list(100)

    seen = set()
    queued = []
    for r in rows:
        tid = r.get("ticket_id")
        if not tid or tid in seen:
            continue
        seen.add(tid)
        existing = await db.apology_queue.find_one({"ticket_id": tid, "status": "pending"}, {"_id": 0})
        if existing:
            continue
        doc = {
            "id": uuid.uuid4().hex,
            "ticket_id": tid,
            "reason": r.get("reasoning") or "Sentiment escalating",
            "queued_at": _now().isoformat(),
            "status": "pending",
        }
        await db.apology_queue.insert_one(dict(doc))
        doc.pop("_id", None)
        queued.append(doc)

    pending = await db.apology_queue.find({"status": "pending"}, {"_id": 0}).sort("queued_at", -1).to_list(100)
    return {"queued_new": len(queued), "queue": pending, "generated_at": _now().isoformat()}


# ═══════════════════════ 4. SLA AUTO-PAGE ═══════════════════════

@router.post("/sla-radar/auto-page")
async def sla_auto_page(min_score: int = 85, current_user: dict = Depends(get_current_user)):
    """For tickets with SLA-radar score >= min_score, create a war-room page entry."""
    # Re-compute SLA scores inline (same logic as the radar endpoint)
    tx = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "pending"]}},
        {"_id": 0}
    ).limit(500).to_list(500)

    now = _now()
    high_risk = []
    for t in tx:
        created = _parse_iso(t.get("created_at")) or now
        sla_due = _parse_iso(t.get("sla_due_at"))
        last_activity = _parse_iso(t.get("updated_at") or t.get("created_at")) or created
        priority = t.get("priority", "normal")

        sla_window_min = {"critical": 240, "high": 480, "medium": 1440, "normal": 2880}.get(priority, 2880)
        age_min = (now - created).total_seconds() / 60
        age_pct = age_min / sla_window_min * 100
        inactivity_min = (now - last_activity).total_seconds() / 60

        score = 0
        if age_pct > 150: score += 40
        elif age_pct > 100: score += 30
        elif age_pct > 75: score += 15
        if inactivity_min > 240: score += 25
        if priority == "critical": score += 20
        elif priority == "high": score += 10
        if sla_due and now > sla_due: score += 30

        if score >= min_score:
            high_risk.append({"ticket": t, "score": score})

    paged = []
    for row in high_risk:
        t = row["ticket"]
        tid = t["id"]
        existing = await db.sla_auto_pages.find_one({"ticket_id": tid, "cleared": {"$ne": True}}, {"_id": 0})
        if existing:
            continue
        doc = {
            "id": uuid.uuid4().hex,
            "ticket_id": tid,
            "ticket_number": t.get("ticket_number"),
            "score": row["score"],
            "paged_at": _now().isoformat(),
            "cleared": False,
        }
        await db.sla_auto_pages.insert_one(dict(doc))
        await db.notifications.insert_one({
            "id": uuid.uuid4().hex,
            "type": "sla_auto_page",
            "title": f"🚨 SLA risk: {t.get('ticket_number')}",
            "body": f"Score {row['score']}/100 — {t.get('title', '')[:100]}",
            "ref_type": "ticket",
            "ref_id": tid,
            "read": False,
            "created_at": _now().isoformat(),
        })
        doc.pop("_id", None)
        paged.append(doc)

    return {"scanned": len(tx), "new_pages_fired": len(paged), "pages": paged}


# ═══════════════════════ 5. PAYMENT PROMISE → CHURN BUMP ═══════════════════════

@router.post("/payment-promises/reconcile")
async def promise_reconcile(current_user: dict = Depends(get_current_user)):
    """Find broken payment promises and bump client churn risk."""
    today = _now().date().isoformat()
    broken = await db.payment_promises.find(
        {"status": "pending", "promised_date": {"$lt": today}},
        {"_id": 0}
    ).to_list(200)

    bumped_clients = defaultdict(int)
    for p in broken:
        await db.payment_promises.update_one({"id": p["id"]}, {"$set": {"status": "broken", "broken_at": _now().isoformat()}})
        inv = await db.invoices.find_one({"id": p.get("invoice_id")}, {"_id": 0, "client_id": 1})
        if inv and inv.get("client_id"):
            bumped_clients[inv["client_id"]] += 1

    # Apply churn bump
    for cid, count in bumped_clients.items():
        bump = min(30, count * 10)
        existing = await db.churn_risk.find_one({"client_id": cid}, {"_id": 0, "score": 1}) or {}
        new_score = min(100, float(existing.get("score") or 25) + bump)
        await db.churn_risk.update_one(
            {"client_id": cid},
            {"$set": {"score": new_score, "last_bumped_at": _now().isoformat(), "last_bump_reason": f"{count} broken payment promises"}},
            upsert=True,
        )

    return {"broken_count": len(broken), "clients_bumped": len(bumped_clients), "bumps": dict(bumped_clients)}


# ═══════════════════════ 6. COGNITIVE OVERLOAD REBALANCE ═══════════════════════

@router.get("/team/{tech_id}/rebalance-suggestions")
async def rebalance_suggestions(tech_id: str, current_user: dict = Depends(get_current_user)):
    """Suggest 3 lowest-priority tickets to reassign off an overloaded tech."""
    tech = await db.users.find_one({"$or": [{"id": tech_id}, {"email": tech_id}]}, {"_id": 0})
    if not tech:
        raise HTTPException(404, "Tech not found")

    open_tx = await db.tickets.find(
        {"$or": [{"assignee_id": tech["id"]}, {"assignee_name": tech.get("name")}],
         "status": {"$in": ["open", "in_progress", "pending"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "created_at": 1, "client_name": 1}
    ).limit(200).to_list(200)

    # Keep criticals and high; suggest to offload lower priority with oldest activity
    priority_weight = {"critical": 4, "high": 3, "medium": 2, "normal": 1}
    open_tx.sort(key=lambda t: (priority_weight.get(t.get("priority"), 1), -(int(((_parse_iso(t.get("created_at")) or _now())).timestamp()))))

    to_offload = open_tx[:3]
    return {
        "tech_id": tech["id"],
        "tech_name": tech.get("name"),
        "total_open": len(open_tx),
        "offload_candidates": to_offload,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 7. PATCH → PAUSE TRMM ═══════════════════════

@router.post("/patches/anomalies/{patch_id}/pause-trmm")
async def pause_trmm_for_patch(patch_id: str, current_user: dict = Depends(get_current_user)):
    """Cancel any scheduled TRMM broadcasts referencing a flagged KB."""
    patch_id = patch_id.upper()
    matched = 0
    if "trmm_scheduled_broadcasts" in await db.list_collection_names():
        res = await db.trmm_scheduled_broadcasts.update_many(
            {"status": "scheduled",
             "$or": [{"command": {"$regex": patch_id, "$options": "i"}},
                     {"label": {"$regex": patch_id, "$options": "i"}}]},
            {"$set": {"status": "paused", "paused_reason": f"Patch anomaly {patch_id}", "paused_at": _now().isoformat()}},
        )
        matched = res.modified_count

    await db.notifications.insert_one({
        "id": uuid.uuid4().hex,
        "type": "patch_trmm_paused",
        "title": f"🛑 {matched} TRMM broadcast(s) paused",
        "body": f"Paused because patch {patch_id} was flagged as an anomaly.",
        "ref_type": "patch",
        "ref_id": patch_id,
        "read": False,
        "created_at": _now().isoformat(),
    })

    return {"patch_id": patch_id, "broadcasts_paused": matched}


# ═══════════════════════ 8. UNBILLED DOLLARS ═══════════════════════

@router.get("/finance/unbilled-dollars")
async def unbilled_dollars(current_user: dict = Depends(get_current_user)):
    """Total $ in logged-but-unbilled time across all resolved tickets."""
    since = (_now() - timedelta(days=90)).isoformat()
    tx = await db.tickets.find(
        {"resolved_at": {"$gte": since}, "time_entries": {"$exists": True, "$ne": []}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_id": 1, "client_name": 1,
         "time_entries": 1, "invoiced": 1, "billed": 1, "resolved_at": 1}
    ).limit(1000).to_list(1000)

    DEFAULT_RATE = 120.0  # $/hour - fallback
    total_mins = 0
    total_dollars = 0.0
    by_client = defaultdict(lambda: {"minutes": 0, "dollars": 0.0, "tickets": 0, "client_name": None})
    unbilled_rows = []

    for t in tx:
        if t.get("invoiced") or t.get("billed"):
            continue
        mins = sum(int(te.get("duration_minutes") or 0) for te in (t.get("time_entries") or []) if te.get("billable", True))
        if mins <= 0:
            continue
        rate = DEFAULT_RATE
        dollars = mins / 60 * rate
        total_mins += mins
        total_dollars += dollars
        cid = t.get("client_id") or "unknown"
        by_client[cid]["minutes"] += mins
        by_client[cid]["dollars"] += dollars
        by_client[cid]["tickets"] += 1
        by_client[cid]["client_name"] = t.get("client_name")
        unbilled_rows.append({
            "ticket_id": t["id"],
            "ticket_number": t.get("ticket_number"),
            "client_name": t.get("client_name"),
            "minutes": mins,
            "dollars": round(dollars, 2),
            "resolved_at": t.get("resolved_at"),
        })

    unbilled_rows.sort(key=lambda r: -r["dollars"])
    client_list = sorted(
        [{"client_id": cid, "client_name": v["client_name"], "minutes": v["minutes"],
          "dollars": round(v["dollars"], 2), "tickets": v["tickets"]}
         for cid, v in by_client.items()],
        key=lambda x: -x["dollars"],
    )

    return {
        "total_minutes": total_mins,
        "total_dollars": round(total_dollars, 2),
        "rate_used_per_hour": DEFAULT_RATE,
        "by_client": client_list[:20],
        "top_tickets": unbilled_rows[:20],
        "window_days": 90,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 9. REVENUE AT RISK ═══════════════════════

@router.get("/finance/revenue-at-risk")
async def revenue_at_risk(current_user: dict = Depends(get_current_user)):
    """Aggregate total $ at risk across aged AR, cold estimates, and high-churn clients."""
    # Aged AR
    rows = await db.invoices.find(
        {"status": {"$in": ["sent", "overdue", "partial"]}},
        {"_id": 0, "total": 1, "amount_paid": 1, "due_date": 1, "client_id": 1}
    ).limit(1000).to_list(1000)
    now = _now()
    aged_ar_total = 0.0
    overdue_60plus = 0.0
    for r in rows:
        bal = float(r.get("total") or 0) - float(r.get("amount_paid") or 0)
        if bal <= 0: continue
        aged_ar_total += bal
        due = _parse_iso(r.get("due_date"))
        if due and (now - due).days > 60:
            overdue_60plus += bal

    # Cold estimates (low win prob)
    estimates = await db.estimates.find(
        {"status": {"$in": ["published", "sent"]}},
        {"_id": 0, "total": 1, "created_at": 1, "client_id": 1}
    ).limit(500).to_list(500)
    cold_estimates_total = 0.0
    for e in estimates:
        created = _parse_iso(e.get("created_at"))
        age_days = (now - created).days if created else 0
        if age_days > 14:
            cold_estimates_total += float(e.get("total") or 0) * 0.6  # risk-weighted

    # High-churn clients
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "mrr": 1}).to_list(500)
    churn_rows = await db.churn_risk.find({"score": {"$gte": 60}}, {"_id": 0}).to_list(500)
    high_churn_by_id = {r["client_id"]: r for r in churn_rows}
    high_churn_annual_total = 0.0
    churn_breakdown = []
    for c in clients:
        cr = high_churn_by_id.get(c["id"])
        if not cr: continue
        mrr = float(c.get("mrr") or 0)
        annual = mrr * 12
        risk_weight = float(cr.get("score") or 0) / 100
        at_risk = annual * risk_weight
        high_churn_annual_total += at_risk
        churn_breakdown.append({
            "client_id": c["id"], "name": c.get("name"), "mrr": mrr,
            "annual": annual, "churn_score": cr.get("score"),
            "at_risk": round(at_risk, 2),
        })
    churn_breakdown.sort(key=lambda x: -x["at_risk"])

    total = aged_ar_total + cold_estimates_total + high_churn_annual_total

    return {
        "total_at_risk": round(total, 2),
        "breakdown": {
            "aged_ar": round(aged_ar_total, 2),
            "overdue_60plus": round(overdue_60plus, 2),
            "cold_estimates_risk_weighted": round(cold_estimates_total, 2),
            "high_churn_annual_risk": round(high_churn_annual_total, 2),
        },
        "top_churn_clients": churn_breakdown[:10],
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 10. PRICING COMPLIANCE ═══════════════════════

@router.get("/finance/pricing-compliance")
async def pricing_compliance(current_user: dict = Depends(get_current_user)):
    """Aggregate pricing-flag violations across all recent estimates."""
    since = (_now() - timedelta(days=60)).isoformat()
    ests = await db.estimates.find(
        {"created_at": {"$gte": since}},
        {"_id": 0, "id": 1, "estimate_number": 1, "line_items": 1, "total": 1, "client_name": 1}
    ).limit(500).to_list(500)

    products = await db.products.find({}, {"_id": 0, "name": 1, "unit_price": 1, "cost": 1}).to_list(2000)
    by_name = {p["name"].lower(): p for p in products if p.get("name")}

    violations = []
    total_underpriced = 0.0
    total_below_margin = 0.0
    for e in ests:
        for li in (e.get("line_items") or []):
            name = (li.get("name") or li.get("description") or "").lower()
            unit = float(li.get("unit_price") or 0)
            qty = float(li.get("quantity") or 1)
            match = by_name.get(name)
            if not match: continue
            std = float(match.get("unit_price") or 0)
            cost = float(match.get("cost") or 0)
            if std > 0 and unit < std * 0.85:
                gap = (std - unit) * qty
                total_underpriced += gap
                violations.append({
                    "estimate_number": e.get("estimate_number"),
                    "client_name": e.get("client_name"),
                    "item": li.get("name"),
                    "gap_dollars": round(gap, 2),
                    "kind": "below_standard",
                })
            if cost > 0 and unit < cost * 1.2:
                gap = (cost * 1.2 - unit) * qty
                total_below_margin += gap
                violations.append({
                    "estimate_number": e.get("estimate_number"),
                    "client_name": e.get("client_name"),
                    "item": li.get("name"),
                    "gap_dollars": round(gap, 2),
                    "kind": "below_margin",
                })

    violations.sort(key=lambda x: -x["gap_dollars"])
    return {
        "total_underpriced_dollars": round(total_underpriced, 2),
        "total_below_margin_dollars": round(total_below_margin, 2),
        "total_violations": len(violations),
        "top_violations": violations[:25],
        "estimates_scanned": len(ests),
        "window_days": 60,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 11. COMMAND CENTER ═══════════════════════

@router.get("/command-center")
async def command_center(current_user: dict = Depends(get_current_user)):
    """Single endpoint collecting the 'what's on fire right now' view."""
    now = _now()

    # SLA radar mini
    tx = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "pending"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1, "priority": 1, "created_at": 1, "updated_at": 1, "sla_due_at": 1}
    ).limit(500).to_list(500)

    sla_hot = []
    for t in tx:
        created = _parse_iso(t.get("created_at")) or now
        sla_window = {"critical": 240, "high": 480, "medium": 1440, "normal": 2880}.get(t.get("priority"), 2880)
        age_pct = (now - created).total_seconds() / 60 / sla_window * 100
        if age_pct > 100 or t.get("priority") == "critical":
            sla_hot.append({"ticket_id": t["id"], "ticket_number": t.get("ticket_number"),
                            "title": t.get("title", "")[:80], "client_name": t.get("client_name"),
                            "priority": t.get("priority"), "age_pct": round(age_pct)})
    sla_hot.sort(key=lambda x: -x["age_pct"])

    # Sentiment escalations 24h
    cutoff = (now - timedelta(hours=24)).isoformat()
    sent_escalations = await db.ticket_sentiment_log.count_documents({"created_at": {"$gte": cutoff}, "flag": "escalating"})

    # Patch anomalies count
    patch_anomaly_count = await db.patch_broadcasts.count_documents({"last_client_count": {"$gte": 3}})

    # Cognitive load top 3 over-threshold
    open_tx_all = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "pending", "waiting"]}},
        {"_id": 0, "assignee_id": 1, "assignee_name": 1, "priority": 1}
    ).to_list(2000)
    load = defaultdict(list)
    for x in open_tx_all:
        key = x.get("assignee_name") or x.get("assignee_id")
        if key: load[key].append(x)
    overloaded = []
    for name, tix in load.items():
        score = min(100, len(tix) * 4 + sum(10 for x in tix if x.get("priority") == "critical") + sum(5 for x in tix if x.get("priority") == "high"))
        if score >= 60:
            overloaded.append({"tech": name, "score": score, "count": len(tix)})
    overloaded.sort(key=lambda x: -x["score"])

    return {
        "sla_hot": sla_hot[:8],
        "sla_hot_count": len(sla_hot),
        "sentiment_escalations_24h": sent_escalations,
        "patch_anomaly_count": patch_anomaly_count,
        "overloaded_techs": overloaded[:5],
        "generated_at": now.isoformat(),
    }


# ═══════════════════════ 12. CLIENT 360 DOSSIER PDF ═══════════════════════

def _safe_pdf(s) -> str:
    if s is None: return ""
    return str(s).encode("latin-1", "replace").decode("latin-1")


@router.get("/clients/{client_id}/dossier.pdf")
async def client_dossier_pdf(client_id: str, current_user: dict = Depends(get_current_user)):
    from fpdf import FPDF
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Client not found")

    tx = await db.tickets.find({"client_id": client_id}, {"_id": 0, "status": 1, "priority": 1, "category": 1}).limit(500).to_list(500)
    devices_count = await db.devices.count_documents({"client_id": client_id})
    cr = await db.churn_risk.find_one({"client_id": client_id}, {"_id": 0, "score": 1}) or {}
    last_year = (_now() - timedelta(days=365)).isoformat()
    inv = await db.invoices.find(
        {"client_id": client_id, "issue_date": {"$gte": last_year}, "status": {"$ne": "void"}},
        {"_id": 0, "total": 1}
    ).to_list(200)
    rev_12m = sum(float(x.get("total") or 0) for x in inv)

    cat_count = defaultdict(int)
    for t in tx:
        if t.get("category"): cat_count[t["category"]] += 1

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.add_page()

    pdf.set_fill_color(15, 23, 42)
    pdf.rect(0, 0, 210, 30, style="F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_xy(12, 8)
    pdf.cell(0, 10, _safe_pdf(f"{c.get('name','')}"), ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_x(12)
    pdf.cell(0, 6, _safe_pdf(f"Client Dossier · Generated {_now().strftime('%d %B %Y')}"), ln=True)

    pdf.set_text_color(0, 0, 0)
    pdf.ln(12)

    # Metrics grid
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, _safe_pdf("At a glance"), ln=True)
    pdf.set_font("Helvetica", "", 11)
    pdf.cell(0, 6, _safe_pdf(f"MRR: ${float(c.get('mrr') or 0):,.2f}  -  12m revenue: ${rev_12m:,.2f}  -  Churn score: {cr.get('score', 25)}/100"), ln=True)
    pdf.cell(0, 6, _safe_pdf(f"Tickets: {len(tx)}  -  Devices: {devices_count}  -  Industry: {c.get('industry','-')}"), ln=True)
    pdf.cell(0, 6, _safe_pdf(f"Contact: {c.get('contact_name','-')} | {c.get('email','-')}"), ln=True)
    pdf.ln(5)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, _safe_pdf("Top complaint categories"), ln=True)
    pdf.set_font("Helvetica", "", 11)
    top = sorted(cat_count.items(), key=lambda x: -x[1])[:5]
    if not top:
        pdf.cell(0, 6, _safe_pdf("No category data."), ln=True)
    for k, v in top:
        pdf.cell(0, 6, _safe_pdf(f"  - {k}: {v} tickets"), ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, _safe_pdf("Priority mix"), ln=True)
    pdf.set_font("Helvetica", "", 11)
    prio = defaultdict(int)
    for t in tx: prio[t.get("priority") or "normal"] += 1
    for k in ("critical", "high", "medium", "normal"):
        if prio[k]:
            pdf.cell(0, 6, _safe_pdf(f"  - {k}: {prio[k]}"), ln=True)
    pdf.ln(4)

    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(100, 116, 139)
    pdf.cell(0, 5, _safe_pdf(f"Prepared by {current_user.get('name','')} - NexusOps"), ln=True)

    raw = pdf.output(dest="S")
    if isinstance(raw, str): raw = raw.encode("latin-1")
    else: raw = bytes(raw)
    return Response(content=raw, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="dossier-{c.get("name","client").replace(" ","-").lower()}-{_now().strftime("%Y%m%d")}.pdf"'})


# ═══════════════════════ 13. MONDAY PREP PACK ═══════════════════════

@router.get("/briefings/monday-prep")
async def monday_prep(current_user: dict = Depends(get_current_user)):
    now = _now()
    week_ago = (now - timedelta(days=7)).isoformat()

    # Ticket deltas
    new_last_week = await db.tickets.count_documents({"created_at": {"$gte": week_ago}})
    closed_last_week = await db.tickets.count_documents({"resolved_at": {"$gte": week_ago}})
    open_now = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress", "pending"]}})

    # Aged AR shift (vs previous)
    overdue = await db.invoices.find(
        {"status": {"$in": ["sent", "overdue"]}, "due_date": {"$lt": now.date().isoformat()}},
        {"_id": 0, "total": 1, "amount_paid": 1}
    ).limit(500).to_list(500)
    overdue_total = sum(float(r.get("total") or 0) - float(r.get("amount_paid") or 0) for r in overdue if (float(r.get("total") or 0) - float(r.get("amount_paid") or 0)) > 0)

    # Estimates expiring
    cold_est = await db.estimates.count_documents({"status": {"$in": ["published", "sent"]}, "created_at": {"$lt": (now - timedelta(days=14)).isoformat()}})

    # High-churn count
    high_churn = await db.churn_risk.count_documents({"score": {"$gte": 60}})

    # Criticals open
    criticals = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress", "pending"]}, "priority": "critical"})

    return {
        "week_starting": now.date().isoformat(),
        "tickets": {"new": new_last_week, "closed": closed_last_week, "open_now": open_now, "criticals_open": criticals},
        "finance": {"overdue_total": round(overdue_total, 2), "cold_estimates_count": cold_est},
        "clients": {"high_churn_count": high_churn},
        "focus_areas": _build_focus(new_last_week, closed_last_week, criticals, overdue_total, cold_est, high_churn),
        "generated_at": now.isoformat(),
    }


def _build_focus(new_, closed, crit, overdue, cold_est, churn):
    items = []
    if crit > 0: items.append(f"{crit} critical ticket(s) still open — triage first")
    if new_ > closed * 1.3: items.append("Ticket backlog growing — demand > throughput")
    if overdue > 10000: items.append(f"${overdue:,.0f} overdue — AR chase required")
    if cold_est > 5: items.append(f"{cold_est} stale estimates — follow up this week")
    if churn > 3: items.append(f"{churn} high-churn clients — schedule QBRs")
    return items or ["Quiet week — push preventative work (patch drills, blueprints)"]


# ═══════════════════════ 14. TEAM LEADERBOARD ═══════════════════════

@router.get("/team/leaderboard")
async def team_leaderboard(current_user: dict = Depends(get_current_user)):
    techs = await db.users.find({"role": {"$in": ["technician", "admin", "tech", "engineer"]}},
                                {"_id": 0, "id": 1, "name": 1}).to_list(200)

    closed = await db.tickets.find(
        {"status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "assignee_name": 1, "priority": 1, "category": 1, "tags": 1}
    ).to_list(5000)

    drills = await db.backup_drills.find({"status": "completed"}, {"_id": 0, "completed_by": 1}).to_list(500)
    runbooks = await db.runbooks.find({"published": True}, {"_id": 0, "created_by": 1}).to_list(500)

    xp_for = defaultdict(int)
    for t in closed:
        key = t.get("assignee_name")
        if not key: continue
        gain = {"critical": 35, "high": 20, "medium": 10, "normal": 10}.get(t.get("priority"), 10)
        xp_for[key] += gain
    for d in drills:
        k = d.get("completed_by")
        if k: xp_for[k] += 50
    for r in runbooks:
        k = r.get("created_by")
        if k: xp_for[k] += 30

    rows = []
    for tech in techs:
        n = tech.get("name")
        xp = xp_for.get(n, 0)
        rows.append({
            "tech_id": tech["id"],
            "name": n,
            "total_xp": xp,
            "level": 1 + xp // 500,
            "closed_tickets": sum(1 for t in closed if t.get("assignee_name") == n),
            "drills_led": sum(1 for d in drills if d.get("completed_by") == n),
            "runbooks_published": sum(1 for r in runbooks if r.get("created_by") == n),
        })
    rows.sort(key=lambda x: -x["total_xp"])
    for i, r in enumerate(rows): r["rank"] = i + 1
    return {"leaderboard": rows, "generated_at": _now().isoformat()}


# ═══════════════════════ 15. DRILL STREAK TRACKER ═══════════════════════

@router.get("/team/streaks")
async def drill_streaks(current_user: dict = Depends(get_current_user)):
    now = _now()
    drills = await db.backup_drills.find({"status": "completed"}, {"_id": 0}).sort("completed_at", -1).to_list(500)

    by_tech = defaultdict(list)
    for d in drills:
        k = d.get("completed_by")
        if k:
            ts = _parse_iso(d.get("completed_at"))
            if ts: by_tech[k].append(ts)

    streak_rows = []
    for tech, dates in by_tech.items():
        dates.sort(reverse=True)
        # Week-streak: each consecutive week needs at least 1 drill
        weeks = set()
        for d in dates:
            weeks.add((d.isocalendar().year, d.isocalendar().week))
        current_streak = 0
        check = now
        while True:
            iso = (check.isocalendar().year, check.isocalendar().week)
            if iso in weeks:
                current_streak += 1
                check = check - timedelta(days=7)
            else:
                break
        streak_rows.append({
            "tech": tech,
            "current_week_streak": current_streak,
            "total_drills": len(dates),
            "last_drill_at": dates[0].isoformat() if dates else None,
        })
    streak_rows.sort(key=lambda x: -x["current_week_streak"])
    return {"streaks": streak_rows, "generated_at": now.isoformat()}


# ═══════════════════════ 16. MONTHLY CLIENT RECAP ═══════════════════════

@router.get("/clients/{client_id}/monthly-recap")
async def monthly_recap(client_id: str, current_user: dict = Depends(get_current_user)):
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Client not found")

    start_of_month = _now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    start_iso = start_of_month.isoformat()

    resolved = await db.tickets.find(
        {"client_id": client_id, "resolved_at": {"$gte": start_iso}},
        {"_id": 0, "title": 1, "priority": 1, "resolution_notes": 1}
    ).to_list(100)
    new_ = await db.tickets.count_documents({"client_id": client_id, "created_at": {"$gte": start_iso}})

    devices = await db.devices.count_documents({"client_id": client_id})

    avg_resolve_hrs = None
    resolution_hrs = []
    tx = await db.tickets.find(
        {"client_id": client_id, "resolved_at": {"$gte": start_iso}, "created_at": {"$exists": True}},
        {"_id": 0, "created_at": 1, "resolved_at": 1}
    ).to_list(200)
    for t in tx:
        a = _parse_iso(t.get("created_at"))
        b = _parse_iso(t.get("resolved_at"))
        if a and b and b > a:
            resolution_hrs.append((b - a).total_seconds() / 3600)
    if resolution_hrs:
        avg_resolve_hrs = round(sum(resolution_hrs) / len(resolution_hrs), 1)

    system = (
        "You are a friendly MSP account manager writing a monthly recap email to a business client. "
        "Celebrate specific numbers. 3 short paragraphs. NO markdown. Return STRICT JSON ONLY: "
        "{subject: string, body: string, highlight: string}"
    )
    user_msg = (
        f"Client: {c.get('name','')}\n"
        f"Month: {start_of_month.strftime('%B %Y')}\n"
        f"Tickets resolved this month: {len(resolved)}\n"
        f"New tickets opened: {new_}\n"
        f"Avg time-to-resolve: {avg_resolve_hrs} hours\n"
        f"Devices under management: {devices}\n"
        f"Return JSON only."
    )
    draft = _safe_json(await _llm(system, user_msg, "monthrecap"))
    return {
        "client_id": client_id,
        "client_name": c.get("name"),
        "period": start_of_month.strftime("%B %Y"),
        "stats": {
            "resolved": len(resolved),
            "new": new_,
            "devices": devices,
            "avg_resolve_hours": avg_resolve_hrs,
        },
        "subject": draft.get("subject"),
        "body": draft.get("body"),
        "highlight": draft.get("highlight"),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 17. INSURANCE ACTION PLAN ═══════════════════════

@router.get("/clients/{client_id}/insurance-action-plan")
async def insurance_action_plan(client_id: str, current_user: dict = Depends(get_current_user)):
    devices = await db.devices.find({"client_id": client_id}, {"_id": 0}).limit(2000).to_list(2000)
    total = len(devices) or 1
    mfa_need = [d for d in devices if not d.get("mfa_enabled")]
    edr_need = [d for d in devices if not d.get("edr_installed")]
    enc_need = [d for d in devices if d.get("encryption_status") not in ("enabled", True, "yes")]
    cutoff = (_now() - timedelta(days=30)).isoformat()
    patch_need = [d for d in devices if (d.get("last_patch_date") or "") < cutoff]

    last_drill = await db.backup_drills.find_one({"client_id": client_id, "status": "completed"}, {"_id": 0})

    mfa_pct = round((total - len(mfa_need)) / total * 100)
    edr_pct = round((total - len(edr_need)) / total * 100)
    enc_pct = round((total - len(enc_need)) / total * 100)
    patch_pct = round((total - len(patch_need)) / total * 100)
    score = round(mfa_pct * 0.3 + edr_pct * 0.3 + enc_pct * 0.2 + patch_pct * 0.2)

    actions = []
    if mfa_pct < 100:
        actions.append({"priority": 1, "title": f"Enable MFA on {len(mfa_need)} device(s)",
                        "impact": "+ 30% toward score", "device_count": len(mfa_need)})
    if edr_pct < 100:
        actions.append({"priority": 1, "title": f"Install EDR on {len(edr_need)} device(s)",
                        "impact": "+ 30% toward score", "device_count": len(edr_need)})
    if enc_pct < 100:
        actions.append({"priority": 2, "title": f"Enable encryption on {len(enc_need)} device(s)",
                        "impact": "+ 20% toward score", "device_count": len(enc_need)})
    if patch_pct < 100:
        actions.append({"priority": 2, "title": f"Patch {len(patch_need)} out-of-date device(s)",
                        "impact": "+ 20% toward score", "device_count": len(patch_need)})
    if not last_drill:
        actions.append({"priority": 1, "title": "Complete a restore drill",
                        "impact": "Required by most insurers", "device_count": 0})

    return {
        "client_id": client_id,
        "current_score": score,
        "tier": "insurable" if score >= 80 else "needs-improvement" if score >= 60 else "high-risk",
        "actions": actions,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 18. PRE-CALL BRIEF ═══════════════════════

@router.get("/clients/{client_id}/pre-call-brief")
async def pre_call_brief(client_id: str, current_user: dict = Depends(get_current_user)):
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Client not found")

    recent_tx = await db.tickets.find(
        {"client_id": client_id},
        {"_id": 0, "ticket_number": 1, "title": 1, "priority": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).limit(10).to_list(10)

    cutoff = (_now() - timedelta(days=14)).isoformat()
    sent_events = await db.ticket_sentiment_log.find(
        {"created_at": {"$gte": cutoff}, "flag": "escalating"},
        {"_id": 0, "ticket_id": 1, "reasoning": 1}
    ).limit(20).to_list(20)
    client_sent = [s for s in sent_events if s.get("ticket_id") in [t.get("id") for t in await db.tickets.find({"client_id": client_id}, {"_id": 0, "id": 1}).to_list(200)]]

    cr = await db.churn_risk.find_one({"client_id": client_id}, {"_id": 0, "score": 1}) or {}
    open_crit = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["open", "in_progress"]}, "priority": "critical"})
    open_overdue = await db.invoices.count_documents({"client_id": client_id, "status": {"$in": ["sent", "overdue"]}, "due_date": {"$lt": _now().date().isoformat()}})

    system = (
        "You are an AI briefer preparing an MSP account manager for a client call. Be concise and practical. "
        "Return STRICT JSON ONLY with 4 fields: "
        "{topics_to_raise: [string] (3-5 items), topics_to_avoid: [string] (1-3 items), tone: 'friendly'|'neutral'|'apologetic'|'firm', one_liner: string (single sentence primer)}"
    )
    user_msg = (
        f"Client: {c.get('name','')}\n"
        f"Churn score: {cr.get('score', 25)}/100\n"
        f"Recent tickets:\n" + "\n".join([f"  {t.get('ticket_number')} [{t.get('priority')}] {t.get('title','')[:80]} ({t.get('status')})" for t in recent_tx[:8]]) +
        f"\n\nRecent sentiment escalations: {len(client_sent)}\n"
        f"Open criticals: {open_crit}\n"
        f"Overdue invoices: {open_overdue}\n"
    )
    draft = _safe_json(await _llm(system, user_msg, "precall"))
    return {
        "client_id": client_id,
        "client_name": c.get("name"),
        "stats": {"churn_score": cr.get("score"), "open_criticals": open_crit, "overdue_invoices": open_overdue, "escalations_14d": len(client_sent)},
        "topics_to_raise": draft.get("topics_to_raise") or [],
        "topics_to_avoid": draft.get("topics_to_avoid") or [],
        "tone": draft.get("tone"),
        "one_liner": draft.get("one_liner"),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 19. DAILY TECH BRIEFING ═══════════════════════

@router.get("/team/{tech_id}/daily-briefing")
async def daily_briefing(tech_id: str, current_user: dict = Depends(get_current_user)):
    tech = await db.users.find_one({"$or": [{"id": tech_id}, {"email": tech_id}]}, {"_id": 0})
    if not tech:
        raise HTTPException(404, "Tech not found")

    open_tx = await db.tickets.find(
        {"$or": [{"assignee_id": tech["id"]}, {"assignee_name": tech.get("name")}],
         "status": {"$in": ["open", "in_progress", "pending"]}},
        {"_id": 0, "ticket_number": 1, "title": 1, "priority": 1, "sla_due_at": 1, "client_name": 1}
    ).to_list(50)

    now = _now()
    in_danger = []
    for t in open_tx:
        due = _parse_iso(t.get("sla_due_at"))
        if due and (due - now).total_seconds() < 7200:
            in_danger.append(t)

    system = (
        "You are an MSP team lead giving a short, motivating daily briefing to a tech. Plain text, 80-120 words, "
        "no markdown. Call out priorities, sla pressure and one confidence-boosting note."
    )
    user_msg = (
        f"Tech: {tech.get('name')}\n"
        f"Open tickets: {len(open_tx)}\n"
        f"Criticals: {sum(1 for t in open_tx if t.get('priority') == 'critical')}\n"
        f"In SLA-danger (< 2h): {len(in_danger)}\n"
        f"Sample titles:\n" + "\n".join([f"  {t.get('ticket_number')} [{t.get('priority')}] {t.get('title','')[:80]}" for t in open_tx[:5]])
    )
    text = await _llm(system, user_msg, "daily")
    return {
        "tech_id": tech["id"],
        "tech_name": tech.get("name"),
        "stats": {"open": len(open_tx), "in_sla_danger": len(in_danger),
                  "criticals": sum(1 for t in open_tx if t.get('priority') == 'critical')},
        "text": text if isinstance(text, str) else str(text),
        "generated_at": now.isoformat(),
    }


# ═══════════════════════ 20. SCOPE DRIFT ═══════════════════════

@router.get("/tickets/{ticket_id}/scope-drift")
async def scope_drift(ticket_id: str, current_user: dict = Depends(get_current_user)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")

    actual_minutes = sum(int(te.get("duration_minutes") or 0) for te in (t.get("time_entries") or []))
    expected_minutes = int(t.get("blueprint_sla_minutes") or t.get("sla_minutes") or 0)

    ratio = None
    drift = None
    if expected_minutes > 0:
        ratio = round(actual_minutes / expected_minutes, 2)
        drift = "over" if ratio > 1.5 else "over_slight" if ratio > 1.1 else "on_track"

    checklist = t.get("blueprint_checklist") or []
    done = sum(1 for c in checklist if c.get("done"))
    return {
        "ticket_id": ticket_id,
        "actual_minutes": actual_minutes,
        "expected_minutes": expected_minutes,
        "ratio": ratio,
        "drift": drift or "no_blueprint",
        "checklist_done": done,
        "checklist_total": len(checklist),
        "flag": ratio and ratio > 1.5,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 21. QUALITY AUDIT ═══════════════════════

@router.post("/tickets/quality-audit")
async def quality_audit(payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Pick random 5% of recently-closed tickets and score resolution quality."""
    sample_size = int(payload.get("sample_size") or 5)
    since = (_now() - timedelta(days=14)).isoformat()

    closed = await db.tickets.find(
        {"resolved_at": {"$gte": since}, "resolution_notes": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "resolution_notes": 1, "assignee_name": 1, "client_name": 1}
    ).limit(200).to_list(200)

    if not closed:
        return {"audited": [], "message": "No closed tickets to audit"}

    sample = random.sample(closed, min(sample_size, len(closed)))

    audited = []
    for t in sample:
        system = (
            "You are a senior MSP QA reviewer scoring the QUALITY of a resolution. "
            "Consider: clarity, completeness, evidence/next-steps, root-cause vs symptom. "
            "Return STRICT JSON ONLY: {score: 0-10, verdict: 'excellent'|'good'|'needs_improvement'|'poor', comment: string (1 sentence)}"
        )
        user_msg = (
            f"Ticket: {t.get('ticket_number')} - {t.get('title','')}\n"
            f"Priority: {t.get('priority')}\n"
            f"Resolution notes:\n{(t.get('resolution_notes') or '')[:800]}\n"
        )
        rv = _safe_json(await _llm(system, user_msg, "qa"))
        if rv:
            audited.append({
                "ticket_id": t["id"],
                "ticket_number": t.get("ticket_number"),
                "assignee": t.get("assignee_name"),
                "client_name": t.get("client_name"),
                "score": rv.get("score"),
                "verdict": rv.get("verdict"),
                "comment": rv.get("comment"),
            })
            # Save to a per-ticket audit collection
            await db.ticket_quality_audits.insert_one({
                "id": uuid.uuid4().hex,
                "ticket_id": t["id"],
                "score": rv.get("score"),
                "verdict": rv.get("verdict"),
                "comment": rv.get("comment"),
                "audited_at": _now().isoformat(),
                "audited_by": "AI",
            })

    audited.sort(key=lambda x: (x.get("score") or 0))
    return {"audited": audited, "sample_size": len(audited), "pool_size": len(closed), "generated_at": _now().isoformat()}


# ═══════════════════════ 22. CAPACITY FORECAST ═══════════════════════

@router.get("/forecasting/capacity")
async def capacity_forecast(current_user: dict = Depends(get_current_user)):
    now = _now()

    # Tech load forecast
    open_tx = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "pending", "waiting"]}},
        {"_id": 0, "assignee_name": 1, "priority": 1}
    ).to_list(2000)
    load_per_tech = defaultdict(int)
    for t in open_tx:
        k = t.get("assignee_name")
        if k: load_per_tech[k] += 1
    techs = await db.users.count_documents({"role": {"$in": ["technician", "tech", "engineer", "admin"]}})
    avg_load = sum(load_per_tech.values()) / max(len(load_per_tech), 1)
    extra_techs_needed = max(0, round(avg_load / 20) - 1) if avg_load > 20 else 0

    # Device replacement
    devices = await db.devices.find({}, {"_id": 0, "purchase_date": 1, "warranty_expiry": 1, "battery_health": 1, "errors_count": 1}).limit(5000).to_list(5000)
    replace_30 = 0; replace_90 = 0; replace_365 = 0
    for d in devices:
        purchased = _parse_iso(d.get("purchase_date"))
        warranty = _parse_iso(d.get("warranty_expiry"))
        if not purchased: continue
        age_days = (now - purchased).days
        errors = int(d.get("errors_count") or 0)
        score = 0
        if age_days > 1825: score += 50
        elif age_days > 1460: score += 30
        elif age_days > 1095: score += 15
        if warranty and (warranty - now).days < 0: score += 25
        elif warranty and (warranty - now).days < 90: score += 10
        if errors > 50: score += 20
        if score >= 70: replace_30 += 1
        elif score >= 45: replace_90 += 1
        elif score >= 25: replace_365 += 1

    # Backup refresh scan
    last_drill = await db.backup_drills.find_one({"status": "completed"}, sort=[("completed_at", -1)])
    drill_stale_days = None
    if last_drill:
        d = _parse_iso(last_drill.get("completed_at"))
        if d: drill_stale_days = (now - d).days
    backup_refresh_needed = (drill_stale_days or 999) > 90

    return {
        "team": {
            "current_techs": techs,
            "avg_load_per_tech": round(avg_load, 1),
            "extra_techs_needed_90d": extra_techs_needed,
        },
        "devices": {"replace_in_30": replace_30, "replace_in_90": replace_90, "replace_in_365": replace_365},
        "backup": {"last_drill_days_ago": drill_stale_days, "refresh_required": backup_refresh_needed},
        "headline": _forecast_headline(extra_techs_needed, replace_30, backup_refresh_needed),
        "generated_at": now.isoformat(),
    }


def _forecast_headline(techs, devices_30, backup_need):
    parts = []
    if techs > 0: parts.append(f"hire {techs} tech{'s' if techs > 1 else ''}")
    if devices_30 > 0: parts.append(f"replace {devices_30} device{'s' if devices_30 > 1 else ''} in next 30d")
    if backup_need: parts.append("schedule backup refresh drill")
    return f"Next 90 days you should: {', '.join(parts)}" if parts else "All systems within capacity"


# ═══════════════════════ 23. CLIENT BENCHMARK ═══════════════════════

@router.get("/clients/{client_id}/benchmark")
async def client_benchmark(client_id: str, current_user: dict = Depends(get_current_user)):
    c = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "id": 1})
    if not c:
        raise HTTPException(404, "Client not found")

    # Compute this client's security score
    my_dev = await db.devices.find({"client_id": client_id}, {"_id": 0}).limit(2000).to_list(2000)
    my_total = len(my_dev) or 1
    my_mfa = round(sum(1 for d in my_dev if d.get("mfa_enabled")) / my_total * 100)
    my_edr = round(sum(1 for d in my_dev if d.get("edr_installed")) / my_total * 100)

    # Compute fleet average (excluding this client)
    all_dev = await db.devices.find({"client_id": {"$ne": client_id}}, {"_id": 0}).limit(20000).to_list(20000)
    all_total = len(all_dev) or 1
    avg_mfa = round(sum(1 for d in all_dev if d.get("mfa_enabled")) / all_total * 100)
    avg_edr = round(sum(1 for d in all_dev if d.get("edr_installed")) / all_total * 100)

    comparisons = [
        {"metric": "MFA coverage", "you": my_mfa, "benchmark": avg_mfa, "delta": my_mfa - avg_mfa},
        {"metric": "EDR coverage", "you": my_edr, "benchmark": avg_edr, "delta": my_edr - avg_edr},
    ]

    warnings = []
    if my_mfa < avg_mfa - 20:
        warnings.append(f"MFA coverage is {avg_mfa - my_mfa}% below benchmark — insurers typically flag this.")
    if my_edr < avg_edr - 20:
        warnings.append(f"EDR coverage is {avg_edr - my_edr}% below benchmark — breach risk elevated.")

    return {
        "client_id": client_id,
        "client_name": c.get("name"),
        "comparisons": comparisons,
        "warnings": warnings,
        "peer_group_size": all_total,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 24. SCHEDULE INSURANCE SNAPSHOT ═══════════════════════

@router.post("/security/insurance-vault/schedule")
async def schedule_insurance_snapshot(payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Register a recurring snapshot job (persisted — a scheduler can pick it up later)."""
    doc = {
        "id": uuid.uuid4().hex,
        "client_id": payload.get("client_id"),
        "cadence": payload.get("cadence") or "weekly",  # weekly | monthly
        "recipient_emails": payload.get("recipient_emails") or [],
        "active": True,
        "created_by": current_user.get("name"),
        "created_at": _now().isoformat(),
        "next_run_at": (_now() + timedelta(days=7)).isoformat(),
    }
    await db.insurance_vault_schedule.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/security/insurance-vault/schedule")
async def list_insurance_schedules(current_user: dict = Depends(get_current_user)):
    rows = await db.insurance_vault_schedule.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return rows


# ═══════════════════════ 25. OPS TICK — AUTOMATED CHAIN REACTIONS ═══════════════════════

async def run_chain_reactions(triggered_by: str = "scheduler") -> dict:
    """Run the 5 zero-touch chain reactions and return a compact summary."""
    summary = {
        "triggered_by": triggered_by,
        "started_at": _now().isoformat(),
        "results": {},
        "errors": {},
    }
    system_user = {"name": f"auto-{triggered_by}"}

    # 1) Apology queue scan
    try:
        r = await apology_queue_scan.__wrapped__(system_user) if hasattr(apology_queue_scan, "__wrapped__") else await apology_queue_scan(system_user)
        summary["results"]["apology_queue"] = {"queued_new": r.get("queued_new", 0)}
    except Exception as e:
        summary["errors"]["apology_queue"] = str(e)[:200]

    # 2) SLA auto-page
    try:
        r = await sla_auto_page(85, system_user)
        summary["results"]["sla_auto_page"] = {"new_pages_fired": r.get("new_pages_fired", 0)}
    except Exception as e:
        summary["errors"]["sla_auto_page"] = str(e)[:200]

    # 3) Payment promise reconcile
    try:
        r = await promise_reconcile(system_user)
        summary["results"]["promise_reconcile"] = {"broken_count": r.get("broken_count", 0), "clients_bumped": r.get("clients_bumped", 0)}
    except Exception as e:
        summary["errors"]["promise_reconcile"] = str(e)[:200]

    # 4) Patch anomaly broadcast — call directly from its router
    try:
        from app.routers.mega_features import broadcast_patch_anomalies
        r = await broadcast_patch_anomalies(system_user)
        summary["results"]["patch_broadcast"] = {"newly_broadcast": r.get("newly_broadcast", 0)}
    except Exception as e:
        summary["errors"]["patch_broadcast"] = str(e)[:200]

    summary["finished_at"] = _now().isoformat()
    # Persist the tick record
    try:
        await db.ops_tick_log.insert_one({
            "id": uuid.uuid4().hex, **summary,
        })
    except Exception:
        pass
    return summary


@router.post("/ops/nightly-tick")
async def ops_nightly_tick(current_user: dict = Depends(get_current_user)):
    """Manually trigger the automated chain-reaction sweep."""
    return await run_chain_reactions(triggered_by=f"manual:{current_user.get('name','?')}")


@router.get("/ops/tick-log")
async def ops_tick_log(current_user: dict = Depends(get_current_user)):
    rows = await db.ops_tick_log.find({}, {"_id": 0}).sort("started_at", -1).limit(25).to_list(25)
    return {"ticks": rows, "count": len(rows)}


@router.get("/ops/settings")
async def ops_settings(current_user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"type": "ops_scheduler"}, {"_id": 0}) or {}
    return {
        "enabled": bool(s.get("enabled", True)),
        "interval_minutes": int(s.get("interval_minutes", 15)),
    }


@router.put("/ops/settings")
async def update_ops_settings(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "ops_scheduler"},
        {"$set": {
            "type": "ops_scheduler",
            "enabled": bool(payload.get("enabled", True)),
            "interval_minutes": max(5, int(payload.get("interval_minutes") or 15)),
            "updated_at": _now().isoformat(),
            "updated_by": current_user.get("name"),
        }},
        upsert=True,
    )
    return await ops_settings(current_user)
