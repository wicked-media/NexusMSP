"""Two-client tenant-isolation coverage for Yeastar extension overrides."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import yeastar
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(row.get(key) == value for key, value in (query or {}).items())


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = [dict(row) for row in (rows or [])]
        self.find_one_queries: list[dict[str, Any]] = []
        self.update_calls: list[tuple[dict[str, Any], dict[str, Any], bool]] = []
        self.inserted: list[dict[str, Any]] = []

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        self.find_one_queries.append(dict(query))
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False):
        self.update_calls.append((dict(query), dict(update), upsert))
        row = next((item for item in self.rows if _matches(item, query)), None)
        if row is None and upsert:
            row = {key: value for key, value in query.items() if not isinstance(value, dict)}
            self.rows.append(row)
        if row is not None:
            row.update(dict(update.get("$set") or {}))
        return SimpleNamespace(matched_count=1 if row is not None else 0)

    async def insert_one(self, row: dict[str, Any]):
        record = dict(row)
        self.rows.append(record)
        self.inserted.append(record)


class _Db:
    def __init__(self):
        self.yeastar_pbxs = _Collection([
            {"id": "pbx-a", "name": "PBX A", "client_id": "client-a"},
            {"id": "pbx-b", "name": "PBX B", "client_id": "client-b"},
        ])
        self.yeastar_extension_overrides = _Collection([
            {
                "extension_key": "pbx-b:200",
                "extension_number": "200",
                "client_id": "client-b",
                "enabled": True,
                "exclude_from_billing": False,
            },
        ])
        self.scope_denials = _Collection()


def _client_a_technician() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "email": "tech-a@example.test",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_db(monkeypatch: pytest.MonkeyPatch) -> _Db:
    fake_db = _Db()

    async def log_activity(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(yeastar, "db", fake_db)
    monkeypatch.setattr(scope_permissions, "db", fake_db)
    monkeypatch.setattr(yeastar, "log_activity", log_activity)
    return fake_db


def test_client_a_cannot_read_or_mutate_client_b_extension_override(monkeypatch: pytest.MonkeyPatch):
    """The PBX client boundary is enforced before any override access."""
    fake_db = _install_db(monkeypatch)

    with pytest.raises(HTTPException) as blocked:
        asyncio.run(yeastar.update_yeastar_extension_override(
            "200",
            {
                "extension_key": "pbx-b:200",
                "exclude_from_billing": True,
                "change_reason": "Attacker-supplied mutation",
            },
            current_user=_client_a_technician(),
        ))

    assert blocked.value.status_code == 404
    assert fake_db.yeastar_extension_overrides.find_one_queries == []
    assert fake_db.yeastar_extension_overrides.update_calls == []
    assert fake_db.yeastar_extension_overrides.rows[0]["exclude_from_billing"] is False
    assert fake_db.scope_denials.inserted[0]["client_id"] == "client-b"


def test_override_without_a_canonical_pbx_key_is_rejected_before_database_access(monkeypatch: pytest.MonkeyPatch):
    """A bare extension number cannot be used to bypass client ownership proof."""
    fake_db = _install_db(monkeypatch)

    with pytest.raises(HTTPException) as blocked:
        asyncio.run(yeastar.update_yeastar_extension_override(
            "200",
            {"extension_key": "200", "exclude_from_billing": True, "change_reason": "Invalid legacy key"},
            current_user=_client_a_technician(),
        ))

    assert blocked.value.status_code == 400
    assert fake_db.yeastar_pbxs.find_one_queries == []
    assert fake_db.yeastar_extension_overrides.find_one_queries == []
    assert fake_db.yeastar_extension_overrides.update_calls == []


def test_client_a_can_mutate_its_own_extension_and_record_client_ownership(monkeypatch: pytest.MonkeyPatch):
    """Valid scoped work remains supported and keeps the override client-bound."""
    fake_db = _install_db(monkeypatch)

    result = asyncio.run(yeastar.update_yeastar_extension_override(
        "100",
        {
            "extension_key": "pbx-a:100",
            "exclude_from_billing": True,
            "change_reason": "Approved test handset",
        },
        current_user=_client_a_technician(),
    ))

    assert result["client_id"] == "client-a"
    assert result["exclude_from_billing"] is True
    assert fake_db.yeastar_extension_overrides.rows[-1]["extension_key"] == "pbx-a:100"
    assert fake_db.yeastar_extension_overrides.rows[-1]["client_id"] == "client-a"


def test_global_operator_keeps_authorised_cross_client_override_access(monkeypatch: pytest.MonkeyPatch):
    """A globally authorised operator may still govern any client-linked PBX."""
    fake_db = _install_db(monkeypatch)

    result = asyncio.run(yeastar.update_yeastar_extension_override(
        "200",
        {
            "extension_key": "pbx-b:200",
            "exclude_from_billing": True,
            "change_reason": "Approved billing exclusion",
        },
        current_user={"id": "admin-1", "is_admin": True},
    ))

    assert result["client_id"] == "client-b"
    assert fake_db.yeastar_extension_overrides.rows[0]["exclude_from_billing"] is True
