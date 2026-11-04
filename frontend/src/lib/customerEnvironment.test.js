import {
  UNMEASURED_LABEL,
  candidateStrength,
  correlationHeadline,
  dimensionDisplay,
  formatCount,
  groupDimensions,
  healthTone,
  minutesBeforeLabel,
  sharedTargetLabel,
  signalChips,
  signalTone,
} from "./customerEnvironment";

test("an unmeasured dimension is never rendered as a zero", () => {
  const unmeasured = dimensionDisplay({ assessed: false, value: null, reason: "Not collected for this view." });
  expect(unmeasured.assessed).toBe(false);
  expect(unmeasured.text).toBe(UNMEASURED_LABEL);
  expect(unmeasured.text).not.toBe("0");
  expect(unmeasured.reason).toBe("Not collected for this view.");
  expect(unmeasured.tone).toBe("zinc");
});

test("an unmeasured dimension with no stated reason still discloses that it was not measured", () => {
  const unmeasured = dimensionDisplay({ assessed: false });
  expect(unmeasured.text).toBe(UNMEASURED_LABEL);
  expect(unmeasured.reason).toMatch(/no reason was disclosed/);
});

test("a missing dimension object is treated as unmeasured rather than crashing", () => {
  expect(dimensionDisplay().text).toBe(UNMEASURED_LABEL);
  expect(dimensionDisplay(null).assessed).toBe(false);
  // A value that arrives without the assessed flag must not be trusted either.
  expect(dimensionDisplay({ value: 5 }).text).toBe(UNMEASURED_LABEL);
});

test("an assessed dimension renders its count", () => {
  const measured = dimensionDisplay({ assessed: true, value: 142, source: "devices" });
  expect(measured.assessed).toBe(true);
  expect(measured.text).toBe("142");
  expect(measured.tone).toBe("slate");
  expect(measured.source).toBe("devices");
  expect(dimensionDisplay({ assessed: true, value: 1234 }).text).toBe("1,234");
});

test("zero is a measured value and only appears when it was actually measured", () => {
  expect(dimensionDisplay({ assessed: true, value: 0 }).text).toBe("0");
  expect(dimensionDisplay({ assessed: false, value: 0, reason: "Not measured." }).text).toBe(UNMEASURED_LABEL);
  expect(formatCount(0)).toBe("0");
  expect(formatCount(null)).toBeNull();
  expect(formatCount("nonsense")).toBeNull();
});

test("health tones are distinct and unknown is never a success tone", () => {
  const healthy = healthTone("healthy");
  const attention = healthTone("attention");
  const unknown = healthTone("unknown");
  expect(healthy.tone).toBe("emerald");
  expect(attention.tone).toBe("amber");
  expect(unknown.tone).toBe("zinc");
  expect(unknown.tone).not.toBe("emerald");
  expect(new Set([healthy.tone, attention.tone, unknown.tone]).size).toBe(3);
  // An unrecognised state claims nothing rather than defaulting to healthy.
  expect(healthTone("something-new").tone).toBe("zinc");
  expect(healthTone(undefined).label).toBe(UNMEASURED_LABEL);
});

test("signal states map to governed tones and an unknown state claims nothing", () => {
  expect(signalTone("verified").tone).toBe("emerald");
  expect(signalTone("connected").tone).toBe("emerald");
  expect(signalTone("due").tone).toBe("amber");
  expect(signalTone("attention").tone).toBe("rose");
  expect(signalTone("not_measured").label).toBe(UNMEASURED_LABEL);
  expect(signalTone("healthy").label).toBe(UNMEASURED_LABEL);
});

test("signal chips keep their disclosure alongside the presentation", () => {
  const chips = signalChips({
    signals: [
      { id: "website_enquiry_workflow", label: "Website enquiry workflow", state: "verified", reason: "" },
      { id: "backup_recovery_test", label: "Backup recovery test", state: "due", reason: "Verified point is older than the RPO." },
    ],
  });
  expect(chips).toHaveLength(2);
  expect(chips[0].presentation.tone).toBe("emerald");
  expect(chips[1].presentation.label).toBe("Due");
  expect(chips[1].reason).toMatch(/older than the RPO/);
  expect(signalChips({})).toEqual([]);
});

test("dimensions are grouped into the three ordered groups with stable ordering", () => {
  const grouped = groupDimensions({
    groups: {
      commercial: [{ id: "services", label: "Services", assessed: true, value: 18 }],
      health: [
        { id: "open_tickets", label: "Open tickets", assessed: true, value: 7 },
        { id: "alerts", label: "Alerts", assessed: false, value: null, reason: "Not collected." },
        { id: "changes", label: "Changes", assessed: true, value: 3 },
      ],
      technology: [
        { id: "websites", label: "Websites", assessed: true, value: 4 },
        { id: "devices", label: "Devices", assessed: true, value: 142 },
      ],
    },
  });
  expect(grouped.map((group) => group.key)).toEqual(["health", "technology", "commercial"]);
  expect(grouped[0].label).toBe("Health");
  // Ordering follows DIMENSION_ORDER, not the order the API happened to send.
  expect(grouped[0].items.map((item) => item.id)).toEqual(["open_tickets", "changes", "alerts"]);
  expect(grouped[1].items.map((item) => item.id)).toEqual(["devices", "websites"]);
  expect(grouped[0].items[2].display.text).toBe(UNMEASURED_LABEL);
  expect(grouped[1].items[0].display.text).toBe("142");
});

test("grouping a customer with no groups returns the three empty tabs", () => {
  const grouped = groupDimensions({});
  expect(grouped).toHaveLength(3);
  expect(grouped.every((group) => group.items.length === 0)).toBe(true);
});

test("candidate strength labels never claim a cause", () => {
  expect(candidateStrength("strong")).toEqual({ key: "strong", tone: "amber", label: "Shares an identified target" });
  expect(candidateStrength("weak")).toEqual({ key: "weak", tone: "zinc", label: "Same customer only" });
  expect(candidateStrength("certain").label).toBe("Evidence strength not stated");
  for (const label of [candidateStrength("strong").label, candidateStrength("weak").label]) {
    expect(label.toLowerCase()).not.toContain("cause");
    expect(label.toLowerCase()).not.toContain("caused");
  }
});

test("timing reads from the recorded minutes and refuses a missing value", () => {
  expect(minutesBeforeLabel(1)).toBe("1 minute before");
  expect(minutesBeforeLabel(45)).toBe("45 minutes before");
  expect(minutesBeforeLabel(60)).toBe("1 hour before");
  expect(minutesBeforeLabel(120)).toBe("2 hours before");
  expect(minutesBeforeLabel(135)).toBe("2h 15m before");
  expect(minutesBeforeLabel(-5)).toBe("Timing not recorded");
  expect(minutesBeforeLabel(undefined)).toBe("Timing not recorded");
});

test("an empty correlation is reported as no match, not as reassurance", () => {
  const empty = correlationHeadline({ window_hours: 24, candidates: [] });
  expect(empty).toMatch(/No change/);
  expect(empty).toMatch(/absence of a match/);
  expect(empty.toLowerCase()).not.toContain("nothing happened");
  expect(empty.toLowerCase()).not.toContain("all clear");
});

test("the headline states that candidates are not conclusions", () => {
  const headline = correlationHeadline({
    window_hours: 24,
    candidates: [
      { change_id: "chg-1", strength: "strong" },
      { change_id: "chg-2", strength: "weak" },
    ],
  });
  expect(headline).toMatch(/2 possible contributors/);
  expect(headline).toMatch(/1 of which share an identified target/);
  expect(headline).toMatch(/not conclusions/);
});

test("shared identifiers are named, and the same-customer fallback is explicit", () => {
  expect(sharedTargetLabel(["dev-1", "site-9"])).toBe("Shared: dev-1, site-9");
  expect(sharedTargetLabel([])).toBe("No shared identifier — same customer only");
  expect(sharedTargetLabel(undefined)).toBe("No shared identifier — same customer only");
});
