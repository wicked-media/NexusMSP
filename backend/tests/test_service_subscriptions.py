from app.routers.service_subscriptions import _infer_category, _monthly_amount, _normalise_status
from app.routers import web_studio
from fastapi import HTTPException
import pytest


def test_monthly_amount_normalises_common_billing_cadences():
    assert _monthly_amount(1200, "annual") == 100
    assert _monthly_amount(300, "quarterly") == 100
    assert round(_monthly_amount(120, "weekly"), 2) == 520
    assert _monthly_amount(75, "monthly") == 75


def test_category_inference_covers_connected_service_families():
    assert _infer_category("Microsoft 365 Business Premium") == "licence"
    assert _infer_category("Acronis endpoint protection") == "backup"
    assert _infer_category("Yeastar extension") == "voice"
    assert _infer_category("Managed DNS security") == "security"
    assert _infer_category("Business internet service") == "telecom"
    assert _infer_category("Managed support agreement") == "managed_service"
    assert _infer_category("Unclassified recurring item") == "subscription"


def test_status_normalisation_preserves_disabled_state():
    assert _normalise_status("online") == "active"
    assert _normalise_status("connected") == "active"
    assert _normalise_status("active", enabled=False) == "disabled"


def test_wordpress_connection_rejects_private_network_targets(monkeypatch):
    monkeypatch.setattr(web_studio.socket, "getaddrinfo", lambda *_args, **_kwargs: [(None, None, None, None, ("127.0.0.1", 443))])
    with pytest.raises(HTTPException) as exc:
        web_studio._wordpress_api_url("https://localhost")
    assert exc.value.status_code == 400


def test_wordpress_connection_allows_public_https_host(monkeypatch):
    monkeypatch.setattr(web_studio.socket, "getaddrinfo", lambda *_args, **_kwargs: [(None, None, None, None, ("93.184.216.34", 443))])
    assert web_studio._wordpress_api_url("https://example.com") == "https://example.com/wp-json"
