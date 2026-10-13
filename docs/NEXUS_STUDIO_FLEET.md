# Nexus Studio fleet

Last reviewed: 2026-10-13
Governed by: [Nexus Product Constitution](NEXUS_PRODUCT_CONSTITUTION.md) (capability admission gate, autonomy contract, Safety Kernel)
Status vocabulary and completion contract: [Nexus Master Capability Register](NEXUS_MASTER_CAPABILITY_REGISTER.md)
Machine source of truth: `backend/app/services/studio_registry.py` — this document is the human-readable plan that registry encodes.
Catalogue consolidation: [Nexus studio catalogue merge review](NEXUS_STUDIO_MERGE_REVIEW.md) — what each capability proposed by batches 2-5 became, encoded in `backend/app/services/studio_proposals.py`.

## What a Studio is

A Studio is one specialist operating surface over canonical Nexus objects. Studios are not
parallel products: each one is a registry entry plus an adapter to endpoints that already
enforce tenant and client scope. The fleet exists so that adding a domain is admission work,
not a new product with its own rules.

Three properties define every studio:

1. **One spine.** Every studio renders the same nine tabs (below). The tabs are the contract;
   studios differ only in which capabilities fill them.
2. **Admission first.** A studio becomes active implementation only after it passes the
   capability admission gate. Until then its status says `Discovery required` or
   `Architecture required` and it renders no wired tabs.
3. **Disclosed, never fabricated.** A tab whose capability is not registered renders the
   reason it is not wired. No studio shows inventory, health or success it did not observe.

## The spine — nine tabs

| # | Tab | Purpose |
|---|---|---|
| 1 | Overview | What this studio is: admission contract, provider contract state, honest status, live health when wired. |
| 2 | Inventory | Observed provider objects for this domain, with `observed_at`/source provenance. |
| 3 | Administration | Governed actions behind the canonical action descriptor, approval and verification. |
| 4 | Diagnostics | Read-only diagnosis and evidence-gathering for this domain. |
| 5 | Changes | Proposed and applied changes with approval, rollback and outcome evidence. |
| 6 | Automation | Registered recipes and workflows for this domain, with verification steps. |
| 7 | Security | Security posture, containment and policy signals for this domain. |
| 8 | Activity | Scoped platform events whose subjects belong to this studio, newest first. |
| 9 | Settings | Studio-scoped configuration and connection state. Never renders credentials. |

## Products — the navigation boundary

A Studio belongs to a **product**. Products are the navigation boundary, not a second product
line: Nexus presents a handful of major products and each holds the specialist studios and
workspaces that operate it, so 130 operational problems never become 130 navigation entries
([batch 5](NEXUS_INVENT_BATCH_5.md) records the decision and the catalogue it groups).

- **14 products hold the 130 studied studios** (~9:1). The declaration is `PRODUCTS` in
  `studio_registry.py`; a studio that does not name a declared product cannot be constructed
  at all, so a new capability extends an existing product by default and adding a fifteenth
  product is a deliberate, reviewable decision.
- Each product also carries `planned_studios`, and it is **derived, not hand-written**: it is
  exactly the `studio` dispositions filed under that product by
  `backend/app/services/studio_proposals.py`. A name there is a plan, never a capability claim
  — a planned studio is not implemented, tested or released by being listed. Every other
  catalogue idea leaves the plan and is recorded with the disposition that decided it: a
  `section` of a studio that already exists, a `merged` duplicate of another work item, an
  `extend` gap named against an existing surface, or a `served` capability with the file it
  lives in. A proposal that is not already served either names the gate blocking it or names
  the records it is a projection of; "later" is not a disposition.
- A gate is **decided, not restated**. Clearing one keeps its record and adds the artifact
  that cleared it (and the note explaining how), while a proposal still blocked by it must
  change disposition in the same change — so the register can show which gates are open
  without anyone remembering. `windows` and `endpoint-performance` left the plan that way on
  2026-10-12, when the `fleet-baseline` gate was cleared by
  `backend/app/services/fleet_baseline.py`. A gate can equally be *decided and left open*:
  `dependency-graph-provenance` was surveyed on the same day, and its record now says which
  half already exists in code and which half is a collection decision nobody has taken,
  instead of restating the capability (see the merge review).
- `GET /api/studios` serves `products`, `summary.by_product`, `product_note` and
  `proposal_note`, and each product also carries `proposals` and `proposal_count`, so the
  hub groups by that declaration rather than by its own idea of the layout and renders what
  each product is intended to hold alongside what it already has. A studio filed under an
  undeclared product is disclosed in an explicit ungrouped section rather than hidden.

Current products: `nexus-endpoint`, `nexus-infrastructure`, `nexus-recovery`, `nexus-shield`,
`nexus-identity`, `nexus-service`, `nexus-communications`, `nexus-knowledge`,
`nexus-automation`, `nexus-observability`, `nexus-commerce`, `nexus-growth`, `nexus-build`,
`nexus-platform`. Per-product membership is machine-served — read it from `GET /api/studios`
rather than duplicating it here.

## Studio contract laws

0. **Product-first.** Every studio belongs to exactly one declared product; a studio outside
   a product is a construction error.
1. **One spine.** Every studio renders all nine tabs in this order.
2. **Registry-first.** A studio exists in `studio_registry.py` before it exists in the UI.
3. **Admission first.** No tab wires before the studio's admission record is complete.
4. **Honest status.** Statuses come from the register's vocabulary, not from UI presence.
5. **Canonical objects only.** Studios operate on canonical Nexus objects behind existing
   scoped APIs; they never introduce a parallel store for their domain.
6. **Server-side scope.** Every read and write is tenant- and client-scoped on the server.
7. **Governed actions.** Mutations cross the Safety Kernel with permissions, approval,
   audit and idempotency — studio UI is never the authority.
8. **Provenance or nothing.** Live data comes only from the endpoint the tab contract
   names, rendered with its observation time; demo or cached rows are forbidden.
9. **Disclosed, never fabricated.** An unmeasured dimension is disclosed with its reason —
   never shown as a clean, healthy state.

## The capability admission gate

An admitted studio (status other than `Discovery required` / `Architecture required`) must
name every one of these fields in its registry admission record:

- customer problem and expected measurable outcome;
- canonical objects and provider contracts used;
- required permissions, tenant scopes, audit events and data-retention implications;
- verification, rollback and failure behaviour;
- commercial source of truth and billing effect where relevant;
- release gate, test plan, operator documentation and accountable owner.

The registry enforces the gate structurally: an unadmitted studio cannot declare a wired
tab — every non-Overview tab is forced to `discovery_required` or `architecture_required`
with the blocking status in its summary, and a studio whose status disagrees with its
admission record fails registry construction.

## Fleet roster (2026-10-13)

Statuses mirror the capability register. Per-tab wiring states are machine-served and are
**not** duplicated here — read them from `GET /api/studios`.

| Studio | Domain | Status | Priority | Release |
|---|---|---|---|---|
| customer-environment | Customer context | Partially implemented | P1 | R2 |
| operations-assurance | Assurance | Partially implemented | P1 | R2 |
| extension | Ecosystem | Partially implemented | P2 | R6 |
| web | Websites | Partially implemented | P1 | R2 |
| client | Clients | Partially implemented | P1 | R2 |
| lead | Sales | Partially implemented | P2 | R2 |
| remote | Remote access | Partially implemented | P0 | R1-R2 |
| proxmox | Virtualisation | Testing | P1 | R1-R2 |
| m365 | Microsoft 365 | Partially implemented | P1 | R2 |
| voice | Voice | Partially implemented | P1 | R3 |
| telecom | Telecom | Architecture required | P2 | R3 |
| devices | Endpoint estate | Partially implemented | P0 | R1-R2 |
| network | Network | Partially implemented | P2 | R4 |
| identity | Identity | Partially implemented | P1 | R2 |
| security | Security | Partially implemented | P1 | R4 |
| backup | Backup | Partially implemented | P0 | R1, R7 |
| cloud | Cloud | Discovery required | P2 | R3 |
| service-desk | Service desk | Partially implemented | P0 | R1-R2 |
| finance | Finance | Partially implemented | P0 | R1, R3 |
| documentation | Knowledge | Partially implemented | P1 | R2, R5 |
| automation | Automation | Partially implemented | P1 | R2, R5 |
| compliance | Compliance | Partially implemented | P1 | R4 |
| agent | Endpoint agent | Partially implemented | P0 | R1-R2 |
| patch | Patching | Partially implemented | P1 | R1-R2 |
| dns | DNS | Partially implemented | P2 | R4 |
| monitoring | Monitoring | Partially implemented | P0 | R1 |
| communications | Communications | Partially implemented | P1 | R2 |
| windows | Windows estate | Partially implemented | P1 | R2 |
| endpoint-performance | Endpoint performance | Partially implemented | P1 | R2 |

Wiring today: Overview is wired for every studio (its own admission record is the evidence).
Activity is subject-wired for the studios whose event subjects are admitted to the platform
catalogue. Proxmox additionally wires Inventory and live connection health and is the first
studio at `Testing`; its operating surface can reconcile that inventory from the provider's own
report (`POST /api/proxmox/servers/{server_id}/sync`, reached from the surface's action menu),
so the guests a technician can act on are the guests Proxmox reported, each carrying its
`source` and `observed_at`. The durable `proxmox-inventory` worker loop reconciles that same
projection on the platform's `proxmox_inventory_sync` schedule through the same single writer,
so the inventory stays current without an operator pressing sync; the surface states the
schedule it was told about (and says plainly when the schedule is switched off) rather than
letting the manual action be the only story. The three foundations added by
[Nexus foundation batch 4](NEXUS_FOUNDATIONS_BATCH_4.md) — Customer Environment,
Operations Assurance and Extension Studio — each wire the tabs their already-scoped endpoints
serve. Windows and Endpoint Performance wire Inventory and Diagnostics against the fleet
baseline projection and link their `home_route` at `/fleet-baseline?platform=windows` and
`/fleet-baseline?view=recurrence`; their Automation and Changes tabs stay unwired with the
reason, because acting on a deviation or raising work from a shape is not registered.
Adopting an existing projection is now the fleet's normal way to advance a studio, and thirteen
studios read one instead of keeping a second copy of it. Four did so first: Devices Studio's
Inventory is the canonical device record (`GET /api/devices`, archived records excluded), Agent
Studio's is the enrolled fleet the trust projection serves (`GET /api/nexus-agent/agents`, no
token or key material), Client Studio's is the account rollup the Clients workspace already reads
(`GET /api/clients-enriched`) and Backup Studio's is protected-workload evidence with its recorded
run outcome (`GET /api/backup-dashboard/overview`, where green is a recorded run, never a verified
restore). Nine more joined them by adopting the endpoint their own disclosure already named as
served:

| Studio | Inventory reads | What the tab refuses to overstate |
|---|---|---|
| M365 | `GET /api/m365/tenants` | tenant credentials and tokens are removed server-side, so this is a tenant register, not a consent or token-health view |
| Voice | `GET /api/yeastar/pbxs` | the provider secret is excluded, and the extension counts are the provider's rather than a Nexus recount |
| Web | `GET /api/web-studio/fleet` | each dimension carries its own `assessed` flag; an unassessed dimension prints that it was not assessed instead of a zero finding count |
| Network | `GET /api/networking/sites` | controller credentials are stripped, so this is a site register rather than a viable topology map |
| Patch | `GET /api/patch-compliance/overview` | compliance is `null` until something is assessed (never 0%), and the reported payload carries no CVSS severity, so the tab never labels a pending update critical |
| Security | `GET /api/security-dashboard/overview` | identity is reported as unmeasured because no identity source is configured, never as zero identity alerts |
| Documentation | `GET /api/documentation` | page bodies are deliberately not part of this projection, and freshness/confidence is stated as not yet assessed |
| Lead | `GET /api/leads` | no currency figure is rendered or summed, and the stage-weighting and forecast views stay in the Sales workspace |
| Communications | `GET /api/csat/dashboard` | the endpoint's zero-responses payload reads as "nobody answered", never as a satisfaction score of zero |

Adopting a projection is not a status promotion: all thirteen stay `Partially implemented` until
their own release gates clear, and each tab states that the projection is read, not re-counted —
which the registry records by putting the endpoint the tab reads into the tab's own summary.
Everything else discloses its state per tab with the reason.

A wired tab whose endpoint carries a path parameter declares its value in the tab's `params`
(`endpoint="/fleet-baseline/cohorts/{platform}/deviations", params={"platform": "windows"}`),
and `_tab` refuses a wired tab that leaves a placeholder unbound — as does the panel, which
requests nothing rather than repeating the unresolved path on a stale contract. The cohort a
studio grades against is therefore a registry decision — the surface cannot silently compare a Windows
endpoint with whichever cohort happened to be largest. Endpoint Performance reads the same
Windows cohort in its tab and discloses that it did, while its `home_route` lets a technician
switch cohorts on the full-estate page.

## Operating surfaces and API

- **`MSP Studios` — the navigation section** (`frontend/src/config/navigation.js`): the
  fleet's entry point from every other workspace, so a studio is reachable as a studio and
  not only through the hub. Each item resolves to a registered route — the studio's own
  operating surface where it has one (`/proxmox`, `/fleet-baseline?platform=windows`,
  `/fleet-baseline?view=recurrence`, `/customer-environment`, `/operations-assurance`,
  `/extension-studio`) and its page on the shared studio shell otherwise (`/studios/web`,
  `/studios/m365`). A studio whose capability is only proposed stays on `/studios`, which
  reports its admission gate honestly rather than presenting a plan as a delivered surface.
  `frontend/src/config/navigationRoutes.test.js` fails if a listed item stops resolving to a
  registered route or two items claim one path, so a menu entry cannot outlive the page it
  names.
- **`/studios` — Studio Fleet hub** (`frontend/src/pages/StudiosHubPage.jsx`): one listing,
  one status vocabulary, the shared spine, and links into each studio.
- **`/studios/:studioId` — studio detail on the shared shell**
  (`frontend/src/components/studios/StudioShell.jsx`): renders the nine tabs from the
  registry contract; wired tabs fetch their named endpoint, unwired tabs render the
  admission reason (`tab-unwired-*`). A tab whose endpoint answers one of the platform's
  projected questions is rendered by that question's own panel instead of as raw JSON: the
  fleet-baseline tabs render through
  `frontend/src/components/studios/FleetBaselinePanel.jsx`, which uses
  `frontend/src/components/fleet/FleetBaselineKit.jsx` — the same rendering rules and the
  same disclosures as `/fleet-baseline`, so the page and the studio cannot disagree about a
  deviation, an unmeasured metric or which cohort spoke. A studio that adopts a workspace
  projection renders through `frontend/src/components/studios/StudioObservationKit.jsx`,
  which maps the endpoint the contract names to that projection's panel — the thirteen above,
  as `DeviceEstatePanel.jsx`, `AgentFleetPanel.jsx`, `ClientEstatePanel.jsx`,
  `BackupRecoveryPanel.jsx`, `M365TenantPanel.jsx`, `VoiceEstatePanel.jsx`,
  `WebEstatePanel.jsx`, `NetworkSitesPanel.jsx`, `PatchPosturePanel.jsx`,
  `SecurityPosturePanel.jsx`, `LeadPipelinePanel.jsx`, `DocumentationInventoryPanel.jsx` and
  `CommunicationsPanel.jsx`. The kit is the honest half of that: a value the API did not report
  renders as an explicit "not reported" instead of a blank or a zero, an empty read is stated in
  that projection's own terms instead of looking like a clean estate, an unmeasured dimension is
  disclosed with its reason (a null percentage, an unconfigured identity source, a payload with
  no severity field), a declared path parameter the registry never bound requests nothing at all,
  and an endpoint no panel models falls through to the generic tab rather than being described by
  a panel whose fields do not match it.
- Existing operating surfaces (for example `/proxmox`, `/web-studio`) stay linked from a
  studio's card and Overview as the studio's `home_route` — the spine does not fork them.

Backend (`backend/app/routers/studio_fleet.py`, registered in `server.py`):

- `GET /api/studios` — every studio with status and per-tab states (authenticated).
- `GET /api/studios/{studio_id}` — one studio's full contract; `404 Unknown studio` for
  anything outside the registry.

The registry is static capability-contract code: no customer data and no secrets, so it
needs no tenant partition and no entry beyond the existing ones in
[DATA_OWNERSHIP](DATA_OWNERSHIP.md). Live data a tab renders always comes from that tab's
own scoped endpoint (for example `GET /api/proxmox/connection`, `GET /api/proxmox/nodes`,
`GET /api/fleet-baseline/contract`, `GET /api/devices`, `GET /api/nexus-agent/agents`,
`GET /api/events/platform/recent`), never from the registry. Adopting a projection creates no
new store: these tabs are reads over records another surface already owns, so they add no
entry to [DATA_OWNERSHIP](DATA_OWNERSHIP.md).

`backend/tests/test_studio_observations.py` holds the fleet to that: every wired tab's
declared endpoint (with the parameters the registry bound) must resolve to a mounted
operation, that operation must be guarded by an `app.auth` dependency, and every studio that
adopted a projection (thirteen today) must still name the endpoint and evidence it was admitted
against. It also reads `StudioObservationKit.jsx` and `StudioShell.jsx` to check the surface
agrees about which panel renders which projection — so wiring a tab to an endpoint no panel
models fails the suite instead of quietly degrading to raw JSON. The same suite reads each panel
to prove it renders through the shared kit: no panel fetches its own endpoint, and every panel
uses the kit's disclosure parts rather than a second implementation of them.

## Activity governance

A wired Activity tab names subject prefixes (for example `virtualization.`). The shell
fetches the server-side scoped recent-events window and keeps only events whose subject
matches one of the prefixes — other domains' events never appear under this studio, and an
empty window is shown as an empty observation, not as "nothing happened".

New subjects must be added to the governed `EVENT_SUBJECTS` catalogue in
`backend/app/services/platform_foundation.py` in the same change that emits them.

## Adding or advancing a studio

1. Write the admission record (all gate fields) or keep the studio honestly unadmitted.
2. Register the entry with `_studio(...)` in `studio_registry.py`, naming its `product`; status
   must match the admission state, and unadmitted studios declare no wired tabs. A wired tab
   names the endpoint it reads and declares `params` for every `{placeholder}` that endpoint
   carries — a tab that leaves one unbound is refused at import rather than rendering over a
   path no route answers. A capability
   that belongs to no existing product needs a product decision first — not a new studio. A
   capability that is not admitted yet does not get a studio entry at all: record it in
   `studio_proposals.py` with a disposition, the gate blocking it (or the records it is a
   projection of) and the batch that proposed it.
3. Wire a tab only to an endpoint that already enforces tenant/client scope, permission
   checks and audit; give Activity its subject prefixes.
4. Add/extend event subjects in the `EVENT_SUBJECTS` catalogue if the studio emits events.
5. Add tests: registry/API behaviour in `backend/tests/test_studio_fleet.py`; shell/hub
   behaviour in `frontend/src/pages/StudiosHubPage.test.jsx`.
6. Update this document's roster and the capability register row in the same change. A studio
   that is still a proposal belongs in `studio_proposals.py` as a `studio` disposition, which
   is what puts it in its product's derived `planned_studios` — never in the roster as if it
   were built. A proposal the consolidation turned into a section, a merge, an extension or a
   served capability is recorded there with that disposition instead, so it cannot reappear as
   a plan it has already been decided against.

Full worked example: [batch 5](NEXUS_INVENT_BATCH_5.md) classified 25 proposals into 14
products without registering a single new studio, because most were already sections of an
existing studio and the rest needed a persistence, tenancy or provider decision first. That
classification is now consolidated across batches 2-5 instead of asserted batch by batch:
112 catalogue ideas, each appearing exactly once with one disposition and, where it is not
already served, the named gate that blocks it — one datum, one owner, and no proposal left to
be found twice or not at all. See [Nexus studio catalogue merge review](NEXUS_STUDIO_MERGE_REVIEW.md).

## Verification

```bash
cd backend && JWT_SECRET=test-only-secret-that-is-long-and-random-enough \
  MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=nexusops-tests \
  python3 -m pytest tests/test_studio_fleet.py -q

cd frontend && CI=true npx craco test --watchAll=false \
  --testPathPattern="(StudiosHubPage|FleetBaselinePanel|navigationRoutes)"
```

The tests prove: the fleet loads with honest statuses; admission states match statuses;
unadmitted studios cannot declare wired tabs; the shell renders all nine tabs; planned
tabs disclose their reason; Activity filters to the studio's subjects; Inventory renders
observed rows only; a wired endpoint declares every parameter it carries and an unbound
placeholder is refused at registration; unknown studios 404 to a not-found state; every studio belongs to a
declared product and a studio outside one cannot be constructed; the product catalogue is
smaller than the fleet and holds each studio exactly once; `planned_studios` is derived and
holds only `studio` dispositions, none of which has a registry entry; every catalogue idea
from batches 2-5 is recorded exactly once, every `section` and `merged` target resolves, no
idea is covered twice, every cited file and every open gate exists, and an open gate that
blocks nothing is refused; a cleared gate cites evidence that exists, says what cleared it
and blocks no proposal, and the studios it unblocked are registered rather than planned; the
hub groups by product, disclosing an empty product, an unfiled studio and each product's
consolidated proposals instead of hiding any of them; and every studio named in the
`MSP Studios` navigation section resolves to a registered route, with no path claimed twice,
so the menu cannot point at a surface that no longer exists.

## What this document must not become

Not a second source of truth. Tab states, wiring counts and admission records live in the
registry and its API; if this document and the registry disagree, the registry is correct
and this document is the bug.
