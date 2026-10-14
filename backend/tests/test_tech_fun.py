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
from app.services import qol_tools, tech_fun  # noqa: E402


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
            if op == "$gte" and not (value is not None and value >= operand):
                return False
            if op == "$lt" and not (value is not None and value < operand):
                return False
            if op == "$lte" and not (value is not None and value <= operand):
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

    async def update_one(self, query, update, upsert=False, **_kwargs):
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
        if upsert:
            row = {key: value for key, value in (query or {}).items() if isinstance(value, (str, int, float, bool))}
            row.update(update.get("$set") or {})
            self.rows.append(copy.deepcopy(row))
            return SimpleNamespace(matched_count=1, upserted_id=row)
        return SimpleNamespace(matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for row in self.rows if _matches(row, query or {}))


def _db(**collections):
    namespace = SimpleNamespace()
    for name in ("tickets", "users", "tech_points_ledger", "user_achievements", "devices",
                 "onboarding_checklist_runs", "runbooks", "backup_drills", "ticket_comments",
                 "nexus_agent_commands", "alerts", "clients", "remote_sessions",
                 "backup_jobs", "maintenance_windows", "change_management",
                 "nexus_memory", "nexus_feedback", "settings", "work_locks"):
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


# ============== NOTE TRANSLATORS ==============


def test_professionalise_composes_venting_notes():
    result = qol_tools.professionalise("fucking Microsoft broke Outlook again, this is bullshit")
    assert "fucking" not in result.lower()
    assert "bullshit" not in result.lower()
    assert result.endswith(".")
    assert "Microsoft" in result


def test_customer_update_translates_jargon():
    result = qol_tools.to_customer_update("Rebuilt TCP/IP stack, flushed DNS cache and renewed the DHCP lease")
    assert "TCP/IP" not in result
    assert "network configuration" in result
    assert result.endswith(".")


def test_translator_endpoint_rejects_unknown_mode():
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(tech_fun_router.translate_note({"mode": "pirate", "text": "ahoy"}, _user()))
    assert excinfo.value.status_code == 400


# ============== IS IT DNS ==============


def test_dns_verdict_answers_yes_on_failures():
    verdict = qol_tools.dns_verdict([
        {"host": "ok.example.com", "ok": True, "ms": 12, "addresses": ["1.2.3.4"]},
        {"host": "bad.example.com", "ok": False, "ms": 400, "addresses": []},
    ])
    assert verdict["answer"] == "YES"
    assert any("failed" in reason for reason in verdict["reasons"])


def test_dns_verdict_answers_no_when_all_clean():
    verdict = qol_tools.dns_verdict([{"host": "a.example.com", "ok": True, "ms": 8, "addresses": ["1.2.3.4"]}])
    assert verdict["answer"] == "NO"
    assert any("firewall" in reason.lower() for reason in verdict["reasons"])


def test_is_it_dns_uses_real_resolution(monkeypatch):
    devices = _Collection([
        {"hostname": "server.contoso.com", "tenant_id": "platform-a"},
        {"hostname": "nas.contoso.com", "tenant_id": "platform-a"},
        {"hostname": "printer.contoso.com", "tenant_id": "platform-a"},
    ])
    db = _db(devices=devices)
    monkeypatch.setattr(tech_fun, "_resolve_host", lambda host: (False if "nas" in host else True, 12.0, ["10.0.0.1"]))

    verdict = asyncio.run(tech_fun.is_it_dns(db, _user()))

    assert verdict["answer"] == "YES"
    assert "nas.contoso.com" in verdict["tested_hosts"]
    assert any("nas.contoso.com" in reason for reason in verdict["reasons"])


# ============== REALITY CHECK / BOSS BATTLES / PERSONALITY / CELEBRATIONS ==============


def test_verify_user_report_summarises_evidence():
    now = _now()
    db = _db(
        devices=_Collection([{"id": "dev-1", "hostname": "PC-1", "tenant_id": "platform-a", "last_seen": _iso(now - timedelta(minutes=2))}]),
        remote_sessions=_Collection([
            {"device_id": "dev-1", "started_at": _iso(now - timedelta(hours=2))},
            {"device_id": "dev-1", "started_at": _iso(now - timedelta(hours=5))},
        ]),
    )

    report = asyncio.run(tech_fun.verify_user_report(db, _user(), "dev-1", 24))

    assert report["found"] is True
    assert report["sessions_in_window"] == 2
    assert len(report["evidence"]) == 3
    assert "does not support" in report["verdict"]


def test_boss_battles_fight_the_oldest_tickets():
    tickets = _Collection([
        {"id": "boss-1", "ticket_number": 9, "title": "Ancient printer saga", "client_name": "A",
         "priority": "high", "tenant_id": "platform-a", "status": "open", "assigned_name": "Terry Tech",
         "created_at": _iso(_now() - timedelta(days=47))},
        {"id": "young", "ticket_number": 10, "title": "Fresh", "client_name": "A",
         "priority": "low", "tenant_id": "platform-a", "status": "open",
         "created_at": _iso(_now() - timedelta(days=2))},
    ])
    comments = _Collection([
        {"ticket_id": "boss-1", "body": "note1"}, {"ticket_id": "boss-1", "body": "note2"},
    ])
    db = _db(tickets=tickets, ticket_comments=comments)

    battles = asyncio.run(tech_fun.boss_battles(db, _user()))

    assert len(battles) == 1
    battle = battles[0]
    assert battle["id"] == "boss-1"
    assert battle["open_days"] >= 45
    assert battle["notes"] == 2
    assert battle["battle_rank"] in {"elite", "epic", "legendary"}


def test_device_personality_tells_the_story_and_spots_unicorns(monkeypatch):
    db = _db(devices=_Collection([{
        "id": "dev-1", "hostname": "SERVER01", "tenant_id": "platform-a", "status": "online",
        "purchase_date": _iso(_now() - timedelta(days=8 * 365)),
    }]))
    monkeypatch.setattr(tech_fun_router, "db", db)

    result = asyncio.run(tech_fun_router.device_personality("dev-1", _user()))

    assert result["found"] is True
    assert result["unicorn"] is True
    assert "retire" in result["assessment"]
    assert result["replacement_note"]
    assert any(row["achievement_id"] == "uptime_unicorn" for row in db.user_achievements.rows)


def test_celebrations_flag_inbox_zero():
    tickets = _Collection([
        {"id": "t1", "ticket_number": 41, "assigned_to": "tech-1", "status": "closed"},
    ])
    db = _db(tickets=tickets)

    result = asyncio.run(tech_fun.celebrations(db, _user(), "Terry Tech"))

    assert result["inbox_zero"] is True
    assert result["open_count"] == 0
    assert result["next_global_milestone"] == 1000


def test_celebrations_handle_prefixed_ticket_numbers():
    # Real installs use forms like SR-0002; the milestone maths must not
    # assume ticket numbers are plain integers.
    tickets = _Collection([
        {"id": "t1", "ticket_number": "SR-0002", "assigned_to": "tech-1", "status": "closed"},
    ])
    db = _db(tickets=tickets)

    result = asyncio.run(tech_fun.celebrations(db, _user(), "Terry Tech"))

    assert result["inbox_zero"] is True
    assert result["latest_ticket_number"] == 2
    assert result["next_global_milestone"] == 1000


def test_derived_badges_cover_the_quality_of_life_catalog(monkeypatch):
    monkeypatch.setattr(tech_fun, "_utcnow", lambda: datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc))
    rows = [
        {"id": "t1", "assigned_to": "tech-1", "status": "closed", "title": "Printer jam again",
         "resolved_at": _iso(datetime(2026, 10, 13, 11, 0, tzinfo=timezone.utc)), "resolution_notes": "It was DNS."},
        {"id": "t2", "assigned_to": "tech-1", "status": "closed", "title": "VPN drops",
         "resolved_at": _iso(datetime(2026, 10, 13, 10, 0, tzinfo=timezone.utc)), "resolution_notes": "patched"},
    ]
    db = _db(tickets=_Collection(rows))

    keys = asyncio.run(tech_fun.derived_badge_keys(db, "tech-1", "Terry Tech"))

    # 2026-10-13 is the second Tuesday of October — Patch Tuesday.
    assert "patch_survivor" in keys
    assert "it_was_dns" in keys
    assert "ticket_zero" in keys  # nothing open
    assert "perfect_week" not in keys


# ============== SHIFT INTELLIGENCE ==============


def test_can_i_go_home_all_clear():
    now = _now()
    db = _db(
        tickets=_Collection([{"id": "t1", "priority": "critical", "status": "closed", "tenant_id": "platform-a"}]),
        devices=_Collection([{"id": "d1", "hostname": "SQL01", "device_type": "server", "status": "online", "tenant_id": "platform-a"}]),
        backup_jobs=_Collection([{"id": "b1", "status": "success", "started_at": _iso(now - timedelta(hours=2))}]),
    )

    result = asyncio.run(tech_fun.can_i_go_home(db, _user(), "Terry Tech"))

    assert result["go_home"] is True
    assert result["verdict"] == "YES. GO HOME. 🏠"
    assert all(check["ok"] for check in result["checks"])


def test_can_i_go_home_names_the_blockers():
    now = _now()
    db = _db(
        tickets=_Collection([{"id": "t1", "priority": "critical", "status": "open", "tenant_id": "platform-a"}]),
        backup_jobs=_Collection([{"id": "b1", "status": "failed", "started_at": _iso(now - timedelta(hours=1))}]),
    )

    result = asyncio.run(tech_fun.can_i_go_home(db, _user(), "Terry Tech"))

    assert result["go_home"] is False
    assert result["verdict"] == "Not quite."
    assert "No P1 tickets" in result["blockers"]
    assert "Backups healthy" in result["blockers"]


def test_weekend_risk_flags_disk_warranty_and_offline():
    now = datetime(2026, 10, 3, 15, 0, tzinfo=timezone.utc)
    db = _db(devices=_Collection([
        {"id": "d1", "hostname": "SRV01", "disk_usage": 91, "status": "online", "tenant_id": "platform-a"},
        {"id": "d2", "hostname": "SRV02", "warranty_expiry": "2026-10-05", "status": "online", "tenant_id": "platform-a"},
        {"id": "d3", "hostname": "SRV03", "status": "offline", "tenant_id": "platform-a"},
        {"id": "d4", "hostname": "SRV04", "warranty_expiry": "2025-09-15", "status": "online", "tenant_id": "platform-a"},
    ]))

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(tech_fun, "_utcnow", lambda: now)
        result = asyncio.run(tech_fun.weekend_risk(db, _user()))

    kinds = {item["kind"] for item in result["items"]}
    assert kinds == {"disk", "warranty", "offline"}
    assert result["count"] == 4
    assert result["items"][0]["severity"] == "high"  # highest severity first
    expired = next(item for item in result["items"] if item["device_id"] == "d4")
    assert "expired" in expired["title"]
    assert expired["severity"] == "high"


def test_caught_up_digest_summarises_absence():
    now = _now()
    since = now - timedelta(hours=8)
    db = _db(
        alerts=_Collection([
            {"id": "a1", "created_at": _iso(now - timedelta(hours=2)), "status": "auto_resolved"},
            {"id": "a2", "created_at": _iso(now - timedelta(hours=2)), "status": "resolved"},
            {"id": "a3", "created_at": _iso(now - timedelta(hours=2)), "status": "open"},
        ]),
        tickets=_Collection([
            {"id": "t1", "assigned_to": "tech-1", "updated_at": _iso(since), "status": "open",
             "priority": "high", "title": "VPN down", "tenant_id": "platform-a"},
        ]),
    )

    result = asyncio.run(tech_fun.caught_up(db, _user(), "Terry Tech", 24))

    assert result["alerts_total"] == 3
    assert result["alerts_resolved"] == 2
    assert result["tickets_updated"] == 1
    assert result["need_to_know"][0]["id"] == "t1"
    assert result["verdict"] == "You didn't miss much."


# ============== OPERATIONAL MEMORY / RISK / FEEDBACK / LABS ==============


def test_operational_memory_is_pinned_and_tenant_scoped():
    db = _db()
    user = _user()

    asyncio.run(tech_fun.pin_memory(db, user, object_type="device", object_id="d1",
                                   text="Don't restart APP01 between 2-4 PM: payroll runs."))
    mine = asyncio.run(tech_fun.list_memory(db, user, "device", "d1"))
    outsider = {**_user("tech-9", "Other Tenant"), "tenant_id": "platform-b"}
    theirs = asyncio.run(tech_fun.list_memory(db, outsider, "device", "d1"))

    assert mine[0]["text"].startswith("Don't restart APP01")
    assert mine[0]["pinned_by"] == "tech-1"
    assert theirs == []


def test_change_risk_score_is_explainable():
    db = _db(devices=_Collection([
        {"id": "d1", "hostname": "SQL01", "device_type": "server", "disk_usage": 95,
         "uptime_hours": 91 * 24, "status": "online", "tenant_id": "platform-a"},
    ]))

    result = asyncio.run(tech_fun.change_risk_score(db, _user(), device_id="d1", description="Patch SQL"))

    assert result["found"] is True
    assert result["score"] >= 75
    assert result["band"] == "Critical"
    assert any("server" in reason.lower() for reason in result["reasons"])
    assert any("maintenance window" in reason.lower() for reason in result["reasons"])
    assert result["recommendation"].startswith("Do not proceed")


def test_change_risk_score_is_low_for_benign_target():
    db = _db(devices=_Collection([
        {"id": "d2", "hostname": "LAPTOP01", "device_type": "workstation", "disk_usage": 40,
         "uptime_hours": 2 * 24, "status": "online", "tenant_id": "platform-a"},
    ]), change_management=_Collection([{"device_id": "d2", "change": "rename"}]),
         backup_jobs=_Collection([{"device_id": "d2", "status": "success",
                                   "started_at": _iso(_now() - timedelta(days=1))}]),
         maintenance_windows=_Collection([{"starts_at": _iso(_now() - timedelta(hours=1)),
                                           "ends_at": _iso(_now() + timedelta(hours=3))}]))

    result = asyncio.run(tech_fun.change_risk_score(db, _user(), device_id="d2", description="Rename device"))

    assert result["score"] == 0
    assert result["band"] == "Low"
    assert result["reasons"] == []


def test_nope_feedback_validates_verdict(monkeypatch):
    db = _db()
    monkeypatch.setattr(tech_fun_router, "db", db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.record_feedback({"verdict": "nope"}, _user()))
    assert exc.value.status_code == 400

    entry = asyncio.run(tech_fun_router.record_feedback(
        {"verdict": "wrong_root_cause", "source_type": "ticket", "source_id": "t1", "note": "It was DNS."},
        _user()))
    assert entry["verdict"] == "wrong_root_cause"
    assert db.nexus_feedback.rows[0]["created_by"] == "tech-1"


def test_nexus_labs_flags_are_admin_only(monkeypatch):
    db = _db()
    monkeypatch.setattr(tech_fun_router, "db", db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(tech_fun_router.update_labs({"flags": {"predictive_ticketing": True}}, _user()))
    assert exc.value.status_code == 403

    admin = {**_user(), "role": "admin"}
    updated = asyncio.run(tech_fun_router.update_labs({"flags": {"predictive_ticketing": True}}, admin))
    read = asyncio.run(tech_fun_router.get_labs(_user()))

    assert updated["flags"]["predictive_ticketing"] is True
    assert read["flags"]["predictive_ticketing"] is True
    assert read["flags"]["failure_prediction"] is False  # untouched flags stay off


def test_device_personality_quips_for_ancient_hardware():
    db = _db(devices=_Collection([
        {"id": "d1", "hostname": "MUSEUM-PC", "os": "Windows XP", "uptime_hours": 2001 * 24,
         "disk_usage": 99, "status": "online", "purchase_date": "2015-06-01", "tenant_id": "platform-a"},
    ]))

    result = asyncio.run(tech_fun.device_personality(db, _user(), "d1"))

    assert "Nexus has contacted a museum." in result["quips"]
    assert any("Prehistoric" in quip for quip in result["quips"])
    assert any("hope" in quip for quip in result["quips"])
    assert any("Obama" in quip for quip in result["quips"])  # pre-2017 firmware vintage


# ============== CONTEXT-AWARENESS ==============


def test_alert_triage_ignores_resource_alert_during_backup():
    now = _now()
    db = _db(
        alerts=_Collection([{"id": "a1", "alert_type": "cpu_high", "message": "CPU is 96%",
                             "device_id": "d1", "created_at": _iso(now), "tenant_id": "platform-a"}]),
        backup_jobs=_Collection([{"id": "b1", "device_id": "d1", "status": "running",
                                  "started_at": _iso(now - timedelta(minutes=10))}]),
    )

    result = asyncio.run(tech_fun.alert_triage(db, _user(), "a1"))

    assert result["verdict"] == "Ignore"
    assert any("Backup" in reason for reason in result["reasons"])
    assert "First occurrence" in result["why_now"]


def test_alert_triage_investigates_unprecedented_security_alert():
    now = _now()
    db = _db(alerts=_Collection([
        {"id": "a1", "alert_type": "unknown_process", "message": "Unrecognised process started",
         "device_id": "d1", "created_at": _iso(now), "tenant_id": "platform-a"},
    ]))

    result = asyncio.run(tech_fun.alert_triage(db, _user(), "a1"))

    assert result["verdict"] == "Investigate"
    assert any("Unrecognised" in reason for reason in result["reasons"])


def test_alert_triage_reports_recurrence_in_why_now():
    now = _now()
    db = _db(alerts=_Collection([
        {"id": "a1", "alert_type": "disk_low", "message": "disk low", "device_id": "d1",
         "created_at": _iso(now), "tenant_id": "platform-a"},
        {"id": "a0", "alert_type": "disk_low", "message": "disk low", "device_id": "d1",
         "created_at": _iso(now - timedelta(days=1)), "tenant_id": "platform-a"},
    ]))

    result = asyncio.run(tech_fun.alert_triage(db, _user(), "a1"))

    assert "Recurring" in result["why_now"]
    assert result["verdict"] in {"Investigate", "Watch"}


def test_blast_radius_counts_what_depends_on_the_device():
    db = _db(
        devices=_Collection([{"id": "d1", "hostname": "SQL02", "client_id": "c1", "client_name": "Acme",
                              "site_name": "SITE02", "tenant_id": "platform-a"}]),
        tickets=_Collection([
            {"id": "t1", "device_id": "d1", "status": "open", "tenant_id": "platform-a"},
            {"id": "t2", "device_id": "d1", "status": "closed", "tenant_id": "platform-a"},
        ]),
    )

    result = asyncio.run(tech_fun.blast_radius(db, _user(), "d1"))

    assert result["found"] is True
    assert "Acme / SITE02" in result["headline"]
    assert result["open_tickets"] == 1  # the closed one does not count
    assert any("work in flight" in impact for impact in result["impacts"])


def test_work_lock_blocks_second_technician():
    db = _db()
    first = asyncio.run(tech_fun.acquire_work_lock(db, _user(), "Terry Tech", device_id="d1", ticket_id="INC-1"))
    second = asyncio.run(tech_fun.acquire_work_lock(db, {**_user("tech-2", "Brett Tech")}, "Brett Tech", device_id="d1"))

    assert first["acquired"] is True
    assert second["acquired"] is False
    assert second["held_by"] == "Terry Tech"

    status = asyncio.run(tech_fun.work_lock_status(db, {**_user("tech-2", "Brett Tech")}, "d1"))
    assert status["safe_to_proceed"] is False
    assert any("Terry Tech" in blocker for blocker in status["blockers"])

    # "Take Ownership" is a deliberate, recorded take-over.
    takeover = asyncio.run(tech_fun.acquire_work_lock(
        db, {**_user("tech-2", "Brett Tech")}, "Brett Tech", device_id="d1", force=True))
    assert takeover["acquired"] is True
    assert takeover["taken_from"] == "Terry Tech"


def test_handover_digest_shape_and_recommendation():
    now = _now()
    db = _db(tickets=_Collection([
        {"id": "t1", "ticket_number": "INC-1", "title": "VPN down", "client_name": "Acme",
         "priority": "high", "assigned_to": "tech-1", "assigned_name": "Terry Tech", "status": "open",
         "device_hostname": "vpn-gw", "tenant_id": "platform-a"},
        {"id": "t0", "ticket_number": "INC-0", "title": "VPN down earlier", "status": "closed",
         "device_hostname": "vpn-gw", "assigned_name": "Brett Tech", "tenant_id": "platform-a"},
    ]))

    result = asyncio.run(tech_fun.handover(db, _user(), "Terry Tech"))

    assert result["active_issues"][0]["id"] == "t1"
    assert result["customer_waiting"][0]["id"] == "t1"
    assert "Brett Tech" in (result["recommendation"] or "")


def test_customer_cost_report_compares_demand_to_peers():
    rows = []
    for index in range(8):
        rows.append({"id": f"hot-{index}", "client_id": "c1", "category": "legacy_app",
                     "total_time_minutes": 60, "tenant_id": "platform-a"})
    for index in range(2):
        rows.append({"id": f"cool-{index}", "client_id": "c2", "category": "other",
                     "total_time_minutes": 30, "tenant_id": "platform-a"})
    db = _db(
        clients=_Collection([{"id": "c1", "name": "Acme", "tenant_id": "platform-a"}]),
        tickets=_Collection(rows),
        users=_Collection([{"id": "u1", "hourly_rate": 100.0}]),
    )

    result = asyncio.run(tech_fun.customer_cost_report(db, _user(), "c1"))

    assert result["found"] is True
    assert result["total_tickets"] == 8
    assert result["peer_median_tickets"] == 2
    assert result["demand_ratio"] == 4.0
    assert result["drivers"][0]["category"] == "legacy_app"
    assert result["estimated_delivery_cost"] == 800  # 8h × $100
    assert "generates 4.0×" in result["verdict"]
