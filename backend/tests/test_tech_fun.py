"""Contracts for the tech delight layer (Tech Toolbox).

The delight layer may never invent a second source of truth: points flow
through the append-only ledger, hidden badges through the shared award store,
and every derived figure (streaks, seasons, weather, speedruns) recomputes
from authoritative operational records.  These tests lock those boundaries,
the daily gates, and the tenant/client scoping of the fun endpoints.
"""

import asyncio
import copy
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import quirky_features, tech_fun as tech_fun_router  # noqa: E402
from app.services import tech_fun  # noqa: E402


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat()


# ============== MINIMAL MONGO FAKES ==============


def _match_value(value, condition):
    if isinstance(condition, dict):
        for op, operand in condition.items():
            if op == "$in" and value not in operand:
                return False
            if op == "$nin" and value in operand:
                return False
            if op == "$exists" and (value is not None) != bool(operand):
                return False
            if op == "$ne" and value == operand:
                return False
            if op == "$gt" and not (value is not None and value > operand):
                return False
            if op == "$regex" and not re.search(operand, str(value or "")):
                return False
        return True
    if condition is None:
        return value is None
    return value == condition


def _matches(row, query):
    for key, condition in query.items():
        if key == "$or":
            if not any(_matches(row, sub) for sub in condition):
                return False
        elif key == "$and":
            if not all(_matches(row, sub) for sub in condition):
                return False
        elif not _match_value(row.get(key), condition):
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, field, direction=1):
        self._rows = sorted(self._rows, key=lambda row: (row.get(field) is None, row.get(field)), reverse=direction < 0)
        return self

    def limit(self, count):
        self._rows = self._rows[:count]
        return self

    async def to_list(self, _count=None):
        return [copy.deepcopy(row) for row in self._rows]


class _Collection:
    def __init__(self, rows=None):
        self.rows = [copy.deepcopy(row) for row in (rows or [])]
        self.inserted = []
        self.updates = []

    def find(self, query=None, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query or {})])

    async def find_one(self, query=None, _projection=None):
        for row in self.rows:
            if _matches(row, query or {}):
                return copy.deepcopy(row)
        return None

    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))
        self.inserted.append(copy.deepcopy(row))

    async def update_one(self, query, update, **_kwargs):
        self.updates.append((copy.deepcopy(query), copy.deepcopy(update)))
        for row in self.rows:
            if _matches(row, query):
                for field, value in (update.get("$set") or {}).items():
                    if "." in field:
                        head, tail = field.split(".", 1)
                        nested = row.setdefault(head, {})
                        if isinstance(nested, dict):
                            nested[tail] = value
                    else:
                        row[field] = value
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for row in self.rows if _matches(row, query or {}))


def _db(**collections):
    namespace = SimpleNamespace()
    for name in ("tickets", "users", "tech_points_ledger", "user_achievements", "devices",
                 "onboarding_checklist_runs", "runbooks", "backup_drills"):
        setattr(namespace, name, collections.get(name, _Collection()))
    return namespace


def _user(uid="tech-1", name="Terry Tech"):
    return {"id": uid, "name": name, "role": "tech", "tenant_id": "platform-a", "client_scope_mode": "all"}


# ============== HIDDEN BADGES ==============


def test_hidden_badges_derive_from_ticket_history(monkeypatch):
    monkeypatch.setattr(tech_fun, "_utcnow", lambda: datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc))
    tickets = _Collection([
        {"id": "t1", "assigned_to": "tech-1", "status": "closed",
         "resolved_at": _iso(datetime(2026, 10, 3, 3, 15, tzinfo=timezone.utc)), "resolution_notes": "ok"},
        {"id": "t2", "assigned_to": "tech-1", "status": "resolved",
         "resolved_at": _iso(datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)),
         "resolution_notes": "x" * 42},
    ])

    keys = asyncio.run(tech_fun.derived_badge_keys(_db(tickets=tickets), "tech-1", "Terry Tech"))

    assert {"glitch_graveyard", "glitch_the_answer"} <= keys
    assert "perfect_week" not in keys


def test_perfect_week_needs_seven_consecutive_days(monkeypatch):
    monkeypatch.setattr(tech_fun, "_utcnow", lambda: datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc))
    rows = [
        {"id": f"t{i}", "assigned_to": "tech-1", "status": "closed",
         "resolved_at": _iso(datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc) - timedelta(days=i)), "resolution_notes": ""}
        for i in range(7)
    ]
    keys = asyncio.run(tech_fun.derived_badge_keys(_db(tickets=_Collection(rows)), "tech-1", "Terry Tech"))
    assert "perfect_week" in keys


def test_easter_egg_awards_hidden_badge_idempotently(monkeypatch):
    db = _db()
    monkeypatch.setattr(tech_fun_router, "db", db)
    user = _user()

    first = asyncio.run(tech_fun_router.trigger_easter_egg("sudo", user))
    second = asyncio.run(tech_fun_router.trigger_easter_egg("sudo", user))

    assert first["awarded"] is True
    assert second["awarded"] is False
    awards = db.user_achievements.rows
    assert len(awards) == 1 and awards[0]["achievement_id"] == "glitch_sudo"

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(tech_fun_router.trigger_easter_egg("not-an-egg", user))
    assert excinfo.value.status_code == 404


def test_locked_hidden_badges_render_masked(monkeypatch):
    monkeypatch.setattr(tech_fun, "derived_badge_keys", lambda *_args, **_kwargs: _empty_set())
    db = _db()
    monkeypatch.setattr(quirky_features, "db", db)
    monkeypatch.setattr(tech_fun_router, "db", db)

    earned, locked = asyncio.run(quirky_features._merged_badges("tech-1", "Terry Tech"))

    hidden_locked = {v["key"]: v for v in locked if v["key"] in tech_fun.HIDDEN_KEYS}
    assert set(hidden_locked) == tech_fun.HIDDEN_KEYS
    assert all(v["title"] == "??? (hidden badge)" for v in hidden_locked.values())
    perfect = next(v for v in locked + earned if v["key"] == "perfect_week")
    assert perfect["title"] == "Perfect Week"


async def _empty_set():
    return set()


# ============== LUCKY COIN & WHEEL ==============


def test_lucky_coin_is_daily_and_flows_through_ledger(monkeypatch):
    db = _db(users=_Collection([_user()]))
    monkeypatch.setattr(tech_fun_router, "db", db)
    monkeypatch.setattr("secrets.randbelow", lambda _n: 3)

    first = asyncio.run(tech_fun_router.claim_lucky_coin(_user()))
    second = asyncio.run(tech_fun_router.claim_lucky_coin(_user()))

    assert first["available"] is True and 1 <= first["amount"] <= 5
    assert second["available"] is False
    entry = db.tech_points_ledger.rows[0]
    assert entry["kind"] == "earn" and entry["reason"] == "lucky coin"
    assert entry["balance_after"] == first["amount"]


def test_lucky_coin_jackpot_awards_hidden_badge(monkeypatch):
    db = _db(users=_Collection([_user()]))
    monkeypatch.setattr(tech_fun_router, "db", db)
    monkeypatch.setattr("secrets.randbelow", lambda _n: 0)

    result = asyncio.run(tech_fun_router.claim_lucky_coin(_user()))

    assert result["jackpot"] is True and result["amount"] == 25
    assert any(row["achievement_id"] == "glitch_lucky" for row in db.user_achievements.rows)


def test_wheel_spin_assigns_oldest_unassigned_ticket():
    tickets = _Collection([
        {"id": "t-new", "ticket_number": 2, "title": "newer", "client_name": "A", "priority": "low", "tenant_id": "platform-a",
         "created_at": _iso(_now() - timedelta(hours=1)), "assigned_to": None, "status": "open"},
        {"id": "t-old", "ticket_number": 1, "title": "older", "client_name": "B", "priority": "high", "tenant_id": "platform-a",
         "created_at": _iso(_now() - timedelta(days=2)), "assigned_to": None, "status": "open"},
        {"id": "t-taken", "ticket_number": 3, "title": "taken", "client_name": "C", "priority": "low", "tenant_id": "platform-a",
         "created_at": _iso(_now() - timedelta(days=3)), "assigned_to": "tech-9", "status": "open"},
    ])
    db = _db(tickets=tickets, users=_Collection([_user()]))
    monkey_user = _user()

    result = asyncio.run(tech_fun.wheel_spin(db, monkey_user, "platform-a"))

    assert result["ticket"]["id"] == "t-old"
    assert result["wheel_streak"] == 1
    taken = next(row for row in tickets.rows if row["id"] == "t-old")
    assert taken["assigned_to"] == "tech-1"

    asyncio.run(tech_fun.wheel_spin(db, monkey_user, "platform-a"))
    clear = asyncio.run(tech_fun.wheel_spin(db, monkey_user, "platform-a"))
    assert clear["ticket"] is None


def test_wheel_streak_bonus_every_fifth_spin():
    tickets = _Collection([
        {"id": "t1", "ticket_number": 1, "title": "a", "client_name": "A", "priority": "low", "tenant_id": "platform-a",
         "created_at": _iso(_now()), "assigned_to": None, "status": "open"},
    ])
    user = {**_user(), "fun_state": {"wheel_streak": 4, "wheel_last": _iso(_now() - timedelta(hours=1))}}
    db = _db(tickets=tickets, users=_Collection([user]))

    result = asyncio.run(tech_fun.wheel_spin(db, user, "platform-a"))

    assert result["wheel_streak"] == 5
    assert result["streak_bonus_points"] == 5
    assert any(row["reason"] == "wheel streak 5" for row in db.tech_points_ledger.rows)


# ============== FOCUS MODE ==============


def test_focus_session_rewards_deep_work_once_per_day():
    user = _user()
    db = _db(users=_Collection([user]))

    started = asyncio.run(tech_fun.set_focus(db, user, 30))
    assert started["active"] is True and started["minutes"] == 30

    # Simulate a completed 30-minute session.
    asyncio.run(tech_fun.update_fun_state(db, "tech-1", {"focus_started": _iso(_now() - timedelta(minutes=30))}))
    first = asyncio.run(tech_fun.end_focus(db, user, "platform-a"))
    second = asyncio.run(tech_fun.end_focus(db, user, "platform-a"))

    assert first["deep_work_points"] == 5
    assert second["deep_work_points"] == 0


def test_short_focus_session_earns_nothing():
    user = _user()
    db = _db(users=_Collection([user]))
    asyncio.run(tech_fun.set_focus(db, user, 10))
    result = asyncio.run(tech_fun.end_focus(db, user, "platform-a"))
    assert result["deep_work_points"] == 0


# ============== DERIVED VIEWS ==============


def test_season_standings_and_hall_of_fame_derive_from_ledger():
    now = _now()
    ledger = _Collection([
        {"tenant_id": "platform-a", "user_id": "tech-1", "delta": 100, "kind": "earn",
         "created_at": now.strftime("%Y-%m-%dT10:00:00+00:00")},
        {"tenant_id": "platform-a", "user_id": "tech-2", "delta": 50, "kind": "earn",
         "created_at": now.strftime("%Y-%m-%dT11:00:00+00:00")},
        {"tenant_id": "platform-a", "user_id": "tech-2", "delta": -20, "kind": "spend",
         "created_at": now.strftime("%Y-%m-%dT12:00:00+00:00")},
    ])
    db = _db(tech_points_ledger=ledger,
             users=_Collection([_user("tech-1", "One"), _user("tech-2", "Two")]))

    result = asyncio.run(tech_fun.season_standings(db, "platform-a", months=2))

    assert result["standings"][0] == {"user_id": "tech-1", "name": "One", "points": 100}
    assert result["standings"][1]["points"] == 50
    assert isinstance(result["hall_of_fame"], list)


def test_win_wall_kinds_reflect_priority_and_speed():
    now = _now()
    tickets = _Collection([
        {"id": "t1", "ticket_number": 1, "title": "crit", "client_name": "A", "priority": "critical", "tenant_id": "platform-a", "status": "closed",
         "created_at": _iso(now - timedelta(hours=2)), "resolved_at": _iso(now - timedelta(hours=1))},
        {"id": "t2", "ticket_number": 2, "title": "slow", "client_name": "A", "priority": "low", "tenant_id": "platform-a", "status": "closed",
         "created_at": _iso(now - timedelta(days=2)), "resolved_at": _iso(now - timedelta(hours=2))},
    ])
    db = _db(tickets=tickets)

    wins = asyncio.run(tech_fun.win_wall(db, _user()))

    kinds = {win["id"]: win["kind"] for win in wins}
    assert kinds == {"t1": "critical", "t2": "close"}


def test_network_weather_buckets_device_health():
    now = _now()
    devices = _Collection([
        {"client_name": "Healthy Co", "status": "online", "last_seen": _iso(now), "tenant_id": "platform-a"},
        {"client_name": "Stormy Co", "status": "offline", "last_seen": _iso(now), "tenant_id": "platform-a"},
        {"client_name": "Stormy Co", "status": "offline", "last_seen": _iso(now), "tenant_id": "platform-a"},
        {"client_name": "Foggy Co", "status": "online", "last_seen": _iso(now - timedelta(days=3)), "tenant_id": "platform-a"},
    ])
    db = _db(devices=devices)

    weather = asyncio.run(tech_fun.network_weather(db, _user()))

    by_name = {group["client_name"]: group["weather"] for group in weather["clients"]}
    assert by_name == {"Foggy Co": "foggy", "Healthy Co": "sunny", "Stormy Co": "stormy"}


def test_speedruns_rank_completed_runs_and_personal_best():
    base = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
    runs = _Collection([
        {"id": "r1", "template_id": "tpl-1", "technician_id": "tech-1", "technician_name": "Terry Tech",
         "status": "completed", "started_at": _iso(base), "completed_at": _iso(base + timedelta(minutes=30))},
        {"id": "r2", "template_id": "tpl-1", "technician_id": "tech-2", "technician_name": "Other",
         "status": "completed", "started_at": _iso(base), "completed_at": _iso(base + timedelta(minutes=10))},
        {"id": "r3", "template_id": "tpl-1", "technician_id": "tech-1", "technician_name": "Terry Tech",
         "status": "in_progress", "started_at": _iso(base), "completed_at": None},
    ])
    db = _db(onboarding_checklist_runs=runs)

    result = asyncio.run(tech_fun.speedruns(db, _user(), "tpl-1"))

    assert [row["technician_id"] for row in result["leaderboard"]] == ["tech-2", "tech-1"]
    assert result["personal_best"]["run_id"] == "r1"
    assert result["runs_timed"] == 2


def test_pet_evolution_stages_follow_lifetime_points():
    assert tech_fun.pet_evolution(0)["stage"] == 1
    assert tech_fun.pet_evolution(2_500)["stage"] == 2
    assert tech_fun.pet_evolution(12_000)["stage"] == 3
    top = tech_fun.pet_evolution(99_000)
    assert top["stage"] == 4 and top["next_at"] is None


# ============== QR LABELS ==============


def test_qr_endpoint_rejects_non_http_data():
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(tech_fun_router.qr_svg(data="javascript:alert(1)", current_user=_user()))
    assert excinfo.value.status_code == 400


def test_qr_endpoint_renders_svg_for_urls():
    response = asyncio.run(tech_fun_router.qr_svg(data="https://nexus.example/devices/dev-1", current_user=_user()))
    assert response.media_type == "image/svg+xml"
    assert b"<svg" in response.body and b"rect" in response.body
