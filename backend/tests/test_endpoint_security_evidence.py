"""Evidence boundaries for Nexus Shield endpoint posture."""

import asyncio
import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import endpoint_security  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    async def to_list(self, _limit):
        return list(self.rows)


class FakeDevices:
    def __init__(self, rows):
        self.rows = rows

    def find(self, _query, _projection):
        return FakeCursor(self.rows)


class FakeDb:
    def __init__(self, rows):
        self.devices = FakeDevices(rows)


def test_inventory_only_security_fields_are_not_assessed(monkeypatch):
    monkeypatch.setattr(endpoint_security, "db", FakeDb([{
        "id": "inventory-1",
        "name": "Inventory PC",
        "firewall_enabled": True,
        "encryption_status": "BitLocker - Encrypted",
        "antivirus_status": "active",
        "defender_real_time_enabled": True,
    }]))

    result = asyncio.run(endpoint_security.get_endpoint_scores({"id": "tech-1"}))
    endpoint = result["scores"][0]

    assert endpoint["evidence_state"] == "inventory_only"
    assert endpoint["av_status"] == "not_assessed"
    assert endpoint["firewall"] == "not_assessed"
    assert endpoint["encryption"] == "not_assessed"
    assert endpoint["patch_status"] == "not_assessed"
    assert endpoint["av_score"] is None
    assert endpoint["firewall_score"] is None
    assert endpoint["encryption_score"] is None
    assert endpoint["overall_score"] is None
    assert endpoint["risk_score"] is None
    assert endpoint["grade"] == "—"


def test_verified_agent_security_fields_preserve_live_evidence(monkeypatch):
    monkeypatch.setattr(endpoint_security, "db", FakeDb([{
        "id": "verified-1",
        "name": "Verified PC",
        "nexus_agent_id": "agent-1",
        "security_assessed_at": "2026-07-28T00:00:00Z",
        "firewall_enabled": True,
        "encryption_status": "BitLocker - Encrypted",
        "antivirus_status": "active",
        "defender_real_time_enabled": True,
        "pending_patches": 0,
    }]))

    result = asyncio.run(endpoint_security.get_endpoint_scores({"id": "tech-1"}))
    endpoint = result["scores"][0]

    assert endpoint["evidence_state"] == "agent_verified"
    assert endpoint["av_status"] == "active"
    assert endpoint["firewall"] == "enabled"
    assert endpoint["encryption"] == "encrypted"
    assert endpoint["patch_status"] == "up_to_date"
    assert endpoint["overall_score"] == 100
    assert endpoint["grade"] == "A"
