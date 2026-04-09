# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, date-fns
- Backend: FastAPI (Python), Motor (async MongoDB), httpx
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, emergentintegrations, pyotp, httpx

## Completed Features

### Phase 1-16: Core Platform through Navigation (DONE)
Ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification, Workshop/Cabling, PO/Invoice/Billing, SOC & Security, Smart Automation, Onboarding, 16+ MSP modules, Dashboard, Portal, Technicians, Patch Agent, RustDesk, Nav Consolidation, Module Visibility

### Phase 17: Microsoft OAuth2 SSO (DONE - 2026-04-09)
PKCE OAuth2 flow, login button, callback handler, admin SSO config in Settings

### Phase 18: Global Settings Hub & Email-to-Lead (DONE - 2026-04-09)
6-tab Settings, O365 Mailbox inline, email-to-ticket for known clients, email-to-lead for unknowns

### Phase 19: Notifications Revamp (DONE - 2026-04-09)
Dedicated /notifications page, search/filter/group, 6+ types, mark read/delete/bulk, bell "View All"

### Phase 20: Kanban Board (DONE - 2026-04-09)
HTML5 drag-and-drop 5-column ticket board, SLA badges, priority filter, optimistic updates

### Phase 21: Live RustDesk Integration (DONE - 2026-04-09)
Test connection, live peers, sync to DB, audit logs, LIVE badges, auto-polling every 5 min

### Phase 22: Workshop Bench (DONE - 2026-04-09)
- 6-column Kanban: Intake → Diagnosing → Parts Ordered → Repairing → Testing/QA → Ready for Pickup
- Drag-and-drop job cards with job numbers (WS-XXXXX), client/device info, age badges
- New Job dialog, search, auto turnaround stats
- Backend: /api/workshop/bench CRUD + /api/workshop/bench/move

### Phase 23: Dispatch Map View (DONE - 2026-04-09)
- Visual map view with positioned tech markers (green=available, blue=active, red=busy)
- Unassigned job markers (amber pulse), hover tooltips
- Smart Assignment Suggestions with one-click Assign
- Map/Table view toggle, 4-stat bar
- Technician status grid with capacity tracking
- Backend: /api/dispatch/board with AI suggestions + /api/dispatch/assign

## Prioritized Backlog

### P2 — Feature Expansion
- Workflow Automation Builder (IF/THEN visual rules engine)
- Knowledge Base / Wiki
- Scheduled PDF Reports
- CRM integrations (Xero, Pax8, Domotz)

### P3 — Tech Debt
- Refactor TicketsPage.jsx (3893 lines)
- Fix recharts console warnings
- DB N+1 query optimization
- Decompose seed.py

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123

## Key API Endpoints
- `/api/auth/login`, `/api/auth/microsoft/*`
- `/api/settings/microsoft-sso`, `/api/settings/o365-mailbox`
- `/api/notifications/*`, `/api/kanban-tickets/*`
- `/api/rustdesk/live/*` (test-connection, peers, sync, audit)
- `/api/workshop/bench`, `/api/workshop/bench/move`
- `/api/dispatch/board`, `/api/dispatch/assign`
