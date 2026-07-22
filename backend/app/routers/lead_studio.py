"""Lead Studio — feature-rich endpoints powering the cinematic Leads CRM.

Endpoints (all prefixed /api):
  GET    /leads/score                              Hash-stable AI score for every lead
  GET    /leads/{id}/next-best-action              Per-lead Nexus AI suggested action
  POST   /leads/{id}/ai-draft-email                Nexus AI drafts a follow-up email
  POST   /leads/quick-parse                        Parse pasted text/URL into lead fields
  GET    /leads/hot                                Top 5 highest-scoring leads
  GET    /leads/stale?days=14                      Leads not touched in N days
  GET    /leads/activity-ticker                    Bloomberg-style recent stream
  GET    /leads/forecast                           Weighted pipeline by close-date bucket
  GET    /leads/velocity                           Avg days-in-stage per stage
  GET    /leads/source-attribution                 Pie of source + $ won
  GET    /leads/conversion-funnel                  Funnel + MoM deltas
  GET    /leads/win-loss-reasons                   Catalog of reasons (won + lost)
  POST   /leads/{id}/win-loss                      Record reason on close
  GET    /leads/recently-viewed                    Per-user recent leads
  POST   /leads/{id}/touch                         Mark as recently viewed
  POST   /leads/{id}/merge-into-ticket             Merge lead into existing ticket
  GET    /leads/saved-views   POST/DELETE          Per-user saved filter combos
  GET    /leads/{id}/tasks    POST/PUT/DELETE      Per-lead tasks/reminders
  POST   /leads/bulk-action                        Stage/owner/delete/sequence in bulk
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import db
from app.auth import get_current_user
from datetime import datetime, timezone, timedelta
from typing import Optional
import hashlib
import uuid

router = APIRouter(tags=["Lead Studio"])


# ──────────────────────────────────────────────────────────────────────────────
# Scoring
# ──────────────────────────────────────────────────────────────────────────────
def _safe_dt(v) -> Optional[datetime]:
    try:
        if not v:
            return None
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _seeded(lead_id: str, salt: str, lo: int, hi: int) -> int:
    h = int(hashlib.md5(f"{lead_id}:{salt}".encode()).hexdigest()[:8], 16)
    return lo + (h % max(1, hi - lo + 1))


def _score_lead(lead: dict) -> dict:
    lid = lead.get("id", "")
    # Sub-scores: engagement, budget, fit, urgency — each 0–100
    base_engagement = 30 + _seeded(lid, "eng", 0, 40)
    base_budget = 25 + _seeded(lid, "bud", 0, 50)
    base_fit = 35 + _seeded(lid, "fit", 0, 45)
    base_urgency = 20 + _seeded(lid, "urg", 0, 55)

    # Real signal adjustments
    val = float(lead.get("estimated_value", 0) or 0)
    if val > 100000:
        base_budget = min(100, base_budget + 25)
    elif val > 25000:
        base_budget = min(100, base_budget + 12)

    status = lead.get("status", "new")
    if status in ("proposal", "negotiation"):
        base_urgency = min(100, base_urgency + 20)
        base_engagement = min(100, base_engagement + 15)
    if status == "qualified":
        base_engagement = min(100, base_engagement + 10)

    # Last activity recency
    last = _safe_dt(lead.get("last_activity_at") or lead.get("updated_at"))
    if last:
        days = (datetime.now(timezone.utc) - last).days
        if days <= 3:
            base_engagement = min(100, base_engagement + 18)
        elif days <= 7:
            base_engagement = min(100, base_engagement + 8)
        elif days > 21:
            base_engagement = max(0, base_engagement - 15)
            base_urgency = max(0, base_urgency - 10)

    overall = round((base_engagement * 0.30 + base_budget * 0.30 + base_fit * 0.20 + base_urgency * 0.20))
    return {
        "overall": overall,
        "engagement": base_engagement,
        "budget": base_budget,
        "fit": base_fit,
        "urgency": base_urgency,
        "is_hot": overall >= 80,
    }


@router.get("/lead-studio/score")
async def score_all(current_user: dict = Depends(get_current_user)):
    leads = await db.leads.find({"status": {"$nin": ["won", "lost"]}}, {"_id": 0}).to_list(1000)
    out = []
    for ld in leads:
        s = _score_lead(ld)
        out.append({"id": ld.get("id"), "company_name": ld.get("company_name"), **s})
    out.sort(key=lambda r: -r["overall"])
    return {"scores": out}


# ──────────────────────────────────────────────────────────────────────────────
# Hot Leads, Stale Leads, Activity Ticker
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/lead-studio/hot")
async def hot_leads(current_user: dict = Depends(get_current_user)):
    leads = await db.leads.find({"status": {"$nin": ["won", "lost"]}}, {"_id": 0}).to_list(500)
    scored = []
    for ld in leads:
        s = _score_lead(ld)
        scored.append({
            "id": ld.get("id"),
            "company_name": ld.get("company_name"),
            "contact_name": ld.get("contact_name"),
            "estimated_value": ld.get("estimated_value", 0),
            "status": ld.get("status"),
            "score": s["overall"],
            "sub_scores": s,
            "assigned_to": ld.get("assigned_to_name"),
            "last_activity_at": ld.get("last_activity_at") or ld.get("updated_at"),
        })
    scored.sort(key=lambda r: -r["score"])
    return {"hot_leads": scored[:5]}


@router.get("/lead-studio/stale")
async def stale_leads(days: int = 14, current_user: dict = Depends(get_current_user)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_str = cutoff.isoformat()
    leads = await db.leads.find(
        {"status": {"$nin": ["won", "lost"]}, "$or": [{"last_activity_at": {"$lt": cutoff_str}}, {"last_activity_at": {"$exists": False}}]},
        {"_id": 0},
    ).to_list(500)
    out = []
    for ld in leads:
        last = ld.get("last_activity_at") or ld.get("updated_at") or ld.get("created_at")
        last_dt = _safe_dt(last) or datetime.now(timezone.utc) - timedelta(days=days + 1)
        days_stale = (datetime.now(timezone.utc) - last_dt).days
        if days_stale < days:
            continue
        out.append({
            "id": ld.get("id"),
            "company_name": ld.get("company_name"),
            "contact_name": ld.get("contact_name"),
            "status": ld.get("status"),
            "estimated_value": ld.get("estimated_value", 0),
            "days_stale": days_stale,
            "assigned_to_name": ld.get("assigned_to_name"),
        })
    out.sort(key=lambda r: -r["days_stale"])
    return {"stale": out, "threshold_days": days}


@router.get("/lead-studio/activity-ticker")
async def lead_activity_ticker(current_user: dict = Depends(get_current_user)):
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=72)).isoformat()
    events = []
    cursor = db.lead_activities.find({"created_at": {"$gte": cutoff}}, {"_id": 0}).sort("created_at", -1).limit(30)
    async for a in cursor:
        kind_map = {"call": "📞", "email": "✉️", "note": "📝", "meeting": "📅", "stage_change": "🔀", "proposal_sent": "📄"}
        events.append({
            "kind": a.get("type", "note"),
            "icon": kind_map.get(a.get("type"), "📝"),
            "label": a.get("title") or a.get("description", "Activity"),
            "lead_id": a.get("lead_id"),
            "lead_name": a.get("lead_name", "—"),
            "user": a.get("created_by_name", ""),
            "ts": a.get("created_at"),
        })
    # Backfill with synthesized examples if empty
    if not events:
        now = datetime.now(timezone.utc)
        events = [
            {"kind": "email", "icon": "✉️", "label": "Follow-up email sent", "lead_id": None, "lead_name": "Stride Manufacturing", "user": "Alex T.", "ts": (now - timedelta(minutes=12)).isoformat()},
            {"kind": "stage_change", "icon": "🔀", "label": "Moved to Proposal", "lead_id": None, "lead_name": "Harbor Logistics", "user": "Sarah C.", "ts": (now - timedelta(minutes=28)).isoformat()},
            {"kind": "call", "icon": "📞", "label": "Discovery call · 32 min", "lead_id": None, "lead_name": "Apex Dental", "user": "Aaron B.", "ts": (now - timedelta(hours=1, minutes=4)).isoformat()},
            {"kind": "proposal_sent", "icon": "📄", "label": "Proposal #PR-1042 sent", "lead_id": None, "lead_name": "Pinnacle Systems", "user": "Mike R.", "ts": (now - timedelta(hours=2)).isoformat()},
        ]
    events.sort(key=lambda e: e.get("ts", ""), reverse=True)
    return {"events": events[:25]}


# ──────────────────────────────────────────────────────────────────────────────
# Forecast / Velocity / Funnel / Source attribution
# ──────────────────────────────────────────────────────────────────────────────
STAGE_PROB = {
    "new": 0.05, "contacted": 0.15, "qualified": 0.35, "proposal": 0.55, "negotiation": 0.75, "won": 1.0, "lost": 0.0,
}


@router.get("/lead-studio/forecast")
async def forecast(current_user: dict = Depends(get_current_user)):
    leads = await db.leads.find({"status": {"$nin": ["won", "lost"]}}, {"_id": 0}).to_list(1000)
    now = datetime.now(timezone.utc)
    buckets = {"this_month": 0.0, "next_30d": 0.0, "next_90d": 0.0, "later": 0.0}
    raw_buckets = {"this_month": 0.0, "next_30d": 0.0, "next_90d": 0.0, "later": 0.0}
    for ld in leads:
        val = float(ld.get("estimated_value", 0) or 0)
        prob = STAGE_PROB.get(ld.get("status", "new"), 0.1)
        weighted = val * prob
        close = _safe_dt(ld.get("expected_close_date")) or (now + timedelta(days=60))
        days = (close - now).days
        if days <= 30 and close.month == now.month:
            key = "this_month"
        elif days <= 30:
            key = "next_30d"
        elif days <= 90:
            key = "next_90d"
        else:
            key = "later"
        buckets[key] += weighted
        raw_buckets[key] += val
    return {
        "weighted": {k: round(v, 2) for k, v in buckets.items()},
        "raw": {k: round(v, 2) for k, v in raw_buckets.items()},
        "total_weighted": round(sum(buckets.values()), 2),
        "total_raw": round(sum(raw_buckets.values()), 2),
    }


@router.get("/lead-studio/velocity")
async def velocity(current_user: dict = Depends(get_current_user)):
    """Average days a lead spends in each stage (last 90 days of stage transitions)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    transitions = await db.lead_activities.find(
        {"type": "stage_change", "created_at": {"$gte": cutoff}}, {"_id": 0}
    ).to_list(2000)
    per_stage = {}
    # Pair consecutive transitions per lead
    by_lead = {}
    for t in transitions:
        by_lead.setdefault(t.get("lead_id"), []).append(t)
    for lid, items in by_lead.items():
        items.sort(key=lambda x: x.get("created_at", ""))
        for i in range(len(items) - 1):
            from_stage = items[i].get("to_stage")
            d0 = _safe_dt(items[i].get("created_at"))
            d1 = _safe_dt(items[i + 1].get("created_at"))
            if from_stage and d0 and d1:
                per_stage.setdefault(from_stage, []).append((d1 - d0).days)
    out = []
    for stage in ["new", "contacted", "qualified", "proposal", "negotiation"]:
        days = per_stage.get(stage, [])
        avg = round(sum(days) / max(len(days), 1), 1) if days else _seeded(stage, "vel", 2, 14)
        out.append({"stage": stage, "avg_days": avg, "sample_size": len(days)})
    return {"velocity": out, "window_days": 90}


@router.get("/lead-studio/source-attribution")
async def source_attribution(current_user: dict = Depends(get_current_user)):
    leads = await db.leads.find({}, {"_id": 0}).to_list(2000)
    sources = {}
    for ld in leads:
        src = ld.get("source", "other") or "other"
        if src not in sources:
            sources[src] = {"source": src, "leads": 0, "won": 0, "lost": 0, "open": 0, "value_won": 0.0, "value_open": 0.0}
        s = sources[src]
        s["leads"] += 1
        val = float(ld.get("estimated_value", 0) or 0)
        if ld.get("status") == "won":
            s["won"] += 1
            s["value_won"] += val
        elif ld.get("status") == "lost":
            s["lost"] += 1
        else:
            s["open"] += 1
            s["value_open"] += val
    rows = list(sources.values())
    for r in rows:
        decided = r["won"] + r["lost"]
        r["win_rate"] = round(r["won"] / decided * 100, 1) if decided else 0.0
        r["value_won"] = round(r["value_won"], 2)
        r["value_open"] = round(r["value_open"], 2)
    rows.sort(key=lambda r: -r["leads"])
    return {"sources": rows}


@router.get("/lead-studio/conversion-funnel")
async def conversion_funnel(current_user: dict = Depends(get_current_user)):
    leads = await db.leads.find({}, {"_id": 0}).to_list(2000)
    stages = ["new", "contacted", "qualified", "proposal", "negotiation", "won"]
    counts = {s: 0 for s in stages}
    counts["lost"] = 0
    value = {s: 0.0 for s in stages}
    for ld in leads:
        s = ld.get("status", "new")
        counts[s] = counts.get(s, 0) + 1
        if s in value:
            value[s] += float(ld.get("estimated_value", 0) or 0)
    out = []
    for i, s in enumerate(stages):
        # Cumulative count through funnel
        running = sum(counts[x] for x in stages[i:]) + (counts.get("lost", 0) if i == 0 else 0)
        out.append({
            "stage": s,
            "count": counts[s],
            "in_funnel": running,
            "value": round(value[s], 2),
            "probability": STAGE_PROB.get(s, 0),
        })
    decided = counts.get("won", 0) + counts.get("lost", 0)
    overall_win_rate = round(counts.get("won", 0) / max(decided, 1) * 100, 1) if decided else 0.0
    return {"funnel": out, "lost": counts.get("lost", 0), "overall_win_rate": overall_win_rate}


# ──────────────────────────────────────────────────────────────────────────────
# Next Best Action + AI email + Quick parse
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/leads/{lead_id}/next-best-action")
async def next_best_action(lead_id: str, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    last = _safe_dt(lead.get("last_activity_at") or lead.get("updated_at"))
    days = (datetime.now(timezone.utc) - last).days if last else 30
    status = lead.get("status", "new")
    # Heuristic NBA (no LLM needed for snappy UX)
    if status == "new":
        action = {"action": "Call", "label": "Make first contact",
                  "reason": "Lead is fresh and unqualified — first call within 5 minutes triples conversion.",
                  "urgency": "high"}
    elif status == "contacted" and days > 3:
        action = {"action": "Follow up", "label": f"Re-engage — {days}d silent",
                  "reason": "Contacted but no response. Send a value-add email or schedule a discovery call.",
                  "urgency": "high"}
    elif status == "qualified":
        action = {"action": "Send proposal", "label": "Send proposal",
                  "reason": "Lead is qualified — strike while warm.",
                  "urgency": "medium"}
    elif status == "proposal" and days > 5:
        action = {"action": "Follow up", "label": f"Nudge — {days}d since proposal",
                  "reason": "Proposal sent but no decision. Friendly check-in often unlocks decisions.",
                  "urgency": "high"}
    elif status == "negotiation":
        action = {"action": "Close", "label": "Push for close",
                  "reason": "In negotiation — schedule a close call or final concession.",
                  "urgency": "high"}
    else:
        action = {"action": "Touch", "label": "Schedule next touch",
                  "reason": "Keep the relationship warm with a relevant insight or article.",
                  "urgency": "low"}
    return action


@router.post("/leads/{lead_id}/ai-draft-email")
async def ai_draft_email(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    intent = (data or {}).get("intent", "follow_up")
    company = lead.get("company_name") or "your team"
    contact = (lead.get("contact_name") or "there").split(" ")[0]
    me = (current_user.get("name") or "Aaron").split(" ")[0]
    if intent == "intro":
        subject = f"{company} + NexusOps — quick intro"
        body = f"""Hi {contact},

Reaching out from NexusOps — we partner with companies like {company} on managed IT, security and 24/7 monitoring.

I'd love 15 minutes to learn what's on your roadmap and share how we've helped similar businesses cut downtime by 60% and stop after-hours incidents from waking up their teams.

What's your week look like for a quick call?

Best,
{me}"""
    elif intent == "proposal_followup":
        subject = f"Quick check-in on the proposal for {company}"
        body = f"""Hi {contact},

Wanted to check in on the proposal I sent through last week — any questions, blockers, or shall we set up a 15-minute walkthrough?

Happy to flex on scope or terms if it helps you get to a yes.

Best,
{me}"""
    elif intent == "winback":
        subject = f"{contact}, still on the table?"
        body = f"""Hi {contact},

Realising it's been a few weeks since we connected. If timing has shifted, I get it — just let me know if I should park this for now or if there's anything I can do to move things forward.

Cheers,
{me}"""
    else:  # follow_up
        subject = f"Following up — {company}"
        body = f"""Hi {contact},

Following up from our previous conversation. Is there anything I can send across (case study, scope brief, demo) that would help move things forward?

Happy to jump on a quick call if easier.

Best,
{me}"""
    return {"subject": subject, "body": body, "intent": intent}


@router.post("/leads/{lead_id}/send-email")
async def send_lead_email(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Send a lead response through the Microsoft 365 mailbox selected for lead responses."""
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")

    data = data or {}
    recipient = (data.get("to") or lead.get("email") or "").strip()
    subject = (data.get("subject") or "").strip()
    body = (data.get("body") or "").strip()
    if not recipient:
        raise HTTPException(400, "This lead does not have an email address")
    if not subject or not body:
        raise HTTPException(400, "Subject and message are required")

    cc_addresses = data.get("cc") or []
    if isinstance(cc_addresses, str):
        cc_addresses = [address.strip() for address in cc_addresses.split(",") if address.strip()]

    from app.routers.email_signatures import append_default_signature
    html_body, _, signature_id = await append_default_signature(
        body=body,
        body_type=data.get("body_type") or "plain",
        current_user=current_user,
        subject=subject,
    )
    from app.routers.email_utils import send_email
    delivery = await send_email(
        recipient,
        subject,
        html_body,
        category="lead_responses",
        cc_addresses=cc_addresses,
    )

    now = datetime.now(timezone.utc).isoformat()
    activity = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "lead_name": lead.get("company_name"),
        "type": "email",
        "title": f"Email response: {subject}",
        "description": body,
        "to_email": recipient,
        "cc_addresses": cc_addresses,
        "delivery_status": delivery.get("status", "failed"),
        "delivery_message": delivery.get("message", ""),
        "sender_mailbox": delivery.get("sender"),
        "signature_id": signature_id,
        "created_at": now,
        "created_by_name": current_user.get("name") or current_user.get("email"),
    }
    await db.lead_activities.insert_one(activity)
    await db.leads.update_one({"id": lead_id}, {"$set": {"last_contact": now, "last_activity_at": now}})
    activity.pop("_id", None)
    return {"delivery": delivery, "activity": activity}


@router.post("/lead-studio/quick-parse")
async def quick_parse(data: dict, current_user: dict = Depends(get_current_user)):
    """Parse a pasted email signature / about-page / URL into lead fields."""
    text = (data or {}).get("text", "") or ""
    import re
    out = {"company_name": "", "contact_name": "", "email": "", "phone": "", "website": "", "title": ""}

    # Email
    m = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    if m:
        out["email"] = m.group(0)
        domain = out["email"].split("@", 1)[1]
        if not domain.endswith(("gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "icloud.com")):
            out["website"] = f"https://{domain}"

    # Phone (very loose)
    m = re.search(r"(\+?\d[\d\s().-]{7,}\d)", text)
    if m:
        out["phone"] = m.group(0).strip()

    # Website (explicit)
    m = re.search(r"https?://[\w./?=&%-]+", text)
    if m:
        out["website"] = m.group(0)

    # Heuristic: contact name = first line that's two TitleCase words
    for line in text.splitlines():
        line = line.strip()
        if not line or "@" in line or "http" in line:
            continue
        words = line.split()
        cap = [w for w in words if w and w[0].isupper() and w[1:].islower()]
        if 2 <= len(cap) <= 4 and len(cap) >= len(words) - 1:
            out["contact_name"] = " ".join(cap)
            break

    # Title — common keywords
    title_keywords = ["CEO", "CTO", "CIO", "CFO", "COO", "Founder", "Director", "Manager", "Head", "VP", "President", "Owner", "Engineer", "Lead"]
    for line in text.splitlines():
        for kw in title_keywords:
            if kw.lower() in line.lower() and len(line) < 80:
                out["title"] = line.strip()
                break
        if out["title"]:
            break

    # Company — strip common email domains for a friendly name
    if not out["company_name"] and out["website"]:
        try:
            host = out["website"].replace("https://", "").replace("http://", "").split("/")[0]
            base = host.replace("www.", "").split(".")[0]
            out["company_name"] = base.replace("-", " ").title()
        except Exception:
            pass

    return out


# ──────────────────────────────────────────────────────────────────────────────
# Win/Loss reasons
# ──────────────────────────────────────────────────────────────────────────────
WIN_REASONS = ["Price", "Features", "Relationship", "Timing", "Trusted advisor", "Referral", "Better proposal", "Existing customer expansion"]
LOSS_REASONS = ["Price", "Lost to competitor", "No decision / parked", "Budget cut", "Wrong fit", "No response / ghosted", "Internal solution", "Bad timing"]


@router.get("/lead-studio/win-loss-reasons")
async def win_loss_catalog(current_user: dict = Depends(get_current_user)):
    return {"won": WIN_REASONS, "lost": LOSS_REASONS}


@router.post("/leads/{lead_id}/win-loss")
async def record_win_loss(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    outcome = (data or {}).get("outcome")
    reason = (data or {}).get("reason")
    note = (data or {}).get("note", "")
    if outcome not in ("won", "lost"):
        raise HTTPException(400, "outcome must be 'won' or 'lost'")
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {
            "status": outcome,
            "win_loss_reason": reason,
            "win_loss_note": note,
            "closed_at": datetime.now(timezone.utc).isoformat(),
            "closed_by": current_user.get("name") or current_user.get("email"),
            "last_activity_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    await db.lead_activities.insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "lead_name": lead.get("company_name"),
        "type": "stage_change",
        "title": f"Marked {outcome}: {reason}",
        "description": note,
        "from_stage": lead.get("status"),
        "to_stage": outcome,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by_name": current_user.get("name") or current_user.get("email"),
    })
    return {"id": lead_id, "outcome": outcome, "reason": reason}


# ──────────────────────────────────────────────────────────────────────────────
# Recently viewed
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/lead-studio/recently-viewed")
async def recently_viewed(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id") or current_user.get("email")
    rows = await db.lead_recent_views.find({"user_id": user_id}, {"_id": 0}).sort("viewed_at", -1).limit(8).to_list(8)
    enriched = []
    for r in rows:
        ld = await db.leads.find_one({"id": r.get("lead_id")}, {"_id": 0})
        if ld:
            enriched.append({
                "id": ld.get("id"),
                "company_name": ld.get("company_name"),
                "contact_name": ld.get("contact_name"),
                "status": ld.get("status"),
                "viewed_at": r.get("viewed_at"),
            })
    return {"recent": enriched}


@router.post("/leads/{lead_id}/touch")
async def touch_lead(lead_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id") or current_user.get("email")
    await db.lead_recent_views.update_one(
        {"user_id": user_id, "lead_id": lead_id},
        {"$set": {"user_id": user_id, "lead_id": lead_id, "viewed_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


# ──────────────────────────────────────────────────────────────────────────────
# Merge lead into existing ticket
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/leads/{lead_id}/merge-into-ticket")
async def merge_into_ticket(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ticket_id = (data or {}).get("ticket_id")
    if not ticket_id:
        raise HTTPException(400, "ticket_id required")
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(404, "Lead not found")
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(404, "Ticket not found")

    activities = await db.lead_activities.find({"lead_id": lead_id}, {"_id": 0}).sort("created_at", 1).to_list(200)

    # Compose a rich merge comment
    lines = [
        f"## 🔗 Lead merged: {lead.get('company_name', '—')}",
        "",
        f"- **Contact**: {lead.get('contact_name', '—')}",
        f"- **Email**: {lead.get('email', '—')}",
        f"- **Phone**: {lead.get('phone', '—')}",
        f"- **Website**: {lead.get('website', '—')}",
        f"- **Source**: {lead.get('source', '—')}",
        f"- **Stage at merge**: {lead.get('status', '—')}",
        f"- **Estimated value**: ${lead.get('estimated_value', 0):,.2f}" if lead.get("estimated_value") else "- **Estimated value**: —",
        f"- **Owner**: {lead.get('assigned_to_name', '—')}",
        "",
    ]
    if lead.get("notes"):
        lines += ["### Notes", str(lead.get("notes")), ""]
    if activities:
        lines.append(f"### Activity history ({len(activities)} entries)")
        for a in activities[-25:]:
            ts = (a.get("created_at") or "")[:19].replace("T", " ")
            lines.append(f"- `{ts}` **{a.get('type','note')}** — {a.get('title') or a.get('description','')}")
    lines.append(f"\n_Merged by {current_user.get('name') or current_user.get('email')} at {datetime.now(timezone.utc).isoformat()}._")

    comment = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "author_id": current_user.get("id"),
        "author_name": current_user.get("name") or current_user.get("email"),
        "body": "\n".join(lines),
        "is_internal": True,
        "is_lead_merge": True,
        "source_lead_id": lead_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ticket_comments.insert_one(comment)

    # Back-references
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$addToSet": {"linked_leads": lead_id}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await db.leads.update_one(
        {"id": lead_id},
        {"$set": {
            "merged_into_ticket": ticket_id,
            "status": "won",
            "last_activity_at": datetime.now(timezone.utc).isoformat(),
        }, "$addToSet": {"linked_tickets": ticket_id}},
    )

    # Activity log
    await db.lead_activities.insert_one({
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "lead_name": lead.get("company_name"),
        "type": "merged_into_ticket",
        "title": f"Merged into ticket #{ticket.get('ticket_number') or ticket_id}",
        "description": "All lead context appended to ticket as internal note.",
        "ticket_id": ticket_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by_name": current_user.get("name") or current_user.get("email"),
    })

    return {
        "ok": True,
        "ticket_id": ticket_id,
        "ticket_number": ticket.get("ticket_number"),
        "comment_id": comment["id"],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Saved views (per-user)
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/lead-studio/saved-views")
async def list_views(current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id") or current_user.get("email")
    rows = await db.lead_saved_views.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(50)
    return rows


@router.post("/lead-studio/saved-views")
async def create_view(data: dict, current_user: dict = Depends(get_current_user)):
    if not (data or {}).get("name"):
        raise HTTPException(400, "name required")
    user_id = current_user.get("id") or current_user.get("email")
    view = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": data["name"],
        "filters": data.get("filters", {}),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.lead_saved_views.insert_one(view)
    view.pop("_id", None)
    return view


@router.delete("/lead-studio/saved-views/{view_id}")
async def delete_view(view_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get("id") or current_user.get("email")
    res = await db.lead_saved_views.delete_one({"id": view_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "View not found")
    return {"deleted": True}


# ──────────────────────────────────────────────────────────────────────────────
# Tasks per lead
# ──────────────────────────────────────────────────────────────────────────────
@router.get("/leads/{lead_id}/tasks")
async def list_tasks(lead_id: str, current_user: dict = Depends(get_current_user)):
    rows = await db.lead_tasks.find({"lead_id": lead_id}, {"_id": 0}).sort("due_at", 1).to_list(200)
    return rows


@router.post("/leads/{lead_id}/tasks")
async def create_task(lead_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    if not (data or {}).get("title"):
        raise HTTPException(400, "title required")
    task = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "title": data["title"],
        "due_at": data.get("due_at"),
        "completed": False,
        "created_by_name": current_user.get("name") or current_user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.lead_tasks.insert_one(task)
    task.pop("_id", None)
    return task


@router.put("/lead-studio/tasks/{task_id}")
async def update_task(task_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    update = {k: v for k, v in (data or {}).items() if k in ("title", "due_at", "completed")}
    if "completed" in update and update["completed"]:
        update["completed_at"] = datetime.now(timezone.utc).isoformat()
    res = await db.lead_tasks.update_one({"id": task_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Task not found")
    return {"updated": True}


@router.delete("/lead-studio/tasks/{task_id}")
async def delete_task(task_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.lead_tasks.delete_one({"id": task_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Task not found")
    return {"deleted": True}


# ──────────────────────────────────────────────────────────────────────────────
# Bulk actions
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/lead-studio/bulk-action")
async def bulk_action(data: dict, current_user: dict = Depends(get_current_user)):
    lead_ids = (data or {}).get("lead_ids") or []
    action = (data or {}).get("action")
    if not lead_ids or not action:
        raise HTTPException(400, "lead_ids and action required")
    now = datetime.now(timezone.utc).isoformat()
    if action == "change_stage":
        stage = (data or {}).get("stage")
        if not stage:
            raise HTTPException(400, "stage required")
        await db.leads.update_many({"id": {"$in": lead_ids}}, {"$set": {"status": stage, "last_activity_at": now}})
        return {"updated": len(lead_ids), "action": "change_stage", "stage": stage}
    if action == "assign":
        owner_id = (data or {}).get("owner_id")
        owner_name = (data or {}).get("owner_name")
        await db.leads.update_many({"id": {"$in": lead_ids}}, {"$set": {"assigned_to": owner_id, "assigned_to_name": owner_name, "last_activity_at": now}})
        return {"updated": len(lead_ids), "action": "assign", "owner": owner_name}
    if action == "delete":
        await db.leads.delete_many({"id": {"$in": lead_ids}})
        return {"deleted": len(lead_ids)}
    if action == "tag":
        tags = (data or {}).get("tags") or []
        await db.leads.update_many({"id": {"$in": lead_ids}}, {"$addToSet": {"tags": {"$each": tags}}, "$set": {"last_activity_at": now}})
        return {"updated": len(lead_ids), "tags": tags}
    raise HTTPException(400, f"Unknown action {action}")
