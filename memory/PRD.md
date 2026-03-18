# NexusOps - Product Requirements Document

## Original Problem Statement
Build a rich and elegant RMM/PSA platform called "NexusOps" that rivals Syncro and Super Ops, fully feature-rich with the best features from competitors plus unique capabilities.

## Core Modules
1. **Dashboard** - Real-time overview with device health, tickets, alerts
2. **Ticketing** - Unified ticket system (SLA + Workshop + Cabling/WISP) with type icons, worksheets
3. **Estimates** - Full estimate lifecycle (Draft -> Published -> Sent -> Approved -> Declined -> Converted)
4. **Workshop** - Retail/bench repair job management with timer, parts, billing
5. **Field Jobs** - WISP/Internet field dispatch with checklists, signal/speed testing, zones
6. **Devices & RMM** - Device management, remote access, discovery, chat
7. **Clients & CRM** - Client management, leads, loyalty
8. **Products & Inventory** - Product catalog, bundling, stock management, on-order tracking
9. **Purchase Orders** - Full PO lifecycle, stock receiving, ping/escalation, audit trail
10. **Stocktake** - Inventory counting, variance tracking, reports, barcode scanner
11. **Technicians** - Tech management, on-call roster, ping/swap, performance
12. **Invoicing** - Invoices with PDF preview/print, white-label branding
13. **Contracts & Scheduling** - Contract management, scheduling
14. **Integrations** - Acronis, Proxmox, Gradient, UniFi, Splynx, Xero, O365, Pax8, Domotz
15. **Reporting** - Financial reports, tech performance, inventory reports
16. **Settings** - White-label, ticket ping, PO ping, job numbering prefixes

## Architecture
- **Frontend**: React + Shadcn/UI + TailwindCSS
- **Backend**: FastAPI + MongoDB
- **Auth**: JWT-based with role support

## Test Credentials
- Email: admin@nexusops.io
- Password: admin123

## What's Been Implemented

### Phase 1-4 (Previous Sessions)
- Core platform with all major modules
- Advanced ticketing with SLA, conversation view, PDF notifications
- Device management with remote access, discovery, chat
- Invoice system with PDF preview, print, white-label
- Integrations (Acronis, Proxmox, Gradient, RustDesk, O365)
- Financial reporting dashboard, Ticket attachments, Network device discovery

### Phase 5 - Inventory & Procurement (March 18, 2026)
- Purchase Order System with stock receiving, barcode scanner, PO ping & escalation, audit trail
- Stocktake System with variance tracking, finalization, premium reporting
- Product Bundling, Ticket Itemization, On-Order Indicators
- Vendor PO Integration, Stock Movements

### Phase 6 - Technician & Workshop Tools (March 18, 2026)
- Auto-Reorder Alerts: Low stock detection, auto PO creation, procurement ping
- On-Call Roster: Category shifts, swap, ping, pulsing ON CALL badge
- Workshop/Retail Jobs: Full repair lifecycle with timer, parts, billing
- WISP/Internet Field Jobs: Zone dispatch, installation checklists, signal/speed testing

### Phase 7 - Unified Tickets & Estimates (March 18, 2026)
- **Unified Ticket System**: Merged SLA, Workshop, and Cabling/WISP into single view with type filter buttons (All, SLA, Workshop, Cabling/WISP). Type icons: Shield (SLA blue), Wrench (Workshop purple), Wifi (Cabling cyan). All three job types display in one unified list.
- **Ticket Worksheets**: Auditable checklist feature per ticket. Add items, check/uncheck with technician name and timestamp trail. Completion counter.
- **Estimates Module**: Full lifecycle management (Draft -> Published -> Sent -> Approved -> Declined -> Converted to Invoice). Stats cards, status filters, audit trail, line items with tax/discount calculations, flashing status indicators for active estimates.
- **Splynx Non-Payment UI**: Non-payment customer tracking tab with overdue stats, suspension controls, auto-suspend toggle (MOCKED).
- **Job Numbering Configuration**: Settings card for configurable ticket prefixes (SLA-, WS-, CW-) with live preview.

## Prioritized Backlog

### P1 (High Priority)
- Full UniFi Integration Phase 2 (active management)
- Full Xero Integration (real API vs mocked)

### P2 (Medium Priority)
- Full backend for Pax8, Domotz integrations
- Client self-service portal with estimate approval
- Recharts console warnings fix

### P3 (Low Priority)
- Component refactoring (TicketsPage, TechniciansPage decomposition, server.py auto-discovery)
- Database seeding mechanism
- SLA breach alerting

## Mocked Integrations
- Xero, Pax8, Domotz: Fully mocked
- Splynx non-payment: Mocked data
- Acronis, Proxmox, Gradient: Partially integrated
