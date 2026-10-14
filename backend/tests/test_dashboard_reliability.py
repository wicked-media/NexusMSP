"""Focused regression coverage for the dashboard's optional provider enrichment."""

import asyncio
import time

from app.routers import dashboard


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class _Collection:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.find_queries = []

    def find(self, query, *_args, **_kwargs):
        self.find_queries.append(query)
        return _Cursor([row for row in self.rows if _matches(row, query)])


def _matches(row, query):
    if "$and" in query:
        return all(_matches(row, clause) for clause in query["$and"])
    for field, expected in query.items():
        value = row.get(field)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$ne" in expected and value == expected["$ne"]:
                return False
        elif value != expected:
            return False
    return True


class _DashboardDb:
    ticket_comments = _Collection()
    ticket_emails = _Collection()
    tickets = _Collection()
    alerts = _Collection()
    yeastar_pbxs = _Collection([
        {
            "id": "pbx-slow",
            "name": "Slow PBX",
            "client_name": "Example client",
            "pbx_url": "https://pbx.example.invalid",
            "client_api_id": "client-id",
            "client_secret": "not-a-real-secret",
            "tls_validation": True,
        }
    ])


def test_activity_feed_does_not_wait_for_an_unresponsive_pbx(monkeypatch):
    """A live provider timeout must not block the shared dashboard feed."""
    from app.routers import yeastar

    async def slow_token(*_args, **_kwargs):
        await asyncio.sleep(1)
        return None

    monkeypatch.setattr(dashboard, "db", _DashboardDb())
    monkeypatch.setattr(dashboard, "DASHBOARD_PBX_ACTIVITY_TIMEOUT_SECONDS", 0.02)
    monkeypatch.setattr(yeastar, "_yeastar_get_token", slow_token)

    started = time.monotonic()
    activities = asyncio.run(dashboard.get_activity_feed(limit=15, current_user={"role": "admin"}))
    elapsed = time.monotonic() - started

    assert activities == []
    assert elapsed < 0.4


def test_activity_feed_scopes_optional_pbx_activity_to_the_current_technician(monkeypatch):
    """A restricted technician must not fetch another client's PBX activity."""
    from app.routers import yeastar

    dashboard_db = _DashboardDb()
    dashboard_db.yeastar_pbxs.rows = [
        {
            "id": "pbx-client-a",
            "client_id": "client-a",
            "name": "Client A PBX",
            "client_name": "Client A",
            "enabled": True,
        },
        {
            "id": "pbx-client-b",
            "client_id": "client-b",
            "name": "Client B PBX",
            "client_name": "Client B",
            "enabled": True,
        },
    ]
    contacted_pbxs = []

    async def no_token(settings, *_args, **_kwargs):
        contacted_pbxs.append(settings["id"])
        return None

    monkeypatch.setattr(dashboard, "db", dashboard_db)
    monkeypatch.setattr(yeastar, "_yeastar_get_token", no_token)

    activities = asyncio.run(dashboard.get_activity_feed(
        limit=15,
        current_user={
            "id": "tech-client-a",
            "role": "technician",
            "client_scope_mode": "restricted",
            "client_scope_ids": ["client-a"],
        },
    ))

    assert activities == []
    assert contacted_pbxs == ["pbx-client-a"]
    query = dashboard_db.yeastar_pbxs.find_queries[-1]
    assert "client-a" in str(query)
    assert "client-b" not in str(query)
