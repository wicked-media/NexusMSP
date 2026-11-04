import {
  CHECK_STATES,
  VERDICTS,
  capabilityRows,
  checkSeverity,
  checkStateLabel,
  checkTone,
  exampleManifestText,
  formatCheckSummary,
  marketplaceState,
  missingContractFields,
  parseManifest,
  sortChecks,
  verdictLabel,
  verdictTone,
} from "./extensionStudio";

const REQUIRED_FIELDS = [
  "id", "name", "version", "kind", "distribution", "capabilities",
  "permissions", "data_classes", "isolation", "verification", "rollback",
];

test("a fail never wears a positive tone, and unknown states claim nothing", () => {
  expect(checkTone("pass")).toBe("emerald");
  expect(checkTone("needs_review")).toBe("amber");
  expect(checkTone("fail")).toBe("rose");
  expect(checkTone("PASS")).toBe("emerald");
  expect(checkTone("something-new")).toBe("zinc");
  expect(checkTone(undefined)).toBe("zinc");
  // The whole point: a failure must not be able to look like a pass.
  expect(checkTone("fail")).not.toBe(checkTone("pass"));
});

test("check labels are always words, never colour alone", () => {
  expect(checkStateLabel("pass")).toBe("Pass");
  expect(checkStateLabel("needs_review")).toBe("Needs review");
  expect(checkStateLabel("fail")).toBe("Fail");
  expect(checkStateLabel("mystery")).toBe("Unrecognised check state");
  for (const state of CHECK_STATES) {
    expect(checkStateLabel(state)).not.toMatch(/unrecognised/i);
  }
});

test("an unknown verdict is never rendered as approved", () => {
  expect(verdictTone("approved")).toBe("emerald");
  expect(verdictTone("needs_review")).toBe("amber");
  expect(verdictTone("rejected")).toBe("rose");
  expect(verdictTone("mystery")).toBe("zinc");
  expect(verdictTone("rejected")).not.toBe("emerald");
  expect(verdictLabel("mystery")).toBe("Unrecognised verdict");
  for (const verdict of VERDICTS) {
    expect(verdictLabel(verdict)).not.toMatch(/unrecognised/i);
  }
});

test("an approval says it is a review outcome and promises nothing more", () => {
  expect(verdictLabel("approved")).toMatch(/review outcome only/i);
  for (const verdict of VERDICTS) {
    expect(verdictLabel(verdict)).not.toMatch(/deploy|deployed|execute|privilege|granted/i);
  }
});

test("checks are ordered worst first so the refusal reason leads", () => {
  const sorted = sortChecks([
    { id: "c", state: "pass" },
    { id: "a", state: "fail" },
    { id: "d", state: "mystery" },
    { id: "b", state: "needs_review" },
  ]);
  expect(sorted.map((check) => check.id)).toEqual(["a", "b", "c", "d"]);
  expect(checkSeverity("fail")).toBeLessThan(checkSeverity("needs_review"));
  expect(checkSeverity("needs_review")).toBeLessThan(checkSeverity("pass"));
  expect(sortChecks(undefined)).toEqual([]);
});

test("a valid manifest parses to a payload", () => {
  const result = parseManifest(exampleManifestText());
  expect(result.ok).toBe(true);
  expect(result.error).toBe("");
  expect(result.manifest.id).toBe("acme.backup-summary");
});

test("malformed JSON is refused in the browser without producing a payload", () => {
  const result = parseManifest('{"id": "acme",,}');
  expect(result.ok).toBe(false);
  expect(result.manifest).toBeNull();
  expect(result.error).toMatch(/not valid JSON/i);
});

test("non-object and empty manifests are refused before anything is sent", () => {
  expect(parseManifest("[1, 2, 3]").ok).toBe(false);
  expect(parseManifest("[1, 2, 3]").manifest).toBeNull();
  expect(parseManifest("42").error).toMatch(/must be a JSON object/i);
  expect(parseManifest('"a string"').ok).toBe(false);
  expect(parseManifest("   ").error).toMatch(/empty/i);
  expect(parseManifest(undefined).ok).toBe(false);
});

test("missing required fields are named from the contract", () => {
  const missing = missingContractFields(
    { id: "acme", capabilities: [], isolation: "  ", verification: "ok", rollback: "ok" },
    REQUIRED_FIELDS,
  );
  expect(missing).toContain("name");
  expect(missing).toContain("capabilities");
  expect(missing).toContain("isolation");
  expect(missing).not.toContain("verification");
  expect(missingContractFields(undefined, REQUIRED_FIELDS)).toEqual(REQUIRED_FIELDS);
});

test("the example manifest satisfies every required field and uses governed vocabulary", () => {
  const manifest = parseManifest(exampleManifestText()).manifest;
  expect(missingContractFields(manifest, REQUIRED_FIELDS)).toEqual([]);
  expect(["dashboard", "command", "connector", "workflow"]).toContain(manifest.kind);
  expect(["private", "distributed"]).toContain(manifest.distribution);
  expect(manifest.permissions.every((permission) => !permission.includes("*"))).toBe(true);
  expect(manifest.data_classes).not.toContain("credential");
});

test("the check summary is arithmetic, and says so when no checks ran", () => {
  expect(formatCheckSummary({ pass: 9, needs_review: 1, fail: 0, total: 10 }))
    .toBe("10 checks — 1 need review, 9 pass");
  expect(formatCheckSummary({ pass: 6, needs_review: 0, fail: 4, total: 10 }))
    .toBe("10 checks — 4 fail, 6 pass");
  expect(formatCheckSummary({})).toMatch(/No checks have been run yet/);
  expect(formatCheckSummary({ total: 0 })).toMatch(/No checks have been run yet/);
});

test("the marketplace is reported as deferred with its gate, never as coming soon", () => {
  const deferred = marketplaceState({
    marketplace: { state: "deferred", gate: "Signing infrastructure does not exist yet." },
  });
  expect(deferred.deferred).toBe(true);
  expect(deferred.detail).toBe("Signing infrastructure does not exist yet.");
  expect(deferred.label).toMatch(/deferred/i);
  expect(deferred.label).not.toMatch(/coming soon/i);

  const unstated = marketplaceState({});
  expect(unstated.deferred).toBe(false);
  expect(unstated.detail).toMatch(/deferred/i);
  expect(marketplaceState(undefined).label).toMatch(/not stated/i);
});

test("a long capability list is capped rather than rendered unbounded", () => {
  const capabilities = Array.from({ length: 250 }, (_, index) => ({ id: `/api/x${index}` }));
  const capped = capabilityRows(capabilities, 60);
  expect(capped.rows).toHaveLength(60);
  expect(capped.hidden).toBe(190);
  expect(capped.total).toBe(250);
  expect(capabilityRows(undefined).rows).toEqual([]);
});
