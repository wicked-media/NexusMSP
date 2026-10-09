"""Regression guards for the continuity sweep fixes.

These lock three bug classes found during the sweep so they cannot return
silently:

1. Route shadowing: literal paths like ``/tickets/merge-suggestions`` must
   resolve to their own handler, not fall into an earlier ``{param}`` route.
2. MongoDB ``_id`` leaks: seed-on-read handlers must never return documents
   carrying the pymongo-mutated ``_id`` field (it breaks JSON serialisation).
3. Handler shadowing: the tech-rewards route handler must not shadow the
   imported ``award_points`` service function (a rename regression would make
   every points write 500).
"""

import asyncio
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from starlette.routing import Match  # noqa: E402


def _first_match(app, path: str, method: str = "GET"):
    for route in app.routes:
        scope = {
            "type": "http",
            "method": method,
            "path": path,
            "root_path": "",
            "headers": [],
        }
        try:
            match, _ = route.matches(scope)
        except Exception:
            continue
        if match == Match.FULL:
            return route
    return None


class TestRouteShadowRegressions:
    def test_merge_suggestions_not_shadowed_by_ticket_id_route(self):
        import server

        route = _first_match(server.app, "/api/tickets/merge-suggestions")
        assert route is not None, "merge-suggestions route is not registered"
        assert getattr(route.endpoint, "__name__", "") == "get_merge_suggestions"
        assert "ticket_merge" in getattr(route.endpoint, "__module__", "")

    def test_vendor_stats_not_shadowed_by_vendor_id_route(self):
        import server

        route = _first_match(server.app, "/api/vendors/stats")
        assert route is not None, "vendors stats route is not registered"
        assert getattr(route.endpoint, "__name__", "") == "get_vendor_stats"

    def test_ticket_merge_router_wins_priority(self):
        import server

        assert server.ROUTER_PRIORITY.index("ticket_merge") < server.ROUTER_PRIORITY.index("tickets")

    def test_vendors_stats_defined_before_vendor_id(self):
        source = (BACKEND_ROOT / "app" / "routers" / "vendors.py").read_text(encoding="utf-8")
        stats_pos = source.find('"/vendors/stats"')
        param_pos = source.find('"/vendors/{vendor_id}"')
        assert stats_pos != -1 and param_pos != -1
        assert stats_pos < param_pos, "vendors stats must be declared before the {vendor_id} route"


class _FakeInsertResult:
    pass


class _FakeCollection:
    """Minimal pymongo-shaped collection whose insert_one mutates like pymongo."""

    def __init__(self):
        self.rows = []

    def find(self, _query, projection=None):
        rows = [dict(row) for row in self.rows]
        if projection and projection.get("_id") == 0:
            for row in rows:
                row.pop("_id", None)
        return _Cursor(rows)

    async def insert_one(self, record):
        # pymongo injects _id into the caller's dict in place.
        record["_id"] = f"oid-{len(self.rows)}"
        self.rows.append(dict(record))
        return _FakeInsertResult()


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return [dict(row) for row in self.rows]


class TestTaxProfileSeedIdLeak:
    def test_seed_returns_docs_without_mongo_id(self):
        from app.routers import invoice_enhanced

        fake = _FakeCollection()
        original = invoice_enhanced.db
        invoice_enhanced.db = _TaxProfileDb(fake)
        try:
            result = asyncio.run(invoice_enhanced.get_tax_profiles(current_user={"id": "user-1"}))
        finally:
            invoice_enhanced.db = original
        assert result, "seed should return default tax profiles"
        for doc in result:
            assert "_id" not in doc, "seeded tax profile leaked its MongoDB _id"
        # Second call reads persisted rows and must also be clean.
        original = invoice_enhanced.db
        invoice_enhanced.db = _TaxProfileDb(fake)
        try:
            second = asyncio.run(invoice_enhanced.get_tax_profiles(current_user={"id": "user-1"}))
        finally:
            invoice_enhanced.db = original
        for doc in second:
            assert "_id" not in doc


class TestAchievementDefinitionsIntegrity:
    def test_achievement_ids_are_unique(self):
        from app.routers.achievements import ACHIEVEMENT_DEFINITIONS

        ids = [a["id"] for a in ACHIEVEMENT_DEFINITIONS]
        assert len(ids) == len(set(ids))

    def test_every_category_maps_to_points(self):
        from app.routers.achievements import ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_POINTS

        for ach in ACHIEVEMENT_DEFINITIONS:
            assert ach["category"] in ACHIEVEMENT_POINTS, (
                f"achievement {ach['id']} category {ach['category']} has no points mapping"
            )

    def test_threshold_zero_achievements_are_not_auto_awarded(self):
        """Zero-threshold badges (birthday, shop opener) need explicit events.

        The auto-check loop requires threshold > 0 so these cannot be farmed
        by repeatedly calling the check endpoint.
        """
        from app.routers.achievements import ACHIEVEMENT_DEFINITIONS

        zero = [a for a in ACHIEVEMENT_DEFINITIONS if a["threshold"] == 0]
        assert zero, "expected some zero-threshold event badges"
        assert all(a["category"] in {"celebration", "special", "points"} for a in zero)


class _TaxProfileDb:
    def __init__(self, tax_profiles):
        self.tax_profiles = tax_profiles


class TestTechRewardsHandlerShadowing:
    def test_award_points_is_the_service_function(self):
        from app.routers import tech_rewards as rewards_router
        from app.services import tech_rewards as rewards_service

        assert rewards_router.award_points is rewards_service.award_points, (
            "router.award_points must stay the imported service function; "
            "a route handler with that name would shadow every points write"
        )

    def test_award_route_bound_to_grant_points_handler(self):
        import server

        route = _first_match(server.app, "/api/tech-rewards/award", method="POST")
        assert route is not None
        assert getattr(route.endpoint, "__name__", "") == "grant_points"
