"""Agent application-update policy, evidence, endpoint and command tests.

The endpoint agent now reports which applications its own winget scan can
upgrade, so an operator can see pending application updates on a device and apply
them from the device menu. These tests pin the server half of that contract:

- the signed policy that gates automatic installation, and its fail-closed
  default when no operator has opted in;
- the bounded evidence a device record accepts, including that a hostile heartbeat
  cannot inflate a count, smuggle an unbounded list or store raw winget output;
- the authenticated per-device endpoint, which distinguishes "nothing to update"
  from "this endpoint has never scanned";
- the command kind the device menu queues.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers import nexus_agent
from app.services.agent_trust import build_agent_policy

DNS_PROFILE = {"enabled": True, "mode": "visibility", "deployment_id": "dns-1"}

# The whole winget policy block. Reporting is enabled; installing anything
# automatically is off until an operator opts in, and an empty allow-list means
# "none", never "all".
EXPECTED_WINGET_POLICY = {
    "enabled": False,
    "auto_update_enabled": False,
    "allowed_ids": [],
}


class _Collection:
    def __init__(self):
        self.find_one_result = None
        self.updates = []
        self.inserts = []

    async def find_one(self, *args, **kwargs):
        return self.find_one_result

    async def update_one(self, *args, **kwargs):
        self.updates.append((args, kwargs))
        return None

    async def insert_one(self, *args, **kwargs):
        self.inserts.append((args, kwargs))
        return None


class _Db:
    """Attribute-style stand-in for the Motor database handle."""

    def __init__(self):
        self._collections = {}

    def __getattr__(self, name):
        return self._collections.setdefault(name, _Collection())


def _scope(monkeypatch, agent_id="agent-1"):
    async def _in_scope(device_id, user, action):
        assert device_id == agent_id
        return {"id": agent_id, "client_id": "cli-1"}

    monkeypatch.setattr(nexus_agent, "_agent_in_scope", _in_scope)


def test_the_winget_policy_is_fail_closed_and_cacheable():
    closed = build_agent_policy({}, DNS_PROFILE)
    assert closed["winget"] == EXPECTED_WINGET_POLICY
    # Reporting is never gated by the install policy, and the existing blocks are
    # untouched by this decision.
    assert closed["self_heal"]["enabled"] is True
    assert closed["self_repair"]["enabled"] is True

    opened = build_agent_policy(
        {
            "winget_enabled": True,
            "winget_auto_update_enabled": True,
            "winget_allowed_ids": ["Microsoft.Edge", " 7zip.7zip ", "", "   "],
        },
        DNS_PROFILE,
    )
    assert opened["winget"]["enabled"] is True
    assert opened["winget"]["auto_update_enabled"] is True
    # The allow-list is trimmed, keeps its order, and drops empty entries rather
    # than letting an operator approve nothing by accident.
    assert opened["winget"]["allowed_ids"] == ["Microsoft.Edge", "7zip.7zip"]

    # Automatic installation cannot outlive the switch that enabled winget at all.
    orphaned = build_agent_policy({"winget_auto_update_enabled": True}, DNS_PROFILE)
    assert orphaned["winget"]["auto_update_enabled"] is True
    assert orphaned["winget"]["enabled"] is False

    # The document is cacheable: identical settings hash identically, and the gate
    # is part of that hash.
    assert build_agent_policy(
        {
            "winget_enabled": True,
            "winget_auto_update_enabled": True,
            "winget_allowed_ids": ["Microsoft.Edge", "7zip.7zip"],
        },
        DNS_PROFILE,
    )["checksum_sha256"] == opened["checksum_sha256"]
    assert closed["checksum_sha256"] != opened["checksum_sha256"]


def test_the_heartbeat_payload_accepts_app_update_evidence_and_defaults_empty():
    assert nexus_agent.HeartbeatPayload().app_updates == {}
    payload = nexus_agent.HeartbeatPayload(app_updates={"status": "ok", "package_count": 2})
    assert payload.app_updates["status"] == "ok"


def test_app_update_evidence_is_bounded_and_raw_output_is_dropped():
    noise = "x" * 5_000
    evidence = nexus_agent._app_updates_evidence_update(
        {
            "status": noise,
            "observed_at": noise,
            "package_count": 10**9,
            "error": noise,
            "packages": [
                {"id": "Microsoft.Edge", "name": noise, "current": noise, "available": noise},
                # A duplicate identifier must not be stored twice.
                {"id": "microsoft.edge", "name": "Edge again", "current": "1", "available": "2"},
                # Anything that is not an identifier is refused.
                {"id": "", "name": "empty", "current": "1", "available": "2"},
                {"id": "   ", "name": "blank", "current": "1", "available": "2"},
                {
                    "id": "Microsoft.Edge --force; shutdown",
                    "name": "hostile",
                    "current": "1",
                    "available": "2",
                },
                {"id": "7zip.7zip", "name": "7-Zip", "current": "23.01", "available": "24.09"},
                "not-a-mapping",
                None,
            ],
            "raw_winget_output": noise,
        },
        "2026-10-09T00:00:00+00:00",
    )

    assert evidence["status"] == "x" * 40
    assert evidence["observed_at"] == "x" * 64
    assert evidence["error"] == "x" * 200
    assert evidence["reported_at"] == "2026-10-09T00:00:00+00:00"
    # The stored count is derived from what was actually stored, so it can never
    # disagree with the list an operator reads on the device.
    assert evidence["package_count"] == 2
    assert evidence["truncated"] is True
    assert [package["id"] for package in evidence["packages"]] == ["Microsoft.Edge", "7zip.7zip"]
    assert evidence["packages"][0]["name"] == "x" * 200
    assert evidence["packages"][0]["current"] == "x" * 60
    assert set(evidence["packages"][0]) == {"id", "name", "current", "available"}
    assert set(evidence) == {
        "status",
        "observed_at",
        "package_count",
        "truncated",
        "error",
        "packages",
        "reported_at",
    }


def test_absent_app_update_evidence_still_produces_a_renderable_block():
    evidence = nexus_agent._app_updates_evidence_update({}, "2026-10-09T00:00:00+00:00")
    assert evidence["status"] == "unknown"
    assert evidence["packages"] == []
    assert evidence["package_count"] == 0
    assert evidence["truncated"] is False


def test_the_endpoint_reports_never_scanned_rather_than_nothing_to_update(monkeypatch):
    fake_db = _Db()
    _scope(monkeypatch)
    monkeypatch.setattr(nexus_agent, "db", fake_db)

    with pytest.raises(HTTPException) as failure:
        asyncio.run(nexus_agent.agent_app_updates(device_id="agent-1", user={"id": "tech-1"}))
    assert failure.value.status_code == 404

    # The endpoint is a read: a device record is never rewritten by looking at it.
    for collection in fake_db._collections.values():
        assert collection.updates == []
        assert collection.inserts == []


def test_the_endpoint_returns_the_stored_scan_and_marks_stale_evidence(monkeypatch):
    fake_db = _Db()
    _scope(monkeypatch)
    monkeypatch.setattr(nexus_agent, "db", fake_db)

    fresh = datetime.now(timezone.utc).isoformat()
    fake_db.nexus_agents.find_one_result = {
        "app_updates": {
            "status": "ok",
            "observed_at": fresh,
            "package_count": 1,
            "packages": [
                {
                    "id": "Microsoft.Edge",
                    "name": "Microsoft Edge",
                    "current": "120",
                    "available": "121",
                }
            ],
        }
    }
    response = asyncio.run(nexus_agent.agent_app_updates(device_id="agent-1", user={"id": "tech-1"}))
    assert response["device_id"] == "agent-1"
    assert response["status"] == "ok"
    assert response["stale"] is False
    assert response["package_count"] == 1
    assert response["packages"][0]["id"] == "Microsoft.Edge"

    # An old scan is disclosed as stale evidence rather than presented as current.
    old = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    fake_db.nexus_agents.find_one_result["app_updates"]["observed_at"] = old
    stale = asyncio.run(nexus_agent.agent_app_updates(device_id="agent-1", user={"id": "tech-1"}))
    assert stale["stale"] is True

    # A timestamp the API cannot read is treated as stale, never as fresh.
    fake_db.nexus_agents.find_one_result["app_updates"]["observed_at"] = "not-a-timestamp"
    unreadable = asyncio.run(nexus_agent.agent_app_updates(device_id="agent-1", user={"id": "tech-1"}))
    assert unreadable["stale"] is True


def test_the_apply_command_is_a_typed_request_not_a_command_line():
    request = nexus_agent.CommandRequest(kind="winget_upgrade", payload={"ids": ["Microsoft.Edge"]})
    assert request.kind == "winget_upgrade"
    assert request.include_offline is False
    whole_fleet = nexus_agent.CommandRequest(kind="winget_upgrade", payload={"all": True})
    assert whole_fleet.payload["all"] is True

    # The API accepts only its own vocabulary, so a caller cannot turn an endpoint
    # into a general command runner through this route.
    with pytest.raises(ValidationError):
        nexus_agent.CommandRequest(kind="winget upgrade --all", payload={})


def test_the_application_update_routes_and_gates_are_registered():
    paths = {route.path for route in nexus_agent.router.routes}
    assert "/nexus-agent/agents/{device_id}/app-updates" in paths

    methods = {
        method
        for route in nexus_agent.router.routes
        if route.path == "/nexus-agent/agents/{device_id}/app-updates"
        for method in route.methods
    }
    assert methods == {"GET"}

    settings = nexus_agent.NexusAgentSettings()
    assert settings.winget_auto_update_enabled is False
    assert settings.winget_enabled is False
    assert settings.winget_allowed_ids == []
