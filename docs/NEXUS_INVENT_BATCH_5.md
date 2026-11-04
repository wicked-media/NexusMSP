# Nexus Invent — batch 5: technology control, application engineering and MSP growth

Last reviewed: 2026-10-12
Governed by: [Nexus Product Constitution](NEXUS_PRODUCT_CONSTITUTION.md) · [Studio fleet](NEXUS_STUDIO_FLEET.md) · [Master capability register](NEXUS_MASTER_CAPABILITY_REGISTER.md)
Predecessors: [batch 2](NEXUS_INVENT_BATCH_2.md) · [batch 3](NEXUS_INVENT_BATCH_3.md) · [batch 4 foundations](NEXUS_FOUNDATIONS_BATCH_4.md)
Consolidated by: [Catalogue merge review](NEXUS_STUDIO_MERGE_REVIEW.md) — the 25 proposals below are recorded once in `backend/app/services/studio_proposals.py`

This batch proposes studios **106–130** and answers the design question the brief
itself raises before proposing any of them: are these full products, specialist
workspaces or shared platform capabilities? Getting that wrong at 130 studios
produces a platform nobody can navigate.

The brief's instruction was explicit — *do not create 130 separate navigation
entries or backend services; build a smaller set of major Nexus products
containing specialised Studios and workspaces*. That instruction is now
structural, not prose: `backend/app/services/studio_registry.py` declares the
**products** and refuses to construct a studio that does not belong to one.

## The decision this batch makes

**14 products hold 130 studios.** Nexus presents major products; each holds the
specialist studios and workspaces that operate it. The ratio is ~9 studios per
product, and the two examples in the brief are the ones the registry pins in
tests:

| Product | Admitted studios today | Also holds (proposed) |
|---|---|---|
| **Nexus Endpoint** | devices, agent, patch, remote + Windows (108) and Endpoint Performance (111), admitted once the fleet-baseline gate was cleared | Apple (106), Linux (107), Browser Management (109), Peripheral (114), Update Compatibility (115) |
| **Nexus Infrastructure** | proxmox, network, cloud, dns | Connectivity Diagnostics (113) |
| **Nexus Recovery** | backup | Storage Recovery (112) |
| **Nexus Shield** | security, compliance | — |
| **Nexus Identity** | identity, m365 | Authentication (110) |
| **Nexus Service** | service-desk, customer-environment, operations-assurance | SLA (124), Dispatch (125) |
| **Nexus Communications** | voice, telecom, communications | — |
| **Nexus Knowledge** | documentation | — |
| **Nexus Automation** | automation | — |
| **Nexus Observability** | monitoring | Observability (118) |
| **Nexus Commerce** | finance | Quoting (122), Stockroom (126), Subscription (127), Customer Profitability (128) |
| **Nexus Growth** | client, lead | Sales Engineering (121), Customer Roadmap (123), Partner (129) |
| **Nexus Build** | web | DevOps (116), Application Runtime (117), Data Pipeline (119), Release (120) |
| **Nexus Platform** | extension | Marketplace Operations (130) |

Three rules the registry now enforces, each with a test:

1. **No studio exists outside a product.** `_studio(...)` requires `product=` and
   raises on an unknown one, so a new capability joins an existing product by
   default and creating a fifteenth product is a deliberate, reviewable decision
   rather than something that happens by accident.
2. **A proposal is never a capability claim.** Each product's `planned_studios`
   is derived from the consolidated catalogue register, so it holds only the
   proposals the consolidation left as a future studio. A proposal that became a
   section of a studio that already exists, a merge into a shared work item, or a
   named gap on an existing surface is not a plan and does not appear there. A
   proposed studio has no registry entry, so nothing can render it as shipped.
   (`planned_studios` also cannot collide with an admitted studio id; that is a
   construction error.)
3. **The taxonomy is one statement in one place.** `GET /api/studios` returns
   `products`, `summary.by_product`, `product_note` and `proposal_note`, and each
   product carries its `proposals` with the disposition the consolidation gave
   them; the `/studios` hub groups by the server's declaration rather than by its
   own idea of the layout, and a studio the server did not file under a declared
   product is disclosed in an explicit "not in a declared product" section rather
   than hidden.

### Shipped in this batch

| Surface | Path |
|---|---|
| Product taxonomy (declared, enforced) | `backend/app/services/studio_registry.py` (`PRODUCTS`, `product_catalogue()`, `PRODUCT_NOTE`) |
| API exposure | `GET /api/studios` → `products`, `summary.by_product`, `product_note`, per-studio `product`/`product_name` |
| Consolidated catalogue (derived plan) | `backend/app/services/studio_proposals.py` — one record per catalogue idea from batches 2–6, 61 named gates of which one (`fleet-baseline`) is recorded as cleared; `PRODUCTS[*].planned_studios` is derived from it (batch 5 shipped the register at 45 gates; [batch 6](NEXUS_INVENT_BATCH_6.md) extended it) |
| Fleet baseline projection (the cleared gate) | `backend/app/services/fleet_baseline.py`, `backend/app/routers/fleet_baseline.py` — `GET /api/fleet-baseline/contract`, `/cohorts/{platform}/deviations`, `/cohorts/{platform}/recurrence`; read-only, scoped, no new store |
| API exposure (extended) | `GET /api/studios` → per-product `proposals`, `proposal_count` and `proposal_note`, so a product shows what it plans and what was consolidated into existing capability |
| Hub grouping (pure) | `frontend/src/lib/studioProducts.js` |
| Hub | `frontend/src/pages/StudiosHubPage.jsx` (product sections, plan/empty/consolidation disclosures) |
| Studio operating surface for the cleared gate | `frontend/src/pages/FleetBaselinePage.jsx` (`/fleet-baseline`, the studios' `home_route`) |
| Diagnostics tab of both admitted studios | `frontend/src/components/studios/FleetBaselinePanel.jsx` + `frontend/src/components/fleet/FleetBaselineKit.jsx` — the deviation, recurrence and contract views rendered from the tab's declared endpoint, sharing one set of disclosure rules with the page; `studio_registry._tab` binds `params={"platform": "windows"}` and refuses a wired tab that leaves a `{placeholder}` unbound |
| Tests | `backend/tests/test_studio_fleet.py` (32), `backend/tests/test_fleet_baseline.py` (52), `frontend/src/lib/studioProducts.test.js` (12), `frontend/src/pages/StudiosHubPage.test.jsx` (15), `frontend/src/pages/FleetBaselinePage.test.jsx` (8), `frontend/src/components/studios/FleetBaselinePanel.test.jsx` (17) |

**No studio from 106–130 is built by this batch, and that is the finding, not an
omission.** The coverage table below is the reason: most of the 25 already exist
as specialised surfaces inside products that are admitted today, and the ones
that do not need a persistence, tenancy or provider decision *before* they need
code. Building them as 25 new studios would have produced exactly the
fragmentation the brief warns about.

Two of them have since been admitted, and not by this batch changing its mind:
the one gate it named for them — `fleet-baseline` — was decided and cleared on
2026-10-12, so 108 and 111 left the plan and entered the fleet as studios at
**Partially implemented** (see [the merge review](NEXUS_STUDIO_MERGE_REVIEW.md)).
That is the register working as designed: the capability waited on a decision, the
decision was made in code, and the record shows the artifact instead of the
intention. Neither is finished — Windows Studio is the Windows cohort view, and
macOS/Linux parity remains an open gate; Endpoint Performance counts the shapes it
sees and raises a **change request** from one rather than a ticket, through Change
Management, while choosing and applying a repair stays unbuilt.

## Studios 106–115 — infrastructure and technology control

| # | Studio | Kind | What already exists in this repository | Disposition |
|---|---|---|---|---|
| 106 | **Apple Studio** | Specialist workspace (Nexus Endpoint) | `routers/device_discovery.py`, `services/nexus_device_state.py` (declared-state checks incl. FileVault/BitLocker), `routers/patch_compliance.py`, `routers/application_manager.py`; the Go agent is Windows-mature | **Workspace, P2.** Apple/Windows/Linux are platform-scoped *views* inside Nexus Endpoint, sharing one agent, asset and policy infrastructure. Blocked on the master register's existing gate: agent macOS/Linux parity and signed release. ABM/Jamf ingestion is a provider integration on top. |
| 107 | **Linux Studio** | Specialist workspace (Nexus Endpoint) | `services/script_library_catalog.py` (Linux snippets), `routers/scripting.py`, `agent/cmd/nexus-agent/service_other.go` | **Workspace, P2.** Same parity gate as 106. "Safely execute verified repairs" is `script_library` + agent command approval, both of which exist — the honest blocker is evidence, not authority. |
| 108 | **Windows Studio** | Specialist workspace (Nexus Endpoint) | Agent inventory/commands/heartbeat, `routers/endpoint_security.py`, `routers/patch_compliance.py`, `services/agent_runtime.py`, `agent/internal/selfheal/learn.go` (per-endpoint learned baseline), `services/fleet_baseline.py` (the projection, added 2026-10-12) | **Workspace, P1, admitted 2026-10-12.** The brief's capability — *explain why a device differs from a healthy baseline* — was the one genuinely missing piece: a baseline existed **per endpoint**, and nothing compared a device against the fleet. That projection is now built (`GET /api/fleet-baseline/*`) over stored telemetry, so it needed no new store; the studio is registered as **Partially implemented** and the macOS/Linux views stay gated on agent platform parity. Its Automation tab raises a deviation as a change request (`services/fleet_change_proposal.py`); it executes nothing. |
| 109 | **Browser Management Studio** | Specialist workspace (Nexus Endpoint) | `services/nexus_device_state.py` (browser policy keys in declared state), `routers/shadow_it.py`, `routers/third_party_patching.py` | **Workspace, P2.** Configuration drift is already expressible as declared state. Extension inventory needs agent-side enumeration plus a retention/consent decision — the same shape as batch 3's Application Black Box gate. |
| 110 | **Authentication Studio** | Full capability (Nexus Identity) | `routers/microsoft_sso.py`, `routers/zero_trust.py`, `routers/identity_threats.py`, `services/m365_access_governance.py`, `routers/cipp.py` | **Deferred — provider integration.** *Reconstruct why an authentication attempt failed* needs identity-provider sign-in and Conditional Access ingestion, which is the **Authentication Journey gate** named in batches 2 and 3, unchanged. Nexus must not infer a denial reason it did not read. |
| 111 | **Endpoint Performance Studio** | Specialist workspace (Nexus Endpoint) | `agent/internal/selfheal/perf.go` (learned performance baseline), `routers/health_radar.py`, `routers/device_pulse.py`, `routers/nexus_pulse.py`, `routers/tech_performance.py`, `services/nexus_device_state.py`, `services/fleet_baseline.py` (recurrence, added 2026-10-12) | **Workspace, P1–P2, admitted 2026-10-12.** *Find recurring performance problems before tickets are raised* is the deviation shapes more than one endpoint in a cohort shares, counted from the same deviations 108 reads rather than duplicating them. Registered as **Partially implemented**: it names the shapes and raises one as a proposed change citing the shape's own basis, with a verification step and a rollback statement, approved through Change Management; choosing and applying a repair is not built. |
| 112 | **Storage Recovery Studio** | Specialist workspace (Nexus Recovery) | `services/nexus_backup*.py` (vault, leases, envelope, capture records), `services/nexus_rescue.py`, `routers/ups.py`, `routers/hardware_refresh.py`, `routers/asset_lifecycle.py`, `routers/nexus_backup.py` | **Workspace.** *Map storage faults to affected business services* needs array/RAID/snapshot evidence from a provider and the dependency chain — the same **Recovery Confidence Map gate** (restore-verification evidence per dependency chain) that batches 2–3 recorded. The UPS and hardware-half already produce the fault signal. |
| 113 | **Connectivity Diagnostics Studio** | Full capability (Nexus Infrastructure) | `routers/networking.py`, `routers/bandwidth_monitor.py`, `routers/dns_monitor.py`, `routers/unifi.py`, `routers/unifi_controllers.py`, `routers/topology.py` | **Deferred — observation capability.** *Compare network paths from multiple authorised observation points* needs an authorised probe at each point with its own access and rate policy. This is batch 3's DNS Propagation Lab gate in a different costume, and it is a network capability rather than a Nexus-internal join. |
| 114 | **Peripheral Studio** | Specialist workspace (Nexus Endpoint) | `services/nexus_device_state.py`, `routers/device_intel.py`, `routers/warranty_tracker.py`, `routers/assets.py` | **Workspace, P2, smallest honest slice.** Peripheral *policy* compliance (blocked USB, required drivers) is declared state today. Driver-compatibility correlation needs agent-side device inventory evidence first — no fabrication of a compatibility matrix Nexus cannot read. |
| 115 | **Update Compatibility Studio** | Specialist workspace (Nexus Endpoint) | `routers/application_manager.py`, `routers/third_party_patching.py`, `routers/patch_compliance.py`, `routers/deployment_hub.py`, `routers/hardware_refresh.py` | **Deferred on the dependency half.** The update half exists; *predict which devices need extra testing* needs the customer-specific application/hardware dependency map — the **relationship graph with provenance** gate from batch 2, unchanged. |

## Studios 116–120 — software and application engineering

| # | Studio | Kind | What already exists | Disposition |
|---|---|---|---|---|
| 116 | **DevOps Studio** | Full capability (Nexus Build) | `routers/git_scripts.py` (a two-endpoint script catalogue read — **not** repository/CI management), `routers/scripting.py`, `routers/deployment_hub.py` (Nexus's *own* Core/Edge/Vault/Relay provisioning), `services/webhook_security.py` (signed webhook verification) | **Deferred — provider integration + ownership decision.** GitHub/GitLab/Azure DevOps ingestion is the gate, and the incident→change link needs the relationship graph. Note honestly: `deployment_hub` is Nexus deploying itself, not customer CI/CD, so it is not evidence for this studio. Ranked High by the brief; the blocker is a provider integration and a `docs/DATA_OWNERSHIP.md` entry for deployment records, not a design question. |
| 117 | **Application Runtime Studio** | Specialist workspace (Nexus Build) | `routers/application_manager.py` (explicitly *does not* dispatch endpoint commands or call a package-management provider), `services/automation_runtime.py` (queues, workers, leases), `routers/workflow_automation.py` | **Deferred behind 116.** *Correlate application failures with infrastructure, database and deployment changes* needs the deployment record to correlate against. Queues and scheduled jobs are already Nexus-owned and observable. |
| 118 | **Observability Studio** | **Shared platform capability** (Nexus Observability) | `services/observability.py` (low-cardinality telemetry), the `observability/` stack (Prometheus, Tempo, Loki, Alertmanager, provisioned Grafana), `routers/alert_rules.py`, `routers/alert_suppression.py`, `services/event_backbone.py`, `routers/event_bus.py`, `routers/topology.py` | **High priority, and the batch's best foundations candidate — as a shared capability, not a customer studio.** *Assemble an evidence-backed explanation of a service degradation* is a projection over records Nexus already stores plus the alert/event streams, so it needs no new store. What it must not become: a fifth dashboard. The product boundary is deliberate — every other product consumes this evidence layer, so per-customer observability studios would fragment it. |
| 119 | **Data Pipeline Studio** | **Shared platform capability** (Nexus Build) | `routers/data_quality.py` ("scoped, non-persistent data-quality read model… never repairs records from the browser"), `services/data_quality_engine.py`, `services/event_backbone.py`, `routers/event_bus.py`, `routers/scheduled_reports.py` | **Partly shipped as a shared capability.** Duplicate/incomplete-record detection is the data-quality read model. The ETL/pipeline-run half needs integration ingestion and belongs in the same evidence layer as 118 rather than a separate workspace. |
| 120 | **Release Studio** | Specialist workspace (Nexus Build) | `routers/change_management.py`, `services/change_guardian.py`, `routers/change_freezes.py`, `routers/blueprints.py`, `services/web_studio_fleet.py`, `routers/nexus_proving_ground.py` (pre-rollout verification bench) | **Workspace over existing change machinery.** Approvals, verification kinds and rollback plans exist; the staged-deployment half arrives with 116. Do not build a second release engine beside Change Management. |

## Studios 121–130 — studios that help MSPs operate and grow

| # | Studio | Kind | What already exists | Disposition |
|---|---|---|---|---|
| 121 | **Sales Engineering Studio** | Specialist workspace (Nexus Growth) | `routers/qbr.py`, `routers/qbr_generator.py`, `routers/client_360.py`, `routers/benchmarking.py`, `routers/upsell.py`, `routers/roi_reports.py`, `routers/growth.py` — plus batch 4's Customer Environment projection | **Workspace, P2, no new store.** *An evidence-backed assessment of existing technology, gaps, risks and improvements* is exactly the shape of the Customer Environment foundation shipped in batch 4; this is the commercial framing of the same projection. |
| 122 | **Quoting Studio** | Specialist workspace (**Nexus Commerce**) | `routers/estimates.py`, `routers/pricing_calc.py`, `routers/commercial_documents.py`, `routers/products.py`, `routers/procurement_planner.py`, `services/procurement_integrity.py` | **Merge — do not build a second quoting engine.** The brief asks for it to share the commercial engine with Finance and Procurement, and it already does. The genuine gap is complex bundles, margins and approval thresholds on the existing estimate path. |
| 123 | **Customer Roadmap Studio** | Specialist workspace (Nexus Growth) | `routers/hardware_refresh.py`, `routers/asset_lifecycle.py`, `routers/asset_depreciation.py`, `routers/license_management.py`, `routers/contracts.py`, `routers/warranty_tracker.py` | **Buildable as a projection, Medium.** Lifecycle, warranty, licence and contract dates already exist to compute it from. One trap recorded: `services/product_roadmap.py` is **Nexus's own** product roadmap and must not be repurposed as a customer roadmap. |
| 124 | **SLA Studio** | Specialist workspace (Nexus Service) | `routers/sla_timer.py`, `routers/sla_penalties.py`, `routers/sla_report_gen.py`, `routers/escalation_matrix.py`, `routers/service_tiers.py`, `routers/maintenance_windows.py` | **Section of an existing studio, with one real gap.** The brief's requirement — *calculate deadlines from actual contract terms, not one global SLA timer* — is a contract-terms change: `contracts` owns the terms and the clock must read them, including calendars and exclusions. That is policy work in an existing store, not a new workspace. |
| 125 | **Dispatch Studio** | Specialist workspace (Nexus Service) | `routers/dispatch_board.py`, `routers/scheduling.py`, `routers/smart_scheduling.py`, `routers/field_enhanced.py`, `routers/geo_map.py`, `routers/on_call.py`, `routers/tech_roster.py`, `routers/work_sessions.py` | **Largely shipped — merge.** Visit allocation, travel and technician availability exist. The missing fields are the practical ones on the visit record: required equipment, access instructions, appointment confirmation. |
| 126 | **Stockroom Studio** | Specialist workspace (**Nexus Commerce**) | `routers/stocktake.py`, `routers/assets.py`, `routers/purchase_orders.py`, `routers/vendors.py`, `routers/warranty_tracker.py`, `routers/asset_lifecycle.py`, `routers/qr_assets.py`, `routers/rentals.py`, `routers/procurement_planner.py` | **Workspace, High priority — but a persistence decision comes first.** *A technician should know whether a replacement device is already available before buying another one* needs per-location stock (office, warehouse, vehicle, site) with serial tracking, reservations, transfers and reorder points. That is a new shared datum, so it requires an approved owner in `docs/DATA_OWNERSHIP.md` before code — one owner, labelled replicas if any. |
| 127 | **Subscription Studio** | Already-shipped workspace | `routers/service_subscriptions.py` — whose own contract is to "keep operational/provider quantities separate from commercial billing streams… without pretending that an unlinked provider quantity is already being billed" — plus `routers/recurring_invoices.py`, `routers/recurring_smart.py`, `routers/usage_billing.py`, `routers/license_management.py` | **Mostly shipped — merge.** The brief's key capability, *reconcile technical service state against billed quantities*, is what this read model already refuses to fake. Extend it; do not rebuild it. |
| 128 | **Customer Profitability Studio** | Specialist workspace (**Nexus Commerce**) | `routers/profitability_heatmap.py`, `routers/contract_profit.py`, `routers/cost_per_ticket.py`, `routers/client_budget.py`, `routers/billing_dashboard.py`, `routers/financial_reports.py`, `routers/tech_utilization.py`, `services/finance_integrity.py` | **Section of an existing studio.** The brief's requirement to *distinguish estimated costs from confirmed financial transactions* is the same honesty rule `finance_integrity` already applies — reuse it rather than inventing a second cost model. |
| 129 | **Partner Studio** | Full capability (Nexus Growth) — **tenancy decision first** | `routers/vendors.py`, `routers/vendor_scorecard.py`, `services/synergy_wholesale.py` (a distributor connector — a *supplier* integration, not a partner model) | **Deferred, Medium, blocked on a security decision.** *Delegated access to shared customer records* adds a fourth scope axis (partner → client → site) to a platform whose constitution requires server-side scope on every read and treats cross-tenant access as a release blocker. The gate is an approved, documented tenancy boundary plus an ownership decision — before any code. This is the batch's most security-sensitive proposal. |
| 130 | **Marketplace Operations Studio** | Specialist workspace (Nexus Platform) | `routers/integrations_overview.py`, `routers/integrations.py`, `routers/module_templates.py`, `routers/blueprints.py`, `routers/workflow_automation.py` (workflow marketplace), batch 4's Extension Studio (manifest review only) | **Complements Extension Studio; deferred behind the distribution gate.** Extension Studio reviews *packaging*; this is lifecycle (install, permissions, subscription billing, version compatibility, updates, publisher verification, health). Publisher verification needs a signing and trust model — the same gate batches 3 and 4 recorded ("who attests a publisher"), which is a security decision before a feature. |

## The three combinations the brief calls out

**1. Web Studio + DevOps + Release → Nexus Build.** The pieces that exist are the
website record (`services/web_studio_fleet.py`), governed change
(`change_management`, `change_guardian`, freezes), the pre-rollout verification
bench (`nexus_proving_ground`) and rollback plans. What does not exist is the
repository/CI provider integration, so the commit → build → staging → approve →
production chain is **one provider integration away, not one endpoint away**, and
it arrives with 116.

**2. RMM + Endpoint Performance + Observability → Nexus Endpoint + Nexus
Observability.** The endpoint half has a real learned per-endpoint performance
baseline in the agent. The observability half has the telemetry stack but not the
evidence join. This combination is the reason 118 is ranked first: it is the
substrate the other two consume.

**3. Sales Engineering + Roadmap + Quoting + Procurement → Nexus Growth + Nexus
Commerce.** Every input exists today — discovery records, lifecycle and warranty
dates, licence and contract terms, estimates, purchase orders. This is the
combination **closest to buildable with no new store**, and it is the
commercialisation path the brief describes: technical monitoring turned into a
measurable opportunity, without making a purchasing decision on the customer's
behalf.

## What I would prioritise, with the gate attached

| Priority | Studio | Gate before code |
|---|---|---|
| High | **Nexus Observability (118)** | None technical — it is a projection over stored records and the event/alert streams. Needs a scope decision: shared capability, not a per-customer studio. |
| High | **Nexus DevOps (116)** | GitHub/GitLab/Azure DevOps ingestion with sandbox acceptance, plus a `docs/DATA_OWNERSHIP.md` entry for deployment records. |
| High | **Nexus Stockroom (126)** | A persistence and ownership decision for per-location stock, serials, reservations and transfers. One owner, no replica in a second store. |
| Medium | **Nexus Customer Roadmap (123)** | None — a projection over lifecycle, licence, warranty and contract dates. `product_roadmap` must not be repurposed. |
| Medium | **Nexus Partner (129)** | An approved tenancy boundary for delegated partner access, with a security review, before any implementation. |

Until those gates open, this ranking is a strategy assessment, not a release plan.

## Why nothing was built here

This batch deliberately ships a taxonomy instead of studios. Three reasons, in
order of weight:

1. **Most of the 25 are sections of studios that already exist.** Quoting,
   Dispatch, Subscription and Profitability are substantially present; SLA and
   Endpoint Performance are present minus one real gap each. Building them as new
   studios would have created parallel owners for datums that already have one.
2. **The genuinely new capabilities need a decision first, not code.** Stockroom
   needs an owner for a new datum; Partner needs a tenancy boundary; DevOps needs
   a provider integration. The constitution's rule is that storage, tenancy and
   service boundaries are decided and documented before they are implemented.
3. **The brief's own instruction was to avoid fragmentation.** The cheapest way
   to honour it is to make "every studio belongs to a product" a construction
   rule in the registry, which is what this batch shipped — so the fragmentation
   cannot happen quietly later.

## Consolidated in the catalogue register

This batch's own finding was that most of the 25 already exist as specialised
surfaces and that the genuinely new ones need a decision before code. The merge
review turned that finding into data: `backend/app/services/studio_proposals.py`
holds **one record per catalogue idea from batches 2 to 6** — 104 records
against 61 named gates (60 open, one of which is recorded as cleared) over the
142 ideas those batches proposed — each with one disposition, and
`PRODUCTS[*].planned_studios` is
**derived** from it. Only a `studio` proposal lands in a product's plan;
everything else appears in that product's `proposals` on `GET /api/studios` and
is rendered by the hub, so a product cannot claim work it has decided not to do.
[The merge review](NEXUS_STUDIO_MERGE_REVIEW.md) is the decision record; the
register is the data.

Where this batch's proposals went:

| # | Batch 5 proposal | Recorded as |
|---|---|---|
| 106 | Apple | `apple` — studio (gate: agent platform parity) |
| 107 | Linux | `linux` — studio (gate: agent platform parity) |
| 108 | Windows | `windows` — **served** 2026-10-12: the fleet-baseline gate was cleared by `services/fleet_baseline.py` and the studio is admitted in the registry |
| 109 | Browser Management | `browser-management` — studio, merging batch 4's Browser |
| 110 | Authentication | `authentication` — studio, merging batch 3's Login Journey Recorder and batch 2's Authentication Journey |
| 111 | Endpoint Performance | `endpoint-performance` — **served** 2026-10-12: the same cleared gate, admitted reading the recurrence projection |
| 112 | Storage Recovery | `storage-recovery` — studio, merging batch 3's Recovery Confidence Map |
| 113 | Connectivity Diagnostics | `connectivity-diagnostics` — studio, merging batch 3's DNS Propagation Lab |
| 114 | Peripheral | `peripheral` — studio |
| 115 | Update Compatibility | `update-compatibility` — studio, merging batch 4's Software Deployment, batch 3's Update Compatibility Gate and batch 2's Update Autopsy |
| 116 | DevOps | `devops` — studio |
| 117 | Application Runtime | merged into `devops` |
| 118 | Observability | `observability` — studio |
| 119 | Data Pipeline | merged into `observability` |
| 120 | Release | `release` — extends `backend/app/routers/change_management.py` |
| 121 | Sales Engineering | `sales-engineering` — section of `customer-environment`, so it is filed under **Nexus Service**, not Nexus Growth as this batch placed it |
| 122 | Quoting | `quoting` — extends `backend/app/routers/estimates.py` |
| 123 | Customer Roadmap | `customer-roadmap` — studio, buildable with no gate |
| 124 | SLA | `sla` — section of `service-desk`, merging batch 4's Maintenance and batch 3's Smart Maintenance Window |
| 125 | Dispatch | `dispatch` — served by `backend/app/routers/dispatch_board.py` |
| 126 | Stockroom | `stockroom` — studio |
| 127 | Subscription | `subscription` — extends `backend/app/routers/service_subscriptions.py` |
| 128 | Customer Profitability | `customer-profitability` — section of `finance` |
| 129 | Partner | `partner` — studio |
| 130 | Marketplace Operations | `marketplace-operations` — studio |

Two consequences worth naming, because this batch's product tables above still
show the pre-consolidation plan. **Nexus Commerce** plans only `service-catalogue`
(batch 4) and `stockroom`: Quoting, Subscription and Customer Profitability are
recorded as an extension, an extension and a section of surfaces Commerce already
has. **Nexus Service** gains `sales-engineering` as a section of Customer
Environment, and **Nexus Endpoint** keeps the largest plan — eight proposed studios
now that Windows and Endpoint Performance have left it for the fleet, and the
honest count because Browser Management, Update Compatibility and the remaining
platform views are one work item each rather than three.

## Verification

- `backend/tests/test_studio_fleet.py` — 32 tests: the batch's 23 (16 existing
  plus 7 new) plus the consolidation's contract, which replaced the
  planned-studios pin, plus the cleared-gate contract, plus the wired-endpoint
  parameter guard. It proves: a wired tab declares a value for every
  `{placeholder}` its endpoint carries and an unbound one is refused at
  registration, so no tab can render over a path no route answers; every studio belongs to a declared
  product; a studio cannot exist outside one; the product catalogue is smaller
  than the fleet; every studio is held exactly once; `planned_studios` is derived
  from the register and holds only `studio` proposals, so nothing can render a
  proposal as shipped; every catalogue idea from batches 2–5 appears exactly once
  — as a record or as something a record covers — so the consolidation itself
  cannot drop one; every merge target resolves, every cited file exists, and no
  gate blocks nothing; Nexus Endpoint and Nexus Commerce hold the specialisations
  the brief names; a cleared gate cites evidence that exists, says what cleared it
  and blocks nothing, and the two studios it unblocked are registered rather than
  planned; `GET /api/studios` reports products, `by_product` counts, both
  notes and per-product proposals.
- `backend/tests/test_fleet_baseline.py` — **52 tests** for the projection that
  cleared the gate: a metric nobody reported stays `null` with its reason rather
  than `0`; a cohort below the minimum measured size has no baseline and grades
  nobody (`cohort_not_established`); a device with no reported metric is
  `not_measured`, never healthy; deviation verdicts follow the thresholds the
  contract discloses and name the median and the endpoints behind it; recurrence
  is counted from the same deviations the per-device view returns and needs two
  endpoints before a shape is shared; the routes are mounted behind
  authentication, the read is projected and bounded, and the tenant partition plus
  the caller's client scope are applied by the database query (an unassigned
  technician is scoped to no client, not to every client). It also builds each
  studio tab's path from that tab's own declaration — endpoint plus `params` — and
  asserts the result is a route this application serves, and that each
  Diagnostics tab names the cohort it grades against instead of taking whichever
  one is largest.
- `frontend/src/lib/studioProducts.test.js` — **12 tests**: declaration order,
  one filing per studio, ungrouped disclosure for an undeclared product, a
  declared-but-empty product rendered as a plan, graceful degradation when the
  payload carries no products, proposals counted as proposals, coverage counts,
  and the consolidation helpers — proposed versus consolidated counts, the target
  text for all five dispositions, gate titles falling back to the gate id rather
  than being invented, and a product payload with no `proposals` degrading to an
  empty catalogue.
- `frontend/src/components/studios/FleetBaselinePanel.test.jsx` — **17 tests**: a
declared parameter builds the request the tab names and an undeclared one stays
visible rather than resolving to guesswork, with the panel requesting nothing at
all for it and saying which value is missing; only a fleet-baseline question is
rendered by the panel; the Windows Studio Diagnostics tab reads
`/fleet-baseline/cohorts/windows/deviations` with no literal placeholder on the
wire and discloses the cohort it read; each deviation renders with its basis and
an unmeasured metric is listed rather than shown as clean; a metric nobody
reported is never `0`; a cohort too small to define a baseline grades nobody; a
cohort the API does not know is disclosed instead of shown as an empty estate;
the recurrence tab counts the endpoints sharing a shape and quotes its basis; the
contract tab discloses the thresholds and every cohort; a failed read states
the failure instead of rendering an empty, clean cohort; and the tab that raises a
shape as proposed work reads the bound cohort, shows the request with its
verification and rollback as a request rather than an applied repair, names the
change already open for a shape instead of proposing a second, and states an empty
result rather than rendering a clean panel.
- `frontend/src/pages/StudiosHubPage.test.jsx` — **15 tests**: the existing
  fleet/shell behaviours plus product sections in declaration order, the empty
  product disclosure, the "`n` studios · `m` proposed" line, the ungrouped
  disclosure, the header reporting products rather than a flattened wall, the
  consolidated count, the product's catalogue rendering with each disposition and
  the gate blocking it, a delivered proposal reading differently from a proposed
  studio, an older payload with no `proposals` rendering exactly the previous
  listing, and — through the shared spine — the Windows Studio Diagnostics tab
  rendering the deviation view for the cohort its registry entry bound, the
  Inventory tab rendering the cohort contract, and a fleet-baseline tab that
  cannot be read saying so rather than showing an empty cohort.
- `docs/NEXUS_STUDIO_FLEET.md`, `docs/NEXUS_MASTER_CAPABILITY_REGISTER.md` and
  `docs/DATA_OWNERSHIP.md` are updated in the same change.

A route existing is not implementation evidence (the register's own rule), so
every "what already exists" claim above cites a file, and no disposition claims
delivery.
