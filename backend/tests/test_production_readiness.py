"""Production-readiness register contract tests."""

import pytest

from app.services.production_readiness import (
    DEFAULT_READINESS_ITEMS,
    PRODUCTION_GATES,
    READINESS_SECTIONS,
    normalise_readiness_payload,
    summarise_readiness,
)


def test_register_has_every_required_section_and_seed_control():
    section_ids = {section["id"] for section in READINESS_SECTIONS}
    seeded_sections = {item["section"] for item in DEFAULT_READINESS_ITEMS}

    assert len(section_ids) == 15
    assert section_ids == {
        "security-findings",
        "tenant-isolation",
        "permissions",
        "agent-security",
        "automation-safety",
        "backup-restoration",
        "disaster-recovery",
        "observability",
        "performance",
        "billing",
        "integrations",
        "deployment",
        "legal",
        "pilot",
        "launch-blockers",
    }
    assert section_ids <= seeded_sections


def test_release_blockers_cover_external_uploads_browser_journeys_and_provider_proof():
    """The readiness UI must not hide the most material pilot blockers.

    Static checks and a disposable API acceptance run are valuable, but they
    are not evidence that customer uploads, browser workflows or external
    providers are safe in a pilot.  Keep those obligations explicit in the
    server-side register so the dashboard cannot imply a release is ready.
    """
    controls = {item["id"]: item for item in DEFAULT_READINESS_ITEMS}

    required = {
        "readiness-upload-quarantine",
        "readiness-browser-golden-workflows",
        "readiness-provider-sandbox-acceptance",
    }
    assert required <= controls.keys()
    for control_id in required:
        control = controls[control_id]
        assert control["production_blocker"] is True
        assert control["status"] == "not_started"
        assert control["test_result"] == "not_run"


def test_every_section_contributes_to_a_launch_gate():
    section_ids = {section["id"] for section in READINESS_SECTIONS}
    gated_sections = {section_id for gate in PRODUCTION_GATES for section_id in gate["sections"]}

    assert section_ids <= gated_sections


def test_create_validation_requires_accountability_and_evidence():
    with pytest.raises(ValueError, match="owner"):
        normalise_readiness_payload({
            "section": "billing",
            "title": "Billing replay test",
            "owner": "",
            "severity": "critical",
            "evidence_required": "Repeatable invoice output from duplicate events.",
            "status": "not_started",
            "test_result": "not_run",
        })


def test_readiness_cannot_claim_passed_with_non_passing_evidence():
    with pytest.raises(ValueError, match="passed readiness control"):
        normalise_readiness_payload({
            "section": "billing",
            "title": "Billing replay test",
            "owner": "Commercial Platform",
            "severity": "critical",
            "evidence_required": "Repeatable invoice output from duplicate events.",
            "status": "passed",
            "test_result": "fail",
        })


def test_partial_update_state_requires_merged_validation():
    existing = {
        **DEFAULT_READINESS_ITEMS[0],
        "status": "in_progress",
        "test_result": "fail",
    }
    update = normalise_readiness_payload({"status": "passed"}, partial=True)

    with pytest.raises(ValueError, match="passed readiness control"):
        normalise_readiness_payload({**existing, **update})

    with pytest.raises(ValueError, match="not-applicable readiness control"):
        normalise_readiness_payload({
            "section": "billing",
            "title": "Billing replay test",
            "owner": "Commercial Platform",
            "severity": "critical",
            "evidence_required": "Repeatable invoice output from duplicate events.",
            "status": "not_applicable",
            "test_result": "pass",
        })

    with pytest.raises(ValueError, match="evidence"):
        normalise_readiness_payload({
            "section": "billing",
            "title": "Billing replay test",
            "owner": "Commercial Platform",
            "severity": "critical",
            "evidence_required": "short",
            "status": "not_started",
            "test_result": "not_run",
        })


def test_live_context_cannot_implicitly_pass_a_control():
    item = {
        **DEFAULT_READINESS_ITEMS[0],
        "system_evidence": {"boundary_denials": 42, "status": "healthy"},
        "status": "in_progress",
        "test_result": "partial",
    }

    summary = summarise_readiness([item])

    assert summary["launch_decision"] == "hold"
    assert summary["passed_gates"] == 0
    assert summary["open_blockers"] == 1


def test_all_seeded_controls_must_pass_for_candidate_decision():
    passed_items = [
        {
            **item,
            "status": "passed",
            "test_result": "pass",
            "production_blocker": True,
        }
        for item in DEFAULT_READINESS_ITEMS
    ]

    summary = summarise_readiness(passed_items)

    assert summary["launch_decision"] == "candidate"
    assert summary["passed_gates"] == summary["total_gates"]
    assert summary["open_blockers"] == 0
