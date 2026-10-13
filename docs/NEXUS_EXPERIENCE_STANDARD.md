# Nexus experience standard

Every routed Nexus workspace is a promise to a technician: *what you see is what is true*.
This document is the contract behind that promise, and `pnpm audit:experience` is the gate
that enforces it.

## The state contract

A workspace that reads data owes the technician **four distinct outcomes**:

| Outcome | Means | Implementation |
| --- | --- | --- |
| loading | Nexus does not know yet | `LoadingState` |
| empty | Nexus knows, and there are legitimately no records | `EmptyState` |
| error | The read failed, and here is the way out | `ErrorState` |
| data | Here are the records | the workspace |

The four must be *distinguishable*. The failure this standard exists to prevent is a
workspace where a failed read is indistinguishable from an empty result: the technician
reads "you have no tickets", the client gets a clean-looking report, and nobody learns that
the API was down. An error is never allowed to render as an answer.

This is a correctness rule, not a styling preference. It is the same rule the platform
applies to evidence: **Nexus does not present data it did not read.**

## The primitives

All three live in exactly one module — `src/components/design-system/index.jsx`:

```jsx
import { EmptyState, ErrorState, LoadingState, PageShell } from "@/components/design-system";

<EmptyState
  icon={<Stethoscope className="h-7 w-7 text-cyan-300" />}
  title="No diagnostic plan is ready"
  description="Nexus will surface one when multiple retained signals support a coordinated review."
  action={<Button size="sm" onClick={refresh}>Refresh evidence</Button>}
  className="rounded-xl border border-dashed border-border/80"
/>

<LoadingState label="Reading retained evidence…" rows={3} />

<ErrorState
  error={message}                                  // the raw reason, shown as monospace detail
  title="The diagnostic workspace could not be loaded"
  description="No plan has been inferred. Retry the read before treating this as healthy."
  icon={<Stethoscope className="h-7 w-7" />}
  retryLabel="Retry evidence read"
  onRetry={load}
/>
```

Contract notes:

- `icon` is a **React element**, not a component type — pass `<Search className="h-6 w-6" />`.
- The text prop is `description`. It used to arrive as `msg`, `body`, `detail` and `children`
  in the six local copies this standard replaced; those names are gone.
- `className` is merged onto the panel, so a workspace can supply its own framing (inside a
  `Card`, on a dark client-portal canvas, in a dense side panel) **without forking the
  primitive**. Presentation varies; the implementation does not.
- `ErrorState.onRetry` is optional, so a read-only surface can state the failure without
  inventing an action it cannot take. When a retry is possible, wire it.
- `LoadingState` renders skeleton rows rather than a spinner, so the panel keeps its shape
  and does not jump when records land. It is announced with `role="status"`/`aria-live`.
- `ErrorState` renders with `role="alert"` — a screen reader is told the read failed even if
  the technician is not looking at the panel.

## The gate

```
pnpm audit:experience        # node scripts/audit-experience-readiness.mjs
```

The audit walks the real source tree, resolves routed workspaces from `src/config/routes.js`
so a new route is audited the moment it is declared, and fails the build at zero on the two
classes where the source can *prove* the contract is broken:

1. **`duplicateStatePrimitives`** — a file outside the canonical module defines its own
   `EmptyState`/`LoadingState`/`ErrorState`/`NoResults`/`EmptyPanel`/`EmptyNotice`/
   `StateMessage`. Six subtly different prop contracts grew this way before; a seventh copy
   is not a style question, it is the mechanism by which the first six appeared.
2. **`workspacesWithoutErrorPath`** — a workspace that fetches data with no failure path
   anywhere in the file, so a rejected request can only render as a wrong answer.

Missing loading or empty *presentation* is deliberately **not** gated. A workspace may
legitimately delegate that to a shared child this scan cannot follow, so those files are
reported as a ranked backlog (`stateBacklog`) instead of failing the build. The backlog is
where polish work should be picked up from — worst first.

The contract, the classifiers and the gate definitions live in
`src/lib/experienceReadiness.js` and are unit-tested in
`src/lib/experienceReadiness.test.js`, so the policy cannot drift away from the gate that
enforces it, and the gate's behaviour is tested with synthetic inputs rather than inferred
from whatever the tree happens to look like today.

### What the gate can and cannot prove

These are **source-shape heuristics**. They can prove a workspace *has no* state handling.
They cannot prove what the workspace looks like on screen, that the empty copy is honest, or
that the retry actually recovers. Appearance and interaction remain evidenced by the browser
matrix, and the honesty of the copy remains a review responsibility.

## Honest copy

The state contract is only worth anything if the words inside the panels are true:

- An empty state names **what is missing and why** ("No certificate has been issued against
  this assignment yet"), not "No data".
- It never implies Nexus looked and found nothing healthy — absence of evidence is stated as
  absence of evidence, not as a clean bill of health.
- It offers the next real action where one exists (create, connect, assign, refresh).
- An error state says what failed, what was **not** changed, and how to retry.

## Contrast, focus and motion

The design system makes three promises to an operator who has an accessibility need, and
until this gate existed none of them was measured:

| Promise | Bar | Enforced by |
| --- | --- | --- |
| Text stays legible in both themes | 4.5:1 (WCAG 1.4.3) | every token pair in `TEXT_PAIRS`, plus the chip hues |
| A focus indicator is visible | 3:1 (WCAG 2.4.13 / 1.4.11) | every ring the shared kit declares, at the alpha it declares, for all eight accent presets |
| A motion preference is obeyed | — | the sheet's reset and guards, and every shared primitive that animates in JavaScript |

### Contrast

The sheet's own prose already records that the light theme had to restate the signal tones
because the dark-theme neon glyphs measured 1.68-2.13:1 on a white card, and
`signalToneTokens.test.js` pins that one scale. What nothing pinned was the *base* token
pairs, the accent presets, or the design system's own components — which is how the status
chips came to render 9px uppercase copy in fixed Tailwind `-500` literals that measure
**2.15:1 (amber) to 4.47:1 (indigo)** as text on the light theme's white card. They now read
through `--nx-chip-*`, a scale declared once per theme: the dark theme keeps the hue the
chips shipped with, and the light theme restates each hue deep enough to clear 4.5:1 —
measured on the 5% tint the label actually sits on, not on the plain card.

### Focus visibility

`Button` shipped `focus-visible:ring-primary/35`. A 35% ring composites with whatever is
behind it, and measured **1.40-1.95:1** against the surface behind the button — for every one
of the eight accent presets, in both themes. The indicator was in the DOM and invisible on
screen. The kit now declares `focus-visible:ring-ring` at full opacity.

The menu, list and select rows had the mirror-image problem. Radix moves real focus with the
arrow keys and cmdk keeps the caret in the search field and marks the row with `data-selected`;
both marked the current row with an accent **fill**, which measures **1.21:1 (dark) / 1.10:1
(light)** against the popover it fills. So the row the operator was on was marked by something
that cannot carry a focus indicator at all. Every row now carries an inset ring in `--ring`
(**worst case 3.19:1** — rose accent, dark theme, against its own highlight fill) on exactly
the selector that paints the fill: `focus:` for Radix, `data-[selected=true]:` for cmdk,
`data-[state=open]:` for an open submenu row. A ring on a *different* selector than the fill
would leave the row unmarked in the very case cmdk creates, so the audit checks them as a pair.

Each indicator is measured against four surfaces — `--background`, `--card`, `--popover` (the
surface a flyout row sits in) and `--accent` (the fill that row paints) — for every accent
preset, in the theme that preset belongs to.

### Reduced motion

`App.js` accepts four settings — *Follow system*, *Professional*, *Minimal motion*, *Static* —
and writes them to `<html data-motion>`; the sheet guards every CSS animation against them and
against `(prefers-reduced-motion: reduce)`. A media query cannot reach JavaScript, and
`MetricTile` delegates to `HeroTile`, whose counter drove every KPI figure through
`requestAnimationFrame` regardless — so an operator who chose *Static* still watched every
number count up. Shared primitives now ask `useReducedMotion()` and render the real value
immediately, following a setting change without a reload.

### The gate

```
pnpm audit:accessibility      # node scripts/audit-accessibility.mjs
```

It fails the build at zero on: a measured ratio below its threshold, a focus ring whose
colour does not resolve to a sheet token, a row whose only marker is a highlight fill
(`rowIndicatorMissing` — the ring has to ride on the selector that paints the fill), an outline
suppressed with no indicator in its place, a frame loop that starts without consulting the
motion preference, and a sheet that has lost its reduced-motion reset.

The motion scope is self-maintaining: it walks the design system's modules and follows its
local imports one level, so a primitive the design system newly delegates to is audited the
moment it is imported.

**What it does not gate, and why.** Two classes are reported with their measured numbers
instead of failing the build, because closing them is a visual-identity decision rather than
a coverage gap:

- `contrastBacklog` — card and input boundaries (1.21-1.34:1 against their own surface, and
  inputs are `bg-transparent`, so the boundary is the only affordance), shadcn's default
  destructive fill with white copy (3.62:1 dark / 3.78:1 light), and the light-theme signal
  glyphs (success 2.90:1, warning 2.13:1).
- `focusBacklog` — rows whose only indicator is a fill. Empty: every shared row carries a
  ring, and a reappearance here is the regression this audit is aimed at.
- `outlineSuppressedOnSurfaces` — the one outline suppression that is not a row: the popover
  container, which carries a shadow and is not something the operator arrows through.

**What it can and cannot prove.** It measures declared colours and source shape. It cannot
prove how the result looks: it does not render pixels, and the browser matrix remains the
evidence for appearance.

## Related gates

| Gate | Proves |
| --- | --- |
| `pnpm audit:consistency` | Every routed workspace renders through the canonical header |
| `pnpm audit:controls` | Controls come from the shared kit |
| `pnpm audit:experience` | Every data-reading workspace can distinguish loading / empty / error / data |
| `pnpm audit:accessibility` | Contrast, focus visibility and reduced motion hold across the shared design system |
