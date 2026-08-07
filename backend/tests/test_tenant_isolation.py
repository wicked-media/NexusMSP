"""Fail-closed client and object ownership contract tests."""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import mission_control, workflow_automation
from app.services import scope_permissions


class _InsertCollection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))


class _RecordCollection:
    def __init__(self, record):
        self.record = record

    async def find_one(self, query, projection):
        if self.record and self.record.get("id") == query.get("id"):
            return dict(self.record)
        return None


def test_missing_scope_configuration_fails_closed():
    scope = scope_permissions.effective_scope({"id": "tech-1", "role": "technician"})

    assert scope["mode"] == "restricted"
    assert scope["client_ids"] == []
    assert scope["source"] == "fail-closed-unassigned"


def test_administrator_and_explicit_all_scope_remain_supported():
    admin = scope_permissions.effective_scope({"id": "admin-1", "role": "admin"})
    service_manager = scope_permissions.effective_scope({
        "id": "manager-1",
        "role": "service_desk_manager",
        "client_scope_mode": "all",
    })

    assert admin["mode"] == "all"
    assert service_manager["mode"] == "all"


def test_scoped_query_intersects_filters_instead_of_overwriting_them():
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    query = scope_permissions.scoped_query(user, {"status": "open"})

    assert query == {
        "$and": [
            {"status": "open"},
            {"client_id": {"$in": ["client-a"]}},
        ]
    }


def test_scoped_query_enforces_selected_sites_when_present():
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-1"],
    }

    query = scope_permissions.scoped_query(user, {"status": "online"})

    assert query == {
        "$and": [
            {"status": "online"},
            {"client_id": {"$in": ["client-a"]}},
            {"site_id": {"$in": ["site-1"]}},
        ]
    }


def test_mission_control_queries_are_client_and_site_scoped():
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-1"],
    }

    operational = mission_control._query(user, {"status": "offline"})
    clients = mission_control._query(
        user,
        {"status": {"$ne": "archived"}},
        field="id",
        site_field=None,
    )

    assert operational == {
        "$and": [
            {"status": "offline"},
            {"client_id": {"$in": ["client-a"]}},
            {"site_id": {"$in": ["site-1"]}},
        ]
    }
    assert clients == {
        "$and": [
            {"status": {"$ne": "archived"}},
            {"id": {"$in": ["client-a"]}},
        ]
    }


def test_foreign_record_is_masked_and_denial_is_audited(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    user = {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }
    records = _RecordCollection({"id": "ticket-b", "client_id": "client-b"})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(scope_permissions.assert_record_scope(
            user,
            records,
            "ticket-b",
            operation="ticket.read",
            resource_name="Ticket",
        ))

    assert exc.value.status_code == 404
    assert exc.value.detail == "Resource not found"
    assert denials.rows[0]["client_id"] == "client-b"
    assert denials.rows[0]["operation"] == "ticket.read"


def test_allowed_record_returns_owned_document(monkeypatch):
    monkeypatch.setattr(scope_permissions.db, "scope_denials", _InsertCollection())
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }
    records = _RecordCollection({"id": "device-a", "client_id": "client-a", "name": "Reception"})

    record = asyncio.run(scope_permissions.assert_record_scope(
        user,
        records,
        "device-a",
        operation="device.read",
        resource_name="Device",
    ))

    assert record["name"] == "Reception"


def test_foreign_automation_run_is_masked_before_approval_or_compensation(monkeypatch):
    denials = _InsertCollection()
    monkeypatch.setattr(scope_permissions.db, "scope_denials", denials)
    monkeypatch.setattr(
        workflow_automation,
        "db",
        type("AutomationDB", (), {
            "workflow_runs": _RecordCollection({
                "id": "RUN-FOREIGN",
                "client_id": "client-b",
                "status": "awaiting_approval",
            })
        })(),
    )
    user = {
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }

    with pytest.raises(HTTPException) as exc:
        asyncio.run(workflow_automation._run_in_scope(
            "RUN-FOREIGN",
            user,
            "automation.run.approve",
        ))

    assert exc.value.status_code == 404
    assert denials.rows[0]["operation"] == "automation.run.approve"
