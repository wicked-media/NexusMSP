import {
  buildClientAttentionQueue,
  getClientAttentionReasons,
} from "./clientPortfolioAttention";

describe("client portfolio attention helpers", () => {
  test("ranks a critical service risk ahead of ordinary patch exposure", () => {
    const queue = buildClientAttentionQueue([
      { id: "patches", name: "Patch Co", patch_pending: 4 },
      { id: "critical", name: "Critical Co", risk_level: "critical", open_tickets: 12 },
    ]);

    expect(queue.map((entry) => entry.client.id)).toEqual(["critical", "patches"]);
    expect(queue[0].severity).toBe("critical");
    expect(queue[0].reasons.map((reason) => reason.id)).toContain("critical-risk");
  });

  test("shows concise, labelled operational evidence without inventing missing health data", () => {
    const reasons = getClientAttentionReasons({
      id: "service", name: "Service Co", patch_pending: 2, open_tickets: 11,
    });

    expect(reasons.map((reason) => reason.label)).toEqual(expect.arrayContaining([
      "Patch exposure",
      "Service volume",
    ]));
    expect(reasons.some((reason) => reason.label.startsWith("Health"))).toBe(false);
  });

  test("keeps evidence gaps visible, and respects a caller-provided queue limit", () => {
    const queue = buildClientAttentionQueue([
      { id: "agent-gap", name: "Agent Gap", asset_count: 3, assets_assessed: 0 },
      { id: "health", name: "Health Gap", health_score: 55 },
    ], { limit: 1 });

    expect(queue).toHaveLength(1);
    expect(queue[0].client.id).toBe("health");
    expect(getClientAttentionReasons({ asset_count: 3, assets_assessed: 0 })[0].id).toBe("missing-agent-evidence");
  });
});
