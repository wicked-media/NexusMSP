# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Core Modules
- **Ticketing**: SLA tickets, workshop jobs, cabling/WISP jobs with full conversation, status tracking, and lifecycle automation
- **RMM/Monitoring**: Device monitoring, agent management, remote access (RustDesk)
- **Invoicing & Billing**: Invoice management, purchase orders, revenue tracking, aging reports, credit notes, revenue analytics, billing command center
- **Asset Management**: Asset lifecycle, inventory, procurement
- **CRM**: Client management, contacts, addresses, loyalty tracking
- **Networking**: Network maps, zero-trust management, SNMP monitoring
- **Scheduling & Dispatch**: Smart scheduling, dispatch board, on-call management
- **Reporting**: Dashboards, analytics, SLA compliance, revenue reports
- **White Label**: Full branding customization, custom domains
- **Client Portal**: Self-service portal for clients
- **AI Features**: AI copilot, intelligent routing, voice-to-ticket

## Tech Stack
- **Frontend**: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, DnD-kit
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Integrations**: Resend, Stripe, RustDesk, qrcode, fpdf2, emergentintegrations

## What's Been Implemented

### Completed Features (All Tested)
1. Full ticketing system (SLA, workshop, cabling/WISP)
2. Client management with revamped UI
3. Invoice & billing system
4. Asset lifecycle management
5. RMM monitoring dashboard
6. Network management & zero-trust
7. Scheduling & dispatch
8. Reporting & analytics
9. White label / branding
10. AI copilot & intelligent routing
11. Client self-service portal
12. Voice-to-ticket
13. Revenue-per-ticket tracking
14. Technician settings page (2FA, FIDO2, signatures, badges)
15. Ticket lifecycle automation (auto-close resolved after 24h)
16. Gamification & leaderboard system
17. SLA timer & penalties
18. Change management / Escalation matrix / Incident heatmap
19. Skills matrix / Tech utilization tracking
20. **Workshop Enrichment** - COMPLETED 2026-03-20
21. **Cabling/WISP Enrichment** - COMPLETED 2026-03-21
22. **PO, Invoices & Billing Overhaul** - COMPLETED 2026-03-21
    - Purchase Orders: Approval workflows, notes, PDF, email vendor, duplicate, spend analytics
    - Invoices: Tabbed detail, email, clone, credit notes, aging report, revenue analytics
23. **Billing Command Center** - COMPLETED 2026-03-21
    - Live MRR/ARR gauges with collection progress
    - Payment Health Score (SVG radial gauge, 0-100 weighted scoring)
    - Cash Collection Streak (gamified flame levels: starter/warming/hot/fire/legendary)
    - 30-Day Cash Flow Forecast (incoming/outgoing/net)
    - Overdue Alerts with one-click Chase buttons
    - Monthly Revenue Trend (6-month invoiced vs collected)
    - Top Debtors ranking with balance visualization
    - Recent Payments feed
    - Invoice Pipeline (Draft→Sent→Overdue→Paid)

## Prioritized Backlog

### P1
- **Technician Performance Leaderboard** - Gamified leaderboard with weekly challenges

### P2
- Dedicated "Workshop Bench View" with visual Kanban board
- Dedicated "Dispatch Map View" for field jobs using GPS coords
- Deeper CRM integrations (Xero, Pax8, Domotz)
- Cross-platform scripting library
- Advanced client off-boarding / tenant lifecycle

### P3
- Decompose monolithic seed.py and navigation.js
- Bluetooth barcode scanner integration
- Fix recharts console warnings on Reports page
- Refactor TicketsPage.jsx (3300+ lines) into sub-components

## Known Issues
- recharts console warnings on ReportsPage (cosmetic, P3)
- Missing aria-describedby for some DialogContent (accessibility, P3)

## Authentication
- JWT-based custom auth
- Demo: admin@nexusops.io / admin123
