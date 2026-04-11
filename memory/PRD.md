# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, date-fns, DOMPurify
- Backend: FastAPI (Python), Motor (async MongoDB), httpx
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, emergentintegrations, pyotp, httpx

## Completed Features

### Phase 1-23 (DONE)
Full MSP platform: Ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification, SOC & Security, Onboarding, Dashboard, Technicians, Patch Agent, RustDesk live integration, Nav Consolidation, Module Visibility, Microsoft SSO, Global Settings Hub, Email-to-Lead/Ticket, Notifications Revamp, Kanban Board, Workshop Bench, Dispatch Map

### Phase 24-25: Code Quality & Security Hardening (DONE)
- XSS Protection (DOMPurify), SSL verification fix, document.write sanitized
- Secure token storage (secureStorage XOR cipher wrapper)
- Python SystemRandom, hook dependencies, mutable defaults fixed

### Phase 26: RustDesk Integration Fixes (DONE - 2026-04-10)
- Fixed inverted SSL verify logic, URL normalization, test connection

### Phase 27: Module Consolidation (DONE - 2026-04-11)
- Merged 13 overlapping pages into 5 unified tabbed Centers

### Phase 28: Tickets & Billing Revamp + Xero Finance Center (DONE - 2026-04-11)
**Finance Center (XeroDashboardPage)**: 8-tab unified financial hub
- Overview, Invoices (CRUD + email), Estimates (CRUD + convert), Recurring, Contacts, Accounts, Sync Log, Aging
**Ticket Enhancements**: Bulk actions (close/assign/priority/status/tag), SLA countdown badges, Quick Template picker

### Phase 29: Enhanced Recurring Billing + Invoice Email (DONE - 2026-04-11)
**Recurring Billing Module (Enterprise Grade)**:
- KPI dashboard: MRR, ARR, Active Templates, Due for Generation, Total Templates
- 12-Month Revenue Forecast bar chart with escalation projections
- Rich template cards with expand/collapse detail view
- Per-template details: contract period, payment terms, total billed, collection rate, notes, line items breakdown, generated invoice history
- Create/Edit/Delete templates with full fields: frequency (weekly/fortnightly/monthly/quarterly/yearly), payment terms, tax rate, contract dates, annual escalation %, auto-generate/auto-send toggles, billing email, notes
- Generate Now button per template (creates invoice immediately)
- Batch Generate All Due button (bulk invoice creation)
- Search + status filter (active/paused)

**Invoice Email Feature**:
- Email dialog with invoice preview (client, amount, due date, status)
- Recipient email, subject, message fields
- Email button on every invoice in Invoices tab
- Send Reminder button on overdue invoices in Aging tab
- MOCKED email sending (logged to MongoDB, ready for Resend integration)

**Backend Additions**:
- `PUT /api/xero/recurring/{id}` - Edit templates
- `DELETE /api/xero/recurring/{id}` - Delete templates
- `POST /api/xero/recurring/{id}/generate` - Generate invoice from template
- `POST /api/xero/recurring/batch-generate` - Batch generate all due
- `GET /api/xero/recurring/{id}/history` - Generated invoice history
- `GET /api/xero/recurring/forecast` - 12-month forecast + MRR/ARR
- `POST /api/xero/invoices/{id}/email` - Send (mocked) invoice email
- `GET /api/xero/invoices/{id}/emails` - Email history per invoice

## Prioritized Backlog

### P2 - Feature Expansion
- Workflow Automation Builder (IF/THEN visual rules engine)
- Knowledge Base / Wiki enhancements
- Scheduled PDF Reports
- CRM integrations (Pax8, Domotz)
- Cross-platform scripting library

### P3 - Tech Debt
- Refactor TicketsPage.jsx (~4000 lines) into sub-components
- Fix Recharts console width/height warnings
- Add missing aria-describedby for DialogContent accessibility
- Decompose monolithic seed.py and navigation.js

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123

## Key API Endpoints
- `/api/auth/login`, `/api/settings/*`
- `/api/xero/*` (Finance Center - invoices, estimates, recurring, contacts, accounts, sync, email)
- `/api/tickets/*`, `/api/tickets/bulk-action`
- `/api/rustdesk/live/*`

## Mocked Integrations
- Xero accounting (all endpoints use local MongoDB, no live Xero API)
- Email sending (logged to MongoDB, not sent via Resend)
- AI config, dashboard data seeders
