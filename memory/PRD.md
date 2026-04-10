# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, date-fns, DOMPurify
- Backend: FastAPI (Python), Motor (async MongoDB), httpx
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, emergentintegrations, pyotp, httpx

## Completed Features

### Phase 1-23 (DONE — see CHANGELOG.md)
Full MSP platform: Ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification, SOC & Security, Onboarding, Dashboard, Technicians, Patch Agent, RustDesk live integration, Nav Consolidation, Module Visibility, Microsoft SSO, Global Settings Hub, Email-to-Lead/Ticket, Notifications Revamp, Kanban Board, Workshop Bench, Dispatch Map

### Phase 24: Code Quality & Security Hardening (DONE - 2026-04-10)
- **XSS Protection** — DOMPurify sanitization on all 6 dangerouslySetInnerHTML usages (TicketsPage, EmailPage, TechniciansPage)
- **SSL Verification** — Replaced all `verify=False` with env-configurable `ALLOW_SELF_SIGNED_CERTS` (server.py, yeastar, splynx, hudu, networking, rustdesk)
- **document.write XSS** — Sanitized ProductsPage barcode printing with input escaping + null checks
- **Test Credentials** — Migrated all hardcoded test passwords to `os.environ.get()` across 15+ test files
- **Hook Dependencies** — Fixed missing useEffect deps in ZeroTrustPage
- **Environment Config** — Added `ALLOW_SELF_SIGNED_CERTS` env var for RustDesk/integration self-signed cert support

## Prioritized Backlog

### P2 — Feature Expansion
- Workflow Automation Builder (IF/THEN visual rules engine)
- Knowledge Base / Wiki
- Scheduled PDF Reports
- CRM integrations (Xero, Pax8, Domotz)

### P3 — Tech Debt (from code review, lower priority)
- Refactor TicketsPage.jsx (3893 lines) into sub-components
- Replace wildcard imports with explicit imports
- Use `secrets` module instead of `random` for token generation (374 instances)
- Fix array index as key in React maps (143 instances)
- Break down high-complexity functions (336 instances)
- Fix remaining missing hook dependencies (206 instances)
- Consider httpOnly cookies for token storage

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123

## Key API Endpoints
- `/api/auth/login`, `/api/auth/microsoft/*`
- `/api/settings/*`, `/api/notifications/*`, `/api/kanban-tickets/*`
- `/api/rustdesk/live/*`, `/api/workshop/bench`, `/api/dispatch/*`
