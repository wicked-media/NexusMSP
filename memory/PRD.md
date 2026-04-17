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
- Fixed critical `client_portal.py` syntax error (duplicate routes mid-return)
- Client Portal View Page (`/portal/:token`) with Overview, Devices, Tickets, Invoices tabs
- Invoice PDF Themes: 5 built-in themes integrated into PDF generation
- Theme Picker UI in Finance Center Branding tab
- Icon branding fix: double `/api/` prefix, server-side placeholder filtering
- Finance Center TabsList overflow fix (flex-wrap)

### Phase 13: PDF Viewer System Across All Document Types
- **Reusable PdfViewerDialog component** — inline PDF preview with iframe, Download + Full Screen buttons
- **Invoice Theme Preview** — Each theme card has Eye icon to generate sample PDF in selected theme
- **Contract PDF Generation** — New `generate_contract_pdf()` with branded header, client/contract details, SLA tier box, line items, contract value, signature blocks, footer
- **Contract PDF endpoints**: `GET /api/contracts/{id}/pdf?token=JWT` (preview) + `/pdf/download` (attachment)
- **PO PDF Preview endpoint**: `GET /api/purchase-orders/{id}/pdf/preview?token=JWT` (inline, query-param auth)
- **Invoice preview button** added to Finance Center invoice rows (Eye icon opens PdfViewerDialog)
- **Contract preview/download** added to Contracts page dropdown menu
- **PO preview button** added to Purchase Orders page (detail view + list table)
- All PDF endpoints use query-param token auth for iframe compatibility

## Test Reports
- iteration_93: Portal APIs + Invoice Themes (100% backend 16/16)
- iteration_94: PDF Viewer System (100% backend 19/19, 100% frontend)

## Backlog (Prioritized)

### P3 - Future
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx (>3800 lines) & TechniciansPage.jsx
- Bluetooth barcode scanner integration
- Recharts console warnings fix
- Missing aria-describedby on some DialogContent
- Mobile-responsive optimization for field technicians

## Key API Endpoints
- `/api/invoices/{id}/pdf?token=JWT` — Invoice PDF preview
- `/api/invoices/{id}/pdf/download?token=JWT` — Invoice PDF download
- `/api/contracts/{id}/pdf?token=JWT` — Contract PDF preview
- `/api/contracts/{id}/pdf/download?token=JWT` — Contract PDF download
- `/api/purchase-orders/{id}/pdf/preview?token=JWT` — PO PDF preview
- `/api/invoice-themes` — GET all themes, POST create custom
- `/api/invoice-themes/active` — GET/PUT active theme
- `/api/invoice-themes/{id}/preview-pdf?token=JWT` — Theme sample PDF
- `/api/portal-api/{token}/summary` — Public portal summary
- `/api/settings/branding` — Platform branding config
