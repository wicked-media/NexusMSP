# Nexus Invent — batch 6: business communications, data protection and physical infrastructure

Last reviewed: 2026-10-13
Governed by: [Nexus Product Constitution](NEXUS_PRODUCT_CONSTITUTION.md) · [Studio fleet](NEXUS_STUDIO_FLEET.md) · [Master capability register](NEXUS_MASTER_CAPABILITY_REGISTER.md)
Predecessors: [batch 2](NEXUS_INVENT_BATCH_2.md) · [batch 3](NEXUS_INVENT_BATCH_3.md) · [batch 4 foundations](NEXUS_FOUNDATIONS_BATCH_4.md) · [batch 5](NEXUS_INVENT_BATCH_5.md)
Consolidated by: [Catalogue merge review](NEXUS_STUDIO_MERGE_REVIEW.md) — the 30 proposals below are recorded once in `backend/app/services/studio_proposals.py`

This batch proposes studios **156–185**: ten business communications studios, ten
data protection and governance studios, and ten physical infrastructure and
specialist services. It is the batch that stops adding rows to a list and starts
treating the catalogue as a product portfolio.

Three things follow from that framing, and all three are structural rather than
prose:

1. **A studio is one of three commercial tiers.** `TIERS` in
   `backend/app/services/studio_registry.py` declares **Core**, **Specialist** and
   **Platform**; every product belongs to exactly one, an unknown tier refuses
   registry construction, and `GET /api/studios` serves the tiers, each product's
   tier and each studio row's `tier`/`tier_label`.
2. **The catalogue is searched, not scrolled.** 185+ studios cannot be 185 sidebar
   links. The `msp_studios` navigation section is retitled **Market Place** and
   holds one row — the catalogue — and `frontend/src/pages/StudiosHubPage.jsx` is
   a searchable index over admitted studios *and* catalogue ideas.
3. **A disposition is still not a capability claim.** The batch files 30 ideas as
   24 proposed studios, 2 sections of studios that already own the domain, 4 named
   gaps on surfaces that already exist, and 0 new products. Nothing here is
   registered as shipped, and nothing is presented as delivered because it is
   listed.

The brief's numbering runs to 185 studios; the register counts **142 distinct
catalogue ideas across batches 2–6**, recorded as **104 records** (68 proposed
studios, 10 sections, 2 merges, 14 named gaps and 10 already-served capabilities)
against **61 named gates**, one of which (`fleet-baseline`) is recorded as cleared.
Those are different unit systems — the brief numbers every studio it imagined, the
register counts each idea once after duplicates are absorbed — so every count in
this document is the register's, because those are the ones that fail a test when
they are wrong.

## The decision this batch makes

### Three tiers, one packaging

The catalogue is a portfolio: some of these ideas become products, some become
tabs inside a studio that exists, and some are shared engines that make every
other product stronger. The tiers are that sentence in code.

| Tier | Products | Admitted studios | Proposed studios | What it means commercially |
|---|---|---|---|---|
| **Core** | nexus-endpoint, nexus-identity, nexus-shield, nexus-recovery, nexus-service | 14 | 27 | Everyday MSP operations: the products a technician works in all day. |
| **Specialist** | nexus-infrastructure, nexus-communications, nexus-growth, nexus-build | 10 | 23 | Advanced capability a client buys because their estate needs it. |
| **Platform** | nexus-automation, nexus-observability, nexus-commerce, nexus-knowledge, nexus-platform | 5 | 18 | Shared engines every other product inherits: policy, evidence, commercials and integration management. |

A tier describes a *product*, never a studio that has not been admitted. That is
why the tier rollup reports two different numbers per tier: a count of admitted
studios, and a labelled count of proposed ones. The tier changes no persistence:
like the rest of the register it is static declaration, so it adds no entry to
[DATA_OWNERSHIP](DATA_OWNERSHIP.md).

### The Market Place, instead of 185 links

| Surface | Path | What it does |
|---|---|---|
| Catalogue index (pure) | `frontend/src/lib/studioCatalogue.js` | Flattens `GET /api/studios` into one searchable entry per admitted studio and per catalogue idea: `buildCatalogueIndex`, `searchCatalogue`, `catalogueFacets`, `catalogueSummary`, `isCatalogueFiltered`. Every query token must match (two words narrow a search, never widen it), an admitted studio outranks a plan on an equal match, facet counts come from the whole index so a chip cannot vanish mid-search, and a payload that declares no tiers still indexes. |
| Hub | `frontend/src/pages/StudiosHubPage.jsx` | Unfiltered, the fleet still reads as the product sections it always did — the product is the navigation boundary. As soon as a search or facet is set, it answers with a ranked flat list over admitted studios *and* catalogue ideas, each naming its product, tier, status and the gate that blocks it. An admitted studio offers "Open studio"; a plan offers no surface unless a registered studio owns it. |
| Navigation | `frontend/src/config/navigation.js` | The `msp_studios` section is titled **Market Place** and holds one row: `/studios`, "Studio catalogue". The admitted studio surfaces are its children, so sidebar search and the command palette still resolve a studio by name without a sidebar link per studio. The group id is unchanged so stored visibility preferences and enabled modules keep resolving. |
| Alias route | `frontend/src/config/routes.js` | `/marketplace` serves the same catalogue, so a shared link matches the label; `/studios` stays canonical and navigation points at it. |

### Shipped in this batch

| Surface | Path |
|---|---|
| The batch-6 catalogue (30 records, 16 new gates) | `backend/app/services/studio_proposals.py` |
| Commercial tiers | `backend/app/services/studio_registry.py` — `TIERS`, `_product(tier=...)`, `tier_rollup()`, `TIER_NOTE` |
| API exposure (extended) | `GET /api/studios` → `tiers` (with per-tier product and studio counts), `tier_note`, `products[].tier`/`tier_label`, each studio row's `tier`/`tier_label`, `GET /api/studios/{id}` → `tier`/`tier_label` |
| Market Place catalogue (pure) | `frontend/src/lib/studioCatalogue.js` |
| Market Place hub | `frontend/src/pages/StudiosHubPage.jsx` |
| Market Place navigation | `frontend/src/config/navigation.js`, `frontend/src/config/routes.js`, `frontend/src/components/studios/StudioShell.jsx` ("Back to the Market Place") |
| Tests | `backend/tests/test_studio_fleet.py` (39), `frontend/src/lib/studioCatalogue.test.js` (13), `frontend/src/pages/StudiosHubPage.test.jsx` (20), `frontend/src/config/navigationRoutes.test.js` |

**No studio from 156–185 is built by this batch, and that is again the finding.**
Twenty-four of the thirty are plans blocked on a decision Nexus has not taken —
almost always a provider contract it does not read yet, or a collection and
retention boundary nobody has agreed to. Two are sections of studios that already
own the domain, and four are named gaps on surfaces that already exist. Building
any of them as a new studio today would create a second owner for a datum that
already has one.

## Studios 156–185 — the batch in one table

| # | Studio | Product | Disposition | Blocked on / where it went |
|---|---|---|---|---|
| 156 | Contact Centre Studio | Nexus Communications | `studio` | Carrier-to-agent call-path evidence |
| 157 | Business SMS Studio | Nexus Communications | `studio` | Messaging provider delivery and charge contract |
| 158 | Cloud Fax Studio | Nexus Communications | `studio` | Messaging provider delivery and charge contract |
| 159 | Unified Communications Studio | Nexus Communications | `studio` | Carrier call-path evidence **and** meeting-quality ingestion |
| 160 | SIP Studio | Nexus Communications | `studio` | Carrier-to-agent call-path evidence |
| 161 | Video Conferencing Studio | Nexus Communications | `studio` | Meeting endpoint and call-quality ingestion |
| 162 | Voice Quality Studio | Nexus Communications | `section` of `voice` | Carrier call-path evidence; a view over the studio that already owns voice |
| 163 | Number Management Studio | Nexus Communications | `studio` | Carrier number ownership and billing record |
| 164 | Messaging Compliance Studio | Nexus Communications | `studio` | Messaging provider contract **and** classification/retention model |
| 165 | Reception Studio | Nexus Communications | `extend` | `backend/app/routers/voice_service_desk.py`, projecting from `backend/app/routers/tickets.py` |
| 166 | Data Governance Studio | Nexus Shield | `studio` | Data classification and retention model |
| 167 | Data Loss Prevention Studio | Nexus Shield | `studio` | Data classification and retention model |
| 168 | eDiscovery Studio | Nexus Shield | `studio` | Data classification and retention model |
| 169 | Privacy Operations Studio | Nexus Shield | `studio` | Data classification and retention model |
| 170 | Encryption Studio | Nexus Shield | `studio` | Key-management provider integration |
| 171 | Secrets Studio | Nexus Platform | `studio` | Secret-manager provider integration |
| 172 | Threat Exposure Studio | Nexus Shield | `extend` | `backend/app/routers/nexus_exposure.py`; authorised network observation points |
| 173 | Software Supply Chain Studio | Nexus Build | `studio` | Software bill-of-materials ingestion |
| 174 | Identity Threat Studio | Nexus Identity | `extend` | `backend/app/routers/identity_threats.py`; identity-provider sign-in ingestion |
| 175 | Data Recovery Studio | Nexus Recovery | `section` of `backup` | Restore-test evidence per dependency chain |
| 176 | Rack Studio | Nexus Infrastructure | `studio` | Rack placement, power and runtime model |
| 177 | Cabling Studio | Nexus Infrastructure | `studio` | Passive infrastructure inventory |
| 178 | Fibre Studio | Nexus Infrastructure | `studio` | Passive infrastructure inventory |
| 179 | Environmental Studio | Nexus Observability | `studio` | Equipment-room sensor feed |
| 180 | UPS Studio | Nexus Infrastructure | `studio` | Rack placement, power and runtime model |
| 181 | Kiosk Studio | Nexus Endpoint | `extend` | `backend/app/routers/kiosk.py`; managed public-access device inventory |
| 182 | Laboratory Equipment Studio | Nexus Observability | `studio` | Laboratory-equipment monitoring boundary |
| 183 | Broadcast Studio | Nexus Infrastructure | `studio` | Media pipeline inventory |
| 184 | Satellite Studio | Nexus Infrastructure | `studio` | Satellite terminal and provider read contract |
| 185 | Edge Studio | Nexus Endpoint | `studio` | Edge node and local-application inventory |

Sixteen gates are declared once and referenced by every studio they actually
block: `carrier-call-path-evidence`, `messaging-carrier-contract`,
`meeting-quality-evidence`, `carrier-number-ownership`,
`data-classification-model`, `key-management-integration`,
`secret-provider-integration`, `sbom-ingestion`,
`power-placement-and-runtime-model`, `passive-infrastructure-inventory`,
`facility-sensor-feed`, `kiosk-public-device-inventory`,
`laboratory-equipment-monitoring-consent`, `media-pipeline-inventory`,
`satellite-provider-contract` and `edge-node-inventory`. Two batch-6 studios
reuse gates the earlier batches already named (`authorised-network-probes` for
172, `authentication-journey` for 174, `restore-test-evidence` for 175), because a
second name for one decision is the duplication this register exists to prevent.

## Studios 156–165 — business communications and collaboration

The batch's own instruction: these sit inside **Nexus Communications**, with
Telecom Studio remaining the technical administration hub. The dispositions keep
that true — the ten become eight plans, one section of the voice studio that
already owns voice, and one named gap on the voice service desk that already turns
an answered call into a ticket. Nexus Communications now plans eight studios,
where before this batch it planned none.

| # | Studio | What it would manage | Standout capability | Disposition and gate |
|---|---|---|---|---|
| 156 | **Contact Centre Studio** | Call queues, agents, IVR, call routing, recordings, wallboards and contact-centre integrations | Diagnose customer calls from carrier to agent | **Proposed studio.** The differentiator is the gate, not the wallboard: per-leg evidence from carrier, PBX and endpoint, each with its own access, rate and retention decision. |
| 157 | **Business SMS Studio** | Business SMS, sender identities, messaging gateways, templates, delivery reports and customer messaging | Trace failed SMS delivery and reconcile carrier charges | **Proposed studio.** A different provider family from voice: sender identities, templates, delivery reports and carrier charges each need the provider contract before a failed message can be traced. |
| 158 | **Cloud Fax Studio** | Fax-to-email, cloud fax services, fax numbers, routing, transmission failures and retention | Manage legacy fax services without separate provider portals | **Proposed studio.** Shares the messaging provider contract with SMS rather than earning a second collection decision — legacy fax is still a live service in most client estates. |
| 159 | **Unified Communications Studio** | Presence, voice, video, messaging and collaboration integrations | Correlate communication failures across devices, networks and providers | **Proposed studio, gated on both halves.** Correlating a failure across devices, networks and providers needs the call path *and* the meeting quality; it is gated on both rather than on either. |
| 160 | **SIP Studio** | SIP registrations, trunks, routing, codec negotiation, session border controllers and call diagnostics | Visualise SIP call failures and signalling sequences | **Proposed studio.** Registrations, trunks, codec negotiation and SBCs are the signalling half of the call-path gate; the visualised signalling sequence is what the gate unlocks. |
| 161 | **Video Conferencing Studio** | Meeting platforms, conferencing endpoints, device firmware and call quality | Identify whether poor meeting quality comes from the endpoint, network or service | **Proposed studio.** Meeting platforms and room endpoints sit with communications, not the endpoint estate, because the question is answered from platform call-quality records. |
| 162 | **Voice Quality Studio** | Jitter, latency, packet loss, MOS estimates and call-path health | Explain recurring voice-quality problems using network evidence | **Section of `voice`.** Jitter, latency, packet loss and MOS are a view over the call path Voice Studio already owns, so this is a section of that studio rather than a second voice product. |
| 163 | **Number Management Studio** | DIDs, number allocation, porting, carrier ownership, assignments and billing | Prevent orphaned or incorrectly billed phone numbers | **Proposed studio.** A number register is only useful if it knows who is billed for the number — the ownership record the standout capability depends on. |
| 164 | **Messaging Compliance Studio** | Business messaging retention, approved channels, policy controls and audit evidence | Identify communication services operating outside customer policy | **Proposed studio, gated twice.** Measuring a communication against policy requires a policy that exists, so it needs the messaging inventory *and* the classification and retention model. |
| 165 | **Reception Studio** | Virtual reception, call answering workflows, appointment routing and business-hours configuration | Coordinate call handling across customer offices | **Named gap on `voice_service_desk.py`.** Call answering already produces a service-desk record; what remains is answering workflows and business-hours configuration across a customer's offices, not a parallel reception product. It projects from the ticket records that already exist. |

## Studios 166–175 — data, protection and governance

Five of these ten are one missing model rather than five products: classification
and retention decide all of them, so `data-classification-model` is named once and
referenced by Data Governance, Data Loss Prevention, eDiscovery, Privacy
Operations and Messaging Compliance. The batch's own instruction on Secrets Studio
is met in the register rather than in a comment: it integrates established secret
managers and is filed under **Nexus Platform**, because every other product
consumes it and a home-grown cryptographic vault needs a reason Nexus does not
have.

| # | Studio | What it would control | Standout capability | Disposition and gate |
|---|---|---|---|---|
| 166 | **Data Governance Studio** | Data classification, ownership, retention, sharing policies and lifecycle | Which data matters, declared once | **Proposed studio.** Classification, ownership, sharing and lifecycle *are* the model, so this is the studio the model is declared in rather than a projection of one. |
| 167 | **Data Loss Prevention Studio** | DLP policies, incidents, sensitive data movement and approved remediation | Rank incidents by what the data actually is | **Proposed studio.** A DLP policy is only meaningful against a classification: incidents and remediation cannot be ranked before something says which data matters. |
| 168 | **eDiscovery Studio** | Authorised searches, legal holds, exports, chain of custody and case management | Search under authorisation, with custody recorded | **Proposed studio.** Authorised search, holds and chain of custody need the same model plus the authorisation boundary the gate names. |
| 169 | **Privacy Operations Studio** | Data access requests, deletion workflows, consent records and privacy obligations | Answer an access or deletion request with evidence | **Proposed studio.** Where the classification model meets an obligation: without it a deletion request has nothing to search. |
| 170 | **Encryption Studio** | Encryption status, key-management integrations, recovery-key governance and cryptographic policy | Read encryption state without becoming the key authority | **Proposed studio.** Encryption status and recovery-key governance are read from the customer's key-management provider; Nexus must never be the key authority. |
| 171 | **Secrets Studio** | Application credentials, service accounts, API secrets, rotation and access approvals | One audited path to rotate a secret across providers | **Proposed studio, filed under Nexus Platform as a shared capability.** Read, lease and rotate through established secret managers with their own audit trail; the provider contract and the rotation-ownership decision come first. |
| 172 | **Threat Exposure Studio** | Internet-facing assets, misconfigurations, known vulnerabilities and remediation tracking | What the internet can see, and who fixed it | **Named gap on `nexus_exposure.py`.** An exposure surface already exists; internet-facing discovery and remediation tracking need authorised observation points rather than a second exposure workspace. |
| 173 | **Software Supply Chain Studio** | Software bills of materials, package provenance, dependency vulnerabilities and release integrity | Trust a release because its provenance is recorded | **Proposed studio (Nexus Build).** Provenance and dependency vulnerability are read where software is built, so it sits beside DevOps Studio and is gated on SBOM collection. |
| 174 | **Identity Threat Studio** | Suspicious sign-ins, privileged access anomalies, risky authentication and identity incident investigation | Investigate a sign-in with the provider's own evidence | **Named gap on `identity_threats.py`.** Risky sign-ins and privileged anomalies need identity-provider sign-in ingestion finished first; Nexus must not infer a denial reason it did not read. |
| 175 | **Data Recovery Studio** | File-level recovery, deleted data investigations, restore requests and recovery verification | Recover a file, not just a job | **Section of `backup`.** File-level recovery, deleted-data investigation and recovery verification are Backup Studio's own restore surface; the planned `storage-recovery` proposal covers storage-level fault recovery, which is a different evidence set. Gated on restore-test evidence per dependency chain. |

## Studios 176–185 — physical infrastructure and specialist services

These extend Nexus beyond conventional MSP software into communications and
facilities infrastructure, which is what an MSP that also runs ISP and network
services needs. Each needs an inventory Nexus does not collect yet — which is
exactly why the hardware provider families stay plans rather than being folded
into Monitoring Studio for looking like telemetry: environmental sensors and UPS
runtime are a facility-collection decision, not a section of the IT monitoring
studio, and the register says so in each note rather than leaving a reader to
infer it.

| # | Studio | What it would manage | Standout capability | Disposition and gate |
|---|---|---|---|---|
| 176 | **Rack Studio** | Interactive rack layouts, rack units, power allocation, patching, device placement and capacity | A rack diagram that is a record, not a drawing | **Proposed studio.** Placement is the first half of the power model; without it a rack layout cannot be reconciled with the asset record. |
| 177 | **Cabling Studio** | Structured cabling records, patch panels, ports, fibre runs, test results and cable tracing | Trace a run instead of guessing it | **Proposed studio.** Shares one missing source of truth with fibre, so both are blocked by the same inventory decision rather than by two. |
| 178 | **Fibre Studio** | Fibre infrastructure, optical levels, transceivers, link diagnostics, fibre paths and fault history | Attribute a link fault to a run and an end | **Proposed studio.** Optical levels, transceivers and link diagnostics only mean something against recorded runs and endpoints — the specialist capability the batch names for MSP/ISP operations. |
| 179 | **Environmental Studio** | Temperature, humidity, water-leak sensors, environmental alarms and equipment-room conditions | Know the room before the hardware fails | **Proposed studio (Nexus Observability).** It is telemetry and alarms, but kept as a plan rather than a section of Monitoring Studio: equipment-room sensors are a facility-collection decision Monitoring Studio does not own. |
| 180 | **UPS Studio** | Battery health, runtime estimates, load, self-tests, alerts and shutdown coordination | Whether the runtime is still enough for a graceful stop | **Proposed studio.** The runtime half of the power model, read from the UPS rather than inferred from a device record. |
| 181 | **Kiosk Studio** | Self-service terminals, public-access devices, kiosk software, connectivity and remote maintenance | Manage terminals as a fleet, not one at a time | **Named gap on `kiosk.py`.** A tokenised public kiosk surface already ships; the fleet half — software, connectivity and remote maintenance — needs the public-access device inventory and consent decision. |
| 182 | **Laboratory Equipment Studio** | Authorised monitoring of network-connected laboratory equipment and supporting IT systems | Read the instrument without touching its control system | **Proposed studio, deliberately narrow.** Read-only, with the equipment owner's authorisation and a boundary that never reaches into an instrument's own control system. |
| 183 | **Broadcast Studio** | Streaming infrastructure, encoders, media servers, distribution systems and broadcast network health | Attribute a broadcast fault to a pipeline stage | **Proposed studio.** The pipeline sits on a network Nexus already observes, but attributing health needs the pipeline inventory first. |
| 184 | **Satellite Studio** | Satellite internet terminals, connectivity, signal quality, service usage and supported provider integrations | Signal and usage evidence without the provider portal | **Proposed studio.** A connectivity provider family of its own, called out for ISP operations alongside fibre and cabling. |
| 185 | **Edge Studio** | Edge computing nodes, remote gateways, local applications, synchronisation and resilient offline operations | Prove a remote site kept working while offline | **Proposed studio.** Managed endpoints with resident applications and offline behaviour belong to the endpoint estate, and are blocked on inventory the agent does not collect yet. |

## The five this batch would build first

The batch names its own order. Until the named gate opens, each of these is a
strategy assessment rather than a release plan — and building one before its gate
is decided would mean inferring evidence Nexus has not read.

| Priority | Studio | Gate before code |
|---|---|---|
| 1 | **Contact Centre Studio (156)** | Carrier-to-agent call-path evidence across carrier, PBX and endpoint — and it fits the Yeastar and Atom Telecom integrations the platform already has. |
| 2 | **SIP Studio (160)** | The same call-path gate, with the signalling view as its first honest output. |
| 3 | **Secrets Studio (171)** | A secret-manager provider contract plus the rotation-ownership decision. It is third because it is a shared foundation every other integration consumes. |
| 4 | **Fibre Studio (178)** | Passive infrastructure inventory: recorded runs, endpoints and test results. |
| 5 | **Edge Studio (185)** | Edge node and local-application inventory from the agent. |

## The integration opportunity this batch names

Nexus Communications could correlate Yeastar PBX data, SIP trunk diagnostics,
carrier usage and Microsoft Teams call-quality evidence in one investigation:
whether a reported call-quality problem belongs to the endpoint, the network
conditions, the PBX, or an upstream communications service. Number Management and
SIP Studio are the two the batch singles out for the existing Yeastar and Atom
Telecom integrations.

One caveat belongs in the gate rather than in a product claim, and the register
states it there: the meeting-quality half depends on the conferencing platform's
call records, which have their own permission requirements and a bounded
availability window (Microsoft Graph call records are permission-scoped and the
batch records their availability as 30 days — a provider detail, so the gate states
it as such rather than Nexus asserting it). A studio that correlated call quality without
those records would be inferring the cause of a fault from the absence of
evidence, which is the failure mode this register exists to refuse.

## Verification

- `backend/tests/test_studio_fleet.py` — **39 tests**. New for this batch: the
  batch-6 catalogue ledger is pinned so no idea can be dropped (the register's
  coverage union is checked against `BATCH_6_CATALOGUE` alongside the earlier
  batches), the communications studios are held to their one product and their two
  non-plan dispositions, the physical-infrastructure families are held to plans
  rather than sections of Monitoring, every batch-6 plan asserts a batch-6
  recorded gate and a note, the classification gate is proven to be named once and
  referenced by exactly the five studios it blocks, every product declares one
  declared tier, a tier is never claimed for an unadmitted studio, the tier rollup
  places each product exactly once, the API serves `tiers`/`by_tier`/`tier_note`
  and per-row tier labels, and the register refuses an undeclared tier.
- `frontend/src/lib/studioCatalogue.test.js` — **13 tests**: admitted studios and
  catalogue ideas index separately; a plan is never given an operating surface of
  its own while a section points at the studio that owns it; a capability is found
  by the problem it solves, not only its name; every token narrows; a name match
  outranks a note that happens to mention the word and an admitted studio outranks
  a plan on an equal match; facets count the whole index and combine with a query;
  the summary reports what is shown out of what exists; one normalisation makes two
  spellings agree; a payload with no tiers still indexes and still names each
  plan's blocker; and empty or null payloads return an empty catalogue instead of
  crashing.
- `frontend/src/pages/StudiosHubPage.test.jsx` — **20 tests**: the existing
  fleet/shell behaviours plus the catalogue. It proves the unfiltered hub is still
  the product view and that a search replaces it with a ranked flat list over both
  kinds of entry; a plan shows its disposition and its blocker and offers no
  "Open studio" button, while an admitted studio shows its status, product and tier
  and does; the tier and kind facets narrow and clear back to the fleet; a search
  with no match renders the shared `EmptyState` rather than an empty catalogue; and
  a payload that declares no tiers renders no tier facet, still searches, and still
  names each plan's blocker.
- Full frontend suite: **86 suites / 632 tests** pass, including
  `frontend/src/config/navigationRoutes.test.js`, which holds the Market Place
  section to one catalogue row with the admitted surfaces as children and fails if
  a row stops resolving to a registered route or two rows claim one path.
- `docs/NEXUS_STUDIO_FLEET.md`, `docs/NEXUS_STUDIO_MERGE_REVIEW.md`,
  `docs/NEXUS_MASTER_CAPABILITY_REGISTER.md`, `docs/PLATFORM_PRIORITY_MAP.md` and
  the register counts in `docs/NEXUS_INVENT_BATCH_5.md` and
  `docs/NEXUS_FOUNDATIONS_BATCH_4.md` are updated in the same change, and
  `docs/DATA_OWNERSHIP.md` records why none of it needs an entry there: the tiers and
  the catalogue are static declaration over the same register, so they add no store,
  no collection and no owner.

A studio appearing in this catalogue is not implementation evidence — the
register's own rule, and the reason every row above names what blocks it.
