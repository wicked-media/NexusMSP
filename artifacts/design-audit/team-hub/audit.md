# Team Hub combined UX and accessibility audit

## Audit scope

The authenticated Team Hub directory at `http://localhost:3000/team-hub`, compared with the established My Workspace and Clients surfaces at the same 1132 x 900 in-app browser viewport.

## User goal and accessibility target

An operator should be able to understand team coverage, find a teammate, move between common team workflows, and safely start an account action without scanning a dense command console. The target is a clear keyboard-operable interface with readable labels, visible state, stable semantic tabs, and actions that remain understandable without colour alone.

## Strengths

- The existing API boundaries, tenant-scoped data loading, route-backed view state, dialogs, and confirmation flows were already functional.
- The shared Nexus workspace header, buttons, cards, badges, inputs, and Radix controls provide a strong semantic and visual foundation.
- Search and status filters already had accessible names and a useful zero-result recovery state.

## UX risks

1. **Structural:** eleven always-visible tabs were split across three labelled groups, making the main navigation feel like a control matrix instead of a focused workspace.
2. **Structural:** three equal-weight header buttons obscured the primary action and made refresh as prominent as provisioning a teammate.
3. **Structural:** six small metrics produced more colour than prioritisation and compressed operational context.
4. **Structural:** the three-column directory grid left too little width for names, roles, emails, status and actions.
5. **Polish:** decorative skill radars displaced useful identity content while conveying values too small to interpret.

## Accessibility risks

- Tiny uppercase labels and dense tab wrapping increased zoom and low-vision scanning effort.
- Truncated names, titles and email addresses hid information with no alternative disclosure.
- Persistent archive buttons visually competed with the normal manage action, increasing accidental-action risk.
- A wrapped multi-row tab list made the keyboard focus path harder to predict.

## Opportunity areas

- Keep the five most common views visible and place specialist workflows in one labelled overflow menu.
- Match the existing Nexus header pattern: grouped secondary tools, one outlined invitation action, and one primary provisioning action.
- Use four operational metrics and a distinct readiness signal.
- Give directory cards enough width to show identity, workload, capacity and skills in plain text.
- Place archival actions in an explicit per-member actions menu.

## Evidence limits and verification gaps

- The audit used the current authenticated desktop state and available populated/empty states. It does not claim full WCAG conformance.
- Mobile reflow was reviewed from responsive implementation rules and production compilation; the current browser automation surface did not expose viewport resizing.
- Destructive confirmations were inspected but not submitted, so no account data was changed.

## Recommendations implemented

- Renamed the surface consistently to Team Hub.
- Replaced the three-row navigation with five quick views plus a More views menu.
- Standardised header action hierarchy and status signalling.
- Reduced the metric strip from six tiles to four decision-oriented summaries.
- Rebuilt the directory controls and widened cards to two columns at normal desktop widths.
- Replaced decorative radar graphics with readable top-skill badges.
- Moved archive/delete into explicit actions menus while retaining the existing safety dialogs.
