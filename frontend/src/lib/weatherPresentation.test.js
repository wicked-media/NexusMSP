import {
  displayTemperature,
  formatWeatherFreshness,
  getWeatherMotionKind,
} from "./weatherPresentation";

describe("weather presentation helpers", () => {
  test("selects calm, condition-specific motion", () => {
    expect(getWeatherMotionKind("clear")).toBe("clear");
    expect(getWeatherMotionKind("partly-cloudy")).toBe("cloud");
    expect(getWeatherMotionKind("rain")).toBe("precipitation");
    expect(getWeatherMotionKind("storm")).toBe("storm");
    expect(getWeatherMotionKind("unexpected")).toBe("cloud");
  });

  test("reports truthful freshness without inventing a timestamp", () => {
    const now = new Date("2026-08-29T12:30:00.000Z");
    expect(formatWeatherFreshness("2026-08-29T12:29:45.000Z", now)).toBe("Updated just now");
    expect(formatWeatherFreshness("2026-08-29T12:18:00.000Z", now)).toBe("Updated 12m ago");
    expect(formatWeatherFreshness("2026-08-29T09:15:00.000Z", now)).toBe("Updated 3h ago");
    expect(formatWeatherFreshness(undefined, now)).toBe("Live conditions");
    expect(formatWeatherFreshness(null, now)).toBe("Live conditions");
  });

  test("formats usable temperatures and preserves missing values", () => {
    expect(displayTemperature(9.6)).toBe(10);
    expect(displayTemperature("0")).toBe(0);
    expect(displayTemperature(null)).toBe("--");
  });
});
