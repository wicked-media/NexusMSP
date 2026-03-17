# NexusOps - RMM/PSA Platform
## Product Requirements Document

### Original Problem Statement
Build a "rich and elegant RMM/PSA like Syncro and Super Ops" named "NexusOps" - a comprehensive, feature-rich platform to surpass competitors.

### Core Architecture
- **Frontend**: React + Shadcn UI + TailwindCSS
- **Backend**: FastAPI + MongoDB
- **Auth**: JWT-based authentication
- **AI**: Multi-LLM via Emergent LLM Key (Claude, GPT, Gemini)
- **Email**: Resend integration

### Credentials
- **Email**: admin@nexusops.io | **Password**: admin123

---

## Implemented Features (All Tested & Working)

### Core Modules
- Dashboard (SLA countdown, device fleet overview, quick search Ctrl+K, auto-refresh 60s, operational alerts)
- Ticketing (full CRUD, SLA, priorities, email via Resend, Co-Pilot AI, device status)
- Client Management (health scores 0-100, activity timeline, contacts, M365, Splynx, subscriptions)
- Technicians (profiles, scheduling, per-tech email signatures, canned responses)
- Devices (bulk select/actions, CPU/RAM/Disk monitoring, compliance scores)
- Contracts (renewal alerts 30/60/90 day, SLA tiers platinum/gold/silver/standard, auto-renew)
- Invoicing (Stripe integration, overdue tracking)
- Knowledge Base (pinning, public/internal visibility, Hudu sync, related articles, helpful votes)
- Time Tracking (live timer, weekly chart, by-technician/client billing, CSV export)
- Reports (7 tabs: Overview, Technicians, Tickets, SLA Compliance, Revenue, Profitability, Devices + CSV)
- Scripting (code blocks with copy, 8 library templates, scheduling, patch management)
- Projects (milestones, time budget vs actual tracking, tasks)
- Products, Purchase Orders, Vendors, Assets, Phone/Rentals, Admin, Activity Logs, Achievements

### Advanced Features
- **Client Health Score Engine**: Auto-calculated (Tickets/30 + SLA/20 + Devices/20 + Payments/20 + Contracts/10 = 100)
- **Global Notification Bell**: SLA breach, contract renewal, device offline alerts with unread count
- **Technician Co-Pilot**: AI chat with code block rendering
- **AI Diagnostics & Proofreading**: Device diagnosis, email proofreading
- **Enhanced Leads/CRM**: Syncro-style pipeline, create ticket from lead, assign client
- **Syncro RMM Import**: Import clients/contacts/assets from Syncro
- **UniFi Integration Phase 1**: WLAN management, DPI analytics

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
| Pax8/Domotz/Acronis/Proxmox | MOCKED |

### Session History
- **Session 1**: 5 parallel features (Resend email, leads, Syncro import, scripting, CoPilot)
- **Session 2**: 6 module enhancements (Dashboard, Reports, Time Tracking, KB, Devices, Scripting)
- **Session 3**: 5 major features (Health Scores, Contracts, Projects, Clients, Notifications)

---

## Prioritized Backlog

### P1 - Upcoming
- Enhanced Projects page frontend (milestones UI, Gantt timeline, task dependencies)
- Full UniFi Integration Phase 2 (active device management, provisioning)
- Real Xero integration (move from mocked)

### P2 - Future
- Real Pax8/Domotz/Acronis/Proxmox backends
- Client self-service portal
- Document upload system for clients
- Real-time WebSocket notifications
