# Nexus architecture plan

This plan follows the audit-first rule. It does not authorise database migrations by itself.

## P0 — security and data integrity

1. Run authenticated two-tenant API tests across client, ticket, device, billing, portal, artifact and agent-command routes. A cross-tenant read/write is release-blocking.
2. Audit actual Supabase cloud configuration: RLS, Storage policies, Auth/session settings, Realtime, service-role scope, backups and environment separation.
3. Inventory Mongo production configuration: indexes, validators, TTL, backup encryption, restore proof and access controls.
4. Replace implicit `nexus-local` tenancy fallbacks for channel/multi-MSP paths with an explicit migration-safe tenant model.

## P1 — domain and ownership boundaries

1. Keep `docs/DATA_OWNERSHIP.md` current for every new table, collection, cache or replica.
2. Introduce repository/data-access boundaries only while touching high-risk domains (Identity, Client, Ticket, Billing, Agent, Security); do not mass-refactor routers.
3. Define the universal action envelope: actor, tenant, target, permission, policy/risk, approval, idempotency, audit, correlation, timeout, verification and compensation.
4. Version the event backbone schema and document retry, failure and replay semantics.

## P2 — reliability and operations

1. Instrument API, worker, event and integration paths with correlation IDs, structured logs, health checks and OpenTelemetry-compatible telemetry.
2. Add bounded retry/backoff and failure-state handling for external providers; add dead-letter handling only after the workload justifies it.
3. Establish retention/index standards for telemetry, events, snapshots and provider caches.
4. Capture repeatable production restore and incident exercises for Mongo, uploads and Supabase artifacts.

## P3 — controlled modernisation

1. Evaluate deterministic Python dependency tooling only after reproducing the current environment and CI builds.
2. Move selected new native security/transport components to Rust only where privileged access, resource footprint or cryptographic boundaries justify it.
3. Evaluate PostgreSQL for a deliberately selected relational business domain only with source-of-truth declaration, schema mapping, dry run, counts, integrity tests, backup and rollback.
