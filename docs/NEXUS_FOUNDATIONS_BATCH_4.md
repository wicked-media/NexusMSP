# Nexus foundation batch 4 — the 105-studio catalogue and the three foundations

Last reviewed: 2026-10-11
Governed by: [Nexus Product Constitution](NEXUS_PRODUCT_CONSTITUTION.md) · [Studio fleet](NEXUS_STUDIO_FLEET.md) · [Master capability register](NEXUS_MASTER_CAPABILITY_REGISTER.md)
Consolidated by: [Catalogue merge review](NEXUS_STUDIO_MERGE_REVIEW.md) — every row below is recorded once in `backend/app/services/studio_proposals.py`

This batch records studios 81–105 of the Nexus studio catalogue and ships the
three foundations the batch itself recommends building first:

* **Nexus Customer Environment Studio** — one customer's whole operating context.
* **Nexus Operations Assurance Studio** — did the promised outcome actually happen?
* **Nexus Extension Studio** — a governed way to add capability without editing core.

The batch's own instruction was explicit: *do not build another 25 independent
modules; build the foundations that make the other hundred easier to build,
operate and commercialise.* This document follows that instruction, and the same
discipline batch 2 and batch 3 used — **a named gate is a plan, an unnamed
"later" is not.**

Nothing here is a production claim. Each foundation's honest limitation is
stated below and in its own admission record in `studio_registry.py`.

## Shipped in this batch

All three are read-only or review-only. None introduces a store, and none claims
what it did not observe (see [DATA_OWNERSHIP](DATA_OWNERSHIP.md)).

### 1. Nexus Customer Environment Studio (`customer-environment`)

| Surface | Path |
|---|---|
| Policy (pure) | `backend/app/services/customer_environment.py` |
| Routes | `backend/app/routers/customer_environment.py` |
| Tests | `backend/tests/test_customer_environment.py` (22 cases) |
| Page + helpers | `frontend/src/pages/CustomerEnvironmentPage.jsx`, `frontend/src/lib/customerEnvironment.js` |
| Registry entry | `customer-environment` in `backend/app/services/studio_registry.py` |

The brief's key difference — *not merely links to other modules* — is met by
projecting records that already have an owner into one customer context:

* **Six disclosed dimensions** (devices, websites, services, open tickets,
  changes, alerts) grouped into the brief's **Health / Technology / Commercial**
  tabs, each carrying an `assessed` flag, its reason and its source.
* **Evidence signals** (website enquiry workflow, backup recovery test, Microsoft
  365 integration) reused from the assurance evaluators so a chip cannot disagree
  with the assurance report about the same evidence.
* **The correlation**, answering *"What changed in this customer's environment,
  and could any of those changes explain today's tickets?"*: a change that
  precedes an open ticket inside the window and shares a **stable Nexus
  identifier** becomes a candidate, `strong` when a target is shared and `weak`
  when only the customer is. Every candidate carries the ids, the timestamps and
  the basis sentence.

**Honest limitation, stated in the product and in the API:** a dimension that was
not measured returns `null` with its reason and renders as "Not measured", never
as `0`; environment health is `unknown` when nothing was measured, never
`healthy`; and a correlation is a *candidate*, never a claim of cause —
`INVESTIGATION_BOUNDARY` is returned verbatim so no UI can invent a stronger
statement. Correlation is also limited to what Nexus records: work held in
someone's head, or a change recorded without a target identifier, produces no
candidate — which is the correct answer rather than a guess.

### 2. Nexus Operations Assurance Studio (`operations-assurance`)

| Surface | Path |
|---|---|
| Policy (pure) | `backend/app/services/operations_assurance.py` |
| Routes | `backend/app/routers/operations_assurance.py` |
| Tests | `backend/tests/test_operations_assurance.py` (20 cases) |
| Page + helpers | `frontend/src/pages/OperationsAssurancePage.jsx`, `frontend/src/lib/operationsAssurance.js` |
| Registry entry | `operations-assurance` in `backend/app/services/studio_registry.py` |

Four promises are declared, each with the evidence that would prove it, and each
evaluated deterministically into `met` / `at_risk` / `breached` / `not_measured`:

| Commitment | Promise | Evidence source |
|---|---|---|
| `verified_recovery_point` | Every protected workload has a **verified** recovery point inside its agreed objective | `backup_jobs` |
| `website_enquiry_form` | Every critical website has a functionable enquiry form | `web_sites` |
| `departed_user_access_revoked` | Departed access is revoked inside the agreed timeframe | *not yet available — see the gate below* |
| `monitoring_reporting_window` | Every monitored endpoint reported inside its window | `nexus_agents` |

**Honest limitation:** Nexus never infers. `at_risk` is used where an obligation
is within 80% of its threshold or is unverified, rather than being rounded to
`met`; a commitment with no recorded evidence is `not_measured` **with its
reason** and is promoted to a dedicated "Unmeasured obligations" panel, because
an unmeasured obligation is the most important thing on the screen. The studio
reports on the collection being healthy, not on whether the job ran.

**Named gate for the fourth commitment:** Nexus has no authoritative offboarding
source today, so `departed_user_access_revoked` is deliberately *not wired* and
reports `not_measured` rather than being evaluated against a guess. The gate is a
recorded offboarding record (`user_id`, `left_at`, `revoked_at`,
`timeframe_hours`) with an owner and a retention rule.

### 3. Nexus Extension Studio (`extension`)

| Surface | Path |
|---|---|
| Policy (pure) | `backend/app/services/extension_studio.py` |
| Routes | `backend/app/routers/extension_studio.py` |
| Tests | `backend/tests/test_extension_studio.py` (25 cases) |
| Page + helpers | `frontend/src/pages/ExtensionStudioPage.jsx`, `frontend/src/lib/extensionStudio.js` |
| Registry entry | `extension` in `backend/app/services/studio_registry.py` |

An **extension is a manifest**, and the endpoint that matters is
`POST /api/extensions/validate` (permission `platform.configuration.manage`).
It runs ten disclosed checks and returns `approved` / `needs_review` /
`rejected`:

required fields present · API compatibility (`major` equal, `minor` at most) ·
governed kind · named non-wildcard permissions that exist in the action
catalogue · every declared capability resolvable against **the routes this Nexus
actually serves** (reusing Nexus Forge's route-grounded catalogue) · data classes
declared and never credential-shaped · an isolation plan · verification for
state-changing work · a rollback path (needs review when thin) · distribution
matching what Nexus can currently support.

**Honest limitation, and the whole point of the design:** this studio *reviews*.
It generates no code, signs nothing, deploys nothing, executes nothing, persists
nothing and grants no privilege — the response says so, and the page says so on
screen. An approval is a review outcome. An **unsigned `distributed` manifest is
refused**: signing infrastructure does not exist, so neither should the ability to
approve distribution.

**Named gates before any extension can be distributed or run:**

| Gate | Why it blocks |
|---|---|
| Signing infrastructure | A signature must attest *something*; there is no key custody, review authority or revocation story yet. |
| Review authority and liability model | Who reviews a partner-authored extension, and who is accountable when one causes harm, is an ownership decision before it is code. |
| Isolated execution | Sandbox provisioning, expiry and destruction evidence do not exist. Forge's `sandbox_plan` check is the design-time half only. |
| Marketplace distribution | Depends on all three above. |

## The catalogue: studios 81–105

Disposition of every idea in the batch. "Section" means the idea is a specialist
**section within an existing studio**, not a new fleet member — the brief asked
for Firewall inside Network Studio and Directory inside Identity Studio, and the
same reasoning applies where a studio already owns the domain.

### Specialist administration (81–90)

| # | Studio | Disposition | Gate or destination |
|---|---|---|---|
| 81 | Firewall | Section of **Network Studio** | Needs a firewall provider contract (policy/NAT/VPN objects, config backup, traffic diagnostics) with its own sandbox acceptance. |
| 82 | Directory | Section of **Identity Studio** | Needs AD forest/DC/replication/GPO evidence; this is the Authentication Journey gate from batch 2, unchanged — identity-provider and directory ingestion first. |
| 83 | File Services | Deferred | Needs SMB/NFS share, quota and ACL evidence. The differentiator — *"why can this user not open this folder"* — is verified effective-access evaluation, which is a provider integration, not a join. |
| 84 | Collaboration | Deferred | Needs SharePoint/OneDrive/Teams sharing and permission ingestion (Graph). Do not infer sharing state from a link. |
| 85 | Browser | Deferred | Needs a managed-browser policy and extension-inventory source per customer. |
| 86 | Software Deployment | Deferred, partly existing | Agent-side winget scan/apply (`agent/internal/appupdate`) and Patch Studio own half; the missing half is a **package/ring/dependency** model with preflight and verified results. |
| 87 | Remote Workforce | **Merge into existing `remote` studio** | VPN/VDI/remote-app diagnosis needs endpoint→application evidence; do not build a second remote product. |
| 88 | Certificate Trust | Deferred | Needs a certificate inventory plus service/binding/dependency relationships. First honest slice (expiry + dependent services) is a plausible Forge design today. |
| 89 | Time & Synchronisation | Deferred | Needs an NTP/time-source read. Correlating clock drift with auth and certificate failures needs that read plus timestamped failures. |
| 90 | Licensing Compliance | Deferred | Needs entitlements, assignments and vendor usage-rights data by contract — a commercial source of truth, and therefore an ownership decision first. |

### Advanced MSP operations (91–100)

| # | Studio | Disposition | Gate or destination |
|---|---|---|---|
| 91 | Problem Management | **Partially served by Customer Environment** | The per-customer half ("group the incidents, compare evidence, find the shared dependency") now exists as the correlation. The cross-customer problem *record* with root-cause hypotheses and permanent-fix progress is deferred: it needs a durable problem object spanning tickets and changes, plus an owner. |
| 92 | Service Catalogue | Deferred | The commercial and technical catalogue of what an MSP sells is a **commercial source of truth**. It must attach to contracts and billing, so it is an ownership decision plus a data-ownership entry before a studio. |
| 93 | **Customer Environment** | **Shipped** | Foundation 1. See above. |
| 94 | Service Activation | Deferred | Every stage needs an evidenced, recoverable execution state; that is the autonomy contract (P0 #6) plus per-service provisioning adapters. |
| 95 | Service Cancellation | Deferred | Deprovisioning, supplier cancellation, licence recovery and final reconciliation are **state-changing across domains**; each needs an audited, reversible action descriptor. |
| 96 | Escalation | Deferred | Needs external vendor case ingestion (per-vendor API or mailbox parsing) and an evidence package. A provider integration with its own sandbox acceptance, as batch 2 concluded for the Vendor Case Companion. |
| 97 | Maintenance | **Merge into existing `maintenance_windows`** | Window ownership already exists. Conflict and shared-dependency detection needs authoritative backup-job schedules and customer operating patterns — the Recovery Confidence Map gate. |
| 98 | Capacity Planning | **Partially served by Customer Environment** | The estate counts (devices, websites, services) are now disclosed per customer. Forecasting storage/compute/bandwidth/technician load needs usage time-series, and connecting a forecast to procurement needs the Quotes/procurement contract. |
| 99 | Customer Communication | **Already owned** | The `communications` studio plus `ticket.public_update.send` own client-linked outbound records with delivery evidence. Merge preferences and templates there; do not build a second comms product. |
| 100 | **Operations Assurance** | **Shipped** | Foundation 2. See above. |

### Platform capabilities (101–105)

| # | Studio | Disposition | Gate or destination |
|---|---|---|---|
| 101 | Decision Studio | Deferred | Comparing migration/upgrade/vendor options needs a cost, risk and dependency model with provenance (the relationship graph with provenance, batch 2's gate) and the Executive Cockpit's what-if primitive. |
| 102 | Runbook Studio | Deferred, partly existing | `runbooks` and the workflow runtime exist. Executable version-controlled procedures with approvals, branching, verification and rollback is a **runbook contract change** — and a runbook must propose a correction for review, never silently deviate. |
| 103 | Lab Studio | Deferred | Isolated environments with synthetic customer data need provisioning, isolation, expiry and destruction evidence. This is the same gate as batch 3's Phantom/Instant Lab. |
| 104 | Trust Studio | Deferred | Access reviews, attestations, data residency and subprocessor records are **assurance claims about Nexus itself**; they need an evidence model and a review cadence owner before a screen. |
| 105 | **Extension Studio** | **Shipped in part** | Foundation 3 — manifest review only. Signing, isolated execution and marketplace remain gated (see above). Nexus Forge composes a *design*; Extension Studio reviews the *packaging*. |

## The three foundations make the rest cheaper

The batch's long-term goal — *every new studio makes the existing studios more
intelligent* — is why these three were built first:

* **Customer Environment** gives every future studio a place to appear in
  context. A new domain becomes a dimension or a signal rather than a destination,
  and studio 91 (Problem Management) already starts from its correlation.
* **Operations Assurance** is the outcome layer every service studio reports up
  into. A studio that ships a capability can also declare the promise it fulfils.
* **Extension Studio** is how capability is added without touching core — the
  reason the remaining ~80 ideas do not each require a platform release.

## How this batch would be proven worth further investment

Recognition is cheap; the numbers are not:

1. **Correlation usefulness** — do technicians open a candidate and confirm it?
   A candidate list that is never actioned should be removed, not explained.
2. **Unmeasured obligations over time** — the count should fall as evidence
   sources are wired. A number that never moves means the panel is decorative.
3. **Manifest pass rate and version reuse** — if honest manifests mostly end
   `rejected`, the checks are too strict or the capability catalogue too thin,
   and that is the answer rather than a reason to quietly loosen the checks.
4. **Time to first contribution under Extension Studio** — the distance from a
   partner's idea to a reviewed manifest, measured, is the entire commercial
   claim.

Until those exist, treat the batch's ranking as a strategy assessment.

## Consolidated in the catalogue register

This batch's disposition table is the batch's own opinion, and it stands. What
changed is that the opinions from batches 2, 3, 4 and 5 now live in one
checkable place. `backend/app/services/studio_proposals.py` holds **one record
per catalogue idea from batches 2 to 5** — 74 records against 45 named gates —
and every record carries one disposition: `studio` (a gated future studio),
`section` (a section of a studio that already exists), `merged` (the same
capability under a second name), `extend` (a named gap on an existing surface),
or `served` (already delivered, with the file that proves it).

`PRODUCTS[*].planned_studios` is **derived from that register**: only a `studio`
proposal lands in a product's plan. Everything the consolidation turned into an
extension of something that already exists appears instead in that product's
`proposals` on `GET /api/studios`, and the `/studios` hub renders it, so a
product cannot claim work it has decided not to do.
[The merge review](NEXUS_STUDIO_MERGE_REVIEW.md) is the decision record; the
register is the data.

Where this batch's rows went:

| # | Batch 4 row | Recorded as |
|---|---|---|
| 81 | Firewall | `firewall` — section of `network` |
| 82 | Directory | `directory` — section of `identity` |
| 83 | File Services | `file-services` — studio |
| 84 | Collaboration | `collaboration` — studio |
| 85 | Browser | merged into `browser-management` (batch 5) |
| 86 | Software Deployment | merged into `update-compatibility` (batch 5) |
| 87 | Remote Workforce | `remote-workforce` — section of `remote` |
| 88 | Certificate Trust | `certificate-trust` — studio, absorbing batch 3's Certificate Detective |
| 89 | Time & Synchronisation | `time-sync` — studio |
| 90 | Licensing Compliance | `licensing-compliance` — extends `backend/app/routers/license_management.py` |
| 91 | Problem Management | `problem-management` — studio; the per-customer half already shipped as the correlation |
| 92 | Service Catalogue | `service-catalogue` — studio |
| 93 | Customer Environment | `customer-environment` — served |
| 94 | Service Activation | `service-activation` — studio, absorbing 95 |
| 95 | Service Cancellation | merged into `service-activation` |
| 96 | Escalation | `escalation` — extends `backend/app/routers/escalation_matrix.py`, absorbing batch 2's Vendor Case Companion and batch 3's Vendor Escalation Tracker |
| 97 | Maintenance | merged into `sla` (batch 5, a section of `service-desk`) |
| 98 | Capacity Planning | `capacity-planning` — studio |
| 99 | Customer Communication | `customer-communication` — served by `backend/app/routers/ticket_email_notifications.py` |
| 100 | Operations Assurance | `operations-assurance` — served |
| 101 | Decision | `decision` — studio |
| 102 | Runbook | `runbook` — extends `backend/app/routers/runbooks.py`, absorbing batch 3's Live Runbook |
| 103 | Lab | `lab` — studio, absorbing batch 3's Instant Lab, Technician Sandbox and Safe Experiment |
| 104 | Trust | `trust` — studio |
| 105 | Extension | `extension` — served, manifest review only |

The one disposition this batch did not anticipate is `extend`: a capability whose
surface already exists and whose remaining gap is a field, a policy or a
provider read rather than a studio. That is the honest outcome for Licensing
Compliance, Escalation and Runbook, and it is why the fleet does not grow by
three.

## Verification

```bash
cd backend && JWT_SECRET=test-only-secret-that-is-long-and-random-enough \
  MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=nexusops-tests \
  python3 -m pytest tests/test_customer_environment.py tests/test_operations_assurance.py \
    tests/test_extension_studio.py tests/test_studio_fleet.py -q
python3 -m flake8 app server.py worker.py
python3 scripts/run_unit_tests.py

cd frontend && CI=true npx craco test --watchAll=false \
  --testPathPattern="customerEnvironment|operationsAssurance|extensionStudio"
npx eslint src --ext .js,.jsx
```

Evidence at the time of this revision: 99 focused backend tests pass (22 + 20 + 25
+ 32 fleet), the full backend unit gate passes at **2314 passed / 1 skipped**,
`flake8 app server.py worker.py` is clean, 40 focused frontend tests pass, and the
frontend lint run is clean.

The fleet tests additionally prove the three studios obey the shared contract:
the full nine-tab spine, admission states matching statuses, wired tabs naming the
endpoint they read, Activity subjects resolving to governed platform subjects, and
every cited permission resolving in the action catalogue.
