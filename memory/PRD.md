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
7. **Clients & CRM** - Client management, leads, loyalty, sentiment scoring, health scoring
8. **Products & Inventory** - Product catalog, bundling, stock management, on-order tracking
9. **Purchase Orders** - Full PO lifecycle, stock receiving, ping/escalation, audit trail
10. **Stocktake** - Inventory counting, variance tracking, reports, barcode scanner
11. **Technicians** - Tech management, on-call roster, ping/swap, performance, gamification
12. **Invoicing** - Invoices with PDF preview/print, white-label branding
13. **Contracts & Scheduling** - Contract management, smart scheduling with travel optimization
14. **Integrations** - Acronis, Proxmox, Gradient, UniFi, Splynx, Xero, O365, Pax8, Domotz
15. **Reporting** - Financial reports, tech performance, inventory reports, benchmarking
16. **Settings** - White-label, ticket ping, PO ping, job numbering prefixes

## Architecture
- **Frontend**: React + Shadcn/UI + TailwindCSS
- **Backend**: FastAPI + MongoDB
- **Auth**: JWT-based with role support
- **AI**: Emergent LLM Key (Claude Sonnet) for triage, sentiment, copilot, voice transcription, doc scanning
- **Encryption**: Fernet for password vault

## Test Credentials
- Email: admin@nexusops.io
- Password: admin123

## Completed Phases

### Phase 1-4: Core Platform
- All major modules, advanced ticketing, device management, invoicing, integrations

### Phase 5: Inventory & Procurement
- Purchase Orders, Stocktake, Product Bundling, Vendor PO Integration

### Phase 6: Technician & Workshop Tools
- Auto-Reorder Alerts, On-Call Roster, Workshop/Retail Jobs, WISP Field Jobs

### Phase 7: Unified Tickets & Estimates
- Unified Ticket System, Worksheets, Estimates Module, Job Numbering

### Phase 8: 8 Differentiator Features (March 19, 2026)
1. AI Ticket Triage & Auto-Routing
2. Client Sentiment Scoring Dashboard
3. Technician Gamification & Leaderboard
4. Smart Scheduling with Travel Optimization
5. Client-Facing Live Status Board
6. Voice-to-Ticket
7. Predictive Maintenance Alerts
8. One-Click Client Onboarding Wizard

### Phase 10: 15 Swiss Army Knife Features (March 19, 2026)
All tested 100% pass rate:
1. **AI Copilot Chat** - Platform-wide AI assistant with live data access
2. **Client Health Score Dashboard** - Composite score (sentiment+tickets+payments+devices+engagement)
3. **NOC Wallboard** - Full-screen TV-mountable dashboard with live ticket queue, SLA timers, tech status
4. **Magic Link Client Portal** - Zero-login client access to tickets, devices, estimates, contracts
5. **Network Topology Auto-Mapper** - SVG network diagrams per client from device data
6. **Runbook Automation Engine** - If-this-then-that workflows with 5 pre-built templates
7. **Password Vault** - Encrypted credential storage with reveal, copy, audit trail
8. **QR Code Asset Tags** - Batch QR generation for all devices, printable labels
9. **Bulk Email Campaign Tool** - Branded campaigns with templates, recipient filtering
10. **SLA Countdown Timer** - Live SLA tracking with breach predictions
11. **Time-to-Resolution Benchmarking** - Compare MSP metrics against industry averages
12. **Automated Billing Reconciliation** - Find unbilled time, products, contract overages
13. **Upsell Opportunity Detector** - AI scan for device/backup/tier gaps
14. **Client ROI Report Generator** - Value-delivered reports with downtime savings
15. **Smart Document Scanner** - AI OCR to extract device info from text/labels

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

## Key API Endpoints (Phase 10)
- `/api/copilot/chat`, `/api/copilot/suggestions`, `/api/copilot/history`
- `/api/client-health/scores`, `/api/client-health/dashboard`
- `/api/wallboard/data`, `/api/wallboard/public`
- `/api/magic-portal/generate/{client_id}`, `/api/magic-portal/access/{token}`
- `/api/topology/all`, `/api/topology/{client_id}`
- `/api/automation`, `/api/automation/templates`, `/api/automation/{id}/test`
- `/api/vault/entries`, `/api/vault/entries/{id}`, `/api/vault/audit-log`
- `/api/qr-assets/generate-batch`, `/api/qr-assets/print-sheet`
- `/api/campaigns`, `/api/campaigns/templates`, `/api/campaigns/{id}/send`
- `/api/sla-timer/active`, `/api/sla-timer/predictions`
- `/api/benchmarking/overview`
- `/api/billing-recon/overview`
- `/api/upsell/opportunities`
- `/api/roi-reports`, `/api/roi-reports/{client_id}`
- `/api/doc-scanner/scan`, `/api/doc-scanner/create-device`

## Mocked Integrations
- Xero, Pax8, Domotz: Fully mocked
- Email campaigns: Simulated sending (no actual emails)
- Runbook automation: Simulated execution (no real actions)
