# NexusOps - Product Requirements Document

## Overview
NexusOps is a unified RMM/PSA platform for managed service providers. Monitor, manage, and support from a single pane of glass.

## Core Modules
- **Ticketing**: SLA tickets, workshop jobs, cabling/WISP jobs with full lifecycle
- **RMM/Monitoring**: Device monitoring, agent management, remote access (RustDesk)
- **Invoicing & Billing**: Invoice management, purchase orders, billing command center, revenue tracking
- **Asset Management**: Asset lifecycle, inventory, procurement
- **CRM**: Client management, contacts, addresses, loyalty tracking
- **Networking**: Network maps, zero-trust management, SNMP monitoring
- **Security Operations Center**: Huntress-ready SOC, endpoint security, dark web monitoring, vulnerability scanning, phishing simulation, identity threat detection, ransomware canary, threat timeline
- **Smart Automation**: AI thank-you detection, stale ticket reminders, billing reconciliation
- **Scheduling & Dispatch**: Smart scheduling, dispatch board, on-call management
- **Reporting**: Dashboards, analytics, SLA compliance, revenue reports
- **White Label**: Full branding customization, custom domains
- **Client Portal**: Self-service portal for clients
- **AI Features**: AI copilot, intelligent routing, voice-to-ticket

## Tech Stack
- Frontend: React, Shadcn/UI, TailwindCSS, Recharts, TipTap, DnD-kit
- Backend: FastAPI (Python), Motor (async MongoDB)
- Database: MongoDB
- Integrations: Resend, Stripe, RustDesk, qrcode, fpdf2, emergentintegrations

## Completed Features

### Phase 1-3: Core Platform (DONE)
1. Full ticketing system (SLA, workshop, cabling/WISP)
2. Client management, Contracts, Vendors
3. Invoice & billing system with Stripe
4. Asset lifecycle management
5. RMM monitoring dashboard
6. Network management & zero-trust
7. Scheduling & dispatch
8. Reporting & analytics
9. White label / branding
10. AI copilot & intelligent routing
11. Client self-service portal
12. Voice-to-ticket, Gamification, SLA, Change Mgmt

### Phase 4: Deep Enrichments (DONE - 2026-03-21)
13. Workshop Enrichment (photos, checklists, QR codes, PDF job cards)
14. Cabling/WISP Enrichment (site photos, materials, dispatch queue)
15. PO/Invoice/Billing Overhaul (approval workflows, PDF, email, clone, credit notes, aging, revenue analytics)
16. Billing Command Center (MRR/ARR gauges, health score, collection streak, cash flow forecast, chase)

### Phase 5: SOC & Security Enrichment (DONE - 2026-03-21)
17. **Security Dashboard** - Unified SOC hub with threat level banner, endpoint health, active incidents, dark web summary, vulnerability summary, identity threats
18. **SOC Alert Feed** - Live alert stream with technician tools: Acknowledge, Create Ticket from Alert, Isolate Endpoint, Remediate, Close. Severity/status filters, MITRE ATT&CK tags, recommended remediation steps
19. **Endpoint Security** - 30 managed endpoints with AV status, firewall, patch status, risk scores, scan/isolate/unisolate actions
20. **Dark Web Monitor** - Credential leak detection, domain monitoring, breach source tracking, affected user counts
21. **Vulnerability Scanner** - CVE tracking, CVSS scores, exploit-in-wild detection, patch availability, severity filtering
22. **Phishing Simulation** - Campaign management with click rates, open rates, report rates, per-org tracking
23. **Identity Threat Detection** - Impossible travel, brute force, MFA fatigue, token theft detection with location/IP tracking
24. **Ransomware Canary** - Deployed canary files across endpoints, triggered alerts, emergency isolate
25. **Threat Timeline** - Chronological security event view
26. **Huntress Integration (Mock-Ready)** - Settings page for API key, auto-sync, mock data generators ready for real Huntress REST API connection

### Phase 5b: Smart Automation (DONE - 2026-03-21)
27. **AI Thank-You Detection** - Auto-close tickets when clients reply with "thanks/ty/cheers" (configurable keywords)
28. **Stale Ticket Reminders** - Auto-ping clients on tickets inactive for X days (configurable)
29. **Billing Reconciliation** - Compare RMM agent counts vs contract seats per client, flag revenue leakage

### Phase 6: Client Onboarding Wizard (DONE - 2026-03-21)
30. **Client Onboarding Wizard (Enhanced)** - Comprehensive 8-step guided wizard consolidating two previous modules:
    - Template selection (Small Office, Mid-Market, Enterprise, Break/Fix)
    - Steps: Company Profile → Contacts & Access → Asset Discovery → Contracts & Billing → Security & Compliance → Monitoring & Automation → Documentation → Go Live
    - Preflight checklist with critical/non-critical items
    - Health score tracking, pause/resume, audit log
    - Side effects: auto-creates clients, contacts, devices, contracts, tickets
    - First ticket creation on Go Live
    - Backend: `/api/onboarding-enhanced/*` (11 endpoints), Collection: `onboarding_enhanced`
    - Frontend: `/onboarding` and `/onboarding-workflows` both point to unified wizard

## Prioritized Backlog

### P1
- Technician Performance Leaderboard

### P2
- Workshop Bench View (Kanban)
- Dispatch Map View (GPS)
- CRM integrations (Xero, Pax8, Domotz)
- Client Payment Portal (self-service invoices)

### P3
- Decompose monolithic seed.py and navigation.js
- Refactor TicketsPage.jsx into sub-components
- Bluetooth barcode scanner integration
- Fix recharts console warnings
- Connect real Huntress API (when user provides API key)
- SentinelOne / CrowdStrike connectors

## Mocked Features
- All SOC/security data uses mock generators (realistic randomized data) - ready for real Huntress API
- AI routing (mock)
- Voice-to-text (mock)
- Email sending (requires Resend API key)

## Authentication
- JWT-based custom auth
- Demo: admin@nexusops.io / admin123
