"""Nexus Time Machine state, comparison, and deduplication behaviour."""

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

from app.services.time_machine import (  # noqa: E402
    compare_endpoint_states,
    normalise_endpoint_state,
    record_endpoint_state_snapshot,
)


class FakeCursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    def sort(self, field, direction):
        self.rows.sort(key=lambda row: str(row.get(field) or ""), reverse=direction < 0)
        return self

    async def to_list(self, limit):
        return [dict(row) for row in self.rows[:limit]]


class FakeSnapshots:
    def __init__(self):
        self.rows = []

    def find(self, query, _projection):
        return FakeCursor([
            row for row in self.rows
            if all(row.get(key) == value for key, value in query.items())
        ])

    async def insert_one(self, row):
        self.rows.append(dict(row))

    async def update_one(self, query, update):
        row = next(item for item in self.rows if item.get("id") == query.get("id"))
        row.update(update.get("$set") or {})
        for key, value in (update.get("$inc") or {}).items():
            row[key] = row.get(key, 0) + value


class FakeDb:
    def __init__(self):
        self.device_state_snapshots = FakeSnapshots()


def test_normalisation_reports_only_collected_coverage():
    state = normalise_endpoint_state(
        {
            "hostname": "AARON-HOME-PC",
            "os": "Windows",
            "security": {"firewall_enabled": True, "pending_update_count": 0},
            "software": [{"name": "Nexus Agent", "version": "1.2.3"}],
        },
        capabilities=["nexus_shield"],
        agent_version="1.2.3",
    )

    assert state["coverage"] == ["agent", "security", "software", "system", "updates"]
    assert "registry" not in state["coverage"]
    assert "group_policy" not in state["coverage"]
    assert state["categories"]["security"]["firewall_enabled"] is True


def test_comparison_groups_software_and_system_changes():
    before = normalise_endpoint_state({
        "hostname": "PC-1",
        "os": "Windows 11",
        "software": [
            {"name": "Nexus Agent", "publisher": "Nexus", "version": "1.0"},
            {"name": "Old Tool", "publisher": "Example", "version": "2.0"},
        ],
    })
    after = normalise_endpoint_state({
        "hostname": "PC-1-RENAMED",
        "os": "Windows 11",
        "software": [
            {"name": "Nexus Agent", "publisher": "Nexus", "version": "1.1"},
            {"name": "New Tool", "publisher": "Example", "version": "1.0"},
        ],
    })

    comparison = compare_endpoint_states(before, after)

    assert comparison["total_changes"] == 4
    assert comparison["changed_categories"] == ["software", "system"]
    software = comparison["categories"]["software"]
    assert [row["label"] for row in software["added"]] == ["New Tool"]
    assert [row["label"] for row in software["removed"]] == ["Old Tool"]
    assert [row["label"] for row in software["changed"]] == ["Nexus Agent"]
    assert comparison["categories"]["system"]["changed"][0]["key"] == "hostname"


def test_identical_heartbeats_extend_observation_instead_of_duplicating():
    database = FakeDb()
    baseline = {
        "hostname": "AARON-HOME-PC",
        "os": "Windows 11",
        "software": [{"name": "Nexus Agent", "version": "1.0"}],
    }

    first = asyncio.run(record_endpoint_state_snapshot(
        database,
        device_id="device-1",
        client_id="client-1",
        agent_id="agent-1",
        snapshot=baseline,
        capabilities=["inventory"],
        agent_version="1.0",
        captured_at="2026-07-28T00:00:00+00:00",
    ))
    duplicate = asyncio.run(record_endpoint_state_snapshot(
        database,
        device_id="device-1",
        client_id="client-1",
        agent_id="agent-1",
        snapshot=baseline,
        capabilities=["inventory"],
        agent_version="1.0",
        captured_at="2026-07-28T00:05:00+00:00",
    ))
    changed = asyncio.run(record_endpoint_state_snapshot(
        database,
        device_id="device-1",
        client_id="client-1",
        agent_id="agent-1",
        snapshot={**baseline, "hostname": "AARON-HOME-PC-2"},
        capabilities=["inventory"],
        agent_version="1.0",
        captured_at="2026-07-28T00:10:00+00:00",
    ))

    assert first["created"] is True
    assert duplicate["created"] is False
    assert changed["created"] is True
    assert len(database.device_state_snapshots.rows) == 2
    assert database.device_state_snapshots.rows[0]["observation_count"] == 2
    assert database.device_state_snapshots.rows[0]["last_observed_at"] == "2026-07-28T00:05:00+00:00"
    assert database.device_state_snapshots.rows[1]["change_count"] == 1
    assert database.device_state_snapshots.rows[1]["changed_categories"] == ["system"]
