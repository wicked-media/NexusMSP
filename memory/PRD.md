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
- **Remote Access**: RustDesk (self-hosted) with live status polling

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal Demo: `john@acmecorp.com` / `portal123`

## Features Completed (Apr 17-18, 2026)

### Phase 12: Client Portal + Invoice Themes + Icon Branding Fix
- Fixed critical `client_portal.py` syntax error
- Client Portal View Page with 4 tabs + ticket submission
- Invoice PDF Themes (5 built-in) + Theme Picker UI
- Icon branding fix + Finance Center TabsList overflow fix

### Phase 13: PDF Viewer System
- Reusable PdfViewerDialog component (iframe + Download + Full Screen)
- Contract PDF Generation with SLA tier, line items, signature blocks
- PO PDF Preview endpoint, Theme Preview (sample PDF per theme)
- Preview/Download wired into Invoices, Contracts, PO pages

### Phase 14: Invoice Download Fix + RustDesk Auto-Connect
- Invoice download: hidden anchor click replaces window.open (popup blocker fix)
- RustDesk URI: `rustdesk://ID@server_host` format (was incorrect `connection/new/ID`)

### Phase 15: RustDesk Live Connection Status Indicator
- **New endpoint**: `GET /api/rustdesk/live/status-map` — lightweight {rd_id: online/offline} map
- **Devices page**: 15-second polling with live status overlay on device badges, "RD" live indicator when RustDesk status differs from DB
- **Device Detail page**: Live status polling, LIVE badge, Remote Access button respects live status
- **Remote Access Hub**: Already had live peers — now shares the same infrastructure

## Test Reports
- iteration_93: Portal APIs + Invoice Themes (100%)
- iteration_94: PDF Viewer System (100% — 19/19 backend)
- iteration_95: RustDesk Status Polling + Bug Fixes (100% — 12/12 backend)

## Backlog (Prioritized)

### P2 - Enhancements
- Estimate PDF generation with theme system
- Email PDFs of contracts/POs from preview dialog
- Multi-provider remote access status (Splashtop, ConnectWise)

### P3 - Tech Debt & Polish
- Refactor TicketsPage.jsx (>3800 lines) & TechniciansPage.jsx
- Recharts console warnings fix
- Missing aria-describedby on some DialogContent
- Decompose monolithic seed.py and navigation.js
- Mobile-responsive optimization for field technicians

## Key API Endpoints
- `/api/rustdesk/live/status-map` — Live online/offline status map
- `/api/rustdesk/quick-connect` — RustDesk connection with correct URI
- `/api/invoices/{id}/pdf?token=JWT` — Invoice PDF preview
- `/api/contracts/{id}/pdf?token=JWT` — Contract PDF preview
- `/api/purchase-orders/{id}/pdf/preview?token=JWT` — PO PDF preview
- `/api/invoice-themes/{id}/preview-pdf?token=JWT` — Theme sample PDF
- `/api/portal-api/{token}/summary` — Public portal summary
