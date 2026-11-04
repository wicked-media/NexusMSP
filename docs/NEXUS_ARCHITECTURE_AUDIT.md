# Nexus architecture audit

Status: initial static repository audit, 2026-08-14. No data was migrated and no production database configuration was changed.

## Current application architecture

| Area | Current state | Finding | Priority |
|---|---|---|---|
| Frontend | React 19 SPA and Axios API calls | Primary workflows use the Nexus API; the unused browser Supabase client has been removed to enforce that boundary | P1: retain API-only business mutations and type shared API contracts |
| API | FastAPI with routers, services and Motor direct collection access | Functional modular structure, but direct `db.<collection>` access is widespread and repository boundaries are not yet explicit | P1 |
| MongoDB | Motor client from `MONGO_URL`; broad document model | Current primary store. Strong fit for telemetry/integration documents, but collection ownership, indexes, retention and formal tenant model are not centrally documented | P0/P1 |
| Supabase | Private Storage adapter plus authenticated status route | No Postgres domain table, migration, RLS policy or backend table access is present in source; no browser database client is shipped | P0: verify cloud RLS/storage policies and environment separation before customer data |
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
- Browser configuration: no local `REACT_APP_SUPABASE_*` values were configured. The unused browser Supabase client was subsequently removed, so the current UI has no direct Supabase database transport.
- MongoDB: the configured database responded to a metadata-only ping and reported 205 collections. Only 22 had at least one non-`_id` index, while 183 had none. This is a scale/readiness risk to inventory and remediate by actual query pattern; it is not permission to bulk-create indexes blindly.
- Voice/YCM fleet administration: YCM credentials, fleet discovery and Cloud PBX claim operations are now global-scope actions. Restricted technicians are denied and audited before any integration data or client mapping is read or changed; assigned PBXs remain available through the client-scoped Voice workflows.

## Immediate recommendations

1. Treat formal tenant ownership and cross-tenant API tests as P0 before channel/multi-MSP production.
2. Audit the connected Supabase project: RLS, private artifact bucket policies, Auth settings, Realtime exposure, service-role access, backups and environment separation.
3. Inventory Mongo production indexes, collection validators, retention/TTL policies and restore evidence. Do not infer them from application code.
4. Add a small data-access boundary for new/refactored high-risk domains; do not mass-rewrite working routers.
5. Standardise event/job envelopes with `event_id`, schema version, tenant/client scope, correlation and idempotency.

## Targeted hardening evidence — 2026-08-21

The following targeted P0/P1 improvements have been completed without a data migration or router rewrite:

1. Canonical client graph and Fabric reads use masked record-scope checks, so a restricted technician cannot enumerate an out-of-scope client through a 403/404 difference.
2. Client 360 and Client War Room now apply router-level masked client ownership checks before loading aggregated operational, security, billing or AI-commentary data.
3. Client Studio applies a masked client boundary to client views, reserves portfolio-wide views for explicit global scope, intersects **My Accounts** with the technician client scope, and resolves stakeholder changes through the stored client owner.
4. Client Studio write actions now require stable action permissions and write central audit evidence with actor, client boundary, action and safe metadata.
5. Central audit-log review requires both explicit global scope and the `platform.audit.view` action permission. Measured audit-history indexes are ensured during boot for entity, client, ticket, actor, action and metadata-client timelines.
6. The read-only data-store audit now inventories MongoDB secondary/unique/TTL index metadata and schema-validator presence without reading documents or changing configuration.
7. The durable event backbone already provided versioned envelopes, idempotency, ordered integrity seals, bounded delivery retry and dead-letter handling. Its API boundary now resolves every published event to the authenticated tenant/client scope, rejects conflicting client or cross-tenant input, and reserves delivery/subscription/replay operations for explicitly global authorised operators. The older SSE compatibility stream and ticket-viewer notifications now apply the same client boundary, rather than broadcasting another customer's live operational activity.
8. Query-token PDF previews retain their separate browser-friendly transport but now verify the authenticated user is active and perform the same masked client-record scope check as a normal API read before rendering an invoice, estimate, contract or purchase order.
9. Client portal administration now uses dedicated action permissions for portal audit review, configuration changes, bearer-link lifecycle and portal-user lifecycle. Bearer links remain compatible with the existing portal flow, but their expiry is now validated and bounded to one to 365 days.
10. Technician identity validation now treats an explicit disabled, inactive, suspended, locked or revoked account state as immediate session revocation at both login and bearer-token verification. Legacy user records without an activity field remain compatible until they are formally migrated.
11. Technician profile updates no longer trust an arbitrary URL user ID. A technician can change only their own safe profile fields; staff-management changes require an administrator and each successful update writes activity evidence.
12. The frontend no longer ships an unused Supabase JavaScript client or browser-side Supabase environment variables. Artifact-storage status and all business data continue to flow through authenticated Nexus API routes, removing a dormant path that could otherwise be used to bypass the domain boundary later.
13. Legacy compatibility webhook administration now uses the same explicit global scope and action-permission boundary as governed platform operations. Both older management surfaces validate delivery endpoints using the event-backbone HTTPS policy, redact configured secrets from API responses, and preserve safe activity evidence for changes and live tests.
14. The older client-site administration route now scope-filters reads, validates the owning client before creation, prevents a site from being silently reassigned, requires an explicit site-management action for writes, and records each create, update and retirement in the activity ledger.
15. Legacy organisation-wide custom-field and on-call rotation creation routes now require explicit global scope plus a platform-configuration action, and write activity evidence rather than relying only on a signed-in session.
16. The public Xero callback now fails closed unless its server-only webhook key is configured, verifies Xero's HMAC signature over the original request body, and records provider event IDs in a Mongo-derived idempotency ledger before applying invoice payment state.
17. Both legacy Xero connection settings surfaces now redact OAuth and provider credentials from all responses, require an explicit global accounting-integration action for connection state, and record configuration changes in the activity ledger.

Focused regression coverage currently exercises these boundaries. This is not a substitute for the remaining authenticated, two-tenant end-to-end test programme or an independent penetration test.

## Targeted hardening evidence — 2026-08-22

1. Invoice deletion now requires the dedicated `billing.invoice.void` action and validates the stored invoice client before evaluating status or deleting. Foreign IDs are masked as `404`, including draft, issued and paid records, so a restricted technician cannot turn a guessed invoice ID into a cross-client destructive action.
2. Work Session and Voice Journal flows now keep ticket-linked device, time-entry and history reads inside the authorised ticket/client boundary. Completion retries return only the canonical time entry for the same authorised ticket and client; stale cross-client device pointers and Voice Journal history cannot disclose another client's operational context.
3. Ticket-linked agent commands, device lists and fan-out actions now resolve the ticket and every linked device through the same server-side client boundary. A foreign ticket is masked, and a stale cross-client ticket/device link is rejected before any command can be queued.
4. The isolated authenticated two-client API harness now executes successfully against a generated local MongoDB database and removes it afterward. Its first live run caught a production-relevant Ticket model mismatch (`client_logo_url` was persisted but undeclared), which is now part of the typed ticket contract.
5. Invoice financial mutations now use explicit source/target client scope, constrained status transitions and client-bound writes. Payment session state is bound to the invoice that created it; cross-client settlement remains a global-only operation; duplicate legacy Xero settings routes were removed rather than left as a second boundary.
6. Public payment links and Stripe settlement now form a separate capability boundary: public routes cannot mutate invoices directly, every initiation is bound to a Nexus-created transaction, and signed Stripe callbacks prove the existing transaction, invoice, currency and amount before an optimistic settlement update. Link expiry/revocation is checked at every public mutation, operator lists redact bearer/provider state, bank transfers require scoped confirmation, and payment retry state prevents a concurrent invoice update from becoming a false successful settlement.

## Targeted finance hardening evidence — 2026-08-24

This tranche closed verified legacy financial boundaries without a storage migration or a platform-wide rewrite:

1. Xero-mirror invoices, estimates, recurring templates, financial dashboards and integration history now distinguish client-scoped financial work from explicitly global accounting operations. Direct mutations use canonical client identity, action permissions and version/client-bound writes.
2. The legacy Billing Pro, Invoice Enhanced, Invoice Smart, Recurring Smart, product pricing, client price-book, billing dashboard and reconciliation surfaces now use explicit actions, client/global scope and auditable changes. Finance AI is scoped and receives minimised structural evidence only.
3. The customer portal checkout now reuses the payment-link reservation, deterministic provider idempotency and persisted settlement transaction boundary. Browser-supplied origin, currency, amount and retry keys cannot select a different payment.
4. Commercial-document template control is global-only and uses a per-document-type settings pointer; legacy template fields are compatibility projections, not the active-default authority.
5. Late-payment messages derive commercial facts from canonical invoice/payment records instead of request fields. PDF query-token routes now use canonical active-account, action and record-scope checks with no-store/no-referrer headers.
6. The isolated two-client API acceptance environment now proves a restricted billing-capable user can create/list only their own Xero-mirror financial record and sees only their client-scoped dashboard total. It passed against a generated local MongoDB database and removed that database afterward.
7. Invoice, estimate, contract and purchase-order browser PDF preview/download callers now use five-minute opaque, hash-stored document capabilities. Each capability is bound to one active actor, tenant/client/site, source record and delivery mode; a MongoDB TTL index retains only the short-lived capability evidence. Fresh download capabilities prevent a long-open preview from reusing an expired token. Legacy JWT URLs remain only for specialty template, theme and report preview families that do not yet have an equivalent object-bound capability contract.
8. Legacy Billing Pro warehouse, catalogue, stock and purchase-order operations are now explicitly organisation-global. Restricted client scopes fail closed; privileged operations carry action checks, version/CAS guards and compact activity evidence. Purchase-order receipt claims a transient receiving state before stock movement to stop duplicate stock increments.
9. Router auto-discovery now enforces a single owner for every HTTP method/path. Documented historical shadow routes are excluded without changing their currently live owner; new collisions fail application construction. OpenAPI now produces unique operation IDs.

Residual release work remains: a complete adversarial route matrix, browser E2E under distinct restricted roles, Stripe/Xero/email sandbox acceptance, object-bound capability contracts for the remaining specialty template/theme/report PDF families, and the broader formal tenant-ownership rollout. These controls reduce known exposure; they do not justify a claim of complete multi-tenant production readiness.
