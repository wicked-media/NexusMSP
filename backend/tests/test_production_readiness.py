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
