# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features are implemented in large, parallel batches to maximize efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async driver), 153 auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 150+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered via `pkgutil`/`importlib` from `/app/backend/app/routers/`. Frontend routes in `/app/frontend/src/config/routes.js`. Sidebar nav in `/app/frontend/src/config/navigation.js`.
- **Theming**: CSS variables in `index.css` (:root for dark, .light for light mode). ThemeProvider in App.js toggles `.light` class.

## Completed Phases

### Phase 8-12 (Previous Sessions) - DONE
85+ features including Tickets, Devices, Clients, Assets, Security, Financial, Networking, Integrations, Gamification

### P0 Refactoring - DONE (March 20, 2026)
- `server.py`: Auto-discovers 153 routers
- `App.js`: Config-driven routes via `routes.js`
- `Sidebar.jsx`: Config-driven nav via `navigation.js`

### Phase B+C: DNS Monitor + 9 Features - DONE
### Phase D: Dark/Light Mode + 20 Security Features - DONE

### Bug Fix: Light Mode Sidebar - FIXED (March 20, 2026)
- Radix `TooltipTrigger asChild` stringified NavLink className function. Fixed with Link + useLocation.

### Phase E: Deep Patching + 12 MSP Forum Features - DONE (March 20, 2026)
**Patch Hub (8-tab deep patching system):**
1. Dashboard: OS compliance 67.9%, App compliance 59.7%, 250 pending patches, 12 critical devices, 7-day activity chart, ring status, compliance by client
2. Intelligence: 15 patches with CVSS scores, AI-paused patches, stability analysis
3. Deployment Rings: 5 rings (Test Lab → Early Adopters → Broad → Critical → Legacy) with auto-promote and manual approval
4. Exclusions: KB/app exclusion management with scope, expiry, reasons
5. Reboot Scheduler: Per-client schedules with deferral limits and force reboot
6. Rollback: History + available rollbacks with one-click rollback
7. Testing Lab: Test results (pass/fail/warning) + pre/post deployment scripts
8. History: Full patch audit trail with KB IDs, devices, status, rings

**New Features:**
9. NLP Query Engine: Plain English search ("Show me offline devices")
10. AI Auto-Resolution: 8 issue types, auto-resolve, pending approval, manual
11. Client Budget Tracker: 8 clients with annual budgets, categories, forecasts
12. Dark Web Credential Monitor: 8 exposures with severity, resolve actions
13. Phishing Simulation: 5 campaigns with click/report rates
14. Backup Verification Testing: 20 tests with restore times, pass/fail
15. Compliance Frameworks: NIST 800-171, CIS v8, SOC 2, HIPAA with control tracking
16. NPS Tracker: Net Promoter Score with 6-month trend
17. Executive Reports: Automated monthly client reports
18. Geo Map: 10 client sites + 5 technician locations
19. Hardware Refresh Planner: 50 devices with EOL tracking
20. Onboarding Workflows: 3 workflows with 14-step checklists

## Testing Status
- iteration_43.json: P0 Refactoring + Phase B+C (100% pass)
- iteration_44.json: Phase D - 21 features (100% pass)
- iteration_45.json: Phase E - 13 features + Patch Hub (100% pass - 23/23 backend, 13/13 frontend)

## Stats
- **Backend Routers**: 153 auto-discovered
- **Frontend Pages**: 150+
- **Devices**: 131 across 15 clients
- **Collections**: 75+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Mocked Integrations
Xero, Pax8, Domotz, All Security/AI feature APIs (seeded mock data)

## Backlog (User-Approved Ideas)
### Remaining from 27-Feature List:
- **Predictive Failure Detection** (SMART data ML)
- **AI QBR Generator** (auto-generate quarterly reviews)
- **Usage-Based Billing Engine** (auto-calc from device/user counts)
- **Dynamic Pricing Calculator** (auto-margin from tech cost)
- **Late Payment Predictor** (AI flags likely late payers)
- **Zero Trust Policy Manager** (conditional access rules)
- **Ransomware Tabletop Simulation**
- **Client Communication Timeline** (unified feed)
- **Custom Dashboard Builder** (drag-and-drop widgets)
- **Webhook/API Builder** (visual integrations)
- **Git-Integrated Script Library** (version control + diff)
- **MSP-of-MSPs Channel Mode** (white-label tenants)
- **Mobile Tech Dashboard (PWA)**
- **AR Remote Support**

### Other Backlog:
- **P1**: Phase 9 Enhancements (Device Activity Monitoring, Acronis Reporting)
- **P1**: Full UniFi Integration (Phase 2)
- **P2**: AI-driven self-healing / predictive alerts
- **P2**: Full backend logic for mocked integrations (Xero, Pax8, Domotz)
- **P2**: Decompose monolithic `seed.py`
- **P3**: Bluetooth barcode scanner integration
- **P3**: Fix recharts console warnings
