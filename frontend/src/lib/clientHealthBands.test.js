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
    expect(healthBand(100).key).toBe("healthy");
    expect(healthBand(75).key).toBe("healthy");
    expect(healthBand(74).key).toBe("attention");
    expect(healthBand(50).key).toBe("attention");
    expect(healthBand(49).key).toBe("at_risk");
    expect(healthBand(25).key).toBe("at_risk");
    expect(healthBand(24).key).toBe("critical");
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
      `Healthy ${CLIENT_HEALTH_BAND_FLOORS.healthy}+`,
      `Needs attention ${CLIENT_HEALTH_BAND_FLOORS.attention}+`,
      `At risk ${CLIENT_HEALTH_BAND_FLOORS.at_risk}+`,
      "Critical",
    ]);
    // The directory used to offer "Healthy 85+" while the engine started the
    // healthy band at 75, so genuinely healthy accounts matched nothing.
    expect(CLIENT_HEALTH_FILTER_OPTIONS.some((option) => option.label.includes("85"))).toBe(false);
  });

  test("prefers the band Nexus served and normalises stored spellings", () => {
    expect(resolveClientHealthBand({ risk_level: "at_risk", health_score: 90 }).key).toBe("at_risk");
    expect(resolveClientHealthBand({ risk_level: "at-risk" }).key).toBe("at_risk");
    expect(resolveClientHealthBand({ risk_level: "AT RISK" }).key).toBe("at_risk");
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

  test("floors still match the health engine that serves risk_level", () => {
    const engineSource = fs.readFileSync(
      path.join(__dirname, "../../../backend/app/routers/clients.py"),
      "utf8",
    );
    const assignment = engineSource.match(/risk\s*=\s*"healthy"[^\n]*/);
    expect(assignment).not.toBeNull();

    const scored = [...assignment[0].matchAll(/"([a-z_]+)"\s*if\s*total_score\s*>=\s*(\d+)/g)]
      .map(([, key, floor]) => [key, Number(floor)]);
    // The engine chains its bands, so the band that owns every remaining score
    // is the last `else`, not the first.
    const fallbacks = [...assignment[0].matchAll(/else\s+"([a-z_]+)"/g)];
    const fallback = fallbacks[fallbacks.length - 1];

    expect(scored.map(([key]) => key)).toEqual(["healthy", "attention", "at_risk"]);
    scored.forEach(([key, floor]) => {
      expect(CLIENT_HEALTH_BAND_FLOORS[key]).toBe(floor);
    });
    expect(fallback).not.toBeNull();
    expect(fallback[1]).toBe("critical");
    // The fallback band owns every score below the lowest published floor.
    expect(CLIENT_HEALTH_BAND_FLOORS[fallback[1]]).toBe(0);
  });
});
