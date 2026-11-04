# Monitoring Studio audit and consolidation plan

**Status:** Phase 0 complete; first safe UI admission complete.  This document
is not a claim that every source below is connected, current, or
production-verified.

## Decision

Monitoring Studio is the **tenant-scoped operational read model** for Nexus.
It does not become another device inventory, metrics database, alert engine,
ticket system, backup policy service, or provider collector.  Technology
Studios retain collection and administration ownership; Monitoring Studio
normalises the evidence they expose, preserves its provenance and freshness,
and correlates it only when a shared, recorded dependency supports that
relationship.

MongoDB remains the source of truth for existing Nexus operational records.
Prometheus, Tempo, Loki, Alertmanager and Grafana remain derived operational
telemetry where deployed, as recorded in `docs/DATA_OWNERSHIP.md`.  No new
store, migration, or customer identity is introduced by this plan.

## Existing inventory

| Capability | Current owner / source | Classification | Monitoring Studio treatment |
| --- | --- | --- | --- |
| Endpoint inventory and current agent observation | `devices`, `nexus_agents`; `GET /devices`, `GET /nexus-agent/agents` | Working, partial | Reuse as resource identity and freshness evidence. Missing observation is unknown, never healthy. |
| Endpoint performance snapshot | Nexus Agent `agent/internal/telemetry`; device telemetry | Working, source-dependent | Reuse CPU, memory, disk, uptime and NIC observations only with collection timestamps and units. It is periodic telemetry, not continuous streaming. |
| Windows health | Windows Studio / `windows_health`, agent Windows operations | Working, partial | Link evidence and diagnostics; do not create another Event Log collector. |
| Network / WAN observations | Network Studio, UniFi, bandwidth monitor | Working, partial | Reuse labelled controller or Edge telemetry. No inferred topology or synthetic throughput. |
| Proxmox observation | Proxmox adapter and Studio | Working, partial | Reuse provider observations; do not poll the API a second time. |
| Backup state and restore verification | Backup Centre, `backup_jobs`, verification endpoints | Working, partial | Reuse job and restore evidence. A successful job does not prove recovery. |
| Security posture and alerts | Security Studio / Shield records | Working, partial | Reuse operationally relevant state; threat investigation remains Security-owned. |
| Alert policy evaluation | `app.routers.alert_rules` | Working, incomplete | Reuse duration, cooldown, maintenance suppression, ticket hand-off and workflow dispatch. Add tenant scope and evidence provenance before broadening use. |
| Maintenance windows | `maintenance_windows`, `maintenance_window_runs` | Working | Reuse as the sole suppression/execution boundary. |
| Tickets and escalation work | `tickets`, workflow runtime, notifications | Working | Link correlated incidents to existing ticket records. Do not create a second PSA lifecycle. |
| Platform telemetry | `app.services.observability`, Prometheus/OpenTelemetry hooks | Working, platform-only | Use for Monitoring Studio self-health; keep it distinct from customer monitoring. |
| Nexus Pulse | `app.services.nexus_pulse`, `GET /nexus-pulse/overview` | Working read model, incomplete | This is the correct initial composition point. It currently covers fleet freshness, agent freshness, open service work and backup attention only. |

## Implemented admission slice

The Monitoring Studio overview now adopts the existing scoped Pulse endpoint
through the shared Studio workbench.  Its inventory tab also adopts the
read-only Pulse resource register, which labels each existing endpoint record
as `observed`, `stale` or `not_monitored`.  Neither admission adds a collector,
persistence, provider request or independent alert state.  The panels display
only the contracts' retained records and preserve uncertainty rather than
treating an absent observation as a healthy result.  Focused frontend tests
cover registry-to-panel dispatch and both endpoint contracts; focused backend
tests cover the compositions and tenant/client-scoped router reads.

The local browser access gate below remains open: an unauthenticated or stale
session must still not be mistaken for proof that an authorised monitoring
read fails.

## Current collector and data-flow architecture

1. Nexus Agent collects endpoint inventory and a bounded performance snapshot.
   `CollectPerformance` samples CPU over 250ms and returns current CPU,
   memory and disk state. It does not provide historical series by itself.
2. The backend persists / projects device and agent observations with stable
   Nexus IDs and timestamps.
3. Specialist providers (UniFi, Proxmox, Microsoft, Backup and security
   sources) retain their own adapter and collection boundaries.
4. Alert rules evaluate existing device observations and can honour active
   maintenance windows, create a ticket, publish a controlled chat alert and
   dispatch a workflow.
5. Nexus Pulse composes a scoped, read-only overview.  It currently has no
   dependency graph, availability ledger, historical metric query or incident
   correlation engine.

## Consolidation findings

### Reuse now

- `nexus_pulse` for the safe, scoped operational composition pattern.
- `device_pulse`, Fleet Baseline and Windows Health for endpoint evidence.
- Alert Rules for configured threshold/duration/cooldown behaviour.
- Maintenance Windows for suppression and authorised execution scheduling.
- Events, workflow runs, tickets and notifications for audit and hand-off.
- Existing Studio adapters for Network, Proxmox, Microsoft, Backup and
  Security rather than duplicating their provider polling.

### Do not consolidate by copying data

- Do not create a Monitoring-owned device, client, site or backup register.
- Do not add a second time-series datastore without an approved retention and
  ownership decision.
- Do not merge security incidents into generic operational incidents without a
  source-linked reference and Security ownership.
- Do not turn local Agent snapshots into “live” telemetry without a retained
  timestamped ingestion pipeline.

### Gaps that remain open

- Historical customer telemetry query/retention contract.
- Monitored-resource/profile/check data model and safe target policy.
- Explicit dependency graph and evidence-backed alert correlation.
- Availability and SLA evidence ledger, including maintenance exclusions.
- Collector registration, health and backpressure model for non-Agent checks.
- Cross-source coverage reporting and a verified NOC dashboard.

## Browser verification result

On the local authenticated browser session, `GET /api/nexus-pulse/overview`
returned HTTP 403 on 2026-10-18.  The page remained in its loading state.  This
is a release blocker for the Monitoring Studio UX, but it does **not** prove
the endpoint or its scoped server-side logic is broken: the next implementation
slice must add an authenticated API test and determine whether the active user
lacks a required permission, has an expired session, or is failing a scope
policy.

## Sequenced implementation

1. **Access and truthfulness gate.** Add focused endpoint and browser-client
   tests for an authorised tenant user, unauthorised user and client-restricted
   user; fix the observed 403 only after identifying its server-side cause.
2. **Unified read contract.** Extend the Pulse composition to expose source,
   observed-at, freshness, state and stable target IDs for existing specialist
   evidence.  No provider action or synthetic metric is added.
3. **Coverage and resource inventory.** Build a read-only monitored-resource
   projection over existing stable IDs, explicitly reporting `not_monitored`,
   `unknown` and stale source states.
4. **Alert and incident correlation.** Add an evidence-backed, tenant-scoped
   correlation projection.  Preserve every source alert and label a likely
   upstream cause as a hypothesis, never a confirmed root cause.
5. **Availability and history.** Only after a documented retention decision,
   add time-window calculations and graphs sourced from retained samples.
   Unknown windows stay unknown; maintenance treatment is explicit.
6. **Controlled operations.** Reuse maintenance windows, alert rules and
   approvals for diagnostics/remediation.  Monitoring never acquires direct
   unrestricted command execution.

## Acceptance gates

- Every read and write is tenant- and client-scoped server-side.
- Every displayed signal names its source and observation time.
- A missing, stale, unconfigured or permission-denied source is not displayed
  as healthy.
- Alerts, ticket hand-offs and workflow actions retain stable target IDs and
  audit evidence.
- A dependency or root-cause suggestion names the recorded relationship and is
  not described as a verified cause.
- No specialist provider is polled twice solely for Monitoring Studio.
- Provider integrations are reported as unverified until an authorised
  environment test succeeds.
