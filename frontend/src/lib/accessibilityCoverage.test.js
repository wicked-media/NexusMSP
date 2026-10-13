/* Contrast, focus and motion coverage for the shared design system.

   These tests do two jobs. The synthetic ones pin the contract's own behaviour — colour
   maths, the classifiers, and the fact that the defects this audit exists for really do
   fail it. The ones that read the real tree pin the design system itself, because a gate
   whose thresholds are only exercised by fixtures proves nothing about the sheet that
   ships. Threshold checks collect their failures and assert the list is empty, so a
   failure names the pair and the ratio rather than only reporting "expected false to be
   true"; the counts are asserted as well, so the suite cannot pass vacuously by measuring
   nothing. */
import fs from "fs";
import path from "path";

import {
  alphaFromSuffix,
  auditFocusRings,
  buildAccessibilityReport,
  CHIP_TINT_ALPHA,
  compositeOver,
  contrastRatio,
  findFillOnlyRows,
  findOutlineSuppressions,
  findUnguardedJsMotion,
  FOCUS_INDICATOR_MINIMUM,
  FOCUS_SURFACES,
  GATED_CLASSES,
  hslToRgb,
  isSharedKitSource,
  measureChipTones,
  measurePair,
  NON_TEXT_CONTRAST_MINIMUM,
  parseAccentPresets,
  parseThemeTokens,
  reducedMotionCoverage,
  resolveLocalImports,
  TEXT_CONTRAST_MINIMUM,
  TEXT_PAIRS,
} from "./accessibilityCoverage";

const readSource = (relative) => fs.readFileSync(path.join(__dirname, "../../", relative), "utf8");
const readSourcesIn = (directory) => fs
  .readdirSync(path.join(__dirname, "../../", directory))
  .filter((name) => isSharedKitSource(`${directory}/${name}`))
  .map((name) => `${directory}/${name}`);

const css = readSource("src/index.css");
const appSource = readSource("src/App.js");
const tokens = parseThemeTokens(css);
const accents = parseAccentPresets(appSource);
const kitSources = [
  "src/components/design-system/index.jsx",
  "src/components/HeroTile.jsx",
  ...readSourcesIn("src/components/ui"),
].map((sourcePath) => ({ path: sourcePath, source: readSource(sourcePath) }));

const failuresOf = (entries, pick) => entries.map(pick).filter(Boolean);

describe("the contract's colour maths", () => {
  test("contrast ratio matches the WCAG endpoints and is order-independent", () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(21);
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
  });

  test("an HSL token converts to rgb", () => {
    // Exact on the primary hues, where the answer is not a matter of rounding.
    expect(hslToRgb([0, 0, 100])).toEqual([255, 255, 255]);
    expect(hslToRgb([0, 0, 0])).toEqual([0, 0, 0]);
    expect(hslToRgb([0, 100, 50])).toEqual([255, 0, 0]);
    expect(hslToRgb([120, 100, 50])).toEqual([0, 255, 0]);
    expect(hslToRgb([240, 100, 50])).toEqual([0, 0, 255]);
  });

  test("a sheet token resolves to the palette literal it was rounded from", () => {
    // `199 89% 48%` is the sky-500 literal the status chips used to carry. The sheet stores
    // rounded triples, so the conversion lands within a channel or two of the palette rgb.
    const [r, g, b] = hslToRgb([199, 89, 48]);
    expect(Math.abs(r - 14)).toBeLessThanOrEqual(3);
    expect(Math.abs(g - 165)).toBeLessThanOrEqual(3);
    expect(Math.abs(b - 233)).toBeLessThanOrEqual(3);
  });

  test("compositing is what makes a translucent ring measurable", () => {
    expect(compositeOver([10, 20, 30], [0, 0, 0], 1)).toEqual([10, 20, 30]);
    expect(compositeOver([10, 20, 30], [0, 0, 0], 0)).toEqual([0, 0, 0]);
    expect(alphaFromSuffix(undefined)).toBe(1);
    expect(alphaFromSuffix("35")).toBeCloseTo(0.35);
    expect(alphaFromSuffix("5")).toBeCloseTo(0.05);
  });

  test("a 35% focus ring is the defect this audit exists for", () => {
    // The exact declaration `Button` shipped. It was in the DOM and invisible on screen:
    // measured against every accent preset, in the theme it belongs to, it never reached
    // 2:1.
    const translucent = auditFocusRings({
      tokens,
      accents,
      sources: [{ path: "synthetic.jsx", source: 'className="focus-visible:ring-2 focus-visible:ring-primary/35"' }],
    });
    expect(translucent.declarations).toHaveLength(1);
    expect(translucent.declarations[0].alpha).toBeCloseTo(0.35);
    expect(translucent.declarations[0].worstRatio).toBeLessThan(FOCUS_INDICATOR_MINIMUM);
    expect(translucent.declarations[0].worstRatio).toBeGreaterThan(1);

    // The same ring at full opacity, which is what the kit declares today.
    const solid = auditFocusRings({
      tokens,
      accents,
      sources: [{ path: "synthetic.jsx", source: 'className="focus-visible:ring-2 focus-visible:ring-ring"' }],
    });
    expect(solid.declarations[0].worstRatio).toBeGreaterThanOrEqual(FOCUS_INDICATOR_MINIMUM);
    // Every accent preset, in both themes, and every surface it can be drawn on — the page,
    // a card, the popover a row sits in, and the fill that row paints.
    expect(solid.declarations[0].checkedColours).toBe(accents.length * 2 * FOCUS_SURFACES.length);
  });

  test("a row whose only marker is an accent fill is a finding, on the selector that paints it", () => {
    expect(findFillOnlyRows([
      { path: "a.jsx", source: 'className="outline-none focus:bg-accent focus:text-accent-foreground"' },
    ])).toEqual([{ path: "a.jsx", prefix: "focus", line: expect.stringContaining("focus:bg-accent") }]);

    // The fill and the ring have to share a selector. cmdk keeps the caret in the search field
    // and marks the current row with `data-selected`, so a ring on `focus:` alone would leave
    // the row the arrow keys are on unmarked — which is the bug, not the fix.
    expect(findFillOnlyRows([
      {
        path: "b.jsx",
        source: 'className="data-[selected=true]:bg-accent focus:ring-1 focus:ring-ring"',
      },
    ])).toEqual([expect.objectContaining({ prefix: "data-[selected=true]" })]);

    expect(findFillOnlyRows([
      {
        path: "c.jsx",
        source: 'className="data-[selected=true]:bg-accent data-[selected=true]:ring-1 data-[selected=true]:ring-ring"',
      },
    ])).toEqual([]);

    // A width is not an indicator, and neither is a modifier: `ring-inset` names no colour.
    expect(findFillOnlyRows([
      { path: "d.jsx", source: 'className="focus:bg-accent focus:ring-inset focus:ring-2"' },
    ])).toHaveLength(1);
  });

  test("no shared row marks the current row with a fill alone", () => {
    expect(findFillOnlyRows(kitSources)).toEqual([]);
  });

  test("a test is not a control, so it is outside the kit's scope", () => {
    expect(isSharedKitSource("src/components/ui/select.jsx")).toBe(true);
    expect(isSharedKitSource("src/components/ui/sonner.test.js")).toBe(false);
    expect(isSharedKitSource("src/components/design-system/accessibility.test.jsx")).toBe(false);
  });

  test("a ring whose colour is not a sheet token cannot be measured, and says so", () => {
    const { declarations } = auditFocusRings({
      tokens,
      accents,
      sources: [{ path: "synthetic.jsx", source: 'className="focus-visible:ring-2 focus-visible:ring-nonexistent"' }],
    });
    expect(declarations[0].resolved).toBe(false);
    expect(declarations[0].worstRatio).toBeNull();
  });
});

describe("the sheet's contrast contract", () => {
  test("both themes are declared, and the light theme restates the chip scale", () => {
    for (const theme of ["dark", "light"]) {
      expect(tokens[theme]["muted-foreground"]).toBeDefined();
      expect(tokens[theme]["nx-chip-sky"]).toBeDefined();
    }
    expect(tokens.dark["nx-chip-sky"]).not.toEqual(tokens.light["nx-chip-sky"]);
  });

  test("every text pair the design system promises clears 4.5:1 in both themes", () => {
    const measured = ["dark", "light"].flatMap((theme) => TEXT_PAIRS.map((pair) => measurePair(tokens, theme, pair)));

    // A pair whose tokens are not declared at all is a failure, not a skip.
    expect(failuresOf(measured, (entry) => (entry ? null : "undeclared token pair"))).toEqual([]);
    expect(measured).toHaveLength(TEXT_PAIRS.length * 2);

    const failures = failuresOf(measured, (entry) => (entry.ratio < TEXT_CONTRAST_MINIMUM
      ? `${entry.theme} ${entry.pair} = ${entry.ratio}:1 (needs ${TEXT_CONTRAST_MINIMUM}:1)`
      : null));
    expect(failures).toEqual([]);
  });

  test("every chip label clears 4.5:1 on the tint it actually renders on", () => {
    const measurements = measureChipTones(tokens);
    expect(measurements).toHaveLength(24); // 6 hues x 2 surfaces x 2 themes

    const failures = failuresOf(measurements, (entry) => (entry.ratio < TEXT_CONTRAST_MINIMUM
      ? `${entry.theme} ${entry.pair} = ${entry.ratio}:1`
      : null));
    expect(failures).toEqual([]);

    // The tint is not a rounding detail: measuring the plain card overstates the ratio for
    // the light theme, which is where the chips were failing in the first place.
    const label = hslToRgb(tokens.light["nx-chip-amber"]);
    const card = hslToRgb(tokens.light.card);
    expect(contrastRatio(label, compositeOver(label, card, CHIP_TINT_ALPHA)))
      .toBeLessThan(contrastRatio(label, card));
  });
});

describe("the design system's focus and motion contract", () => {
  test("every ring the shared kit declares clears 3:1 at the alpha it declares", () => {
    const { declarations } = auditFocusRings({ tokens, accents, sources: kitSources });
    expect(declarations.length).toBeGreaterThanOrEqual(8);

    expect(failuresOf(declarations, (entry) => (!entry.resolved ? `${entry.path} ${entry.declaration} (unresolved)` : null)))
      .toEqual([]);
    expect(failuresOf(declarations, (entry) => (entry.worstRatio < FOCUS_INDICATOR_MINIMUM
      ? `${entry.path} ${entry.declaration} = ${entry.worstRatio}:1 over --${entry.worstSurface} (${entry.worstTheme})`
      : null))).toEqual([]);
  });

  test("the accent preset an operator picks is a focus indicator that clears 3:1", () => {
    const { accentRings } = auditFocusRings({ tokens, accents, sources: kitSources });
    expect(accentRings).toHaveLength(accents.length * 2 * FOCUS_SURFACES.length);

    expect(failuresOf(accentRings, (entry) => (entry.ratio < NON_TEXT_CONTRAST_MINIMUM
      ? `${entry.indicator} ${entry.theme}/${entry.surface} = ${entry.ratio}:1`
      : null))).toEqual([]);
  });

  test("a suppressed outline with nothing in its place is a finding, and a ring is not", () => {
    const withRing = findOutlineSuppressions([
      { path: "a.jsx", source: 'className="outline-none focus-visible:ring-2 focus-visible:ring-ring"' },
    ]);
    expect(withRing).toEqual([{ path: "a.jsx", line: expect.stringContaining("outline-none"), indicator: "ring" }]);

    const withNothing = findOutlineSuppressions([
      { path: "b.jsx", source: 'className="text-sm outline-none placeholder:text-muted-foreground"' },
    ]);
    expect(withNothing[0].indicator).toBe("none");

    // A wrapped declaration still finds its indicator: the real kit writes long class
    // strings, and a line-at-a-time scan would report failures that are not there.
    const wrapped = findOutlineSuppressions([
      { path: "c.jsx", source: 'className="\n  outline-none\n  focus-visible:ring-1\n  focus-visible:ring-ring\n"' },
    ]);
    expect(wrapped[0].indicator).toBe("ring");
  });

  test("a frame loop that ignores the motion preference is caught, and the shared counter is not", () => {
    expect(findUnguardedJsMotion([
      { path: "synthetic.jsx", source: "const raf = (ts) => requestAnimationFrame(raf);" },
    ])).toHaveLength(1);

    const heroTile = kitSources.find((entry) => entry.path === "src/components/HeroTile.jsx");
    expect(heroTile.source).toContain("requestAnimationFrame");
    expect(findUnguardedJsMotion([heroTile])).toEqual([]);
  });

  test("the sheet keeps the reduced-motion reset and both settings that ask for it", () => {
    const coverage = reducedMotionCoverage(css);
    expect(coverage.globalReduction).toBe(true);
    expect(coverage.resetBody).toBe(true);
    expect(coverage.settingNames).toEqual(expect.arrayContaining(["minimal", "none"]));
    expect(coverage.unguardedSettings).toEqual([]);
    expect(coverage.settingGuards).toBeGreaterThan(10);
  });
});

describe("the gate over the tree as it stands", () => {
  const report = buildAccessibilityReport({
    tokens,
    accents,
    sources: kitSources,
    motionScope: kitSources,
    css,
  });

  test("the shared design system passes every gated class", () => {
    expect(report.failed).toBe(false);
    expect(report.contrastBelowMinimum).toEqual([]);
    expect(report.focusIndicatorBelowMinimum).toEqual([]);
    expect(report.focusSuppressionWithoutIndicator).toEqual([]);
    expect(report.unguardedJsMotion).toEqual([]);
  });

  test("it passed by measuring the tree, not by measuring nothing", () => {
    expect(report.contrastPairsChecked).toBe(TEXT_PAIRS.length * 2);
    expect(report.chipTonesChecked).toBe(24);
    expect(report.focusIndicatorsChecked).toBeGreaterThan(20);
    expect(report.motionScopedSources.length).toBeGreaterThan(10);
    expect(report.focusIndicators.every((entry) => entry.ratio !== null)).toBe(true);
  });

  test("every row that paints a highlight fill carries a ring", () => {
    expect(report.rowIndicatorMissing).toEqual([]);
    expect(report.rowIndicatorMissingCount).toBe(0);
    // The accent fill alone, for the record: it is what made a fill-only row unusable.
    for (const theme of ["dark", "light"]) {
      expect(contrastRatio(hslToRgb(tokens[theme].accent), hslToRgb(tokens[theme].popover)))
        .toBeLessThan(FOCUS_INDICATOR_MINIMUM);
    }
    // And the rings that ride on those rows are measured, not just counted.
    const rowRings = report.focusIndicators.filter((entry) => /^(focus|data-\[)/.test(entry.indicator || ""));
    expect(rowRings.length).toBeGreaterThanOrEqual(7);
    expect(rowRings.every((entry) => entry.ratio >= FOCUS_INDICATOR_MINIMUM)).toBe(true);
  });

  test("what it does not gate is reported with a number instead of hidden", () => {
    // Card boundaries, shadcn's default destructive fill and the light-theme signal
    // glyphs: real gaps, but closing them is a visual-identity decision rather than a
    // coverage one, so they are ranked instead of failing the build.
    expect(report.contrastBacklog.length).toBeGreaterThan(0);
    expect(report.contrastBacklog.every((entry) => entry.ratio < entry.minimum)).toBe(true);
    expect(report.contrastBacklog.map((entry) => entry.ratio)).toEqual(
      [...report.contrastBacklog.map((entry) => entry.ratio)].sort((left, right) => left - right),
    );

    // No row is left indicating focus with a fill alone.
    expect(report.focusBacklog).toEqual([]);
    // The one outline suppression that is not a row: a popover container, which carries a
    // shadow and is not something the operator arrows through.
    expect(report.outlineSuppressedOnSurfaces.map((entry) => entry.path))
      .toEqual(["src/components/ui/popover.jsx"]);
  });

  test("each gated class is named, so a failure says which promise broke", () => {
    expect(GATED_CLASSES).toEqual(expect.arrayContaining([
      "contrastBelowMinimum",
      "focusIndicatorBelowMinimum",
      "rowIndicatorMissing",
      "outlineSuppressedWithoutIndicator",
      "unguardedJsMotion",
      "reducedMotionResetMissing",
    ]));
  });
});

describe("reading the tree", () => {
  test("the accent presets are read from the one place they are applied", () => {
    expect(accents).toHaveLength(8);
    expect(accents.map((preset) => preset.name)).toEqual(
      expect.arrayContaining(["emerald", "blue", "cyan", "violet", "orange", "red", "sky", "rose"]),
    );
    expect(accents[0].dark).toHaveLength(3);
    expect(accents[0].light).toHaveLength(3);
  });

  test("local imports resolve to source paths, so the motion scope follows delegation", () => {
    const imports = resolveLocalImports('import HeroTile from "@/components/HeroTile";\nimport { cn } from "./utils";');
    expect(imports).toEqual(expect.arrayContaining(["src/components/HeroTile", "src/components/design-system/utils"]));
    // A library import is not part of the motion scope.
    expect(resolveLocalImports('import { AreaChart } from "recharts";')).toEqual([]);
  });
});
