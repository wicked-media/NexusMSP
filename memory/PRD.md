# NexusOps - Ultimate RMM/PSA Platform PRD

## Overview
NexusOps is a comprehensive Remote Monitoring & Management (RMM) and Professional Services Automation (PSA) platform, designed to exceed the capabilities of Syncro and SuperOps combined.

## Original Problem Statement
Build the ultimate RMM/PSA platform with all features MSPs need:
- All core modules (Ticketing, RMM, Asset Management, Client Management)
- RustDesk self-hosted remote access integration
- Domotz monitoring integration
- Office 365 email integration for ticket communications
- Acronis backup subscription tracking
- Leads/CRM module for sales pipeline
- Scripting & Automation
- Patch Management
- IT Documentation with password vault
- Project Management
- Customer Portal
- Runbooks/Workflows
- Technician Scheduling
- Yeastar PBX phone system integration
- And more...

## What's Been Implemented

### Core Modules (100% Complete)
| Module | Status | Features |
|--------|--------|----------|
| Authentication | Done | JWT-based login, registration, roles |
| Dashboard | Done | Stats cards, charts, alerts, recent tickets |
| Ticketing | Done | CRUD, SLA tracking, priorities, **click-into detail view, notes, email compose, email signatures** |
| Devices/RMM | Done | Monitoring cards, CPU/RAM/Disk metrics, Chat & Remote buttons |
| Assets | Done | Hardware/software inventory tracking |
| Clients | Done | Organization management, MRR tracking |
| Contracts | Done | Service agreements, recurring billing |
| Line Items | Done | Recurring billing items, Pax8 sync |
| Invoices | Done | Invoice generation, status management |
| Time Tracking | Done | Quick timer, billable hours, hourly rates |
| Knowledge Base | Done | Articles, categories, tags, search |
| Reports | Done | Charts, analytics, KPIs |

### New Features (December 2025)
| Module | Status | Features |
|--------|--------|----------|
| Leads/CRM | Done | Pipeline, lead tracking, conversion, proposals |
| Acronis | Done | Backup subscription tracking (MOCKED) |
| Office 365 Email | Done | Email composition, ticket emails (MOCKED) |
| Scripting | Done | Script library, execution on devices, scheduling |
| IT Documentation | Done | Password vault with reveal, documentation pages |
| Project Management | Done | Projects, tasks, progress tracking |
| Patch Management | Done | Policies, patch approval, dashboard |
| Device Groups | Done | Group devices, auto-assign rules |
| Policies | Done | Monitoring, security, maintenance policies |
| Runbooks | Done | Workflow automation, step execution |
| Customer Portal | Done | Portal users, permissions, login |
| Audit Logs | Done | Full activity tracking |
| Technician Scheduling | Done | Calendar, appointments, on-call rotation |
| Custom Fields | Done | Add fields to any entity |
| Webhooks | Done | Event notifications to external systems |
| Sites/Locations | Done | Multi-site support per client |
| **Yeastar PBX** | Done | Extensions, active calls, call logs, system info (MOCKED) |
| **Ticket Detail View** | Done | Click into tickets, notes, email sending, signatures |
| **User Email Signatures** | Done | Save/load per-user signatures |

### Integrations (All MOCKED - Settings pages available)
| Integration | Settings Page | Features |
|-------------|---------------|----------|
| Office 365 | `/email` | Azure AD credentials, email send/receive |
| Acronis | `/acronis` | API credentials, subscription sync |
| RustDesk | `/remote-access` | Self-hosted server, API key |
| Domotz | `/domotz` | API credentials, network monitoring |
| Pax8 | `/pax8` | OAuth2, subscription sync |
| Proxmox | `/proxmox` | Server management |
| **Yeastar PBX** | `/yeastar` | PBX URL, Client ID/Secret, extensions, calls, CDR |

## Navigation Structure (Grouped Sidebar)

```
MAIN
├── Dashboard
└── Tickets

INFRASTRUCTURE
├── Devices
├── Assets
├── Scripting
└── Remote Access

BUSINESS
├── Clients
├── Leads & CRM
├── Projects
├── Contracts
├── Invoices
└── Time Tracking

COMMUNICATION
├── Email
├── IT Docs
└── Knowledge Base

INTEGRATIONS
├── Yeastar PBX
├── Proxmox
├── Domotz
├── Acronis
└── Pax8

SYSTEM
├── Expiry Tracker
├── Reports
└── Settings
```

## API Endpoints (80+ endpoints)

### Core APIs
- `/api/auth/*` - Authentication
- `/api/dashboard/*` - Dashboard stats
- `/api/clients/*` - Client management
- `/api/tickets/*` - Ticketing
- `/api/tickets/{id}/comments` - Ticket notes/comments
- `/api/tickets/{id}/emails` - Ticket email integration
- `/api/devices/*` - Device management
- `/api/assets/*` - Asset inventory
- `/api/users/{id}` - User update (email signature)
- `/api/contracts/*` - Contracts
- `/api/invoices/*` - Invoicing
- `/api/time-entries/*` - Time tracking
- `/api/kb-articles/*` - Knowledge base

### Yeastar PBX APIs
- `/api/yeastar/status` - Connection status
- `/api/yeastar/settings` - Configuration
- `/api/yeastar/test-connection` - Test PBX connection
- `/api/yeastar/system-info` - PBX system info
- `/api/yeastar/extensions` - Extension list & status
- `/api/yeastar/active-calls` - Live call monitoring
- `/api/yeastar/call-logs` - Call history/CDR
- `/api/yeastar/dashboard` - Phone system dashboard

## Technical Architecture

```
/app/
├── backend/
│   └── server.py          # FastAPI (~4900 lines)
├── frontend/
│   └── src/
│       ├── App.js         # Router with 23+ routes
│       ├── components/
│       │   ├── Sidebar.jsx  # Grouped navigation
│       │   └── ui/          # Shadcn components
│       └── pages/           # 25 pages total
│           ├── TicketsPage.jsx   # Full detail view with notes/emails
│           ├── YeastarPage.jsx   # NEW - PBX management
│           └── ...
└── memory/
    └── PRD.md
```

## Demo Credentials
- Email: admin@nexusops.io
- Password: admin123

## Prioritized Backlog

### P0 - Critical (Next)
- Refactor server.py into /routers, /models, /services directories
- Real-time device agent for actual monitoring data
- Connect actual RustDesk server when credentials provided

### P1 - High Priority
- Implement real Office 365 email send/receive (requires Azure AD OAuth)
- Implement real Yeastar PBX connection (requires PBX credentials)
- Implement real Pax8, Domotz, Acronis integrations
- Client self-service portal frontend
- PDF export for invoices and proposals

### P2 - Medium Priority
- Custom dashboard widgets
- API rate limiting
- Role-based access control (RBAC)
- SSO/SAML authentication
- Fix chart console warnings on Reports page

### P3 - Nice to Have
- Mobile responsive improvements
- Dark/Light theme toggle
- Custom branding per organization
- AI-powered ticket categorization
- Slack/Teams notifications

## Test Results
- Backend: All endpoints working (80+ endpoints)
- Frontend: All pages functional (25 pages)
- Ticket detail view: Fully tested (notes, emails, signatures)
- Yeastar PBX: Fully tested (all tabs, settings, MOCKED)
- Last tested: March 2026, iteration_4
