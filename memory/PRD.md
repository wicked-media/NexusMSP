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
1. **Editable Ticket Title** - Click-to-edit inline, Enter saves, Escape cancels
2. **Company + Reporter Display** - Colored initial badge + company name under title, reporter name/email
3. **Client End User Contacts** - Full CRUD per client (name, email, phone, role). Seeded for Acme, TechStart, Global Finance
4. **Conversation Tab First** - Reordered: Conversation (default) > Suggestions > Worksheets > Files > Items > Children > Time > Audit
5. **Rich Text Notes & Emails** - TipTap editor with full toolbar: Bold, Italic, Underline, Headings, Lists, Blockquote, Code, Divider, Alignment, Links, Image paste/upload/drag-drop, Undo/Redo
6. **No Internal Note Checkbox** - Removed redundant checkbox; notes always internal when type is "note"
7. **Contact Auto-Populate** - Email To field auto-suggests from client contacts via HTML datalist
8. **AI-Powered Ticket Triage** - Auto-categorize (7 categories), auto-prioritize (keyword + urgency analysis with infrastructure amplification), auto-route to best tech (skills × 10 - workload × 3), auto-tag. Apply button fills form fields.
9. **Skills Matrix** - Hardcoded skills per tech per category (network, security, hardware, email, software, backup, support)

## Testing Status
- iteration_43-47: Phases B-G (100% pass)
- iteration_48: Phase H - Enrichment + Search (100% pass - 14/14 backend)
- iteration_49: Phase I - Ticket UX + AI Triage (100% pass - 13/13 backend, all frontend verified)

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
### Remaining User-Approved:
- Client Self-Service Portal (branded status page, ticket logging)
- Revenue-per-Ticket Tracking (profitability analysis)
- Automated Warranty Claims (detect & auto-generate vendor RMAs)
- Voice-to-Ticket (dictate updates, AI transcribes)
- Competitive Win/Loss Tracker
- AR Remote Support
- Mobile Tech PWA (service worker)

### Other:
- **P1**: Phase 9 Enhancements (Device Activity Monitoring, Acronis Reporting)
- **P1**: Full UniFi Integration (Phase 2)
- **P2**: Full backend logic for mocked integrations (Xero, Pax8, Domotz)
- **P2**: Decompose monolithic `seed.py` + `navigation.js`
- **P3**: Bluetooth barcode scanner, recharts console warnings
