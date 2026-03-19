# NexusOps - Product Requirements Document

## Overview
NexusOps is a feature-rich RMM/PSA (Remote Monitoring & Management / Professional Services Automation) platform intended to surpass competitors like Syncro and SuperOps.

## Core Architecture
- **Frontend**: React + Shadcn UI + Tailwind CSS
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **AI Integration**: Emergent LLM Key (Claude Sonnet for AI features)

## Authentication
- JWT-based custom auth
- Default admin: admin@nexusops.io / admin123

## Implementation Phases

### Phase 1-7: Core Platform (COMPLETE)
- Dashboard, Tickets, Devices, Assets, Clients, Contracts, Invoices
- Time Tracking, Knowledge Base, Remote Access, CRM/Leads
- Email, Scripting, IT Documentation, Projects
- Networking, Scheduling, Technicians, Products, Purchase Orders
- Device Discovery, Stocktake, Estimates, On-Call Scheduling
- Integrations: Stripe, Splynx, Hudu, Xero (mocked), Pax8 (mocked), Domotz (mocked), RustDesk, Proxmox, Acronis, O365

### Phase 8: 8 Differentiator Features (COMPLETE - Tested)
1. AI Ticket Triage
2. Client Sentiment Scoring
3. Gamification & Leaderboard
4. Smart Scheduling (Route Optimization)
5. Public Status Board
6. Voice-to-Ticket
7. Predictive Failure Analysis
8. Client Onboarding Wizard

### Phase 10: 15 Swiss Army Knife Features (COMPLETE - Tested)
1. AI Copilot Panel
2. Client Health Scoring
3. NOC Wallboard
4. Magic Portal Links
5. Document Scanner
6. Network Topology
7. Runbook Automation
8. Password Vault
9. QR Asset Tags
10. Email Campaigns
11. SLA Timer
12. Benchmarking
13. Billing Reconciliation
14. Upsell Detector
15. ROI Reports

### Phase 11: 15 Features MSPs Are Screaming For (COMPLETE - Tested 2026-03-19)
1. AI-Powered Knowledge Base (Self-Healing Wiki) - `/api/kb/*`
2. Client Communication Timeline - `/api/client-timeline/{client_id}`
3. Automated Compliance Reporting (CIS/HIPAA) - `/api/compliance/*`
4. Real-Time Revenue Per Endpoint Dashboard - `/api/rpe/dashboard`
5. Intelligent Dispatch Board - `/api/dispatch/*`
6. Contract Profitability Analyzer - `/api/contract-profit/overview`
7. Vendor Scorecard & Spend Analytics - `/api/vendor-scorecard/overview`
8. Client IT Roadmap Builder - `/api/it-roadmap/*`
9. Automated Warranty Tracker - `/api/warranty/overview`
10. Multi-Tenant Client Comparison Dashboard - `/api/client-compare`
11. Technician Skills Matrix & Auto-Matching - `/api/skills-matrix`
12. Approval Workflows Engine - `/api/approvals/*`
13. Asset Depreciation & Refresh Planner - `/api/asset-depreciation`
14. Incident Post-Mortem Generator (AI) - `/api/postmortem/*`
15. Client Satisfaction Pulse Surveys - `/api/csat/*`

## Backlog

### P1 - Upcoming
- Phase 9 Enhancements: Device Activity Monitoring, Acronis Reporting, UI Dark/Light mode
- Full UniFi Integration
- Full Xero Integration (currently mocked)

### P2 - Future
- Full Pax8 & Domotz backend logic (currently mocked)
- Standalone DB seeding mechanism
- Client portal for estimate approval
- Ticket page visual overhaul

### P3 - Nice to Have
- Bluetooth barcode scanner integration
- recharts console warnings fix

## Refactoring Needs
- `server.py`: 45+ manually registered routers - needs auto-discovery
- `App.js`: 70+ route definitions - needs route modules
- `TicketsPage.jsx`: 2300+ line monolith - needs decomposition
- API routing strategy to prevent path collisions

## Active 3rd Party Integrations
Stripe, TipTap, Recharts, @dnd-kit/core, Splynx, Hudu, Resend, emergentintegrations (Multi-LLM), Office 365, fpdf2, RustDesk, qrcode

## Test Reports
- Phase 8: /app/test_reports/iteration_39.json (34/34 backend, 8/8 frontend)
- Phase 10: /app/test_reports/iteration_40.json (39/39 backend, 15/15 frontend)
- Phase 11: /app/test_reports/iteration_41.json (28/28 backend, 14/14 frontend)
