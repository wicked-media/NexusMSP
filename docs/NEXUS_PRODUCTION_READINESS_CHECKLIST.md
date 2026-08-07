# Nexus production-readiness checklist

Last verified: 2026-08-07  
Legend: `[ ]` not started, `[-]` in progress, `[x]` implemented and verified, `[!]` blocked, `[~]` deferred with approved reason.

An item is `[x]` only when the evidence and tests named here exist. “Implemented” without production-like proof remains `[-]`.

| State | Requirement | Severity | Owner | Evidence and tests | Production blocker / remaining work |
|---|---|---:|---|---|---|
| [x] | Production refuses a missing JWT secret and separates integration encryption material. | Critical | Security | `app/database.py`, `.env.example`, container config and security review | Production secret-store injection and rotation rehearsal remain deployment evidence, tracked separately. |
| [x] | Bootstrap registration closes after the first account; technician creation is authenticated. | Critical | Identity | `routers/auth.py`; deterministic auth tests | None for bootstrap behaviour. |
| [x] | MFA challenge is enforced when a verified TOTP enrolment exists. | High | Identity | `routers/auth.py`; login regression coverage | Recovery codes/passkeys/SSO and operational recovery process remain R1 work. |
| [x] | Public login has distributed brute-force and enumeration resistance. | Critical | Security | `request_throttling.py`, auth integration, TTL bootstrap, Compose configuration and `test_request_throttling.py`; verified 2026-08-07 | Retain defence-in-depth ingress limits and tune thresholds from production telemetry. |
| [!] | Session rotation, revocation and production passkey/SSO contract. | High | Identity | Roadmap decision recorded | Product/identity decision and persistence model required. |
| [-] | Every pilot API/query/export/file/event/job/websocket enforces tenant and client scope. | Critical | Platform + Security | Scope services, tenant tests, reviewed high-risk paths | Authenticated two-user/two-client DAST and complete route matrix required. |
| [x] | High-impact endpoint commands require explicit capability and trusted agent identity. | Critical | Agent | Agent safety/trust services and tests; Go command tests | Signed production release proof tracked below. |
| [!] | Agent binaries/updates are signed, staged, rollback-tested and tamper resistant. | Critical | Agent + Release | Windows build artifact exists in CI | Code-signing infrastructure and pilot rollout/rollback evidence required. |
| [x] | Remote sessions enforce provider, target scope, consent, purpose, technician, ticket/time and audit lifecycle. | Critical | Remote | Remote runtime/RustDesk tests; verified ticket-to-remote UI flow | Sandbox relay acceptance and recording policy remain. |
| [x] | Upload paths and extensions fail closed on reviewed ticket/device/client/workshop surfaces. | Critical | Security | `upload_security.py` and upload tests | Malware/content-signature scanner remains required before broad public upload. |
| [!] | Public uploads are quarantined and malware scanned before release. | High | Security + Platform | Interface not yet selected | Scanner infrastructure, policy and operational handling required. |
| [x] | Correlation IDs and baseline security response headers are applied to API responses. | High | Reliability | `server.py` middleware | CSP/HSTS/TLS belong at verified production ingress. |
| [-] | Structured logs, metrics, traces, dependency/queue health and actionable alerts have owners. | High | SRE | Correlation logs, health/readiness, production-readiness service | External telemetry backend, alert destinations and runbooks required. |
| [x] | Event and automation workers use durable status, leases and recovery semantics. | High | Platform | Event backbone/automation runtime tests | Production queue load and outage drill required. |
| [x] | CI runs frontend tests/lint/build/audit, backend deterministic tests/compile, Go test/vet/build and container builds. | High | Release | `.github/workflows`, current green local gates | Branch protection and protected environment evidence required. |
| [-] | Frontend lint has zero errors and a shrinking warning budget. | Medium | Experience | `lint:ci` passes with 126 warnings against max 127; accessibility lint backlog zero | Remove remaining hook/dead-code warnings without increasing budget. |
| [x] | Current frontend unit suite and production build pass. | High | QA | 23/23 tests and production build verified 2026-08-07 | Broader E2E/visual/a11y coverage tracked separately. |
| [x] | Deterministic backend safety suite passes. | High | QA | 276 tests passed on 2026-08-07 | Legacy live-stack probes must be replaced by controlled E2E coverage. |
| [x] | Go agent tests, vet and Windows amd64 build pass. | High | Agent | CI workflow and security review | Signing/pilot proof remains blocking. |
| [!] | Browser E2E covers six golden workflows under production-like roles and provider failures. | High | QA | Golden workflows defined in `PRODUCTION_READINESS.md` | Test environment, fixtures and provider sandboxes required. |
| [!] | Load and soak tests demonstrate thousands of MSPs / 100k+ endpoints architecture. | High | Performance | No accepted production-scale result | Workload model, targets and test infrastructure required. |
| [!] | Independent penetration test closes all critical/high findings. | Critical | Security | Internal static/security review complete | External assessment required before broad customer fleets. |
| [x] | API, worker, MongoDB and web containers build from reproducible repository definitions. | High | Release | Dockerfiles, Compose and CI build gate | Immutable registry tags/signing and deployment environment proof required. |
| [!] | TLS ingress, HSTS/CSP, WAF/rate policy and trusted proxy headers are verified. | Critical | SRE + Security | Application security headers exist | Production ingress configuration/evidence not present. |
| [!] | MongoDB, uploads and installer artifacts have encrypted scheduled backups and timed restore proof. | Critical | SRE | Required procedure documented | Restore has not been evidenced. |
| [!] | Immutable application rollback and database migration rollback are rehearsed. | Critical | Release | Rollback procedure documented | Staging rehearsal and recorded decision owner required. |
| [!] | External email/SMS delivery is proven with failure, retry and customer audit evidence. | High | Communications | Application workflows exist | Dedicated sandbox provider acceptance required. |
| [!] | Microsoft, Xero, Yeastar, backup providers and RustDesk pass sandbox acceptance. | High | Integrations | Integration code and focused tests exist | Vendor credentials/tenants and recorded acceptance required. |
| [-] | Billing golden paths are idempotent, auditable and fail closed on unavailable provider quantities. | Critical | Finance | Billing reconciliation tests and service quantity foundation | Provider sandbox and full split/tax/payment E2E required. |
| [-] | Nexus Connect object references and operational actions preserve the original workspace permissions, client scope and auditable responsibility. | High | Experience + Service Desk | Scoped cards/commands, Ticket Pass API, object rooms and `test_nexus_connect.py` | Two-client browser E2E, real-Mongo acceptance race proof, notification delivery and retention policy required. |
| [-] | UI uses shared design language, keyboard paths, responsive states and reduced motion. | Medium | Experience | Shared headers/metrics/dialogs/themes; a11y lint clear | Automated axe, browser, responsive and visual regression matrix required. |
| [-] | AI uses tenant-scoped evidence, permissions, confidence and safe fallback. | High | AI + Security | Provider abstraction, permissioned actions and confidence components | Formal eval, prompt injection, retention/privacy and spend thresholds required. |
| [~] | NexusOS developer preview. | Low | Future product | Capability register | Deferred until core platform Release 1 gates pass; separate repository required. |

## Current cycle record — 2026-08-07

1. **Inspected:** repository architecture, manifests, CI, containers, production/security runbooks, auth boundary, test estate and existing product-roadmap services.
2. **Found:** strong quality/security baseline but no master capability register; Release 1 remains blocked by authenticated DAST, malware scanning, observability integration, recovery proof and vendor sandbox acceptance.
3. **Fixed this cycle:** created the master register, release roadmap and evidence-based checklist; added distributed, privacy-safe login throttling with explicit proxy trust, TTL cleanup, audit outcomes and production configuration.
4. **Security implication:** no new module is considered shipped from UI evidence; production status now fails closed on missing end-to-end evidence.
5. **Verification:** focused Nexus Connect 4/4 and Value Proof 5/5 suites, frontend 23/23, production build, lint gate and deterministic backend gate 276/276 passed on 2026-08-07.
6. **Next priority:** execute authenticated cross-tenant DAST for the six golden workflows and close any boundary gaps.
