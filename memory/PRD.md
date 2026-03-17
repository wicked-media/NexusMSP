# NexusOps - RMM/PSA Platform PRD

## Original Problem Statement
Build a "rich and elegant RMM/PSA like Syncro and Super Ops" named "NexusOps" - fully feature-rich, better than competition.

## Core Architecture
- **Backend**: FastAPI + MongoDB | **Frontend**: React + Shadcn/UI + TailwindCSS | **Auth**: JWT-based

## What's Been Implemented

### Core Modules
Dashboard, Ticketing (SLA, child tickets, merging, progress tracker, viewer tracking, auto-ping, escalation), Client Mgmt (health scores, timeline, achievements, readiness, loyalty), Device Mgmt (bulk actions, RMM heartbeat), Asset Mgmt + Lifecycle, Contract Mgmt (SLA shields), Invoice, Time Tracking, Knowledge Base (Hudu sync), Scripting, CRM/Leads, Remote Access, Reporting, IT Docs, Email + O365 Setup, Scheduling, Technician Mgmt, Vendor/Rental Mgmt, Project Mgmt, Admin Settings, Notifications, Purchase Orders, Products, Networking (UniFi), Infrastructure, White Label & Branding, Loyalty Dashboard, Predictive Maintenance AI, Health Radar, Event Bus

### Session Changes (March 17, 2026)

**Batch 1:** Leads bug fix, O365 mailbox setup, Email-to-Lead, Asset Lifecycle, Predictive Maintenance AI, Event Bus, Health Radar, Ticket number badges, Viewer tracking, Enhanced progress bar

**Batch 2:** Button color swap (Create Ticket=green, Convert=purple), White Label/Branding, SLA Shields, Client Tenure Achievements, Loyalty Dashboard, Auto-Renewal Proposals, Portal Readiness Score

**Batch 3:**
1. **RMM Device Heartbeat** - Real-time reporting: CPU, RAM, disk, OS, IP, uptime, hardware, security status, logged-in user, patches. Fields map correctly to Device model.
2. **Smart Ticket Auto-Ping** - Auto-notify team by category (workshop, retail, network, etc.) and SLA/priority when tickets created. Pings until picked up.
3. **24-Hour Auto-Escalation** - Unassigned tickets auto-escalate to senior staff/admin after configurable timeout
4. **Ticket Ping & Escalation Settings** - Full config page: ping interval, escalation timeout, category→team mapping, SLA→team mapping, escalation contacts
5. **Enhanced Viewer Badge** - Cyan/purple gradient shimmer with ping animation, viewer count badge (1 viewer = eye icon, 2+ = count), viewer names shown

## Key API Endpoints (New - Batch 3)
- `POST /api/devices/{id}/heartbeat` - RMM agent real-time reporting
- `POST /api/devices/heartbeat/bulk` - Bulk heartbeat for multiple devices
- `GET /api/devices/stale?hours=N` - Devices not reporting in
- `GET/PUT /api/settings/ticket-ping` - Ping configuration
- `GET/PUT /api/settings/ticket-ping/team-mappings` - Category/SLA team mappings
- `POST /api/tickets/check-escalations` - Manual escalation check
- `POST /api/tickets/{id}/pick-up` - Tech claims a ticket
- `POST /api/tickets/trigger-ping/{id}` - Manual ping
- `GET /api/tickets/{id}/ping-history` - Ping log

## Credentials
- Admin: admin@nexusops.io / admin123

## Backlog
### P1: Full UniFi Phase 2, Full Xero Integration
### P2: Real integrations (Pax8, Domotz, Acronis, Proxmox), Real O365 OAuth, Client portal, recharts warnings

## Testing
- iter 30: 100% (21 backend) | iter 31: 100% (10 backend) | iter 32: 100% (14 backend)
