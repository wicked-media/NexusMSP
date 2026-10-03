import {
  DEFAULT_PREFERENCES,
  applyPreset,
  deriveSuggestions,
  maturityLabel,
  normalisePreferences,
  orderQuickActions,
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
