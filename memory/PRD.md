# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Core Modules
- **Ticketing**: SLA tickets, workshop jobs, cabling/WISP jobs with full conversation, status tracking, and lifecycle automation
- **RMM/Monitoring**: Device monitoring, agent management, remote access (RustDesk)
- **Invoicing & Billing**: Invoice management, purchase orders, revenue tracking
- **Asset Management**: Asset lifecycle, inventory, procurement
- **CRM**: Client management, contacts, addresses, loyalty tracking
- **Networking**: Network maps, zero-trust management, SNMP monitoring
- **Scheduling & Dispatch**: Smart scheduling, dispatch board, on-call management
- **Reporting**: Dashboards, analytics, SLA compliance, revenue reports
- **White Label**: Full branding customization, custom domains
- **Client Portal**: Self-service portal for clients
- **AI Features**: AI copilot, intelligent routing, voice-to-ticket

## User Personas
- **MSP Admin**: Full platform control, branding, client management
- **Technician**: Ticket handling, workshop repairs, on-site work
- **Client**: Self-service portal access, ticket submission

## Authentication
- JWT-based custom auth with email/password
- Demo credentials: admin@nexusops.io / admin123

## Tech Stack
- **Frontend**: React + Vite, Shadcn/UI, TailwindCSS, Recharts, TipTap, DnD-kit
- **Backend**: FastAPI (Python), Motor (async MongoDB)
- **Database**: MongoDB
- **Integrations**: Resend (email), Stripe, RustDesk, qrcode, fpdf2, emergentintegrations (Multi-LLM)

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
18. Change management
19. Escalation matrix
20. Incident heatmap
21. Skills matrix
22. Tech utilization tracking
23. **Workshop Enrichment (Phase 1-3)** - COMPLETED 2026-03-20
    - Diagnostic repair notes system
    - Before/during/after photo attachments
    - Diagnostic checklists (5 device templates: laptop, desktop, phone, printer, network)
    - Full audit trail
    - Visual progress tracker (6 stages)
    - Customer email/SMS notifications with templates
    - Quote/estimate builder with send & approval workflow
    - Push-to-invoice (new or existing)
    - Enhanced device intake (condition, accessories, password, warranty)
    - Workshop job PDF generation (branded job card)
    - QR code label generation
    - Repair history lookup by serial/customer
    - Workshop queue/kanban view

## Prioritized Backlog

### P0 (Next Up)
- **Purchase Order PDF Generation** - Generate branded PO PDFs with company logo
- **PO Approval Workflow** - Draft → Pending Approval → Approved → Submitted
- **PO Vendor Emailing** - Auto-email PO PDFs to vendors
- **Goods Received Tracking** - Track received items against PO line items

### P1
- **Technician Performance Leaderboard** - Gamified leaderboard with weekly challenges

### P2
- Deeper CRM integrations (Xero, Pax8, Domotz)
- Cross-platform scripting library
- Advanced client off-boarding and tenant lifecycle management

### P3
- Decompose monolithic seed.py and navigation.js
- Bluetooth barcode scanner integration
- Fix recharts console warnings on Reports page

## Known Issues
- recharts console warnings on ReportsPage (cosmetic, P3)
- Missing aria-describedby for some DialogContent (accessibility, P3)
