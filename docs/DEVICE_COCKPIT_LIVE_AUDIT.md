# Device Cockpit live audit

Date: 10 September 2026

Surface: `/devices/dev-001`

Viewport: 1440 x 1024

Result: Passed

## Overall verdict

The authenticated Device Cockpit now presents identity, freshness, telemetry, current work and actions in a clear technician-first order. The tested read-only workflows are visually stable, the forms fit inside the viewport, and the browser run completed without console errors or failed network responses.

## Audited steps

1. **Open the Device Cockpit - healthy.** The stale evidence state is explicit, high-impact work is guarded, the telemetry strip is readable, and the five primary work areas are distinct. The current-work view now shows pending patches rather than installed history.
   - Evidence: `artifacts/device-cockpit-audit-01-overview.png`
2. **Open Edit device identity - healthy.** The workflow explains which fields are authoritative versus agent-reported, keeps the four editable fields in one view, and provides clear Cancel and Save actions.
   - Evidence: `artifacts/device-cockpit-audit-02-edit-identity.png`
3. **Open More actions - healthy.** Secondary and lifecycle actions are consolidated in one menu. Archive, merge and permanent deletion are not duplicated elsewhere in the record, and destructive deletion is visually separated.
   - Evidence: `artifacts/device-cockpit-audit-03-actions-menu.png`
4. **Open Archive managed asset - healthy.** The form explains retained evidence, requires a reason, and keeps the archive action disabled until the required context is present.
   - Evidence: `artifacts/device-cockpit-audit-04-archive-workflow.png`

## Corrections made during the audit

- Shortened primary section descriptions so they remain legible at narrower desktop widths.
- Changed the telemetry patch metric to state that the value represents pending updates.
- Changed Current work to prioritise pending patch records and show their KB identifiers.
- Replaced the contradictory software-inventory empty message when application records already exist.
- Added explicit keyboard focus treatment to primary and secondary device navigation.
- Removed the retired global `/api/seed` bootstrap call that produced two 403 console errors on every application load.

## Accessibility and validation limits

- Visible labels, modal headings, form labels, disabled destructive actions and keyboard focus styling were inspected.
- A full screen-reader and keyboard-only traversal was not performed, so this audit does not claim complete accessibility conformance.
- Archive and permanent deletion were opened and inspected but not submitted, preserving the existing device and client evidence.
