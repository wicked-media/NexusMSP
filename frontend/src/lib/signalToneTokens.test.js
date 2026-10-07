/* Device detail, the fleet cockpit and the shared workspace header all render
   operational severity as colour, and each cluster used to hardcode its own
   dark-theme neon literals. Measured against the light theme — whose
   `--background` and `--card` both resolve to pure white — those literals landed
   between 1.68:1 and 2.13:1: under the 3:1 non-text threshold for a glyph, a
   status dot or a telemetry track, and under 4.5:1 for status copy. Two of them
   read from `--amber-500` and `--cyan-400`, which are declared nowhere, so every
   use silently ran on its fallback instead.

   This suite pins the replacement: one theme-aware `--nx-tone-*` scale that owns
   each tone once, keeping the original hue for the dark theme and a deepened hue
   for the light theme. */
import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8");

const LIGHT_THEME_START = css.indexOf("\n    .light {");

// The device detail cluster: the region the tone scale was first extracted from,
// still pinned so it cannot drift back to literals.
const DEVICE_REGION = css.slice(
  css.indexOf(".nx-device-action-summary__icon {"),
  css.indexOf("@keyframes nx-device-meter-enter"),
);

// Each tone and the dark-theme literal it replaced. Consolidating the
// near-identical hexes a cluster had accumulated is the only change the dark
// theme was allowed to take.
const TONES = {
  positive: "#12d98b",
  caution: "#f1ba36",
  watch: "#f4d13d",
  critical: "#ef4a57",
  info: "#13cce4",
};

// The surfaces that were measured failing on the light theme, and the tone each
// one must resolve through.
const SIGNAL_RULES = [
  ['.nx-workspace-header[data-signal-state="attention"] .nx-workspace-header__orb', "caution"],
  ['.nx-workspace-header[data-signal-state="attention"] .nx-workspace-header__state-icon', "caution"],
  [".nx-fleet-cockpit-header__mark", "info"],
  [".nx-fleet-cockpit-header__mark::before", "info"],
  [".nx-fleet-cockpit-header__state-copy > span", "caution"],
  [".nx-fleet-attention-rail__heading > span", "caution"],
  [".nx-fleet-telemetry__head svg", "positive"],
  [".nx-device-cockpit-header__mark", "info"],
  [".nx-device-cockpit-header__mark::before", "info"],
];

const declarationsOf = (tone) => {
  const pattern = new RegExp(`--nx-tone-${tone}:\\s*([^;]+);`, "g");
  return [...css.matchAll(pattern)].map((match) => ({
    value: match[1].trim(),
    light: match.index > LIGHT_THEME_START,
  }));
};

const lightValueOf = (tone) => declarationsOf(tone).find((entry) => entry.light).value;
const darkValueOf = (tone) => declarationsOf(tone).find((entry) => !entry.light).value;

const hslTriple = (value) => {
  const parts = value.split(/\s+/).map((part) => Number(part.replace("%", "")));
  expect(parts).toHaveLength(3);
  parts.forEach((part) => expect(Number.isFinite(part)).toBe(true));
  return parts;
};

const toRgb = ([hue, saturation, lightness]) => {
  const h = hue / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [channel(0), channel(8), channel(4)];
};

const relativeLuminance = ([r, g, b]) => {
  const linear = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

// Every one of these surfaces sits on a white or near-white light-theme card, so
// the white page is the strictest backdrop they are measured against.
const contrastAgainstWhite = (rgb) => Math.round((1.05 / (relativeLuminance(rgb) + 0.05)) * 100) / 100;

// The declaration block of a single selector, whether it is written on one line
// or several.
const ruleBody = (selector) => {
  const lines = css.split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith(`${selector} {`));
  expect(start).toBeGreaterThan(-1);
  let body = "";
  for (let index = start; index < lines.length; index += 1) {
    body += lines[index];
    if (lines[index].includes("}")) break;
  }
  return body;
};

test("every tone is declared exactly once per theme", () => {
  for (const tone of Object.keys(TONES)) {
    const declarations = declarationsOf(tone);
    expect(declarations).toHaveLength(2);
    expect(declarations.filter((entry) => entry.light)).toHaveLength(1);
  }
});

test("the light theme restates every tone as a darker hue", () => {
  for (const tone of Object.keys(TONES)) {
    const light = lightValueOf(tone);
    expect(light).not.toBe(darkValueOf(tone));
    // Carrying the dark hue into the light theme is exactly the defect replaced.
    expect(relativeLuminance(toRgb(hslTriple(light)))).toBeLessThan(
      relativeLuminance(toRgb(hslTriple(darkValueOf(tone)))),
    );
  }
});

test("light-theme tones clear the 3:1 non-text threshold", () => {
  for (const tone of Object.keys(TONES)) {
    expect(contrastAgainstWhite(toRgb(hslTriple(lightValueOf(tone))))).toBeGreaterThanOrEqual(3);
  }
});

test("the caution tone also clears 4.5:1 because it renders status copy", () => {
  expect(contrastAgainstWhite(toRgb(hslTriple(lightValueOf("caution"))))).toBeGreaterThanOrEqual(4.5);
});

test("the dark theme keeps the hue the clusters shipped with", () => {
  for (const [tone, hex] of Object.entries(TONES)) {
    const expected = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const actual = toRgb(hslTriple(darkValueOf(tone)));
    actual.forEach((channel, index) => {
      expect(Math.abs(channel - expected[index])).toBeLessThanOrEqual(4);
    });
  }
});

test("every shared signal surface resolves through its tone with no literal left", () => {
  for (const [selector, tone] of SIGNAL_RULES) {
    const body = ruleBody(selector);
    expect(`${selector} :: ${body}`).toContain(`var(--nx-tone-${tone})`);
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(body).not.toMatch(/\brgba?\(/);
  }
});

test("no device severity colour is a raw literal any more", () => {
  const literals = [
    ...new Set([...DEVICE_REGION.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase())),
  ].sort();
  // Only the two filled primary buttons keep a literal: a filled control measures
  // 9.76:1 in the dark theme and 18.1:1 in the light theme, so a token would add
  // indirection without fixing anything.
  expect(literals).toEqual(["#031a12", "#12d98b", "#22e79a"]);
});

test("every data-tone rule resolves through a signal tone token", () => {
  const toneRules = DEVICE_REGION.split("\n").filter(
    (line) => line.includes("[data-tone=") && line.includes("{"),
  );
  expect(toneRules.length).toBeGreaterThan(0);
  for (const rule of toneRules) {
    expect(rule).toContain("var(--nx-tone-");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  }
});

test("the stylesheet keeps no orphan colour scale for these surfaces", () => {
  // `--amber-500` and `--cyan-400` are declared nowhere, so every use silently
  // fell back to a literal that measured under 3:1 on the light theme.
  expect(css).not.toContain("--amber-500");
  expect(css).not.toContain("--cyan-400");
  // The two amber literals the workspace header and the fleet cockpit shipped.
  expect(css).not.toMatch(/#f2c141/i);
  expect(css).not.toMatch(/#f0b938/i);
  expect(css).not.toContain("rgb(242 193 65");
});
