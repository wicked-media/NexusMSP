# Nexus Invent, batch 2 — Dead End Detector and Support Debt

Scope: the second Nexus Invent concept batch (October 2026) — thirty proposed
inventions, of which the batch names five as strongest: Dead End Detector,
Support Debt, Reality Replay, The Missing Technician and Operational Antibodies.

**Two of those five shipped. Three did not, and this document says why.** The
source batch itself says not to implement all thirty indiscriminately, and the
controlling principle — *don't measure Nexus by how many tools it contains;
measure it by how many problems technicians no longer have to solve twice* — is
better served by two capabilities that are complete than by thirty that are
route registrations.

## What shipped

Both merged into a workspace that already owns the problem space. No parallel
destination was created.

| Tool | Merged into | Merged as | Backend |
|---|---|---|---|
| Nexus Dead End Detector | Ticket workspace, inside the **Outcome & flow** tab (Flow Intelligence) | A verdict section above Breadcrumb Rescue, built from the same breadcrumbs | `app/services/nexus_flow.py`, `app/routers/nexus_flow.py` |
| Nexus Support Debt | Cost-Per-Ticket workspace | A recurring-work card beneath the cost dashboard | `app/services/support_debt.py`, `app/routers/support_debt.py` |

Pure decision policy lives in the service modules and is tested directly. Tenant
and client scope, validation, audit and HTTP live in the routers. Frontend
presentation helpers are in `frontend/src/lib/flowIntelligence.js` (Dead End
Detector) and `frontend/src/lib/supportDebt.js` (Support Debt).

### 1. Nexus Dead End Detector

**Differentiator delivered:** a troubleshooting system that notices when the
*investigation* is going wrong, not just when the endpoint is broken.

- Built from the breadcrumbs a technician already records, so it needs **no new
  telemetry and no employee monitoring**.
- Reports that the investigation has stopped reducing uncertainty: repeated
  diagnostics (same test text, deduplicated to a shape), tests since the last
  conclusion, minutes investigating, and assumptions still open.
- Names which conclusions are unverified and whether every test came from one
  evidence source.
- Suggests **one different test** — change the evidence source, or test the
  remaining assumption directly — because the point is to change the input.

**Boundary enforced in code and asserted in tests:** the detector advises. It
does not decide the diagnosis, stop the technician, or claim the work so far was
wasted, and its response carries that sentence verbatim so a UI cannot invent a
stronger claim.

**Known limit:** it sees what the technician recorded. An investigation held
entirely in someone's head produces no verdict, which is the correct behaviour
(`insufficient_evidence`) rather than a guess.

### 2. Nexus Support Debt

**Differentiator delivered:** the recurring work an MSP performs *because a source
is still broken*, turned into a management figure.

- Groups tickets into work signatures from a normalised title shape — digits
  dropped (`SERVER03` and `SERVER04` share a shape), noise words dropped, word
  order irrelevant — keyed by **stable client ID**, never by client name.
- Joins the canonical ticket time entries to each signature and annualises the
  observed window.
- Reports hours always, and cost **only over entries that carry recorded value**,
  disclosing whether that basis is `complete`, `partial` or `none`.

**Boundary enforced in code:** Nexus never invents a labour rate. A signature with
no recorded value is reported in hours with `annual_cost: null` and says so in
the API response and the UI copy — `"$0 of avoidable labour"` and `"no rate was
recorded"` are different statements to a manager. Signature rows carry the
contributing ticket IDs so a human can check what actually matched, and nothing
here changes a customer record or a work pattern.

**Known limit:** a title-derived signature is fuzzy by nature — letters from an
asset code a technician typed (`prn` in `PRN-04`) survive and can split one
pattern into two, and an unrecognised recurrence is simply not reported. Both
failure modes are visible (the matched ticket IDs are returned), and the
documented fix is better labelling of recurring work, not a cleverer guess.

## What is deliberately deferred

None of the remaining twenty-eight is started.

### The other three "strongest" candidates

| Concept | Why it waits | What must exist first |
|---|---|---|
| **Nexus Reality Replay** | Reconstructing *what the technician could reasonably have known at each moment* — including gaps and later-discovered changes — needs a time-ordered evidence stream with source, confidence and observation time per fact. Nexus has a timeline (`nexus_timeline.py`) and an event backbone, but not per-fact provenance on the reads a reconstruction would use. | P0 #4 (event envelope at every mutation) and P0 #8 (freshness/confidence metadata on every stored fact), then an inert replay projection that marks gaps honestly. |
| **Nexus The Missing Technician** | Preserving the knowledge that leaves with an employee means extracting verified procedures from historical tickets, changes and documentation, and keeping them attached to the objects they describe. That is a knowledge-provenance programme, not a screen. | Verified-procedure extraction with evidence links, plus retention and redaction policy for departed-staff-authored content. |
| **Nexus Operational Antibodies** | Deploying a reviewed detection-and-response package to *other environments* is a blast-radius and change-control decision, and "safe response" must be provable. Shipping the registry before the deployment authority exists would create either a registry nobody can action or an unreviewed fleet-wide change. | A deployment authority with approvals, expiry and rollback evidence, built on the existing Proving Ground simulation ledger and the autonomy contract (P0 #6). |

### The other inventions

| Concepts | Blocking gate |
|---|---|
| Fix Fallout, Repair Side-Effect Map, Ticket Collision Detector, Work Collision Forecast | Need a relationship graph **with provenance** and change-time attribution (P0 #5 plus change evidence on the graph), so a consequence can be linked to the change that produced it instead of inferred from timing alone. |
| Customer Memory Shield, Customer Frustration Prevention, The Customer Who Never Calls, Zero-Question Support | Need consent-aware customer continuity: what Nexus may recall about a person, how it is redacted, and how it is scoped. The batch's own rule — never invent facts when identity or device mapping is uncertain — makes this a policy deliverable before a feature. |
| Technician Second Brain, The Technician Who Never Has to Ask Twice, Escalation Quality Gate, Support Passport, Escalation Packet | Depend on the assembled-context primitives (`nexus_investigate`, `nexus_fleet_shell`, Evidence Engine). Partially present; the per-technician operational memory needs a retention decision first. |
| False Fix Detector, Fix Expiry, Diagnostic Replay, Known-Good Library, Maintenance Debt | Need recurring-failure evidence keyed to a stable service/fault identity. Support Debt now supplies the recurrence half for *tickets*; the *per-service restart/recurrence* half has no authoritative source yet. |
| Reboot Negotiator, Service Dependency Doctor, Invisible Dependency Hunter, Network Path Memory, Driver Compatibility Radar, Software Conflict Investigator | Need discovery telemetry and a dependency graph with provenance. The batch's own distinction — inferred vs verified dependency — is the whole design constraint, so these stay Labs until the graph can carry it. |
| Authentication Journey, Update Autopsy, Vendor Case Companion | Need identity-provider, update-pipeline and external-case ingestion respectively. Each is a provider integration with its own sandbox acceptance, not a Nexus-internal feature. |
| Customer Promise Guardian, Escalation Quality Gate | Overlap existing SLA/timer and notification surfaces; the honest next step is a review of those workspaces, not a new tool. |
| All personality candidates from batch 1 | Still last, for the same reason: cheap, but they must never appear during a critical incident. |

## How this batch would be proven worth further investment

Support Debt makes an existing claim measurable, so the evidence is immediate:

1. **Avoidable labour eliminated** — the annual figure for one signature before
   and after the source is fixed. It is a management metric, so it either shrinks
   or it does not.
2. **Wall-clock time on difficult tickets** — Dead End Detector verdicts against
   time-to-verified-resolution, and whether the recommended different test
   changed the outcome.
3. **Adoption of the recommendation** — a suggestion that is never taken is a
   signal to remove the detector, not to explain it better.

Until those numbers exist, treat the batch's ranking as a strategy assessment.

## Verification

- `backend/tests/test_nexus_dead_end_detector.py` — 7 tests: verdict rules,
  the suggested different test, the advisory boundary, tenant partition and
  client-scope refusal on the route.
- `backend/tests/test_support_debt.py` — 10 tests: signature normalisation,
  recurrence threshold, the refusal to invent a rate, annualisation, cost basis,
  window handling, and tenant/client scope on the route.
- Frontend: 11 tests added across `lib/flowIntelligence.test.js`,
  `lib/supportDebt.test.js` and the two component render tests, including that a
  missing value is never rendered as `$0.00`.
- The Python lint gate (`python -m flake8 app server.py worker.py`) and the
  frontend lint run (`npx eslint src --ext .js,.jsx`) pass.
