import pytest

from app.routers.nexus_autopilot import (
    DEFAULT_POLICY,
    build_autopilot_readiness,
    build_autopilot_simulation,
    normalise_autopilot_policy,
)
from app.services.action_permissions import ACTION_PERMISSION_IDS
from app.services.platform_foundation import EVENT_SUBJECTS


def _facts(**overrides):
    return {
        "event_ledger_ready": True,
        "trusted_agents": 1,
        "approved_workflows": 1,
        "workflow_simulations": 1,
        "maintenance_controls": 1,
        "rollback_ready": True,
        **overrides,
    }


def _policy(**overrides):
    return normalise_autopilot_policy({
        **DEFAULT_POLICY,
        "enabled": True,
        "configured_level": 4,
        "allowed_client_ids": ["client-1"],
        "allowed_action_ids": [
            "restart-service",
            "create-ticket",
            "run-approved-script",
        ],
        "overnight_enabled": True,
        "max_actions_per_run": 4,
        **overrides,
    })


def test_policy_enforces_non_optional_governance_controls():
    policy = normalise_autopilot_policy({
        "configured_level": 2,
        "confidence_threshold": 0.86,
        "ticket_link_required": False,
        "maintenance_window_required": False,
        "protected_actions_human_only": False,
    })

    assert policy["ticket_link_required"] is True
    assert policy["maintenance_window_required"] is True
    assert policy["protected_actions_human_only"] is True


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("configured_level", 5),
        ("configured_level", -1),
        ("confidence_threshold", 0.69),
        ("confidence_threshold", 1),
        ("max_actions_per_run", 0),
        ("max_actions_per_run", 11),
    ],
)
def test_policy_rejects_values_outside_the_governed_boundary(field, value):
    with pytest.raises(ValueError):
        normalise_autopilot_policy({field: value})


def test_effective_level_is_capped_by_sequential_readiness():
    readiness = build_autopilot_readiness(
        _policy(),
        _facts(approved_workflows=0),
    )

    assert readiness["configured_level"] == 4
    assert readiness["highest_ready_level"] == 1
    assert readiness["effective_level"] == 1
    assert readiness["capped"] is True
    assert readiness["levels"][2]["status"] == "attention"
    assert readiness["levels"][3]["status"] == "locked"


def test_kill_switch_always_returns_effective_level_to_observe():
    readiness = build_autopilot_readiness(
        _policy(paused=True),
        _facts(),
    )

    assert readiness["highest_ready_level"] == 4
    assert readiness["effective_level"] == 0
    assert readiness["mode"] == "paused"


def test_level_four_requires_explicit_overnight_and_strict_volume_controls():
    readiness = build_autopilot_readiness(
        _policy(overnight_enabled=False, max_actions_per_run=8),
        _facts(),
    )

    assert readiness["highest_ready_level"] == 3
    assert readiness["levels"][4]["ready"] is False
    failed = {gate["id"] for gate in readiness["levels"][4]["gates"] if not gate["passed"]}
    assert failed == {"overnight_scope", "bounded_volume"}


def test_protected_simulation_never_executes_and_requires_a_human():
    policy = _policy(configured_level=2, overnight_enabled=False)
    readiness = build_autopilot_readiness(policy, _facts())
    candidate = {
        "id": "resolution:air-1",
        "source_label": "AI resolution queue",
        "title": "Certificate expires tomorrow",
        "client_id": "client-1",
        "client_name": "Acme",
        "category": "certificate",
        "confidence": 0.97,
        "action_id": "create-ticket",
        "minimum_level": 2,
        "ticket_id": "ticket-1",
        "endpoint_action": False,
        "simulated_source": False,
        "proposed_action": "Prepare a reviewed certificate-renewal change.",
    }

    simulation = build_autopilot_simulation(
        candidate,
        policy,
        readiness,
        {"trusted_endpoint": False},
    )

    assert simulation["will_execute"] is False
    assert simulation["protected_category"] is True
    assert simulation["requires_human_approval"] is True
    assert "independent change approval" in simulation["approval_path"]


def test_autopilot_permissions_and_event_contracts_are_declared():
    assert {
        "automation.autopilot.manage",
        "automation.autopilot.simulate",
        "automation.autopilot.pause",
    } <= ACTION_PERMISSION_IDS
    subjects = {item["subject"] for item in EVENT_SUBJECTS}
    assert {
        "autopilot.policy.changed",
        "autopilot.simulation.completed",
        "autopilot.paused",
        "autopilot.resumed",
    } <= subjects

