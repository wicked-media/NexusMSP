# NexusOps - Product Requirements Document

## Original Problem Statement
Build a rich and elegant RMM/PSA platform called "NexusOps" that rivals Syncro and Super Ops, fully feature-rich with the best features from competitors plus unique capabilities.

## Core Modules
1. **Dashboard** - Real-time overview with device health, tickets, alerts
2. **Ticketing** - Full lifecycle with SLA, conversation view, attachments, itemization
3. **Workshop** - Retail/bench repair job management with timer, parts, billing
4. **Field Jobs** - WISP/Internet field dispatch with checklists, signal/speed testing, zones
5. **Devices & RMM** - Device management, remote access, discovery, chat
6. **Clients & CRM** - Client management, leads, loyalty
7. **Products & Inventory** - Product catalog, bundling, stock management, on-order tracking
8. **Purchase Orders** - Full PO lifecycle, stock receiving, ping/escalation, audit trail
9. **Stocktake** - Inventory counting, variance tracking, reports, barcode scanner
10. **Technicians** - Tech management, on-call roster, ping/swap, performance
11. **Invoicing** - Invoices with PDF preview/print, white-label branding
12. **Contracts & Scheduling** - Contract management, scheduling
13. **Integrations** - Acronis, Proxmox, Gradient, UniFi, Splynx, Xero, O365, Pax8, Domotz
14. **Reporting** - Financial reports, tech performance, inventory reports
15. **Settings** - White-label, ticket ping, PO ping

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
- **Auto-Reorder Alerts**: Detects low stock, auto-creates draft POs for preferred vendors, pings procurement team
- **On-Call Roster**: Schedule shifts by category (general/wisp/workshop/network/emergency), shift types (primary/secondary/backup), swap with notifications to both techs, ping active on-call, flashy green pulsing ON CALL badge
- **Workshop/Retail Jobs**: Integrated into Tickets page as Workshop tab. Full repair job management with status progression (checked_in → diagnosing → parts_ordered → repairing → ready_for_pickup → collected), labour timer with start/stop, parts usage auto-deducting inventory, billing summary (parts + labour costs)
- **WISP/Internet Field Jobs**: Integrated into Tickets page as Field Jobs tab. Field dispatch with zone/area assignment, auto-generated installation checklists (6 items), signal strength & speed test logging, status progression (scheduled → en_route → on_site → completed)

## Prioritized Backlog

### P1 (High Priority)
- Full UniFi Integration Phase 2 (active management)
- Full Xero Integration (real API vs mocked)

### P2 (Medium Priority)
- Full backend for Pax8, Domotz integrations
- Client self-service portal
- Recharts console warnings fix

### P3 (Low Priority)
- Component refactoring (TicketsPage, ClientsPage, server.py auto-discovery)
- Database seeding mechanism
- SLA breach alerting
