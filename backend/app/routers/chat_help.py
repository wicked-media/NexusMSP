"""Chat broadcast hook + Help center.

Chat broadcast:
  POST /api/chat/broadcast/sentiment-escalating  â€” fires when any ticket flips to escalating
  POST /api/chat/broadcast/sla-page              â€” fires when SLA auto-page creates a new page

Help center:
  GET  /api/help/articles                        â€” list (with search)
  GET  /api/help/articles/{slug}                 â€” full article
  POST /api/help/articles                        â€” create/update article (admin)
  DELETE /api/help/articles/{slug}               â€” remove
  POST /api/help/seed                            â€” seed default articles
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


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• CHAT BROADCAST HOOKS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
            f"Reaction: ðŸ‘€ = I'm on it Â· âœ‹ = needs reassignment"
        )
        msg = await _post_to_general("âš ï¸ Sentiment escalation", body, ref_type="sentiment_escalation", ref_id=tid)
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
            f"Client: {t.get('client_name','?')} Â· Assignee: {t.get('assignee_name','unassigned')}\n"
            f"Title: {t.get('title','')[:100]}\n"
            f"React ðŸ‘€ to claim it."
        )
        msg = await _post_to_general("ðŸš¨ SLA Auto-Page", body, ref_type="sla_page", ref_id=r.get("id"))
        posted.append({"ticket_number": t.get("ticket_number"), "msg_id": msg["id"]})
    return {"posted": len(posted), "items": posted}


async def _check_storm_broadcast() -> Optional[dict]:
    """Helper: post one storm warning per day when weather mode flips to stormy.
    Idempotent via ref_id = YYYY-MM-DD."""
    from app.routers.quirky_features import weather_mode  # reuse existing computation
    try:
        wm = await weather_mode(current_user={"id": "system"})
    except Exception:
        return None
    if (wm or {}).get("mood") != "stormy":
        return None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    already = await db.chat_messages.find_one({"ref_type": "storm_mood", "ref_id": today}, {"_id": 0})
    if already:
        return None
    stats = wm.get("stats") or {}
    body = (
        f"@channel  Mood just flipped to STORMY.\n"
        f"Open critical: {stats.get('open_critical', 0)} Â· Open total: {stats.get('open_total', 0)} Â· Huntress: {stats.get('huntress_open', 0)}\n"
        f"Triage mode â€” keep the cockpit busy."
    )
    return await _post_to_general("â›ˆï¸ Stormy mood", body, ref_type="storm_mood", ref_id=today)


@router.post("/chat/broadcast/storm-check")
async def broadcast_storm_check(current_user: dict = Depends(get_current_user)):
    """Manual trigger for the once-a-day stormy mood broadcast."""
    msg = await _check_storm_broadcast()
    return {"posted": 1 if msg else 0, "msg_id": (msg or {}).get("id")}


async def _check_all_clear_broadcast() -> Optional[dict]:
    """Helper: post a single 'storm passed' message when mood drops back to sunny/beach
    AFTER a storm broadcast was posted earlier the same day. Idempotent."""
    from app.routers.quirky_features import weather_mode
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Need a prior storm broadcast today
    storm = await db.chat_messages.find_one({"ref_type": "storm_mood", "ref_id": today}, {"_id": 0})
    if not storm:
        return None
    # Skip if already posted all-clear today
    already = await db.chat_messages.find_one({"ref_type": "storm_clear", "ref_id": today}, {"_id": 0})
    if already:
        return None

    try:
        wm = await weather_mode(current_user={"id": "system"})
    except Exception:
        return None
    if (wm or {}).get("mood") not in {"sunny", "beach"}:
        return None

    stats = wm.get("stats") or {}
    body = (
        f"@channel  Storm passed â€” mood is back to {wm.get('mood').upper()}.\n"
        f"Open critical: {stats.get('open_critical', 0)} Â· Open total: {stats.get('open_total', 0)} Â· Huntress: {stats.get('huntress_open', 0)}\n"
        f"Nice work team. Take a breath."
    )
    return await _post_to_general("â˜€ï¸ All clear", body, ref_type="storm_clear", ref_id=today)


@router.post("/chat/broadcast/all-clear-check")
async def broadcast_all_clear(current_user: dict = Depends(get_current_user)):
    """Manual trigger for the once-a-day storm-passed broadcast."""
    msg = await _check_all_clear_broadcast()
    return {"posted": 1 if msg else 0, "msg_id": (msg or {}).get("id")}


# Wire all broadcasts into the existing scheduler tick
@router.post("/chat/broadcast/tick")
async def broadcast_tick(current_user: dict = Depends(get_current_user)):
    a = await broadcast_sentiment_escalating(current_user=current_user)
    b = await broadcast_sla_page(current_user=current_user)
    c = await _check_storm_broadcast()
    d = await _check_all_clear_broadcast()
    return {
        "sentiment_posted": a["posted"], "sla_posted": b["posted"],
        "storm_posted": 1 if c else 0, "all_clear_posted": 1 if d else 0,
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• HELP CENTER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

DEFAULT_ARTICLES = [
    {
        "slug": "getting-started",
        "title": "Getting Started with NexusOps",
        "category": "Basics",
        "icon": "ðŸš€",
        "order": 0,
        "summary": "Your first 10 minutes inside the platform.",
        "body_md": """## Welcome
NexusOps is your MSP command-and-control hub. Here's what to do in your first session:

1. **Sign in** at the login screen with the credentials your admin provided.
2. **Set your status** â€” click the LED dot beside your name in the chat panel (bottom-right). Active ðŸŸ¢ / DND ðŸŸ  / Break ðŸ”µ.
3. **Open the Command Center** from the sidebar â€” Reports & Comms â†’ Command Center. This is your "what's on fire right now" screen.
4. **Open the Tickets page** to see queued work assigned to you.
5. **Press Cmd/Ctrl+K** anywhere to toggle the chat panel.

## Where to find things
- **Sidebar** is grouped: Service Desk Â· Infrastructure Â· Business Â· Reports & Comms.
- The search box at the top of the sidebar (Ctrl+K) jumps you anywhere fast.
""",
    },
    {
        "slug": "tickets-module",
        "title": "Tickets Module",
        "category": "Service Desk",
        "icon": "ðŸŽ«",
        "order": 1,
        "summary": "Everything you can do on a ticket.",
        "body_md": """## Overview
The Tickets module is the heart of NexusOps. Every customer interaction lives here.

## Ticket detail toolbar â€” every button explained
When you open a ticket, the header has these AI buttons (top right):

- **ðŸ”¥ Why on fire** â€” Claude explains *why this ticket is still open* (waiting on client / SLA pressure / blocked by parts).
- **ðŸ’¬ Sentiment Badge** â€” gauges client sentiment trend across the conversation. Green = improving, red = escalating.
- **ðŸ‘¥ DoppelgÃ¤nger** â€” finds the 3 most similar resolved tickets across ALL clients + their resolution notes.
- **ðŸª„ Suggest Resolution** â€” copies the resolution from the closest matching past ticket. One-click time saver.
- **âœ“ Smart Assign** â€” picks the best tech based on Skills XP Ã— Cognitive Load Ã— on-shift status.
- **âœ‰ï¸ Apology AI** â€” drafts a warm apology email + make-good offer when sentiment is red or SLA breached.
- **ðŸ“– To Runbook** â€” (resolved tickets only) promotes the resolution into a published runbook for the team.

## Tabs
- **Conversation**, **Worksheet**, **Suggestions** (AI-suggested blueprints), **Files**, **Items** (products/parts), **Children** (sub-tickets), **Time**, **Audit**, and **Time Machine** â€” a chronological replay of every event on the ticket.

## Pro tips
- Type `/assign @bob TKT-001` in chat to reassign without leaving chat.
- Drag-and-drop files directly onto the ticket detail to attach.
""",
    },
    {
        "slug": "command-center",
        "title": "Command Center",
        "category": "Reports & Comms",
        "icon": "ðŸŽ¯",
        "order": 2,
        "summary": "The single screen you leave open all day.",
        "body_md": """## What it is
The Command Center is a compounding intelligence dashboard â€” it pulls signals from SLA Radar, Sentiment Tracker, Patch Anomalies, Cognitive Load, AR aging, and forecasts into one screen.

## The 9 tabs

1. **Right now** â€” SLA hot tickets + sentiment escalations + patch anomalies + overloaded techs.
2. **Automation** â€” toggle the zero-touch chain reactions scheduler on/off. Set interval (5m/15m/30m/60m). Recent ticks shown as a table.
3. **Revenue at Risk** â€” total $ at risk = aged AR + cold estimates + churn-weighted client value.
4. **Unbilled Dollars** â€” total time logged but not invoiced, broken down by client.
5. **Pricing Compliance** â€” under-priced and below-margin estimates.
6. **Monday Prep** â€” week-start brief auto-generated from the prior week's data.
7. **Leaderboard** â€” team rank by total XP + drills + runbooks.
8. **Streaks** â€” Duolingo-style ðŸ”¥ streak counters per tech.
9. **Capacity 90d** â€” predicts how many techs and devices you'll need over the next 90 days.

## When to use it
- **First thing each morning** â€” open Right Now to see overnight events.
- **Friday afternoon** â€” open Leaderboard + Monday Prep to plan the next week.
- **End of month** â€” open Revenue at Risk + Unbilled Dollars before billing runs.
""",
    },
    {
        "slug": "insights-hub",
        "title": "Insights Hub",
        "category": "Reports & Comms",
        "icon": "âœ¨",
        "order": 3,
        "summary": "9-tab cross-tenant intelligence dashboard.",
        "body_md": """## What it is
Cross-cutting analytics surfaces built from your live data.

## The 9 tabs
- **Tech Load** â€” burnout score per tech (0-100). Score â‰¥85 auto-pauses new assignments.
- **Patch Anomalies** â€” KB# patches affecting 3+ clients. Click "Broadcast" to alert Slack/Teams.
- **Device Trajectory** â€” 4 buckets: replace 0-30d / 30-90d / 90-365d / healthy.
- **Battery Wall** â€” top 20 laptops with degraded batteries.
- **Aged AR** â€” invoices bucketed by days outstanding.
- **Skills XP** â€” per-tech XP per skill category.
- **Insurance Vault** â€” cyber insurance score + control coverage. **Download PDF** generates an evidence pack.
- **Voice Brief** â€” radio-style overnight brief (regeneratable).
- **Runbooks** â€” search the published runbook marketplace.

## Pro tip
The Insurance Vault PDF is what your client's insurer will accept as evidence. Generate it once a month, keep on file.
""",
    },
    {
        "slug": "chat-presence",
        "title": "Chat & Presence",
        "category": "Collaboration",
        "icon": "ðŸ’¬",
        "order": 4,
        "summary": "Internal staff chat with live LED status.",
        "body_md": """## Opening chat
- Click the violet ðŸ’¬ button (bottom-right) **or** press **Cmd/Ctrl+K** anywhere.

## LED colour meanings
| LED | Meaning |
|---|---|
| ðŸŸ¢ Pulse | Active â€” heartbeat in last 30s |
| ðŸ”´ | On a ticket / remote session / war room (auto-detected from URL) |
| ðŸŸ  | Do not disturb (manual) |
| ðŸ”µ Pulse | On break (manual) |
| ðŸŸ¡ Pulse | Away (no activity 5+ min) |
| âš« | Offline |

## Slash commands
Type `/` in any channel to access:
- `/help` â€” list all commands
- `/assign @user TKT-###` â€” reassign a ticket
- `/page <severity>` â€” page the team
- `/summarize` â€” Claude summarises the last 40 messages

## Auto-spawned channels
- `warroom-{slug}` â€” auto-created when a war room opens. Anyone paged is invited.
- DMs created on-demand from the user directory.

## Mentions
Type `@email-prefix` or `@firstname` to mention someone â€” they get a notification.
""",
    },
    {
        "slug": "tech-profile",
        "title": "Your Tech Profile",
        "category": "Team",
        "icon": "ðŸ†",
        "order": 5,
        "summary": "Level up. Earn achievements. Track your skills.",
        "body_md": """## What it is
Each tech has a profile at `/me` (or `/team/{your-id}`). It's your gamified career page inside NexusOps.

## What's tracked
- **Level** â€” calculated from total XP. Every 500 XP = 1 level.
- **Skills radar** â€” which categories you've earned XP in. Closed tickets award XP based on priority.
- **Achievements** â€” 15 badges across Common / Rare / Epic / Legendary rarity. Examples:
  - ðŸ©¸ First Blood â€” close your first ticket
  - ðŸ’¯ Century â€” close 100 tickets
  - ðŸš’ Five-Alarm Hero â€” close 5 critical tickets
  - ðŸ¦‰ Night Owl â€” resolve a ticket between 10 PM and 6 AM
- **Daily Quests** â€” 3 random micro-quests refreshed daily, each worth XP.
- **Brain Bucket** â€” a private scratchpad only YOU can see. Drop fix snippets, command lines, ideas. AI can later mine this for runbook material if you choose to publish.

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


EXTENDED_ARTICLES = [
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MASS P2 MODULE AUDITS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        "slug": "qbr-page-audit",
        "title": "QBR Generator â€” Audit",
        "category": "Reports & Comms",
        "icon": "ðŸ“Š",
        "order": 71,
        "summary": "Quarterly Business Reviews: how to draft, edit and ship.",
        "body_md": """## Page: `/qbr`
3-column layout: Client picker (left) Â· Draft (center) Â· Actions (right).

## Workflow
1. Pick a client + quarter range.
2. Click **Generate Draft** â€” Claude pulls tickets, devices, backups, alerts, spend, pattern hits â†’ drafts 7 sections.
3. Edit the inline rich-text editor for each section.
4. **Save Draft** persists to `db.qbrs`. **Download PDF** prints branded fpdf with cover page + KPI strip + all sections.

## The 7 sections
Executive Summary Â· Key Wins Â· Incident Breakdown Â· Infrastructure Health Â· Risks & Recommendations Â· MSP Intelligence Â· Next Quarter Focus.

## MSP Intelligence section
Each pattern hit links to `/blueprints?pattern=...&t=...`. Click â†’ opens Blueprint Library filtered to that pattern. This is your cross-tenant insight engine â€” competitors don't have this.

## Tinker
- Section list/order: `qbr.py` â†’ `QBR_SECTIONS`.
- AI prompt: `qbr.py` â†’ `_generate_qbr_section()` system prompt.
- PDF layout: `qbr.py` â†’ `qbr_pdf_export()`.
""",
    },
    {
        "slug": "scheduling-audit",
        "title": "Scheduling â€” Calendar / Smart / Roster Audit",
        "category": "Service Desk",
        "icon": "ðŸ“…",
        "order": 96,
        "summary": "Three scheduling pages and how they relate.",
        "body_md": """## Three pages

### `/scheduling` â€” Calendar
Drag-and-drop bookings. Each booking links to a ticket. Status colours: scheduled (sky) / in_progress (amber) / completed (emerald) / cancelled (zinc).

### `/smart-scheduling` â€” AI Routing
Claude reads tech skills + location + calendar + current load â†’ recommends best assignment. **"Auto-assign"** button writes the assignment + emails the tech.

### `/tech-roster` â€” On-Call & Skills
Tier 1/2/3 columns + skills matrix table.
- Each tech has: escalation_tier Â· preferred_channels (sms/slack/teams/email/in_app) Â· on_call Â· active.
- Drives War Room paging â€” Tier-1 fires immediately, Tier-2/3 wait for grace expiry.

## Tinker
- Tech tier definitions: `tech_roster.py` â†’ `TIER_DEFINITIONS`.
- Smart-Scheduling weighting: `smart_scheduling.py` â†’ `_score_assignment()`.
- Calendar conflict detection: `scheduling.py` â†’ `_check_conflicts()`.
""",
    },
    {
        "slug": "reports-hub-audit",
        "title": "Reports Hub â€” Audit",
        "category": "Reports & Comms",
        "icon": "ðŸ“ˆ",
        "order": 91,
        "summary": "/reports-hub â€” every report card explained.",
        "body_md": """## Page: `/reports-hub`
Card grid. Each card is one report. Click â†’ run with chosen date range â†’ preview â†’ download PDF/CSV/XLSX.

## The reports
- **MSP Performance** â€” tickets created/resolved/SLA % by tech.
- **Client Profitability** â€” revenue âˆ’ product costs âˆ’ labor. Per client + roll-up.
- **Backup Health** â€” Acronis success rate, drill compliance.
- **Patch Compliance** â€” % of devices fully patched per client.
- **Security Posture** â€” CIPP hygiene + Huntress alerts trend.
- **Time Utilisation** â€” billable vs non-billable per tech.
- **Recurring Revenue** â€” MRR / ARR + churn.
- **Custom Report Builder** â€” drag-and-drop schema + filters.

## Tinker
- Add a report: `reports.py` â†’ register in `REPORT_REGISTRY` + `_run_report()`.
- Custom Report Builder: `reports_custom.py` â†’ field schema + filter ops.
""",
    },
    {
        "slug": "insights-hub-audit",
        "title": "Insights Hub â€” Audit",
        "category": "Reports & Comms",
        "icon": "ðŸ§ ",
        "order": 92,
        "summary": "/insights â€” 21-feature mega bundle of AI signals.",
        "body_md": """## Page: `/insights`
Tabbed dashboard with proactive intelligence cards.

## What's here
- Blueprint Pattern Discovery
- Cross-Tenant Pattern Hits
- Sentiment Drift Radar
- Churn Risk Radar
- Revenue Protection Pulse
- Client DNA Snapshots
- Insurance Vault
- LTV Forecasts
- Anniversary AI Queue
- Patch Anomalies
- SLA Auto-Page Queue
- Apology Queue
- Payment Promise Watch
- Estimate Win-Rate

## Tinker
All 21 endpoints live in `mega_features.py` â€” every card maps 1:1 to one endpoint.
""",
    },
    {
        "slug": "hudu-audit",
        "title": "Hudu â€” Audit",
        "category": "Knowledge",
        "icon": "ðŸ“š",
        "order": 41,
        "summary": "/hudu â€” Cross-search articles, assets, passwords.",
        "body_md": """## Page: `/hudu`
6 tabs: Companies Â· Articles Â· Assets Â· Procedures Â· Websites Â· Passwords. Each tab has its own filter bar (company / search).

## Article + Procedure viewer
HTML rendered inside a viewer dialog. Copy / open-in-Hudu.

## Passwords tab
Redacted by default. **Reveal** decrypts on-demand â†’ audit-logged in `db.hudu_password_reveals`.

## AI Suggestions panel on tickets
Auto-runs on ticket open. Derives 3-6 keywords from title+description (stopword-filtered), queries Hudu, ranks via Claude with concrete fix steps.

## Tinker
- Sync interval: `hudu.py` â†’ `_sync_articles()`.
- Suggestion ranking: `hudu_suggestions.py` â†’ `_rank_results()`.
- Reveal audit retention: edit DB-side TTL.
""",
    },
    {
        "slug": "soc-audit",
        "title": "SOC Dashboard â€” Audit",
        "category": "Security",
        "icon": "ðŸ›¡ï¸",
        "order": 31,
        "summary": "/soc â€” Huntress-led IR with audit trail.",
        "body_md": """## Page: `/soc`
6-tile metric strip (Agents Â· Offline Â· Critical Â· Open Â· Signals Â· Orgs) + Response Timeline + 3 incident lists.

## Per-incident actions (... menu)
- **Acknowledge / Add comment / Assign / Close**
- **Isolate agent / Release agent**
Each writes to `db.huntress_actions` (audit log shown in Response Timeline).

## Identity Threats page
`/identity-threats` â€” merges SOC identity-threats with Huntress incidents (impossible_travel / brute_force / mfa_fatigue / token_theft / password_spray / privilege_escalation). Huntress rows wear an orange `HNT` badge.

## Endpoint Security
`/endpoint-security` â€” merges live Huntress agents with demo endpoints.

## Tinker
- Action audit shape: `huntress.py` â†’ `_record_action()`.
- Incident severity merge: `soc.py` â†’ `_normalise_severity()`.
""",
    },
    {
        "slug": "unifi-audit",
        "title": "UniFi â€” Audit",
        "category": "Infrastructure",
        "icon": "ðŸ“¡",
        "order": 51,
        "summary": "/unifi â€” Hosted UniFi (api.ui.com) site management.",
        "body_md": """## Page: `/unifi`
5-metric strip (Sites Â· Devices online/total Â· Clients Â· Alerts Â· Linked %). 2 tabs: Sites Â· Linked Clients.

## Per-site detail
Master-detail. Sub-tabs: Devices Â· Clients Â· SSIDs Â· Alerts.
- Device table â€” model, status, IP, uptime, firmware.
- Client table â€” wired/wifi badges, signal, RX/TX.
- SSID table.
- Alerts feed.

## Linking
"Link to client" dialog on every site.

## Tinker
- API endpoint base: Settings â†’ Integrations â†’ UniFi (default `https://api.ui.com/ea`).
- Refresh interval: `unifi.py` â†’ `_sync_sites()`.
""",
    },
    {
        "slug": "cipp-audit",
        "title": "CIPP â€” Audit",
        "category": "Security",
        "icon": "â˜ï¸",
        "order": 46,
        "summary": "/cipp â€” M365 management with hygiene scoring.",
        "body_md": """## Page: `/cipp`
3 tabs: Tenants Â· Linked Clients Â· Audit. Per-tenant detail shows users + SKU chips.

## Per-user actions
Create user Â· Manage licenses Â· Reset password Â· Block / Unblock sign-in Â· Offboard. Audited to `db.cipp_actions`.

## Hygiene Digest (7 dimensions)
| Dimension | Weight |
|---|---|
| License efficiency | 20 |
| MFA coverage | 25 |
| Stale users | 15 |
| License waste | 15 |
| Admin sprawl | 10 |
| Guest posture | 10 |
| Modern auth CA | 5 |

"Send Digest" emails an HTML hygiene report through the selected Microsoft 365 mailbox.

## Client Health integration
M365 hygiene contributes 10% to linked client's Health Score.

## Tinker
- Dimension weights: `cipp.py` â†’ `HYGIENE_DIMENSIONS`.
- Email template: `cipp_hygiene_email.html`.
""",
    },
    {
        "slug": "pax8-audit",
        "title": "Pax8 CSP â€” Audit",
        "category": "Business",
        "icon": "ðŸ›’",
        "order": 56,
        "summary": "/pax8 â€” Subscriptions + auto-billing flow.",
        "body_md": """## Page: `/pax8`
3 tabs: Companies Â· Subscriptions Â· Billing.

## Linking
"Link to client" on each Pax8 company. Once linked, recurring invoices with **Auto-attach Pax8** enabled pull live seat Ã— unit price each generation.

## Billing preview
`/api/pax8/billing/preview` returns per-client MRR. "Link to Recurring Invoice" enables auto-attach OR scaffolds a new recurring invoice.

## Subscription Drift detector
Flags clients paying for more seats than they use. See **Finance Intelligence** article.

## Tinker
- OAuth: Settings â†’ Integrations â†’ Pax8 (Client ID + Secret).
- Sync cron: `pax8.py` â†’ `_sync_subscriptions()`.
""",
    },

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• DEVICES UI AUDIT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        "slug": "devices-page-audit",
        "title": "Devices Page â€” Every Button & Filter Explained",
        "category": "Infrastructure",
        "icon": "ðŸ’»",
        "order": 21,
        "summary": "Complete audit of the /devices page: toolbar, filters, table, bulk bar, detail view.",
        "body_md": """## Top metric strip (6 tiles)
| Tile | Source |
|---|---|
| Total | `db.devices` count |
| Online | status="online" |
| Offline | status="offline" |
| Warning | status="warning" |
| Avg CPU | mean of `cpu_usage` |
| Need Patching | sum of `needs_patching` |

## TRMM Freshness Strip (NEW)
Top of page. Shows last sync timestamp, agent count, transition count, **Sync now** button + outage banner when active. See **TRMM Reliability** article.

## Toolbar buttons (right-aligned)
| Button | What it does |
|---|---|
| Refresh | Re-fetches `/api/devices` + `/api/devices/stats/summary` |
| Discover | Opens network discovery (subnet scan / DNS sweep / Active Directory) |
| Add Device | Manual device entry dialog |

## Bulk Actions Bar
Appears when 1+ devices are selected:
- **Reboot** â€” TRMM `agents/{id}/reboot/` per selected device
- **Scan** â€” Anti-malware scan
- **Deploy Agent** dropdown â€” Windows PowerShell or Linux/macOS Bash one-liners
- **Delete** â€” Removes from `db.devices`. Doesn't uninstall the agent.
- **Clear** â€” Reset selection

## Filters row
- Search box: name / IP / OS / serial fuzzy match (client-side filter)
- Status dropdown: All / Online / Offline / Warning
- Type dropdown: All / Servers / Workstations / Laptops / Network
- Client dropdown: All clients / specific client
- View toggle: Table view / Grid view

## Table columns
Checkbox Â· Icon (with status dot + remote-viewer ring) Â· Device Â· Client Â· OS Â· IP Â· CPU Â· RAM Â· Disk Â· Compliance Â· Last Seen Â· Actions menu.

The **remote-viewer ring** is a cyan pulse ring + Eye icon when a tech is currently remoted into this device. Hover for tech name(s).

## Row actions (... menu)
View Details Â· Connect (RDP/VNC/SSH picker) Â· Run Script Â· Restart Â· Run Patches Â· Delete.

## Detail view (`/devices/{id}`)
Tabs: Overview Â· Performance Â· Patches Â· Software Â· Sessions Â· Audit. See **Devices & RMM** article.

## Tinker
- Add a metric: `DevicesPage.jsx` line ~342, follow existing `<MetricTile />` pattern.
- Add a filter chip: line ~388, copy a `<Select>` block.
- Add a column: edit both `<TableHeader>` (line ~430) and the row map (line ~454).
- Add a bulk action: edit the bar block (~365) and create a handler matching `handleBulkReboot`.
""",
    },

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• INVOICES DETAIL AUDIT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        "slug": "invoice-detail-audit",
        "title": "Invoice Detail â€” Every Button Explained",
        "category": "Business",
        "icon": "ðŸ§¾",
        "order": 77,
        "summary": "Complete audit of the invoice detail right-sidebar, tabs and actions.",
        "body_md": """## Top of detail
- Invoice number + Status pill (draft / sent / paid / overdue / disputed / void)
- Edit button (top right) â€” opens edit dialog
- Print / Download PDF / Email shortcuts
- Total Â· Paid Â· Balance summary card

## Tabs
- **Items** â€” line items table with edit/delete per row, add new line
- **Activity** â€” chronological log: created Â· updated Â· payment_recorded Â· voided Â· emailed Â· SMS sent

## Actions sidebar (right column)
### Payment row (when not paid)
- **Pay with Stripe** (green) â€” opens Stripe Checkout-hosted page
- **Record Manual Payment** â€” internal record (cash/cheque/EFT/etc) with reference + notes

### Document actions
| Button | What it does |
|---|---|
| Preview PDF | Opens PDF in modal |
| Download PDF | Saves locally |
| **Dispute Shield** (amber) | Generates evidence-pack PDF with all tickets/time/products |
| **Pre-scan Risks (AI)** (rose) *(NEW)* | Claude + heuristic dispute scan BEFORE sending. Returns flags + per-line justifications. |

### Send actions
- Email Invoice â€” opens the Microsoft 365 mail dialog with template and PDF attachment
- SMS Reminder (when not paid) â€” MobileMessage text with template

### AI helpers
- **Smart Reminder Strategy** â€” recommends cadence based on client behaviour
- **Invoice Explainer** â€” plain-English client-safe summary (copy-paste-ready)
- **Pre-bill Audit** â€” checks for missing time entries, mispriced items

## Details card
Client Â· Due Date (red when overdue) Â· Created Â· Paid Date Â· Last Emailed To Â· Late Fees applied.

## Tinker
- Add a sidebar action: `InvoicesPage.jsx` around line 815. Follow the `<Button variant="outline" className="w-full text-...">` pattern.
- Action sidebar layout is in `InvoicesPage.jsx` â†’ search for `Actions card`.
- Stripe Checkout: backend `/api/invoices/{id}/create-checkout-session`. Live integration with the Stripe key in env.

## Connection to Finance Intelligence
- **Margin per invoice** â€” `GET /api/invoices/{id}/margin` returns revenue + cost + profit + margin% (cost_breakdown by products/labor/other). Roll-up: `GET /api/finance/margin-overview`.
- **Late-payment risk** â€” `GET /api/invoices/{id}/late-risk` returns 0-100 score + reasons.
""",
    },

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• BACKUP / ACRONIS DETAIL â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        "slug": "backup-page-audit",
        "title": "Backup Center â€” Every Tab Explained",
        "category": "Infrastructure",
        "icon": "ðŸ’¾",
        "order": 26,
        "summary": "Complete audit of the /backup page: tabs, drills, auto-billing.",
        "body_md": """## Top metric strip (6 tiles)
Tenants Â· Machines Â· Healthy Â· Failed Â· Warning Â· Alerts.

## Tabs
### Tenants
- 50+ Acronis customer rows.
- **Link to client** button on each â€” maps Acronis tenant_id â†’ NexusOps client_id (writes to `db.acronis_tenant_links`).
- Once linked, the tenant tile shows the linked client name + a deep-link to the Client detail.

### Backup Status
- 364 machines table.
- Columns: machine name Â· client Â· plan Â· last backup Â· next backup Â· health.
- Click a machine â†’ drill-in panel with recent activities, resource usage, restore button.

### Activities
- Live Acronis activity feed â€” backup runs, restores, cleanups, failures.
- Filter by status (success / warning / error).

### Alerts
- Acronis alert feed.
- Acknowledge / Dismiss / Convert to Ticket.

### Billing
- Per-client storage usage + per-workload-type cost preview.
- "Push to Recurring Invoice" â€” links Acronis usage to a recurring invoice for auto-billing each generation.

## Restore Drills (sidebar)
- Schedule a drill: pick machine, target date, lead tech.
- Status: scheduled â†’ in_progress â†’ completed â†’ archived.
- Completion awards lead tech +50 XP and increments client restore-readiness score.

## Configuration
Settings â†’ Integrations â†’ Acronis Cyber Cloud. Stores Client ID + Secret + Data Centre URL. Test Connection validates within 3s.

## Tinker
- Cost engine for per-workload pricing: `acronis.py` â†’ `compute_acronis_cost()`. Prices stored in `db.acronis_pricing`.
- Drill XP weight: `quirky_features.py` â†’ ACHIEVEMENTS list + drill resolver.
""",
    },

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• CLIENTS 360Â° â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        "slug": "clients-360",
        "title": "Clients 360Â° â€” Full Profile Tabs",
        "category": "Service Desk",
        "icon": "ðŸ¢",
        "order": 12,
        "summary": "Everything about a customer on one screen: subscriptions, security, billing, assets.",
        "body_md": """## What it is
The Client detail view is a **full 360Â° profile** of a customer. 12 tabs surface every service, subscription, invoice, device, security posture, and relationship signal in one place.

## The 12 tabs

### Overview
- **Next Best Action** â€” Claude-style recommendation (SMS reminder / QBR / upsell) based on current signals.
- **Quick Actions** â€” New Ticket Â· New Invoice Â· SMS Â· Email Â· Start Timer.
- **Health Score Breakdown** â€” 5-6 dimensions (Tickets/SLA/Devices/Payments/Contracts, +M365 when CIPP linked) with live progress bars.
- **Recent Activity** â€” unified feed of tickets / invoices / events.

### Tickets â†’ Assets â†’ Subscriptions *(new)* â†’ Security *(new)* â†’ Contacts â†’ Billing *(enhanced)*

### Subscriptions tab *(new)*
Combines **every** subscription this customer has:
- Pax8 CSP subscriptions (M365, Acronis-via-Pax8, etc.)
- Acronis direct backup usage
- NexusOps recurring invoices (managed services contracts)

Summary strip: active count Â· total seats Â· **monthly $** Â· **annual $**.
Table: source Â· product Â· qty Â· unit Â· monthly Â· cycle Â· status.

Use this tab to answer "what are they paying me every month for?" in 2 seconds.

### Security tab *(new)*
- MFA coverage % (CIPP) with colour-coded badge (â‰¥95 green, 80-94 amber, <80 rose)
- CIPP 7-dimension hygiene score (bar per dimension)
- Huntress agents count + open critical alerts
- Active users Â· stale users Â· weak passwords
- Deep-links to `/cipp` and `/huntress-dashboard`

### Billing tab *(enhanced, inline)*
- Open balance Â· Overdue 90+ Â· MRR Â· LTV
- **AR Aging** card â€” Current / 30 / 60 / 90+ with colour bars
- Payment Promises badge (kept/broken)
- Recent 10 invoices table (invoice# Â· total Â· paid Â· due Â· status)
- Link to full invoice list

### Assets tab *(enhanced, inline)*
- Total / Online / Offline counts
- **Device Families** â€” devices grouped by model with count, avg age, online/offline breakdown, 4-device preview per family
- Deep-link to full device list

### Blueprints â†’ AI Insights â†’ Integrations â†’ M365 / CIPP â†’ Activity
Unchanged â€” same as before.

## AI Insights tab (recap)
9 buttons: DNA Profile Â· LTV Forecast Â· Anniversary AI Â· Monthly Recap Â· Pre-call Brief Â· Insurance Plan Â· Dossier PDF Â· (plus churn reasons & sentiment) â€” see **Clients & Health Score** article.

## Tinker
- Add/remove tabs: `ClientsPage.jsx` â†’ search for `{ v: "overview", l: "Overview" }`.
- Adjust `_aggregate_subscriptions()` in `client_360.py` to pull from more SaaS sources (Dropbox, DocuSign, etc.) â€” just add another DB lookup + append to `subs[]`.
- Health score weights: `clients.py` â†’ `compute_health_score()`.

## API endpoints
- `GET /api/clients/{id}/full-profile` â€” kitchen-sink aggregator
- `GET /api/clients/{id}/subscriptions` â€” combined subs roll-up
- `GET /api/clients/{id}/security` â€” hygiene + Huntress combined
- `GET /api/clients/{id}/billing-detail` â€” AR aging + invoices
- `GET /api/clients/{id}/assets-detail` â€” device family grouping
""",
    },

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TICKET TOOLBAR & TABS AUDIT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        "slug": "tickets-toolbar-reference",
        "title": "Tickets â€” Every Button & Tab Explained",
        "category": "Service Desk",
        "icon": "ðŸŽ«",
        "order": 11,
        "summary": "Complete reference of every toolbar button and every detail tab on the Ticket page.",
        "body_md": """## Overview
Open a ticket from `/tickets` and you land on the detail view. This doc explains every single button + tab so nothing is a mystery.

## Top toolbar (left to right)

### Primary actions row
| Button | What it does |
|---|---|
| â† Back | Returns to the ticket list. Also calls `/stop-viewing` to release live presence. |
| ðŸ”´/ðŸŸ¢ status dot | Device online/offline indicator (if a device is linked). Colour-coded. |
| Remote Connect | Opens `/remote-access?device={id}` in new tab (RDP/VNC/SSH picker). |
| ðŸ§  AI Analysis | Claude analyses title + description + client history â†’ returns suggested category/priority/next steps. Results appear in the `ai-analysis-panel` card. |
| â–¶ / â¸ Timer | Start/stop the live work timer. Persists to `time_entries` on stop. |
| Log Time | Manual time entry dialog (duration + billable flag + rate). |
| Email | Opens email composer (RichTextEditor, signature-aware). |
| Add Items | Opens the Add Items dialog â€” search + pick products + quantities. |
| **Apply Kit** *(new)* | Opens Kit Picker â€” apply a pre-built bundle (e.g. "New Hire Setup") in one click. See **Product Kits** article. |
| To Invoice (N) | Push unbilled ticket products to a draft invoice. |
| PDF | Download a branded ticket-summary PDF. |
| Child | Create a sub-ticket linked to this one. |
| Merge | Merge this ticket into another (duplicates, etc). |

### AI row
| Widget | Purpose |
|---|---|
| SentimentBadge | Live sentiment pill (ðŸŸ¢ positive / ðŸŸ¡ neutral / ðŸ”´ frustrated). Click to log to history. |
| TicketAIBundle | Action menu: To Runbook Â· Proofread Â· Summarize Â· Auto-respond Â· Add-child suggestion Â· Pre-call Brief. |
| **Quote It** | Claude reads ticket + time + products â†’ drafts a quote, console-logs the result. |
| ðŸŸ¢ **Quote Nudge Banner** *(new)* | Auto-appears when scope is expanding (score â‰¥ 50). Click "Draft quote now" to auto-generate. |

### Progress Tracker
5-stage card showing Open â†’ In Progress â†’ On Hold â†’ Resolved â†’ Closed. Each stage shows a circle with the stage number; the filled part shows how far along you are. Clicking any stage jumps the status.

## The 10 tabs

### 1. Conversation
Unified feed â€” internal notes + outbound emails + inbound/outbound SMS. Compose new entry at the top (type selector switches between Note / Email / SMS forms).

### 2. Blueprint / Worksheet
When a blueprint is applied, this tab shows the typed fields + checklist. Completion gated if `require_completion=true`.

### 3. Suggestions
- **History suggestions**: past resolved tickets with similar keywords (scored).
- **Hudu articles**: cross-ref to Hudu knowledge with click-to-insert fix steps.

### 4. Worksheets (legacy free-form)
Ad-hoc checklist when no blueprint. Tick boxes, add items.

### 5. Files
Attachment upload + preview. Images shown inline, PDFs as link.

### 6. Items
Billable products attached to the ticket. Shows qty Ã— unit Ã— line total. Actions: **Apply Kit** (bulk add), **Add Item** (single), **To Invoice** (push unbilled lines).

### 7. Children
Nested sub-tickets. Each shows its own status.

### 8. Time
All time_entries for this ticket. Billable/non-billable toggle per row. Total at bottom.

### 9. Audit
Every state change, every note add, every email/sms send. Immutable log.

### 10. Time Machine (Timeline)
Linear ticket history â€” who did what, when, in one scrolling column. Great for postmortems.

## Right-sidebar cards (detail view)

### Status & Priority
Status picker Â· Priority picker Â· Assignee. Changes log to audit instantly.

### Device
If a device is linked, shows IP, OS, status. Click "View device" to deep-link. Quick AI + Quick Remote buttons mirror the top toolbar.

### Run Scripts
TRMM scripts (starred) â€” one-click run on the linked device. Results toast on completion. See **Devices & RMM** article.

### Sentiment (live)
Current sentiment score 1-5. Trend over the last 5 interactions.

## Pro tips
- Hit **T** from the detail view to open timer, **V** for Voice Journal, **A** to apply blueprint.
- If the **Quote Nudge** banner appears, it's because your ticket has 6+ comments, 120+ minutes logged, or project keywords. You're about to give away free work â€” send a quote.
- **Apply Kit** is the fastest way to add 5 products + labor in one click. Build kits at `/finance-intel` â†’ Kits.

## Tinker
- Add/remove tabs: `TicketsPage.jsx` â†’ find `<TabsList className="w-full grid grid-cols-10">`.
- Add/remove toolbar buttons: same file around line 1260-1290.
- Apply Kit logic: `components/tickets/KitPickerDialog.jsx` + backend `POST /api/tickets/{id}/apply-kit/{kit_id}`.
- Quote Nudge threshold: `products_invoices_plus.py` â†’ `quote_nudge()` â€” adjust the score weights.
""",
    },

    {
        "slug": "invoice-dispute-scan",
        "title": "Invoice â€” Pre-Emptive Dispute Scan",
        "category": "Business",
        "icon": "ðŸ›¡ï¸",
        "order": 76,
        "summary": "AI-scan an invoice BEFORE you send it so client disputes never happen.",
        "body_md": """## What it does
On the Invoice detail â†’ Actions sidebar â†’ **Pre-scan Risks (AI)** button (rose). Claude + heuristics read every line item and flag anything a client could push back on:
- Vague high-value lines ("Emergency support â€” $1,500" with no description)
- Quantity Ã— unit anomalies (10 Ã— $150)
- Emergency rate without after-hours justification

## How it works
1. Heuristic scan runs first â€” always free, always works.
2. If `OPENAI_API_KEY` is set, Claude scans too with context of the client's last 10 resolved tickets. Returns:
   - `flags[]` â€” heuristic concerns
   - `ai_risks[]` â€” per-line with severity + justification referencing actual ticket numbers
   - `ai_summary` â€” one-paragraph exec summary

## Output
The button shows a toast + opens an alert with the full report. Future roadmap: side-panel viewer.

## Tinker
`products_invoices_plus.py` â†’ `dispute_scan()`:
- Change the heuristic thresholds (1500 default, qty > 5, etc).
- Edit the Claude system prompt.

## Paired with DisputeShield PDF
DisputeShield PDF assembles evidence AFTER a dispute fires (proof pack). Dispute Scan prevents disputes BEFORE they fire. Use both.
""",
    },

    {
        "slug": "quote-nudge-banner",
        "title": "ðŸ’¡ Quote Nudge Banner",
        "category": "Easter Eggs",
        "icon": "ðŸ’¡",
        "order": 221,
        "summary": "Auto-appears on tickets that are silently becoming projects.",
        "body_md": """## Trigger
A green banner appears at the top of a ticket when its **quote-nudge score â‰¥ 50**. Signals:
- 6+ comments (scope expanding)
- 120+ minutes already logged
- 3+ project keywords in title/description (install / migrate / deploy / setup / onboard / upgrade / refresh / replace / procure / license / project)

## What it does
- Shows the score + the specific signals that triggered it.
- "Draft quote now" button calls `POST /api/tickets/{id}/auto-quote` to generate a Claude-drafted quote from the conversation.
- Dismiss (Ã—) hides for this session.

## Why it exists
Tickets that start as "quick fix" often drift into scoped projects. Techs rarely notice until they've given away 4 hours of free work. The nudge fires exactly at the inflection point.

## Tinker
`products_invoices_plus.py` â†’ `quote_nudge()`:
- Score weights (30/30/30 for comments/time/keywords).
- Keyword list.
- Threshold (`score >= 50`).

## Disable
Comment out `<QuoteNudgeBanner />` in `TicketsPage.jsx`.
""",
    },

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TRMM RELIABILITY (NEW) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    {
        "slug": "trmm-reliability",
        "title": "TRMM Reliability & Sync",
        "category": "Infrastructure",
        "icon": "ðŸ›°ï¸",
        "order": 19,
        "summary": "How live TRMM sync works, Demo Mode, outage detective, stale agents, bulk actions.",
        "body_md": """## What it does
The Reliability page at `/device-reliability` turns NexusOps into the source-of-truth for device state. A background job pulls live agent status from Tactical RMM every 3 minutes and pushes it into `db.devices` â€” so the main `/devices` page always reflects reality, not stale seed data.

## Demo Mode vs Live
| Mode | Trigger | What happens |
|---|---|---|
| **Live** | TRMM configured in Settings â†’ Integrations â†’ Tactical RMM (base_url + api_key present) | Real agents pulled, states written back |
| **Demo** | TRMM not configured | Synthetic TRMM-shaped data generated from your existing devices so every flow works end-to-end immediately |

The page shows a `DEMO` badge when demo mode is active. When you add real TRMM creds and save, the next tick automatically switches to Live â€” no restart needed.

## The 4 tabs
### Client health
Per-client roll-up. Each card shows online/offline/warning counts, an online-% bar, and a status badge: HEALTHY Â· WARNING Â· PARTIAL OUTAGE Â· FULL OUTAGE.

### Outages
Live active outages from the Outage Detective. Each row shows client, device count, detected-at, auto-created ticket link, and a Resolve button.

### Stale agents
Devices linked to TRMM that haven't reported in >3 days. Likely need agent reinstall. Shows device + client + last-seen + agent ID.

### Bulk actions
Pick N devices, pick an action (Reboot / Install patches / Run checks). Executes via TRMM (or simulates in demo mode). **Change Freeze** windows are honoured automatically â€” frozen clients are skipped with `change_freeze_active` reason.

## Sync Now button
Top-right button forces an immediate sync. Runs the same tick the scheduler runs. Returns counts of devices updated + any newly-detected outages.

## Freshness badge on /devices
Top of the main Devices page shows a live TRMM sync strip:
- Green "Updated 42s ago" â€” fresh
- Amber "Updated 8m ago" â€” stale-ish
- Rose "Updated 23m ago" â€” sync likely broken
- `DEMO MODE` badge when no TRMM creds

## Tinker
- **Sync frequency**: `server.py` chain-reactions loop tick interval (defaults to whatever `ops_chain_reactions` setting says â€” typically 3-15 min). Change in Settings â†’ Automation or edit `server.py` directly.
- **Stale threshold**: `/api/trmm-sync/stale-agents?days=3` â€” change the `days` query param.
- **Demo mode agent generation**: `tactical_rmm_sync.py` â†’ `_fetch_demo_agents()`. Adjust the 82/10/5/3% probability distribution for online/offline/warning/stale.
- **Outage Detective trigger**: 3+ devices offline within 5 min at the same client. In `tactical_rmm_sync.py` search for `len(offs) < 3: continue` to change the threshold.

## Where state lives
- `db.devices.status / last_seen / last_trmm_sync / trmm_agent_id` â€” live device state
- `db.device_state_log` â€” every state transition (for "offline for 2h 14m" style labels, audit, patterns)
- `db.outages` â€” active + resolved outages
- `db.settings.trmm_sync_state` â€” last sync metadata
""",
    },

    {
        "slug": "outage-detective",
        "title": "ðŸ”¥ Outage Detective",
        "category": "Easter Eggs",
        "icon": "ðŸ”¥",
        "order": 220,
        "summary": "Auto-detects client-wide outages from clustered device-offline events.",
        "body_md": """## What it does
When 3 or more devices at the *same client* transition to `offline` within 5 minutes, the Outage Detective:
1. Creates a row in `db.outages` (idempotent per client per day).
2. Auto-creates a **Priority: Critical** ticket with the offline device list + triage hints (ISP / WAN / UPS / UniFi gateway).
3. Surfaces a red banner on `/devices` and `/device-reliability`.

## Why it matters
A single device offline = user walked away. 10 devices at the same client going dark together = ISP event or UPS failure. This distinction saves tickets like "PC won't turn on" from flooding the queue.

## Where
- Banner on `/devices` (top of page).
- `/device-reliability` â†’ Outages tab.
- Ticket: `TKT-XXXXX` with `source=auto_outage`.

## Resolve
Click **Resolve** on the outage card. Marks `resolved=true`. Does NOT auto-resolve the ticket â€” that's still your job (so you can document the fix).

## Tinker
`tactical_rmm_sync.py` â†’ `run_trmm_sync()`:
- Change `len(offs) < 3: continue` to change min-device threshold.
- Change the `five_min_ago = now - timedelta(minutes=5)` window.
- Edit the auto-ticket body text.

## Disable entirely
Comment out the `# â”€â”€â”€â”€â”€ Outage Detective â”€â”€â”€â”€â”€` block in `run_trmm_sync()`.
""",
    },

    {
        "slug": "stale-agent-radar",
        "title": "ðŸ“¡ Stale Agent Radar",
        "category": "Infrastructure",
        "icon": "ðŸ“¡",
        "order": 46,
        "summary": "Find TRMM agents that stopped reporting â€” probably need reinstall.",
        "body_md": """## What it is
When a device is linked to a TRMM agent (`trmm_agent_id` present) but hasn't phoned home in >3 days, the agent is almost always broken â€” not the device. Normal offline = minutes or hours. Stale = days.

## Where
`/device-reliability` â†’ Stale agents tab.

## Tinker
- Default threshold: 3 days. Call `/api/trmm-sync/stale-agents?days=7` for a different window.
- Or edit the UI default in `DeviceReliabilityPage.jsx` â†’ `StaleAgents`.

## Next steps
For each stale agent:
1. Attempt bulk `run-checks` action (sometimes wakes them up).
2. If no response in another 24h â†’ queue an agent-reinstall runbook.
3. Consider automating: add a scheduled job that auto-closes the TRMM agent + creates a ticket "Reinstall TRMM on DEVICENAME".
""",
    },

    {
        "slug": "bulk-trmm-actions",
        "title": "âš¡ Bulk TRMM Actions",
        "category": "Infrastructure",
        "icon": "âš¡",
        "order": 47,
        "summary": "Reboot / patch / run-checks across selected devices in one go.",
        "body_md": """## Where
`/device-reliability` â†’ Bulk actions tab.

## How to use
1. Check the devices you want to action (only TRMM-linked devices appear).
2. Hit Reboot / Install patches / Run checks.
3. Confirm the prompt.
4. Results toast shows N succeeded, M failed. Any `change_freeze_active` skips are surfaced.

## Safety rails
- Only TRMM-linked devices show up (`trmm_agent_id` present).
- Change Freeze windows auto-skip frozen clients â€” see **Change Freeze Calendar** article.
- Every bulk action writes an audit row to `db.trmm_actions`.
- Demo mode simulates the calls (no actual TRMM hit) â€” marked `simulated:true` in results.

## Tinker
- Add new action types in `tactical_rmm_sync.py` â†’ `bulk_action()` endpoint + the `kind` map.
- Replace the confirm prompt with a scheduled-execution picker if you want future-dated bulk actions.
""",
    },
]


# Extended seed lives in a sibling file to keep this file lean
try:
    from app.routers._help_seed_extended import EXTENDED_ARTICLES as _EXT
    DEFAULT_ARTICLES = DEFAULT_ARTICLES + _EXT + EXTENDED_ARTICLES
except Exception:
    DEFAULT_ARTICLES = DEFAULT_ARTICLES + EXTENDED_ARTICLES


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

    # Apply each versioned product catalogue update once. This keeps shipped
    # guidance current without touching admin-authored articles.
    try:
        from app.routers._help_seed_modern import HELP_CATALOG_VERSION, STALE_SLUGS, MODERN_ARTICLES
        metadata = db.help_center_metadata
        catalog = await metadata.find_one({"key": "catalog_version"}, {"_id": 0, "value": 1})
        if catalog is None or catalog.get("value") != HELP_CATALOG_VERSION:
            if STALE_SLUGS:
                await db.help_articles.delete_many({"slug": {"$in": STALE_SLUGS}})
            for a in MODERN_ARTICLES:
                doc = {**a, "updated_at": _now_iso()}
                existing = await db.help_articles.find_one({"slug": a["slug"]}, {"_id": 0})
                if existing:
                    await db.help_articles.update_one({"slug": a["slug"]}, {"$set": doc})
                else:
                    doc["created_at"] = _now_iso()
                    await db.help_articles.insert_one(doc)
            await metadata.update_one(
                {"key": "catalog_version"},
                {"$set": {"value": HELP_CATALOG_VERSION, "updated_at": _now_iso()}},
                upsert=True,
            )
    except Exception:
        pass
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
        "icon": payload.get("icon") or "ðŸ“˜",
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
    """Reseed default + modern articles. Also prunes stale slugs from prior versions."""
    try:
        from app.routers._help_seed_modern import HELP_CATALOG_VERSION, STALE_SLUGS, MODERN_ARTICLES
    except Exception:
        HELP_CATALOG_VERSION, STALE_SLUGS, MODERN_ARTICLES = "", [], []

    stale = set(STALE_SLUGS or [])

    # 1) Overwrite the legacy default articles (idempotent) â€” but skip any that are now stale
    default_to_seed = [a for a in DEFAULT_ARTICLES if a["slug"] not in stale]
    await db.help_articles.delete_many({"slug": {"$in": [a["slug"] for a in DEFAULT_ARTICLES]}})
    for a in default_to_seed:
        await db.help_articles.insert_one({
            **a,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        })

    # 2) Prune any leftover stale slugs (e.g. custom-authored copies)
    pruned_count = 0
    if stale:
        res = await db.help_articles.delete_many({"slug": {"$in": list(stale)}})
        pruned_count = res.deleted_count or 0

    # 3) Upsert the modern (post-dedup) articles â€” overwrite any prior versions
    modern_seeded = 0
    for a in MODERN_ARTICLES:
        doc = {**a, "updated_at": _now_iso()}
        existing = await db.help_articles.find_one({"slug": a["slug"]}, {"_id": 0})
        if existing:
            await db.help_articles.update_one({"slug": a["slug"]}, {"$set": doc})
        else:
            doc["created_at"] = _now_iso()
            await db.help_articles.insert_one(doc)
        modern_seeded += 1

    if HELP_CATALOG_VERSION:
        await db.help_center_metadata.update_one(
            {"key": "catalog_version"},
            {"$set": {"value": HELP_CATALOG_VERSION, "updated_at": _now_iso()}},
            upsert=True,
        )

    return {
        "seeded": len(default_to_seed),
        "modern_seeded": modern_seeded,
        "pruned": pruned_count,
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• HELP CO-PILOT (AI ask anything) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/help/copilot")
async def help_copilot(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Ask anything â€” Claude answers using the article corpus as context."""
    import os
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question required")
    if len(question) > 500:
        raise HTTPException(400, "question too long")

    # Pull top candidate articles by keyword overlap
    rows = await db.help_articles.find({}, {"_id": 0, "slug": 1, "title": 1, "category": 1, "summary": 1, "body_md": 1}).to_list(500)
    qlower = question.lower()
    qwords = {w for w in re.findall(r"[a-z0-9]+", qlower) if len(w) > 3}

    def score(a):
        text = f"{a.get('title','')} {a.get('summary','')} {a.get('body_md','')}".lower()
        s = sum(1 for w in qwords if w in text)
        if any(w in (a.get("title","").lower()) for w in qwords): s += 5
        return s
    candidates = sorted([a for a in rows if score(a) > 0], key=score, reverse=True)[:6]

    if not candidates:
        return {
            "answer": "I couldn't find any articles matching that. Try rephrasing or browse the sidebar.",
            "citations": [],
            "fallback": True,
        }

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        # Fallback â€” return the candidates as a list with no AI synthesis
        return {
            "answer": f"Found {len(candidates)} relevant articles. Open one to read in full.",
            "citations": [{"slug": c["slug"], "title": c["title"], "category": c.get("category")} for c in candidates],
            "fallback": True,
        }

    try:
        from app.services.ai_provider import LlmChat, UserMessage
        corpus = "\n\n---\n\n".join([
            f"# {a['title']} (slug: {a['slug']})\nCategory: {a.get('category','-')}\n{a.get('body_md','')[:2000]}"
            for a in candidates
        ])
        chat = LlmChat(
            api_key=api_key,
            session_id=f"help-copilot-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You are the NexusOps Help Co-pilot. Answer the user's question using ONLY the provided article corpus. "
                "Cite each article you use with its slug in parentheses, e.g. (clients-module). "
                "If the corpus doesn't contain the answer, say so honestly. Keep answers under 250 words. "
                "Use markdown for formatting. Use bullet lists when listing steps."
            ),
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")
        msg = await chat.send_message(UserMessage(text=f"Question: {question}\n\nCorpus:\n{corpus}"))
        return {
            "answer": msg or "No response.",
            "citations": [{"slug": c["slug"], "title": c["title"], "category": c.get("category")} for c in candidates],
            "fallback": False,
        }
    except Exception as e:
        return {
            "answer": f"AI temporarily unavailable. Top relevant articles below.",
            "citations": [{"slug": c["slug"], "title": c["title"], "category": c.get("category")} for c in candidates],
            "fallback": True,
            "error": str(e)[:200],
        }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SCREENSHOT UPLOAD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/help/upload-screenshot")
async def upload_help_screenshot(
    payload: dict = Body(...),
    current_user: dict = Depends(get_current_user),
):
    """Accept a base64 data-URL image, save it under uploads/help/, return public URL.
    Body: {data_url: 'data:image/png;base64,...', caption?: str}
    """
    import base64, pathlib
    from app.database import UPLOADS_DIR
    data_url = payload.get("data_url") or ""
    if not data_url.startswith("data:image/"):
        raise HTTPException(400, "expected base64 image data URL")
    try:
        header, b64 = data_url.split(",", 1)
        ext = "png"
        if "image/jpeg" in header or "image/jpg" in header: ext = "jpg"
        elif "image/webp" in header: ext = "webp"
        elif "image/gif" in header: ext = "gif"
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(400, "could not decode image")

    if len(raw) > 5 * 1024 * 1024:  # 5 MB cap
        raise HTTPException(413, "image too large (max 5 MB)")

    folder = pathlib.Path(UPLOADS_DIR) / "help"
    folder.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}.{ext}"
    fpath = folder / fname
    fpath.write_bytes(raw)
    public_url = f"/api/uploads/help/{fname}"
    return {
        "url": public_url,
        "caption": payload.get("caption") or "",
        "size_bytes": len(raw),
    }
