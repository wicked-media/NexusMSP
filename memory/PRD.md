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
Dedicated `/notifications` page, search/filter/group, 6+ notification types, mark read/delete/bulk, bell "View All" link

### Phase 20: Kanban Board (DONE - 2026-04-09)
HTML5 drag-and-drop 5-column board, SLA badges, priority filter, optimistic updates

### Phase 21: Live RustDesk Integration (DONE - 2026-04-09)
- **Test Connection** — `/api/rustdesk/live/test-connection` probes RustDesk server API
- **Live Peers** — `/api/rustdesk/live/peers` fetches real peer data (ID, hostname, OS, online/offline, version)
- **Sync to DB** — `/api/rustdesk/live/sync` matches peers to devices, creates new entries, updates status
- **Audit Logs** — `/api/rustdesk/live/audit` fetches session history from RustDesk server
- **UI** — Connection status bar with Test/Sync buttons, Live Online stat, Live Peers tab, LIVE badge on device status, API setup instructions in Settings dialog

## Prioritized Backlog

### P2 — Feature Expansion
- Workshop Bench View (Kanban for repairs)
- Dispatch Map View (GPS field jobs)
- Workflow Automation Builder (IF/THEN rules)
- Knowledge Base / Wiki
- CRM integrations (Xero, Pax8, Domotz)

### P3 — Tech Debt
- Refactor TicketsPage.jsx (3893 lines)
- Fix recharts console warnings
- DB N+1 query optimization
- Decompose seed.py

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123
- Microsoft SSO: Settings > Authentication tab

## Key API Endpoints
- `/api/auth/login`, `/api/auth/microsoft/*`
- `/api/settings/microsoft-sso`, `/api/settings/o365-mailbox`
- `/api/notifications/*`, `/api/kanban-tickets/*`
- `/api/rustdesk/live/test-connection`, `/api/rustdesk/live/peers`
- `/api/rustdesk/live/sync`, `/api/rustdesk/live/audit`
- `/api/rustdesk/config`, `/api/rustdesk/all-devices`
