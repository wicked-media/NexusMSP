import {
  costBasis,
  formatHours,
  formatMoney,
  formatWindow,
  lastSeenLabel,
  signaturePressure,
  supportDebtHeadline,
} from "./supportDebt";

test("money is either recorded or explicitly not recorded", () => {
  expect(formatMoney(22400)).toBe("$22,400.00");
  expect(formatMoney(0)).toBe("$0.00");
  expect(formatMoney(null)).toBe("Not recorded");
  expect(formatMoney(undefined)).toBe("Not recorded");
  expect(formatMoney("nonsense")).toBe("Not recorded");
});

test("an unknown cost basis claims nothing rather than looking complete", () => {
  expect(costBasis("complete")).toEqual({ key: "complete", tone: "emerald", label: "Value recorded for all work" });
  expect(costBasis("partial").tone).toBe("amber");
  expect(costBasis("none").label).toMatch(/Hours only/);
  expect(costBasis("something-new")).toEqual({ key: "something-new", tone: "zinc", label: "Value basis not stated" });
});

test("the headline never turns missing value into a zero dollar figure", () => {
  expect(supportDebtHeadline(null)).toMatch(/repeated often enough/);
  expect(supportDebtHeadline({ signatures: 0 })).toMatch(/repeated often enough/);

  const uncosted = supportDebtHeadline({ signatures: 3, annual_hours: 120, annual_cost: null, uncosted_signatures: 3 });
  expect(uncosted).toMatch(/3 recurring patterns/);
  expect(uncosted).toMatch(/no dollar figure is claimed/);

  const costed = supportDebtHeadline({ signatures: 2, annual_hours: 60, annual_cost: 2400, uncosted_signatures: 1 });
  expect(costed).toContain("$2,400.00");
  expect(costed).toMatch(/1 pattern\(s\) carry no recorded value/);
});

test("rows are ordered by the figure that actually exists", () => {
  expect(signaturePressure({ annual_cost: 4200, annual_hours: 40 })).toBe("rose");
  expect(signaturePressure({ annual_cost: 900, annual_hours: 10 })).toBe("amber");
  expect(signaturePressure({ annual_cost: 120, annual_hours: 2 })).toBe("emerald");
  // No recorded value: hours still decide whether it deserves attention.
  expect(signaturePressure({ annual_cost: null, annual_hours: 12 })).toBe("amber");
  expect(signaturePressure({ annual_cost: null, annual_hours: 2 })).toBe("zinc");
  expect(signaturePressure(null)).toBe("zinc");
});

test("windows, hours and last-seen labels read from the evidence", () => {
  expect(formatWindow(90)).toBe("90 days");
  expect(formatWindow(365)).toBe("a year");
  expect(formatWindow(0)).toBe("Unknown window");
  expect(formatHours(1240.55)).toBe("1,240.6h");
  expect(formatHours(null)).toBe("Not recorded");
  expect(lastSeenLabel({ last_seen: "2026-10-08T09:00:00+00:00" })).toBe("Last seen 2026-10-08");
  expect(lastSeenLabel({})).toBe("No dated occurrence");
});
