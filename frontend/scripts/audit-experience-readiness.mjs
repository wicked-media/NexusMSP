/**
 * Experience-readiness audit for every routed Nexus workspace.
 *
 * Sibling of `audit-workspace-consistency.mjs` (which proves each routed
 * workspace renders through the canonical header) and `audit-controls.mjs`
 * (which proves controls come from the shared kit). This one covers the states a
 * workspace shows when there is nothing to show: loading, empty and error.
 *
 * It answers one question — *can this workspace tell the technician the
 * difference between "no records", "still loading" and "it broke"?* — and it
 * fails the build for the two classes where the source can prove the answer is
 * no:
 *
 *   * a state panel implemented outside `src/components/design-system/index.jsx`
 *     (the reason six prop contracts grew last time), and
 *   * a routed workspace that fetches data with no failure path anywhere in the
 *     file, so an API error can only ever render as a wrong answer.
 *
 * Missing loading/empty *presentation* is reported as a ranked backlog rather
 * than a failure, because a workspace may legitimately delegate it to a shared
 * component this scan cannot follow. The contract, the classifiers and the gate
 * definitions live in `src/lib/experienceReadiness.js` so they are unit-tested
 * rather than re-implemented here.
 *
 * Run: `pnpm audit:experience` (or `npm run audit:experience`).
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildExperienceReport,
  classifyWorkspace,
  findStatePrimitiveDuplicates,
  isScannableSource,
} from "../src/lib/experienceReadiness.js";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const routesPath = fileURLToPath(new URL("../src/config/routes.js", import.meta.url));

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
};

const toSourcePath = (path) => `src/${relative(root, path).replaceAll("\\", "/")}`;

const files = (await walk(root)).filter((path) => isScannableSource(toSourcePath(path)));
const source = await Promise.all(files.map(async (path) => ({
  path: toSourcePath(path),
  source: await readFile(path, "utf8"),
})));
const byPath = new Map(source.map((entry) => [entry.path.toLowerCase(), entry.source]));

// Routed workspaces are resolved from the router, exactly as the sibling audit
// does, so a new route is audited the moment it is declared.
const routes = await readFile(routesPath, "utf8");
const routedPageNames = [
  ...new Set([...routes.matchAll(/component:\s*page\("([A-Za-z0-9_-]+)"\)/g)].map((match) => match[1])),
];

let routedPagesWithoutSource = 0;
const workspaces = routedPageNames.map((name) => {
  const path = `src/pages/${name}.jsx`;
  const text = byPath.get(path.toLowerCase());
  if (text === undefined) routedPagesWithoutSource += 1;
  return { path, ...classifyWorkspace(text ?? "") };
});

const report = buildExperienceReport({
  workspaces,
  duplicates: findStatePrimitiveDuplicates(source),
});

console.log(JSON.stringify({
  routedPageNames: routedPageNames.length,
  routedPagesWithoutSource,
  ...report,
}, null, 2));

if (report.failed) process.exitCode = 1;
