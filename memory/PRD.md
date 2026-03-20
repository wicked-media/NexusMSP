# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features are implemented in large, parallel batches to maximize efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async driver), 172 auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 170+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered from `/app/backend/app/routers/`. Frontend routes in `/app/frontend/src/config/routes.js`. Sidebar nav in `/app/frontend/src/config/navigation.js`.
- **Theming**: CSS variables in `index.css` (:root for dark, .light for light mode). ThemeProvider in App.js.

## Completed Phases

### Phase 8-12 (Previous Sessions) - DONE
85+ features including Tickets, Devices, Clients, Assets, Security, Financial, Networking, Integrations, Gamification

### P0 Refactoring - DONE
- `server.py`: Auto-discovers 172 routers
- `App.js`: Config-driven routes via `routes.js`
- `Sidebar.jsx`: Config-driven nav via `navigation.js`

### Phase B+C: DNS Monitor + 9 Features - DONE
### Phase D: Dark/Light Mode + 20 Security Features - DONE
### Bug Fix: Light Mode Sidebar - FIXED

### Phase E: Deep Patching + 12 MSP Forum Features - DONE
Patch Hub (8-tab), NLP Query, AI Auto-Resolution, Client Budget, Dark Web Monitor, Phishing Sim, Backup Verification, Compliance Frameworks, NPS Tracker, Executive Reports, Geo Map, Hardware Refresh, Onboarding Workflows

### Phase F: AI Self-Healing + 10 Advanced Features - DONE
Self-Healing, Predictive Failure, Usage Billing, Pricing Calculator, Comms Timeline, QBR Generator, Zero Trust, Webhook Builder, Git Scripts, Late Payment, Ransomware Tabletop

### Phase G: Dashboard Builder + Channel Mode + 3 Features - DONE
Dashboard Builder (12 widgets, 3 layouts), Channel/MSP-of-MSPs Mode (8 tenants), Mobile Tech Dashboard, Real-time SOC Feed, MRR/ARR Revenue Tracker

### Phase H: Ticket Enrichment + Global Search + Dashboard UX - DONE (March 20, 2026)
1. **Global Module Search** (Sidebar) - Ctrl+K command palette with instant fuzzy search across all 170+ pages/modules. Results show icon, label, and group. Navigate by clicking.
2. **AI Ticket Enrichment** (Ticket Detail) - 5 intelligent panels on every ticket:
   - **Client Sentiment** - AI keyword analysis detects frustrated/neutral/positive tone with score bar
   - **Resolution Prediction** - TTR estimate based on historical category/priority patterns with confidence %
   - **Impact Blast Radius** - Shows affected users and services when a linked device is a server/network device
   - **Client Health Card** - Health score gauge, open tickets, total devices, NPS, CSAT, contract value
   - **Smart Merge Suggestions** - Lists related/duplicate open tickets from the same client
3. **Internal Note Fix** - Removed redundant "Internal note" checkbox; notes are always internal when conversation type is "note"
4. **Dashboard Pulsating Borders** - CSS animated red pulsating border on Outstanding card (pulse-critical), orange pulsating border on SLA Breaches card (pulse-warning)

## Testing Status
- iteration_43.json: P0 Refactoring + Phase B+C (100% pass)
- iteration_44.json: Phase D - 21 features (100% pass)
- iteration_45.json: Phase E - 13 features + Patch Hub (100% pass)
- iteration_46 (pytest): Phase F - 11 features (100% pass)
- iteration_47.json: Phase G - 5 features (100% pass - 19/19 backend, 5/5 frontend)
- iteration_48.json: Phase H - Ticket Enrichment + Search + Dashboard UX (100% pass - 14/14 backend, all frontend)

## Stats
- **Backend Routers**: 172 auto-discovered
- **Frontend Pages**: 170+
- **Devices**: 131 across 15 clients
- **Collections**: 90+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Mocked Integrations
Xero, Pax8, Domotz, Ticket Enrichment AI (keyword-based), All Security/AI features

## Backlog (User-Approved)
### Remaining User Requests:
- AI-Powered Ticket Triage (auto-categorize, prioritize, route by skills matrix)
- Client Self-Service Portal (branded status page, ticket logging)
- Revenue-per-Ticket Tracking (profitability analysis)
- Automated Warranty Claims (detect & auto-generate vendor RMAs)
- Voice-to-Ticket (dictate ticket updates, AI transcribes)
- Competitive Win/Loss Tracker
- AR Remote Support
- Mobile Tech PWA (service worker)

### Other Backlog:
- **P1**: Phase 9 Enhancements (Device Activity Monitoring, Acronis Reporting)
- **P1**: Full UniFi Integration (Phase 2)
- **P2**: Full backend logic for mocked integrations (Xero, Pax8, Domotz)
- **P2**: Decompose monolithic `seed.py`
- **P2**: Decompose `navigation.js` into section-specific files
- **P3**: Bluetooth barcode scanner integration
- **P3**: Fix recharts console warnings
