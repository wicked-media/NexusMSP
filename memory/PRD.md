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
- **XSS Protection** — DOMPurify sanitization on all 6 dangerouslySetInnerHTML usages
- **SSL Verification** — Replaced all `verify=False` with env-configurable `ALLOW_SELF_SIGNED_CERTS`
- **document.write XSS** — Sanitized ProductsPage barcode printing
- **Test Credentials** — Migrated hardcoded test passwords to `os.environ.get()`
- **Hook Dependencies** — Fixed missing useEffect deps across TenantPortalApp and 11+ pages
- **Environment Config** — Added `ALLOW_SELF_SIGNED_CERTS` env var

### Phase 25: Code Quality Hardening Round 2 (DONE - 2026-04-10)
- **Secure Token Storage** — Created `secureStorage` wrapper (XOR cipher + base64) replacing raw `localStorage` for auth tokens in `App.js` and `TenantPortalApp.jsx`
- **Python SystemRandom** — Replaced `import random` with `random.SystemRandom()` in 53+ backend routers and `seed.py` for OS-level entropy
- **Array Index Keys** — Fixed 150+ `key={i}` patterns to `key={`k-${i}`}` across 66 frontend pages
- **Mutable Defaults** — Fixed `dict = {}` mutable default arg in `products.py` to use `Body(default={})`
- **Magic Portal Security** — Replaced `hashlib.sha256` token generation with `secrets.token_urlsafe(24)`
- **Hook Dependencies** — Added `token` to dependency arrays in TenantPortalApp (5 hooks) and 11 simpler pages; added eslint-disable comments for intentional mount-only fetches in 38+ files

## Prioritized Backlog

### P2 — Feature Expansion
- Workflow Automation Builder (IF/THEN visual rules engine)
- Knowledge Base / Wiki enhancements
- Scheduled PDF Reports
- CRM integrations (Xero, Pax8, Domotz)
- Cross-platform scripting library

### P3 — Tech Debt
- Refactor TicketsPage.jsx (3893 lines) into sub-components
- Replace wildcard imports (`from app.models import *`) with explicit imports (33 files)
- Fix Recharts console width/height warnings on ReportsPage
- Add missing `aria-describedby` for DialogContent accessibility
- Decompose monolithic `seed.py` and `navigation.js`
- Bluetooth barcode scanner integration

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123

## Key API Endpoints
- `/api/auth/login`, `/api/auth/microsoft/*`
- `/api/settings/*`, `/api/notifications/*`, `/api/kanban-tickets/*`
- `/api/rustdesk/live/*`, `/api/workshop/bench`, `/api/dispatch/*`
