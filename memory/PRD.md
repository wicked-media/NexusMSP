# NexusOps - Product Requirements Document

## Original Problem Statement
Build a rich and elegant RMM/PSA platform named "NexusOps" that is fully feature-rich and better than competitors like Syncro and Super Ops. The application incorporates a mix of the best features from other platforms while also introducing unique capabilities.

## Core Vision
A comprehensive, feature-rich platform to surpass competitors, including modules for Ticketing, Client Management, Scripting, Reporting, Invoicing, CRM, Device Management, Remote Access, and more.

## Tech Stack
- **Frontend**: React + Shadcn/UI + TailwindCSS (dark theme)
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Auth**: JWT-based

## User Personas
- MSP Technicians (primary users)
- MSP Administrators
- Clients (future portal)

---

## Implemented Features

### Phase 1 - Core Platform
- Full auth system (login/register)
- Dashboard with real-time stats, SLA countdown, device fleet overview
- Ticketing system (CRUD, assignments, priorities, SLA tracking, ticket numbers INC-XXXX)
- Client management (CRUD, contacts, detail views, M365 users, Splynx integration)
- Device management (CRUD, status monitoring, bulk actions)
- Contracts management with SLA shield icons (Gold/Silver/Bronze)
- Invoicing with Xero sync (mocked)
- CRM / Leads module with conversion to client & ticket
- Technician management & scheduling
- Knowledge Base
- Reporting with charts (recharts)
- Scripting module
- Networking module
- Products module
- IT Documentation
- Admin settings
- Activity logs

### Phase 2 - Advanced Modules
- Asset Management module
- Predictive AI Maintenance module
- Real-Time Event Bus module
- Client Health Radar module
- O365 Mailbox Settings (email-to-lead)
- White Labeling system (custom logos, branding, primary colors)
- Client Loyalty system with tenure achievements dashboard
- Device heartbeat endpoint for real-time RMM status
- Ticket auto-ping and escalation system

### Phase 3 - Feature Batch (2026-03-17)
- **Notification Links Fix**: Fixed broken notification click navigation - now correctly routes to /tickets, /contracts, /devices based on ref_type
- **Unified Conversation Tab**: Merged separate Notes and Emails tabs into single "Conversation" tab with dropdown selector (Internal Note vs Public Email), chronological timeline
- **Email Notifications with PDF**: Branded PDF generation of ticket conversation history, client notification emails with PDF attachment, PDF download button
- **RustDesk Remote Access**: Full CRUD for RustDesk device configs per client, Remote tab on client detail, connection initiation (rustdesk:// protocol), session logging
- **Network Device Discovery**: Simulated network scan by client/subnet, discovered device list with one-click import, duplicate detection, scan history

## Active Integrations
- Stripe (payments)
- TipTap (rich text editing)
- Recharts (charts)
- @dnd-kit/core (drag and drop)
- Splynx (ISP integration)
- Hudu (documentation)
- Resend (email - demo mode)
- Multi-LLM via Emergent LLM Key
- Office 365 (email-to-lead)
- RustDesk (remote access - protocol handler)

## Mocked Integrations
- Xero (invoicing)
- Pax8 (vendor management)
- Domotz (network monitoring)
- Acronis (backup)
- Proxmox (virtualization)
- Resend email sending (demo mode - placeholder API key)
- Device discovery (simulated scan)

---

## Prioritized Backlog

### P1 - Upcoming
- Full UniFi Integration Phase 2 (active management: provisioning, port profiles)
- Full Xero Integration (real API, not mocked)

### P2 - Future
- Full backend for mocked integrations (Pax8, Domotz, Acronis, Proxmox)
- Database seeding mechanism
- Client self-service portal
- Fix recharts console warnings on Reports page

### P3 - Nice to Have
- Break down large components (TicketsPage, ClientsPage) into sub-components
- Auto-discover routers in server.py

## Credentials
- Email: admin@nexusops.io
- Password: admin123
