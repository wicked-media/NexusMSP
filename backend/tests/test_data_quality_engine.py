from datetime import datetime, timezone

from app.services.data_quality_engine import build_data_quality_snapshot


NOW = datetime(2026, 9, 3, 1, 0, tzinfo=timezone.utc)


def test_missing_sources_remain_not_assessed_instead_of_passing():
    snapshot = build_data_quality_snapshot(now=NOW)

    assert snapshot["summary"]["state"] == "not_assessed"
    assert snapshot["summary"]["observed_quality_signal"] is None
    assert snapshot["summary"]["records_examined"] == 0
    assert snapshot["summary"]["findings"] == 0
    assert all(source["state"] == "not_observed" for source in snapshot["sources"])
    assert "does not invent missing data" in snapshot["boundary"]


def test_duplicate_serial_and_unlinked_agent_are_evidence_led_findings():
    snapshot = build_data_quality_snapshot(
        now=NOW,
        clients=[{
            "id": "client-1",
            "name": "Acme",
            "email": "ops@acme.example",
            "contacts": [{"id": "contact-1", "name": "Taylor", "email": "taylor@acme.example", "is_primary": True}],
        }],
        devices=[
            {"id": "device-1", "client_id": "client-1", "name": "ACME-01", "serial_number": "ABC123", "nexus_agent_id": "agent-1"},
            {"id": "device-2", "client_id": "client-1", "name": "ACME-02", "serial_number": "ABC123"},
        ],
        agents=[{"id": "agent-1", "client_id": "client-1", "hostname": "ACME-01"}],
    )

    duplicate_serial = [item for item in snapshot["findings"] if item["id"].startswith("device-duplicate-serial")]
    assert len(duplicate_serial) == 2
    assert all(item["severity"] == "high" for item in duplicate_serial)
    assert all("Review source history" in item["detail"] for item in duplicate_serial)
    assert snapshot["summary"]["state"] == "attention_required"
    assert snapshot["summary"]["observed_quality_signal"] is not None
    assert snapshot["provenance"]["no_automatic_remediation"] is True


def test_restricted_snapshot_does_not_surface_unattributed_global_counts():
    snapshot = build_data_quality_snapshot(
        now=NOW,
        clients=[{"id": "client-1", "name": "Acme", "email": "ops@acme.example"}],
        devices=[{"id": "device-1", "client_id": "client-1", "name": "ACME-01", "serial_number": "SERIAL-1"}],
        global_scope=False,
        unattributed_counts={"devices": 8, "tickets": 3},
    )

    assert snapshot["scope"]["unattributed_records_visible"] is False
    assert snapshot["scope"]["unattributed_records_excluded_for_restricted_users"] is True
    assert not [item for item in snapshot["findings"] if item["id"].startswith("unattributed-source:")]


def test_global_snapshot_uses_aggregate_orphan_signal_without_raw_records():
    snapshot = build_data_quality_snapshot(
        now=NOW,
        clients=[{"id": "client-1", "name": "Acme", "email": "ops@acme.example"}],
        global_scope=True,
        unattributed_counts={"devices": 2, "tickets": 0},
    )

    finding = next(item for item in snapshot["findings"] if item["id"] == "unattributed-source:devices")
    assert finding["client_id"] is None
    assert finding["object"]["type"] == "source_collection"
    assert finding["observed"] == 2
    assert finding["object"]["label"] == "Devices"
    assert "aggregate" in finding["detail"]


def test_partial_capture_never_becomes_an_observed_clean_result():
    snapshot = build_data_quality_snapshot(
        now=NOW,
        clients=[{"id": "client-1", "name": "Acme", "email": "ops@acme.example"}],
        devices=[{"id": "device-1", "client_id": "client-1", "name": "ACME-01", "serial_number": "SERIAL-1"}],
        source_capture={"devices": True},
    )

    assert snapshot["summary"]["state"] == "partial_review"
    assert snapshot["summary"]["capture_state"] == "partial"
    assert snapshot["summary"]["truncated_sources"] == ["devices"]
    assert next(item for item in snapshot["sources"] if item["id"] == "devices")["state"] == "partial"
    assert "review limit" in snapshot["boundary"]


def test_global_orphan_review_is_deferred_when_client_capture_is_partial():
    snapshot = build_data_quality_snapshot(
        now=NOW,
        clients=[{"id": "client-1", "name": "Acme", "email": "ops@acme.example"}],
        global_scope=True,
        source_capture={"clients": True},
        unattributed_counts_available=False,
    )

    assert snapshot["scope"]["unattributed_records_review_deferred"] is True
    assert "misclassify" in snapshot["boundary"]
