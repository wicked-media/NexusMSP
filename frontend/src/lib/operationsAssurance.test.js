import {
  allGaps,
  commitmentHeadline,
  commitmentStateIsPositive,
  commitmentStateLabel,
  commitmentStateTone,
  formatCount,
  gapFields,
  gapIdentifier,
  gapReason,
  reportedTotal,
  stateCounts,
  unmeasuredCommitments,
} from "./operationsAssurance";

test("every governed state has a tone and only 'met' is positive", () => {
  expect(commitmentStateTone("met")).toBe("emerald");
  expect(commitmentStateTone("at_risk")).toBe("amber");
  expect(commitmentStateTone("breached")).toBe("rose");
  expect(commitmentStateTone("not_measured")).toBe("violet");
});

test("an unrecognised state is neutral and never positive", () => {
  expect(commitmentStateTone("probably-fine")).toBe("slate");
  expect(commitmentStateLabel("probably-fine")).toBe("Unrecognised state");
  expect(commitmentStateIsPositive("probably-fine")).toBe(false);
  expect(commitmentStateTone(undefined)).toBe("slate");
});

test("not_measured is never presented as a positive outcome", () => {
  expect(commitmentStateIsPositive("not_measured")).toBe(false);
  expect(commitmentStateTone("not_measured")).not.toBe(commitmentStateTone("met"));
  expect(commitmentStateLabel("not_measured")).toBe("Not measured");
});

test("state labels are stable for each governed state", () => {
  expect(commitmentStateLabel("met")).toBe("Met");
  expect(commitmentStateLabel("at_risk")).toBe("At risk");
  expect(commitmentStateLabel("breached")).toBe("Breached");
  // A state value that arrives with stray whitespace or casing still resolves.
  expect(commitmentStateLabel("  MET  ")).toBe("Met");
});

test("counts are reported in a fixed reporting order", () => {
  const rows = stateCounts({ met: 2, at_risk: 1, breached: 0, not_measured: 1, total: 4 });
  expect(rows.map((row) => row.state)).toEqual(["met", "at_risk", "breached", "not_measured"]);
  expect(rows.map((row) => row.count)).toEqual([2, 1, 0, 1]);
  expect(rows.map((row) => row.label)).toEqual(["Met", "At risk", "Breached", "Not measured"]);
});

test("a count the server did not send is null rather than a confident zero", () => {
  const rows = stateCounts({ met: 1 });
  expect(rows.find((row) => row.state === "met").count).toBe(1);
  expect(rows.find((row) => row.state === "breached").count).toBeNull();
  expect(stateCounts(null).every((row) => row.count === null)).toBe(true);
  expect(formatCount(null)).toBe("Not recorded");
  expect(formatCount(0)).toBe("0");
});

test("the reported total is null when the server did not state one", () => {
  expect(reportedTotal({ total: 4 })).toBe(4);
  expect(reportedTotal({})).toBeNull();
  expect(reportedTotal(undefined)).toBeNull();
  expect(reportedTotal({ total: "nonsense" })).toBeNull();
});

test("gap fields render only the keys the gap actually carries", () => {
  const fields = gapFields({
    workload_id: "wl-1", name: "SQL", age_hours: 30, rpo_hours: 24,
    device_id: "", website_id: null,
  });
  expect(fields).toEqual([
    { key: "name", label: "Name", value: "SQL" },
    { key: "workload_id", label: "Workload", value: "wl-1" },
    { key: "age_hours", label: "Age (h)", value: "30" },
    { key: "rpo_hours", label: "RPO (h)", value: "24" },
  ]);
});

test("a gap shaped differently still renders, and an empty gap renders nothing", () => {
  expect(gapFields({ device_id: "dev-9", silent_hours: 51 }).map((field) => field.key))
    .toEqual(["device_id", "silent_hours"]);
  expect(gapFields({})).toEqual([]);
  expect(gapFields(null)).toEqual([]);
  expect(gapFields("nonsense")).toEqual([]);
});

test("a gap without an obvious identifier or reason still says something useful", () => {
  expect(gapIdentifier({ user_id: "u-1", name: "Ex Employee" })).toBe("Ex Employee");
  expect(gapIdentifier({ timeframe_hours: 4 })).toBe("4");
  expect(gapIdentifier(null)).toBe("Unnamed item");
  expect(gapReason({ reason: "Access was revoked late." })).toBe("Access was revoked late.");
  expect(gapReason({})).toBe("No reason was recorded for this gap.");
});

test("the actionable gap list carries the commitment that produced each gap", () => {
  const rows = allGaps({
    id: "verified_recovery_point",
    title: "Verified recovery point",
    gaps: [{ name: "SQL", workload_id: "wl-1", reason: "Older than the RPO." }],
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].commitmentId).toBe("verified_recovery_point");
  expect(rows[0].identifier).toBe("SQL");
  expect(rows[0].reason).toBe("Older than the RPO.");
  expect(allGaps({ id: "x" })).toEqual([]);
});

test("the headline is the promise and unmeasured promises are surfaced", () => {
  expect(commitmentHeadline({ promise: "Every workload has a verified recovery point." }))
    .toBe("Every workload has a verified recovery point.");
  expect(commitmentHeadline({})).toBe("This promise was not recorded.");

  const commitments = [
    { id: "a", state: "met" },
    { id: "b", state: "not_measured" },
    { id: "c", state: "breached" },
  ];
  expect(unmeasuredCommitments(commitments).map((commitment) => commitment.id)).toEqual(["b"]);
  expect(unmeasuredCommitments(null)).toEqual([]);
});
