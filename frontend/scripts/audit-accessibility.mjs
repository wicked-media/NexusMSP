/**
 * Accessibility audit for the shared Nexus design system.
 *
 * Sibling of `audit-workspace-consistency.mjs`, `audit-controls.mjs` and
 * `audit-experience-readiness.mjs`. Those prove a workspace renders through the canonical
 * header, that controls come from the shared kit, and that a workspace can tell the
 * technician the difference between "no records", "still loading" and "it broke". This one
 * covers the three properties of the shared kit that a technician with an accessibility
 * need depends on and that nothing measured:
 *
 *   * **contrast** — every token pair the design system promises to keep legible, in both
 *     themes, plus the chip hues the chips render their labels in, measured against the
 *     surfaces and tints they actually sit on.
 *   * **focus visibility** — every focus indicator the shared kit declares, measured at
 *     the alpha it declares, against the surfaces it is drawn over, for all eight accent
 *     presets an operator can choose.
 *   * **reduced motion** — that the sheet still carries its reduced-motion reset and
 *     `data-motion` guards, and that a shared primitive which animates in JavaScript
 *     consults the motion preference instead of assuming it may move.
 *
 * The motion scope is self-maintaining: it walks the design system's own modules and
 * follows its local imports one level, so a primitive the design system newly delegates to
 * is audited the moment it is imported.
 *
 * Contrast pairs whose repair is a visual-identity decision (card boundaries, shadcn's
 * default destructive fill) and focus indicators that are a background fill rather than a
 * ring are reported with their measured ratios instead of failing the build, so the gap is
 * documented rather than hidden.
 *
 * Run: `pnpm audit:accessibility` (or `npm run audit:accessibility`).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAccessibilityReport,
  isSharedKitSource,
  parseAccentPresets,
  parseThemeTokens,
  resolveLocalImports,
  SHARED_KIT_ROOTS,
  withSourceExtension,
} from "../src/lib/accessibilityCoverage.js";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));

const read = (sourcePath) => readFile(join(frontendRoot, sourcePath), "utf8");

const exists = async (sourcePath) => {
  try {
    await stat(join(frontendRoot, sourcePath));
    return true;
  } catch {
    return false;
  }
};

async function walk(relative_dir) {
  const entries = await readdir(join(frontendRoot, relative_dir), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = `${relative_dir}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

/** The modules in the audit's scope: the shared kit roots, flattened to source files. */
const sharedKitFiles = (await Promise.all(SHARED_KIT_ROOTS.map(async (root) => {
  const path = join(frontendRoot, root);
  const info = await stat(path);
  if (!info.isDirectory()) return [root];
  const files = await walk(root);
  return files.filter((file) => isSharedKitSource(file));
}))).flat();

const kit = await Promise.all(sharedKitFiles.map(async (path) => ({ path, source: await read(path) })));

// Depth one from the design system module: what it composes or delegates to is the design
// system's motion surface too, whether or not anyone remembered to list it above.
const designSystemModule = "src/components/design-system/index.jsx";
const designSystemSource = kit.find((entry) => entry.path === designSystemModule)?.source || "";
const declared = new Set(sharedKitFiles);
const delegated = [];
for (const candidate of resolveLocalImports(designSystemSource, designSystemModule)) {
  if (!/\.(js|jsx)$/.test(candidate)) continue;
  const path = withSourceExtension(candidate);
  if (declared.has(path) || delegated.some((entry) => entry.path === path)) continue;
  if (!(await exists(path))) continue;
  delegated.push({ path, source: await read(path) });
}

const css = await read("src/index.css");
const app = await read("src/App.js");

const tokens = parseThemeTokens(css);
const accents = parseAccentPresets(app);

const report = buildAccessibilityReport({
  tokens,
  accents,
  sources: kit,
  motionScope: [...kit, ...delegated],
  css,
});

console.log(JSON.stringify({
  accentPresets: accents.map((preset) => preset.name),
  sharedKitSources: kit.map((entry) => entry.path),
  delegatedMotionSources: delegated.map((entry) => entry.path),
  ...report,
}, null, 2));

if (report.failed) process.exitCode = 1;
