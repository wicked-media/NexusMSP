# Client Studio: Nexus CRM delivery plan

## Product direction

Client Studio is the account relationship workspace, not a second copy of Leads,
Tickets, Quotes or Billing. Positioning: **Your customer experience just got better.**
The differentiator is a connected sales-to-service relationship with attributable
history, clear ownership and actions a technician or account manager can execute.

## Inspected foundation (2026-09-05)

- `ClientsPage.jsx`: client home, service work, contacts, subscriptions, billing,
  relationship map, account growth, account plans, documentation and activity.
- `ClientStudioWidgets.jsx`: stakeholder map, account plans, contract watch,
  renewal and expansion views. Presence is not a production certification.
- `client_studio.py`: existing scoped account endpoints and permission-checked,
  audited account-plan writes. Starter generation is deterministic evidence
  seeding, **not AI**, and currently persists immediately.
- `crm.py` and `lead_studio.py`: existing lead lifecycle, conversion, tasks and
  saved views. Reuse these domains only after route registration, tenancy and
  action permissions are verified. Some handlers in `crm.py` visibly query by ID
  without local scope checks; whether upstream enforcement protects those routes
  needs tracing before expanding exposure.

## First hardening increment

Account-plan requests are cancelled on client changes. Failed loads expose retry
and prohibit editing. Save/generate calls are mutually guarded. The starter action
is honestly labelled and disabled for nonempty plans in the UI. This is not yet
server-side overwrite protection or multi-user concurrency control.

Risk: frontend workflow changes only, existing schema and APIs preserved.
Rollback: revert the account-plan component changes and focused tests; no data
migration or new store exists in this increment.

## Delivery stages and acceptance gates

### Boundary increment: account-plan API

Account-plan reads, saves and generated-plan writes now use the authenticated
actor's tenant partition. Saves allow only the five editable sections; client ID,
tenant, author and generation provenance cannot be supplied by the browser.
Content is bounded to 100 items per section and 4000 characters per text item;
opportunity amounts must be finite and non-negative. Existing client-scope and
`client.account.manage` dependencies remain in place. Focused tests validate query
partitioning, forged metadata and rejected payloads without production writes.

This does not complete the wider lead-route review, concurrent editing, atomic
audit persistence or server-side starter overwrite protection. Legacy unmarked
plans remain accessible only through the documented local tenant partition.
Rollback is a code revert; no stored records are migrated by deployment.

1. **P0: CRM boundary verification.** Trace mounted lead/client routes; adversarial
   tenant/client tests for list/detail/edit/convert/export/tasks; allowlisted
   payloads; atomic version checks for account plans; fail-safe audit handling.
   Do not introduce new write surfaces before these pass.
2. **Account command centre.** One relationship overview: accountable owner,
   lifecycle, primary contacts, dated next action and a trustworthy activity feed.
   Missing information stays unknown. Links open the canonical existing records.
3. **Owned follow-ups (first delivery slice complete).** Call/meeting/task/review
   commitments now have a verified owner, due date, completion state, overdue
   view, reassignment and attributable history. No arbitrary free-text identity
   relationships are stored. The next slice is portfolio-wide overdue reporting,
   notification delivery and durable audit/outbox handling.
4. **Sales-to-service.** Opportunities linked by stable client/contact IDs,
   configurable stages, quotes and won-to-onboarding handoff. Avoid creating a
   second authoritative opportunity alongside an existing lead/opportunity.
5. **Communication centre.** Existing Microsoft mailbox integration, approved
   senders, email threading, consent/preferences, internal versus customer-visible
   notes and explicit delivery errors. Test with dedicated mailboxes, not clients.
6. **Customer success.** Contract renewals, QBRs, commitments, satisfaction evidence
   and service coverage. Separate measured results from estimates and suggestions.
7. **Enterprise rollout.** Imports with preview/validation, governed deduplication,
   exports, custom fields, role-aware layouts and reporting provenance. Pilot real
   account-manager and technician workflows before claiming full CRM readiness.

## Ownership and scope

MongoDB remains authoritative for existing client and CRM records as documented in
DATA_OWNERSHIP.md. This plan authorises no database migration. New entities require
an ownership decision before implementation. CRM views compose domains through the
Nexus API, not browser joins between stores.

## Definition of finished

### Client record navigation increment

The client record now uses Overview, People, Service, Billing, Sales & success and
History groups. Existing tab URLs and panels are preserved and covered by a
navigation completeness test. Contacts and Service work have direct header actions;
notes, account plans, briefings and certificates use the shared dropdown menu.
The cover, priorities and account-pulse tiles are overview-only, preventing them
from pushing focused editors below repeated dashboard content. The working header
uses a smaller logo; existing shared forms and permissions are unchanged.
This is a navigation/layout increment, not a new opportunity pipeline or a claim
that browser/mobile visual acceptance has been completed.

Section navigation now uses shared Radix-backed Nexus TabsList/TabsTrigger rather
than custom ARIA-only buttons, connecting triggers to their panels and inheriting
keyboard navigation and focus behaviour. Live visual review remains pending: the
in-app browser connector failed and the alternate CDP connection exposed no pages.

### Client contact workflow increment

The People workspace contact form now ignores a late request after client changes,
prevents duplicate saves/deletes and shows a retryable error without presenting an
empty directory as successful. The count callback no longer causes a contacts
reload loop when its parent renders.

The corresponding API is tenant partitioned for direct client lookup, contact
writes and client-detail child records. Create, update and delete require
`client.contact.manage`; input is bounded and server-owned IDs/audit values are
ignored. Primary-contact changes are a single document update, so a successful
write cannot leave two contacts marked primary. Removing the current primary
promotes the next retained contact; target-aware writes return a refreshable
conflict rather than auditing a concurrent no-op. Contact add/update/delete writes
an activity entry without recording email or phone content. Focused tests cover
the scope queries, payload handling, primary pipeline, conflict handling and
action dependencies.

This increment does not make every existing client record tenant-bound, does not
add a full communications CRM, and does not make cross-collection writes
transactional. It also exposes an existing architecture review: Client Studio
uses embedded `clients.contacts[]`, while onboarding and several older workflows
use `client_contacts`. No data was moved or duplicated in this pass. If audit
logging fails after a completed contact mutation, the request can still fail even
though the contact changed; a durable outbox/transaction decision belongs in the
P1 reliability stage.

### Client follow-up workflow increment

Client Studio now has a focused account-commitment register for internal task,
call, meeting and review follow-ups. A record is scoped to one stable `client_id`
and the authenticated platform tenant, has a server-verified active staff owner,
UTC due time, constrained priority/type/state, optimistic version and completion
actor/time. It remains a relationship commitment: it does not silently create a
ticket, project task, automation or customer notification.

Create requests use a caller-generated idempotency key that produces a
deterministic Nexus follow-up ID. Retrying the same request returns the original
record without a duplicate activity entry. Reassignment and completion use the
latest expected version; a stale or repeat completion is a refreshable conflict
rather than an unaudited no-op. Browser-controlled titles and notes are bounded;
tenant/client IDs, owner names, completion identity and audit metadata are always
server derived. Client timeline events contain only safe identifiers, state and
deadline/owner metadata—not the free-text follow-up context.

The Client Studio view supplies open, overdue, completed and all filters, a
single workflow dialog for create/edit, one-click completion and reassignment.
It remains visibly separate from Tickets and Projects so a technician can tell
whether they are recording a customer promise or dispatching service work.

This does not yet add a cross-client follow-up queue, notification delivery,
service-level escalation, a durable outbox or transaction for audit writes, nor
external calendar/email delivery. No existing task collection was migrated or
changed. Rollback is removal of the feature routes/UI; the new standalone
collection has no downstream business authority.

### Lead conversion boundary increment

`POST /leads/{lead_id}/convert` now requires `crm.lead.convert` (legacy client
creation permission) and all-client portfolio scope. Lead reads and updates are
tenant partitioned; created clients retain actor-derived tenant ownership and
`source_lead_id`. Estimated pipeline value is no longer copied into client MRR.
Conversion records an attributable activity event with the client link.

Focused tests cover denied actors, tenant query construction, missing and already
converted leads, metadata, zero uncontracted MRR and the route dependency.
No live customer conversion was performed. Concurrent conversion, multi-document
atomicity and audit-failure recovery remain open; this is not a certification of
the remaining lead CRUD, task or create-ticket routes. Existing client MRR is not
changed retroactively. Rollback is a code revert; no bulk migration is needed.

End-to-end lead -> client -> proposal -> service handoff -> follow-up -> renewal
passes with tenant isolation, server-side permissions, audit, error recovery and
keyboard/mobile usability. A new tab or attractive dashboard alone is not done.
