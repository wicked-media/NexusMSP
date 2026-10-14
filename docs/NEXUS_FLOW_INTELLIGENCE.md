# Nexus Flow Intelligence — the first Nexus Invent batch

Scope: the Nexus Invent concept batch (October 2026) — ten proposed inventions,
fifteen research-backlog concepts and a technician-personality layer. This
document records what was actually built, where it was merged, what is
deliberately deferred, and the honesty boundaries the code enforces.

The batch names **Friction Radar + Outcome Contracts + Breadcrumb Rescue** as the
first thing worth pursuing, because together they improve *how an MSP works*
rather than adding another way to manage devices. That is the slice delivered
here. Nothing else in the batch has been started.

**Promotion policy still applies.** A concept becomes roadmap work only with
dependencies, evidence, an owner and a release gate (`app/services/nexus_ideas.py`).
Shipping one slice is not an adoption decision for the other twenty-four.

## What shipped

Everything ships **inside a workspace that already owns its problem space**, per
`docs/ROADMAP_MERGE_REVIEW.md`. No parallel destination was created.

| Tool | Merged into | Merged as | Backend |
|---|---|---|---|
| Friction Radar | Nexus Control Plane (beside the Idea Vault) | A friction-evidence and proposal-review card | `app/routers/nexus_flow.py`, `app/services/nexus_flow.py` |
| Outcome Contract | Ticket workspace | A new **Outcome & flow** ticket tab | same |
| Breadcrumb Rescue | Ticket workspace | The same **Outcome & flow** tab | same |

Pure decision policy is isolated in `backend/app/services/nexus_flow.py` and
tested directly, mirroring `roadmap_tools.py`. Tenant-safe reads, audit events and
HTTP validation live in `backend/app/routers/nexus_flow.py`.
Frontend presentation helpers are in `frontend/src/lib/flowIntelligence.js`.

### 1. Friction Radar

**Differentiator delivered:** Nexus measures the steps *between* opening a ticket
and resolving it, from evidence it already holds.

- Reads the aggregate counters every workspace already records through learned
  workspace ordering (`workspace_learning_signals`) — it records **no new
  telemetry**.
- Derives two detections from that evidence alone: the same concept reached from
  two or more workspaces (`repeated_navigation`), and one screen carrying most of
  a workspace's repeats (`concentrated_usage`).
- Converts repeats into a monthly estimate **only** when the evidence spans a
  usable window (≥ 7 days) and the window is disclosed. Otherwise it reports the
  count and says no rate is claimed. `SECONDS_PER_REPEAT = 8` is a stated,
  conservative assumption, not a measurement.
- A proposal is **proposed**, then **approved or rejected by a human** with a
  required review note. Nexus never publishes a workflow change itself.

**Boundary enforced:** aggregate counts only. The response carries no user,
client, record or session detail, and no ranking of individuals exists anywhere
in the API.

### 2. Outcome Contract

**Differentiator delivered:** the requested outcome is separated from the
technician's chosen method, and a ticket cannot claim the outcome on a command's
exit code.

- A contract states the business outcome, preconditions, dependencies,
  acceptable interruption, verification method, rollback and an evidence
  validity period.
- Six machine checks run against it. An outcome that is really an instruction
  ("Restart the MYOB service") fails the *outcome is not a method* check, so the
  contract stands at `insufficient` and can verify nothing.
- Standing is `insufficient → unverified → verified → expired`. Verification
  requires a declared kind plus a real observation note; evidence expires.
- `closeout_gate` refuses a resolved claim while the standing is anything but
  `verified`, and its refusal reason is what the UI shows.

### 3. Breadcrumb Rescue

**Differentiator delivered:** the technician's *reasoning state* is restored, and
the conclusions the record has moved past are named.

- Records typed breadcrumbs (hypothesis, tested, ruled out, finding, next step,
  change) against a ticket and a device/client scope reference.
- On resume it reconstructs what was being tested, what was already ruled out,
  open hypotheses and the next step.
- It flags a conclusion `possibly_stale` when a change landed on the same scope
  after it was formed, and `age_stale` when there is no change evidence and the
  conclusion is older than the freshness window. An old conclusion is never
  silently trusted.

## Honesty boundaries

- Friction Radar never fabricates a saving, never records arbitrary employee
  activity, and never ranks people by speed. It optimises product workflows,
  not individuals.
- No tool executes anything on an endpoint.
- Free text in every Flow Intelligence field is refused when it looks like
  credential material, on the server **and** in the client.
- A `verified` outcome is a claim backed by a recorded observation with an
  expiry — never inferred from a successful command.
- The route descriptors, not the UI, decide scope: every read and write is
  partitioned by the authenticated Nexus platform tenant, and ticket-scoped
  routes re-check the caller's client scope server-side (`_client_visible`).

## What is deferred, and why

None of these are started. Each needs the gate named in the column.

| Concept | Why it waits |
|---|---|
| Nexus Phantom | Needs isolated Windows VM reconstruction, licensing and representative-clone guarantees. Feasibility 2/5 in the batch's own assessment; a separate architecture programme. |
| Dependency Negotiator | Needs a dependency graph with provenance (P0 #5) plus negotiated execution windows; the graph exists, the protocol does not. |
| Zero-Question Support | Needs reliable identity/device mapping before it may ask fewer questions; the batch itself says never invent facts when the mapping is uncertain. |
| Repair Warranty | Needs an agreement/billing treatment decision and an MSP policy model, not only a timer. |
| Reality Check | Needs independent synthetic probes and customer-specific observation, plus a vendor-status ingestion contract. |
| The remaining backlog concepts | Symptom Fingerprint, Evidence Debt, Work Collision Forecast, Customer Reality Gap, Fix Expiry, Silence Detector, Support Passport, Assumption Register, Diagnostic Budget, Peripheral Passport, User Experience Contract, Repair Conflict Detector, Escalation Packet, Technician Continuity, Automation Regret — all need evidence sources or partner data Nexus does not yet ingest. |
| The personality layer (Ghost in the Machine, Coffee Preservation Protocol, Printer Exorcism, Legendary Fix, Fortune Cookies, Retro Helpdesk Mode) | Deliberately last. Cheap, but they must never appear during critical incidents; they should ride along with a functional batch rather than lead one. |

**Not claimed:** this document does not assert that nobody has conceived or
patented a similar capability. That requires the separate competitive and
intellectual-property review named in the source concept document.

## How this would be proven worth further investment

The batch proposes a 90-day discovery programme. The evidence this slice can
supply, without new instrumentation:

1. **Time to verified resolution** — `closeout_gate` state and verification
   timestamps per ticket.
2. **Repeated work and reopen rate** — Breadcrumb Rescue staleness events and
   whether a returning technician resumes rather than restarts.
3. **Adoption of friction proposals** — approved vs rejected proposals and the
   measured repeat rate of the target after a change lands.

Until those numbers exist, treat the ranking in the source document as a
strategy assessment, not a measured result.

## Verification

- `backend/tests/test_nexus_flow.py` — 16 tests: pure policy for friction
  estimation and windows, contract status and gates, breadcrumb staleness, plus
  every route's tenant and client-scope boundary.
- `frontend/src/lib/flowIntelligence.test.js` — 9 tests for the presentation
  helpers, including that an unknown status is never rendered as healthy.
- The Python lint gate (`python -m flake8 app server.py worker.py`) passes.
