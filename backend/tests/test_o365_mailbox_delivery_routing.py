"""Regression coverage for central Microsoft 365 sender selection.

The mailbox settings record is the source of truth for every shared outbound
email workflow.  These tests keep mailbox removal and legacy-record upgrades
from leaving a workflow routed to an address that no longer exists.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import o365_mailbox


class _Collection:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return deepcopy(row)
        return None

    async def update_one(self, query, update, upsert=False):
        row = next(
            (
                item
                for item in self.rows
                if all(item.get(key) == value for key, value in query.items())
            ),
            None,
        )
        if row is None and upsert:
            row = deepcopy(query)
            self.rows.append(row)
        if row is None:
            return SimpleNamespace(matched_count=0, modified_count=0)
        row.update(deepcopy(update.get("$set", {})))
        return SimpleNamespace(matched_count=1, modified_count=1)


class _Database(SimpleNamespace):
    def __init__(self, settings):
        super().__init__(
            users=_Collection([{"id": "admin-1", "role": "admin"}]),
            settings=_Collection([settings]),
        )


def _admin():
    return {"id": "admin-1", "name": "Mailbox Administrator", "role": "admin"}


def test_removing_the_selected_sender_rehomes_all_outbound_roles(monkeypatch):
    database = _Database(
        {
            "type": "o365_mailbox",
            "connected": True,
            "enabled": True,
            "live_sync_enabled": True,
            "mailbox_email": "billing@example.com",
            "outbound_mailbox_email": "billing@example.com",
            "mailboxes": [
                {"id": "billing", "mailbox_email": "billing@example.com"},
                {"id": "support", "mailbox_email": "support@example.com"},
            ],
            "outbound_routing": {role: "billing@example.com" for role in o365_mailbox.OUTBOUND_ROLES},
        }
    )
    monkeypatch.setattr(o365_mailbox, "db", database)

    result = asyncio.run(o365_mailbox.remove_o365_mailbox("billing", _admin()))

    saved = database.settings.rows[0]
    assert result["remaining"] == 1
    assert saved["mailbox_email"] == "support@example.com"
    assert saved["outbound_mailbox_email"] == "support@example.com"
    assert set(saved["outbound_routing"]) == o365_mailbox.OUTBOUND_ROLES
    assert set(saved["outbound_routing"].values()) == {"support@example.com"}
    assert saved["connected"] is True
    assert saved["live_sync_enabled"] is True


def test_last_mailbox_removal_disables_delivery_and_clears_sender(monkeypatch):
    database = _Database(
        {
            "type": "o365_mailbox",
            "connected": True,
            "enabled": True,
            "live_sync_enabled": True,
            "mailbox_email": "support@example.com",
            "outbound_mailbox_email": "support@example.com",
            "mailboxes": [{"id": "support", "mailbox_email": "support@example.com"}],
            "outbound_routing": {role: "support@example.com" for role in o365_mailbox.OUTBOUND_ROLES},
        }
    )
    monkeypatch.setattr(o365_mailbox, "db", database)

    asyncio.run(o365_mailbox.remove_o365_mailbox("support", _admin()))

    saved = database.settings.rows[0]
    assert saved["mailboxes"] == []
    assert saved["connected"] is False
    assert saved["enabled"] is False
    assert saved["live_sync_enabled"] is False
    assert saved["mailbox_email"] == ""
    assert saved["outbound_mailbox_email"] == ""
    assert saved["outbound_routing"] == {}


def test_legacy_single_mailbox_is_preserved_when_settings_are_saved(monkeypatch):
    database = _Database(
        {
            "type": "o365_mailbox",
            "connected": True,
            "enabled": True,
            "tenant_id": "tenant",
            "client_id": "client",
            "client_secret": "secret",
            "mailbox_email": "support@example.com",
        }
    )
    monkeypatch.setattr(o365_mailbox, "db", database)

    asyncio.run(
        o365_mailbox.update_o365_mailbox_settings(
            {"outbound_mailbox_email": "support@example.com"},
            _admin(),
        )
    )

    saved = database.settings.rows[0]
    assert saved["mailboxes"] == [
        {
            "id": "legacy-primary",
            "mailbox_email": "support@example.com",
            "tenant_id": "tenant",
            "client_id": "client",
            "connected": True,
            "connection_status": "disconnected",
            "email_to_lead_enabled": True,
            "email_to_ticket_enabled": False,
            "last_sync": None,
        }
    ]
    assert saved["outbound_mailbox_email"] == "support@example.com"


def test_service_job_categories_are_configurable_outbound_roles():
    assert {"service_job_comments", "service_job_replies"}.issubset(o365_mailbox.OUTBOUND_ROLES)


def test_mailbox_settings_never_return_an_encrypted_service_credential(monkeypatch):
    database = _Database(
        {
            "type": "o365_mailbox",
            "connected": True,
            "tenant_id": "tenant",
            "client_id": "client",
            "client_secret_encrypted": "opaque-server-only-value",
            "mailbox_email": "support@example.com",
        }
    )
    monkeypatch.setattr(o365_mailbox, "db", database)

    result = asyncio.run(o365_mailbox.get_o365_mailbox_settings(_admin()))

    assert result["client_secret"] == ""
    assert result["client_secret_set"] is True
    assert "client_secret_encrypted" not in result


def test_mailbox_operational_controls_require_an_admin_but_allow_the_scheduler(monkeypatch):
    database = _Database({"type": "o365_mailbox", "mailboxes": []})
    database.users.rows.append({"id": "tech-1", "role": "technician"})
    monkeypatch.setattr(o365_mailbox, "db", database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(o365_mailbox._require_mailbox_admin({"id": "tech-1"}))
    assert getattr(denied.value, "status_code", None) == 403

    asyncio.run(
        o365_mailbox._require_mailbox_admin(
            {"id": "system-microsoft365-sync", "role": "system"},
            allow_system_sync=True,
        )
    )
