# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 200+ backend routers and 75+ frontend pages.

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT admin + JWT portal with TOTP 2FA
- **Email**: Resend (sender: onboarding@resend.dev)
- **Payments**: Stripe (test mode — sk_test_emergent)
- **PDF**: fpdf2 (invoices, contracts, POs, estimates)

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

## Recent Features (Apr 18, 2026)

### Portal Merge + Invoice Payments
- **Merged two portals into one** — Old token-based `/portal/:token` now auto-redirects to V2 login portal via `/api/portal/v2/token-auth`
- **Invoice detail view** — Full line items table, subtotal/tax/total breakdown, notes, payment history
- **Invoice payment** — Pay button with Stripe checkout (demo mode with test key). Shows balance due, initiates payment
- **Invoice list enhanced** — Balance column, payment status badges, clickable rows, "Pay" badges for unpaid
- **Token auth bridge** — Legacy portal links auto-authenticate matching portal users into V2

### Previous Features This Session
- Portal User Management (CRUD, welcome emails, password reset emails)
- Estimate PDF generation, Email from PDF Preview, Client Portal V2
- Recharts fix, Accessibility fix, Config refactoring
- RustDesk live status polling, Invoice download fix, RustDesk URI fix
- PDF Viewer across invoices/contracts/POs, Invoice themes

## Test Reports
- iteration_93-97: All 100% pass rates
- iteration_98: Portal merge — 17/17 backend, 100% frontend

## Remaining Backlog
- Verify custom sender domain on Resend
- Multi-provider remote status (Splashtop/ScreenConnect)
- Mobile-responsive optimization (deferred)
- Connect real Stripe key for live payments
