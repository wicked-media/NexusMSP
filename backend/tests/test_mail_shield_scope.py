"""Regression coverage for Mail Shield Microsoft-provider visibility."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import mail_shield


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _Collection:
    def __init__(self, name, captured, rows=None, row=None):
        self.name = name
        self.captured = captured
        self.rows = rows or []
        self.row = row

    def find(self, query, _projection=None):
        self.captured.setdefault(self.name, []).append(query)
        return _Cursor(self.rows)

    async def find_one(self, query, _projection=None):
        self.captured.setdefault(self.name, []).append(query)
        return self.row


def _contains(value, expected):
    if value == expected:
        return True
    if isinstance(value, dict):
        return any(_contains(item, expected) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains(item, expected) for item in value)
    return False


def _platform_user():
    return {"id": "admin-a", "role": "admin", "tenant_id": "platform-a"}


def test_mail_shield_overview_uses_the_shared_provider_visibility_boundary(monkeypatch):
    captured = {}
    calls = []

    async def visible(current_user, *, database):
        calls.append((current_user, database))
        return {"entra-a"}

    database = SimpleNamespace(
        nexus_mail_shield_signals=_Collection("signals", captured),
        m365_tenants=_Collection("provider_tenants", captured),
    )
    monkeypatch.setattr(mail_shield, "db", database)
    monkeypatch.setattr(mail_shield, "visible_m365_provider_tenant_ids", visible)

    result = asyncio.run(mail_shield._overview(_platform_user()))

    assert result["connection"]["tenant_count"] == 0
    assert calls == [(_platform_user(), database)]
    query = captured["provider_tenants"][0]
    assert _contains(query, {"tenant_id": {"$in": ["entra-a"]}})
    assert not _contains(query, {"tenant_id": "platform-a"})


def test_mail_shield_connection_list_fails_closed_without_provider_visibility(monkeypatch):
    captured = {}

    async def visible(*_args, **_kwargs):
        return set()

    monkeypatch.setattr(
        mail_shield,
        "db",
        SimpleNamespace(
            m365_tenants=_Collection("provider_tenants", captured),
            nexus_mail_shield_connections=_Collection("connections", captured),
        ),
    )
    monkeypatch.setattr(mail_shield, "visible_m365_provider_tenant_ids", visible)

    response = asyncio.run(mail_shield.list_mail_shield_connections(_platform_user()))

    assert response["connections"] == []
    assert _contains(
        captured["provider_tenants"][0],
        {"tenant_id": {"$in": []}},
    )
    assert _contains(
        captured["connections"][0],
        {"tenant_id": {"$in": []}},
    )


def test_mail_shield_configuration_masks_a_foreign_provider_tenant(monkeypatch):
    captured = {}

    async def visible(*_args, **_kwargs):
        return set()

    monkeypatch.setattr(
        mail_shield,
        "db",
        SimpleNamespace(
            m365_tenants=_Collection("provider_tenants", captured, row=None),
        ),
    )
    monkeypatch.setattr(mail_shield, "visible_m365_provider_tenant_ids", visible)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            mail_shield.configure_mail_shield_connection(
                "entra-foreign",
                {},
                current_user=_platform_user(),
            )
        )

    assert exc.value.status_code == 404
    assert _contains(
        captured["provider_tenants"][0],
        {"tenant_id": {"$in": []}},
    )


def test_mail_shield_evidence_verification_masks_a_foreign_provider_tenant(monkeypatch):
    captured = {}

    async def visible(*_args, **_kwargs):
        return set()

    monkeypatch.setattr(
        mail_shield,
        "db",
        SimpleNamespace(
            m365_tenants=_Collection("provider_tenants", captured, row=None),
        ),
    )
    monkeypatch.setattr(mail_shield, "visible_m365_provider_tenant_ids", visible)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            mail_shield.verify_mail_shield_evidence_connection(
                "entra-foreign",
                {"verification_id": "verified-ref"},
                current_user=_platform_user(),
            )
        )

    assert exc.value.status_code == 404
    assert _contains(
        captured["provider_tenants"][0],
        {"tenant_id": {"$in": []}},
    )
