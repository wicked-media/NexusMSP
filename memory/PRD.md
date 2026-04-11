# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, date-fns, DOMPurify
- Backend: FastAPI (Python), Motor (async MongoDB), httpx
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, emergentintegrations, pyotp, httpx

## Completed Features

### Phase 1-27 (DONE)
Full MSP platform: Ticketing, CRM, invoicing, RMM, networking, scheduling, reporting, white-label, AI copilot, client portal, voice-to-ticket, gamification, SOC & Security, Onboarding, Dashboard, Technicians, Patch Agent, RustDesk live, Nav Consolidation, Module Visibility, Microsoft SSO, Global Settings Hub, Email-to-Lead/Ticket, Notifications Revamp, Kanban Board, Workshop Bench, Dispatch Map, Code Quality & Security Hardening, Module Consolidation (5 Centers)

### Phase 28-29: Finance Center + Recurring Billing (DONE - 2026-04-11)
- 8-tab Finance Center (Overview, Invoices, Estimates, Recurring, Contacts, Accounts, Sync Log, Aging)
- Enterprise-grade Recurring Billing (MRR/ARR, forecast, contract dates, escalation, batch generate)
- Invoice Email feature (mocked, ready for Resend)
- Ticket Enhancements (bulk actions, SLA countdowns, quick templates)

### Phase 30: Morning Checks + Live Terminal + Remote Hub + Templates (DONE - 2026-04-11)

**Morning Checks Dashboard** (`/morning-checks`):
- Health Score gauge (0-100, color coded)
- KPI cards: Devices Offline, Critical Tickets, SLA Breaches, Backups Failed, Security Alerts
- Client Health RAG Board (Red/Amber/Green per client with device/ticket/backup status)
- Offline devices list, critical tickets list, overnight tickets
- Quick stats: unassigned tickets, critical patches, invoices due
- Phone system (Yeastar) status
- Overdue invoices summary
- Scheduled tasks for today
- Refresh on demand

**Live Terminal** (Scripting page):
- New "Live Terminal" tab with split-pane view
- Left: Script selector, target device dropdown, Execute button, code preview
- Right: Dark terminal output console with macOS-style dots header
- Real-time output with timestamps, color coding (blue=info, green=success, red=error, yellow=warning)
- Animated line-by-line output display
- Recent runs history with status, duration
- Clear button to reset output

**Remote Access Multi-Provider Hub**:
- Backend supports 4 providers: RustDesk, MeshCentral, Splashtop, Apache Guacamole
- Per-provider settings, connection testing, activation toggle
- Provider info: license type, features, documentation links
- Ready for credential configuration

**Module Templates** (34 total):
- 12 Ticket Templates (Password Reset, New User, Network Down, Email, Printer, VPN, Slow PC, Backup Fail, Security Incident, Server Down, Software Install, Offboarding)
- 4 Onboarding Templates (IT Audit, M365 Migration, Security Baseline, RMM Deployment)
- 4 SLA Templates (Platinum/Gold/Silver/Bronze with response/resolution times)
- 6 Runbook Templates (Server Down, Ransomware, New Employee, Client Offboarding, Firewall Change, Backup Investigation)
- 8 Script Templates (Disk Cleanup, AD Audit, Windows Update, Service Health, Backup Verify, Network Diag, SSL Check, Linux Health)

## Prioritized Backlog

### P1 - High Value
- Hudu integration fixes (live data not working)
- Surface templates in frontend UI (currently backend only — need template pickers in Tickets, Onboarding, SLA, Runbooks)
- Remote Access Provider UI page (frontend for configuring MeshCentral/Splashtop/Guacamole)

### P2 - Feature Expansion
- Workflow Automation Builder (IF/THEN visual rules engine)
- Knowledge Base / Wiki enhancements
- Scheduled PDF Reports
- CRM integrations (Pax8, Domotz)

### P3 - Tech Debt
- Refactor TicketsPage.jsx (~4000 lines) into sub-components
- Fix Recharts console width/height warnings
- Add missing aria-describedby for DialogContent accessibility
- Decompose monolithic seed.py and navigation.js

## Authentication
- MSP Admin: aaron@stech.com.au / Lucky@2871$!
- Client Portal: john@acmecorp.com / portal123

## Key API Endpoints
- `/api/morning-checks` (NOC daily briefing)
- `/api/xero/*` (Finance Center)
- `/api/tickets/*`, `/api/tickets/bulk-action`
- `/api/scripts/{id}/live-run`, `/api/script-executions/{id}`
- `/api/remote-providers`, `/api/remote-providers/{id}/settings`
- `/api/templates/{module}` (tickets, onboarding, sla, runbooks, scripts)

## Mocked Integrations
- Xero accounting (local MongoDB)
- Email sending (logged, not sent via Resend)
- Remote providers (static config, no live connections)
- Script execution (simulated output)
- Morning checks (aggregates from DB)
