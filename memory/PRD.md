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
- Python SystemRandom across 53+ backend routers
- 150+ Array Index Keys fixed, hook dependencies fixed
- Mutable default args fixed, magic_portal.py secured with secrets.token_urlsafe

### Phase 26: RustDesk Integration Fixes (DONE - 2026-04-10)
- Fixed inverted SSL verify logic across rustdesk.py, yeastar.py, splynx.py, hudu.py, networking.py
- Added server URL normalization (auto-prepend https://)
- Test Connection now tests current form input (not saved config)
- Added RustDesk Server Pro requirement info box
- Fixed missing Switch import that caused blank Remote Devices page

### Phase 27: Module Consolidation (DONE - 2026-04-11)
Merged 13 overlapping pages into 5 unified tabbed pages:
- **Revenue Analytics** = Revenue Tracker + Revenue Tracking (MRR/ARR | Per-Ticket | Cohorts)
- **Predictive Intelligence** = Predictive Failure + Predictive Maintenance (Predictions | Monitoring)
- **SLA Center** = SLA Timer + SLA Penalties + SLA Report Gen (Timers | Penalties | Reports)
- **Backup Center** = Backup Dashboard + Backup Compliance + Backup Verify (Dashboard | Compliance | Verify)
- **Compliance Center** = Compliance + Compliance Frameworks + Compliance Report Gen (Frameworks | Scanner | Reports)

### Phase 28: Tickets & Billing Revamp + Xero Finance Center (DONE - 2026-04-11)
**Finance Center (XeroDashboardPage)**:
- Unified financial hub with 8 tabs: Overview, Invoices, Estimates, Recurring, Contacts, Accounts, Sync Log, Aging
- Overview: Revenue stats, Monthly Revenue chart, Invoice Status pie chart, Collection Rate gauge, Receivables Aging bars, Recent Activity feed
- Invoices: Full CRUD with search, status filter, create/send/pay/void actions
- Estimates: CRUD with convert-to-invoice workflow
- Recurring: Templates with pause/resume toggle, MRR calculation
- Contacts: Xero contact mapping with balance info
- Accounts: Chart of accounts
- Sync Log: Full sync history with trigger sync
- Aging: Aging buckets (Current, 30d, 60d, 90+) with overdue invoices list
- Navigation consolidated: Invoicing + Billing merged under "Finance Center" in Business section

**Ticket Enhancements**:
- Bulk selection checkboxes on every ticket card
- Select All / Deselect All functionality
- Bulk actions bar: Close All, Assign To, Change Priority, Change Status, Add Tag
- SLA Countdown badges on ticket cards with color coding (red/amber/green)
- Quick Template picker dropdown in conversation tab for rapid note insertion

**Backend Additions**:
- `/api/xero/estimates` - Full CRUD + convert to invoice
- `/api/xero/recurring` - CRUD + pause/resume toggle
- `/api/xero/sync-history` - Sync event log
- `/api/xero/sync` - Trigger full sync
- `/api/xero/invoices/{id}/void` - Void invoice
- `/api/xero/invoices/{id}/send` - Send invoice
- `/api/tickets/bulk-action` - Bulk close/assign/priority/status/tag

## Prioritized Backlog

### P2 - Feature Expansion
- Workflow Automation Builder (IF/THEN visual rules engine)
- Knowledge Base / Wiki enhancements
- Scheduled PDF Reports
- CRM integrations (Pax8, Domotz)
- Cross-platform scripting library

### P3 - Tech Debt
- Refactor TicketsPage.jsx (~4000 lines) into sub-components
- Replace wildcard imports (33 files)
- Fix Recharts console width/height warnings
- Add missing aria-describedby for DialogContent accessibility
- Decompose monolithic seed.py and navigation.js
- Bluetooth barcode scanner integration

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123

## Key API Endpoints
- `/api/auth/login`, `/api/auth/microsoft/*`
- `/api/settings/*`, `/api/notifications/*`, `/api/kanban-tickets/*`
- `/api/rustdesk/live/*`, `/api/workshop/bench`, `/api/dispatch/*`
- `/api/xero/*` (Finance Center - invoices, estimates, recurring, contacts, accounts, sync)
- `/api/tickets/bulk-action` (Bulk ticket operations)
- `/api/revenue-tracker/*`, `/api/revenue-tracking/*`
- `/api/predictive-failure/*`, `/api/predictive/*`
- `/api/sla-timer/*`, `/api/sla-penalties/*`, `/api/sla-report-gen/*`
- `/api/backups/*`, `/api/backup-compliance/*`, `/api/backup-verify/*`
- `/api/compliance/*`, `/api/compliance-frameworks/*`, `/api/compliance-generator/*`
