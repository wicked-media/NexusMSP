// Pure presentation and validation helpers for the Nexus Wish Engine.
//
// The server owns the policy in `backend/app/services/wish_engine.py`: the
// signature, the similarity rule, the routing suggestion and the promotion gate.
// This file only decides how to label what the server returned, and it refuses a
// request the server would refuse (wrong length, credential material) before a
// technician wastes a round trip.
//
// Two rules matter more than the labels:
//   * Nexus never renders a request shape as "valued" from its counts alone.
//   * A lone request is the author's own; the reviewer view is counts only.

/** What an unmet need can become, with what each option commits to. */
export const WISH_DISPOSITIONS = [
  { value: "shortcut", label: "Shortcut", meaning: "The capability exists but takes too many steps or lives in the wrong place." },
  { value: "product_change", label: "Product change", meaning: "The capability does not exist, or does not match how the work is actually done." },
  { value: "automation", label: "Automation", meaning: "The work should not need a person to repeat it at all." },
  { value: "forge_tool", label: "Forge tool", meaning: "No Nexus capability covers this yet; it needs a Forge design request." },
  { value: "documentation", label: "Documentation", meaning: "The answer exists but is not discoverable where the technician needs it." },
];

const DISPOSITION_TONES = {
  shortcut: "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-100",
  product_change: "border-violet-500/25 bg-violet-500/[0.07] text-violet-100",
  automation: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-100",
  forge_tool: "border-amber-500/25 bg-amber-500/[0.07] text-amber-100",
  documentation: "border-sky-500/25 bg-sky-500/[0.07] text-sky-100",
};

export const WISH_TEXT_MIN = 12;
export const WISH_TEXT_MAX = 400;

/** Presentation for one disposition. An unknown value is never shown as decided. */
export function dispositionPresentation(value) {
  const key = String(value || "").trim().toLowerCase();
  const found = WISH_DISPOSITIONS.find((item) => item.value === key);
  if (!found) return { key: key || "undecided", label: "Not dispositioned yet", tone: "border-white/10 bg-white/[0.03] text-zinc-300", meaning: "" };
  return { key, label: found.label, meaning: found.meaning, tone: DISPOSITION_TONES[key] || "border-white/10 bg-white/[0.03] text-zinc-300" };
}

/** The disposition vocabulary the server serves, with a local fallback. */
export function dispositionOptions(dispositions) {
  if (Array.isArray(dispositions) && dispositions.length) {
    return dispositions
      .map((item) => {
        const value = String(item?.id || item?.value || "").trim();
        const known = WISH_DISPOSITIONS.find((entry) => entry.value === value);
        return { value, label: known?.label || value.replaceAll("_", " "), meaning: item?.meaning || known?.meaning || "" };
      })
      .filter((item) => item.value);
  }
  return WISH_DISPOSITIONS;
}

/**
 * What Nexus suggests, stated as a suggestion. The matched words are always
 * disclosed so a reviewer can disagree with the reasoning instead of the answer.
 */
export function suggestionText(suggestion) {
  if (!suggestion) return "No routing suggestion yet.";
  const disposition = String(suggestion.disposition || "").trim();
  if (!disposition) return suggestion.reason || "No routing signal matched; a person has to choose.";
  const signals = (suggestion.signals || []).slice(0, 4);
  const label = dispositionPresentation(disposition).label;
  return signals.length ? `Suggested: ${label} · matched “${signals.join("”, “")}”` : `Suggested: ${label}`;
}

/** How often and by how many people a shape was reported — never by whom. */
export function clusterCounts(cluster) {
  const occurrences = Number(cluster?.occurrences || 0);
  const reporters = Number(cluster?.reporter_count || occurrences);
  const surfaces = Array.isArray(cluster?.surfaces) ? cluster.surfaces : [];
  const spanDays = Number(cluster?.span_days || 0);
  return {
    occurrences,
    reporters,
    surfaces,
    spanDays,
    reportsText: `${occurrences} report${occurrences === 1 ? "" : "s"}`,
    reportersText: `${reporters} technician${reporters === 1 ? "" : "s"}`,
    surfacesText: surfaces.length ? surfaces.join(", ") : "no workspace recorded",
    spanText: spanDays > 0 ? `${spanDays} day${spanDays === 1 ? "" : "s"} apart` : "reported the same day",
  };
}

/** The evidence behind a cluster, as labelled lines rather than a score. */
export function clusterEvidenceLines(cluster) {
  if (!cluster) return [];
  const counts = clusterCounts(cluster);
  const lines = [
    { label: "Reported", text: counts.reportsText },
    { label: "By technicians", text: counts.reportersText },
    { label: "Workspaces", text: counts.surfacesText },
    { label: "Span", text: counts.spanText },
  ];
  const phrasings = cluster.member_signatures || [];
  if (phrasings.length > 1) lines.push({ label: "Phrasings", text: `${phrasings.length} different wordings` });
  if (cluster.first_seen_at) lines.push({ label: "First reported", text: String(cluster.first_seen_at).slice(0, 10) });
  return lines;
}

/** Why a shape cannot be promoted yet, verbatim from the server gate. */
export function promotionReason(cluster) {
  return cluster?.promotion?.reason || "";
}

export function promotionAllowed(cluster) {
  return Boolean(cluster?.promotion?.allowed);
}

/** The stored human decision, if there is one. */
export function recordedDisposition(cluster) {
  const decision = cluster?.disposition;
  if (!decision || !decision.disposition) return null;
  return {
    ...dispositionPresentation(decision.disposition),
    evidenceNote: decision.evidence_note || "",
    decidedBy: decision.decided_by || "",
    decidedAt: decision.decided_at || "",
    occurrencesAtDecision: decision.occurrences_at_decision ?? null,
    reporterCountAtDecision: decision.reporter_count_at_decision ?? null,
    ideaId: decision.idea_id || null,
    ideaTitle: decision.idea_title || null,
    promotedAt: decision.promoted_at || null,
  };
}

/**
 * The same credential-material guard the server enforces, so a technician is told
 * before a request is sent rather than after it is refused.
 */
const CREDENTIAL_PATTERNS = [
  "password=", "password:", "passwd=", "api_key=", "apikey=", "secret=",
  "token=", "client_secret", "private_key", "-----begin", "sk_live_",
  "sk_test_", "xoxb-", "bearer ", "authorization:",
];

export function containsCredentialMaterial(text) {
  const haystack = String(text || "").trim().toLowerCase();
  return CREDENTIAL_PATTERNS.some((pattern) => haystack.includes(pattern));
}

/** Validate a request before sending it. The server remains the authority. */
export function wishFormErrors(form = {}) {
  const errors = [];
  const text = String(form.text || "").trim();
  if (text.length < WISH_TEXT_MIN) errors.push("Describe the frustration in a sentence of at least 12 characters.");
  if (text.length > WISH_TEXT_MAX) errors.push(`Keep the request under ${WISH_TEXT_MAX} characters.`);
  if (containsCredentialMaterial(text)) errors.push("Credential material is never stored. Remove it before reporting.");
  if (!String(form.surface || "").trim()) errors.push("Nexus records which workspace the request was felt in.");
  if (containsCredentialMaterial(form.context_ref)) errors.push("Remove the credential material from the context reference.");
  return errors;
}

/** Build the request body, or null when the form is not yet valid. */
export function wishPayload(form = {}) {
  if (wishFormErrors(form).length) return null;
  const contextRef = String(form.context_ref || "").trim();
  return {
    text: String(form.text).trim(),
    surface: String(form.surface).trim().toLowerCase().slice(0, 48),
    context_ref: contextRef ? contextRef.slice(0, 120) : null,
  };
}

/** Validate a recorded disposition. A decision without its reasoning is refused. */
export function dispositionFormErrors(form = {}) {
  const errors = [];
  if (!WISH_DISPOSITIONS.some((item) => item.value === form.disposition)) errors.push("Choose what this request should become.");
  const note = String(form.evidence_note || "").trim();
  if (note.length < 5) errors.push("Record the evidence behind the decision — at least 5 characters.");
  if (containsCredentialMaterial(note)) errors.push("Credential material is never stored. Remove it from the note.");
  return errors;
}

export function dispositionPayload(form = {}) {
  if (dispositionFormErrors(form).length) return null;
  return { disposition: form.disposition, evidence_note: String(form.evidence_note).trim() };
}

/** Validate a promotion into the Nexus Ideas registry. */
export function promotionFormErrors(form = {}) {
  const errors = [];
  const title = String(form.title || "").trim();
  const summary = String(form.summary || "").trim();
  if (title.length < 3) errors.push("Give the promoted idea a title of at least 3 characters.");
  if (summary.length < 10) errors.push("Explain why the shared pattern matters, in at least 10 characters.");
  if ([title, summary].some((value) => containsCredentialMaterial(value))) {
    errors.push("Credential material is never stored. Remove it before promoting.");
  }
  return errors;
}

export function promotionPayload(form = {}) {
  if (promotionFormErrors(form).length) return null;
  return {
    title: String(form.title).trim().slice(0, 120),
    summary: String(form.summary).trim().slice(0, 600),
    horizon: String(form.horizon || "explore").trim().toLowerCase() || "explore",
  };
}

/** The cluster key used in the disposition and promotion routes. */
export function clusterPath(cluster) {
  const signature = String(cluster?.signature || "").trim();
  return signature ? encodeURIComponent(signature) : "";
}
