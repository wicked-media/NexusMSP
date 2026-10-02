"""Regression coverage for Backup Centre scoped recovery evidence."""

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

from app.routers import backup_center  # noqa: E402


class _Cursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


class _Collection:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]
        self.queries = []
        self.inserted = []

    def find(self, query, _projection=None):
        self.queries.append(dict(query))
        return _Cursor(self.rows)

    async def find_one(self, query, _projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return dict(row)
        return None

    async def insert_one(self, record):
        self.inserted.append(dict(record))


class _Database:
    def __init__(self):
        self.clients = _Collection([{"id": "client-a", "name": "Allowed client"}])
        self.backup_jobs = _Collection()
        self.backup_records = _Collection()
        self.backup_verifications = _Collection()
        self.backup_recovery_simulations = _Collection()
        self.activity_logs = _Collection()


def _restricted_user():
    return {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _assert_client_scope_query(query):
    assert "client-a" in str(query)
    assert query != {}


def test_assurance_overview_does_not_fall_back_to_all_provider_data_for_restricted_user(monkeypatch):
    database = _Database()
    fallback_calls = []
    monkeypatch.setattr(backup_center, "db", database)

    async def fallback():
        fallback_calls.append(True)
        return [{"client_id": "client-foreign", "status": "success"}]

    monkeypatch.setattr(backup_center, "_build_overview_from_acronis", fallback)

    result = asyncio.run(backup_center.backup_assurance_overview(current_user=_restricted_user()))

    assert fallback_calls == []
    assert result["confidence"]["score"] is None
    for collection in (database.backup_jobs, database.backup_records, database.backup_verifications):
        _assert_client_scope_query(collection.queries[0])


def test_recovery_simulation_reads_and_records_only_the_allowed_client_scope(monkeypatch):
    database = _Database()
    fallback_calls = []
    monkeypatch.setattr(backup_center, "db", database)

    async def fallback():
        fallback_calls.append(True)
        return [{"client_id": "client-foreign", "status": "success"}]

    monkeypatch.setattr(backup_center, "_build_overview_from_acronis", fallback)

    result = asyncio.run(backup_center.create_recovery_simulation({
        "client_id": "client-a",
        "workload": "Finance file server",
        "target_rto_hours": 4,
        "target_rpo_hours": 24,
        "data_size_gb": 100,
        "dependencies": ["Directory services"],
    }, _restricted_user()))

    assert fallback_calls == []
    assert result["simulation"]["client_id"] == "client-a"
    for collection in (database.backup_jobs, database.backup_records, database.backup_verifications):
        _assert_client_scope_query(collection.queries[0])
    assert database.backup_recovery_simulations.inserted[0]["client_id"] == "client-a"
    assert database.activity_logs.inserted[0]["metadata"]["client_id"] == "client-a"


def test_selected_client_assurance_ignores_same_named_evidence_from_another_allowed_client(monkeypatch):
    database = _Database()
    database.backup_jobs.rows = [{
        "client_id": "client-b",
        "client_name": "Allowed client",
        "status": "success",
    }]
    database.backup_records.rows = [{
        "client_id": "client-b",
        "client_name": "Allowed client",
        "immutable": True,
    }]
    database.backup_verifications.rows = [{
        "client_id": "client-b",
        "client_name": "Allowed client",
        "result": "pass",
        "data_integrity_check": "passed",
    }]
    monkeypatch.setattr(backup_center, "db", database)

    result = asyncio.run(backup_center.backup_assurance_overview(
        client_id="client-a",
        current_user=_restricted_user(),
    ))

    assert result["confidence"]["score"] is None
    for collection in (database.backup_jobs, database.backup_records, database.backup_verifications):
        _assert_client_scope_query(collection.queries[0])
        assert "client-a" in str(collection.queries[0])
