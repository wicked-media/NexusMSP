# Nexus studio merge review — what happened to every proposed capability

Last reviewed: 2026-10-13
Governed by: [Nexus Product Constitution](NEXUS_PRODUCT_CONSTITUTION.md) · [Studio fleet](NEXUS_STUDIO_FLEET.md) · [Master capability register](NEXUS_MASTER_CAPABILITY_REGISTER.md)
Sources consolidated: [batch 2](NEXUS_INVENT_BATCH_2.md) · [batch 3](NEXUS_INVENT_BATCH_3.md) · [batch 4 foundations](NEXUS_FOUNDATIONS_BATCH_4.md) · [batch 5](NEXUS_INVENT_BATCH_5.md) · [batch 6](NEXUS_INVENT_BATCH_6.md)
Register: `backend/app/services/studio_proposals.py`

Batches 2 to 6 proposed **142** operational ideas between them: catalogue numbers
81–105 (batch 4), 106–130 (batch 5), 156–185 (batch 6), and the deferred lists
batch 2 and batch 3 recorded instead of building. Each of the first four batches
wrote its own documents and none of them cross-referenced another's list, so the
same capability appeared several times under several names. Batch 6 arrived the
other way round — as a portfolio batch written *about* the catalogue — and its 30
ideas were filed into the fourteen products that already exist rather than adding
a fifteenth. This document is the consolidation record; the register above is the
machine-checkable form of it.

## The problem this settles

The duplication was invisible in prose because it never appeared in one place:

| Capability | Names it arrived under | Batches |
|---|---|---|
| Managed browser policy + extension inventory | Browser, Browser Management | 4 #85, 5 #109 |
| Package/ring/dependency preflight for updates | Software Deployment, Update Compatibility, Update Compatibility Gate, Update Autopsy | 4 #86, 5 #115, 3, 2 |
| Recoverability proved by a restore test | Recovery Confidence Map, Storage Recovery | 3, 5 #112 |
| Why an authentication attempt failed | Directory, Authentication Journey, Login Journey Recorder, Authentication | 4 #82, 2, 3, 5 #110 |
| Certificate expiry plus its dependents | Certificate Trust, Certificate Detective | 4 #88, 3 |
| Deadlines computed from contract terms | Maintenance, SLA, Smart Maintenance Window | 4 #97, 5 #124, 3 |
| What an MSP sells, attached to contracts and billing | Licensing Compliance, Service Catalogue, Quoting, Subscription | 4 #90, 4 #92, 5 #122, 5 #127 |
| Vendor case status and evidence | Escalation, Vendor Escalation Tracker, Vendor Case Companion | 4 #96, 3, 2 |
| Disposable isolated environments | Lab, Instant Lab, Technician Sandbox, Safe Experiment | 4 #103, 3, 3, 3 |
| Executable, versioned procedures | Runbook, Live Runbook | 4 #102, 3 |
| Deployment records and CI/CD | DevOps, Application Runtime, Release | 5 #116, #117, #120 |
| A dependency graph with provenance | Ten batch-2 concepts, plus five capabilities that cite it as a gate | 2, 3, 4, 5 |

Left alone, each pair would have become two owners for one datum — the outcome
`docs/NEXUS_PRODUCT_CONSTITUTION.md` exists to prevent, and the failure
`docs/NEXUS_INVENT_BATCH_5.md` names when it warns against 130 navigation entries.

## The result

**142 catalogue ideas became 104 records.** Every idea appears exactly once.

| Disposition | Records | Meaning |
|---|---|---|
| `studio` | 68 | A real capability that does not exist yet. Filed under a product and counted in its `planned_studios`. |
| `section` | 10 | A specialist section inside a studio that is already registered, which owns the domain. |
| `merged` | 2 | The same capability as another record, under a second name. |
| `extend` | 14 | An existing non-studio surface owns it; what remains is a named gap on that surface. |
| `served` | 10 | Already delivered. |

Two of the 70 plan records have since left the plan by the route this document
intends: **Windows Studio and Endpoint Performance Studio were blocked by one gate
that was then decided** (see below), so they are `served` rather than `studio` and
the roster they entered is 29 studios, not 27.

42 of the 142 names are now `covers` of the record that owns the idea, so a
proposal cannot quietly disappear into a merge — the register names what each
record absorbed.

Two rules make the vocabulary more than a label:

1. **A proposal that is not already served names what blocks it or what feeds
   it.** Either a gate (`gates`, with the blocking reason and the batch that
   recorded it, in `GATES`) or the records it is a projection of
   (`buildable_from`). "Later" is not a disposition.
2. **A gate nobody is blocked by is not a plan.** Every *open* gate in `GATES`
   must be referenced, every referenced gate must exist, and a cited file must
   exist on disk. `studio_proposals.validate()` enforces that — and it runs at
   import time from `studio_registry`, so an inconsistent catalogue fails the
   process that imports it rather than a screen that renders it.
3. **A cleared gate is kept, and has to prove itself.** Opening a gate deletes
   nothing: the gate keeps the reason it existed and gains a `cleared_by` path and
   a `cleared_note`, while a proposal blocked by it has to change disposition in
   the same edit. `validate()` refuses a cleared gate that cites a file which does
   not exist, that says nothing about what cleared it, or that any proposal is
   still blocked by — so "the gate is open" is a checkable claim about the code,
   not a sentence in a document.

## The first gate that was decided

`docs/NEXUS_PRODUCT_CONSTITUTION.md` requires a storage, tenancy or provider
decision to be made *and documented* before the code, and the point of a gate is
that it gets decided rather than restated. The first one has been:

| Gate | Blocked | Cleared | What cleared it |
|---|---|---|---|
| `fleet-baseline` — *a healthy baseline exists per endpoint; nothing compares a device against the fleet* | Windows Studio (batch 5 #108), Endpoint Performance Studio (batch 5 #111) | 2026-10-12 | `backend/app/services/fleet_baseline.py` + `backend/app/routers/fleet_baseline.py` |

The projection reads records Nexus already stores — the usage metrics the agent
reports on the device record and the learned self-heal performance band it keeps
per endpoint — and adds no collection, so the gate was a projection to build
rather than a persistence decision to approve:

- `GET /api/fleet-baseline/contract` — the caller's own scoped cohorts, the metric
  list, the minimum cohort size and the deviation thresholds, disclosed so a
  verdict can be reproduced by hand rather than trusted;
- `GET /api/fleet-baseline/cohorts/{platform}/deviations` — each endpoint against
  its cohort's measured median, with the median, the delta, the basis and how many
  endpoints were measured;
- `GET /api/fleet-baseline/cohorts/{platform}/recurrence` — deviation shapes
  shared by two or more endpoints, counted from the same deviations the per-device
  view returns, so the two cannot tell different stories.

It is read-only, tenant- and client/site-scoped through the database query, and an
unmeasured metric is `null` with its reason rather than `0`. Two things it is not:
a cohort below the minimum measured size returns `cohort_not_established` instead
of grading anyone against a number that means nothing, and a deviation is a
difference from the estate's own median rather than a fault.

Both studios left the plan and entered the roster in the same change
(`backend/app/services/studio_registry.py`), both at **Partially implemented**,
because that is what they are:

- **Windows Studio** is the Windows cohort view. The macOS and Linux views it
  would extend to are still blocked, and that gate (`agent-platform-parity`)
  remains open and named.
- **Endpoint Performance Studio** reports the recurring shapes and raises one as a
  proposed change (`backend/app/services/fleet_change_proposal.py`). Choosing and
  executing a repair recipe is still not registered, and the register says so per
  tab rather than implying it.

That is the shape this document wants every gate decision to take: the blocker
decided, the artifact cited, both proposals moved, and the two studios admitted
with the limits they still carry written down. Neither studio claims more than it
does — nothing raises a ticket from a recurring shape, and nothing repairs an
endpoint; raising the change *request* is the only work either studio starts.

## The second gate: decided, not cleared

`dependency-graph-provenance` is the gate behind ten batch-2 concepts, all filed
under `dependency-map`: Fix Fallout, Repair Side-Effect Map, Ticket Collision
Detector, Work Collision Forecast, Reboot Negotiator, Service Dependency Doctor,
Invisible Dependency Hunter, Network Path Memory, Driver Compatibility Radar and
Software Conflict Investigator. It was **surveyed on 2026-10-12 rather than
restated**, and the survey changed what the gate says:

| Question | Answer |
|---|---|
| Does an edge carry provenance? | Yes. `backend/app/services/core_relationships.py` stores, per edge, the relation type, the source record (`source.collection` / `source.id`) and the evidence that asserted it; an approved `context_relationships` edge additionally records who recorded it, under which decision and when. |
| Is there change-time attribution? | Partly. The assertion evidence names the field or record that produced the edge, and the approved-context edge records its decision and author. `nexus_objects.build_object_story` already refuses to read timeline proximity as causation, and says so in the story it returns. |
| Is there a *dependency* graph? | No. The canonical relation types are ownership and commercial ones — `client.owns`, `site.contains`, `user.uses`, `service.governed_by`, `integration.provides`, `ticket.concerns`, `project.includes`, `invoice.bills`, `documentation.describes`, `context.explains`. Nothing says which endpoint depends on which service, share, driver or other asset. |
| Can a projection build it? | No. A dependency edge is not derivable from records Nexus already holds; it has to be collected (agent, SNMP or provider discovery) and then owned by one authoritative writer, which is a persistence decision rather than a read. |

So the gate is **decided and left open**: what blocks these ten concepts is the
dependency half, not provenance, and the gate's own `blocking_reason` now says so
(`backend/app/services/studio_proposals.py`). The honest outcome is an open gate
with a precise reason — the alternative would be to clear it by claiming a graph
Nexus cannot collect, which is the failure mode every other gate in this document
exists to prevent. The ten proposals stay `studio` records blocked by it.

What would decide it instead: a recorded ownership decision for an authoritative
dependency-edge model, plus the collection that would author those edges. Until
then, every one of the ten would infer a consequence from timing alone, which
batch 2 itself rules out.

## Batch 6: the batch that arrived about the catalogue

Batches 2–5 wrote capability lists and this document consolidated them afterwards.
Batch 6 was written the other way round: it is a **portfolio** batch — business
communications, data protection and physical infrastructure — that names 30
capabilities against the products and tiers the fleet already has, so its 30 ideas
were filed into the existing fourteen products and no fifteenth product was
proposed. It is also the first batch that needed no `covers` entry at all: nothing
it proposed duplicated a record an earlier batch had already filed, so all 30 ideas
are records in their own right rather than names absorbed by someone else's.

Its dispositions are deliberately mixed, and that mix is the point the batch makes
about the catalogue as a whole:

| Idea | Disposition | Owner |
|---|---|---|
| Voice Quality Studio (162) | `section` | the registered `voice` studio — jitter, latency and MOS are a view over the call path Voice Studio already owns |
| Data Recovery Studio (175) | `section` | the registered `backup` studio — file-level recovery is Backup Studio's own restore surface |
| Reception Studio (165) | `extend` | `backend/app/routers/voice_service_desk.py` — call answering already produces a service-desk record |
| Threat Exposure Studio (172) | `extend` | `backend/app/routers/nexus_exposure.py` — what remains is internet-facing discovery, which is a gate rather than a second exposure workspace |
| Identity Threat Studio (174) | `extend` | `backend/app/routers/identity_threats.py` — an investigation gap on a surface that exists |
| Kiosk Studio (181) | `extend` | `backend/app/routers/kiosk.py` — a tokenised kiosk surface ships; managing the terminal fleet is the gap |
| the other 24 ideas | `studio` | a product each, with the gate named below |

Sixteen new gates record what blocks the plans, and one of them decides five
studios at once: **`data-classification-model`** — a declared
classification-and-retention model with a named owner — blocks `data-governance`,
`data-loss-prevention`, `ediscovery`, `privacy-operations` and
`messaging-compliance`, because all five measure something against a policy that
does not exist yet. The rest are provider contracts and collection boundaries:
`carrier-call-path-evidence`, `messaging-carrier-contract`,
`meeting-quality-evidence`, `carrier-number-ownership`,
`key-management-integration`, `secret-provider-integration`, `sbom-ingestion`,
`power-placement-and-runtime-model`, `passive-infrastructure-inventory`,
`facility-sensor-feed`, `kiosk-public-device-inventory`,
`laboratory-equipment-monitoring-consent`, `media-pipeline-inventory`,
`satellite-provider-contract` and `edge-node-inventory`. Two decisions are recorded
in the gate text itself rather than left implied: **Secrets Studio integrates
established secret managers** instead of becoming a vault, and **Encryption Studio
reads the customer's key-management provider** rather than making Nexus the key
authority.

What batch 6 did **not** do matters as much as what it did: it built nothing,
cleared no gate, and admitted no studio. Every one of its 30 ideas is a plan with an
owner, a product, a tier and a blocker — exactly the register state this document
exists to keep honest. What did change outside the register is how the catalogue is
reached: the `MSP Studios` navigation section became **Market Place** with one
searchable catalogue instead of a sidebar link per studio, because a fleet of 185+
numbered studios is a catalogue to search rather than a menu to scroll.

## Clusters that collapsed into one record

These are the merges that changed a batch's own conclusion. A merge here is a
single owner, not a smaller ambition.

| Cluster | Record | Absorbs | Why one record |
|---|---|---|---|
| Managed browser | `browser-management` (studio, Endpoint) | Browser (4 #85) | One object — managed-browser policy plus extension inventory — and one blocker: agent enumeration with a retention/consent policy. |
| Update preflight | `update-compatibility` (studio, Endpoint) | Software Deployment (4 #86), Update Compatibility Gate (3), Update Autopsy (2) | Four names for package/ring/dependency preflight. The apply half already ships: the agent's app-update path and Patch Studio. |
| Recovery proved | `storage-recovery` (studio, Recovery) | Recovery Confidence Map (3) | One projection. A green backup job proves a job ran; both names needed a recorded restore test per dependency chain. |
| Authentication | `authentication` (studio, Identity) | Login Journey Recorder (3), Authentication Journey (2) | One gate, unchanged across three batches: Nexus must not infer a denial reason it did not read. Directory (4 #82) is the section of Identity Studio that ingests the directory half. |
| Certificates | `certificate-trust` (studio, Shield) | Certificate Detective (3) | Expiry plus the dependent services a renewal can break. One inventory, one graph. |
| Deadline clock | `sla` (section of `service-desk`) | Maintenance (4 #97), Smart Maintenance Window (3) | Policy work in stores that already exist: the clock must read contract terms, calendars and exclusions, and window impact needs authoritative backup schedules. |
| Commercial source of truth | `service-catalogue` (studio, Commerce) with `licensing-compliance`, `quoting`, `subscription` extending `license_management.py`, `estimates.py`, `service_subscriptions.py` | Licensing Compliance (4 #90), Quoting (5 #122), Subscription (5 #127) | Four names for entitlements, assignments and vendor usage rights by contract. It is one owned datum attached to contracts and billing, so one gate (`commercial-source-of-truth`) blocks all four — and three of them extend engines that already exist rather than rebuilding them. |
| Vendor cases | `escalation` (extends `escalation_matrix.py`) | Vendor Escalation Tracker (3), Vendor Case Companion (2) | The escalation matrix exists; external vendor case ingestion plus an evidence package is the provider integration that unlocks all three names. |
| Isolated environments | `lab` (studio, Automation) | Instant Lab (3), Technician Sandbox (3), Safe Experiment (3) | One infrastructure decision: provisioning, isolation, expiry and destruction evidence. Safe Experiment's reversible-endpoint-execution half rides on the same isolation. |
| Procedure contract | `runbook` (extends `runbooks.py`) | Live Runbook (3) | One contract change. An adaptive step must propose a correction for review rather than deviate silently. |
| Build and release | `devops` (studio, Build) | Application Runtime (5 #117), Release (5 #120) | Application Runtime is deferred behind the deployment record DevOps owns, so it is a merge rather than a second workspace; Release extends Change Management (`change_management.py`), where approvals, verification kinds and rollback plans already live. |
| Evidence layer | `observability` (studio, Observability) | Data Pipeline (5 #119) | Duplicate/incomplete-record detection already ships as the data-quality read model, and batch 5 says the ETL half belongs in the same evidence layer rather than a separate workspace. |
| Dependency graph | `dependency-map` (studio, Infrastructure) | Fix Fallout, Repair Side-Effect Map, Ticket Collision Detector, Work Collision Forecast, Reboot Negotiator, Service Dependency Doctor, Invisible Dependency Hunter, Network Path Memory, Driver Compatibility Radar, Software Conflict Investigator (all batch 2) | Ten concepts across two of batch 2's rows resolve to one missing substrate. Until the graph carries provenance and change-time attribution, every one of them would infer a consequence from timing alone — which batch 2 itself rules out. |
| Customer continuity | `customer-continuity` (studio, Service) | Customer Memory Shield, Customer Frustration Prevention, The Customer Who Never Calls, Zero-Question Support (batch 2) | One consent-aware continuity decision under one gate (`contact-policy`). |
| Technician memory | `technician-memory` (studio, Knowledge) | Technician Second Brain, The Technician Who Never Has to Ask Twice, Escalation Quality Gate, Support Passport, Escalation Packet (batch 2) | They all depend on the assembled-context primitives, and the per-technician operational memory needs a retention decision first. |
| Recurring failure | `recurring-failure-evidence` (studio, Service) | False Fix Detector, Fix Expiry, Diagnostic Replay, Known-Good Library, Maintenance Debt (batch 2) | All five need recurrence keyed to a stable service or fault identity. Support Debt supplies the ticket half; the per-service half has no authoritative source. |
| Sales engineering | `sales-engineering` (section of `customer-environment`) | — | Batch 5 says it itself: this is the Customer Environment projection with a commercial framing. A section, not a second store — and therefore it lives in Nexus Service, not the Nexus Growth product batch 5 filed it under. |
| Change machinery | `customer-profitability` (section of `finance`) | — | Distinguishing estimated cost from confirmed transaction is the rule `finance_integrity` already applies; it is reused, not reinvented. |

## Clusters that deliberately did NOT merge

A merge is a decision about ownership, so several clusters share a gate while
staying separate records. Collapsing them would have created one tool pretending
to hold two unrelated objects:

| Kept separate | Shared gate | Why one tool would be wrong |
|---|---|---|
| `windows`, `apple`, `linux`, `endpoint-performance` | `agent-platform-parity` (open); `fleet-baseline` (**built and cleared** — read by `windows` and `endpoint-performance`) | Three platform views and one fleet baseline over one agent, asset and policy stack. The views differ; the gate is decided once, and the baseline is built once and consumed twice. |
| `file-services`, `permission-microscope` | `effective-access-evaluation` | A share's quota and ACL evidence against an identity-side answer to *which rule denied this file operation*. The same provider decision unlocks both, but they are read by different surfaces. |
| `browser-management`, `application-black-box` | both are consent decisions, recorded separately | Extension inventory is not bounded runtime capture. One enumerates what is installed; the other records what an application does, and it carries the privacy boundary that must never record unrelated customer content. |
| `connectivity-diagnostics`, `port-historian` | none — different sources of truth | An authorised probe from an observation point is not an SNMP or controller inventory of switch, port and VLAN state over time. |
| `service-catalogue`, `quoting` | `commercial-source-of-truth` | What an MSP sells is not how it prices a specific deal. One gate, two surfaces: the catalogue is the datum, the estimate path is the engine that consumes it. |
| `lab`, `observability` | none — different decisions | Disposable environments need isolation and destruction evidence; the evidence layer needs a scope decision. Both are shared platform capabilities, which is why both must not become per-customer studios. |

## Where it surfaces

The consolidation is not a document people have to remember:

- `GET /api/studios` carries, per product, `planned_studios` (the `studio`
  dispositions only), `proposals` (every record filed under that product with its
  disposition, gates, merge target and note) and `proposal_count`, plus a
  top-level `proposal_note`.
- `frontend/src/pages/StudiosHubPage.jsx` renders each product's catalogue with
  the disposition named, so an idea consolidated into existing capability says
  where it went and a proposed studio never reads as a delivered one.
- `PRODUCTS[*].planned_studios` is derived from the register, not hand-written, so
  a product cannot claim as a plan what the consolidation turned into an
  extension of something it already has.

## What would prove this consolidation was right

The merge's whole claim is that a smaller number of owners is worth more than a
longer list, and it is falsifiable:

1. **Do the 68 proposed studios stay 68?** A proposal that quietly becomes a
   section, or a section that reappears as a studio in a later batch, means the
   register is being routed around rather than used. A proposal that leaves the
   plan *because its gate was decided* is the register working, and it says so:
   `windows` and `endpoint-performance` are `served` with the file they are served
   by, not silently dropped.
2. **Do the 60 open gates get decided?** A gate that is still unnamed a quarter
   later was never a real gate — the honest response is to delete the proposal,
   not to restate it. One is decided: `fleet-baseline` is recorded as cleared with
   the artifact that cleared it, and that artifact exists.
3. **Do the extensions ship?** Licensing Compliance, Quoting, Subscription,
   Escalation, Runbook, Release, Handover, Temporary Access Expiry, Change Witness
   and Hardware Swap extend surfaces that exist — and batch 6 added four more
   (Reception, Threat Exposure, Identity Threat and Kiosk). If those never produce
   a change, the `extend` disposition is a euphemism for abandoned.
4. **Does a new idea arrive with a disposition?** The consolidation is only
   working if the next batch's first question is *which product, which owner,
   which gate* rather than *which new studio*.

Until those numbers exist, this is a record of decisions, not a delivery claim.
No studio named here is built by being named here.

## Verification

```bash
cd backend && JWT_SECRET=test-only-secret-that-is-long-and-random-enough \
  MONGO_URL=mongodb://127.0.0.1:27017 DB_NAME=nexusops-tests \
  python3 -m pytest tests/test_studio_fleet.py tests/test_fleet_baseline.py -q
python3 -m flake8 app server.py worker.py

cd frontend && CI=true npx craco test --watchAll=false \
  --testPathPattern="studioProducts|studioCatalogue|StudiosHubPage"
npx eslint src --ext .js,.jsx
```

`backend/tests/test_studio_fleet.py` (39 tests) and
`backend/tests/test_fleet_baseline.py` (52 tests) prove this rather than
describing it:

- every catalogue idea from batches 2–6 is recorded exactly once, as a record or
  as a `covers` entry, and no concept is covered twice;
- `planned_studios` holds only `studio` dispositions, and a proposed studio has no
  registry entry — so nothing can render a proposal as shipped;
- a cleared gate cites evidence that exists, says what cleared it, and blocks no
  proposal — and the two studios it unblocked are `served` and registered rather
  than planned; the projection's own read is pinned too: an unmeasured metric is
  `null` with its reason, a cohort below the minimum has no baseline, a deviation
  is counted from the same deviations the per-device view returns, and the
  endpoints are mounted behind authentication with the tenant partition and the
  caller's client scope applied by the database query;
- every `section` target is a registered studio in the same product, every
  `merged` target is a real record and merges do not chain, and a merged record
  carries no gates of its own;
- every `studio` proposal names a gate or the records it projects from, every
  referenced gate exists, and a gate that blocks nothing is refused;
- every cited `already_exists_at` and `buildable_from` path exists on disk;
- the register's own guards refuse a broken consolidation (unknown product,
  unknown gate, unresolved target, duplicate cover, missing cited file, orphan
  gate) — asserted directly against `studio_proposals.validate()`;
- the boundary where an explanation becomes work is pinned as well: a shape the
  recurrence view does not report raises nothing, a cohort without a baseline
  raises nothing, a shape with an open change is not raised twice while a closed
  or rejected one does not block it for ever, the request that is raised cites the
  shape's own basis and carries a verification step and a rollback statement, a
  failed platform event does not hide the change that was created, and a
  client-scoped technician cannot raise an estate-wide change. The derived request
  is also handed to the change-management owner itself rather than to a stub of
  it, so the owner's own validation and the two fields a derived request adds are
  exercised on the request that matters.

The frontend tests (45 across `StudiosHubPage.test.jsx` (20),
`studioCatalogue.test.js` (13) and `studioProducts.test.js` (12), plus 17 in
`components/studios/FleetBaselinePanel.test.jsx` and 8 in
`pages/FleetBaselinePage.test.jsx`)
prove the hub counts proposals as proposals, renders a consolidated idea with its
target and gate, never renders a proposed studio as delivered, and degrades to the
previous listing when the payload carries no `proposals`; that the catalogue
searches admitted studios and plans in one index, ranks a name match above a note
that merely mentions the word, narrows with every token, filters by tier and by
what an entry is, never offers a surface a plan does not have, and states an empty
search instead of an empty catalogue; and prove that the tab which raises a shape
shows the request, its verification and its rollback, names the change when one is
already open instead of proposing a second, and states an empty result rather than
rendering a clean panel. The whole frontend suite is 86 suites and 632 tests.

None of this is asserted batch by batch. The ledger is re-derived from
`backend/app/services/studio_proposals.py` every time the suite runs, so a seventh
batch extends the same register, the same gate vocabulary and the same `covers`
ledger instead of starting a second list — which is why batch 6 could be added by
declaration alone, with no change to what a record *means*.
