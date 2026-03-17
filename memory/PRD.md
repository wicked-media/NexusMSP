# NexusOps - RMM/PSA Platform PRD

## Original Problem Statement
Build a "rich and elegant RMM/PSA like Syncro and Super Ops" named "NexusOps". The application should be "fully feature-rich" and "better than the competition," incorporating a mix of the best features from other platforms while also introducing unique capabilities.

## Core Architecture
- **Backend**: FastAPI + MongoDB
- **Frontend**: React + Shadcn/UI + TailwindCSS
- **Auth**: JWT-based

## What's Been Implemented (Complete)

### Core Modules
- Dashboard with KPI cards
- Ticketing system with SLA, child tickets, merging, progress tracker
- Client Management with health scores & activity timeline
- Device Management with bulk actions
- Asset Management
- Contract Management with SLA tiers
- Invoice Management
- Time Tracking
- Knowledge Base with Hudu sync
- Scripting with code blocks and copy functionality
- CRM/Leads with pipeline management
- Remote Access
- Reporting (Recharts)
- IT Documentation
- Email Management
- Scheduling
- Technician Management with profiles & achievements
- Vendor Management
- Rental Management
- Project Management with milestones
- Admin Settings
- Notification System (bell + unread count)
- Purchase Orders
- Products
- Networking (UniFi analytics)
- Infrastructure monitoring

### Integrations
- **Active**: Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, Multi-LLM (Emergent LLM Key)
- **Mocked**: Xero, Pax8, Domotz, Acronis, Proxmox, Office 365

### New Features (Current Session - March 17, 2026)
1. **Leads Bug Fix** - Added "Convert to Client & Create Ticket" combined button
2. **Office 365 One-Click Mailbox Setup** - Full O365 integration UI with Azure AD credentials, ready for real registration
3. **Email-to-Lead** - Webhook endpoint auto-creates leads from incoming emails
4. **Asset Lifecycle Management** - Track IT assets from procurement to disposal with lifecycle stages
5. **Predictive Maintenance AI** - Rule-based hardware failure prediction with risk scores
6. **Real-Time Event Bus** - SSE-based event system with ticket viewer tracking
7. **Client Health & Opportunity Radar** - Identifies at-risk clients and upsell opportunities
8. **Ticket Number Badges** - Prominent ticket numbers (INC-xxxx, SR-xxxx, CHG-xxxx) on left of each ticket
9. **Ticket Viewer Tracking** - Color-flashing badges when a tech has a ticket open, with hover tooltip
10. **Enhanced Progress Bar** - Card-style progress tracker with gradient stages and click-to-change

## API Endpoints (New)
- `GET/PUT /api/settings/o365-mailbox` - O365 settings
- `POST /api/o365/connect|disconnect|test-connection|sync-emails` - O365 management
- `POST /api/o365/webhook/incoming-email` - Email-to-lead webhook
- `GET /api/o365/email-leads` - Email-generated leads
- `GET/POST/PUT/DELETE /api/asset-lifecycle` - Asset lifecycle CRUD
- `GET /api/asset-lifecycle/dashboard` - Lifecycle dashboard stats
- `POST /api/asset-lifecycle/{id}/transition` - Stage transitions
- `GET /api/predictive-maintenance/dashboard` - Fleet-wide risk analysis
- `GET /api/predictive-maintenance/device/{id}` - Per-device prediction
- `POST /api/events/publish` - Publish event to bus
- `GET /api/events/stream` - SSE event stream
- `GET /api/events/recent` - Recent events
- `POST /api/tickets/{id}/viewing|stop-viewing` - Viewer tracking
- `GET /api/tickets/active-viewers` - All active viewers
- `GET /api/health-radar/dashboard` - Client health & opportunity analysis

## DB Collections (New)
- `asset_lifecycle` - Asset lifecycle tracking
- `events` - Event bus events
- `settings` (type: "o365_mailbox") - O365 configuration

## Credentials
- Admin: admin@nexusops.io / admin123

## Backlog

### P1 - Next Up
- Full UniFi Integration Phase 2 (active device management)
- Full Xero Integration (real invoice syncing)

### P2 - Future
- Full backend for mocked integrations (Pax8, Domotz, Acronis, Proxmox)
- Real Office 365 Azure AD OAuth flow
- Client portal for end-user self-service
- Database seeding mechanism
- Fix recharts console warnings

## Testing
- Latest test: iteration_30.json - 100% pass rate (21/21 backend, all frontend verified)
