/**
 * Accessibility coverage for the shared Nexus design system.
 *
 * The design system made three promises that nothing in the repository checked, and
 * each one had already been broken in a way that only measurement can show:
 *
 *   * **contrast** — the sheet's own prose records that the light theme had to restate
 *     the signal tones because the dark-theme neon glyphs measured 1.68-2.13:1 on a
 *     white card, and `signalToneTokens.test.js` pins that one scale. Nothing pinned
 *     the *base* token pairs, the accent presets, or the design system's own
 *     components — which shipped their status chips as fixed Tailwind `-500` literals
 *     that measure 2.15-4.47:1 as text on the light theme's white card.
 *   * **focus visibility** — `Button` shipped `focus-visible:ring-primary/35`. A 35%
 *     ring composites to 1.40-1.95:1 against the surface behind it for every one of
 *     the eight accent presets, in both themes: it is in the DOM, and it is
 *     effectively invisible on screen. The Radix and cmdk rows had the mirror-image
 *     problem: they marked the current row with an accent *fill*, which measures
 *     1.10-1.21:1 against the popover it fills, so the row the arrow keys were on was
 *     marked by nothing usable at 3:1. That is measured below, never asserted.
 *   * **reduced motion** — the sheet guards CSS animation thoroughly (`html[data-motion]`
 *     plus a global `prefers-reduced-motion` reset), but a media query cannot reach
 *     JavaScript. `MetricTile` delegates to `HeroTile`, whose `AnimatedCounter` drove
 *     every KPI figure through `requestAnimationFrame` whatever the setting was, so a
 *     technician who had explicitly asked for no motion still watched every number
 *     count up.
 *
 * This module is the single definition of all three, deliberately pure and
 * dependency-free: `scripts/audit-accessibility.mjs` walks the real tree with it and
 * the unit tests pin its behaviour, so the policy cannot drift away from the gate that
 * enforces it.
 *
 * Scope note, stated rather than hidden. This is measurement plus source shape. It can
 * prove a token pair's ratio, that every focus indicator a shared control declares
 * clears the threshold at the alpha it declares, and that a primitive consults the
 * motion preference. It cannot prove how the result *looks*: it measures declared
 * colours rather than rendered pixels, and appearance remains evidenced by the browser
 * matrix. The one class it deliberately does *not* gate is recorded in `REPORTED_PAIRS`
 * and `focusBacklog` instead, with numbers, so a gap is documented rather than hidden.
 */

/* -------------------------------------------------------------------------- *
 * Thresholds and scales
 * -------------------------------------------------------------------------- */

/** WCAG 1.4.3 contrast for normal text. Chip copy is 9px uppercase: never "large". */
export const TEXT_CONTRAST_MINIMUM = 4.5;

/** WCAG 1.4.11 non-text contrast — the bar the sheet already holds signal tones to. */
export const NON_TEXT_CONTRAST_MINIMUM = 3;

/**
 * The focus-indicator bar: WCAG 2.4.13 (focus appearance) asks for 3:1 between the
 * indicator and the colours adjacent to it, which is the same threshold 1.4.11 applies
 * to a component boundary. Nexus keeps one number for both.
 */
export const FOCUS_INDICATOR_MINIMUM = 3;

/**
 * The setting names the audit expects to find guarded in the sheet. `App.js` writes one
 * of these to `<html data-motion>`, and `src/lib/motionPreference.js` is the runtime
 * owner of the list; the audit only checks the sheet still honours them.
 */
export const GUARDED_MOTION_SETTINGS = ["minimal", "none"];

/** The hue scale the shared status and identity chips own, one declaration per theme. */
export const CHIP_TONES = ["sky", "blue", "indigo", "amber", "emerald", "rose"];

/**
 * The chips render their label on a `bg-chip-<tone>/5` tint over the card, so the
 * backdrop is very slightly tinted rather than the plain surface. Measuring the plain
 * card would quietly overstate the ratio, so the tint is composited in.
 */
export const CHIP_TINT_ALPHA = 0.05;

/**
 * The surfaces a focus indicator can be drawn against.
 *
 * `background` and `card` are the page surfaces a control sits on. `popover` is the surface
 * a flyout row sits in, and `accent` is the fill that row paints when it is the current one:
 * an *inset* row ring is drawn on that fill, so measuring only the page surfaces would miss
 * the pair that matters most for a menu.
 */
export const FOCUS_SURFACES = ["background", "card", "popover", "accent"];

/**
 * Selectors that mean "this row is the current one". Radix marks a highlighted row with
 * `focus` (it moves real focus with the arrow keys) and cmdk with `data-selected`, so both
 * spellings have to be recognised for a row indicator to be checkable.
 */
export const ROW_HIGHLIGHT_PREFIXES =
  "(?:focus-visible|focus|data-\\[highlighted\\]|data-\\[selected=true\\]|data-\\[state=open\\])";

/**
 * The shared modules whose motion and focus behaviour is the design system's own. The
 * script additionally follows local imports one level from the design-system module, so
 * a newly delegated primitive is audited the moment it is imported rather than the
 * moment someone remembers to add it here.
 */
export const SHARED_KIT_ROOTS = [
  "src/components/design-system",
  "src/components/ui",
  "src/components/HeroTile.jsx",
];

/**
 * Whether a path is part of the shared kit rather than a test for it.
 *
 * A test asserts what a control declares; it does not declare one itself. A test that names
 * `data-[selected=true]:bg-accent` in an expectation is evidence the rule is enforced, so
 * scanning tests would fail the gate on the assertions that prove the gate works.
 */
export function isSharedKitSource(path) {
  const value = String(path || "");
  return /\.(js|jsx)$/.test(value) && !/\.test\.(js|jsx)$/.test(value);
}

/** The tokens a source must consult before it starts a frame loop. */
export const MOTION_PREFERENCE_MARKERS = [
  "useReducedMotion",
  "prefersReducedMotion",
  "subscribeToMotionPreference",
  "motionPreference",
];

/* -------------------------------------------------------------------------- *
 * Colour maths
 * -------------------------------------------------------------------------- */

/** Parse the `"199 89% 48%"` form the sheet stores its tokens in. */
export function parseHslTriple(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .map((part) => Number(part.replace("%", "")));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts;
}

/**
 * HSL to rgb, the standard conversion.
 *
 * The sheet stores rounded triples (`199 89% 48%` approximates sky-500, whose rgb is
 * `14 165 233`), so a token resolves to values within a couple of channels of the palette
 * literal it came from. That is a property of the source data, not of the maths.
 */
export function hslToRgb([hue, saturation, lightness]) {
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [channel(0), channel(8), channel(4)];
}

export function relativeLuminance([r, g, b]) {
  const linear = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, rounded to two decimals. Order-independent. */
export function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/** Composite a translucent foreground (a `/35` ring, a `/5` fill) over its backdrop. */
export function compositeOver(foreground, backdrop, alpha) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  return foreground.map((channel, index) => Math.round(channel * a + backdrop[index] * (1 - a)));
}

/** Tailwind's opacity suffix (`ring-primary/35`, `bg-chip-sky/5`) as an alpha. */
export function alphaFromSuffix(suffix) {
  if (suffix === undefined || suffix === null || suffix === "") return 1;
  const value = Number(suffix);
  if (!Number.isFinite(value)) return 1;
  return value > 1 ? value / 100 : value;
}

/* -------------------------------------------------------------------------- *
 * Reading the sheet
 * -------------------------------------------------------------------------- */

/**
 * The sheet's two theme blocks: `:root` is the dark theme Nexus ships, `.light` is the
 * restatement `App.js` toggles onto `<html>`.
 */
export function parseThemeTokens(css) {
  const text = String(css || "");
  const lightStart = text.indexOf(".light {");
  const tokens = { dark: {}, light: {} };
  const pattern = /--([a-z0-9-]+):\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*;/g;
  for (const match of text.matchAll(pattern)) {
    const theme = lightStart >= 0 && match.index > lightStart ? "light" : "dark";
    const [, name, hue, saturation, lightness] = match;
    if (!(name in tokens[theme])) tokens[theme][name] = [Number(hue), Number(saturation), Number(lightness)];
  }
  return tokens;
}

/**
 * The accent presets, read from `App.js` because that is where the operator's choice is
 * applied: `--primary` and `--ring` are overwritten from these values, so a preset is a
 * focus indicator's real colour.
 */
export function parseAccentPresets(source) {
  const pattern = /(\w+):\s*\{\s*primary:\s*"([^"]+)",\s*lightPrimary:\s*"([^"]+)"\s*\}/g;
  return [...String(source || "").matchAll(pattern)].map((match) => ({
    name: match[1],
    dark: parseHslTriple(match[2]),
    light: parseHslTriple(match[3]),
  }));
}

/** The colour tokens a focus ring may name, resolved to rgb for one theme. */
export function resolveToken(tokens, theme, name) {
  const triple = tokens?.[theme]?.[name];
  return triple ? hslToRgb(triple) : null;
}

/* -------------------------------------------------------------------------- *
 * Contrast
 * -------------------------------------------------------------------------- */

/**
 * Token pairs the design system promises to keep legible as text, in both themes.
 * `on` names the surface the text sits on; every pair here is gated at
 * `TEXT_CONTRAST_MINIMUM`.
 */
export const TEXT_PAIRS = [
  { token: "foreground", on: "background", why: "workspace body copy" },
  { token: "card-foreground", on: "card", why: "card copy" },
  { token: "muted-foreground", on: "background", why: "secondary copy on the page" },
  { token: "muted-foreground", on: "card", why: "secondary copy in a card" },
  { token: "muted-foreground", on: "muted", why: "copy on a muted chip or row" },
  { token: "secondary-foreground", on: "secondary", why: "secondary control label" },
  { token: "accent-foreground", on: "accent", why: "hovered / open control label" },
  { token: "primary-foreground", on: "primary", why: "primary button label" },
];

/**
 * Pairs that are measured and reported but deliberately *not* gated, because closing
 * them is a visual-identity decision rather than a coverage gap. Each is listed in the
 * report with its ratio, so the number is never a surprise.
 */
export const REPORTED_PAIRS = [
  { token: "destructive-foreground", on: "destructive", why: "shadcn's default red fill with white copy: 3.62:1 dark / 3.78:1 light", minimum: TEXT_CONTRAST_MINIMUM },
  { token: "border", on: "background", why: "decorative card and table boundaries", minimum: NON_TEXT_CONTRAST_MINIMUM },
  { token: "input", on: "background", why: "input boundary; inputs are bg-transparent, so this boundary is the affordance", minimum: NON_TEXT_CONTRAST_MINIMUM },
  { token: "border", on: "card", why: "decorative boundaries inside a card", minimum: NON_TEXT_CONTRAST_MINIMUM },
  { token: "success", on: "background", why: "light-theme success glyph / border", minimum: NON_TEXT_CONTRAST_MINIMUM },
  { token: "warning", on: "background", why: "light-theme warning glyph / border", minimum: NON_TEXT_CONTRAST_MINIMUM },
  { token: "offline", on: "background", why: "offline badge copy", minimum: TEXT_CONTRAST_MINIMUM },
];

/** Measure one token pair in one theme, or `null` when a token is undeclared. */
export function measurePair(tokens, theme, pair) {
  const foreground = resolveToken(tokens, theme, pair.token);
  const backdrop = resolveToken(tokens, theme, pair.on);
  if (!foreground || !backdrop) return null;
  return {
    theme,
    pair: `${pair.token} on ${pair.on}`,
    ratio: contrastRatio(foreground, backdrop),
    minimum: pair.minimum ?? TEXT_CONTRAST_MINIMUM,
  };
}

/**
 * The chip scale, measured the way the chips actually render: label colour over a 5%
 * tint of itself on the card (and on the page background).
 */
export function measureChipTones(tokens) {
  return ["dark", "light"].flatMap((theme) =>
    CHIP_TONES.flatMap((tone) => {
      const label = resolveToken(tokens, theme, `nx-chip-${tone}`);
      if (!label) return [];
      return ["background", "card"].flatMap((surface) => {
        const backdrop = resolveToken(tokens, theme, surface);
        if (!backdrop) return [];
        const tinted = compositeOver(label, backdrop, CHIP_TINT_ALPHA);
        return [{
          theme,
          pair: `${tone} chip label on ${surface}`,
          ratio: contrastRatio(label, tinted),
          minimum: TEXT_CONTRAST_MINIMUM,
        }];
      });
    }),
  );
}

/* -------------------------------------------------------------------------- *
 * Focus visibility
 * -------------------------------------------------------------------------- */

/**
 * Every focus indicator the shared kit declares, measured at the alpha it declares.
 *
 * A ring is drawn over whatever is behind the control, so both surfaces a control can
 * sit on are measured: the page background and a card. Reading the alpha out of the
 * class matters — `ring-ring` measures 4.08-8.72 across the presets, and
 * `ring-primary/35` measures 1.40-1.95, which is the difference this audit exists for.
 */
export function measureFocusIndicators({ tokens, accents }) {
  const findings = [];
  for (const { name, dark, light } of accents) {
    for (const theme of ["dark", "light"]) {
      const preset = theme === "dark" ? dark : light;
      if (!preset) continue;
      // Presets are stored as HSL triples, exactly as `App.js` writes them onto
      // `<html>`; contrast maths needs rgb, and passing the triple through unconverted
      // silently measures a brownish fiction instead of the accent.
      const ring = hslToRgb(preset);
      for (const surface of FOCUS_SURFACES) {
        const backdrop = resolveToken(tokens, theme, surface);
        if (!backdrop) continue;
        findings.push({
          indicator: `${name} accent ring`,
          theme,
          surface,
          ratio: contrastRatio(ring, backdrop),
          minimum: FOCUS_INDICATOR_MINIMUM,
        });
      }
    }
  }
  return findings;
}

/**
 * Ring utilities that are geometry rather than colour. A width (`ring-2`) or a modifier
 * (`ring-inset`, `ring-offset-*`) names no colour, so treating one as a token would report a
 * perfectly good indicator as "does not resolve to a sheet token".
 */
export const RING_MODIFIERS = ["inset", "offset"];

/**
 * Parse `<row selector>:ring-<token>[/alpha]` declarations out of a source file.
 *
 * The selector is captured, not assumed: `focus-visible:` is how a control declares its
 * ring, and `focus:`/`data-[selected=true]:`/`data-[state=open]:` is how a row declares the
 * one that rides on the fill it paints.
 */
export function findFocusRingDeclarations(source) {
  const pattern = new RegExp(`${ROW_HIGHLIGHT_PREFIXES}:ring-(?!offset)([a-z][a-z0-9-]*)(?:\\/(\\d+))?`, "g");
  const seen = [];
  for (const match of String(source || "").matchAll(pattern)) {
    const [, token, suffix] = match;
    if (/^\d+$/.test(token)) continue; // `focus-visible:ring-2` is a width, not a colour
    if (RING_MODIFIERS.includes(token) || token.startsWith("offset")) continue;
    seen.push({ token, alpha: alphaFromSuffix(suffix), declaration: match[0] });
  }
  return seen;
}

/**
 * Measure every ring a shared source declares, against the surfaces it can be drawn
 * over, for every accent preset when the ring follows `--primary`/`--ring`.
 */
export function auditFocusRings({ sources, tokens, accents }) {
  const accentRings = measureFocusIndicators({ tokens, accents });
  const declarations = [];
  for (const { path, source } of sources || []) {
    for (const { token, alpha, declaration } of findFocusRingDeclarations(source)) {
      // An accent preset rewrites `--primary` and `--ring`, so a ring that follows either
      // one is measured against every preset — but each preset colour belongs to *its own*
      // theme. Measuring a light preset against the dark card would invent a failure that
      // no operator can see, which is exactly how a gate loses its authority.
      //
      // (`[token, "ring", "primary"].includes(token)` is always true, because the array is
      // built with `token` in it; that silently measured every ring against the presets and
      // let an unresolvable colour pass as resolved.)
      const followsAccent = ["ring", "primary"].includes(token);
      const colours = followsAccent
        ? accents.flatMap((preset) => [
          { theme: "dark", rgb: preset.dark ? hslToRgb(preset.dark) : null },
          { theme: "light", rgb: preset.light ? hslToRgb(preset.light) : null },
        ]).filter((entry) => entry.rgb)
        : ["dark", "light"].flatMap((theme) => {
          const rgb = resolveToken(tokens, theme, token);
          return rgb ? [{ theme, rgb }] : [];
        });

      const surfaces = colours.flatMap(({ theme, rgb }) => FOCUS_SURFACES.flatMap((surface) => {
        const backdrop = resolveToken(tokens, theme, surface);
        if (!backdrop) return [];
        return [{
          theme,
          surface,
          ratio: contrastRatio(compositeOver(rgb, backdrop, alpha), backdrop),
        }];
      }));

      const worstRatio = surfaces.length ? Math.min(...surfaces.map((entry) => entry.ratio)) : null;
      const worst = surfaces.find((entry) => entry.ratio === worstRatio) || null;
      declarations.push({
        path,
        declaration,
        alpha,
        minimum: FOCUS_INDICATOR_MINIMUM,
        worstRatio,
        worstSurface: worst ? worst.surface : null,
        worstTheme: worst ? worst.theme : null,
        checkedColours: surfaces.length,
        // A declaration whose colour cannot be resolved is not silently skipped.
        resolved: surfaces.length > 0,
      });
    }
  }
  return { accentRings, declarations };
}

/**
 * Components that hide the native outline. Nexus accepts a fill change as a visible
 * focus indicator on keyboard-driven composite widgets (Radix menu and list items,
 * which move focus with the arrow keys), but a fill change is *not* a strong enough
 * indicator at 3:1 — `--accent` measures 1.09-1.35:1 against the surface it fills — so
 * those files are listed in `focusBacklog` rather than gated. A suppressed outline with
 * no indicator at all is a different matter and is gated.
 */
const escapeForRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rows that mark the current row with a fill and nothing else.
 *
 * This is the direct form of the rule: an accent fill measures 1.21:1 (dark) and 1.10:1
 * (light) against the popover it fills, so a row whose only marker is that fill is marked by
 * something under the 3:1 a focus indicator needs. The ring must ride on the *same* selector
 * that paints the fill — a ring on `focus:` alone would leave a row highlighted by
 * `data-selected` unmarked, which is exactly how cmdk behaves.
 */
export function findFillOnlyRows(sources) {
  const fillPattern = new RegExp(`(${ROW_HIGHLIGHT_PREFIXES}):bg-[a-z0-9-]+`, "g");
  // Geometry and modifiers do not name a colour. `ring-1` is a width, `ring-inset` is a
  // placement, and a ring with neither a token nor a width would fall back to Tailwind's own
  // default — a 50%-alpha blue that no theme owns.
  const notAColour = `${RING_MODIFIERS.map((modifier) => `(?!${modifier}\\b)`).join("")}(?!offset)(?!\\d)`;
  return (sources || []).flatMap(({ path, source }) => {
    const rows = [];
    for (const raw of String(source || "").split("\n")) {
      const prefixes = [...new Set([...raw.matchAll(fillPattern)].map((match) => match[1]))];
      for (const prefix of prefixes) {
        const ring = new RegExp(`${escapeForRegExp(prefix)}:ring-${notAColour}[a-z][a-z0-9-]*`);
        if (!ring.test(raw)) rows.push({ path, prefix, line: raw.trim().slice(0, 120) });
      }
    }
    return rows;
  });
}

export const OUTLINE_INDICATORS = [
  { kind: "ring", pattern: /ring-(?!offset)[a-z0-9-]+/ },
  { kind: "shadow", pattern: /shadow-\[|shadow-(sm|md|lg|xl)/ },
  { kind: "outline", pattern: /outline-(?!none)[a-z0-9-]+/ },
  { kind: "fill", pattern: /(?:focus|focus-visible|data-\[[^\]]+\]):bg-[a-z0-9-]+/ },
];

export function findOutlineSuppressions(sources, windowSize = 2) {
  return (sources || []).flatMap(({ path, source }) => {
    const lines = String(source || "").split("\n");
    const out = [];
    lines.forEach((raw, index) => {
      if (!/outline-none|outline:\s*none|outline:\s*0\b/.test(raw)) return;
      // A className or a CSS rule can wrap, so the indicator is looked for in the
      // declaration the suppression belongs to rather than on its own line only. The
      // window is deliberately small: a wider one would start crediting a neighbouring
      // element's ring, which would make the guard pass for the wrong reason.
      const context = lines.slice(Math.max(0, index - windowSize), index + windowSize + 1).join("\n");
      const indicator = OUTLINE_INDICATORS.find(({ pattern }) => pattern.test(context));
      out.push({
        path,
        line: raw.trim().slice(0, 120),
        indicator: indicator ? indicator.kind : "none",
      });
    });
    return out;
  });
}

/* -------------------------------------------------------------------------- *
 * Reduced motion
 * -------------------------------------------------------------------------- */

/**
 * The sheet's motion guards. CSS animation is already covered thoroughly, so this only
 * pins that the coverage is still there: a global `prefers-reduced-motion` reset, the
 * `html[data-motion]` setting the in-app Motion control writes, and no animation
 * declared outside either.
 */
export function reducedMotionCoverage(css) {
  const text = String(css || "");
  const globalReduction = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*/.test(text);
  const settingGuards = [...text.matchAll(/html\[data-motion=/g)].length;
  const resetBody = /animation-duration:\s*1ms\s*!important/.test(text);
  const settingNames = [...new Set([...text.matchAll(/html\[data-motion="([a-z]+)"\]/g)].map((match) => match[1]))];
  return {
    globalReduction,
    resetBody,
    settingGuards,
    settingNames,
    // The two settings the in-app Motion control uses to mean "less movement"; a sheet
    // that stopped guarding one of them would keep animating for that operator.
    unguardedSettings: GUARDED_MOTION_SETTINGS.filter((setting) => !settingNames.includes(setting)),
  };
}

/**
 * A source that starts a frame loop owes the operator the motion preference: CSS cannot
 * reach `requestAnimationFrame`, so the check has to live in the component.
 */
export function findUnguardedJsMotion(sources) {
  const animates = /requestAnimationFrame\s*\(/;
  return (sources || [])
    .filter(({ source }) => animates.test(String(source || "")))
    .filter(({ source }) => !MOTION_PREFERENCE_MARKERS.some((marker) => String(source).includes(marker)))
    .map(({ path, source }) => ({
      path,
      reason: `starts a frame loop (${(String(source).match(animates) || []).length ? "requestAnimationFrame" : "?"}) without consulting the motion preference`,
    }));
}

/* -------------------------------------------------------------------------- *
 * Resolving what the design system delegates to
 * -------------------------------------------------------------------------- */

/** Local (Nexus) imports of a module, as source paths, so the motion scope follows them. */
export function resolveLocalImports(source, modulePath = "src/components/design-system/index.jsx") {
  const pattern = /from\s+"(@\/[^"]+|\.[^"]+)"/g;
  const dir = modulePath.split("/").slice(0, -1).join("/");
  const resolved = new Set();
  for (const match of String(source || "").matchAll(pattern)) {
    const specifier = match[1];
    if (specifier.startsWith("@/")) {
      resolved.add(`src/${specifier.slice(2)}`);
      continue;
    }
    const parts = `${dir}/${specifier}`.split("/");
    const stack = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    resolved.add(stack.join("/"));
  }
  return [...resolved];
}

/** A source path as the tree stores it, with the extension the file actually uses. */
export function withSourceExtension(path) {
  const value = String(path || "");
  if (/\.(js|jsx|ts|tsx|css)$/.test(value)) return value;
  return `${value}.jsx`;
}

/* -------------------------------------------------------------------------- *
 * The gate
 * -------------------------------------------------------------------------- */

/**
 * Classes the audit fails on, at zero.
 *
 * All four are mechanical: a measured ratio below its threshold, a focus ring that
 * cannot be resolved to a token, a frame loop that ignores the motion preference, or a
 * sheet that has lost its reduced-motion reset. Nothing here is a matter of taste.
 */
export const GATED_CLASSES = [
  "contrastBelowMinimum",
  "focusIndicatorBelowMinimum",
  "rowIndicatorMissing",
  "outlineSuppressedWithoutIndicator",
  "unguardedJsMotion",
  "reducedMotionResetMissing",
];

export function buildAccessibilityReport({
  tokens = { dark: {}, light: {} },
  accents = [],
  sources = [],
  motionScope = [],
  css = "",
} = {}) {
  const themes = ["dark", "light"];

  const textMeasurements = themes.flatMap((theme) =>
    TEXT_PAIRS.map((pair) => measurePair(tokens, theme, pair)).filter(Boolean),
  );
  const chipMeasurements = measureChipTones(tokens);
  const contrastFailures = [...textMeasurements, ...chipMeasurements].filter(
    (entry) => entry.ratio < entry.minimum,
  );

  const { accentRings, declarations } = auditFocusRings({ sources, tokens, accents });
  const ringFailures = accentRings.filter((entry) => entry.ratio < entry.minimum);
  const declarationFailures = declarations
    .filter((entry) => !entry.resolved || (entry.worstRatio !== null && entry.worstRatio < entry.minimum))
    .map((entry) => ({
      path: entry.path,
      declaration: entry.declaration,
      alpha: entry.alpha,
      ratio: entry.worstRatio,
      surface: entry.worstSurface,
      minimum: entry.minimum,
      reason: entry.resolved
        ? `${Math.round(entry.alpha * 100)}% of the focus colour composites to ${entry.worstRatio}:1 over --${entry.worstSurface} (${entry.worstTheme} theme)`
        : "focus colour does not resolve to a sheet token, so neither theme owns it",
    }));

  const suppressions = findOutlineSuppressions(sources);
  const fillOnlyRows = findFillOnlyRows(sources);
  const unguarded = findUnguardedJsMotion(motionScope);
  const motion = reducedMotionCoverage(css);

  // A suppression whose indicator is a fill is a row (Radix, cmdk); one whose indicator is a
  // shadow is a surface — a popover container is not a row the operator arrows through, so it
  // is reported separately rather than counted as a missing indicator.
  const rowBacklog = suppressions.filter((entry) => entry.indicator === "fill");
  const surfaceSuppressions = suppressions.filter((entry) => entry.indicator === "shadow");

  const reportedPairs = themes.flatMap((theme) =>
    REPORTED_PAIRS.map((pair) => measurePair(tokens, theme, pair)).filter(Boolean),
  );

  return {
    themes,
    contrastPairsChecked: textMeasurements.length,
    chipTonesChecked: chipMeasurements.length,
    textContrastMinimum: TEXT_CONTRAST_MINIMUM,
    nonTextContrastMinimum: NON_TEXT_CONTRAST_MINIMUM,
    focusIndicatorMinimum: FOCUS_INDICATOR_MINIMUM,
    focusIndicatorsChecked: accentRings.length + declarations.length,
    motionScopedSources: motionScope.map((entry) => entry.path),
    contrastBelowMinimum: contrastFailures,
    focusIndicatorBelowMinimum: [...ringFailures, ...declarationFailures],
    unguardedJsMotion: unguarded,
    reducedMotion: {
      ...motion,
      // The reset is what makes every existing `animate-*` and inline transition obey the
      // operator's choice; without it the sheet's motion coverage is a set of local rules.
      missing: !(motion.globalReduction && motion.resetBody),
    },
    contrastBacklog: reportedPairs
      .filter((entry) => entry.ratio < entry.minimum)
      .sort((left, right) => left.ratio - right.ratio),
    rowIndicatorMissing: fillOnlyRows,
    rowIndicatorMissingCount: fillOnlyRows.length,
    // Rows whose only indicator is a fill. Empty by construction once every row carries a
    // ring; a reappearance here is the regression this audit is aimed at.
    focusBacklog: rowBacklog,
    focusSuppressionWithoutIndicator: suppressions.filter((entry) => entry.indicator === "none"),
    // Surfaces that suppress the outline and carry a shadow. A popover container is not a row
    // the operator arrows through, so it is listed rather than counted as a missing indicator.
    outlineSuppressedOnSurfaces: surfaceSuppressions,
    focusIndicators: [
      ...accentRings.map((entry) => ({ ...entry, indicator: `${entry.indicator} over --${entry.surface}` })),
      // The binding surface and theme are part of the number, not decoration: they are what
      // makes "3.19:1" checkable, and they are the reason an inset row ring is measured
      // against the fill it is drawn on rather than only against the page.
      ...declarations.map((entry) => ({
        indicator: entry.declaration,
        path: entry.path,
        ratio: entry.worstRatio,
        surface: entry.worstSurface,
        theme: entry.worstTheme,
        minimum: entry.minimum,
      })),
    ],
    outlineSuppressedWithoutIndicatorCount: suppressions.filter((entry) => entry.indicator === "none").length,
    gatedClasses: GATED_CLASSES,
    failed:
      contrastFailures.length > 0
      || ringFailures.length > 0
      || declarationFailures.length > 0
      || fillOnlyRows.length > 0
      || suppressions.some((entry) => entry.indicator === "none")
      || unguarded.length > 0
      || !(motion.globalReduction && motion.resetBody),
    expectation:
      "The shared design system stays legible in both themes, shows a focus indicator that clears 3:1 for every accent preset, and honours the operator's motion setting in JavaScript as well as in CSS.",
  };
}
