# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 190+ backend routers and 60+ frontend pages covering every aspect of MSP operations.

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT-based + TOTP 2FA for portal
- **Email**: Resend (integration ready, requires API key)

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal Demo: `john@acmecorp.com` / `portal123`

## Implemented Modules (Complete)

### Core Operations
1. Dashboard / Command Center
2. Tickets (SLA countdowns, bulk actions, >3800 lines)
3. Devices / RMM
4. Clients / CRM
5. Technicians (with email invites)

### Finance
6. Xero Finance Center (Invoices, Estimates, Contacts, Aging)
7. Recurring Billing (MRR/ARR forecasting)
8. Document Branding & Templates (4 builtin, custom)
9. Time Tracking (billable hours, invoice generation, bulk entry)

### Operations
10. Morning Checks Dashboard (with email reports)
11. Client Onboarding Wizard (Kanban board + templates)
12. Smart Schedule / Dispatch (visual weekly calendar, map, route optimization)
13. Scripting Live Terminal
14. Remote Access Hub (RustDesk, Splashtop, MeshCentral)

### Reporting & Analytics
15. Executive Reports (auto-generated, KPIs, trends, recommendations)
16. QBR Generator
17. Reports & Analytics
18. Audit Trail (filterable timeline, export CSV, category breakdown)

### Security & Compliance
19. SOC / Security Operations
20. Multi-Tenant Client Portal (2FA)

### Platform & Integrations
21. License Management (seat tracking, cost optimization, vendor/client breakdown, expiry alerts)
22. Webhook Builder (CRUD, event triggers, payload editor, test/toggle)
23. Global Settings Hub

### Advanced MSP Modules
24. Vendor Scorecard, SLA Penalties, Alert Suppression
25. Incident Heatmap, Predictive Failure, Capacity Planner
26. Auto Documentation, NLP Query

## Features Completed This Session (Apr 11, 2026)

### Batch 1: Previous Session Features
1. **Daily Morning Check Email Report** — rich HTML email with health score, KPIs
2. **Invoice/Letterhead/PO Branding Templates** — 4 builtin templates, Branding tab in Finance
3. **Technician Email Invites** — send/list/revoke/resend/accept
4. **Onboarding Kanban Board** — 3-column visual tracker

### Batch 2: 8 Module Revamps (This Session)
5. **License Management** — COMPLETE REWRITE from 66→230 lines. Seat tracking, cost optimization suggestions, vendor/client breakdown charts, expiry alerts, auto-renewal, Add/Edit/Delete dialogs, 5-tab layout
6. **Webhook Builder** — COMPLETE REWRITE from 38→190 lines. Full CRUD, 17 event triggers, payload template editor, test delivery, toggle active/pause, expandable config cards
7. **Executive Reports** — COMPLETE REWRITE from 46→210 lines. Auto-generated client reports with 6+ KPIs, 6-month trend charts, top issues, recommendations, expandable cards
8. **Audit Trail** — COMPLETE REWRITE from 66→215 lines. System activity log, category breakdown chart, severity/category/date filters, export CSV, event timeline with icons
9. **Time Tracking Enhancement** — Added "Generate Invoice" from billable hours, bulk entry endpoint, invoice dialog
10. **Smart Schedule Enhancement** — Added visual weekly calendar with time blocks (7am-4pm grid)

## Mocked Integrations
- Xero accounting data (requires OAuth keys)
- Resend email (requires API key)
- License data auto-seeded
- Webhook test delivery simulated
- Executive reports mock KPI data
- Audit trail mock events
- AI routing, SOC data, Huntress security

## Backlog (Prioritized)

### P2 - Upcoming
- Workflow Automation Builder (visual drag-and-drop)
- Cross-platform scripting library
- Contract management enrichment
- Knowledge Base enrichment (version history, article ratings)

### P3 - Future
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx (>3800 lines)
- Refactor TechniciansPage.jsx (>1500 lines)
- Bluetooth barcode scanner integration
- Recharts console warnings fix
- Missing aria-describedby accessibility fix

## Key API Endpoints
- `/api/license-management/*` — License CRUD + overview
- `/api/webhook-builder/*` — Webhook CRUD + triggers + test
- `/api/executive-reports/*` — Report list + generate
- `/api/audit-trail/*` — Events + summary with filters
- `/api/time-entries/*` — Time CRUD + generate-invoice + bulk
- `/api/scheduling/*` — Calendar + map + availability
- `/api/morning-checks/*` — NOC dashboard + email
- `/api/technicians/*` — Tech CRUD + invites
- `/api/doc-branding/*` — Document templates/settings
- `/api/onboarding-enhanced/*` — Client onboarding

## Test Reports
- iteration_76.json: Morning Check Email, Branding, Tech Invites, Onboarding Kanban (100%)
- iteration_77.json: License Mgmt, Webhook Builder, Exec Reports, Audit Trail, Time Tracking, Smart Schedule (100%)
