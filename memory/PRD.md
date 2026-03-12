# NexusOps - Ultimate RMM/PSA Platform PRD

## Overview
NexusOps is a comprehensive RMM/PSA platform designed to outdo Syncro, SuperOps, and NinjaRMM.

## What's Been Implemented

### Core Modules (27+ Pages, 100+ API Endpoints)
| Module | Status | Key Features |
|--------|--------|--------------|
| Auth | Done | JWT login, registration, roles |
| Dashboard | Done | Stats, charts, **Operational Alerts** (revenue, outstanding, no-notes, SLA, low stock, pending POs) |
| **Ticketing** | Done | **Syncro-style creation** (13 fields), **color-coded progress bar** (Open→In Progress→On Hold→Resolved→Closed), parent/child, merging, timer, SLA, canned responses, audit log, rich text signatures, no-notes auto-escalation |
| Clients | Done | Multiple contacts, detail view with tabs |
| Devices/RMM | Done | **Feature-rich**: 40+ fields, hardware specs, compliance scoring, software inventory, patch management, network adapters, 24h performance charts, event timeline, Table/Grid views, Flamingo MSP-inspired |
| **Assets** | Done | Warranty tracking, depreciation, expiry alerts, lifecycle management |
| Reports | Done | 5-tab: Technicians, Tickets, Clients, Revenue, Devices |
| Technicians | Done | CRUD, overview, detail dashboard, clickable no-notes tickets |
| Scheduling | Done | Weekly calendar, unscheduled queue |
| Products | Done | Full CRUD, categories, vendor, pricing, stock, recurring billing |
| Purchase Orders | Done | Full PO workflow, line items from catalog |
| **Invoices** | Done | **Stripe payments** (user-configurable API key), manual payments, Paid (GREEN)/Not Paid (RED), product linking, **recurring billing** |
| **Time Tracking** | Done | **Live timer widget**, weekly timesheet, billable breakdown |
| **Leads/CRM** | Done | **Kanban pipeline view**, table view, deal values |
| **Projects** | Done | **Kanban task board**, task status management |
| **Settings** | Done | **Stripe API key config**, no-notes threshold, Xero settings, notifications |

### Key Integration Points
- **Stripe**: User-configurable API key (Settings → Stripe Payments), stored in MongoDB, live Checkout
- **Xero**: Settings storage ready for OAuth (needs user credentials)
- **Mocked**: Pax8, Domotz, Acronis, Proxmox, Office 365

### Ticket Progress Bar
- 5 stages: Open → In Progress → On Hold → Resolved → Closed
- Green checkmarks for completed stages
- Highlighted colored dot with ring for current stage  
- Connected by colored lines (green=complete, grey=incomplete)

## Demo Credentials
- Email: admin@nexusops.io, Password: admin123

## Prioritized Backlog

### P0
- Refactor server.py (6500+ lines) into modular structure

### P1
- Xero OAuth flow, Real O365 email integration
- Contracts enhancement, Email threading, KB rich text

### P2
- Client portal, PDF export, RBAC/SSO, mobile responsive, Expiry Tracker

## Bug Fixes
- **Edit Dialog Bug (March 2026)**: Fixed across 5 pages (Invoices, Products, Purchase Orders, Assets, Clients). Dialogs now extracted into shared variables rendered in both detail and list views.

## Device Management Feature (March 2026)
- **DevicesPage.jsx**: Table/Grid views, stats dashboard (Total/Online/Offline/Warning/Avg CPU/Needs Patching), filters (status/type/client/search), Add/Edit device dialogs
- **DeviceDetailPage.jsx**: 7-tab detail page (Overview, Performance, Software, Patches, Security, Network, Events). Hardware specs, OS info, assignment, tags, compliance score, endpoint protection, 24h performance charts, installed software inventory, patch status tracking, network adapter details, event timeline
- **Backend**: Enhanced Device model (40+ fields), new collections (device_software, device_patches, device_events, device_performance, device_network), 6 new API endpoints
- **Seed Data**: 10 realistic devices across 5 clients with full hardware/software/security data

## Enhanced Dashboard (March 2026)
- **MSP Command Center**: Top stats (Clients, Devices online/total, Open Tickets, MRR, Active Alerts), operational alerts row (Collected, Outstanding, SLA Breaches, Need Patching, Low Compliance, Pending POs)
- **Device Fleet Overview**: Table sorted by criticality (warning/offline first), CPU/RAM/Disk/Security/Status, clickable rows to device detail
- **System Health**: Donut chart (Online/Warning/Offline), Fleet Breakdown (Servers/Workstations/Laptops/Network), Avg CPU/RAM
- **Ticket Volume**: 7-day area chart, Open Tickets scrollable list with device names
- **Alerts & Activity**: Active alerts section, Activity feed with timestamps

## Remote Access Integration (March 2026)
- **Remote Access Dialog**: Connection status (Ready/Unavailable), RustDesk ID, IP, OS display
- **4 Session Types**: Remote Desktop, Terminal/SSH, File Transfer, View Only
- **Online/Offline Awareness**: Green "Remote Access" button for online devices, disabled "Offline" for offline devices
- **RustDesk Launch**: Opens rustdesk:// protocol URL with device's RustDesk ID

## Device-Ticket Integration (March 2026)
- **Bidirectional linking**: Tickets now have device_id/device_name fields. Backend auto-resolves device_name on create/update.
- **Device Detail - Tickets Tab**: Shows all linked tickets with priority/status badges, plus stats (Total/Open/In Progress/Resolved). "Create Ticket for Device" button.
- **Tickets Page - Device Column**: Shows linked device name for each ticket in the list view
- **Ticket Detail - Device Selector**: Dropdown to link/change device, filtered by client. "View {device} details" navigation link.
- **Ticket Creation - Device Field**: Device selector in create form, filtered by selected client
- **Seed Data**: 16 realistic MSP tickets, 15 linked to devices across 5 clients

## Test Results
- Backend: 100% (12/12 in iteration 13)
- Frontend: 100% (11/11 features verified)
- Last tested: March 2026, iteration 14 (42/42 frontend checks passed)
