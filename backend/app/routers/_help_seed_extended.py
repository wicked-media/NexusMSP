"""Extended help-article seed content. Imported by chat_help.py.

Adds 25+ articles covering every major module + a complete Easter Eggs section
documenting all quirky behaviours, hidden settings, and how to tinker with them.
"""

EXTENDED_ARTICLES = [
    # ═══════════════════════ DASHBOARD ═══════════════════════
    {
        "slug": "dashboard-overview",
        "title": "Dashboard",
        "category": "Basics",
        "icon": "🏠",
        "order": 0,
        "summary": "Your daily start screen — what every tile does.",
        "body_md": """## What's on the Dashboard
The Dashboard is the first screen after login. It surfaces today's most important signals.

## Top to bottom

### 1. Weather Strip (very top)
A 1.5px gradient bar that signals the day's mood: stormy / beach / rainy_monday / sunny / neutral. Hover for a tooltip; click to open the full **Atmosphere** page. When stormy, the bar pulses rose. See the *Easter Eggs* category for tinkering options.

### 2. Metric Strip
4 tiles: Clients · Devices · Open Tickets · Revenue. Each tile is a quick KPI; trends/colours change automatically.

### 3. Hero header
Greets you by first name and shows the date plus high-level counts. The **Coffee Break Toggle** lives here (☕ button) — start a focus/lunch/meeting session and your assigned tickets get `sla_paused=true` for the duration.

### 4. Standup Digest banner
Auto-rotates morning / midday / end-of-day labels. Click refresh to regenerate via Claude. Auto-emails / SMS at your configured hour.

### 5. SLA Radar Tile
Top tickets at risk of SLA breach. Click any row to jump to the ticket.

### 6. Insight tiles
- Blueprint Insights — rising patterns in this week's tickets
- Churn Risk Radar — clients trending toward churn

### 7. Threat Radar Ticker
Marquee of Huntress signals + cross-client patch anomalies. Hidden when nothing's hot.

### 8. Attention banner
Tactical chips — "X SLA breaches", "$Y outstanding", "N offline devices" — all clickable.

### 9. Volume + Fleet charts
Ticket volume (7-day) + Fleet Health donut.

## Pro tips
- The Coffee Break button auto-detects you're back when you click around the app for >30s.
- The whole dashboard refreshes when you hit `R` (handled by the global key listener).
""",
    },

    # ═══════════════════════ CLIENTS ═══════════════════════
    {
        "slug": "clients-module",
        "title": "Clients & Health Score",
        "category": "Service Desk",
        "icon": "🏢",
        "order": 10,
        "summary": "Master-detail client portfolio with AI insights.",
        "body_md": """## What you see
The Clients page is a master-detail layout (Linear-inspired):
- **Left** — dense client list with health dial + integration chips (ACR/PX8/365/RMM) + MRR sparkline + lifecycle pill.
- **Right** — selected client detail with tabs Overview / Tickets / Assets / Contacts / Billing / Integrations / Activity / AI Insights / M365 / Blueprints.

## Health Score
Each client has a 0-100 health score driven by 6 weighted signals:
| Signal | Weight |
|---|---|
| Ticket volume + criticality | 25 |
| SLA breach rate | 15 |
| Device health (online %) | 20 |
| Backup health | 10 |
| AR aging | 10 |
| Engagement (last activity) | 10 |
| M365 hygiene (when CIPP-linked) | 10 |
**Score < 60** = Watchlist · **< 40** = Critical · **> 80** = Healthy.

## AI Insights tab buttons
- **DNA Profile** — communication style + decision factors + risk preference (Claude reads recent tickets/notes).
- **LTV Forecast** — projected revenue 1y/3y/5y with confidence band.
- **Anniversary AI** — drafts a "thanks for X years" email automatically.
- **Monthly Recap** — emailable summary of the past month.
- **Pre-call Brief** — 30-second briefing before a client call.
- **Insurance Plan** — recommended controls to lift cyber-insurance score.
- **Dossier PDF** — branded one-pager.

## Lifecycle pills
Prospect / Onboarding / Active / Watchlist / Churned. Auto-rolls up into the portfolio metric strip at the top.

## Keyboard shortcuts
- `/` — focus search
- `j` / `k` — navigate next/prev client
- `⌘N` (Cmd+N) — new client
""",
    },

    # ═══════════════════════ DEVICES / RMM ═══════════════════════
    {
        "slug": "devices-rmm",
        "title": "Devices & RMM",
        "category": "Infrastructure",
        "icon": "💻",
        "order": 20,
        "summary": "Live fleet status, patches, scripts, sessions.",
        "body_md": """## Devices page
6-tile metric strip (Total · Online · Offline · Warning · Avg CPU · Need Patching). The table supports search + filter chips + saved views.

## Detail view
Click a device → tabs:
- **Overview** — status, uptime, last seen, IP, OS, model.
- **Performance** — live CPU / RAM / disk graphs (Recharts).
- **Patches** — KB list with status (pending / installed / failed) + Install button.
- **Software** — installed inventory (used by Shadow IT detector).
- **Sessions** — past remote-control sessions.
- **Audit** — every action ever taken on the device.

## Tactical RMM Command Center (`/trmm`)
Power-user view: bulk script execution, live agent map, failed-patch wall, custom field editor.

## How patches connect to Freeze Calendar
If a Change Freeze is active for the client (or MSP-wide) AND the freeze blocks `patch`, the scheduler skips automated installs for that window. You can still install manually. See **Change Freeze Calendar** article.
""",
    },

    # ═══════════════════════ BACKUP / ACRONIS ═══════════════════════
    {
        "slug": "backup-command-center",
        "title": "Backup Command Center & Acronis",
        "category": "Infrastructure",
        "icon": "💾",
        "order": 25,
        "summary": "Live Acronis Cyber Cloud + backup drills + auto-billing.",
        "body_md": """## What it is
`/backup` shows live data from Acronis (Steele Technology partner). 6-tile metric strip: Tenants · Machines · Healthy · Failed · Warning · Alerts.

## Tabs
- **Tenants** — every Acronis customer, link button to map to a NexusOps client.
- **Backup Status** — 364 machines with applied plans, last/next backup times, health indicator.
- **Activities** — recent backup tasks.
- **Alerts** — Acronis alert feed.
- **Billing** — per-client storage usage + per-workload-type cost preview.

## Auto-billing
When a client is linked + their recurring invoice has **Auto-attach Acronis usage** enabled, every generation pulls live usage and adds line items prefixed `Acronis —`. Same logic for Pax8.

## Restore Drills
- `POST /api/backup/drills` — schedule a drill
- Drill completion gives the lead tech +50 XP and increments the client's restore-readiness score.
- Status flows: scheduled → in_progress → completed → archived.

## Configuration
Settings → Integrations → Acronis Cyber Cloud card. Stores Client ID + Secret + Data Centre URL. Test Connection validates within 3s.
""",
    },

    # ═══════════════════════ HUNTRESS / SOC ═══════════════════════
    {
        "slug": "huntress-soc",
        "title": "Huntress / Security Dashboard",
        "category": "Security",
        "icon": "🛡️",
        "order": 30,
        "summary": "SOC-led incident response, agents, identity threats.",
        "body_md": """## SOC Dashboard at `/soc`
Huntress-first when configured, demo data otherwise. 6-tile strip: Agents · Offline · Critical · Open · Signals · Orgs.

## Per-incident actions (... menu)
- **Acknowledge** / **Add comment** / **Assign** / **Close**
- **Isolate agent** / **Release agent**
Each action persists to `db.huntress_actions` (audit). When Huntress rejects (plan-limited), you see a structured `hint` in the toast.

## Identity Threats page (`/identity-threats`)
Merges SOC `identity-threats` with filtered Huntress `incident_reports` (impossible_travel / brute_force / mfa_fatigue / token_theft / password_spray / privilege_escalation). Huntress rows wear an orange `HNT` badge.

## Response Timeline
Right column on SOC Dashboard. Reads `/api/huntress/actions` — full chronological audit of every IR action with accepted/rejected badges.

## Endpoint Security page
Merges live Huntress agents with demo endpoints. Isolate/Release routes to Huntress on Huntress-source rows.

## Configuration
Settings → Integrations → Huntress Labs. Two fields: API Key + Secret Key (HTTP Basic auth). Test Connection probes `/v1/account`.
""",
    },

    # ═══════════════════════ HUDU ═══════════════════════
    {
        "slug": "hudu-docs",
        "title": "Hudu IT Documentation",
        "category": "Knowledge",
        "icon": "📚",
        "order": 40,
        "summary": "Cross-search Hudu articles, assets, passwords + AI suggestions on every ticket.",
        "body_md": """## Hudu Command Center at `/hudu`
6-tile metric strip (Companies · Articles · Assets · Procedures · Websites · Passwords). 6 tabs per resource type. Filter bar with company dropdown.

## Article + Procedure viewer
Rendered Hudu HTML inside a viewer dialog. Copy / open-in-Hudu links.

## Passwords tab
Redacted in list. **Reveal** button decrypts on-demand → audit-logged in `db.hudu_password_reveals` with Show/Hide + Copy buttons.

## AI Suggestions on tickets
The `<HuduSuggestionsPanel />` mounts under every ticket detail. It auto-runs on open, derives 3-6 keywords from title+description (stopword-filtered), queries Hudu, ranks top picks via Claude + concrete fix steps. Hit count badge shows result quantity.

## Configuration
Settings → Integrations → Hudu. Base URL + API Key. Test Connection validates against Hudu API v1.
""",
    },

    # ═══════════════════════ CIPP / M365 ═══════════════════════
    {
        "slug": "cipp-m365",
        "title": "CIPP — Microsoft 365 Management",
        "category": "Security",
        "icon": "☁️",
        "order": 45,
        "summary": "Full M365 tenant ops + 7-dimension hygiene scoring.",
        "body_md": """## CIPP Command Center at `/cipp`
3 tabs: Tenants · Linked Clients · Audit. Per-tenant detail shows users table + SKU chips.

## Per-user actions
- **Create user** (with license picker)
- **Manage licenses** (add/remove)
- **Reset password**
- **Block / Unblock sign-in**
- **Offboard** (with OOO + forward + checkbox options)
Every write audited to `db.cipp_actions`.

## Hygiene Digest tab
7-dimension scoring per tenant:
| Dimension | Weight |
|---|---|
| License efficiency | 20 |
| MFA coverage | 25 |
| Stale users | 15 |
| License waste | 15 |
| Admin sprawl | 10 |
| Guest posture | 10 |
| Modern auth CA | 5 |

- "Send digest" emails an HTML hygiene digest via Resend.
- Upsell candidates surfaces clients with risks → Security Posture bundle prospects.

## Client Health integration
M365 hygiene contributes 10% to the linked client's Health Score (when CIPP tenant is linked + scored).

## Configuration
Settings → Integrations → CIPP. Base URL + API Key. Test Connection probes `/api/getversion`.
""",
    },

    # ═══════════════════════ UNIFI ═══════════════════════
    {
        "slug": "unifi-network",
        "title": "UniFi Site Manager",
        "category": "Infrastructure",
        "icon": "📡",
        "order": 50,
        "summary": "Hosted UniFi (api.ui.com) — sites, devices, alerts.",
        "body_md": """## UniFi Command Center at `/unifi`
5-metric strip (Sites · Devices online/total · Clients · Alerts · Linked %). 2 tabs: Sites · Linked Clients.

## Per-site detail
Master-detail. Sub-tabs: Devices · Clients · SSIDs · Alerts.
- Device table — model, status, IP, uptime, firmware, client-count.
- Client table — wired/wifi badges, signal, RX/TX.
- SSID table.
- Alerts feed.

## Linking
"Link to client" dialog appears on every site. Once linked, the client's topology pulls UniFi data automatically.

## Configuration
Settings → Integrations → UniFi. Base URL (default `https://api.ui.com/ea`) + API Key (X-API-KEY header). Test Connection queries `/hosts`.
""",
    },

    # ═══════════════════════ PAX8 ═══════════════════════
    {
        "slug": "pax8-csp",
        "title": "Pax8 CSP & Auto-Billing",
        "category": "Business",
        "icon": "🛒",
        "order": 55,
        "summary": "Sync M365 / CSP subscriptions + per-seat auto-billing.",
        "body_md": """## Pax8 Command Center at `/pax8`
3 tabs: Companies · Subscriptions · Billing. Live OAuth2 client_credentials against api.pax8.com.

## Linking
"Link to client" on each Pax8 company. Once linked, recurring invoices with **Auto-attach Pax8** enabled pull live seat × unit price each generation.

## Billing preview
`/api/pax8/billing/preview` returns per-client MRR. Click "Link to Recurring Invoice" to enable auto-attach OR scaffold a new RI if none exists.

## Configuration
Settings → Integrations → Pax8. Client ID + Secret. Test Connection requests an access token.

## Live data
104 Pax8 companies · 209 subscriptions · 22 products synced.
""",
    },

    # ═══════════════════════ WAR ROOMS ═══════════════════════
    {
        "slug": "war-rooms",
        "title": "Live Incident War Rooms",
        "category": "Service Desk",
        "icon": "🚨",
        "order": 60,
        "summary": "One URL that becomes the shared battle-station when a P1 fires.",
        "body_md": """## What it is
A war room is a single URL for a P1 incident. Internal techs collaborate in a live chat; clients can watch a public status page.

## Creating a war room
`/warroom` → New. Required: title. Optional: severity, ticket_id, client_id, ETA, summary.
- Auto-resolves `client_name` from the linked client.
- Auto-populates `similar_incidents` by string-matching past resolved tickets.
- Writes opening system message.
- **Auto-spawns** a private chat channel `warroom-{slug}` and posts a system message linking the ticket + severity + ETA. All paged techs are auto-invited.

## Page Team dialog
Body `{tech_ids, channels, auto_escalate, grace_minutes}`. When `auto_escalate=true`, only Tier-1 techs fire immediately. Tier-2/3 stay pending until grace expires (30s scheduler tick).
- **Channels**: Slack · Teams · SMS · Email · In-app push. Missing config → graceful `no_webhook` marker; paging never blocks.
- **Magic-link ack** — `/api/warroom/page/ack/{token}` (no auth, HTML). Used by SMS/Slack/email recipients.

## Public page
`/warroom/public/{slug}` — zero-auth status page. 15s polling. Internal chat hidden; only system + status messages.

## Postmortem
After resolve → "Generate Postmortem" button (sky break-button). Claude drafts summary / timeline / root_cause / impact / what-went-well / what-went-poorly / action_items. Persists to `db.postmortems`.
""",
    },

    # ═══════════════════════ BLUEPRINTS ═══════════════════════
    {
        "slug": "blueprints",
        "title": "Ticket Blueprints (Worksheet Killer)",
        "category": "Service Desk",
        "icon": "📐",
        "order": 65,
        "summary": "Reusable typed worksheets + AI-suggested blueprints + cross-client patterns.",
        "body_md": """## What it is
A blueprint is a reusable worksheet for repeatable work types (New User Onboarding, VPN Setup, Mailbox Migration, etc).

## Creating a blueprint
`/blueprints` → Library tab → New. Define:
- Defaults (priority / category / status / SLA minutes)
- `require_completion` gate (block resolve until complete)
- `fields[]` typed (text / textarea / number / date / select / checkbox)
- `checklist[]` (each with `done_by` / `done_at` stamps)

## Auto-apply on ticket create
On `POST /api/tickets`, if the client has `default_blueprint_id`, the blueprint hydrates the ticket.

## Resolve gate
When `require_completion=true`, `PUT /api/tickets/{id}` with status=resolved/closed returns 400 listing missing items.

## Pattern Discovery tab
Bigram clustering across ALL resolved/closed tickets. Each pattern shows ticket count, client count, sample titles, sample IDs. "Generate Blueprint" → AI dialog with editable draft + two switches: **Push to all N clients** + **Set as default**.

## AI suggest from history
On a ticket's Suggestions tab → "Suggest from history". Scans the client's resolved tickets, feeds Claude, returns a STRICT-JSON draft blueprint. Save & Apply persists + applies in one shot.
""",
    },

    # ═══════════════════════ QBR ═══════════════════════
    {
        "slug": "qbr-generator",
        "title": "QBR Auto-Generator",
        "category": "Reports & Comms",
        "icon": "📊",
        "order": 70,
        "summary": "Quarterly Business Reviews drafted in 60 seconds.",
        "body_md": """## What it is
`/qbr` aggregates per-client tickets, device health, backup health, alerts, quarter spend, plus cross-client pattern hits. Then Claude drafts 7 sections.

## The 7 sections
1. Executive summary
2. Key wins
3. Incident breakdown (with sla_assessment)
4. Infrastructure health
5. Risks & recommendations
6. **MSP Intelligence** — pattern hits each linking to `/blueprints?pattern=...&t=...`
7. Next quarter focus

## Output
- Save to `db.qbrs` (draft + edits).
- Download PDF — branded fpdf with cover, KPI strip, all sections, MSP intelligence bullets.

## Pro tip
Edit the AI draft inline before saving — Claude is fast but you know your client best.
""",
    },

    # ═══════════════════════ INVOICING ═══════════════════════
    {
        "slug": "invoicing",
        "title": "Invoices, Estimates & Recurring",
        "category": "Business",
        "icon": "💰",
        "order": 75,
        "summary": "Invoice templates + AI auditor + DisputeShield + recurring auto-billing.",
        "body_md": """## Invoice detail toolbar
- **Pre-bill Audit** — Claude flags missing time entries, mispriced items, blocked work.
- **Smart Reminder Strategy** — recommended cadence based on client behaviour.
- **Send SMS Reminder** — template-driven; tracks `sms_reminders_sent` + `last_sms_reminder_at`.
- **Invoice Explainer** — plain-English client-safe summary (copy-to-clipboard).
- **DisputeShield PDF** — auto-assembled evidence packet (every ticket worked, time entries with techs, approved estimates).

## Invoice PDF Template Builder
`/invoice-templates`. CRUD with 12 toggleable, reorderable blocks (logo, company info, bill_to, invoice_meta, line items, totals, payment terms, notes, bank details, qr_pay, thank_you, footer). Inline editable copy with merge tags `{{invoice_number}}`, `{{client_name}}`, etc. 4 layouts × 3 densities × custom hex primary colour. Live preview iframe.

## Recurring invoices
Switches: Auto-attach Acronis · Auto-attach Pax8. Both pull live usage on every generation.

## Estimates
- **Win Probability** + **Pricing Flags** panel on detail.
- **Follow-up draft** — AI tailors a subject+body to the most likely objection (price/scope/timing).
- **Auto-Quote from Conversation** — read ticket + notes + product catalog → Claude draft quote.
""",
    },

    # ═══════════════════════ PATCHES ═══════════════════════
    {
        "slug": "patch-hub",
        "title": "Patch Hub & Anomaly Detector",
        "category": "Infrastructure",
        "icon": "🩹",
        "order": 80,
        "summary": "Cross-tenant patch tracker with AI anomaly detection.",
        "body_md": """## Patch Hub at `/patch-hub`
Live patch status across the fleet — by KB, by client, by status.

## Patch Anomaly Detector
`GET /api/patches/anomalies` — KB# patches affecting 3+ clients with high failure rates.
- **Broadcast** button → `POST /api/patches/anomalies/broadcast` → de-dupes against `db.patch_broadcasts`, dispatches Slack/Teams + in-app fallback.
- Only re-fires if `affected_clients` grew since the last broadcast.

## Pause TRMM
`POST /api/patches/anomalies/{kb}/pause-trmm` — temporarily stops automated install of a problematic KB on TRMM until you re-enable.

## Connection to Freeze Calendar
Patches respect freeze windows automatically when scheduled by the chain-reactions loop.
""",
    },

    # ═══════════════════════ TIME TRACKING ═══════════════════════
    {
        "slug": "time-tracking",
        "title": "Time Tracking & Voice Journal",
        "category": "Service Desk",
        "icon": "⏱️",
        "order": 85,
        "summary": "Live timers, billable flags, Voice Journal one-shot logging.",
        "body_md": """## On every ticket
- **Start timer** — runs in the header. Pauses on Coffee Break (auto).
- **Log time** — manual entry with billable flag + duration + rate ($150/hr default).

## Voice Journal
Big record button on the ticket header. WebM audio → OpenAI Whisper → transcript + ticket comment + time_entries row, all in one shot.

## Coffee Break Mode
Dashboard hero → ☕ button. Presets: coffee 15m / lunch 45m / meeting 30m / focus 60m / break 10m.
- Stamps your assigned open/in_progress tickets with `sla_paused=true`.
- Auto-resumes on break end.
- Auto-expires after `duration_minutes` even if you forget.

## Reports
`/time-tracking` shows utilisation, billable %, top clients by hours.
""",
    },

    # ═══════════════════════ COMMUNICATIONS ═══════════════════════
    {
        "slug": "communications",
        "title": "Email, SMS & Phone",
        "category": "Reports & Comms",
        "icon": "✉️",
        "order": 90,
        "summary": "Two-way SMS, Resend email, MobileMessage gateway.",
        "body_md": """## Email
Send from the ticket Conversation tab → Public Email. RichTextEditor with full Outlook signature support (tables preserved on paste). HTML ⇄ Visual toggle for raw paste.

## SMS (MobileMessage.com.au)
- Send from Conversation tab → SMS option.
- Auto-populates recipient from `client.mobile`/`client.phone`.
- Live char/segment counter (signature-aware).
- Inbound replies auto-link by `custom_ref=tkt-{id}` or phone match.
- SMS signature config: Settings → Integrations → SMS Messaging.

## Invoice SMS Reminders
On the invoice detail Actions sidebar (when not paid). Template-driven (`overdue_invoice` default). Shows last reminder timestamp + counter + recent SMS history.

## Phone (3CX, optional)
Click-to-call buttons next to every contact phone. Recordings appear on the contact's Activity tab.
""",
    },

    # ═══════════════════════ SCHEDULING ═══════════════════════
    {
        "slug": "scheduling",
        "title": "Scheduling & Smart Routing",
        "category": "Service Desk",
        "icon": "📅",
        "order": 95,
        "summary": "Calendar, Smart Routing, On-call Roster.",
        "body_md": """## Pages
- `/scheduling` — Calendar view (drag/drop bookings).
- `/smart-scheduling` — AI-routed: feeds tech skills, location, calendar, current load → recommends best assignment.
- `/tech-roster` — Tier 1/2/3 columns + table editor; controls escalation order on war room paging.

## Tech roster fields
- escalation_tier (1/2/3)
- preferred_channels (sms/slack/teams/email/in_app)
- on_call (boolean)
- active (boolean)

Used by warroom paging logic to determine who fires immediately vs who waits for grace expiry.
""",
    },

    # ═══════════════════════ CHANGE FREEZE ═══════════════════════
    {
        "slug": "change-freezes",
        "title": "Change Freeze Calendar",
        "category": "Change & Incidents",
        "icon": "🧊",
        "order": 100,
        "summary": "Block patches/scripts/reboots/broadcasts during sensitive windows.",
        "body_md": """## What it is
A freeze = a "no automated changes" window for a specific client (or MSP-wide).

## Creating one
`/change-freezes` → New freeze. Set:
- Title (e.g. "Stocktake weekend · Acme Corp")
- Client (or "All clients · MSP-wide")
- Starts/Ends (datetime-local picker)
- Block kinds — toggle chips: Patches · Reboots · Scripts · Broadcasts · Deployments
- Reason (optional)
- Active toggle

## What it does
Other modules import `_is_frozen()` to check before firing automation:
```python
from app.routers.change_freezes import _is_frozen
state = await _is_frozen(client_id="...", kind="patch")
if state["frozen"]:
    return  # skip
```
Currently honoured by the chain-reactions loop (SLA auto-page, patch broadcast, storm broadcast).

## Status badges on each row
- **ACTIVE NOW** (rose) — within window
- **UPCOMING** (amber) — starts later
- **ENDED** (zinc) — finished
- **INACTIVE** — manually disabled
""",
    },

    # ═══════════════════════ NOTIFICATIONS ═══════════════════════
    {
        "slug": "notifications",
        "title": "Notifications & Alert Suppression",
        "category": "Reports & Comms",
        "icon": "🔔",
        "order": 105,
        "summary": "Bell icon, types, suppression rules.",
        "body_md": """## Notifications bell (sidebar top)
Last 15 unread items. Types include:
- `chat_mention` — someone @mentioned you
- `chat_broadcast` — `@channel` ping in a channel you're in
- `ticket_assigned` — work routed to you
- `sla_breach` — SLA red zone hit
- `patch_anomaly` — broadcast failed/skipped

## Alert Suppression at `/alert-suppression`
Rules to silence noisy alerts based on:
- Client + alert type
- Time-of-day window
- Specific device categories

Suppressed alerts still write to the audit log for compliance.
""",
    },

    # ═══════════════════════ INTEGRATIONS OVERVIEW ═══════════════════════
    {
        "slug": "integrations-overview",
        "title": "Integrations Overview",
        "category": "Integrations",
        "icon": "🧩",
        "order": 110,
        "summary": "Single screen showing every 3rd-party integration's status.",
        "body_md": """## What it is
`/integrations` aggregates 12+ integrations: Huntress · Hudu · Acronis · Pax8 · Domotz · Stripe · Xero · Resend · MobileMessage · Splynx · Syncro · Suped · CIPP · UniFi.

## Each tile shows
- Connected / Unconfigured badge
- Last synced (amber "stale" mark when >24h old)
- Last test status
- **Open Command Center** + **Configure** buttons (deep-linking)

## Search + filter chips
All / Configured / Unconfigured.

## Coverage %
Top metric — % of integrations connected.
""",
    },

    # ═══════════════════════ MOBILE TECH ═══════════════════════
    {
        "slug": "mobile-tech",
        "title": "Mobile Tech Mode",
        "category": "Service Desk",
        "icon": "📱",
        "order": 115,
        "summary": "Field-tech-friendly compact UI for phones/tablets.",
        "body_md": """## What it is
`/mobile-tech` — single-column UI optimised for one-handed phone use. Big buttons, fewer tabs.

## What's included
- Today's queue
- Active timer (always visible)
- Quick add note / log time
- Voice Journal one-tap record
- Coffee Break toggle
- Click-to-call client phone

## When to use
Field visits. Don't fight with the desktop layout on a 6-inch screen.
""",
    },

    # ═══════════════════════ RUNBOOKS ═══════════════════════
    {
        "slug": "runbooks",
        "title": "Runbook Marketplace",
        "category": "Knowledge",
        "icon": "📖",
        "order": 120,
        "summary": "Promote tickets to reusable runbooks.",
        "body_md": """## What it is
A runbook is a published step-by-step fix for a recurring issue. The team can search them; new techs can follow them.

## Creating one
On any resolved ticket → **To Runbook** button (Ticket AI bundle). Claude reads the resolution notes + steps + commands and drafts a publishable doc. Edit + Publish.

## Searching
`/insights` → Runbooks tab. Full-text + tag search. Filter by client / category / author.

## XP
Publishing a runbook awards +30 XP to the author.
""",
    },

    # ═══════════════════════ KEYBOARD SHORTCUTS ═══════════════════════
    {
        "slug": "keyboard-shortcuts",
        "title": "Keyboard Shortcuts",
        "category": "Basics",
        "icon": "⌨️",
        "order": 5,
        "summary": "Every shortcut bound across the app.",
        "body_md": """## Global
| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + K` | Toggle chat panel |
| `Cmd/Ctrl + /` | Open shortcut palette (this list) |
| `/` | Focus search on Clients / Tickets pages |
| `j` / `k` | Navigate next / prev row in dense lists |
| `⌘N` (`Ctrl+N`) | New (context-aware: client / ticket) |
| `Esc` | Close any modal / dialog |
| `R` | Refresh current page data |

## Tickets
| Shortcut | Action |
|---|---|
| `T` | Open timer |
| `V` | Open Voice Journal |
| `A` | Apply blueprint |

## Chat
| Shortcut | Action |
|---|---|
| `/` | Show slash commands |
| `Shift+Enter` | New line |
| `Enter` | Send |

## Easter eggs
See **Easter Eggs** category for hidden shortcuts (Konami code, etc).
""",
    },

    # ═══════════════════════ EASTER EGGS — THE FUN STUFF ═══════════════════════
    {
        "slug": "easter-eggs-overview",
        "title": "Easter Eggs Overview",
        "category": "Easter Eggs",
        "icon": "🥚",
        "order": 200,
        "summary": "Hidden behaviours, quirky settings, and how to tinker with them.",
        "body_md": """## Welcome to the rabbit hole
NexusOps has a few intentional easter eggs and ambient quirks. They're meant to keep the cockpit feeling alive and rewarding instead of "just another ticket app." This section documents every one of them — what triggers them, how they behave, and which knobs you can turn.

## At a glance
| Egg | Trigger | Documented in |
|---|---|---|
| Konami code → CRT mode | `↑↑↓↓←→←→BA` on any page | konami-crt-mode |
| Stormy weather pulse | Mood = stormy | weather-mode |
| Friday Reel | `/atmosphere` → Friday Reel tab | friday-reel |
| Threat Dragon | `/atmosphere` → Threat Dragon tab | threat-dragon |
| Trading Cards | `/atmosphere` → Client Cards | trading-cards |
| Mood Ring | 30-day client sentiment colour | mood-ring |
| Password Pet | M365/MFA hygiene avatar per client | password-pet |
| Slow-Internet Detective | One-click verdict | slow-internet |
| Device Graveyard | Auto-epitaphs on retired devices | device-graveyard |
| Family Tree | Devices grouped by model+OS | device-family-tree |
| Brain Bucket | Per-tech private scratchpad | brain-bucket |
| Daily Quests | 3 micro-quests per tech per day | daily-quests |
| Achievements | 15 badges (Common→Legendary) | achievements |
| Storm broadcast | Auto-posted to #general at storm onset | storm-broadcast |
| All-clear broadcast | Auto-posted when storm passes | all-clear-broadcast |
| Launch events | Manual rocket triggers | launches |
| Birthday Radar | Contact + client anniversaries | birthday-radar |

## Philosophy
- **Subtle by default** — eggs never block work. They sit in the periphery.
- **Tinkerable** — most have a settings doc you can edit (see each article).
- **Auditable** — gamification XP/achievements are stored in MongoDB, not magic.
""",
    },

    {
        "slug": "konami-crt-mode",
        "title": "🎮 Konami Code → CRT Mode",
        "category": "Easter Eggs",
        "icon": "🕹️",
        "order": 201,
        "summary": "↑ ↑ ↓ ↓ ← → ← → B A — toggle a 30-second retro CRT scanline overlay.",
        "body_md": """## What it does
On any page, type the Konami sequence on your keyboard:
**↑ ↑ ↓ ↓ ← → ← → B A**

You'll get:
- A green-phosphor CRT overlay with horizontal scanlines
- A subtle screen flicker (4 Hz)
- A small "RETRO MODE" badge bottom-left
- Auto-disables after 30 seconds (or hit `Esc`)

## Where it's wired
- Component: `/app/frontend/src/components/easter-eggs/KonamiCRT.jsx`
- Mounted globally inside `App.js` so the listener works everywhere.

## Tinkering
Edit `KonamiCRT.jsx`:
- `DURATION_MS` — change auto-disable timer (default 30000)
- `SCANLINE_OPACITY` — opacity of overlay (default 0.18)
- `SEQUENCE` — change the trigger combo if you want a different one

## Disable globally
Comment out the `<KonamiCRT />` line in `App.js`.

## Why it exists
Because every great cockpit deserves a little fun. Burnout is real — small joys compound.
""",
    },

    {
        "slug": "weather-mode",
        "title": "🌤️ Weather Mode (Mood Signal)",
        "category": "Easter Eggs",
        "icon": "🌤️",
        "order": 202,
        "summary": "5-state ambient mood signal driven by live operations data.",
        "body_md": """## What it is
A subtle gradient bar at the top of the dashboard reflecting the day's vibe:

| Mood | Trigger | Gradient |
|---|---|---|
| **Stormy** | Open critical > 3 OR Huntress alerts > 10 | rose → slate → rose (pulses!) |
| **Beach** | Friday after 4 PM AND no open critical | amber → sky → emerald |
| **Rainy Monday** | Monday before noon AND open total > 30 | slate gradient |
| **Sunny** | Open total < 5 | amber → sky → amber |
| **Neutral** | Default | violet → indigo → sky |

## How to tinker
Edit `_routers/quirky_features.py` → `weather_mode()` function. Adjust the thresholds:
- `open_crit > 3` — change critical threshold
- `huntress > 10` — change alert threshold
- `is_friday_pm` / `is_monday_am` — change time-of-day windows

## Stormy auto-broadcast
When mood flips to **stormy** the chain-reactions loop posts a one-time `@channel` message in `#general` (idempotent per day). When mood drops back to sunny/beach an `☀️ All clear` companion posts. See **storm-broadcast** + **all-clear-broadcast** articles.

## Pulse animation
Only stormy gets the rose pulse + glow. Configurable in `WeatherStrip.jsx` → `@keyframes weatherStormyPulse`.
""",
    },

    {
        "slug": "threat-dragon",
        "title": "🐉 Threat Dragon",
        "category": "Easter Eggs",
        "icon": "🐉",
        "order": 203,
        "summary": "Visual hunger meter for your security alert queue.",
        "body_md": """## What it is
A grow/shrink emoji-creature that visualises Huntress open alerts:

| Open alerts | State | Emoji | Size |
|---|---|---|---|
| 0 | Sleeping kitten | 😺 | 10% |
| 1-4 | Drowsy dragon | 🐉 | 30% |
| 5-14 | Hungry dragon | 🔥🐉 | 65% |
| 15+ | Raging dragon | 🔥🔥🐉🔥🔥 | 100% |

Find it on `/atmosphere` → Threat Dragon tab.

## Tinker
`quirky_features.py` → `threat_dragon()`. Adjust thresholds (`< 5`, `< 15`).

## Pro tip
This is a great "team room" wallboard if you have a TV — leave Atmosphere on and you'll see the dragon grow as the day decays.
""",
    },

    {
        "slug": "friday-reel",
        "title": "🎬 Friday Wrap-up Reel",
        "category": "Easter Eggs",
        "icon": "🎬",
        "order": 204,
        "summary": "Claude-generated 5-scene week-in-review.",
        "body_md": """## What it does
Reads the past 7 days of:
- Closed tickets (count + criticals)
- Drills completed
- Runbooks published
- Top 3 critical wins
- Funniest ticket title (longest title heuristic)

Then asks Claude Sonnet 4.5 to produce 5 short scene captions in a fun, motivational tone.

## Where to find
`/atmosphere` → Friday Reel tab.

## Re-roll
Click "Re-roll" — generates a fresh take. Good for team calls.

## Tinker
`quirky_features.py` → `friday_reel()`. Adjust:
- `week_ago` window (default 7 days)
- System prompt — make it more sarcastic / formal / Aussie
- Number of scenes (currently slices first 5)

## Disable
Remove the tab from `AtmospherePage.jsx` if you'd rather not use it.
""",
    },

    {
        "slug": "trading-cards",
        "title": "🃏 Client Trading Cards",
        "category": "Easter Eggs",
        "icon": "🃏",
        "order": 205,
        "summary": "Each client = a Pokémon-style trading card with rarity.",
        "body_md": """## Rarity tiers
Computed from 12-month revenue:
| LTV | Rarity | Border |
|---|---|---|
| $100k+ | Legendary | amber |
| $50-100k | Epic | violet |
| $20-50k | Rare | sky |
| Under $20k | Common | zinc |

## Stats shown
LTV · Tickets resolved · Years partnered · Devices · Churn score · Longest resolution.

## Tagline
Auto-generated based on rarity + tenure + ticket count. Override by setting `client.tagline`.

## Tinker
`quirky_features.py` → `client_trading_card()`. Adjust:
- Rarity thresholds
- `_client_tagline()` rules

## Where to find
`/atmosphere` → Client Cards tab → pick a client.
""",
    },

    {
        "slug": "mood-ring",
        "title": "💍 Client Mood Ring",
        "category": "Easter Eggs",
        "icon": "💍",
        "order": 206,
        "summary": "30-day client sentiment colour.",
        "body_md": """## Colours
| Avg sentiment | Colour | Label |
|---|---|---|
| ≥ 4.0 | Emerald | delighted |
| 3.3-4.0 | Sky | happy |
| 2.7-3.3 | Amber | neutral |
| 2.0-2.7 | Orange | uneasy |
| < 2.0 | Rose | frustrated |

Source: `db.ticket_sentiment_log` (last 30 days, all tickets for the client).

## Tinker
`quirky_features.py` → `client_mood_ring()`. Adjust thresholds or window length.

## Limitations
Returns "no data" if the client has no recent sentiment-logged tickets. Run AI Sentiment Badge on a few tickets to seed.
""",
    },

    {
        "slug": "password-pet",
        "title": "🐶 Password Pet",
        "category": "Easter Eggs",
        "icon": "🐶",
        "order": 207,
        "summary": "Per-client M365 hygiene avatar.",
        "body_md": """## States
Score = `(MFA% - weak_password×0.5 - breached×1.0) × 100`, clamped 0-100.

| Score | State | Emoji |
|---|---|---|
| 80+ | Happy | 🐶✨ |
| 50-79 | OK | 🐶 |
| 25-49 | Sick | 🐶💧 |
| 0-24 | Dying | 💀🐶 |

## Tinker
`quirky_features.py` → `password_pet()`. Tune the scoring formula or thresholds.

## Pro tip
A "dying" pet is a sales opportunity — show the client the score and recommend a hygiene project. Pair with Hygiene Digest from CIPP for the proof pack.
""",
    },

    {
        "slug": "slow-internet",
        "title": "🕵️ Slow-Internet Detective",
        "category": "Easter Eggs",
        "icon": "🕵️",
        "order": 208,
        "summary": "One-click 'is it the VPN?' verdict per client.",
        "body_md": """## Verdicts
- **Wide outage** — >30% of devices offline → check WAN.
- **VPN bottleneck** — >5 active VPN sessions + >60ms ping → upgrade VPN tier.
- **Wi-Fi/local** — jitter > 20ms.
- **Device-specific** — high error counts on a subset.
- **Healthy** — escalate to ISP.

## Tinker
`quirky_features.py` → `slow_internet_detective()`. Adjust:
- Offline % threshold (currently 30%)
- VPN count threshold (currently 5)
- Jitter threshold (currently 20)
- Synthetic ping/jitter ranges (currently random 15-95 / 2-30) — replace with real RMM/UniFi data when available.

## Real-data path
When Domotz / UniFi / TRMM monitoring data is plumbed in, replace the `random.randint(...)` lines with actual probes.
""",
    },

    {
        "slug": "device-graveyard",
        "title": "⚰️ Device Graveyard",
        "category": "Easter Eggs",
        "icon": "⚰️",
        "order": 209,
        "summary": "Tombstones with auto-epitaphs for decommissioned devices.",
        "body_md": """## What it is
Every device with `status: "decommissioned"` shows up as a tombstone card with an auto-generated epitaph based on lifespan + reason.

## Epitaph rules
- Reason contains "fail" → "Served X years before falling in the line of duty."
- Lifespan > 7 years → "A faithful {type} for X years. Rest easy, old friend."
- Lifespan > 4 years → "X years of dependable service."
- Otherwise → "Brief but bright — X years."

## Tinker
`quirky_features.py` → `_epitaph()`. Add new rules.

## Where to find
`/atmosphere` → Graveyard tab.
""",
    },

    {
        "slug": "device-family-tree",
        "title": "🌳 Device Family Tree",
        "category": "Easter Eggs",
        "icon": "🌳",
        "order": 210,
        "summary": "Devices grouped by model + OS with avg age.",
        "body_md": """## What it is
Per-client view of "devices that look like each other." Groups by `{model} | {os}`. Each row shows count, avg age in years, offline count.

## Why it's useful
- Spot fleet-replacement candidates ("12 × Dell Latitude 7390 averaging 5.8 years — refresh project")
- See OS sprawl ("we have 3 different Windows 10 versions on this site")

## Where to find
`/atmosphere` → Client Cards → pick client → Family Tree mini-card.

## Tinker
`quirky_features.py` → `device_family_tree()`. Change grouping key (default `{model} | {os}`).
""",
    },

    {
        "slug": "brain-bucket",
        "title": "🪣 Brain Bucket (Private Scratchpad)",
        "category": "Easter Eggs",
        "icon": "🪣",
        "order": 211,
        "summary": "Free-form notes only YOU can see.",
        "body_md": """## What it is
A textarea on your `/me` profile (50,000 char limit) only you can read or write. Drop:
- Frequently-used CLI snippets
- Half-baked runbook ideas
- Client quirks ("Bob hates phone calls — email only")
- Personal shortcuts

## Privacy
- Backend enforces `tech_id == current_user.id`. 403 otherwise.
- Stored unencrypted in `db.brain_bucket` (so DB admins CAN read it). For sensitive credentials use Hudu instead.

## Tinker
`quirky_features.py` → `get_brain_bucket()` / `save_brain_bucket()`. Adjust char limit.

## Future
Roadmap: opt-in "AI mine my brain bucket for runbook material" button.
""",
    },

    {
        "slug": "daily-quests",
        "title": "🎯 Daily Quests",
        "category": "Easter Eggs",
        "icon": "🎯",
        "order": 212,
        "summary": "3 random micro-quests per tech per day.",
        "body_md": """## How it works
Each tech gets 3 randomly-picked quests at midnight UTC. Same per-tech per-day (idempotent). Pool currently includes:

| Quest | XP |
|---|---|
| Close 1 low/normal-priority ticket | 25 |
| Close 1 critical ticket | 75 |
| Publish 1 runbook | 50 |
| Complete 1 backup drill | 60 |
| Send a Monthly Recap email | 30 |
| Apply a blueprint to 1 ticket | 20 |
| Respond to 3 tickets within 15 minutes | 40 |

## Where to find
`/me` → Quests tab.

## Tinker
`quirky_features.py` → `daily_quests()`. Add to `quest_pool[]`. Each quest needs `key` + `title` + `xp` + `icon`.

## Marking complete
Currently scored heuristically server-side (when achievements recompute). Future: a manual "I did this" button on each quest.
""",
    },

    {
        "slug": "achievements",
        "title": "🏅 Achievements (15 badges)",
        "category": "Easter Eggs",
        "icon": "🏅",
        "order": 213,
        "summary": "Common → Rare → Epic → Legendary badges.",
        "body_md": """## All 15 badges
| Badge | Trigger | Rarity |
|---|---|---|
| 🩸 First Blood | Close your 1st ticket | Common |
| 💯 Century | Close 100 tickets | Rare |
| 🚒 Five-Alarm Hero | Close 5 critical tickets | Epic |
| 🦉 Night Owl | Resolve a ticket between 22:00-06:00 | Common |
| ⚡ Speed Demon | Close 5 tickets in 1 hour | Epic |
| 🛡️ Guardian | Lead 10 backup drills | Rare |
| 📖 Author | Publish 5 runbooks | Rare |
| 🎯 Sharpshooter | 10 tickets resolved without re-open | Epic |
| 🌐 Polyglot | Close tickets in 5+ skill categories | Rare |
| 👻 Ghost | Resolve 3 weekend tickets | Common |
| 🔥 Streaker | 14-day login streak | Rare |
| 🦄 Unicorn | Receive 5 perfect-CSAT replies | Legendary |
| 🚀 Apollo | First user to use a new feature | Legendary |
| 🤝 Mentor | 10 tickets reassigned-from-you-to-junior | Epic |
| 💎 Diamond | Lifetime Level 50 | Legendary |

## Computing
- `POST /api/achievements/recompute` — full sweep (scheduler).
- Per-tech: `GET /api/team/{id}/achievements` — earned + locked list.

## Tinker
`quirky_features.py` → `ACHIEVEMENTS` list. Add your own.
""",
    },

    {
        "slug": "storm-broadcast",
        "title": "⛈️ Storm Broadcast",
        "category": "Easter Eggs",
        "icon": "⛈️",
        "order": 214,
        "summary": "Auto-posted @channel notice when day flips to stormy.",
        "body_md": """## Trigger
The chain-reactions scheduler runs every 15 min (configurable in Command Center → Automation). On each tick:
1. Compute `weather_mode()`
2. If mood == "stormy" AND no `storm_mood` ref for today's date in `chat_messages` → post to #general:
   *"⛈️ Stormy mood — Open critical: X · Open total: Y · Huntress: Z. Triage mode."*
3. Idempotent via `ref_id = YYYY-MM-DD`.

## Manual trigger
`POST /api/chat/broadcast/storm-check` — fires the same logic on demand.

## Tinker
- `chat_help.py` → `_check_storm_broadcast()` — change body text or thresholds.
- Disable entirely: comment the call in `server.py` chain-reactions loop.
""",
    },

    {
        "slug": "all-clear-broadcast",
        "title": "☀️ All-Clear Broadcast",
        "category": "Easter Eggs",
        "icon": "☀️",
        "order": 215,
        "summary": "Companion to storm — fires when storm passes.",
        "body_md": """## Trigger
Scheduler tick checks:
1. Was a `storm_mood` posted today?
2. Is current mood now `sunny` or `beach`?
3. No `storm_clear` already today?

If all yes → posts: *"☀️ Storm passed — mood is back to SUNNY. Nice work team. Take a breath."*

## Manual trigger
`POST /api/chat/broadcast/all-clear-check`.

## Tinker
`chat_help.py` → `_check_all_clear_broadcast()`. Add `neutral` to the trigger set if you want.
""",
    },

    {
        "slug": "launches",
        "title": "🚀 Launch Events",
        "category": "Easter Eggs",
        "icon": "🚀",
        "order": 216,
        "summary": "Manual rocket-celebration triggers.",
        "body_md": """## What it is
Mark a moment of team celebration — big sale, gnarly bug squashed, milestone hit. Stored in `db.launch_events`.

## Where
`/atmosphere` → Launches tab → "Fire a launch" button.

## API
- `POST /api/ambient/launch-event` body `{kind, label, ref_type?, ref_id?}`
- `GET /api/ambient/recent-launches` → last 10.

## Future
Roadmap: auto-fire on critical-resolved + big-payment-received + achievement-earned.
""",
    },

    {
        "slug": "birthday-radar",
        "title": "🎂 Birthday Radar",
        "category": "Easter Eggs",
        "icon": "🎂",
        "order": 217,
        "summary": "Upcoming contact birthdays + client onboarding anniversaries.",
        "body_md": """## What it surfaces
Per client, the next 60 days of:
- Contact birthdays (from `client.contacts[].birthday`)
- Client onboarding anniversary (from `client.onboarded_at` or `created_at`)

## Where
`/atmosphere` → Client Cards → pick client → Birthday Radar mini-card.

## Tinker
`quirky_features.py` → `upcoming_birthdays()`. Adjust window (default 60 days) or add other key dates (contract renewal, etc).

## Pro tip
Pair with Anniversary AI button (Client AI Insights tab) for one-click "thanks for X years" emails.
""",
    },

    {
        "slug": "tech-of-the-week",
        "title": "🏆 Tech of the Week",
        "category": "Easter Eggs",
        "icon": "🏆",
        "order": 218,
        "summary": "Friday auto-pick of the week's MVP.",
        "body_md": """## When it fires
Every Friday at 16:00 UTC, the chain-reactions loop:
1. Computes XP delta per tech for the past 7 days.
2. Picks the highest delta.
3. Posts to `#general`: *"🏆 Tech of the Week — {name} earned +X XP. Top contributors: {top 3}."*

Idempotent per ISO week (`YYYY-WW`).

## Manual trigger
`POST /api/chat/broadcast/tech-of-week-check`.

## Tinker
`chat_help.py` → `_check_tech_of_week()`. Adjust trigger day/hour, weighting (XP vs critical-closed vs runbooks).

## Disable
Comment the call in `server.py` chain-reactions loop.
""",
    },
]
