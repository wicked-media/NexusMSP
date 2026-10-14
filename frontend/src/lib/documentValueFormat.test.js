import {
  distributionRows,
  documentValueText,
  formatCount,
  isMoneyField,
  isNumericValue,
  labelFor,
  looksLikeDistribution,
  recordColumns,
} from "./documentValueFormat";

describe("report document value formatting", () => {
  test("reads a unit from the field name rather than from its magnitude", () => {
    expect(documentValueText("total_invoiced", 184320.55)).toBe("$184,320.55");
    expect(documentValueText("outstanding", 33100.45)).toBe("$33,100.45");
    expect(documentValueText("tickets_total", 148)).toBe("148");
    expect(documentValueText("devices_total", 214)).toBe("214");
    expect(documentValueText("jobs_total", 96)).toBe("96");
    expect(documentValueText("security_assessed_pct", 84)).toBe("84%");
    expect(documentValueText("sla_compliance", 92.5)).toBe("92.5");
  });

  test("states absent evidence instead of inventing a zero", () => {
    expect(documentValueText("note", null)).toBe("Not recorded");
    expect(documentValueText("note", "")).toBe("Not recorded");
    expect(documentValueText("latest_compliance", "CIS v8.0 - 84%")).toBe("CIS v8.0 - 84%");
  });

  test("classifies money and count field names", () => {
    expect(isMoneyField("grand_total")).toBe(true);
    expect(isMoneyField("line_total")).toBe(true);
    expect(isMoneyField("invoice_count")).toBe(false);
    expect(isMoneyField("devices_total")).toBe(false);
  });

  test("keeps a distribution only where a share of total is meaningful", () => {
    expect(looksLikeDistribution("by_status", { open: 7, resolved: 121 })).toBe(true);
    expect(looksLikeDistribution("by_priority", { low: 60, high: 25 })).toBe(true);
    expect(looksLikeDistribution("billing", { total_invoiced: 10, invoice_count: 2 })).toBe(false);
    expect(looksLikeDistribution("summary", { devices_total: 10, tickets_total: 2 })).toBe(false);
    expect(looksLikeDistribution("by_status", { open: 7, note: "mixed" })).toBe(false);
    expect(looksLikeDistribution("by_status", { open: 7 })).toBe(false);
  });

  test("ranks a distribution, totals it and keeps the recorded order", () => {
    const { rows, total } = distributionRows({ open: 7, closed: 15, resolved: 121 });
    expect(total).toBe(143);
    expect(rows.map((row) => row.label)).toEqual(["Open", "Closed", "Resolved"]);
    expect(rows[2].share).toBeCloseTo(84.6, 1);
    expect(distributionRows({}).rows).toEqual([]);
  });

  test("caps record columns at the readable maximum", () => {
    const wide = [{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }];
    expect(recordColumns(wide)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(recordColumns([])).toEqual([]);
  });

  test("formats counts and labels without changing the recorded value", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(84.5)).toBe("84.5");
    expect(isNumericValue(0)).toBe(true);
    expect(isNumericValue("84")).toBe(false);
    expect(formatCount(96.4)).toBe("96.4");
  });

  test("names a field in the document's own voice, not as a database column", () => {
    expect(labelFor("sla_compliance_pct")).toBe("SLA Compliance");
    expect(labelFor("m365_mailboxes")).toBe("M365 Mailboxes");
    expect(labelFor("rpo_hours")).toBe("RPO Hours");
    expect(labelFor("device_id")).toBe("Device ID");
    expect(labelFor("by_status")).toBe("By Status");
    expect(labelFor("invoice_count")).toBe("Invoice Count");
    expect(labelFor("Unit price")).toBe("Unit Price");
    expect(labelFor("")).toBe("");
  });

  test("keeps the unit with the value rather than in the label", () => {
    expect(documentValueText("sla_compliance_pct", 96.4)).toBe("96.4%");
    expect(documentValueText("security_assessed_pct", 84)).toBe("84%");
    expect(documentValueText("average_resolution_hours", 6.4)).toBe("6.4");
    expect(documentValueText("total_invoiced", 1843205.5)).toBe("$1,843,205.50");
  });
});
