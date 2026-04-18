# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 200+ backend routers and 75+ frontend pages.

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT-based admin + JWT portal auth with TOTP 2FA
- **Email**: Resend (configured, sender: onboarding@resend.dev)
- **PDF**: fpdf2 for invoice/contract/PO/estimate PDF generation

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

## Recent Features (Apr 18, 2026)

### Portal User Management + Welcome Emails
- Full CRUD for portal users per client (create, edit, delete, reset password)
- Auto-generated passwords with copy-to-clipboard
- Granular permissions (tickets, devices, invoices)
- **Welcome email** — branded HTML email with login credentials + portal URL sent via Resend on user creation
- **Password reset email** — branded HTML email sent on admin password reset
- "Send Welcome Email" toggle in Add User dialog
- Sender: `onboarding@resend.dev` (Resend default — user should verify their own domain on resend.com for custom sender)

### Previous: P2+P3 Batch
- Estimate PDF Generation, Email from PDF Preview, Client Portal V2, Recharts fix, Accessibility fix, Config refactoring

## Test Reports
- iteration_93-95: Previous features (all 100%)
- iteration_96: P2+P3 Batch — 100% (18 features)
- iteration_97: Portal User Management — 100% (14 tests)
- Welcome email: Tested live — Resend ID 47e614ea confirmed delivery

## Important Notes
- **Resend sender domain**: Currently using `onboarding@resend.dev`. To send from a custom domain (e.g., `noreply@stech.com.au`), verify the domain at https://resend.com/domains and update SENDER_EMAIL in backend/.env
- **Resend test mode**: In test mode, emails can only be delivered to the Resend account owner's email

## Remaining Backlog
- Verify custom sender domain on Resend for production emails
- Multi-provider remote status (Splashtop/ScreenConnect)
- Mobile-responsive optimization (deferred)
