from datetime import datetime, timedelta, timezone

from app.services.confidence_engine import (
    build_confidence_profile,
    confidence_dimension,
    evidence_gap,
    freshness_score,
)
from app.services.action_permissions import ACTION_PERMISSION_IDS, TECHNICIAN_DEFAULTS
from app.services.platform_foundation import EVENT_SUBJECTS


NOW = datetime(2026, 7, 29, 2, 0, tzinfo=timezone.utc)


def test_freshness_is_current_then_decays_without_guessing():
    assert freshness_score(NOW - timedelta(hours=2), now=NOW, fresh_days=1, stale_days=14) == 100
    assert freshness_score(NOW - timedelta(days=20), now=NOW, fresh_days=1, stale_days=14) == 0
    assert freshness_score(None, now=NOW) == 0


def test_profile_is_unavailable_when_no_source_evidence_exists():
    dimension = confidence_dimension(
        "identity",
        "Identity",
        weight=100,
        checks=[("serial", False), ("model", False)],
        sources=["devices"],
        evidence_count=0,
        now=NOW,
    )
    profile = build_confidence_profile(
        entity_type="device",
        entity_id="dev-1",
        entity_label="Endpoint",
        dimensions=[dimension],
        now=NOW,
    )
    assert profile["score"] == 0
    assert profile["state"] == "unavailable"
    assert profile["evidence_available"] is False


def test_manual_attestation_does_not_raise_score_or_hide_gap():
    dimension = confidence_dimension(
        "lifecycle",
        "Lifecycle",
        weight=100,
        checks=[("purchase date", True), ("warranty", False)],
        sources=["assets"],
        evidence_count=1,
        observed_at=NOW - timedelta(days=10),
        gaps=[evidence_gap("warranty", "Record warranty evidence.", severity="high")],
        now=NOW,
    )
    verification = {
        "verified_at": NOW.isoformat(),
        "expires_at": (NOW + timedelta(days=90)).isoformat(),
        "verified_by": "Alex Technician",
        "note": "Checked the purchase record against the supplier invoice.",
    }
    without_attestation = build_confidence_profile(
        entity_type="device",
        entity_id="dev-1",
        entity_label="Endpoint",
        dimensions=[dimension],
        now=NOW,
    )
    with_attestation = build_confidence_profile(
        entity_type="device",
        entity_id="dev-1",
        entity_label="Endpoint",
        dimensions=[dimension],
        verification=verification,
        now=NOW,
    )
    assert with_attestation["score"] == without_attestation["score"]
    assert with_attestation["gaps"] == without_attestation["gaps"]
    assert with_attestation["attestation"]["current"] is True
    assert with_attestation["attestation"]["does_not_override_gaps"] is True


def test_conflicts_apply_a_visible_penalty():
    dimension = confidence_dimension(
        "identity",
        "Identity",
        weight=100,
        checks=[("serial", True), ("model", True)],
        sources=["devices"],
        evidence_count=1,
        observed_at=NOW,
        now=NOW,
    )
    profile = build_confidence_profile(
        entity_type="device",
        entity_id="dev-1",
        entity_label="Endpoint",
        dimensions=[dimension],
        conflicts=[{"key": "duplicate_serial", "severity": "high", "label": "Serial is duplicated."}],
        now=NOW,
    )
    assert profile["raw_score"] == 100
    assert profile["conflict_penalty"] == 8
    assert profile["score"] == 92
    assert profile["conflicts"][0]["key"] == "duplicate_serial"


def test_high_priority_gaps_are_ordered_first():
    dimension = confidence_dimension(
        "coverage",
        "Coverage",
        weight=100,
        checks=[("source", True)],
        sources=["clients"],
        evidence_count=1,
        observed_at=NOW,
        gaps=[
            evidence_gap("minor", "Optional owner missing.", severity="low"),
            evidence_gap("critical", "Backup evidence missing.", severity="critical"),
        ],
        now=NOW,
    )
    profile = build_confidence_profile(
        entity_type="client",
        entity_id="client-1",
        entity_label="Acme",
        dimensions=[dimension],
        now=NOW,
    )
    assert profile["next_actions"][0]["key"] == "critical"
    assert profile["next_actions"][0]["dimension"] == "Coverage"


def test_confidence_review_uses_shared_permission_and_event_contracts():
    subjects = {item["subject"] for item in EVENT_SUBJECTS}
    assert "confidence.verify" in ACTION_PERMISSION_IDS
    assert "confidence.verify" in TECHNICIAN_DEFAULTS
    assert "confidence.assessment.verified" in subjects
