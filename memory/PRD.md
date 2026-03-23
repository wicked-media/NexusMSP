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
31-48. All 16+ advanced MSP modules enriched (AI Resolution, QBR Generator, Comms Timeline, Tech Utilization, Backup Dashboard, Warranty Tracker, Compliance Frameworks, Client Budget, Vendor Scorecard, SLA Penalties, Alert Suppression, Incident Heatmap, Predictive Failure, Capacity Planner, Auto Documentation, NLP Query, Leaderboard, IT Documentation)

### Phase 8: MSP Command Center Dashboard (DONE - 2026-03-21)
49. Cross-module intelligence hub — 8-tile strip + 3 detail cards (Urgent Failures, Backup Status, Compliance Posture)

### Phase 9: Multi-Tenant Client Portal (DONE - 2026-03-23)
50-59. Full portal SPA at `/portal-app` with email/password + TOTP 2FA, 8 client-scoped views (Dashboard, Tickets+Create, Devices, Invoices, Backups, Compliance, QBR, Settings), dark zinc theme, MSP branding + client logo spot
- Backend: `/api/portal/v2/*` — 15 endpoints
- Test user: john@acmecorp.com / portal123 (Acme Corporation)

### Phase 10: Admin Portal User Management (DONE - 2026-03-23)
60. **Portal User Management Admin Page** — Full CRUD for portal users from MSP admin panel
    - Stats dashboard (Total Users, Active, With 2FA, Clients)
    - User table with search + client filter, permissions icons, 2FA status, last login, active/inactive toggle
    - Invite User dialog (client selector, name, email, password, role, 4 permission toggles, primary contact flag)
    - Edit User dialog (name, phone, role, status, permissions)
    - Reset Password dialog
    - Delete user with confirmation
    - By Client tab (grouped cards + "Clients Without Portal Access" with quick-invite)
    - Activity Log tab
    - Copy Portal Link button

## Prioritized Backlog

### P2
- Workshop Bench View (Kanban drag-and-drop)
- Dispatch Map View (GPS field jobs)
- Workflow Automation Builder (IF/THEN rules)
- Scheduled PDF Reports (auto-generate weekly/monthly)
- Knowledge Base / Wiki for techs
- Profitability Dashboard (revenue vs cost per client)
- CRM integrations (Xero, Pax8, Domotz)

### P3
- Implement /api/client-portal/access-logs endpoint for Activity Log
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx into sub-components
- Bluetooth barcode scanner
- Fix recharts console warnings
- Accessibility fixes (aria-describedby)

## Authentication
- MSP Admin: JWT auth — admin@nexusops.io / admin123
- Client Portal: JWT portal tokens with TOTP 2FA — john@acmecorp.com / portal123
