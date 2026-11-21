import fs from "fs";
import path from "path";
import {
  CLIENT_HEALTH_BANDS,
  CLIENT_HEALTH_BAND_FLOORS,
  CLIENT_HEALTH_FILTER_OPTIONS,
  healthBand,
  healthBandByKey,
  resolveClientHealthBand,
} from "./clientHealthBands";

describe("client health bands", () => {
  test("bands a score on the engine's own boundaries", () => {
    expect(healthBand(100).key).toBe("thriving");
    expect(healthBand(85).key).toBe("thriving");
    expect(healthBand(84).key).toBe("healthy");
    expect(healthBand(70).key).toBe("healthy");
    expect(healthBand(69).key).toBe("needs_attention");
    expect(healthBand(50).key).toBe("needs_attention");
    expect(healthBand(49).key).toBe("at_risk");
    expect(healthBand(30).key).toBe("at_risk");
    expect(healthBand(29).key).toBe("critical");
    expect(healthBand(1).key).toBe("critical");
  });

  test("treats a zero or malformed score honestly instead of assuming the best", () => {
    expect(healthBand(0).key).toBe("critical");
    expect(healthBand("0").key).toBe("critical");
    expect(healthBand(null)).toBeNull();
    expect(healthBand(undefined)).toBeNull();
    expect(healthBand("")).toBeNull();
    expect(healthBand("not scored")).toBeNull();
    expect(healthBand(true)).toBeNull();
  });

  test("labels every directory filter from its band floor", () => {
    expect(CLIENT_HEALTH_FILTER_OPTIONS[0]).toEqual({ value: "all", label: "All health" });
    expect(CLIENT_HEALTH_FILTER_OPTIONS.map((option) => option.label)).toEqual([
      "All health",
      `Thriving ${CLIENT_HEALTH_BAND_FLOORS.thriving}+`,
      `Healthy ${CLIENT_HEALTH_BAND_FLOORS.healthy}+`,
      `Needs attention ${CLIENT_HEALTH_BAND_FLOORS.needs_attention}+`,
      `At risk ${CLIENT_HEALTH_BAND_FLOORS.at_risk}+`,
      "Critical",
    ]);
    // The directory used to offer "Healthy 85+" while the engine started the
    // healthy band at 70, so genuinely healthy accounts matched nothing.
    expect(CLIENT_HEALTH_FILTER_OPTIONS.some((option) => option.label.includes("85+") && option.value === "healthy")).toBe(false);
  });

  test("prefers the band Nexus served and normalises stored spellings", () => {
    expect(resolveClientHealthBand({ risk_level: "at_risk", health_score: 90 }).key).toBe("at_risk");
    expect(resolveClientHealthBand({ risk_level: "at-risk" }).key).toBe("at_risk");
    expect(resolveClientHealthBand({ risk_level: "AT RISK" }).key).toBe("at_risk");
    expect(resolveClientHealthBand({ risk_level: "needs_attention" }).key).toBe("needs_attention");
    expect(resolveClientHealthBand({ risk_level: "attention" }).key).toBe("needs_attention");
    expect(resolveClientHealthBand({ riskLevel: "thriving" }).key).toBe("thriving");
    expect(resolveClientHealthBand({ riskLevel: "critical" }).key).toBe("critical");
    expect(resolveClientHealthBand({ health_score: 80 }).key).toBe("healthy");
    expect(resolveClientHealthBand({ healthScore: 40 }).key).toBe("at_risk");
    expect(resolveClientHealthBand({ health_score: 0 }).key).toBe("critical");
    expect(resolveClientHealthBand({})).toBeNull();
    expect(resolveClientHealthBand(null)).toBeNull();
  });

  test("exposes each band once with a descending floor", () => {
    const keys = CLIENT_HEALTH_BANDS.map((band) => band.key);
    expect(new Set(keys).size).toBe(keys.length);
    const floors = CLIENT_HEALTH_BANDS.map((band) => band.floor);
    expect(floors).toEqual([...floors].sort((left, right) => right - left));
    expect(floors[floors.length - 1]).toBe(0);
    expect(healthBandByKey("nonsense")).toBeNull();
  });

  test("floors still match the one backend health scale", () => {
    const policySource = fs.readFileSync(
      path.join(__dirname, "../../../backend/app/services/client_health_policy.py"),
      "utf8",
    );
    const block = policySource.match(/HEALTH_BANDS = \(([\s\S]*?)\n\)/);
    expect(block).not.toBeNull();

    const backendBands = [...block[1].matchAll(/\("([a-z_]+)",\s*(\d+)\)/g)]
      .map(([, key, floor]) => [key, Number(floor)]);

    expect(backendBands).toEqual(
      CLIENT_HEALTH_BANDS.map((band) => [band.key, band.floor]),
    );
    backendBands.forEach(([key, floor]) => {
      expect(CLIENT_HEALTH_BAND_FLOORS[key]).toBe(floor);
    });
  });
});
