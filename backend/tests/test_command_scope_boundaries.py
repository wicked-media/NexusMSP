"""Regression tests for user-controlled endpoint command target boundaries."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import maintenance_windows, scripting, ticket_workflow
from app.services import scope_permissions


def _matches(row: dict, query: dict) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit: int):
        return deepcopy(self.rows)


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])
        self.inserted: list[dict] = []
        self.inserted_many: list[list[dict]] = []
        self.update_calls: list[tuple[dict, dict]] = []
        self.deleted: list[dict] = []

    async def find_one(self, query: dict, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict):
        copy = deepcopy(document)
        self.rows.append(copy)
        self.inserted.append(copy)
        return SimpleNamespace(inserted_id=copy.get("id"))

    async def insert_many(self, documents: list[dict]):
        copies = deepcopy(documents)
        self.rows.extend(copies)
        self.inserted_many.append(copies)
        return SimpleNamespace(inserted_ids=[row.get("id") for row in copies])

    async def update_one(self, query: dict, update: dict):
        self.update_calls.append((deepcopy(query), deepcopy(update)))
        for row in self.rows:
            if _matches(row, query):
                for key, value in update.get("$set", {}).items():
                    row[key] = deepcopy(value)
                for key, value in update.get("$inc", {}).items():
                    row[key] = row.get(key, 0) + value
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query: dict):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.deleted.append(deepcopy(row))
                del self.rows[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            devices=_Collection([
                {
                    "id": "device-a",
                    "client_id": "client-a",
                    "site_id": "site-a",
                    "name": "CLIENT-A-SERVER",
                    "nexus_agent_id": "agent-a",
                    "status": "online",
                },
                {
                    "id": "device-b",
                    "client_id": "client-b",
                    "site_id": "site-b",
                    "name": "CLIENT-B-SERVER",
                    "nexus_agent_id": "agent-b",
                    "status": "online",
                },
            ]),
            tickets=_Collection([
                {"id": "ticket-a", "client_id": "client-a", "site_id": "site-a", "device_id": "device-a", "title": "Client A work"},
                {"id": "ticket-b", "client_id": "client-b", "site_id": "site-b", "device_id": "device-b", "title": "Client B work"},
            ]),
            maintenance_windows=_Collection(),
            maintenance_window_runs=_Collection(),
            scripts=_Collection([{"id": "script-1", "name": "Health check", "content": "Write-Output ok", "script_type": "powershell"}]),
            script_executions=_Collection(),
            scheduled_tasks=_Collection(),
            scheduled_task_runs=_Collection(),
            nexus_agent_commands=_Collection(),
            scope_denials=_Collection(),
            ticket_audit_log=_Collection(),
        )


def _restricted_operator() -> dict:
    return {
        "id": "tech-a",
        "name": "Technician A",
        "email": "tech-a@example.test",
        "role": "technician",
        "permissions": {"agent_commands": {"execute": True}},
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-a"],
    }


def _global_operator() -> dict:
    return {"id": "admin-1", "name": "Administrator", "role": "admin", "is_admin": True}


def _install_database(monkeypatch, database: _Database):
    for module in (maintenance_windows, scripting, ticket_workflow):
        monkeypatch.setattr(module, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)

    async def no_activity(*_args, **_kwargs):
        return None

    monkeypatch.setattr(maintenance_windows, "log_activity", no_activity)
    monkeypatch.setattr(ticket_workflow, "log_activity", no_activity)


def _window_request(device_ids: list[str]) -> dict:
    return {
        "device_ids": device_ids,
        "actions": ["run-checks"],
        "scheduled_at": datetime.now(timezone.utc).isoformat(),
    }


def test_maintenance_window_foreign_target_is_masked_and_never_persisted(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(maintenance_windows.create_window(
            _window_request(["device-a", "device-b"]), current_user=_restricted_operator()
        ))

    assert denied.value.status_code == 404
    assert database.maintenance_windows.inserted == []
    assert database.scope_denials.rows[-1]["client_id"] == "client-b"


def test_global_operator_can_create_multi_client_window_with_provenance(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    result = asyncio.run(maintenance_windows.create_window(
        _window_request(["device-a", "device-b"]), current_user=_global_operator()
    ))

    assert result["client_ids"] == ["client-a", "client-b"]
    assert result["site_ids"] == ["site-a", "site-b"]
    assert database.maintenance_windows.inserted[0]["client_ids"] == ["client-a", "client-b"]


def test_foreign_window_run_now_is_masked_before_status_change(monkeypatch):
    database = _Database()
    database.maintenance_windows.rows.append({
        "id": "window-b",
        "name": "Client B maintenance",
        "status": "scheduled",
        "device_ids": ["device-b"],
        "devices_meta": [{"id": "device-b", "client_id": "client-b", "name": "CLIENT-B-SERVER"}],
        "client_ids": ["client-b"],
        "site_ids": ["site-b"],
    })
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(maintenance_windows.run_now("window-b", current_user=_restricted_operator()))

    assert denied.value.status_code == 404
    assert database.maintenance_windows.update_calls == []


def test_scheduler_skips_maintenance_target_when_current_client_binding_changes(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    window = {"id": "window-a", "client_ids": ["client-a"]}
    stored_device = {"id": "device-a", "client_id": "client-a", "name": "CLIENT-A-SERVER"}
    database.devices.rows[0]["client_id"] = "client-b"

    device, reason = asyncio.run(maintenance_windows._current_window_device(window, stored_device))

    assert device is None
    assert "ownership changed" in reason


def test_foreign_ticket_cannot_be_linked_to_same_client_maintenance(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    request = _window_request(["device-a"])
    request["parent_ticket_id"] = "ticket-b"

    with pytest.raises(HTTPException) as denied:
        asyncio.run(maintenance_windows.create_window(request, current_user=_restricted_operator()))

    assert denied.value.status_code == 404
    assert database.maintenance_windows.inserted == []


def test_script_execution_mixed_targets_is_atomic_and_scope_checked(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(scripting.execute_script(
            "script-1", ["device-a", "device-b"], current_user=_restricted_operator()
        ))

    assert denied.value.status_code == 404
    assert database.script_executions.inserted == []
    assert database.nexus_agent_commands.inserted == []


def test_script_execution_keeps_same_client_operator_flow(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    dispatched: list[dict] = []

    async def dispatch(execution, script, device, queued_by):
        dispatched.append({"execution": execution, "script": script, "device": device, "queued_by": queued_by})
        return True

    monkeypatch.setattr(scripting, "_dispatch_execution_to_agent", dispatch)

    result = asyncio.run(scripting.execute_script(
        "script-1", ["device-a"], current_user=_restricted_operator()
    ))

    assert result["message"] == "Script queued for 1 devices"
    assert result["executions"][0]["client_id"] == "client-a"
    assert dispatched[0]["device"]["id"] == "device-a"


def test_scheduled_task_foreign_target_is_rejected_before_persist(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(scripting.create_scheduled_task({
            "name": "Foreign reboot", "script_id": "script-1", "target_ids": ["device-b"],
        }, current_user=_restricted_operator()))

    assert denied.value.status_code == 404
    assert database.scheduled_tasks.inserted == []


def test_manual_scheduled_run_is_masked_before_execution_or_queue(monkeypatch):
    database = _Database()
    database.scheduled_tasks.rows.append({
        "id": "task-b", "name": "Client B task", "script_id": "script-1",
        "target_ids": ["device-b"], "client_ids": ["client-b"],
    })
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(scripting.run_scheduled_task_now("task-b", current_user=_restricted_operator()))

    assert denied.value.status_code == 404
    assert database.script_executions.inserted_many == []
    assert database.nexus_agent_commands.inserted == []


def test_scheduler_disables_legacy_task_without_client_provenance(monkeypatch):
    database = _Database()
    database.scheduled_tasks.rows.append({
        "id": "legacy-task", "name": "Legacy task", "script_id": "script-1",
        "target_ids": ["device-b"], "enabled": True, "next_run": "2000-01-01T00:00:00+00:00",
    })
    _install_database(monkeypatch, database)

    result = asyncio.run(scripting.process_due_scheduled_tasks(datetime.now(timezone.utc)))

    assert result == {"processed": 0, "queued": 0}
    assert database.scheduled_tasks.rows[0]["enabled"] is False
    assert "scope revalidation" in database.scheduled_tasks.rows[0]["last_error"]
    assert database.script_executions.inserted_many == []


def test_scheduler_rejects_reassigned_target_even_when_both_clients_are_authorised(monkeypatch):
    database = _Database()
    database.scheduled_tasks.rows.append({
        "id": "multi-client-task", "name": "Multi-client task", "script_id": "script-1",
        "target_ids": ["device-a", "device-b"], "client_ids": ["client-a", "client-b"],
        "target_scopes": [
            {"device_id": "device-a", "client_id": "client-a", "site_id": "site-a"},
            {"device_id": "device-b", "client_id": "client-b", "site_id": "site-b"},
        ],
        "enabled": True, "next_run": "2000-01-01T00:00:00+00:00",
    })
    database.devices.rows[0]["client_id"] = "client-b"
    _install_database(monkeypatch, database)

    result = asyncio.run(scripting.process_due_scheduled_tasks(datetime.now(timezone.utc)))

    assert result == {"processed": 0, "queued": 0}
    assert database.scheduled_tasks.rows[0]["enabled"] is False
    assert "binding changed" in database.scheduled_tasks.rows[0]["last_error"]
    assert database.script_executions.inserted_many == []


def test_live_run_preserves_scoped_client_history(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    execution = asyncio.run(scripting.live_run_script(
        "script-1", {"device_id": "device-a"}, current_user=_restricted_operator()
    ))

    assert execution["client_id"] == "client-a"
    assert database.script_executions.inserted[0]["client_id"] == "client-a"


def test_ticket_maintenance_cannot_target_device_from_another_client(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(ticket_workflow.schedule_maintenance("ticket-a", {
            "start": datetime.now(timezone.utc).isoformat(),
            "duration_min": 30,
            "device_id": "device-b",
        }, current_user=_restricted_operator()))

    assert denied.value.status_code == 404
    assert database.maintenance_windows.inserted == []


def test_ticket_blocker_must_be_visible_and_in_the_same_client(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(ticket_workflow.block_ticket_on(
            "ticket-a", {"blocking_ticket_id": "ticket-b"}, current_user=_restricted_operator()
        ))

    assert denied.value.status_code == 404
    assert database.tickets.update_calls == []
