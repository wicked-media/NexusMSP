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

### Client Intelligence
10. **Client Health Dashboard** (NEW - radar chart, risk/positive factors, alert thresholds, snapshots)
11. Client Risk Scoring
12. Executive Reports (auto-generated, KPIs, trends, recommendations)
13. QBR Generator

### Operations & Scheduling
14. Morning Checks Dashboard (with email reports)
15. Client Onboarding Wizard (Kanban board + templates)
16. Smart Schedule / Dispatch (visual weekly calendar, map, route optimization)
17. Scripting Live Terminal

### Remote Access & Monitoring
18. Remote Access Hub (RustDesk, Splashtop, MeshCentral)
19. License Management (seat tracking, cost optimization, expiry alerts)

### Platform & Integrations
20. Webhook Builder (CRUD, 17 event triggers, payload editor, test/toggle)
21. Audit Trail (filterable timeline, export CSV, category breakdown)
22. Global Settings Hub
23. Multi-Tenant Client Portal (2FA)

### Security & Compliance
24. SOC / Security Operations
25. Advanced MSP Modules (26 total including Vendor Scorecard, SLA Penalties, etc.)

## Features Completed This Session (Apr 11, 2026)

### Phase 1: Previous Session Features
1. Daily Morning Check Email Report
2. Invoice/Letterhead/PO Branding Templates
3. Technician Email Invites
4. Onboarding Kanban Board

### Phase 2: 8 Module Revamps
5. License Management — COMPLETE REWRITE (66→230 lines)
6. Webhook Builder — COMPLETE REWRITE (38→190 lines)
7. Executive Reports — COMPLETE REWRITE (46→210 lines)
8. Audit Trail — COMPLETE REWRITE (66→215 lines)
9. Time Tracking Enhancement — Generate Invoice + Bulk Entry
10. Smart Schedule Enhancement — Visual weekly calendar grid

### Phase 3: Client Health Dashboard
11. **Client Health Score Dashboard** — COMPLETE REWRITE
    - Comprehensive health scoring (6 dimensions: tickets, devices, payments, backups, security, engagement)
    - Auto-generated alerts from critical risk factors
    - Radar chart visualization per client
    - Health breakdown bars with metric icons
    - Risk/positive factor analysis
    - Point-in-time snapshot tracking for trends
    - Configurable alert thresholds (critical/warning)
    - Revenue-at-risk calculation with MRR percentage
    - Search + status filter + clickable detail panel

## Test Reports
- iteration_76.json: Morning Check Email, Branding, Tech Invites, Onboarding Kanban (100%)
- iteration_77.json: License Mgmt, Webhook Builder, Exec Reports, Audit Trail, Time Tracking, Smart Schedule (100%)
- iteration_78.json: Client Health Dashboard (100% - 14/14 backend, all frontend verified)

## Backlog (Prioritized)

### P2 - Upcoming
- Workflow Automation Builder (visual drag-and-drop)
- Contract management enrichment
- Knowledge Base enrichment (version history, article ratings)
- Cross-platform scripting library

### P3 - Future
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx (>3800 lines) & TechniciansPage.jsx
- Bluetooth barcode scanner integration
- Recharts console warnings fix

## Key API Endpoints
- `/api/client-health/*` — Health dashboard, scores, detail, snapshot, alert config
- `/api/license-management/*` — License CRUD + overview
- `/api/webhook-builder/*` — Webhook CRUD + triggers + test
- `/api/executive-reports/*` — Report list + generate
- `/api/audit-trail/*` — Events + summary with filters
- `/api/time-entries/*` — Time CRUD + generate-invoice + bulk
