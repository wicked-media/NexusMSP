# NexusOps - Ultimate RMM/PSA Platform

## Problem Statement
Build a comprehensive RMM/PSA platform called "NexusOps" that surpasses Syncro and Super Ops, serving as the go-to platform for all MSPs.

## Tech Stack
- **Backend**: FastAPI, MongoDB, JWT Auth, Pydantic, python-barcode, httpx
- **Frontend**: React, Tailwind CSS, Shadcn UI, Recharts, TipTap, @dnd-kit/core, react-barcode
- **Architecture**: Monolithic full-stack (backend refactoring needed)

## Core Modules (Implemented)
- Dashboard (fleet overview, system health)
- Tickets (rich text, parent/child, device linking, product linking)
- Clients & Contacts
- Technicians
- Invoices (recurring, Stripe, manual payments x9, move-client, void, Xero-ready)
- Products (stock tracking, barcodes, instances, label printing)
- Purchase Orders
- Assets
- Devices (detailed hardware/software/security info, remote access)
- Networking (UniFi sites CRUD, device adoption, edit, test connection, clients)
- Time Tracking
- Leads / CRM
- Projects (Kanban boards)
- Knowledge Base
- IT Documentation (Password Vault)
- Contracts
- Reports
- Scheduling
- Scripting (UI placeholder)

## Latest Session Implementations (March 2026)

### Networking Page Enhancement
- Full CRUD for network sites: add/edit/delete with UniFi controller URL, API key, credentials
- Client linking: associate sites with existing NexusOps clients
- Test Connection button: validates reachability of UniFi controller
- Device adoption: add new devices (AP, switch, gateway) with MAC, model, IP
- Edit/delete devices directly from networking page
- WAN details management (IP, ISP, speed)
- Site detail view with controller info bar, health cards, device/client tabs

### Invoice Enhancements
- Move Invoice to Different Client: one-click transfer between clients with audit trail
- Void Invoice: cancel with reason, audit tracked
- Enhanced Manual Payment: 9 payment methods (Cash, Bank Transfer/EFT, Check/Cheque, Credit Card Offline, Debit Card, PayPal, Cryptocurrency, Wire Transfer, Other)
- Payment fields: amount, method, reference/transaction ID, date, notes

### Xero Billing Integration (Configuration-Ready)
- Xero settings management (client_id, client_secret, redirect_uri)
- Invoice sync endpoint (creates mock Xero invoice ID)
- Webhook endpoint for payment status updates (auto-marks invoices as paid)
- Full OAuth2 flow ready for real Xero credentials

### Login Page Revamp
- Modern dark tech aesthetic with animated background orbs and grid overlay
- Sign In / Sign Up tabs
- Demo credentials button
- Hero section with platform stats and feature pills
- Gradient branding and glass-morphism card

### Previous Session Features
- Products module: stock tracking, barcode generation, instances, label printing
- Networking page: initial implementation with demo data
- Device Management with detail pages
- Dashboard Overhaul with fleet analytics

## Database Collections
- users, clients, contacts, tickets, invoices, products, product_instances, stock_movements
- purchase_orders, assets, devices, device_events, network_sites, network_devices, network_clients
- time_entries, leads, projects, project_tasks, knowledge_base, it_documents
- contracts, schedules, custom_fields, remote_sessions, settings

## Key API Endpoints
- `/api/products/*` - Full CRUD + barcode, instances, stock-movements, labels
- `/api/networking/*` - Sites CRUD, devices CRUD, clients, stats, test-connection, adopt-device
- `/api/invoices/{id}/move-client` - Move invoice between clients
- `/api/invoices/{id}/void` - Void/cancel invoice
- `/api/invoices/{id}/record-payment` - Enhanced manual payment (9 methods)
- `/api/settings/xero` - Xero configuration
- `/api/xero/sync-invoice/{id}` - Sync invoice to Xero
- `/api/xero/webhook` - Xero payment webhook

## Credentials
- Email: admin@nexusops.io
- Password: admin123

## Testing Status
- Iteration 16: 20/20 backend + 18/18 frontend features passed (100%)
- Iteration 15: 24/24 backend + 22/22 frontend features passed (100%)

## Integrations
- **Stripe**: Implemented (payments)
- **Xero**: Configuration-ready (MOCKED - settings stored, webhook endpoint active)
- **UniFi**: Configuration-ready (MOCKED - test-connection makes real HTTP, data from MongoDB)
- **TipTap**: Implemented (rich text)
- **Recharts**: Implemented (charts)
- **@dnd-kit/core**: Implemented (Kanban)
- **react-barcode + python-barcode**: Implemented (barcode generation)
- **RustDesk**: Mock (remote access)
- **Pax8, Domotz, Acronis, Proxmox**: Mocked

## Pending Issues
- P0: Refactor server.py (monolithic, 7200+ lines)
- P2: Recharts console warnings on Reports page

## Upcoming Tasks
- P0: Refactor server.py into modular FastAPI structure
- P1: Standalone database seeding script
- P2: Enhance remaining modules (Contracts, Reports, Technicians, Clients)
- P2: Scripting & Automation Engine
- P2: Real backend for mocked integrations
- P2: Client portal
