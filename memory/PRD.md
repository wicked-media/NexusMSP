# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Core Modules
- **Ticketing**: SLA tickets, workshop jobs, cabling/WISP jobs with full lifecycle
- **RMM/Monitoring**: Device monitoring, agent management, remote access (RustDesk)
- **Invoicing & Billing**: Invoice management, purchase orders, billing command center, revenue tracking
- **Asset Management**: Asset lifecycle, inventory, procurement
- **CRM**: Client management, contacts, addresses, loyalty tracking
- **Networking**: Network maps, zero-trust management, SNMP monitoring
- **Security Operations Center**: Huntress-ready SOC, endpoint security, dark web monitoring, vulnerability scanning, phishing simulation, identity threat detection, ransomware canary, threat timeline
- **Smart Automation**: AI thank-you detection, stale ticket reminders, billing reconciliation
- **Scheduling & Dispatch**: Smart scheduling, dispatch board, on-call management
- **Reporting**: Dashboards, analytics, SLA compliance, revenue reports
- **White Label**: Full branding customization, custom domains
- **Client Portal**: Multi-tenant self-service portal for clients (email/password + 2FA)
- **AI Features**: AI copilot, intelligent routing, voice-to-ticket
- **MSP Command Center**: Cross-module intelligence dashboard aggregating all 16+ advanced modules

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, DnD-kit
- Backend: FastAPI (Python), Motor (async MongoDB)
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, qrcode, fpdf2, emergentintegrations, pyotp

## Completed Features

### Phase 1-3: Core Platform (DONE)
1-12. Full ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification

### Phase 4-5: Deep Enrichments (DONE)
13-29. Workshop/Cabling enrichment, PO/Invoice/Billing overhaul, Billing Command Center, SOC & Security (10 modules), Smart Automation (3 modules)

### Phase 6: Client Onboarding Wizard (DONE)
30. 8-step guided onboarding wizard

### Phase 7: Advanced MSP Module Enrichment (DONE - 2026-03-21)
31-48. All 16+ advanced MSP modules enriched to enterprise-grade UIs (AI Resolution, QBR Generator, Comms Timeline, Tech Utilization, Backup Dashboard, Warranty Tracker, Compliance Frameworks, Client Budget, Vendor Scorecard, SLA Penalties, Alert Suppression, Incident Heatmap, Predictive Failure, Capacity Planner, Auto Documentation, NLP Query, Leaderboard, IT Documentation)

### Phase 8: MSP Command Center Dashboard (DONE - 2026-03-21)
49. Cross-module intelligence hub merged into main dashboard — 8-tile intelligence strip + 3 detail cards (Urgent Failures, Backup Status, Compliance Posture)

### Phase 9: Multi-Tenant Client Portal (DONE - 2026-03-23)
50. **Portal Login** — Email/password authentication with TOTP-based 2FA support
51. **Portal Dashboard** — Client-scoped overview (open tickets, online devices, outstanding invoices, resolved count) + quick links
52. **Portal Tickets** — View all client tickets + create new support tickets from portal
53. **Portal Devices** — Client device fleet with CPU/RAM/Disk usage and online/offline status
54. **Portal Invoices** — Client invoice list with status and amounts
55. **Portal Backups** — Client backup job status with success rate tracking
56. **Portal Compliance** — Framework compliance posture (NIST, CIS, SOC 2, HIPAA)
57. **Portal QBR Reports** — Quarterly business review access
58. **Portal Settings** — Profile management + 2FA setup/disable with QR code provisioning
59. **Portal Layout** — Dark zinc theme, sidebar navigation with MSP branding + client logo spot, user info + sign out

**Backend**: `/api/portal/v2/*` — 15 endpoints (login, verify-2fa, setup-2fa, enable-2fa, disable-2fa, me, update profile, dashboard, tickets GET/POST, devices, invoices, backups, compliance, qbr)
**Frontend**: Self-contained SPA at `/portal-app` with independent auth context
**Test user**: john@acmecorp.com / portal123 (Acme Corporation, client-001)
**Bug fixes**: Fixed Ticket.title and Device.name model defaults that caused 500 errors on /api/tickets and /api/devices

## Prioritized Backlog

### P2
- Workshop Bench View (Kanban)
- Dispatch Map View (GPS)
- CRM integrations (Xero, Pax8, Domotz)
- Workflow Automation Builder (IF/THEN rules)
- Scheduled PDF Reports (auto-generate weekly/monthly)
- Knowledge Base / Wiki for techs
- Profitability Dashboard (revenue vs cost per client)
- Admin portal user management page (invite/remove client portal users from MSP admin)

### P3
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx into sub-components
- Bluetooth barcode scanner integration
- Fix recharts console warnings
- Accessibility fixes (aria-describedby)
- Clean up TEST_ prefixed data from testing

## Mocked Features
- SOC/security data (mock generators)
- AI routing, Voice-to-text (mock)
- Predictive failure predictions (mock ML data)
- NLP query (keyword matching)
- Compliance frameworks (fallback if DB empty)

## Authentication
- MSP Admin: JWT-based custom auth — admin@nexusops.io / admin123
- Client Portal: JWT portal tokens with TOTP 2FA — john@acmecorp.com / portal123
