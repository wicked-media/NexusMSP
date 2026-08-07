"""Policy-scope and threshold guardrails for Nexus Shield."""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import nexus_shield  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    async def to_list(self, _limit):
        return list(self.rows)


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]
        self.updated = []

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return dict(row)
        return None

    def find(self, query, projection=None):
        ids = set((query.get("id") or {}).get("$in") or [])
        rows = [row for row in self.rows if not ids or row.get("id") in ids]
        return FakeCursor(rows)

    async def update_one(self, query, update, upsert=False):
        changes = dict(update.get("$set") or {})
        self.updated.append((dict(query), changes, upsert))
        existing = next((row for row in self.rows if all(row.get(key) == value for key, value in query.items())), None)
        if existing:
            existing.update(changes)
        elif upsert:
            self.rows.append(changes)
        return SimpleNamespace(modified_count=1)


class FakeDb:
    def __init__(self):
        self.settings = FakeCollection()
        self.clients = FakeCollection([
            {"id": "client-1", "name": "Acme Corporation"},
            {"id": "client-2", "name": "Globex"},
        ])


async def no_activity(*_args, **_kwargs):
    return None


def configured_policies():
    return [
        {
            **policy,
            "client_ids": list(policy.get("client_ids") or []),
        }
        for policy in nexus_shield.DEFAULT_POLICIES
    ]


def test_policy_scope_and_patch_threshold_are_applied_to_evidence():
    selected = {
        **next(policy for policy in nexus_shield.DEFAULT_POLICIES if policy["id"] == "defender_health"),
        "scope_mode": "selected_clients",
        "client_ids": ["client-1"],
    }
    assert nexus_shield._policy_applies(selected, "client-1") is True
    assert nexus_shield._policy_applies(selected, "client-2") is False
    assert nexus_shield._policy_applies(selected, None) is False

    risks = nexus_shield._device_risks(
        {
            "id": "device-1",
            "name": "AARON-HOME-PC",
            "client_id": "client-1",
            "security_assessed_at": "2026-07-27T00:00:00+00:00",
            "antivirus_status": "active",
            "defender_real_time_enabled": True,
            "firewall_enabled": True,
            "encryption_status": "encrypted",
            "pending_patches": 20,
        },
        {"patch_exposure": {"threshold": 25}},
    )
    assert not any(risk["control"] == "Patch exposure" for risk in risks)


def test_policy_update_persists_scope_severity_and_threshold(monkeypatch):
    fake_db = FakeDb()
    activity = {}

    async def capture_activity(*_args, **kwargs):
        activity.update(kwargs)

    monkeypatch.setattr(nexus_shield, "db", fake_db)
    monkeypatch.setattr(nexus_shield, "log_activity", capture_activity)
    policies = configured_policies()
    patch_policy = next(policy for policy in policies if policy["id"] == "patch_exposure")
    patch_policy.update({
        "severity": "high",
        "scope_mode": "selected_clients",
        "client_ids": ["client-1"],
        "threshold": 25,
    })

    result = asyncio.run(nexus_shield.update_nexus_shield_policies(
        {"policies": policies},
        current_user={"id": "operator-1", "name": "Test Technician"},
    ))

    saved = fake_db.settings.updated[0][1]
    saved_patch = next(policy for policy in saved["value"]["policies"] if policy["id"] == "patch_exposure")
    assert saved_patch["severity"] == "high"
    assert saved_patch["scope_mode"] == "selected_clients"
    assert saved_patch["client_ids"] == ["client-1"]
    assert saved_patch["threshold"] == 25
    assert result["updated_by"] == "Test Technician"
    assert result["changed_controls"] == 1
    assert activity["metadata"]["changed_control_count"] == 1
    assert activity["metadata"]["changed_controls"] == [{
        "id": "patch_exposure",
        "fields": ["severity", "scope_mode", "client_ids", "threshold"],
    }]
    assert activity["metadata"]["external_changes"] is False


def test_policy_update_rejects_unknown_client_scope(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(nexus_shield, "db", fake_db)
    policies = configured_policies()
    policies[0].update({
        "scope_mode": "selected_clients",
        "client_ids": ["client-missing"],
    })

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(nexus_shield.update_nexus_shield_policies(
            {"policies": policies},
            current_user={"id": "operator-1", "name": "Test Technician"},
        ))

    assert rejected.value.status_code == 422
    assert "no longer exist" in rejected.value.detail


def test_policy_update_rejects_malformed_client_scope(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(nexus_shield, "db", fake_db)
    policies = configured_policies()
    policies[0]["client_ids"] = "client-1"

    with pytest.raises(HTTPException) as rejected:
        asyncio.run(nexus_shield.update_nexus_shield_policies(
            {"policies": policies},
            current_user={"id": "operator-1", "name": "Test Technician"},
        ))

    assert rejected.value.status_code == 422
    assert "must be a list" in rejected.value.detail
