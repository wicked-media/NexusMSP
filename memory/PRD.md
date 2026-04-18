# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps is an enterprise-grade RMM/PSA platform with 200+ backend routers and 75+ frontend pages. Now with live Acronis Cyber Cloud integration.

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`
- Acronis: Client ID cb352098... / au1-cloud.acronis.com (partner: Steele Technology, 83 tenants)

## Recent Features (Apr 18, 2026)

### Acronis Live Integration
- **Real API connection** to Acronis Cyber Cloud (au1-cloud.acronis.com)
- Partner-level auth: Single credential accesses all 83 customer tenants
- Live data: Tenants, Resources (500), Alerts (200), Usage per tenant
- Sync button pulls fresh data into local DB
- Customer-to-NexusOps client linking system

### Module Consolidation (8 merges)
- Revenue Command Center, Backup Command Center, SLA Manager, Compliance Hub, Dispatch Center, Reports Hub
- AI Triage consolidated, Portal consolidated
- ~23 pages eliminated

## Integration Architecture
- Acronis auth: OAuth2 client_credentials → JWT with partner scope
- Root tenant: efa33c24-b78f-42ee-a1d9-3859ebd251f7 (Steele Technology)
- API endpoints: /api/2/tenants, /resource_management/v4/resources, /alert_manager/v1/alerts

## Test Reports
- iteration_99: Module merge — 100% (25/25 backend, 6/6 frontend)
- Acronis API: Live connection verified, 83 tenants, 500 resources, 200 alerts

## Remaining
- Link Acronis tenants to NexusOps clients
- Connect live Stripe key, verify Resend sender domain
- Operational modules (SLA, Escalation, Change Mgmt, Skills, Live Chat)
- Security modules (Vuln Scanner, Dark Web, Phishing Sim, MFA Mgmt)
