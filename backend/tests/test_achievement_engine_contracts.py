"""Contract tests for the evidence-driven achievement engine.

These lock the retro-award / recompute safety properties: awards follow real
accountable evidence fields, are idempotent (never duplicate earned badges),
zero-threshold event badges cannot be farmed by re-running the sweep, and
badge points are valued by the shared category→points policy.
"""

import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.achievement_catalog import ACHIEVEMENT_POINTS  # noqa: E402
from app.services.achievement_engine import (  # noqa: E402
    badge_points,
    run_achievement_check,
)


class _FakeInsertResult:
    inserted_id = "oid"


class _FakeCursor:
    def __init__(self, rows):
        self.rows = rows
        self._limit = None

    def sort(self, *_args):
        return self

    def limit(self, n):
        self._limit = n
        return self

    async def to_list(self, limit):
        cap = min(self._limit or limit, limit)
        return [dict(row) for row in self.rows[:cap]]


class _FakeCollection:
    def __init__(self, rows=None, count=0):
        self.rows = [dict(row) for row in (rows or [])]
        self.count = count
        self.inserted = []

    async def count_documents(self, _query):
        return self.count

    def find(self, query=None, projection=None):
        return _FakeCursor(self.rows)

    async def find_one(self, query, projection=None):
        return dict(self.rows[0]) if self.rows else None

    async def insert_one(self, record):
        self.rows.append(dict(record))
        self.inserted.append(dict(record))
        return _FakeInsertResult()


class _FakeDb:
    def __init__(self, **collections):
        self.tickets = collections.get("tickets", _FakeCollection())
        self.activity_logs = collections.get("activity_logs", _FakeCollection())
        self.remote_sessions = collections.get("remote_sessions", _FakeCollection())
        self.workshop_jobs = collections.get("workshop_jobs", _FakeCollection())
        self.field_jobs = collections.get("field_jobs", _FakeCollection())
        self.onboarding_checklist_runs = collections.get(
            "onboarding_checklist_runs", _FakeCollection()
        )
        self.tech_points_ledger = collections.get("tech_points_ledger", _FakeCollection())
        self.user_achievements = collections.get("user_achievements", _FakeCollection())


ACTOR = {"id": "admin-1", "name": "Admin"}


def _run(db, user):
    return asyncio.run(
        run_achievement_check(db, user, tenant_id="nexus-local", actor=ACTOR)
    )


class TestBadgePointsPolicy:
    def test_points_follow_category_map(self):
        for category, points in ACHIEVEMENT_POINTS.items():
            assert badge_points({"category": category}) == points

    def test_unknown_category_falls_back(self):
        assert badge_points({"category": "mystery"}) == 75
        assert badge_points({}) == 75


class TestEvidenceAwarding:
    def test_ticket_milestones_award_from_closed_evidence(self):
        db = _FakeDb(tickets=_FakeCollection(count=30))
        result = _run(db, {"id": "tech-1", "name": "Tess"})
        ids = result["newly_awarded_ids"]
        assert "first_ticket" in ids
        assert "ticket_10" in ids
        assert "ticket_25" in ids
        assert "ticket_50" not in ids, "must not award beyond the evidence"

    def test_award_records_target_user_and_system_actor(self):
        db = _FakeDb(tickets=_FakeCollection(count=1))
        _run(db, {"id": "tech-1", "name": "Tess"})
        entry = db.user_achievements.inserted[0]
        assert entry["user_id"] == "tech-1"
        assert entry["achievement_id"] == "first_ticket"
        assert entry["awarded_by"] == "System"
        assert "tickets closed" in entry["note"]

    def test_points_category_counts_lifetime_ledger(self):
        ledger_rows = [
            {"delta": 600, "balance_after": 600},
            {"delta": -100, "balance_after": 500},
            {"delta": 500, "balance_after": 1000},
        ]
        db = _FakeDb(tech_points_ledger=_FakeCollection(rows=ledger_rows))
        result = _run(db, {"id": "tech-1", "name": "Tess"})
        ids = result["newly_awarded_ids"]
        assert "points_1k" in ids  # 1100 lifetime earned (spend excluded)
        assert "points_5k" not in ids


class TestIdempotency:
    def test_already_earned_badges_are_not_re_awarded(self):
        earned = [
            {"achievement_id": "first_ticket"},
            {"achievement_id": "ticket_10"},
        ]
        db = _FakeDb(
            tickets=_FakeCollection(count=10),
            user_achievements=_FakeCollection(rows=earned),
        )
        result = _run(db, {"id": "tech-1", "name": "Tess"})
        assert result["newly_awarded"] == []
        assert db.user_achievements.inserted == []
        assert result["total_earned"] == 2

    def test_zero_threshold_event_badges_are_not_farmable(self):
        # Nothing is in the ledger, so the Shop Opener / speed demon badges
        # (threshold 0) must never appear from a recompute sweep.
        db = _FakeDb()
        result = _run(db, {"id": "tech-1", "name": "Tess"})
        assert result["newly_awarded"] == []
        assert db.user_achievements.inserted == []


class TestPointsGrant:
    def test_new_awards_grant_category_valued_points_in_one_entry(self):
        db = _FakeDb(tickets=_FakeCollection(count=1))
        result = _run(db, {"id": "tech-1", "name": "Tess"})
        # first_ticket is a tickets badge -> 100 points.
        assert result["points_earned"] == ACHIEVEMENT_POINTS["tickets"]
        assert len(db.tech_points_ledger.inserted) == 1
        entry = db.tech_points_ledger.inserted[0]
        assert entry["delta"] == ACHIEVEMENT_POINTS["tickets"]
        assert entry["user_id"] == "tech-1"
        assert entry["reference_id"].startswith("achievements-check:tech-1:")

    def test_no_new_awards_means_no_ledger_entry(self):
        db = _FakeDb()
        result = _run(db, {"id": "tech-1", "name": "Tess"})
        assert result["points_earned"] == 0
        assert db.tech_points_ledger.inserted == []

    def test_tenant_and_actor_are_recorded_on_the_ledger(self):
        db = _FakeDb(tickets=_FakeCollection(count=1))
        _run(db, {"id": "tech-1", "name": "Tess"})
        entry = db.tech_points_ledger.inserted[0]
        assert entry["tenant_id"] == "nexus-local"
        assert entry["awarded_by"] == "admin-1"
        assert entry["awarded_by_name"] == "Admin"
