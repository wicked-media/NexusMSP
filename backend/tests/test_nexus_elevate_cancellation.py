"""Cancellation controls for Nexus Elevate's pre-dispatch boundary."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import permission_elevation


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    @staticmethod
    def _matches(row, query):
        return all(row.get(key) == value for key, value in query.items())

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if self._matches(row, query)), None)

    async def find_one_and_update(self, query, update):
        for row in self.rows:
            if self._matches(row, query):
                previous = dict(row)
                row.update(update.get("$set", {}))
                return previous
        return None

    async def update_one(self, query, update):
        for row in self.rows:
            if self._matches(row, query):
                row.update(update.get("$set", {}))
                for key in update.get("$unset", {}):
                    row.pop(key, None)
                return _Result(1)
        return _Result()


def _caller():
    return {
        "id": "tech-1",
        "name": "Alex Technician",
        "role": "technician",
        "permissions": {"agent_commands": {"execute": True}},
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-1"],
    }


def _install(monkeypatch, request, command=None):
    requests = _Rows([request])
    commands = _Rows([command] if command else [])
    monkeypatch.setattr(permission_elevation, "db", SimpleNamespace(
        users=_Rows([_caller()]),
        nexus_elevate_requests=requests,
        nexus_agent_commands=commands,
    ))

    async def in_scope(*_args, **_kwargs):
        return None

    audit = []

    async def write_audit(kind, _request, _actor, details):
        audit.append((kind, details))

    monkeypatch.setattr(permission_elevation, "assert_client_scope", in_scope)
    monkeypatch.setattr(permission_elevation, "_resolve_native_elevation_review_notification", in_scope)
    monkeypatch.setattr(permission_elevation, "_write_native_audit", write_audit)
    monkeypatch.setattr(permission_elevation, "_request_view", lambda value: _async_value(dict(value)))
    return requests, commands, audit


async def _async_value(value):
    return value


def test_pending_elevation_request_can_be_withdrawn_before_review(monkeypatch):
    requests, _commands, audit = _install(monkeypatch, {
        "id": "elev-1", "status": "pending", "client_id": "client-1",
    })

    result = asyncio.run(permission_elevation.cancel_nexus_elevate_request(
        "elev-1", {"reason": "The requester no longer needs this application."}, {"id": "tech-1"}
    ))

    assert result["request"]["status"] == "cancelled"
    assert requests.rows[0]["cancellation_reason"].startswith("The requester")
    assert audit == [("nexus_elevate_cancelled", {"reason": "The requester no longer needs this application.", "stage": "review"})]


def test_queued_elevation_launch_is_revoked_only_while_command_is_pending(monkeypatch):
    requests, commands, audit = _install(monkeypatch, {
        "id": "elev-2", "status": "approved", "client_id": "client-1", "agent_command_id": "cmd-1",
    }, {
        "id": "cmd-1", "status": "pending", "elevation_request_id": "elev-2",
    })

    result = asyncio.run(permission_elevation.cancel_nexus_elevate_request(
        "elev-2", {"reason": "The change window has been cancelled by the customer."}, {"id": "tech-1"}
    ))

    assert result["request"]["status"] == "revoked"
    assert commands.rows[0]["status"] == "cancelled"
    assert requests.rows[0]["revocation_reason"].startswith("The change window")
    assert audit[0][0] == "nexus_elevate_revoked"


def test_dispatched_elevation_launch_is_not_falsely_reported_as_revoked(monkeypatch):
    requests, commands, audit = _install(monkeypatch, {
        "id": "elev-3", "status": "approved", "client_id": "client-1", "agent_command_id": "cmd-2",
    }, {
        "id": "cmd-2", "status": "dispatched", "elevation_request_id": "elev-3",
    })

    with pytest.raises(HTTPException) as error:
        asyncio.run(permission_elevation.cancel_nexus_elevate_request(
            "elev-3", {"reason": "The change window has been cancelled by the customer."}, {"id": "tech-1"}
        ))

    assert error.value.status_code == 409
    assert requests.rows[0]["status"] == "approved"
    assert commands.rows[0]["status"] == "dispatched"
    assert audit == []


class _TicketRows:
    def __init__(self):
        self.query = None

    async def find_one(self, _query, _projection=None):
        self.query = _query
        return {"id": "ticket-1"}


class _TicketAuditRows:
    def __init__(self):
        self.calls = []

    async def update_one(self, query, update, upsert=False):
        self.calls.append((query, update, upsert))


def test_elevation_lifecycle_is_projected_to_its_validated_ticket(monkeypatch):
    ticket_audit = _TicketAuditRows()
    monkeypatch.setattr(permission_elevation, "db", SimpleNamespace(
        tickets=_TicketRows(), ticket_audit_log=ticket_audit,
    ))
    request = {
        "id": "elev-4", "ticket_id": "ticket-1", "tenant_id": "nexus-local",
        "client_id": "client-1", "device_id": "agent-1", "program_name": "Tool.exe",
        "hostname": "PC-01", "status": "approved", "agent_command_id": "cmd-4",
    }

    asyncio.run(permission_elevation._write_ticket_elevation_evidence(
        "nexus_elevate_approved", request, {"id": "tech-1", "name": "Alex Technician"}, {}
    ))

    assert len(ticket_audit.calls) == 1
    query, update, upsert = ticket_audit.calls[0]
    assert query == {
        "ticket_id": "ticket-1", "elevation_request_id": "elev-4", "action": "nexus_elevate_approved",
    }
    assert upsert is True
    entry = update["$setOnInsert"]
    assert entry["details"] == "Elevation approved: Tool.exe on PC-01."
    assert entry["metadata"]["agent_command_id"] == "cmd-4"


def test_agent_ticket_reference_is_resolved_to_a_stable_same_scope_id(monkeypatch):
    tickets = _TicketRows()
    monkeypatch.setattr(permission_elevation, "db", SimpleNamespace(tickets=tickets))

    ticket_id = asyncio.run(permission_elevation._resolve_agent_ticket_id(
        {"client_id": "client-1", "tenant_id": "tenant-1"}, "TKT-1042"
    ))

    assert ticket_id == "ticket-1"
    assert tickets.query == {
        "client_id": "client-1", "tenant_id": "tenant-1",
        "$or": [{"id": "TKT-1042"}, {"ticket_number": "TKT-1042"}],
    }
