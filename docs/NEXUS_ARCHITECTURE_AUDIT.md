# Nexus architecture audit

Status: initial static repository audit, 2026-08-14. No data was migrated and no production database configuration was changed.

## Current application architecture

| Area | Current state | Finding | Priority |
|---|---|---|---|
| Frontend | React 19 SPA, Axios API calls, optional Supabase browser client | Primary workflows use Nexus API; Supabase browser client is configured with no persisted session | P1: retain API-only business mutations and type shared API contracts |
| API | FastAPI with routers, services and Motor direct collection access | Functional modular structure, but direct `db.<collection>` access is widespread and repository boundaries are not yet explicit | P1 |
| MongoDB | Motor client from `MONGO_URL`; broad document model | Current primary store. Strong fit for telemetry/integration documents, but collection ownership, indexes, retention and formal tenant model are not centrally documented | P0/P1 |
| Supabase | Private Storage adapter plus authenticated status route; optional browser client | No Postgres domain table, migration, RLS policy or backend table access is present in source | P0: verify cloud RLS/storage policies and environment separation before customer data |
| Workers/events | Docker worker and Mongo-backed event backbone exist | Event foundation exists; standardise schema/versioning, retry/dead-letter and observability evidence | P1/P2 |
| Agent | Existing Go module | Go Agent is established. Rust is a future option for security-critical native components, not a rewrite mandate | P2 |
| Nexus OS/Edge | Separate project folders and architecture docs | Keep separately deployable from SaaS; define shared identity/update primitives before expansion | P1 |

## Data and tenancy observations

1. `client_id` is broadly used and stable IDs are common. `tenant_id` appears in selected services but is not yet a universal, explicit ownership field; several services use `nexus-local` as a fallback. This prevents the current repository from claiming complete multi-tenant isolation.
2. MongoDB is the current operational system of record. The existing Supabase adapter deliberately retains Nexus metadata and permissions in MongoDB, which is the correct boundary for now.
3. There are no repository-managed Postgres migrations or tables to classify. The Supabase project itself must be inspected separately in the Supabase dashboard/CLI before any RLS or table conclusion can be made.
4. The production compose file includes MongoDB, API, worker and web. It does not yet model Supabase as a required production dependency; Storage is optional by environment configuration.

## Security and reliability observations

- Existing security review documents focused fixes and residual dynamic-testing work. This audit does not replace an authenticated two-tenant test or independent penetration test.
- The Supabase service-role key is correctly described as backend-only in source. It must remain outside browser bundles, logs and Git.
- Mongo tenant isolation must be verified route-by-route with adversarial tests. Client scope is not a replacement for formal tenant scope in a reseller/multi-MSP deployment.
- Mongo indexes, TTL policies, validation rules, document growth and backup restore evidence cannot be verified from source alone; capture them against each environment before broad release.

## Read-only environment check — 2026-08-14

- Supabase Storage: the configured `nexus-artifacts` bucket responded successfully and reported `public: false`. This verifies the private artifact bucket only; it does **not** prove Postgres RLS, Auth, Realtime, or Storage object policies.
- Browser configuration: no local `REACT_APP_SUPABASE_*` values were configured, so the current local UI cannot bypass the Nexus API through a browser Supabase client.
- MongoDB: the configured database responded to a metadata-only ping and reported 205 collections. Only 22 had at least one non-`_id` index, while 183 had none. This is a scale/readiness risk to inventory and remediate by actual query pattern; it is not permission to bulk-create indexes blindly.
- Voice/YCM fleet administration: YCM credentials, fleet discovery and Cloud PBX claim operations are now global-scope actions. Restricted technicians are denied and audited before any integration data or client mapping is read or changed; assigned PBXs remain available through the client-scoped Voice workflows.

## Immediate recommendations

1. Treat formal tenant ownership and cross-tenant API tests as P0 before channel/multi-MSP production.
2. Audit the connected Supabase project: RLS, private artifact bucket policies, Auth settings, Realtime exposure, service-role access, backups and environment separation.
3. Inventory Mongo production indexes, collection validators, retention/TTL policies and restore evidence. Do not infer them from application code.
4. Add a small data-access boundary for new/refactored high-risk domains; do not mass-rewrite working routers.
5. Standardise event/job envelopes with `event_id`, schema version, tenant/client scope, correlation and idempotency.
