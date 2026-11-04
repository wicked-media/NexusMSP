from datetime import datetime, timedelta, timezone

from app.services.nexus_pulse import compose_monitored_resources, compose_nexus_pulse


def test_pulse_never_marks_missing_or_stale_observations_healthy():
    now = datetime(2026, 9, 3, tzinfo=timezone.utc)
    result = compose_nexus_pulse(
        devices=[
            {"id": "device-1", "name": "Unknown"},
            {"id": "device-2", "name": "Stale", "last_seen": (now - timedelta(minutes=20)).isoformat()},
        ],
        agents=[], tickets=[], automation_runs=[], backup_jobs=[], generated_at=now,
    )

    fleet = next(signal for signal in result["signals"] if signal["id"] == "managed-fleet")
    assert fleet["state"] == "attention"
    assert result["summary"]["fresh_devices"] == 0
    assert result["summary"]["attention"] == 2


def test_pulse_separates_backup_failure_from_restore_proof():
    result = compose_nexus_pulse(
        devices=[], agents=[], tickets=[], automation_runs=[],
        backup_jobs=[{"id": "backup-1", "name": "Acme backup", "status": "failed"}],
    )

    recovery = next(signal for signal in result["signals"] if signal["id"] == "recovery-evidence")
    assert recovery["state"] == "attention"
    assert "restore test" in recovery["detail"]


def test_monitored_resources_distinguishes_stale_from_missing_coverage():
    now = datetime(2026, 9, 3, tzinfo=timezone.utc)
    result = compose_monitored_resources(
        devices=[
            {"id": "device-current", "name": "Current", "client_id": "client-a", "last_seen": (now - timedelta(minutes=2)).isoformat()},
            {"id": "device-stale", "name": "Stale", "last_seen": (now - timedelta(minutes=20)).isoformat()},
            {"id": "device-unobserved", "name": "Unobserved"},
        ],
        generated_at=now,
    )

    states = {resource["id"]: resource["state"] for resource in result["resources"]}
    assert states == {
        "device-current": "observed",
        "device-stale": "stale",
        "device-unobserved": "not_monitored",
    }
    assert result["summary"] == {"resources": 3, "observed": 1, "stale": 1, "not_monitored": 1}
    assert "does not prove availability" in result["boundary"]
