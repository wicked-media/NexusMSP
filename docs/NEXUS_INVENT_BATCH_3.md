# Nexus Invent — batch 3: what Nexus cannot see, prove, coordinate or undo

This batch takes two related ideas from the same brief and turns the first
honest slice of each into shipped capability:

* **Nexus Technician Wish Engine** — the unmet need, stated by the person doing
  the work, grouped into reviewed patterns and promoted into the existing Nexus
  Ideas registry only after a human records what it should become.
* **Nexus Forge** — a governed *tool design request*: a specification composed
  from capabilities the running Nexus API actually serves, held behind twelve
  disclosed checks, a human review and retained version history.

Everything else in the batch is deferred below with the gate that blocks it and
the existing workspace it should extend when that gate opens. No concept here is
recorded as "underway", and nothing in this document is a delivery claim.

## Shipped in this batch

### Nexus Technician Wish Engine (`wish_engine.py`, `docs/DATA_OWNERSHIP.md`)

The Wish Engine exists because an unmet need is the cheapest product signal an
MSP will ever get, and almost every platform throws it away into a chat channel.
It ships as a tool in the Control Plane next to Friction Radar and the idea
vault, because that is where the product-development loop already lives.

What it does: a technician states the frustration in one line with the workspace
it was felt in; Nexus normalises it into a *shape*, groups shapes that describe
the same need in different words, and reports how often and by how many people
the shape was reported, over what span and from which surfaces.

What it deliberately does not do:

* **A single request is never quoted to reviewers.** A shape reaches the review
  queue only once at least two technicians reported it; a lone request is counted
  and stays with its author. This is the difference between a shared-need list
  and a window onto one person's opinions.
* **No saving is claimed.** Nexus reports reports, technicians, workspaces and
  span. It does not convert the counts into hours or money — unlike Support Debt,
  there is no recorded labour behind a wish to annualise.
* **The routing is a suggestion with its reasoning attached.** The rule that
  proposes `shortcut`, `automation`, `forge_tool`, `documentation` or
  `product_change` discloses the exact words that matched, and returns no
  suggestion at all when nothing matched rather than guessing.
* **Nexus cannot promote alone.** Promotion into the Nexus Ideas registry
  requires a recorded disposition, the evidence for it, and the minimum shared
  occurrence count. The promoted idea enters as `captured`: dependencies,
  evidence, an owner and a release gate are still required before roadmap work.

**The honest limitation, stated in the product:** grouping free text is a disclosed
heuristic — two shared distinctive words plus a 60% coverage of the shorter
request — not language understanding. A need described in two entirely different
vocabularies stays two patterns, and a pattern only surfaces once someone else
reports it. Nexus says so on screen rather than implying it understood the need.

### Nexus Forge — design requests, not code generation

Forge is the part of the brief with the largest commercial claim, so it ships
with the smallest honest control: a request for a **technical design**. It
generates no executable code, deploys nothing, holds no credential and grants no
privilege.

* **Grounded capability discovery.** `GET /nexus-forge/capabilities` is built from
  the route table the running application serves, not a written-down wish list.
  A design can only compose capabilities that exist, and the API it composes is
  the same API the caller is already authorised against.
* **Twelve disclosed checks.** No privileged or credential-bearing delivery, a
  resolved capability set, server-side tenant scope, named permissions (a
  wildcard is a failure), declared data classes (a credential-shaped class is a
  failure), a sandbox plan, verification tests, rollback, a re-review interval,
  stated verification for any state-changing composition, duplicate detection
  against already-published tools, and blast radius. Each returns `pass`,
  `needs_review` or `fail` with its reason.
* **A person decides, and a refusal is recorded.** A failing design cannot be
  approved. A design with flagged checks can be, but only with a written
  acknowledgement of at least 20 characters. Decisions are retained with the
  verdict they were made against.
* **A version is governance, not a deployment.** Only an approved design can
  record a version, versions are never overwritten, `supersedes` is recorded,
  rollback is retained and every published tool carries a next-review date.

**The honest limitation, stated in the product:** Forge shortens the distance
from an unmet need to a *reviewed specification*. It does not shorten the
distance from a specification to a maintained tool. Complex tools still need
engineering review, tests and maintenance, and a "tool" that is only a dashboard
over authorised data is the only kind this batch can prove end to end.

## Deferred, with the gate that blocks each one

Batch 2 used the same shape and for the same reason: a named gate is a plan, an
unnamed "later" is not.

| Concepts | Blocking gate |
|---|---|
| **Undo Everything** | The device State Engine (`nexus_device_state.py`) reports desired state and drift, but nothing retains the *previous value* of an arbitrary setting per change, with provenance, and nothing can check whether anything else has changed since. Undo needs captured before-values plus a dependency check and an explicit "this is irreversible" list. Until then it would be an undo button that promises more than it can restore — which the brief itself rules out. |
| **Preflight** | Depends on the same dependency graph with provenance as the consequence-engine concepts in batch 2, plus authoritative backup *restore* verification. Disk space, DNS and replication health are per-provider reads that each need their own integration acceptance. |
| **Nexus Last Known Human** | Buildable from existing records (`activity_logs`, ticket history, `change_management`) with no new store — the work is a scoped projection plus a consent rule for contacting a person. Ranked P2 rather than built now: it competes for the same contact-policy decision as Customer Memory Shield. |
| **Technician Radar** | **Already covered in part by shipped work locks** (`work_locks`, "before you touch it"), which prevent two technicians unknowingly working the same device. The genuinely missing pieces are visibility of scheduled `change_management` and `maintenance_windows` in the same panel. Merge into the existing fleet/device workspace; do not build a second collision system. |
| **Safe Experiment** | Needs reversible endpoint execution with automatic restoration, which is an Agent command capability with its own isolation and approval model. Overlaps Nexus Proving Ground (simulation) and the Phantom concept. Forge's `sandbox_plan` check is the design-time half; the runtime half is the gate. |
| **Permission Microscope** | Needs authoritative effective-access evaluation from identity providers and file systems with per-object ACL evidence. `m365_access_governance.py` measures tenant readiness and `permission_elevation.py` governs JIT access; neither answers "which rule denied this file operation". The brief's own distinction — verified evaluation versus inferred explanation — is the whole design constraint, so this stays a provider integration, not a Nexus-internal feature. |
| **Application Black Box** | Needs bounded endpoint capture (process, DNS, connection, token events) from an agent, and a consent/retention policy for it. The privacy boundary ("never record unrelated customer content") is a policy deliverable before a feature, exactly as batch 2 concluded for the customer-continuity concepts. |
| **Smart Maintenance Window** | `maintenance_windows` already owns the window; the differentiator needs authoritative backup-job schedules and customer operating patterns to evaluate impact. Rides along with the Recovery Confidence Map gate below. |
| **Technician Sandbox** | An isolated per-technician practice environment is infrastructure plus a licence/ownership decision, and the training half overlaps Nexus University (existing idea #356). Forge's sandbox plan requirement is the governed subset shipped today. |
| **Error Translator** | Needs OS build, process identity, permission and surrounding evidence joined to a specific operation. Feasible from existing records once the operation context is captured; ranked P2, and it must not become a generic "this error might mean" lookup — the batch's own point is that a generic explanation is worth little. |
| **Live Runbook** | Needs live environment reads while a runbook is followed, which is an Agent read capability (`nexus_agent_commands`) plus runbook versioning. The adaptive step must propose a correction for review rather than silently deviate, which is a change to the runbook contract, not a UI addition. |
| **Handover Simulator** | **Partly shipped already.** `GET /tickets/{id}/handover` is the scoped handover projection and the ticket Outcome Contract already refuses a close-out it cannot verify. The missing piece is the *missing-items gate* (no reproduction steps, expectation unrecorded, next action unclear) in the handover panel. Merge into the ticket workspace. |
| **Recovery Confidence Map** | Needs restore-verification evidence, not backup job success. Green jobs already exist; proving a business process is recoverable requires a recorded restore test per dependency chain (SQL, application configuration, authentication dependency). Gate: restore-test evidence retained against the business process, then the map is a projection of it. |
| **Nexus Mission Mode** | The largest claim in the brief and the one most likely to become a fourth parallel orchestrator. It needs a durable work object spanning tickets, devices, approvals, automation and time — with a declared owner for progress, evidence and interruption. Nexus already has the pieces it would aggregate (`nexus_investigate`, `mission_control` portfolio briefing, Proving Ground, Expected State, Change Management), so the gate is an explicit mission lifecycle contract and an ownership decision, not more endpoints. See the naming note in `docs/PLATFORM_PRIORITY_MAP.md`. |
| **Nexus Port Historian** | Needs authoritative switch/port/VLAN inventory over time (SNMP or controller APIs) with change attribution. There is no source of truth for switch-port state today. |
| **Nexus Certificate Detective** | Needs certificate inventory plus service, binding, dependency and renewal-ownership relationships. The first slice (expiry plus dependent services) is a plausible Forge design composed from existing capabilities; the dependency half needs the relationship graph with provenance. |
| **Nexus DNS Propagation Lab** | Needs authorised authoritative and recursive DNS queries against customer zones from selected locations — a network capability with its own access and rate policy, not a Nexus-internal join. |
| **Nexus Login Journey Recorder** | Needs identity-provider sign-in and Conditional Access ingestion (Entra first). This is batch 2's Authentication Journey gate, unchanged. |
| **Nexus Print Path Visualiser** | Needs print topology (application → spooler → driver → queue → server → device) that no current source records. Endpoint discovery telemetry is the prerequisite. |
| **Nexus Update Compatibility Gate** | Needs a customer-specific application/hardware dependency map plus update inventory. Application Manager, Third-Party Patching and Patch Compliance own the update half; the dependency half is the relationship graph again. |
| **Nexus Hardware Swap Assistant** | Buildable from existing asset, configuration and relationship records — the configuration transfer itself is the endpoint-execution half, so the guide can ship before the automation. Ranked P2; must not promise transfer of what it cannot read. |
| **Nexus Temporary Access Expiry** | **Mostly shipped.** `permission_elevation.py` already time-boxes approvals with auto-expiry, break-glass and session evidence; `nexus_access.py` owns the rotation register. The missing piece is a post-work review that revokes temporary privileges granted outside Nexus and reports the ones it cannot see. Merge into Nexus Elevate. |
| **Nexus Change Witness** | Needs an independent verification signal per approved change. The pre-rollout bench in the Proving Ground verifies a *candidate* before rollout; witnessing an executed change needs the outcome-contract verification kinds, which exist. Ranked P2 as an extension of Change Management plus Outcome Contract. |
| **Nexus Vendor Escalation Tracker** | Needs external vendor case ingestion (per-vendor API or mailbox parsing) and a diagnostic-evidence diff against it. A provider integration with its own sandbox acceptance, exactly as batch 2 concluded for Vendor Case Companion. |

## The five Forge-family follow-ons

| Concept | Disposition |
|---|---|
| **Nexus Forge (design requests)** | **Shipped this batch.** See above. |
| **Nexus Tool Evolution** | Deferred. It needs *sequences* of technician actions to notice that Certificate Detective is run after DNS diagnostics; the learned workspace ordering deliberately stores counts per target, not sequences, and stores no record identifiers. The gate is an explicit decision to retain ordered per-technician action sequences with a retention and privacy rule — a decision this batch declines to make on the user's behalf. The evidence it would consume (`nexus_forge_requests.versions` plus usage) already exists, so the feature is one decision away. |
| **Nexus Repair Exchange** | Deferred. Distributing signed tools between MSPs is a trust, signing and liability model before it is code: who reviews an MSP-authored tool, what a signature attests, how a customer's data is provably excluded, and who is accountable when a shared procedure damages a customer. An ownership decision with a security review comes first. |
| **Nexus Zero-Friction Workspace** | Deferred, with a concrete reason visible in the code: workspace composition already exists per browser (`useWidgetGrid`, localStorage), so a *shared* workspace needs server-side persisted workspace definitions, a capability/permission contract for every component that may be composed, and a tenancy model for sharing it with a colleague. That is an ownership decision plus a UI contract, and it is the honest prerequisite for anything Forge might later generate. |
| **Nexus Instant Lab** | Deferred with the Phantom gate: disposable, policy-controlled environments need infrastructure provisioning, isolation, expiry and destruction evidence. |

## How this batch would be proven worth further investment

Both shipped tools are measurable, and neither number is flattering by default:

1. **Forge: request → reviewed specification without engineering intervention.**
   If most honest requests end at `fail` or `needs_review`, the checks are too
   strict or the capability catalogue is too thin — either way that is the answer,
   not a reason to loosen the checks quietly.
2. **Forge: how many recorded versions someone actually uses.** A tool that is
   versioned and never opened should be re-reviewed and retired, not kept.
3. **Forge: whether the re-review interval is honoured.** Recorded versions carry
   a next-review date; an interval nobody honours is a false governance claim.
4. **Wish Engine: how many promotions came from two or more reporters.** A queue
   dominated by single requests means the threshold is wrong or the capture point
   is in the wrong workspace.
5. **Wish Engine: routing accuracy.** Whether the human disposition agreed with
   the suggested one is directly measurable; a suggestion that is usually
   overridden should be deleted, not explained.

Until those numbers exist, treat this batch's ranking as a strategy assessment.

## Verification

- `backend/tests/test_wish_engine.py` — 12 tests: signature stability, the
  disclosed similarity match, the lone-request privacy rule, cluster counts and
  span without identities, the promotion gate (no disposition, thin evidence,
  unsupported disposition, already promoted, too few reports), value-axis
  mapping, and tenant scope plus credential refusal on every route.
- `backend/tests/test_nexus_forge.py` — 15 tests: the route-grounded catalogue,
  server-side catalogue search, the privilege and credential refusals, unresolved
  and undeclared capabilities, mandatory scope/permissions/data classes, a fully
  passing design, a skipped specification, state-changing verification, duplicate
  and blast-radius review, version comparison and the never-overwrite gate, the
  approval rules (blocked on failure, acknowledgement when flagged), the version
  record and its `supersedes` chain, and tenant scoping.
- Frontend: 42 tests added — `lib/wishEngine.test.js`, `lib/nexusForge.test.js`,
  `WishEngineCard.test.jsx` and `ForgeDesignCard.test.jsx` — including that an
  unknown disposition, check status or verdict is never rendered as healthy, and
  that a request the server would refuse is refused before it is sent.
- The Python lint gate and the frontend lint run pass; the Control Plane
  foundation tab renders both cards between Friction Radar, the idea vault and
  the event backbone.
