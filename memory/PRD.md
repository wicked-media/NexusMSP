# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features are implemented in large, parallel batches to maximize efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async driver)
- **Frontend**: React + Shadcn/UI + Recharts + TipTap
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered via `pkgutil`/`importlib` from `/app/backend/app/routers/`. Frontend routes defined in `/app/frontend/src/config/routes.js` using React.lazy. Sidebar navigation config-driven from `/app/frontend/src/config/navigation.js`.
- **Theming**: CSS variables in `index.css` (:root for dark, .light for light mode). ThemeProvider in App.js toggles `.light` class on `<html>`.

## Completed Phases

### Phase 8 (8 Differentiator Features) - DONE
### Phase 10 (15 Swiss Army Knife Features) - DONE
### Phase 11 (15 MSP Features) - DONE
### Phase 12 (15 New Features) - DONE

### P0 Refactoring - DONE (March 20, 2026)
- `server.py`: Auto-discovers 140 routers from `/app/backend/app/routers/`
- `App.js`: Config-driven routes via `routes.js`
- `Sidebar.jsx`: Config-driven nav via `navigation.js`

### Mock Data Enhancement - DONE (March 20, 2026)
- 131 total devices across 15 clients

### Phase B+C: DNS Monitor + 9 MSP Features - DONE (March 20, 2026)
1. DNS Record Change Monitor
2. Patch Compliance Dashboard
3. Client Portal Admin
4. Backup Dashboard
5. MFA Management
6. Alert Suppression
7. License Management
8. Maintenance Scheduler
9. Bandwidth Monitor

### Phase D: Dark/Light Mode + 20 Security/MSP Features - DONE (March 20, 2026)
1. **Dark/Light Mode Toggle** - CSS variable theming, sidebar toggle, persisted in localStorage
2. **Security Dashboard (SOC)** - Unified security score (77.7), endpoint count, patch compliance, active threats, trend chart
3. **Endpoint Security Scores** - Per-device security scores, grade breakdown (A-F), AV/Encrypt/Firewall/MFA
4. **Ransomware Canary** - 20 deployed canary files, trigger detection, deployment management
5. **Kanban Tickets** - 5-column board (Open/In Progress/Waiting/Resolved/Closed), drag-and-drop
6. **Recurring Invoices** - 5 templates, $30.1k MRR tracking, auto-generation
7. **Identity Threats** - OAuth/BEC/Travel/Session/Brute force detection, resolve actions
8. **SOC Feed** - Real-time security events, analyst activity, MTTR tracking
9. **Vulnerability Scanner** - 40 vulns, CVE tracking, by-client breakdown, severity ratings
10. **Remediation Playbooks** - 4 playbooks with step-by-step actions, execution history
11. **Third Party Patching** - 129 apps tracked, compliance %, update policies
12. **Audit Trail** - Login/device/ticket/password events with user attribution
13. **Password Rotation** - 3 policies (30/60/90 day cycles), rotation history
14. **Threat Timeline** - MITRE ATT&CK tactics/techniques, process chains, resolution

### Bug Fix: Light Mode Sidebar Visibility - FIXED (March 20, 2026)
- **Root Cause**: Radix `TooltipTrigger asChild` stringified NavLink's className function instead of evaluating it, causing both active and inactive CSS classes to be applied simultaneously. In light mode, `text-primary-foreground` (white) won over `text-muted-foreground` (gray).
- **Fix**: Replaced NavLink with Link + useLocation for manual active state detection in a separate NavItem component.

## Testing Status
- iteration_41.json: Phase 11 (100% pass)
- iteration_42.json: Phase 12 (100% pass)
- iteration_43.json: P0 Refactoring + Phase B+C (100% pass)
- iteration_44.json: Phase D - 21 features (100% pass - 18/18 backend, 15/15 frontend)

## Stats
- **Backend Routers**: 140 auto-discovered
- **Frontend Pages**: 140+
- **Devices**: 131 across 15 clients
- **Collections**: 60+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Mocked Integrations
Xero, Pax8, Domotz, All Security feature APIs (seeded mock data)

## Backlog
- **P1**: Phase 9 Enhancements (Device Activity Monitoring, Acronis Branded Reporting)
- **P1**: Full UniFi Integration (Phase 2)
- **P2**: AI-driven self-healing / predictive alerts
- **P2**: Deeper CRM integrations, cross-platform scripting library
- **P2**: Full backend logic for mocked integrations (Xero, Pax8, Domotz)
- **P2**: Decompose monolithic `seed.py` into smaller functions
- **P3**: Bluetooth barcode scanner integration
- **P3**: Fix recharts console warnings on Reports page
