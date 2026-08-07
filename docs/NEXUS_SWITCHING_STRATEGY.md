# Nexus switching and value strategy

Last reviewed: 2026-08-07

## The reason to switch

**Nexus replaces the cost, complexity and friction of running an MSP by bringing every operational system into one intelligent platform.**

The public promise should remain simple:

> Run your entire MSP from one intelligent platform.

Supporting line:

> Replace disconnected tools with one platform that automates operations, protects customers, captures knowledge and helps the MSP grow.

This is a product constraint, not only marketing copy. A capability should reduce tool spend, technician effort, duplicate data, operational risk or revenue leakage. If it does none of those things, it should not displace foundation work.

## Switching wedges

| Wedge | Nexus outcome | Evidence required before claiming it |
|---|---|---|
| One operational system | Client, site, user, device, service, contract, ticket, project, invoice and integration share canonical identity | Relationship integrity and migration reconciliation |
| Time returned | Repetitive work is completed through retained automation, script and self-healing executions | Execution record plus explicit time-saved methodology |
| Revenue protection | Unbilled quantities and work are identified and reconciled | Source quantity, agreement/product mapping and finance approval |
| Verified recovery | Backups are not called recoverable without a successful restore proof | Provider evidence, isolated restore, integrity result, RPO/RTO and actor |
| Operational memory | Decisions and fixes remain connected to the affected objects | Source, actor, timestamp, client scope and version history |
| Value in the first hour | Initial discovery produces a prioritised, explainable findings report | Connected-source coverage and a reproducible baseline |
| Low-risk migration | Imported objects reconcile to source counts and exceptions before cutover | Dry run, mapping decisions, checksum, exception queue and rollback/export |

## Value Proof standard

Nexus separates three types of number:

1. **Observed outcome** — backed by a retained execution or provider record.
2. **Opportunity requiring review** — such as unbilled work; useful, but not recovered revenue yet.
3. **Not measured** — shown honestly when a causal baseline does not exist.

The dashboard now follows this contract. In particular, `tickets prevented` remains unavailable until Nexus has an approved baseline and attribution method. Financial opportunities are labelled `revenue identified`, not `revenue recovered`, until the billing lifecycle proves recovery.

## Migration programme

Migration must be a controlled programme, not seven unrelated upload dialogs.

### Common pipeline

`Connect source → Inventory → Dry-run map → Resolve exceptions → Import → Reconcile → Cut over → Monitor → Export proof`

Every connector must produce:

- source system and source object ID;
- canonical Nexus object ID;
- checksum and import batch ID;
- created, updated, skipped, conflicted and failed counts;
- field-level mapping decisions;
- attachment/link handling;
- an exception owner and retry state;
- source-versus-Nexus reconciliation;
- rollback or safe compensating action;
- final signed migration report.

### Provider order

1. Syncro and Halo PSA: clients, contacts, tickets, assets, products, invoices and time.
2. NinjaOne and ConnectWise: devices, monitoring policies, scripts and remote mappings.
3. Autotask: PSA records, contracts, billing and projects.
4. Hudu and IT Glue: documentation structures and external credential references; do not copy secrets into Nexus.

Provider support is not considered implemented until a real sandbox/export fixture passes reconciliation and repeat-import idempotency tests.

## First-hour experience

The onboarding result should answer:

- What did Nexus connect?
- What coverage is missing?
- What requires attention now?
- What value has already been identified?
- Which findings are evidence-backed and which are provisional?

The first-hour report should prioritise outdated/offline devices, missing protection, backup failures or missing verification, billing mismatches, expiring warranties/certificates and high-confidence identity/security exposure. It must never imply full coverage when a required provider is not connected.

## Release order

1. Finish the canonical model, client scope and Value Proof contract.
2. Add migration batches, mappings, dry runs, exception queues and reconciliation as shared infrastructure.
3. Ship one end-to-end Syncro/Halo pilot connector using real export fixtures.
4. Build the first-hour findings report on coverage-aware evidence.
5. Add further providers through the same migration framework.
6. Publish customer-facing ROI and executive reporting only after the measurement methodology is approved.

## Non-negotiable test

Before prioritising a capability, ask: **Would a rational MSP accept the switching cost because this outcome is materially better?** If the answer is no, it belongs behind reliability, migration, speed and measurable-value work.
