# Backup Studio audit and consolidation plan

## Purpose and boundary

Backup Studio is the single Nexus operations surface for backup evidence,
coverage gaps, recovery verification and provider capability. It does not
become a replacement provider or claim that a recorded job outcome proves a
recoverable restore. MongoDB remains the current source of record for Nexus
policy, operational projections and recovery evidence; providers remain the
authority for their own execution and inventory.

## Existing capability inventory — 2026-10-18

| Area | Current owner | Classification | Consolidation decision |
| --- | --- | --- | --- |
| Backup dashboard and status records | `backup_jobs`, `/backup-dashboard/*` | Existing, working projection | Keep as the shared protected-workload projection; expose freshness and stable client grouping. |
| Coverage compliance | `backup_records`, `/backup-compliance/dashboard` | Existing, incomplete | Reuse for observed coverage only. Missing evidence remains `not_assessed`; it cannot prove an endpoint is unprotected. |
| Restore verification | `backup_verifications`, `/backup-verify/*` | Existing, working governed evidence | Keep as the recovery-proof authority. Scheduled drills and completed outcomes remain distinct. |
| Recovery assurance | `backup_assurance.py`, `/backup-assurance/*` | Existing, working derived evidence | Keep as the explainable RPO/RTO/immutability/recovery score; it never executes a restore. |
| Acronis | `acronis.py`, `acronis_advanced.py`, shared integration service | Existing, partial provider integration | Reuse credential/configuration, tenant link, status, activity, policies, alerts and billing. Do not create another Acronis registry. |
| Native Nexus Backup | `nexus_backup.py`, agent `internal/nexusbackup` | Existing, deliberately non-executing | Retain policy, destination attestation, preflight and restore-drill intent. Payload capture/restore requires the approved immutable-destination release gate. |
| Proxmox backups | `proxmox_backups`, `proxmox_backup_schedules`, `proxmox_restore_logs` | Existing but not provider-executing | Correlate in Backup Studio when inventory evidence is wired; do not call it an active PBS integration yet. |
| Veeam and Microsoft 365 protection providers | No verified provider adapter | Missing / unsupported | Add only behind documented, capability-declared adapters and verified vendor credentials. |
| Billing and reporting | Acronis billing endpoints and existing report scheduler | Existing, partial | Reuse as source evidence; reconcile provider usage to stable Nexus client IDs before commercial automation. |

## Correctness fixes in this pass

- Client backup summaries now group by stable `client_id`, never mutable display name.
- Dashboard responses declare source and latest recorded timestamp. Missing timestamps remain missing rather than being shown as live/current.
- Recovery-verification and assurance client resolution now includes the authenticated tenant partition.

## Provider capability model

Every future adapter must explicitly declare `inventory`, `jobs`, `recovery_points`,
`repository_capacity`, `retention`, `agent_health`, `restore`, `restore_test`,
`billing`, and `management_actions`. The UI must show unavailable, unsupported,
not licensed, and permission-denied states rather than empty success states.

## Delivery order and release gates

1. **Evidence consolidation** — finish freshness, stable mappings and source
   quality across Acronis, Proxmox and existing recovery records.
2. **Coverage and RPO** — add workload-to-service-agreement expectations only
   after a stable client/site/workload relationship is observed.
3. **Provider adapters** — begin with documented Acronis capability mapping;
   add Veeam, PBS and M365 only using supported APIs and stored server-side
   credentials.
4. **Recovery operations** — staged, approval-gated restore workflows with
   immutable audit evidence. No restore action is released from a dashboard
   button without provider capability, scope, approval and outcome verification.
5. **Native Backup capture pilot** — gated on immutable external destination,
   signed agent release, encrypted envelope validation, sandbox restore and an
   approved payload-retention decision. It is not production backup today.

## Known limitations

- No verified Veeam adapter, PBS adapter or Microsoft 365 backup provider is
  connected in this installation.
- Acronis fallback data is available only to all-client scope until provider
  tenant IDs have an explicit stable Nexus client mapping.
- A recorded successful backup is not restore proof; only completed
  verification evidence can support that statement.
- Nexus Backup is an intent/preflight control plane, not a released data
  capture or restore engine.
