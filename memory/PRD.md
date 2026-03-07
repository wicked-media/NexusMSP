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
| Devices/RMM | ✅ Complete | Monitoring cards, CPU/RAM/Disk metrics |
| Assets | ✅ Complete | Hardware/software inventory tracking |
| Clients | ✅ Complete | Organization management, MRR tracking |
| Contracts | ✅ Complete | Service agreements, recurring billing |
| Line Items | ✅ Complete | Recurring billing items, Pax8 sync |
| Invoices | ✅ Complete | Invoice generation, status management |
| Time Tracking | ✅ Complete | Quick timer, billable hours, hourly rates |
| Knowledge Base | ✅ Complete | Articles, categories, tags, search |
| Pax8 Integration | ✅ Complete | OAuth2 auth, subscriptions sync |
| Reports | ✅ Complete | Charts, analytics, KPIs |

## What's Been Implemented

### Version 2.0.0 (March 7, 2026)

**Backend (FastAPI)**
- JWT authentication with bcrypt password hashing
- Full CRUD for: users, clients, tickets, devices, assets, alerts
- New: contracts, line_items, invoices, time_entries, kb_articles
- Pax8 OAuth2 integration service
- Dashboard aggregation endpoints
- SLA calculation and tracking
- Billable hours/amount calculations
- Demo data seeding endpoint

**Frontend (React + Tailwind + shadcn/UI)**
- Dark theme with Electric Blue (#3B82F6) primary color
- Collapsible sidebar navigation
- 12 fully functional pages:
  - Login (split-screen design)
  - Dashboard (bento grid, charts)
  - Tickets (table, filters, CRUD)
  - Devices (monitoring cards, metrics)
  - Assets (inventory table)
  - Clients (organization management)
  - Contracts (agreement management)
  - Invoices (billing management)
  - Time Tracking (quick timer, entries)
  - Knowledge Base (article cards, search)
  - Pax8 (integration setup, client linking)
  - Reports (multiple charts)
  - Settings (profile, notifications)

**Integrations**
- Pax8 API (OAuth2, subscriptions sync, company mapping)
- Recharts for data visualization
- date-fns for date formatting

## Prioritized Backlog

### P0 - Critical (Future)
- [ ] Real-time device agent for actual monitoring data
- [ ] Email notifications for SLA breaches
- [ ] Webhook support for alert integrations

### P1 - High Priority
- [ ] Client portal for end-users
- [ ] Multi-tenant support
- [ ] Automated invoice generation on schedule
- [ ] PDF export for invoices
- [ ] Stripe/payment integration

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

## Technical Architecture

```
Frontend (React 18)          Backend (FastAPI)          Database (MongoDB)
├── App.js (Router)          ├── server.py              ├── users
├── pages/                   ├── Models (Pydantic)      ├── clients
│   ├── Login               │   ├── User                ├── tickets
│   ├── Dashboard           │   ├── Client              ├── devices
│   ├── Tickets             │   ├── Ticket              ├── assets
│   ├── Devices             │   ├── Device              ├── alerts
│   ├── Assets              │   ├── Asset               ├── contracts
│   ├── Clients             │   ├── Contract            ├── line_items
│   ├── Contracts           │   ├── LineItem            ├── invoices
│   ├── Invoices            │   ├── Invoice             ├── time_entries
│   ├── TimeTracking        │   ├── TimeEntry           ├── kb_articles
│   ├── KnowledgeBase       │   ├── KBArticle           └── settings
│   ├── Pax8                │   └── Alert               
│   ├── Reports             ├── Pax8Service             
│   └── Settings            └── Auth (JWT/bcrypt)       
└── components/                                         
    └── Sidebar                                         
```

## Next Action Items
1. Add Pax8 API credentials to enable subscription sync
2. Configure email service for notifications
3. Set up scheduled tasks for recurring invoice generation
4. Implement client portal for customer self-service
5. Add PDF generation for invoices

## Demo Credentials
- Email: admin@nexusops.io
- Password: admin123
