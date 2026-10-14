"""Focused boundaries for recurring reconciliation and Acronis mappings."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import billing_reconcile
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, part) for part in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection=None) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def update_one(self, query: dict[str, Any], update: dict[str, Any]):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            recurring_invoices=_Collection(
                [
                    {
                        "id": "recurring-a",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "description": "Client A support",
                        "currency": "AUD",
                        "status": "active",
                        # Current Nexus recurring-form shape intentionally uses rate.
                        "line_items": [{"description": "Managed endpoint", "quantity": 2, "rate": 40, "acronis_policy_id": "policy-a"}],
                    },
                    {
                        "id": "recurring-b",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "description": "Client B confidential support",
                        "currency": "AUD",
                        "status": "active",
                        "line_items": [{"description": "Managed endpoint", "quantity": 5, "rate": 90, "acronis_policy_id": "policy-b"}],
                    },
                ]
            ),
            devices=_Collection(
                [
                    {"id": "device-a", "client_id": "client-a", "name": "Client A endpoint"},
                    {"id": "device-b", "client_id": "client-b", "name": "Client B endpoint"},
                ]
            ),
            scope_denials=_Collection(),
            activity_logs=_Collection(),
            tickets=_Collection(),
        )


def _restricted_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install(monkeypatch: pytest.MonkeyPatch) -> tuple[_Database, list[dict[str, Any]]]:
    database = _Database()
    audit: list[dict[str, Any]] = []
    monkeypatch.setattr(billing_reconcile, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(
        billing_reconcile,
        "_count_devices_under_policy",
        lambda policy_id, _client_id: _async_value(
            {"policy-a": {"mapped_count": 4, "acronis_count": 4, "mapped_devices": []}, "policy-b": {"mapped_count": 8, "acronis_count": 8, "mapped_devices": []}}[policy_id]
        ),
    )

    async def _log(*args, **kwargs):
        audit.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(billing_reconcile, "log_activity", _log)
    return database, audit


def test_reconciliation_scopes_records_and_uses_legacy_rate(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_reconciliation_scopes_records_and_uses_legacy_rate(monkeypatch))


async def _test_reconciliation_scopes_records_and_uses_legacy_rate(monkeypatch: pytest.MonkeyPatch):
    database, _audit = _install(monkeypatch)
    user = _restricted_user()

    result = await billing_reconcile.reconcile_recurring_invoice("recurring-a", current_user=user)
    assert result["summary"]["bill_shock_amount"] == 80.0
    assert result["line_items"][0]["unit_price"] == 40.0

    with pytest.raises(HTTPException) as foreign:
        await billing_reconcile.reconcile_recurring_invoice("recurring-b", current_user=user)
    assert foreign.value.status_code == 404
    assert database.scope_denials.rows[-1]["operation"] == "billing.recurring.reconcile.read"


def test_policy_mapping_and_watchtower_are_client_scoped_and_audited(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_policy_mapping_and_watchtower_are_client_scoped_and_audited(monkeypatch))


async def _test_policy_mapping_and_watchtower_are_client_scoped_and_audited(monkeypatch: pytest.MonkeyPatch):
    database, audit = _install(monkeypatch)
    user = _restricted_user()

    updated = await billing_reconcile.link_line_item_to_policy(
        "recurring-a", 0, {"acronis_policy_id": "policy-a-new"}, current_user=user
    )
    assert updated["message"] == "Linked"
    assert database.recurring_invoices.rows[0]["line_items"][0]["acronis_policy_id"] == "policy-a-new"
    assert audit[-1]["args"][1] == "recurring_policy_mapping_updated"

    with pytest.raises(HTTPException) as foreign:
        await billing_reconcile.link_line_item_to_policy(
            "recurring-b", 0, {"acronis_policy_id": "policy-b"}, current_user=user
        )
    assert foreign.value.status_code == 404

    # Restore the mapped policy for the deterministic mock, then verify a
    # restricted technician cannot see Client B's bill-shock evidence.
    database.recurring_invoices.rows[0]["line_items"][0]["acronis_policy_id"] = "policy-a"
    watchtower = await billing_reconcile.drift_watchtower(current_user=user)
    assert watchtower["scanned_invoices"] == 1
    assert watchtower["all_rows"][0]["recurring_invoice_id"] == "recurring-a"
    assert watchtower["all_rows"][0]["bill_shock_amount"] == 80.0


async def _async_value(value):
    return value
