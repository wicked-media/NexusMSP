"""Client-boundary regression tests for recurring invoice operations.

Recurring invoices contain financial templates and generation history.  A
technician assigned to Client A must never be able to discover, change, or
generate billing records for Client B merely by altering an ID in the URL.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import recurring_invoices
from app.services import scope_permissions


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if isinstance(expected, dict):
            if "$in" in expected and row.get(key) not in expected["$in"]:
                return False
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            if "$lte" in expected and not (row.get(key) is not None and row.get(key) <= expected["$lte"]):
                return False
            if "$gt" in expected and not (row.get(key) is not None and row.get(key) > expected["$gt"]):
                return False
            continue
        if row.get(key) != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any):
        return self

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(
        self, query: dict[str, Any], _projection: dict[str, Any] | None = None
    ) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict[str, Any]):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query: dict[str, Any], update: dict[str, Any]):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                for field, value in update.get("$inc", {}).items():
                    row[field] = row.get(field, 0) + value
                for field, value in update.get("$push", {}).items():
                    row.setdefault(field, []).append(deepcopy(value))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query: dict[str, Any]):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            clients=_Collection(
                [
                    {"id": "client-a", "name": "Client A"},
                    {"id": "client-b", "name": "Client B"},
                ]
            ),
            recurring_invoices=_Collection(
                [
                    {
                        "id": "recurring-a",
                        "client_id": "client-a",
                        "client_name": "Client A",
                        "description": "Client A managed services",
                        "status": "active",
                        "frequency": "monthly",
                        "amount": 100.0,
                        "invoices_generated": 0,
                        "total_billed": 0,
                        "generation_history": [],
                    },
                    {
                        "id": "recurring-b",
                        "client_id": "client-b",
                        "client_name": "Client B",
                        "description": "Client B confidential services",
                        "status": "active",
                        "frequency": "monthly",
                        "amount": 200.0,
                        "invoices_generated": 0,
                        "total_billed": 0,
                        "generation_history": [],
                    },
                ]
            ),
            assets=_Collection(),
            line_items=_Collection(),
            invoices=_InvoiceCollection(),
            recurring_indexation_log=_Collection(),
            invoice_templates=_Collection(
                [
                    {
                        "id": "template-standard",
                        "name": "Standard managed services",
                        "line_items": [
                            {
                                "description": "Support",
                                "quantity": 1,
                                "rate": 100,
                                "amount": 100,
                            }
                        ],
                        "usage_count": 0,
                    }
                ]
            ),
            scope_denials=_Collection(),
        )


class _InvoiceCollection(_Collection):
    async def create_index(self, *_args: Any, **_kwargs: Any):
        return "recurring_invoice_billing_period_unique"


def _client_a_technician() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_database(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(recurring_invoices, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    return database


async def _assert_masked_denial(awaitable, database: _Database, operation: str) -> None:
    with pytest.raises(HTTPException) as exc:
        await awaitable
    assert exc.value.status_code == 404
    assert exc.value.detail == "Resource not found"
    assert database.scope_denials.rows[-1]["client_id"] == "client-b"
    assert database.scope_denials.rows[-1]["operation"] == operation


def test_restricted_technician_only_sees_own_recurring_billing(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_restricted_technician_only_sees_own_recurring_billing(monkeypatch))


async def _test_restricted_technician_only_sees_own_recurring_billing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)

    technician = _client_a_technician()

    invoices = await recurring_invoices.get_recurring_invoices(current_user=technician)
    stats = await recurring_invoices.get_recurring_stats(current_user=technician)
    owned = await recurring_invoices.get_recurring_invoice(
        "recurring-a", current_user=technician
    )

    assert [invoice["id"] for invoice in invoices] == ["recurring-a"]
    assert stats["total"] == 1
    assert stats["mrr"] == 100.0
    assert owned["client_id"] == "client-a"

    await _assert_masked_denial(
        recurring_invoices.get_recurring_invoice("recurring-b", current_user=technician),
        database,
        "recurring_invoice.read",
    )


def test_restricted_technician_cannot_mutate_or_generate_another_clients_billing(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(
        _test_restricted_technician_cannot_mutate_or_generate_another_clients_billing(
            monkeypatch
        )
    )


async def _test_restricted_technician_cannot_mutate_or_generate_another_clients_billing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)
    technician = _client_a_technician()

    operations = (
        (
            recurring_invoices.update_recurring(
                "recurring-b", {"description": "Attempted cross-client update"}, technician
            ),
            "recurring_invoice.update",
        ),
        (recurring_invoices.delete_recurring("recurring-b", technician), "recurring_invoice.delete"),
        (
            recurring_invoices.set_acronis_auto(
                "recurring-b", {"include_acronis_usage": True}, technician
            ),
            "recurring_invoice.acronis_auto.update",
        ),
        (recurring_invoices.toggle_recurring("recurring-b", technician), "recurring_invoice.toggle"),
        (recurring_invoices.generate_invoice_now("recurring-b", technician), "recurring_invoice.generate"),
        (recurring_invoices.duplicate_recurring("recurring-b", technician), "recurring_invoice.duplicate"),
        (
            recurring_invoices.get_generation_history("recurring-b", technician),
            "recurring_invoice.history.read",
        ),
    )

    for awaitable, operation in operations:
        await _assert_masked_denial(awaitable, database, operation)

    with pytest.raises(HTTPException) as create_exc:
        await recurring_invoices.create_recurring(
            {
                "client_id": "client-b",
                "description": "Attempted Client B recurring invoice",
                "line_items": [{"description": "Support", "quantity": 1, "rate": 100, "amount": 100}],
            },
            technician,
        )
    assert create_exc.value.status_code == 404
    assert database.scope_denials.rows[-1]["operation"] == "recurring_invoice.create"

    with pytest.raises(HTTPException) as by_client_exc:
        await recurring_invoices.get_recurring_by_client("client-b", technician)
    assert by_client_exc.value.status_code == 404
    assert database.scope_denials.rows[-1]["operation"] == "recurring_invoice.list_by_client"

    with pytest.raises(HTTPException) as template_exc:
        await recurring_invoices.apply_template_to_recurring(
            "template-standard", {"client_id": "client-b"}, technician
        )
    assert template_exc.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "recurring_invoice.template.apply"
    assert database.invoice_templates.rows[0]["usage_count"] == 0

    with pytest.raises(HTTPException) as invalid_template_exc:
        await recurring_invoices.apply_template_to_recurring(
            "template-standard", {}, technician
        )
    assert invalid_template_exc.value.status_code == 403
    assert database.scope_denials.rows[-1]["operation"] == "recurring_invoice.template.apply"
    assert database.invoice_templates.rows[0]["usage_count"] == 0

    # A technician can still perform the equivalent safe operation in their own scope.
    toggled = await recurring_invoices.toggle_recurring("recurring-a", technician)
    assert toggled == {"status": "paused"}
    assert database.recurring_invoices.rows[0]["status"] == "paused"
    assert database.recurring_invoices.rows[1]["status"] == "active"
    assert [row["id"] for row in database.recurring_invoices.rows] == [
        "recurring-a",
        "recurring-b",
    ]


def test_recurring_invoice_cannot_change_client_and_scheduler_requires_global_scope(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(
        _test_recurring_invoice_cannot_change_client_and_scheduler_requires_global_scope(
            monkeypatch
        )
    )


async def _test_recurring_invoice_cannot_change_client_and_scheduler_requires_global_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)
    technician = _client_a_technician()

    with pytest.raises(HTTPException) as move_exc:
        await recurring_invoices.update_recurring(
            "recurring-a", {"client_id": "client-b"}, technician
        )
    assert move_exc.value.status_code == 422
    assert database.recurring_invoices.rows[0]["client_id"] == "client-a"

    for protected_operation in (
        recurring_invoices.get_scheduler_status(current_user=technician),
        recurring_invoices.run_scheduler_now(current_user=technician),
    ):
        with pytest.raises(HTTPException) as exc:
            await protected_operation
        assert exc.value.status_code == 403

    captured: list[dict[str, Any]] = []

    async def _fake_scheduler(actor: dict[str, Any]) -> dict[str, Any]:
        captured.append(actor)
        return {"processed": 0, "generated": 0, "skipped_duplicates": 0, "results": []}

    monkeypatch.setattr(recurring_invoices, "_run_scheduler_now", _fake_scheduler)
    administrator = {"id": "admin", "name": "Billing Admin", "role": "admin"}
    result = await recurring_invoices.run_scheduler_now(current_user=administrator)

    assert result["processed"] == 0
    assert captured == [administrator]


def test_billing_anchor_preserves_month_end_without_permanent_drift():
    assert recurring_invoices._calc_next_date("2026-01-31", "monthly", 31) == "2026-02-28"
    assert recurring_invoices._calc_next_date("2026-02-28", "monthly", 31) == "2026-03-31"
    assert recurring_invoices._calc_next_date("2028-02-29", "annually", 29) == "2029-02-28"
    assert recurring_invoices._calc_next_date("2028-02-29", "quarterly", 29) == "2028-05-29"


def test_create_recurring_recomputes_server_pricing_and_uses_canonical_client(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_create_recurring_recomputes_server_pricing_and_uses_canonical_client(monkeypatch))


async def _test_create_recurring_recomputes_server_pricing_and_uses_canonical_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_database(monkeypatch)
    created = await recurring_invoices.create_recurring(
        {
            "client_id": "client-a",
            "client_name": "Forged Client Name",
            "description": "Managed services",
            "frequency": "monthly",
            "start_date": "2026-01-31",
            "tax_rate": 10,
            "line_items": [
                {"description": "Support", "quantity": 2, "rate": 100, "amount": 1}
            ],
        },
        _client_a_technician(),
    )

    assert created["client_name"] == "Client A"
    assert created["line_items"][0]["amount"] == 200.0
    assert created["subtotal"] == 200.0
    assert created["tax_amount"] == 20.0
    assert created["amount"] == 220.0
    assert created["billing_anchor_day"] == 31
    assert created["next_generation"] == "2026-02-28"


async def _test_update_recurring_recomputes_tax_and_rejects_server_owned_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)
    technician = _client_a_technician()
    record = database.recurring_invoices.rows[0]
    record.update({
        "version": 1,
        "start_date": "2026-01-31",
        "billing_anchor_day": 31,
        "next_generation": "2026-02-28",
        "line_items": [{"description": "Support", "quantity": 1, "rate": 100, "amount": 100}],
        "subtotal": 100.0,
        "tax_rate": 10.0,
        "tax_amount": 10.0,
        "amount": 110.0,
    })

    with pytest.raises(HTTPException) as protected:
        await recurring_invoices.update_recurring(
            "recurring-a", {"invoices_generated": 99}, technician
        )
    assert protected.value.status_code == 422
    assert record["invoices_generated"] == 0

    result = await recurring_invoices.update_recurring(
        "recurring-a", {"tax_rate": 20}, technician
    )
    assert result == {"message": "Updated"}
    assert record["tax_amount"] == 20.0
    assert record["amount"] == 120.0
    assert record["version"] == 2


def test_update_recurring_recomputes_tax_and_rejects_server_owned_fields(
    monkeypatch: pytest.MonkeyPatch,
):
    asyncio.run(_test_update_recurring_recomputes_tax_and_rejects_server_owned_fields(monkeypatch))


def test_generate_now_refuses_and_completes_an_ended_schedule(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_generate_now_refuses_and_completes_an_ended_schedule(monkeypatch))


async def _test_generate_now_refuses_and_completes_an_ended_schedule(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)
    record = database.recurring_invoices.rows[0]
    record.update({
        "version": 1,
        "start_date": "2025-01-01",
        "next_generation": "2025-02-01",
        "end_date": "2025-12-31",
    })

    with pytest.raises(HTTPException) as ended:
        await recurring_invoices.generate_invoice_now("recurring-a", _client_a_technician())
    assert ended.value.status_code == 409
    assert record["status"] == "completed"
    assert record["completion_reason"] == "end_date_reached"
    assert database.invoices.rows == []


def test_recurring_stats_include_weekly_and_fortnightly_mrr(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_recurring_stats_include_weekly_and_fortnightly_mrr(monkeypatch))


async def _test_recurring_stats_include_weekly_and_fortnightly_mrr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = _install_database(monkeypatch)
    database.recurring_invoices.rows.append({
        "id": "recurring-weekly",
        "client_id": "client-a",
        "client_name": "Client A",
        "description": "Weekly support",
        "status": "active",
        "frequency": "weekly",
        "amount": 120.0,
    })
    database.recurring_invoices.rows.append({
        "id": "recurring-fortnightly",
        "client_id": "client-a",
        "client_name": "Client A",
        "description": "Fortnightly support",
        "status": "active",
        "frequency": "fortnightly",
        "amount": 100.0,
    })

    stats = await recurring_invoices.get_recurring_stats(current_user=_client_a_technician())
    assert stats["by_frequency"]["weekly"] == 1
    assert stats["by_frequency"]["fortnightly"] == 1
    expected_mrr = 100 + 120 * 52 / 12 + 100 * 26 / 12
    assert stats["mrr"] == round(expected_mrr, 2)
    assert stats["arr"] == round(expected_mrr * 12, 2)
