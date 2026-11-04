import asyncio
from datetime import datetime, timezone

import pytest

from app.routers.executive_intelligence import (
    _load_executive_state,
    build_board_brief,
    build_executive_scenario,
    build_mrr_target_progress,
    build_profit_killers,
    build_receivables_aging,
    build_renewal_calendar,
    build_revenue_concentration,
    build_revenue_trend,
    normalise_mrr_target,
    normalise_scenario,
    normalise_window,
)
from app.services.action_permissions import ACTION_PERMISSION_IDS, default_permissions_for_role
from app.services.platform_foundation import EVENT_SUBJECTS


async def _allow_global_scope(*args, **kwargs):
    """The live scope guard needs a request object; these tests exercise the handler body."""
    return None


def test_normalise_scenario_retains_only_bounded_inputs():
    scenario = normalise_scenario({
        "name": "  Lose biggest client  ",
        "lost_client_id": "client-001",
        "pricing_change_pct": 7.5,
        "new_monthly_cost": 8500,
        "cash_reserve": 125000,
        "unexpected": "ignored",
    })
    assert scenario == {
        "name": "Lose biggest client",
        "lost_client_id": "client-001",
        "pricing_change_pct": 7.5,
        "new_monthly_cost": 8500.0,
        "cash_reserve": 125000.0,
    }


@pytest.mark.parametrize("field,value", [
    ("pricing_change_pct", 26),
    ("pricing_change_pct", -26),
    ("new_monthly_cost", -1),
    ("cash_reserve", -1),
])
def test_normalise_scenario_rejects_unsafe_ranges(field, value):
    with pytest.raises(ValueError):
        normalise_scenario({field: value})


def test_scenario_is_non_mutating_and_explains_the_math():
    result = build_executive_scenario(
        {"mrr": 10000, "recorded_direct_cost": 3000},
        {"client-001": 4000, "client-002": 6000},
        [{"id": "client-001", "name": "Anchor Client"}, {"id": "client-002", "name": "Other Client"}],
        normalise_scenario({
            "name": "Resilience",
            "lost_client_id": "client-001",
            "pricing_change_pct": 10,
            "new_monthly_cost": 1000,
        }),
    )
    assert result["will_execute"] is False
    assert result["baseline_mrr"] == 10000
    assert result["projected_mrr"] == 6600
    assert result["mrr_delta"] == -3400
    assert result["lost_client"]["name"] == "Anchor Client"
    assert result["projected_service_contribution"] == 2600
    assert len(result["assumptions"]) == 4


def test_load_executive_state_scopes_client_health_with_the_requesting_user(monkeypatch):
    """Client health enforces tenant scope, so the executive loader must forward the requesting user."""
    from app.routers import executive_intelligence as executive

    class _Cursor:
        def __init__(self, rows):
            self._rows = rows

        def sort(self, *args, **kwargs):
            return self

        async def to_list(self, limit=None):
            return list(self._rows)

    class _Collection:
        def __init__(self, rows=()):
            self._rows = rows

        def find(self, *args, **kwargs):
            return _Cursor(self._rows)

        async def find_one(self, *args, **kwargs):
            return self._rows[0] if self._rows else None

    class _FakeDb:
        def __init__(self, rows):
            self._rows = rows

        def __getattr__(self, name):
            return _Collection(self._rows.get(name, []))

    user = {"id": "user-1", "tenant_id": "tenant-1"}
    monkeypatch.setattr(executive, "db", _FakeDb({
        "clients": [{"id": "client-1", "name": "Anchor Client", "tenant_id": "tenant-1"}],
    }))

    seen = {}

    async def _fake_compute_health(client, current_user):
        seen["client_id"] = client.get("id")
        seen["current_user"] = current_user
        return {"client_id": client.get("id"), "health_score": 72}

    monkeypatch.setattr(executive, "_compute_health", _fake_compute_health)

    state = asyncio.run(_load_executive_state(user))

    assert seen["client_id"] == "client-1"
    assert seen["current_user"] is user
    assert isinstance(state, dict)


def test_scenario_does_not_invent_contribution_without_cost_evidence():
    result = build_executive_scenario(
        {"mrr": 10000, "recorded_direct_cost": None},
        {},
        [],
        normalise_scenario({"pricing_change_pct": 5}),
    )
    assert result["projected_mrr"] == 10500
    assert result["projected_service_contribution"] is None
    assert result["cash_runway_months"] is None


def test_profit_killers_compare_revenue_share_to_service_burden():
    findings = build_profit_killers(
        [{"id": "a", "name": "Calm Client"}, {"id": "b", "name": "Heavy Client"}],
        {"a": 8000, "b": 2000},
        [
            {"client_id": "a", "created_at": "2026-07-20T10:00:00+00:00"},
            *[
                {"client_id": "b", "created_at": f"2026-07-{10 + index:02d}T20:00:00+00:00"}
                for index in range(9)
            ],
        ],
        [
            {"client_id": "a", "minutes": 60},
            {"client_id": "b", "minutes": 600},
        ],
    )
    heavy = next(item for item in findings if item["client_id"] == "b")
    assert heavy["service_burden_share_pct"] > heavy["revenue_share_pct"]
    assert heavy["after_hours_tickets_30d"] == 9
    assert "contract-backed MRR" in heavy["explanation"]
    assert "profit" not in heavy["explanation"].lower()


def test_board_brief_marks_missing_forecast_inputs():
    brief = build_board_brief(
        {
            "mrr": 20000,
            "net_cash_30d": -5000,
            "collection_rate": 92,
            "average_client_health": 82,
            "at_risk_clients": 0,
            "assessed_clients": 4,
        },
        [{
            "severity": "high",
            "title": "Two renewals need attention",
            "decision": "Assign renewal owners.",
        }],
        [],
        [{"label": "Direct cost coverage", "state": "missing"}],
    )
    assert brief["wins"]
    assert brief["decisions"] == ["Assign renewal owners."]
    assert any("Direct cost coverage" in item for item in brief["outlook"])
    assert "not an accounting opinion" in brief["method"]


def test_executive_permissions_are_admin_only_by_default():
    required = {
        "executive.intelligence.view",
        "executive.scenario.simulate",
        "executive.board.snapshot",
        "executive.watchlist.manage",
        "executive.mrr_target.manage",
    }
    assert required <= ACTION_PERMISSION_IDS
    assert required.isdisjoint(default_permissions_for_role("technician"))
    assert required.isdisjoint(default_permissions_for_role("service_desk_manager"))
    assert required <= set(default_permissions_for_role("admin"))


def test_executive_events_are_declared_in_platform_contract():
    subjects = {item["subject"] for item in EVENT_SUBJECTS}
    assert "executive.scenario.simulated" in subjects
    assert "executive.board.snapshot.saved" in subjects
    assert "executive.watchlist.changed" in subjects
    assert "executive.mrr_target.changed" in subjects


# --- Owner period -----------------------------------------------------------

def test_normalise_window_accepts_only_the_reviewed_periods():
    assert normalise_window(30) == 30
    assert normalise_window("90") == 90
    assert normalise_window(365) == 365
    for rejected in (0, 7, 400, None, "all", "", True, {}):
        assert normalise_window(rejected) == 30


# --- Receivables ageing -----------------------------------------------------

def test_receivables_aging_buckets_from_the_recorded_due_date():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    aging = build_receivables_aging(
        [
            {"total": 1000, "amount_paid": 0, "due_date": "2026-09-15"},
            {"total": 500, "amount_paid": 0, "due_date": "2026-08-10"},
            {"total": 300, "amount_paid": 0, "due_date": "2026-07-01"},
            {"total": 200, "amount_paid": 0, "due_date": "2026-03-01"},
            {"total": 400, "amount_paid": 400, "due_date": "2026-01-01"},
            {"total": 250, "amount_paid": 0},
        ],
        now,
    )
    buckets = {bucket["key"]: bucket for bucket in aging["buckets"]}
    assert buckets["not_due"]["total"] == 1000
    assert buckets["overdue_1_30"]["total"] == 500
    assert buckets["overdue_31_60"]["total"] == 300
    assert buckets["overdue_90_plus"]["total"] == 200
    # An invoice with no due date is disclosed, never silently treated as current.
    assert buckets["undated"]["total"] == 250
    assert aging["outstanding_total"] == 2250
    assert aging["overdue_total"] == 1000
    assert aging["oldest_overdue_days"] == 172
    assert buckets["overdue_90_plus"]["overdue"] is True
    assert buckets["undated"]["overdue"] is False


def test_receivables_aging_claims_no_evidence_without_a_ledger():
    aging = build_receivables_aging([], datetime(2026, 8, 20, tzinfo=timezone.utc))
    assert aging["state"] == "insufficient_evidence"
    assert aging["outstanding_total"] == 0
    assert aging["oldest_overdue_days"] is None
    assert all(bucket["share_pct"] is None for bucket in aging["buckets"])


# --- Revenue concentration --------------------------------------------------

def test_revenue_concentration_states_share_not_churn_probability():
    result = build_revenue_concentration(
        {"a": 8000, "b": 1000, "c": 1000},
        {"a": "Anchor", "b": "Small", "c": "Other"},
    )
    assert result["level"] == "dependency"
    assert result["top_client"]["share_pct"] == 80.0
    assert result["top_three_share_pct"] == 100.0
    assert result["top_client"]["name"] == "Anchor"
    assert "Anchor" in result["detail"]
    assert "not a churn probability" in result["method"]


def test_revenue_concentration_bands_spread_and_concentrated_shares():
    concentrated = build_revenue_concentration({"a": 330, "b": 300, "c": 250, "d": 120})
    assert concentrated["level"] == "concentrated"
    assert concentrated["top_client"]["share_pct"] == 33.0
    spread = build_revenue_concentration({key: 200 for key in "abcde"})
    assert spread["level"] == "spread"
    assert spread["top_client"]["share_pct"] == 20.0


def test_revenue_concentration_never_calls_absent_revenue_diversified():
    result = build_revenue_concentration({"a": 0})
    assert result["state"] == "insufficient_evidence"
    assert result["level"] == "insufficient_evidence"
    assert result["top_client"] is None


# --- Renewal calendar -------------------------------------------------------

def test_renewal_calendar_uses_recorded_end_dates_only():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    calendar = build_renewal_calendar(
        [
            {"id": "c1", "client_id": "a", "end_date": "2026-09-01", "monthly_value": 500},
            {"id": "c2", "client_id": "b", "end_date": "2027-06-01", "monthly_value": 900},
            {"id": "c3", "client_id": "a", "monthly_value": 400},
        ],
        [{"id": "a", "name": "Anchor"}, {"id": "b", "name": "Bravo"}],
        now,
    )
    assert [row["contract_id"] for row in calendar["rows"]] == ["c1"]
    assert calendar["rows"][0]["client_name"] == "Anchor"
    assert calendar["rows"][0]["urgency"] == "immediate"
    assert calendar["total_value"] == 500
    assert "without an end date are not listed" in calendar["method"]


def test_renewal_calendar_reports_an_empty_state_rather_than_assuming_evergreen():
    calendar = build_renewal_calendar([], [], datetime(2026, 8, 20, tzinfo=timezone.utc))
    assert calendar["state"] == "insufficient_evidence"
    assert calendar["rows"] == []
    assert calendar["total_value"] == 0


# --- Revenue trend ----------------------------------------------------------

def test_revenue_trend_keys_months_and_excludes_voided_invoices():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    trend = build_revenue_trend(
        [
            {"total": 1000, "amount_paid": 1000, "created_at": "2026-08-02T00:00:00+00:00", "status": "issued"},
            {"total": 400, "amount_paid": 0, "created_at": "2026-07-15T00:00:00+00:00", "status": "issued"},
            {"total": 9999, "amount_paid": 0, "created_at": "2026-08-05T00:00:00+00:00", "status": "voided"},
        ],
        now,
        months=3,
    )
    months = {row["key"]: row for row in trend["months"]}
    assert months["2026-08"]["invoiced"] == 1000
    assert months["2026-08"]["collected"] == 1000
    assert months["2026-07"]["invoiced"] == 400
    assert months["2026-06"]["count"] == 0
    assert trend["recorded_months"] == 2
    assert trend["state"] == "verified"


def test_revenue_trend_needs_more_than_one_recorded_month_to_draw_a_trend():
    trend = build_revenue_trend(
        [{"total": 500, "amount_paid": 0, "created_at": "2026-08-02T00:00:00+00:00", "status": "issued"}],
        datetime(2026, 8, 20, tzinfo=timezone.utc),
        months=3,
    )
    assert trend["state"] == "insufficient_evidence"


# --- Recorded MRR goal ------------------------------------------------------

def test_normalise_mrr_target_requires_a_bounded_amount():
    assert normalise_mrr_target({"target_mrr": 60000, "target_month": "2027-06", "note": "  Board plan  "}) == {
        "target_mrr": 60000.0,
        "target_month": "2027-06",
        "note": "Board plan",
    }
    # A target month is optional: progress is still measurable without one.
    assert normalise_mrr_target({"target_mrr": "45000.5"})["target_month"] is None


@pytest.mark.parametrize("payload", [
    {},
    {"target_mrr": None},
    {"target_mrr": ""},
    {"target_mrr": 0},
    {"target_mrr": -1},
    {"target_mrr": 1_000_000_001},
    {"target_mrr": 60000, "target_month": "June 2027"},
    {"target_mrr": 60000, "target_month": "2027-6"},
    {"target_mrr": 60000, "target_month": "1999-12"},
    {"target_mrr": 60000, "target_month": "2101-01"},
    {"target_mrr": 60000, "target_month": "2027-13"},
])
def test_normalise_mrr_target_rejects_an_unusable_goal(payload):
    with pytest.raises(ValueError):
        normalise_mrr_target(payload)


def test_mrr_target_absent_is_never_rendered_as_zero_progress():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    progress = build_mrr_target_progress(None, 42000, now)
    assert progress["state"] == "not_recorded"
    assert progress["target_mrr"] is None
    assert progress["progress_pct"] is None
    assert progress["gap"] is None
    assert progress["current_mrr"] == 42000
    # With no goal there is no starting line and no growth to state.
    assert progress["starting_mrr"] is None
    assert progress["starting_recorded_at"] is None
    assert progress["growth"] is None
    assert progress["growth_pct"] is None
    assert "no goal is assumed" in progress["method"]


def test_mrr_target_progress_states_the_gap_and_the_required_step():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    progress = build_mrr_target_progress(
        {"target_mrr": 60000, "target_month": "2027-02", "note": "Board plan", "recorded_by": "Owner"},
        45000,
        now,
    )
    assert progress["state"] == "in_progress"
    assert progress["target_month_label"] == "Feb 2027"
    assert progress["months_remaining"] == 6
    assert progress["progress_pct"] == 75.0
    assert progress["gap"] == 15000
    # 15000 over 6 whole months, as arithmetic rather than a forecast.
    assert progress["required_monthly_growth"] == 2500
    assert progress["required_growth_pct_per_month"] == 5.6
    assert progress["note"] == "Board plan"


def test_mrr_target_progress_states_growth_from_the_recorded_starting_line():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    progress = build_mrr_target_progress(
        {
            "target_mrr": 60000,
            "target_month": "2027-02",
            "starting_mrr": 38900,
            "starting_recorded_at": "2026-02-01T00:00:00+00:00",
        },
        45000,
        now,
    )
    assert progress["starting_mrr"] == 38900
    assert progress["starting_recorded_at"] == "2026-02-01T00:00:00+00:00"
    assert progress["growth"] == 6100
    assert progress["growth_pct"] == 15.7


def test_mrr_target_progress_never_measures_growth_from_an_unrecorded_zero():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    progress = build_mrr_target_progress({"target_mrr": 60000, "target_month": "2027-02"}, 45000, now)
    # A goal recorded before any revenue evidence carries no starting line, so the
    # distance to target is stated but no growth is.
    assert progress["starting_mrr"] is None
    assert progress["starting_recorded_at"] is None
    assert progress["growth"] is None
    assert progress["growth_pct"] is None
    assert progress["progress_pct"] == 75.0


def test_mrr_target_progress_reports_a_fall_when_the_run_rate_dropped():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    progress = build_mrr_target_progress(
        {"target_mrr": 60000, "starting_mrr": 50000},
        42000,
        now,
    )
    assert progress["growth"] == -8000
    assert progress["growth_pct"] == -16.0


def test_mrr_target_progress_states_no_percentage_from_a_zero_starting_line():
    # A start of $0 is a real recorded figure, but a percentage growth from it
    # would be a division the owner cannot read, so only dollars are stated.
    progress = build_mrr_target_progress(
        {"target_mrr": 60000, "starting_mrr": 0},
        5000,
        datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    assert progress["starting_mrr"] == 0
    assert progress["growth"] == 5000
    assert progress["growth_pct"] is None


def test_mrr_target_progress_marks_a_lapsed_goal_overdue_rather_than_behind():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    progress = build_mrr_target_progress({"target_mrr": 60000, "target_month": "2026-06"}, 45000, now)
    assert progress["state"] == "overdue"
    assert progress["months_remaining"] == -2
    # There is no time left to pace into, so Nexus states no required step at all.
    assert progress["required_monthly_growth"] is None


def test_mrr_target_progress_reports_achievement_with_the_surplus():
    now = datetime(2026, 8, 20, tzinfo=timezone.utc)
    progress = build_mrr_target_progress({"target_mrr": 40000, "target_month": "2026-06"}, 45000, now)
    assert progress["state"] == "achieved"
    assert progress["progress_pct"] == 112.5
    assert progress["gap"] == -5000
    assert progress["required_monthly_growth"] is None


def test_mrr_target_progress_claims_no_pace_feet_without_a_recorded_month():
    progress = build_mrr_target_progress(
        {"target_mrr": 60000},
        30000,
        datetime(2026, 8, 20, tzinfo=timezone.utc),
    )
    assert progress["state"] == "in_progress"
    assert progress["progress_pct"] == 50.0
    assert progress["months_remaining"] is None
    assert progress["required_monthly_growth"] is None


def test_board_brief_names_the_recorded_goal():
    brief = build_board_brief(
        {"mrr": 45000},
        [],
        [],
        [],
        {
            "state": "in_progress",
            "target_mrr": 60000,
            "target_month_label": "Feb 2027",
            "progress_pct": 75.0,
        },
    )
    assert any("$60,000" in item and "75.0%" in item for item in brief["outlook"])


def test_board_brief_states_growth_since_the_goal_was_recorded():
    brief = build_board_brief(
        {"mrr": 45000},
        [],
        [],
        [],
        {
            "state": "in_progress",
            "target_mrr": 60000,
            "target_month_label": "Feb 2027",
            "progress_pct": 75.0,
            "starting_mrr": 38900,
            "growth": 6100,
            "growth_pct": 15.7,
        },
    )
    goal_line = next(item for item in brief["outlook"] if "$60,000" in item)
    assert "growth of $6,100 (+15.7%) from the $38,900 run rate recorded with the goal" in goal_line
    # The retained evidence-constraint line is not displaced by the growth clause.
    assert len(brief["outlook"]) <= 4


def test_board_brief_calls_a_flat_run_rate_unchanged_rather_than_zero_growth():
    brief = build_board_brief(
        {"mrr": 38900},
        [],
        [],
        [],
        {
            "state": "in_progress",
            "target_mrr": 60000,
            "progress_pct": 64.8,
            "starting_mrr": 38900,
            "growth": 0,
            "growth_pct": 0.0,
        },
    )
    goal_line = next(item for item in brief["outlook"] if "$60,000" in item)
    assert "no change from the $38,900 run rate recorded with the goal" in goal_line
    assert "growth of $0" not in goal_line


def test_board_brief_states_no_growth_for_a_goal_without_a_starting_line():
    brief = build_board_brief(
        {"mrr": 45000},
        [],
        [],
        [],
        {
            "state": "achieved",
            "target_mrr": 40000,
            "progress_pct": 112.5,
            "starting_mrr": None,
            "growth": None,
        },
    )
    assert all("run rate recorded with the goal" not in item for item in [*brief["outlook"], *brief["wins"]])
    # A fall is never reported as growth.
    falling = build_board_brief(
        {"mrr": 45000},
        [],
        [],
        [],
        {"state": "in_progress", "target_mrr": 60000, "progress_pct": 75.0, "starting_mrr": 50000, "growth": -5000, "growth_pct": -10.0},
    )
    assert any("a fall of $5,000 (-10.0%)" in item for item in falling["outlook"])


def _target_db(goal=None):
    state = {"goal": dict(goal) if goal else None, "inserts": [], "updates": []}

    class _Cursor:
        def __init__(self, payload):
            self._payload = payload

        def sort(self, *args, **kwargs):
            return self

        async def to_list(self, limit=None):
            return list(self._payload)

    class _Collection:
        def __init__(self, name):
            self._name = name

        def find(self, *args, **kwargs):
            return _Cursor([])

        async def find_one(self, *args, **kwargs):
            if self._name == "executive_mrr_targets" and state["goal"]:
                return dict(state["goal"])
            return None

        async def insert_one(self, document):
            state["inserts"].append(dict(document))
            state["goal"] = dict(document)

        async def update_one(self, query, update):
            state["updates"].append({"query": query, "update": update})
            merged = dict(state["goal"] or {})
            merged.update(update.get("$set", {}))
            state["goal"] = merged

    class _FakeDb:
        def __getattr__(self, name):
            return _Collection(name)

    return _FakeDb(), state


def test_mrr_target_is_tenant_scoped_and_recording_twice_is_a_no_op(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db()
    events = []

    async def _capture(**kwargs):
        events.append(kwargs["subject"])

    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)
    monkeypatch.setattr(executive, "emit_platform_event", _capture)

    user = {"id": "user-1", "tenant_id": "tenant-1"}
    payload = {"target_mrr": 60000, "target_month": "2027-06", "note": "Board plan"}
    first = asyncio.run(executive.record_mrr_target(payload, request=None, current_user=user))
    second = asyncio.run(executive.record_mrr_target(payload, request=None, current_user=user))

    assert first["created"] is True
    # Re-recording the same goal writes nothing and audits nothing a second time.
    assert second["created"] is False
    assert len(state["inserts"]) == 1
    assert state["updates"] == []
    assert events == ["executive.mrr_target.changed"]
    assert state["goal"]["tenant_id"] == "tenant-1"
    assert state["goal"]["target_mrr"] == 60000.0


def test_revising_the_goal_retains_the_one_it_replaced(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db({
        "id": "goal-1",
        "tenant_id": "tenant-1",
        "target_mrr": 50000.0,
        "target_month": "2027-01",
        "note": "Original",
        "revisions": [],
    })
    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    async def _capture(**kwargs):
        return None

    monkeypatch.setattr(executive, "emit_platform_event", _capture)

    result = asyncio.run(executive.record_mrr_target(
        {"target_mrr": 75000, "target_month": "2027-06"},
        request=None,
        current_user={"id": "user-1", "tenant_id": "tenant-1"},
    ))

    assert result["created"] is False
    revisions = state["goal"]["revisions"]
    assert revisions[0]["target_mrr"] == 50000.0
    assert revisions[0]["note"] == "Original"
    assert state["goal"]["target_mrr"] == 75000.0
    assert state["updates"][0]["query"] == {"id": "goal-1"}


def _fake_state_loader(mrr, revenue_state="verified"):
    """A stand-in briefing whose only interesting facts are the run rate and its evidence state."""
    payload = {
        "summary": {"mrr": mrr},
        "data_quality": [{"id": "revenue", "state": revenue_state}],
        "mrr_target": {"state": "not_recorded"},
    }

    async def _load(*args, **kwargs):
        return dict(payload)

    return _load


def test_recording_a_goal_captures_the_current_run_rate_as_its_starting_line(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db()
    events = []

    async def _capture(**kwargs):
        events.append(kwargs["payload"])

    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)
    monkeypatch.setattr(executive, "emit_platform_event", _capture)
    monkeypatch.setattr(executive, "_load_executive_state", _fake_state_loader(38900))

    asyncio.run(executive.record_mrr_target(
        {"target_mrr": 60000, "target_month": "2027-06"},
        request=None,
        current_user={"id": "user-1", "tenant_id": "tenant-1"},
    ))

    assert state["goal"]["starting_mrr"] == 38900
    assert state["goal"]["starting_recorded_at"] is not None
    assert state["goal"]["starting_evidence_state"] == "verified"
    # The audit trail records the line the goal was recorded against.
    assert events[0]["starting_mrr"] == 38900


def test_a_goal_recorded_without_revenue_evidence_records_no_starting_line(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db()
    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    async def _capture(**kwargs):
        return None

    monkeypatch.setattr(executive, "emit_platform_event", _capture)
    monkeypatch.setattr(executive, "_load_executive_state", _fake_state_loader(0, revenue_state="missing"))

    asyncio.run(executive.record_mrr_target(
        {"target_mrr": 60000},
        request=None,
        current_user={"id": "user-1", "tenant_id": "tenant-1"},
    ))

    # $0 here is "no revenue evidence", not a recorded starting run rate.
    assert state["goal"]["starting_mrr"] is None
    assert state["goal"]["starting_recorded_at"] is None
    assert state["goal"]["starting_evidence_state"] == "missing"


def test_revising_the_goal_keeps_the_run_rate_it_was_recorded_against(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db({
        "id": "goal-1",
        "tenant_id": "tenant-1",
        "target_mrr": 50000.0,
        "target_month": "2027-01",
        "note": "Original",
        "starting_mrr": 38900.0,
        "starting_recorded_at": "2026-02-01T00:00:00+00:00",
        "starting_evidence_state": "verified",
        "revisions": [],
    })
    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    async def _capture(**kwargs):
        return None

    monkeypatch.setattr(executive, "emit_platform_event", _capture)
    # The current run rate is deliberately different: revising the target must not
    # re-baseline the growth the owner has already achieved.
    monkeypatch.setattr(executive, "_load_executive_state", _fake_state_loader(46000))

    asyncio.run(executive.record_mrr_target(
        {"target_mrr": 75000, "target_month": "2027-06"},
        request=None,
        current_user={"id": "user-1", "tenant_id": "tenant-1"},
    ))

    assert state["goal"]["starting_mrr"] == 38900.0
    assert state["goal"]["starting_recorded_at"] == "2026-02-01T00:00:00+00:00"
    # The goal it replaced keeps the starting line it was measured against.
    assert state["goal"]["revisions"][0]["starting_mrr"] == 38900.0


def test_clearing_the_goal_retains_the_value_as_its_last_revision(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db({
        "id": "goal-1",
        "tenant_id": "tenant-1",
        "target_mrr": 50000.0,
        "target_month": "2027-01",
        "note": "Original",
        "starting_mrr": 41000.0,
        "starting_recorded_at": "2026-02-01T00:00:00+00:00",
        "revisions": [],
    })
    events = []

    async def _capture(**kwargs):
        events.append(kwargs["payload"]["action"])

    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)
    monkeypatch.setattr(executive, "emit_platform_event", _capture)

    result = asyncio.run(executive.clear_mrr_target(
        request=None,
        current_user={"id": "user-1", "tenant_id": "tenant-1"},
    ))

    assert result["cleared"] is True
    assert result["removed_target_mrr"] == 50000.0
    assert state["goal"]["revisions"][0]["target_mrr"] == 50000.0
    assert events == ["cleared"]
    # The start line goes with the goal it measured, and is retained in the goal it
    # superseded rather than silently becoming the next goal's baseline.
    assert state["goal"]["starting_mrr"] is None
    assert state["goal"]["starting_recorded_at"] is None
    assert state["goal"]["revisions"][0]["starting_mrr"] == 41000.0
    assert result["mrr_target"]["state"] == "not_recorded"
    assert result["mrr_target"]["starting_mrr"] is None
    assert result["mrr_target"]["growth"] is None
    # Nothing is assumed again once the goal is cleared.
    assert result["mrr_target"]["target_mrr"] is None


def test_a_goal_recorded_after_a_clear_still_keeps_the_earlier_goals(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db({
        "id": "goal-1",
        "tenant_id": "tenant-1",
        "target_mrr": 50000.0,
        "target_month": "2027-01",
        "note": "Original",
        "revisions": [],
    })
    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    async def _capture(**kwargs):
        return None

    monkeypatch.setattr(executive, "emit_platform_event", _capture)
    user = {"id": "user-1", "tenant_id": "tenant-1"}

    asyncio.run(executive.clear_mrr_target(request=None, current_user=user))
    asyncio.run(executive.record_mrr_target(
        {"target_mrr": 80000, "target_month": "2027-09"},
        request=None,
        current_user=user,
    ))

    # Clearing is not a way to erase a target: the superseded goal is still retained.
    revisions = state["goal"]["revisions"]
    assert [row["target_mrr"] for row in revisions] == [50000.0]
    assert revisions[0]["changed_by"] == "user-1"
    assert state["goal"]["target_mrr"] == 80000.0


def test_clearing_a_goal_that_was_never_recorded_is_refused(monkeypatch):
    from fastapi import HTTPException

    from app.routers import executive_intelligence as executive

    fake_db, _state = _target_db()
    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    with pytest.raises(HTTPException) as error:
        asyncio.run(executive.clear_mrr_target(
            request=None,
            current_user={"id": "user-1", "tenant_id": "tenant-1"},
        ))
    assert error.value.status_code == 404


def test_an_unsafe_goal_is_rejected_before_anything_is_written(monkeypatch):
    from fastapi import HTTPException

    from app.routers import executive_intelligence as executive

    fake_db, state = _target_db()
    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    with pytest.raises(HTTPException) as error:
        asyncio.run(executive.record_mrr_target(
            {"target_mrr": -50},
            request=None,
            current_user={"id": "user-1", "tenant_id": "tenant-1"},
        ))
    assert error.value.status_code == 400
    assert state["inserts"] == []
    assert state["updates"] == []


# --- Owner watchlist --------------------------------------------------------

def _watchlist_db(rows):
    seen = {"watchlist_queries": []}

    class _Cursor:
        def __init__(self, payload):
            self._payload = payload

        def sort(self, *args, **kwargs):
            return self

        async def to_list(self, limit=None):
            return list(self._payload)

    class _Collection:
        def __init__(self, name, payload):
            self._name = name
            self._payload = payload

        def find(self, query=None, *args, **kwargs):
            if self._name == "executive_watchlist":
                seen["watchlist_queries"].append(query)
            return _Cursor(self._payload)

    class _FakeDb:
        def __getattr__(self, name):
            return _Collection(name, rows.get(name, []))

    return _FakeDb(), seen


def test_owner_watchlist_is_partitioned_by_tenant_and_user(monkeypatch):
    from app.routers import executive_intelligence as executive

    fake_db, seen = _watchlist_db({
        "executive_watchlist": [
            {"client_id": "client-1", "note": "Watch cash", "created_at": "2026-08-01T00:00:00+00:00"},
            {"client_id": "client-other-tenant", "note": "Elsewhere", "created_at": "2026-08-02T00:00:00+00:00"},
        ],
        "clients": [{"id": "client-1", "name": "Anchor"}],
    })
    monkeypatch.setattr(executive, "db", fake_db)
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    payload = asyncio.run(executive.list_executive_watchlist(
        request=None,
        current_user={"id": "user-1", "tenant_id": "tenant-1"},
    ))

    assert seen["watchlist_queries"][0] == {"tenant_id": "tenant-1", "user_id": "user-1"}
    assert [row["client_id"] for row in payload["watchlist"]] == ["client-1"]
    assert payload["watchlist"][0]["client_name"] == "Anchor"


def test_watchlist_add_is_idempotent_and_emits_the_audited_event(monkeypatch):
    from app.routers import executive_intelligence as executive

    rows = []
    events = []

    class _Cursor:
        def __init__(self, payload):
            self._payload = payload

        def sort(self, *args, **kwargs):
            return self

        async def to_list(self, limit=None):
            return list(self._payload)

    class _Watchlist:
        async def find_one(self, query=None, *args, **kwargs):
            for row in rows:
                if row["client_id"] == (query or {}).get("client_id"):
                    return dict(row)
            return None

        def find(self, *args, **kwargs):
            return _Cursor(rows)

        async def insert_one(self, document):
            rows.append(dict(document))

    class _Clients:
        async def find_one(self, query=None, *args, **kwargs):
            clauses = (query or {}).get("$and") or []
            target = (clauses[-1] if clauses else {}).get("id")
            return {"id": target, "name": "Anchor"} if target == "client-1" else None

        def find(self, *args, **kwargs):
            return _Cursor([{"id": "client-1", "name": "Anchor"}])

    class _FakeDb:
        def __getattr__(self, name):
            return _Clients() if name == "clients" else _Watchlist()

    async def _capture(**kwargs):
        events.append(kwargs["subject"])

    monkeypatch.setattr(executive, "db", _FakeDb())
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)
    monkeypatch.setattr(executive, "emit_platform_event", _capture)

    user = {"id": "user-1", "tenant_id": "tenant-1"}
    first = asyncio.run(executive.add_executive_watchlist_entry(
        {"client_id": "client-1", "note": "Cash risk"}, request=None, current_user=user,
    ))
    second = asyncio.run(executive.add_executive_watchlist_entry(
        {"client_id": "client-1", "note": "Cash risk"}, request=None, current_user=user,
    ))

    assert first["created"] is True
    # A repeat of the same intent is a no-op, not a duplicate row and not a second audit event.
    assert second["created"] is False
    assert len(rows) == 1
    assert events == ["executive.watchlist.changed"]
    assert rows[0]["tenant_id"] == "tenant-1"
    assert rows[0]["user_id"] == "user-1"
    assert rows[0]["note"] == "Cash risk"


def test_watchlist_refuses_a_client_that_is_not_visible_in_the_tenant(monkeypatch):
    from fastapi import HTTPException

    from app.routers import executive_intelligence as executive

    class _Collection:
        async def find_one(self, *args, **kwargs):
            return None

        def find(self, *args, **kwargs):
            raise AssertionError("a watchlist read must not happen after a failed client check")

    class _FakeDb:
        def __getattr__(self, name):
            return _Collection()

    monkeypatch.setattr(executive, "db", _FakeDb())
    monkeypatch.setattr(executive, "assert_global_scope", _allow_global_scope)

    with pytest.raises(HTTPException) as error:
        asyncio.run(executive.add_executive_watchlist_entry(
            {"client_id": "client-in-another-tenant"},
            request=None,
            current_user={"id": "user-1", "tenant_id": "tenant-1"},
        ))
    assert error.value.status_code == 404
