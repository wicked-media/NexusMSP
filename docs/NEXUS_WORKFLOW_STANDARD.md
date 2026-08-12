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

Run `pnpm --dir frontend audit:consistency` before a release to inventory remaining direct dialogs and track migration progress.
