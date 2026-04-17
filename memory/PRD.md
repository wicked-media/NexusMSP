# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform — the "ultimate MSP Swiss Army knife" — with 200+ backend routers and 75+ frontend pages covering every aspect of MSP operations.

## Tech Stack
- **Frontend**: React, Shadcn UI, TailwindCSS, Recharts
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Auth**: JWT-based + TOTP 2FA for portal
- **Email**: Resend (integration ready, requires API key)
- **PDF**: fpdf2 for invoice/contract/PO PDF generation

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal Demo: `john@acmecorp.com` / `portal123`

## Features Completed (Apr 17, 2026)

### Phase 12: Client Portal + Invoice Themes + Icon Branding Fix
- Fixed critical `client_portal.py` syntax error
- Client Portal View Page with 4 tabs + ticket submission
- Invoice PDF Themes (5 built-in) + Theme Picker UI
- Icon branding fix + Finance Center TabsList overflow fix

### Phase 13: PDF Viewer System
- Reusable PdfViewerDialog component (iframe + Download + Full Screen)
- Contract PDF Generation with SLA tier, line items, signature blocks
- PO PDF Preview endpoint (query-param auth)
- Theme Preview (sample PDF per theme)
- Preview/Download wired into Invoices, Contracts, PO pages

### Phase 14: Bug Fixes — Invoice Download + RustDesk Auto-Connect
- **Invoice Download Fix**: Changed `window.open()` to hidden anchor click to avoid popup blocker issues. Applied across invoices and contracts
- **RustDesk URI Fix**: Changed from incorrect `rustdesk://connection/new/{id}` to correct `rustdesk://{id}@{server_host}` format (per official RustDesk protocol spec). Updated both frontend `launchRustDesk()` in DeviceDetailPage and RemoteAccessPage, and backend `quick-connect` + device connect endpoints. Self-hosted server hostname is now extracted and included in URI for auto-routing.

## Test Reports
- iteration_93: Portal APIs + Invoice Themes (100% backend 16/16)
- iteration_94: PDF Viewer System (100% backend 19/19, 100% frontend)

## Backlog (Prioritized)

### P3 - Future
- Refactor TicketsPage.jsx (>3800 lines) & TechniciansPage.jsx
- Recharts console warnings fix
- Missing aria-describedby on some DialogContent
- Mobile-responsive optimization

## Key API Endpoints
- `/api/invoices/{id}/pdf?token=JWT` — Invoice PDF preview
- `/api/contracts/{id}/pdf?token=JWT` — Contract PDF preview
- `/api/purchase-orders/{id}/pdf/preview?token=JWT` — PO PDF preview
- `/api/invoice-themes/{id}/preview-pdf?token=JWT` — Theme sample PDF
- `/api/rustdesk/quick-connect` — RustDesk connection (now returns correct URI)
