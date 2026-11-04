import base64
import hashlib
import hmac

from app.routers.invoices import verify_xero_webhook_signature
from app.services.action_permissions import ACTION_PERMISSION_BY_ID
from app.services.integration_security import redact_connection_settings


def test_xero_webhook_signature_requires_matching_hmac():
    body = b'{"events":[]}'
    key = "xero-test-webhook-key"
    signature = base64.b64encode(hmac.new(key.encode("utf-8"), body, hashlib.sha256).digest()).decode("ascii")

    assert verify_xero_webhook_signature(body, signature, key)
    assert not verify_xero_webhook_signature(body, "invalid", key)
    assert not verify_xero_webhook_signature(body, signature, "different-key")


def test_xero_webhook_signature_fails_closed_without_identity():
    assert not verify_xero_webhook_signature(b"{}", "signature", "")
    assert not verify_xero_webhook_signature(b"{}", "", "key")


def test_connection_settings_never_return_oauth_or_provider_secrets():
    safe = redact_connection_settings({"client_id": "public", "client_secret": "secret", "access_token": "access", "refresh_token": "refresh"})
    assert safe == {"client_id": "public"}


def test_accounting_connection_management_has_explicit_permission():
    assert "billing.integration.manage" in ACTION_PERMISSION_BY_ID
