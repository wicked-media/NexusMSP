# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps RMM/PSA platform with 200+ routers, 75+ pages, live Acronis Cyber Cloud integration.

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`


## Recent Updates (Feb 2026 — Team Command Center consolidation)
Renamed "Tech Command Center" → **Team Command Center**. All Team module pages folded into a single 11-tab hub at `/tech-command`:
- **Directory** (default) — embeds the full `TechniciansPage` (invite, add, edit, archive, profiles)
- **Smart Finder** — NL search
- **Capacity** — workload cockpit
- **On-Call** — embeds `TechRosterPage` (tier 1/2/3 escalation roster)
- **Skills** — embeds `SkillsMatrixPage`
- **Utilisation** — embeds `TechUtilizationPage`
- **Leaderboard** — embeds `LeaderboardPage`
- **Permissions** — heatmap + diff
- **Role Drift** — AI alignment alerts
- **JIT** — elevation grants + break-glass
- **Audit** — timeline of permission events
- "Invite / Add Tech" + "Refresh" buttons in header
- Embedded pages lazy-loaded via `React.lazy` so only initialise when their tab is opened — no perf hit.
- Sidebar `Team` group collapsed to a single "Team Command Center ⚡" entry. Old routes (`/technicians`, `/tech-roster`, `/skills-matrix`, `/tech-utilization`, `/leaderboard`) remain alive for direct deep-linking.

## Recent Updates (Feb 2026 — Tech Command Center + Outlook-Grade Signatures)

### 🚀 Tech Command Center (`/tech-command`) — outclasses Syncro/HaloPSA/CW/Ninja
A flagship 6-tab control hub for the entire technician workforce, all in the platform's gradient-glow aesthetic.

**Backend (3 new routers):**
- `tech_intel.py` — capacity cockpit (live workload state per tech), smart NL tech finder (AI-parsed intent: skills/level/availability), permission matrix (techs × 16 modules), permission diff engine (preview promote/demote changes), role drift detector (AI flags techs whose actual ticket workload misaligns with assigned role), audit timeline.
- `permission_elevation.py` — JIT elevation (grant elevated permissions for N minutes with auto-revert), break-glass mode (self-grant full admin for emergencies, max 60 min, mandatory detailed reason, fully audited), revoke endpoint, lazy auto-revert on listing.
- All actions tracked via `_log_audit` helper into `permission_audit` collection.

**Frontend:**
- `TechCommandCenter.jsx` — single flagship page with 6 tabs:
  - **Smart Finder**: NL search ("L2 with security skills available now") + skill radar + workload pulse per tech.
  - **Capacity Cockpit**: HeroTile metric strip + horizontal utilisation bars per tech with state badges (idle/active/busy/overloaded).
  - **Permission Heatmap**: techs × 16 modules grid, vertical column headers, color-coded R/W/A cells, per-row "Promote to" dropdown with diff preview dialog.
  - **Role Drift**: AI cards flagging mismatches with rationale.
  - **JIT Elevation**: live active grants list, Grant dialog with tech/preset/duration/reason, Break-Glass dialog with safety guardrails (10+ char reason, max 60min).
  - **Audit Timeline**: vertical time-rail with grouped per-day events, color-coded dots (rose=break-glass, violet=grant, cyan=other).
- 8-axis CSS-only `SkillRadar` component drawn inline (no extra deps).
- Linked into navigation under **Team → Command Center ⚡** as the primary entry.

### ✉️ Outlook-Grade Email Signatures (`/email-signatures`)
Replaces the basic plain-text `email_signature` field with a full multi-signature rich-HTML system.
- Backend `email_signatures.py`: full CRUD + `set-default` + `render-default` + `{sig_id}/render` (substitutes template vars `{{user.*}}`, `{{company.*}}`, `{{ticket.*}}`, `{{client.*}}` against ticket context).
- `tickets.py` `send_ticket_email` now AUTO-INJECTS the user's default rendered signature into every outbound email (with marker `<!--nx-signature-->` to prevent double-stamping). Falls back to legacy plain text if no rich signature.
- Frontend `SignatureManager.jsx`: Outlook-style WYSIWYG editor (bold/italic/underline/align/list/link/image/colour/font/size), template variable inserter dropdown, 3 design presets (modern/minimal/bold), live preview with real user context, scope (all/new/reply), default toggle, multi-signature support.
- Wired into TechSettings → Email Signature tab, replacing the old textarea.

**Tested live (curl + screenshots):**
- Capacity returns 4 techs with workload states (Aaron=overloaded with 37 open).
- Smart Finder parses *"L2 with security skills available now"* into `{skills:[security], level:l2, needs_available:true}` and returns 3 ranked results.
- Permission matrix returns 16 modules × 5 rows.
- Signature created with template vars rendered live: `<b>Aaron Buckanen</b><br/>Senior Engineer | NexusOps MSP`.
- Frontend smoke screenshots confirm full render with skill radars, heatmap, animated state badges.

## Recent Updates (Feb 2026 — Client War Room — live operational dashboard)
- New backend router `client_war_room.py` with two endpoints:
  - `GET /api/clients/{id}/war-room` → live aggregation: devices (online/offline/warning), open tickets w/ critical+breached counts, MTTR (7d), on-call/active techs, last 24h activity, severity (ok/warning/critical).
  - `GET /api/clients/{id}/war-room/commentary` → AI-generated NOC commentary using Claude Sonnet 4.5 via Emergent LLM Key (with deterministic heuristic fallback if no key). Returns tactical 60-90 word situation report: biggest risk → root-cause hypothesis → recommended next action.
- New frontend component `/app/frontend/src/components/clients/ClientWarRoom.jsx`:
  - Wired into `ClientsPage` as a new "War Room" tab in the client detail pane.
  - Auto-refresh every 15s (toggleable), severity banner (rose/amber/emerald), 6 HeroTile metrics, AI commentary card with Regenerate button, quad-grid for Device Telemetry / Active Tickets / On-Call / Live Activity (24h).
  - Visual style perfectly matches the Tickets/Jobs page (gradient-glow tiles, monospace numbers, glassy cards).
- **Tested:** backend returns valid data + AI commentary works (verified live for `client-001` Acme Corporation — severity=critical, 9/10 devices, 31 open / 11 critical tickets, AI commentary is tactical not generic). Frontend smoke screenshot confirms perfect render.

## Recent Updates (Feb 2026 — Clients Module HeroTile rollout — completion)
- Fixed blocker JSX syntax error in `ClientTimelinePage.jsx` (stray closing `</div>`) that was breaking webpack build.
- All Clients module pages now route their stat tiles through the shared `HeroTile` component (single source of truth):
  - `ClientsPage.jsx`: legacy `TopMetric` shim now delegates to HeroTile + the inner detail-pane metric strip (Monthly Recurring / Open Tickets / Assets / Contacts / AR Overdue) replaced with HeroTiles.
  - `ClientHealthPage.jsx`, `ClientRiskPage.jsx`, `ClientBudgetPage.jsx`, `ClientComparePage.jsx`, `ClientTimelinePage.jsx`: inline gradient blocks refactored to HeroTile components with `AnimatedCounter`, animated counters, consistent glow tones (cyan/emerald/violet/amber/rose).
- Verified clean: ESLint passes on all 6 Client pages, webpack compiles without error, smoke screenshot confirms gradient-glow tiles render identically to Tickets/Backup Center.


### 🎨 Tickets List Redesign (Linear/Plain.com-inspired, Feb 2026)
Replaced the bulky Card-row list with a **dense table-list** to leapfrog Syncro/Ninja/HaloPSA aesthetics:
- **Density modes**: Compact / Comfortable / Spacious (`⌘+Shift+D` cycles, persisted in localStorage)
- **Group-by**: None / Status / Priority / Assignee / Client / **Age** (default — Breached / Due in <4h / Due Today / Later / Resolved buckets)
- **Collapsible group headers** with tone-coloured uppercase monospace labels + count badges + sticky positioning
- **Status pills**: Linear-style uppercase mono micro-pills with semantic dot prefix
- **Priority left-border accent** (2px sticky) on every row
- **Hover-reveal**: checkbox + kebab menu fade in on hover; row hover lightens bg subtly
- **Sticky column header** (md+ screens) with monospace 10px uppercase labels
- **Monospace** ticket numbers + tabular SLA timers (turns red when breached)
- **Active viewer** avatars: overlapping cyan-ringed circles with ping animation

### 🤖 AI Co-Pilot Strip (top of ticket detail)
- Violet/cyan banner with "next-best-action" chip computed from heuristics: blocker, SLA breach, device offline, needs reboot, failing checks, pending patches, unassigned, unacknowledged, missing CSAT
- Optional "Summarise" button calls `/api/ai/proofread` for a one-line AI summary (gracefully handles object-vs-string responses)
- Inline stats: ticket age · SLA % · note count · device online state
- Tone-coloured (rose=urgent, amber=warn, cyan=info, violet=primary, emerald=healthy)
- New files: `TicketRow.jsx`, `AICopilotStrip.jsx`
- **Tested:** `iteration_167` — all visual + interaction tests PASS; AI summary object-render bug fixed (single-line patch in generateSummary)

## Recent Updates (Feb 2026 — Saved Views + Tech Profile Richness + Settings Hub)

### 🎨 Hero Tiles propagated platform-wide (consistency drive)
- Extracted the gradient-glow KPI tile from `BackupCenterPage` into reusable `/app/frontend/src/components/HeroTile.jsx`
- **Rewrote `MetricTile`/`MetricStrip` in `/app/frontend/src/components/design-system/index.jsx`** to render the gradient-glow aesthetic — all **17 pages** that already use `MetricStrip` (Tickets, Devices, Dashboard, Workspace, Security, Invoices, Contracts, all Command Centers, Live Chat, Shadow IT, Assets, Integrations…) auto-upgrade with zero JSX changes
- **Added 8 global CSS rules** in `index.css` that automatically upgrade flat-tinted colored Cards (`border-{color}-500/30 bg-{color}-500/[0.0x]`) to the gradient-glow look — catches the **~150 other pages** that hand-rolled their own colored tiles (BillingPro, ClientHealth, AssetDepreciation, etc.)
- Mobile Tech Page custom tile blocks also upgraded
- Backup Center re-uses the shared `HeroTile` component (single source of truth)
- Result: **every stat tile on every page now has identical visual language** — gradient bg, top-right blur orb where applicable, monospace number, uppercase tracking-widest label

### 🎨 Ticket Detail Visual Redesign
- Added `.ticket-glass` CSS utility in `/app/frontend/src/index.css` — wraps the ticket detail container so all child cards automatically get a violet→cyan gradient sheen, hairline accent border, soft inset glow
- Added `.glass-card` utility for opt-in upgrade of any individual Card across the platform (gradient bg + corner blur orb)
- **Tab list rebuilt** — Linear/Plain.com aesthetic: monospace uppercase labels (`Convo · 4`, `Sheet`, `AI`, `Tasks · 3`, `Files · 2`, …), thin violet underline on active tab, transparent bg, no rounded chrome
- Right-rail panels (BurndownBar, WorkflowPanel, DeviceCockpit, AICopilotStrip) already use the same gradient aesthetic — now visually consistent with everything else
- Layout customisation toggle remains: each tech can show/hide AI Co-Pilot · Burn-down · Workflow · Device Cockpit (persisted per user)

### 🧩 Right-rail panel customisation on ticket detail
- New "Layout" dropdown above the ticket detail (data-testid `layout-toggle`) lets each user toggle: AI Co-Pilot · SLA Burn-down · Workflow · Device Cockpit
- Choices persisted to localStorage per user (`nexus.tickets.panels`)
- Combined with **Saved Views**, **Density modes**, **Group-by**, **Custom fields** (existing) → ticket workspace is now fully customisable per technician

### ⭐ Saved Views (Linear-style pinned filter+grouping presets)
- New backend: `/app/backend/app/routers/saved_views.py` — full CRUD scoped to user (`/api/saved-views`)
- Stores: name, scope (tickets/workspace/devices/clients), filters, group_by, density, sort, color, icon, pinned, shared
- New frontend component: `/app/frontend/src/components/SavedViewsBar.jsx` — pinned chips at top of list with star/edit/delete + save dialog (color picker, pin/share toggles)
- **Wired into `/tickets`**: applies view in-place (sets filters + group_by + density)
- **Wired into `/workspace` "My Open Tickets" tab**: clicking a chip stores view in localStorage and navigates to `/tickets`, where it auto-applies on mount
- Each user gets their own private views; can opt-in to share with team

### 👤 Tech Profile (TechProfilePage.jsx) — feature-rich rebuild
- **Backend**: `/api/team/{id}/profile` extended with `csat_avg`, `csat_count`, `recent_closed` (last 5), `activity_heatmap` (7×24), `specialties`, `certifications`, `bio`, `timezone`, `on_call`, `working_hours`
- **Backend**: PUT `/api/technicians/{id}/profile` now mirrors extras to `db.technician_profiles` so the profile read pulls live data
- **Frontend**:
  - 4-card stat strip: Closed · Open · Avg resolve · **CSAT score** (avg/5 + response count)
  - 2-column overview: Skills radar **+** Recent closed tickets clickable list
  - **Activity heatmap** (7 days × 24 hours violet density grid)
  - New **About tab** — editable bio, timezone, working hours, **on-call toggle**, specialties chips, certifications chips (only owner can edit)

### ⚙️ Settings Hub
- Added a quick-access card row at the top of `/settings` linking to all dedicated settings sub-pages: Ticket Settings · Ticket Ping · Tech Settings · My Profile
- Settings page already had searchable index + 7 tabs — kept intact

### 💡 Customisation status (per user request)
- **Already in platform**: per-user density mode, group-by preference, dashboard widgets, theme/branding tab, ticket numbering format, custom fields, automation rules, hotkey palette (⌘K)
- **Now added**: Saved Views (per-user pinned presets), tech profile editable specialties/certs/bio/on-call
- **Future smart features ideas**: Co-Pilot suggestions everywhere (already on tickets), per-page saved layouts, custom row columns, saved kanban swimlanes

## Recent Updates (Feb 2026 — Team Chat Redesign + Slash Commands + Tickets Refactor)

### 🎮 Ticket → Live Device Cockpit (A + B + C)
The ticket detail right-rail now houses a **full RMM control panel** for the linked device:

**Group A — Take Control** (one-click MeshCentral via TRMM)
- Desktop · Terminal · Files buttons each fetch a one-time URL from `GET /api/tickets/{id}/device/remote-url`
- Terminal opens in an embedded modal so the tech stays in ticket context

**Group B — Live device actions** (each posts an audit note to the ticket)
- Reboot / Shutdown (with 60s grace, confirm dialog)
- Wake-on-LAN (graceful "logged for LAN-proxy" until LAN agent wired)
- Run Checks · Install Patches · Send Message to user
- Backend wrapper: `POST /api/tickets/{id}/device/{action}` — auto-creates ticket_notes (is_system_action) + ticket_audit row

**Group C — Diagnostics tabs** (services, processes, patches)
- Services list with start/stop/restart inline (filterable)
- Top 25 processes by CPU with kill button
- Pending Windows Updates list
- Live gauges for CPU, RAM, Disk pulled from TRMM agent every 30s
- Status pills: needs reboot · failing checks · pending patches · logged-in user

**New backend file:** `/app/backend/app/routers/ticket_device_actions.py` (13 endpoints; all gracefully degrade when TRMM not configured)
**New frontend file:** `/app/frontend/src/components/tickets/TicketDeviceCockpit.jsx` (~340 lines)

### 🧰 Ticket Workflow Polish (Group D)
- **Block-on chain**: `POST /api/tickets/{id}/block-on` — pick another ticket as blocker; visible rose-colored indicator
- **Convert to Change Request**: `POST /api/tickets/{id}/convert-to-change` — sets category=change with risk + planned window
- **Schedule Maintenance Window**: `POST /api/tickets/{id}/schedule-maintenance` — creates `db.maintenance_windows` row
- **Send CSAT**: `POST /api/tickets/{id}/send-csat` — manual trigger; **auto-fires on status→closed transition** when `contact_email` exists (`tickets.update` hook)
- **SLA Burn-down bar** in right rail: `GET /api/tickets/{id}/burndown` shows elapsed vs target with breach highlighting
- New backend file: `/app/backend/app/routers/ticket_workflow.py`
- New frontend files: `TicketWorkflowPanel.jsx`, `TicketBurndownBar.jsx`
- **Cleaned up duplicate `/send-csat`** in `tech_performance.py` — `ticket_workflow.py` is now the single source of truth (proper contact_email validation)

**Tested:** `iteration_166` — Backend 23/24 PASS, Frontend 100% PASS, duplicate endpoint resolved

### 🪄 Global Command Palette (`⌘K` / `Ctrl+K`)
- New `/app/frontend/src/components/CommandPalette.jsx` — mounted globally in `App.js → AuthedAddons` so ⌘K opens it from ANY authenticated route
- Unified search across **tickets · clients · devices · people · pages** with 180 ms debounce (backed by `GET /api/command-palette/search`)
- Slash mode: typing `/` shows all 8 chat slash commands (`/ticket /close /assign /sla /note /summarize /page /help`) with icons + arg hints. Commands without args (e.g. `/help`, `/summarize`, `/page`) execute immediately via `POST /api/command-palette/run`; commands with args (e.g. `/ticket`, `/close`, `/sla`) fill the input so the user can complete arguments
- Smart navigation on select: tickets → `/tickets?ticket=NUM`, clients → `/clients?id=ID`, devices → `/devices/ID`, pages → path
- Backend `/api/command-palette/run` auto-resolves to `#ops` or `#general` channel so slash commands are always auditable in chat history (single source of truth — delegates to existing `chat_presence.slash`)
- Keyboard: ArrowUp/Down navigate · Enter run · Esc close · click also works
- **Tested:** `iteration_165` — Backend 15/15 PASS · Frontend keyboard, search, slash mode, navigation all verified working

### 💬 Team Chat — WhatsApp/Teams-quality redesign (`/team-chat`)
- Full UI rewrite at `/app/frontend/src/pages/TeamChatPage.jsx` (modular sub-components)
- New `NewChatDialog` with 3 tabs: **DM · Group · Channel** — create direct messages, multi-person group chats, or named channels (public/private with invite-only members)
- Modernized message bubbles (gradient for own, muted for others), date separators, hover toolbar (react/reply/pin/edit/delete), inline emoji picker, typing indicator, presence dots, info side panel with member list, thread sidebar, search, pinned strip
- Wires `POST /api/chat/dm/{user_id}`, `POST /api/chat/group-dm`, `POST /api/chat/channels` (with member_ids for private channels)
- **Tested:** `iteration_162.json` — 100% PASS (every redesign feature verified end-to-end)

### ⚡ Chat Slash Commands (`/api/chat/slash`)
Extended `chat_presence.slash` with full ticket workflow:
- `/ticket TKT-### status <open|in_progress|on_hold|resolved|closed>` — change status
- `/ticket TKT-### priority <low|medium|high|critical>` — change priority
- `/close TKT-###` — quick close shortcut
- `/sla TKT-###` — show response & resolution SLA timers (live countdown / breach state)
- `/note TKT-### <body>` — add internal note from chat
- `/assign @user TKT-###` · `/summarize` · `/page <severity>` · `/help`
- Frontend `send()` auto-detects slash commands and routes to `/api/chat/slash`; mention-only `/ticket T-XXX` still renders the inline TicketCard
- **Slash Autocomplete Dropdown** (`SLASH_COMMANDS` catalog at top of TeamChatPage): typing `/` shows a Slack/Notion-style filtered dropdown with icons, args hints, and descriptions. Full keyboard nav: `ArrowUp/Down` to highlight, `Tab/Enter` to pick, `Esc` to clear. Mouse click also works. Hides automatically once user types a space (args mode).
- **Tested:** `iteration_164.json` — 100% PASS (filter, keyboard nav, click, send-on-Enter-when-hidden, mention-only carve-out)

### 🧹 TicketsPage.jsx decomposition (P1 refactor)
- Final size: **3431 lines (was 3862, -431 lines, -11%)**
- New `TicketEnrichmentRail.jsx` (99 lines) — TTR Prediction + Blast Radius + Client Health cards
- New `TicketConversationTab.jsx` (223 lines) — full Conversation tab (Note/Email/SMS forms + unified timeline)
- New `TicketSecondaryTabs.jsx` (262 lines) — exports 6 tab components: Worksheets, Attachments, Items, Children, Time, Audit
- All state remains in parent — children are pure presentational
- **Tested:** `iteration_163.json` + `iteration_164.json` — 100% PASS, no regressions

## Recent Updates (Feb 2026 — Bidirectional Ticket↔Chat linking)

### 🔗 Tickets ⇄ Chat
- **Backend:** `GET /api/chat/ticket-card/{ticket_number}` returns embed payload · `POST /api/chat/discuss-ticket/{ticket_number}` posts a "Let's discuss" message into #ops/general (auto-detects).
- **Chat side:** Messages mentioning `/ticket T-XXX` auto-render an inline ticket card showing status/priority/client/assignee/service — clickable to jump into the ticket.
- **Ticket side:** "Discuss in Team Chat" item added to the Ticket Actions dropdown — one click posts to chat & navigates there.
- Result: NexusOps becomes a single hub teams never leave.

## Recent Updates (Feb 2026 — Service Catalog wiring + Notify Channels + Chat Pro overhaul)

### 🧩 Service Catalog wired into ticket creation
- `TicketCreate.service_code` field; backend looks up `service_catalog`, applies priority + SLA + billing/category to ticket
- Frontend Create Ticket dialog gains Service Catalog dropdown (`/api/pro-pack/service-catalog`), auto-fills priority + category from service definition
- Wired in `/app/frontend/src/pages/TicketsPage.jsx` (services state + fetch) and `CreateDialogs.jsx` (selector)

### 📡 Notify Channels event publisher
- New service `app/services/notify_publish.py` — fire-and-forget Slack/Teams/Discord webhook poster
- Hooked into `/api/tickets` POST → `ticket_created` event published with priority emoji, ticket #, client, title
- Channels subscribed via `events: [...]` array fire automatically; failures are logged, never block ticket creation

### 💬 Chat Pro — full Slack-style internal team chat (`/team-chat`)
**New backend endpoints (`/api/chat/*`):** reactions toggle · thread replies + retrieve · edit message · soft-delete · pin/unpin + list pinned · search (regex) · file upload (base64, ≤10 MB) · typing indicator (5s window).

**New frontend page `/app/frontend/src/pages/TeamChatPage.jsx`:** 3-pane layout — sidebar (channels + DMs + team), main feed with hover action toolbar (react/reply/pin/edit/delete), thread sidebar, emoji picker, file paperclip, search, typing indicator, member list. Full-featured Slack-equivalent.

### Tested
- `iteration_161.json` — 17/17 backend tests pass · frontend Team Chat + Service Catalog dropdown verified · 0 issues.

## Recent Updates (Feb 2026 — Pro Pack: IA cleanup + 20 new feature pages)

### 🧹 Information Architecture Cleanup
- Removed duplicate `/predictive-failure` entry · Renamed duplicate "SLA Center" → SLA Hub · Renamed duplicate "Smart Routing" labels (Auto-Scheduler vs Smart Routing) · Merged `/qbr-generator` into Reports
- Sidebar regrouped: Tickets now contains Triage Queue + Service Catalog + SLA Hub. Devices contains Patch Tuesday. Compliance contains Cyber Insurance Export + DR Plans. Comms contains Slack/Teams Webhooks + CSAT + NPS. Settings contains API Tokens + 2FA. Live Support contains Phone System.
- New hub pages: Automation Hub, Documentation Hub, Financial Analytics Hub, SLA Hub (each tile-grid landing page).

### 💎 Pro Pack — 20 new feature pages, 25+ new endpoints (`/api/pro-pack/*`)
- Triage Queue · Service Catalog (SLA-attached SKUs) · Ticket Merge/Split · Quote-to-Cash pipeline view
- Slack/Teams/Discord webhooks (CRUD + test) · Customer Health Score · Patch Tuesday calendar
- Phone System inbound webhook → auto-create ticket · API Tokens (sha256-hashed) · 2FA TOTP setup
- CRM Pipeline (6 stages, drag-stage move) · KB Auto-Generator from tickets · Cyber Insurance Compliance Export
- DR Plans (RTO/RPO + scenarios) · SaaS Spend Tracker (per client) · MS Defender / AV Health
- Stocktake Mobile (scan/count/commit) · Asset Tag Batch Print · NPS Summary · Bulk PDF/Zip download

### Bug fix
- Route `/api-tokens` collided with `/api` ingress prefix → renamed to `/settings-api-tokens`.

### Tested
- `iteration_160.json` — 34/34 backend tests pass · 19/20 frontend pages verified · 1 issue (route collision) **fixed**.

## Recent Updates (Feb 2026 — Billing Pro: best-in-class billing)

### 💎 Billing Pro Suite (beats Syncro/HaloPSA/Ninja)
**New backend router** `/app/backend/app/routers/billing_pro.py` (~700 LOC) exposes 25+ new endpoints. **New frontend page** `/billing-pro` with 9 settings/dashboard tabs. Existing pages enhanced inline.

**Implemented (all P0 + P1 + most P2):**
- ✅ Smart invoice numbering (`{YYYY}/{FY}/{CLIENT}/{SEQ:05d}` token format · FY-aware reset · live preview)
- ✅ Per-line-item tax rate + per-line discount % + invoice-level discount % on `/api/invoices` create
- ✅ Bulk invoice actions: mark sent/paid, void, delete, **CSV export** with checkbox toolbar in InvoicesPage
- ✅ AI Smart-Suggest line items from un-invoiced billable time + tickets (button in invoice form)
- ✅ Approval workflow (threshold-based) — invoices ≥ $X auto-flagged `pending_approval`, request/approve/reject endpoints
- ✅ Deposits / progress invoicing — `POST /create-deposit` generates child invoice w/ N% of parent
- ✅ Tax-invoice compliance settings (AU ABN / NZ NZBN, GST %, bank details, "Tax Invoice" label)
- ✅ Multi-warehouse stock locations + stock transfers between locations
- ✅ Auto-PO from low-stock — one-click vendor PO generation, draft → sent → received with auto-stock-in
- ✅ Quantity-break (tier) pricing per product + price-for-qty resolver
- ✅ Bulk product CSV import (column mapping, upsert by SKU, error report)
- ✅ Margin calculator — suggest retail price for target margin %
- ✅ CPI / Annual Indexation — auto-bump unit prices on each anniversary, integrated into recurring scheduler tick (server.py)
- ✅ Mid-cycle proration calculator
- ✅ Generation calendar — 3-month forecast of recurring invoice events
- ✅ MRR analytics dashboard — current/new/paused/cancelled MRR + 13-month trend
- ✅ Inventory month-end snapshot (totals, by-category, low-stock detail)
- ✅ Live FX conversion (exchangerate-api.com)
- ✅ Retainer / pre-paid hours — top-up, draw-down, full transaction history
- ✅ Customer invoice portal comments + dispute thread

**Files:**
- Backend: `app/routers/billing_pro.py` (NEW), `app/routers/invoices.py` (extended create), `app/models.py` (InvoiceCreate.discount_pct/amount), `server.py` (indexation cron)
- Frontend: `pages/BillingProPage.jsx` (NEW · 9 tabs), `pages/InvoicesPage.jsx` (bulk toolbar · per-line tax/discount · AI suggest), `pages/ProductsPage.jsx` (margin calc · tier pricing), `pages/RecurringInvoicesPage.jsx` (CPI indexation toggle)

**Tested:** `iteration_159.json` — 25 backend tests + frontend UI: **100% pass**.

## Recent Updates (Feb 2026 — Backup Centre Merge & Live Data)

### 🧩 Backup Centre — Single Unified Page
Merged the legacy `/backup-dashboard` "Acronis Tenants & Billing" page into the modernized Backup Command Center at `/backup-center`. Now ONE page with **9 tabs**: Dashboard · Live · Tenants · Backup Status · Acronis Console · Orphans · Compliance · Billing · Verify.
- New components: `TenantsTab.jsx` (83 tenants + link/unlink dialog), `BackupStatusTab.jsx` (364 machines + per-machine Run / bulk Run on filtered status), `BillingTab.jsx` (pricing config + per-client preview + auto-bill toggle).
- Old `BackupCommandCenterPage.jsx` deleted; `/backup-dashboard` and `/backup-compliance` now redirect to merged page.
- Sidebar: "Backup Command Center" promoted to top-level (no children).

### 🔧 Backup Centre — Live Acronis Data
Removed legacy mock-seeding from `/api/backup-dashboard/overview` and `/api/backup-verify/overview`. Dashboard tab now synthesises rows directly from `acronis_service.get_resource_statuses()` returning real machines/tenants (e.g. `FSMC-HOST`@forbesservicesclub, `MP-SERVER`@midpro — 364 machines from live tenant).
- Removed `_seed_backup_data()` and `_seed_tests()` (auto-creating Acme/TechStart/Veeam fakes)
- Frontend dashboard table columns updated: Tenant · Machine · Plan · Last Backup · Next Run · Status
- Verify tab shows clean empty state until real verifications are recorded
- Purged 37 fake `backup_jobs` + 20 fake `backup_verifications` from MongoDB

### Testing
- `iteration_158.json`: **All 9 tabs verified rendering live Acronis data — no regressions.**

## Recent Updates (Feb 2026 — Bill-Shock Reconciliation + Device Backup Plans)

### 💰 Bill-Shock Reconciliation
Per-line-item drift detection between billed quantities and actual Acronis-protected device count.
- **Recurring invoices** can now link any line item to an **Acronis policy** via dropdown (99 plans available from live tenant)
- **Reconcile button** ($ icon) on every recurring invoice opens dialog with:
  - 4 summary stats: Line Items · Plan-Linked · Drift Detected · Bill Shock $/period
  - Per-line-item table with Billed / Actual / Drift / Bill Shock columns
  - Severity coding: critical (>5 abs or >20%), warning (>2 abs or >10%), minor, ok
  - "You're under-billing by $X" / "over-billing" warning banner
- Drift is computed by querying Acronis applications under that policy, intersecting with devices linked to the client (`device.acronis_resource_id` or `acronis_id`)

### 📡 Device Backup Plans
New **Backups** tab on every Device Detail page:
- Acronis Resource link card — shows current link status (explicit / name_match / none) with manual link editor
- Applied Backup Plans table — every plan currently assigned to this device in Acronis (name, type, state, enabled)
- Recent Backup Activities table — last 20 activities for this resource
- Auto-fallback: if no explicit `acronis_resource_id`, attempts name match against Acronis resource names

### New backend endpoints (`billing_reconcile.py`)
- `GET /api/billing/reconcile-recurring/{ri_id}`
- `PUT /api/billing/recurring/{ri_id}/line-items/{idx}/link-policy`
- `GET /api/devices/{device_id}/acronis`
- `PUT /api/devices/{device_id}/acronis-link`

### Testing
- `iteration_156.json`: **21/21 backend + frontend reconcile flow verified.** 99 plans loadable, dropdown linking works, dialog stats display correctly.

---

## Recent Updates (Feb 2026 — Acronis Backup Actions)

### Wired up everything Acronis exposes
After researching the Acronis Cyber Cloud public API, the following are supported and now usable from NexusOps without leaving the page:

**✅ Run backup now** — `POST /api/acronis/backup/run` (existing endpoint, also exposed in Apply Plan dialog as "Run immediately after applying")
**✅ Cancel running backup** — `POST /api/acronis/backup/cancel` (state: stopped). Stop button on every running activity card in Live tab.
**✅ List backup plans** — `GET /api/acronis/policies` returns 98 real backup-only policies (filtered to `policy.backup.*`)
**✅ Apply / change plan** — `POST /api/acronis/policies/apply` with optional `run_now`. ChangePlanDialog with search + run-now checkbox. Per-row action on every Unprotected resource and bulk action for multi-select.
**✅ Remove plan binding** — `DELETE /api/acronis/applications/{id}`
**✅ List a resource's plans** — `GET /api/acronis/resources/{id}/applications`

### Honest about API limitations
Amber info banner on Acronis Console tab explains:
- **Pause/Resume is NOT in Acronis's public API** — only stop/run
- **Per-run scheduling is NOT in the API** — schedules are baked into the policy itself; users either edit the policy in Acronis Cloud or apply a different plan from here

### Testing
- `iteration_155.json`: **100% backend (25/25) + 100% frontend.** Verified against live Acronis tenant — 98 backup plans, 89 Apply Plan buttons, bulk action working.

---

## Recent Updates (Feb 2026 — Backup Center Modernization + Acronis Orphan Hunter)

### Modern Backup Command Center (`/backup-center`)
Massively redesigned to feel "like you're inside Acronis" with live data and animations.

**Hero**: gradient icon, status pill ("X running" pulsing), Open Acronis Cloud + Refresh buttons
**6 glow metric tiles** (Total Backups, Successful, Failed, Running, Online Agents, Active Alerts) with animated count-up

**6 tabs**:
- **Dashboard** — backup jobs table with filter & search
- **Live** — running backups with **animated SVG progress rings**, pulsing ping dots, shimmer progress bars, CRT-style stats (📦 transferred · ⚡ MB/s · 🏢 tenant); auto-refreshes every 5s; recent activity table
- **Acronis Console** — Quick Actions (Open Acronis Cloud, Refresh Live, Sync Agents, Run Orphan Scan), Agent Health card (Online / Offline / Stale >24h), Active Acronis Alerts list with severity badges + ArrowUpRight (open in console) + Dismiss buttons
- **Orphans** — "Orphan & Zombie Hunter" violet card with Run Scan button → 4 summary tiles + detail tables (Unprotected, Stale, Zombie Plans, Offline Agents)
- **Compliance** — existing device backup status
- **Verify** — existing restore verification tests

### New Backend Endpoints (`acronis_advanced.py`)
- `GET /api/acronis/orphans?stale_days=30` — 4-way orphan detection (unprotected resources, stale-but-billing, zombie plans pointing to deleted resources, long-offline agents still consuming)
- `GET /api/acronis/agents/health` — categorized agent health (online/offline/stale)
- `POST /api/acronis/alerts/{id}/dismiss` — mark alert handled in Acronis
- `GET /api/acronis/console-link` — build deep-link URL into Acronis Cloud UI
- `GET /api/acronis/live-activities` — running + recent activities with progress %, transferred/total bytes, speed

### Live Acronis Data Verification
Real Acronis instance returned 169 orphan items (89 unprotected, 80 zombie plans) and 200 active alerts on first scan — feature is operating against the live API.

### Testing
- `iteration_154.json`: **100% backend (18/18) + 100% frontend.**

---

## Recent Updates (Feb 2026 — Team Pins / NOC Strip)

### Shared Team Pins (Outage Room mode)
- New `/api/team-pins` endpoints — anyone can pin a ticket for the whole team; only the original pinner or an admin can unpin.
- **Dashboard NOC Strip** at top of Dashboard with red animated pulse stripe — auto-refreshes every 30s, hidden when no active pins.
- Each card shows ticket #, priority, status, client, age since pin, optional note + who pinned it.
- **Ticket Detail header**: red pulsing "TEAM" badge (with Siren icon) appears when team-pinned.
- **Actions menu**: "Pin for Team (NOC strip)" toggles. When pinned by another user, shows "Pinned by {Name}" and disables (only that user or an admin can unpin).

Backend: `/app/backend/app/routers/team_pins.py` with 4 endpoints (list, pin, unpin, status).

### Testing
- `iteration_153.json`: **100% backend (14/14) + 100% frontend.**

---

## Recent Updates (Feb 2026 — Workspace Module + Multi-Device Linking)

### Workspace Module — Per-tech "My Work" hub
- **New page** at `/workspace` (sidebar entry "My Workspace" under Service Desk)
- **5 tabs**: Pinned · My Tickets · Watched · Scratchpad · Recent
- **Metric strip**: Pinned count · Watching count · My Open Tickets · My Critical
- **Pin from any ticket** via Actions menu → "Pin to My Workspace" (toggle, with "Pinned" badge in detail header)
- **Watch devices** for personal monitoring (UI hooks ready; device-page button to wire up later)
- **Personal scratchpad** for snippets, notes, command bookmarks (persisted server-side)
- **Recent activity feed** showing last 20 actions by the current user
- **My Open Tickets** quick-list sorted by SLA due date

Backend: `/app/backend/app/routers/workspace.py` with endpoints:
- `GET /api/workspace` — hydrated dashboard data
- `POST/DELETE /api/workspace/pin/ticket/{id}` + `GET .../status`
- `POST/DELETE /api/workspace/watch/device/{id}`
- `PUT /api/workspace/scratch-notes`

### Multi-Device Linking on Tickets (Syncro-style)
- Tickets can now link **multiple devices/assets** instead of just one
- New chip-list UI in ticket sidebar (`TicketLinkedDevices.jsx`) with:
  - Click chip name → open device page
  - ⭐ on hover to promote a chip to **primary device** (legacy `device_id`)
  - X to unlink (auto-promotes next chip to primary if needed)
  - "+" dropdown to add another device (filtered to ticket's client)
- Backward compat: legacy `device_id` field preserved as the primary device pointer; `device_ids[]` is the source of truth.

Backend changes:
- `Ticket` and `TicketCreate` models gained `device_ids: List[str]` and `device_names: List[str]`
- New endpoints: `POST /api/tickets/{id}/devices` and `DELETE /api/tickets/{id}/devices/{device_id}`
- Create-ticket flow auto-merges `device_id` into `device_ids` and resolves names

### Testing
- `iteration_152.json`: **100% backend (23/23) + 100% frontend.** All workspace + multi-device flows verified.

---

## Recent Updates (Feb 2026 — Ticket Detail UX Redesign + Refactor)

### UX Redesign — "Less in your face" (per user feedback)
- **Header refactored** into Syncro-style grouped dropdown menus to reduce button clutter:
  - **C.R.A.I.G** (purple) — AI Diagnose, Doppelgänger, Suggest Resolution, Smart Assign, Apology Draft, Promote to Runbook
  - **Actions** — Start/Stop Timer, Log Time, Create Child, Merge Tickets
  - **Billing** (emerald) — Add Items, Apply Kit, Push to Invoice, Auto-Quote
- Hot buttons kept visible: Back, Remote, Copilot, Explain Error, Voice Journal, Email, PDF, Why on Fire
- **Title card + Compact Progress Tracker** now sit side-by-side (50/50 grid). New `compact` mode on `TicketProgressTracker` — pill-rail layout shows all 5 stages clearly without taking full width.
- **Hudu KB Suggestions** moved into a collapsible `<details>` toggle to free up vertical space.
- **Related Tickets** promoted from sidebar to a chip-banner at the top of main content for one-click navigation to potential duplicates.
- **Sentiment card removed** from the sidebar (per user request — was noisy and rarely actionable).

### Tech-debt: TicketsPage decomposition (~3893→3857 lines, +5 new files)
- `TicketDetailHeader.jsx` — new header with the 3 grouped dropdowns
- `TicketDialogs.jsx` — extracted: Email, ChildTicket, Merge, LogTime, NotifyClient, AddItems, PushInvoice
- `CreateDialogs.jsx` — extracted: CreateTicket, CreateWorkshopJob, CreateFieldJob
- `JobDialogs.jsx` — created (12 workshop+field dialogs); not yet swapped in (deferred to next batch)
- `TicketAIBundle` refactored to support `variant="menu"` + `renderMenuItems` for embedding inside a DropdownMenu
- `TicketProgressTracker` gained `compact` prop

### Testing
- `iteration_151.json`: **100% frontend pass rate.** Testing agent fixed a minor nested-button HTML warning in `HuduSuggestionsPanel.jsx`. All dropdowns, layouts, and dialogs verified working.

---

## Recent Updates (May 3, 2026 — P2 Module Audits: Devices/Invoices/Backup)

### What was audited
- **Devices Page** — every metric tile, toolbar button (Refresh/Discover/Add Device), bulk-action bar (Reboot/Scan/Deploy Agent/Delete), filter row, table columns, row actions menu, detail tabs.
- **Invoices Detail** — Items+Activity tabs, Stripe/manual payment buttons, PDF/Email/SMS actions, AI helpers (Smart Reminder/Explainer/Pre-bill Audit), DisputeShield + new Pre-scan Risks (AI), Details card.
- **Backup Center** — 5 tabs (Tenants/Backup Status/Activities/Alerts/Billing), Restore Drills sidebar, auto-billing flow.

### Functional addition
- **LateRiskBadge** component on invoice detail Details card. Pulls `/api/invoices/{id}/late-risk`, shows coloured pill (low/medium/high) with score 0-100 + reasons tooltip. Hidden on paid invoices.

### Documented (59 articles total)
Three new audit articles preserved alongside all 56 previous:
- `devices-page-audit` — Infrastructure
- `invoice-detail-audit` — Business
- `backup-page-audit` — Infrastructure

Each includes a **Tinker** section pointing at the exact file + line for customisation.

### Testing
- `iteration_150.json`: **11/11 backend (100%) + 100% frontend.** Zero issues.


## Recent Updates (May 3, 2026 — Client 360° Full Profile)

### Every service the customer has — in one place
- New `client_360.py` router — 5 aggregator endpoints:
  - `GET /api/clients/{id}/full-profile` — kitchen-sink (subs + security + billing + assets + tickets + integrations + churn + dna)
  - `GET /api/clients/{id}/subscriptions` — Pax8 + Acronis + recurring invoices combined
  - `GET /api/clients/{id}/security` — CIPP MFA% + 7-dim hygiene + Huntress agents + critical alerts
  - `GET /api/clients/{id}/billing-detail` — AR aging + MRR + LTV + recent invoices
  - `GET /api/clients/{id}/assets-detail` — device family grouping by model

### Two new tabs + two enhanced
- **Subscriptions** (NEW) — 4 stat tiles (Active subs · Total seats · Monthly $ · Annual $) + source badges + per-line table. Verified live: Acme Corporation = 4 subs / $13,895/mo / $166,740/yr.
- **Security** (NEW) — MFA coverage %, CIPP 7-dimension hygiene bars, Huntress agent count + critical alerts, deep-links to /cipp + /huntress-dashboard.
- **Billing** (enhanced inline) — open/overdue/MRR/LTV tiles, AR Aging buckets (Current/30/60/90+) coloured, payment promises kept/broken badges, recent 10 invoices table.
- **Assets** (enhanced inline) — total/online/offline tiles, devices grouped by model (count, avg age, online/offline, 4-device preview).

### New component library
`/app/frontend/src/components/clients/Client360Tabs.jsx` — reusable Client360Subscriptions, Client360Security, Client360Billing, Client360Assets components with shared Stat/InfoTile/EmptyState helpers.

### Help (56 articles total)
- `clients-360` — full audit of all 12 tabs with tinker paths and API endpoint reference.

### Testing
- `iteration_149.json`: **27/27 backend (100%) + 100% frontend.** Zero issues.


## Recent Updates (May 3, 2026 — Ticket Module Audit + Finance Intel UI Wiring)

### Connected Finance Intel features into the ticket workflow
- **QuoteNudgeBanner** (`components/tickets/QuoteNudgeBanner.jsx`) auto-appears on ticket detail when quote-nudge score ≥ 50 (6+ comments, 120+ min logged, 3+ project keywords). "Draft quote now" button triggers AI auto-quote.
- **KitPickerDialog** (`components/tickets/KitPickerDialog.jsx`) — Apply Kit button on Items tab. Lists available product bundles; one click attaches all products + labor via `POST /api/tickets/{id}/apply-kit/{kit_id}`.
- **Pre-scan Risks (AI)** button on Invoice detail Actions sidebar — calls `/dispute-scan`, surfaces heuristic flags + Claude AI risks + per-line justifications BEFORE sending.

### Help Center (55 articles now — preserving all previous)
- `tickets-toolbar-reference` — complete Ticket module audit documenting every toolbar button + all 10 detail tabs + right-sidebar cards + pro tips + tinker paths.
- `invoice-dispute-scan` — Pre-emptive Dispute Scan reference.
- `quote-nudge-banner` — Easter Eggs section entry.

### Testing
- `iteration_148.json`: **18/18 backend (100%) + 100% frontend.** Zero issues.
- Known: Full TicketsPage.jsx decomposition (4300+ lines) still P1 — didn't ship in this batch (too risky without dedicated round). Minor HuduSuggestionsPanel button-nesting warning flagged for future cleanup.


## Recent Updates (May 3, 2026 — TRMM Reliability · Sync · Outage Detective)

### 🛰️ Live TRMM Sync (core reliability fix)
- New `tactical_rmm_sync.py` — background sync pushes live TRMM agent state into `db.devices` every chain-reactions tick (3-15 min configurable). Main `/devices` page now shows reality instead of stale seed data.
- **Demo Mode** — when TRMM not configured, generates realistic synthetic agents from existing devices (82% online, 10% offline, 5% warning, 3% stale distribution). Flips to Live automatically when creds added in Settings → Integrations → Tactical RMM.
- **State transition log** — `db.device_state_log` captures every online↔offline transition with timestamps + client_id. Enables "offline for 2h 14m" labels, outage forensics, pattern detection.

### 🔥 Outage Detective
- When 3+ devices at same client go offline within 5 min → auto-creates a `db.outages` row + Priority:Critical ticket with triage hints (ISP/WAN/UPS/UniFi). Idempotent per client per day.
- Live banner on `/devices` + full list on `/device-reliability` → Outages tab with Resolve button.

### 📡 Stale Agent Radar
- `GET /api/trmm-sync/stale-agents?days=3` — devices linked to TRMM but silent >N days. Next step: agent reinstall runbook.

### 🎯 Per-Client Device Health Roll-up
- `GET /api/trmm-sync/client-health` — returns every client with online/offline/warning/linked counts + online_pct progress bar + badge (HEALTHY · WARNING · PARTIAL OUTAGE · FULL OUTAGE).

### ⚡ Bulk TRMM Actions
- `POST /api/trmm-sync/bulk-action` body `{device_ids:[], action: 'reboot'|'install-patches'|'run-checks'}`. **Honours Change Freeze** — frozen clients auto-skipped with `change_freeze_active` reason. Demo mode simulates. Live dispatches to TRMM. All audited to `db.trmm_actions`.

### 🖼️ Frontend
- New `/device-reliability` page — 4 tabs (Client health · Outages · Stale agents · Bulk actions) + Sync now button + DEMO badge + freshness badge.
- Main `/devices` page — thin freshness strip at top ("Updated 42s ago" green / 8m amber / 23m rose) + red outage banner when active. "Reliability center →" deep-link.
- Sidebar: Devices → **Reliability & TRMM Sync**.

### 📚 Help articles (4 new — 52 total now)
- `trmm-reliability` (Infrastructure) — full architecture doc
- `outage-detective` (Easter Eggs) — trigger + tinker
- `stale-agent-radar` (Infrastructure) — threshold + next steps
- `bulk-trmm-actions` (Infrastructure) — safety rails + freeze integration

### Testing
- `iteration_147.json`: **29/29 backend (100%) + 100% frontend.** Live-verified: 131 devices updated per sync, 48+ transitions logged, 5+ active outages with auto-created tickets (TKT-00069 through TKT-00075). Zero issues.


## Recent Updates (May 3, 2026 — Finance Intelligence: 9 Differentiators)

### Products & Invoices — killing the competition on revenue intelligence

All 9 features live at `/finance-intel` (new Finance Center sub-item "Finance Intelligence"):

1. **Smart Product Catalog** — `GET /api/finance/product-margin-insights` computes margin%, cost change vs last price_history entry, flags LOW MARGIN / COST UP. `POST /api/finance/product/{id}/price-change` records to price_history.
2. **Product Kits/Bundles** — `db.product_kits`, full CRUD, `POST /api/tickets/{tid}/apply-kit/{kit_id}` auto-attaches all kit products + labor to a ticket.
3. **Per-Client Price Book** — `db.client_price_overrides`. `POST /clients/{id}/price-book` upsert, `GET /clients/{id}/price-for/{product_id}` resolves price (override vs standard) with source label for use elsewhere in the app.
4. **Subscription Drift Detector** — `GET /api/subscription-drift` cross-joins Pax8 subscriptions ↔ linked clients ↔ CIPP active users. Flags seats_paid > seats_used with wasted_monthly_aud + recommendation.
5. **Cash Flow Forecast** — `GET /api/finance/cash-flow-forecast` projects 30/60/90-day inflow from open invoices + recurring generations + churn-weighted risk_adjusted variants. Live: $91k/30d.
6. **Late-payment Predictor** — `GET /api/finance/invoices/late-payment-risk` + `GET /api/invoices/{id}/late-risk`. 0-100 score from client payment history, past-due balance, churn score, broken promises.
7. **Margin per Invoice** — `GET /api/invoices/{id}/margin` with cost_breakdown {products, labor, other}. `GET /api/finance/margin-overview?days=90` rolls up per client.
8. **Predictive Auto-Quote Nudge** — `POST /api/tickets/{id}/quote-nudge` scores based on comment count + minutes logged + project-keyword hits. Returns `should_quote:true` above 50.
9. **Pre-Emptive DisputeShield Scan** — `POST /api/invoices/{id}/dispute-scan` runs heuristic flags + Claude scan (when EMERGENT_LLM_KEY set), returns ai_risks[] with per-line justifications referencing actual tickets.

All endpoints namespaced under `/api/finance/...` to avoid conflict with existing `/products/{id}` and `/invoices/{id}` catch-alls.

### Frontend
`FinanceIntelPage.jsx` — 7-tab consolidation: Product margin · Kits · Price book · Drift · Cash flow · Late risk · Invoice margin. Master-detail Kit editor, price-book form, live stats.

### Testing
- `iteration_146.json`: **45/46 backend (98%) + 100% frontend.** 1 "miss" was a test-framework false positive on a frontend route. Zero issues.


## Recent Updates (May 2, 2026 — Help Center MEGA · Easter Eggs · Co-pilot · Konami)

### 📚 Help Center massively expanded (48 articles total, 12 categories)
- New `_help_seed_extended.py` — 42 additional articles seeded automatically:
  - **Module guides (23)**: Dashboard · Tickets · Clients & Health · Devices/RMM · Backup/Acronis · Huntress SOC · Hudu · CIPP/M365 · UniFi · Pax8 · War Rooms · Blueprints · QBR · Invoicing · Patch Hub · Time Tracking · Communications · Scheduling · Change Freezes · Notifications · Integrations Overview · Mobile Tech · Runbooks · Keyboard Shortcuts.
  - **Easter Eggs section (19)**: Overview · Konami CRT · Weather Mode · Threat Dragon · Friday Reel · Trading Cards · Mood Ring · Password Pet · Slow-Internet Detective · Device Graveyard · Family Tree · Brain Bucket · Daily Quests · Achievements · Storm Broadcast · All-Clear Broadcast · Launches · Birthday Radar · Tech of the Week. Each article documents the trigger, behaviour, exact file/function to tinker, and how to disable.

### 🤖 Help Co-pilot (Claude-powered "Ask anything")
- `POST /api/help/copilot` — keyword-scores articles, picks top 6 candidates, feeds them to Claude Sonnet 4.5 via `emergentintegrations` with strict-citation prompt. Returns `{answer, citations[{slug, title, category}], fallback}`.
- Frontend `<CopilotBar>` mounted above the Help sidebar — search box → answer card with markdown-rendered response + clickable citation chips.
- Live verified: question "How do I send an SMS reminder?" → cites `invoicing` + `communications` with step-by-step answer.

### 🖼️ Screenshot upload in Help editor
- `POST /api/help/upload-screenshot` — accepts base64 data URL (5 MB cap), saves to `UPLOADS_DIR/help/`, returns public `/api/uploads/help/{file}` URL.
- `<ScreenshotUploader>` in admin editor — file picker → upload → preview row + caption input + remove.

### 📑 Auto-TOC sidebar
- H2 headings post-rendered with `id="h-..."` anchors; `<ArticleTOC>` lists them at top of every article (hidden when <2 H2s). Click jumps to section.

### 🕹️ Konami code easter egg
- `KonamiCRT.jsx` — listens for `↑↑↓↓←→←→BA`. Activates a 30s green-phosphor scanline overlay + flicker + "RETRO MODE" badge. Esc to exit. Mounted globally in `AuthedAddons`.

### ⌨️ Keyboard Shortcut Palette
- `ShortcutPalette.jsx` — `Cmd/Ctrl+/` opens a searchable modal listing every bound shortcut (Global, Tickets, Chat, Easter Eggs). Mounted globally.

### 🧊 Change Freeze enforcement on chain reactions
- `power_features.sla_auto_page()` now consults `_is_frozen(client_id, kind="broadcast")` per ticket and skips paged tickets whose client is in an active freeze window. Other reactions can be added the same way.

### Testing
- `iteration_145.json`: **30/30 backend pass (100%) · 100% frontend pass**. Zero issues.


## Recent Updates (May 2, 2026 — All-Clear · Recharts cleanup · Change Freeze Calendar)

### ☀️ All-Clear Broadcast (companion to Stormy)
- New helper `_check_all_clear_broadcast()` in `chat_help.py`. Posts a `☀️ All clear` system message into `#general` with `@channel` ping when (a) a `storm_mood` message exists today, (b) current mood is `sunny` or `beach`, (c) no `storm_clear` already today. Idempotent.
- New endpoint `POST /api/chat/broadcast/all-clear-check`. Wired into the scheduler loop in `server.py` and into the unified `/chat/broadcast/tick` (now returns 4 keys: sentiment_posted, sla_posted, storm_posted, all_clear_posted).

### 🧹 Recharts ResponsiveContainer warnings suppressed
- `/app/frontend/src/index.js` adds a small `console.warn` filter that swallows the Recharts `width(-1)/height(-1)` cosmetic warning on chart mount/unmount transitions. Pre-existing P3 (recurring 6+ iterations) — non-functional.

### 🧊 Change Freeze Calendar (NEW)
- Backend `/app/backend/app/routers/change_freezes.py` — full CRUD on `db.change_freezes`:
  - `POST /api/change-freezes` — title + starts_at + ends_at required; client_id null = MSP-wide; kinds[] default ["patch","reboot","script","broadcast"]; reason; active toggle.
  - `GET /api/change-freezes` (supports `?client_id=` + `?active_only=true`) hydrates client_name. `/active` returns currently-active windows. `/check?client_id=&kind=` boolean used by other modules + scheduler.
  - `GET/PUT/DELETE /api/change-freezes/{id}` — get/update/delete.
  - Reusable `_is_frozen()` helper for other routers to import.
- Frontend `/app/frontend/src/pages/ChangeFreezePage.jsx` at `/change-freezes`:
  - 3-tile stat row (Active now / Upcoming / Total).
  - 'Show only currently active' switch filter.
  - Row cards with state badge (ACTIVE NOW · UPCOMING · ENDED · INACTIVE), client name, date range, kind chips, reason.
  - FreezeEditor dialog: title, client picker (incl. "All clients · MSP-wide"), datetime-local inputs for start/end, 5 kind chips (toggle), reason textarea, active switch.
- Linked in sidebar **Change & Incidents → Freeze Calendar**.

### Testing
- `iteration_144.json`: **29/29 backend pass (100%) · 100% frontend pass.** Zero issues.


## Recent Updates (May 2, 2026 — Help Center + Atmosphere + @channel Broadcast)

### 📚 Help Center Framework (NEW)
- New router `chat_help.py` — CRUD for `db.help_articles` with auto-seed of 6 default articles (Getting Started · Tickets · Command Center · Insights Hub · Chat & Presence · Tech Profile). Supports search via `?q=`, slug-based fetch, admin upsert with optional screenshots[].
- New page `/help` (also `/help/:slug`) — `HelpCenterPage.jsx` with searchable category sidebar, markdown article viewer (markdown-it), inline screenshot rendering, admin-only Edit/New/Re-seed buttons. Tactical-dark prose styling (zinc bg, violet links, IBM-Plex feel).
- Linked in sidebar under **Reports & Comms → Help Center**.

### 📢 @channel / @here / @everyone Chat Broadcast
- `chat_presence.send_message()` now detects `@channel`, `@here`, `@everyone` mentions and notifies every channel member (or all active users if channel has no explicit member list). Per-user mentions still work, no double-notify.
- Stamps `msg.broadcast=true` so frontend can style them differently later.
- Companion auto-broadcast hooks in `chat_help.py`: `POST /api/chat/broadcast/sentiment-escalating`, `/sla-page`, `/tick` — scan for new escalations/auto-pages and post idempotent system messages with `@channel` into `#general`.

### 🌌 Atmosphere Page (Phase 3 quirky bundle)
- New page `/atmosphere` (`AtmospherePage.jsx`) — 6-tab consolidation of all Phase 3 ambient features:
  - **Ambient** — weather-mode mood gradient banner (stormy/beach/rainy_monday/sunny/neutral) + open-critical/total/huntress/hour stats.
  - **Friday Reel** — 5-scene Claude storyboard + week stats + top critical wins.
  - **Threat Dragon** — security mood meter (kitten → raging dragon, sized by open Huntress alerts).
  - **Launches** — recent celebratory rocket events + manual "Fire a launch" button.
  - **Graveyard** — decommissioned device tombstones with auto-epitaphs and lifespan counts.
  - **Client Cards** — picker → 6 mini-cards: Trading Card (rarity), Mood Ring, Password Pet, Birthday Radar, Slow-Internet Detective (run-on-demand), Family Tree.
- All endpoints already lived in `quirky_features.py`; this page wires them up. Linked in sidebar under **Reports & Comms → Atmosphere**.
- Static MOOD_GRADIENT class map prevents Tailwind JIT from purging the gradient classes.

### Testing
- `iteration_143.json`: **31/31 backend pass (100%) · 100% frontend pass.**
- Only pre-existing Recharts width/height console warnings (P3) remain — tracked.


## Recent Updates (May 2, 2026 — War Room Auto-spawn + UI Consistency)

### 🚨 War Room Channel Auto-spawn
- When `POST /api/warroom` creates an incident, it now also auto-creates a private chat channel `warroom-{slug}` and posts a system message linking the ticket + severity + ETA. All paged techs (existing + creator) are auto-invited as members.
- Idempotent: re-creating doesn't duplicate the channel.
- Tested live — creating a war room now spawns a `warroom-{slug}` chat channel within the same request.

### 🎨 Tech Profile Page UI Consistency Pass
- Refactored `/me` and `/team/:id` to match the global page pattern used across Command Center / Insights Hub:
  - Standard kicker label (`text-[10px] uppercase tracking-widest text-violet-400`)
  - Standard h1 (`text-2xl font-semibold tracking-tight`)
  - Standard subtitle (`text-sm text-muted-foreground`)
  - Hero stats moved into a standard `Card` component (no more bespoke styled div)
  - Save button now uses the "Break button" outline style (`text-violet-400 border-violet-500/30 hover:bg-violet-500/10`)
  - Stat tiles match the colour-tinted-uppercase-label pattern from Command Center


## Recent Updates (May 2, 2026 — Chat + Presence + Gamification + Quirky Features)

### 💬 Internal Staff Chat with LED Presence (NEW)
- New router `chat_presence.py` — heartbeat (15-20s), presence with auto-LED computation, channels (team/dm), messages, mentions → notifications, slash commands (`/help`, `/assign`, `/page`, `/summarize` via Claude), unread counts, reactions.
- LED states: 🟢 active (pulse) · 🔴 busy (on-ticket auto-detected from URL) · 🟠 dnd · 🔵 break (pulse) · 🟡 away (pulse) · ⚫ offline.
- Frontend: floating ChatPanel widget global to authenticated app (Cmd/Ctrl+K shortcut), `usePresenceHeartbeat()` hook detects busy_state from URL automatically. PresenceDot reusable LED component.

### 🎮 Gamification Core (NEW)
- New router `quirky_features.py` — Achievements engine (15 badges, common/rare/epic/legendary rarity), Tech Profile (level + XP bar + skills radar), Daily Quests (3 random per user/day, persisted), Friday Wrap-up reel (Claude storyboard).
- New page `/me` and `/team/:id` (TechProfilePage) — header with LED avatar, level/XP bar, achievements grid, quests tab, private Brain Bucket (only visible to owner).

### ✨ 13 Quirky / Ambient Features (NEW)
- Trading Cards (legendary/epic/rare/common rarity with auto-tagline).
- Mood Ring (30-day sentiment colour: emerald → rose).
- Slow-Internet Detective (instant verdict: VPN bottleneck / Wi-Fi / ISP).
- Device Graveyard with auto-epitaphs.
- Device Family Tree (grouped by model+os).
- Brain Bucket (private scratchpad).
- Threat Dragon (size_pct + emoji based on Huntress alerts).
- Password Pet (per-client hygiene avatar).
- Birthday Radar (contacts + client anniversaries).
- Weather Mode (ambient gradient signal: stormy / beach / rainy_monday / sunny / neutral).
- Launch Events + Recent Launches (rocket-celebration triggers).

### Testing
- `iteration_142.json`: **37/37 backend pass · 100% frontend pass.**
- One LOW-priority cosmetic noted: chat button position vs Emergent badge — fixed by moving to `bottom-20 right-4`.


## Recent Updates (May 2, 2026 — Zero-touch Automation Scheduler)

### 🤖 Background scheduler live — chain reactions now fire automatically
- New helper `run_chain_reactions()` in `power_features.py` runs 5 reactions in one pass: Apology Queue scan · SLA Auto-page · Promise Reconcile · Patch Broadcast.
- New endpoints: `POST /api/ops/nightly-tick` (manual trigger), `GET /api/ops/tick-log` (history), `GET/PUT /api/ops/settings` (enable/disable + interval).
- Background loop `_chain_reactions_loop()` wired in `server.py` — polls settings doc `{type: 'ops_scheduler'}` each cycle, defaults to enabled + 15 min interval (configurable 5-60 min).
- Persists every tick to `db.ops_tick_log` with triggered_by, started_at, per-reaction result counts, errors, finished_at.
- **New Automation tab** on Command Center (/command-center) — Running/Paused status, Run now button, interval quick-switches (5/15/30/60 min), recent-ticks table.
- **Testing**: `iteration_141.json` — 12/12 backend · 100% frontend · scheduler auto-fires within 45 seconds of backend boot. Zero issues.


## Recent Updates (May 2, 2026 — 24-feature Power Compound Bundle)

### ⚡ Power Features — 24 compounding composites on top of Mega Bundle (iteration_140: 28/28 pass)

**Backend** — single new router `/app/backend/app/routers/power_features.py`:

**Chain reactions** (1-7): `POST /api/tickets/{id}/smart-assign`, `GET /tickets/{id}/doppelganger-resolution`, `POST /ai/apology-queue/scan`, `POST /sla-radar/auto-page`, `POST /payment-promises/reconcile`, `GET /team/{id}/rebalance-suggestions`, `POST /patches/anomalies/{kb}/pause-trmm`.

**Revenue amplifiers** (8-10): `GET /finance/unbilled-dollars`, `GET /finance/revenue-at-risk`, `GET /finance/pricing-compliance`.

**Unified screens** (11-13): `GET /command-center`, `GET /clients/{id}/dossier.pdf`, `GET /briefings/monday-prep`.

**Gamification** (14-15): `GET /team/leaderboard`, `GET /team/streaks`.

**Retention** (16-18): `GET /clients/{id}/monthly-recap`, `GET /clients/{id}/insurance-action-plan`, `GET /clients/{id}/pre-call-brief`.

**AI extensions** (19-21): `GET /team/{id}/daily-briefing`, `GET /tickets/{id}/scope-drift`, `POST /tickets/quality-audit`.

**Moonshots** (22-24): `GET /forecasting/capacity`, `GET /clients/{id}/benchmark`, `POST/GET /security/insurance-vault/schedule`.

**Frontend**:
- NEW `/command-center` page (`CommandCenterPage.jsx`) with 8 tabs — Right Now, Revenue at Risk, Unbilled Dollars, Pricing Compliance, Monday Prep, Leaderboard, Streaks, Capacity 90d. Linked in sidebar *Reports & Comms* group.
- Extended `TicketAIBundle.jsx` → 5 buttons (added Smart Assign, Suggest Resolution).
- Extended `ClientAIBundle.jsx` → 5 buttons (added Monthly Recap, Pre-call Brief, Insurance Plan, Dossier PDF).


## Recent Updates (May 2, 2026 — Proactive Alerts + Insurance PDF)

### 🚨 Patch Anomaly Broadcast
- `POST /api/patches/anomalies/broadcast` — scans for cross-tenant patch anomalies (3+ clients), de-dupes against `db.patch_broadcasts` so already-sent alerts aren't re-fired, dispatches Slack & Teams webhooks (reuses the TRMM notification settings doc), AND writes an in-app notification as always-on fallback.
- Only fires again if `affected_clients` grew since the last broadcast.
- Button wired on Insights Hub → Patch Anomalies tab.

### 📄 Cyber Insurance Vault PDF
- `GET /api/security/insurance-vault.pdf[?client_id=…]` — branded FPDF evidence pack (score, tier, control coverage bars, last restore drill, attestation footer). Safe for forwarding directly to insurers.
- Snapshot metadata persisted to `db.insurance_vault_snapshots` for audit trail.
- Download button wired on Insights Hub → Insurance Vault tab.

### Testing
- `iteration_139.json`: **10/10 backend tests PASS · 100% frontend pass**.


## Recent Updates (May 2, 2026 — 21-feature Mega Bundle SHIPPED)

### 🚀 21 differentiator features in one drop — 100% test pass (iteration_138)

**Backend** — single new router `/app/backend/app/routers/mega_features.py` with all 21 endpoints (auto-discovered).

| # | Feature | Endpoint |
|---|---------|----------|
| 1 | Ticket Doppelgänger | `GET /api/tickets/{id}/doppelganger` |
| 2 | Ticket Time Machine | `GET /api/tickets/{id}/timeline` |
| 3 | Auto-Apology Composer | `POST /api/tickets/{id}/apology-draft` |
| 4 | Tech Cognitive Load | `GET /api/team/cognitive-load` |
| 5 | Client DNA Profile | `GET /api/clients/{id}/dna` |
| 6 | LTV Forecast | `GET /api/clients/{id}/ltv-forecast` |
| 7 | Client Anniversary AI | `GET /api/clients/{id}/anniversary-draft` |
| 8 | Pre-Billing AI Auditor | `POST /api/invoices/{id}/audit` |
| 9 | Smart Reminder Cadence | `GET /api/invoices/{id}/reminder-strategy` |
| 10 | Aged AR Heatmap | `GET /api/aged-ar-heatmap` |
| 11 | Estimate Win Probability | `GET /api/estimates/{id}/win-probability` |
| 12 | Competitive Pricing Flags | `GET /api/estimates/{id}/pricing-flags` |
| 13 | Device Health Trajectory | `GET /api/device-health-trajectory` |
| 14 | Patch Anomaly Detector (cross-tenant) | `GET /api/patches/anomalies` |
| 15 | Battery Health Wall | `GET /api/device-battery-wall` |
| 16 | Restore Drill Scheduler | `POST/GET/PUT /api/backup/drills` |
| 17 | Cyber Insurance Vault | `GET /api/security/insurance-vault` |
| 18 | Skills XP Bank | `GET /api/team/xp` |
| 19 | 1:1 Auto-Agenda | `GET /api/team/{tech_id}/1on1-agenda` |
| 20 | MSP Voice Morning Brief | `POST /api/voice/morning-brief` |
| 21 | Run-Book Marketplace | `POST /api/runbooks/from-ticket/{id}` · `GET /api/runbooks` |

**Frontend** — consolidated wiring:
- **NEW page** `/insights` (`InsightsHubPage.jsx`) — 9-tab dashboard for the aggregate views (Tech Load · Patch Anomalies · Device Trajectory · Battery Wall · Aged AR · Skills XP · Insurance Vault · Voice Brief · Runbooks). Linked from sidebar under *Reports & Comms*.
- `TicketAIBundle.jsx` mounted on Ticket detail header — Doppelgänger / Apology AI / To Runbook buttons.
- `TicketTimelineTab.jsx` — new "Time Machine" tab on every ticket.
- `ClientAIBundle.jsx` — DNA + LTV cards + Anniversary AI button on a new "AI Insights" client tab.
- `InvoiceAIBundle.jsx` — Pre-bill Audit + Smart Reminder buttons on Invoice detail header.
- `EstimateAIBundle.jsx` — Win Probability + Pricing Flags panel on Estimate detail.

**Routing collisions fixed**: `/devices/health-trajectory` and `/devices/battery-wall` were caught by `/devices/{id}` dynamic route → renamed to `/device-health-trajectory`, `/device-battery-wall`. Same for `/aged-ar-heatmap`.

**Testing**: `iteration_138.json` — 22/22 backend tests pass · 100% frontend pass · zero issues.


## Recent Updates (May 1, 2026 — Revenue Protection AI Bundle SHIPPED)

### 💸 Revenue Protection AI — All 5 features live
- **Backend `/app/backend/app/routers/diff_features.py`** (already shipped in prior fork):
  - `GET /api/sla-radar` — scores every open ticket by SLA-window usage + inactivity and flags danger zone.
  - `GET /api/tickets/{id}/sentiment` — Claude scores conversation trajectory (improving / flat / worsening / escalating) with reasoning.
  - `POST /api/invoices/{id}/promises` · `GET /api/payment-promises` · `PUT /api/payment-promises/{id}` — LLM extracts spoken/written payment-promise dates, auto-flags broken promises.
  - `POST /api/estimates/{id}/followup-draft` — AI drafts a subject+body email tailored to the most likely objection (price/scope/timing).
  - `GET /api/invoices/{id}/explainer` — plain-English, client-safe summary of what the invoice covers.
- **Frontend wiring completed in this session**:
  - `SLARadarTile.jsx` mounted on Dashboard (above Blueprints/Churn grid).
  - `SentimentBadge.jsx` mounted in Ticket detail header toolbar next to "Why on fire".
  - `PaymentPromiseButton.jsx` mounted on Invoice detail header (shown when balance > 0).
  - `InvoiceExplainerButton.jsx` **(NEW)** — mounted on Invoice detail header; dialog with copy-to-clipboard.
  - `EstimateFollowupButton.jsx` **(NEW)** — mounted on Estimate detail header for non-draft, non-approved estimates.
- **Testing**: `iteration_137.json` — 100% backend + 100% frontend pass. Pytest suite at `/app/backend/tests/test_revenue_protection_ai.py`. Only noise: pre-existing Recharts console warnings (tracked P3).



## Recent Updates (May 1, 2026 — Escalation Ladder + Blueprints + Time-aware Standups)

### 🚨 War Room Paging with Escalation Ladder
- **Backend `/app/backend/app/routers/warroom.py`** (appended):
  - `POST /api/warroom/{id}/page` — body `{tech_ids, channels?, auto_escalate?, grace_minutes?}`. When `auto_escalate=true`, only Tier-1 techs fire immediately; Tier-2/3 stay `pending` with `next_escalation_at` set.
  - `GET /api/warroom/page/ack/{token}` — **no auth**, HTML response. Magic-link the tech gets via SMS/Slack/email. Clears `next_escalation_at`, adds participant, idempotent.
  - `POST /api/warroom/{id}/page/{page_id}/resend` — re-dispatches a specific page.
  - Channels: Slack webhook, Teams webhook, SMS via MobileMessage, Email (queues notification), In-app push (creates notification doc). Missing channel configs return `no_webhook`/`no_config` markers — paging never blocks.
  - `warroom_escalation_tick()` promotes tier 1→2→3 every grace period. Wired into `server.py` as `_warroom_escalation_loop` background task (30s cadence).
- **Tech Roster `/app/backend/app/routers/tech_roster.py` (NEW)** — `db.tech_roster` CRUD; escalation_tier 1/2/3, preferred_channels, on_call flag, active flag.
- **Frontend** — `WarRoomPage.jsx` gains `PageTeamDialog` (grouped by tier, channel chips, auto-escalate switch + grace input) and **Escalation Ladder** sidebar card showing per-page status (pending/sent/ack) with T1/T2/T3 badges + "Next: 2m" countdown. New `TechRosterPage.jsx` at `/tech-roster` with tier columns + table editor.

### 🎫 Ticket Blueprints (Syncro worksheet-killer)
- **Backend `/app/backend/app/routers/blueprints.py` (NEW)**:
  - Full CRUD `/api/blueprints` with name, description, default_priority/category/status/sla_minutes, `require_completion` gate, typed `fields[]` (text/textarea/number/date/select/checkbox) + `checklist[]`.
  - `GET/PUT /api/clients/{id}/blueprints` — assign blueprints to a client with a default.
  - `POST /api/tickets/{id}/apply-blueprint`, `PUT /api/tickets/{id}/blueprint-fields`, `POST /api/tickets/{id}/blueprint-checklist/{item_id}/toggle` (adds done_by/done_at).
  - **Auto-apply**: on ticket create (`routers/tickets.py`), if the client has `default_blueprint_id`, blueprint gets hydrated into the ticket (fields, checklist, defaults).
  - **Resolve gate**: `PUT /api/tickets/{id}` with `status=resolved|closed` returns 400 listing missing checklist items + required fields when `blueprint_require_completion=true`.
- **Frontend**: `BlueprintsPage.jsx` at `/blueprints` with field+checklist builder (auto-slug keys, req toggles, select options). New Blueprint **tab** on ticket detail backed by `TicketBlueprintPanel.jsx` (empty-state picker → worksheet with progress %, inline saves, per-item checklist toggle). New **Blueprints tab** on Client detail for assignment + "★ Default" picker. Blueprint badge appears in ticket top toolbar in break-button sky style.

### 🌅🌤️🌙 Time-aware Standups
- **Backend `/app/backend/app/routers/ai_wave_a.py`** — `_slot_for_hour()` returns morning (5-11), afternoon (12-16), evening (17+) with slot-specific AI system prompt + default lookback window. Standup digest endpoint now accepts `slot` and `hour_override` params and returns `slot`, `slot_label`, `slot_icon` in response.
- **Frontend `StandupDigestBanner.jsx`** — rotates Sunrise/Sun/Moon icon and label ("Morning Standup" / "Midday Pulse" / "End-of-Day Wrap") automatically. Ticket-number regex extended to match `INC-1234` and `#INC-1234` so ticket refs hyperlink to `/tickets?ticket=...`.

### Testing
- `iteration_131.json`: **29/29 backend tests PASS · 100% frontend UI pass**. Zero blocking issues.

### AI-suggested Blueprints (May 1, 2026 · follow-up)
- **Backend** `POST /api/blueprints/suggest-from-history` — scans the client's resolved/closed tickets (string-scored by title overlap when a `title_hint` is supplied, otherwise the most recent 15), feeds them to Claude Sonnet 4.5 as a corpus, and returns a STRICT-JSON draft blueprint (name, priority, category, sla_minutes, fields[], checklist[], require_completion). Requires ≥2 matching resolved tickets.
- **Frontend** — `TicketBlueprintPanel` empty state gets a "Suggest from history" button (violet break-button style). Opens `SuggestDialog` showing the learned-from ticket refs, editable name/description, and the proposed fields + checklist. "Save & Apply" persists as a new blueprint and applies it to the current ticket in one shot.
- Smoke-tested: Claude generated a correct "New User Onboarding" blueprint (6 fields incl. a Select, 8 required checklist items, `require_completion=true`) from 2 source tickets.

### Cross-client Blueprint Pattern Library (May 1, 2026 · follow-up 2)
- **Backend** `GET /api/blueprint-patterns` — bigram clustering over ALL resolved/closed tickets across every client. Returns top patterns with `ticket_count`, `client_count`, `sample_titles`, `sample_ticket_ids`, `affected_client_ids`, `related_blueprints` and collapses bigrams whose ticket pool overlaps >60%.
- **Backend** `POST /api/blueprint-patterns/suggest` — feeds the cross-client corpus to Claude 4.5 with a tenant-agnostic prompt → returns a shared-blueprint draft.
- **Backend** `POST /api/blueprints/{bp_id}/push-to-clients` — bulk-assigns blueprint to N clients at once, with optional `make_default` flag.
- **Frontend** — `/blueprints` splits into **Library** and **Pattern Discovery** tabs. Pattern cards show name guess, tokens, ticket/client counts, top category, sample titles. "Generate Blueprint" button → AI dialog with editable draft + two switches: **Push to all N clients** (on by default) and **Also set as default**.
- **Bug fix**: `push-to-clients` was only updating 1 client because `{}` is falsy in Python; now uses `client is None` guard + matched_count. Fixed the endpoint path mismatch caught by the testing agent (`/blueprint-patterns` instead of `/blueprints/patterns` to avoid shadowing `/blueprints/{bp_id}`).
- Smoke-tested: Claude 4.5 generated "VPN Configuration & Troubleshooting" blueprint with 5 fields (incl. 2 Select dropdowns) and 8 production-grade checklist items from 2 cross-client VPN tickets. Push endpoint now correctly updates all 4 clients.
- **Testing**: `iteration_132.json` — 17/17 backend tests PASS · 100% frontend UI pass.

### Blueprint Insights — Dashboard tile (May 1, 2026 · follow-up 3)
- **Backend** `GET /api/blueprint-patterns/trends?days=7` — compares this-window vs previous-window resolved tickets, returns top 3 rising patterns with `is_new` flag (prev=0) and `delta` for surges. Falls back to `updated_at` when `resolved_at` is null. `score = (this*1.5 if is_new else delta) + this*0.5`.
- **Frontend** `BlueprintInsightsTile.jsx` mounted on the Dashboard right after the standup banner. Each rising pattern shows a NEW badge (rose) or "+N vs last wk" badge (amber), ticket/client counts, sample title, and a "Draft" button that deep-links to `/blueprints?pattern={key}&t=tok1,tok2`.
- **Auto-open flow**: landing on `/blueprints` with `?pattern&?t` URL params auto-selects the Pattern Discovery tab and auto-opens the suggest dialog for the matching pattern; URL params are cleared on consume. Pattern panel `min_tickets` default lowered from 3 → 2 so deep-links from the dashboard tile reliably resolve.
- **Testing**: `iteration_133.json` — 21/21 backend tests PASS · 100% frontend UI pass. Zero blockers.

### QBR Auto-Generator (May 1, 2026 · follow-up 4)
- **Backend** `/app/backend/app/routers/qbr.py` (NEW):
  - `GET /api/qbr/{client_id}?quarter=YYYY-QN` — aggregates per-client tickets (volume, priority, top categories, SLA breaches, resolved count), device health, backup health, critical alerts, quarter spend, plus **cross-client pattern hits** that affected this client (bridges `blueprints._bigrams/_tokens`). Calls Claude Sonnet 4.5 to draft 7 sections: executive_summary, key_wins, incident_breakdown (with sla_assessment), infrastructure_health, risks_and_recommendations, **msp_intelligence**, next_quarter_focus. Defaults to most recently completed quarter when no param.
  - `POST /api/qbr/{client_id}/save` — persists draft + edits to `db.qbrs`.
  - `GET /api/qbr/{client_id}/list` — past QBRs for client.
  - `GET /api/qbrs/{qbr_id}` — full QBR.
  - `GET /api/qbrs/{qbr_id}/pdf?token=...` — branded PDF using fpdf with `_safe()` unicode sanitizer (latin-1 compat) and explicit margins to avoid horizontal-space errors. Cover header in MSP brand color, KPI summary, all sections + risks/recommendations, MSP intelligence with pattern hit bullets.
- **Frontend** `/app/frontend/src/pages/QBRPage.jsx` (NEW): client + quarter selectors, "Generate QBR" button (Claude takes 30-60s), KPI strip (5 cards: Tickets, Critical, Devices, SLA, Spend), 6 editable section cards with bullet builders, MSP Intelligence card showing pattern hits each linking to `/blueprints?pattern=...&t=...` for one-click cross-client blueprint generation, sticky Save + Download PDF footer, recent QBR history list.
- **Routing/Nav**: `/qbr` route added; "QBRs" nav item under Business section between Revenue Growth and War Rooms.
- **Testing**: `iteration_134.json` — 23/23 backend tests PASS · 100% frontend UI pass. Zero blockers. Generated valid 6.4KB PDF starting with `%PDF-1.3` header.

### Big differentiator drop (May 1, 2026 · iteration 135) — six new features in one batch
1. **Invoice PDF Template Builder** (`/app/backend/app/routers/invoice_pdf_templates.py`, `/app/frontend/src/pages/InvoiceTemplatesPage.jsx`):
   - CRUD `/api/invoice-templates` with 12 toggleable, reorderable blocks (logo, company_info, bill_to, invoice_meta, line_items, totals, payment_terms, notes, bank_details, qr_pay, thank_you, footer).
   - Inline editable copy with merge tags (`{{invoice_number}}`, `{{client_name}}`, `{{due_date}}`, `{{total}}`, `{{terms_days}}`, `{{bank_name}}`, etc).
   - 4 base layouts (classic/minimal/bold/executive), 3 densities, custom hex primary colour.
   - Live PDF preview iframe via GET `/preview-pdf?token=...`. Per-doc default + per-invoice template override (`/api/invoices/{id}/pdf-with-template?template_id=...`).
2. **AI "Why on fire?"** (`/api/ai/why-on-fire/{entity_type}/{entity_id}`): aggregates last-24h notes/alerts/tickets/devices for a ticket/device/client and asks Claude Sonnet 4.5 for diagnosis/severity/likely_root_cause/3 next steps/confidence. Wired as a rose break-button on ticket detail; opens `WhyOnFireButton` dialog.
3. **Auto-Quote from Conversation** (`POST /api/tickets/{id}/auto-quote`): reads ticket + notes + product catalog → Claude returns a draft quote with line_items, subtotal, tax, total, confidence, notes_for_tech. Wired as "Quote It" emerald break-button on ticket detail.
4. **Walk-in Kiosk** (`/app/backend/app/routers/kiosk.py`, `/app/frontend/src/pages/KioskPage.jsx`): zero-auth tablet UI at `/kiosk/:token`. Admin registers a kiosk, gets a long-lived token; clients identify by email (rate-limited 5/min) → see open tickets, approve estimates one-tap, click pay-link on invoices.
5. **Threat Radar Ticker** (`/api/threat-radar` + `ThreatRadarTicker.jsx`): scrolling marquee on the dashboard pulling Huntress (`threat_events`, `identity_threats`), critical alerts, and live cross-client ticket patterns. Hidden when no items.
6. **Client Health Certificate PDF** (`/api/clients/{id}/health-certificate.pdf?token=`): branded landscape A4 cert with score, grade, dimensions, cert ID. ★ Certificate button next to the Health Dial on client detail.
- **Testing**: `iteration_135.json` — **33/35 backend (94%) · 100% frontend**. The 2 minor items (entity_type missing on quiet-period response; warroom path collision in test) fixed in this round.

### Four more differentiators (May 1, 2026 · iteration 136)
1. **Client Churn Risk Score** — `/api/clients/{id}/churn-risk` returns 0-100 score + band + drivers (rising volume, SLA breaches, overdue invoices, offline devices, critical open tickets) + plain-English save actions. `/api/churn-risk/overview` ranks all clients. **ChurnRiskTile** mounted on dashboard next to BlueprintInsightsTile showing top at-risk clients.
2. **Invoice DisputeShield PDF** — `/api/invoices/{id}/dispute-shield.pdf` auto-assembles a branded evidence packet: every ticket worked in the billing window, time entries with tech names, approved estimates, defence conclusion. One-click button on invoice detail (amber break-button).
3. **Auto-Incident Postmortem** — `POST /api/warroom/{id}/postmortem` (400 unless resolved) → Claude drafts summary/timeline/root-cause/impact/what-went-well/what-went-poorly/action_items. Persists to `db.postmortems` and stamps the war room. **Generate Postmortem** button appears on resolved war rooms (sky break-button).
4. **Client Whisper Mode** — `/api/whisper/contact?email=X` returns rich VIP context (role/is_vip/birthday/preferred_drink/notes + recent tickets + finance + churn score + escalations + preferred tech). **WhisperRail** renders above CoPilotPanel on ticket detail when `requester_email` is set; VIPs get amber Crown + border.
- **Testing**: `iteration_136.json` — **15/15 real backend tests PASS · 100% frontend**.



## Recent Updates (May 1, 2026 — Live Incident War Room)
One URL that becomes the shared battle-station when a P1 fires.
- **Backend `/app/backend/app/routers/warroom.py`** — 7 endpoints:
  - `POST /api/warroom` (title required, auto-generates `public_slug` via `secrets.token_urlsafe(8)`, resolves `client_name` + auto-populates `similar_incidents` by string-matching past resolved tickets, writes opening system message).
  - `GET /api/warroom?include_resolved=false` — excludes resolved by default.
  - `GET /api/warroom/{id}` — hydrates `affected_devices` with live status.
  - `POST /api/warroom/{id}/messages` — chat, auto-adds participant if new.
  - `POST /api/warroom/{id}/status` — update status/eta/summary, writes system messages on change, 400 on invalid status.
  - `POST /api/warroom/{id}/resolve` — sets `resolved_at`, `resolved_notes`, system message.
  - `GET /api/warroom/public/{slug}` — **no auth**; returns reduced payload; filters messages to only `system`/`status` kinds (internal chat hidden).
- **Frontend** — `WarRoomPage.jsx` (list with KPIs + create dialog + 3-col detail view: ETA/status/participants/public URL + live tech chat (4s polling) + similar-incidents sidebar + affected devices) and `WarRoomPublicPage.jsx` (zero-auth client status page, 15s polling, timeline only).
- **Routing** (`config/routes.js`) — `/warroom` (auth + layout), `/warroom/:id` (auth, no layout), `/warroom/public/:slug` (auth:false). Added to Service Desk nav.
- **DB model** `db.war_rooms` — `{id, public_slug, title, severity, status, summary, eta, ticket_id, client_id, client_name, affected_device_ids, participants[], messages[], similar_incidents[], created_*, resolved_*}`.
- **Testing** (`iteration_130.json`): 28/28 backend tests PASS, 100% frontend UI pass. Zero issues.


## Recent Updates (Apr 23, 2026 — UniFi Site Manager Command Center + Production Deployment Fix)

### Production deployment fix
- `server.py`: added unprefixed `GET /health` (and `GET /api/health`) returning 200 with no DB calls so K8s readiness probe passes.
- Moved `seed_data()` + ticket-number backfill out of `@app.on_event("startup")` into a background `_boot_warmup()` task so uvicorn reports startup complete in <1s on cold Atlas boots. This unblocks production deployment timeouts.

### UniFi Site Manager integration (api.ui.com, hosted)
- **Backend `/app/backend/app/routers/unifi.py`** — full router using `X-API-KEY` auth:
  - Settings: `GET/POST/DELETE /api/unifi/settings`, `GET /api/unifi/status`, `GET /api/unifi/test`.
  - Data: `/unifi/hosts`, `/unifi/sites`, `/unifi/sites/{id}/devices`, `/unifi/sites/{id}/clients`, `/unifi/sites/{id}/alerts`, `/unifi/sites/{id}/networks`, `/unifi/sites/{id}/events`.
  - Dashboard: `/unifi/summary` aggregates devices/clients/alerts across all sites.
  - Link to client: `POST/DELETE /api/clients/{id}/link-unifi-site`, `GET /api/unifi/linked-clients`.
  - Robust normalization helpers tolerate UniFi response-shape variations (data/sites/hosts/items keys + state→online/offline).
- **Frontend `/app/frontend/src/pages/UnifiCommandCenterPage.jsx`** at `/unifi`:
  - 5-metric strip (Sites · Devices online/total · Clients · Alerts · Linked %).
  - Tabs: Sites (master-detail with site list + sub-tabs Devices/Clients/SSIDs/Alerts) · Linked Clients.
  - Per-site detail: device table (model, status, IP, uptime, firmware, client-count), client table (wired/wifi badges, signal, RX/TX), SSID table, alerts feed.
  - "Link to client" dialog from any site.
- **Settings** — UniFi card with Base URL + API key (default `https://api.ui.com/ea`), Save/Test/Remove flow, masked key preview, last test/sync timestamps.
- **Navigation** — Sidebar Integrations group now includes UniFi (`/unifi`).
- **Testing** (`iteration_120.json`): 32/32 backend tests PASS, 100% frontend pass. Zero issues.



## Recent Updates (Apr 23, 2026 — CIPP Hygiene → Client Health Score + Weekly M365 Hygiene Digest)
- **Backend `/app/backend/app/routers/cipp_hygiene.py`** — 7-dimension hygiene scoring per M365 tenant:
  - Dimensions: License efficiency (20), MFA coverage (25), Stale users (15), License waste (15), Admin sprawl (10), Guest posture (10), Modern auth CA (5). Each dimension gracefully degrades when CIPP source data is missing.
  - `GET /api/cipp/tenants/{id}/hygiene?force=true` — live compute with 6h cache in `db.cipp_hygiene_cache`.
  - `GET /api/clients/{id}/cipp-hygiene` — per-client hygiene via linked tenant.
  - `GET /api/cipp/hygiene-digest` — aggregate across every linked client + upsell_candidates list (clients with license waste / unlicensed / weak MFA).
  - `POST /api/cipp/hygiene-digest/send` — HTML email digest via Resend (if configured), falls back to admin email. Persisted to `db.cipp_digests`.
  - `GET /api/cipp/digests` — digest history.
- **Backend `client_health.py` + `clients.py`** — client Health Score now factors in M365 hygiene at **10% weight** when a CIPP tenant is linked AND hygiene is cached. Composite rebalances: security 10→5 + engagement 10→5 (or devices 20→15 + contracts 10→5 for the simple breakdown) to keep total at 100. Hygiene top risks merged into `risk_factors`.
- **Frontend CIPP Command Center** — new **Hygiene Digest** tab:
  - 4-tile metrics (Avg Score · Tenants · Critical &lt;50 · Upsell candidates).
  - "Upsell opportunities" card highlighting tenants with license/MFA risks as Security Posture bundle candidates.
  - All-tenants table with score/grade/active-users/MFA%/top-risks.
  - "Send digest" + "Recompute" buttons. Digest history table.
- **Frontend Client detail** — M365/CIPP tab now shows an **M365 Hygiene** card (only when linked):
  - Large score dial + 7-dimension breakdown bars.
  - Top risks list with impact scores.
  - Amber upsell callout when score &lt;70.
  - "Recompute" button for force refresh.
- **Client Overview Health breakdown** — automatically adds a **M365** bar when the linked client has a cached hygiene score.
- **Testing**: `/app/test_reports/iteration_119.json` — 18/18 backend tests PASS, 100% frontend. Zero issues.



## Recent Updates (Apr 23, 2026 — CIPP M365 Tenant Management + Suped Command Center)
- **Backend `/app/backend/app/routers/cipp.py`** — full CIPP integration against hosted CIPP Azure Function URLs:
  - Settings: `GET/POST/DELETE /api/cipp/settings`, `GET /api/cipp/status`, `GET /api/cipp/test`.
  - Tenant ops: `GET /api/cipp/tenants`, `/tenants/{id}/users`, `/tenants/{id}/licenses`.
  - User ops: `POST /api/cipp/tenants/{id}/users` (create), `/assign-license`, `/reset-password`, `/block-signin`, `/offboard`.
  - Dashboard: `GET /api/cipp/summary` (tenant + linked-client + coverage stats), `GET /api/cipp/linked-clients`.
  - Client linking: `POST/DELETE /api/clients/{id}/link-cipp-tenant` + `/link-suped-tenant`.
  - Uses `x-functions-key` + `Authorization: Bearer` headers for compatibility. Every write audited to `db.cipp_actions`.
- **Frontend `/app/frontend/src/pages/CippCommandCenterPage.jsx`** at `/cipp`:
  - 4-tile MetricStrip (Tenants · Linked Clients · Coverage · Actions).
  - 3 Tabs: Tenants (left list, right detail with users table + SKU chips), Linked Clients, Audit log.
  - Full action dialogs: Create M365 user (with license picker), Manage licenses (add/remove), Reset password (prompt), Block/Unblock sign-in, Offboard (checkbox options + OOO/forward), Link tenant → client.
- **Frontend `/app/frontend/src/pages/SupedCommandCenterPage.jsx`** at `/suped`:
  - 5-tile MetricStrip (Overall Score · Fully Protected · Partial · Unprotected · Clients).
  - 3 Tabs: Overview (service coverage grid + at-risk clients table), All clients (full matrix with service check columns), DMARC records (per-client record pull with summary stats).
  - Manage subscriptions dialog per client (Suped Org ID + service toggles).
- **Settings** — CIPP settings card (`cipp-settings-card`) with Base URL + API Key inputs, Save/Test/Remove flow, status badge, masked key preview. Mirrors Huntress pattern.
- **Clients page** — new `M365 / CIPP` tab in client detail pane. When unlinked: `Link tenant` CTA opens dialog listing all CIPP tenants. When linked: tenant header + stats + users table with per-row actions (Licenses, Reset pw, Block/Unblock, Offboard).
- **Navigation** — Sidebar Integrations group now includes CIPP + Suped entries.
- **Testing**: `/app/test_reports/iteration_118.json` — 28/28 backend tests PASS, 100% frontend pass. Zero issues. All data-testids present.


## Recent Updates (Apr 20, 2026 — Unified Integrations Overview)
- **Backend**: `/app/backend/app/routers/integrations_overview.py` — new `/api/integrations-overview` endpoint aggregating status of 12 integrations (Huntress, Hudu, Acronis, Pax8, Domotz, Stripe, Xero, Resend, MobileMessage SMS, Splynx, Syncro, Suped DMARC). Returns `{total, configured_count, coverage_pct, tiles[]}`.
- **Frontend**: `/app/frontend/src/pages/IntegrationsOverviewPage.jsx` at `/integrations`:
  - 4-tile MetricStrip (Total · Connected · Unconfigured · Coverage %).
  - Search + filter chips (All / Configured / Unconfigured).
  - Responsive tile grid (1→2→3→4 cols). Each tile shows category-toned icon, connected/unconfigured badge, last-synced stamp (with amber "stale" marker when >24h old), last-test status, and `Open Command Center` + `Configure` CTAs deep-linking correctly.
  - Linked in sidebar under **Platform → Integrations → Overview**.
- **Testing**: `/app/test_reports/iteration_117.json` — 100% backend + frontend pass. Testing agent fixed missing `last_test_status` key on 8 tile shapes.

## Recent Updates (Apr 20, 2026 — Hudu Command Center Page)
- **New `/hudu` route** — full Hudu Command Center page at `/app/frontend/src/pages/HuduCommandCenterPage.jsx`:
  - 6-tile MetricStrip (Companies · Articles · Assets · Procedures · Websites · Passwords) fed by `/api/hudu/summary`.
  - Filter bar with search + company dropdown + Apply/Clear.
  - 6 Tabs: Articles, Procedures, Passwords, Assets, Websites, Companies — each with tailored table/list view.
  - Article/Procedure list rows open a viewer dialog with rendered Hudu HTML content.
  - Passwords tab renders with a Reveal button — opens a dialog with show/hide toggle, copy button, and audit-log warning. Every reveal writes to `db.hudu_password_reveals`.
  - Not-configured state shows a Configure button deep-linking to Settings.
- Registered route + sidebar link under **Platform → Integrations → Hudu**.
- **Fix**: Rewrote `MetricStrip` to use concrete Tailwind class names (`lg:grid-cols-6` etc) instead of dynamic string interpolation — the previous version was silently broken by Tailwind JIT purge. All MetricStrip pages (Dashboard, Devices, Assets, Contracts, Huntress, Shadow IT, etc.) will now reliably show their intended columns at lg breakpoint.
- **Testing**: `/app/test_reports/iteration_116.json` — 100% frontend pass, no regressions.

## Recent Updates (Apr 20, 2026 — Hudu Feature-Rich Revamp + AI KB Suggestions)
- **Fully rewrote `/app/backend/app/routers/hudu.py`**:
  - New resource endpoints: `/api/hudu/{companies,articles,articles/{id},assets,asset-layouts,websites,procedures,passwords,passwords/{id}}` — read-through to Hudu API v1 with proper `search`/`name` query parameters.
  - Passwords redacted in list, decrypted on-demand per-ID with audit log in `db.hudu_password_reveals`.
  - `GET /api/hudu/search?q=` — fan-out across articles + assets + procedures + websites + passwords.
  - `GET /api/hudu/summary` — dashboard roll-up with counts + recent articles.
  - `POST /api/hudu/suggest-for-ticket` — derives 3-6 keywords from ticket title+description (stopword-filtered), queries Hudu, and ranks top picks via Claude Sonnet 4.5 with concrete fix steps. Audit log in `db.hudu_suggestions`.
  - Graceful error handling: connection errors → 503, timeouts → 504, 403 from Hudu → returns empty list (plan-limited endpoints), zero 500s.
- **Frontend**: New `<HuduSuggestionsPanel />` mounted in TicketsPage detail view below the description card. Auto-runs on open, shows hit count badge, AI picks with fix bullets + Copy button, full article viewer dialog.
- **Testing**: `/app/test_reports/iteration_115.json` — 41/41 backend + 100% frontend pass. Testing agent fixed a minor 500 in `_hudu_get` (now returns 503/504 on connection/timeout errors).

## Recent Updates (Apr 20, 2026 — Huntress Response Timeline + Identity Threats Wiring)
- **New `<ResponseTimeline />` component** (`/app/frontend/src/components/security/ResponseTimeline.jsx`) — reads `GET /api/huntress/actions`, renders a chronological audit trail of every incident action attempted (close, resolve, assign, comment, acknowledge, isolate, release) with accepted/rejected badges, rejection message, and user + timestamp. Mounted on the SOC Dashboard right column.
- **IdentityThreatPage** (`/app/frontend/src/pages/IdentityThreatPage.jsx`) — now parallel-fetches `/api/soc/identity-threats` AND `/api/huntress/incident-reports`. Filters Huntress incidents by identity-category keywords (identity, credential, impossible_travel, brute_force, mfa_fatigue, token_theft, password_spray, privilege_escalation, etc), normalises them to the existing row shape, merges them in, and flags each with an orange `HNT` badge. Shows a `Huntress Live` badge in the header when merging real data.
- **Testing**: `/app/test_reports/iteration_114.json` — 16/16 backend + 100% frontend pass. Real Huntress data observed: 123 identity rows merged, 118 HNT badges rendered, 10 response-timeline rows.

## Recent Updates (Apr 20, 2026 — Huntress Incident Response + Live Wiring)
- **Incident Response endpoints** (best-effort against Huntress write APIs; graceful fallback when plan doesn't expose them):
  - `POST /api/huntress/incident-reports/{id}/action` (actions: close, resolve, assign, comment, acknowledge)
  - `POST /api/huntress/agents/{id}/isolate`, `/release`
  - `_try_paths` helper probes multiple candidate paths per action, returns first 2xx or structured rejection with `hint`.
  - All attempts persisted to `db.huntress_actions` for audit.
  - `GET /api/huntress/actions` — audit log.
- **SOC Dashboard** — each Huntress incident row now has a `...` menu (Acknowledge · Add comment · Assign · Isolate agent · Release agent · Close incident) → opens a response dialog with note textarea + assignee field when relevant. Fallback toast when Huntress rejects the attempt.
- **Endpoint Security page** — merges live Huntress agents with the SOC demo endpoints when configured. Isolate/Release actions on Huntress-source rows route through the Huntress API.
- **SOC Feed page** — merges Huntress `incident_reports` into the alert feed when configured. Isolate button routes to Huntress for Huntress-source alerts.
- **Testing**: `/app/test_reports/iteration_113.json` — 24/24 backend + 100% frontend pass. All graceful-rejection paths validated.

## Recent Updates (Apr 20, 2026 — SOC Dashboard Huntress-First Revamp)
- Rewrote `/app/frontend/src/pages/SecurityDashboardPage.jsx` to be Huntress-led:
  - Top MetricStrip (Agents, Offline, Critical, Open, Signals, Orgs) driven by live `/api/huntress/summary` when configured, falls back to `/api/soc/dashboard` demo data when not.
  - Threat Level Banner, Endpoint Health progress, Incidents table (live Huntress or demo).
  - Side panels: Severity Mix chart, Top Organizations breakdown (per-org agents/incidents), Recent Signals.
  - Secondary telemetry cards for Vulns, Dark Web, Identity, Compliance — unchanged.
  - Quick-nav chips to all other security surfaces (Endpoint, Shadow IT, Vuln Scanner, Dark Web, Phishing Sim, Identity, Ransomware, MFA).
  - Not-configured state: big orange CTA card deep-linking to Huntress settings.
- Extended `/api/huntress/summary` to return `per_org`, `severity_mix`, `recent_signals` alongside existing stats + recent_incidents.
- Fixed SettingsPage deep-link: `/settings?tab=integrations&anchor=huntress-settings-card` now auto-selects tab and scrolls to card.
- Security section, Shadow IT, Compliance, Ransomware, and existing pages left intact per user request ("leave it").
- **Testing**: `/app/test_reports/iteration_112.json` — 16/16 backend pass, 100% frontend pass.

## Recent Updates (Apr 20, 2026 — Huntress Labs Integration)
- **New backend router** `/app/backend/app/routers/huntress.py` — read-only Huntress REST API (https://api.huntress.io) integration via HTTP Basic auth (api_key:secret_key).
  - `GET /api/huntress/status`, `POST /api/huntress/settings`, `DELETE /api/huntress/settings`
  - `GET /api/huntress/test-connection` (probes /v1/account, stores `last_test_status`)
  - `GET /api/huntress/summary` (aggregates agents + incidents + signals + orgs in parallel; graceful fallback when endpoint disabled)
  - `GET /api/huntress/{agents,incident-reports,organizations,signals}` (read-through)
  - Credentials stored in `db.settings` (`type: huntress`), 60 req/min friendly.
- **Settings UI**: New Huntress integration card in Settings → Integrations (`huntress-settings-card`) with save / test / remove flows and masked key preview.
- **Security Dashboard**: Added `<HuntressSummaryCard />` below the Threat Level Banner. Shows Orgs / Agents (online/total) / Offline / Critical / Open / Signals, plus top 5 recent incidents. When not configured, shows an orange CTA linking to Settings.
- **Testing**: `/app/test_reports/iteration_111.json` — 14/14 backend pass, 100% frontend pass.

## Recent Updates (Apr 20, 2026 — Dark/Light Mode Palette Unification)
- **Problem**: Dark `:root` used a slate-blue palette (`222 47% 11%`) while the Wave 2 refactored pages hardcoded zinc-950 (`240 10% 4%`) — legacy vs revamped pages clashed. And `PageShell` hardcoded `bg-zinc-950 text-zinc-100` meaning light-mode toggle left revamped pages stuck dark.
- **Fix**:
  - `/app/frontend/src/index.css` — `:root` (dark) and `.light` palettes rewritten with zinc-based HSL tokens (dark: 240 10% 4% zinc-950 base, 240 5% 65% muted-foreground zinc-400, 240 4% 16% zinc-800 border).
  - `/app/frontend/src/components/design-system/index.jsx` — `PageShell`, `MetricStrip`, `MetricTile`, `StatusPill`, `IntegrationChip`, `EmptyState`, `MicroLabel` now use semantic Tailwind tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`) instead of hardcoded zinc classes. Auto-switches with theme.
- **Testing**: `/app/test_reports/iteration_110.json` — 100% pass across Dashboard, Devices, Tickets, Shadow IT, Assets, Contracts. Theme persists via `localStorage.nexusops_theme` and across page refreshes.

## Recent Updates (Apr 20, 2026 — P1 Wave C Feature 1: Shadow IT Detector)
- **Zero-LLM-cost** rule-based detector. New router `/app/backend/app/routers/shadow_it.py`:
  - Curated `RISK_DB` (40+ regex patterns covering file_sharing, remote_access, unapproved_vpn, ai_tool, messaging, personal_cloud, password_manager_personal, crypto_mining, torrent_p2p, unapproved_backup, screen_recorder) with per-app risk level + reason.
  - `GET/PUT /api/clients/{id}/shadow-it/baseline` — per-client approved app list (falls back to sensible default).
  - `POST /api/devices/{id}/software-report` — RMM agent push endpoint for installed software inventory.
  - `POST /api/shadow-it/scan` — fleet-wide or single-client scan; aggregates findings per app across devices.
  - `GET /api/shadow-it/summary` — dashboard roll-up (by_risk, per_client, top_apps, last_scan).
  - `GET /api/shadow-it/findings` — filterable by client/risk/category/status, sorted critical→low.
  - `POST /api/shadow-it/findings/{id}/{approve|ignore|create_ticket}` — approve adds to baseline; create_ticket produces a security ticket with mapped priority.
  - `POST /api/shadow-it/seed-demo` — idempotent demo populater for preview environments.
- **Frontend**: `/app/frontend/src/pages/ShadowItPage.jsx` at `/shadow-it`. 6-tile MetricStrip (Total / Critical / High / Medium / Low / Clients Affected), master-detail layout (client list ↔ findings table), risk filter chips, search, row actions (Approve/Ticket/Ignore), Top-10 fleet-wide shadow apps grid, devices dialog. Wired into sidebar under **Security → Endpoint Security → Shadow IT**.
- **Testing**: `/app/test_reports/iteration_109.json` — backend 18/18 pass, frontend 100%.
- **Demo data**: 135 devices seeded, 20 clients scanned → 106 findings (40 high, 54 medium, 12 low, 17 clients affected). Ready for dev team review.

## Recent Updates (Apr 20, 2026 — P1 Wave B: Voice Journal + Coffee Break + Digest Scheduler)
- **Voice Journal** — `/app/backend/app/routers/voice_journal.py`. OpenAI Whisper (`whisper-1`) via Emergent key.
  - `POST /api/voice-journal/transcribe` — multipart audio → transcript.
  - `POST /api/voice-journal/log-entry` — one-shot: audio → transcript → ticket comment + `time_entries` row (billable flag, duration minutes, $150/hr default).
  - `GET /api/voice-journal/history` — tech's recent voice entries.
  - Frontend: `<VoiceJournalButton />` in ticket detail header uses `MediaRecorder` (WebM), shows big record button + live timer, asks for duration/billable, then logs.
- **Coffee Break Mode** — `/app/backend/app/routers/coffee_break.py`.
  - `GET /api/coffee-break/status`, `POST /api/coffee-break/start`, `POST /api/coffee-break/end`, `GET /api/coffee-break/active-users`, `GET /api/coffee-break/history`.
  - Stamps the tech's assigned open/in_progress tickets with `sla_paused=true`, auto-resumes on break end. Auto-expiration after `duration_minutes`.
  - Frontend: `<CoffeeBreakToggle />` in Dashboard hero header. Popover with presets (☕ coffee 15m, 🥪 lunch 45m, 👥 meeting 30m, 🧘 focus 60m, ⏸ break 10m) + custom minutes. When active, shows live countdown + "resume" single-click.
- **Morning Standup Digest Scheduler** — `server.py` startup adds `_standup_digest_scheduler()` background task.
  - Once-per-minute check: if enabled and `now.hour == send_hour_local` and not already sent today, generates digest via Claude Sonnet 4.5 and delivers via Resend (email) and/or MobileMessage (SMS) per `standup_digest.value.channels`.
  - `last_sent_tag` guards against duplicate sends within a day. Timezone-aware via `zoneinfo`.
- **Testing**: `/app/test_reports/iteration_108.json` — backend 20/20 pass, frontend Dashboard 100%.

## Recent Updates (Apr 20, 2026 — P1 Wave A: AI Differentiators)
- **LLM**: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`) via Emergent LLM key using `emergentintegrations`.
- **New backend router**: `/app/backend/app/routers/ai_wave_a.py`
  - `POST /api/tickets/{id}/copilot` — `summarize` / `next_step` (structured JSON) / `draft_reply` (tone-aware).
  - `POST /api/ai/explain-error` — plain-English diagnosis + `severity` + `remediation_steps[]` + `references[]`.
  - `GET /api/ai/standup-digest?hours=12` — AI brief over overnight events (new tickets, criticals, SLA breaches, offline devices, failed backups, alerts, overdue AR).
  - `GET /api/ai/standup-digest/history` · `GET/PUT /api/ai/standup-digest/settings` — per-admin delivery prefs (banner/email/SMS).
  - All AI calls audit-logged in `db.ai_copilot_events`.
- **New frontend components**:
  - `/app/frontend/src/components/ai/CopilotWidgets.jsx` — `<TicketCopilotButton />`, `<ExplainErrorButton />`.
  - `/app/frontend/src/components/ai/StandupDigestBanner.jsx` — urgency-toned (rose/amber/emerald) 7am banner with refresh + collapse.
- **Wiring**:
  - TicketsPage detail header → Copilot dropdown + Explain Error button (adjacent to existing AI Diagnose).
  - DashboardPage → Standup Digest banner above Attention banner.
- **Testing**: `/app/test_reports/iteration_107.json` — backend 16/16 pass, frontend 100%. Regression on existing AI Diagnose, Timer, Log Time, Email, PDF buttons all pass.

## Recent Updates (Apr 20, 2026 — Swiss Tactical Dark UI Wave 2)
- **Goal**: Extend the new design system to the remaining high-traffic cockpit pages.
- **Wave 2 migrated pages** (headers + metric strips wrapped in `<PageShell>` / `<MetricStrip>` / `<MetricTile>`; inner tables & dialogs untouched):
  - `DashboardPage` — 4-tile strip (Clients, Devices, Open Tickets, Revenue). Duplicate stat grid removed.
  - `DevicesPage` — 6-tile strip (Total, Online, Offline, Warning, Avg CPU, Need Patching).
  - `AssetsPage` — 5-tile strip (Total Assets, Active, Total Value, Warranty Expiring, Warranty Expired).
  - `ContractsPage` — 5-tile strip (Total Contracts, Monthly Value, Active, Expiring 90d, Line Items).
  - `BackupCommandCenterPage` — 6-tile strip (Tenants, Machines, Healthy, Failed, Warning, Alerts).
  - `Pax8CommandCenterPage` — 4-tile strip (Companies, Linked, Billable MRR, Auto-Billed).
  - `LiveChatPage` — 5-tile strip (Active, Mine, Unassigned, Messages Today, Closed).
- **Testing**: `/app/test_reports/iteration_106.json` — 100% pass. 9 pages tested (7 refactored + 2 regression on Tickets/Invoices). No blank pages, no React errors, no stacking crashes.

## Recent Updates (Apr 19, 2026 — Design System Primitives + Tickets & Invoices Migration)
- **Goal**: Apply the Swiss Tactical Dark aesthetic (extracted from the revamped Clients page) consistently across the whole app without rewriting 182 pages individually.
- **New shared design-system module**: `/app/frontend/src/components/design-system/index.jsx` exports reusable primitives used across the cockpit:
  - `<PageShell>` — full-bleed zinc-950 page wrapper
  - `<MetricStrip>` + `<MetricTile>` — left-border-accent metric row (replaces the old rounded Card-based stat blocks)
  - `<HealthDial>` — animated SVG score ring
  - `<Sparkline>` — compact Recharts area sparkline
  - `<StatusPill>` — uppercase micro-label pill with color-coded status mapping (ticket/invoice/lifecycle)
  - `<IntegrationChip>` — ACR/PX8/365/RMM chips
  - `<EmptyState>`, `<MicroLabel>` — terminal-style helpers
- **Migrated Wave 1**:
  - **TicketsPage** — list view + detail view wrapped in `<PageShell>`, 6-tile metric strip replaces rounded colored cards, smaller `text-xl` header with uppercase mono sub-label. All existing flows (create ticket, voice, workshop, cabling/WISP, SMS send, email, filters, bulk actions) continue to work.
  - **InvoicesPage** — list view wrapped in `<PageShell>`, 5-tile metric strip replaces rounded cards. Create / aging / revenue / detail flows unchanged.
- **Testing**: 100% frontend tests passed by testing agent. Zero regressions. Testing agent fixed a missing `...props` spread on `PageShell`.
- **Remaining pages to migrate**: 180 other pages inherit the zinc base automatically but still use rounded Cards for stats. Next waves recommended: Dashboard, Devices/Assets, Backup Command Center, Pax8 Command Center, Contracts, Contacts, Live Chat, Settings.

## Recent Updates (Apr 19, 2026 — Clients Page Revamp + Phase 1 of Ultimate MSP Roadmap)
- **Ambition**: User said "do all of them" for a 13-bundle roadmap (AI everywhere, Client Health Score, Gamification, Field tech quirks, Auto-doc, Voice bot, Time Machine, Billboard, Network map, MSP Business OS, White-label portal, Change calendar, Breach alerts). Rolling out in themed phases.
- **Phase 1 — Clients page revamp + Client Health Score**:
  - Invoked `design_agent_full_stack` → produced `/app/design_guidelines.json` (Archetype 4: Swiss & High-Contrast Dark Tactical). Master-detail F-pattern layout, zinc-950 canvas, indigo/sky/cyan/emerald accents, 1px border aesthetic, IBM Plex Sans + JetBrains Mono.
  - **Backend**: New `GET /api/clients-enriched` endpoint — one-shot portfolio view: per-client health score + risk level, MRR + 12-month sparkline trend, open tickets / assets / contacts / contracts / overdue-AR counts, integration link status (Acronis, Pax8, M365, RMM), last activity, lifecycle stage. Plus roll-up summary (client_count, total_mrr, avg_health, at_risk, churned, prospects, with_acronis, with_pax8).
  - `ClientCreate` + `Client` models now accept `tier` and `lifecycle`.
  - **Frontend**: `ClientsPage.jsx` fully replaced (1469 → ~650 lines). Linear/Superhuman-inspired:
    - Portfolio metric strip (6 tiles) with left-border accent + trend hints
    - Dense master list with animated SVG health dial, integration chips (ACR/PX8/365/RMM), MRR sparklines, trend % deltas, lifecycle pills
    - Saved-view filters: lifecycle × risk × integration
    - Right-pane detail with tier-gradient avatar, 5-column quick metric strip, tabs (Overview/Tickets/Assets/Contacts/Billing/Integrations/Activity)
    - Overview shows **AI-driven Next Best Action**, quick actions, animated health-score breakdown bars, recent activity feed
    - Keyboard shortcuts: `/` focus search, `j/k` navigate, `⌘N` new client
  - **Testing**: 16/16 backend tests passed, 100% frontend verified by testing agent. Zero bugs, zero regressions.

## Recent Updates (Apr 18, 2026 — Pax8 API Integration + Microsoft/CSP Auto-Billing)
- **Scope**: Mirror the Acronis billing pattern for Pax8. Live OAuth2 client_credentials auth (api.pax8.com). Sync Microsoft 365 / Defender / Azure / CSP subscriptions, link Pax8 companies to NexusOps clients, auto-attach per-seat usage onto recurring invoices every generation.
- **Backend** — new `/app/backend/app/routers/pax8.py`:
  - Settings: `GET/PUT /api/settings/pax8`, `POST /api/pax8/test`
  - Sync: `POST /api/pax8/sync` (companies + subs + product catalog)
  - Companies: `GET /api/pax8/companies` (with link status), `POST /api/pax8/companies/{id}/link`, `DELETE …/link`
  - Subscriptions: `GET /api/pax8/subscriptions?company_id=…` (enriched with product/vendor names)
  - Billing: `GET /api/pax8/billing/preview` (per-client MRR), `GET /api/pax8/billing/client/{client_id}`
  - Link-to-recurring: `POST /api/pax8/billing/client/{id}/link-to-recurring` (+ unlink). Supports `create_if_missing=true` to scaffold a new RI for clients with none.
  - Old stub `Pax8` routes in `integrations.py` removed to avoid route conflict.
- **Recurring invoices** — both `generate-now` and scheduler `run-now` now support `include_pax8_usage=true` (parity with Acronis). Auto-attached line items prefixed `Pax8 —` and flagged `pax8_auto=true`. Prior auto-attach items are stripped before re-attaching.
- **Frontend**:
  - New **Pax8 Command Center** page (`/pax8`) with Companies / Subscriptions / Billing tabs, stat cards, search, link dialogs, and per-client "Link to Recurring Invoice" button + scaffold flow. 
  - **RecurringInvoicesPage**: new "Auto-attach Pax8 / Microsoft subscriptions" switch in Create + Edit, indigo `Pax8 Auto` badge on rows.
  - **Settings** → new Pax8 card (masked secret, Test Connection, Sync Now, enable toggle).
- **Live data**: 104 Pax8 companies, 209 subscriptions, 22 products cached. ACB Consultants pre-linked to Acme Corporation ($32 AUD/mo M365 Business Standard).
- **Testing**: 15/15 backend tests passed, 95% frontend verified. Fix by testing agent: deduplicated /pax8 route in routes.js.

## Recent Updates (Apr 18, 2026 — Acronis Usage → Recurring Invoice Auto-Billing)
- **User goal**: One-click auto-billing for any Acronis-linked client. Whenever Acronis sync runs for a client with "Auto-Bill via Recurring" enabled, the client's recurring invoice(s) will automatically pick up fresh usage on every generation — no manual sync-to-contract step required.
- **Backend**:
  - `POST /api/acronis/billing/client/{id}/link-to-recurring` — enables `include_acronis_usage=True` on all active RIs for a client, OR (with `create_if_missing=true`) scaffolds a new RI if none exists. Stamps `auto_bill_recurring=True` on the `acronis_customer_links` doc.
  - `POST /api/acronis/billing/client/{id}/unlink-recurring` — disables auto-attach across all client RIs.
  - `GET /api/recurring-invoices/by-client/{id}` — lists active RIs for a client with their `include_acronis_usage` flag.
  - `POST /api/recurring-invoices/{ri_id}/set-acronis-auto` — per-RI toggle.
  - `GET /api/acronis/billing/preview` now returns `auto_bill_recurring` and `active_recurring_invoices[]` per client for UI.
  - **Fixed**: `POST /api/recurring-invoices/scheduler/run-now` was NOT auto-attaching Acronis usage — only manual `generate-now` was. Now both paths pull live Acronis usage when `include_acronis_usage=true` (parity achieved).
  - `POST /api/recurring-invoices/create` now persists `include_acronis_usage` (was dropped from input).
- **Frontend**:
  - **RecurringInvoicesPage**: new "Auto-attach Acronis usage" switch (Cloud icon, sky accent) in both Create and Edit dialogs. `Acronis Auto` badge on list rows.
  - **BackupCommandCenterPage → Billing tab**: per-client row now has "Link to Recurring Invoice" / "Disable Auto-Bill" button + live `Auto-Billed via Recurring` badge + active RI count. If a client has no RIs, clicking opens a scaffold dialog (frequency picker → creates a minimal RI with Acronis auto-attach enabled).
- **Testing**: 13/13 backend tests + 100% frontend verified (zero issues). Test file `/app/backend/tests/test_iteration102_acronis_recurring_billing.py`.

## Recent Updates (Apr 18, 2026 — Editor & SMS Signature UX)
- **Ticket email composer enlarged & resizable**: Inline Public Email body editor now defaults to 320px tall and the entire ProseMirror area is vertically resizable by drag handle. Signature editor in Settings defaults to 300px.
- **RichTextEditor major upgrade**:
  - `@tiptap/extension-table` (+ row/cell/header) — tables now preserved on paste and via new toolbar Table button. Critical for pasted Outlook signatures which heavily use tables.
  - New `HTML ⇄ Visual` toggle (`data-testid=rte-html-toggle`) exposes a raw HTML source textarea (`rte-html-textarea`). Users can paste their exported Outlook signature HTML directly, toggle back to Visual, and send.
  - Signature card description updated with guidance: Outlook `cid:` inline images won't render — host images publicly or paste as base64 data URIs.
- **SMS signature**: New config in `sms_config` (`signature`, `append_signature`). Default "Kind Regards, NexusMSP". Auto-appended by `send_sms()` unless caller sets `skip_signature=True` (test SMS flow) OR the message already contains the signature text. Settings UI adds signature input + auto-append toggle. Ticket SMS composer now shows signature-aware segment counter + hint "Signature auto-appended: \"...\"".
- **Testing**: 9/9 backend tests passed, 100% frontend verified. Test file `/app/backend/tests/test_rte_sms_signature.py`.

## Recent Updates (Apr 18, 2026 — Two-way SMS Service Desk + Overdue Invoice SMS Reminders)
- **Tickets — SMS channel in Conversation tab**: New third option in the conversation-type selector alongside Internal Note & Public Email. Form auto-populates recipient from `client.mobile`/`client.phone`, supports the `ticket` category of SMS templates with client-side placeholder substitution ({client_name}, {ticket_number}, etc.), live character / segment counter, and 1600-char provider limit.
- **Unified timeline rendering**: Outbound SMS shows emerald-tinted card + PhoneCall icon + provider delivery status; inbound replies (auto-linked by webhook via custom_ref tkt-{id} or client phone match) render with a bolder left border and "SMS Reply" badge. Conversation tab badge count now includes SMS.
- **Invoices — Send SMS Reminder**: New action in the invoice detail Actions sidebar (only when payment_status != paid). Dialog shows invoice summary + last reminder timestamp + counter, pre-selects `overdue_invoice` template with billing-category templates loaded dynamically, recent SMS-for-this-invoice history (last 5), and optional override message. On success, refreshes invoice to show `last_sms_reminder_at` / `sms_reminders_sent`.
- **Backend endpoints (already live from prior session)**:
  - `GET /api/tickets/{id}/sms` — list outbound+inbound SMS linked to a ticket (by `ticket_id` or `custom_ref=tkt-{id}`)
  - `POST /api/tickets/{id}/send-sms` — resolve recipient from ticket's client, apply template, send via MobileMessage, push `sms_sent` activity entry on the ticket
  - `POST /api/invoices/{id}/send-sms-reminder` — template-driven (days_overdue, amount, payment_link computed server-side), increments `sms_reminders_sent`, stamps `last_sms_reminder_at`
- **Testing**: 14/14 backend tests passed, 100% frontend UI verified, regression PASS on Internal Note, Public Email, Invoice Clone/Email/Credit Note/Payment/Void. Test file: `/app/backend/tests/test_sms_integration.py`.

## Acronis Integration (Live)
- Partner: Steele Technology (efa33c24-b78f-42ee-a1d9-3859ebd251f7)
- Data Centre: au1-cloud.acronis.com
- 83 customer tenants, 364 machines, 200 alerts
- Backup statuses: 207 healthy, 93 failed, 50 warning
- Credentials stored in backend/.env (ACRONIS_API_URL, ACRONIS_CLIENT_ID, ACRONIS_CLIENT_SECRET)
- Also configurable via Settings > Integrations > Acronis Cyber Cloud card

## Recent Updates (Apr 18, 2026)
- Backup Command Center with 4 live tabs: Tenants, Backup Status (364 machines with plans/timestamps), Activities, Alerts
- Link button on each tenant to map to NexusOps client
- Acronis Settings card in Settings > Integrations (Client ID, Secret, Data Centre URL, Test Connection)
- Backup status shows: machine name, tenant, health (ok/failed/warning), applied plans, last/next backup times

## Recent Updates (Apr 18, 2026 — SMS integration via MobileMessage.com.au)
- **New SMS integration**: End-to-end MobileMessage.com.au SMS gateway with outbound send, inbound webhooks, delivery-status webhooks, balance checking, and audit log.
- **Config UI** at Settings → Integrations → SMS Messaging:
  - API Username + Password (masked, `clear` to remove), Default Sender with "Load Senders" to fetch approved IDs from MobileMessage, Enable toggle
  - Auto-generated webhook URLs (status + inbound) with copy buttons — ready to paste into MobileMessage portal
  - Test Recipient + Message with "Send Test SMS" button and last-test-result badge
  - "Refresh Balance" button (pulls live from `/v1/account`)
  - Status badge with credit balance + last test
- **Backend endpoints**:
  - `GET/PUT /api/settings/sms` — config storage (DB-override, password masked on read)
  - `POST /api/sms/send` — outbound SMS with full audit trail in `sms_messages`
  - `POST /api/sms/test` — test SMS with last-test-result persistence
  - `GET /api/sms/balance` — live credit balance from `/v1/account`
  - `GET /api/sms/senders` — approved sender IDs (shared/own/brand)
  - `GET /api/sms/messages` — paginated message log (direction/client filters)
  - `GET /api/sms/stats` — outbound/inbound/delivered/failed/unread/today counters
  - `POST /api/sms/webhook/status` — public webhook; updates `sms_messages` by `message_id`
  - `POST /api/sms/webhook/inbound` — public webhook; auto-links to client by phone match
  - `POST /api/sms/messages/{id}/read` — mark inbound as read
- **Phone normalisation**: `04xx` and `+614xx` both normalised to `614xxxxxxxx` for consistent dedup & matching
- **Collections**: `sms_messages` (outbound+inbound audit), `sms_webhook_log` (raw payload archive), `settings.sms_config`
- **Live verified**: Test SMS sent successfully to 0493892119 from sender 61485900170 — cost 2 credits, balance went from 50 → 48, Configured badge green, all flows working end-to-end

- **Resend email settings** now fully configurable via UI at **Settings → Integrations → Resend Email Delivery**:
  - Editable API key (masked display, `clear` to remove custom key and revert to env), Sender Email (From), Reply-To, Test Email Recipient
  - Status badges: Configured/Not Configured + source (DB override vs. Environment .env)
  - Last-test-result badge with timestamp
  - "Send Test Email" button delivers a branded test email and stores the result
  - Backend: `GET/PUT /api/settings/resend`, `POST /api/settings/resend/test`
  - `email_utils.send_email()` now reads from DB first (fallback to env) so admins can swap keys without redeploying

- **Settings page revamped for easy navigation**:
  - New **Quick-search input** in the page header — type "resend", "stripe", "logo", "acronis", "sso"… and get instant dropdown results with tab badges
  - Search index covers 24+ settings across all 7 tabs (branding, general, auth, mailbox, integrations, AI, notifications)
  - Click a result → auto-jumps to the correct tab, scrolls to the target card, and briefly highlights it
  - All major cards now have stable `data-testid` anchors (resend/acronis/xero/stripe/hudu/syncro/ai/sso/notifications/…) so quick-jump is reliable
  - Backend: a pre-existing destructuring bug (resend data was dropped into the wrong slot behind acronis) was fixed while wiring the new integration


- **Consent-gated remote access**: Portal Remote button now opens a compliance consent dialog before launching RustDesk. Shows device details, SOC 2 / ISO 27001 disclosure, MSP-observation notice, and requires explicit checkbox acknowledgement. Backend rejects `remote-connect` without `consent_acknowledged: true`.
- **Active-session tracking**: After consent, an "in progress" dialog stays open with session notes field and red "End Session" button. Ending the session computes duration and generates the audit record.
- **Tamper-evident PDF audit records**: MSP-branded PDF per session including Session ID, Client, Initiated by, Device + OS, RustDesk ID, Started/Ended timestamps, Duration, Status, IP address, full consent text, acknowledgement timestamp, session notes. Generated via `reportlab`-style FPDF with MSP branding (uses `settings.branding.company_name`).
- **New Portal "Sessions" tab** (shown only when `can_remote_devices=True`): lists all past remote sessions for the portal user with device / started / ended / duration / status / per-row PDF download button.
- **Admin-side visibility**: `GET /api/remote-session-records` (optional client_id/status filters) + `GET /api/remote-session-records/{id}/pdf` for MSP audit access.
- **New backend endpoints**:
  - `POST /api/portal/v2/devices/{id}/remote-connect` now requires `{consent_acknowledged: true}`; creates a `remote_session_records` doc + audit link to `rustdesk_sessions`
  - `POST /api/portal/v2/remote-sessions/{id}/end` with optional notes; computes duration
  - `GET /api/portal/v2/remote-sessions` portal-scoped list
  - `GET /api/portal/v2/remote-sessions/{id}/pdf` portal PDF download
  - `GET /api/remote-session-records` admin list
  - `GET /api/remote-session-records/{id}/pdf` admin PDF download
- New MongoDB collection: `remote_session_records` with fields: id, type, client_id, client_name, portal_user_id/name/email, device_id/name/os, rustdesk_id, started_at, ended_at, duration_seconds, status, consent_acknowledged, consent_acknowledged_at, consent_text, ip_address, user_agent, notes, created_at
- Verified end-to-end: consent → rejected without checkbox → accepted → session logged (4s) → End Session with notes → PDF downloaded successfully (2450 bytes, valid PDF-1.3)


- **Live Chat enhanced** (was 139 lines → now feature-rich):
  - 5-card stats strip: Active / Assigned to Me / Unassigned / Messages Today / Closed
  - Queue panel with search + All/Active/Closed filter tabs + unread badges + last-message preview
  - Dedicated Context sidebar showing open tickets count, device count, last ticket for the session's client, and transfer history
  - **Canned responses** (7 defaults seeded): shortcut, title, content; `{visitor}` / `{eta}` placeholders auto-substitute. Full CRUD dialog for managing responses. Popover picker next to message input.
  - **Session transfer** to another agent/tech with optional note; posts system message in chat and records transfer history
  - **Create Ticket from chat** enhanced — inherits priority & assigned agent, links back to session
  - Auto-mark-as-read when agent opens a session; `unread_count` shown as green badge on queue items
  - Textarea with Enter=send, Shift+Enter=newline
  - Polling every 5s for new messages in active session
  - System messages rendered centered & italic (e.g., transfer records)
  - Backend endpoints: `GET /live-chat/sessions?status=&search=&assigned_to=`, `GET /live-chat/stats`, `GET /live-chat/canned-responses`, `POST /live-chat/canned-responses`, `DELETE /live-chat/canned-responses/{id}`, `POST /live-chat/sessions/{id}/transfer`, `GET /live-chat/agents`

- **Client Portal — Remote Into Devices**:
  - New per-device **"Remote" button** in the Portal Devices tab (uses Power icon)
  - Button auto-disabled when: permission missing, no RustDesk agent installed, or device offline — with tooltip explaining why
  - "Remote ready" green badge shows agents are installed; "No agent" otherwise
  - Launches RustDesk native URI (`rustdesk://{id}@{server}`) via hidden anchor (bypasses popup blockers); toast fallback with Download link if app not installed
  - Session logged to `rustdesk_sessions` with `initiated_via: "client_portal"` and portal user ID for full audit trail
  - Strict server-side guard: portal user can only remote into devices belonging to their own `client_id`
  - New permission `can_remote_devices` (default OFF) in portal user model
  - Admin-side Client Portal Users CRUD: new toggle "Remote Into Devices" in both Create and Edit dialogs + green "Remote" badge in users table
  - Portal devices endpoint `/api/portal/v2/devices` now augments each device with `rustdesk_available` and `rustdesk_device_id`
  - New `POST /api/portal/v2/devices/{device_id}/remote-connect` endpoint
  - Verified: John Smith (Acme Corporation portal admin) sees all 10 devices with per-device Remote button; 8 online+ready enabled, 3 offline disabled

- **Multi-currency support with live FX**: Pricing now defaults to AUD (user's region). New `POST /api/acronis/fx/refresh` hits exchangerate-api.com (free, no auth) to fetch live USD→target rate. Currency selector in Billing tab (AUD/USD/EUR/GBP/NZD/CAD) auto-triggers FX refresh on change. Default USD prices are auto-converted at serve time (e.g., USD $8/server → AUD 11.12 at rate 1.39). User overrides preserved verbatim.
- **Client Acronis Billing Widget** on client detail page (Subs tab): shows live-from-API badge, current month cost in client's currency, last synced timestamp + Δ since last sync, full line-item breakdown, and "View Full Billing →" deep link. New `GET /api/acronis/billing/client/{client_id}` endpoint.
- **Contract → Recurring Invoice conversion**: New `POST /api/contracts/{id}/convert-to-recurring` creates a linked recurring invoice template from all contract line items in one click. Dialog captures frequency, tax rate (default 10% Aus GST), and Auto-attach Acronis toggle. Dropdown menu item added to every contract row. Also shows "View Linked Recurring" when already linked.
- **Auto-attach Acronis to recurring invoice generation**: `POST /api/recurring-invoices/{id}/generate-now` now pulls fresh per-period Acronis usage (for linked clients with `include_acronis_usage=True`) and auto-appends as line items, tagged `acronis_auto=True`. Invoice total recomputes dynamically. Prior auto-attached items are cleared on each generation to avoid stacking.
- Fixed: `LineItem.quantity` changed from `int` to `float` to support fractional GB quantities (e.g. 19.7 GB).
- Verified end-to-end:
  - `contract-001` → RI `ri-77790856` at AUD 2,762.50 (3 contract items + 2 Acronis-synced items)
  - Generated invoice `INV-202604-C3AE` at AUD 2,779.88 with 2 auto-attached Acronis line items for the period

## Earlier in This Session (Apr 18, 2026 — P0 Acronis enhancements)

- **Clickable stat cards**: Machines / Healthy / Failed / Warning cards now navigate to Backup Status tab with status filter applied (banner + Clear filter button)
- **Agent Online/Offline badges**: Backup Status table shows live agent connectivity (Online/Offline badges) via Acronis `/agent_manager/v2/agents` mapping — 132 online / 231 offline detected
- **Run Backup action**: New POST `/api/acronis/backup/run` endpoint triggers `PUT /policy_management/v4/applications/run` with `{items:[resource_ids], state:'running', policy_id}`. Auto-discovers and groups by policy. Handles Zmqgw partial-success 500s gracefully. Per-row "Run Backup" button disabled when agent offline or no backup plan applied.
- **Bulk Run Backup**: "Run Backup on All Online" button in the filter banner (shown for Failed/Warning filter) triggers every eligible machine in one call.
- **Acronis Usage Billing Sync** (NEW full sub-module):
  - Pricing configuration table (18 default offering items mapped: storage, workstations, servers, M365, GSuite, EDR, DLP, DR, etc.) with editable unit price + markup % + enable toggle
  - `GET /api/acronis/pricing` + `POST /api/acronis/pricing` — persisted per-MSP
  - `GET /api/acronis/billing/preview` — aggregates Acronis `/api/2/tenants/{id}/usages` per linked client, normalizes bytes→GB, calculates cost with markup, flags unknown offerings
  - `POST /api/acronis/billing/sync` — materializes usage as `LineItem` docs on each linked client's active contract (tagged with `acronis_synced`, `acronis_tenant_id`, `acronis_offering_code`, `acronis_period`); re-runs REPLACE existing items for that period (no duplicates)
  - `GET /api/acronis/billing/history` — audit snapshots
  - Main `/api/acronis/sync` also auto-generates read-only billing snapshots for all linked clients
  - New "Billing" tab in Backup Command Center with 4 KPI cards, pricing editor, per-client preview with line-item breakdown, Refresh / Dry Run / Sync to Line Items buttons
  - Verified: Bindiwalla Pastoral tenant → Acme Corporation client: $2.36 C2C Storage + $9.00 M365 Seats = $11.36 persisted as real line items on `contract-001`



---

## 2026-04-30 — Tactical RMM (Self-Hosted) integration + Global UI sweep

### What shipped
- **Tactical RMM router** (`/app/backend/app/routers/tactical_rmm.py`)
  - Settings CRUD: `/api/trmm/settings` (GET/POST/DELETE), `/api/trmm/status`, `/api/trmm/test`
  - Data: `/api/trmm/agents`, `/api/trmm/agents/{id}`, `/api/trmm/clients`, `/api/trmm/checks`, `/api/trmm/alerts`, `/api/trmm/summary`
  - Actions: reboot, shutdown, run-script (cmd/script_id), run-checks, install-patches, remote-url (MeshCentral)
  - Linking: POST/DELETE `/api/devices/{id}/link-trmm-agent`, GET `/api/trmm/linked-devices`, GET `/api/trmm/actions/log`
  - Auth: `X-API-KEY` header against self-hosted TRMM REST API
  - Inert until configured — returns `configured=false` shaped responses (no 500s)
- **Settings TRMM card** in `SettingsPage.jsx` (id `trmm-settings-card`) under Integrations
- **Tactical RMM Command Center** (`/tactical-rmm`) — KPI strip, agents table with per-row Remote / Script / Checks / Reboot actions, Linked Devices tab, Audit Log tab, Run Script dialog
- **Device Detail page** — Syncro-style "Remote (TRMM)" button + Link TRMM Agent dialog
- **Global Break-button styling sweep** applied to Hudu (Apply filter), CIPP (Create user, Send digest), Clients (Create, Link tenant, Create user, Link submit) — outlined with color-tinted bg

### Tests
- `/app/test_reports/iteration_122.json` — 25/25 passed (backend), zero issues, no regressions on existing integrations.

### Next backlog (P1 → P2)
- Wire UniFi telemetry (offline APs/switches) into Client Health Score (Network Health dimension)
- Recharts console warnings (recurring) — add minWidth/minHeight to ResponsiveContainer
- Decompose `TicketsPage.jsx` (~4200 lines)
- Network Topology Map + Outage Simulator
- Wave C AI: Billboard Mode, PSA Time Machine, Geofence auto-time entry
- Service Desk bundle (Escalation, Change Mgmt, Skills Matrix)
- Security bundle (Vuln Scanner, Dark Web, Phishing Sim, MFA Mgmt)

## 2026-04-30 (cont.) — TRMM Auto-Link + Sidebar Cleanup

### What shipped
- **POST `/api/trmm/auto-link`** — One-click matcher
  - Pairs TRMM agents → NexusOps devices by hostname (case-insensitive) with IP fallback
  - Body: `{ dry_run?: bool, overwrite?: bool }`
  - Response: `{ success, stats:{agents_total, devices_total, matched, skipped, ambiguous, unmatched}, matched[], skipped[], ambiguous[], unmatched[] }`
  - Persists `trmm_agent_id`, `trmm_hostname`, `trmm_linked_at`, `trmm_linked_by`, `trmm_match_type` on the device
  - Records audit entry in `db.trmm_actions` with `action: "auto-link"`
- **Auto-link dialog** in TRMM Command Center — preview matches with stats grid (matched/skipped/ambiguous/unmatched), Overwrite toggle, Recompute, then commit with one click.
- **Sidebar cleanup**:
  - Removed "Remote Access" from Devices submenu → replaced with "Remote & Patching (TRMM)" linking to `/tactical-rmm`
  - Removed entire "Patch Management" group (Patch Hub, Compliance, 3rd Party) — handled in TRMM
  - Routes preserved (no 404s for old bookmarks); only nav/discoverability changed

### Tests
- `/app/test_reports/iteration_123.json` — 18/18 passed (backend), zero issues, all TRMM regression tests still green.

## 2026-04-30 (cont. 2) — Unified Remote Access Button on Devices

### What shipped
- **GET `/api/remote-providers/active`** — Compact list of all currently active+configured remote providers, surfaces TRMM (from `db.settings.type='tactical_rmm'`) and RustDesk (from `db.settings.key='rustdesk_config'`) alongside the generic remote_providers entries.
- **`<RemoteAccessButton/>` component** (`/app/frontend/src/components/devices/RemoteAccessButton.jsx`) — Single unified button on the Device Detail page that:
  - Picks the primary action based on priority: TRMM (if device has `trmm_agent_id`) → RustDesk (if `rustdesk_id`) → "Link TRMM" (if TRMM configured but device unlinked) → other providers
  - Shows a chevron dropdown listing every available provider when more than one option exists
  - Falls back to a "Configure Remote" CTA linking to Settings if nothing is configured
  - Handles offline state gracefully
- DeviceDetailPage no longer hard-codes RustDesk — both old buttons (RustDesk-only + standalone TRMM) replaced with this single component.

### Tests
- `/app/test_reports/iteration_124.json` — 13/13 passed, zero issues. Confirmed via UI smoke that the button correctly shows "Remote (RustDesk)" when only RustDesk is configured, and will switch to "Remote (TRMM)" once TRMM is wired up + agents linked.

## 2026-04-30 (cont. 3) — Inline Remote button on Devices list

### What shipped
- `RemoteAccessButton` now accepts `compact` + `providersOverride` props so it can be embedded in table rows without doing N network calls (parent DevicesPage fetches `/api/remote-providers/active` once and forwards the result to every row).
- **Table view**: new inline "Remote" / "Link" / "Offline" button in the actions column of each device row (testid `row-remote-{deviceId}`).
- **Grid view**: same compact button added to each card's footer (testid `card-remote-{deviceId}`).
- When a device has `rustdesk_id` or `trmm_agent_id`: click-to-launch (calls `/api/rustdesk/quick-connect` or `/api/trmm/agents/{id}/remote-url`).
- When the device has no provider linkage yet: amber "Link" button navigates to device detail so the tech can assign an ID / link a TRMM agent.
- Offline devices show a disabled "Offline" pill.

### Tests
- `/app/test_reports/iteration_125.json` — 13/13 regression tests passed.

## 2026-04-30 (cont. 4) — TRMM Agent Workspace: World-Class Scripts & Live Terminal

### What shipped
**Backend (10 new endpoints):**
- `GET /api/trmm/scripts` — full script library from TRMM
- `GET /api/trmm/scripts/{id}` — script detail incl. body/args
- `POST /api/trmm/scripts/{id}/favorite` — per-user favorites (stored locally in NexusOps)
- `GET /api/trmm/scripts/favorites/mine`
- `GET /api/trmm/agents/{id}/services` + POST `/services/{name}/{start|stop|restart}`
- `GET /api/trmm/agents/{id}/processes` + POST `/processes/{pid}/kill`
- `GET /api/trmm/agents/{id}/software` (installed inventory)
- `GET /api/trmm/agents/{id}/winupdates` (pending Windows updates)
- Upgraded `POST /api/trmm/agents/{id}/run-script` — captures stdout/stderr/retcode/duration into `db.trmm_runs`, returns `run_id`
- `GET /api/trmm/agents/{id}/runs` and `GET /api/trmm/runs/{run_id}` — persistent run history

**Frontend: `TrmmAgentWorkspace` drawer** — opened by clicking any agent row or the Workspace button. 6 tabs:
- **Terminal** — Live interactive console with PowerShell/CMD/Bash/Python shells, `↑/↓` command history, Ctrl-L to clear, auto-scroll, quick-command palette (OS-aware: PS `Get-ComputerInfo`, CMD `systeminfo`, Bash `uptime/df/journalctl`), colorised output (cyan for cmd, rose for stderr, emerald for stdout, zinc for system), persistent exit code + duration footer per command.
- **Scripts** — Full TRMM library with search + shell filter, starrable favorites (persisted per-user), inline per-script args input, one-click "Run" with live-scrolling output piped into the Terminal tab. Side panel shows Recent Runs with expandable stdout/stderr and exit codes.
- **Services** — Filterable Windows services table with Start/Stop/Restart buttons that call the TRMM service action endpoint and auto-refresh.
- **Processes** — Sortable by CPU/Memory/PID with one-click kill + confirm.
- **Software** — Installed software inventory, searchable.
- **Updates** — Pending Windows updates list + "Install pending" button.

Every action is audited in `db.trmm_actions` and every script run is captured in `db.trmm_runs` for forensic replay.

### Tests
- `/app/test_reports/iteration_126.json` — 33/33 passed, zero issues.

## 2026-04-30 (cont. 5) — Multi-Agent Terminal Broadcast

### What shipped
**Backend:**
- `POST /api/trmm/broadcast` — fire-and-forget concurrent executor. Accepts `{agent_ids[], command|script_id, shell, timeout, args, concurrency(1..20)}`. Creates one `db.trmm_runs` record per target + one `db.trmm_broadcasts` document linking them. Uses `asyncio.Semaphore` for per-broadcast concurrency clamp.
- `GET /api/trmm/broadcasts/{id}` — live status polling; returns `agents[]` flattened with per-target {status, retcode, duration_ms, stdout_preview, stderr_preview}. Counters (completed/succeeded/failed_count) increment atomically as each worker finishes.
- `GET /api/trmm/broadcasts` — list recent broadcasts (limit 20).
- Validation: 503 when TRMM not configured · 400 for missing agent_ids/command · 400 for >200 agents.

**Frontend:** `TrmmBroadcastDialog` component (`/app/frontend/src/components/trmm/TrmmBroadcastDialog.jsx`)
- Tabbed "Ad-hoc command" vs "Saved script" picker (script picker pulls `/api/trmm/scripts`, filterable).
- Concurrency + timeout + label inputs.
- Automatic offline-filtering (offline agents in selection are shown as skip-warnings).
- Live grid view: one card per agent, color-coded icon (running/queued/ok/failed/error), expandable panel showing stdout/stderr preview, progress bar with total completion %, auto-poll every 1.5s until broadcast.status==='complete'.
- Sorted grid: running → queued → error → failed → ok so attention goes where it's needed.

**Wiring in TRMM Command Center:**
- Row selection checkboxes (header select-all filters-aware)
- "Broadcast · N" toolbar button appears the moment anything is selected
- "Clear" resets selection

### Tests
- `/app/test_reports/iteration_127.json` — 34/34 passed, zero issues.

## 2026-04-30 (cont. 6) — Scheduled Broadcasts + Maintenance Window Badge

### What shipped
**Backend (4 new endpoints + scheduler loop):**
- `POST /api/trmm/scheduled-broadcasts` — queue a command/script for future execution. Body includes `run_at` (ISO datetime), `repeat` (once/daily/weekly), all broadcast fields. Validation: 503 unconfigured · 400 for missing agent_ids/command/run_at/repeat · 400 for >200 agents.
- `GET /api/trmm/scheduled-broadcasts` — list pending (or `?include_completed=true` for history)
- `GET /api/trmm/scheduled-broadcasts/{id}` — detail
- `DELETE /api/trmm/scheduled-broadcasts/{id}` — cancel (404 if already executed/cancelled)
- `execute_due_scheduled_broadcasts()` — called by `_trmm_scheduled_broadcast_loop()` in server.py every 30s. Fires due items, creates real bcast- record, links `last_broadcast_id`, increments runs_count. For daily/weekly, bumps run_at forward to next occurrence instead of marking complete.

**Frontend:**
- **Broadcast dialog**: "Run now" vs "Schedule for later" pill toggle; when scheduling shows datetime-local picker + repeat (once/daily/weekly) dropdown. Submit button label adapts ("Schedule for 5 agents" / "Broadcast to 5 agents").
- **Scheduled tab** in TRMM Command Center — table with label/command, target count, run-at, repeat badge, last-run info, Cancel action.
- **Maintenance-window badge** in TRMM CC header — appears when any scheduled broadcast is queued within next 24h; shows count + time-until-next, click jumps straight to the Scheduled tab.

### Tests
- `/app/test_reports/iteration_128.json` — 44/44 passed, zero issues.
- End-to-end verified: one-time schedule fired in 30s; daily repeat correctly bumped run_at forward.

## 2026-04-30 (cont. 7) — Slack/Teams Notifications for TRMM Broadcasts

### What shipped
**Backend (3 new endpoints + auto-dispatch):**
- `GET /api/trmm/notifications/settings`
- `POST /api/trmm/notifications/settings` — accepts slack_webhook_url, teams_webhook_url, notify_on (all|failures|none); 400 on invalid notify_on
- `POST /api/trmm/notifications/test` — sends a sample summary card to the configured channel(s) for verification
- **Auto-dispatch**: every broadcast invokes `_send_broadcast_notification()` after `gather()` completes (try/except wrapped so a webhook failure never breaks the broadcast). Persists per-target delivery status into `db.trmm_broadcasts.notifications` plus a `notified_at` timestamp.
- Slack message uses native blocks API (header + 4 fields + command context) with green/amber/red color based on success ratio.
- Teams message uses MessageCard schema (themeColor + facts).

**Frontend:** New "Broadcast notifications" panel inside the TRMM Settings card —
Slack & Teams URL inputs · `notify_on` dropdown (Every broadcast / Only failures / Disabled) · Save · **Send test** button (validates config by firing a sample message).

### Tests
- `/app/test_reports/iteration_129.json` — 37/37 passed, zero issues. Hand-tested: real Slack-format card delivered to httpbin.org/post returned 200 OK.

## 2026-04-30 (cont. 8) — UniFi → Client Health Score (Network Health dimension)

### What shipped
**Backend:**
- `/api/unifi/summary` now persists per-site snapshots into `db.unifi_site_cache` (`{site_id, devices_total, devices_online, clients_total, alerts, cached_at}`) whenever it runs — no new API calls needed by the health engine.
- `_compute_health()` in `client_health.py` now reads the cache for clients with `unifi_site_id`, computes `network_score = uptime_pct - (alerts * 5)`, and emits:
  - `metrics.network_health` (0-100)
  - `details.network` (full breakdown)
  - Risk factors for offline devices & alerts (critical if ≥3 offline)
  - Positive factor "All N network devices online" when everything is clean
- **Weight rebalancing**: when network_health is present, it gets 10% of the composite (borrowed 5% from device, 5% from engagement). M365 hygiene (10%) stacks on top when also present.

**Frontend:**
- `ClientHealthPage.jsx` radar chart now renders Network + M365 axes dynamically when scores exist (not hardcoded 6-axis).
- Health Breakdown panel shows an indigo "Network Health" bar with Wifi icon + sky-blue "M365 Hygiene" bar.

### Tests
- Hand-verified end-to-end: seeded client-001 with a dummy UniFi site (10 devices, 8 online, 1 alert) → health score dropped from 72 → 66, composite reflects network_score=75, risk factors show "2 UniFi device(s) offline at Acme HQ" + "1 UniFi site alerts", `details.network` returns full stats.
- Regression: existing health endpoints unchanged for clients without UniFi (network_health stays null, legacy 6-dimension scoring intact).

## 2026-05-01 — Revenue Opportunity Scanner ⭐ (MSP differentiator)

### What shipped
**Backend** (`/app/backend/app/routers/growth.py`):
- `POST /api/growth/scan` — walks every client, applies 6 detectors, creates ranked opportunities. Keeps human-curated statuses (quoted/won/lost/dismissed), only refreshes `status='new'`.
- `GET /api/growth/opportunities` — filter by status, client_id, category
- `GET /api/growth/summary` — pipeline value, by_status, by_category, top 10 opps, top 10 clients by pipeline
- `PATCH /api/growth/opportunities/{id}` — status lifecycle (new → quoted → won/lost/dismissed), notes, quoted_value
- `POST /api/growth/opportunities/{id}/pitch` — Claude Sonnet 4.5 drafts a tailored 3-5 sentence email pitch body using Emergent LLM key

**Detectors** (each emits `{monthly_value, one_time_value, confidence}` → priority score):
1. **EOL Windows devices** → hardware refresh ($2k × device, confidence 0.9)
2. **M365 hygiene < 70** → Managed MFA/MDR ($18 × users/mo, confidence 0.85)
3. **Security posture gap** (≥3 alerts, no EDR flag) → Managed EDR ($8 × endpoints/mo, 0.75)
4. **Backup failure rate > 10%** → Immutable-backup upgrade ($15 × endpoints/mo, 0.9)
5. **Expiring contracts** (≤90d) → Renewal with 15% uplift (confidence scales with urgency)
6. **Contract over-utilisation** (>10% over cap) → Hour-pack upsell ($150 × extra h/mo, 0.8)

**Frontend** (`/app/frontend/src/pages/GrowthPage.jsx`):
- Route `/growth`, nav under Finance/Business section with TrendingUp icon.
- 4 KPI cards: Open pipeline $, Won all-time, Top category, Last scan metadata.
- "Top clients by pipeline" row with per-client $ values.
- Filterable table: status tabs (Active/New/Quoted/Won/Lost-Dismissed), category chips (Hardware/Security/Data Protection/Contracts), free-text search.
- Priority bar visualisation per row.
- Side-drawer detail view with evidence JSON, suggested action, AI-pitch panel (Draft email → Claude Sonnet generates body → Copy button), quoted value + notes fields, status-change buttons (Quoted/Won/Lost/Dismissed).

### Tests
- Hand-tested via curl: scan across 20 seed clients → 7 opportunities, $9,080 annual pipeline. All endpoints behave correctly.
- Frontend visually verified: Growth page renders with KPI cards, top clients grid, filterable opportunity table. Lint clean.
