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

- `NexusGlobalPulse`: sidebar estate pulse built from retained navigation evidence.
- `NexusVerifiedSequence`: Work Session, Tickets, Nexus Verify, Diagnostics, and Assurance completion language.
- `Nexus Expected State`: explicit evidence boundary and canonical Nexus Agent heartbeat coverage.
- Appearance settings: user-controlled System, Full, Minimal, and Static motion modes.

This document is the source of truth for future Nexus visual and interaction work. Changes must update both this standard and the shared implementation primitives.
