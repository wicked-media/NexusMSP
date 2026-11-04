import { buildEstateStatus } from "./estateStatus";

describe("estate status presentation", () => {
  test("uses the Mission Control label and bounded score", () => {
    expect(buildEstateStatus({ health_score: 85, health_label: "Stable" })).toEqual({
      label: "Stable",
      score: 85,
      tone: "stable",
      detail: "Stable · 85",
    });
    expect(buildEstateStatus({ health_score: 140, health_label: "Healthy" }).score).toBe(100);
  });

  test("derives safe labels when the API omits one", () => {
    expect(buildEstateStatus({ health_score: 91 }).detail).toBe("Healthy · 91");
    expect(buildEstateStatus({ health_score: 62 }).detail).toBe("At risk · 62");
    expect(buildEstateStatus({ health_score: 35 }).detail).toBe("Critical · 35");
  });

  test("keeps loading and unavailable states explicit", () => {
    expect(buildEstateStatus(null, "loading").detail).toBe("Checking");
    expect(buildEstateStatus(null, "unavailable").detail).toBe("Unavailable");
    expect(buildEstateStatus({ health_score: null }).detail).toBe("Unavailable");
    expect(buildEstateStatus({ health_score: "not-a-score" }).detail).toBe("Unavailable");
  });
});
