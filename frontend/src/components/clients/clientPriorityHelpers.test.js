import {
  getClientCoverageChecklist,
  getClientCoverageSummary,
  getClientPrimaryPriority,
} from "./clientPriorityHelpers";

const COMPLETE_CLIENT = {
  health_score: 88,
  open_tickets: 2,
  overdue_count: 0,
  overdue_amount: 0,
  contact_count: 2,
  asset_count: 5,
  active_contracts: 1,
  lifecycle: "active",
  integrations: { rmm: true, m365: true, acronis: true },
};

describe("client priority helpers", () => {
  test("puts an evidenced overdue balance ahead of every other signal", () => {
    const priority = getClientPrimaryPriority({
      ...COMPLETE_CLIENT,
      overdue_count: 2,
      overdue_amount: 4500,
      open_tickets: 19,
      health_score: 41,
    });

    expect(priority.id).toBe("overdue-billing");
    expect(priority.action).toEqual({ kind: "navigate", tab: "billing", label: "Open billing" });
    expect(priority.title).toContain("4,500");
  });

  test("turns relationship gaps into ordered, actionable coverage checks", () => {
    const checklist = getClientCoverageChecklist({
      contact_count: 0,
      asset_count: 0,
      active_contracts: 0,
      integrations: { rmm: false, m365: true, acronis: false },
    });

    expect(checklist.map((item) => [item.id, item.status])).toEqual([
      ["contacts", "attention"],
      ["assets", "attention"],
      ["agreements", "attention"],
      ["rmm", "attention"],
      ["m365", "complete"],
      ["acronis", "attention"],
    ]);
    expect(getClientPrimaryPriority({
      health_score: 88,
      open_tickets: 0,
      overdue_count: 0,
      overdue_amount: 0,
      contact_count: 0,
      asset_count: 0,
      active_contracts: 0,
      integrations: { rmm: false, m365: true, acronis: false },
    }).id).toBe("coverage-contacts");
  });

  test("does not invent missing coverage records as failures", () => {
    const checklist = getClientCoverageChecklist({ integrations: {} });
    const summary = getClientCoverageSummary(checklist);

    expect(checklist.every((item) => item.status === "unknown")).toBe(true);
    expect(summary).toEqual({ complete: 0, known: 0, unknown: 6, total: 6 });
  });

  test("uses the real onboarding lifecycle to select the onboarding callback", () => {
    expect(getClientPrimaryPriority({ ...COMPLETE_CLIENT, lifecycle: "onboarding" }).action).toEqual({
      kind: "continue-onboarding",
      label: "Continue onboarding",
    });
    expect(getClientPrimaryPriority({ ...COMPLETE_CLIENT, lifecycle: "prospect" }).action).toEqual({
      kind: "start-onboarding",
      label: "Start onboarding",
    });
  });
});
