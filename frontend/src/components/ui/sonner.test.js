/* The toast surface is split across two owners, so this suite pins the contract
   between them: components/ui/sonner.jsx names the variant and turns Sonner's own
   styling off, and src/index.css owns every visual property. Each assertion below
   guards a defect that was actually shipping before. */
import fs from "fs";
import path from "path";

const componentSource = fs.readFileSync(path.join(__dirname, "sonner.jsx"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../../index.css"), "utf8");

const TOAST_TONES = ["success", "warning", "error", "info"];

// The declarations of one rule, so unrelated `.nx-toast__*` reuse elsewhere cannot
// mask a missing tone.
const declarationsFor = (selector) => {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
};

// The single-line tone map rules.
const cssRules = (selectorNeedle) =>
  css
    .split("\n")
    .filter((line) => line.includes(selectorNeedle) && line.trim().endsWith("}"))
    .join("\n");

test("Sonner keeps the mechanics and the stylesheet owns the surface", () => {
  // Without `unstyled`, Sonner's runtime-injected theme rules outrank index.css,
  // which is what left the icon chip a flat grey box and the rail drawn twice.
  expect(componentSource).toMatch(/\n\s+unstyled\b/);
  expect(componentSource).toMatch(/richColors=\{false\}/);
});

test("every visual property Sonner would otherwise supply is declared locally", () => {
  const base = declarationsFor("[data-sonner-toaster] .nx-toast {");
  for (const property of ["display: flex", "align-items: center", "width: min(var(--width"]) {
    expect(base).toContain(property);
  }
  // Sonner's toast transition drives enter/exit; overriding it breaks motion.
  expect(base).not.toContain("transition:");
});

test("a tone resolves to a theme signal token so the rail and the icon agree", () => {
  const mapping = cssRules("[data-sonner-toaster] .nx-toast[data-type=");
  for (const [tone, token] of [
    ["success", "--nx-toast-tone-success"],
    ["warning", "--nx-toast-tone-warning"],
    ["error", "--nx-toast-tone-critical"],
    ["info", "--nx-toast-tone-info"],
  ]) {
    expect(mapping).toContain(`[data-type="${tone}"] { --nx-toast-tone: var(${token}); }`);
  }
  // No tone may borrow another tone's colour.
  expect(css).not.toContain('data-type="info"] { --nx-toast-tone: var(--nx-toast-tone-success)');
  expect(css).not.toContain('data-type="info"] { --nx-toast-tone: var(--nx-toast-tone-critical)');
});

test("the light theme deepens the tones instead of reusing the luminous tokens", () => {
  const dark = css.slice(css.indexOf(":root"), css.indexOf(".light"));
  const light = css.slice(css.indexOf(".light", css.indexOf("@layer base")));
  for (const token of ["--nx-toast-tone-success", "--nx-toast-tone-warning", "--nx-toast-tone-critical", "--nx-toast-tone-info"]) {
    expect(dark).toContain(`${token}: var(`);
    // A 15% tint of the bright signal token over a white card lands under 3:1.
    expect(light).toContain(token);
    const declared = new RegExp(`${token}: (\\d{1,3} \\d{1,3}% \\d{1,3}%)`).exec(light);
    expect(declared).not.toBeNull();
    expect(parseInt(declared[1].split(" ")[2], 10)).toBeLessThanOrEqual(45);
  }
  expect(light).not.toContain("--nx-toast-tone-success: var(");
});

test("the rail cannot render twice and never fights Sonner's pseudo-elements", () => {
  // Sonner uses ::before/::after on the toast itself for swipe and stack geometry.
  expect(css).not.toMatch(/\.nx-toast(?:\[[^\]]*\])?::(?:before|after)/);
  // Exactly one rail declaration for the toast itself, and it is tone-driven.
  const rails = css
    .split("\n")
    .filter((line) => line.includes("border-left: 3px solid"));
  expect(rails).toHaveLength(1);
  expect(rails[0]).toContain("hsl(var(--nx-toast-tone))");
});

test("the glyph chip is tinted by the tone instead of a colourless box", () => {
  const icon = declarationsFor("[data-sonner-toaster] .nx-toast__icon {");
  expect(icon).toContain("background: hsl(var(--nx-toast-tone) /");
  expect(icon).toContain("border: 1px solid hsl(var(--nx-toast-tone) /");
  expect(icon).toContain("color: hsl(var(--nx-toast-tone))");
});

test("the close control is held inside the card and stays reachable", () => {
  const close = declarationsFor("[data-sonner-toaster] .nx-toast__close {");
  // Sonner's default translate sits outside the corner and gets clipped.
  expect(close).toContain("transform: none");
  expect(close).toContain("top:");
  expect(close).toContain("right:");
  // Hidden-until-hover is unusable on touch devices.
  expect(css).toContain("@media (hover: none), (max-width: 640px)");
});

test("the tone map has no hardcoded palette left to drift", () => {
  const toastCss = css.split("\n").filter((line) => line.includes("nx-toast")).join("\n");
  expect(toastCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(toastCss).not.toMatch(/rgba?\(\s*\d/);
});

test("stacked background toasts still peek instead of showing stacked text", () => {
  expect(css).toContain('.nx-toast[data-expanded="false"][data-front="false"] > * { opacity: 0; }');
});

test("each tone is classed so a stored preference can never land unstyled", () => {
  for (const variant of ["nx-toast--nexus", "nx-toast--minimal", "nx-toast--ops"]) {
    expect(componentSource).toContain(`"${variant}"`);
    expect(css).toContain(`.${variant}`);
  }
  for (const density of ["nx-toast--comfortable", "nx-toast--dense"]) {
    expect(componentSource).toContain(`"${density}"`);
    expect(css).toContain(`.${density}`);
  }
  // Unknown stored values must fall back rather than render a bare toast.
  expect(componentSource).toContain("|| TOAST_STYLE_CLASS.nexus");
  expect(componentSource).toContain("|| TOAST_DENSITY_CLASS.comfortable");
});

test("reduced motion and the minimal-motion setting both switch the toast off", () => {
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).toContain('html[data-motion="minimal"] [data-sonner-toaster] .nx-toast__spinner');
  const spinnerRules = css
    .split("\n")
    .filter((line) => line.includes(".nx-toast__spinner") && line.includes("animation: none"));
  expect(spinnerRules.length).toBeGreaterThanOrEqual(2);
});

test("the tone list stays in step with the tones the app actually raises", () => {
  const appSources = [
    path.join(__dirname, "../clientHealthBands.js"),
    path.join(__dirname, "../../pages/ClientsPage.jsx"),
  ];
  const calls = appSources
    .filter((file) => fs.existsSync(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  const raised = new Set([...calls.matchAll(/toast\.(success|warning|error|info)\b/g)].map((m) => m[1]));
  for (const tone of raised) {
    expect(TOAST_TONES).toContain(tone);
  }
});
