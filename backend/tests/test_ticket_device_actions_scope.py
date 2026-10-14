"""Regression tests for ticket-linked Nexus Agent command scope enforcement."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import ticket_device_actions
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
        if isinstance(expected, dict):
            if "$in" in expected and row.get(key) not in expected["$in"]:
                return False
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
        elif row.get(key) != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit: int):
        return deepcopy(self.rows)

    def __aiter__(self):
        self._iterator = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return next(self._iterator)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class _Collection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])
        self.inserted: list[dict] = []

    async def find_one(self, query: dict, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict):
        self.inserted.append(deepcopy(document))
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class _Database(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=_Collection([
                {
                    "id": "ticket-a",
                    "tenant_id": "tenant-a",
                    "client_id": "client-a",
                    "title": "Client A server maintenance",
                    "device_id": "device-a",
                    "device_ids": ["device-a"],
                },
                {
                    "id": "ticket-b",
                    "tenant_id": "tenant-a",
                    "client_id": "client-b",
                    "title": "Client B confidential incident",
                    "device_id": "device-b",
                    "device_ids": ["device-b"],
                },
            ]),
            devices=_Collection([
                {
                    "id": "device-a",
                    "tenant_id": "tenant-a",
                    "client_id": "client-a",
                    "name": "CLIENT-A-SERVER",
                    "nexus_agent_id": "agent-a",
                    "status": "online",
                },
                {
                    "id": "device-b",
                    "tenant_id": "tenant-a",
                    "client_id": "client-b",
                    "name": "CLIENT-B-SERVER",
                    "nexus_agent_id": "agent-b",
                    "status": "online",
                },
            ]),
            scope_denials=_Collection(),
        )


def _restricted_client_a_operator() -> dict:
    return {
        "id": "tech-a",
        "tenant_id": "tenant-a",
        "name": "Technician A",
        "email": "tech-a@example.test",
        "role": "technician",
        "permissions": {"agent_commands": {"execute": True}},
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _global_operator() -> dict:
    return {
        "id": "admin-1",
        "tenant_id": "tenant-a",
        "name": "Administrator",
        "email": "admin@example.test",
        "role": "admin",
        "is_admin": True,
    }


def _install_database(monkeypatch, database: _Database):
    monkeypatch.setattr(ticket_device_actions, "db", database)
    monkeypatch.setattr(scope_permissions, "db", database)


def test_ticket_linked_commands_mask_foreign_ticket_and_never_queue(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    queued: list[dict] = []

    async def queue(device, kind, payload, queued_by):
        queued.append({"device": device, "kind": kind, "payload": payload, "queued_by": queued_by})
        return "command-foreign"

    async def post_note(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ticket_device_actions, "queue_command_for_device", queue)
    monkeypatch.setattr(ticket_device_actions, "_post_action_note", post_note)

    async def scenario():
        with pytest.raises(HTTPException) as denied:
            await ticket_device_actions.device_reboot(
                "ticket-b",
                device_id=None,
                current_user=_restricted_client_a_operator(),
            )
        assert denied.value.status_code == 404
        assert denied.value.detail == "Resource not found"

    asyncio.run(scenario())
    assert queued == []
    assert database.scope_denials.rows[-1]["client_id"] == "client-b"


def test_legacy_ticket_remote_launch_is_retired_without_touching_data():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(ticket_device_actions.ticket_device_remote_connect(
            "ticket-a",
            "device-a",
            current_user=_global_operator(),
        ))

    assert retired.value.status_code == 410
    assert retired.value.detail == "Legacy remote launch is retired; use the governed Remote action"


def test_governed_ticket_remote_masks_foreign_ticket_before_start(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    started: list[dict] = []

    async def start_remote_session(**kwargs):
        started.append(kwargs)
        return {"session": {"id": "should-not-start"}}

    monkeypatch.setattr(ticket_device_actions, "start_remote_session", start_remote_session)

    async def scenario():
        with pytest.raises(HTTPException) as denied:
            await ticket_device_actions.governed_ticket_device_remote_connect(
                "ticket-b",
                "device-b",
                request=None,
                payload={},
                current_user=_restricted_client_a_operator(),
            )
        assert denied.value.status_code == 404
        assert denied.value.detail == "Resource not found"

    asyncio.run(scenario())
    assert started == []


def test_ticket_linked_commands_keep_same_client_operator_flow(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    queued: list[dict] = []

    async def queue(device, kind, payload, queued_by):
        queued.append({"device": device, "kind": kind, "payload": payload, "queued_by": queued_by})
        return "command-client-a"

    async def post_note(*_args, **_kwargs):
        return None

    monkeypatch.setattr(ticket_device_actions, "queue_command_for_device", queue)
    monkeypatch.setattr(ticket_device_actions, "_post_action_note", post_note)

    result = asyncio.run(ticket_device_actions.device_reboot(
        "ticket-a",
        device_id=None,
        current_user=_restricted_client_a_operator(),
    ))

    assert result == {"success": True, "command_id": "command-client-a"}
    assert queued[0]["device"]["id"] == "device-a"
    assert queued[0]["kind"] == "reboot"


def test_ticket_device_helpers_reject_foreign_linkage_and_foreign_fanout(monkeypatch):
    database = _Database()
    _install_database(monkeypatch, database)
    queued: list[dict] = []

    async def queue(device, kind, payload, queued_by):
        queued.append({"device": device, "kind": kind, "payload": payload, "queued_by": queued_by})
        return "command-foreign"

    monkeypatch.setattr(ticket_device_actions, "queue_command_for_device", queue)

    async def scenario():
        # A stale or corrupted device reference must not let a Client A ticket
        # become a command path to Client B's endpoint.
        ticket_a = database.tickets.rows[0]
        ticket_a["device_id"] = "device-b"
        ticket_a["device_ids"] = ["device-b"]
        with pytest.raises(HTTPException) as mismatched_link:
            await ticket_device_actions.device_reboot(
                "ticket-a",
                device_id=None,
                current_user=_restricted_client_a_operator(),
            )
        assert mismatched_link.value.status_code == 404

        # A global operator can see both clients, but cannot use malformed
        # linkage to send a Client B command from a Client A ticket either.
        with pytest.raises(HTTPException) as global_mismatched_link:
            await ticket_device_actions.device_reboot(
                "ticket-a",
                device_id=None,
                current_user=_global_operator(),
            )
        assert global_mismatched_link.value.status_code == 409

        # The fan-out and cockpit endpoints use the same ticket boundary rather
        # than becoming a second way to enumerate or command Client B devices.
        with pytest.raises(HTTPException) as foreign_list:
            await ticket_device_actions.list_ticket_devices(
                "ticket-b",
                current_user=_restricted_client_a_operator(),
            )
        assert foreign_list.value.status_code == 404

        with pytest.raises(HTTPException) as foreign_fanout:
            await ticket_device_actions.device_fanout(
                "ticket-b",
                "reboot",
                payload={},
                current_user=_restricted_client_a_operator(),
            )
        assert foreign_fanout.value.status_code == 404

    asyncio.run(scenario())
    assert queued == []
