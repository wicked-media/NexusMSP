// Pure presentation helpers for the Nexus Customer Environment Studio.
//
// The whole point of this studio is that it never fabricates. Two rules live
// here, and the unit tests pin both:
//
// 1. A dimension the backend did not measure (`assessed: false`, `value: null`)
//    must never be rendered as `0` and must never look healthy. "0 devices" and
//    "we have not assessed devices" are different statements to a technician.
// 2. Overall health is only ever derived from measured signals, so `unknown` is
//    a first-class state with its own neutral treatment — never a success tone.

export const DIMENSION_ORDER = [
  "devices",
  "websites",
  "services",
  "open_tickets",
  "changes",
  "alerts",
];

export const GROUP_ORDER = ["health", "technology", "commercial"];

export const GROUP_LABELS = {
  health: "Health",
  technology: "Technology",
  commercial: "Commercial",
};

export const UNMEASURED_LABEL = "Not measured";

// Health is derived from measured signals only.
const HEALTH_PRESENTATION = {
  healthy: { tone: "emerald", label: "Healthy", description: "Every measured signal is verified or connected." },
  attention: { tone: "amber", label: "Attention", description: "A measured signal is due or needs attention." },
  unknown: { tone: "zinc", label: "Not yet measured", description: "No operational signal has been measured for this customer." },
};

const SIGNAL_PRESENTATION = {
  verified: { tone: "emerald", label: "Verified" },
  connected: { tone: "emerald", label: "Connected" },
  due: { tone: "amber", label: "Due" },
  attention: { tone: "rose", label: "Attention" },
  not_measured: { tone: "zinc", label: UNMEASURED_LABEL },
};

const STRENGTH_PRESENTATION = {
  strong: { tone: "amber", label: "Shares an identified target" },
  weak: { tone: "zinc", label: "Same customer only" },
};

/** A count, or `null` when there is no measured number to show. */
export function formatCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toLocaleString();
}

/**
 * How a single dimension should be rendered.
 *
 * An unmeasured dimension returns `text: "Not measured"` with its disclosed
 * reason and a neutral tone. It never returns a number.
 */
export function dimensionDisplay(dimension) {
  const spec = dimension || {};
  const assessed = spec.assessed === true && spec.value !== null && spec.value !== undefined;
  if (!assessed) {
    return {
      assessed: false,
      text: UNMEASURED_LABEL,
      tone: "zinc",
      reason: spec.reason || "This dimension was not measured, and no reason was disclosed.",
      source: spec.source || null,
    };
  }
  return {
    assessed: true,
    text: formatCount(spec.value),
    tone: "slate",
    reason: "",
    source: spec.source || null,
  };
}

/** Tone, label and explanation for the overall environment health. */
export function healthTone(state) {
  const key = String(state || "").trim().toLowerCase();
  const found = HEALTH_PRESENTATION[key];
  if (found) return { key, ...found };
  return {
    key: key || "unknown",
    tone: "zinc",
    label: UNMEASURED_LABEL,
    description: "Health was not stated, so nothing is claimed.",
  };
}

/** Tone and label for one evidence chip. An unknown state claims nothing. */
export function signalTone(state) {
  const key = String(state || "").trim().toLowerCase();
  const found = SIGNAL_PRESENTATION[key];
  if (found) return { key, ...found };
  return { key: key || "unknown", tone: "zinc", label: UNMEASURED_LABEL };
}

/** The customer's dimensions bucketed into the brief's three tabs, in a stable order. */
export function groupDimensions(customer) {
  const groups = customer?.groups || {};
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABELS[key] || key,
    items: (groups[key] || [])
      .map((dimension) => ({ ...dimension, display: dimensionDisplay(dimension) }))
      .sort((a, b) => DIMENSION_ORDER.indexOf(a.id) - DIMENSION_ORDER.indexOf(b.id)),
  }));
}

/** Signals as rendered chips, with their disclosure attached. */
export function signalChips(customer) {
  return (customer?.signals || []).map((signal) => ({
    ...signal,
    presentation: signalTone(signal.state),
  }));
}

/** Correlation strength. Both are candidates; neither is ever a cause. */
export function candidateStrength(strength) {
  const key = String(strength || "").trim().toLowerCase();
  const found = STRENGTH_PRESENTATION[key];
  if (found) return { key, ...found };
  return { key: key || "unknown", tone: "zinc", label: "Evidence strength not stated" };
}

/** How long before the ticket the change happened, from the recorded minutes. */
export function minutesBeforeLabel(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return "Timing not recorded";
  if (value < 60) return `${value} minute${value === 1 ? "" : "s"} before`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (remainder === 0) return `${hours} hour${hours === 1 ? "" : "s"} before`;
  return `${hours}h ${remainder}m before`;
}

/**
 * The one-line statement above the candidate list.
 *
 * An empty result is reported as "nothing was correlated in this window" — which
 * is an observation about the evidence, not reassurance that nothing happened.
 */
export function correlationHeadline(investigation) {
  const candidates = investigation?.candidates || [];
  const window = investigation?.window_hours;
  const windowText = Number.isFinite(Number(window)) ? `in the last ${window} hours` : "in this window";
  if (candidates.length === 0) {
    return `No change in the requested window was correlated with an open ticket. That is an absence of a match, not evidence that nothing changed.`;
  }
  const strong = candidates.filter((candidate) => candidate.strength === "strong").length;
  return `${candidates.length} possible contributor${candidates.length === 1 ? "" : "s"} ${windowText}, ${strong} of which share an identified target with an open ticket. These are candidates for investigation, not conclusions.`;
}

/** The identifiers Nexus used to link a change to a ticket. */
export function sharedTargetLabel(targets) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (list.length === 0) return "No shared identifier — same customer only";
  return `Shared: ${list.join(", ")}`;
}
