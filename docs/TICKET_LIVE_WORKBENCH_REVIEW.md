# Ticket workbench live review

Reviewed on 2026-09-05 through a user-authorised Playwright session, signed in by the user. Scope was SR-0004 and SR-0005, the ticket header, product dialog, quick-action menu and Tools drawer. No message, stock mutation, remote command or ticket status change was submitted.

## Findings and changes

1. Full ticket: repeated case description, lifecycle, SLA, service tier and contextual panels pushed the conversation below the first screen. Added session-only Focus view, reversible in the header. Briefing, conversation, tasks, ownership, billing and linked assets remain available. Service kits and AI analysis are not removed.
2. Compact header actions: hidden text lacked an accessible name when rendered icon-only. Shared TicketHeaderAction now supplies aria-label and title from its label, retaining explicit caller overrides.
3. Related-ticket banner: displayed suggestions as potential duplicates without evidence explaining a confirmed relationship. Renamed to Tickets to review and explicitly labelled suggestions, relationships not confirmed.
4. Product workflow: confirmed the header opens the shared Nexus workflow dialog; its body scrolls at short heights and footer remains visible. No item was added during the review.
5. Quick actions and Tools: inspected live. Tools uses the shared side drawer with five groups. Opening and Escape dismissal worked. Executing each listed action is outside this pass; labels such as Ready are not proof of successful execution.

## Evidence

Current screenshots are under `.codex-qa/`: `ticket-signed-in.png`, `ticket-products-stable.png`, `ticket-menu-review.png`, `ticket-focus-desktop.png`, `ticket-full-desktop.png`, `ticket-tools-desktop.png`. Full/focus comparison uses the same ticket and 1440x1000 viewport. An earlier product capture was taken during animation and is not accepted as visual evidence.

Live assertions confirmed Focus hides the case context, keeps ticket properties, restores the case on switching back, and gives Tools an accessible name. Core draft state is retained because the main conversation stays mounted. Lint, component and lifecycle tests supplement rather than replace live checks.

## Remaining work

### Follow-up: duplicate briefing and conversation polish

Observed 16 briefing DOM nodes with one component declaration. Briefing and handover siblings shared the raw ticket-ID key. Namespaced these keys, then clean-rendered the ticket (composer was empty) and verified exactly one briefing after repeated handover cycles. A source-contract regression test preserves unique keys.

Added a subtle service-tier sheen (14-second cycle with a long rest), disabled by OS reduced motion and Nexus minimal/none motion settings. Verified computed animation names in the browser. Renamed the case brief Original request with a quieter surface; renamed commercial context Time & billing and clarified amounts are not a final invoice. Suggested-ticket titles wrap and opening always loads the authoritative scoped ticket instead of using a partial suggestion object.

Conversation mode buttons now expose pressed state and wrap at smaller widths. Activity offers All updates, Client communication and Internal notes, recognises both legacy and explicit internal visibility, and no longer reserves 500px for a single note. This is presentation filtering, not an authorisation control. Public/internal/email composers were opened without submitting. No email-delivery, invoice, stock or linked-asset mutation was tested in this pass. Screenshot: `.codex-qa/ticket-polish-fixed.png`.

- Review provenance of contextual predictions before promoting them as reliable technician guidance.
- Evidence-linked handover and since-last-view summaries require a backend event/summary contract, not invented frontend summaries.
- Full small-screen, keyboard and end-to-end checks across all mutation workflows remain necessary.

Rollback is limited to the Focus view and shared action-label hunks; no database, API or persistence change was introduced. Full context remains the default.
