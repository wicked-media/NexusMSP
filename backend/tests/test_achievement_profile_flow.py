"""Contract tests for the technician-profile achievement flow-through.

The profile surface must render the *same* badge catalog the achievements
workspace and points economy use — these tests lock the shared source of truth
(previously three drifting copies existed) and the pure profile-view mapping.
"""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.achievement_catalog import (  # noqa: E402
    ACHIEVEMENT_DEFINITIONS,
    ACHIEVEMENT_POINTS,
    ICON_EMOJI,
    badge_emoji,
    badge_rarity,
    profile_badge_view,
)
from app.services import activity  # noqa: E402
from app.routers import achievements as achievements_router  # noqa: E402


def test_single_source_of_truth_for_badge_definitions():
    """All former copies must resolve to the one catalog list object."""
    assert achievements_router.ACHIEVEMENT_DEFINITIONS is ACHIEVEMENT_DEFINITIONS
    assert activity.ACHIEVEMENT_DEFINITIONS is ACHIEVEMENT_DEFINITIONS


def test_router_points_map_is_the_catalog_map():
    assert achievements_router.ACHIEVEMENT_POINTS is ACHIEVEMENT_POINTS


def test_definition_ids_are_unique():
    ids = [d["id"] for d in ACHIEVEMENT_DEFINITIONS]
    assert len(ids) == len(set(ids))


def test_every_definition_has_profile_view_fields():
    for definition in ACHIEVEMENT_DEFINITIONS:
        view = profile_badge_view(definition, earned=False)
        assert view["key"] == definition["id"]
        assert view["title"] == definition["name"]
        assert view["description"] == definition["description"]
        assert view["earned"] is False
        assert view["icon"]
        assert view["rarity"] in {"common", "rare", "epic", "legendary"}


def test_profile_view_marks_earned():
    definition = ACHIEVEMENT_DEFINITIONS[0]
    assert profile_badge_view(definition, earned=True)["earned"] is True


def test_badge_rarity_scales_with_threshold():
    assert badge_rarity({"threshold": 1, "category": "tickets"}) == "common"
    assert badge_rarity({"threshold": 10, "category": "tickets"}) == "rare"
    assert badge_rarity({"threshold": 100, "category": "tickets"}) == "epic"
    assert badge_rarity({"threshold": 500, "category": "tickets"}) == "legendary"


def test_event_badges_are_not_common():
    """Zero-threshold event badges (birthday, speed demon) sit above common."""
    assert badge_rarity({"threshold": 0, "category": "celebration"}) == "epic"
    assert badge_rarity({"threshold": 0, "category": "special"}) == "epic"


def test_every_definition_icon_has_emoji_mapping():
    for definition in ACHIEVEMENT_DEFINITIONS:
        assert definition["icon"] in ICON_EMOJI
        assert badge_emoji(definition) == ICON_EMOJI[definition["icon"]]


def test_unknown_icon_falls_back_to_generic_badge():
    assert badge_emoji({"icon": "not-a-real-icon"}) == "🏅"


def test_profile_view_shape_matches_profile_card_contract():
    """The profile grid renders key/title/icon/rarity/description/earned."""
    view = profile_badge_view(ACHIEVEMENT_DEFINITIONS[0], earned=True)
    assert set(view) == {"key", "title", "icon", "rarity", "description", "category", "earned"}
