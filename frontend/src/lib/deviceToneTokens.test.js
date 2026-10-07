/* The device detail cluster renders severity as colour, and it used to hardcode a
   dark-theme neon palette. Measured against the white light theme, every literal it
   used landed between 1.78:1 and 2.13:1 — under the 3:1 non-text threshold for a
   glyph, a severity dot or a 6px telemetry track, and under 4.5:1 for the agent
   status text. This suite pins the replacement: one theme-aware token per tone, the
   original hue kept for the dark theme, and a deepened hue for the light theme. */
import fs from "fs";
import path from "path";

const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8");

const LIGHT_THEME_START = css.indexOf("\n    .light {");
const DEVICE_REGION = css.slice(
  css.indexOf(".nx-device-action-summary__icon {"),
  css.indexOf("@keyframes nx-device-meter-enter"),
);

// Each tone and the dark-theme literal it replaced. Consolidating near-identical
// hexes is the only change the dark theme was allowed to take.
const DEVICE_TONES = {
  positive: "#12d98b",
  caution: "#f1ba36",
  watch: "#f4d13d",
  critical: "#ef4a57",
  info: "#13cce4",
};

const declarationsOf = (tone) => {
  const pattern = new RegExp(`--nx-device-tone-${tone}:\\s*([^;]+);`, "g");
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

// Every device surface in the light theme is a white or near-white card, so the
// white page is the strictest backdrop the cluster is measured against.
const contrastAgainstWhite = (rgb) => Math.round((1.05 / (relativeLuminance(rgb) + 0.05)) * 100) / 100;

test("every device tone is declared exactly once per theme", () => {
  for (const tone of Object.keys(DEVICE_TONES)) {
    const declarations = declarationsOf(tone);
    expect(declarations).toHaveLength(2);
    expect(declarations.filter((entry) => entry.light)).toHaveLength(1);
  }
});

test("the light theme restates every tone as a darker hue", () => {
  for (const tone of Object.keys(DEVICE_TONES)) {
    const light = lightValueOf(tone);
    expect(light).not.toBe(darkValueOf(tone));
    // Carrying the dark hue into the light theme is exactly the defect replaced.
    expect(relativeLuminance(toRgb(hslTriple(light)))).toBeLessThan(
      relativeLuminance(toRgb(hslTriple(darkValueOf(tone)))),
    );
  }
});

test("light-theme device tones clear the 3:1 non-text threshold", () => {
  for (const tone of Object.keys(DEVICE_TONES)) {
    expect(contrastAgainstWhite(toRgb(hslTriple(lightValueOf(tone))))).toBeGreaterThanOrEqual(3);
  }
});

test("the caution tone also clears 4.5:1 because it renders the agent status text", () => {
  expect(contrastAgainstWhite(toRgb(hslTriple(lightValueOf("caution"))))).toBeGreaterThanOrEqual(4.5);
});

test("the dark theme keeps the hue the cluster shipped with", () => {
  for (const [tone, hex] of Object.entries(DEVICE_TONES)) {
    const expected = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const actual = toRgb(hslTriple(darkValueOf(tone)));
    actual.forEach((channel, index) => {
      expect(Math.abs(channel - expected[index])).toBeLessThanOrEqual(4);
    });
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

test("every data-tone rule resolves through a device tone token", () => {
  const toneRules = DEVICE_REGION.split("\n").filter(
    (line) => line.includes("[data-tone=") && line.includes("{"),
  );
  expect(toneRules.length).toBeGreaterThan(0);
  for (const rule of toneRules) {
    expect(rule).toContain("var(--nx-device-tone-");
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  }
});

test("the device cluster no longer reads the undefined amber scale", () => {
  // `--amber-500` is declared nowhere in the stylesheet, so every use silently fell
  // back to `38 92% 50%` — 2.13:1 against the light-theme surface.
  expect(DEVICE_REGION).not.toContain("--amber-500");
});
