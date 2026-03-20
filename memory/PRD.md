# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features are implemented in large, parallel batches to maximize efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async driver), 166 auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 160+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered via `pkgutil`/`importlib` from `/app/backend/app/routers/`. Frontend routes in `/app/frontend/src/config/routes.js`. Sidebar nav in `/app/frontend/src/config/navigation.js`.
- **Theming**: CSS variables in `index.css` (:root for dark, .light for light mode). ThemeProvider in App.js toggles `.light` class.

## Completed Phases

### Phase 8-12 (Previous Sessions) - DONE
85+ features including Tickets, Devices, Clients, Assets, Security, Financial, Networking, Integrations, Gamification

### P0 Refactoring - DONE (March 20, 2026)
- `server.py`: Auto-discovers 166 routers
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
3. Deployment Rings: 5 rings (Test Lab > Early Adopters > Broad > Critical > Legacy) with auto-promote and manual approval
4. Exclusions: KB/app exclusion management with scope, expiry, reasons
5. Reboot Scheduler: Per-client schedules with deferral limits and force reboot
6. Rollback: History + available rollbacks with one-click rollback
7. Testing Lab: Test results (pass/fail/warning) + pre/post deployment scripts
8. History: Full patch audit trail with KB IDs, devices, status, rings

**New Features:**
9. NLP Query Engine, 10. AI Auto-Resolution, 11. Client Budget Tracker, 12. Dark Web Monitor,
13. Phishing Simulation, 14. Backup Verification, 15. Compliance Frameworks, 16. NPS Tracker,
17. Executive Reports, 18. Geo Map, 19. Hardware Refresh Planner, 20. Onboarding Workflows

### Phase F: AI Self-Healing + 10 Advanced Features - DONE (March 20, 2026)
1. **AI Self-Healing Engine** (/self-healing) - Autonomous issue detection, runbook matching & execution, zero human intervention. Live feed, 24h timeline, runbook stats, simulate issue.
2. **Predictive Failure Detection** (/predictive-failure) - SMART data ML-based failure predictions with risk levels (critical/high/medium), 87.3% accuracy
3. **Usage-Based Billing Engine** (/usage-billing) - Auto-calc MRR from device/user counts, overage tracking, per-client plans
4. **Dynamic Pricing Calculator** (/pricing-calc) - Auto-margin calculation from tech cost, labor rates, target margins, overhead multipliers
5. **Client Communication Timeline** (/comms-timeline) - Unified feed of all client interactions (email, ticket, call, meeting)
6. **AI QBR Generator** (/qbr-generator) - Auto-generate quarterly business reviews with sections (exec summary, security, uptime, tickets)
7. **Zero Trust Policy Manager** (/zero-trust) - Conditional access rules, policy enforcement, trust scoring, event logging
8. **Webhook/API Builder** (/webhook-builder) - Visual webhook configuration with triggers, targets, and status tracking
9. **Git-Integrated Script Library** (/git-scripts) - Version-controlled scripts with commit history, language detection, sync status
10. **Late Payment Predictor** (/late-payment) - AI flags likely late payers with risk analysis and outstanding amount tracking
11. **Ransomware Tabletop Simulation** (/ransomware-tabletop) - Interactive drill scenarios with phases, start/stop exercises

## Testing Status
- iteration_43.json: P0 Refactoring + Phase B+C (100% pass)
- iteration_44.json: Phase D - 21 features (100% pass)
- iteration_45.json: Phase E - 13 features + Patch Hub (100% pass - 23/23 backend, 13/13 frontend)
- iteration_46 (pytest): Phase F - 11 features (100% pass - 16/16 backend, 11/11 frontend smoke test)

## Stats
- **Backend Routers**: 166 auto-discovered
- **Frontend Pages**: 160+
- **Devices**: 131 across 15 clients
- **Collections**: 85+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Mocked Integrations
Xero, Pax8, Domotz, All Security/AI feature APIs (seeded mock data)

## Backlog (User-Approved)
### Remaining Features:
- Custom Dashboard Builder (drag-and-drop widgets)
- MSP-of-MSPs Channel Mode (white-label tenants)
- Mobile Tech Dashboard (PWA)
- AR Remote Support
- WebSocket push for SOC Feed

### Other Backlog:
- **P1**: Phase 9 Enhancements (Device Activity Monitoring, Acronis Reporting)
- **P1**: Full UniFi Integration (Phase 2)
- **P2**: Full backend logic for mocked integrations (Xero, Pax8, Domotz)
- **P2**: Decompose monolithic `seed.py`
- **P2**: Decompose `navigation.js` into section-specific files
- **P3**: Bluetooth barcode scanner integration
- **P3**: Fix recharts console warnings
