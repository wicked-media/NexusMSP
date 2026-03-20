# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features implemented in large, parallel batches for maximum efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async), 174 auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 170+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered from `/app/backend/app/routers/`. Frontend routes in `routes.js`, sidebar nav in `navigation.js`.
- **Theming**: CSS variables (:root dark, .light light mode)

## Completed Phases

### Phases 8-12 (Previous Sessions) - DONE
85+ features: Tickets, Devices, Clients, Assets, Security, Financial, Networking, Integrations, Gamification

### P0 Refactoring - DONE
Auto-discovery for routers, config-driven routes + sidebar nav

### Phase B+C: DNS Monitor + 9 Features - DONE
### Phase D: Dark/Light Mode + 20 Security Features - DONE
### Phase E: Deep Patching + 12 MSP Forum Features - DONE
Patch Hub (8-tab), NLP Query, AI Auto-Resolve, + 10 more

### Phase F: AI Self-Healing + 10 Advanced Features - DONE
Self-Healing, Predictive Failure, Usage Billing, Pricing Calculator, Comms Timeline, QBR Generator, Zero Trust, Webhook Builder, Git Scripts, Late Payment, Ransomware Tabletop

### Phase G: Dashboard Builder + Channel Mode + 3 Features - DONE
Dashboard Builder (12 widgets, 3 layouts), Channel/MSP-of-MSPs Mode, Mobile Tech, Real-time SOC Feed, MRR/ARR Revenue Tracker

### Phase H: Ticket Enrichment + Global Search + Dashboard UX - DONE
Global Module Search (Ctrl+K), Sentiment, Resolution Prediction, Blast Radius, Client Health, Smart Merge, Dashboard Pulsating Borders

### Phase I: Ticket UX Overhaul + AI Triage - DONE (March 20, 2026)
1. Editable Ticket Title, Company + Reporter Display, Client End User Contacts (CRUD)
2. Conversation Tab First, Rich Text Notes & Emails (TipTap), Contact Auto-Populate
3. AI-Powered Ticket Triage (auto-categorize, prioritize, route, tag), Skills Matrix
4. Resizable conversation area

### Phase J: Clients Module Revamp - DONE (March 20, 2026)
**List View:**
- Summary stat cards: Total Clients, Total MRR, Avg Health, Health Status breakdown, ARR
- Card-based client rows with health-colored left borders (emerald=healthy, amber=attention, red=critical)
- Health & Contract filter dropdowns alongside search
- At-a-glance data: health score, subscription status, device/ticket counts, MRR

**Detail View:**
- Professional header with health badge, contract type, industry, email display
- 6 summary stat cards: Health (color-coded), MRR, Open Tickets, Devices (online/total), Contacts, Contracts
- Right sidebar with Client Info section and Health Breakdown with progress bars

**Tickets Tab (Key Feature):**
- Matches main TicketsPage styling: priority-colored left borders, priority/status badges
- Card-based layout with ticket number badges, category, assignee, age info
- UNASSIGNED badges for unassigned tickets

**Devices Tab:**
- Card-based with online/offline status coloring (green/red borders)

**Contracts Tab:**
- Card-based with value display and active/inactive status

**All tabs preserved:** Contacts, Tickets, Devices, Contracts, Remote, Awards, Ready, Timeline, Subs, Splynx, M365

## Testing Status
- iteration_43-47: Phases B-G (100% pass)
- iteration_48: Phase H - Enrichment + Search (100% pass - 14/14 backend)
- iteration_49: Phase I - Ticket UX + AI Triage (100% pass - 13/13 backend, all frontend verified)
- iteration_50: Phase J - Clients Module Revamp (100% pass - 14/14 backend, 16/16 frontend features)

## Stats
- **Backend Routers**: 174 auto-discovered
- **Frontend Pages**: 170+
- **Devices**: 131 across 15 clients
- **Collections**: 95+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Mocked Integrations
Xero, Pax8, Domotz, All AI features (keyword-based), Skills matrix (hardcoded)

## Backlog
### P1 - Upcoming:
- AI-powered intelligent ticket routing
- Client Self-Service Portal (branded status page, ticket logging)
- Revenue-per-Ticket Tracking (profitability analysis)
- Voice-to-Ticket (dictate updates, AI transcribes)

### P2 - Future:
- Deeper CRM integrations (Xero, Pax8, Domotz)
- Cross-platform scripting library
- Automated Warranty Claims
- Competitive Win/Loss Tracker
- AR Remote Support
- Mobile Tech PWA

### P3 - Low Priority:
- recharts console warnings fix
- Decompose monolithic seed.py + navigation.js
- Bluetooth barcode scanner
