from app.services import windows_health


def test_component_store_issue_is_evidence_not_confirmed_root_cause():
    assessment = windows_health.assess({
        "id": "dev-1", "client_id": "client-1", "name": "Windows endpoint", "os": "Windows 11",
        "self_heal": {"performance": {"details": {"component_store": "component store corruption is repairable"}}},
    })
    assert assessment["assessment_state"] == "action_required"
    assert assessment["confirmed_root_cause"] is None
    assert assessment["diagnostic_hypotheses"][0]["confirmed_root_cause"] is False
    repair = next(item for item in assessment["recommendations"] if item["kind"] == "repair")
    assert repair["requires_administrator_approval"] is True
    assert repair["execution"] == "change_management"


def test_evidence_gaps_are_not_healthy():
    assessment = windows_health.assess({"id": "dev-2", "os": "Windows Server"})
    assert assessment["assessment_state"] == "insufficient_evidence"
    assert assessment["findings"] == []
    assert any(item["status"] == "not_reported" for item in assessment["evidence"])


def test_pending_reboot_requires_approved_disruptive_workflow():
    assessment = windows_health.assess({
        "id": "dev-3", "os": "Windows 10",
        "self_heal": {"performance": {"details": {"pending_reboot": "windows update"}}},
    })
    restart = next(item for item in assessment["recommendations"] if item["title"] == "Plan a restart")
    assert restart["requires_administrator_approval"] is True
    assert "approved change" in assessment["boundary"].lower()
