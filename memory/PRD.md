# NexusOps - Ultimate RMM/PSA Platform

## Problem Statement
Build a comprehensive RMM/PSA platform called "NexusOps" that surpasses Syncro and Super Ops, serving as the go-to platform for all MSPs.

## Tech Stack
- **Backend**: FastAPI, MongoDB, JWT Auth, Pydantic, python-barcode
- **Frontend**: React, Tailwind CSS, Shadcn UI, Recharts, TipTap, @dnd-kit/core, react-barcode
- **Architecture**: Monolithic full-stack (backend refactoring needed)

## Core Modules (Implemented)
- Dashboard (fleet overview, system health)
- Tickets (rich text, parent/child, device linking, product linking)
- Clients & Contacts
- Technicians
- Invoices (recurring, Stripe payments)
- Products (stock tracking, barcodes, instances, label printing)
- Purchase Orders
- Assets
- Devices (detailed hardware/software/security info, remote access)
- Networking (UniFi sites, devices, clients, health monitoring)
- Time Tracking
- Leads / CRM
- Projects (Kanban boards)
- Knowledge Base
- IT Documentation (Password Vault)
- Contracts
- Reports
- Scheduling
- Scripting (UI placeholder)

## Implemented Features (Latest Session - March 2026)

### Products Module Enhancement
- Stock tracking with inventory levels per product
- Unique barcode generation (Code128) per product via python-barcode
- Product instances with individual barcodes and serial numbers
- Stock movement tracking (in/out/adjustment with history)
- Label printing via browser print dialog (formatted for label printers)
- Product-to-ticket linking with automatic stock deduction
- Low stock alerts with reorder level monitoring
- Product detail page with 4 tabs: Overview, Inventory, Barcodes & Labels, Stock History
- 10 realistic seed products (Hardware, Licensing, Networking, Security, Cloud, Services)

### Networking Page (UniFi Integration)
- Network site management with 5 demo sites
- Global stats dashboard (sites, devices, clients, APs, switches, gateways, health)
- Per-site overview with WAN/LAN/WLAN health status
- Network device listing (gateways, switches, access points) with CPU/MEM/uptime
- Connected clients table with IP, MAC, type, OS, signal strength, traffic
- Device type filtering and search
- 16 seed network devices, 10 seed network clients across 5 sites

### Previous Session Features
- Comprehensive Device Management with detail pages
- Device-Ticket Integration
- Dashboard Overhaul with fleet analytics
- Remote Access (RustDesk mock)
- Edit dialog bug fixes across 5 pages

## Database Collections
- users, clients, contacts, tickets, invoices, products, product_instances, stock_movements
- purchase_orders, assets, devices, device_events, network_sites, network_devices, network_clients
- time_entries, leads, projects, project_tasks, knowledge_base, it_documents
- contracts, schedules, custom_fields, remote_sessions, settings

## Key API Endpoints
- `/api/products/*` - Full CRUD + barcode, instances, stock-movements, labels
- `/api/networking/*` - Sites, devices, clients, stats, overview
- `/api/tickets/{id}/products` - Link products to tickets
- `/api/dashboard/stats` - Dashboard overview
- `/api/devices/{id}/**` - Device management suite

## Credentials
- Email: admin@nexusops.io
- Password: admin123

## Testing Status
- Iteration 15: 24/24 backend + all 22 frontend features passed (100%)

## Integrations
- **Stripe**: Implemented (payments)
- **TipTap**: Implemented (rich text)
- **Recharts**: Implemented (charts)
- **@dnd-kit/core**: Implemented (Kanban)
- **react-barcode + python-barcode**: Implemented (barcode generation)
- **RustDesk**: Mock (remote access)
- **UniFi**: Demo data (networking - ready for real API)
- **Xero**: Planned (billing sync)
- **Pax8, Domotz, Acronis, Proxmox**: Mocked

## Pending Issues
- P0: Refactor server.py (monolithic, 7000+ lines)
- P2: Recharts console warnings on Reports page

## Upcoming Tasks
- P0: Refactor server.py into modular FastAPI structure
- P1: Xero Integration (playbook fetched)
- P1: Standalone database seeding script
- P2: Enhance remaining modules (Contracts, Reports, Technicians, Clients)
- P2: Scripting & Automation Engine
- P2: Real backend for mocked integrations
- P2: Client portal
