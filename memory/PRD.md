# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features are implemented in large, parallel batches to maximize efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async driver)
- **Frontend**: React + Shadcn/UI + Recharts + TipTap
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered via `pkgutil`/`importlib` from `/app/backend/app/routers/`. Frontend routes defined in `/app/frontend/src/config/routes.js` using React.lazy. Sidebar navigation config-driven from `/app/frontend/src/config/navigation.js`.

## Completed Phases

### Phase 8 (8 Differentiator Features) - DONE
### Phase 10 (15 Swiss Army Knife Features) - DONE
### Phase 11 (15 MSP Features) - DONE
- AI Knowledge Base, Compliance Reporting, Dispatch Board, Client Timeline, RPE Dashboard, Contract Profitability, Vendor Scorecard, IT Roadmap, Warranty Tracker, Client Compare, Skills Matrix, Approval Workflows, Asset Depreciation, Postmortems, CSAT Surveys

### Phase 12 (15 New Features) - DONE
- SLA Penalties, Revenue Forecast, Client Risk, Bulk Actions, Escalation Matrix, Change Management, Incident Heatmap, Tech Utilization, Cost Per Ticket, Profitability Heatmap, Backup Compliance, Procurement Planner, Client Reports, Live Chat

### P0 Refactoring - DONE (March 20, 2026)
- `server.py`: Auto-discovers 122 routers from `/app/backend/app/routers/` using pkgutil/importlib (was 60+ manual imports)
- `App.js`: Refactored from 1165 lines to ~186 lines using React.lazy + routeConfig from `/app/frontend/src/config/routes.js`
- `Sidebar.jsx`: Now imports navGroups from `/app/frontend/src/config/navigation.js`

### Mock Data Enhancement - DONE (March 20, 2026)
- 131 total devices across 15 clients (was 20)
- Devices include: workstations, servers, firewalls, switches, laptops, printers
- All devices have patch_status, pending_patches, OS, warranty, manufacturer data
- 9 network sites seeded for bandwidth monitoring

### Phase B+C: DNS Monitor + 9 MSP Features - DONE (March 20, 2026)
1. **DNS Record Change Monitor** - Track DNS records (A/MX/TXT/CNAME/NS) for 7+ client domains, alerts on changes
2. **Patch Compliance Dashboard** - 67.9% compliance tracking, 4 deployment rings, auto-approve policies
3. **Client Portal Admin** - Branded client portal config with feature toggles, access logs, invitations
4. **Backup Dashboard** - Unified backup status across Acronis/Veeam/Datto, per-client success rates
5. **MFA Management** - Track MFA enrollment across client tenants (Azure AD/Google/Okta/Duo), enforce policies
6. **Alert Suppression** - Intelligent alert noise reduction with 6 rule types, estimated time saved
7. **License Management** - Software license tracking, utilization rates, wasted spend identification
8. **Maintenance Scheduler** - Recurring maintenance windows with pre/post scripts per client
9. **Bandwidth Monitor** - Real-time per-site bandwidth with area charts, alerts, ISP tracking

## Testing Status
- iteration_41.json: Phase 11 (100% pass)
- iteration_42.json: Phase 12 (100% pass)
- iteration_43.json: P0 Refactoring + Phase B+C (100% pass - 20/20 backend, 9/9 frontend)

## Stats
- **Backend Routers**: 122 auto-discovered
- **Frontend Pages**: 94+
- **Devices**: 131 across 15 clients
- **Collections**: 50+

## Active Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Mocked Integrations
Xero, Pax8, Domotz

## Backlog
- **P1**: Phase 9 Enhancements (Device Activity Monitoring, Acronis Branded Reporting, Dark/Light Mode)
- **P1**: Full UniFi Integration, Full Xero Integration
- **P2**: Full Pax8/Domotz backend logic, Standalone DB seeding mechanism, Client portal for estimate approval, Ticket page visual overhaul
- **P3**: Bluetooth barcode scanner, recharts console warnings fix
