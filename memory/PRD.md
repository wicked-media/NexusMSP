# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Core Modules
- **Ticketing**: SLA tickets, workshop jobs, cabling/WISP jobs with full conversation, status tracking, and lifecycle automation
- **RMM/Monitoring**: Device monitoring, agent management, remote access (RustDesk)
- **Invoicing & Billing**: Invoice management, purchase orders, revenue tracking, aging reports, credit notes, revenue analytics
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
20. **Workshop Enrichment (All Phases)** - COMPLETED 2026-03-20
    - Repair notes, before/during/after photos, diagnostic checklists (5 templates)
    - Full audit trail, visual progress tracker (6 stages)
    - Customer notifications with templates, quote builder, push-to-invoice
    - Enhanced device intake (condition, accessories, password, warranty)
    - PDF job card, QR code labels, repair history, workshop queue
21. **Cabling/WISP Enrichment (All Phases)** - COMPLETED 2026-03-21
    - Field notes, site photos (5 types: survey/before/during/after/completion)
    - Enhanced checklists (5 templates)
    - Full audit trail, visual progress tracker (5 stages)
    - Customer notifications, quote builder, push-to-invoice
    - Equipment tracking, materials tracking, site survey & access info
    - PDF completion report, QR code labels, job history, dispatch queue
22. **PO, Invoices & Billing Overhaul** - COMPLETED 2026-03-21
    - **Purchase Orders**: Multi-stage approval workflow (Draft→Pending Approval→Approved→Submitted→Partial→Received), PO notes/comments, PDF generation, email-to-vendor, duplicate PO, spend analytics (top vendors, monthly trend, status breakdown), barcode scanner receiving, escalation checks
    - **Invoices**: Tabbed detail view (Line Items, Payments, Emails, Audit), payment progress bar, email invoice with history tracking, clone invoices, credit notes, aging report (Current/30/60/90/120+ day buckets), revenue analytics (MRR/ARR, monthly trends, top clients, collection rate), void/move-client, recurring billing
    - Bug fix: Made `due_date` Optional in Invoice model to prevent ResponseValidationError for workshop/field-generated invoices

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
