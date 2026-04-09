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
85-90. Reduced 130+ sidebar items to ~35 clean modules in 7 groups, collapsible sub-menus, module visibility toggle per technician

### Phase 17: Microsoft OAuth2 SSO (DONE - 2026-04-09)
91. **Backend SSO Router** (`microsoft_sso.py`) - PKCE OAuth2 flow with state validation, token exchange via Microsoft Graph API, auto user creation
92. **Login Page SSO Button** - "Sign in with Microsoft" with Windows logo, conditionally shown when SSO enabled
93. **Auth Callback Page** (`AuthCallbackPage.jsx`) - Handles redirect from Microsoft, processes JWT token
94. **Settings Page SSO Config** - Admin panel to configure Azure AD Tenant ID, Client ID, Client Secret, Redirect URI, auto-create users toggle, default role
95. **Public SSO Status API** - `/api/settings/microsoft-sso/status` (no auth) for login page to check if SSO is enabled
96. **loginWithToken** method added to AuthProvider for SSO token consumption

## Prioritized Backlog

### P1 — Release Readiness (Next Up)
- Email-to-Lead (configurable mailbox auto-generates leads) — backend exists (`o365_mailbox.py`), review/polish needed
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
- aria-describedby for DialogContent components

## Authentication
- MSP Admin: aaron@stech.com.au / admin123
- Client Portal: john@acmecorp.com / portal123
- Microsoft SSO: Configure in Settings > Microsoft SSO (requires Azure AD App Registration)

## Key API Endpoints
- `/api/auth/login` - Standard JWT login
- `/api/auth/microsoft/login` - Microsoft SSO initiation (redirect)
- `/api/auth/microsoft/callback` - Microsoft SSO callback handler
- `/api/settings/microsoft-sso` - SSO configuration (admin)
- `/api/settings/microsoft-sso/status` - Public SSO status check
- `/api/technicians/{id}/modules` - Toggle UI visibility
- `/api/patch-hub/agent/deploy` - Patch agent deployment
- `/api/portal_v2/*` - Client portal
- `/api/rustdesk/*` - Remote access

## Architecture
```
/app/backend/app/routers/microsoft_sso.py  # Microsoft OAuth2 SSO
/app/frontend/src/pages/AuthCallbackPage.jsx  # SSO callback handler
/app/frontend/src/pages/LoginPage.jsx  # Login with SSO button
/app/frontend/src/pages/SettingsPage.jsx  # SSO config section
/app/frontend/src/App.js  # AuthProvider with loginWithToken
```
