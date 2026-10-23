import { buildRemoteTelemetrySnapshot, telemetryTone } from "./remoteTelemetry";

describe("remote telemetry snapshot", () => {
  test("uses the latest performance sample and reports its age", () => {
    const snapshot = buildRemoteTelemetrySnapshot({
      device: { cpu_usage: 5, memory_usage: 6, disk_usage: 7 },
      performance: [{ cpu: 92.2, memory: 81.7, disk: 96.1, timestamp: "2026-10-16T00:00:00.000Z" }],
      now: Date.parse("2026-10-16T00:03:30.000Z"),
    });

    expect(snapshot).toMatchObject({ cpu: 92, memory: 82, disk: 96, ageMinutes: 4 });
  });

  test("falls back to the scoped device record when no history exists", () => {
    const snapshot = buildRemoteTelemetrySnapshot({
      device: { cpu_usage: 37.4, memory_usage: 48.6, disk_usage: 73.2, last_seen: "2026-10-16T00:00:00.000Z" },
      now: Date.parse("2026-10-16T00:01:00.000Z"),
    });

    expect(snapshot).toMatchObject({ cpu: 37, memory: 49, disk: 73, ageMinutes: 1 });
  });

  test("keeps unavailable telemetry distinct and applies metric-specific thresholds", () => {
    expect(buildRemoteTelemetrySnapshot({ device: {} }).cpu).toBeNull();
    expect(telemetryTone("cpu", 90)).toBe("rose");
    expect(telemetryTone("memory", 75)).toBe("amber");
    expect(telemetryTone("disk", 90)).toBe("amber");
    expect(telemetryTone("disk", null)).toBe("muted");
  });
});
