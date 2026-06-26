"""Modern help center seed (Feb 2026).

This is the canonical seed for help articles after the great dedup audit.
The `STALE_SLUGS` list contains old article slugs that should be removed from
the DB during a reseed because they reference modules that have been merged
or removed.

The reseed endpoint in `chat_help.py` will:
  1. Delete every doc whose slug is in `STALE_SLUGS`.
  2. Upsert every doc in `MODERN_ARTICLES` (overwrites existing).
  3. Leave admin-authored custom articles alone.
"""

# Stale slugs that referenced merged / deleted modules. Safe to remove.
STALE_SLUGS = [
    # The "*-audit" articles were one-off audits, not user docs
    "qbr-page-audit",
    "scheduling-audit",
    "reports-hub-audit",
    "insights-hub-audit",
    "hudu-audit",
    "soc-audit",
    "unifi-audit",
    "cipp-audit",
    "pax8-audit",
    "devices-page-audit",
    "invoice-detail-audit",
    "backup-page-audit",
    # These referenced standalone pages that have been merged into hubs
    "tickets-toolbar-reference",  # superseded by tactical-ticket-console-v2
    "stale-agent-radar",          # rolled into device-smart-bar
    "outage-detective",           # rolled into auto-ops-hub
]


MODERN_ARTICLES = [
    # ── What's New (auto-updated mirror of /api/changelog) ──
    {
        "slug": "whats-new",
        "title": "What's New in NexusOps",
        "category": "Release Notes",
        "icon": "🆕",
        "order": -1,
        "summary": "Latest features, merges and fixes — newest first.",
        "body_md": """## Latest Releases

> Tip: the dashboard tile **What's New** shows the most recent 3 entries with a "new since you visited" counter. Click any entry to jump to the corresponding module.

### 2026-06-25 — Big Cleanup (modules merged & dedup'd)
- Deleted 27 orphan files (25 unused frontend pages, 2 empty backend stubs).
- 12 backend routers merged into 6 canonical ones — endpoint paths unchanged.
- Settings now has 16 tabs (was 8). Deep-links work via `?tab=<id>`.
- Four new conceptual hubs introduced:
  - **Client Insights** — `/client-insights` — Customer Health · RMM Health · Risk · Sentiment · Timeline.
  - **Auto-Ops Hub** — `/auto-ops` — Triage Queue · Smart Routing · Auto-Resolve · Self-Healing.
  - **Credentials Hub** — `/credentials` — Vault · Rotation · MFA.
  - **Team Hub** — `/team-hub` — Command Center · Technicians · Roster · Utilization · Skills · Leaderboard.

### 2026-06-24 — Tactical Ticket Console v2
- New `TicketConsoleHeader.jsx` is a single-row header that fits all status + SLA + owner + actions in 64px.
- **Change Customer** button reassigns a ticket to a different client in 2 clicks (POST `/api/tickets/{id}/change-customer`).
- The legacy header is still available — toggle it in the widget layout settings.

### 2026-06-23 — M365 Command Center (CIPP-killer)
- Multi-tenant lens for M365: tenants, users, standards, GDAP, security & alerts.
- 15 seeded standards, 8 Conditional Access templates, 5 scripted alerts.
- Currently using **mock data** — wire up MS Partner Center credentials in Settings → Integrations to switch live.

### 2026-06-22 — Autonomous Maintenance Windows
- Schedule cron-style fan-out maintenance: reboot, install patches, run scripts.
- Per-device success/failure with Claude-generated summary.
- Schedule one from the Devices page.

### 2026-06-21 — Syncro-killer Device Smart Bar
- Inline action strip on every device row (diagnose · restart agent · push script · live metrics).
- AI Diagnose for one-click "why is this device sad?" answer.

### 2026-06-20 — Invoice Studio + Smart Billing Engine
- Drag-and-drop invoice template builder.
- AI drafts invoices from ticket time + parts.
- Aged AR insights, renewal risk, smart recurring billing.
""",
    },

    # ── Getting Started (refreshed) ──
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
2. **Open the Dashboard** — your default landing page. The **What's New** tile (top-right) keeps you in the loop as features land.
3. **Press Cmd/Ctrl+K** anywhere to open the command palette and jump to any module.
4. **Open Tickets** to see queued work assigned to you.
5. **Set your status** — click the LED dot beside your name (bottom-right). 🟢 Active · 🟠 DND · 🔵 Break.

## Sidebar layout
- **Service Desk** — Dashboard · Workspace · Tickets · Dispatch · Change · Team · Scheduling · Live Support.
- **Infrastructure** — Devices · Network · Assets · Backup · Automation · Vault & Credentials.
- **Business** — Clients · Client Portal · CRM · Billing · Financial Analytics · Products · POs · Projects · Contracts.
- **Security** — SOC · Endpoint · Ransomware · Compliance.
- **AI & Intelligence** — Copilot · Auto-Ops · Knowledge & Docs.
- **Reports & Comms** — Command Center · Insights · Reports · Communications.
- **Platform** — Settings · System Health · Integrations.
""",
    },

    # ── Hubs ──
    {
        "slug": "client-insights-hub",
        "title": "Client Insights Hub",
        "category": "Business",
        "icon": "👥",
        "order": 10,
        "summary": "All client lenses in one tabbed view.",
        "body_md": """## Where
`/client-insights` (Sidebar → Business → Clients → Client Insights Hub)

## Tabs
- **Customer Health** — NPS, CSAT, churn signal.
- **RMM Health** — uptime, agent status, alert volume.
- **Risk** — composite churn-risk score per client.
- **Sentiment** — AI-derived sentiment from ticket threads.
- **Timeline** — chronological feed of every touchpoint.

Deep-link directly to a tab: `/client-insights?tab=customer-health`.
""",
    },
    {
        "slug": "auto-ops-hub",
        "title": "Auto-Ops Hub",
        "category": "AI & Intelligence",
        "icon": "🤖",
        "order": 11,
        "summary": "Triage, route, resolve and self-heal — all automation surfaces in one place.",
        "body_md": """## Where
`/auto-ops` (Sidebar → AI & Intelligence → AI Copilot → Auto-Ops Hub)

## Tabs
- **Triage Queue** — unassigned tickets ordered by AI-scored urgency.
- **Smart Routing** — rules that auto-assign tickets based on tech skills, load and availability.
- **Auto-Resolve** — tickets that Claude can close end-to-end (with audit trail).
- **Self-Healing** — devices that recovered on their own thanks to runbooks.

Deep-link: `/auto-ops?tab=ai-resolution`.
""",
    },
    {
        "slug": "credentials-hub",
        "title": "Credentials Hub",
        "category": "Security",
        "icon": "🔐",
        "order": 12,
        "summary": "Password vault, rotation and MFA — single pane.",
        "body_md": """## Where
`/credentials` (Sidebar → Infrastructure → Vault & Credentials → Credentials Hub)

## Tabs
- **Password Vault** — encrypted credentials per client and per device.
- **Rotation** — cadence + audit of password rotations.
- **MFA Management** — enrolment, factor reset and bypass approvals.

Deep-link: `/credentials?tab=mfa-management`.
""",
    },
    {
        "slug": "team-hub",
        "title": "Team Hub",
        "category": "Service Desk",
        "icon": "🧑‍💼",
        "order": 13,
        "summary": "Six team lenses, one tabbed surface.",
        "body_md": """## Where
`/team-hub` (Sidebar → Service Desk → Team → Team Hub)

## Tabs
- **Command Center** — live who-is-on-what.
- **Technicians** — roster and contact details.
- **Roster** — shift planning calendar.
- **Utilization** — billable vs non-billable per tech.
- **Skills Matrix** — competency grid.
- **Leaderboard** — gamified perf board.

Deep-link: `/team-hub?tab=utilization`.
""",
    },

    # ── Settings hub ──
    {
        "slug": "settings-hub",
        "title": "Settings (16-tab hub)",
        "category": "Platform",
        "icon": "⚙️",
        "order": 20,
        "summary": "Everything you used to chase across 10 pages is now one tabbed Settings page.",
        "body_md": """## Where
`/settings` (Sidebar → Platform → Settings)

## Tabs (in order)
| Tab | Purpose |
|---|---|
| Platform Branding | Logo, colours, favicon, invoice header/footer |
| General | Profile, job numbering, escalation thresholds, canned responses |
| Service Tiers | Bronze/Silver/Gold/Platinum/Diamond SLA tiers |
| Authentication | Microsoft SSO, JWT settings |
| Mailbox & Email | O365 inbox, email signatures |
| Integrations | Xero, Stripe, Resend, SMS, Acronis, Pax8, Huntress, SupED, CIPP, UniFi, TRMM, Splynx, Hudu, Syncro |
| AI & Automation | Provider, model, Emergent LLM key |
| Notifications | Email/SMS alert preferences |
| Ticket Defaults | Numbering, SLA, workflows |
| Ping & Escalation | Live alerts, sounds, notification rules |
| White Label | Brand the customer-facing portal |
| Channel / MSP Mode | Channel-partner vs direct-MSP mode toggles |
| API Tokens | Issue/revoke API tokens for scripts/integrations |
| 2FA / Security | 2FA enrolment and recovery |
| Notify Channels | Slack/Teams webhooks |
| My Workspace | Per-tech UI density, views, personal toggles |

Deep-link any tab: `/settings?tab=integrations` or `/settings?tab=tickets`.
""",
    },

    # ── Marquee features ──
    {
        "slug": "tactical-ticket-console-v2",
        "title": "Tactical Ticket Console v2",
        "category": "Service Desk",
        "icon": "🎫",
        "order": 30,
        "summary": "Cleaner ticket detail header, Change Customer flow, legacy toggle.",
        "body_md": """## What changed
The old ticket detail view stacked four header panels and felt cluttered. v2 collapses everything into a single-row `TicketConsoleHeader` with status, SLA pill, priority, owner, client and quick actions.

## Change Customer
Click the client name in the console header → search → confirm. The ticket reassigns instantly. Thread history, time entries and devices stay attached.

## Where the old header went
Power users can restore the old multi-panel header via the layout settings (`legacyHeader` toggle). Nothing was deleted — just tucked away.

## Endpoints
- `POST /api/tickets/{ticket_id}/change-customer` — body `{ "client_id": "..." }`.
""",
    },
    {
        "slug": "m365-command-center",
        "title": "M365 Command Center",
        "category": "Integrations",
        "icon": "🟦",
        "order": 31,
        "summary": "CIPP-style multi-tenant lens for Microsoft 365.",
        "body_md": """## Where
`/m365` (Sidebar → Platform → Integrations → M365 Center)

## Tabs
- **Tenants** — list/search, secure score, MFA %, deep links to Entra/Exchange/Intune/SharePoint/Defender.
- **Users** — search across tenants, license assignment, sign-in status.
- **Standards** — 15 baseline standards; toggle, schedule, run and auto-remediate.
- **GDAP** — relationship health, expiry alerts, +1y extend, 4 role templates.
- **Security** — MFA analytics by method, 30-day Secure Score trend, 8 Conditional Access templates, 5 scripted alerts.
- **Alerts** — impossible travel, new admin, mass delete, inbox forward external, guest admin.
- **Connection** — paste app_id / tenant_id / app_secret / refresh_token to go live.

## Currently
Mock data. The MOCK badge in the top-right will disappear once Connection credentials are saved.
""",
    },
    {
        "slug": "maintenance-windows",
        "title": "Maintenance Windows",
        "category": "Infrastructure",
        "icon": "🛠️",
        "order": 32,
        "summary": "Schedule fan-out maintenance: reboot, patch, scripts — across many devices.",
        "body_md": """## Schedule one
1. Open **Devices**.
2. Select target devices (multi-select).
3. Click **Schedule Maintenance Window**.
4. Pick the start time, cadence (one-off, weekly, monthly) and the action (reboot, run script, install patch).
5. Confirm.

The backend scheduler executes the actions at the scheduled time and writes a per-device audit trail. Each run gets a Claude-generated summary (e.g. "23/25 succeeded, 2 timed out — both are Windows 7 boxes scheduled for retirement").

## Endpoints
- `POST /api/maintenance/windows` — create.
- `GET /api/maintenance/windows` — list.
- `GET /api/maintenance/windows/{id}/runs` — execution history.
""",
    },
    {
        "slug": "device-smart-bar",
        "title": "Device Smart Bar",
        "category": "Infrastructure",
        "icon": "🖥️",
        "order": 33,
        "summary": "Inline action strip on every device row.",
        "body_md": """## What you get on every row
- **Diagnose** — AI summary of CPU/RAM/Disk/temperature/recent tickets.
- **Restart agent** — bounces the RMM agent without opening the remote tools.
- **Push script** — drop into the script picker pre-targeted to this device.
- **Live metrics** — opens a drawer streaming CPU/RAM/Disk.
- **Remote** — launch RustDesk/Mesh/Splashtop instantly.

## Bulk
Select multiple rows → the Smart Bar appears at the top with bulk actions.
""",
    },
    {
        "slug": "invoice-studio",
        "title": "Invoice Studio + Smart Billing",
        "category": "Business",
        "icon": "💸",
        "order": 34,
        "summary": "Drag-and-drop invoice templates plus AI-powered billing intelligence.",
        "body_md": """## Invoice Studio
`/invoice-templates` (Sidebar → Business → Billing & Finance → PDF Templates)

Block-based template editor:
- Drag blocks (logo, address, line items, totals, signature, notes) into a page.
- Pick a preset from the **Gallery** if you don't want to start from scratch.
- Save as the active template — every invoice PDF uses it.

## Smart Billing
- **AI Invoice Draft** (`/api/invoices/smart/draft`) — pulls ticket time + parts and drafts the invoice.
- **Aged AR Insights** — AI summary of who owes what and why.
- **Renewal Risk** — contracts at risk of churn.
- **Smart Recurring** — generates and dispatches recurring invoices on a schedule.
""",
    },

    # ── Help center itself ──
    {
        "slug": "using-help-center",
        "title": "Using the Help Center",
        "category": "Basics",
        "icon": "📘",
        "order": 99,
        "summary": "How to find docs, ask the AI co-pilot, and contribute.",
        "body_md": """## Browse
Use the left rail to jump between categories. Articles are ordered by importance within each category.

## Search
Type into the search box at the top — title, summary and body all match.

## AI co-pilot
Press the **Ask Co-Pilot** button. It answers using only the article corpus, with citations.

## Contribute (admins)
Hit **+ New Article**. Markdown is supported; screenshots can be uploaded inline.

## Reseed
Admins can hit **Reseed** to refresh the default articles. This also prunes stale articles (e.g. `*-audit` slugs from the old documentation pass).
""",
    },
]
