import {
  closeoutCopy,
  containsCredentialMaterial,
  contractFormErrors,
  contractPayload,
  contractStatus,
  deadEndEvidenceLines,
  deadEndStatus,
  evidenceNoteError,
  frictionEstimateText,
  outcomeIsMethod,
  resumeLines,
  stalenessLabel,
} from "./flowIntelligence";

const validForm = {
  outcome: "Sarah can open MYOB, reach the company database and generate an invoice.",
  preconditions: "MYOB licensed on the workstation",
  acceptable_interruption: "Up to 10 minutes outside 9am-12pm",
  verification_method: "customer_confirmed",
  rollback: "Restore the previous MYOB configuration snapshot",
  evidence_days: 14,
  dependencies: ["MYOB server", "  ", "SQL instance"],
};

test("an unknown contract status is never presented as healthy", () => {
  expect(contractStatus("verified")).toEqual({ key: "verified", tone: "emerald", label: "Outcome verified" });
  expect(contractStatus("expired").tone).toBe("amber");
  expect(contractStatus("insufficient").tone).toBe("rose");
  expect(contractStatus("something-new")).toEqual({ key: "something-new", tone: "zinc", label: "No contract" });
});

test("close-out copy carries the backend reason instead of claiming success", () => {
  const blocked = closeoutCopy({ allowed: false, status: "unverified", reason: "The contract is complete but no verification evidence has been recorded yet." });
  expect(blocked.tone).toBe("rose");
  expect(blocked.detail).toContain("no verification evidence");

  const expired = closeoutCopy({ allowed: false, status: "expired", reason: "The verification evidence has expired and the outcome must be re-verified." });
  expect(expired.tone).toBe("amber");
  expect(expired.label).toMatch(/re-verify/i);

  expect(closeoutCopy({ allowed: true, status: "no_contract", reason: "No contract." }).label).toBe("No verified-outcome claim");
  expect(closeoutCopy({ allowed: true, status: "verified", reason: "Verified." }).tone).toBe("emerald");
});

test("resume lines never fabricate a summary from empty evidence", () => {
  expect(resumeLines(null)).toEqual([]);
  expect(resumeLines({})).toEqual([]);

  const lines = resumeLines({
    testing: "Direct TDS connection",
    ruled_out: ["DNS", "Routing"],
    findings: ["Service account password expired"],
    open_hypotheses: ["SQL failover misconfigured"],
    next_step: "Compare service account permissions",
  });
  expect(lines.map((line) => line.label)).toEqual(["You were testing", "Already ruled out", "Findings so far", "Still open", "Next step"]);
  expect(lines[1].text).toBe("DNS; Routing");
});

test("stale conclusions are labelled and carry the reason", () => {
  expect(stalenessLabel({ reason: "possibly_stale", detail: "A change landed after this conclusion." }).tone).toBe("rose");
  expect(stalenessLabel({ reason: "age_stale" }).tone).toBe("amber");
  expect(stalenessLabel(null).label).toBe("Unverified");
});

test("a friction saving is either measured or explicitly not claimed", () => {
  expect(frictionEstimateText({ estimate_available: false, estimate_reason: "Evidence spans fewer than 7 days, so Nexus does not claim a monthly rate." }))
    .toBe("Evidence only — Evidence spans fewer than 7 days, so Nexus does not claim a monthly rate.");
  expect(frictionEstimateText({ estimate_available: true, estimated_monthly_hours: 19.1, estimated_monthly_repeats: 286 }))
    .toBe("≈ 19.1h/month · 286 repeats/month");
  expect(frictionEstimateText(null)).toBe("No evidence");
});

test("credential material and method-as-outcome are caught before a request is sent", () => {
  expect(containsCredentialMaterial("Rotated the local admin password today")).toBe(false);
  expect(containsCredentialMaterial("api_key=sk_live_abc123")).toBe(true);

  expect(outcomeIsMethod("Restart the MYOB service")).toBe(true);
  expect(outcomeIsMethod("Sarah can print to the accounts printer")).toBe(false);
});

test("contract validation mirrors the server gates", () => {
  expect(contractFormErrors(validForm)).toEqual([]);

  const method = contractFormErrors({ ...validForm, outcome: "Restart the MYOB service" });
  expect(method.some((error) => /method, not the outcome/i.test(error))).toBe(true);

  const missingRollback = contractFormErrors({ ...validForm, rollback: "" });
  expect(missingRollback.some((error) => /rollback/i.test(error))).toBe(true);

  const badDays = contractFormErrors({ ...validForm, evidence_days: 400 });
  expect(badDays.some((error) => /1 to 365 days/.test(error))).toBe(true);

  const secret = contractFormErrors({ ...validForm, rollback: "restore token=abc from the vault" });
  expect(secret.some((error) => /Credential material/i.test(error))).toBe(true);
});

test("the payload only carries trimmed, validated fields", () => {
  expect(contractPayload({ ...validForm, outcome: "Restart it" })).toBeNull();

  const payload = contractPayload(validForm);
  expect(payload.dependencies).toEqual(["MYOB server", "SQL instance"]);
  expect(payload.verification_method).toBe("customer_confirmed");
  expect(payload.evidence_days).toBe(14);
});

test("evidence notes need a real observation", () => {
  expect(evidenceNoteError("done")).toMatch(/Describe what was observed/);
  expect(evidenceNoteError("token=abc123")).toMatch(/Credential material/);
  expect(evidenceNoteError("Sarah generated invoice INV-1043 on the call")).toBe("");
});

test("a dead-end verdict is labelled truthfully and an unknown one is not healthy", () => {
  expect(deadEndStatus("stalled")).toEqual({ key: "stalled", tone: "rose", label: "Investigation appears stalled" });
  expect(deadEndStatus("at_risk").tone).toBe("amber");
  expect(deadEndStatus("progressing").tone).toBe("emerald");
  expect(deadEndStatus("something-new")).toEqual({ key: "something-new", tone: "zinc", label: "No verdict yet" });
});

test("the detector shows its evidence and names a narrowed evidence source", () => {
  expect(deadEndEvidenceLines(null)).toEqual([]);
  const lines = deadEndEvidenceLines({ minutes_investigating: 35, repeated_tests: 2, tests_since_conclusion: 3, scopes_tested: ["dev-1"] });
  expect(lines).toEqual([
    { label: "Minutes investigating", text: "35" },
    { label: "Repeated diagnostics", text: "2" },
    { label: "Tests since a conclusion", text: "3" },
    { label: "Evidence source", text: "dev-1 only" },
  ]);
  const multiple = deadEndEvidenceLines({ minutes_investigating: 10, scopes_tested: ["dev-1", "dev-2"] });
  expect(multiple[multiple.length - 1]).toEqual({ label: "Evidence sources", text: "dev-1, dev-2" });
});
