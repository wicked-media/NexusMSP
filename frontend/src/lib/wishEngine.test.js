import {
  WISH_DISPOSITIONS,
  clusterCounts,
  clusterEvidenceLines,
  clusterPath,
  containsCredentialMaterial,
  dispositionFormErrors,
  dispositionOptions,
  dispositionPayload,
  dispositionPresentation,
  promotionAllowed,
  promotionFormErrors,
  promotionPayload,
  promotionReason,
  recordedDisposition,
  suggestionText,
  wishFormErrors,
  wishPayload,
} from "./wishEngine";

const cluster = {
  signature: "certificate close expiry shows",
  occurrences: 3,
  reporter_count: 2,
  surfaces: ["devices", "tickets"],
  member_signatures: ["a", "b"],
  span_days: 17,
  first_seen_at: "2026-09-01T09:00:00+00:00",
  promotion: { allowed: false, reason: "A person has to record what this request should become before it can be promoted." },
};

describe("wishEngine disposition vocabulary", () => {
  it("maps the server vocabulary and falls back to the shared list", () => {
    expect(dispositionOptions([]).map((item) => item.value)).toEqual(WISH_DISPOSITIONS.map((item) => item.value));
    const served = dispositionOptions([{ id: "forge_tool", meaning: "Served meaning" }]);
    expect(served).toEqual([{ value: "forge_tool", label: "Forge tool", meaning: "Served meaning" }]);
  });

  it("never renders an unknown disposition as decided", () => {
    expect(dispositionPresentation("something_new")).toMatchObject({ label: "Not dispositioned yet" });
    expect(dispositionPresentation(null).key).toBe("undecided");
    expect(dispositionPresentation("shortcut")).toMatchObject({ label: "Shortcut" });
  });
});

describe("wishEngine evidence presentation", () => {
  it("states the suggestion with the words it matched", () => {
    expect(suggestionText({ disposition: "shortcut", signals: ["screens", "open"], reason: "" })).toBe(
      "Suggested: Shortcut · matched “screens”, “open”",
    );
  });

  it("does not invent a suggestion when nothing matched", () => {
    const text = suggestionText({ disposition: null, signals: [], reason: "No routing signal matched this request; a person has to choose what it becomes." });
    expect(text).toContain("No routing signal matched");
    expect(text).not.toContain("Suggested:");
    expect(suggestionText(null)).toBe("No routing suggestion yet.");
  });

  it("reports counts and span without naming anyone", () => {
    const counts = clusterCounts(cluster);
    expect(counts.reportsText).toBe("3 reports");
    expect(counts.reportersText).toBe("2 technicians");
    expect(counts.surfacesText).toBe("devices, tickets");
    expect(counts.spanText).toBe("17 days apart");
    expect(clusterCounts({ occurrences: 1, reporter_count: 1, surfaces: [], span_days: 0 })).toMatchObject({
      reportsText: "1 report",
      reportersText: "1 technician",
      surfacesText: "no workspace recorded",
      spanText: "reported the same day",
    });
    expect(clusterEvidenceLines(cluster).map((line) => line.label)).toContain("Phrasings");
    expect(clusterEvidenceLines(cluster).find((line) => line.label === "First reported").text).toBe("2026-09-01");
    expect(clusterEvidenceLines(null)).toEqual([]);
  });

  it("exposes the server's promotion gate verbatim", () => {
    expect(promotionAllowed(cluster)).toBe(false);
    expect(promotionReason(cluster)).toContain("A person has to record");
    expect(promotionAllowed({ promotion: { allowed: true } })).toBe(true);
  });

  it("shows the recorded decision, and nothing when there is none", () => {
    expect(recordedDisposition({ signature: "x" })).toBeNull();
    const recorded = recordedDisposition({
      disposition: {
        disposition: "forge_tool",
        evidence_note: "Two technicians, two workspaces",
        decided_by: "Ops lead",
        occurrences_at_decision: 3,
        idea_id: "idea-9",
        idea_title: "Certificate expiry view",
      },
    });
    expect(recorded).toMatchObject({ label: "Forge tool", decidedBy: "Ops lead", occurrencesAtDecision: 3, ideaId: "idea-9" });
  });

  it("builds an encodable path for a cluster and refuses an empty one", () => {
    expect(clusterPath(cluster)).toBe("certificate%20close%20expiry%20shows");
    expect(clusterPath({})).toBe("");
  });
});

describe("wishEngine validation", () => {
  it("catches a request the server would refuse before it is sent", () => {
    expect(wishFormErrors({ text: "too short", surface: "devices" })).toHaveLength(1);
    expect(wishFormErrors({ text: "A device warranty panel that never hides the warranty", surface: "" })).toEqual([
      "Nexus records which workspace the request was felt in.",
    ]);
    expect(wishFormErrors({ text: "Reset the account with password=hunter2 on the panel", surface: "devices" })).toEqual([
      "Credential material is never stored. Remove it before reporting.",
    ]);
    expect(wishFormErrors({ text: "A device warranty panel that never hides the warranty", surface: "devices" })).toEqual([]);
    expect(containsCredentialMaterial("token=abc123")).toBe(true);
  });

  it("builds a payload only when the form is valid", () => {
    expect(wishPayload({ text: "short", surface: "devices" })).toBeNull();
    expect(wishPayload({ text: "  A device warranty panel without opening tickets  ", surface: " Devices " })).toEqual({
      text: "A device warranty panel without opening tickets",
      surface: "devices",
      context_ref: null,
    });
  });

  it("refuses a disposition without reasoning or with credential material", () => {
    expect(dispositionFormErrors({ disposition: "shortcut", evidence_note: "ok" })).toHaveLength(1);
    expect(dispositionFormErrors({ disposition: "rewrite", evidence_note: "A real reason" })).toHaveLength(1);
    expect(dispositionFormErrors({ disposition: "shortcut", evidence_note: "token=abc12345" })).toEqual([
      "Credential material is never stored. Remove it from the note.",
    ]);
    expect(dispositionPayload({ disposition: "shortcut", evidence_note: "  Two workspaces  " })).toEqual({
      disposition: "shortcut",
      evidence_note: "Two workspaces",
    });
    expect(dispositionPayload({ disposition: "shortcut", evidence_note: "no" })).toBeNull();
  });

  it("validates a promotion into the idea registry", () => {
    expect(promotionFormErrors({ title: "ab", summary: "too short" })).toHaveLength(2);
    expect(promotionFormErrors({ title: "Certificate view", summary: "A shared pattern across two workspaces" })).toEqual([]);
    expect(promotionPayload({ title: " Certificate view ", summary: " A shared pattern across two workspaces ", horizon: "Next" })).toEqual({
      title: "Certificate view",
      summary: "A shared pattern across two workspaces",
      horizon: "next",
    });
    expect(promotionPayload({ title: "Certificate view", summary: "short" })).toBeNull();
  });
});
