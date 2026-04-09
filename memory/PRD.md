# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, DnD-kit, date-fns
- Backend: FastAPI (Python), Motor (async MongoDB)
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, qrcode, fpdf2, emergentintegrations, pyotp, httpx

## Completed Features

### Phase 1-16: Core Platform through Navigation (DONE)
Ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification, Workshop/Cabling, PO/Invoice/Billing, SOC & Security, Smart Automation, Onboarding wizard, 16+ advanced MSP modules, Command Center Dashboard, Multi-tenant portal, admin user mgmt, RustDesk rebuild, Technicians overhaul, Dashboard redesign, Patch Agent system, Auto-deploy via RustDesk, Navigation consolidation (130+ → ~35 items), Module visibility toggles

### Phase 17: Microsoft OAuth2 SSO (DONE - 2026-04-09)
- PKCE OAuth2 flow, "Sign in with Microsoft" button, Auth callback page
- Admin SSO config in Settings (Tenant/Client ID, Secret, auto-create users, default role)

### Phase 18: Global Settings Hub & Email-to-Lead (DONE - 2026-04-09)
- 6-tab Settings layout: General, Authentication, Mailbox & Email, Integrations, AI, Notifications
- O365 Mailbox inline config with email routing rules
- Email-to-ticket for known clients, email-to-lead for unknowns

### Phase 19: Notifications Revamp (DONE - 2026-04-09)
- Dedicated `/notifications` page with search, type/severity/read filters, grouped by date
- Enhanced notification types: SLA breach, SLA warning, contract renewal, device offline, ticket assigned, new lead
- Mark read/unread, delete, bulk actions
- Sidebar bell dropdown with "View All Notifications" link

### Phase 20: Kanban Board Upgrade (DONE - 2026-04-09)
- Full drag-and-drop ticket board (5 columns: Open, In Progress, Waiting, Resolved, Closed)
- HTML5 native DnD with optimistic updates
- SLA countdown badges, priority filters, search, ticket cards with client/assignee info
- Drop zone highlighting during drag

## Prioritized Backlog

### P0 — Next Up (User Requested)
- Devices module review & enhancement
- Remote Access (RustDesk) with live data integration

### P2 — Feature Expansion
- Workshop Bench View (Kanban drag-and-drop for repairs)
- Dispatch Map View (GPS field jobs)
- Workflow Automation Builder (IF/THEN rules)
- Scheduled PDF Reports
- Knowledge Base / Wiki
- CRM integrations (Xero, Pax8, Domotz)

### P3 — Tech Debt
- Decompose monolithic seed.py
- Refactor TicketsPage.jsx (3893 lines) into sub-components
- Fix recharts console warnings (recurring)
- DB query optimization (N+1 patterns)

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123
- Microsoft SSO: Configure in Settings > Authentication tab

## Key API Endpoints
- `/api/auth/login`, `/api/auth/microsoft/login`, `/api/auth/microsoft/callback`
- `/api/settings/microsoft-sso`, `/api/settings/o365-mailbox`
- `/api/o365/webhook/incoming-email` — Email → Lead/Ticket
- `/api/notifications`, `/api/notifications/generate`, `/api/notifications/mark-read`, `/api/notifications/delete`
- `/api/kanban-tickets/board`, `/api/kanban-tickets/move`
- `/api/devices`, `/api/rustdesk/*`
