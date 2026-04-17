# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 200+ backend routers and 75+ frontend pages covering every aspect of MSP operations.

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
6. Xero Finance Center (Invoices, Estimates, Contacts, Aging, Branding, PDF Themes)
7. Recurring Billing (MRR/ARR forecasting)
8. Document Branding & Templates (4 builtin templates, custom)
9. Time Tracking (billable hours, invoice generation, bulk entry)
10. Invoice PDF Export (branded PDF generation with 5 theme options)

### Client Intelligence
11. Client Health Dashboard (radar chart, risk/positive factors)
12. Client Risk Scoring
13. Executive Reports
14. QBR Generator

### Operations & Scheduling
15. Morning Checks Dashboard
16. Client Onboarding Wizard
17. Smart Schedule / Dispatch
18. Scripting Live Terminal

### Remote Access & Monitoring
19. Remote Access Hub (7 providers)
20. License Management

### Platform & Integrations
21. Webhook Builder
22. Audit Trail
23. Global Settings Hub
24. Multi-Tenant Client Portal (2FA + public token-based portal view)

### Security & Compliance
25. SOC / Security Operations
26. Advanced MSP Modules (26 total)

## Features Completed (Apr 11-17, 2026)

### Phases 1-9 (Previous sessions - see CHANGELOG.md for details)
- Remote Access Integrations, Invoice PDF Export & Email, One-Time Payment Links
- Remote Access Connect Fix, Payment Links Dashboard, Theme Settings System
- Dashboard & Morning Checks Visual Overhaul
- Remote Access Dialog Consistency + Device Agent & Disk Health
- Login Page Wallpaper & Animated Features

### Phase 10: Workflow Automation, AI Triage, Recurring Billing Overhaul (Apr 16, 2026)
- Workflow automation builder with visual rule chains
- AI ticket triage system
- Device terminal scripting
- Scheduled reports system
- Recurring billing complete overhaul with auto-generation scheduler in server.py

### Phase 11: CRM Proposals, White-Label Branding, Enhanced Modules (Apr 16, 2026)
- Complete CRM Proposal Builder (Draft -> Send -> Accept -> Convert)
- Global Platform White-Label Branding System
- Overhauled: Profitability Heatmap, Contract Profit, CSAT Surveys, Patch Compliance, Topology, Alert Rules
- Auto-Ticket Merge with settings toggle
- Warranty Tracker page overhaul

### Phase 12: Client Portal Overhaul + Branded PDF Invoice Themes (Apr 17, 2026)
- **Fixed client_portal.py critical syntax error** — duplicate routes inserted mid-return-statement broke all portal APIs (200 routers now vs 198)
- **Client Portal View Page** (`/portal/:token`) — public token-based portal with Overview, Devices, Tickets, Invoices tabs + Submit Ticket dialog
- **Invoice PDF Themes** — 5 built-in themes (Modern Professional, Classic Business, Minimal Clean, Bold Impact, Executive) with theme-specific headers, line item styles, footers, and color schemes
- **Invoice Theme Picker UI** in Finance Center Branding tab with visual mini-previews and one-click activation
- **Icon Branding Fix** — Fixed double `/api/` prefix in WhiteLabelPage logo preview, added server-side validation to filter out test placeholder images (<200 bytes), added onError fallbacks for broken images
- **Finance Center TabsList fix** — Changed from grid-cols-9 to flex-wrap h-auto to properly accommodate 10 tabs

## Test Reports
- iteration_84-92: Previous sessions (100% pass rates)
- iteration_93: Portal APIs + Invoice Themes + PDF Generation (100% backend 16/16, frontend 95%)

## Backlog (Prioritized)

### P3 - Future
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx (>3800 lines) & TechniciansPage.jsx
- Bluetooth barcode scanner integration
- Recharts console warnings fix
- Missing aria-describedby on some DialogContent
- Mobile-responsive optimization for field technicians

## Key API Endpoints
- `/api/invoice-themes` — GET all themes, POST create custom theme
- `/api/invoice-themes/active` — GET/PUT active theme selection
- `/api/portal-api/{token}/summary` — Public portal summary
- `/api/portal-api/{token}/tickets` — GET/POST portal tickets
- `/api/portal-api/{token}/invoices` — GET portal invoices
- `/api/portal-api/{token}/devices/health` — GET device health
- `/api/settings/branding` — GET/PUT platform branding
- `/api/settings/branding/upload-logo?logo_type=icon` — POST logo upload
- `/api/invoices/{id}/pdf?token=JWT` — GET PDF preview
- `/api/invoices/{id}/pdf/download?token=JWT` — GET PDF download
