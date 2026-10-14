// Pure presentation and validation helpers for Nexus Forge.
//
// The policy lives in `backend/app/services/nexus_forge.py`: the capability
// catalogue, the twelve checks, the verdict and the version gate. This file only
// labels what the server returned, and it catches the two failures a technician
// should never have to send to find out about: a request for privilege, and a
// request carrying credential material.

/** The forms a Forge tool is allowed to take. */
export const FORGE_TOOL_KINDS = [
  { value: "panel", label: "Panel", meaning: "A contextual surface inside an existing workspace, scoped to the record it was opened from." },
  { value: "dashboard", label: "Dashboard", meaning: "A read-only aggregate view across a scope the caller is already authorised for." },
  { value: "diagnostic_command", label: "Diagnostic command", meaning: "A read-only investigation that gathers evidence and returns it for a person to judge." },
  { value: "workflow", label: "Workflow", meaning: "A staged, approval-gated sequence that reuses an existing workflow runner." },
];

const CHECK_TONES = {
  pass: { tone: "emerald", label: "Pass", className: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-100" },
  needs_review: { tone: "amber", label: "Needs review", className: "border-amber-500/25 bg-amber-500/[0.07] text-amber-100" },
  fail: { tone: "rose", label: "Fail", className: "border-rose-500/25 bg-rose-500/[0.07] text-rose-100" },
};

const VERDICT_TONES = {
  pass: { tone: "emerald", label: "Every check passed", className: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-100" },
  needs_review: { tone: "amber", label: "Needs a human decision", className: "border-amber-500/25 bg-amber-500/[0.07] text-amber-100" },
  fail: { tone: "rose", label: "Blocked", className: "border-rose-500/25 bg-rose-500/[0.07] text-rose-100" },
};

const STAGE_TONES = {
  specified: { tone: "zinc", label: "Specified", className: "border-white/10 bg-white/[0.03] text-zinc-300" },
  changes_requested: { tone: "amber", label: "Changes requested", className: "border-amber-500/25 bg-amber-500/[0.07] text-amber-100" },
  rejected: { tone: "rose", label: "Rejected", className: "border-rose-500/25 bg-rose-500/[0.07] text-rose-100" },
  approved: { tone: "cyan", label: "Approved, no version yet", className: "border-cyan-500/25 bg-cyan-500/[0.07] text-cyan-100" },
  published: { tone: "emerald", label: "Version recorded", className: "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-100" },
};

/** A check's status. An unrecognised status is never rendered as a pass. */
export function checkStatus(status) {
  const key = String(status || "").trim().toLowerCase();
  const found = CHECK_TONES[key];
  if (found) return { key, ...found };
  return { key: key || "unknown", tone: "zinc", label: "Not evaluated", className: "border-white/10 bg-white/[0.03] text-zinc-300" };
}

/** A verdict. An unrecognised verdict never reads as ready. */
export function verdictPresentation(verdict) {
  const key = String(verdict || "").trim().toLowerCase();
  const found = VERDICT_TONES[key];
  if (found) return { key, ...found };
  return { key: key || "unknown", tone: "zinc", label: "No verdict recorded", className: "border-white/10 bg-white/[0.03] text-zinc-300" };
}

/** A design's lifecycle stage. */
export function stagePresentation(stage) {
  const key = String(stage || "").trim().toLowerCase();
  const found = STAGE_TONES[key];
  if (found) return { key, ...found };
  return { key: key || "unknown", tone: "zinc", label: "Unrecognised stage", className: "border-white/10 bg-white/[0.03] text-zinc-300" };
}

export function kindPresentation(kind) {
  const key = String(kind || "").trim().toLowerCase();
  const found = FORGE_TOOL_KINDS.find((item) => item.value === key);
  if (found) return { key, label: found.label, meaning: found.meaning };
  const words = key.replaceAll("_", " ").trim();
  return {
    key: key || "unknown",
    label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unspecified",
    meaning: "",
  };
}

/** Counts per check status, so a reviewer sees the shape of the result at once. */
export function checkCounts(checks) {
  const counts = { pass: 0, needs_review: 0, fail: 0, total: 0 };
  (Array.isArray(checks) ? checks : []).forEach((check) => {
    const key = String(check?.status || "").trim().toLowerCase();
    if (key in counts) counts[key] += 1;
    counts.total += 1;
  });
  return counts;
}

/** The checks that stand between the design and an approval, worst first. */
export function blockingChecks(checks) {
  const rows = Array.isArray(checks) ? checks : [];
  return [
    ...rows.filter((check) => check?.status === "fail"),
    ...rows.filter((check) => check?.status === "needs_review"),
  ];
}

/** How to describe a design's verdict, with the server's own reason. */
export function verdictCopy(request) {
  const presentation = verdictPresentation(request?.verdict);
  return { ...presentation, detail: request?.verdict_reason || "" };
}

/** Whether the review actions can approve this design at all. */
export function approvalBlocked(request) {
  const failing = (request?.checks || []).filter((check) => check?.status === "fail");
  if (String(request?.verdict || "") === "fail" || failing.length) {
    return `This design failed ${failing.length || 1} check(s) and cannot be approved until the specification is fixed.`;
  }
  if (String(request?.stage || "") === "published") return "A published tool is versioned, not approved again as a new design.";
  return "";
}

/** Whether approving needs an acknowledgement note, and how long it must be. */
export function approvalNoteRequirement(request) {
  const flagged = (request?.checks || []).filter((check) => check?.status === "needs_review");
  return flagged.length
    ? { required: true, minimum: 20, reason: `${flagged.length} check(s) need a human decision; approving anyway requires a written reason.` }
    : { required: false, minimum: 5, reason: "" };
}

const PRIVILEGED_PATTERNS = [
  "production credentials", "service-role key", "service role key", "service account password",
  "domain admin", "run as system", "unrestricted", "bypass approval", "bypass authentication",
  "skip the security review", "skip review", "disable auditing", "write directly to the database",
  "credential material",
];

const CREDENTIAL_PATTERNS = [
  "password=", "password:", "passwd=", "api_key=", "apikey=", "secret=", "token=",
  "client_secret", "private_key", "-----begin", "sk_live_", "sk_test_", "xoxb-",
  "bearer ", "authorization:",
];

export function containsCredentialMaterial(text) {
  const haystack = String(text || "").trim().toLowerCase();
  return CREDENTIAL_PATTERNS.some((pattern) => haystack.includes(pattern));
}

/**
 * The phrases the server refuses. Catching them here means a technician is told
 * before sending rather than after being refused.
 */
export function privilegedPhrases(text) {
  const haystack = ` ${String(text || "").trim().toLowerCase()} `;
  return PRIVILEGED_PATTERNS.filter((needle) => haystack.includes(needle));
}

export function emptySpecForm(capabilityId = "") {
  return {
    title: "",
    intent: "",
    kind: "panel",
    expected_outcome: "",
    capability_refs: capabilityId ? [capabilityId] : [],
    tenant_enforced: true,
    permissions: "",
    data_classes: "",
    sandbox_plan: "",
    tests: "",
    verification: "",
    rollback: "",
    review_interval_days: 90,
  };
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Validate a specification before sending it. The server remains the authority. */
export function specFormErrors(form = {}) {
  const errors = [];
  const title = String(form.title || "").trim();
  const intent = String(form.intent || "").trim();
  const outcome = String(form.expected_outcome || "").trim();
  if (title.length < 3) errors.push("Give the tool a title of at least 3 characters.");
  if (intent.length < 12) errors.push("Describe what the tool should do in at least 12 characters.");
  if (outcome.length < 10) errors.push("State the outcome the tool produces, not the steps it takes.");
  if (!FORGE_TOOL_KINDS.some((item) => item.value === form.kind)) errors.push("Choose the form the tool should take.");
  if (!(form.capability_refs || []).length) errors.push("Compose at least one capability Nexus already serves.");
  if (!splitList(form.permissions).length) errors.push("Name the permissions the tool needs.");
  if (splitList(form.permissions).some((item) => ["*", "all", "any", "admin:*"].includes(item.toLowerCase()))) {
    errors.push("A wildcard permission is never granted. Name each capability.");
  }
  if (!splitList(form.data_classes).length) errors.push("Declare which data classes the tool reads.");
  if (String(form.sandbox_plan || "").trim().length < 20) errors.push("Describe where the tool is proven first, in at least 20 characters.");
  const tests = splitList(form.tests);
  if (!tests.length) errors.push("Declare at least one verification test.");
  if (tests.some((item) => item.length < 10)) errors.push("Each test needs at least 10 characters to be checkable.");
  if (String(form.rollback || "").trim().length < 12) errors.push("State how a published version is withdrawn.");
  const interval = Number(form.review_interval_days);
  if (!Number.isFinite(interval) || interval < 1 || interval > 365) errors.push("The re-review interval must be between 1 and 365 days.");
  if (!form.tenant_enforced) errors.push("Every read and write must be scoped server-side; a design cannot rely on frontend filtering.");

  const sensitive = ["title", "intent", "expected_outcome", "sandbox_plan", "rollback", "verification"]
    .find((field) => containsCredentialMaterial(form[field]));
  if (sensitive) errors.push(`Credential material is never stored; remove it from ${sensitive.replaceAll("_", " ")}.`);
  else {
    const privileged = privilegedPhrases([title, intent, outcome, form.sandbox_plan, form.rollback].join(" "));
    if (privileged.length) {
      errors.push(`Nexus cannot grant privilege: remove “${privileged.slice(0, 3).join("”, “")}” from the request.`);
    }
  }
  return errors;
}

/** Build the design-request body, or null when the form is not yet valid. */
export function specPayload(form = {}) {
  if (specFormErrors(form).length) return null;
  return {
    title: String(form.title).trim().slice(0, 120),
    intent: String(form.intent).trim().slice(0, 600),
    kind: form.kind,
    expected_outcome: String(form.expected_outcome).trim().slice(0, 400),
    capability_refs: (form.capability_refs || []).map((item) => String(item).trim()).filter(Boolean).slice(0, 60),
    scope: {
      tenant_enforced: Boolean(form.tenant_enforced),
      permissions: splitList(form.permissions).slice(0, 12),
      data_classes: splitList(form.data_classes).slice(0, 12),
    },
    sandbox_plan: String(form.sandbox_plan).trim().slice(0, 600),
    tests: splitList(form.tests).slice(0, 12),
    verification: String(form.verification || "").trim().slice(0, 400),
    rollback: String(form.rollback).trim().slice(0, 400),
    review_interval_days: Number(form.review_interval_days),
  };
}

/** Validate a review decision. */
export function reviewFormErrors(request, form = {}) {
  const errors = [];
  const note = String(form.evidence_note || "").trim();
  if (!["approved", "changes_requested", "rejected"].includes(form.decision)) errors.push("Choose a decision.");
  if (note.length < 5) errors.push("Record why, in at least 5 characters.");
  if (containsCredentialMaterial(note)) errors.push("Credential material is never stored. Remove it from the note.");
  if (form.decision === "approved") {
    const blocked = approvalBlocked(request);
    if (blocked) errors.push(blocked);
    const requirement = approvalNoteRequirement(request);
    if (requirement.required && note.length < requirement.minimum) errors.push(requirement.reason);
  }
  return errors;
}

export function reviewPayload(form = {}) {
  if (reviewFormErrors(null, form).length) return null;
  return { decision: form.decision, evidence_note: String(form.evidence_note).trim() };
}

/** Validate a version record. */
export function publishFormErrors(request, form = {}) {
  const errors = [];
  const stage = String(request?.stage || "");
  if (!["approved", "published"].includes(stage)) errors.push("A person has to approve the design before a version can be recorded.");
  if (String(request?.verdict || "") === "fail") errors.push("A design whose checks failed cannot record a version.");
  const version = String(form.version || "").trim();
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) errors.push("Use a version in the form 1.0 or 1.2.3.");
  else {
    const existing = (request?.versions || []).map((item) => String(item?.version || ""));
    const asNumbers = (value) => value.split(".").map((part) => Number(part) || 0);
    const newest = existing
      .slice()
      .sort((left, right) => {
        const [a, b] = [asNumbers(left), asNumbers(right)];
        for (let index = 0; index < 3; index += 1) {
          if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
        }
        return 0;
      })
      .pop();
    if (newest && asNumbers(version).join(".") <= asNumbers(newest).join(".")) {
      errors.push(`Version ${version} is not newer than ${newest}; a published version is never overwritten.`);
    }
  }
  const note = String(form.evidence_note || "").trim();
  if (note.length < 5) errors.push("Record what this version changes, in at least 5 characters.");
  if (containsCredentialMaterial(note)) errors.push("Credential material is never stored. Remove it from the note.");
  return errors;
}

export function publishPayload(form = {}) {
  if (String(form.version || "").trim().length < 3 || String(form.evidence_note || "").trim().length < 5) return null;
  return { version: String(form.version).trim().slice(0, 20), evidence_note: String(form.evidence_note).trim() };
}

/** The version history, newest first, with supersession made explicit. */
export function versionHistory(request) {
  const versions = Array.isArray(request?.versions) ? request.versions : [];
  return versions
    .map((item) => ({
      version: String(item?.version || ""),
      note: item?.note || "",
      publishedAt: item?.published_at || "",
      publishedBy: item?.published_by || "",
      supersedes: item?.supersedes || null,
      reviewIntervalDays: Number(item?.review_interval_days || 0),
      capabilities: item?.capabilities || [],
    }))
    .reverse();
}

/** The plain-language lifecycle sentence for one design request. */
export function lifecycleCopy(request) {
  const stage = stagePresentation(request?.stage);
  if (String(request?.stage) === "published") {
    const latest = versionHistory(request)[0];
    const interval = latest?.reviewIntervalDays || 0;
    return {
      ...stage,
      detail: latest
        ? `Version ${latest.version} recorded. ${interval ? `Re-reviewed every ${interval} days.` : ""} Recorded means governed, not deployed.`
        : "A version is recorded. Recorded means governed, not deployed.",
    };
  }
  if (String(request?.stage) === "approved") {
    return { ...stage, detail: "Approved for a version. Nothing is deployed; the tool still has to be built and reviewed like any other product work." };
  }
  if (String(request?.stage) === "specified") {
    return { ...stage, detail: "Waiting for a person to review the specification and its checks." };
  }
  return { ...stage, detail: "" };
}
