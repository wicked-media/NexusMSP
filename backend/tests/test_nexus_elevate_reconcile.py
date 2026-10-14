"""Focused tests for the durable Nexus Elevate reconcile sweeps.

The ``nexus-elevate`` worker keeps approval SLAs and expiry honest without
console reads: elapsed approval windows are closed once and overdue reviews
are escalated to on-call once.  These tests pin that idempotent, tenant-tagged
policy without a database or scheduler.
"""

import asyncio
from types import SimpleNamespace

from app.routers import permission_elevation


PAST = "2020-01-01T00:00:00+00:00"
FUTURE = "2999-01-01T00:00:00+00:00"


class _Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


def _matches(row, query):
    for key, expected in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and (key in row) != bool(expected["$exists"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$lte" in expected and not (actual is not None and actual <= expected["$lte"]):
                return False
            if "$gte" in expected and not (actual is not None and actual >= expected["$gte"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return [dict(row) for row in self.rows]


class _Rows:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]
        self.inserted = []

    def find(self, query, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, row):
        self.inserted.append(dict(row))
        self.rows.append(dict(row))

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                return _Result(1)
        if upsert:
            new_row = {key: value for key, value in query.items() if not isinstance(value, dict)}
            new_row.update(update.get("$setOnInsert") or {})
            self.rows.append(new_row)
            return _Result(0)
        return _Result()

    async def update_many(self, query, update):
        matched = 0
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                matched += 1
        return _Result(matched)


def _database(*, requests):
    return SimpleNamespace(
        nexus_elevate_requests=_Rows(requests),
        nexus_elevate_audit=_Rows(),
        notifications=_Rows(),
        on_call_roster=_Rows([{
            "tenant_id": "tenant-a",
            "start_time": PAST,
            "end_time": FUTURE,
            "status": "active",
            "tech_id": "tech-9",
            "shift_type": "primary",
        }]),
    )


def test_expiry_sweep_closes_elapsed_approval_windows_once(monkeypatch):
    database = _database(requests=[
        {"id": "req-1", "tenant_id": "tenant-a", "status": "approved", "approved_until": PAST},
        {"id": "req-2", "tenant_id": "tenant-a", "status": "approved", "approved_until": FUTURE},
        {"id": "req-3", "tenant_id": "tenant-b", "status": "pending", "approved_until": PAST},
    ])
    monkeypatch.setattr(permission_elevation, "db", database)

    expired = asyncio.run(permission_elevation._expire_stale_native_approvals())

    assert expired == 1
    by_id = {row["id"]: row for row in database.nexus_elevate_requests.rows}
    assert by_id["req-1"]["status"] == "expired"
    assert by_id["req-1"]["expired_at"]
    assert "window elapsed" in by_id["req-1"]["expiration_reason"]
    assert by_id["req-2"]["status"] == "approved"
    assert by_id["req-3"]["status"] == "pending"

    audit_kinds = [event["kind"] for event in database.nexus_elevate_audit.inserted]
    assert audit_kinds == ["nexus_elevate_expired"]

    # The compare-and-set update means a second sweep changes nothing.
    assert asyncio.run(permission_elevation._expire_stale_native_approvals()) == 0
    assert database.nexus_elevate_requests.rows[0]["status"] == "expired"
    assert len(database.nexus_elevate_audit.inserted) == 1


def test_escalation_sweep_pages_on_call_once_and_keeps_tenant_tagging(monkeypatch):
    database = _database(requests=[
        {"id": "req-a", "tenant_id": "tenant-a", "status": "pending", "approval_due_at": PAST,
         "program_path": "C:\\Program Files\\Vendor\\app.exe", "hostname": "WS-01"},
        {"id": "req-b", "tenant_id": "tenant-a", "status": "pending", "approval_due_at": FUTURE},
        {"id": "req-c", "tenant_id": "tenant-b", "status": "pending", "approval_due_at": PAST,
         "approval_escalated_at": PAST},
    ])
    monkeypatch.setattr(permission_elevation, "db", database)

    escalated = asyncio.run(permission_elevation._escalate_overdue_native_reviews({}))

    assert escalated == 1
    by_id = {row["id"]: row for row in database.nexus_elevate_requests.rows}
    assert by_id["req-a"]["approval_escalated_at"]
    assert not by_id["req-b"].get("approval_escalated_at")
    assert by_id["req-c"]["approval_escalated_at"] == PAST

    notifications = [row for row in database.notifications.rows
                     if row.get("type") == "nexus_elevate_review_escalation"]
    assert [row["user_id"] for row in notifications] == ["tech-9"]
    assert notifications[0]["tenant_id"] == "tenant-a"
    assert notifications[0]["ref_id"] == "req-a"
    assert notifications[0]["action_url"].startswith("/nexus-elevate")

    escalations = [event for event in database.nexus_elevate_audit.inserted
                   if event["kind"] == "nexus_elevate_review_escalated"]
    assert len(escalations) == 1
    assert escalations[0]["request_id"] == "req-a"

    # Escalation is written once; a page refresh or worker tick cannot re-page on-call.
    assert asyncio.run(permission_elevation._escalate_overdue_native_reviews({})) == 0
    assert len([row for row in database.notifications.rows
                if row.get("type") == "nexus_elevate_review_escalation"]) == 1
