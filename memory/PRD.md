# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps RMM/PSA platform with 200+ routers, 75+ pages, live Acronis Cyber Cloud integration.

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

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

## Recent Updates (Apr 18, 2026 — FX + Client Widget + Contract→Recurring)
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


