# Nexus workflow standard

Every Nexus workspace follows the same interaction contract:

1. **Orient** — show scope, purpose and the recommended next action.
2. **Prepare** — collect only the information required for the action.
3. **Preview impact** — explain what will change, what will not, and any approval requirement.
4. **Confirm deliberately** — one clear primary action; destructive actions require an explicit confirmation.
5. **Verify and record** — return evidence, next steps and an attributable audit trail.

## Component rules

- Use `OperationalPageHeader` for new operational pages.
- Use `NexusWorkflowDialog` for create, edit, approve and delete flows, except purpose-built working canvases such as rich ticket intake.
- Use shared `Button`, `Input`, `Select`, `Textarea` and `Checkbox` controls; do not introduce raw replacements.
- Preserve keyboard focus, visible labels, errors and a reduced-motion experience.
- Every workspace must expose its purpose and a safe next action through the **Start here** compass.

## Dialog layout contract

Long or decision-making dialogs must use a contained workspace rather than allowing the browser page to become the scroll area:

- a fixed-height `DialogContent` bounded by the viewport;
- a fixed header with the workflow title and purpose;
- one `min-h-0 flex-1 overflow-y-auto` body for the form or evidence;
- a fixed `DialogFooter` for Cancel, Save, Approve, Reject or Done;
- an explicit Cancel/Close action whenever the workflow can be abandoned safely.

`NexusWorkflowDialog` is preferred for new workflows. Existing direct dialogs can be migrated incrementally when their source is readable and the behavioural boundary can be validated. Legacy pages with large single-line JSX blocks must be deliberately source-formatted and covered by a focused regression check before migration; do not mass-rewrite them just to satisfy styling consistency.

Run `pnpm --dir frontend audit:consistency` before a release to inventory remaining direct dialogs and track migration progress.

## Managed asset lifecycle

Managed assets treat operational history as evidence, not disposable metadata:

- **Archive** is the normal retirement path. It removes the endpoint from active fleet views while retaining its identity, tickets, alerts, remote sessions, telemetry and audit trail.
- **Restore** returns an archived, non-merged asset to the active fleet as offline. A trusted Agent or provider check-in is required before Nexus treats it as online.
- **Merge duplicate** selects one same-client survivor, archives the duplicate and records the relationship. Historical evidence remains linked to its original record so incident and billing provenance stays intact.
- **Permanent deletion** is limited to empty, manually created error records. Agent-linked assets or assets with retained evidence must be archived instead.

Lifecycle actions use the `asset.lifecycle.manage` permission, server-side scope validation, an explicit reason or typed confirmation where needed, and an attributable activity record.
