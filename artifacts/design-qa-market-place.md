# Market Place (`/studios`) browser review

## Evidence

- Surface reviewed: `http://127.0.0.1:3000/studios` — the running preview, signed in as the
  repository's seeded demo administrator, so the page read the **real** `/api/studios`
  contract (29 admitted studios, 14 products, 3 tiers, 133 catalogue entries) rather than a
  fixture.
- Browser: headless Chromium through the repository's own `@playwright/test` dev dependency.
  No new dependency was added and no harness was left behind.
- Viewports: 1440 × 1000 (desktop) and 480 × 900 (narrow).
- Themes: dark (default) and light, with the in-app Motion setting held at *Static* so the
  captures are stable.
- States captured: the unfiltered fleet grouped by product in **both themes**
  (`market-place-dark.png`, `market-place-light.png`); and, in the dark theme, a search that
  matches (`?q=fibre`, 3 results — `market-place-results.png`), a search that matches nothing
  (`market-place-empty.png`) and the narrow layout (`market-place-narrow.png`).
- Console: no errors or failed requests on any capture.

## What this review is, and is not

It is a **measurement** pass. The screenshot set is attached for a human to look at; the
findings below are computed, not eyeballed: horizontal overflow, clipped text, the rendered
contrast of every text leaf inside the hub (854 leaves per pass, composited against the
background each one actually sits on), and the type size carrying information.

## Measurements, before and after

| Measurement | Before | After |
| --- | --- | --- |
| Text below its WCAG threshold (light theme) | 32 of 854 leaves | **0** |
| Text below its WCAG threshold (dark theme) | 0 | 0 |
| Worst contrast, light theme | 1.79:1 (header eyebrow) | **4.67:1** (disposition chip on the muted proposals panel) |
| Worst contrast, dark theme | 5.96:1 (status chip) | 5.96:1 |
| Horizontal overflow at 1440 / 480 px | none | none |
| Clipped text (overflow hidden or truncated) | 0 | 0 |
| Console errors | 0 | 0 |

## Findings and fixes

1. **The workspace header's eyebrow was invisible in the light theme — 1.79:1.**
   `--nx-header-accent` is declared once, with the lightness the dark canvas needs, and was
   never restated for the light theme, so the eyebrow, the identity mark, the state chip and
   the action-rail copy rendered as neon on a white card. Because every routed workspace
   renders through this header, the defect was app-wide and not specific to the Market Place.
   Each tone now restates its hue at the depth the light chip scale already uses
   (`frontend/src/index.css`), which takes the eyebrow to 5.95:1.
2. **The filled primary fill sat under the bar in the light theme — 4.08–4.34:1.**
   Four of the eight accent presets drew white button copy on a fill that measured
   emerald 4.32:1, sky 4.34:1, orange 4.17:1 and cyan 4.08:1. Each keeps its hue and
   saturation and drops only the lightness the light theme needs (emerald 4.77:1, sky 4.76:1,
   orange 4.70:1, cyan 4.84:1); `--ring` follows the same token, so the focus indicator
   deepens with it (`frontend/src/App.js`). This fixed all 29 primary controls on the page and
   every filled primary control in the product.
3. **A facet count was dimmed below legibility.**
   The count inside each filter chip carried `opacity-70`, which dropped it to roughly 3:1 on
   the light theme's filled chip. It now reads at the same weight as its label and takes its
   hierarchy from size and tabular figures (`frontend/src/pages/StudiosHubPage.jsx`).

## What remains unproven

- No human visual judgement: layout taste, density and hierarchy are for a person looking at
  the attached captures.
- Only the default accent preset (emerald) was rendered; the other seven presets were checked
  arithmetically, not in the browser.
- Three states were captured (fleet, results, no match). Interaction states beyond those —
  hover, focus rings mid-keyboard-walk, the loading skeleton mid-read — are asserted by the
  unit suites, not by this pass.
- The review used the seeded demo data. A tenant with a much longer product catalogue was not
  rendered.
