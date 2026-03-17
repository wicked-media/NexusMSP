# NexusOps - Ultimate RMM/PSA Platform

## Problem Statement
Build a comprehensive RMM/PSA platform called "NexusOps" that surpasses Syncro and Super Ops, serving as the go-to platform for all MSPs.

## Tech Stack
- **Backend**: FastAPI, MongoDB, JWT Auth, Pydantic, python-barcode, httpx, emergentintegrations (Claude/GPT/Gemini)
- **Frontend**: React, Tailwind CSS, Shadcn UI, Recharts, TipTap, @dnd-kit/core, react-barcode
- **Architecture**: Monolithic full-stack (backend refactoring needed)

## Core Modules (Implemented)
- Dashboard (fleet overview, system health)
- Tickets (rich text, parent/child, device linking, product linking, audit trail)
- Clients & Contacts (M365 tenancy sync, CIPP-ready)
- Technicians (permissions, leaderboard, history, signatures, activity log, remote sessions, profile pictures, about me, achievements/badges, hover status cards, Teams status sync)
- Invoices (recurring, Stripe, manual payments x9, move-client, void, Xero-ready, admin audit trail)
- Products (stock tracking, barcodes, instances, label printing)
- Purchase Orders
- Assets
- Devices (detailed hardware/software/security info, remote access, remote session history with lock tracking, admin audit log)
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

## Latest Session Implementations (March 2026 - Session 6)

### Technician Co-Pilot AI Chat (March 17, 2026)
- Floating purple AI chat button on ticket detail views
- Context-aware - automatically includes ticket title, description, client, device info
- Cross-references KB articles and past resolutions in responses
- Quick action buttons: Diagnose, Draft reply, Find KB articles, Suggest scripts
- Copy response, minimize/expand, persistent session
- Backend: POST /api/ai/copilot with session management

### Full UniFi Integration Enhancement (March 17, 2026)
- WLAN Management tab: View/create/edit WiFi networks with SSID, security, VLAN, band, guest settings
- DPI Traffic Analytics tab: Traffic by Category bar chart, Traffic Distribution pie chart, detailed Category Breakdown table with download/upload/share percentages
- Port Profiles: VoIP, Security Cameras, Guest VLAN configurations
- Sync from Controller: Live sync from real UniFi controller (login, devices, clients, health)
- Comprehensive demo data: 3 sites, gateways (USG-Pro-4, UDM-Pro), switches (USW-Pro-48-PoE), APs (U6-Pro, U6-Enterprise), 25+ clients
- Backend: /api/networking/sites/{id}/wlans, /api/networking/sites/{id}/dpi, /api/networking/sites/{id}/sync

### Tickets Page Improvements (March 17, 2026)
- Renamed "Service Desk" back to "Tickets" (page header + sidebar)
- Removed Email Signature and Canned Responses from ticket detail sidebar
- Moved Email Signature (rich text editor) to Settings per-technician
- Moved Canned Responses management to Settings per-technician  
- Email signature auto-appends when sending email from ticket
- Rich text signature supports full HTML formatting like Outlook

## Previous Session Implementations (March 2026 - Session 5)

### AI-Powered Features with Claude Sonnet 4.5 (March 17, 2026)
- **Spell Check / Grammar Tool**: Real-time proofreading via `/api/ai/proofread` for ticket notes and emails
  - Proofread button in Notes tab and Email dialog
  - Shows corrected text + list of changes, one-click Apply
- **Auto-Categorization**: `/api/ai/categorize-ticket` analyzes title/description and suggests type, category, priority with confidence score
- **AI Device Analysis**: `/api/ai/analyze-device` provides comprehensive diagnosis with:
  - Severity assessment, step-by-step fix instructions
  - Potential causes, recommended scripts/commands
  - Cross-references KB articles and past resolved tickets
- **Model Switching**: Settings page allows switching between Claude 4.5, GPT-5.2, Gemini 3 Flash
- Backend: `/app/backend/app/routers/ai_service.py`

### Xero Accounting Integration - MOCKED (March 17, 2026)
- Full financial dashboard at `/xero` with:
  - 4 stat cards: Total Revenue, Collected, Outstanding, Overdue
  - Monthly Revenue bar chart and Invoice Status pie chart
  - Invoices tab with 18 demo invoices, search, status filter, Pay buttons
  - Contacts tab with synced client contacts
  - Accounts tab with chart of accounts (6 accounts)
- Record Payment dialog for outstanding invoices
- Auto-seeding demo data for immediate use
- Backend: `/app/backend/app/routers/xero.py`

### Enhanced Ticket Detail Page (March 17, 2026)
- **Device Status Indicator**: Shows online/offline status in header (green/red badge)
- **Remote Connect Button**: Opens remote access session for linked device
- **AI Diagnose Button**: Runs AI analysis directly from ticket, shows diagnosis panel with severity, fix steps, causes, scripts, KB references
- **Device Info Panel**: Right sidebar shows OS, IP, Type, Last Seen for linked device
- **Quick Actions**: AI Diagnose + Remote in sidebar for fast access
- **Run Scripts**: List of available scripts to run on linked device from ticket
- **Proofread for Notes**: Spell check button in Notes tab
- **Proofread for Emails**: Grammar check button in Email dialog

## Previous Session Implementations (March 2026 - Session 4)

### Splynx ISP Service Health Dashboard (March 17, 2026)
- Dedicated /splynx-dashboard page with comprehensive ISP service visibility
- 5 stat cards: Service Health %, Linked Clients, Total Services, Active Services, Suspended
- Pie chart: Service Status Distribution (Active/Suspended/Other)
- Bar chart: Services by Type (Active vs Suspended per service type)
- Clients Needing Attention section with red-highlighted suspended service indicators
- All Linked Clients section with search, health bars, and status badges per client
- Sidebar link: "ISP Health" under Infrastructure section

### Configurable Ticket Numbering Scheme (March 17, 2026)
- Halo PSA / Syncro / Flamingo MSP-style ticket numbering with per-type prefixes
- 7 configurable types: Incident (INC), Service Request (SR), Problem (PRB), Change Request (CHG), Alert (ALR), Task (TSK), Default (TKT)
- Configurable separator character (hyphen, hash, or none) and number padding (3-6 digits)
- Auto-incrementing counters per prefix type stored in ticket_counters collection
- Live preview examples in Ticket Configuration settings
- All new tickets automatically get type-based numbering (e.g., INC-0001, SR-0001, PRB-0001)
- Tabbed Ticket Configuration page with Numbering and Categories tabs

### AI-Powered Ticket Resolution Suggestions (March 17, 2026)
- Smart keyword extraction from ticket title, description, and category
- Keyword matching against resolved/closed tickets and Knowledge Base articles
- Suggestions tab (default) in ticket detail view showing:
  - Matched keywords as badges
  - Similar Resolved Tickets with resolution notes, comments, assigned tech, and time spent
  - Knowledge Base Articles with relevance scores, content preview, views, and helpful count
- Relevance scoring with bonus for exact word matches
- Suggestions improve as more tickets are resolved and KB articles are added

### Hudu IT Documentation Integration (March 17, 2026)
- Hudu API v1 integration for syncing knowledge base articles
- Settings page: Hudu URL + API Key configuration with masking and Test Connection
- Sync articles from Hudu into local KB with deduplication (by hudu_id)
- One-click "Sync from Hudu" button on Knowledge Base page
- Procedure search endpoint for matching fix guides by query
- Backend: /api/settings/hudu, /api/hudu/articles, /api/hudu/sync, /api/hudu/procedures/search

## Previous Session Implementations (March 2026 - Session 3)

### Suped DMARC Integration (March 16, 2026)
- Integrated Suped API (https://www.suped.com/api) for DMARC monitoring and email security
- 6 tracked services: DMARC Monitoring, Hosted DMARC, Hosted SPF, Hosted MTA-STS, SPF Flattening, Blocklist Monitoring
- Client Subscriptions tab with green (active) / red (not active) toggle bars per service
- Suped Organization ID per client for DMARC record fetching
- DMARC records proxy endpoint with summary stats (total emails, authorized, rejected, compliance rate, top sources)
- Settings page: Suped API key configuration with masking
- Clients list: Subscription status column with shield icon and active/total count
- API key securely stored, masked in GET responses

### Splynx ISP Billing Integration (March 16, 2026)
- Full Splynx API v2 integration (REST, Basic Auth with API key + secret)
- Settings page: Splynx URL, API Key, API Secret configuration with credential masking
- Test Connection button verifies API connectivity
- Per-client Splynx Customer ID linking
- Client Splynx tab: customer info, billing details, all services (internet, voice, recurring, bundle)
- Service status bars: green (ACTIVE) / red (SUSPENDED - NON PAYMENT) / amber (PENDING)
- Splynx invoice history per client with paid/unpaid status
- Splynx overview endpoint aggregating service counts across all linked clients

### Tickets Page Revamp (March 16, 2026)
- Renamed to "Service Desk" with enriched header showing ticket count across clients
- 6 clickable stat cards: Open, In Progress, Resolved, Critical, No Response, Avg Time
- Card-based ticket list with priority color-coded left borders (red/orange/yellow/green)
- SLA BREACH badge on overdue tickets, AWAITING RESPONSE badge on no-note tickets
- Enhanced filter bar with Clear Filters button and ticket count display
- Richer ticket card layout with category, tags, device info, assignee, and relative time

### Email Security Compliance Dashboard (March 16, 2026)
- Dedicated DMARC Compliance page (/dmarc-compliance) with aggregate fleet posture
- Overall compliance score ring with Critical/Poor/Fair/Good/Excellent labels
- Fully Protected / Partially Protected / Unprotected client counts
- Service Coverage progress bars showing adoption rate per service across all clients
- Clients Needing Attention section highlighting at-risk clients sorted by score
- Full client table with per-service checkmarks/X-marks and score badges
- Search filter on client table
- Dashboard widget: compact Email Security card on main dashboard showing score ring, quick stats, at-risk clients
- Dashboard widget clickable, navigates to full compliance page
- Sidebar link: "Email Security" under Infrastructure section

### Phone Rentals & Sales (March 16, 2026)
- Full RentalsPage.jsx with Agreements tab and Device Inventory tab
- Three agreement types: Rental (monthly payments), Buy Outright (one-time purchase), Lease to Own
- Device inventory tracking: Yealink phone models, serial numbers, MAC addresses, firmware, condition
- Payment recording with multiple methods, deposit tracking, progress bars
- Device return processing with condition assessment
- Stats dashboard: total devices, available, active rentals, overdue, revenue

### Vendor Management (March 16, 2026)
- Full VendorsPage.jsx with CRUD, categories, and detail view
- Vendor fields: name, contact, email, phone, address, ABN, tax ID, payment terms, website
- 8 vendor categories (general, hardware, software, telecom, networking, cloud, security, consulting)
- Category-based filtering and search
- Vendor detail with purchase order history

### Ticket Category & Issue Settings (March 16, 2026)
- TicketSettingsPage.jsx for managing ticket categories and issue type dropdowns (Syncro-style)
- Expandable accordion categories with color-coded issue types
- Issue types with priority levels (critical, high, medium, low)
- 8 default categories with 45+ built-in issue types
- CRUD for categories and issue types with icon/color customization

### Networking Page Enhancement (March 16, 2026)
- Dashboard section: site bandwidth table, active alerts, offline devices, firmware distribution
- Clickable site rows to drill into site details

## Previous Session Implementations (March 2026 - Session 2)

### Cross-Entity Activity Logging & Audit Trail
- Unified `activity_logs` collection recording all actions across tickets, invoices, devices
- Admin-only access on all activity log endpoints
- Action types: created, updated, deleted, payment_recorded, voided, moved_client, remote_connect, remote_disconnect
- Change tracking with old/new field values
- Activity logged on: ticket CRUD, invoice CRUD/payment/move/void, device CRUD, remote sessions

### Enhanced Remote Session Tracking (RustDesk)
- Device type tracking (desktop, server, laptop, workstation) on each session
- Lock status tracking: `was_locked_before_disconnect` and `lock_action_on_disconnect` (locked/unlocked/no_change)
- Active sessions endpoint showing live duration
- Per-device session history with stats
- Per-technician session history with aggregated stats (total sessions, total time, unique devices)

### Technician Activity Page (Admin)
- New "Remote Sessions" tab: shows active count, total sessions, total time, unique devices, full session table with device type and lock status
- New "Activity Log" tab: combined timeline of all activity logs + remote sessions, color-coded action badges, entity icons, change diffs
- Admin can view full historical data for each technician

### Device Detail Enhancements
- New "Sessions" tab: shows remote session history per device with technician, type, status, duration, lock status
- New "Audit Log" tab: admin-only device activity trail showing all changes and remote access events

### Invoice Detail Audit Trail
- Admin-only "Audit Trail" section in invoice detail view
- Shows creation, updates, payments, voiding, client moves with timestamps and change diffs

### Session 2b - Achievement Badges, Profile & Microsoft Integrations

#### Achievement Badge System (Gamification)
- 18 built-in achievement definitions across 6 categories: tickets (6), invoices (3), remote (2), tenure (4), celebration (1), special (2)
- Auto-check milestones on profile view (ticket closures, invoices created, remote sessions, tenure, birthday)
- Admin can manually award any badge + create custom badges
- Admin can revoke badges
- Visual showcase: earned badges with glow effects, all badges by category with earned/locked state

#### Technician Profile Enhancements
- Profile picture upload with file validation (jpg, png, webp, gif)
- About Me bio section
- Hire Date and Birthday fields (for tenure/birthday badges)
- "Edit Profile" dialog for updating bio/dates
- Profile tab shows all personal info, specialties, hourly rate

#### Hover Status Card
- Hovering over tech avatar shows real-time status card
- Status types: remote (green pulse), active (blue), available (grey)
- Shows: status text ("In remote session with ClientName"), active sessions with device/client/duration, assigned tickets, badge count

#### Microsoft Integration Configuration
- Microsoft Teams: Config UI for tenant_id, client_id, client_secret, webhook_url + status sync endpoint
- CIPP: Config UI for api_url, api_key, tenant_filter + tenant sync endpoint
- Microsoft 365: Config UI for tenant_id, client_id, client_secret, redirect_uri
- All configs stored in settings collection, enabled/disabled toggle
- Real API calls are MOCKED (configuration UI is ready, actual Graph API/CIPP calls need real credentials)

#### Client M365 Tenancy Sync
- New "Microsoft 365" tab on client detail page
- One-click "Connect M365" to link tenant ID and domain
- User table showing Display Name, UPN/Email, License Type, Status
- CIPP integration notice for full sync capability

### Previous Session Features (March 2026 - Session 2a)

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
- activity_logs (unified cross-entity audit trail)
- user_achievements (earned badges per user)
- achievement_definitions (custom admin-created badges)
- m365_users (synced Microsoft 365 users per client)
- teams_status (Teams status per user)
- client_subscriptions (Suped service subscriptions per client)
- vendors (vendor management)
- ticket_categories (ticket category/issue type configuration)
- rentals (phone rental agreements)
- rental_devices (phone device inventory)

## Key API Endpoints
- `/api/activity-logs` - Admin-only activity trail (filter by entity_type, entity_id, technician_id)
- `/api/activity-logs/entity/{type}/{id}` - Activity logs for specific entity
- `/api/technicians/{id}/activity` - Full technician activity + remote sessions
- `/api/technicians/{id}/remote-sessions` - Technician remote session history with stats
- `/api/devices/{id}/remote-sessions` - Device remote session history
- `/api/remote/active-sessions` - Currently active remote sessions with live duration
- `/api/remote/sessions` - Create/list remote sessions (with device_type, lock tracking)
- `/api/remote/sessions/{id}/end` - End session with lock status data
- `/api/invoices/{id}/activity-log` - Admin-only invoice activity trail
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
- Iteration 23: 17/17 backend + all frontend passed (100%) - Splynx Integration + Tickets Revamp
- Iteration 22: 11/11 backend + all frontend passed (100%) - DMARC Compliance Dashboard + Widget
- Iteration 21: 21/21 backend + all frontend passed (100%) - Suped DMARC, Rentals, Vendors, Ticket Settings
- Iteration 19: 27/27 regression tests passed (100%) - Post-refactoring full verification
- Iteration 18: 28/28 backend + all frontend features passed (100%) - Achievements, Profile, Hover cards, M365

## Integrations
- **Stripe**: Implemented (payments)
- **Suped**: Implemented (DMARC monitoring, email security subscriptions - needs real API key for live data)
- **Splynx**: Implemented (ISP billing, customer services, invoice tracking - needs real Splynx instance URL + API credentials)
- **Xero**: Configuration-ready (MOCKED - settings stored, webhook endpoint active)
- **UniFi**: Configuration-ready (MOCKED - test-connection makes real HTTP, data from MongoDB)
- **Microsoft Teams**: Configuration-ready (MOCKED - status sync UI ready)
- **CIPP**: Configuration-ready (MOCKED - tenant sync UI ready)
- **Microsoft 365**: Configuration-ready (MOCKED - tenancy sync per client)
- **TipTap**: Implemented (rich text)
- **Recharts**: Implemented (charts)
- **@dnd-kit/core**: Implemented (Kanban)
- **react-barcode + python-barcode**: Implemented (barcode generation)
- **RustDesk**: Mock (remote access with session tracking + lock status)
- **Pax8, Domotz, Acronis, Proxmox**: Mocked

## Pending Issues
- P0: Refactor server.py (monolithic, 7200+ lines)
- P2: Recharts console warnings on Reports page

## Upcoming Tasks
- P1: Implement Xero Integration (playbook fetched)
- P1: Full UniFi Integration (deep API integration)
- P1: Standalone database seeding script
- P2: Enhance remaining modules (Contracts, Reports, Clients)
- P2: Scripting & Automation Engine
- P2: Real backend for mocked integrations (Pax8, Domotz, Acronis, Proxmox, Microsoft Graph/CIPP)
- P2: Client portal
- P2: Fix Recharts console warnings

## Architecture (Post-Refactoring)
```
/app/backend/
├── server.py                  # Thin entry point (~100 lines)
├── app/
│   ├── database.py           # MongoDB connection, constants
│   ├── auth.py               # JWT auth, password helpers
│   ├── models.py             # All Pydantic models (1265 lines)
│   ├── routers/              # 30 modular router files
│   │   ├── auth.py, clients.py, clients_contacts.py
│   │   ├── tickets.py, devices.py, assets.py, contracts.py
│   │   ├── invoices.py, time_entries.py, knowledge_base.py
│   │   ├── integrations.py (Pax8/Domotz/O365/Acronis)
│   │   ├── dashboard.py, technicians.py, scheduling.py
│   │   ├── products.py, networking.py, purchase_orders.py
│   │   ├── remote.py, crm.py, scripting.py
│   │   ├── it_docs.py, portal.py, projects.py
│   │   ├── admin.py, infrastructure.py, yeastar.py
│   │   ├── activity_logs.py, achievements.py
│   │   ├── technicians_profile.py, microsoft_config.py
│   │   ├── vendors.py, rentals.py, ticket_categories.py
│   │   └── suped.py           # Suped DMARC integration
│   └── services/
│       ├── activity.py       # Activity logging + ticket audit
│       ├── integrations.py   # Service classes (Pax8, Domotz, O365, Acronis)
│       └── seed.py           # Database seeding
```
