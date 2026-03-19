# NexusOps - Product Requirements Document

## Original Problem Statement
Build a rich and elegant RMM/PSA platform called "NexusOps" that rivals Syncro and Super Ops, fully feature-rich with the best features from competitors plus unique capabilities.

## Core Modules
1. **Dashboard** - Real-time overview with device health, tickets, alerts
2. **Ticketing** - Unified ticket system (SLA + Workshop + Cabling/WISP) with type icons, worksheets, AI triage, voice-to-ticket
3. **Estimates** - Full estimate lifecycle (Draft -> Published -> Sent -> Approved -> Declined -> Converted)
4. **Workshop** - Retail/bench repair job management with timer, parts, billing
5. **Field Jobs** - WISP/Internet field dispatch with checklists, signal/speed testing, zones
6. **Devices & RMM** - Device management, remote access, discovery, chat, predictive maintenance
7. **Clients & CRM** - Client management, leads, loyalty, sentiment scoring
8. **Products & Inventory** - Product catalog, bundling, stock management, on-order tracking
9. **Purchase Orders** - Full PO lifecycle, stock receiving, ping/escalation, audit trail
10. **Stocktake** - Inventory counting, variance tracking, reports, barcode scanner
11. **Technicians** - Tech management, on-call roster, ping/swap, performance, gamification
12. **Invoicing** - Invoices with PDF preview/print, white-label branding
13. **Contracts & Scheduling** - Contract management, smart scheduling with travel optimization
14. **Integrations** - Acronis, Proxmox, Gradient, UniFi, Splynx, Xero, O365, Pax8, Domotz
15. **Reporting** - Financial reports, tech performance, inventory reports
16. **Settings** - White-label, ticket ping, PO ping, job numbering prefixes

## Architecture
- **Frontend**: React + Shadcn/UI + TailwindCSS
- **Backend**: FastAPI + MongoDB
- **Auth**: JWT-based with role support
- **AI**: Emergent LLM Key (Claude Sonnet) for triage, sentiment, voice transcription

## Test Credentials
- Email: admin@nexusops.io
- Password: admin123

## What's Been Implemented

### Phase 1-4 (Previous Sessions)
- Core platform with all major modules
- Advanced ticketing with SLA, conversation view, PDF notifications
- Device management with remote access, discovery, chat
- Invoice system with PDF preview, print, white-label
- Integrations (Acronis, Proxmox, Gradient, RustDesk, O365)
- Financial reporting dashboard, Ticket attachments, Network device discovery

### Phase 5 - Inventory & Procurement (March 18, 2026)
- Purchase Order System with stock receiving, barcode scanner, PO ping & escalation, audit trail
- Stocktake System with variance tracking, finalization, premium reporting
- Product Bundling, Ticket Itemization, On-Order Indicators
- Vendor PO Integration, Stock Movements

### Phase 6 - Technician & Workshop Tools (March 18, 2026)
- Auto-Reorder Alerts: Low stock detection, auto PO creation, procurement ping
- On-Call Roster: Category shifts, swap, ping, pulsing ON CALL badge
- Workshop/Retail Jobs: Full repair lifecycle with timer, parts, billing
- WISP/Internet Field Jobs: Zone dispatch, installation checklists, signal/speed testing

### Phase 7 - Unified Tickets & Estimates (March 18, 2026)
- Unified Ticket System: Merged SLA, Workshop, and Cabling/WISP into single view
- Ticket Worksheets: Auditable checklist feature per ticket
- Estimates Module: Full lifecycle management
- Splynx Non-Payment UI, Job Numbering Configuration

### Phase 8 - 8 Differentiator Features (March 19, 2026)
All 8 features fully implemented and tested (100% pass rate):

1. **AI Ticket Triage & Auto-Routing**: AI analyzes tickets and suggests priority, category, technician assignment with confidence scoring. Integrated into ticket creation flow.
2. **Client Sentiment Scoring**: AI-powered analysis of client ticket history and communications. Dashboard with distribution stats, at-risk panel, churn probability. Full client detail view with factor breakdown.
3. **Technician Gamification & Leaderboard**: XP system, 7 levels (Rookie to Legend), 8 badges, activity heatmap, podium view. Auto-recalculation from ticket history.
4. **Smart Scheduling with Travel Optimization**: Zone-based map view, calendar view, route optimization using nearest-neighbor algorithm. Tech availability dashboard.
5. **Client-Facing Live Status Board**: Public page (no auth) showing ticket status, active incidents, upcoming work, pending estimates with approval. Auto-refreshes every 30s.
6. **Voice-to-Ticket**: Audio recording → Whisper transcription → AI structuring → Ticket creation. Integrated into ticket creation flow.
7. **Predictive Maintenance Alerts**: Device health scoring, telemetry analysis, failure predictions. Batch analysis for all devices, alert management.
8. **One-Click Client Onboarding Wizard**: 6-step wizard (Client Info, Contacts, Devices, Contract, Monitoring, Go Live). Creates real entities in DB.

## Prioritized Backlog

### P0 (Current Priority)
- Phase 9 Enhancements: Device Activity Monitoring, Acronis Reporting, UI Theming, Ticket UI Enhancement

### P1 (High Priority)
- Full UniFi Integration Phase 2 (active management)
- Full Xero Integration (real API vs mocked)

### P2 (Medium Priority)
- Full backend for Pax8, Domotz integrations
- Client self-service portal with estimate approval
- Recharts console warnings fix

### P3 (Low Priority)
- Component refactoring (TicketsPage, server.py auto-discovery)
- Database seeding mechanism
- SLA breach alerting
- Bluetooth barcode scanner integration

## Mocked Integrations
- Xero, Pax8, Domotz: Fully mocked
- Splynx non-payment: Mocked data
- Acronis, Proxmox, Gradient: Partially integrated

## Key API Endpoints (Phase 8)
- `/api/ai/triage`, `/api/ai/auto-route`
- `/api/sentiment/dashboard`, `/api/sentiment/clients`, `/api/sentiment/at-risk`, `/api/sentiment/analyze/{client_id}`
- `/api/gamification/leaderboard`, `/api/gamification/stats`, `/api/gamification/profile/{user_id}`, `/api/gamification/award-xp`
- `/api/scheduling/calendar`, `/api/scheduling/map-data`, `/api/scheduling/optimize-route`
- `/api/status-board/{client_id}` (PUBLIC)
- `/api/voice-ticket/transcribe`, `/api/voice-ticket/create-from-transcript`
- `/api/predictive/dashboard`, `/api/predictive/analyze/{device_id}`, `/api/predictive/analyze-all`
- `/api/onboarding/start`, `/api/onboarding/sessions`, `/api/onboarding/{session_id}/step/{step_num}`
