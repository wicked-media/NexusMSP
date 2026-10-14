from app.services.nexus_proving_ground import compose_proving_ground


def test_proving_ground_preserves_non_mutating_boundary_and_configuration_gaps():
    result = compose_proving_ground(
        workflows=[{
            "id": "wf-1", "name": "Repair DNS", "enabled": True,
            "approval_status": "approved", "simulation_count": 2,
        }],
        simulations=[{
            "id": "sim-1", "workflow_id": "wf-1", "workflow_name": "Repair DNS",
            "status": "blocked", "risk_level": "high", "requires_approval": True,
            "will_execute": True, "summary": {"steps": 3, "systems": 1, "configuration_gaps": 2},
        }],
        runs=[],
        approvals=[],
    )

    assert result["summary"]["configuration_gaps"] == 2
    assert result["summary"]["workflows_ready"] == 1
    assert result["simulations"][0]["will_execute"] is False
    assert "cannot execute" in result["boundary"].lower()


def test_proving_ground_only_counts_active_workflow_runs():
    result = compose_proving_ground(
        workflows=[], simulations=[], approvals=[],
        runs=[{"id": "run-active", "status": "running"}, {"id": "run-done", "status": "completed"}],
    )

    assert result["summary"]["active_runs"] == 1
