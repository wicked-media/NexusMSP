# NexusOps - RMM/PSA Platform PRD

## Overview
NexusOps RMM/PSA platform with 200+ routers, 75+ pages, live Acronis Cyber Cloud integration.

## Credentials
- Admin: `aaron@stech.com.au` / `Lucky@2871$!`
- Portal: `john@acmecorp.com` / `portal123`

## Acronis Integration (Live)
- Partner: Steele Technology (efa33c24-b78f-42ee-a1d9-3859ebd251f7)
- Data Centre: au1-cloud.acronis.com
- 83 customer tenants, 364 machines, 200 alerts
- Backup statuses: 207 healthy, 93 failed, 50 warning
- Credentials stored in backend/.env (ACRONIS_API_URL, ACRONIS_CLIENT_ID, ACRONIS_CLIENT_SECRET)
- Also configurable via Settings > Integrations > Acronis Cyber Cloud card

## Recent Updates (Apr 18, 2026)
- Backup Command Center with 4 live tabs: Tenants, Backup Status (364 machines with plans/timestamps), Activities, Alerts
- Link button on each tenant to map to NexusOps client
- Acronis Settings card in Settings > Integrations (Client ID, Secret, Data Centre URL, Test Connection)
- Backup status shows: machine name, tenant, health (ok/failed/warning), applied plans, last/next backup times
