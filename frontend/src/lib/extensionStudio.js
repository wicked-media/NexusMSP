// Pure presentation helpers for Nexus Extension Studio.
//
// The backend runs the disclosed checks and returns the verdict; these helpers
// only decide how to label it. Two rules they exist to enforce:
//
//   1. An approval is a *review outcome*, never a deployment and never a grant
//      of privilege — no label may imply either.
//   2. An unrecognised check state or verdict is shown as unrecognised. It is
//      never quietly rendered as a pass, and state is never conveyed by colour
//      alone (every tone is paired with words).

export const CHECK_STATES = ["pass", "needs_review", "fail"];
export const VERDICTS = ["approved", "needs_review", "rejected"];

export const MARKETPLACE_FALLBACK_GATE =
  "Marketplace distribution is deferred until signing infrastructure, a review authority and isolated execution exist.";

const CHECK_PRESENTATION = {
  pass: { tone: "emerald", label: "Pass" },
  needs_review: { tone: "amber", label: "Needs review" },
  fail: { tone: "rose", label: "Fail" },
};

const VERDICT_PRESENTATION = {
  approved: { tone: "emerald", label: "Approved — review outcome only" },
  needs_review: { tone: "amber", label: "Needs human review" },
  rejected: { tone: "rose", label: "Rejected" },
};

/** The tone for one check state. Unknown states get a neutral tone, never a pass. */
export function checkTone(state) {
  const key = String(state || "").trim().toLowerCase();
  return (CHECK_PRESENTATION[key] || { tone: "zinc" }).tone;
}

/** The words for one check state. Unknown states say so explicitly. */
export function checkStateLabel(state) {
  const key = String(state || "").trim().toLowerCase();
  return (CHECK_PRESENTATION[key] || { label: "Unrecognised check state" }).label;
}

/** The tone for a verdict. An unknown verdict is never rendered as positive. */
export function verdictTone(verdict) {
  const key = String(verdict || "").trim().toLowerCase();
  return (VERDICT_PRESENTATION[key] || { tone: "zinc" }).tone;
}

/**
 * The words for a verdict. "Approved" always carries the qualifier, because a
 * verdict is a review outcome and not permission to do anything.
 */
export function verdictLabel(verdict) {
  const key = String(verdict || "").trim().toLowerCase();
  return (VERDICT_PRESENTATION[key] || { label: "Unrecognised verdict" }).label;
}

/** Failures first, so the reason a manifest was refused is at the top. */
export function checkSeverity(state) {
  const key = String(state || "").trim().toLowerCase();
  if (key === "fail") return 0;
  if (key === "needs_review") return 1;
  if (key === "pass") return 2;
  return 3;
}

export function sortChecks(checks) {
  return [...(checks || [])].sort((a, b) => {
    const rank = checkSeverity(a?.state) - checkSeverity(b?.state);
    if (rank !== 0) return rank;
    return String(a?.label || a?.id || "").localeCompare(String(b?.label || b?.id || ""));
  });
}

/**
 * Parse the manifest textarea **before** it is ever sent.
 *
 * A malformed manifest is refused in the browser with the reason: the server's
 * refusal is authoritative, but sending broken JSON would waste a permissioned
 * round trip and show the operator a worse message.
 */
export function parseManifest(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) {
    return { ok: false, error: "The manifest is empty. Nothing was sent.", manifest: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `The manifest is not valid JSON: ${error.message}`, manifest: null };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "The manifest must be a JSON object — an array, string or number is not a manifest.",
      manifest: null,
    };
  }
  return { ok: true, error: "", manifest: parsed };
}

/** Which required fields the manifest does not yet populate. */
export function missingContractFields(manifest, requiredFields) {
  const document = manifest && typeof manifest === "object" ? manifest : {};
  return (requiredFields || []).filter((field) => {
    const value = document[field];
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
  });
}

/** One line of check arithmetic, never hidden behind a colour. */
export function formatCheckSummary(summary) {
  if (!summary || !Number.isFinite(Number(summary.total)) || Number(summary.total) <= 0) {
    return "No checks have been run yet.";
  }
  const parts = [];
  if (Number(summary.fail)) parts.push(`${Number(summary.fail)} fail`);
  if (Number(summary.needs_review)) parts.push(`${Number(summary.needs_review)} need review`);
  if (Number(summary.pass)) parts.push(`${Number(summary.pass)} pass`);
  return `${Number(summary.total)} checks — ${parts.length ? parts.join(", ") : "no results recorded"}`;
}

/**
 * The marketplace is deferred, and it is rendered as deferred *with its gate*.
 * It is never shown as "coming soon" or as a disabled feature waiting to be
 * switched on, because neither is true.
 */
export function marketplaceState(contract) {
  const marketplace = contract?.marketplace || {};
  const deferred = String(marketplace.state || "").trim().toLowerCase() === "deferred";
  if (!deferred) {
    return {
      state: String(marketplace.state || "unknown"),
      deferred: false,
      label: "Marketplace state not stated",
      detail: MARKETPLACE_FALLBACK_GATE,
    };
  }
  return {
    state: "deferred",
    deferred: true,
    label: "Marketplace distribution: deferred",
    detail: String(marketplace.gate || "").trim() || MARKETPLACE_FALLBACK_GATE,
  };
}

/** Cap a long capability list rather than rendering every row unbounded. */
export function capabilityRows(capabilities, limit = 60) {
  const all = Array.isArray(capabilities) ? capabilities : [];
  const cap = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 60;
  return { rows: all.slice(0, cap), hidden: Math.max(all.length - cap, 0), total: all.length };
}

/** A deliberately valid example manifest, drawn from the contract's own rules. */
export const EXAMPLE_MANIFEST = {
  id: "acme.backup-summary",
  name: "Backup Summary Dashboard",
  version: "1.0.0",
  kind: "dashboard",
  distribution: "private",
  requires_api: "1.0",
  capabilities: ["/api/extensions/capabilities"],
  permissions: ["platform.readiness.view"],
  data_classes: ["aggregate"],
  isolation: "Read-only projection confined to the caller's client scope.",
  verification: "Renders only observed rows and discloses an unmeasured state.",
  rollback: "Remove the dashboard registration; nothing is written so nothing is restored.",
};

export function exampleManifestText() {
  return JSON.stringify(EXAMPLE_MANIFEST, null, 2);
}
