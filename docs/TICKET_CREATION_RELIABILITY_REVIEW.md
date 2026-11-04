# Created-ticket reliability review — 2026-09-05

Scope: the service desk create dialog and ticket detail loader in `TicketsPage.jsx`. Existing layouts, service kits, persistence and API permissions are preserved.

## Corrected

- A synchronous in-flight guard prevents repeated Create clicks submitting concurrent requests from this dialog. The action shows progress and dismissal is blocked during submission.
- Ticket detail responses are generation-scoped, including contacts, worksheets, devices and suggestions. Older responses cannot overwrite a newer ticket's state.
- Previous ticket collections and communication recipients are cleared/initialised before loading the next record.
- Composer initialisation now precedes asynchronous contact loading, avoiding late initialisation overwriting a populated recipient or draft.
- A successful creation followed by refresh failure is reported as an existing ticket, not a failed creation. An unconfirmed network result advises checking the queue before retrying.

These are frontend request-lifecycle protections, not server-side idempotency or a claim that every action in the workspace has been validated.

## Evidence and remaining checks

### Ticket workbench follow-up

- Header Add products opens the existing item/stock/billing workflow, with a line count. Search covers active product names, SKU, barcode, part number, manufacturer and category; quantity validation and an in-flight guard prevent accidental concurrent Add clicks. This is not cross-session/server idempotency.
- The briefing renders readable AI request text with source scope, generation time, stale-source warning, source disclosure and explicit failure state. It still summarises the title/description only, not the full activity history. Stale AI responses cannot cross tickets.
- Suggested tickets are explicitly labelled keyword matches, not confirmed related incidents. Their Open action also fetches scoped records absent from the current queue and reports unavailable records.
- Previously unhandled briefing reply/note/acknowledge actions now focus the composer; escalation/reboot/blocker suggestions open the existing tools for review.
- These changes use existing APIs and design components; no new persistence or production-data mutation was introduced by the implementation work. Live visual and end-to-end verification remains outstanding.

- Focused frontend tests execute the actual page handlers with controlled network promises and mocked state setters; these are not browser end-to-end tests.
- Existing backend service-kit, project-ticket integrity, remote-to-invoice and device-action-scope tests passed in this review (19 tests).
- Visual/live interaction review is pending: the browser automation surface failed to initialise with a kernel-assets path error. No live ticket was created or customer communication sent during this review.
- Review partial detail-load failure handling next: required parallel requests currently fail the entire initial detail load.
- Review draft preservation on same-ticket refresh and server-side creation idempotency before describing creation as retry-safe across tabs or network loss.
- Benchmark references: Syncro's May 2026 announcement describes ticket summaries and parent/child blueprints: https://community.syncromsp.com/t/whats-new-at-syncro-may-2026/19431 . Existing Nexus summary, blueprint and service-kit components are not evidence of complete feature parity or superiority.

Risk and rollback: limited to the ticket page's local loading/submission lifecycle and Create dialog's busy state. Revert only this review's hunks and test file to roll back; do not discard unrelated working-tree changes. No database migration, external action or authentication change is involved.
