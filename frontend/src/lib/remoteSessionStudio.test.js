import {
  DEFAULT_PREFERENCES,
  applyPreset,
  deriveSessionChapters,
  deriveSuggestions,
  maturityLabel,
  normalisePreferences,
  orderQuickActions,
  riskTone,
  sessionDurationMinutes,
  sessionTimeline,
  suggestSessionLabour,
} from "./remoteSessionStudio";

describe("remote session studio policy", () => {
  test("normalisePreferences whitelists and clamps unknown input", () => {
    const cleaned = normalisePreferences({
      preset: "pro",
      panels: { evidence: false, files: true, timeline: true, injected: true },
      density: "compact",
      default_mode: "control",
      default_display: "primary",
      quick_actions: ["full_screen", "full_screen", "nonsense", "fit"],
      unexpected: "dropped",
    });
    expect(cleaned.preset).toBe("pro");
    expect(cleaned.panels).toEqual({ evidence: false, files: true, timeline: true });
    expect(cleaned.default_mode).toBe("control");
    expect(cleaned.quick_actions).toEqual(["full_screen", "fit"]);
    expect(cleaned).not.toHaveProperty("unexpected");

    expect(normalisePreferences({ preset: "nope", density: "nope" })).toEqual(DEFAULT_PREFERENCES);
  });

  test("applyPreset carries the preset's panels and defaults", () => {
    const compact = applyPreset(DEFAULT_PREFERENCES, "compact");
    expect(compact.preset).toBe("compact");
    expect(compact.panels).toEqual({ evidence: false, files: true, timeline: false });
    expect(compact.default_display).toBe("primary");
    expect(applyPreset(DEFAULT_PREFERENCES, "missing")).toEqual(DEFAULT_PREFERENCES);
  });

  test("orderQuickActions adapts by usage with a stable catalogue tiebreak", () => {
    expect(orderQuickActions(["fit", "file_send", "zoom_in", "fit", "unknown"], { fit: 3, file_send: 9 }))
      .toEqual(["file_send", "fit", "zoom_in"]);
  });

  test("maturity and suggestions are bounded and evidence-based", () => {
    expect(maturityLabel(0).level).toBe("learning");
    expect(maturityLabel(12).level).toBe("adapting");
    expect(maturityLabel(60).level).toBe("tuned");

    const suggestions = deriveSuggestions(
      { file_browse: 3, file_send: 3, display_focus: 4, start_control: 3, start_view: 1 },
      { events: 14 },
    );
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.length).toBeLessThanOrEqual(4);
    expect(suggestions.map((item) => item.action)).toEqual(
      expect.arrayContaining(["pin_files"]),
    );
    suggestions.forEach((item) => expect(item.text).toBeTruthy());
  });
});

describe("remote session journal derivations", () => {
  const session = {
    started_at: "2026-10-06T09:00:00+00:00",
    consent_confirmed_at: "2026-10-06T09:00:30+00:00",
    companion_acknowledged_at: "2026-10-06T09:01:00+00:00",
    transport_reported_at: "2026-10-06T09:01:30+00:00",
    last_heartbeat_at: "2026-10-06T09:05:00+00:00",
    ended_at: "2026-10-06T09:12:00+00:00",
  };

  test("sessionTimeline orders recorded evidence and drops duplicates", () => {
    const timeline = sessionTimeline({
      started_at: "2026-10-06T09:00:00+00:00",
      consent_confirmed_at: "2026-10-06T09:00:30+00:00",
      ended_at: "2026-10-06T09:12:00+00:00",
    });
    expect(timeline.map(([label]) => label)).toEqual(["Authorised", "Consent recorded", "Session closed"]);
    expect(sessionTimeline(null)).toEqual([]);
    expect(sessionTimeline({})).toEqual([]);
  });

  test("deriveSessionChapters reports ordered chapters with offsets from the start", () => {
    const chapters = deriveSessionChapters(session);
    expect(chapters.map((chapter) => chapter.key)).toEqual(["connect", "consent", "companion", "transport", "capture", "close"]);
    expect(chapters[0].offset_seconds).toBe(0);
    expect(chapters[1].offset_seconds).toBe(30);
    expect(chapters.at(-1).offset_seconds).toBe(720);
    chapters.forEach((chapter) => {
      expect(chapter.title).toBeTruthy();
      expect(chapter.detail).toBeTruthy();
    });
  });

  test("deriveSessionChapters never invents an event the record did not record", () => {
    expect(deriveSessionChapters({ started_at: "2026-10-06T09:00:00+00:00" })).toHaveLength(1);
    expect(deriveSessionChapters(null)).toEqual([]);
  });

  test("sessionDurationMinutes reads recorded start and end", () => {
    expect(sessionDurationMinutes(session)).toBe(12);
    expect(sessionDurationMinutes({ started_at: "not-a-date" })).toBeNull();
    expect(sessionDurationMinutes(null)).toBeNull();
  });

  test("sessionDurationMinutes uses the supplied clock for a live session", () => {
    const live = { started_at: "2026-10-06T09:00:00+00:00", ended_at: null };
    expect(sessionDurationMinutes(live, Date.parse("2026-10-06T09:31:48+00:00"))).toBe(31);
  });

  test("suggestSessionLabour rounds up to the next five minutes and reports its basis", () => {
    const suggestion = suggestSessionLabour(session);
    expect(suggestion).toEqual({
      minutes: 15,
      recorded_minutes: 12,
      rationale: "Recorded session time 12 min, rounded up to the next five minutes.",
    });
  });

  test("suggestSessionLabour refuses to suggest time for an empty or unstarted session", () => {
    expect(suggestSessionLabour(null)).toBeNull();
    expect(suggestSessionLabour({ started_at: "bad" })).toBeNull();
    expect(suggestSessionLabour({ started_at: "2026-10-06T09:00:00+00:00", ended_at: "2026-10-06T08:00:00+00:00" })).toBeNull();
  });

  test("riskTone maps every server band and falls back safely", () => {
    ["low", "medium", "elevated", "high"].forEach((band) => {
      expect(riskTone(band)).toBeTruthy();
    });
    expect(riskTone(undefined)).toContain("border-border");
    expect(riskTone("not_native")).toContain("border-border");
  });
});
