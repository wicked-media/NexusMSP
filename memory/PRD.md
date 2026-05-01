# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps RMM/PSA platform with 200+ routers, 75+ pages, live Acronis Cyber Cloud integration.

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`



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
