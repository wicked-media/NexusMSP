from app.routers.billing_recon import _normalise_time_entry


def test_normalise_current_time_entry_uses_minutes_and_hourly_rate():
    entry = _normalise_time_entry({
        "id": "time-001",
        "ticket_id": "ticket-001",
        "client_id": "client-001",
        "minutes": 45,
        "hourly_rate": 85,
    })

    assert entry["hours"] == 0.75
    assert entry["rate"] == 85
    assert entry["total_amount"] == 63.75
    assert entry["billing_ready"] is True
    assert entry["readiness_issues"] == []


def test_normalise_legacy_time_entry_keeps_hours_and_rate():
    entry = _normalise_time_entry({
        "ticket_id": "ticket-002",
        "client_name": "Acme Corporation",
        "hours": 1.5,
        "rate": 75,
    })

    assert entry["minutes"] == 0
    assert entry["hours"] == 1.5
    assert entry["rate"] == 75
    assert entry["total_amount"] == 112.5
    assert entry["billing_ready"] is True


def test_normalise_incomplete_time_entry_explains_missing_evidence():
    entry = _normalise_time_entry({"description": "Unlinked work"})

    assert entry["total_amount"] == 0
    assert entry["billing_ready"] is False
    assert entry["readiness_issues"] == ["duration", "billing_rate", "client", "ticket"]
