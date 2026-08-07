# Nexus Connect product architecture

Last reviewed: 2026-08-07

## Product promise

Nexus Connect is the operational collaboration layer inside NexusMSP. It is not a generic team-chat clone. Conversation is attached to live Nexus objects, technicians can turn discussion into governed action, and responsibility moves through explicit, accepted, auditable handoffs.

The product name is **Nexus Connect**. "Chat" remains a plain-language navigation label where helpful, but API and new product concepts use Nexus Connect.

## Existing foundation

The current implementation already supports direct messages, group conversations, team channels, threads, reactions, typing, presence, attachments, search, edits, deletion, pinning, slash commands and live ticket/invoice/purchase-order cards. Existing collaboration code is extended rather than replaced.

## Differentiating primitives

### Ticket Pass

A Ticket Pass is an explicit proposal to transfer or share responsibility. It records:

- sender and intended recipient;
- mode: take over, assist, escalate, consult, cover, return or swarm;
- reason, completed work and suggested next action;
- the live ticket owner before the pass;
- pending, accepted, declined or stale outcome;
- timestamps, actor, ticket audit, activity and platform events.

Transfer modes change assignment only after the recipient accepts. Acceptance uses compare-and-swap semantics so it cannot overwrite an owner or lifecycle change that happened while the request was pending. Non-transfer modes add the recipient as a watcher. Declines require a reason.

### Nexus object rooms

The first supported object room is a private ticket work room. It stores canonical ticket identity and membership, not a copied ticket record. The UI resolves current ticket details and the API re-checks client scope and room membership whenever a technician views or acts on a pass.

Future rooms should follow the same rule for incidents, projects, clients, devices, invoices, purchase orders, changes and security events.

### Object mentions and conversation-to-action

Ticket, invoice and purchase-order references resolve to permission-scoped live cards. The next actions should be added as governed commands that call the same domain services and permission checks as the original workspace; chat must never become a privileged bypass.

## Security and governance rules

- Every object resolution and mutation re-checks tenant/client scope and masks inaccessible objects as not found.
- Private/direct/object room access is membership-based; administrators retain audited operational access according to policy.
- High-impact actions use named action permissions and the same approval rules as their source workflow.
- External participants must never be admitted to internal channels by inference. Guest rooms require an explicit future boundary, retention policy and redaction model.
- Messages retain references and action evidence; they do not become an alternative source of truth for ticket, invoice or asset state.
- Handoff events use correlation IDs and partition on the ticket so downstream automation can remain ordered and traceable.

## Delivery plan

| Release | Scope | Acceptance evidence |
|---|---|---|
| Connect 1 | Nexus naming, existing collaboration polish, scoped object cards, Ticket Pass, private ticket rooms | API tests for creation/acceptance/decline/concurrency/scope; frontend tests/build; audit and event evidence |
| Connect 2 | Saved replies, richer composer, mentions, notifications, bookmarks and improved global search | Keyboard/accessibility/browser tests; notification delivery and scope tests |
| Connect 3 | Conversation-to-ticket/task/approval/change, automatic incident/project/client rooms, timers and escalation | Domain-service parity, rollback/idempotency and golden workflow E2E |
| Connect 4 | Customer collaboration boundary, email/SMS/portal continuity and controlled guest rooms | External identity, redaction, retention, attachment and delivery-failure tests |
| Connect 5 | Voice/video, huddles, transcripts, recordings, AI summaries and decision capture | Consent, retention, storage, search, privacy and model-governance evidence |

## Current implementation status

**Testing, not production ready.** The Connect 1 Ticket Pass vertical slice, ticket object rooms, scoped reference lookup and secured slash-command ticket actions are implemented. Focused backend tests cover create, accept, decline, recipient-only and one-time decision behaviour. Remaining release gates include two-client API coverage, browser E2E, concurrency against a real MongoDB transaction model, notification delivery, responsive/accessibility/visual regression, retention decisions and operational monitoring.

## Product success measures

- accepted handoffs without reassignment races;
- time from pass request to acceptance;
- conversations converted into governed work;
- technician clicks and context switches avoided;
- stale or declined pass reasons captured;
- object-room activity with complete audit/event linkage;
- zero cross-client object or conversation disclosure.
