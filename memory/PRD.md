# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers. All features implemented in large, parallel batches for maximum efficiency.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async), 174 auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 170+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)
- **Key Pattern**: Backend routers auto-discovered from `/app/backend/app/routers/`. Frontend routes in `routes.js`, sidebar nav in `navigation.js`.

## Completed Phases

### Phases 8-12 (Previous Sessions) - DONE
85+ features: Tickets, Devices, Clients, Assets, Security, Financial, Networking, Integrations, Gamification

### P0 Refactoring - DONE
Auto-discovery for routers, config-driven routes + sidebar nav

### Phase B+C: DNS Monitor + 9 Features - DONE
### Phase D: Dark/Light Mode + 20 Security Features - DONE
### Phase E: Deep Patching + 12 MSP Forum Features - DONE
### Phase F: AI Self-Healing + 10 Advanced Features - DONE
### Phase G: Dashboard Builder + Channel Mode + 3 Features - DONE
### Phase H: Ticket Enrichment + Global Search + Dashboard UX - DONE
### Phase I: Ticket UX Overhaul + AI Triage - DONE (March 20, 2026)
### Phase J: Clients Module Revamp - DONE (March 20, 2026)

### SLA Ticket Enhancement - DONE (March 20, 2026)
- Added customer name (`contact_name`) and client address to SLA ticket cards
- Matches the pattern used by Workshop and WISP job cards
- Updated Ticket Pydantic model to include `contact_name` and `contact_email` fields
- Updated seed data with addresses for all 15 clients
- Populated contact_name on existing tickets from client primary contacts

## Testing Status
- iteration_43-50: All passed (100%)

## Backlog
### P1 - Upcoming:
- AI-powered intelligent ticket routing
- Client Self-Service Portal
- Revenue-per-Ticket Tracking
- Voice-to-Ticket

### P2 - Future:
- Deeper CRM integrations (Xero, Pax8, Domotz)
- Cross-platform scripting library
- Mobile Tech PWA

### P3 - Low Priority:
- recharts console warnings fix
- Decompose monolithic seed.py + navigation.js
