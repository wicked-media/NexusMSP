# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, DnD-kit
- Backend: FastAPI (Python), Motor (async MongoDB)
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, qrcode, fpdf2, emergentintegrations, pyotp, httpx

## Completed Features

### Phase 1-3: Core Platform (DONE)
Ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification

### Phase 4-8: Deep Enrichments, MSP Modules, Dashboard (DONE)
Workshop/Cabling, PO/Invoice/Billing, SOC & Security, Smart Automation, Onboarding wizard, 16+ advanced MSP modules, Command Center Dashboard

### Phase 9-11: Portal, Admin, Remote Devices (DONE)
Multi-tenant portal, admin user mgmt, RustDesk rebuild

### Phase 12-16: Technicians, Dashboard, Patch, Nav, Module Toggle (DONE)
Technicians overhaul, Dashboard redesign, Patch Agent system, Auto-deploy via RustDesk, Navigation consolidation, Module visibility toggles

### Phase 17: Microsoft OAuth2 SSO (DONE - 2026-04-09)
- Backend PKCE OAuth2 flow (`microsoft_sso.py`) with state validation, token exchange, auto user creation
- "Sign in with Microsoft" button on login page (conditionally shown)
- Auth callback page, public SSO status API
- Admin SSO config in Settings (Tenant ID, Client ID, Client Secret, Redirect URI, Auto-create users, Default role)

### Phase 18: Global Settings Hub & Email-to-Lead Enhancement (DONE - 2026-04-09)
- Converted Settings page to 6-tab layout: General, Authentication, Mailbox & Email, Integrations, AI & Automation, Notifications
- Pulled O365 Mailbox config inline into Settings → Mailbox & Email tab (connection status, Azure AD setup, email routing rules, test email, lead preview)
- Enhanced email webhook to support email-to-ticket: known client emails create support tickets, unknown emails create leads
- Email routing rules: toggle email-to-lead, email-to-ticket, and auto-reply independently

## Prioritized Backlog

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
- Fix recharts console warnings (recurring)
- DB query optimization (N+1 patterns)
- aria-describedby for DialogContent components

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123
- Microsoft SSO: Configure in Settings > Authentication tab

## Key API Endpoints
- `/api/auth/login` - Standard JWT login
- `/api/auth/microsoft/login` - Microsoft SSO initiation
- `/api/auth/microsoft/callback` - Microsoft SSO callback
- `/api/settings/microsoft-sso` - SSO config (admin)
- `/api/settings/microsoft-sso/status` - Public SSO check
- `/api/settings/o365-mailbox` - Mailbox config
- `/api/o365/connect` / `/api/o365/disconnect` - Mailbox connection
- `/api/o365/webhook/incoming-email` - Email → Lead/Ticket webhook
- `/api/o365/email-leads` - Email-generated leads list
- `/api/technicians/{id}/modules` - Toggle UI visibility
- `/api/patch-hub/agent/deploy` - Patch agent deployment
