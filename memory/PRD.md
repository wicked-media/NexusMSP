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
17. Security Dashboard - Unified SOC hub
18. SOC Alert Feed - Live alert stream with technician tools
19. Endpoint Security - 30 managed endpoints with AV/firewall/patch
20. Dark Web Monitor - Credential leak detection
21. Vulnerability Scanner - CVE tracking, CVSS scores
22. Phishing Simulation - Campaign management
23. Identity Threat Detection - Impossible travel, brute force, MFA fatigue
24. Ransomware Canary - Canary files, emergency isolate
25. Threat Timeline - Chronological security events
26. Huntress Integration (Mock-Ready)

### Phase 5b: Smart Automation (DONE - 2026-03-21)
27. AI Thank-You Detection
28. Stale Ticket Reminders
29. Billing Reconciliation

### Phase 6: Client Onboarding Wizard (DONE - 2026-03-21)
30. Client Onboarding Wizard (Enhanced) - 8-step guided wizard

### Phase 7: Advanced MSP Module Enrichment (DONE - 2026-03-21)
All 16+ advanced MSP modules enriched from placeholders to enterprise-grade UIs:

**Batch 1 (AI & Operations):**
31. AI Auto-Resolution Engine - Autonomous issue detection with runbook matching, approve/reject, confidence scoring
32. QBR Generator - Client QBR cards with security/uptime/SLA metrics, per-client drill-down
33. Comms Timeline - Client communication history, interaction types, activity timeline
34. Tech Utilization - Billable hours, revenue per tech, utilization target tracking

**Batch 2 (Infrastructure & Compliance):**
35. Backup Dashboard - Multi-vendor backup health (Veeam/Datto/Acronis), client backup cards, failure tracking
36. Warranty Tracker - Manufacturer breakdown, expiry alerts, active/expired/unknown status
37. Compliance Frameworks - NIST/CIS/SOC2/HIPAA with control categories, progress bars, gap analysis
38. Client Budget - Budget vs spend charts, forecast overruns, utilization tracking

**Batch 3 (Analytics & Automation):**
39. Vendor Scorecard - Performance table, spend analytics (pie/bar charts), risk & compliance tab, vendor detail dialog
40. SLA Penalty Calculator - Auto-calculate penalties, credit resolution progress, breach timeline, issue credits
41. Alert Suppression Engine - Rule management with create/toggle/delete, analytics by match type/scope, noise reduction impact
42. Incident Heatmap - Day x Hour density grid, hover tooltip, hourly trend chart, priority distribution, category/client breakdown
43. Predictive Failure Detection - ML-powered predictions with risk scoring, urgent alerts banner, failure type breakdown, detail dialog
44. Resource Capacity Planner - Team utilization gauge, scaling scenarios, workload ratios, 6-month trend chart, hiring alerts
45. Auto-Documentation Generator - AI doc generation (Network/Asset/DR), template cards, client grouping, document section preview
46. Natural Language Search - Plain English query engine, suggestion chips, query history, result highlighting, device/ticket/stat results

**Already Enterprise-Grade (no changes needed):**
47. Leaderboard - XP podium, profiles, activity heatmap, badge system
48. IT Documentation - Password vault, docs management, CRUD, client filtering

## Prioritized Backlog

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
- Fix aria-describedby for DialogContent (accessibility)
- Clean up TEST_ prefixed devices from previous test data

## Mocked Features
- All SOC/security data uses mock generators (realistic randomized data) - ready for real Huntress API
- AI routing (mock)
- Voice-to-text (mock)
- Email sending (requires Resend API key)
- Predictive failure predictions (mock ML data)
- NLP query (keyword matching, not real NLP)

## Authentication
- JWT-based custom auth
- Demo: admin@nexusops.io / admin123
