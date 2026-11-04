"""Canonical achievement badge catalog and pure profile-view policy.

This module owns the achievement badge definitions and the category-to-points
mapping so every surface — the achievements router, the technician profile and
the points economy — renders the *same* badges instead of drifting copies.

All functions here are pure so they can be contract-tested without a database.
"""

from __future__ import annotations

from typing import Any

ACHIEVEMENT_POINTS = {
    "tickets": 100,
    "invoices": 80,
    "remote": 60,
    "workshop": 70,
    "field": 70,
    "onboarding": 90,
    "points": 110,
    "tenure": 150,
    "special": 120,
    "celebration": 50,
    "custom": 75,
}

ACHIEVEMENT_DEFINITIONS = [
    {"id": "first_ticket", "name": "First Resolve", "description": "Closed your first ticket", "icon": "trophy", "category": "tickets", "threshold": 1, "color": "#22c55e"},
    {"id": "ticket_10", "name": "Problem Solver", "description": "Closed 10 tickets", "icon": "target", "category": "tickets", "threshold": 10, "color": "#3b82f6"},
    {"id": "ticket_50", "name": "Resolution Machine", "description": "Closed 50 tickets", "icon": "zap", "category": "tickets", "threshold": 50, "color": "#8b5cf6"},
    {"id": "ticket_100", "name": "Century Club", "description": "Closed 100 tickets", "icon": "award", "category": "tickets", "threshold": 100, "color": "#f59e0b"},
    {"id": "ticket_500", "name": "Legend", "description": "Closed 500 tickets", "icon": "crown", "category": "tickets", "threshold": 500, "color": "#ef4444"},
    {"id": "ticket_1000", "name": "Ticket Titan", "description": "Closed 1,000 tickets", "icon": "gem", "category": "tickets", "threshold": 1000, "color": "#ec4899"},
    {"id": "first_invoice", "name": "Revenue Starter", "description": "Created your first invoice", "icon": "dollar-sign", "category": "invoices", "threshold": 1, "color": "#22c55e"},
    {"id": "invoice_25", "name": "Billing Pro", "description": "Created 25 invoices", "icon": "credit-card", "category": "invoices", "threshold": 25, "color": "#3b82f6"},
    {"id": "invoice_100", "name": "Finance Wizard", "description": "Created 100 invoices", "icon": "banknote", "category": "invoices", "threshold": 100, "color": "#f59e0b"},
    {"id": "remote_10", "name": "Remote Rookie", "description": "Completed 10 remote sessions", "icon": "monitor", "category": "remote", "threshold": 10, "color": "#06b6d4"},
    {"id": "remote_100", "name": "Remote Hero", "description": "Completed 100 remote sessions", "icon": "wifi", "category": "remote", "threshold": 100, "color": "#8b5cf6"},
    {"id": "tenure_1yr", "name": "Year One", "description": "1 year with the company", "icon": "calendar", "category": "tenure", "threshold": 365, "color": "#22c55e"},
    {"id": "tenure_3yr", "name": "Veteran", "description": "3 years with the company", "icon": "shield", "category": "tenure", "threshold": 1095, "color": "#3b82f6"},
    {"id": "tenure_5yr", "name": "Half Decade", "description": "5 years with the company", "icon": "star", "category": "tenure", "threshold": 1825, "color": "#f59e0b"},
    {"id": "tenure_10yr", "name": "Decade Hero", "description": "10 years with the company", "icon": "crown", "category": "tenure", "threshold": 3650, "color": "#ef4444"},
    {"id": "birthday", "name": "Birthday Star", "description": "It's your birthday!", "icon": "cake", "category": "celebration", "threshold": 0, "color": "#ec4899"},
    {"id": "speed_demon", "name": "Speed Demon", "description": "Average ticket resolution under 2 hours", "icon": "rocket", "category": "special", "threshold": 0, "color": "#f97316"},
    {"id": "multitasker", "name": "Multitasker", "description": "Worked on 5+ tickets in a single day", "icon": "layers", "category": "special", "threshold": 5, "color": "#14b8a6"},
    {"id": "ticket_25", "name": "Quarter Century", "description": "Closed 25 tickets", "icon": "target", "category": "tickets", "threshold": 25, "color": "#06b6d4"},
    {"id": "ticket_250", "name": "Force of Nature", "description": "Closed 250 tickets", "icon": "flame", "category": "tickets", "threshold": 250, "color": "#f97316"},
    {"id": "invoice_10", "name": "Revenue Driver", "description": "Created 10 invoices", "icon": "dollar-sign", "category": "invoices", "threshold": 10, "color": "#22c55e"},
    {"id": "invoice_500", "name": "Billing Legend", "description": "Created 500 invoices", "icon": "gem", "category": "invoices", "threshold": 500, "color": "#ec4899"},
    {"id": "remote_5", "name": "Connected", "description": "Completed 5 remote sessions", "icon": "monitor", "category": "remote", "threshold": 5, "color": "#22c55e"},
    {"id": "remote_250", "name": "Remote Master", "description": "Completed 250 remote sessions", "icon": "wifi", "category": "remote", "threshold": 250, "color": "#f59e0b"},
    {"id": "workshop_10", "name": "Bench Apprentice", "description": "Completed 10 workshop jobs", "icon": "wrench", "category": "workshop", "threshold": 10, "color": "#3b82f6"},
    {"id": "workshop_50", "name": "Bench Veteran", "description": "Completed 50 workshop jobs", "icon": "tool", "category": "workshop", "threshold": 50, "color": "#8b5cf6"},
    {"id": "field_10", "name": "Road Warrior", "description": "Completed 10 field jobs", "icon": "truck", "category": "field", "threshold": 10, "color": "#06b6d4"},
    {"id": "field_50", "name": "Field Ranger", "description": "Completed 50 field jobs", "icon": "compass", "category": "field", "threshold": 50, "color": "#f59e0b"},
    {"id": "checklist_5", "name": "Onboarding Ace", "description": "Completed 5 onboarding checklists", "icon": "clipboard-check", "category": "onboarding", "threshold": 5, "color": "#22c55e"},
    {"id": "checklist_20", "name": "Readiness Champion", "description": "Completed 20 onboarding checklists", "icon": "shield-check", "category": "onboarding", "threshold": 20, "color": "#8b5cf6"},
    {"id": "points_1k", "name": "Point Collector", "description": "Earned 1,000 lifetime points", "icon": "coins", "category": "points", "threshold": 1000, "color": "#f59e0b"},
    {"id": "points_5k", "name": "Point Hoarder", "description": "Earned 5,000 lifetime points", "icon": "coins", "category": "points", "threshold": 5000, "color": "#f97316"},
    {"id": "points_10k", "name": "Point Tycoon", "description": "Earned 10,000 lifetime points", "icon": "crown", "category": "points", "threshold": 10000, "color": "#ec4899"},
    {"id": "first_prize", "name": "Shop Opener", "description": "Purchased your first reward", "icon": "shopping-bag", "category": "points", "threshold": 0, "color": "#14b8a6"},
]

# Lucide icon name -> emoji, so badge-system achievements render natively in
# emoji-based surfaces such as the technician profile card grid.
ICON_EMOJI = {
    "trophy": "🏆",
    "target": "🎯",
    "zap": "⚡",
    "award": "🏅",
    "crown": "👑",
    "gem": "💎",
    "dollar-sign": "💵",
    "credit-card": "💳",
    "banknote": "💰",
    "monitor": "🖥️",
    "wifi": "📶",
    "calendar": "📅",
    "shield": "🛡️",
    "star": "⭐",
    "cake": "🎂",
    "rocket": "🚀",
    "layers": "🧩",
    "flame": "🔥",
    "wrench": "🔧",
    "tool": "🪛",
    "truck": "🚚",
    "compass": "🧭",
    "clipboard-check": "✅",
    "shield-check": "🛡️",
    "coins": "🪙",
    "shopping-bag": "🛍️",
    "award-icon": "🏅",
}


def badge_emoji(definition: dict[str, Any]) -> str:
    """Emoji for a badge definition's icon (fallback: generic badge)."""
    return ICON_EMOJI.get(str(definition.get("icon") or ""), "🏅")


def badge_rarity(definition: dict[str, Any]) -> str:
    """Deterministic display rarity for a badge definition.

    Zero-threshold badges are event-driven (birthday, speed demon), so they sit
    at epic; the rest scale with the milestone threshold.
    """
    threshold = int(definition.get("threshold") or 0)
    category = str(definition.get("category") or "")
    if threshold == 0:
        return "epic" if category in {"special", "celebration"} else "rare"
    if threshold >= 500:
        return "legendary"
    if threshold >= 100:
        return "epic"
    if threshold >= 10:
        return "rare"
    return "common"


def profile_badge_view(definition: dict[str, Any], *, earned: bool) -> dict[str, Any]:
    """Map a badge definition to the technician-profile card shape.

    The shape is the quirky profile contract: ``key`` / ``title`` / ``icon``
    (emoji) / ``rarity`` / ``description`` / ``earned``.
    """
    return {
        "key": definition.get("id") or definition.get("key") or "",
        "title": definition.get("name") or definition.get("title") or "",
        "icon": badge_emoji(definition),
        "rarity": badge_rarity(definition),
        "description": definition.get("description") or "",
        "category": definition.get("category") or "custom",
        "earned": bool(earned),
    }
