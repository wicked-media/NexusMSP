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
13-29. Workshop/Cabling, PO/Invoice/Billing, Billing Command Center, SOC & Security (10 modules), Smart Automation (3 modules)

### Phase 6-8: Onboarding, MSP Modules, Dashboard (DONE)
30-49. Onboarding wizard, 16+ advanced MSP modules, Command Center Dashboard

### Phase 9-11: Portal, Admin, Remote Devices (DONE)
50-61. Multi-tenant portal, admin user mgmt, RustDesk rebuild

### Phase 12: Technicians Page Overhaul (DONE - 2026-03-25)
62-67. Edit bug fix, Categories, Archive/Delete, Quick Stats, Bulk Actions

### Phase 13: Dashboard Redesign (DONE - 2026-04-08)
68-72. Clean 4-metric design, Attention Banner, Ctrl+K Quick Search, Collapsible Insights

### Phase 14: Patch Agent System (DONE - 2026-04-08)
73-78. PowerShell agent, Agent tab, Device reporting API, One-line deploy

### Phase 15: Auto-Deploy Agent via RustDesk (DONE - 2026-04-08)
79-84. Per-device deploy button, Bulk deploy, Deployments tab, Mark deployed, Agent status column

### Phase 16: Navigation Consolidation & Module Toggle (DONE - 2026-04-08)
85. **Navigation Consolidation** — Reduced 130+ sidebar items to ~35 clean modules in 7 groups with collapsible sub-menus
86. **Sidebar Groups**: Service Desk, Infrastructure, Business, Security, AI & Intelligence, Reports & Comms, Platform
87. **Collapsible Sub-Menus** — Click parent to expand children, auto-expands current route's parent
88. **Module Search** — Type-ahead search across all modules in sidebar (Ctrl+K)
89. **Module Visibility Toggle** — Admins can toggle which sidebar groups each technician sees (7 switches in Permissions dialog)
90. **Backend Support** — `enabled_modules` array saved per user, returned in login response, filtered in sidebar

## Prioritized Backlog

### P1 — Release Readiness (Next Up)
- Microsoft SSO (OAuth2 one-click sign-in)
- Email-to-Lead (configurable mailbox auto-generates leads)
- Global Settings page (centralized mailbox, integrations, module visibility, branding)

### P2 — Feature Expansion
- Workshop Bench View (Kanban drag-and-drop)
- Dispatch Map View (GPS field jobs)
- Workflow Automation Builder (IF/THEN rules)
- Scheduled PDF Reports
- Knowledge Base / Wiki
- Profitability Dashboard
- CRM integrations (Xero, Pax8, Domotz)

### P3 — Tech Debt
- Decompose monolithic seed.py
- Refactor TicketsPage.jsx into sub-components
- Fix recharts console warnings
- DB query optimization (N+1 patterns)

## Authentication
- MSP Admin: aaron@stech.com.au / admin123
- Client Portal: john@acmecorp.com / portal123
