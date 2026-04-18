# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform with 200+ backend routers and 75+ frontend pages.

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

## Module Consolidation (Apr 18, 2026) — 8 Merges

| Merged Into | Replaced | Tabs |
|---|---|---|
| **Revenue Command Center** | RevenueTracker, RevenueTracking, RevenueAnalytics, RevenueForecast | Forecast, Analytics, Tracking, Churn |
| **Backup Command Center** | BackupCenter, BackupDashboard, BackupCompliance, BackupVerify | Dashboard, Compliance, Verification |
| **SLA Manager** | SlaCenter, SlaTimer, SlaReportGen, SlaPenalties | Timers, Predictions, Penalties, Reports |
| **Compliance Hub** | ComplianceCenter, Compliance, ComplianceFrameworks, ComplianceReportGen | Frameworks, Client Status, Reports |
| **Dispatch Center** | Scheduling, SmartSchedule, DispatchBoard | Board, Calendar, Availability |
| **Reports Hub** | Reports, ExecutiveReports, ClientReports, FinancialReports, RoiReports | Operational, Executive, Client, Financial, ROI |
| **AI Triage** (backend) | ai_ticket_triage, ai_triage, ticket_triage → one router | GPT + Keyword + Auto-route |
| **Portal** (backend) | portal.py → stubbed, portal_v2 + client_portal active | — |

## Result
- **~23 separate pages eliminated** → 6 unified command centers
- All old routes redirect to merged pages (no broken bookmarks)
- Backend: 3 duplicate routers consolidated, 200 routers loading clean

## Test Reports
- iteration_99: Module merge — 100% backend (25/25), 100% frontend (6/6 pages)

## Remaining Backlog
- Connect live Stripe key, verify Resend sender domain
- Operational modules: SLA Timer, Escalation Matrix, Change Management, Skills Matrix, Live Chat
- Security modules: Vuln Scanner, Dark Web Monitoring, Phishing Sim, MFA Mgmt, Backup Compliance
- Nice-to-have: QR Tags, Asset Depreciation, Maintenance Scheduler, Cost Per Ticket, Geo Map
