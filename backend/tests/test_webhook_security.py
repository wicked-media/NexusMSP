import pytest

from app.services.action_permissions import ACTION_PERMISSION_BY_ID
from app.services.webhook_security import redact_webhook_for_response, validate_legacy_webhook_url


def test_legacy_webhook_urls_share_governed_https_policy():
    assert validate_legacy_webhook_url("https://events.example.com/nexus") == "https://events.example.com/nexus"
    with pytest.raises(ValueError):
        validate_legacy_webhook_url("http://events.example.com/nexus")
    with pytest.raises(ValueError):
        validate_legacy_webhook_url("https://user:password@events.example.com/nexus")


def test_webhook_response_redacts_delivery_secrets():
    safe = redact_webhook_for_response(
        {
            "id": "hook-1",
            "secret": "do-not-return",
            "headers": {"Authorization": "Bearer secret", "Content-Type": "application/json", "X-Api-Key": "secret"},
        }
    )
    assert "secret" not in safe
    assert safe["headers"] == {
        "Authorization": "[configured]",
        "Content-Type": "application/json",
        "X-Api-Key": "[configured]",
    }


def test_webhook_administration_has_explicit_action_permission():
    assert "platform.webhooks.manage" in ACTION_PERMISSION_BY_ID


def test_client_site_management_has_explicit_action_permission():
    assert "client.site.manage" in ACTION_PERMISSION_BY_ID


def test_platform_configuration_has_explicit_action_permission():
    assert "platform.configuration.manage" in ACTION_PERMISSION_BY_ID
