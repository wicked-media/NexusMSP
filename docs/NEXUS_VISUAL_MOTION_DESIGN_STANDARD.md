# Nexus Visual & Motion Design Standard

## Purpose

Nexus should make operational state understandable—not merely make screens move. Every visual treatment must help a technician answer one of three questions:

1. What needs attention now?
2. What is Nexus doing, and what has it proven?
3. What will change if I act?

This standard applies to every workspace, workflow dialog, generated client-facing view, and agent surface.

## The three viewing distances

| Distance | Context | Design requirement |
| --- | --- | --- |
| 3 metres | NOC / presentation | State must be legible as calm, attention, critical, or recovering. |
| 1 metre | Technician desk | The next accountable action and its owner must be obvious. |
| 30 centimetres | Investigation | Technical evidence, timestamps, IDs, and scope must be available without leaving context. |

Use progressive disclosure: concise operational summary first, detail on selection or Expert View. Never remove essential evidence to make a screen look clean.

## Visual modes

### Normal mode

The default: calm, information-dense enough for daily work, and free of decorative continuous animation.

### Live mode

Used only where retained or live telemetry supports it. It may show a status heartbeat, a policy rollout, a connection forming, a recovery sequence, or a relevant incident state. Do not simulate live activity.

### Presentation mode

For NOC, QBR, incident review, and customer-facing proof of value. It may use larger state transitions, topology/replay views, and health transformation storytelling; it must still label forecasts, gaps, and inferred relationships clearly.

## Canonical workspace header

Every operational workspace uses `NexusWorkspaceHeader`, normally through the backwards-compatible `OperationalPageHeader` wrapper. Module shells such as Service Desk may add descriptive navigation immediately below it, but must preserve the same identity, state and action grammar.

Required anatomy:

1. A domain icon and restrained status orb.
2. A short operational eyebrow, clear title and one-sentence purpose.
3. An optional truthful state summary derived from supplied workspace evidence.
4. Permission-aware actions, with one visually primary action at most.
5. Inferred back navigation on nested workspace views.
6. A compact command-rail label when actions are present, so horizontal space explains the control group instead of becoming an empty button shelf.

Approved variants are `workspace`, `module`, `record`, `command`, and `portal`. Variants may change density and supporting content, but not the meaning or position of identity, state and actions. Domain tone may vary; interaction behaviour, spacing rhythm and responsive collapse must not.

Do not duplicate the same action in the header, navigation rail and overflow menu. Do not display a healthy state when evidence is missing. Custom headers require a measurable workflow reason and must still follow this contract.

### Header action hierarchy

Header controls use a predictable priority order so technicians do not have to relearn each workspace:

1. Show no more than one filled primary action. It represents the most common safe next step.
2. Show no more than two secondary controls beside it when they are genuinely frequent in-context actions.
3. Place setup, navigation, import/export, administrative and infrequent actions in the shared `WorkspaceActionMenu` labelled `More`.
4. Keep action labels in sentence case while preserving product names and acronyms such as PBX, CSV, YCM and RMM.
5. Do not place the same action both in the visible rail and the overflow menu.

The overflow menu changes presentation only. Existing permission checks, disabled states, confirmation flows and audit ownership remain attached to the underlying action.

Immersive chat, wallboard, public portal, record cockpit and full-screen command canvases may keep specialist headers. Those exceptions are declared in the workspace consistency audit. Route-only wrappers are separately classified when they delegate to a shared header. A new generic routed workspace cannot avoid the release gate by omitting a literal `<h1>`; it must use the canonical header, delegate to a classified shared surface, or be reviewed as a deliberate specialist canvas.

## Motion language

Use existing tokens in `frontend/src/index.css`:

| Token | Intended duration | Use |
| --- | ---: | --- |
| `--nx-motion-instant` | 100ms | Button acknowledgement, focus state |
| `--nx-motion-fast` | 160ms | Hover, row selection, compact status change |
| `--nx-motion-standard` | 220ms | Dialog, drawer, content reveal |
| `--nx-motion-deliberate` | 420ms | Meaningful state transition or replay step |

Rules:

- Never delay a completed action for animation.
- Prefer opacity, transform, and colour over layout thrashing.
- One moving element is enough to establish meaning; do not animate the whole screen.
- Continuous motion is reserved for actual live/attention state and must be calm.
- A visual state must remain understandable when all animation is removed.

### Canonical verbs

Use only these named state verbs in component naming, visual descriptions, and new interactions:

`Enter`, `Exit`, `Expand`, `Collapse`, `Pass`, `Connect`, `Disconnect`, `Verify`, `Warn`, `Fail`, `Recover`, `Deploy`, `Scan`, `Analyse`, `Isolate`, `Restore`, `Complete`.

## State and colour

Colour augments text and iconography; it never carries meaning alone.

Use `NexusConfidenceBadge` whenever the interface needs to explain how Nexus knows a fact. Health and confidence are separate dimensions.

| State | Meaning | Visual treatment |
| --- | --- | --- |
| Calm / nominal | Current retained evidence has no attention state | Neutral surface, restrained emerald status mark |
| Attention | A review is needed | Amber accent on the relevant object only |
| Critical | Immediate risk or service impact | Rose accent, clear scope and next action |
| Active | Nexus or a technician is working | Cyan/primary active marker and explicit status text |
| Verified | Outcome has recorded evidence | Emerald Nexus verification mark |
| Unknown / gap | Evidence is absent or stale | Muted/amber state, explicit `Unassessed` or `Evidence gap` label |
| Forecast | A projected—not current—condition | Dashed/translucent treatment and time horizon |

## Nexus Verified signature

The reusable `NexusVerifiedSequence` is the completion language for accountable work:

`Detected → Diagnosed → Fixed → Verified → Documented → Billed`

It may be tailored to a domain, but every sequence must retain these properties:

- Stage progress comes from actual persisted state, not a decorative timer.
- A completed seal represents recorded evidence, not an assumed result.
- Billing only completes after a real billing hand-off or classification is recorded.
- Customer communication remains an explicit action; it is never implied by ticket closure.

## Safety-critical interactions

For a change with client impact, privileged access, cross-tenant scope, deletion, isolation, or bulk execution:

1. Show persistent tenant/client context.
2. State target count and expected change in plain language.
3. State known impact and uncertainty.
4. Require a deliberate confirmation for high-impact action (hold-to-execute where appropriate).
5. Animate a shield only when a policy really intercepted or gated the action.
6. Record approval, actor, scope, and result in the audit trail.

Never use a success toast as evidence that an external provider completed an action.

## Object and topology views

Spatial/graph views are optional investigative tools, not primary navigation.

- Relationships require a source record; unlinked entities remain visible as coverage gaps.
- Lines must be selectable, labelled, and removable through layer filters.
- `X-Ray` layers are Security, Network, Identity, Backup, Commercial, and Ownership.
- Ghost state means historical evidence and must display its timestamp.
- Prediction ghosts must be visually distinct and show confidence/time horizon.
- `Replay` is ordered from retained events only; missing intervals must be shown as gaps.

## Empty and success states

Replace generic blank states with proof-of-value language only when supported by evidence.

- Good: “Everything is quiet. 182 managed endpoints currently meet the observed coverage criteria.”
- Good: “No billing discrepancy is detected from the connected sources.”
- Not allowed: “Everything is protected” when one or more sources are unavailable.

Celebrate a measurable operational outcome—such as completed recovery coverage—not a button click. Milestones are opt-in, short, and never block work.

## Accessibility, sound, and performance

- Respect `system`, `full`, `minimal`, and `none` motion preferences everywhere.
- `minimal` removes ambient/continuous animation but retains short state acknowledgement.
- `none` removes non-essential motion and smooth scrolling.
- All live indicators have text alternatives and do not rely on colour.
- Sound and haptics are opt-in, contextual, and off by default.
- Do not autoplay audio, use strobing, or make timing essential to a task.
- Prefer CSS transform/opacity; pause off-screen or hidden visualisations.
- Spatial/topology and replay views must offer a static list/table alternative.

## Review checklist for a new workspace

- Does the header explain the operational question the page answers?
- Does each attention state identify scope, evidence source, and next action?
- Is the selected motion semantic, brief, and disabled by the appropriate preference?
- Does the dark and light theme preserve contrast and status meaning?
- Is customer/tenant context persistent for risky actions?
- Can a technician complete the task without watching any animation?
- Do empty, success, and forecast states make their evidence boundary clear?

## Current reference implementations

- `NexusWorkspaceHeader`: canonical workspace identity, evidence state and action surface.
- `TicketModuleHeader`: module variant with descriptive Queue, Triage, SLA and Dispatch navigation.
- Devices Fleet Cockpit: high-density operational variant for endpoint evidence.
- `NexusGlobalPulse`: sidebar estate pulse built from retained navigation evidence.
- `NexusVerifiedSequence`: Work Session, Tickets, Nexus Verify, Diagnostics, and Assurance completion language.
- `Nexus Expected State`: explicit evidence boundary and canonical Nexus Agent heartbeat coverage.
- Appearance settings: user-controlled System, Full, Minimal, and Static motion modes.

This document is the source of truth for future Nexus visual and interaction work. Changes must update both this standard and the shared implementation primitives.
