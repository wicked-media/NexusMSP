"""Nexus Remote Session Studio policy.

The Session Studio is what makes Nexus Remote adapt to the technician using it.
This module holds the pure policy behind that adaptation: the fixed preset
catalogue, the bounded tool vocabulary, the adaptive quick-action ordering, and
the suggestion rules derived from recorded usage.  Nothing here touches the
database or the network so the policy stays trivially testable, and the same
rules are mirrored by the viewer's client-side helper library.
"""

from __future__ import annotations

from typing import Any

# The fixed vocabulary of studio-aware viewer tools.  Usage events outside this
# set are rejected so the adaptive layer can never be trained on arbitrary text.
REMOTE_TOOLS: tuple[str, ...] = (
    "start_view",
    "start_control",
    "display_all",
    "display_focus",
    "zoom_in",
    "zoom_out",
    "fit",
    "focus_desktop",
    "show_evidence",
    "full_screen",
    "pop_out",
    "file_browse",
    "file_retrieve",
    "file_send",
    "end_session",
)

STUDIO_PRESETS: dict[str, dict[str, Any]] = {
    "standard": {
        "label": "Standard",
        "detail": "Balanced session window with evidence, files and timeline visible.",
        "panels": {"evidence": True, "files": True, "timeline": True},
        "density": "comfortable",
        "default_display": "all",
    },
    "compact": {
        "label": "Compact",
        "detail": "Tighter chrome and one-display focus for quick fixes on small screens.",
        "panels": {"evidence": False, "files": True, "timeline": False},
        "density": "compact",
        "default_display": "primary",
    },
    "pro": {
        "label": "Pro",
        "detail": "Everything on with dense spacing for multi-session days.",
        "panels": {"evidence": True, "files": True, "timeline": True},
        "density": "compact",
        "default_display": "all",
    },
    "focus": {
        "label": "Focus",
        "detail": "Desktop-first: the sidebar is hidden until you ask for evidence.",
        "panels": {"evidence": False, "files": False, "timeline": False},
        "density": "comfortable",
        "default_display": "all",
    },
}

PANEL_KEYS: tuple[str, ...] = ("evidence", "files", "timeline")
DENSITY_VALUES: tuple[str, ...] = ("comfortable", "compact")
DEFAULT_MODES: tuple[str, ...] = ("view", "control")
DEFAULT_DISPLAYS: tuple[str, ...] = ("all", "primary")

DEFAULT_PREFERENCES: dict[str, Any] = {
    "preset": "standard",
    "panels": {"evidence": True, "files": True, "timeline": True},
    "density": "comfortable",
    "default_mode": "view",
    "default_display": "all",
    "quick_actions": [],
}


def normalise_preferences(payload: dict[str, Any] | None) -> dict[str, Any]:
    """Return a whitelisted, clamped preferences document.

    Unknown keys are dropped rather than stored so a client can never poison
    another technician's studio with unexpected fields.
    """
    data = dict(payload or {})
    preset = str(data.get("preset") or "").strip().lower()
    if preset not in STUDIO_PRESETS:
        preset = DEFAULT_PREFERENCES["preset"]

    panels = dict(DEFAULT_PREFERENCES["panels"])
    for key, value in dict(data.get("panels") or {}).items():
        if key in PANEL_KEYS:
            panels[key] = bool(value)

    density = str(data.get("density") or "").strip().lower()
    if density not in DENSITY_VALUES:
        density = DEFAULT_PREFERENCES["density"]

    default_mode = str(data.get("default_mode") or "").strip().lower()
    if default_mode not in DEFAULT_MODES:
        default_mode = DEFAULT_PREFERENCES["default_mode"]

    default_display = str(data.get("default_display") or "").strip().lower()
    if default_display not in DEFAULT_DISPLAYS:
        default_display = DEFAULT_PREFERENCES["default_display"]

    quick_actions = []
    for tool in data.get("quick_actions") or []:
        tool_name = str(tool or "").strip().lower()
        if tool_name in REMOTE_TOOLS and tool_name not in quick_actions:
            quick_actions.append(tool_name)
        if len(quick_actions) >= len(REMOTE_TOOLS):
            break

    return {
        "preset": preset,
        "panels": panels,
        "density": density,
        "default_mode": default_mode,
        "default_display": default_display,
        "quick_actions": quick_actions,
    }


def order_quick_actions(tools: list[str], usage_counts: dict[str, int]) -> list[str]:
    """Order studio tools adaptively: most-used first, catalogue order to tie.

    The ordering is deterministic and explainable — never a black box — so a
    technician can always understand why their toolbar moved.
    """
    catalogue_order = {tool: index for index, tool in enumerate(REMOTE_TOOLS)}
    seen: set[str] = set()
    unique_tools: list[str] = []
    for tool in tools:
        name = str(tool or "").strip().lower()
        if name in catalogue_order and name not in seen:
            seen.add(name)
            unique_tools.append(name)
    return sorted(
        unique_tools,
        key=lambda tool: (-(usage_counts.get(tool) or 0), catalogue_order[tool]),
    )


def maturity_label(event_total: int) -> dict[str, str]:
    """Describe how much the studio has learned from this technician."""
    if event_total >= 50:
        return {
            "level": "tuned",
            "label": "Tuned to you",
            "detail": "The studio has enough session evidence to keep your tools where you expect them.",
        }
    if event_total >= 10:
        return {
            "level": "adapting",
            "label": "Adapting",
            "detail": "The studio is reordering your session tools around the work you actually do.",
        }
    return {
        "level": "learning",
        "label": "Learning",
        "detail": "The studio starts in catalogue order and adapts as it records real session work.",
    }


def derive_suggestions(usage_counts: dict[str, int], totals: dict[str, int]) -> list[dict[str, str]]:
    """Derive bounded, evidence-based adaptation suggestions.

    Every suggestion cites the counts that produced it.  Nothing here guesses at
    intent beyond the recorded tool usage itself.
    """
    suggestions: list[dict[str, str]] = []
    counts = {tool: int(usage_counts.get(tool) or 0) for tool in REMOTE_TOOLS}
    file_moves = counts["file_browse"] + counts["file_retrieve"] + counts["file_send"]
    display_focus = counts["display_focus"]
    display_all = counts["display_all"]

    if file_moves >= 5:
        suggestions.append({
            "id": "pin-files",
            "text": f"You used the Files panel {file_moves} times — keep it pinned even in Focus preset.",
            "action": "pin_files",
        })
    if display_focus > display_all and display_focus >= 3:
        suggestions.append({
            "id": "default-primary",
            "text": f"You focused a single display {display_focus} times — default new sessions to one display.",
            "action": "default_primary",
        })
    if counts["start_control"] + counts["start_view"] >= 5 and counts["start_control"] > counts["start_view"]:
        suggestions.append({
            "id": "default-control",
            "text": "Most of your sessions are interactive — default the authorise dialog to Control.",
            "action": "default_control",
        })
    if counts["full_screen"] >= 5:
        suggestions.append({
            "id": "auto-fullscreen",
            "text": f"You go full screen often ({counts['full_screen']} times) — offer it as the first viewer action.",
            "action": "promote_fullscreen",
        })
    if not suggestions and int(totals.get("events") or 0) > 0:
        suggestions.append({
            "id": "keep-going",
            "text": "No strong habits yet — the studio keeps learning from every session action.",
            "action": "none",
        })
    return suggestions[:4]
