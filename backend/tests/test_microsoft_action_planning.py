import pytest
from fastapi import HTTPException

from app.routers.control_plane import (
    MICROSOFT_ACTION_TEMPLATES,
    _normalise_action_options,
)
from app.services.action_permissions import ACTION_PERMISSION_IDS


def _template(action_id: str) -> dict:
    return next(
        item for item in MICROSOFT_ACTION_TEMPLATES if item["id"] == action_id
    )


def test_create_user_plan_requires_identity_fields_and_keeps_safe_defaults():
    options, missing = _normalise_action_options(
        _template("create-user"),
        {
            "display_name": "Alex Taylor",
            "user_principal_name": "alex@example.com",
        },
    )

    assert missing == []
    assert options["usage_location"] == "AU"
    assert options["display_name"] == "Alex Taylor"
    assert options["user_principal_name"] == "alex@example.com"


def test_create_user_plan_reports_every_missing_required_field():
    _, missing = _normalise_action_options(_template("create-user"), {})

    assert missing == ["Display name", "User principal name"]


def test_action_plan_rejects_unknown_select_values():
    with pytest.raises(HTTPException) as exc:
        _normalise_action_options(
            _template("block-sign-in"),
            {
                "session_action": "launch_shell",
                "containment_window": "until_manual_review",
            },
        )

    assert exc.value.status_code == 400
    assert "Existing sessions" in exc.value.detail


def test_action_plan_rejects_malformed_email_fields():
    with pytest.raises(HTTPException) as exc:
        _normalise_action_options(
            _template("offboard-user"),
            {
                "effective_at": "2026-07-25T17:30",
                "mailbox_action": "convert_shared",
                "forward_to": "not-an-email",
                "reclaim_licences": "reclaim",
            },
        )

    assert exc.value.status_code == 400
    assert "Forward mail to" in exc.value.detail


def test_every_microsoft_action_has_a_rollback_contract():
    assert all(template.get("rollback") for template in MICROSOFT_ACTION_TEMPLATES)


def test_group_access_plan_requires_group_and_access_review_evidence():
    options, missing = _normalise_action_options(
        _template("manage-group-access"),
        {"membership_operation": "add"},
    )

    assert options["membership_operation"] == "add"
    assert missing == ["Group name or object ID"]


def test_privileged_role_plan_is_critical_and_requires_independent_approval():
    template = _template("manage-privileged-role")
    options, missing = _normalise_action_options(
        template,
        {
            "role_name": "Exchange Administrator",
            "role_operation": "activate_time_bound",
            "access_duration": "8_hours",
            "role_owner": "Security owner",
        },
    )

    assert missing == []
    assert template["impact"] == "critical"
    assert template["approval_required"] is True
    assert options["access_duration"] == "8_hours"
    assert template["permission"] in ACTION_PERMISSION_IDS


def test_mailbox_delegation_plan_requires_owner_and_approval_contract():
    template = _template("manage-mailbox-access")
    _, missing = _normalise_action_options(
        template,
        {"mailbox_address": "accounts@example.com"},
    )

    assert missing == ["Mailbox owner or approval authority"]
    assert template["approval_required"] is True
    assert template["permission"] in ACTION_PERMISSION_IDS


def test_intune_device_retirement_is_critical_and_requires_recovery_evidence():
    template = _template("retire-managed-device")
    options, missing = _normalise_action_options(template, {})

    assert missing == []
    assert template["target"] == "device"
    assert template["impact"] == "critical"
    assert template["approval_required"] is True
    assert options["device_operation"] == "retire"
    assert template["permission"] in ACTION_PERMISSION_IDS


def test_conditional_access_change_defaults_to_report_only_and_is_approval_gated():
    template = _template("manage-conditional-access")
    options, missing = _normalise_action_options(
        template,
        {"policy_identifier": "Require compliant device"},
    )

    assert missing == []
    assert options["policy_operation"] == "report_only"
    assert template["impact"] == "critical"
    assert template["approval_required"] is True
    assert template["permission"] in ACTION_PERMISSION_IDS
