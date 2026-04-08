# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, DnD-kit
- Backend: FastAPI (Python), Motor (async MongoDB)
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, qrcode, fpdf2, emergentintegrations, pyotp

## Completed Features

### Phase 1-3: Core Platform (DONE)
1-12. Ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification

### Phase 4-5: Deep Enrichments (DONE)
13-29. Workshop/Cabling enrichment, PO/Invoice/Billing overhaul, Billing Command Center, SOC & Security (10 modules), Smart Automation (3 modules)

### Phase 6: Client Onboarding Wizard (DONE)
30. 8-step guided onboarding wizard

### Phase 7: Advanced MSP Module Enrichment (DONE - 2026-03-21)
31-48. All 16+ advanced MSP modules enriched to enterprise-grade

### Phase 8: MSP Command Center Dashboard (DONE - 2026-03-21)
49. Cross-module intelligence hub

### Phase 9: Multi-Tenant Client Portal (DONE - 2026-03-23)
50-59. Full portal SPA at /portal-app with email/password + TOTP 2FA

### Phase 10: Admin Portal User Management (DONE - 2026-03-23)
60. Portal User Management admin page

### Phase 11: Remote Devices Module Rebuild (DONE - 2026-03-24)
61. Complete rebuild with RustDesk ID assignment, quick connect, session history

### Phase 12: Technicians Page Overhaul (DONE - 2026-03-25)
62-67. Edit bug fix, Categories/Roles (9 categories), Archive/Delete system, Quick Stats Strip, Bulk Actions

### Phase 13: Dashboard Redesign (DONE - 2026-04-08)
68. **Clean Dashboard** — Replaced noisy 11-card + 8-tile layout with focused 4-metric design
69. **Attention Banner** — Clickable alerts only showing items needing action (SLA Breaches, Offline Devices, Outstanding, Need Patching, Critical Tickets, Failure Predictions)
70. **Quick Search** — Ctrl+K command palette with ticket/device search + quick actions
71. **Collapsible Insights** — Failure Predictions, Backups, Compliance behind toggle
72. **Auto-refresh** — Dashboard refreshes every 60 seconds

### Phase 14: Patch Management Agent System (DONE - 2026-04-08)
73. **PowerShell Agent Script** — Dynamically generated, deployable alongside RustDesk on client devices
74. **Agent Tab in Patch Hub** — 9th tab showing reporting devices, deploy instructions, script download
75. **Device Reporting API** — POST /api/patch-hub/agent/report (unauthenticated for agents)
76. **Agent Reports Dashboard** — Shows per-device patch status, pending updates, Defender status
77. **One-Line Deploy** — Copy-paste command for technicians to deploy agent on client machines
78. **Windows Service Install** — Script includes Install-AsService function using NSSM

## Prioritized Backlog

### P2
- Workshop Bench View (Kanban drag-and-drop)
- Dispatch Map View (GPS field jobs)
- Workflow Automation Builder (IF/THEN rules)
- Scheduled PDF Reports
- Knowledge Base / Wiki
- Profitability Dashboard
- CRM integrations (Xero, Pax8, Domotz)

### P3
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx into sub-components
- Fix recharts console warnings
- Accessibility fixes (aria-describedby)
- DB query optimization (N+1 patterns in tickets.py, clients.py)

## Authentication
- MSP Admin: aaron@stech.com.au / admin123
- Client Portal: john@acmecorp.com / portal123
