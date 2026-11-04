"""Regression coverage for the legacy bulk-ticket compatibility endpoint.

The old queue route lived in the Xero router and previously updated arbitrary
ticket IDs without an action permission, tenant/client checks, or audit trail.
These direct router tests keep it constrained while the newer ticket workspace
continues to use its own richer workflow.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routers import xero
from app.services import action_permissions, scope_permissions


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

        present = key in row
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$exists" in expected and present != bool(expected["$exists"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = deepcopy(rows)

    def sort(self, *_args: Any, **_kwargs: Any) -> "_Cursor":
        return self

    async def to_list(self, _limit: int) -> list[dict[str, Any]]:
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> _Cursor:
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
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=_Collection(
                [
                    {
                        "id": "ticket-a",
                        "tenant_id": "tenant-a",
                        "ticket_number": "INC-1001",
                        "title": "Client A issue",
                        "client_id": "client-a",
                        "site_id": "site-a",
                        "status": "open",
                        "priority": "low",
                        "tags": [],
                    },
                    {
                        "id": "ticket-a-site-b",
                        "tenant_id": "tenant-a",
                        "ticket_number": "INC-1002",
                        "title": "Client A second site issue",
                        "client_id": "client-a",
                        "site_id": "site-b",
                        "status": "open",
                        "priority": "low",
                    },
                    {
                        "id": "ticket-a-unassigned-site",
                        "tenant_id": "tenant-a",
                        "ticket_number": "INC-1004",
                        "title": "Legacy unassigned-site issue",
                        "client_id": "client-a",
                        "status": "open",
                        "priority": "low",
                    },
                    {
                        "id": "ticket-b",
                        "tenant_id": "tenant-a",
                        "ticket_number": "INC-2001",
                        "title": "Client B issue",
                        "client_id": "client-b",
                        "site_id": "site-b",
                        "status": "open",
                        "priority": "low",
                    },
                    {
                        "id": "ticket-blueprint",
                        "tenant_id": "tenant-a",
                        "ticket_number": "INC-1003",
                        "title": "Blueprint-gated issue",
                        "client_id": "client-a",
                        "site_id": "site-a",
                        "status": "open",
                        "priority": "medium",
                        "blueprint_require_completion": True,
                        "blueprint_id": "blueprint-a",
                        "blueprint_checklist": [{"label": "Verify backup", "required": True, "done": False}],
                        "blueprint_fields": {},
                    },
                ]
            ),
            users=_Collection([{"id": "tech-b", "tenant_id": "tenant-a", "name": "Technician B"}]),
            blueprints=_Collection([{"id": "blueprint-a", "fields": []}]),
            project_tasks=_Collection(),
            ticket_audit_log=_Collection(),
            activity_logs=_Collection(),
            scope_denials=_Collection(),
            permission_denials=_Collection(),
            settings=_Collection(),
        )


def _restricted_user(*, sites: list[str] | None = None, legacy_edit: bool = True) -> dict[str, Any]:
    return {
        "id": "tech-a",
        "tenant_id": "tenant-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": sites or [],
        "permissions": {"tickets": {"edit": legacy_edit}},
    }


def _install(monkeypatch: pytest.MonkeyPatch) -> _Database:
    database = _Database()
    monkeypatch.setattr(xero, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)
    monkeypatch.setattr(action_permissions, "db", database)

    async def _ticket_audit(ticket_id: str, user: dict, action: str, details: str = "") -> None:
        await database.ticket_audit_log.insert_one(
            {
                "ticket_id": ticket_id,
                "user_id": user.get("id"),
                "action": action,
                "details": details,
            }
        )

    async def _activity(
        user: dict,
        action: str,
        entity_type: str,
        entity_id: str,
        entity_name: str = "",
        details: str = "",
        changes: dict | None = None,
        metadata: dict | None = None,
    ) -> None:
        await database.activity_logs.insert_one(
            {
                "user_id": user.get("id"),
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "entity_name": entity_name,
                "details": details,
                "changes": changes or {},
                "metadata": metadata or {},
            }
        )

    monkeypatch.setattr(xero, "ticket_audit", _ticket_audit)
    monkeypatch.setattr(xero, "log_activity", _activity)
    return database


def test_bulk_ticket_action_checks_all_client_scope_before_any_write(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_action_checks_all_client_scope_before_any_write(monkeypatch))


async def _test_bulk_ticket_action_checks_all_client_scope_before_any_write(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)

    with pytest.raises(HTTPException) as foreign_selection:
        await xero.bulk_ticket_action(
            {"ticket_ids": ["ticket-a", "ticket-b"], "action": "priority", "value": "high"},
            request=None,
            current_user=_restricted_user(),
        )

    assert foreign_selection.value.status_code == 404
    assert [ticket["priority"] for ticket in database.tickets.rows[:3]] == ["low", "low", "low"]
    assert database.scope_denials.rows[-1]["operation"] == "ticket.bulk.priority"
    assert not database.activity_logs.rows


def test_bulk_ticket_action_masks_cross_tenant_selection_before_any_write(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_action_masks_cross_tenant_selection_before_any_write(monkeypatch))


async def _test_bulk_ticket_action_masks_cross_tenant_selection_before_any_write(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    database.tickets.rows.append({
        "id": "ticket-other-tenant",
        "tenant_id": "tenant-b",
        "ticket_number": "INC-9001",
        "title": "Same client in another tenant",
        "client_id": "client-a",
        "site_id": "site-a",
        "status": "open",
        "priority": "low",
    })

    with pytest.raises(HTTPException) as foreign_selection:
        await xero.bulk_ticket_action(
            {"ticket_ids": ["ticket-a", "ticket-other-tenant"], "action": "priority", "value": "high"},
            request=None,
            current_user=_restricted_user(),
        )

    assert foreign_selection.value.status_code == 404
    assert database.tickets.rows[0]["priority"] == "low"
    assert database.tickets.rows[-1]["priority"] == "low"
    assert not database.activity_logs.rows


def test_bulk_ticket_action_enforces_site_scope_for_every_selected_ticket(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_action_enforces_site_scope_for_every_selected_ticket(monkeypatch))


async def _test_bulk_ticket_action_enforces_site_scope_for_every_selected_ticket(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)

    with pytest.raises(HTTPException) as foreign_site:
        await xero.bulk_ticket_action(
            {"ticket_ids": ["ticket-a", "ticket-a-site-b"], "action": "status", "value": "in_progress"},
            request=None,
            current_user=_restricted_user(sites=["site-a"]),
        )

    assert foreign_site.value.status_code == 404
    assert database.tickets.rows[0]["status"] == "open"
    assert database.tickets.rows[1]["status"] == "open"
    assert database.scope_denials.rows[-1]["site_id"] == "site-b"


def test_bulk_ticket_action_fails_closed_for_an_unassigned_site_when_site_scope_is_explicit(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_action_fails_closed_for_an_unassigned_site_when_site_scope_is_explicit(monkeypatch))


async def _test_bulk_ticket_action_fails_closed_for_an_unassigned_site_when_site_scope_is_explicit(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)

    with pytest.raises(HTTPException) as unassigned_site:
        await xero.bulk_ticket_action(
            {"ticket_ids": ["ticket-a-unassigned-site"], "action": "priority", "value": "high"},
            request=None,
            current_user=_restricted_user(sites=["site-a"]),
        )

    assert unassigned_site.value.status_code == 404
    assert database.tickets.rows[2]["priority"] == "low"
    assert database.scope_denials.rows[-1]["site_id"] == "__unassigned_ticket_site__"


def test_bulk_ticket_action_is_audited_and_uses_the_declared_action_permission(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_action_is_audited_and_uses_the_declared_action_permission(monkeypatch))


async def _test_bulk_ticket_action_is_audited_and_uses_the_declared_action_permission(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    user = _restricted_user()

    permission = await action_permissions.evaluate_action_permission(user, "ticket.bulk.modify")
    assert permission["allowed"] is True

    route = next(route for route in xero.router.routes if route.path == "/tickets/bulk-action")
    dependency = route.dependant.dependencies[0].call
    assert dependency.__closure__[0].cell_contents == "ticket.bulk.modify"

    result = await xero.bulk_ticket_action(
        {"ticket_ids": ["ticket-a"], "action": "assign", "value": "tech-b"},
        request=None,
        current_user=user,
    )

    assert result["updated"] == 1
    assert result["action"] == "assign"
    ticket = database.tickets.rows[0]
    assert ticket["assigned_to"] == "tech-b"
    assert ticket["assigned_name"] == "Technician B"
    assert database.ticket_audit_log.rows[-1]["action"] == "bulk_updated"
    audit = database.activity_logs.rows[-1]
    assert audit["metadata"]["client_id"] == "client-a"
    assert audit["metadata"]["operation_id"] == result["operation_id"]


def test_bulk_ticket_action_dependency_rejects_a_user_without_bulk_permission(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_action_dependency_rejects_a_user_without_bulk_permission(monkeypatch))


async def _test_bulk_ticket_action_dependency_rejects_a_user_without_bulk_permission(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    route = next(route for route in xero.router.routes if route.path == "/tickets/bulk-action")
    dependency = route.dependant.dependencies[0].call
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "server": ("testserver", 80),
            "path": "/tickets/bulk-action",
            "query_string": b"",
            "headers": [],
        }
    )

    with pytest.raises(HTTPException) as denied:
        await dependency(request=request, current_user=_restricted_user(legacy_edit=False))

    assert denied.value.status_code == 403
    assert denied.value.headers["X-Required-Permission"] == "ticket.bulk.modify"
    assert database.permission_denials.rows[-1]["permission"] == "ticket.bulk.modify"


def test_bulk_ticket_close_preserves_blueprint_gate_and_validates_payload(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_close_preserves_blueprint_gate_and_validates_payload(monkeypatch))


async def _test_bulk_ticket_close_preserves_blueprint_gate_and_validates_payload(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    user = _restricted_user()

    with pytest.raises(HTTPException) as blocked_close:
        await xero.bulk_ticket_action(
            {"ticket_ids": ["ticket-blueprint"], "action": "close", "resolution_summary": "Required work reviewed", "closure_reason": "Resolved"},
            request=None,
            current_user=user,
        )
    assert blocked_close.value.status_code == 409
    assert database.tickets.rows[-1]["status"] == "open"

    with pytest.raises(HTTPException) as duplicate_ids:
        await xero.bulk_ticket_action(
            {"ticket_ids": ["ticket-a", "ticket-a"], "action": "priority", "value": "critical"},
            request=None,
            current_user=user,
        )
    assert duplicate_ids.value.status_code == 422
    assert database.tickets.rows[0]["priority"] == "low"


def test_bulk_ticket_status_resolved_remains_resolved_not_closed(monkeypatch: pytest.MonkeyPatch):
    asyncio.run(_test_bulk_ticket_status_resolved_remains_resolved_not_closed(monkeypatch))


async def _test_bulk_ticket_status_resolved_remains_resolved_not_closed(monkeypatch: pytest.MonkeyPatch):
    database = _install(monkeypatch)
    result = await xero.bulk_ticket_action(
        {"ticket_ids": ["ticket-a"], "action": "status", "value": "resolved"},
        request=None,
        current_user=_restricted_user(),
    )

    assert result["updated"] == 1
    ticket = database.tickets.rows[0]
    assert ticket["status"] == "resolved"
    assert ticket["resolution_status"] == "resolved"
    assert "closed_at" not in ticket
