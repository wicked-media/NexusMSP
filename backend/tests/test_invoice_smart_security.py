"""Focused security regressions for the Invoice Smart financial routes."""

from __future__ import annotations

import asyncio
import sys
from copy import deepcopy
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import invoice_smart
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

    async def to_list(self, _limit: int):
        return deepcopy(self.rows[:_limit])


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], *, upsert: bool = False, **_kwargs: Any):
        row = next((row for row in self.rows if _matches(row, query)), None)
        inserted = False
        if row is None and upsert:
            row = {
                key: deepcopy(value)
                for key, value in query.items()
                if not key.startswith("$") and not isinstance(value, dict)
            }
            self.rows.append(row)
            inserted = True
        if row is None:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        if inserted:
            row.update(deepcopy(update.get("$setOnInsert", {})))
        row.update(deepcopy(update.get("$set", {})))
        for field, increment in update.get("$inc", {}).items():
            row[field] = row.get(field, 0) + increment
        return SimpleNamespace(matched_count=0 if inserted else 1, modified_count=1, upserted_id=row.get("id") if inserted else None)

    async def delete_one(self, query: dict[str, Any]):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database(SimpleNamespace):
    def __init__(self, invoices: list[dict[str, Any]] | None = None):
        super().__init__(
            invoices=_Collection(invoices),
            invoice_payment_plans=_Collection(),
            invoice_emails=_Collection(),
            late_fee_policies=_Collection(),
            payment_transactions=_Collection(),
            activity_logs=_Collection(),
            permission_denials=_Collection(),
            scope_denials=_Collection(),
            settings=_Collection(),
        )


def _admin() -> dict[str, Any]:
    return {"id": "admin-1", "name": "Finance Admin", "role": "admin", "is_admin": True}


def _invoice(*, invoice_id: str = "invoice-a", client_id: str = "client-a", version: int = 4) -> dict[str, Any]:
    return {
        "id": invoice_id,
        "invoice_number": "INV-100",
        "client_id": client_id,
        "client_name": "Client A",
        "status": "sent",
        "payment_status": "unpaid",
        "currency": "AUD",
        "total": 1000.0,
        "subtotal": 1000.0,
        "amount_paid": 800.0,
        "version": version,
    }


def _install_database(monkeypatch: pytest.MonkeyPatch, invoices: list[dict[str, Any]] | None = None) -> _Database:
    database = _Database(invoices)
    monkeypatch.setattr(invoice_smart, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)

    async def _no_activity(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(invoice_smart, "log_activity", _no_activity)
    return database


def test_late_fee_is_limited_to_the_outstanding_balance_and_only_once(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_late_fee_is_limited_to_the_outstanding_balance_and_only_once(monkeypatch))


async def _test_late_fee_is_limited_to_the_outstanding_balance_and_only_once(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch, [_invoice()])

    result = await invoice_smart.apply_late_fee("invoice-a", {"type": "percent", "value": 10}, _admin())

    assert result["fee"] == 20.0
    assert result["new_total"] == 1020.0
    stored = database.invoices.rows[0]
    assert stored["amount_paid"] == 800.0
    assert stored["late_fee_amount"] == 20.0
    assert stored["version"] == 5

    with pytest.raises(HTTPException) as repeated:
        await invoice_smart.apply_late_fee("invoice-a", {"type": "percent", "value": 10}, _admin())
    assert repeated.value.status_code == 409


def test_new_late_fee_policy_action_is_not_granted_to_technicians_or_managers():
    assert "billing.late_fee.policy.manage" in action_permissions.ACTION_PERMISSION_IDS
    assert "billing.late_fee.policy.manage" not in action_permissions.default_permissions_for_role("technician")
    assert "billing.late_fee.policy.manage" not in action_permissions.default_permissions_for_role("service_desk_manager")


def test_payment_plan_is_client_bound_idempotent_and_versioned(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_payment_plan_is_client_bound_idempotent_and_versioned(monkeypatch))


async def _test_payment_plan_is_client_bound_idempotent_and_versioned(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch, [_invoice()])

    first = await invoice_smart.create_payment_plan(
        "invoice-a", {"installments": 2, "interval_days": 30}, _admin()
    )
    repeated = await invoice_smart.create_payment_plan(
        "invoice-a", {"installments": 2, "interval_days": 30}, _admin()
    )

    assert repeated["id"] == first["id"]
    assert first["client_id"] == "client-a"
    assert len(database.invoice_payment_plans.rows) == 1
    assert database.invoices.rows[0]["payment_plan_id"] == first["id"]
    assert database.invoices.rows[0]["version"] == 5

    marked = await invoice_smart.mark_installment_paid(
        first["id"], first["schedule"][0]["id"], _admin()
    )
    assert marked == {"success": True}
    assert database.invoice_payment_plans.rows[0]["schedule"][0]["status"] == "paid"
    assert database.invoice_payment_plans.rows[0]["version"] == 2


def test_reissue_does_not_copy_payment_capabilities_or_plans(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_reissue_does_not_copy_payment_capabilities_or_plans(monkeypatch))


async def _test_reissue_does_not_copy_payment_capabilities_or_plans(monkeypatch: pytest.MonkeyPatch):
    source = _invoice()
    source.update(
        {
            "amount_paid": 0.0,
            "payment_link": "https://checkout.example/old",
            "payment_link_session_id": "cs-old",
            "payment_plan_id": "plan-old",
            "has_payment_plan": True,
            "stripe_payment_intent_id": "pi-old",
        }
    )
    database = _install_database(monkeypatch, [source])

    reissued = await invoice_smart.reissue_invoice("invoice-a", {"due_days": 21}, _admin())

    assert reissued["reissued_from"] == "invoice-a"
    assert reissued["version"] == 1
    assert reissued["status"] == "draft"
    for field in ("payment_link", "payment_link_session_id", "payment_plan_id", "has_payment_plan", "stripe_payment_intent_id"):
        assert field not in reissued
    assert len(database.invoices.rows) == 2


def test_global_late_fee_policy_rejects_a_technician_without_an_explicit_grant(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_global_late_fee_policy_rejects_a_technician_without_an_explicit_grant(monkeypatch))


async def _test_global_late_fee_policy_rejects_a_technician_without_an_explicit_grant(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch)
    technician = {"id": "tech-1", "name": "Tech", "role": "technician", "client_scope_mode": "all"}

    with pytest.raises(HTTPException) as denied:
        await invoice_smart.set_late_fee_policy({"enabled": True, "type": "percent", "value": 5}, technician)

    assert denied.value.status_code == 403
    assert database.permission_denials.rows[0]["permission"] == "billing.late_fee.policy.manage"
    assert database.late_fee_policies.rows == []


def test_bulk_action_scopes_every_invoice_before_processing_any(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_action_scopes_every_invoice_before_processing_any(monkeypatch))


async def _test_bulk_action_scopes_every_invoice_before_processing_any(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(
        monkeypatch,
        [
            _invoice(invoice_id="invoice-a", client_id="client-a"),
            _invoice(invoice_id="invoice-b", client_id="client-b"),
        ],
    )
    restricted_user = {
        "id": "tech-a",
        "name": "Client A Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as denied:
        await invoice_smart.bulk_invoice_action("send", {"invoice_ids": ["invoice-a", "invoice-b"]}, restricted_user)

    assert denied.value.status_code == 404
    assert database.invoices.rows[0]["status"] == "sent"
    assert database.invoices.rows[1]["status"] == "sent"


def test_bulk_send_freezes_a_commercial_snapshot(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_send_freezes_a_commercial_snapshot(monkeypatch))


async def _test_bulk_send_freezes_a_commercial_snapshot(monkeypatch: pytest.MonkeyPatch):
    invoice = _invoice()
    invoice.update({"status": "draft", "amount_paid": 0.0})
    database = _install_database(monkeypatch, [invoice])

    result = await invoice_smart.bulk_invoice_action(
        "send", {"invoice_ids": ["invoice-a"]}, _admin()
    )

    assert result["processed"] == 1
    assert database.invoices.rows[0]["status"] == "sent"
    assert database.invoices.rows[0]["document_snapshot"]["document_type"] == "invoice"


def test_pay_now_link_reuses_a_single_server_owned_stripe_checkout(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_pay_now_link_reuses_a_single_server_owned_stripe_checkout(monkeypatch))


async def _test_pay_now_link_reuses_a_single_server_owned_stripe_checkout(monkeypatch: pytest.MonkeyPatch):
    database = _install_database(monkeypatch, [_invoice()])
    calls: list[dict[str, Any]] = []

    class _Session:
        @staticmethod
        def create(**kwargs: Any):
            calls.append(kwargs)
            return SimpleNamespace(id="cs-smart-1", url="https://checkout.stripe.test/cs-smart-1")

    stripe_module = ModuleType("stripe")
    stripe_module.checkout = SimpleNamespace(Session=_Session)
    monkeypatch.setitem(sys.modules, "stripe", stripe_module)
    monkeypatch.setenv("STRIPE_API_KEY", "test-key")
    monkeypatch.setenv("PUBLIC_URL", "https://nexus.example")

    first = await invoice_smart.generate_pay_now_link("invoice-a", _admin())
    second = await invoice_smart.generate_pay_now_link("invoice-a", _admin())

    assert first == second
    assert len(calls) == 1
    assert calls[0]["idempotency_key"] == database.payment_transactions.rows[0]["idempotency_key"]
    assert calls[0]["success_url"].startswith("https://nexus.example/")
    assert len(database.payment_transactions.rows) == 1
