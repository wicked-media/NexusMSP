# Nexus technical capability execution track

Last reviewed: 2026-09-05

Status: active delivery plan; this document is not production evidence.

## Purpose

Nexus has a broad product surface. The remaining work must be completed as
verifiable technician capabilities, not by adding more screens or treating a
provider configuration as proof that a provider action works. This track
turns the open technical capabilities in the master register into small,
ordered delivery slices.

Each slice is complete only when it has a secured API boundary, explicit
tenant/client scope, durable audit evidence, failure handling, targeted tests,
operator documentation and a recorded release or pilot result where an
external system is involved.

## Current delivery: Academy and security awareness

The active Academy slice adds tenant-bound, administrator-authored courses,
staff assignments and immutable completion evidence while preserving the
existing account-owned first-use onboarding record. It deliberately starts
with Nexus staff learning only. Customer/portal learning, external phishing
delivery and compliance certification require their own client identity,
message-delivery and evidence model; they must not be implied by a learning
card or an acknowledgement.

The initial security-awareness programme is editorial training content for:

1. phishing and business-email compromise;
2. passwords, passkeys and MFA recovery;
3. technician/customer verification and safe remote support;
4. ransomware and incident reporting; and
5. data handling and privacy.

Completion records show the learner, assigned course version, attestation or
assessment result and timestamp. They are readiness evidence only; they never
prove a customer action, a security control, or regulatory compliance on their
own.

## Next technical capability slices

Academy implementation now includes course CRUD through create/edit/archive,
explicit publication, staff assignment, version snapshots and server-graded
knowledge checks. The focused Academy/onboarding and existing Agent/Remote
regression suites pass (87 tests); frontend lint and the production build pass.
This verifies local implementation contracts. Customer learning, phishing
delivery, signed fleet rollout and provider acceptance remain open.

| Order | Capability | Smallest safe delivery | Evidence required before advancing |
|---|---|---|---|
| P0.1 | Authenticated tenant-bound DAST | Exercise the eight golden workflows as users restricted to different clients and roles; fix any fail-open boundary. | Test report, rejected cross-client probes, remediation tests and release-owner review. |
| P0.2 | Upload quarantine | Insert an asynchronous quarantine/scanner boundary before broad portal file availability. Fail closed when the scanner is unavailable; record disposition and safe reason codes. | Malware, bad-type, retry, timeout and cross-client retrieval tests; operator handling runbook. |
| P0.3 | Observability and alert ownership | Export structured metrics/traces to a chosen production backend and configure owned alert routes for API, workers, MongoDB and providers. | Outage drill, alert receipt, correlation trace and named on-call evidence. |
| P0.4 | Recovery rehearsal | Restore MongoDB, uploads and installer artifacts into an isolated environment; verify records, files, RPO/RTO and application rollback. | Timed recovery log, checksums/counts, rollback drill and signed release record. |
| P0.5 | Provider acceptance | Validate one provider at a time in sandbox or a controlled tenant: Microsoft, email/SMS, Xero, Yeastar, backup and RustDesk. | Provider-side result, idempotent retry, denied-scope, timeout and audit evidence. |
| P1.1 | Nexus Agent pilot hardening | Produce a signed Windows release, define staged rings, deploy to an internal pilot, exercise update, rollback and post-reboot heartbeat. | Authenticode verification, pilot inventory, forced rollback and replay/expiry tests. |
| P1.2 | Nexus Remote transport roadmap | Preserve the governed RustDesk adapter while introducing a ticket/device/technician-bound, one-time JIT broker contract for a future Nexus Remote Companion. | Threat model, nonce/revocation tests, sandbox relay proof and attended-session policy tests. |
| P1.3 | Search and action consistency | Expand permitted, typed universal search sources behind the Nexus API; keep command results and direct routes under identical authorisation. | Source coverage matrix, cross-client negative tests, latency/error tests and user guide. |
| P1.4 | Network evidence | Build safe, agent/edge-backed discovery and configuration backup/diff evidence before any configuration restore or enforcement action. | Secret-boundary, scope, retention, diff accuracy and recovery/simulation tests. |
| P1.5 | Customer learning (separate decision) | Design a client-portal identity, assignment, notification and evidence model before exposing Academy to customers. | Data-ownership decision, portal scope tests, delivery and consent evidence. |

## Decision rules

- A live integration, native agent, relay, external message or automated
  remediation is not complete until it has been proven in a controlled
  environment. Do not manufacture a success state to make a workspace appear
  complete.
- Keep RustDesk as the approved transport adapter while Nexus owns policy,
  ticket, consent and audit evidence. Do not call a native remote transport
  complete until the JIT broker, signed companion, relay, revocation and pilot
  controls are independently evidenced.
- Keep the current Go Agent and its supported Windows path stable. macOS/Linux
  parity is a planned capability with its own signing, packaging and fleet
  acceptance work; it is not a cosmetic feature flag.
- No customer-facing security-awareness campaign or simulated phishing email
  is sent until sender identity, approval, opt-out/consent, tenant isolation,
  rate limits, delivery handling and legal/policy review are in place.

## Operating cadence

1. Select one row, define its threat/rollback boundary and add focused tests.
2. Implement the smallest safe domain/API/UI or worker slice.
3. Run static and unit validation, then perform the real sandbox or pilot
   evidence step if required.
4. Record the result in the capability register and production-readiness
   checklist. Failed evidence remains a blocker, not a green status.
5. Advance only after the previous row has a clear owner and recovery path.

This execution track complements the
[implementation roadmap](NEXUS_IMPLEMENTATION_ROADMAP.md),
[master capability register](NEXUS_MASTER_CAPABILITY_REGISTER.md) and
[production readiness runbook](PRODUCTION_READINESS.md). The register remains
the source of truth for capability status.
