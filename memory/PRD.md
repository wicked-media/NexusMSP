# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features are implemented in large, parallel batches to maximize efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async driver), 171 auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 165+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered via `pkgutil`/`importlib` from `/app/backend/app/routers/`. Frontend routes in `/app/frontend/src/config/routes.js`. Sidebar nav in `/app/frontend/src/config/navigation.js`.
- **Theming**: CSS variables in `index.css` (:root for dark, .light for light mode). ThemeProvider in App.js toggles `.light` class.

## Completed Phases

### Phase 8-12 (Previous Sessions) - DONE
85+ features including Tickets, Devices, Clients, Assets, Security, Financial, Networking, Integrations, Gamification

### P0 Refactoring - DONE (March 20, 2026)
- `server.py`: Auto-discovers 171 routers
- `App.js`: Config-driven routes via `routes.js`
- `Sidebar.jsx`: Config-driven nav via `navigation.js`

### Phase B+C: DNS Monitor + 9 Features - DONE
### Phase D: Dark/Light Mode + 20 Security Features - DONE

### Bug Fix: Light Mode Sidebar - FIXED (March 20, 2026)
- Radix `TooltipTrigger asChild` stringified NavLink className function. Fixed with Link + useLocation.

### Phase E: Deep Patching + 12 MSP Forum Features - DONE (March 20, 2026)
**Patch Hub (8-tab deep patching system):**
1. Dashboard, 2. Intelligence, 3. Deployment Rings, 4. Exclusions, 5. Reboot Scheduler, 6. Rollback, 7. Testing Lab, 8. History

**Plus:** NLP Query, AI Auto-Resolution, Client Budget, Dark Web Monitor, Phishing Sim, Backup Verification, Compliance Frameworks, NPS Tracker, Executive Reports, Geo Map, Hardware Refresh, Onboarding Workflows

### Phase F: AI Self-Healing + 10 Advanced Features - DONE (March 20, 2026)
1. **AI Self-Healing Engine** (/self-healing) - Autonomous issue detection, runbook matching & execution
2. **Predictive Failure Detection** (/predictive-failure) - SMART data ML-based failure predictions
3. **Usage-Based Billing Engine** (/usage-billing) - Auto-calc MRR from device/user counts
4. **Dynamic Pricing Calculator** (/pricing-calc) - Auto-margin from tech cost
5. **Client Communication Timeline** (/comms-timeline) - Unified client interaction feed
6. **AI QBR Generator** (/qbr-generator) - Auto-generate quarterly business reviews
7. **Zero Trust Policy Manager** (/zero-trust) - Conditional access rules & trust scoring
8. **Webhook/API Builder** (/webhook-builder) - Visual webhook configuration
9. **Git-Integrated Script Library** (/git-scripts) - Version-controlled scripts
10. **Late Payment Predictor** (/late-payment) - AI risk scoring for payments
11. **Ransomware Tabletop Simulation** (/ransomware-tabletop) - Interactive drill scenarios

### Phase G: Dashboard Builder + Channel Mode + 3 Features - DONE (March 20, 2026)
1. **Custom Dashboard Builder** (/dashboard-builder) - Drag-and-drop widgets with 12 types (stat cards, line/bar/pie charts, ticket/alert feeds, SLA gauge, device map, client table, revenue trend, patch status). 3 pre-built layouts (Operations, Security, Financial). Full CRUD for layouts.
2. **Channel / MSP-of-MSPs Mode** (/channel-mode) - White-label tenant management. 8 seeded tenants across Enterprise/Professional/Standard tiers. Revenue tracking by tier, feature toggle per tenant, create new tenants.
3. **Mobile Tech Dashboard** (/mobile-tech) - Technician's daily view with assigned tickets, schedule, queue, notifications. Quick actions (New Ticket, Time Entry, Scan Asset). Time entry logging.
4. **Real-time SOC Feed** (/soc-realtime) - Live security event stream with auto-refresh (10s polling). Severity filters, simulate events, threat map with attack sources by country. 30+ event types.
5. **MRR/ARR Revenue Tracker** (/revenue-tracker) - Full revenue analytics: Current MRR/ARR, Net Revenue Retention, Logo Retention, revenue by service, client-level breakdown with churn risk, cohort analysis.

## Testing Status
- iteration_43.json: P0 Refactoring + Phase B+C (100% pass)
- iteration_44.json: Phase D - 21 features (100% pass)
- iteration_45.json: Phase E - 13 features + Patch Hub (100% pass - 23/23 backend, 13/13 frontend)
- iteration_46 (pytest): Phase F - 11 features (100% pass - 16/16 backend)
- iteration_47.json: Phase G - 5 features (100% pass - 19/19 backend, 5/5 frontend)

## Stats
- **Backend Routers**: 171 auto-discovered
- **Frontend Pages**: 165+
- **Devices**: 131 across 15 clients
- **Collections**: 90+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Mocked Integrations
Xero, Pax8, Domotz, All Security/AI feature APIs (seeded mock data)

## Backlog (User-Approved)
### Remaining Features:
- AR Remote Support
- Mobile Tech Dashboard (PWA manifest/service worker)

### Other Backlog:
- **P1**: Phase 9 Enhancements (Device Activity Monitoring, Acronis Reporting)
- **P1**: Full UniFi Integration (Phase 2)
- **P2**: Full backend logic for mocked integrations (Xero, Pax8, Domotz)
- **P2**: Decompose monolithic `seed.py`
- **P2**: Decompose `navigation.js` into section-specific files
- **P3**: Bluetooth barcode scanner integration
- **P3**: Fix recharts console warnings
