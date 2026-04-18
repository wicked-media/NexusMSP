# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 200+ backend routers and 75+ frontend pages.

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT-based + TOTP 2FA for portal
- **PDF**: fpdf2 for invoice/contract/PO/estimate PDF generation

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

## Recent Features (Apr 17-18, 2026)

### Phase 12-14: Client Portal + PDF System + Bug Fixes (Previous)
- Client Portal View (token-based), Invoice PDF Themes (5 built-in), Icon branding fix
- Reusable PdfViewerDialog, Contract/PO/Estimate PDF generation
- RustDesk URI fix, Invoice download popup blocker fix, Live status polling

### Phase 15-16: P2+P3 Batch (Current Session)

**P2 Enhancements:**
- **Estimate PDF Generation** — Branded PDF for estimates with theme support. Endpoints: `/api/estimates/{id}/pdf`, `/api/estimates/{id}/pdf/download`
- **Email from PDF Preview** — PdfViewerDialog now has Email button with recipient input (onEmail prop). Works for invoices in Finance Center.
- **Client Portal V2** — Full login-based portal (`/portal-login`, `/portal-dashboard`):
  - Login with email/password + 2FA support
  - Dashboard with 4 stat cards (Open Tickets, Devices Online, Outstanding $, Resolved)
  - Tickets tab with list + detail view with **real-time messaging** (conversation thread)
  - Devices tab with grid cards showing status/metrics
  - Invoices tab with table view
  - Knowledge Base tab with search + 5 demo articles
  - Profile tab showing user info + 2FA status
  - Backend: 8 new/enhanced endpoints in portal_v2.py (ticket detail, messaging, KB)

**P3 Tech Debt:**
- **Recharts console warnings** — Fixed all ResponsiveContainer instances with minWidth={1} minHeight={1}
- **Accessibility** — DialogContent component updated with aria-describedby handling (fixes 116 instances)
- **TicketsPage refactor** — Extracted shared configs to `/config/ticketConfig.js`, imported in TicketsPage & TechniciansPage
- **TechniciansPage refactor** — Shared priorityConfig/statusConfig now imported from ticketConfig.js
- Finance Center Estimates tab now has PDF preview/download buttons

## Test Reports
- iteration_93-95: Previous features (all 100%)
- iteration_96: P2+P3 Batch — 100% backend, 100% frontend (18 features tested)

## Remaining Backlog
- Multi-provider remote status (Splashtop/ScreenConnect) — requires user API keys
- Decompose seed.py (687 lines) — low priority
- Mobile-responsive optimization — deferred by user

## Key API Endpoints
- `/api/portal/v2/login` — Portal login with 2FA
- `/api/portal/v2/tickets/{id}` — Ticket detail with messages
- `/api/portal/v2/tickets/{id}/messages` — POST ticket message
- `/api/portal/v2/kb` — Knowledge base articles
- `/api/estimates/{id}/pdf?token=JWT` — Estimate PDF
- `/api/contracts/{id}/pdf?token=JWT` — Contract PDF
- `/api/purchase-orders/{id}/pdf/preview?token=JWT` — PO PDF
- `/api/invoice-themes/{id}/preview-pdf?token=JWT` — Theme preview
- `/api/rustdesk/live/status-map` — Live device status
