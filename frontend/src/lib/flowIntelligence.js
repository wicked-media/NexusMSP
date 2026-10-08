// Pure presentation helpers for Nexus Flow Intelligence.
//
// These mirror the server policy in `backend/app/services/nexus_flow.py` so the
// UI never has to guess a status tone or invent a saving figure: the backend
// derives the status and the estimate, and this file only decides how to label
// and group what it returned.

export const VERIFICATION_KINDS = [
  { value: "automated_test", label: "Automated test", hint: "A named check the technician can re-run passed." },
  { value: "technician_witnessed", label: "Technician witnessed", hint: "The technician saw the outcome happen." },
  { value: "customer_confirmed", label: "Customer confirmed", hint: "The person who needed the outcome confirmed it." },
  { value: "monitoring_evidence", label: "Monitoring evidence", hint: "Independent monitoring shows the outcome holds." },
];

export const BREADCRUMB_KINDS = [
  { value: "hypothesis", label: "Hypothesis" },
  { value: "tested", label: "Tested" },
  { value: "ruled_out", label: "Ruled out" },
  { value: "finding", label: "Finding" },
  { value: "next_step", label: "Next step" },
  { value: "change", label: "Change" },
];

const CONTRACT_STATUS_PRESENTATION = {
  verified: { tone: "emerald", label: "Outcome verified" },
  unverified: { tone: "amber", label: "Not yet verified" },
  insufficient: { tone: "rose", label: "Contract incomplete" },
  expired: { tone: "amber", label: "Evidence expired" },
};

/**
 * Presentation for a contract standing. An unknown status is never rendered as
 * healthy — an unrecognised value falls back to a neutral, unclaimed state.
 */
export function contractStatus(status) {
  const key = String(status || "").trim().toLowerCase();
  const found = CONTRACT_STATUS_PRESENTATION[key];
  if (found) return { key, ...found };
  return { key: key || "none", tone: "zinc", label: "No contract" };
}

/**
 * The close-out sentence. Nexus refuses to describe a ticket as resolved on a
 * command's exit code alone, so the blocked reason is always shown verbatim.
 */
export function closeoutCopy(gate) {
  if (!gate) return { tone: "zinc", label: "No outcome claim", detail: "" };
  if (gate.allowed) {
    return gate.status === "no_contract"
      ? { tone: "zinc", label: "No verified-outcome claim", detail: gate.reason || "" }
      : { tone: "emerald", label: "Verified outcome supports close-out", detail: gate.reason || "" };
  }
  return {
    tone: gate.status === "expired" ? "amber" : "rose",
    label: gate.status === "expired" ? "Re-verify before close-out" : "Close-out cannot claim this outcome",
    detail: gate.reason || "",
  };
}

/**
 * The restored reasoning state, as labelled lines. Empty evidence produces no
 * lines at all rather than a fabricated summary.
 */
export function resumeLines(resume) {
  if (!resume) return [];
  const lines = [];
  if (resume.testing) lines.push({ label: "You were testing", text: resume.testing });
  if (resume.ruled_out?.length) lines.push({ label: "Already ruled out", text: resume.ruled_out.join("; ") });
  if (resume.findings?.length) lines.push({ label: "Findings so far", text: resume.findings.join("; ") });
  if (resume.open_hypotheses?.length) lines.push({ label: "Still open", text: resume.open_hypotheses.join("; ") });
  if (resume.next_step) lines.push({ label: "Next step", text: resume.next_step });
  return lines;
}

/** How one stale conclusion should be described, and how urgently. */
export function stalenessLabel(item) {
  if (!item) return { tone: "zinc", label: "Unverified" };
  if (item.reason === "possibly_stale") {
    return { tone: "rose", label: "Possibly stale", detail: item.detail || "" };
  }
  if (item.reason === "age_stale") {
    return { tone: "amber", label: "Aged out", detail: item.detail || "" };
  }
  return { tone: "zinc", label: "Unverified", detail: item.detail || "" };
}

/** One opportunity's saving, stated as measured or explicitly not claimed. */
export function frictionEstimateText(opportunity) {
  if (!opportunity) return "No evidence";
  if (!opportunity.estimate_available) {
    return `Evidence only — ${opportunity.estimate_reason || "no rate is claimed."}`;
  }
  const hours = Number(opportunity.estimated_monthly_hours || 0);
  return `≈ ${hours}h/month · ${opportunity.estimated_monthly_repeats} repeats/month`;
}

/**
 * The same credential-material guard the server enforces, so a technician is
 * told before a request is sent rather than after it is refused.
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

const DEAD_END_PRESENTATION = {
  stalled: { tone: "rose", label: "Investigation appears stalled" },
  at_risk: { tone: "amber", label: "Progress has slowed" },
  progressing: { tone: "emerald", label: "Still producing new evidence" },
  insufficient_evidence: { tone: "zinc", label: "Not enough steps yet" },
};

/**
 * Presentation for the Dead End Detector verdict. An unrecognised verdict is
 * never shown as healthy, and Nexus never claims the work was wasted.
 */
export function deadEndStatus(verdict) {
  const key = String(verdict || "").trim().toLowerCase();
  const found = DEAD_END_PRESENTATION[key];
  if (found) return { key, ...found };
  return { key: key || "none", tone: "zinc", label: "No verdict yet" };
}

/** The evidence the detector used, as labelled lines rather than a judgement. */
export function deadEndEvidenceLines(health) {
  if (!health) return [];
  const lines = [
    { label: "Minutes investigating", text: String(health.minutes_investigating ?? 0) },
    { label: "Repeated diagnostics", text: String(health.repeated_tests ?? 0) },
    { label: "Tests since a conclusion", text: String(health.tests_since_conclusion ?? 0) },
  ];
  if (health.scopes_tested?.length === 1) {
    lines.push({ label: "Evidence source", text: `${health.scopes_tested[0]} only` });
  } else if (health.scopes_tested?.length > 1) {
    lines.push({ label: "Evidence sources", text: health.scopes_tested.join(", ") });
  }
  return lines;
}

const OUTCOME_METHOD_PHRASES = [
  "restart", "reboot", "rebuild", "re-run", "rerun", "run the", "execute",
  "flush", "clear the cache", "reinstall", "re-index", "reindex", "gpupdate",
  "net stop", "net start", "stop the service", "start the service", "reset the",
];

/** True when the stated outcome is an instruction rather than an outcome. */
export function outcomeIsMethod(outcome) {
  const text = String(outcome || "").trim().toLowerCase();
  return OUTCOME_METHOD_PHRASES.some((phrase) => text.includes(phrase));
}

/**
 * Validate the contract form client-side. The server remains the authority; this
 * only avoids a round trip that is certain to be refused.
 */
export function contractFormErrors(form = {}) {
  const errors = [];
  const outcome = String(form.outcome || "").trim();
  if (outcome.length < 5) errors.push("State the business outcome the customer needs.");
  else if (outcomeIsMethod(outcome)) errors.push("That is the method, not the outcome. Write what the customer must be able to do.");
  if (!String(form.preconditions || "").trim()) errors.push("Record the preconditions the outcome depends on.");
  if (!String(form.acceptable_interruption || "").trim()) errors.push("Record how much interruption the customer accepts.");
  if (!String(form.rollback || "").trim()) errors.push("Record the rollback conditions and path.");
  if (!VERIFICATION_KINDS.some((kind) => kind.value === form.verification_method)) errors.push("Choose how this outcome will be verified.");
  const days = Number(form.evidence_days);
  if (!Number.isFinite(days) || days < 1 || days > 365) errors.push("Verification evidence must be valid for 1 to 365 days.");
  const sensitive = ["outcome", "preconditions", "rollback"].find((field) => containsCredentialMaterial(form[field]));
  if (sensitive) errors.push(`Credential material is never stored; remove it from ${sensitive}.`);
  return errors;
}

/** Build the contract request body, or null when the form is not yet valid. */
export function contractPayload(form = {}) {
  if (contractFormErrors(form).length) return null;
  return {
    outcome: String(form.outcome).trim(),
    preconditions: String(form.preconditions).trim(),
    dependencies: (form.dependencies || []).map((item) => String(item).trim()).filter(Boolean).slice(0, 12),
    acceptable_interruption: String(form.acceptable_interruption).trim(),
    verification_method: form.verification_method,
    rollback: String(form.rollback).trim(),
    evidence_days: Number(form.evidence_days),
  };
}

/** Validate a verification or breadcrumb note before sending it. */
export function evidenceNoteError(note) {
  const text = String(note || "").trim();
  if (text.length < 12) return "Describe what was observed, not just that something was done.";
  if (containsCredentialMaterial(text)) return "Credential material is never stored. Remove it before saving.";
  return "";
}
