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
61. **Remote Devices Module** — Complete rebuild of the Remote Access page into a comprehensive device management hub:
    - **Server Status Bar** — Live connection indicator with server URL
    - **Quick Connect** — Enter any RustDesk ID and connect instantly, sessions logged
    - **All Devices Table** — 135 devices with name/client/type/OS/status/RustDesk ID/Last Connected columns
    - **Assign ID** — Register any managed device with its RustDesk ID + optional password
    - **Connect Buttons** — One-click remote connect via `rustdesk://` protocol for registered devices
    - **Registered Devices Tab** — Card view of all RustDesk-registered devices with connect
    - **Session History** — Full remote session audit trail
    - **Server Settings** — Configure server URL, API key, relay server
    - **Search & Filters** — By name, hostname, RustDesk ID, client; filter by type and registration status
    - **Backend**: Added GET /api/rustdesk/all-devices (merges devices + rustdesk_devices), PUT /api/rustdesk/assign/{id}, POST /api/rustdesk/quick-connect
    - **Bug Fix**: Previously "ID does not exist" because rustdesk_devices collection was empty and no UI existed to populate it. Now devices are properly linked.

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

## Authentication
- MSP Admin: JWT auth — aaron@stech.com.au / admin123
- Client Portal: JWT portal tokens + TOTP 2FA — john@acmecorp.com / portal123
