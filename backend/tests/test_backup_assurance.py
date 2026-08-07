from datetime import datetime, timedelta, timezone

from app.services.backup_assurance import build_backup_confidence, simulate_recovery


NOW = datetime(2026, 8, 2, 10, 0, tzinfo=timezone.utc)


def test_confidence_does_not_convert_missing_evidence_to_success():
    confidence = build_backup_confidence([], [], [], now=NOW)

    assert confidence["score"] is None
    assert confidence["label"] == "Not assessed"
    assert confidence["evidence_coverage"] == 0
    assert all(component["score"] is None for component in confidence["components"])


def test_confidence_is_explainable_across_five_domains():
    confidence = build_backup_confidence(
        [{"status": "success"}, {"status": "failed"}],
        [{"immutable": True}, {"object_lock": False}],
        [{"result": "pass", "data_integrity_check": "passed", "completed_at": (NOW - timedelta(days=10)).isoformat()}],
        now=NOW,
    )

    assert confidence["evidence_coverage"] == 100
    assert confidence["assessed_components"] == 5
    assert {component["id"] for component in confidence["components"]} == {"backup", "integrity", "recovery", "immutability", "verification"}
    assert confidence["score"] == 80.0


def test_recovery_simulator_surfaces_missing_proof_without_executing():
    result = simulate_recovery(
        client_id="client-1",
        client_name="Example Client",
        workload="Finance SQL",
        target_rto_hours=4,
        target_rpo_hours=1,
        data_size_gb=100,
        dependencies=["Domain Controller", "DNS"],
        jobs=[],
        records=[],
        tests=[],
        now=NOW,
    )

    assert result["readiness"] == "insufficient_evidence"
    assert result["external_changes"] is False
    assert result["estimated_restore_range_minutes"] is None
    assert result["restore_order"] == ["Domain Controller", "DNS", "Finance SQL"]
    assert result["required_staging_storage_gb"] == 120.0
    assert len(result["blockers"]) >= 3


def test_recovery_simulator_uses_customer_scoped_observations():
    result = simulate_recovery(
        client_id="client-1",
        client_name="Example Client",
        workload="File server",
        target_rto_hours=2,
        target_rpo_hours=24,
        data_size_gb=50,
        dependencies=[],
        jobs=[
            {"client_id": "client-1", "status": "success", "completed_at": (NOW - timedelta(hours=2)).isoformat()},
            {"client_id": "client-2", "status": "success", "completed_at": NOW.isoformat()},
        ],
        records=[{"client_id": "client-1", "immutable": True}],
        tests=[{"client_id": "client-1", "result": "pass", "restore_time_minutes": 45}],
        now=NOW,
    )

    assert result["readiness"] == "ready_with_evidence"
    assert result["rpo_status"] == "met"
    assert result["rto_status"] == "met"
    assert result["immutability"] == "proven"
    assert result["blockers"] == []
