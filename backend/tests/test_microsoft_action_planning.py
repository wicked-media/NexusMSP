import pytest
from fastapi import HTTPException

from app.routers.control_plane import (
    MICROSOFT_ACTION_TEMPLATES,
    _normalise_action_options,
)


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
