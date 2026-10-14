# Nexus Web Studio fleet, Safe Update Engine & Technician Identity

Status: shipped 2026-10-08. This batch upgrades the existing Web Studio into a
WordPress operations cockpit and extends the existing technician settings API.
It is additive: the governed website record, the Synergy Wholesale connector and
the WordPress Application Password connection are all preserved.

## Repository audit (before the change)

Nexus already had, and this batch builds on rather than replaces:

- `backend/app/routers/web_studio.py` — `web_sites` records, Synergy Wholesale
  provider actions behind approval, an encrypted WordPress management
  connection and an approval-backed plugin/theme/core update request.
- `frontend/src/pages/WebStudioPage.jsx` — client-linked website portfolio with
  a WordPress management dialog.
- `backend/app/routers/user_settings.py` — the canonical per-technician
  `user_settings` document (profile, 2FA, notifications, working hours,
  display preferences).
- `frontend/src/pages/TechSettingsPage.jsx` — the technician settings
  workspace; `frontend/src/pages/TechProfilePage.jsx` — the technician profile.

There were no dedicated tests for either surface before this batch.

## What shipped

### 1. Fleet command centre (`GET /web-studio/fleet`)

One governed view of every scoped website: managed-website count, plugin
updates, recorded security findings, backup warnings, unreachable sites and an
attention queue with the reason behind each call.

Every figure is derived from evidence already stored on the website record. A
dimension that has never been assessed is returned with an explicit
`assessed` flag and rendered as "not assessed" rather than a reassuring zero.
Nexus does not invent a plugin update, a security finding or a backup time.

Attention levels are `critical`, `attention` and `healthy`, each with named
reasons (recorded findings, available updates, stale backup evidence,
unreachable site).

### 2. Plugin intelligence (`GET /web-studio/plugins`)

Aggregates the WordPress plugin inventory across the scoped fleet: sites
installed, sites active, sites with available updates, version distribution,
recorded security findings and compatibility metadata (required PHP, required
WordPress, tested-up-to). Rows are sorted worst first. A plugin is only called
vulnerable when a finding is recorded against it; premium-licence state reads
`unknown` until the licence register supplies evidence.

### 3. Safe Update Engine (`web_update_plans`)

A plan is a record, never an execution.

- `POST /web-studio/sites/{site_id}/update-plans` composes a plan from the
  current inventory with a deterministic **preflight** (WordPress connection,
  inventory freshness, fresh backup evidence, every target present in the
  inventory, PHP compatibility) and a deterministic **risk** assessment
  (core, version distance, recorded findings, PHP mismatch, untested against
  the site's WordPress version).
- `GET /web-studio/sites/{site_id}/update-plans` lists a site's plans.
- `POST /web-studio/update-plans/{id}/approve` re-runs preflight against
  current evidence and records an independent approval. A plan that failed
  preflight can never be approved.
- `POST /web-studio/update-plans/{id}/execute` queues an approved plan for the
  Nexus WordPress control worker and returns `awaiting_worker`. It never
  reports an update as applied.

Three update policies, safest first — `manual`, `assisted`, `policy_driven` —
decide who may act. Only policy-driven **and low risk** work may run without a
technician; anything else escalates.

The rule the brief insists on is enforced structurally: a green HTTP 200 is not
verification, and the plan state machine cannot reach `completed` without a
worker recording the verified result.

### 4. Technician Identity preferences

Two new sections of the canonical settings API:

- `GET/PUT /user-settings/web-studio` — default view, default update policy,
  attention-only filter, destructive-action confirmation, inventory refresh
  interval.
- `GET/PUT /user-settings/workspace` — landing route, table density, default
  page size, remote default view and personal shortcuts.

Both are validated against typed enums, drop unknown keys, and are versioned
with optimistic concurrency: a browser tab that sends a stale
`expected_version` is refused with `409` so one tab cannot silently overwrite
another. Stored against the technician identity, these preferences follow the
technician to any workstation.

Crucially, **a preference never grants a permission**. A crafted payload that
tries to set a role or permission is dropped and refused; the technician cannot
raise their own authority by editing profile fields.

The two surfaces are wired into `frontend/src/pages/TechSettingsPage.jsx`
("Web Studio" and "Workspace" sections) and the fleet command centre into
`frontend/src/pages/WebStudioPage.jsx`.

## Files changed

Backend:

- `backend/app/services/web_studio_fleet.py` (new) — pure fleet, plugin,
  preflight, risk and policy logic.
- `backend/app/routers/web_studio.py` — fleet, plugin-intelligence and
  Safe Update Engine endpoints; richer WordPress inventory (plugins + themes,
  normalised update counts).
- `backend/app/routers/user_settings.py` — Web Studio and workspace preference
  endpoints.

Frontend:

- `frontend/src/lib/webStudioFleet.js` (new) + `.test.js` — fleet tiles,
  attention queue, plugin rows, preflight/risk/plan copy.
- `frontend/src/pages/WebStudioPage.jsx` — fleet command centre, attention
  queue, plugin intelligence, Safe Update Engine panel, maintenance-safety
  fields.
- `frontend/src/pages/TechSettingsPage.jsx` — Web Studio and Workspace
  settings sections.

Docs: `docs/DATA_OWNERSHIP.md`, `docs/PLATFORM_PRIORITY_MAP.md`, this file.

## Security and reliability controls

- Every fleet, plugin and plan read and write re-checks client scope
  server-side (`assert_client_scope`, `assert_record_scope`, `scoped_query`).
- Plan creation and approval require the existing
  `synergy.wholesale.manage` action permission; approval is recorded through the
  existing approval workflow.
- WordPress Application Passwords stay encrypted on the website record and are
  never returned; the WordPress connector rejects non-HTTPS, private and
  reserved addresses (SSRF protection already in the module).
- Unknown preference keys are dropped; value enums, routes, page sizes and
  shortcut-conflict rules are validated on the server.
- Free-form evidence never becomes a fabricated number: unassessed dimensions
  are disclosed.

## Tests

- `backend/tests/test_web_studio_fleet.py` — 17 tests covering the pure policy
  and the router boundaries (fleet summary, plugin aggregation, preflight
  blocking, plan lifecycle, approval/execute).
- `backend/tests/test_technician_preferences.py` — 5 tests covering defaults,
  validation, optimistic concurrency and the privilege-escalation guard.
- `frontend/src/lib/webStudioFleet.test.js` — 11 tests covering tiles,
  attention ordering, plugin sorting, plan copy and risk tones.

## Remaining limitations

- **No live WordPress control worker.** Plans queue and stop at
  `awaiting_worker`; a real worker that performs the update and records the
  verified post-update state is the next step.
- **Backup and security evidence are recorded, not yet automatically
  harvested.** The fleet surfaces them when they exist; the Backup Center and
  security modules must write them onto `web_sites` to populate the counts.
- **Theming/theme inventory** is read from `/wp/v2/themes` when the connected
  WordPress user has the required capability, and is otherwise empty.
- **No browser UI verification** was possible in this environment; the unit
  tests, lint and route registration are the verification that ran.

## Deferred with named gates

| Concept | Gate before building |
|---|---|
| Visual Website Inspector (before/after screenshots, dynamic-content masking) | A screenshot capture worker + a private artifact store + viewport profiles |
| Staging/deployment workflows | A hosting connector that can clone a site, and a Git-backed source of truth |
| WooCommerce synthetic checkout | A sandbox payment method and a reversible test order contract |
| Git-backed custom development | A repository-per-site decision and a deployment pipeline |
| Lighthouse-class performance/SEO/accessibility diagnostics | An approved external runner (egress policy + rate limits) |
| Content Studio / customer content approval portal | A customer-facing approval surface and an audit contract |
| Website Time Machine, Site Migration, Site Blueprint, Incident Mode | Richer change evidence, a migration plan format and a blueprint schema |

## Recommended next phase

1. A Nexus WordPress control worker that performs an approved plan, verifies
   the result (site health, key pages, inventory diff) and only then records
   `completed`.
2. Write Backup Center and security-finding evidence onto `web_sites` so the
   fleet's backup-warning and security-finding counts move from unassessed to
   verified for every connected site.
3. The Visual Website Inspector foundation: capture a baseline on inventory
   sync, re-capture after an update, and store the diff for technician review.
