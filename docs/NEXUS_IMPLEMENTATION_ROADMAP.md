# Nexus implementation roadmap

Last reviewed: 2026-08-07

## Programme rules

- Work in dependency order and complete one verifiable slice at a time.
- No mock or static-success response may represent provider-backed production behaviour.
- Every release gate requires backend, data, secured API, tenant/RBAC enforcement, audit/event evidence, frontend states, tests, documentation and production configuration.
- Destructive endpoint, identity, security, billing and communication actions start in simulation or approval-required mode.
- Capability status is maintained in `NEXUS_MASTER_CAPABILITY_REGISTER.md`; release evidence is maintained in `NEXUS_PRODUCTION_READINESS_CHECKLIST.md`.

## Release 1 — Production Foundation

Objective: safely operate a controlled internal and single-client pilot.

| Workstream | Acceptance criteria | Production gate |
|---|---|---|
| Tenant isolation | Canonical tenant/client scope applied to every pilot-path query, export, file, event, job and websocket. | Automated two-client horizontal and vertical privilege tests plus authenticated DAST return fail-closed responses. |
| Authentication | Strong password policy, MFA, login throttling, secure expiry, revocation/rotation plan, bootstrap registration lock and audited login outcomes. | Brute-force, enumeration, MFA, expiry and revoked-session tests pass; ingress and proxy trust are documented. |
| RBAC and approvals | Named permission catalogue, client access scope, temporary elevation and approval gates for high-impact actions. | Denied operations are tested at the API boundary and recorded without leaking target existence. |
| Secrets and data security | Central encrypted integration secrets, production secret store, rotation process, upload allow-list/signature/malware strategy and retention rules. | No repository secrets; rotation and upload quarantine tests; production config validated. |
| Canonical model | Stable client/site/user/device/service/contract/ticket/invoice/integration identities and relationship rules. | Duplicate, orphan, relationship and migration tests pass on a production-like copy. |
| Agent trust | Unique identity, tenant/device binding, command signature/expiry/replay protection, staged signed update and rollback. | Windows pilot artifact is signed; compromised/replayed command tests and rollback drill pass. |
| Remote security | Scoped device mapping, technician authorization, consent, ticket/time/audit lifecycle and idempotent session creation. | Sandbox relay golden workflow and cross-client remote tests pass. |
| Billing integrity | Deterministic quantity sources, approvals, idempotent invoice/payment handoffs and durable audit. | Golden ticket-to-invoice and service-reconciliation workflows pass with provider failure scenarios. |
| Reliability and observability | Worker leases/recovery, correlation IDs, structured logs, health/readiness, metrics/traces/alerts and owners. | Queue/provider outage drills alert the named owner and recover without false success. |
| Delivery and recovery | Reproducible containers/agent build, CI gates, immutable releases, migrations, backups and rollback. | Timed Mongo/uploads restore and application rollback rehearsals meet recorded RPO/RTO. |

Release 1 exit: no open critical/high security risks; all six golden workflows in `PRODUCTION_READINESS.md` have current evidence; one controlled pilot has completed rollback and recovery drills.

## Release 2 — MSP Core

Scope: complete ticket workflows, Nexus Connect operational collaboration, devices, remote support, documentation, contracts, billing, customer portal, Microsoft foundation, reports, automation, search and notifications.

Acceptance criteria:

- A technician can work the complete ticket lifecycle without leaving Nexus, including customer communication, device remote session, time, product, invoice and client timeline evidence.
- A technician can pass or share ticket responsibility through an accepted handoff, with a private live object room, unchanged permission boundaries and complete audit/event evidence.
- Client 360 uses canonical objects rather than copied module-specific records.
- Microsoft tenants have explicit client mapping, consent state, token health and audited actions.
- Search and commands enforce permissions identically to direct API routes.
- Portal exposes only approved client data and passes responsive/WCAG checks.
- Value Proof separates observed outcomes, review opportunities and unmeasured claims; migration batches dry-run, reconcile and remain safe to repeat before any source cutover.

Gate: service-desk, remote, documentation, billing, Microsoft and portal golden E2E suites pass under tenant-restricted roles and provider outage conditions.

## Release 3 — Revenue and Operations

Scope: telecom billing, Yeastar, Atom ingestion, licence/service reconciliation, Revenue Protection, quotes, procurement, inventory, projects, profitability and lifecycle.

Acceptance criteria:

- Every recurring charge identifies its source quantity, agreement, product, effective date and approval.
- Provider imports are checksum/idempotency protected and safe to retry.
- PO receiving records serials, ticket/project ownership, technician notification and auditable note.
- Quote → PO/project → asset/service → invoice is traceable end to end.

Gate: duplicate files, partial provider failures, rounding/tax, split billing, inventory concurrency and underbilling regression suites pass.

## Release 4 — Security and Compliance

Scope: Nexus Shield/XDR, identity/email/endpoint/cloud security, vulnerability management, Nexus DNS, compliance controls/evidence, incident response and reports.

Acceptance criteria:

- Signals carry source, client, identity/device relationships, confidence and observed timestamps.
- Correlation creates one incident without discarding source alerts.
- Containment always requires policy and approval, supports simulation and records verification.
- Compliance claims link to retained evidence and show freshness/limitations.

Gate: detection provenance, false-positive, cross-client, containment rollback, incident replay and evidence tamper tests pass; methodology receives independent review.

## Release 5 — Intelligence

Scope: Concierge, AI memory/root cause, self-writing documentation, prediction, risk forecasting, recommendations, simulation and change impact.

Acceptance criteria:

- Responses are grounded in permitted Nexus evidence and expose confidence, risk, alternatives and verification.
- AI unavailability never blocks core MSP operations.
- Tool execution uses the same permissions/approvals as manual actions.
- Retention, privacy, redaction and spend controls are measurable.

Gate: tenant leakage, prompt injection, authorization, hallucination/evidence, destructive action, outage/fallback and cost eval suites meet approved thresholds.

## Release 6 — Platform Ecosystem

Scope: versioned public API, webhooks, SDKs, CLI, marketplace, workflow/industry packs, integration builder, AI skills and developer portal.

Acceptance criteria:

- Versioning/deprecation and compatibility policies are published.
- Apps run in a least-privilege sandbox with install-time scopes and runtime quotas.
- Webhooks are signed, replay protected, observable and retryable.

Gate: contract compatibility, webhook forgery/replay, quota, extension isolation and marketplace supply-chain tests pass.

## Release 7 — Native Nexus Products

Scope: native Remote components, Backup management/engine stages, Nexus DNS, approved vault-reference strategy, network appliance and a separate NexusOS developer preview.

Acceptance criteria:

- Native products reuse canonical identity, objects, policies, events, audit, billing and design standards.
- Build-versus-integrate decisions have threat models, support costs and exit criteria.
- NexusOS remains isolated in its own repository and release process.

Gate: product-specific security/recovery reviews, signed artifacts, staged updates/rollback and controlled design-partner pilots pass.

## Immediate work queue

1. [Completed 2026-08-07] Add and verify public authentication abuse protection with privacy-safe counters and proxy trust controls.
2. Run authenticated two-client DAST over the six golden workflows and close boundary gaps.
3. Add upload quarantine/malware-scanner interface before broad portal uploads.
4. Connect structured metrics/traces/alerts to a production observability backend and assign owners.
5. Rehearse Mongo/uploads restore and immutable application rollback.
6. Execute provider sandbox acceptance for email/SMS, Microsoft, Xero, Yeastar, backup and RustDesk.

New modules are deferred until the Release 1 queue is complete or a documented dependency requires them.
