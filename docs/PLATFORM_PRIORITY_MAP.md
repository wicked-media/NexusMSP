# Nexus Platform Priority Map

Ranked from every concept developed across the stabilisation, toolbox, insight and
certainty batches. This replaces the flat backlog. Future batches are planned from
**P1** (flagships) and the P0 architecture work they depend on — never from the
bottom of this file.

Tiers:

- **P0** — architecture decisions to get right *now*. Changing these later is
  expensive or impossible without a migration programme.
- **P1** — flagship differentiators. The moat. Hard to bolt on from outside.
- **P2** — modules. Valuable, buildable on top of P0/P1 primitives.
- **Labs** — promising but contingent (needs new data sources, customers, or trust).
- **Easter eggs** — the technician personality. Cheap, delightful, never blocking.

---

## The protocol era — above “Nexus runs MSPs”: Nexus as infrastructure

The 2026-10 vision escalation: the endgame is not an MSP product but the
infrastructure other technology businesses operate *through*. Vendors
implement the Nexus Protocol instead of bespoke integrations; certification
makes deep integration a purchasing preference; autonomous agents run under
Nexus identity, delegation and proof. The controlling question for every
build: **can Nexus own the control plane regardless of which technology
underneath wins?**

Shipped this batch — **Nexus Protocol v0.1** (`docs/NEXUS_PROTOCOL.md`,
`nexus_protocol.py`): 17 standard objects, 10 standard actions, the canonical
action descriptor (the P0 #1 contract), and Nexus Native certification —
eight dimensions evaluated from live adapter wiring and recorded evidence,
with gaps published. No bundled adapter is Nexus Native yet; that is the
honest state of the registry.

The audit — what the vision needs and what already exists:

| Vision piece | Grounding today | Verdict |
|---|---|---|
| Nexus Protocol | `nexus_connector` verbs + `nexus_objects` + this batch | 🆕 v0.1 shipped |
| Nexus Certified | `nexus_protocol` conformance + `agent_trust` | 🆕 v0.1 shipped |
| Service Identity | `agent_trust` (device certs, signed policy), `identity_utils` | grounded — needs workload/AI principals |
| Delegation / Agent Passport | `nexus_verify_execution` gate, laws, `action/scope_permissions`, decision objects | grounded — needs capability tokens + risk/spend limits |
| Agent Runtime / Capability Modules | `agent_runtime` + Go agent, `script_library_catalog`, `module_permissions` | grounded — module manifest is the next step |
| Edge Runtime / Fabric overlay / Private Network | none (network product) — note `nexus_fabric.py` is the graph read model; an overlay needs a new name (e.g. `nexus_overlay`) | Labs: genuine architecture programme |
| Promise Graph / Contract Compiler / Regulation Compiler | intents + controls + consequence engine + agreements | grounded — “promise → control → evidence” is buildable |
| Business Risk Graph / Board Intelligence / CFO / CIO / CTO / Negotiator | `core_relationships` graph, consequence engine, agreement margin, commercial records | grounded — advisory surfaces are buildable |
| Outcome Marketplace / Dynamic Vendor Routing | `nexus_connector` swap plans + `nexus_ledger` metering | primitives shipped; markets need transaction volume + consent |
| Cloud Exchange / Capacity Grid | `nexus_ledger` settlement + BYO backup vault | Labs: reliability, regulatory and security complexity |
| Agent Economy / Reputation Marketplace | ledger + verified outcomes (Prove It) | needs adoption and outcome volume |
| Data Escrow / Sovereignty / Policy Exchange | backup vault, tenant scope, laws | escrow buildable; sovereignty is a data-classification programme |
| Company Launch / Clone / M&A / Separation | intent OS + `nexus_switchboard` migration plans | grounded — estate diffing is the next step |
| Radar / IT Index / Predict | `nexus_genome` aggregates (k-floor 3) | needs cross-deployment scale + participation consent |

Planning rule for this era: protocol and certification are the wedge — every
other piece is only credible once actions flow through the descriptor, the
identity and the evidence store. Commerce and network products wait for real
transaction volume (the rule below still stands).

---

## The $1B thesis — Nexus is the operating network for managed technology

The filter changed (2026-10): the question is no longer "is this a feature MSPs
want?" but "does this create a network effect, an ecosystem position, or a
compounding moat?". Kaseya is racing on agentic IT management with 17M+ endpoints
of aggregated intelligence; NinjaOne on autonomous patching. "RMM + PSA + AI but
better" loses. The endgame: RMM/PSA is one workload running on Nexus — a network
of MSPs, businesses and vendors over the Nexus Graph, Intelligence (IT Genome),
Intent OS, Autonomy, and Guardian/Verification, monetised through Services,
Commerce, Trust and Labour.

Moats that design targets: data (Genome), network (more MSPs → better
intelligence), marketplace (two-sided), automation (verified outcomes improve
recipes), trust (accumulated evidence), financial (billing plumbing), labour
(shared capacity), switching (Nexus holds the operational intent/history).

### The eight network primitives

Today's architecture must contain the primitives those businesses need later.
Status after this batch:

| Primitive | Status | Lives in |
|---|---|---|
| Universal object graph | ✅ solid (P0 #5) | `core_relationships.py` (provenance edges, `client_core_graph`), `nexus_objects.py` |
| Entitlement system | ✅ solid | `action_permissions.py`, `scope_permissions.py`, `module_permissions.py` |
| Evidence model | ✅ solid (P0 #2/#6) | `nexus_verify_execution.py`, hash-chained `event_backbone.py`, Prove It |
| Intent model | 🆕 shipped | `nexus_intent.py` — record/suggest/evaluate; drift verdicts never faked |
| Privacy-preserving aggregate intelligence | 🆕 shipped | `nexus_genome.py` — one-way fingerprints, k-anonymity floor 3, lift vs baseline |
| Vendor abstraction layer | 🆕 shipped | `nexus_connector.py` — 14 capability verbs, 7 adapters, coverage, translate, swap plans |
| Metering | 🆕 shipped | `nexus_ledger.py` — idempotent usage meter events with dimensions |
| Transaction ledger | 🆕 shipped | `nexus_ledger.py` — hash-chained double-entry, statements, supplied-rate revenue share |

Honesty boundaries kept: the connector plans vendor operations but does not
execute them; Genome aggregates never surface clusters below the k floor; ledger
rates are supplied, never invented; intent verdicts are `unverified` when the
evidence does not exist.

### The 25 network ideas, re-filtered

| # | Idea | Already in Nexus | Still needed | Tier |
|---|---|---|---|---|
| 1 | Global IT Exchange | Genome primitive (patterns, emerging issues, lift) | cross-deployment aggregate pipeline + participation consent | P1 |
| 2 | IT Genome | `nexus_genome` (this batch) | scale + global pool | P1 |
| 3 | Autonomy Network | Laws gate, Guardian, verified execution, consequence engine | agent orchestration over the autonomy contract (P0 #6) | P1 |
| 4 | Intent OS | `nexus_intent` (this batch) | execution planners per control family | P1 |
| 5 | Digital Company Twin | `core_relationships` graph, dependency horizon | process/data/contract layers on the graph | P1 |
| 6 | Business Simulator | consequence engine (v1) | twin completeness + scenario algebra | P2 (on #5) |
| 7 | Autonomous Migration Engine | `nexus_switchboard` migration plans | RMM/tenant/backup translators | P1 |
| 8 | Universal Connector | `nexus_connector` (this batch) | real adapter execution behind the verbs | P1 |
| 9 | Vendor-independent MSP | swap plans + coverage risk flags | live dual-run + parity evidence | P1 |
| 10 | Marketplace economy | metering + ledger primitives (this batch) | vendor publishing + provisioning automation | P2 |
| 11 | Clearing House | ledger (double-entry, hash chain) | wholesale agreements + consolidated invoicing | P2 |
| 12 | Procurement Exchange | procurement/supplier scorecard modules | distributor APIs + RFQ engine | P2 |
| 13 | Autonomous FinOps | agreement margin, licence reclamation, cost views | cross-cloud spend ingestion + savings ledger | P1 |
| 14 | Insurance Engine | Prove It / audit readiness / evidence model | insurer partnerships + actuarial trust | Labs |
| 15 | Trust Passport | evidence model + confidence report | portable customer-controlled sharing | Labs |
| 16 | Questionnaire killer | evidence model | high evidence coverage + question mapping corpus | Labs |
| 17 | Machine Trust Network | evidence model | bilateral verification protocol + adoption | Labs |
| 18 | Autonomous Compliance | compliance modules + evidence reports | continuous control→evidence mapping | P1 |
| 19 | AI Employee IT Layer | chat, ticket intelligence, intent model | safe request→approval→provision autonomy | P2 |
| 20 | Zero-Ticket Enterprise | — | the metric target of #19, not a build | Labs (target) |
| 21 | MSP-in-a-Box | most modules exist | packaging + onboarding flow | P2 |
| 22 | Franchise/Network | — | verified partner graph + routing + settlement (ledger) | P2 |
| 23 | Technician marketplace | skills matrix, trust scores | vetting, escrow, access brokerage | P2 |
| 24 | Capacity Exchange | — | partner capacity listings + settlement | P2 |
| 25 | Autonomous MSP | commander, consequence, laws, verified execution | the whole autonomy stack matured | P1 (endgame) |

Planning rule: P1 network items only start when their primitive row above is
solid. Commerce items (10–12, 21–24) wait until metering + ledger have real
transaction volume behind them.

---

## P0 — architecture decisions to get right now

| # | Decision | Why it will hurt later |
|---|----------|------------------------|
| 1 | **Canonical action descriptor + consequence contract.** One schema for every proposed action: actor, target (Nexus ID), scope, destructive?, reversible?, autonomy level, verification plan, rollback. Laws, Guardian, Consequence Engine, approvals, audit and automation all consume it. | If each feature invents its own action shape, the Laws evaluator, four-eyes approvals and audit trail can never be unified — and the Consequence Engine (the moat) becomes five disconnected toys. |
| 2 | **Evidence/attestation store.** Append-only, tenant-scoped, retention-aware records of `claim → evidence → verdict → freshness → responsible party` (the Prove It shape). Every "healthy", "verified", "compliant" claim in the product must be renderable from this store. | Retrofitting evidence onto a product that already prints green badges means choosing between lying to customers or rewriting every surface. |
| 3 | **Explicit tenant markers everywhere.** Migrate legacy unmarked documents off the `nexus-local` partition escape hatch; one datum, one tenant, always on the document. | The permissive legacy partition is a latent cross-tenant leak. The longer it exists, the larger the migration and the higher the incident risk. |
| 4 | **Event envelope for the timeline.** Canonical `who/what/when/where/why` schema with source system, actor, object IDs, and ingest points at every mutation. The universal timeline becomes a read of this stream, not ad-hoc unioning. | Rebuilding timeline/search/audit/flight-recorder on a proper event core later means touching every writer in the codebase. |
| 5 | **Relationship graph schema with provenance.** Every edge (device→switch→firewall→WAN→ISP, host→VM→app→user, UPS→host) carries `source`, `confidence`, `observed_at`. Populated by discovery *and* zero-click documentation; never by stale Visio. | The Consequence Engine, diagrams, blast radius and "what dies if this dies" all read this graph. A graph without provenance becomes the 2023 Visio diagram everyone stops trusting. |
| 6 | **Autonomy contract.** Autonomy levels (observe → suggest → act-with-verification → act), mandatory post-action verification, rollback records, and a hard rule that unverifiable outcomes are never claimed as fixes (Law 9). | Bolting verification onto automations after they exist means an estate of automations nobody trusts and nobody can safely widen. |
| 7 | **Human-decision object family.** Approvals, consent receipts, risk acceptances and decision log share one lifecycle: `proposed → reviewed → decided → review-due → expired`. Four-eyes and "we told you" are reads over this family. | Separate approval/consent/risk tables can't answer "who accepted what risk, when does it expire, and what happened next" — which is exactly the governance product. |
| 8 | **Freshness/confidence metadata on every stored fact.** `observed_at`, `source`, `confidence` conventions (the certainty-layer shape). | Without it, "facts decay" stays a demo. With it, every module gets self-correcting data for free. |

---

## P1 — flagship differentiators (the moat)

Built on P0 primitives; each is hard for a competitor to bolt on afterwards.

1. **Nexus Consequence Engine** — "what does clicking this button *mean* to the
   business?" (v1 shipped this batch from live data; grows with the graph).
   Powers: Can I Delete/Reboot/Disable/Remove/Change/Retire/Cancel This?
2. **Nexus Proof** — customer-facing evidence: control → evidence → history →
   verification → responsible party. Audit Readiness Pack (shipped) is its v1.
3. **Nexus Laws** — shipped: 9 invariants + custom laws + deterministic gate.
   Grows: per-target windows, approval laws wired to the decision-object family.
4. **Nexus Detective** — evidence board, Challenge Nexus, Attempt-to-Disprove,
   Second Opinion. Needs the independent reasoning pass; confidence layer (shipped)
   is its inspectability backbone.
5. **Truth Engine** — cross-source reconciliation ("why do these numbers differ?").
   Blocked on P0 #4/#5 plus source connectors (RMM/EDR/identity/billing).
6. **Morning Commander / End My Day** — shipped v1: Nexus decides what matters
   today, and what you must not leave behind.
7. **Self-organising work queue** — difficulty, gravity and escalation preflight
   shipped as parts; the queue re-ranking itself is the flagship form.
8. **Commercial brain** — decision log + risk acceptances + "We Told You" shipped
   this batch; agreement margin shipped earlier; vendor bill auditing joins next.
9. **Safety UX layer** — Writing Guard, cross-customer leak prevention ("this
   content references Contoso, you are replying to ACME"), Wrong-Customer
   Protection, four-eyes with real diffs. Security differentiator, customer-trust
   critical.
10. **Collective memory** — Nexus Memory (shipped), Already-Tried-That,
    don't-ask-the-customer-again, Context Capsules for handovers.

## P2 — modules (build on the primitives)

- Automation debt meter, Micro-Automations ("you've done this three times"),
  Watch-me-do-it → Recipe drafts (trigger/preconditions/steps/verification/
  failure/rollback — *verification and rollback are P0 #6, so recipes slot in*).
- Process mining, bottleneck finder, "where did today go?" (technician-private),
  friction map (improves Nexus itself).
- FCR failure-reason intelligence, customer patience meter, No Ping-Pong,
  Promise Time, Don't-make-me-chase-you timers.
- Explain This Customer / Explain Like I'm Taking Over (context capsules feed these).
- Automatic live diagrams + "draw me this customer" (reads P0 #5).
- Procurement price memory, stock scavenger, licence scavenger,
  "what can we cancel?", vendor margin-leak reports.
- Accessibility preferences in support flows, customer Safe Mode during majors.
- "What permission do I actually need?" + scoped temporary-access requests.

## Labs (contingent — needs data, customers, or trust)

- Nexus Chaos Testing / Fire Drill / Restore Roulette (needs isolated restore
  environments and change windows; Prove It already reports the gap honestly).
- Anonymised cross-MSP benchmarking (needs privacy architecture and volume).
- M&A / acquisition onboarding mode (needs import pipelines + credential transfer).
- Carbon/energy view (needs power telemetry; only measurable data, no greenwashing).
- Travel optimisation, trunk inventory, custody-chain scanning (needs mobile).
- Lost-device mode (needs per-platform isolate/lock agent commands).

## Easter eggs (the identity — cheap, never blocking)

Shipped: urgency punctuation vs severity, "Narrator: somebody changed something.",
definition-of-insanity threshold, Technician Presence Effect, "Forgotten by God"
uptime museum, 🦖 prehistoric uptime, hope-based storage, Friday-4:58 Law windows.
Queued: Schrödinger's IT Problem (problem existed until observed by technician),
"the customer restarted it" (unexpected collaboration), ticket title translator
(HELP!!!!!! → unable to print), "have you saved your work?" pre-reboot check,
device-name critic (DESKTOP-NEW created 2019, SERVER-FINAL, TEST-PC hosting
payroll), rubber-duck diagnosis, "bet you $5 it's DNS" predictions.

---

## Where the shipped batches live

| Batch | Tier home |
|---|---|
| Tech toolbox, shift intelligence, work locks, handover | QoL / P1 (#6, #7 partial) |
| Insight layer (baselines, anomaly explorer, timeline, search, sidecar, debt) | P0 #4/#8 groundwork, P1 #7 |
| Certainty layer (unknowns, Prove It, confidence, laws, noise, readiness) | P0 #2/#8, P1 #2/#3 |
| This batch (consequence engine, commander, decision/risk memory) | P1 #1/#6/#8 |
| Network primitives batch (intent, genome, connector, metering + ledger) | $1B thesis primitives — intent (#4), genome (#1–2), connector (#8–9), commerce (#10–11) |
| Protocol batch (Nexus Protocol v0.1, Nexus Native certification) | Protocol era — spec, action descriptor (P0 #1), conformance |

**Planning rule:** each batch ships one flagship step *and* strengthens a P0
primitive. Features from P2 appear only when they ride along for free.
