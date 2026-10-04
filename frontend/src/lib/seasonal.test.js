import { seasonalMode, SEASONAL_COPY } from "./seasonal";

describe("seasonalMode", () => {
  it("returns snow for all of December", () => {
    expect(seasonalMode(new Date(2026, 11, 1))).toBe("snow");
    expect(seasonalMode(new Date(2026, 11, 31))).toBe("snow");
  });

  it("returns bats only in the last week of October", () => {
    expect(seasonalMode(new Date(2026, 9, 25))).toBe("bats");
    expect(seasonalMode(new Date(2026, 9, 31))).toBe("bats");
    expect(seasonalMode(new Date(2026, 9, 24))).toBeNull();
    expect(seasonalMode(new Date(2026, 10, 1))).toBeNull();
  });

  it("returns april only on April Fools' Day", () => {
    expect(seasonalMode(new Date(2026, 3, 1))).toBe("april");
    expect(seasonalMode(new Date(2026, 3, 2))).toBeNull();
  });

  it("returns null outside any window", () => {
    expect(seasonalMode(new Date(2026, 5, 15))).toBeNull();
  });

  it("has copy for every mode", () => {
    for (const mode of ["snow", "bats", "april"]) {
      expect(SEASONAL_COPY[mode]).toBeTruthy();
    }
  });
});
