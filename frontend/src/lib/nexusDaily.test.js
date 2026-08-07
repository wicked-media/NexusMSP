import { buildNexusDailyBriefing, getDailyRoleLens } from "./nexusDaily";

const missionControl = {
  summary: {
    attention_count: 7,
    automated_actions_24h: 4,
    health_score: 91,
    health_label: "Healthy",
  },
  focus: { id: "focus-1", title: "Review failed backup", route: "/backup-center" },
  panels: [
    { id: "infrastructure", count: 2, route: "/devices", metrics: [{ label: "Offline assets", value: 1 }, { label: "Failed backups", value: 1 }] },
    { id: "billing", count: 3, route: "/billing-recon", metrics: [{ label: "Overdue invoices", value: 2 }] },
    { id: "security", count: 1, route: "/security-dashboard", metrics: [{ label: "Critical alerts", value: 1 }, { label: "Open vulnerabilities", value: 0 }] },
    { id: "client-health", count: 2, route: "/clients", metrics: [{ label: "Active clients", value: 18 }, { label: "Active tickets", value: 9 }] },
  ],
  workstreams: [
    { id: "critical", count: 2 },
    { id: "attention", count: 3 },
  ],
};

describe("Nexus Daily briefing", () => {
  test("adapts the story order to the signed-in role", () => {
    expect(getDailyRoleLens({ role: "finance manager" }).label).toBe("Finance desk");
    expect(getDailyRoleLens({ role: "security analyst" }).label).toBe("Security operations");
    expect(getDailyRoleLens({ role: "technician" }).label).toBe("Technician focus");

    const finance = buildNexusDailyBriefing({ missionControl, nexusBrain: {}, user: { role: "finance" } });
    const technician = buildNexusDailyBriefing({ missionControl, nexusBrain: {}, user: { role: "technician" } });
    expect(finance.sections[0].id).toBe("finance");
    expect(technician.sections[0].id).toBe("operations");
  });

  test("uses evidence-backed mission and billing values", () => {
    const briefing = buildNexusDailyBriefing({
      missionControl,
      nexusBrain: { briefing: { metrics: { revenue_found: 480, pending_approvals: 2 } } },
      user: { role: "admin" },
    });

    expect(briefing.healthScore).toBe(91);
    expect(briefing.headline).toContain("7 items");
    expect(briefing.headline).toContain("4 evidenced actions");
    expect(briefing.sections.find(section => section.id === "finance").headline).toContain("$480");
    expect(briefing.focus.title).toBe("Review failed backup");
  });
});
