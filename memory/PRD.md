# NexusOps - Product Requirements Document

## Original Problem Statement
Build a rich and elegant RMM/PSA platform named "NexusOps" that is fully feature-rich and better than competitors like Syncro and Super Ops.

## Tech Stack
- **Frontend**: React + Shadcn/UI + TailwindCSS (dark theme)
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Auth**: JWT-based

---

## Implemented Features

### Phase 1 - Core Platform
- Full auth, Dashboard, Ticketing (CRUD, SLA, ticket numbers INC-XXXX), Client Management, Device Management, Contracts (SLA shields), Invoicing (Xero mock), CRM/Leads, Technician Management, Scheduling, Knowledge Base, Reporting (recharts), Scripting, Networking, Products, IT Docs, Admin, Activity Logs

### Phase 2 - Advanced Modules
- Asset Management, Predictive AI, Real-Time Event Bus, Client Health Radar, O365 Mailbox, White Labeling, Client Loyalty, Device Heartbeat, Ticket Auto-Ping/Escalation

### Phase 3 - Feature Batch (2026-03-17)
- Notification Links Fix, Unified Conversation Tab, Email Notifications w/ PDF, RustDesk Remote Access, Network Device Discovery, Invoice PDF Preview/Print, Invoice List Print, Device Remote Viewer Badge

### Phase 4 - Major Feature Batch (2026-03-18)
- **Invoice PDF Redesign**: Professional branded PDFs with logo, accent colors, gradient header, line items table, payment history, tax summary, branded footer
- **Invoice White Label Logo Fix**: PDFs now correctly pull logos from branding settings
- **Ticket Attachments**: File upload/download/delete on tickets (like Syncro), Files tab in ticket detail
- **Device Chat System**: Full per-device chat with typing indicators, read receipts, message editing/deletion, file attachments, PDF export of chat history
- **Proxmox VM Management**: VM start/stop/reboot/shutdown, backup creation (full/incremental/differential), backup schedules, action logging, 3 node overview
- **Acronis Integration**: Customer sync, subscription tracking (8 service types), usage monitoring, link to NexusOps clients, Acronis MRR display in client Subscriptions tab
- **Gradient MSP**: Billing reconciliation dashboard (matched/under-billed/over-billed), revenue opportunity identification, KPI cards
- **Comprehensive Financial Reporting**: 8 report types - Revenue Summary (MRR/ARR), Profit & Loss, AR Aging, Client Revenue, Service Revenue, Payment Collections, Tax Summary, Monthly Allocations
- **Technician Performance Dashboard**: KPIs per tech (resolution rate, utilization, hours), CSAT survey system
- **Client Satisfaction Surveys**: Auto-send after ticket resolution, NPS scoring

## Active Integrations
- Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend (demo), Multi-LLM (Emergent), O365, RustDesk

## Mocked Integrations
- Xero, Pax8, Domotz, Acronis (simulated), Proxmox (simulated), Gradient MSP (simulated), Resend email

---

## Prioritized Backlog

### P1 - Upcoming
- UniFi Integration Phase 2 (active management)
- Full Xero Integration (real API)
- Device Chat frontend UI (backend complete, frontend chat component pending)
- UI/UX Revamp across all pages
- RustDesk connection validation & full setup

### P2 - Future
- Full backend for Pax8, Domotz (real APIs)
- Client Self-Service Portal
- SLA Breach Alerting
- Automated Backup Reports
- Fix recharts console warnings

### P3 - Refactoring
- Break down large components (TicketsPage, ClientsPage)
- Auto-discover routers in server.py

## Credentials
- Email: admin@nexusops.io
- Password: admin123
