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

#### Core Modules (All Production-Ready)
- Dashboard with SLA countdown, device fleet overview, quick search (Ctrl+K), auto-refresh, operational alerts
- Ticketing system (full CRUD, SLA, priorities, categories, email from tickets via Resend)
- Client management with contacts
- Technician management with scheduling
- Device/asset management with bulk actions (select all, reboot, scan, delete)
- Contract management
- Invoice management with Stripe
- Knowledge base with article pinning, public/internal visibility, Hudu sync, related articles
- Time entries with live timer, weekly chart, by-technician/client billing, CSV export
- Products and purchase orders
- Vendor management
- Phone/rental management
- Projects module
- Admin panel
- Activity logs and gamification/achievements
- Reports with 7 tabs (Overview, Technicians, Tickets, SLA Compliance, Revenue, Profitability, Devices) + CSV export

#### Advanced Features
- **Technician Co-Pilot**: AI-powered chat with code block rendering + copy
- **AI Diagnostics & Proofreading**: Backend AI service for device diagnosis and email proofreading
- **UniFi Integration (Phase 1)**: Real-time sync, WLAN management, DPI traffic analytics
- **Xero Dashboard**: Mocked accounting integration with revenue charts
- **Feature-Rich Ticket View**: Device status, remote actions, AI diagnosis, script execution, multi-tab layout
- **Per-Technician Settings**: Email signatures and canned responses
- **Enhanced Leads/CRM**: Syncro-style with create-ticket-from-lead, assign-client, activity timeline, pipeline view
- **Syncro RMM Import**: Settings, test connection, import clients/contacts/assets
- **Feature-Rich Scripting**: 5 tabs (Scripts, Library, History, Scheduling, Patches) with CodeBlock component
- **Resend Email Integration**: Emails from tickets with demo/production mode

### Session History
- **March 17, 2026 (Session 1)**: 5 parallel features (Resend email, enhanced leads, Syncro import, scripting, Co-Pilot)
- **March 17, 2026 (Session 2)**: 6 module enhancements (Dashboard, Reports, Time Tracking, KB, Devices, Scripting cleanup)

### Integration Status
| Integration | Status |
|---|---|
| Stripe | Implemented |
| Multi-LLM (Emergent Key) | Implemented |
| UniFi | Phase 1 Complete |
| Resend Email | Implemented |
| Syncro Import | Implemented (needs API key) |
| Hudu | Implemented (needs API key) |
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
- Enhance remaining modules: Contracts (renewal alerts, auto-invoicing), Projects (Gantt view, milestones), Clients (health score, document uploads)
- Full UniFi Integration Phase 2 (active device management, provisioning)
- Real Xero integration (move from mocked to live)

### P2 - Future
- Real backend for Pax8, Domotz, Acronis, Proxmox integrations
- Client portal for end-user self-service
- Standalone database seeding mechanism
- Real-time toast notifications for critical events
