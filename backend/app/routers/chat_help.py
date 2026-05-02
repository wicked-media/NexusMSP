"""Chat broadcast hook + Help center.

Chat broadcast:
  POST /api/chat/broadcast/sentiment-escalating  — fires when any ticket flips to escalating
  POST /api/chat/broadcast/sla-page              — fires when SLA auto-page creates a new page

Help center:
  GET  /api/help/articles                        — list (with search)
  GET  /api/help/articles/{slug}                 — full article
  POST /api/help/articles                        — create/update article (admin)
  DELETE /api/help/articles/{slug}               — remove
  POST /api/help/seed                            — seed default articles
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone
from typing import Optional
import uuid, re

from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", (s or "").lower())).strip("-")


# ═══════════════════════ CHAT BROADCAST HOOKS ═══════════════════════

async def _post_to_general(title: str, body: str, ref_type: Optional[str] = None, ref_id: Optional[str] = None) -> dict:
    """Helper that posts a system message into #general channel."""
    ch = await db.chat_channels.find_one({"name": "general", "kind": "team"}, {"_id": 0})
    if not ch:
        # Create general if missing
        ch = {
            "id": uuid.uuid4().hex,
            "name": "general", "kind": "team", "member_ids": [],
            "created_at": _now_iso(),
        }
        await db.chat_channels.insert_one(dict(ch))
    msg = {
        "id": uuid.uuid4().hex,
        "channel_id": ch["id"],
        "user_id": "system",
        "user_name": "NexusOps",
        "is_system": True,
        "body": f"*{title}*\n{body}",
        "ref_type": ref_type,
        "ref_id": ref_id,
        "ts": _now_iso(),
        "reactions": {},
    }
    await db.chat_messages.insert_one(dict(msg))
    msg.pop("_id", None)
    return msg


@router.post("/chat/broadcast/sentiment-escalating")
async def broadcast_sentiment_escalating(payload: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Scans recent escalating sentiment events; broadcasts any new ones into #general."""
    from datetime import timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    rows = await db.ticket_sentiment_log.find(
        {"created_at": {"$gte": cutoff}, "flag": "escalating"},
        {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)

    posted = []
    for r in rows:
        tid = r.get("ticket_id")
        if not tid: continue
        already = await db.chat_messages.find_one({"ref_type": "sentiment_escalation", "ref_id": tid}, {"_id": 0})
        if already: continue
        t = await db.tickets.find_one({"id": tid}, {"_id": 0, "ticket_number": 1, "title": 1, "client_name": 1, "assignee_name": 1}) or {}
        body = (
            f"@channel  Ticket {t.get('ticket_number','?')} ({t.get('client_name','?')}) sentiment is escalating.\n"
            f"Title: {t.get('title','')[:100]}\n"
            f"Assignee: {t.get('assignee_name','unassigned')}\n"
            f"Reaction: 👀 = I'm on it · ✋ = needs reassignment"
        )
        msg = await _post_to_general("⚠️ Sentiment escalation", body, ref_type="sentiment_escalation", ref_id=tid)
        posted.append({"ticket_number": t.get("ticket_number"), "msg_id": msg["id"]})
    return {"posted": len(posted), "items": posted}


@router.post("/chat/broadcast/sla-page")
async def broadcast_sla_page(current_user: dict = Depends(get_current_user)):
    """Reads recent sla_auto_pages; posts uncleared ones to #general."""
    rows = await db.sla_auto_pages.find({"cleared": {"$ne": True}}, {"_id": 0}).sort("paged_at", -1).limit(20).to_list(20)
    posted = []
    for r in rows:
        already = await db.chat_messages.find_one({"ref_type": "sla_page", "ref_id": r.get("id")}, {"_id": 0})
        if already: continue
        t = await db.tickets.find_one({"id": r.get("ticket_id")}, {"_id": 0, "ticket_number": 1, "title": 1, "client_name": 1, "assignee_name": 1}) or {}
        body = (
            f"@channel  SLA risk score {r.get('score')}/100 on {r.get('ticket_number','?')}\n"
            f"Client: {t.get('client_name','?')} · Assignee: {t.get('assignee_name','unassigned')}\n"
            f"Title: {t.get('title','')[:100]}\n"
            f"React 👀 to claim it."
        )
        msg = await _post_to_general("🚨 SLA Auto-Page", body, ref_type="sla_page", ref_id=r.get("id"))
        posted.append({"ticket_number": t.get("ticket_number"), "msg_id": msg["id"]})
    return {"posted": len(posted), "items": posted}


# Wire both into the existing scheduler tick by exposing a unified endpoint
@router.post("/chat/broadcast/tick")
async def broadcast_tick(current_user: dict = Depends(get_current_user)):
    a = await broadcast_sentiment_escalating(current_user=current_user)
    b = await broadcast_sla_page(current_user=current_user)
    return {"sentiment_posted": a["posted"], "sla_posted": b["posted"]}


# ═══════════════════════ HELP CENTER ═══════════════════════

DEFAULT_ARTICLES = [
    {
        "slug": "getting-started",
        "title": "Getting Started with NexusOps",
        "category": "Basics",
        "icon": "🚀",
        "order": 0,
        "summary": "Your first 10 minutes inside the platform.",
        "body_md": """## Welcome
NexusOps is your MSP command-and-control hub. Here's what to do in your first session:

1. **Sign in** at the login screen with the credentials your admin provided.
2. **Set your status** — click the LED dot beside your name in the chat panel (bottom-right). Active 🟢 / DND 🟠 / Break 🔵.
3. **Open the Command Center** from the sidebar — Reports & Comms → Command Center. This is your "what's on fire right now" screen.
4. **Open the Tickets page** to see queued work assigned to you.
5. **Press Cmd/Ctrl+K** anywhere to toggle the chat panel.

## Where to find things
- **Sidebar** is grouped: Service Desk · Infrastructure · Business · Reports & Comms.
- The search box at the top of the sidebar (Ctrl+K) jumps you anywhere fast.
""",
    },
    {
        "slug": "tickets-module",
        "title": "Tickets Module",
        "category": "Service Desk",
        "icon": "🎫",
        "order": 1,
        "summary": "Everything you can do on a ticket.",
        "body_md": """## Overview
The Tickets module is the heart of NexusOps. Every customer interaction lives here.

## Ticket detail toolbar — every button explained
When you open a ticket, the header has these AI buttons (top right):

- **🔥 Why on fire** — Claude explains *why this ticket is still open* (waiting on client / SLA pressure / blocked by parts).
- **💬 Sentiment Badge** — gauges client sentiment trend across the conversation. Green = improving, red = escalating.
- **👥 Doppelgänger** — finds the 3 most similar resolved tickets across ALL clients + their resolution notes.
- **🪄 Suggest Resolution** — copies the resolution from the closest matching past ticket. One-click time saver.
- **✓ Smart Assign** — picks the best tech based on Skills XP × Cognitive Load × on-shift status.
- **✉️ Apology AI** — drafts a warm apology email + make-good offer when sentiment is red or SLA breached.
- **📖 To Runbook** — (resolved tickets only) promotes the resolution into a published runbook for the team.

## Tabs
- **Conversation**, **Worksheet**, **Suggestions** (AI-suggested blueprints), **Files**, **Items** (products/parts), **Children** (sub-tickets), **Time**, **Audit**, and **Time Machine** — a chronological replay of every event on the ticket.

## Pro tips
- Type `/assign @bob TKT-001` in chat to reassign without leaving chat.
- Drag-and-drop files directly onto the ticket detail to attach.
""",
    },
    {
        "slug": "command-center",
        "title": "Command Center",
        "category": "Reports & Comms",
        "icon": "🎯",
        "order": 2,
        "summary": "The single screen you leave open all day.",
        "body_md": """## What it is
The Command Center is a compounding intelligence dashboard — it pulls signals from SLA Radar, Sentiment Tracker, Patch Anomalies, Cognitive Load, AR aging, and forecasts into one screen.

## The 9 tabs

1. **Right now** — SLA hot tickets + sentiment escalations + patch anomalies + overloaded techs.
2. **Automation** — toggle the zero-touch chain reactions scheduler on/off. Set interval (5m/15m/30m/60m). Recent ticks shown as a table.
3. **Revenue at Risk** — total $ at risk = aged AR + cold estimates + churn-weighted client value.
4. **Unbilled Dollars** — total time logged but not invoiced, broken down by client.
5. **Pricing Compliance** — under-priced and below-margin estimates.
6. **Monday Prep** — week-start brief auto-generated from the prior week's data.
7. **Leaderboard** — team rank by total XP + drills + runbooks.
8. **Streaks** — Duolingo-style 🔥 streak counters per tech.
9. **Capacity 90d** — predicts how many techs and devices you'll need over the next 90 days.

## When to use it
- **First thing each morning** — open Right Now to see overnight events.
- **Friday afternoon** — open Leaderboard + Monday Prep to plan the next week.
- **End of month** — open Revenue at Risk + Unbilled Dollars before billing runs.
""",
    },
    {
        "slug": "insights-hub",
        "title": "Insights Hub",
        "category": "Reports & Comms",
        "icon": "✨",
        "order": 3,
        "summary": "9-tab cross-tenant intelligence dashboard.",
        "body_md": """## What it is
Cross-cutting analytics surfaces built from your live data.

## The 9 tabs
- **Tech Load** — burnout score per tech (0-100). Score ≥85 auto-pauses new assignments.
- **Patch Anomalies** — KB# patches affecting 3+ clients. Click "Broadcast" to alert Slack/Teams.
- **Device Trajectory** — 4 buckets: replace 0-30d / 30-90d / 90-365d / healthy.
- **Battery Wall** — top 20 laptops with degraded batteries.
- **Aged AR** — invoices bucketed by days outstanding.
- **Skills XP** — per-tech XP per skill category.
- **Insurance Vault** — cyber insurance score + control coverage. **Download PDF** generates an evidence pack.
- **Voice Brief** — radio-style overnight brief (regeneratable).
- **Runbooks** — search the published runbook marketplace.

## Pro tip
The Insurance Vault PDF is what your client's insurer will accept as evidence. Generate it once a month, keep on file.
""",
    },
    {
        "slug": "chat-presence",
        "title": "Chat & Presence",
        "category": "Collaboration",
        "icon": "💬",
        "order": 4,
        "summary": "Internal staff chat with live LED status.",
        "body_md": """## Opening chat
- Click the violet 💬 button (bottom-right) **or** press **Cmd/Ctrl+K** anywhere.

## LED colour meanings
| LED | Meaning |
|---|---|
| 🟢 Pulse | Active — heartbeat in last 30s |
| 🔴 | On a ticket / remote session / war room (auto-detected from URL) |
| 🟠 | Do not disturb (manual) |
| 🔵 Pulse | On break (manual) |
| 🟡 Pulse | Away (no activity 5+ min) |
| ⚫ | Offline |

## Slash commands
Type `/` in any channel to access:
- `/help` — list all commands
- `/assign @user TKT-###` — reassign a ticket
- `/page <severity>` — page the team
- `/summarize` — Claude summarises the last 40 messages

## Auto-spawned channels
- `warroom-{slug}` — auto-created when a war room opens. Anyone paged is invited.
- DMs created on-demand from the user directory.

## Mentions
Type `@email-prefix` or `@firstname` to mention someone — they get a notification.
""",
    },
    {
        "slug": "tech-profile",
        "title": "Your Tech Profile",
        "category": "Team",
        "icon": "🏆",
        "order": 5,
        "summary": "Level up. Earn achievements. Track your skills.",
        "body_md": """## What it is
Each tech has a profile at `/me` (or `/team/{your-id}`). It's your gamified career page inside NexusOps.

## What's tracked
- **Level** — calculated from total XP. Every 500 XP = 1 level.
- **Skills radar** — which categories you've earned XP in. Closed tickets award XP based on priority.
- **Achievements** — 15 badges across Common / Rare / Epic / Legendary rarity. Examples:
  - 🩸 First Blood — close your first ticket
  - 💯 Century — close 100 tickets
  - 🚒 Five-Alarm Hero — close 5 critical tickets
  - 🦉 Night Owl — resolve a ticket between 10 PM and 6 AM
- **Daily Quests** — 3 random micro-quests refreshed daily, each worth XP.
- **Brain Bucket** — a private scratchpad only YOU can see. Drop fix snippets, command lines, ideas. AI can later mine this for runbook material if you choose to publish.

## How XP is earned
| Action | XP |
|---|---|
| Close a normal-priority ticket | +10 |
| Close a high-priority ticket | +20 |
| Close a critical ticket | +35 |
| Lead a backup drill | +50 |
| Publish a runbook | +30 |
""",
    },
]


@router.get("/help/articles")
async def list_help_articles(q: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    # Auto-seed if empty
    count = await db.help_articles.count_documents({})
    if count == 0:
        for a in DEFAULT_ARTICLES:
            await db.help_articles.insert_one({
                **a,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
            })
    qry = {}
    if q:
        qry["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"body_md": {"$regex": q, "$options": "i"}},
            {"summary": {"$regex": q, "$options": "i"}},
            {"category": {"$regex": q, "$options": "i"}},
        ]
    rows = await db.help_articles.find(qry, {"_id": 0, "body_md": 0}).sort([("order", 1), ("title", 1)]).to_list(500)
    cats = {}
    for r in rows:
        c = r.get("category") or "Uncategorised"
        cats.setdefault(c, []).append(r)
    return {"articles": rows, "by_category": cats, "count": len(rows)}


@router.get("/help/articles/{slug}")
async def get_help_article(slug: str, current_user: dict = Depends(get_current_user)):
    doc = await db.help_articles.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Article not found")
    return doc


@router.post("/help/articles")
async def upsert_help_article(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(400, "title required")
    slug = payload.get("slug") or _slugify(title)
    doc = {
        "slug": slug,
        "title": title,
        "category": payload.get("category") or "Uncategorised",
        "icon": payload.get("icon") or "📘",
        "order": int(payload.get("order") or 99),
        "summary": payload.get("summary") or "",
        "body_md": payload.get("body_md") or "",
        "screenshots": payload.get("screenshots") or [],  # list of {url, caption}
        "updated_at": _now_iso(),
        "updated_by": current_user.get("name"),
    }
    existing = await db.help_articles.find_one({"slug": slug}, {"_id": 0})
    if existing:
        await db.help_articles.update_one({"slug": slug}, {"$set": doc})
    else:
        doc["created_at"] = _now_iso()
        await db.help_articles.insert_one(dict(doc))
    return doc


@router.delete("/help/articles/{slug}")
async def delete_help_article(slug: str, current_user: dict = Depends(get_current_user)):
    res = await db.help_articles.delete_one({"slug": slug})
    if res.deleted_count == 0:
        raise HTTPException(404, "Article not found")
    return {"deleted": True}


@router.post("/help/seed")
async def reseed(current_user: dict = Depends(get_current_user)):
    await db.help_articles.delete_many({"slug": {"$in": [a["slug"] for a in DEFAULT_ARTICLES]}})
    for a in DEFAULT_ARTICLES:
        await db.help_articles.insert_one({
            **a,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        })
    return {"seeded": len(DEFAULT_ARTICLES)}
