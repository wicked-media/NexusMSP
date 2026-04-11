# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM (Remote Monitoring & Management) and PSA (Professional Services Automation) platform designed as the "ultimate MSP Swiss Army knife." Built for managed service providers, it offers 16+ advanced modules covering every aspect of MSP operations.

## Core Requirements
- Unified dashboard for MSP operations monitoring
- Multi-tenant client portal with 2FA
- Full ticketing, invoicing, and billing workflows
- Remote device management (RustDesk, Splashtop, MeshCentral)
- NOC morning checks and automated reporting
- Client onboarding with visual tracking
- Document branding and template customization

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT-based + TOTP 2FA for portal
- **Email**: Resend (integration ready, requires API key)

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal Demo: `john@acmecorp.com` / `portal123`

## Implemented Modules (Complete)
1. Dashboard / Command Center
2. Tickets (with SLA countdowns, bulk actions)
3. Devices / RMM
4. Clients / CRM
5. Invoicing (Xero Finance Center)
6. Purchase Orders
7. Estimates
8. Recurring Billing (with MRR/ARR forecasting)
9. SOC / Security Operations
10. Remote Access Hub (RustDesk, Splashtop, MeshCentral)
11. Client Onboarding Wizard (with Kanban board)
12. Technicians (with email invites)
13. Morning Checks Dashboard (with email reports)
14. Scripting Live Terminal
15. Multi-Tenant Client Portal
16. Document Branding & Templates
17. Reports & Analytics
18. Global Settings Hub
19. Vendor Scorecard, SLA Penalties, Alert Suppression
20. Incident Heatmap, Predictive Failure, Capacity Planner
21. Auto Documentation, NLP Query

## Features Completed This Session (Apr 11, 2026)

### 1. Daily Morning Check Email Report
- `POST /api/morning-checks/send-email-report` - formats NOC data as rich HTML email
- Beautiful dark-themed HTML template with health score, KPIs, offline devices, critical tickets
- Email Report button + dialog on MorningChecksPage
- Works with Resend (mocked when no API key)

### 2. Invoice, Letterhead & PO Branding Templates
- `GET/POST /api/doc-branding/templates` - 4 builtin templates (Professional, Modern, Corporate, Tech Forward)
- `GET/PUT /api/doc-branding/settings/{doc_type}` - per-document-type settings (invoice, PO, estimate, letterhead)
- `GET /api/doc-branding/preview/{template_id}` - live HTML preview
- Branding tab in Xero Finance Center with company details form, template selector, color swatches, and scaled preview

### 3. Technician Email Invites
- `POST /api/technicians/invite` - creates invite with token, sends email
- `GET /api/technicians/invites` - list all invites
- `DELETE /api/technicians/invites/{id}` - revoke pending invite
- `POST /api/technicians/invites/{id}/resend` - resend email
- `POST /api/technicians/accept-invite` - accept invite and create account
- Invite button + dialog + invites list on TechniciansPage

### 4. Onboarding Module Revamp (Kanban Tracker)
- KanbanBoardView component with 3 columns (In Progress, Paused, Completed)
- Cards with progress bars, step indicators, priority badges, health scores
- Board/List view toggle with persistent selection
- Default view is Kanban board

## Mocked Integrations
- Xero accounting data (requires OAuth keys for live)
- Resend email sending (returns mocked status when no API key)
- AI routing and SOC data feeds
- Huntress security data

## Backlog (Prioritized)

### P2 - Upcoming
- Workflow Automation Builder (visual drag-and-drop)
- Cross-platform scripting library

### P3 - Future
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx (>3800 lines)
- Refactor TechniciansPage.jsx (>1500 lines)
- Bluetooth barcode scanner integration
- Recharts console warnings fix
- Missing aria-describedby for some DialogContent

## Architecture
```
/app/backend/app/routers/  (190+ auto-discovered routers)
/app/frontend/src/pages/   (30+ page components)
```

## Key API Endpoints
- `/api/morning-checks/*` - NOC dashboard
- `/api/morning-checks/send-email-report` - Email report
- `/api/technicians/*` - Technician CRUD + invites
- `/api/doc-branding/*` - Document branding templates/settings
- `/api/onboarding-enhanced/*` - Client onboarding
- `/api/xero/*` - Finance center
- `/api/portal_v2/*` - Client portal
