# NexusOps - Product Requirements Document

## Original Problem Statement
Build "NexusOps," a feature-rich RMM/PSA platform for Managed Service Providers.

## Architecture
- **Backend**: FastAPI + MongoDB (Motor async), 174 auto-discovered routers
- **Frontend**: React + Shadcn/UI + Recharts + TipTap, 170+ pages
- **Auth**: JWT-based (admin@nexusops.io / admin123)

## Completed Phases
- Phases 8-12, P0 Refactoring, Phases B-J: All DONE
- SLA Ticket Enhancement (contact names + addresses): DONE
- Ticket conversation cleanup (March 20, 2026): DONE
  - Removed email duplication (emails no longer create duplicate notes)
  - Added "On Hold" to statusConfig to match progress bar stages
  - Cleaned 8 existing duplicate email-as-note entries from DB

## Testing: iteration_43-50 all passed (100%)

## Backlog
### P1: AI ticket routing, Client Self-Service Portal, Revenue-per-Ticket Tracking, Voice-to-Ticket
### P2: CRM integrations (Xero, Pax8, Domotz), Cross-platform scripting, Mobile Tech PWA
### P3: recharts warnings, decompose seed.py/navigation.js
