# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps RMM/PSA platform with 200+ routers, 75+ pages, live Acronis Cyber Cloud integration.

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

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


