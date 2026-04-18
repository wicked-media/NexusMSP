# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 200+ backend routers and 75+ frontend pages.

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT-based admin + JWT portal auth with TOTP 2FA
- **PDF**: fpdf2 for invoice/contract/PO/estimate PDF generation

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

## Recent Features (Apr 18, 2026)

### Phase 15-16: P2+P3 Batch
- Estimate PDF Generation with theme support
- Email from PDF Preview Dialog (onEmail prop)
- Client Portal V2: Login/2FA, Dashboard, Ticket Messaging, KB, Devices, Invoices, Profile
- Recharts console warnings fixed (10 instances)
- Accessibility: DialogContent aria-describedby fix (116 dialogs)
- TicketsPage/TechniciansPage config extraction refactor

### Phase 17: Portal User Management
- **Admin CRUD for portal users per client** — Create, Edit, Delete, Reset Password
- **Auto-generated passwords** — Temp password shown on create/reset with copy button
- **Granular permissions** — can_create_tickets, can_view_all_tickets, can_view_assets, can_view_invoices
- **Account enable/disable** — Block login without deleting
- **Duplicate email check** — 409 on existing email
- **Role management** — Admin, User, Viewer roles
- **Full flow**: Admin creates user → temp password generated → share with client → client logs in at /portal-login → changes password in portal
- Backend endpoints: GET/POST/PUT/DELETE `/api/client-portal/users/{client_id}` + `/reset-password`
- Frontend: Portal Users panel in Client Portal admin with table, Add User dialog, Edit User dialog

## Test Reports
- iteration_93-95: Previous features (all 100%)
- iteration_96: P2+P3 Batch — 100% (18 features)
- iteration_97: Portal User Management — 100% (14 tests)

## Remaining Backlog
- Multi-provider remote status (Splashtop/ScreenConnect) — requires user API keys
- Decompose seed.py (687 lines, low priority)
- Mobile-responsive optimization (deferred)

## Key API Endpoints
- `/api/client-portal/users/{client_id}` — GET list, POST create portal user
- `/api/client-portal/users/{client_id}/{user_id}` — PUT update, DELETE remove
- `/api/client-portal/users/{client_id}/{user_id}/reset-password` — POST reset
- `/api/portal/v2/login` — Portal login with 2FA
- `/api/portal/v2/tickets/{id}/messages` — Ticket messaging
- `/api/portal/v2/kb` — Knowledge base
- `/api/estimates/{id}/pdf?token=JWT` — Estimate PDF
