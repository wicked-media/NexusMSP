/**
 * Experience-readiness contract for every routed Nexus workspace.
 *
 * Nexus ships one shared design system and hundreds of routed workspaces. What
 * makes a suite that large feel unfinished is never a missing screen — it is a
 * workspace that does not tell the truth about *state*. A table that fetches
 * data and then renders nothing looks identical whether the API returned no
 * records, is still loading, or just failed. A silent failure is the worst of
 * the three, because the technician reads an empty panel as "you have no
 * tickets" and moves on.
 *
 * So the rule is: a workspace that fetches data must be able to render four
 * distinct outcomes — loading, empty (no records, as a *successful* answer),
 * error (with a retry path), and data.
 *
 * This module is the single definition of that rule, and it is deliberately
 * pure and dependency-free: `scripts/audit-experience-readiness.mjs` walks the
 * real source tree with these classifiers, and the unit tests pin their
 * behaviour, so the policy cannot drift away from the gate enforcing it.
 *
 * One caveat is stated rather than hidden: these are source-shape heuristics,
 * not a render. They can prove a workspace *has no* state handling; they cannot
 * prove what it looks like on screen. The browser matrix remains the evidence
 * for appearance (see docs/NEXUS_EXPERIENCE_STANDARD.md).
 */

export const REQUIRED_STATES = ["loading", "empty", "error"];

/** The canonical home of the shared state primitives. Anything else is a copy. */
export const CANONICAL_STATE_MODULE = "src/components/design-system/index.jsx";

/** Component names that mean "this file implements its own state panel". */
export const STATE_PRIMITIVE_NAMES = [
  "EmptyState",
  "NoResults",
  "EmptyPanel",
  "EmptyNotice",
  "StateMessage",
  "LoadingState",
  "ErrorState",
];

/**
 * Source markers per state. A marker is evidence a workspace can render that
 * state; the absence of every marker is evidence it cannot. Both readings are
 * heuristic by design, which is why the gate below only fails on the classes
 * where absence is unambiguous.
 */
export const STATE_MARKERS = {
  loading: [
    /\bSkeleton\b/,
    /\bLoadingState\b/,
    /\bisLoading\b/,
    /<Loader/,
    /\bloading\b/i,
    /\banimate-pulse\b/,
  ],
  empty: [
    /\bEmptyState\b/,
    /\bNoResults\b/,
    /\bNo records\b/i,
    /\bNothing (here|yet)\b/i,
    /\bNo [A-Za-z]+ (found|yet)\b/,
    /\bnothing to show\b/i,
  ],
  error: [
    /\bErrorState\b/,
    /\bcatch\s*\(/,
    /\.catch\(/,
    /\bcatch\s*\{/,
    /\bonError\b/,
  ],
};

/**
 * Classes the audit fails on, at zero.
 *
 * Both are mechanical facts about the source rather than judgements:
 * - `duplicateStatePrimitives` — a file outside the canonical module defines its
 *   own state panel, which is exactly how six prop contracts grew last time.
 * - `workspacesWithoutErrorPath` — a workspace fetches data with no failure path
 *   anywhere in the file, so an API error can only render as a wrong answer.
 *
 * Missing loading/empty *presentation* is deliberately not gated: a workspace
 * may legitimately delegate it to a shared component this scan cannot follow, so
 * it is reported as a ranked backlog instead of a build failure.
 */
export const GATED_CLASSES = ["duplicateStatePrimitives", "workspacesWithoutErrorPath"];

/**
 * Whether a source path belongs in the scan at all.
 *
 * Tests are excluded: a state panel named inside a test is a fixture asserting what
 * the gate does, not an implementation shipped to a technician. Counting it would make
 * the gate fail on the tests that prove the gate works.
 */
export function isScannableSource(path) {
  return /\.(js|jsx)$/.test(String(path || "")) && !/\.test\.(js|jsx)$/.test(String(path || ""));
}

const FETCH_PATTERN = /\bAPI\.(?:get|post|put|patch|delete)\(|axios\.(?:get|post|put|patch|delete)\(/;

/** Classify one workspace source file against the state contract. */
export function classifyWorkspace(source) {
  const text = String(source || "");
  const fetchesData = FETCH_PATTERN.test(text);
  const presents = Object.fromEntries(
    Object.entries(STATE_MARKERS).map(([state, markers]) => [state, markers.some((marker) => marker.test(text))]),
  );
  return {
    fetchesData,
    presents,
    missingStates: fetchesData ? REQUIRED_STATES.filter((state) => !presents[state]) : [],
  };
}

/** Find state panels implemented outside the canonical module. */
export function findStatePrimitiveDuplicates(entries) {
  const pattern = new RegExp(`(?:function|const)\\s+(${STATE_PRIMITIVE_NAMES.join("|")})\\b`, "g");
  const findings = [];
  for (const entry of entries || []) {
    const path = String(entry?.path || "");
    if (!path || path === CANONICAL_STATE_MODULE) continue;
    const names = [...new Set([...String(entry?.source || "").matchAll(pattern)].map((match) => match[1]))];
    if (names.length) findings.push({ path, names: names.sort() });
  }
  return findings.sort((left, right) => left.path.localeCompare(right.path));
}

/** Rank workspaces by how many states they cannot render. */
export function buildStateBacklog(workspaces) {
  return workspaces
    .filter((workspace) => (workspace?.missingStates || []).length > 0)
    .sort(
      (left, right) =>
        right.missingStates.length - left.missingStates.length || left.path.localeCompare(right.path),
    );
}

/**
 * Build the audit report.
 *
 * Pure, so the gate's own behaviour is unit-tested with synthetic inputs rather
 * than inferred from whatever the tree happens to look like today.
 */
export function buildExperienceReport({ workspaces = [], duplicates = [] } = {}) {
  const fetching = workspaces.filter((workspace) => workspace.fetchesData);
  const withoutErrorPath = fetching.filter((workspace) => !workspace.presents.error).map((w) => w.path);
  const withoutLoading = fetching.filter((workspace) => !workspace.presents.loading).map((w) => w.path);
  const withoutEmpty = fetching.filter((workspace) => !workspace.presents.empty).map((w) => w.path);
  const backlog = buildStateBacklog(fetching).map((workspace) => ({
    path: workspace.path,
    missingStates: workspace.missingStates,
  }));

  return {
    workspacesChecked: workspaces.length,
    workspacesFetchingData: fetching.length,
    duplicateStatePrimitives: duplicates,
    duplicateStatePrimitiveCount: duplicates.length,
    workspacesWithoutErrorPath: withoutErrorPath,
    workspacesWithoutErrorPathCount: withoutErrorPath.length,
    workspacesWithoutLoadingState: withoutLoading,
    workspacesWithoutEmptyState: withoutEmpty,
    stateBacklog: backlog,
    gatedClasses: GATED_CLASSES,
    failed: duplicates.length > 0 || withoutErrorPath.length > 0,
    expectation:
      "A workspace that fetches data renders loading, empty, error (with a retry path) and data as four distinct outcomes, using the shared primitives in "
      + `${CANONICAL_STATE_MODULE}. Local state panels are duplicates and fail this audit.`,
  };
}
