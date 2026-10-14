# The Nexus Protocol

**Status:** v0.1-draft · living specification · implemented by
`backend/app/services/nexus_protocol.py`

The Nexus Protocol is how third-party technology speaks Nexus. A vendor that
implements the protocol does not "integrate with Nexus" in the ad-hoc sense —
their product becomes compatible with Nexus automation, billing, Guardian,
Proof, Graph and AI, because those systems all consume the same standard
objects and standard actions.

This document is the specification. The service module is the executable
registry and conformance evaluator; if the two ever disagree, the code is the
behaviour and this file is corrected.

---

## Design rules (inherited from the platform)

1. **Stable Nexus IDs only.** Relationships between protocol objects use
   `tenant_id`, `client_id`, `site_id`, `device_id`, `ticket_id` and the other
   Nexus IDs — never names, emails, hostnames or mutable vendor identifiers.
2. **Freshness metadata on every fact.** Objects carry `observed_at`, `source`
   and `confidence`. A fact without provenance is a claim, not a fact.
3. **Nothing unverified is ever claimed as verified.** Conformance verdicts are
   `verified`, `partial`, `unverified` or `declared`. A vendor's self-declaration
   is `declared`, never `verified`.
4. **Plans are not execution.** Protocol actions are described, validated and
   authorised; executing them through a vendor adapter is a separate, verified,
   auditable step.
5. **Every action is attributable.** Actor, target, scope, authority and
   verification outcome are always recorded (Service Identity groundwork).

---

## 1. Standard objects

Every protocol object has a canonical kind, a stable Nexus ID field, required
identity fields, and the freshness metadata above.

| Kind | Stable ID | Core fields | Authoritative store today |
|---|---|---|---|
| `device` | `device_id` | hostname, client_id, site_id, os, state | `devices` |
| `user` | `user_id` | name, email, client_id, roles, status | `users` |
| `identity` | `identity_id` | principal, provider, subject_ref, mfa_state | `users`, M365 records |
| `service` | `service_id` | name, client_id, sla, state | `contracts`, `services` |
| `application` | `application_id` | name, version, device_id/client_id, state | `applications` |
| `incident` | `ticket_id` | title, severity, state, client_id | `tickets` |
| `risk` | `risk_id` | statement, severity, owner, review_due | `risk_acceptances` |
| `control` | `control_id` | kind, scope, intent_id, verdict | `nexus_intents`, laws |
| `licence` | `licence_id` | product, seats, assigned, renewal | M365/licence records |
| `subscription` | `subscription_id` | product, quantity, term, meter | `agreements`, `usage_meter_events` |
| `contract` | `contract_id` | client_id, terms, promises, renewal | `contracts` |
| `invoice` | `invoice_id` | client_id, amount, state, period | `invoices` |
| `evidence` | `evidence_id` | claim, verdict, freshness, responsible | evidence/verify records |
| `change` | `change_id` | target, plan, state, approval | `change_management` |
| `backup` | `backup_id` | source, job, restore_verified_at | `backup_jobs`, `device_events` |
| `network` | `network_id` | site_id, segment, dependencies | `core_relationships` edges |
| `vendor` | `vendor_id` | name, adapters, agreements | `integrations`, procurement |

A conforming implementation MUST identify objects by their Nexus ID in every
action it accepts or emits, and MUST carry the freshness triple
(`observed_at`, `source`, `confidence`) on observed facts.

## 2. Standard actions

Ten canonical verbs. Everything an integration does maps to one of them.

| Action | Meaning | Mutates | Requires verification | Existing platform home |
|---|---|---|---|---|
| `observe()` | read state into Nexus with provenance | no | freshness | insight layer, telemetry |
| `diagnose()` | explain state / probable cause | no | honest unknowns | certainty layer |
| `deploy()` | provision new capability | yes | post-deploy verify | connector plans |
| `configure()` | change settings toward intent | yes | drift re-evaluation | Intent OS |
| `isolate()` | restrict blast radius | yes | access re-check | Guardian, connector verbs |
| `restore()` | recover to a known state | yes | restore verification | Prove It, backup |
| `verify()` | gather evidence of a claim | no | — | `nexus_verify_execution` |
| `bill()` | record commercial consequence | yes | ledger balance | `nexus_ledger` |
| `approve()` | record human authority | yes | decision lifecycle | decision objects (P0 #7) |
| `rollback()` | reverse a prior action | yes | post-rollback verify | autonomy contract (P0 #6) |

Vendors implement these actions; they do not invent parallel verbs. Capability
verbs in `nexus_connector` (e.g. `endpoint.isolate`, `backup.restore`) are the
vendor-resolved forms of these ten actions.

## 3. Canonical action descriptor

Every proposed action — from a technician, an automation, or an AI agent — is
one descriptor (P0 #1):

```json
{
  "action": "isolate",
  "actor": {"kind": "technician|automation|agent", "id": "...", "on_behalf_of": "..."},
  "target": {"kind": "device", "nexus_id": "dev-001"},
  "scope": {"tenant_id": "...", "client_id": "..."},
  "destructive": true,
  "reversible": true,
  "autonomy_level": "observe|suggest|act_with_verification|act",
  "verification_plan": "post-action evidence to gather",
  "rollback": {"action": "configure", "plan": "..."}
}
```

`nexus_protocol.validate_action_descriptor()` rejects descriptors that violate
the contract (missing actor/target, un-scoped, destructive without rollback,
autonomy `act` without a verification plan). Laws, Guardian, the Consequence
Engine, approvals and audit all consume this one shape.

## 4. Nexus Native certification

A vendor adapter can be certified against eight dimensions:

| Dimension | Proven by |
|---|---|
| Provisioning | wired `deploy()` capability + verified provisioning evidence |
| Telemetry | wired `observe()` capability with freshness metadata |
| Billing | meter events or ledger entries attributable to the vendor |
| Health | honest health signals, never fabricated status |
| Remediation | wired `configure()`/`restore()` capability with verification |
| Uninstall | documented, reversible removal path |
| Audit | attributable action records (actor, target, outcome) |
| Evidence | claims renderable from the evidence store |

### Certification levels

| Level | Meaning |
|---|---|
| **Nexus Native ✓** | all eight dimensions `verified` from live evidence |
| **Nexus Ready** | majority `verified`, none `declared`-only, gaps published |
| **Declared** | vendor self-declaration only — not evidence |
| **Unknown** | nothing verified |

Honesty rule: a dimension is `verified` only when live capability wiring or
recorded evidence proves it. Planned capabilities score `partial` at best.
Nexus publishes the gaps; it does not hide them. As of v0.1 **no bundled
adapter is Nexus Native** — that is the honest state of the registry, and the
checklist is the point.

## 5. What implementing the protocol buys a vendor

Compatibility with Nexus automation, billing, Guardian, Proof, Graph and AI;
placement in front of MSPs that preferentially buy Nexus Native products; and a
reputation built from **verified operational outcomes** (actions, verified
success rate, rollback rate, deployments) rather than star ratings.

## 6. Governance

The protocol is versioned in this file and the registry module. Adding an
object kind or action verb is a spec change: update this document, the
registry, and the conformance matrix together. Removing one is a breaking
change and requires a migration note in `docs/DATA_OWNERSHIP.md`.
