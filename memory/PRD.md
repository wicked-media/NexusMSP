# NexusOps - RMM/PSA Platform
## Product Requirements Document

### Original Problem Statement
Build a "rich and elegant RMM/PSA like Syncro and Super Ops" named "NexusOps" - a comprehensive, feature-rich platform to surpass competitors, including modules for Ticketing, Client Management, Scripting, Reporting, Invoicing, and CRM.

### Core Architecture
- **Frontend**: React + Shadcn UI + TailwindCSS
- **Backend**: FastAPI + MongoDB
- **Auth**: JWT-based authentication
- **AI**: Multi-LLM support via Emergent LLM Key (Claude, GPT, Gemini)
- **Email**: Resend integration (real sending with valid key, demo mode with placeholder)

### What's Been Implemented

#### Core Modules
- Dashboard with real-time stats and charts
- Ticketing system (full CRUD, SLA, priorities, categories, email from tickets)
- Client management with contacts
- Technician management with scheduling
- Device/asset management
- Contract management
- Invoice management with Stripe
- Knowledge base
- Time entries and tracking
- Products and purchase orders
- Vendor management
- Phone/rental management
- Projects module
- Admin panel
- Activity logs and gamification/achievements

#### Advanced Features (Recent Sessions)
- **Technician Co-Pilot**: AI-powered chat assistant in ticket view
- **AI Diagnostics & Proofreading**: Backend AI service for device diagnosis and email proofreading
- **UniFi Integration (Phase 1)**: Real-time sync, WLAN management, DPI traffic analytics
- **Xero Dashboard**: Mocked accounting integration with revenue charts
- **Feature-Rich Ticket View**: Device status, remote actions, AI diagnosis, script execution, multi-tab layout
- **Per-Technician Settings**: Email signatures and canned responses

#### Latest Session (March 17, 2026) - 5 Parallel Features
1. **Resend Email Integration**: Emails from tickets send via Resend (with valid key) or demo mode
2. **Enhanced Leads/CRM Module**: Syncro-style with create-ticket-from-lead, assign-client, activity timeline, pipeline view
3. **Syncro RMM Client Import**: Settings, test connection, import clients/contacts/assets from Syncro
4. **Feature-Rich Scripting Page**: 5 tabs (Scripts, Library with 8 templates, History, Scheduling, Patches)
5. **AI Co-Pilot**: Fully functional chat panel on ticket detail pages

### Integration Status
| Integration | Status |
|---|---|
| Stripe | Implemented |
| Multi-LLM (Emergent Key) | Implemented |
| UniFi | Phase 1 Complete |
| Resend Email | Implemented |
| Syncro Import | Implemented (needs API key) |
| Xero | MOCKED |
| Pax8 | MOCKED |
| Domotz | MOCKED |
| Acronis | MOCKED |
| Proxmox | MOCKED |

### Credentials
- **Email**: admin@nexusops.io
- **Password**: admin123

---

## Prioritized Backlog

### P1 - Upcoming
- Full UniFi Integration Phase 2 (active device management, provisioning)
- Real Xero integration (move from mocked to live)
- Real-time toast notifications for critical events

### P2 - Future
- Real backend for Pax8, Domotz, Acronis, Proxmox integrations
- Standalone database seeding mechanism
- Client portal for end-user self-service
- Fix recharts console warnings on Reports page

### P3 - Nice to Have
- Co-Pilot button positioning verification
- Additional script library templates
