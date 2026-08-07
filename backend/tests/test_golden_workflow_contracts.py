from app.routers.blueprints import STARTER_BLUEPRINTS
from app.routers.control_plane import MICROSOFT_ACTION_TEMPLATES


def test_microsoft_offboarding_requires_approval_rollback_and_service_evidence():
    offboarding = next(item for item in MICROSOFT_ACTION_TEMPLATES if item["id"] == "offboard-user")

    assert offboarding["impact"] == "critical"
    assert offboarding["approval_required"] is True
    assert offboarding["permission"] == "entra.user.disable"
    assert offboarding["rollback"]
    assert any("approval" in step.lower() for step in offboarding["steps"])
    assert any(field["key"] == "effective_at" and field["required"] for field in offboarding["fields"])
    assert any(field["key"] == "reclaim_licences" for field in offboarding["fields"])


def test_onboarding_and_offboarding_blueprints_are_accountable_workflows():
    onboarding = next(item for item in STARTER_BLUEPRINTS if item["name"] == "Client Onboarding Delivery Plan")
    offboarding = next(item for item in STARTER_BLUEPRINTS if item["name"] == "Leaver Offboarding")

    assert onboarding["require_completion"] is True
    assert len(onboarding["child_templates"]) >= 4
    assert any(item.get("per_device") for item in onboarding["child_templates"])
    assert all(item.get("required") for item in onboarding["checklist"])

    assert offboarding["require_completion"] is True
    assert offboarding["default_priority"] == "high"
    assert any("approval" in item["label"].lower() for item in offboarding["checklist"])
    assert any("revoke" in item["label"].lower() for item in offboarding["checklist"])
    assert any("audit" in item["label"].lower() for item in offboarding["checklist"])
