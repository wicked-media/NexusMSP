"""Platform Health must remain global-scope, evidence-backed and honest."""

from __future__ import annotations

import asyncio
import os
import sys
import types
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.auth import get_current_user  # noqa: E402
from app.routers import platform_health as routes  # noqa: E402
from app.services import platform_health as policy  # noqa: E402
from test_studio_fleet import _mounted_operation  # noqa: E402

ADMIN = {"id": "admin-1", "name": "Ada Admin", "role": "admin", "is_admin": True}
RESTRICTED = {"id": "tech-1", "name": "Tina", "role": "technician", "is_admin": False,
              "client_scope_mode": "restricted", "client_scope_ids": ["acme"]}


def test_snapshot_discloses_missing_isolation_evidence_and_agent_coverage():
    snapshot = policy.build_snapshot(
        database_reachable=True,
        event_backbone={"status": "healthy", "queue_depth": 0, "dead_letter": 0},
        active_agents=2,
        reporting_agents=1,
    )
    by_id = {row["id"]: row for row in snapshot["components"]}
    assert by_id["database"]["state"] == "healthy"
    assert by_id["agents"]["state"] == "attention"
    assert by_id["tenant-isolation"]["state"] == "not_measured"
    assert "does not prove" in snapshot["boundary"]


class _Agents:
    async def count_documents(self, query):
        return 2 if "last_seen" not in query else 1


class _Database:
    nexus_agents = _Agents()

    async def command(self, command):
        assert command == "ping"
        return {"ok": 1}


def test_platform_health_is_mounted_and_requires_action_permission():
    route = _mounted_operation("GET", "/api/platform-health/overview")
    assert route is not None
    assert route.endpoint is routes.overview
    calls = [dependency.call for dependency in route.dependant.dependencies]
    assert get_current_user in calls


def test_platform_health_refuses_restricted_scope(monkeypatch):
    async def deny(*_args, **_kwargs):
        raise HTTPException(status_code=403, detail="denied")

    monkeypatch.setattr(routes, "assert_global_scope", deny)
    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(routes.overview(request=types.SimpleNamespace(), current_user=RESTRICTED))
    assert excinfo.value.status_code == 403


def test_platform_health_returns_sanitised_evidence(monkeypatch):
    async def allow(*_args, **_kwargs):
        return {"mode": "all"}

    async def events():
        return {"status": "healthy", "queue_depth": 0, "dead_letter": 0, "checked_at": "now"}

    monkeypatch.setattr(routes, "assert_global_scope", allow)
    monkeypatch.setattr(routes, "event_backbone_health", events)
    monkeypatch.setattr(routes, "db", _Database())
    report = asyncio.run(routes.overview(request=types.SimpleNamespace(), current_user=ADMIN))
    assert report["summary"]["healthy"] >= 3
    assert report["summary"]["not_measured"] == 1
    assert "generated_at" in report
