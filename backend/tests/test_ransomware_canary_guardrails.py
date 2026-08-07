"""Focused deployment safety tests for Nexus Canary."""

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import ransomware_canary  # noqa: E402


class FindOneCollection:
    def __init__(self, row=None):
        self.row = row
        self.queries = []

    async def find_one(self, query, projection=None):
        self.queries.append((query, projection))
        return dict(self.row) if self.row else None


class CanaryDb:
    def __init__(self, agent, canary=None):
        self.nexus_agents = FindOneCollection(agent)
        self.ransomware_canaries = FindOneCollection(canary)


def test_canary_deploy_rejects_offline_agent(monkeypatch):
    stale = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    fake_db = CanaryDb({
        "id": "agent-offline",
        "is_active": True,
        "hostname": "OFFLINE-PC",
        "os_name": "Windows 11",
        "last_seen": stale,
    })
    monkeypatch.setattr(ransomware_canary, "db", fake_db)

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(ransomware_canary.deploy_canary(
            {"agent_id": "agent-offline"},
            current_user={"id": "operator-1", "email": "operator@example.test"},
        ))

    assert rejected.value.status_code == 409
    assert "offline" in rejected.value.detail.lower()


def test_canary_deploy_rejects_duplicate_active_sensor(monkeypatch):
    current = datetime.now(timezone.utc).isoformat()
    fake_db = CanaryDb(
        {
            "id": "agent-protected",
            "is_active": True,
            "hostname": "AARON-HOME-PC",
            "os_name": "Windows 11",
            "last_seen": current,
        },
        {
            "id": "canary-existing",
            "device_name": "AARON-HOME-PC",
            "status": "healthy",
        },
    )
    monkeypatch.setattr(ransomware_canary, "db", fake_db)

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(ransomware_canary.deploy_canary(
            {"agent_id": "agent-protected"},
            current_user={"id": "operator-1", "email": "operator@example.test"},
        ))

    assert rejected.value.status_code == 409
    assert "already has an active nexus canary" in rejected.value.detail.lower()
    duplicate_query = fake_db.ransomware_canaries.queries[0][0]
    assert duplicate_query["status"]["$in"] == ["queued", "active", "healthy", "triggered"]
