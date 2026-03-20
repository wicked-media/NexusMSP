# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for MSPs. Full-send mode with rapid parallel feature delivery.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async), 178+ auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 174+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)

## Completed Phases

### Phases 8-12, P0, B-J: 95+ features, all DONE & TESTED

### Ticket Lifecycle & Tech Settings (March 20, 2026) - DONE
- Auto-close: Resolved tickets auto-set to Closed
- 24h filter: Closed tickets drop from main list after 24 hours
- Client page shows Active and Resolved/Closed tickets separately
- Full Technician Settings page (9 tabs): Profile, Security (password, 2FA, FIDO2), Email Signature, Notifications, Working Hours, API Keys, Sessions, Display, Badges & Awards
- Accessible via clicking user avatar in sidebar bottom-left

### P1 Feature Batch (March 20, 2026) - DONE
1. **AI-Powered Intelligent Routing**: Tech workload dashboard with skills/capacity/SLA/CSAT, 5 routing rules with toggles, bulk route unassigned, single ticket routing with reasoning
2. **Client Self-Service Portal**: Per-client branded portal config, token generation, public endpoints for ticket creation/viewing, device status
3. **Revenue-per-Ticket Tracking**: Profitability by ticket/client/technician, margin analysis, labor vs parts breakdown
4. **Voice-to-Ticket**: Speech transcription, AI keyword extraction (priority/category), create tickets or add notes from voice

## Testing Status
- iteration_43-52: All passed (100%)
- iteration_51: Tech Settings + Ticket Lifecycle (100%)
- iteration_52: P1 Features (25/25 backend, all 4 frontend pages) 

## Stats
- **Backend Routers**: 178+ auto-discovered
- **Frontend Pages**: 174+
- **Devices**: 131 across 15 clients
- **Collections**: 100+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Backlog
### P2 - Future:
- Deeper CRM integrations (Xero, Pax8, Domotz)
- Cross-platform scripting library
- Mobile Tech PWA
- Bluetooth barcode scanner

### P3 - Low Priority:
- recharts console warnings fix
- Decompose monolithic seed.py + navigation.js
- aria-describedby for DialogContent (accessibility)
