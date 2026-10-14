"""Security contracts for the operational notification-channel setting."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import pro_pack
from app.services import notification_channels


class _Collection:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])
        self.updates = []

    async def find_one(self, query, _projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return deepcopy(row)
        return None

    async def insert_one(self, row):
        self.rows.append(deepcopy(row))

    async def update_one(self, query, update, **_kwargs):
        self.updates.append((deepcopy(query), deepcopy(update)))
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                row.update(deepcopy(update.get("$set", {})))
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def _admin():
    return {"id": "admin-1", "name": "Nexus Administrator", "role": "admin"}


def test_public_channel_metadata_never_contains_a_webhook_destination():
    raw_url = "https://hooks.example.test/services/opaque-delivery-credential"
    result = notification_channels.public_notification_channel(
        {
            "id": "channel-1",
            "name": "Operations",
            "kind": "slack",
            "events": ["ticket_created", "sla_breach"],
            "webhook_url_encrypted": notification_channels.encrypt_secret(raw_url),
        }
    )

    assert raw_url not in str(result)
    assert "webhook_url" not in result
    assert result["webhook_configured"] is True
    assert result["events"] == ["ticket_created"]
    assert result["needs_event_review"] is True


def test_channel_input_requires_https_and_an_event_nexus_currently_emits():
    with pytest.raises(ValueError, match="requires HTTPS"):
        notification_channels.normalise_notification_channel_input(
            {"kind": "slack", "webhook_url": "http://not-secure.example.test", "events": ["ticket_created"]}
        )

    with pytest.raises(ValueError, match="Only ticket-created delivery"):
        notification_channels.normalise_notification_channel_input(
            {"kind": "slack", "webhook_url": "https://hooks.example.test/opaque", "events": ["invoice_paid"]}
        )


def test_legacy_plaintext_channel_is_upgraded_only_during_server_side_delivery(monkeypatch):
    collection = _Collection([{"id": "legacy-1", "webhook_url": "https://hooks.example.test/legacy-secret"}])
    monkeypatch.setattr(notification_channels, "db", SimpleNamespace(notify_channels=collection))

    resolved = asyncio.run(notification_channels.resolve_notification_webhook_url(collection.rows[0]))

    assert resolved == "https://hooks.example.test/legacy-secret"
    stored = collection.rows[0]
    assert "webhook_url" not in stored
    assert stored["webhook_url_encrypted"] != resolved
    assert notification_channels.decrypt_secret(stored["webhook_url_encrypted"]) == resolved


def test_create_channel_stores_the_destination_encrypted_and_requires_an_admin(monkeypatch):
    async def no_op_activity(*_args, **_kwargs):
        return None

    async def exercise():
        channels = _Collection()
        database = SimpleNamespace(
            users=_Collection([{"id": "admin-1", "role": "admin"}, {"id": "tech-1", "role": "technician"}]),
            notify_channels=channels,
        )
        monkeypatch.setattr(pro_pack, "db", database)
        monkeypatch.setattr(pro_pack, "log_activity", no_op_activity)

        result = await pro_pack.create_channel(
            {
                "name": "Operations alerts",
                "kind": "teams",
                "webhook_url": "https://hooks.example.test/secure-channel",
                "events": ["ticket_created"],
            },
            _admin(),
        )

        assert "webhook_url" not in result
        assert result["webhook_configured"] is True
        stored = channels.rows[0]
        assert "webhook_url" not in stored
        assert stored["webhook_url_encrypted"]

        with pytest.raises(HTTPException) as denied:
            await pro_pack.create_channel(
                {
                    "name": "Denied",
                    "kind": "slack",
                    "webhook_url": "https://hooks.example.test/denied",
                },
                {"id": "tech-1"},
            )
        assert denied.value.status_code == 403

    asyncio.run(exercise())
