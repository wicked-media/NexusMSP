# NexusMSP engineering rules

## Architecture

- Nexus deliberately uses polyglot persistence. Do not migrate data between MongoDB and PostgreSQL/Supabase without an approved migration plan.
- The browser talks to the Nexus API, never directly to MongoDB or to Supabase for business mutations. Supabase is infrastructure, not the domain layer.
- MongoDB is the current system of record for the existing application. Supabase Storage is currently an optional private binary-artifact store; it is not an authoritative business-data store in this repository.
- Every new persistence decision must be recorded in `docs/DATA_OWNERSHIP.md`. One datum has one authoritative owner; replicas, caches and materialised data must be labelled as such.
- Use stable Nexus IDs (`tenant_id`, `client_id`, `site_id`, `device_id`, `ticket_id`) for cross-domain and cross-store relationships. Never use names, emails, hostnames, or mutable vendor identifiers as relationship keys.
- Keep FastAPI routes thin. Put reusable business policy in domain/application services and data access behind explicit boundaries as the code is modularised.
- Do not introduce a new language, database, queue, cache, or microservice without a measurable operational reason and an ownership decision.

## Technology responsibilities

- TypeScript/React: UI, typed API clients, design system, loading/error/permission-aware UX only.
- Python/FastAPI: domain APIs, integrations, automation, AI orchestration, analytics, reports and workers.
- PostgreSQL/Supabase: future authoritative relational business domains when intentionally adopted; Supabase may provide storage, auth/realtime or platform tooling behind Nexus services.
- MongoDB: current document-oriented operational data, telemetry, snapshots, flexible provider payloads, events and existing application records.
- Rust: future privileged Agent, Edge, Nexus OS, secure transport and command-execution components. Go remains an approved existing Agent runtime; do not rewrite it without a justified plan.

## Multi-tenancy and security

- Every customer-scoped read and write must enforce server-side tenant/client scope. Frontend filtering is not a security control.
- Sensitive actions require authentication, permission checks, audit evidence, idempotency where applicable, clear failure handling, and target scope validation.
- Never log, commit, render, or return service-role keys, integration secrets, tokens, passwords, or private artifact URLs.
- Supabase service-role credentials are server-only. Browser clients may use a publishable key only for explicitly policy-controlled capabilities.
- Treat cross-tenant access, secret exposure, unaudited privileged actions, and data corruption as release blockers.

## Change discipline

1. Audit current behaviour first; preserve working systems.
2. State the problem, desired outcome, risk and rollback before material changes.
3. Make the smallest safe change; do not mass-rewrite.
4. Add or update focused tests where a boundary changes.
5. Run relevant lint, compile, test and build checks; do not claim completion with knowingly broken validation.
6. Update architecture/data-ownership documentation for storage, tenancy, security or service-boundary changes.

## Definition of done

Appropriate behaviour, server-side authorisation, tenant isolation, auditability, validation, recoverability, observability, tests, and documentation are part of completion. A UI that merely appears to work is not sufficient.
