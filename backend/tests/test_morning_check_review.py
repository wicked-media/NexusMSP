"""Evidence and sign-off guardrails for the daily NOC review."""

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

from app.routers import morning_checks  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    def sort(self, *_args):
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class FakeCollection:
    def __init__(self):
        self.rows = {}

    async def find_one(self, query, projection=None):
        for row in self.rows.values():
            if all(row.get(key) == value for key, value in query.items()):
                return dict(row)
        return None

    def find(self, query, projection=None):
        return FakeCursor(self.rows.values())

    async def insert_one(self, document):
        self.rows[document["id"]] = dict(document)
        # Match Motor: the mapping passed to insert_one is mutated with _id.
        document["_id"] = object()
        return SimpleNamespace(inserted_id=document["id"])

    async def update_one(self, query, update):
        row = await self.find_one(query)
        if not row:
            return SimpleNamespace(modified_count=0)
        self.rows[row["id"]].update(dict(update.get("$set") or {}))
        return SimpleNamespace(modified_count=1)


class FakeDb:
    def __init__(self):
        self.morning_check_runs = FakeCollection()


async def no_activity(*_args, **_kwargs):
    return None


async def sample_checks(_current_user):
    return {
        "timestamp": "2026-07-27T01:00:00+00:00",
        "health_score": 62,
        "devices": {"online": 9, "offline": 1, "warning": 0},
        "tickets": {"critical_high": 2, "sla_breaches": 1, "unassigned": 3},
        "backups": {"success": 5, "failed": 0, "warning": 0},
        "security": {"alerts_24h": 1, "critical_alerts": 0},
        "phones": {"online": 1, "pbx_count": 1, "attention": 0},
        "scheduled_tasks": [{"id": "task-1"}],
        "recurring_due": [],
        "patches_pending": 0,
        "overdue_invoices": {"count": 0},
    }


def test_review_snapshot_contains_clear_and_attention_evidence():
    steps = morning_checks._review_steps(asyncio.run(sample_checks({})))
    assert len(steps) == 7
    assert next(step for step in steps if step["key"] == "fleet")["signal"] == "attention"
    assert next(step for step in steps if step["key"] == "backups")["signal"] == "clear"
    assert all(step["outcome"] == "pending" for step in steps)
    assert all("attention" not in step for step in steps)


def test_review_requires_exception_notes_and_full_signoff(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(morning_checks, "db", fake_db)
    monkeypatch.setattr(morning_checks, "get_morning_checks", sample_checks)
    monkeypatch.setattr(morning_checks, "log_activity", no_activity)
    user = {"id": "tech-1", "name": "Test Technician", "timezone": "Australia/Sydney"}

    run = asyncio.run(morning_checks.start_morning_check_run({}, current_user=user))
    assert run["started_by"] == "Test Technician"
    assert run["snapshot_health_score"] == 62
    assert "_id" not in run

    with pytest.raises(HTTPException) as missing_note:
        asyncio.run(morning_checks.review_morning_check_step(
            run["id"], "fleet", {"outcome": "exception", "note": "short"}, current_user=user
        ))
    assert missing_note.value.status_code == 422

    asyncio.run(morning_checks.review_morning_check_step(
        run["id"], "fleet", {"outcome": "exception", "note": "Ticket TKT-1001 assigned to Sarah."}, current_user=user
    ))

    with pytest.raises(HTTPException) as incomplete:
        asyncio.run(morning_checks.complete_morning_check_run(
            run["id"], {"handoff_note": "Fleet issue is assigned; all other checks reviewed."}, current_user=user
        ))
    assert incomplete.value.status_code == 409

    for step in run["steps"]:
        if step["key"] != "fleet":
            asyncio.run(morning_checks.review_morning_check_step(
                run["id"], step["key"], {"outcome": "reviewed", "note": ""}, current_user=user
            ))

    completed = asyncio.run(morning_checks.complete_morning_check_run(
        run["id"],
        {"handoff_note": "Fleet exception assigned to Sarah; remaining evidence is clear."},
        current_user=user,
    ))
    assert completed["status"] == "completed"
    assert completed["completed_by"] == "Test Technician"


def test_cancelled_review_retains_reason_without_completion(monkeypatch):
    fake_db = FakeDb()
    monkeypatch.setattr(morning_checks, "db", fake_db)
    monkeypatch.setattr(morning_checks, "get_morning_checks", sample_checks)
    monkeypatch.setattr(morning_checks, "log_activity", no_activity)
    user = {"id": "tech-1", "name": "Test Technician"}

    run = asyncio.run(morning_checks.start_morning_check_run({}, current_user=user))
    cancelled = asyncio.run(morning_checks.cancel_morning_check_run(
        run["id"],
        {"reason": "Workflow verification only; no operational review performed."},
        current_user=user,
    ))
    assert cancelled["status"] == "cancelled"
    assert cancelled["completed_at"] is None
    assert "verification only" in cancelled["cancel_reason"].lower()
