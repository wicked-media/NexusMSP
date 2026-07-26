import pytest

from app.services.event_backbone import (
    DELIVERY_BACKOFF_SECONDS,
    retry_delay_seconds,
    subject_matches,
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
