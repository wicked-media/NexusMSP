import pytest

from app.services.event_backbone import (
    DELIVERY_BACKOFF_SECONDS,
    EVENT_CHAIN_GENESIS,
    build_event_integrity,
    event_content_hash,
    retry_delay_seconds,
    subject_matches,
    verify_event_integrity,
    validate_subject_patterns,
    validate_webhook_url,
)


def test_subject_matching_supports_exact_and_wildcard_subscribers():
    assert subject_matches("device.health.changed", ["device.*"])
    assert subject_matches("ticket.created", ["ticket.created"])
    assert subject_matches("backup.job.failed", ["*.failed"])
    assert not subject_matches("invoice.generated", ["device.*", "ticket.*"])


def test_subject_patterns_are_normalised_and_deduplicated():
    assert validate_subject_patterns(["Ticket.*", "ticket.*", "device.health.*"]) == [
        "device.health.*",
        "ticket.*",
    ]


def test_invalid_subject_pattern_is_rejected():
    with pytest.raises(ValueError):
        validate_subject_patterns(["https://example.com/events"])


def test_retry_delay_is_bounded_after_the_final_backoff():
    assert retry_delay_seconds(1) == DELIVERY_BACKOFF_SECONDS[0]
    assert retry_delay_seconds(999) == DELIVERY_BACKOFF_SECONDS[-1]


def test_webhooks_require_https_except_for_local_development():
    assert validate_webhook_url("https://events.example.com/nexus") == "https://events.example.com/nexus"
    assert validate_webhook_url("http://127.0.0.1:9000/events") == "http://127.0.0.1:9000/events"
    with pytest.raises(ValueError):
        validate_webhook_url("http://events.example.com/nexus")
    with pytest.raises(ValueError):
        validate_webhook_url("https://user:password@events.example.com/nexus")


def _event(event_id, sequence, payload=None):
    return {
        "id": event_id,
        "subject": "device.health.changed",
        "schema_version": 1,
        "source": "test",
        "tenant_id": "tenant-1",
        "client_id": "client-1",
        "correlation_id": "incident-1",
        "causation_id": None,
        "actor": {"id": "tech-1", "name": "Aaron", "role": "admin"},
        "payload": payload or {"status": "offline"},
        "occurred_at": f"2026-07-29T00:0{sequence}:00+00:00",
        "partition_key": "client-1",
        "sequence": sequence,
        "published_at": f"2026-07-29T00:0{sequence}:01+00:00",
    }


def test_black_box_integrity_links_partition_events():
    first = _event("event-1", 1)
    first["integrity"] = build_event_integrity(first)
    second = _event("event-2", 2, {"status": "online"})
    second["integrity"] = build_event_integrity(second, first)

    assert first["integrity"]["previous_hash"] == EVENT_CHAIN_GENESIS
    assert verify_event_integrity(first)["status"] == "verified"
    assert verify_event_integrity(second, first)["status"] == "verified"


def test_black_box_integrity_detects_payload_tampering():
    event = _event("event-1", 1)
    event["integrity"] = build_event_integrity(event)
    original_hash = event_content_hash(event)
    event["payload"]["status"] = "online"

    result = verify_event_integrity(event)
    assert event_content_hash(event) != original_hash
    assert result["status"] == "compromised"
    assert result["content_verified"] is False
