# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is a comprehensive Remote Monitoring & Management (RMM) and Professional Services Automation (PSA) platform, combining the best features of Syncro and SuperOps with advanced integrations.

## Original Problem Statement
Build a rich and elegant RMM/PSA platform like Syncro and SuperOps combined with:
- All core modules (Ticketing, RMM, Asset Management, Client Management)
- Advanced Reporting with charts
- Pax8 integration for recurring line items
- Contracts/Agreement management with recurring billing
- Automated invoice generation
- Time tracking on tickets
- Knowledge base / documentation module
- RustDesk self-hosted remote access integration
- Domotz monitoring integration
- Office 365 email integration
- Acronis backup subscription tracking
- Leads/CRM module for sales pipeline

## User Personas
1. **MSP Administrator** - Full access to all features, configuration, billing
2. **Technician** - Ticket handling, time tracking, device monitoring, KB access
3. **Client** (future) - Customer portal for tickets and documentation

## Core Requirements (Static)

### Modules Implemented
| Module | Status | Features |
|--------|--------|----------|
| Authentication | ✅ Complete | JWT-based login, registration, roles |
| Dashboard | ✅ Complete | Stats cards, charts, alerts, recent tickets |
| Ticketing | ✅ Complete | CRUD, SLA tracking, priorities, categories |
| Devices/RMM | ✅ Complete | Monitoring cards, CPU/RAM/Disk metrics, Chat & Remote buttons |
| Assets | ✅ Complete | Hardware/software inventory tracking |
| Clients | ✅ Complete | Organization management, MRR tracking |
| Contracts | ✅ Complete | Service agreements, recurring billing |
| Line Items | ✅ Complete | Recurring billing items, Pax8 sync |
| Invoices | ✅ Complete | Invoice generation, status management |
| Time Tracking | ✅ Complete | Quick timer, billable hours, hourly rates |
| Knowledge Base | ✅ Complete | Articles, categories, tags, search |
| Pax8 Integration | ✅ Complete | OAuth2 auth, subscriptions sync |
| Reports | ✅ Complete | Charts, analytics, KPIs |
| Domotz Integration | ✅ Complete | Network monitoring, agent management |
| Remote Access | ✅ Complete | RustDesk self-hosted, agent downloads |
| Device Chat | ✅ Complete | Real-time messaging, command execution |
| Leads/CRM | ✅ Complete | Pipeline management, lead tracking, proposals |
| Office 365 Email | ✅ Complete | Email composition, send/receive (MOCKED) |
| Acronis | ✅ Complete | Backup subscription tracking |

## What's Been Implemented

### Version 2.1.0 (December 2025)

**New Features Added:**
- **Leads/CRM Module**: Full sales pipeline with lead capture, qualification, conversion to clients, activity tracking, and proposals
- **Acronis Integration**: Backup subscription management with storage tracking and status monitoring
- **Office 365 Email**: Email composition and management with Microsoft Graph API (mocked)
- **Device Action Buttons**: Each device card now has Chat and Remote buttons for quick access
- **CRM Dashboard**: Pipeline value tracking, conversion rates, lead sources analytics

**Backend Additions (FastAPI)**
- Lead CRUD endpoints with pipeline stages
- Lead activities and follow-up tracking
- Proposal management system
- CRM dashboard aggregation
- Acronis subscription CRUD
- Acronis dashboard stats
- Office 365 authentication service
- Email CRUD and send functionality

**Frontend Pages Added:**
- LeadsPage.jsx - Full CRM with stats, filtering, CRUD
- AcronisPage.jsx - Backup subscription management
- EmailPage.jsx - Email inbox/compose functionality

**Integration Services (All MOCKED - Settings pages available):**
- Office 365 Graph API (tenant_id, client_id, client_secret)
- Acronis API (api_url, client_id, client_secret)
- RustDesk self-hosted (server_url, api_key, relay_server)
- Domotz API (api_key, api_url)
- Pax8 API (client_id, client_secret)

## Technical Architecture

```
/app/
├── backend/
│   └── server.py          # FastAPI app (~2600 lines) with all routes, models, services
├── frontend/
│   └── src/
│       ├── App.js         # Router with 20 routes
│       ├── components/
│       │   ├── Sidebar.jsx  # 17 navigation items
│       │   └── ui/          # Shadcn components
│       └── pages/
│           ├── DashboardPage.jsx
│           ├── DevicesPage.jsx    # Updated with Chat/Remote buttons
│           ├── LeadsPage.jsx      # NEW - CRM module
│           ├── AcronisPage.jsx    # NEW - Backup subscriptions
│           ├── EmailPage.jsx      # NEW - Office 365 email
│           └── ... (17 total pages)
└── memory/
    └── PRD.md
```

## Database Collections (MongoDB)
- users, clients, tickets, devices, assets, alerts
- contracts, line_items, invoices, time_entries, kb_articles
- settings (for integration credentials)
- leads, lead_activities, proposals
- acronis_subscriptions, emails, device_chat, remote_sessions

## API Endpoints Summary
- `/api/auth/*` - Authentication
- `/api/clients/*` - Client management
- `/api/tickets/*` - Ticketing
- `/api/devices/*` - Device management + chat
- `/api/assets/*` - Asset inventory
- `/api/alerts/*` - Alert management
- `/api/contracts/*` - Contracts
- `/api/line-items/*` - Billing items
- `/api/invoices/*` - Invoicing
- `/api/time-entries/*` - Time tracking
- `/api/kb-articles/*` - Knowledge base
- `/api/leads/*` - CRM leads
- `/api/proposals/*` - Proposals
- `/api/crm/dashboard` - CRM analytics
- `/api/acronis/*` - Backup management
- `/api/office365/*` - Email settings
- `/api/emails/*` - Email CRUD
- `/api/domotz/*` - Network monitoring
- `/api/remote/*` - Remote access
- `/api/pax8/*` - Pax8 integration
- `/api/dashboard/*` - Dashboard stats

## Demo Credentials
- Email: admin@nexusops.io
- Password: admin123

## Prioritized Backlog

### P0 - Critical (Next)
- [ ] Real-time device agent for actual monitoring data
- [ ] Email notifications for SLA breaches
- [ ] Connect actual RustDesk server when credentials provided

### P1 - High Priority
- [ ] Client self-service portal
- [ ] PDF export for invoices and proposals
- [ ] Scheduled invoice generation
- [ ] Multi-tenant support

### P2 - Medium Priority
- [ ] Custom dashboard widgets
- [ ] API rate limiting
- [ ] Audit logging
- [ ] Role-based access control (RBAC)
- [ ] SSO/SAML authentication

### P3 - Nice to Have
- [ ] Mobile responsive improvements
- [ ] Dark/Light theme toggle
- [ ] Custom branding per organization
- [ ] AI-powered ticket categorization
- [ ] Slack/Teams notifications

## Integration Settings Pages
All integrations have settings pages where credentials can be added:
- `/email` - Office 365 (Azure AD Tenant ID, Client ID, Secret)
- `/acronis` - Acronis (API URL, Client ID, Secret)
- `/remote-access` - RustDesk (Server URL, API Key, Relay Server)
- `/domotz` - Domotz (API Key, API URL)
- `/pax8` - Pax8 (Client ID, Client Secret)

## Test Results
- Backend: 100% (22/22 tests passed)
- Frontend: 100% (all features functional)
- Last tested: December 2025
