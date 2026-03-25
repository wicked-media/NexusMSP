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
49. Cross-module intelligence hub — 8-tile strip + 3 detail cards

### Phase 9: Multi-Tenant Client Portal (DONE - 2026-03-23)
50-59. Full portal SPA at /portal-app with email/password + TOTP 2FA, 8 client-scoped views

### Phase 10: Admin Portal User Management (DONE - 2026-03-23)
60. Portal User Management admin page with full CRUD, by-client view, permissions

### Phase 11: Remote Devices Module Rebuild (DONE - 2026-03-24)
61. Complete rebuild with RustDesk ID assignment, quick connect, session history, server settings

### Phase 12: Technicians Page Overhaul (DONE - 2026-03-25)
62. **Edit Bug Fix** — Edit dialog now opens immediately from technician detail view (was only appearing after clicking Back)
63. **Categories/Roles** — 9 categories (SLA, Workshop, Cabling, Network, WISP, Field Service, Security, Cloud, Helpdesk) with color-coded badges, toggle selectors, and category filter
64. **Archive/Delete System** — Archive (soft-deactivate, preserves history, restorable), Permanent Delete (with confirmation dialog), Active/Archived toggle view
65. **Quick Stats Strip** — 5-metric dashboard strip (Active Techs, On Call Now, Overdue Tickets, Open Tickets, Avg Hours/Week)
66. **Bulk Actions** — Checkbox selection, bulk Archive, bulk Set Categories, bulk Restore/Delete for archived techs
67. **Backend Endpoints** — POST /api/technicians/{id}/archive, POST /api/technicians/{id}/restore, POST /api/technicians/bulk-action

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
- Implement /api/client-portal/access-logs endpoint
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx into sub-components
- Fix recharts console warnings
- Accessibility fixes
- DB query optimization (N+1 patterns in tickets.py, clients.py)

## Authentication
- MSP Admin: aaron@stech.com.au / admin123
- Client Portal: john@acmecorp.com / portal123
