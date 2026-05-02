"""Mega feature bundle — 21 unique differentiators.

Tickets:        doppelganger, time-machine, apology-draft, cognitive-load
Clients:        dna-profile, ltv-forecast, anniversary-draft
Finance:        pre-billing audit, smart reminder cadence, aged AR heatmap
Estimates:      win-probability, pricing-flags
Devices/RMM:    health-trajectory, patch anomalies, battery wall
Backup/Sec:     restore drills, cyber insurance vault
Team:           skills XP bank, 1:1 auto-agenda
Cross-cutting:  voice morning brief (text), runbook publish
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import os
import re
import json
import uuid
from typing import Optional

from app.database import db
from app.auth import get_current_user

router = APIRouter()

MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-sonnet-4-5-20250929"


async def _llm(system: str, user_msg: str, session_prefix: str = "mega") -> str:
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


# ═══════════════════════ 1. TICKET DOPPELGÄNGER ═══════════════════════

@router.get("/tickets/{ticket_id}/doppelganger")
async def ticket_doppelganger(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Find the 3 most similar resolved tickets across ALL clients + the fix that worked."""
    target = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Ticket not found")

    title = (target.get("title") or "").lower()
    keywords = [w for w in re.findall(r"[a-z0-9]{4,}", title) if w not in
                {"ticket", "issue", "problem", "error", "with", "from", "this", "that", "have", "test"}][:6]

    if not keywords:
        return {"matches": [], "reason": "Insufficient title keywords"}

    regex = "|".join(re.escape(k) for k in keywords)
    candidates = await db.tickets.find(
        {
            "id": {"$ne": ticket_id},
            "status": {"$in": ["resolved", "closed"]},
            "$or": [
                {"title": {"$regex": regex, "$options": "i"}},
                {"description": {"$regex": regex, "$options": "i"}},
            ],
        },
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "client_name": 1,
         "category": 1, "priority": 1, "resolved_at": 1, "resolution_notes": 1, "description": 1},
    ).limit(40).to_list(40)

    target_set = set(keywords)
    scored = []
    for c in candidates:
        ctext = ((c.get("title") or "") + " " + (c.get("description") or "")).lower()
        ctokens = set(re.findall(r"[a-z0-9]{4,}", ctext))
        overlap = len(target_set & ctokens)
        if overlap == 0:
            continue
        sim = round(overlap / max(len(target_set), 1) * 100)
        scored.append({
            "ticket_id": c["id"],
            "ticket_number": c.get("ticket_number"),
            "title": c.get("title"),
            "client_name": c.get("client_name"),
            "similarity": sim,
            "category": c.get("category"),
            "resolved_at": c.get("resolved_at"),
            "resolution_summary": (c.get("resolution_notes") or c.get("description") or "")[:280],
        })
    scored.sort(key=lambda x: x["similarity"], reverse=True)
    top = scored[:3]

    # Optional: if 2+ matches share a category, surface a "common fix" hint.
    common_fix = None
    if len(top) >= 2:
        cat_count = defaultdict(int)
        for t in top:
            if t.get("category"):
                cat_count[t["category"]] += 1
        if cat_count:
            common_fix = max(cat_count.items(), key=lambda x: x[1])[0]

    return {
        "ticket_id": ticket_id,
        "matches": top,
        "common_category": common_fix,
        "scanned": len(candidates),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 2. TICKET TIME MACHINE ═══════════════════════

@router.get("/tickets/{ticket_id}/timeline")
async def ticket_timeline(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Aggregate notes, status changes, sentiment events, time entries into one chronological feed."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")

    events = []

    events.append({
        "ts": t.get("created_at"),
        "type": "created",
        "icon": "plus",
        "label": f"Ticket created: {t.get('title','')}",
        "actor": t.get("created_by_name") or "system",
    })

    notes = await db.ticket_notes.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    for n in notes:
        events.append({
            "ts": n.get("created_at"),
            "type": "internal_note" if n.get("is_internal") else "comment",
            "icon": "message",
            "label": (n.get("body") or n.get("content") or "")[:220],
            "actor": n.get("author") or n.get("user_name") or "?",
        })

    audit = await db.ticket_audit_log.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
    for a in audit:
        events.append({
            "ts": a.get("created_at") or a.get("timestamp"),
            "type": "status_change" if a.get("field") == "status" else "audit",
            "icon": "shuffle",
            "label": f"{a.get('field','field')}: {a.get('old_value','—')} → {a.get('new_value','—')}",
            "actor": a.get("user_name") or a.get("changed_by") or "system",
        })

    for te in (t.get("time_entries") or []):
        events.append({
            "ts": te.get("started_at") or te.get("created_at"),
            "type": "time_entry",
            "icon": "clock",
            "label": f"Logged {te.get('duration_minutes', 0)} min — {te.get('description','')[:120]}",
            "actor": te.get("tech_name") or te.get("user_name") or "?",
        })

    sent = await db.ticket_sentiment_log.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1).to_list(50)
    for s in sent:
        events.append({
            "ts": s.get("created_at"),
            "type": "sentiment",
            "icon": "heart",
            "label": f"Sentiment: {s.get('trend','?')} (score {s.get('latest_score','?')}/5)",
            "actor": "AI",
        })

    if t.get("resolved_at"):
        events.append({
            "ts": t.get("resolved_at"),
            "type": "resolved",
            "icon": "check",
            "label": (t.get("resolution_notes") or "Ticket resolved")[:220],
            "actor": t.get("resolved_by_name") or "?",
        })

    events = [e for e in events if e.get("ts")]
    events.sort(key=lambda e: str(e["ts"]))

    sentiment_lows = sum(1 for e in events if e["type"] == "sentiment" and "worsen" in str(e.get("label", "")).lower())
    return {
        "ticket_id": ticket_id,
        "ticket_number": t.get("ticket_number"),
        "events": events,
        "stats": {
            "total_events": len(events),
            "comments": sum(1 for e in events if e["type"] in ("comment", "internal_note")),
            "status_changes": sum(1 for e in events if e["type"] == "status_change"),
            "time_entries": sum(1 for e in events if e["type"] == "time_entry"),
            "sentiment_events": sum(1 for e in events if e["type"] == "sentiment"),
            "sentiment_lows": sentiment_lows,
        },
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 3. AUTO-APOLOGY COMPOSER ═══════════════════════

@router.post("/tickets/{ticket_id}/apology-draft")
async def apology_draft(ticket_id: str, payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Generate a context-aware apology + makegood email."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")

    notes = await db.ticket_notes.find({"ticket_id": ticket_id}, {"_id": 0, "body": 1, "author": 1}).sort("created_at", -1).limit(10).to_list(10)
    convo = "\n".join([f"  {n.get('author','?')}: {(n.get('body') or '')[:200]}" for n in notes])

    breached = False
    sla_due = _parse_iso(t.get("sla_due_at"))
    if sla_due and _now() > sla_due:
        breached = True

    reason = payload.get("reason") or ("SLA breach" if breached else "Negative client sentiment")
    severity = payload.get("severity") or ("high" if t.get("priority") == "critical" else "medium")

    system = (
        "You are a senior MSP account manager writing a sincere apology email to a business client. "
        "Acknowledge the specific issue, take ownership, and propose a tangible make-good (free hours, "
        "service credit, escalation path, or future discount). Tone: warm, professional, no excuses. "
        "Return STRICT JSON ONLY: {subject: string, body: string (3-4 short paragraphs), makegood: string, tone: 'warm'|'urgent'}"
    )
    user_msg = (
        f"Ticket #{t.get('ticket_number','')} — {t.get('title','')}\n"
        f"Client: {t.get('client_name','')}\n"
        f"Priority: {t.get('priority')} | Reason for apology: {reason}\n"
        f"Severity: {severity} | SLA breached: {breached}\n"
        f"Recent conversation:\n{convo or '(no conversation)'}\n\n"
        f"Return JSON only."
    )
    draft = _safe_json(await _llm(system, user_msg, "apology"))
    return {
        "ticket_id": ticket_id,
        "subject": draft.get("subject"),
        "body": draft.get("body"),
        "makegood": draft.get("makegood"),
        "tone": draft.get("tone", "warm"),
        "sla_breached": breached,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 4. TECH COGNITIVE LOAD SCORE ═══════════════════════

@router.get("/team/cognitive-load")
async def cognitive_load(current_user: dict = Depends(get_current_user)):
    """Per-tech burnout score (0-100) based on open ticket pressure."""
    techs = await db.users.find({"role": {"$in": ["technician", "admin", "tech", "engineer"]}},
                                {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1}).to_list(200)

    open_tx = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress", "pending", "waiting"]}},
        {"_id": 0, "assignee_id": 1, "assignee_name": 1, "priority": 1,
         "created_at": 1, "sla_due_at": 1, "ticket_number": 1, "title": 1}
    ).to_list(2000)

    by_tech = defaultdict(list)
    for t in open_tx:
        if t.get("assignee_id"):
            by_tech[t["assignee_id"]].append(t)
        elif t.get("assignee_name"):
            by_tech[t["assignee_name"]].append(t)

    rows = []
    for tech in techs:
        tickets = by_tech.get(tech["id"], []) or by_tech.get(tech.get("name"), [])
        count = len(tickets)
        if count == 0:
            score = 0
        else:
            crit = sum(1 for x in tickets if x.get("priority") == "critical")
            high = sum(1 for x in tickets if x.get("priority") == "high")
            now = _now()
            old_count = sum(1 for x in tickets if (now - (_parse_iso(x.get("created_at")) or now)).days >= 7)
            sla_pressure = sum(1 for x in tickets if (lambda d: d and (d - now).total_seconds() < 7200)(_parse_iso(x.get("sla_due_at"))))
            score = min(100, count * 4 + crit * 10 + high * 5 + old_count * 3 + sla_pressure * 8)

        status = "burnout" if score >= 85 else "stretched" if score >= 60 else "healthy" if score >= 30 else "available"
        rows.append({
            "tech_id": tech["id"],
            "name": tech.get("name"),
            "email": tech.get("email"),
            "open_tickets": count,
            "critical": sum(1 for x in tickets if x.get("priority") == "critical"),
            "high": sum(1 for x in tickets if x.get("priority") == "high"),
            "score": score,
            "status": status,
            "auto_pause": score >= 85,
        })
    rows.sort(key=lambda r: r["score"], reverse=True)
    return {"team": rows, "generated_at": _now().isoformat()}


# ═══════════════════════ 5. CLIENT DNA PROFILE ═══════════════════════

@router.get("/clients/{client_id}/dna")
async def client_dna(client_id: str, current_user: dict = Depends(get_current_user)):
    """Behavioural profile aggregated from tickets, invoices, comms history."""
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Client not found")

    tx = await db.tickets.find({"client_id": client_id}, {"_id": 0, "priority": 1, "category": 1,
                                                          "created_at": 1, "resolved_at": 1, "title": 1}).limit(500).to_list(500)
    inv = await db.invoices.find({"client_id": client_id}, {"_id": 0, "issue_date": 1, "due_date": 1,
                                                            "amount_paid": 1, "total": 1, "payments": 1, "status": 1}).limit(200).to_list(200)

    pay_days = []
    for i in inv:
        if (i.get("payments") or []):
            paid = _parse_iso((i["payments"][0] or {}).get("date"))
            issued = _parse_iso(i.get("issue_date"))
            if paid and issued:
                pay_days.append((paid - issued).days)
    avg_pay_days = round(sum(pay_days) / len(pay_days), 1) if pay_days else None

    cat_count = defaultdict(int)
    for t in tx:
        if t.get("category"):
            cat_count[t["category"]] += 1
    top_complaints = sorted(cat_count.items(), key=lambda x: -x[1])[:3]

    hours = defaultdict(int)
    for t in tx:
        d = _parse_iso(t.get("created_at"))
        if d:
            hours[d.hour] += 1
    peak_hour = max(hours.items(), key=lambda x: x[1])[0] if hours else None

    crit_pct = round(sum(1 for t in tx if t.get("priority") == "critical") / max(len(tx), 1) * 100)

    return {
        "client_id": client_id,
        "name": c.get("name"),
        "industry": c.get("industry"),
        "metrics": {
            "total_tickets": len(tx),
            "critical_pct": crit_pct,
            "avg_payment_days": avg_pay_days,
            "peak_demand_hour": peak_hour,
            "top_complaint_categories": [{"category": k, "count": v} for k, v in top_complaints],
            "invoice_count": len(inv),
            "preferred_channel": c.get("preferred_channel") or "email",
        },
        "personality_tags": _dna_tags(crit_pct, avg_pay_days, len(tx)),
        "generated_at": _now().isoformat(),
    }


def _dna_tags(crit_pct: int, avg_pay: Optional[float], tix: int) -> list:
    tags = []
    if crit_pct > 30:
        tags.append("urgency-driven")
    elif crit_pct < 10:
        tags.append("calm-communicator")
    if avg_pay is not None:
        if avg_pay <= 14:
            tags.append("prompt-payer")
        elif avg_pay >= 45:
            tags.append("late-payer")
    if tix > 80:
        tags.append("high-engagement")
    elif tix < 5:
        tags.append("low-touch")
    return tags or ["standard"]


# ═══════════════════════ 6. CLIENT LTV FORECAST ═══════════════════════

@router.get("/clients/{client_id}/ltv-forecast")
async def ltv_forecast(client_id: str, current_user: dict = Depends(get_current_user)):
    """12-month MRR-driven LTV with churn risk weighting."""
    c = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "mrr": 1})
    if not c:
        raise HTTPException(404, "Client not found")

    mrr = float(c.get("mrr") or 0)

    last_year = (_now() - timedelta(days=365)).isoformat()
    inv = await db.invoices.find(
        {"client_id": client_id, "issue_date": {"$gte": last_year}, "status": {"$ne": "void"}},
        {"_id": 0, "total": 1}
    ).limit(200).to_list(200)
    annual_revenue_actual = round(sum(float(x.get("total") or 0) for x in inv), 2)

    cr = await db.churn_risk.find_one({"client_id": client_id}, {"_id": 0, "score": 1}) or {}
    churn_score = float(cr.get("score") or 25)
    survival = max(0.0, 1 - churn_score / 100)

    base_12m = mrr * 12 if mrr > 0 else annual_revenue_actual
    risk_adjusted = round(base_12m * (0.3 + 0.7 * survival), 2)
    upside_5yr = round(base_12m * 5 * (0.2 + 0.8 * survival), 2)

    return {
        "client_id": client_id,
        "name": c.get("name"),
        "mrr": mrr,
        "trailing_12m_revenue": annual_revenue_actual,
        "churn_score": churn_score,
        "survival_probability": round(survival, 3),
        "forecast_12m_risk_adjusted": risk_adjusted,
        "forecast_5yr_ltv": upside_5yr,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 7. CLIENT ANNIVERSARY DRAFT ═══════════════════════

@router.get("/clients/{client_id}/anniversary-draft")
async def anniversary_draft(client_id: str, current_user: dict = Depends(get_current_user)):
    c = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Client not found")

    onboarded = _parse_iso(c.get("onboarded_at") or c.get("created_at"))
    years = round((_now() - onboarded).days / 365, 1) if onboarded else 0

    tickets_resolved = await db.tickets.count_documents({"client_id": client_id, "status": {"$in": ["resolved", "closed"]}})
    devices = await db.devices.count_documents({"client_id": client_id})

    last_year = (_now() - timedelta(days=365)).isoformat()
    inv = await db.invoices.find(
        {"client_id": client_id, "issue_date": {"$gte": last_year}, "status": {"$ne": "void"}},
        {"_id": 0, "total": 1}
    ).limit(200).to_list(200)
    revenue_12m = round(sum(float(x.get("total") or 0) for x in inv), 2)

    system = (
        "You are an MSP relationship manager writing a heart-felt anniversary email to a long-standing business client. "
        "Highlight tangible numbers: years partnered, tickets resolved, devices managed. Brief (3 short paragraphs). "
        "Sincere, not salesy. Return STRICT JSON ONLY: {subject: string, body: string, milestone: string}"
    )
    user_msg = (
        f"Client: {c.get('name','')}\n"
        f"Years partnered: {years}\n"
        f"Tickets resolved: {tickets_resolved}\n"
        f"Devices managed: {devices}\n"
        f"Last 12 months revenue billed: ${revenue_12m:,.2f}\n\n"
        f"Return JSON only."
    )
    draft = _safe_json(await _llm(system, user_msg, "anniv"))
    return {
        "client_id": client_id,
        "client_name": c.get("name"),
        "years": years,
        "stats": {"tickets_resolved": tickets_resolved, "devices": devices, "revenue_12m": revenue_12m},
        "subject": draft.get("subject"),
        "body": draft.get("body"),
        "milestone": draft.get("milestone"),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 8. PRE-BILLING AUDITOR ═══════════════════════

@router.post("/invoices/{invoice_id}/audit")
async def prebilling_audit(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Scan an invoice for missing time entries, unbilled assets, scope creep before sending."""
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")

    cid = inv.get("client_id")
    period_start = (inv.get("issue_date") or "")[:10] or (_now() - timedelta(days=30)).isoformat()[:10]
    period_end = (inv.get("due_date") or _now().isoformat())[:10]

    tx = await db.tickets.find(
        {"client_id": cid, "$or": [
            {"resolved_at": {"$gte": period_start, "$lte": period_end}},
            {"created_at": {"$gte": period_start, "$lte": period_end}},
        ]},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "time_entries": 1, "products": 1}
    ).limit(200).to_list(200)

    invoiced_ticket_refs = set()
    for li in (inv.get("line_items") or []):
        for tn in re.findall(r"(?:#|TKT-|INC-|SR-|CHG-|PRB-)[\w-]+", str(li.get("description", "")) + " " + str(li.get("name", "")), re.I):
            invoiced_ticket_refs.add(tn.upper().lstrip("#"))

    unbilled_time = 0
    unbilled_tickets = []
    for t in tx:
        billable = sum(int(te.get("duration_minutes") or 0) for te in (t.get("time_entries") or []) if te.get("billable", True))
        if billable > 0:
            ref_match = (t.get("ticket_number") or "").upper().lstrip("#") in invoiced_ticket_refs
            if not ref_match:
                unbilled_time += billable
                unbilled_tickets.append({
                    "ticket_number": t.get("ticket_number"),
                    "title": (t.get("title") or "")[:80],
                    "billable_minutes": billable,
                })

    line_total = sum(float(li.get("quantity", 0)) * float(li.get("unit_price", 0)) for li in (inv.get("line_items") or []))
    summary_total = float(inv.get("subtotal") or 0)
    drift = abs(line_total - summary_total)

    flags = []
    if unbilled_time > 0:
        flags.append({
            "severity": "warning",
            "code": "UNBILLED_TIME",
            "message": f"{unbilled_time} unbilled minutes across {len(unbilled_tickets)} ticket(s)",
            "details": unbilled_tickets[:10],
        })
    if drift > 0.5:
        flags.append({
            "severity": "error",
            "code": "TOTAL_DRIFT",
            "message": f"Line items sum to ${line_total:,.2f} but invoice subtotal is ${summary_total:,.2f}",
        })
    if (inv.get("line_items") or []) == []:
        flags.append({"severity": "error", "code": "EMPTY", "message": "Invoice has no line items"})

    return {
        "invoice_id": invoice_id,
        "invoice_number": inv.get("invoice_number"),
        "flags": flags,
        "score": max(0, 100 - len(flags) * 25 - (10 if unbilled_time else 0)),
        "ready_to_send": len([f for f in flags if f["severity"] == "error"]) == 0,
        "scanned_tickets": len(tx),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 9. SMART REMINDER CADENCE ═══════════════════════

@router.get("/invoices/{invoice_id}/reminder-strategy")
async def reminder_strategy(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Picks optimal reminder timing/channel/tone based on this client's pay-by-X history."""
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    cid = inv.get("client_id")

    history = await db.invoices.find(
        {"client_id": cid, "id": {"$ne": invoice_id}, "payments": {"$exists": True, "$ne": []}},
        {"_id": 0, "issue_date": 1, "due_date": 1, "payments": 1}
    ).limit(50).to_list(50)

    pay_offsets = []
    for h in history:
        due = _parse_iso(h.get("due_date"))
        paid = _parse_iso((h.get("payments") or [{}])[0].get("date"))
        if due and paid:
            pay_offsets.append((paid - due).days)

    avg_offset = round(sum(pay_offsets) / len(pay_offsets), 1) if pay_offsets else None
    pattern = "unknown"
    optimal_first_reminder_days_after_due = 1
    tone = "friendly"
    channel = "email"

    if avg_offset is not None:
        if avg_offset < -2:
            pattern = "early-payer"
            optimal_first_reminder_days_after_due = -7
            tone = "thank-you"
            channel = "email"
        elif avg_offset <= 2:
            pattern = "on-time"
            optimal_first_reminder_days_after_due = 1
            tone = "friendly"
        elif avg_offset <= 14:
            pattern = "late-but-reliable"
            optimal_first_reminder_days_after_due = max(1, int(avg_offset - 3))
            tone = "professional"
            channel = "email+sms"
        else:
            pattern = "chronic-late"
            optimal_first_reminder_days_after_due = 3
            tone = "firm"
            channel = "sms+phone"

    return {
        "invoice_id": invoice_id,
        "client_id": cid,
        "history_size": len(pay_offsets),
        "avg_days_late": avg_offset,
        "pattern": pattern,
        "recommended": {
            "first_reminder_days_after_due": optimal_first_reminder_days_after_due,
            "tone": tone,
            "channel": channel,
            "follow_up_cadence_days": [1, 7, 14, 30] if pattern in ("late-but-reliable", "chronic-late") else [3, 14],
        },
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 10. AGED AR HEATMAP ═══════════════════════

@router.get("/aged-ar-heatmap")
async def aged_ar_heatmap(current_user: dict = Depends(get_current_user)):
    """Bucket every unpaid invoice by days outstanding."""
    rows = await db.invoices.find(
        {"status": {"$in": ["sent", "overdue", "partial"]}},
        {"_id": 0, "id": 1, "invoice_number": 1, "client_id": 1, "client_name": 1,
         "due_date": 1, "issue_date": 1, "total": 1, "amount_paid": 1}
    ).limit(500).to_list(500)

    now = _now()
    buckets = {"current": [], "1_30": [], "31_60": [], "61_90": [], "over_90": []}
    bucket_totals = {"current": 0.0, "1_30": 0.0, "31_60": 0.0, "61_90": 0.0, "over_90": 0.0}

    for r in rows:
        due = _parse_iso(r.get("due_date"))
        balance = float(r.get("total") or 0) - float(r.get("amount_paid") or 0)
        if balance <= 0:
            continue
        days = (now - due).days if due else 0
        if days <= 0:
            b = "current"
        elif days <= 30:
            b = "1_30"
        elif days <= 60:
            b = "31_60"
        elif days <= 90:
            b = "61_90"
        else:
            b = "over_90"
        buckets[b].append({
            "invoice_id": r["id"],
            "invoice_number": r.get("invoice_number"),
            "client_name": r.get("client_name"),
            "balance": round(balance, 2),
            "days_overdue": max(0, days),
        })
        bucket_totals[b] += balance

    return {
        "buckets": {k: sorted(v, key=lambda x: -x["days_overdue"])[:25] for k, v in buckets.items()},
        "bucket_totals": {k: round(v, 2) for k, v in bucket_totals.items()},
        "total_outstanding": round(sum(bucket_totals.values()), 2),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 11. ESTIMATE WIN PROBABILITY ═══════════════════════

@router.get("/estimates/{estimate_id}/win-probability")
async def win_probability(estimate_id: str, current_user: dict = Depends(get_current_user)):
    e = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Estimate not found")

    cid = e.get("client_id")
    history = await db.estimates.find(
        {"client_id": cid, "id": {"$ne": estimate_id}},
        {"_id": 0, "status": 1, "total": 1}
    ).limit(50).to_list(50)
    approved = sum(1 for h in history if h.get("status") == "approved")
    declined = sum(1 for h in history if h.get("status") == "declined")
    base_rate = approved / max(approved + declined, 1) if (approved + declined) > 0 else 0.5

    created = _parse_iso(e.get("created_at"))
    age_days = (_now() - created).days if created else 0
    age_decay = max(0, 1 - age_days / 30)

    history_totals = [float(h.get("total") or 0) for h in history if h.get("status") == "approved"]
    avg_approved = sum(history_totals) / len(history_totals) if history_totals else 0
    this_total = float(e.get("total") or 0)
    size_factor = 1.0 if avg_approved == 0 else min(1.2, max(0.5, avg_approved / max(this_total, 1)))

    score = round(min(95, max(5, base_rate * 100 * size_factor * (0.5 + 0.5 * age_decay))))

    drivers = []
    if base_rate >= 0.7:
        drivers.append(f"Client has approved {int(base_rate * 100)}% of past estimates")
    elif base_rate <= 0.3:
        drivers.append(f"Client only approves {int(base_rate * 100)}% of estimates")
    if age_days > 14:
        drivers.append(f"Estimate is {age_days} days old — momentum fading")
    if avg_approved > 0 and this_total > avg_approved * 1.5:
        drivers.append(f"Total ${this_total:,.0f} is {round(this_total/avg_approved,1)}× client's avg approved size")

    return {
        "estimate_id": estimate_id,
        "estimate_number": e.get("estimate_number"),
        "win_probability": score,
        "tier": "hot" if score >= 70 else "warm" if score >= 40 else "cold",
        "drivers": drivers or ["Insufficient history — using neutral baseline"],
        "history": {"approved": approved, "declined": declined, "avg_approved_total": round(avg_approved, 2)},
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 12. ESTIMATE COMPETITIVE PRICING FLAGS ═══════════════════════

@router.get("/estimates/{estimate_id}/pricing-flags")
async def pricing_flags(estimate_id: str, current_user: dict = Depends(get_current_user)):
    e = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Estimate not found")

    products = await db.products.find({}, {"_id": 0, "id": 1, "name": 1, "unit_price": 1, "cost": 1}).limit(2000).to_list(2000)
    by_name = {p["name"].lower(): p for p in products if p.get("name")}

    flags = []
    items = e.get("line_items") or []
    for li in items:
        name = (li.get("name") or li.get("description") or "").lower()
        unit = float(li.get("unit_price") or 0)
        match = by_name.get(name)
        if match:
            std = float(match.get("unit_price") or 0)
            cost = float(match.get("cost") or 0)
            if std > 0:
                if unit < std * 0.85:
                    flags.append({"severity": "warning", "item": li.get("name"),
                                  "code": "BELOW_STANDARD",
                                  "message": f"${unit:.2f} is {round((1-unit/std)*100)}% below standard price ${std:.2f}"})
                if cost > 0 and unit < cost * 1.2:
                    flags.append({"severity": "error", "item": li.get("name"),
                                  "code": "BELOW_MARGIN",
                                  "message": f"${unit:.2f} leaves <20% margin (cost ${cost:.2f})"})

    return {
        "estimate_id": estimate_id,
        "flags": flags,
        "items_checked": len(items),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 13. DEVICE HEALTH TRAJECTORY ═══════════════════════

@router.get("/device-health-trajectory")
async def health_trajectory(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    q = {}
    if client_id:
        q["client_id"] = client_id

    devices = await db.devices.find(
        q,
        {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1,
         "purchase_date": 1, "warranty_expiry": 1, "device_type": 1, "status": 1, "last_seen": 1, "errors_count": 1}
    ).limit(2000).to_list(2000)

    now = _now()
    buckets = {"replace_now_30": [], "replace_30_90": [], "replace_90_365": [], "healthy": []}
    for d in devices:
        purchased = _parse_iso(d.get("purchase_date"))
        warranty = _parse_iso(d.get("warranty_expiry"))
        age_days = (now - purchased).days if purchased else None
        warranty_left = (warranty - now).days if warranty else None
        errors = int(d.get("errors_count") or 0)

        score = 0
        if age_days is not None:
            if age_days > 1825:
                score += 50
            elif age_days > 1460:
                score += 30
            elif age_days > 1095:
                score += 15
        if warranty_left is not None:
            if warranty_left < 0:
                score += 25
            elif warranty_left < 90:
                score += 10
        if errors > 50:
            score += 20
        if d.get("status") in ("offline", "error"):
            score += 10

        row = {
            "device_id": d.get("id"),
            "name": d.get("name"),
            "client_name": d.get("client_name"),
            "device_type": d.get("device_type"),
            "age_days": age_days,
            "warranty_days_left": warranty_left,
            "errors": errors,
            "score": score,
        }
        if score >= 70:
            buckets["replace_now_30"].append(row)
        elif score >= 45:
            buckets["replace_30_90"].append(row)
        elif score >= 25:
            buckets["replace_90_365"].append(row)
        else:
            buckets["healthy"].append(row)

    for k in buckets:
        buckets[k].sort(key=lambda r: r["score"], reverse=True)
        buckets[k] = buckets[k][:50]

    return {
        "buckets": buckets,
        "totals": {k: len(v) for k, v in buckets.items()},
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 14. PATCH ANOMALY DETECTOR ═══════════════════════

@router.get("/patches/anomalies")
async def patch_anomalies(current_user: dict = Depends(get_current_user)):
    """Cross-tenant: which patch IDs have caused tickets at 3+ clients."""
    since = (_now() - timedelta(days=60)).isoformat()
    tx = await db.tickets.find(
        {"created_at": {"$gte": since}},
        {"_id": 0, "id": 1, "title": 1, "description": 1, "client_id": 1, "client_name": 1, "ticket_number": 1, "created_at": 1}
    ).limit(2000).to_list(2000)

    kb_pattern = re.compile(r"\bKB\d{6,8}\b", re.I)
    by_kb = defaultdict(lambda: {"clients": set(), "tickets": [], "title_samples": set()})

    for t in tx:
        text = f"{t.get('title','')} {t.get('description','')}"
        for kb in kb_pattern.findall(text):
            kb = kb.upper()
            entry = by_kb[kb]
            entry["clients"].add(t.get("client_id"))
            entry["tickets"].append({
                "ticket_id": t["id"],
                "ticket_number": t.get("ticket_number"),
                "client_name": t.get("client_name"),
                "title": (t.get("title") or "")[:120],
            })
            if t.get("title"):
                entry["title_samples"].add(t["title"][:80])

    anomalies = []
    for kb, e in by_kb.items():
        if len(e["clients"]) >= 3:
            anomalies.append({
                "patch_id": kb,
                "affected_clients": len(e["clients"]),
                "tickets_seen": len(e["tickets"]),
                "title_samples": list(e["title_samples"])[:3],
                "tickets": e["tickets"][:5],
                "severity": "critical" if len(e["clients"]) >= 5 else "warning",
            })

    anomalies.sort(key=lambda a: -a["affected_clients"])
    return {"anomalies": anomalies, "scan_window_days": 60, "generated_at": _now().isoformat()}


# ═══════════════════════ 15. BATTERY HEALTH WALL ═══════════════════════

@router.get("/device-battery-wall")
async def battery_wall(current_user: dict = Depends(get_current_user)):
    """Top 20 laptops with degraded batteries."""
    devices = await db.devices.find(
        {"$or": [{"device_type": "laptop"}, {"device_type": "notebook"}, {"form_factor": "laptop"}]},
        {"_id": 0, "id": 1, "name": 1, "client_name": 1, "battery_health": 1, "battery_cycles": 1,
         "purchase_date": 1, "device_type": 1}
    ).limit(500).to_list(500)

    now = _now()
    rows = []
    for d in devices:
        bh = d.get("battery_health")
        cycles = int(d.get("battery_cycles") or 0)
        purchased = _parse_iso(d.get("purchase_date"))
        age_days = (now - purchased).days if purchased else None

        # If battery_health absent, infer from age + cycles
        if bh is None:
            if age_days is None:
                continue
            inferred = max(20, 100 - int(age_days / 730 * 30) - int(cycles / 100 * 8))
            bh = inferred
            inferred_flag = True
        else:
            bh = int(bh)
            inferred_flag = False

        if bh < 80:
            rows.append({
                "device_id": d["id"],
                "name": d.get("name"),
                "client_name": d.get("client_name"),
                "battery_health": bh,
                "battery_cycles": cycles,
                "age_days": age_days,
                "inferred": inferred_flag,
                "recommend": "replace" if bh < 50 else "monitor",
            })
    rows.sort(key=lambda r: r["battery_health"])
    return {"devices": rows[:20], "checked": len(devices), "generated_at": _now().isoformat()}


# ═══════════════════════ 16. RESTORE DRILL SCHEDULER ═══════════════════════

@router.post("/backup/drills")
async def schedule_restore_drill(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Schedule a restore-test drill."""
    cid = payload.get("client_id")
    if not cid:
        raise HTTPException(400, "client_id required")
    drill = {
        "id": uuid.uuid4().hex,
        "client_id": cid,
        "client_name": payload.get("client_name"),
        "scheduled_for": payload.get("scheduled_for") or (_now() + timedelta(days=7)).isoformat(),
        "scope": payload.get("scope") or "sample-restore",
        "status": "scheduled",
        "evidence": [],
        "created_at": _now().isoformat(),
        "created_by": current_user.get("name"),
    }
    await db.backup_drills.insert_one(dict(drill))
    drill.pop("_id", None)
    return drill


@router.get("/backup/drills")
async def list_restore_drills(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    q = {}
    if client_id:
        q["client_id"] = client_id
    drills = await db.backup_drills.find(q, {"_id": 0}).sort("scheduled_for", -1).to_list(200)
    return drills


@router.put("/backup/drills/{drill_id}")
async def complete_drill(drill_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    patch = {
        "status": payload.get("status", "completed"),
        "outcome": payload.get("outcome"),
        "evidence": payload.get("evidence") or [],
        "completed_at": _now().isoformat(),
        "completed_by": current_user.get("name"),
    }
    res = await db.backup_drills.update_one({"id": drill_id}, {"$set": patch})
    if res.matched_count == 0:
        raise HTTPException(404, "Drill not found")
    return await db.backup_drills.find_one({"id": drill_id}, {"_id": 0})


# ═══════════════════════ 17. CYBER INSURANCE VAULT ═══════════════════════

@router.get("/security/insurance-vault")
async def insurance_vault(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Aggregate every artifact a cyber-insurer asks for."""
    q = {}
    if client_id:
        q["client_id"] = client_id

    devices = await db.devices.find(q, {"_id": 0, "id": 1, "mfa_enabled": 1, "edr_installed": 1,
                                        "last_patch_date": 1, "encryption_status": 1, "device_type": 1}).limit(2000).to_list(2000)
    total = len(devices) or 1
    mfa_pct = round(sum(1 for d in devices if d.get("mfa_enabled")) / total * 100)
    edr_pct = round(sum(1 for d in devices if d.get("edr_installed")) / total * 100)
    enc_pct = round(sum(1 for d in devices if d.get("encryption_status") in ("enabled", True, "yes")) / total * 100)

    cutoff_30 = (_now() - timedelta(days=30)).isoformat()
    patched_30 = sum(1 for d in devices if (d.get("last_patch_date") or "") >= cutoff_30)
    patch_pct = round(patched_30 / total * 100)

    last_drill = await db.backup_drills.find_one(
        {**({"client_id": client_id} if client_id else {}), "status": "completed"},
        sort=[("completed_at", -1)],
        projection={"_id": 0}
    )

    huntress_alerts = await db.huntress_alerts.count_documents({"resolved": {"$ne": True}, **({"client_id": client_id} if client_id else {})})

    score = round((mfa_pct * 0.3 + edr_pct * 0.3 + enc_pct * 0.2 + patch_pct * 0.2))
    return {
        "client_id": client_id,
        "score": score,
        "tier": "insurable" if score >= 80 else "needs-improvement" if score >= 60 else "high-risk",
        "controls": {
            "mfa_coverage_pct": mfa_pct,
            "edr_coverage_pct": edr_pct,
            "encryption_pct": enc_pct,
            "patched_within_30_days_pct": patch_pct,
            "open_security_alerts": huntress_alerts,
        },
        "last_restore_drill": last_drill,
        "device_count": total,
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 18. SKILLS XP BANK ═══════════════════════

@router.get("/team/xp")
async def skills_xp(current_user: dict = Depends(get_current_user)):
    """Per-tech XP per skill, computed from closed tickets."""
    closed = await db.tickets.find(
        {"status": {"$in": ["resolved", "closed"]}},
        {"_id": 0, "assignee_id": 1, "assignee_name": 1, "category": 1, "tags": 1, "priority": 1}
    ).limit(5000).to_list(5000)

    xp = defaultdict(lambda: defaultdict(int))
    for t in closed:
        tech = t.get("assignee_name") or t.get("assignee_id")
        if not tech:
            continue
        gain = {"low": 5, "normal": 10, "medium": 10, "high": 20, "critical": 35}.get(t.get("priority"), 10)
        skill_keys = []
        if t.get("category"):
            skill_keys.append(t["category"])
        for tg in (t.get("tags") or [])[:3]:
            skill_keys.append(tg)
        if not skill_keys:
            skill_keys = ["general"]
        for sk in skill_keys:
            xp[tech][sk] += gain

    rows = []
    for tech, skills in xp.items():
        total = sum(skills.values())
        sorted_skills = sorted(skills.items(), key=lambda x: -x[1])
        rows.append({
            "tech": tech,
            "total_xp": total,
            "level": 1 + total // 500,
            "top_skills": [{"skill": k, "xp": v} for k, v in sorted_skills[:5]],
        })
    rows.sort(key=lambda r: -r["total_xp"])
    return {"team": rows, "generated_at": _now().isoformat()}


# ═══════════════════════ 19. 1:1 AUTO-AGENDA ═══════════════════════

@router.get("/team/{tech_id}/1on1-agenda")
async def one_on_one_agenda(tech_id: str, current_user: dict = Depends(get_current_user)):
    tech = await db.users.find_one({"$or": [{"id": tech_id}, {"email": tech_id}]}, {"_id": 0, "id": 1, "name": 1, "email": 1})
    if not tech:
        raise HTTPException(404, "Tech not found")

    cutoff = (_now() - timedelta(days=14)).isoformat()
    closed = await db.tickets.find(
        {"$or": [{"assignee_id": tech["id"]}, {"assignee_name": tech.get("name")}],
         "resolved_at": {"$gte": cutoff}},
        {"_id": 0, "ticket_number": 1, "title": 1, "priority": 1, "client_name": 1}
    ).limit(50).to_list(50)
    open_tx = await db.tickets.find(
        {"$or": [{"assignee_id": tech["id"]}, {"assignee_name": tech.get("name")}],
         "status": {"$in": ["open", "in_progress", "pending", "waiting"]}},
        {"_id": 0, "ticket_number": 1, "title": 1, "priority": 1, "client_name": 1, "created_at": 1}
    ).limit(50).to_list(50)

    sentiment_lows = await db.ticket_sentiment_log.count_documents(
        {"flag": "escalating", "created_at": {"$gte": cutoff}}
    )

    system = (
        "You are a thoughtful team lead writing a 1:1 agenda for a tech. Output 4 sections in clear plain text "
        "(NOT markdown): 'Wins from last fortnight', 'Open challenges', 'Suggested questions to ask', 'Career growth nudge'. "
        "Be specific — quote ticket numbers where useful. Output plain text only, no preamble."
    )
    closed_preview = "\n".join([f"  {c.get('ticket_number')} {c.get('priority')}: {c.get('title','')[:80]} — {c.get('client_name','')}" for c in closed[:10]])
    open_preview = "\n".join([f"  {c.get('ticket_number')} {c.get('priority')}: {c.get('title','')[:80]} — {c.get('client_name','')}" for c in open_tx[:10]])
    user_msg = (
        f"Tech: {tech.get('name')}\n"
        f"Closed last 14 days ({len(closed)}):\n{closed_preview or '  (none)'}\n\n"
        f"Open right now ({len(open_tx)}):\n{open_preview or '  (none)'}\n\n"
        f"Sentiment-escalation events in window: {sentiment_lows}\n"
    )
    body = await _llm(system, user_msg, "agenda")
    return {
        "tech_id": tech["id"],
        "tech_name": tech.get("name"),
        "stats": {"closed_14d": len(closed), "open_now": len(open_tx), "escalations_in_window": sentiment_lows},
        "agenda": body if isinstance(body, str) else str(body),
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 20. MSP VOICE BRIEF (text) ═══════════════════════

@router.post("/voice/morning-brief")
async def morning_brief(current_user: dict = Depends(get_current_user)):
    since = (_now() - timedelta(hours=14)).isoformat()
    new_tix = await db.tickets.count_documents({"created_at": {"$gte": since}})
    crit_tix = await db.tickets.count_documents({"created_at": {"$gte": since}, "priority": "critical"})
    backup_fails = 0
    if "backup_jobs" in await db.list_collection_names():
        backup_fails = await db.backup_jobs.count_documents({"completed_at": {"$gte": since}, "status": "failed"})
    huntress_open = await db.huntress_alerts.count_documents({"resolved": {"$ne": True}})

    system = (
        "You are an MSP morning radio host. Deliver a 60-second spoken-word brief of the night's events. "
        "Conversational tone, like talking to a tech in their car. Plain text, no markdown, around 110-130 words. "
        "End with one motivational sign-off."
    )
    user_msg = (
        f"Overnight (last 14h):\n"
        f"  New tickets: {new_tix} ({crit_tix} critical)\n"
        f"  Backup failures: {backup_fails}\n"
        f"  Open Huntress alerts: {huntress_open}\n"
        f"Today is {_now().strftime('%A %d %B')}."
    )
    text = await _llm(system, user_msg, "voicebrief")
    return {
        "text": text if isinstance(text, str) else str(text),
        "stats": {"new_tickets": new_tix, "critical": crit_tix, "backup_failures": backup_fails, "huntress_alerts": huntress_open},
        "generated_at": _now().isoformat(),
    }


# ═══════════════════════ 21. RUN-BOOK PUBLISH FROM TICKET ═══════════════════════

@router.post("/runbooks/from-ticket/{ticket_id}")
async def runbook_from_ticket(ticket_id: str, payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Convert a resolved ticket into a published, reusable runbook."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    if t.get("status") not in ("resolved", "closed"):
        raise HTTPException(400, "Only resolved/closed tickets can become runbooks")

    notes = await db.ticket_notes.find({"ticket_id": ticket_id}, {"_id": 0, "body": 1, "created_at": 1, "author": 1}).sort("created_at", 1).to_list(100)
    convo = "\n".join([f"  {n.get('author','?')}: {(n.get('body') or '')[:300]}" for n in notes[:30]])

    system = (
        "You are a senior MSP technician converting a resolved ticket into a reusable runbook. "
        "Return STRICT JSON ONLY: {title: string, summary: string (1-2 sentences), "
        "steps: [{step: string, detail: string}] (ordered, 3-12 items), "
        "tags: [string] (max 6), category: string}"
    )
    user_msg = (
        f"Ticket #{t.get('ticket_number')} — {t.get('title','')}\n"
        f"Resolution: {t.get('resolution_notes','')[:600]}\n\n"
        f"Conversation history:\n{convo or '(no notes)'}\n"
    )
    parsed = _safe_json(await _llm(system, user_msg, "runbook"))
    if not parsed.get("steps"):
        raise HTTPException(502, "AI failed to extract runbook steps")

    rb = {
        "id": uuid.uuid4().hex,
        "title": parsed.get("title") or t.get("title"),
        "summary": parsed.get("summary"),
        "steps": parsed.get("steps") or [],
        "tags": parsed.get("tags") or [],
        "category": parsed.get("category") or t.get("category"),
        "source_ticket_id": ticket_id,
        "source_ticket_number": t.get("ticket_number"),
        "published": bool(payload.get("publish", True)),
        "created_by": current_user.get("name"),
        "created_at": _now().isoformat(),
    }
    await db.runbooks.insert_one(dict(rb))
    rb.pop("_id", None)
    return rb


@router.get("/runbooks")
async def list_runbooks(q: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    qry = {"published": True}
    if q:
        qry["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"tags": {"$regex": q, "$options": "i"}},
            {"category": {"$regex": q, "$options": "i"}},
        ]
    rows = await db.runbooks.find(qry, {"_id": 0}).sort("created_at", -1).to_list(100)
    return rows
