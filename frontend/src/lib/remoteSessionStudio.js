/**
 * Nexus Remote Session Studio — client-side policy.
 *
 * Mirrors the server policy in backend/app/services/remote_studio.py so the
 * viewer can react instantly while the API remains the source of truth. The
 * adaptation is deliberately explainable: tools reorder by recorded usage with
 * the catalogue order as a stable tiebreak, and every suggestion cites the
 * counts that produced it.
 */

export const STUDIO_PRESETS = {
  standard: {
    label: "Standard",
    detail: "Balanced session window with evidence, files and timeline visible.",
    panels: { evidence: true, files: true, timeline: true },
    density: "comfortable",
    defaultDisplay: "all",
  },
  compact: {
    label: "Compact",
    detail: "Tighter chrome and one-display focus for quick fixes on small screens.",
    panels: { evidence: false, files: true, timeline: false },
    density: "compact",
    defaultDisplay: "primary",
  },
  pro: {
    label: "Pro",
    detail: "Everything on with dense spacing for multi-session days.",
    panels: { evidence: true, files: true, timeline: true },
    density: "compact",
    defaultDisplay: "all",
  },
  focus: {
    label: "Focus",
    detail: "Desktop-first: the sidebar is hidden until you ask for evidence.",
    panels: { evidence: false, files: false, timeline: false },
    density: "comfortable",
    defaultDisplay: "all",
  },
};

export const STUDIO_TOOLS = [
  "start_view", "start_control", "display_all", "display_focus",
  "zoom_in", "zoom_out", "fit", "focus_desktop", "show_evidence",
  "full_screen", "pop_out", "file_browse", "file_retrieve", "file_send",
  "end_session",
];

export const TOOL_LABELS = {
  start_view: "Start view-only",
  start_control: "Start control",
  display_all: "All displays",
  display_focus: "Focus a display",
  zoom_in: "Zoom in",
  zoom_out: "Zoom out",
  fit: "Fit",
  focus_desktop: "Focus desktop",
  show_evidence: "Show evidence",
  full_screen: "Full screen",
  pop_out: "Pop out",
  file_browse: "Browse files",
  file_retrieve: "Retrieve file",
  file_send: "Send file",
  end_session: "End session",
};

export const DEFAULT_PREFERENCES = {
  preset: "standard",
  panels: { evidence: true, files: true, timeline: true },
  density: "comfortable",
  default_mode: "view",
  default_display: "all",
  quick_actions: [],
};

export function normalisePreferences(payload) {
  const data = payload || {};
  const preset = Object.prototype.hasOwnProperty.call(STUDIO_PRESETS, data.preset) ? data.preset : DEFAULT_PREFERENCES.preset;
  const panels = { ...DEFAULT_PREFERENCES.panels };
  Object.entries(data.panels || {}).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(panels, key)) panels[key] = Boolean(value);
  });
  const density = ["comfortable", "compact"].includes(data.density) ? data.density : DEFAULT_PREFERENCES.density;
  const defaultMode = ["view", "control"].includes(data.default_mode) ? data.default_mode : DEFAULT_PREFERENCES.default_mode;
  const defaultDisplay = ["all", "primary"].includes(data.default_display) ? data.default_display : DEFAULT_PREFERENCES.default_display;
  const quickActions = [];
  (data.quick_actions || []).forEach((tool) => {
    const name = String(tool || "").trim().toLowerCase();
    if (STUDIO_TOOLS.includes(name) && !quickActions.includes(name)) quickActions.push(name);
  });
  return {
    preset,
    panels,
    density,
    default_mode: defaultMode,
    default_display: defaultDisplay,
    quick_actions: quickActions.slice(0, STUDIO_TOOLS.length),
  };
}

export function applyPreset(preferences, presetKey) {
  const preset = STUDIO_PRESETS[presetKey];
  if (!preset) return normalisePreferences(preferences);
  return normalisePreferences({
    ...preferences,
    preset: presetKey,
    panels: { ...preset.panels },
    density: preset.density,
    default_display: preset.defaultDisplay,
  });
}

export function orderQuickActions(tools, usageCounts = {}) {
  const catalogueOrder = new Map(STUDIO_TOOLS.map((tool, index) => [tool, index]));
  const seen = new Set();
  const unique = [];
  (tools || []).forEach((tool) => {
    const name = String(tool || "").trim().toLowerCase();
    if (catalogueOrder.has(name) && !seen.has(name)) {
      seen.add(name);
      unique.push(name);
    }
  });
  return unique.sort((left, right) => {
    const usage = (usageCounts[right] || 0) - (usageCounts[left] || 0);
    return usage !== 0 ? usage : catalogueOrder.get(left) - catalogueOrder.get(right);
  });
}

export function maturityLabel(eventTotal = 0) {
  if (eventTotal >= 50) {
    return { level: "tuned", label: "Tuned to you", detail: "The studio has enough session evidence to keep your tools where you expect them." };
  }
  if (eventTotal >= 10) {
    return { level: "adapting", label: "Adapting", detail: "The studio is reordering your session tools around the work you actually do." };
  }
  return { level: "learning", label: "Learning", detail: "The studio starts in catalogue order and adapts as it records real session work." };
}

export function deriveSuggestions(usageCounts = {}, totals = {}) {
  const counts = {};
  STUDIO_TOOLS.forEach((tool) => { counts[tool] = Number(usageCounts[tool] || 0); });
  const suggestions = [];
  const fileMoves = counts.file_browse + counts.file_retrieve + counts.file_send;

  if (fileMoves >= 5) {
    suggestions.push({ id: "pin-files", text: `You used the Files panel ${fileMoves} times — keep it pinned even in Focus preset.`, action: "pin_files" });
  }
  if (counts.display_focus > counts.display_all && counts.display_focus >= 3) {
    suggestions.push({ id: "default-primary", text: `You focused a single display ${counts.display_focus} times — default new sessions to one display.`, action: "default_primary" });
  }
  if (counts.start_control + counts.start_view >= 5 && counts.start_control > counts.start_view) {
    suggestions.push({ id: "default-control", text: "Most of your sessions are interactive — default the authorise dialog to Control.", action: "default_control" });
  }
  if (counts.full_screen >= 5) {
    suggestions.push({ id: "auto-fullscreen", text: `You go full screen often (${counts.full_screen} times) — offer it as the first viewer action.`, action: "promote_fullscreen" });
  }
  if (!suggestions.length && Number(totals.events || 0) > 0) {
    suggestions.push({ id: "keep-going", text: "No strong habits yet — the studio keeps learning from every session action.", action: "none" });
  }
  return suggestions.slice(0, 4);
}

/* ─────────────────────────────────────────────────────────────
   Session evidence derivations.

   These read the governed session record and label what it already proved.
   They never infer desktop content, credentials or endpoint paths, and they
   never invent an event the record did not record.
   ───────────────────────────────────────────────────────────── */

/** Ordered, de-duplicated evidence timeline for one session. */
export function sessionTimeline(session) {
  const events = [
    ["Authorised", session?.started_at],
    ["Consent recorded", session?.consent_confirmed_at],
    ["Companion acknowledged", session?.companion_acknowledged_at],
    ["Latest input queued", session?.last_control_input_queued_at],
    ["Endpoint acknowledged input", session?.last_control_input_acknowledged_at],
    ["Transport reported", session?.transport_reported_at],
    ["Companion disconnected", session?.last_transport_disconnect_at],
    ["Latest protected capture", session?.last_heartbeat_at],
    ["Session closed", session?.ended_at],
  ].filter(([, at]) => at);
  return events
    .filter(([label, at], index) => !events.slice(0, index).some(([priorLabel, priorAt]) => priorLabel === label && priorAt === at))
    .sort(([, first], [, second]) => Date.parse(first) - Date.parse(second));
}

const CHAPTERS = {
  Authorised: { key: "connect", title: "Connect", detail: "A short-lived grant was issued for this endpoint." },
  "Consent recorded": { key: "consent", title: "Customer consent", detail: "Attended consent was recorded before capture began." },
  "Companion acknowledged": { key: "companion", title: "Endpoint accepted", detail: "The endpoint companion verified and accepted the grant." },
  "Transport reported": { key: "transport", title: "Transport", detail: "The secure relay reported an authenticated transport." },
  "Latest input queued": { key: "input", title: "Interactive input", detail: "Bounded control input was queued for the endpoint." },
  "Endpoint acknowledged input": { key: "input_ack", title: "Input acknowledged", detail: "The endpoint acknowledged the latest control input." },
  "Companion disconnected": { key: "disconnect", title: "Disconnected", detail: "The endpoint companion reported a disconnect." },
  "Latest protected capture": { key: "capture", title: "Protected capture", detail: "The endpoint sent a fresh protected capture." },
  "Session closed": { key: "close", title: "Session closed", detail: "The session ended and its grant was revoked." },
};

/**
 * Session chapters: the recorded evidence framed as an ordered work journal with
 * an offset from the start of the session, so a 40-minute session reads as
 * chapters rather than a wall of timestamps.
 */
export function deriveSessionChapters(session) {
  const startedAt = Date.parse(session?.started_at || "");
  return sessionTimeline(session).map(([label, at], index) => {
    const parsed = Date.parse(at);
    const meta = CHAPTERS[label] || { key: `step_${index}`, title: label, detail: "Recorded session evidence." };
    return {
      ...meta,
      label,
      at,
      offset_seconds: Number.isFinite(startedAt) && Number.isFinite(parsed) ? Math.max(0, Math.round((parsed - startedAt) / 1000)) : null,
    };
  });
}

/** Whole minutes a session has run, from its recorded start and end. */
export function sessionDurationMinutes(session, now = Date.now()) {
  const startedAt = Date.parse(session?.started_at || "");
  if (!Number.isFinite(startedAt)) return null;
  const endedAt = Date.parse(session?.ended_at || "");
  const finish = Number.isFinite(endedAt) ? endedAt : now;
  return Math.max(0, Math.floor((finish - startedAt) / 60000));
}

/**
 * Suggested ticket labour for a session. The suggestion is rounded UP to the
 * next five minutes and capped, and always reports the recorded minutes it came
 * from so a technician confirms a number rather than accepting a mystery.
 */
export function suggestSessionLabour(session, now = Date.now()) {
  const recorded = sessionDurationMinutes(session, now);
  if (recorded === null || recorded <= 0) return null;
  const minutes = Math.min(480, recorded < 2 ? 1 : Math.ceil(recorded / 5) * 5);
  return {
    minutes,
    recorded_minutes: recorded,
    rationale: `Recorded session time ${recorded} min, rounded up to the next five minutes.`,
  };
}

/** Tailwind tone classes for a server-reported session risk band. */
export function riskTone(band) {
  return {
    low: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    medium: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    elevated: "border-orange-400/30 bg-orange-400/10 text-orange-200",
    high: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  }[band] || "border-border/60 text-muted-foreground";
}
