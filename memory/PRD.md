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
68-72. Clean 4-metric design, Attention Banner, Ctrl+K Quick Search, Collapsible Insights, Auto-refresh

### Phase 14: Patch Management Agent System (DONE - 2026-04-08)
73-78. PowerShell agent script, Agent tab in Patch Hub, Device reporting API, Agent reports dashboard, One-line deploy, Windows service install

### Phase 15: Auto-Deploy Agent via RustDesk (DONE - 2026-04-08)
79. **Deploy Agent Button** — Per-device "Deploy" button in Remote Devices table queues deployment + shows PowerShell command dialog
80. **Bulk Deploy** — Select multiple devices via checkboxes, deploy agent to all at once
81. **Agent Deployments Tab** — New tab in Remote Devices showing deployment stats (Total/Pending/Deployed/Failed) and full deployment tracker table
82. **Mark Deployed** — Techs confirm deployment completion after running the script via RustDesk
83. **Deploy Command Dialog** — Shows the PowerShell command with copy button and step-by-step instructions
84. **Agent Status Column** — Device table shows Deploy/Pending/Deployed status badges per device

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
