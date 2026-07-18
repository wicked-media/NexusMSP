"""Focused regression tests for Nexus Agent command safety."""

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import nexus_agent  # noqa: E402
from app.models import UserCreate  # noqa: E402


class ListCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, length):
        return [dict(row) for row in self.rows[:length]]

    def __aiter__(self):
        self._iter = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return dict(next(self._iter))
        except StopIteration as exc:
            raise StopAsyncIteration from exc


def test_agent_command_permission_is_explicit():
    assert nexus_agent._can_execute_agent_commands({"role": "admin"})
    assert nexus_agent._can_execute_agent_commands({
        "role": "technician",
        "permissions": {"agent_commands": {"execute": True}},
    })
    assert not nexus_agent._can_execute_agent_commands({
        "role": "dispatcher",
        "permissions": {"devices": {"edit": True}},
    })

    with pytest.raises(HTTPException) as denied:
        asyncio.run(nexus_agent.require_agent_operator(user={"role": "dispatcher"}))
    assert denied.value.status_code == 403


def test_public_registration_cannot_request_an_elevated_role():
    registration = UserCreate(
        name="Untrusted User",
        email="untrusted@example.com",
        password="test-password",
        role="admin",
    )

    assert "role" not in registration.model_dump()


def test_fleet_request_enforces_shell_timeout_and_batch_limits():
    with pytest.raises(ValidationError):
        nexus_agent.FleetScriptRequest(device_ids=["a"], shell="zsh", script="date")
    with pytest.raises(ValidationError):
        nexus_agent.FleetScriptRequest(device_ids=["a"], script="date", timeout_sec=0)
    with pytest.raises(ValidationError):
        nexus_agent.FleetScriptRequest(
            device_ids=[str(i) for i in range(nexus_agent.MAX_FLEET_TARGETS + 1)],
            script="date",
        )
    with pytest.raises(ValidationError):
        nexus_agent.CommandResult(id="cmd-1", status="unexpected")


class StaleCommandCollection:
    """Always returns the same stale candidate to reproduce overlapping polls."""

    def __init__(self):
        self.command = {
            "_id": "mongo-1",
            "id": "cmd-1",
            "device_id": "agent-1",
            "kind": "ping",
            "payload": {},
            "status": "pending",
        }

    def find(self, _query):
        return ListCursor([self.command])

    async def update_one(self, query, update):
        if query.get("status") == "pending" and self.command["status"] == "pending":
            self.command.update(update["$set"])
            return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


class AgentTokenCollection:
    async def find_one(self, query):
        if query.get("agent_token") == "valid-token":
            return {"id": "agent-1", "is_active": True}
        return None


def test_command_poll_claims_each_command_only_once(monkeypatch):
    fake_db = SimpleNamespace(
        nexus_agents=AgentTokenCollection(),
        nexus_agent_commands=StaleCommandCollection(),
    )
    monkeypatch.setattr(nexus_agent, "db", fake_db)

    first = asyncio.run(nexus_agent.commands_poll(x_agent_token="valid-token"))
    second = asyncio.run(nexus_agent.commands_poll(x_agent_token="valid-token"))

    assert [command["id"] for command in first["commands"]] == ["cmd-1"]
    assert second["commands"] == []


class RecentAgentCollection:
    def find(self, *_args, **_kwargs):
        return ListCursor([{
            "id": "agent-1",
            "hostname": "WORKSTATION-1",
            "last_seen": datetime.now(timezone.utc).isoformat(),
            "enrolled_at": datetime.now(timezone.utc).isoformat(),
        }])


class RecentDeviceCollection:
    def find(self, *_args, **_kwargs):
        return ListCursor([{"id": "device-record-1", "nexus_agent_id": "agent-1"}])


def test_recent_enrollments_return_device_record_id_and_live_status(monkeypatch):
    monkeypatch.setattr(nexus_agent, "db", SimpleNamespace(
        nexus_agents=RecentAgentCollection(),
        devices=RecentDeviceCollection(),
    ))

    rows = asyncio.run(nexus_agent.fleet_recent_enrollments(limit=8, user={"id": "user-1"}))

    assert rows[0]["device_record_id"] == "device-record-1"
    assert rows[0]["online"] is True


class FleetAgentCollection:
    def __init__(self):
        self.last_query = None

    def find(self, query, _projection):
        self.last_query = query
        return ListCursor([{"id": "online-1", "hostname": "ONLINE-1"}])


class FleetCommandCollection:
    def __init__(self):
        self.docs = []

    async def insert_many(self, docs, ordered=True):
        self.docs.extend(docs)
        return SimpleNamespace(inserted_ids=[doc["id"] for doc in docs])

    async def delete_many(self, _query):
        return SimpleNamespace(deleted_count=0)


class AuditCollection:
    async def insert_one(self, _doc):
        return SimpleNamespace(inserted_id="audit-1")


def test_fleet_scripts_skip_offline_targets_by_default(monkeypatch):
    agents = FleetAgentCollection()
    commands = FleetCommandCollection()
    monkeypatch.setattr(nexus_agent, "db", SimpleNamespace(
        nexus_agents=agents,
        nexus_agent_commands=commands,
        nexus_agent_audit=AuditCollection(),
    ))

    request = nexus_agent.FleetScriptRequest(
        device_ids=["online-1", "offline-1"],
        shell="powershell",
        script="Get-Date",
    )
    result = asyncio.run(nexus_agent.fleet_run_script(
        request,
        user={"id": "user-1", "email": "operator@example.test"},
    ))

    assert "last_seen" in agents.last_query
    assert result["skipped_device_ids"] == ["offline-1"]
    assert len(commands.docs) == 1
