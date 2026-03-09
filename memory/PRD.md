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
| Dashboard | Done | Stats, charts, alerts, Activity Timeline |
| Ticketing | Done | Parent/child hierarchy, merging, timer, time tracking, SLA countdown, tags, canned responses, CC/BCC, internal notes, audit log, rich text signatures |
| Clients | Done | Multiple contacts per client (primary/billing/technical/general), detail view with tabs |
| Devices/RMM | Done | Monitoring, Chat, Remote |
| Assets | Done | Inventory tracking |
| Reports | Done | 5-tab: Technicians, Tickets, Clients, Revenue, Devices |
| **Technicians** | Done | CRUD, overview cards with stats, detail dashboard, specialties, no-notes tracking |
| **Scheduling** | Done | Weekly calendar view, time slots, unscheduled ticket queue, technician assignment |
| **Products** | Done | Full catalog CRUD, categories, vendor tracking, cost/retail pricing, stock management, recurring billing, low stock alerts |
| **Purchase Orders** | Done | Full PO workflow (draft->submitted->received->cancelled), line items from product catalog, vendor management, tax/shipping calculations |
| + 15 more modules | Done | See full list below |

### Ticket System Features (Competitor Beating)
- Click-into detail view with full context
- Parent/child ticket hierarchy (create, link, navigate)
- Ticket merging (combine duplicates, transfer notes/emails)
- Live timer + manual time logging (billable/non-billable)
- SLA countdown with visual urgency indicator
- Tags/labels system
- Internal vs public notes
- Canned response templates (CRUD + quick insert)
- CC/BCC on email composition
- Rich text email signatures (TipTap editor)
- Full audit trail (status changes, time logged, merges, child creation)
- Status/Priority/Assigned/Category dropdowns in detail sidebar
- Search and multi-filter (status + priority)
- **No-notes tracking** - clickable from Technician dashboard to navigate to tickets

### Client System Features
- Multiple contacts per client (primary, billing, technical, general roles)
- Contact cards with avatar, role badge, email, phone
- Client detail view with 4 tabs (Contacts, Tickets, Devices, Contracts)
- Summary cards (MRR, ticket count, device count, contacts, contracts)
- Client info sidebar with all details
- Edit/delete contacts inline

### Products & Procurement (NEW - March 2026)
- **Products Catalog**: Full CRUD with categories, SKU, vendor, cost/retail pricing
- Inventory tracking with stock levels, reorder alerts, low stock warnings
- Recurring product support (monthly/quarterly/annually billing cycles)
- Tax rate management per product
- Category filtering, search, sortable columns
- Detail view with margin calculations and inventory stats
- **Purchase Orders**: Draft/Submitted/Received/Cancelled workflow
- Line items linked to product catalog with auto-pricing
- Vendor management with contact and email
- Tax and shipping calculations
- Client association (optional)
- Stats dashboard with total value and pending value

### All Integrations (MOCKED until credentials provided)
Office 365, Acronis, RustDesk, Domotz, Pax8, Proxmox

## Technical Architecture
```
Backend: FastAPI + MongoDB (~5900 lines server.py)
Frontend: React + Tailwind + Shadcn + TipTap + Recharts
Pages: 27+ pages, 90+ API endpoints
```

## Demo Credentials
- Email: admin@nexusops.io, Password: admin123

## Prioritized Backlog

### P0 - Critical
- Refactor server.py into /routers, /models, /services (5900+ lines is unmaintainable)

### P1 - High Priority
- Real Office 365 email integration (Azure AD OAuth)
- File attachments on ticket notes
- Watchers implementation (notify other techs)
- Custom fields per ticket

### P2 - Medium Priority
- Client self-service portal
- PDF export for invoices/proposals
- RBAC, SSO/SAML
- Mobile responsive improvements
- IT documentation/password vault completion

### P3 - Nice to Have
- AI ticket categorization
- Slack/Teams notifications
- Dark/Light theme toggle

## Test Results
- Backend: 100% (21/21 in iteration 7)
- Frontend: 100% (all flows verified in iteration 7)
- Last tested: March 2026, iteration 7
