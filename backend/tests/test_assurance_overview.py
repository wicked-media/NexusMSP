"""Evidence and scope boundaries for the Nexus Assurance read model."""

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

os.environ.setdefault("JWT_SECRET", "test-only-secret-that-is-long-and-random-enough")
os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "nexusops-tests")

from app.routers import expected_state  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    async def to_list(self, _limit):
        return list(self.rows)


class FakeCollection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.queries = []

    def find(self, query, _projection=None):
        self.queries.append(dict(query))
        return FakeCursor(self.rows)


class FakeDb:
    def __init__(self, *, clients=(), devices=(), agents=(), subscriptions=(), backup_jobs=(), recovery_tests=(), hygiene=()):
        self.clients = FakeCollection(clients)
        self.devices = FakeCollection(devices)
        self.nexus_agents = FakeCollection(agents)
        self.subscriptions = FakeCollection(subscriptions)
        self.backup_jobs = FakeCollection(backup_jobs)
        self.backup_verifications = FakeCollection(recovery_tests)
        self.cipp_hygiene_cache = FakeCollection(hygiene)


def _control(result, control_id):
    return next(item for item in result["controls"] if item["control_id"] == control_id)


def test_assurance_route_is_an_alias_of_expected_state_contract():
    paths = {route.path for route in expected_state.router.routes}

    assert "/assurance/overview" in paths
    assert "/expected-state/overview" in paths


def test_assurance_counts_only_a_stable_device_agent_link(monkeypatch):
    now = datetime.now(timezone.utc).isoformat()
    database = FakeDb(
        clients=[{"id": "client-a", "name": "Alpha"}],
        devices=[
            {"id": "device-a", "client_id": "client-a", "nexus_agent_id": "agent-a"},
            {"id": "device-b", "client_id": "client-a", "nexus_agent_id": "agent-missing"},
        ],
        agents=[
            {"id": "agent-a", "client_id": "client-a", "is_active": True, "last_seen": now},
            # This is active but not linked to either device, so it cannot
            # falsely complete client-wide endpoint coverage.
            {"id": "unlinked-agent", "client_id": "client-a", "is_active": True, "last_seen": now},
        ],
    )
    monkeypatch.setattr(expected_state, "db", database)

    result = asyncio.run(expected_state.expected_state_overview({"id": "admin-1", "role": "admin"}))
    endpoint = _control(result, "endpoint-agent")

    assert endpoint["status"] == "gap"
    assert endpoint["expected"] == 2
    assert endpoint["observed"] == 1
    assert endpoint["provenance"]["sources"] == ["devices", "nexus_agents"]
    assert "same stable nexus_agent_id" in endpoint["provenance"]["boundary"]
    assert result["read_model"] == "nexus-assurance-expected-state"
    assert result["provenance"]["no_persistence"] is True


def test_assurance_applies_restricted_client_scope_to_all_evidence_sources(monkeypatch):
    database = FakeDb(clients=[{"id": "client-a", "name": "Alpha"}])
    monkeypatch.setattr(expected_state, "db", database)

    result = asyncio.run(expected_state.expected_state_overview({
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }))

    assert result["summary"]["clients"] == 1
    assert database.clients.queries == [{"id": {"$in": ["client-a"]}}]
    for collection in (
        database.devices,
        database.nexus_agents,
        database.subscriptions,
        database.backup_jobs,
        database.backup_verifications,
    ):
        assert collection.queries
        assert "client-a" in str(collection.queries[0])


def test_assurance_marks_missing_evidence_not_assessed(monkeypatch):
    database = FakeDb(clients=[{"id": "client-a", "name": "Alpha"}])
    monkeypatch.setattr(expected_state, "db", database)

    result = asyncio.run(expected_state.expected_state_overview({"id": "admin-1", "role": "admin"}))

    assert all(control["status"] == "not_assessed" for control in result["controls"])
    assert "never treated as compliant" in result["boundary"]


def test_assurance_recognises_native_passed_recovery_verification(monkeypatch):
    database = FakeDb(
        clients=[{"id": "client-a", "name": "Alpha"}],
        devices=[{"id": "device-a", "client_id": "client-a"}],
        subscriptions=[{"id": "service-a", "client_id": "client-a", "name": "Managed Backup", "status": "active"}],
        recovery_tests=[{"id": "verify-a", "client_id": "client-a", "status": "completed", "result": "pass"}],
    )
    monkeypatch.setattr(expected_state, "db", database)

    result = asyncio.run(expected_state.expected_state_overview({"id": "admin-1", "role": "admin"}))
    recovery = _control(result, "recovery-verification")

    assert recovery["status"] == "covered"
    assert recovery["observed"] == 1


def test_assurance_reads_mapped_hygiene_for_restricted_scope(monkeypatch):
    database = FakeDb(
        clients=[{"id": "client-a", "name": "Alpha", "cipp_tenant_id": "tenant-a"}],
        hygiene=[{"tenant_id": "tenant-a", "hygiene": {"evidence_state": "assessed"}}],
    )
    monkeypatch.setattr(expected_state, "db", database)

    result = asyncio.run(expected_state.expected_state_overview({
        "id": "tech-1",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }))
    posture = _control(result, "microsoft-posture")

    assert posture["status"] == "covered"
    assert database.cipp_hygiene_cache.queries == [{"tenant_id": {"$in": ["tenant-a"]}}]
