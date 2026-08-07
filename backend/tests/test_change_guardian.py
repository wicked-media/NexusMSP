from app.services.change_guardian import build_device_change_preview, risk_label
from app.services.platform_foundation import EVENT_SUBJECTS


DEVICES = [
    {
        "id": "device-1",
        "name": "APP-SERVER",
        "client_id": "client-1",
        "device_type": "server",
        "status": "online",
        "nexus_agent_id": "agent-1",
        "assigned_user": "Operations",
    },
]


def test_low_risk_agent_check_remains_explainable():
    preview = build_device_change_preview(
        action="run-checks",
        requested_ids=["device-1"],
        devices=DEVICES,
        clients=[{"id": "client-1", "name": "Acme"}],
    )
    assert preview["risk"]["level"] == "low"
    assert preview["execution_allowed"] is True
    assert "no simulated endpoint outcome" in preview["risk"]["method"].lower()
    assert preview["evidence"]["record_count"] == 2


def test_service_impact_surfaces_sessions_tickets_and_backup_dependencies():
    preview = build_device_change_preview(
        action="reboot",
        requested_ids=["device-1"],
        devices=DEVICES,
        clients=[{"id": "client-1", "name": "Acme"}],
        tickets=[{"id": "ticket-1", "title": "Production outage", "status": "open", "priority": "critical"}],
        sessions=[{"id": "session-1", "device_id": "device-1", "status": "active"}],
        backups=[{"id": "backup-1", "device_id": "device-1", "status": "running"}],
    )
    assert preview["risk"]["level"] == "critical"
    assert preview["risk"]["approval_required"] is True
    assert next(item for item in preview["dependencies"] if item["type"] == "tickets")["count"] == 1
    assert next(item for item in preview["dependencies"] if item["type"] == "remote")["count"] == 1
    assert next(item for item in preview["dependencies"] if item["type"] == "backups")["count"] == 1
    assert any(gate["state"] == "review" for gate in preview["gates"])


def test_unavailable_or_unenrolled_targets_are_never_inferred_ready():
    preview = build_device_change_preview(
        action="install-patches",
        requested_ids=["device-1", "missing-device"],
        devices=[{**DEVICES[0], "nexus_agent_id": None}],
    )
    assert preview["execution_allowed"] is False
    assert preview["scope"]["unavailable_ids"] == ["missing-device"]
    assert preview["scope"]["eligible"] == 0
    assert any("unavailable" in item.lower() for item in preview["recommendations"])


def test_risk_boundaries_are_stable():
    assert risk_label(0) == "low"
    assert risk_label(25) == "medium"
    assert risk_label(50) == "high"
    assert risk_label(75) == "critical"


def test_change_guardian_event_is_part_of_platform_contract():
    subjects = {item["subject"] for item in EVENT_SUBJECTS}
    assert "change.guardian.previewed" in subjects
    assert "change.guardian.execution.linked" in subjects

