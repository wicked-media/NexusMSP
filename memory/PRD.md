# NexusOps - Product Requirements Document

## Original Problem Statement
Build a rich and elegant RMM/PSA platform called "NexusOps" that rivals Syncro and Super Ops, fully feature-rich with the best features from competitors plus unique capabilities.

## Core Modules
1. **Dashboard** - Real-time overview with device health, tickets, alerts
2. **Ticketing** - Full lifecycle with SLA, conversation view, attachments, itemization
3. **Devices & RMM** - Device management, remote access, discovery, chat
4. **Clients & CRM** - Client management, leads, loyalty
5. **Products & Inventory** - Product catalog, bundling, stock management, on-order tracking
6. **Purchase Orders** - Full PO lifecycle, stock receiving, ping/escalation, audit trail
7. **Stocktake** - Inventory counting, variance tracking, reports, barcode scanner
8. **Invoicing** - Invoices with PDF preview/print, white-label branding
9. **Contracts & Scheduling** - Contract management, scheduling
10. **Integrations** - Acronis, Proxmox, Gradient, UniFi, Splynx, Xero, O365, Pax8, Domotz
11. **Reporting** - Financial reports, tech performance, inventory reports
12. **Settings** - White-label, ticket ping, PO ping

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
- Financial reporting dashboard
- Ticket attachments system
- Network device discovery

### Phase 5 - Inventory & Procurement (March 18, 2026)
- **Purchase Order System**: Full CRUD, vendor linking, line items, stock receiving (partial/full), barcode scanner input, PO ping & auto-escalation, comprehensive audit trail
- **Stocktake System**: Session-based stocktake with product snapshots, individual & batch counting, barcode scanner integration, variance tracking (loss/gain), finalization with auto stock adjustments, premium reporting (stock in hand cost/retail, net variance, low stock alerts)
- **Product Bundling**: Link products together (monitors, RAM, cables etc) as bundled packages with cost/retail totals
- **Ticket Itemization**: Add billable items/products to tickets from inventory, Items tab showing quantities/totals, push items to new or existing invoice
- **On-Order Indicators**: Cyan truck icon with pulse animation showing ordered quantities on products list, detailed PO references in product detail
- **Vendor PO Integration**: Create PO button on vendors page (list rows + detail view)
- **Stock Movements**: Full audit trail of stock in/out/adjustment movements

## Prioritized Backlog

### P0 (Critical)
- None currently blocking

### P1 (High Priority)
- Full UniFi Integration Phase 2 (active management)
- Full Xero Integration (real API vs mocked)

### P2 (Medium Priority)  
- Full backend for Pax8, Domotz integrations
- Client self-service portal
- Database seeding mechanism
- Recharts console warnings fix on Reports page

### P3 (Low Priority)
- Component refactoring (TicketsPage, ClientsPage, server.py auto-discovery)
- SLA breach alerting
- Automated backup reports
