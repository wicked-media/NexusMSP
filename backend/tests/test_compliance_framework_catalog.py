"""Integrity checks for the compliance readiness catalogue."""

from app.routers.compliance import (
    COMPLIANCE_FRAMEWORKS,
    COMPLIANCE_ISSUE_SEVERITIES,
    COMPLIANCE_ISSUE_STATUSES,
    COMPLIANCE_POLICY_STATUSES,
    EVIDENCE_CHECKS,
    POLICY_TEMPLATES,
)


def test_priority_compliance_paths_are_available():
    expected = {
        "essential8",
        "iso27001",
        "soc2",
        "nist_csf",
        "pci_dss",
        "gdpr",
        "iso42001",
        "nist_ai_rmf",
        "apra_cps234",
    }

    assert expected.issubset(COMPLIANCE_FRAMEWORKS)


def test_every_framework_control_maps_to_a_known_evidence_source():
    for framework_id, framework in COMPLIANCE_FRAMEWORKS.items():
        assert framework.get("name"), framework_id
        assert framework.get("controls"), framework_id

        control_ids = set()
        for control in framework["controls"]:
            assert control.get("id"), framework_id
            assert control.get("name"), f"{framework_id}:{control.get('id')}"
            assert control.get("check") in EVIDENCE_CHECKS, (
                f"{framework_id}:{control.get('id')} uses unknown evidence check "
                f"{control.get('check')}"
            )
            assert control["id"] not in control_ids, f"duplicate control {framework_id}:{control['id']}"
            control_ids.add(control["id"])


def test_expanded_templates_are_explicitly_readiness_only():
    for framework_id, framework in COMPLIANCE_FRAMEWORKS.items():
        if framework_id in {"cis", "hipaa"}:
            continue
        assert framework.get("template_state") == "readiness_template"


def test_assurance_queue_has_governed_terminal_states():
    assert {"open", "in_progress", "ready_for_review"}.issubset(COMPLIANCE_ISSUE_STATUSES)
    assert {"resolved", "accepted_risk"}.issubset(COMPLIANCE_ISSUE_STATUSES)
    assert COMPLIANCE_ISSUE_SEVERITIES == {"low", "medium", "high", "critical"}


def test_policy_library_supports_core_governance_paths():
    assert {"draft", "in_review", "approved", "retired"} == COMPLIANCE_POLICY_STATUSES
    assert {
        "information-security", "access-control", "incident-response", "business-continuity",
        "vendor-risk", "privacy", "vulnerability", "change-management", "ai-governance",
    }.issubset(POLICY_TEMPLATES)
    for template_id, template in POLICY_TEMPLATES.items():
        assert template.get("name"), template_id
        assert template.get("purpose"), template_id
        assert template.get("frameworks"), template_id
