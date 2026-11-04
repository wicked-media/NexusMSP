"""Focused regressions for the proposal-to-delivery commercial handoff."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.routers import crm
from app.services import scope_permissions


_MISSING = object()


def _value(row: dict[str, Any], key: str) -> Any:
    current: Any = row
    for part in key.split("."):
        if not isinstance(current, dict) or part not in current:
            return _MISSING
        current = current[part]
    return current


def _matches(row: dict[str, Any], query: dict[str, Any] | None) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, item) for item in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, item) for item in expected):
                return False
            continue
        actual = _value(row, key)
        if isinstance(expected, dict):
            if "$exists" in expected and ((actual is not _MISSING) != bool(expected["$exists"])):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual is not _MISSING and actual == expected["$ne"]:
                return False
            continue
        if actual is _MISSING or actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = rows

    def sort(self, _field: str, _direction: int):
        return self

    async def to_list(self, _limit: int):
        return deepcopy(self.rows)


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
            row = {}
            for key, value in query.items():
                if not key.startswith("$") and not isinstance(value, dict):
                    row[key] = deepcopy(value)
            row.update(deepcopy(update.get("$setOnInsert", {})))
            self.rows.append(row)
            inserted = True
        if row is None:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        row.update(deepcopy(update.get("$set", {})))
        return SimpleNamespace(matched_count=0 if inserted else 1, modified_count=1, upserted_id=row.get("id") if inserted else None)

    async def delete_one(self, query: dict[str, Any]):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database(SimpleNamespace):
    def __init__(self, *, proposals: list[dict[str, Any]] | None = None, recurring: list[dict[str, Any]] | None = None):
        super().__init__(
            proposals=_Collection(proposals),
            contracts=_Collection(),
            recurring_invoices=_Collection(recurring),
            projects=_Collection(),
            purchase_orders=_Collection(),
            users=_Collection([{"id": "tech-a", "name": "Avery Technician"}]),
            scope_denials=_Collection(),
        )


def _proposal(*, status: str = "accepted") -> dict[str, Any]:
    return {
        "id": "proposal-a",
        "proposal_number": "PROP-100",
        "title": "Managed service uplift",
        "status": status,
        "client_id": "client-a",
        "client_name": "Client A",
        "client_email": "billing@client-a.test",
        "contract_term": "12_months",
        "payment_terms": "net_14",
        "currency": "AUD",
        "scope_of_work": "Roll out managed endpoint protection.",
        "total": 550.0,
        "line_items": [
            {"description": "Managed endpoint", "quantity": 5, "rate": 100, "amount": 500, "billing_type": "recurring"},
        ],
        "tax_percent": 10,
    }


def _user() -> dict[str, Any]:
    return {"id": "tech-a", "name": "Avery Technician", "role": "admin"}


def _install(monkeypatch: pytest.MonkeyPatch, database: _Database) -> list[dict[str, Any]]:
    audits: list[dict[str, Any]] = []
    monkeypatch.setattr(crm, "db", database)

    async def _scoped(proposal_id: str, _current_user: dict, *, operation: str = "proposal.access") -> dict[str, Any]:
        proposal = await database.proposals.find_one({"id": proposal_id})
        if not proposal:
            raise HTTPException(status_code=404, detail="Resource not found")
        return proposal

    async def _audit(*_args: Any, **kwargs: Any):
        audits.append(kwargs)

    monkeypatch.setattr(crm, "_proposal_or_404", _scoped)
    monkeypatch.setattr(crm, "log_activity", _audit)
    return audits


def test_accepted_proposal_converts_then_creates_one_traceable_delivery_project(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_accepted_proposal_converts_then_creates_one_traceable_delivery_project(monkeypatch))


async def _test_accepted_proposal_converts_then_creates_one_traceable_delivery_project(monkeypatch: pytest.MonkeyPatch):
    database = _Database(proposals=[_proposal()])
    _install(monkeypatch, database)

    conversion = await crm.convert_proposal_to_contract("proposal-a", _user())
    assert conversion["contract_id"]
    assert conversion["recurring_invoice_id"]
    assert database.contracts.rows[0]["proposal_id"] == "proposal-a"
    assert database.recurring_invoices.rows[0]["proposal_id"] == "proposal-a"
    assert database.recurring_invoices.rows[0]["contract_id"] == conversion["contract_id"]

    handoff = await crm.get_proposal_handoff("proposal-a", _user())
    assert handoff["next_action"]["key"] == "launch_project"
    assert handoff["records"]["contract"]["id"] == conversion["contract_id"]
    assert handoff["records"]["recurring_invoices"][0]["id"] == conversion["recurring_invoice_id"]

    first = await crm.launch_proposal_project("proposal-a", {}, _user())
    second = await crm.launch_proposal_project("proposal-a", {}, _user())
    assert first["reused"] is False
    assert second["reused"] is True
    assert len(database.projects.rows) == 1
    project = database.projects.rows[0]
    assert project["proposal_id"] == "proposal-a"
    assert project["contract_id"] == conversion["contract_id"]
    assert project["recurring_invoice_id"] == conversion["recurring_invoice_id"]


def test_handoff_does_not_infer_unrelated_recurring_billing(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_handoff_does_not_infer_unrelated_recurring_billing(monkeypatch))


async def _test_handoff_does_not_infer_unrelated_recurring_billing(monkeypatch: pytest.MonkeyPatch):
    unrelated = {"id": "ri-unrelated", "client_id": "client-a", "status": "active", "description": "Existing service"}
    database = _Database(proposals=[_proposal(status="draft")], recurring=[unrelated])
    _install(monkeypatch, database)

    handoff = await crm.get_proposal_handoff("proposal-a", _user())
    assert handoff["records"]["recurring_invoices"] == []
    assert handoff["stages"][2]["status"] == "not_started"


def test_delivery_cannot_start_before_the_agreement_handoff(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_delivery_cannot_start_before_the_agreement_handoff(monkeypatch))


async def _test_delivery_cannot_start_before_the_agreement_handoff(monkeypatch: pytest.MonkeyPatch):
    database = _Database(proposals=[_proposal(status="accepted")])
    _install(monkeypatch, database)

    with pytest.raises(HTTPException) as blocked:
        await crm.launch_proposal_project("proposal-a", {}, _user())
    assert blocked.value.status_code == 409
    assert database.projects.rows == []


def test_converted_proposal_retries_return_existing_agreement(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_converted_proposal_retries_return_existing_agreement(monkeypatch))


async def _test_converted_proposal_retries_return_existing_agreement(monkeypatch: pytest.MonkeyPatch):
    database = _Database(proposals=[_proposal()])
    _install(monkeypatch, database)

    first = await crm.convert_proposal_to_contract("proposal-a", _user())
    second = await crm.convert_proposal_to_contract("proposal-a", _user())
    assert second["reused"] is True
    assert second["contract_id"] == first["contract_id"]
    assert len(database.contracts.rows) == 1


def test_proposal_reads_are_client_scoped_and_direct_ids_fail_closed(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_proposal_reads_are_client_scoped_and_direct_ids_fail_closed(monkeypatch))


async def _test_proposal_reads_are_client_scoped_and_direct_ids_fail_closed(monkeypatch: pytest.MonkeyPatch):
    own = _proposal(status="draft")
    foreign = {**_proposal(status="draft"), "id": "proposal-b", "client_id": "client-b", "client_name": "Client B"}
    database = _Database(proposals=[own, foreign])
    monkeypatch.setattr(crm, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    restricted_user = {
        "id": "tech-a",
        "name": "Avery Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    visible = await crm.get_proposals(current_user=restricted_user)
    assert [proposal["id"] for proposal in visible] == ["proposal-a"]
    with pytest.raises(HTTPException) as foreign_read:
        await crm.get_proposal("proposal-b", restricted_user)
    assert foreign_read.value.status_code == 404
    assert len(database.scope_denials.rows) == 1
