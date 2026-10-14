"""Security regressions for the bounded recurring-smart billing workflows.

The smart layer operates over recurring invoice templates, so it must not
become a less-governed path around client scope, billing delivery controls or
optimistic financial updates.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import email_utils, recurring_smart
from app.services import action_permissions, scope_permissions


_MISSING = object()


def _value(row: dict[str, Any], key: str) -> Any:
    current: Any = row
    for segment in key.split("."):
        if not isinstance(current, dict) or segment not in current:
            return _MISSING
        current = current[segment]
    return current


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = _value(row, key)
        if isinstance(expected, dict):
            if "$exists" in expected and (actual is not _MISSING) != bool(expected["$exists"]):
                return False
            if "$ne" in expected and actual is not _MISSING and actual == expected["$ne"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            continue
        if actual is _MISSING or actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    def limit(self, _limit: int):
        return self

    async def to_list(self, limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows[:limit])


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], **_kwargs: Any):
        for row in self.rows:
            if not _matches(row, query):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, increment in update.get("$inc", {}).items():
                row[field] = row.get(field, 0) + increment
            for field in update.get("$unset", {}):
                row.pop(field, None)
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def count_documents(self, query: dict[str, Any]) -> int:
        return sum(1 for row in self.rows if _matches(row, query))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            recurring_invoices=_Collection(
                [
                    {
                        "id": "ri-a-1",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "description": "Client A managed services",
                        "status": "active",
                        "frequency": "monthly",
                        "amount": 100.0,
                        "line_items": [{"description": "Support", "quantity": 1, "rate": 100, "amount": 100}],
                        "next_due_date": "2030-01-15",
                        "auto_send_email": "billing@client-a.example",
                        "version": 3,
                    },
                    {
                        "id": "ri-a-2",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "description": "Client A backup",
                        "status": "active",
                        "frequency": "monthly",
                        "amount": 25.0,
                        "line_items": [{"description": "Backup", "quantity": 1, "rate": 25, "amount": 25}],
                        "next_due_date": "2030-01-15",
                        "version": 2,
                    },
                    {
                        "id": "ri-b-1",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "description": "Client B confidential services",
                        "status": "active",
                        "frequency": "monthly",
                        "amount": 500.0,
                        "line_items": [{"description": "Confidential", "quantity": 1, "rate": 500, "amount": 500}],
                        "next_due_date": "2030-01-15",
                        "version": 7,
                    },
                ]
            ),
            clients=_Collection(
                [
                    {"id": "client-a", "name": "Client A", "billing_email": "accounts@client-a.example", "currency": "AUD"},
                    {"id": "client-b", "name": "Client B", "billing_email": "accounts@client-b.example", "currency": "AUD"},
                ]
            ),
            invoices=_Collection(),
            tickets=_Collection(),
            settings=_Collection(),
            recurring_prebill_log=_Collection(),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
            permission_denials=_Collection(),
        )


def _restricted_client_a_user() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _admin() -> dict[str, Any]:
    return {"id": "admin-1", "name": "Billing Admin", "role": "admin", "is_admin": True}


def _install_database(monkeypatch: pytest.MonkeyPatch) -> tuple[_Database, list[dict[str, Any]]]:
    database = _Database()
    activity: list[dict[str, Any]] = []
    monkeypatch.setattr(recurring_smart, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)

    async def _activity(*args: Any, **kwargs: Any) -> None:
        activity.append({"args": args, "kwargs": kwargs})

    monkeypatch.setattr(recurring_smart, "log_activity", _activity)
    return database, activity


def test_recurring_smart_denies_foreign_client_reads_and_writes_before_mutation(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_recurring_smart_denies_foreign_client_reads_and_writes_before_mutation(monkeypatch))


async def _test_recurring_smart_denies_foreign_client_reads_and_writes_before_mutation(monkeypatch: pytest.MonkeyPatch):
    database, _activity = _install_database(monkeypatch)
    user = _restricted_client_a_user()

    with pytest.raises(HTTPException) as invalid_id:
        await recurring_smart.set_uplift_rule("ri-a-1\r\nignored", {"pct": 5}, user)
    assert invalid_id.value.status_code == 422

    before = deepcopy(database.recurring_invoices.rows)
    foreign_operations = (
        recurring_smart.set_uplift_rule("ri-b-1", {"pct": 5}, user),
        recurring_smart.apply_uplift_now("ri-b-1", user),
        recurring_smart.renewal_risk("ri-b-1", user),
        recurring_smart.send_pre_bill_preview("ri-b-1", {"email": "attacker@outside.example"}, user),
        recurring_smart.pause_with_range("ri-b-1", {"to_date": "2030-01-15"}, user),
        recurring_smart.rollup_usage("ri-b-1", user),
    )
    for operation in foreign_operations:
        with pytest.raises(HTTPException) as denied:
            await operation
        assert denied.value.status_code == 404
    assert database.recurring_invoices.rows == before

    with pytest.raises(HTTPException) as foreign_consolidation:
        await recurring_smart.consolidate_client("client-b", None, user)
    assert foreign_consolidation.value.status_code == 404
    assert database.recurring_invoices.rows == before
    assert all(row["client_id"] == "client-b" for row in database.scope_denials.rows)


def test_prebill_uses_trusted_recipient_and_same_period_delivery_is_claimed_once(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_prebill_uses_trusted_recipient_and_same_period_delivery_is_claimed_once(monkeypatch))


async def _test_prebill_uses_trusted_recipient_and_same_period_delivery_is_claimed_once(monkeypatch: pytest.MonkeyPatch):
    database, activity = _install_database(monkeypatch)
    deliveries: list[dict[str, Any]] = []

    async def _send_email(recipient: str, subject: str, body: str, **kwargs: Any) -> dict[str, Any]:
        deliveries.append({"recipient": recipient, "subject": subject, "body": body, "kwargs": kwargs})
        return {"status": "sent", "message": "queued", "sender": "billing@nexus.example"}

    monkeypatch.setattr(email_utils, "send_email", _send_email)
    user = _restricted_client_a_user()

    result = await recurring_smart.send_pre_bill_preview(
        "ri-a-1", {"email": "attacker@outside.example"}, user
    )

    assert result["sent"] is True
    assert result["email"] == "billing@client-a.example"
    assert [delivery["recipient"] for delivery in deliveries] == ["billing@client-a.example"]
    assert "attacker@outside.example" not in deliveries[0]["body"]
    stored = database.recurring_invoices.rows[0]
    assert stored["prebill_preview_sent_for"] == "2030-01-15"
    assert "prebill_preview_lock" not in stored
    assert stored["version"] == 5
    assert len(database.recurring_prebill_log.rows) == 1
    assert activity[-1]["kwargs"]["metadata"]["client_id"] == "client-a"

    with pytest.raises(HTTPException) as repeated:
        await recurring_smart.send_pre_bill_preview("ri-a-1", {"email": "other@outside.example"}, user)
    assert repeated.value.status_code == 409
    assert len(deliveries) == 1


def test_consolidation_is_client_bound_and_avoids_a_second_active_path(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_consolidation_is_client_bound_and_avoids_a_second_active_path(monkeypatch))


async def _test_consolidation_is_client_bound_and_avoids_a_second_active_path(monkeypatch: pytest.MonkeyPatch):
    database, activity = _install_database(monkeypatch)

    consolidated = await recurring_smart.consolidate_client("client-a", None, _restricted_client_a_user())

    assert consolidated["client_id"] == "client-a"
    assert consolidated["status"] == "active"
    assert consolidated["version"] == 2
    a_sources = database.recurring_invoices.rows[:2]
    assert {source["status"] for source in a_sources} == {"paused"}
    assert all(source["consolidated_into"] == consolidated["id"] for source in a_sources)
    assert database.recurring_invoices.rows[2]["status"] == "active"
    active_a = [row for row in database.recurring_invoices.rows if row["client_id"] == "client-a" and row["status"] == "active"]
    assert [row["id"] for row in active_a] == [consolidated["id"]]
    assert activity[-1]["kwargs"]["metadata"]["source_recurring_invoice_ids"] == ["ri-a-1", "ri-a-2"]


def test_recurring_updates_bind_client_state_and_version(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_recurring_updates_bind_client_state_and_version(monkeypatch))


async def _test_recurring_updates_bind_client_state_and_version(monkeypatch: pytest.MonkeyPatch):
    database, _activity = _install_database(monkeypatch)
    stale = deepcopy(database.recurring_invoices.rows[0])
    database.recurring_invoices.rows[0]["version"] += 1

    with pytest.raises(HTTPException) as conflict:
        await recurring_smart._update_scoped_recurring(stale, {"amount": 9999})
    assert conflict.value.status_code == 409
    assert database.recurring_invoices.rows[0]["amount"] == 100.0


def test_billing_actions_used_by_recurring_smart_are_not_permissive_technician_defaults(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_billing_actions_used_by_recurring_smart_are_not_permissive_technician_defaults(monkeypatch))


async def _test_billing_actions_used_by_recurring_smart_are_not_permissive_technician_defaults(monkeypatch: pytest.MonkeyPatch):
    database, _activity = _install_database(monkeypatch)
    user = _restricted_client_a_user()
    protected_actions = {
        "billing.invoice.create",
        "billing.invoice.modify",
        "billing.portal.reminder.send",
    }

    assert protected_actions.isdisjoint(action_permissions.default_permissions_for_role("technician"))
    for permission_id in protected_actions:
        result = await action_permissions.evaluate_action_permission(user, permission_id)
        assert result["allowed"] is False
    assert database.permission_denials.rows == []

    expected_route_permissions = {
        "/recurring-invoices/{ri_id}/uplift-rule": {"billing.invoice.modify"},
        "/recurring-invoices/{ri_id}/apply-uplift": {"billing.invoice.modify"},
        "/recurring-invoices/{ri_id}/renewal-risk": {"billing.portal.view"},
        "/recurring-invoices/consolidate/{client_id}": {"billing.invoice.create", "billing.invoice.modify"},
        "/recurring-invoices/{ri_id}/pre-bill-preview": {"billing.portal.reminder.send"},
        "/recurring-invoices/{ri_id}/pause-range": {"billing.invoice.modify"},
        "/recurring-invoices/{ri_id}/rollup-usage": {"billing.invoice.modify"},
    }
    actual_route_permissions = {
        route.path: {
            cell.cell_contents
            for dependency in route.dependencies
            for cell in (dependency.dependency.__closure__ or ())
            if isinstance(cell.cell_contents, str)
        }
        for route in recurring_smart.router.routes
    }
    assert actual_route_permissions == expected_route_permissions
