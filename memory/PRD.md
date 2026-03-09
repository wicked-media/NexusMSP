# NexusOps - Ultimate RMM/PSA Platform PRD

## Overview
NexusOps is a comprehensive RMM/PSA platform designed to outdo Syncro, SuperOps, and NinjaRMM.

## Original Problem Statement
Build the ultimate RMM/PSA platform with fully-featured ticketing (parent/child, merging, time tracking, SLA, canned responses, audit log, rich text signatures), client management with multiple contacts, and all MSP integrations.

## What's Been Implemented

### Core Modules
| Module | Status | Key Features |
|--------|--------|--------------|
| Auth | Done | JWT login, registration, roles |
| Dashboard | Done | Stats, charts, alerts, Activity Timeline, **Operational Alerts** (revenue, outstanding, no-notes, SLA breaches, low stock, pending POs) |
| Ticketing | Done | Parent/child hierarchy, merging, timer, time tracking, SLA countdown, tags, canned responses, CC/BCC, internal notes, audit log, rich text signatures, **No-notes auto-escalation** |
| Clients | Done | Multiple contacts per client (primary/billing/technical/general), detail view with tabs |
| Devices/RMM | Done | Monitoring, Chat, Remote |
| Assets | Done | Inventory tracking |
| Reports | Done | 5-tab: Technicians, Tickets, Clients, Revenue, Devices |
| Technicians | Done | CRUD, overview cards with stats, detail dashboard, specialties, no-notes tracking, **clickable ticket rows** |
| Scheduling | Done | Weekly calendar view, time slots, unscheduled ticket queue, technician assignment |
| **Products** | Done | Full catalog CRUD, categories, vendor tracking, cost/retail pricing, stock management, recurring billing, low stock alerts |
| **Purchase Orders** | Done | Full PO workflow (draft->submitted->received->cancelled), line items from product catalog, vendor management, tax/shipping calculations |
| **Invoices (Enhanced)** | Done | **Product-to-invoice linking**, Stripe payments, manual payment recording, **Paid (GREEN)/Not Paid (RED)** badges, payment history, tax rate, balance tracking |
| **Settings (Enhanced)** | Done | **No-Notes Escalation Threshold** (configurable hours, escalate-to senior), **Xero integration settings**, **Stripe status** |

### Stripe Integration
- Stripe Checkout for online invoice payments
- Manual payment recording (cash, bank transfer, check, credit card offline)
- Payment history per invoice
- Automatic status updates: unpaid → partial → paid
- Webhook support for payment confirmation

### Xero Integration (Settings Only)
- Settings page to configure Xero Client ID, Client Secret, Redirect URI
- Ready for OAuth flow implementation when user provides credentials

### No-Notes Escalation Threshold
- Configurable in Settings → enable/disable toggle
- Set threshold in hours (e.g., 24h)
- Select senior member to escalate to
- Auto-reassigns tickets with zero notes after threshold period
- Marks escalated tickets as high priority
- Adds audit log entry with escalation reason

### Dashboard Operational Alerts
- Revenue / Outstanding / No-Notes / SLA Breaches / Low Stock / Pending POs
- Clickable cards navigate to respective pages
- Real-time data from enhanced-stats endpoint

## Technical Architecture
```
Backend: FastAPI + MongoDB (~6200 lines server.py)
Frontend: React + Tailwind + Shadcn + TipTap + Recharts
Integrations: Stripe (emergentintegrations), Xero (settings only)
Pages: 27+ pages, 100+ API endpoints
```

## Demo Credentials
- Email: admin@nexusops.io, Password: admin123

## Prioritized Backlog

### P0 - Critical
- Refactor server.py into /routers, /models, /services (6200+ lines is unmaintainable)

### P1 - Phase 2 (Operations Polish)
- Time Tracking: Running timer widget, weekly timesheet, approval workflow, billable breakdown
- Assets: Lifecycle management, warranty linking, depreciation tracking
- Scheduling: Drag-drop improvements, technician availability, recurring appointments
- Devices: Enhanced monitoring dashboard, bulk actions, OS breakdown charts

### P1 - Phase 3 (Communication & Knowledge)
- Email: Threaded inbox view, templates, email-to-ticket conversion
- Knowledge Base: Rich text articles, categories/tags, search, public vs internal
- IT Documentation: Password vault with encryption, network docs, runbooks
- Leads/CRM: Pipeline/Kanban view, deal stages, conversion tracking

### P2 - Phase 4 (Advanced & Settings)
- Reports: Custom date ranges, export options, more chart types
- Projects: Kanban board, Gantt-style timeline, task dependencies
- Expiry Tracker: Unified warranty/license/domain/SSL dashboard
- Xero OAuth flow implementation (when user provides credentials)
- Real Office 365 email integration

### P3 - Future
- Client self-service portal
- PDF export for invoices/proposals
- RBAC, SSO/SAML
- AI ticket categorization
- Mobile responsive improvements

## Test Results
- Backend: 100% (18/18 in iteration 8)
- Frontend: 100% (all flows verified in iteration 8)
- Last tested: March 2026, iteration 8
