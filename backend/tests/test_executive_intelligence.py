import asyncio

import pytest

from app.routers.executive_intelligence import (
    _load_executive_state,
    build_board_brief,
    build_executive_scenario,
    build_profit_killers,
    normalise_scenario,
)
from app.services.action_permissions import ACTION_PERMISSION_IDS, default_permissions_for_role
from app.services.platform_foundation import EVENT_SUBJECTS


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
    }
    assert required <= ACTION_PERMISSION_IDS
    assert required.isdisjoint(default_permissions_for_role("technician"))
    assert required.isdisjoint(default_permissions_for_role("service_desk_manager"))
    assert required <= set(default_permissions_for_role("admin"))


def test_executive_events_are_declared_in_platform_contract():
    subjects = {item["subject"] for item in EVENT_SUBJECTS}
    assert "executive.scenario.simulated" in subjects
    assert "executive.board.snapshot.saved" in subjects
