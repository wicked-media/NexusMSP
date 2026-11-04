import {
  attentionQueue,
  attentionTone,
  fleetTiles,
  planStatusLabel,
  planStatusTone,
  pluginRows,
  policyLabel,
  preflightSummary,
  riskTone,
  updatePlanItem,
  vulnerableSiteCount,
} from "./webStudioFleet";

describe("Web Studio fleet tiles", () => {
  test("marks a dimension that has never been assessed instead of showing a clean zero", () => {
    const tiles = fleetTiles({
      managed_websites: 3,
      plugin_updates: 0,
      security_findings: 0,
      backup_warnings: 0,
      assessed: { plugins: false, security: false, backups: false },
    });
    const byKey = Object.fromEntries(tiles.map((tile) => [tile.key, tile]));
    expect(byKey.managed.value).toBe(3);
    expect(byKey.updates.unassessed).toBe(true);
    expect(byKey.security.unassessed).toBe(true);
    expect(byKey.backups.unassessed).toBe(true);
  });

  test("treats a genuine zero as assessed when the evidence exists", () => {
    const tiles = fleetTiles({ plugin_updates: 0, assessed: { plugins: true, security: true, backups: true } });
    expect(tiles.find((tile) => tile.key === "updates").unassessed).toBe(false);
    expect(tiles.find((tile) => tile.key === "backups").subtitle).toContain("current backup evidence");
  });
});

describe("Web Studio attention queue", () => {
  test("orders critical sites before attention sites and attaches the site record", () => {
    const sites = [{ id: "a", name: "Acme" }, { id: "b", name: "Retail" }];
    const queue = attentionQueue(
      {
        attention_sites: [
          { site_id: "b", level: "attention", reasons: ["2 plugin updates available"] },
          { site_id: "a", level: "critical", reasons: ["Website did not respond"] },
        ],
      },
      sites,
    );
    expect(queue.map((entry) => entry.site_id)).toEqual(["a", "b"]);
    expect(queue[0].site.name).toBe("Acme");
    expect(queue[0].tone.label).toBe("Critical");
  });

  test("falls back to a healthy tone for an unknown level", () => {
    expect(attentionTone("something-new").label).toBe("Healthy");
  });
});

describe("Web Studio plugin intelligence", () => {
  test("sorts by findings, then sites with updates, then name", () => {
    const rows = pluginRows([
      { plugin: "b", name: "Bravo", security_findings: 0, sites_with_updates: 1 },
      { plugin: "a", name: "Alpha", security_findings: 2, sites_with_updates: 0 },
      { plugin: "c", name: "Charlie", security_findings: 0, sites_with_updates: 3 },
    ]);
    expect(rows.map((row) => row.plugin)).toEqual(["a", "c", "b"]);
  });

  test("only counts sites as vulnerable when a finding is recorded", () => {
    expect(vulnerableSiteCount({ security_findings: 0, sites_installed: 5 })).toBe(0);
    expect(vulnerableSiteCount({ security_findings: 1, sites_installed: 5 })).toBe(5);
  });

  test("builds a plan item straight from an inventory row", () => {
    const item = updatePlanItem({
      plugin: "akismet/akismet.php",
      name: "Akismet",
      version: "5.3",
      new_version: "5.3.1",
      requires_php: "7.2",
      security_findings: 1,
    });
    expect(item).toEqual({
      kind: "plugin",
      plugin: "akismet/akismet.php",
      name: "Akismet",
      from_version: "5.3",
      to_version: "5.3.1",
      requires_php: "7.2",
      security_findings: 1,
    });
  });
});

describe("Safe Update Engine copy", () => {
  test("never frames a blocked preflight as ready", () => {
    const summary = preflightSummary({
      allowed: false,
      checks: [
        { key: "connection", state: "pass", detail: "linked" },
        { key: "backup", state: "block", detail: "No backup evidence is recorded for this website" },
      ],
    });
    expect(summary.passed).toBe(false);
    expect(summary.headline).toContain("1 check");
    expect(summary.detail).toContain("No backup evidence");
  });

  test("reports a passed preflight only when every check passes", () => {
    const summary = preflightSummary({
      allowed: true,
      checks: [{ key: "backup", state: "pass", detail: "ok" }],
    });
    expect(summary.passed).toBe(true);
    expect(summary.blockers).toEqual([]);
  });

  test("labels plan states, risk and policy for technicians", () => {
    expect(planStatusLabel("awaiting_worker")).toBe("Awaiting control worker");
    expect(planStatusLabel("preflight_failed")).toBe("Preflight Failed");
    expect(planStatusTone("preflight_failed")).toContain("rose");
    expect(planStatusTone("completed")).toContain("emerald");
    expect(riskTone("high")).toContain("rose");
    expect(riskTone("low")).toContain("emerald");
    expect(policyLabel("policy_driven")).toBe("Policy-driven");
    expect(policyLabel(undefined)).toBe("Manual");
  });

  test("an unevaluated preflight is not treated as passing", () => {
    expect(preflightSummary({}).passed).toBe(false);
  });
});
