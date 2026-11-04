// Pure presentation helpers for Nexus Operations Assurance.
//
// The backend decides whether a promised operational outcome was achieved; these
// helpers only decide how to say it. Two rules are enforced here rather than in
// JSX, because they are the whole point of the studio:
//
//   * `not_measured` is its own prominent state. It is never rendered in the
//     positive "met" treatment, and it never becomes a reassuring zero.
//   * A state string Nexus does not recognise is rendered as unrecognised. It is
//     never silently treated as healthy.

export const COMMITMENT_STATES = ["met", "at_risk", "breached", "not_measured"];

// Tone keys map to Tailwind utility classes in the page. `not_measured` gets a
// deliberately distinct tone so it can never be mistaken for "nothing to see".
const STATE_PRESENTATION = {
  met: { tone: "emerald", label: "Met", positive: true },
  at_risk: { tone: "amber", label: "At risk", positive: false },
  breached: { tone: "rose", label: "Breached", positive: false },
  not_measured: { tone: "violet", label: "Not measured", positive: false },
};

const UNRECOGNISED = { tone: "slate", label: "Unrecognised state", positive: false };

function normaliseState(state) {
  return String(state || "").trim().toLowerCase();
}

/** The visual tone for a commitment state. Only `met` is a positive tone. */
export function commitmentStateTone(state) {
  return (STATE_PRESENTATION[normaliseState(state)] || UNRECOGNISED).tone;
}

/** The human label for a commitment state, or "Unrecognised state". */
export function commitmentStateLabel(state) {
  return (STATE_PRESENTATION[normaliseState(state)] || UNRECOGNISED).label;
}

/** Whether a state may be presented as a positive outcome. */
export function commitmentStateIsPositive(state) {
  return (STATE_PRESENTATION[normaliseState(state)] || UNRECOGNISED).positive === true;
}

/**
 * The four governed states in reporting order, with the count the server sent.
 *
 * A count the server did not send is `null`, not `0`: "Nexus did not count this"
 * and "Nexus counted zero" are different statements.
 */
export function stateCounts(summary) {
  const source = summary && typeof summary === "object" ? summary : {};
  return COMMITMENT_STATES.map((state) => {
    const raw = source[state];
    const count = raw === null || raw === undefined || raw === "" || Number.isNaN(Number(raw))
      ? null
      : Number(raw);
    return { state, label: commitmentStateLabel(state), tone: commitmentStateTone(state), count };
  });
}

/** The reported total, or `null` when the server did not state one. */
export function reportedTotal(summary) {
  const raw = summary && typeof summary === "object" ? summary.total : undefined;
  if (raw === null || raw === undefined || raw === "" || Number.isNaN(Number(raw))) return null;
  return Number(raw);
}

/** Rows the summary should render, with a `"Not recorded"` value for a null count. */
export function formatCount(count) {
  return count === null || count === undefined ? "Not recorded" : String(count);
}

// Fields a gap may carry, and how to name them. A gap schema is per-commitment,
// so anything absent is skipped rather than rendered as an empty cell.
const GAP_FIELD_LABELS = [
  ["name", "Name"],
  ["workload_id", "Workload"],
  ["device_id", "Device"],
  ["website_id", "Website"],
  ["user_id", "User"],
  ["url", "URL"],
  ["age_hours", "Age (h)"],
  ["elapsed_hours", "Elapsed (h)"],
  ["silent_hours", "Silent (h)"],
  ["timeframe_hours", "Agreed (h)"],
  ["rpo_hours", "RPO (h)"],
  ["window_hours", "Window (h)"],
];

/**
 * The present, renderable fields of one gap. Only keys that actually carry a
 * value are returned, so a commitment with a different gap schema still renders.
 */
export function gapFields(gap) {
  if (!gap || typeof gap !== "object") return [];
  return GAP_FIELD_LABELS
    .filter(([key]) => gap[key] !== null && gap[key] !== undefined && String(gap[key]).trim() !== "")
    .map(([key, label]) => ({ key, label, value: String(gap[key]) }));
}

/** The most useful single identifier for a gap row, however the gap is shaped. */
export function gapIdentifier(gap) {
  const fields = gapFields(gap);
  const preferred = fields.find((field) => ["name", "workload_id", "website_id", "device_id", "user_id"].includes(field.key));
  return (preferred || fields[0])?.value || "Unnamed item";
}

/** The gap's own explanation, or an honest statement that it did not give one. */
export function gapReason(gap) {
  const reason = gap && typeof gap === "object" ? gap.reason : undefined;
  return reason === null || reason === undefined || String(reason).trim() === ""
    ? "No reason was recorded for this gap."
    : String(reason);
}

/** Every gap across the report, flattened for the actionable list. */
export function allGaps(commitment) {
  const gaps = commitment && Array.isArray(commitment.gaps) ? commitment.gaps : [];
  return gaps.map((gap, index) => ({
    key: `${commitment?.id || "commitment"}-${index}`,
    commitmentId: commitment?.id || "",
    commitmentTitle: commitment?.title || "",
    identifier: gapIdentifier(gap),
    reason: gapReason(gap),
    fields: gapFields(gap),
  }));
}

/** The headline for one commitment: the promise, not a job status. */
export function commitmentHeadline(commitment) {
  return commitment?.promise || "This promise was not recorded.";
}

/** The obligations Nexus could not measure — the most important part of the report. */
export function unmeasuredCommitments(commitments) {
  if (!Array.isArray(commitments)) return [];
  return commitments.filter((commitment) => normaliseState(commitment?.state) === "not_measured");
}
