# Nexus Product Constitution

Last reviewed: 2026-08-09  
Applies to: every Nexus product, module, integration, automation, report and AI capability.

## Purpose

NexusMSP is not a collection of MSP screens. It is the evidence-led control plane an MSP uses to understand, operate, protect and commercialise a customer's technology.

The product must make a technician's next safe action clearer, reduce manual glue between systems, and connect technical work to a verified customer or business outcome.

## Product invariants

1. **One operating model.** Client, site, person, identity, device, service, contract, ticket, project, invoice, integration and evidence use canonical references. A new capability must not create an unlinked copy of these objects.
2. **Evidence before assertion.** Nexus distinguishes observed fact, correlated lead, recommendation, prepared plan, approved action and verified outcome. A route or card is never evidence of a provider-backed capability.
3. **Human authority remains explicit.** Autonomy is governed by client scope, role, confidence, action allow-list, approval, maintenance window and rollback boundary. Emergency access is time-bound and reviewed.
4. **Verified Operations is the delivery loop.** Every material workflow should progress through: **Detect → Understand → Act → Verify → Document → Bill → Learn**. If verification is unavailable, the workflow must say so.
5. **One outcome, not one more dashboard.** New work must improve at least one of: time saved, risk reduced, confidence increased, customer value proved or revenue protected.
6. **Integrate; do not imitate.** Nexus abstracts supported vendors behind provider contracts. It does not claim to replace a provider until the necessary security, support, recovery and operational evidence exists.
7. **Secure by structure.** Tenant isolation, scoped permissions, audit, retention, secrets handling, data residency and safe failure are design inputs—not later hardening tasks.
8. **Calm, direct experience.** Every workspace answers what needs attention, what changed, why it matters and the next accountable action. Motion and AI assistance are purposeful, optional and accessible.

## Capability admission gate

No idea becomes active implementation merely because it is attractive or competitive. It enters the Master Capability Register first and must name:

- the customer problem and expected measurable outcome;
- canonical objects and provider contracts it uses;
- required permissions, tenant scopes, audit events and data-retention implications;
- verification, rollback and failure behaviour;
- commercial source of truth and billing effect where relevant;
- the release gate, test plan, operator documentation and accountable owner.

If a capability cannot satisfy these fields, it remains `Discovery required` or `Architecture required`.

## Prioritisation scorecard

Score each candidate from 1 (low) to 5 (high), then record the reasoning in the capability register or idea evidence:

| Dimension | Question |
|---|---|
| Customer demand | Does it remove a repeated, expensive MSP or customer problem? |
| Competitive moat | Does shared Nexus context make it meaningfully harder to copy than a standalone tool? |
| Outcome / revenue | Can it prove value, reduce risk, protect margin or create a sellable service? |
| Foundation fit | Does it reuse canonical objects, events, permissions and provider contracts? |
| Delivery confidence | Can Nexus prove it safely with the current team, dependencies and release gates? |

High demand alone is not enough. A candidate cannot bypass Release 1 safety, tenancy or recovery gates simply because it scores well commercially.

## Autonomy contract

Nexus uses the Autopilot autonomy ladder across all products:

| Level | Nexus may |
|---|---|
| 0 — Observe | Retain and show evidence. |
| 1 — Recommend | Propose a bounded next action with rationale. |
| 2 — Prepare | Build a change plan or simulation and wait for approval. |
| 3 — Execute | Perform approved low-risk actions within policy. |
| 4 — Resolve | Diagnose, remediate, verify, document and close routine, explicitly allowed work. |
| 5 — Optimise | Improve toward declared business and technical objectives; future capability only. |

The effective level is always the lower of platform policy, MSP policy, client policy, action risk and current evidence confidence.

## Safety Kernel

All material mutations—whether requested by a technician, AI, automation, API client or future marketplace extension—must cross the same Safety Kernel. No caller may bypass it.

The kernel evaluates, records and enforces:

- actor identity, role, tenant/client scope and current elevation;
- action risk classification, explicit permission and provider capability;
- target count, blast-radius limit, velocity limit and idempotency key;
- maintenance window, change freeze, active incident and recovery constraints;
- approval, four-eyes, re-authentication and emergency-access requirements;
- preflight evidence, rollback limits, postflight verification and durable audit/event records.

Platform-wide emergency pause must stop autonomous mutations immediately while preserving monitoring, recommendations and audit visibility. This is an architectural requirement; it is not a claim that every current provider action is already reversible.

## Architecture contract

Every new Nexus capability is designed against these seven questions:

| Contract | Required question |
|---|---|
| API-first | Can an authorised system perform the same supported operation through a stable contract? |
| Event-first | Does Nexus emit a scoped, attributable event when meaningful state changes? |
| Policy-first | Can the desired behaviour, scope and exception be declared rather than hard-coded? |
| Evidence-first | Can Nexus show source, freshness, confidence and the basis for its assertion? |
| Automation-ready | Can repetitive work be prepared or executed without bypassing the Safety Kernel? |
| Safe failure | Are timeout, retry, idempotency, rollback and degraded-mode behaviours explicit? |
| Intelligence-ready | Can permitted Nexus evidence improve explanation or recommendation without fabricating certainty? |

### Scale, residency and resilience target

Nexus currently operates as a unified product platform. Its destination architecture must support logically isolated tenant cells, regional data residency, per-tenant fairness and a separation between policy/control work and high-volume data work. These are target constraints, not a claim that multi-region cells or sovereign deployments already exist.

Agents and future Edge Nodes must be able to retain signed, expiry-bound work locally, queue telemetry safely and reconcile idempotently when connectivity returns. A broad outage must degrade Nexus safely rather than duplicating or silently losing material actions.

### Truth and provenance

Nexus never silently resolves disagreements between systems. Every material value should retain its source, observed time, confidence and, where applicable, authoritative-source policy. When sources conflict, Nexus must surface the conflict or follow an approved resolution policy.

## Intelligence model

Nexus does not build separate intelligence silos. It composes six explainable lenses over the same permitted objects, graph, policy, event and evidence contracts:

| Layer | The question Nexus answers |
|---|---|
| Operational intelligence | What is happening now and who owns the next action? |
| Technical intelligence | What changed, which dependencies are involved and what is the supported hypothesis? |
| Security intelligence | Is there risk, exposure, policy deviation or a required containment decision? |
| Business intelligence | Which people, processes, commitments and customer outcomes are affected? |
| Commercial intelligence | What does delivery cost, what is billed, what is at risk and what value is evidenced? |
| Autonomous intelligence | What may Nexus safely prepare, execute, verify or escalate within its effective autonomy level? |

Each lens must expose its source evidence, uncertainty and route to the accountable operating record. Correlation is a lead, not proof of causation; estimates remain visibly distinct from recorded financial results.

### Readiness and completeness

Readiness answers whether a declared operation can safely proceed. It is based on an explicit checklist of required scope, relationships, evidence, approvals, timing, rollback and verification—not an opaque score.

Completeness answers whether Nexus knows enough about an object to operate it reliably. It measures required identity, ownership, relationship, documentation, recovery and commercial fields for that object type. Missing inputs must be visible and actionable; they are never silently treated as healthy.

## Decision order

1. Protect Release 1: tenant isolation, identity, agent trust, remote safety, billing integrity, observability and recovery proof.
2. Complete vertical MSP workflows using the shared foundation.
3. Expand the Control Plane through provider adapters and desired-state policies.
4. Add intelligence only where it can cite permitted evidence and use the same action guardrails as a technician.
5. Develop category products only after their operating, commercial and support model is proven through a controlled pilot.

## Portfolio hierarchy

Every candidate in the Master Capability Register belongs to one portfolio tier. The tier decides when it can receive active engineering investment; it does not change the production evidence standard.

| Tier | Purpose | Examples |
|---|---|---|
| **Nexus Core** | Makes every other capability safe, connected and operable. | Tenancy, canonical objects, permissions, events, audit, agent trust, recovery, observability. |
| **Differentiators** | Makes Nexus the daily operational control plane rather than another PSA/RMM. | Universal search and inspector, Control Plane, desired state, Verified Operations, relationship/work graph, change guardian, autonomy. |
| **Revenue engines** | Turns verified operations into defensible commercial value. | Service-delivery verification, billing reconciliation, Value Proof, contract intelligence, service designer, lifecycle intelligence. |
| **Enterprise requirements** | Enables larger and regulated customers without weakening control. | Four-eyes approval, break glass, data residency, evidence chain, hierarchy, sovereignty, vendor risk. |
| **Category bets** | Builds new products only once their shared operating model is proven. | Assurance, Data Governance, Application Manager, Edge Node, Customer Twin, Trust Centre. |
| **Research / moonshots** | Explores future network effects or hardware with a separate hypothesis and budget. | Federation, Problem Exchange, autonomous optimisation, agent mesh, certification lab. |

### Feature gate

Before a candidate moves from `Captured` to active development, the owner must answer yes to at least one of the following and name the measurable result:

- Does it materially increase switching motivation or retention?
- Does it create or protect recurring revenue?
- Does it safely reduce repeated technician effort?
- Does it improve customer trust or prove delivered value?
- Does it create a defensible platform advantage from shared Nexus data and workflow context?

It must also identify its tier, foundation dependencies, autonomy boundary and verification method. A “yes” to customer demand alone is insufficient.

## Working agreement

- The [Master Capability Register](NEXUS_MASTER_CAPABILITY_REGISTER.md) is the authoritative inventory and release status.
- The [Implementation Roadmap](NEXUS_IMPLEMENTATION_ROADMAP.md) is the sequencing and release-gate plan.
- The Nexus Ideas registry is an inbox, not a promise. `Captured` never means approved, funded, scheduled or released.
- Every meaningful release updates its capability evidence in the same change.
- If an item is intentionally deferred, retain the decision and reason rather than silently losing it.

## Product north star

Nexus is successful when an MSP can state an outcome—secure this customer, prepare this employee, restore this service, bill what we deliver—and Nexus safely coordinates the connected systems, proves the result, preserves the knowledge and escalates only the judgement that still needs a human.
