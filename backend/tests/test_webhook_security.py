import asyncio
import socket
from types import SimpleNamespace

import pytest

from app.services import event_backbone
from app.services.action_permissions import ACTION_PERMISSION_BY_ID
from app.services.webhook_security import (
    assert_outbound_destination,
    redact_webhook_for_response,
    validate_legacy_webhook_url,
)


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


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/nexus",
        "https://[::1]/nexus",
        "https://[::ffff:127.0.0.1]/nexus",
        "https://10.4.0.9/nexus",
        "https://192.168.1.20/nexus",
        "https://172.16.9.9/nexus",
        "https://[fd00::1]/nexus",
    ],
)
def test_outbound_destination_refuses_non_public_literals(url):
    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(assert_outbound_destination(url))


def test_outbound_destination_refuses_cloud_metadata_address():
    with pytest.raises(ValueError, match="link-local"):
        asyncio.run(assert_outbound_destination("https://169.254.169.254/latest/meta-data/"))


def test_outbound_destination_accepts_public_literal():
    assert asyncio.run(assert_outbound_destination("https://1.1.1.1/nexus")) == "https://1.1.1.1/nexus"


def test_outbound_destination_refuses_name_resolving_to_private_address(monkeypatch):
    async def resolves_to_private(host, port):
        return ["10.0.0.5"]

    monkeypatch.setattr(event_backbone, "_resolve_addresses", resolves_to_private)
    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(assert_outbound_destination("https://hooks.example.com/nexus"))


def test_outbound_destination_refuses_when_any_resolved_address_is_private(monkeypatch):
    async def resolves_to_mixed(host, port):
        return ["1.1.1.1", "127.0.0.1"]

    monkeypatch.setattr(event_backbone, "_resolve_addresses", resolves_to_mixed)
    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(assert_outbound_destination("https://hooks.example.com/nexus"))


def test_outbound_destination_refuses_unresolvable_name(monkeypatch):
    async def cannot_resolve(host, port):
        raise socket.gaierror("name resolution failed")

    monkeypatch.setattr(event_backbone, "_resolve_addresses", cannot_resolve)
    with pytest.raises(ValueError, match="could not be resolved"):
        asyncio.run(assert_outbound_destination("https://missing.example.com/nexus"))


def test_outbound_destination_applies_governed_scheme_policy_before_delivery():
    with pytest.raises(ValueError):
        asyncio.run(assert_outbound_destination("http://events.example.com/nexus"))


def test_durable_delivery_refuses_non_public_destination_before_sending():
    delivery = {"id": "dlv_1", "delivery_key": "key-1"}
    subscription = {"endpoint_url": "https://169.254.169.254/latest/meta-data/", "signing_secret_encrypted": None}
    event = {"id": "evt_1", "subject": "client.created"}

    success, status_code, excerpt, permanent = asyncio.run(
        event_backbone._deliver_webhook(delivery, subscription, event)
    )

    assert success is False
    assert status_code is None
    assert permanent is True, "a policy refusal must not be retried as a network failure"
    assert excerpt.startswith("Blocked destination:")


def test_create_subscription_rejects_non_public_endpoint_before_persisting(monkeypatch):
    class RefusesWrites:
        async def insert_one(self, *args, **kwargs):
            raise AssertionError("a refused endpoint must not be persisted")

    async def no_indexes():
        return None

    monkeypatch.setattr(event_backbone, "ensure_event_backbone_indexes", no_indexes)
    monkeypatch.setattr(
        event_backbone,
        "db",
        SimpleNamespace(platform_event_subscriptions=RefusesWrites()),
    )

    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(
            event_backbone.create_subscription(
                {"name": "Internal hooks", "endpoint_url": "https://169.254.169.254/hook"},
                {"id": "user-1", "name": "Operator"},
            )
        )


def test_update_subscription_rejects_non_public_endpoint_before_persisting(monkeypatch):
    class Stored:
        async def find_one(self, *args, **kwargs):
            return {"id": "sub-1", "delivery_type": "webhook", "endpoint_url": "https://hooks.example.com/old"}

        async def update_one(self, *args, **kwargs):
            raise AssertionError("a refused endpoint must not be persisted")

    async def no_indexes():
        return None

    monkeypatch.setattr(event_backbone, "ensure_event_backbone_indexes", no_indexes)
    monkeypatch.setattr(event_backbone, "db", SimpleNamespace(platform_event_subscriptions=Stored()))

    with pytest.raises(ValueError, match="non-public"):
        asyncio.run(
            event_backbone.update_subscription("sub-1", {"endpoint_url": "https://10.0.0.7/hook"})
        )


def test_legacy_hook_creation_rejects_non_public_endpoint(monkeypatch):
    from fastapi import HTTPException

    from app.routers import webhook_builder

    class RefusesWrites:
        async def insert_one(self, *args, **kwargs):
            raise AssertionError("a refused endpoint must not be stored")

    monkeypatch.setattr(webhook_builder, "db", SimpleNamespace(webhooks=RefusesWrites()))

    with pytest.raises(HTTPException) as raised:
        asyncio.run(
            webhook_builder.create_webhook(
                {"name": "Internal hook", "url": "https://127.0.0.1/hook"},
                {"name": "Operator"},
            )
        )
    assert raised.value.status_code == 400
    assert "non-public" in str(raised.value.detail)


def test_legacy_hook_edit_rejects_non_public_endpoint(monkeypatch):
    from fastapi import HTTPException

    from app.routers import webhook_builder

    class RefusesWrites:
        async def update_one(self, *args, **kwargs):
            raise AssertionError("a refused endpoint must not be stored")

    monkeypatch.setattr(webhook_builder, "db", SimpleNamespace(webhooks=RefusesWrites()))

    with pytest.raises(HTTPException) as raised:
        asyncio.run(
            webhook_builder.update_webhook(
                "WH-1",
                {"url": "https://169.254.169.254/hook"},
                {"name": "Operator"},
            )
        )
    assert raised.value.status_code == 400
    assert "non-public" in str(raised.value.detail)
