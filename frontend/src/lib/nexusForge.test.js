import {
  approvalBlocked,
  approvalNoteRequirement,
  blockingChecks,
  checkCounts,
  checkStatus,
  containsCredentialMaterial,
  emptySpecForm,
  kindPresentation,
  lifecycleCopy,
  privilegedPhrases,
  publishFormErrors,
  publishPayload,
  reviewFormErrors,
  reviewPayload,
  specFormErrors,
  specPayload,
  stagePresentation,
  verdictCopy,
  verdictPresentation,
  versionHistory,
} from "./nexusForge";

const validForm = {
  title: "Certificate expiry view",
  intent: "Show every certificate close to expiry with its dependent services",
  kind: "panel",
  expected_outcome: "One place to see expiring certificates and what depends on them",
  capability_refs: ["/api/devices"],
  tenant_enforced: true,
  permissions: "devices.read",
  data_classes: "asset_metadata",
  sandbox_plan: "Run against the seeded sandbox tenant for 14 days before any customer sees it.",
  tests: "An expiring certificate inside 30 days appears exactly once",
  verification: "Compare the device record before and after inside the sandbox tenant.",
  rollback: "Remove the panel registration and restore the previous workspace layout.",
  review_interval_days: 90,
};

const request = {
  stage: "specified",
  verdict: "needs_review",
  verdict_reason: "1 check(s) need a human decision: Verification for state-changing steps.",
  checks: [
    { id: "grounded_capabilities", label: "Grounded", status: "pass" },
    { id: "write_verification", label: "Verification", status: "needs_review" },
    { id: "blast_radius", label: "Blast radius", status: "fail" },
  ],
  versions: [],
};

describe("nexusForge presentation", () => {
  it("never renders an unknown status or verdict as a pass", () => {
    expect(checkStatus("something")).toMatchObject({ label: "Not evaluated", tone: "zinc" });
    expect(checkStatus("fail")).toMatchObject({ tone: "rose" });
    expect(verdictPresentation("")).toMatchObject({ label: "No verdict recorded" });
    expect(verdictPresentation("pass")).toMatchObject({ label: "Every check passed" });
    expect(stagePresentation("published")).toMatchObject({ label: "Version recorded" });
    expect(stagePresentation("weird")).toMatchObject({ label: "Unrecognised stage" });
    expect(kindPresentation("diagnostic_command")).toMatchObject({ label: "Diagnostic command" });
    expect(kindPresentation("mystery")).toMatchObject({ label: "Mystery" });
  });

  it("summarises the checks and puts the worst first", () => {
    expect(checkCounts(request.checks)).toEqual({ pass: 1, needs_review: 1, fail: 1, total: 3 });
    expect(checkCounts(null)).toEqual({ pass: 0, needs_review: 0, fail: 0, total: 0 });
    expect(blockingChecks(request.checks).map((check) => check.id)).toEqual(["blast_radius", "write_verification"]);
    expect(verdictCopy(request)).toMatchObject({ tone: "amber", detail: request.verdict_reason });
  });

  it("says why an approval is blocked and how long an acknowledgement must be", () => {
    expect(approvalBlocked(request)).toContain("failed 1 check(s)");
    expect(approvalBlocked({ verdict: "pass", stage: "specified", checks: [] })).toBe("");
    expect(approvalBlocked({ verdict: "pass", stage: "published", checks: [] })).toContain("versioned");
    expect(approvalNoteRequirement(request)).toMatchObject({ required: true, minimum: 20 });
    expect(approvalNoteRequirement({ verdict: "pass", checks: [{ status: "pass" }] })).toMatchObject({ required: false });
  });

  it("catches the privilege and credential requests the server refuses", () => {
    expect(privilegedPhrases("Give it production credentials and let it run as system")).toEqual([
      "production credentials",
      "run as system",
    ]);
    expect(privilegedPhrases("Read the device inventory")).toEqual([]);
    expect(containsCredentialMaterial("password=hunter2")).toBe(true);
  });

  it("describes the lifecycle without claiming a deployment", () => {
    expect(lifecycleCopy({ stage: "approved" }).detail).toContain("still has to be built");
    expect(lifecycleCopy({ stage: "specified" }).detail).toContain("Waiting for a person");
    expect(lifecycleCopy({ stage: "rejected" }).label).toBe("Rejected");
  });
});

describe("nexusForge specification validation", () => {
  it("accepts a complete specification", () => {
    expect(specFormErrors(validForm)).toEqual([]);
    expect(specPayload(validForm)).toEqual({
      title: validForm.title,
      intent: validForm.intent,
      kind: "panel",
      expected_outcome: validForm.expected_outcome,
      capability_refs: ["/api/devices"],
      scope: { tenant_enforced: true, permissions: ["devices.read"], data_classes: ["asset_metadata"] },
      sandbox_plan: validForm.sandbox_plan,
      tests: [validForm.tests],
      verification: validForm.verification,
      rollback: validForm.rollback,
      review_interval_days: 90,
    });
  });

  it("fails the gates a technician skipped before the round trip", () => {
    const errors = specFormErrors({ ...validForm, title: "ab", capability_refs: [], sandbox_plan: "", tests: "", rollback: "", review_interval_days: 0 });
    expect(errors.join(" ")).toContain("title of at least 3");
    expect(errors.join(" ")).toContain("Compose at least one capability");
    expect(errors.join(" ")).toContain("proven first");
    expect(errors.join(" ")).toContain("at least one verification test");
    expect(errors.join(" ")).toContain("withdrawn");
    expect(errors.join(" ")).toContain("between 1 and 365 days");
    expect(specPayload({ ...validForm, title: "ab" })).toBeNull();
  });

  it("refuses a wildcard permission, an undeclared data class and a design that is not server-scoped", () => {
    const wildcard = specFormErrors({ ...validForm, permissions: "*", data_classes: "", tenant_enforced: false });
    expect(wildcard.join(" ")).toContain("A wildcard permission is never granted");
    expect(wildcard.join(" ")).toContain("Declare which data classes");
    expect(wildcard.join(" ")).toContain("scoped server-side");
  });

  it("refuses privilege and credential material in the request itself", () => {
    expect(specFormErrors({ ...validForm, intent: "Store the domain admin password so it can fix any device" }).join(" ")).toContain(
      "Nexus cannot grant privilege",
    );
    expect(specFormErrors({ ...validForm, sandbox_plan: "Connect with password=hunter2 and leave it running for the sandbox" }).join(" ")).toContain(
      "Credential material is never stored",
    );
  });

  it("starts a specification form with one capability already composed", () => {
    expect(emptySpecForm("/api/devices").capability_refs).toEqual(["/api/devices"]);
    expect(emptySpecForm().capability_refs).toEqual([]);
    expect(emptySpecForm().tenant_enforced).toBe(true);
  });
});

describe("nexusForge review and version governance", () => {
  it("blocks an approval of a failed design and demands a note when checks are flagged", () => {
    expect(reviewFormErrors(request, { decision: "approved", evidence_note: "Looks fine to me" }).join(" ")).toContain("cannot be approved");
    expect(
      reviewFormErrors({ ...request, verdict: "needs_review", checks: [{ status: "needs_review" }] }, { decision: "approved", evidence_note: "short" }).join(" "),
    ).toContain("requires a written reason");
    expect(
      reviewFormErrors({ ...request, verdict: "needs_review", checks: [{ status: "needs_review" }] }, {
        decision: "approved",
        evidence_note: "The verification gap is acceptable because the tool only previews records.",
      }),
    ).toEqual([]);
    expect(reviewFormErrors(request, { decision: "rejected", evidence_note: "Duplicate of an existing panel" })).toEqual([]);
    expect(reviewPayload({ decision: "rejected", evidence_note: "Duplicate of an existing panel" })).toEqual({
      decision: "rejected",
      evidence_note: "Duplicate of an existing panel",
    });
  });

  it("only records a newer, valid version for an approved design", () => {
    const approved = { ...request, stage: "approved", verdict: "pass", checks: [], versions: [{ version: "1.0" }] };
    expect(publishFormErrors(approved, { version: "1.1", evidence_note: "Adds the dependent-service column" })).toEqual([]);
    expect(publishFormErrors({ ...approved, stage: "specified" }, { version: "1.1", evidence_note: "Not approved yet" }).join(" ")).toContain(
      "approve the design",
    );
    expect(publishFormErrors(approved, { version: "v1", evidence_note: "Bad version" }).join(" ")).toContain("1.0 or 1.2.3");
    expect(publishFormErrors(approved, { version: "1.0", evidence_note: "Same version again" }).join(" ")).toContain("never overwritten");
    expect(publishFormErrors(approved, { version: "0.9", evidence_note: "Older version" }).join(" ")).toContain("never overwritten");
    expect(publishPayload({ version: " 1.1 ", evidence_note: " Adds the dependent-service column " })).toEqual({
      version: "1.1",
      evidence_note: "Adds the dependent-service column",
    });
    expect(publishPayload({ version: "1.1", evidence_note: "no" })).toBeNull();
  });

  it("lists the version history newest first with what it supersedes", () => {
    const history = versionHistory({
      versions: [
        { version: "1.0", note: "First release", review_interval_days: 90 },
        { version: "1.1", note: "Adds a column", supersedes: "1.0", review_interval_days: 90 },
      ],
    });
    expect(history.map((item) => item.version)).toEqual(["1.1", "1.0"]);
    expect(history[0].supersedes).toBe("1.0");
    expect(versionHistory({})).toEqual([]);
    const published = lifecycleCopy({ stage: "published", versions: [{ version: "1.1", review_interval_days: 90 }] });
    expect(published.detail).toContain("Version 1.1 recorded");
    expect(published.detail).toContain("not deployed");
  });
});
