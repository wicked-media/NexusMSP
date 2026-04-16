# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 190+ backend routers and 60+ frontend pages covering every aspect of MSP operations.

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT-based + TOTP 2FA for portal
- **Email**: Resend (integration ready, requires API key)
- **PDF**: fpdf2 for invoice PDF generation

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal Demo: `john@acmecorp.com` / `portal123`

## Complete Module Inventory

### Core Operations
1. Dashboard / Command Center
2. Tickets (SLA countdowns, bulk actions, >3800 lines)
3. Devices / RMM
4. Clients / CRM (1417 lines)
5. Technicians (email invites, leaderboard)

### Finance & Billing
6. Xero Finance Center (Invoices, Estimates, Contacts, Aging, Branding)
7. Recurring Billing (MRR/ARR forecasting)
8. Document Branding & Templates (4 builtin templates, custom)
9. Time Tracking (billable hours, invoice generation, bulk entry)
10. **Invoice PDF Export** (NEW - branded PDF generation, download, email with attachment)

### Client Intelligence
11. **Client Health Dashboard** (radar chart, risk/positive factors, alert thresholds, snapshots)
12. Client Risk Scoring
13. Executive Reports (auto-generated, KPIs, trends, recommendations)
14. QBR Generator

### Operations & Scheduling
15. Morning Checks Dashboard (with email reports)
16. Client Onboarding Wizard (Kanban board + templates)
17. Smart Schedule / Dispatch (visual weekly calendar, map, route optimization)
18. Scripting Live Terminal

### Remote Access & Monitoring
19. **Remote Access Hub** (UPDATED - 7 providers: RustDesk, MeshCentral, Splashtop, ConnectWise ScreenConnect, TeamViewer, AnyDesk, Apache Guacamole)
20. License Management (seat tracking, cost optimization, expiry alerts)

### Platform & Integrations
21. Webhook Builder (CRUD, 17 event triggers, payload editor, test/toggle)
22. Audit Trail (filterable timeline, export CSV, category breakdown)
23. Global Settings Hub
24. Multi-Tenant Client Portal (2FA)

### Security & Compliance
25. SOC / Security Operations
26. Advanced MSP Modules (26 total including Vendor Scorecard, SLA Penalties, etc.)

## Features Completed This Session (Apr 11-16, 2026)

### Phase 1: Remote Access Integrations Tab
- Added "Integrations" tab to Remote Access Hub page
- 7 providers displayed with status cards (Self-Hosted/Cloud badges, feature tags)
- Configure dialog with per-provider API key/URL fields
- Enable/disable toggle switches per provider
- Test Connection and Save Settings functionality
- Docs links for each provider

### Phase 2: Invoice PDF Export & Email
- Invoice PDF generation via fpdf2 with branded headers, line items, totals
- PDF download button added to every invoice row in Finance Center
- PDF preview endpoint (inline) and download endpoint (attachment)
- Query param token auth for PDF endpoints (new-tab compatible)
- Invoice email endpoint now generates PDF and attaches to email
- HTML email template with invoice summary table
- Resend integration for real email sending (mocked when not configured)
- Email history tracking with has_pdf field

### Phase 3: One-Time Payment Links
- Generate unique, expiring payment links per invoice
- Public payment page (no auth) with invoice summary, line items, payment history
- 3 payment methods: Stripe Card (Checkout), BECS Direct Debit (AU banks), Manual Bank Transfer
- Partial payments — pay any amount with one method, rest with another
- Links expire after configurable days or once fully paid
- Admin can confirm bank transfers and revoke links
- Payment link button + dialog in invoice table actions

### Phase 4: Remote Access Connect Fix (Critical Bug)
- Fixed: `window.open("rustdesk://")` was opening blank tabs instead of launching RustDesk
- Replaced with hidden anchor `click()` — no blank tabs
- Corrected URI format: `rustdesk://connection/new/{id}`
- Connection dialog with 3 options: Native Client, Web Client, Copy ID
- Backend returns relay_server and web_client_url for proper routing
- Status bar now says "Configured" instead of misleading "Connected"
- Troubleshooting guidance in connect dialog

### Phase 5: Payment Links Dashboard
- New "Payment Links" tab in Finance Center
- Summary stat cards: Active, Completed, Pending Transfers, Expired/Revoked
- Pending Bank Transfer Confirmations queue with one-click Confirm buttons
- All Payment Links table with status, methods, payment history, copy/revoke actions

### Phase 6: Theme Settings System
- Removed Gradient MSP module (GradientPage.jsx + gradient.py + nav entry)
- 6 theme presets: Midnight, Oceanic, Carbon, Arctic, Ember, Phantom
- 8 accent colors: Emerald, Blue, Cyan, Violet, Orange, Red, Sky, Rose
- 6 Google Fonts: Inter, JetBrains Mono, DM Sans, Space Grotesk, IBM Plex Sans, Outfit
- All preferences persist via localStorage
- CSS variables (--primary, --font-sans) apply globally to all Shadcn components

### Phase 7: Dashboard & Morning Checks Visual Overhaul (Apr 16, 2026)
- **Dashboard**: Glass-morphism hero banner, gradient text greeting, attention strip, animated metric cards with gradient overlays, ticket volume AreaChart, fleet health PieChart, operational insights (failure predictions, backups, compliance), open tickets/alerts/activity feed columns, quick search modal (Ctrl+K)
- **Morning Checks**: Matching glass-morphism hero with status badge, animated HealthGauge SVG with glow effects, animated metric cards, color-coded issues strip, offline devices/critical tickets/backup failures with gradient top borders, RAG Client Health Board, quick stats row, overdue invoices, phone system status, scheduled tasks, all-clear message

### Phase 8: Remote Access Dialog Consistency + Device Agent & Disk Health (Apr 16, 2026)
- **Remote Access Dialog Fix**: Replaced old-style 4-button dialog in DeviceDetailPage with the same 3-option dialog from Remote Access Hub: Open in RustDesk Client (hidden anchor launch, no blank tabs), Open Web Client, Copy ID to Clipboard, plus password display, relay server info, and troubleshooting tips
- **Device Agent Scripts**: PowerShell (Windows) and Bash (Linux/macOS) agent scripts auto-generated per device via `/api/devices/{device_id}/agent-script`. Scripts collect system info, disk SMART health, CPU/RAM/disk usage, network info, security status and report back via `/api/devices/agent/report`
- **Disk Health Monitoring**: New `device_disks` collection with per-drive SMART data (status, temperature, power hours, reallocated/pending sectors, model, serial, firmware, interface). Drive Health card added to DeviceDetailPage overview tab with usage bars, SMART badges, and health warnings
- **Seed Data**: 15 disk entries across 10 devices with realistic hardware (Samsung, Seagate, Intel, WD, SK Hynix, Apple SSDs/HDDs/NVMe) including Warning status disks with sector issues
- **Bulk Deploy Agent**: Dropdown in Devices list page bulk actions toolbar to download agent scripts for multiple selected devices at once

### Phase 9: Login Page Wallpaper & Animated Features (Apr 16, 2026)
- **Custom Login Wallpaper**: Upload custom 1920x1080 images in My Settings > Display > Login Page Wallpaper
- **Template Gallery**: 6 curated wallpaper templates (Cyber City, Neon Glow, Dark Workspace, Tech Setup, Neon Nights, Minimalist) from Unsplash
- **Overlay Control**: Adjustable overlay darkness slider (30-90%) for wallpaper readability
- **Animated Login Features**: Time-of-day greeting with bouncing emoji (sun/moon), typing effect headline cycling through "Command Center / NOC Dashboard / Service Desk / Asset Manager / Security Hub", interactive particle network canvas with 60 nodes and connecting lines, staggered entrance animations

## Test Reports
- iteration_76.json: Morning Check Email, Branding, Tech Invites, Onboarding Kanban (100%)
- iteration_77.json: License Mgmt, Webhook Builder, Exec Reports, Audit Trail, Time Tracking, Smart Schedule (100%)
- iteration_78.json: Client Health Dashboard (100%)
- iteration_79.json: Remote Access Integrations + Invoice PDF/Email (100% - 20/20 backend, all frontend verified)
- iteration_80.json: Payment Links — CRUD, public page, 3 payment methods, partial payments (100% - 22/22 backend)
- iteration_81.json: RustDesk Connect Fix — URI format, dialog, 3 connection methods (100% - 10/10 backend)
- iteration_82.json: Payment Links Dashboard (100% - 12/12 backend, all frontend verified)
- iteration_83.json: Theme System + Gradient MSP Removal (100% - 12/12 backend, all frontend verified)
- iteration_84.json: Dashboard & Morning Checks Visual Overhaul (100% - 21/21 frontend elements verified)
- iteration_85.json: Remote Access Dialog Fix + Device Agent & Disk Health (100% - 17/17 backend, all frontend verified)
- iteration_86.json: Login Wallpaper + Animated Login Features (100% - 11/11 backend, all frontend verified)

## Backlog (Prioritized)

### P2 - Upcoming
- Workflow Automation Builder (visual drag-and-drop)
- Cross-platform scripting library

### P3 - Future
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx (>3800 lines) & TechniciansPage.jsx
- Bluetooth barcode scanner integration
- Recharts console warnings fix
- Missing aria-describedby on some DialogContent

## Key API Endpoints
- `/api/remote-providers` — GET all providers, PUT settings, PUT toggle, POST test
- `/api/remote-providers/{id}/settings` — GET/PUT provider config
- `/api/invoices/{id}/pdf?token=JWT` — GET PDF preview (query param auth)
- `/api/invoices/{id}/pdf/download?token=JWT` — GET PDF download
- `/api/xero/invoices/{id}/email` — POST send invoice email with PDF
- `/api/client-health/*` — Health dashboard, scores, detail, snapshot, alert config
- `/api/license-management/*` — License CRUD + overview
- `/api/webhook-builder/*` — Webhook CRUD + triggers + test
- `/api/executive-reports/*` — Report list + generate
- `/api/audit-trail/*` — Events + summary with filters
- `/api/time-entries/*` — Time CRUD + generate-invoice + bulk
- `/api/devices/{id}/disks` — GET disk health data per device
- `/api/devices/{id}/agent-script?os_type=windows|linux` — GET downloadable agent script
- `/api/devices/agent/report` — POST agent telemetry with disk SMART data
