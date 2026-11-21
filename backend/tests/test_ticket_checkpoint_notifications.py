"""Coverage for the due-promise in-app notification projection."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.routers import clients
from app.services import ticket_checkpoint_notifications as checkpoint_notifications


def _matches(row: dict, query: dict) -> bool:
    if not query:
        return True
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(row, clause) for clause in expected):
                return False
            continue
        if key == "$and":
            if not all(_matches(row, clause) for clause in expected):
                return False
            continue
        present = key in row
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and present != bool(expected["$exists"]):
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                return False
            continue
        if actual != expected:
            return False
    return True


class FakeCursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    def sort(self, field, direction=1):
        self.rows.sort(key=lambda row: row.get(field) or "", reverse=direction < 0)
        return self

    async def to_list(self, limit):
        return deepcopy(self.rows[:limit])


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(deepcopy(rows or []))
        self.indexes = []

    async def create_index(self, keys, **kwargs):
        self.indexes.append({"keys": keys, **kwargs})
        return kwargs.get("name")

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, _projection=None):
        return FakeCursor([row for row in self.rows if _matches(row, query)])

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                for field in update.get("$unset", {}):
                    row.pop(field, None)
                for field, value in update.get("$addToSet", {}).items():
                    current = row.setdefault(field, [])
                    if value not in current:
                        current.append(value)
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        inserted = deepcopy(update.get("$setOnInsert", {}))
        self.rows.append(inserted)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=inserted.get("id"))

    async def update_many(self, query, update):
        matched = [row for row in self.rows if _matches(row, query)]
        for row in matched:
            row.update(deepcopy(update.get("$set", {})))
            for field, value in update.get("$addToSet", {}).items():
                current = row.setdefault(field, [])
                if value not in current:
                    current.append(value)
        return SimpleNamespace(matched_count=len(matched), modified_count=len(matched))

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def delete_many(self, query):
        before = len(self.rows)
        self.rows[:] = [row for row in self.rows if not _matches(row, query)]
        return SimpleNamespace(deleted_count=before - len(self.rows))


class _NoTruthDatabase(SimpleNamespace):
    """PyMongo databases reject bool(); exercise the explicit None check."""

    def __bool__(self):
        raise AssertionError("database truthiness must not be tested")


def _ticket(ticket_id: str, *, due: datetime, assigned_to: str | None = None, status: str = "open", tenant_id: str = "tenant-a"):
    return {
        "id": ticket_id,
        "tenant_id": tenant_id,
        "client_id": "client-a",
        "site_id": "site-a",
        "assigned_to": assigned_to,
        "title": f"Ticket {ticket_id}",
        "ticket_number": f"INC-{ticket_id[-1]}",
        "status": status,
        "next_checkpoint_at": due.astimezone(timezone.utc).isoformat(),
    }


def test_due_promise_notifications_are_tenant_bound_and_deduplicated(monkeypatch):
    now = datetime.now(timezone.utc)
    due = now - timedelta(hours=1)
    database = SimpleNamespace(
        tickets=FakeCollection([
            _ticket("ticket-1", due=due, assigned_to="tech-1"),
            _ticket("ticket-2", due=now + timedelta(hours=1), assigned_to="tech-1"),
            _ticket("ticket-3", due=due, assigned_to="tech-1", status="resolved"),
            _ticket("ticket-4", due=due),
        ]),
        notifications=FakeCollection(),
    )
    monkeypatch.setattr(checkpoint_notifications, "db", database)

    first = asyncio.run(checkpoint_notifications.notify_due_ticket_checkpoints())
    assert first == {"checked": 2, "created": 2}
    assert database.notifications.indexes[0]["keys"] == "dedupe_key"
    assert database.notifications.indexes[0]["unique"] is True

    rows = {row["ref_id"]: row for row in database.notifications.rows}
    assigned = rows["ticket-1"]
    assert assigned["tenant_id"] == "tenant-a"
    assert assigned["client_id"] == "client-a"
    assert assigned["site_id"] == "site-a"
    assert assigned["user_id"] == "tech-1"
    assert assigned["type"] == "ticket_checkpoint_due"
    assert assigned["severity"] == "critical"
    assert assigned["checkpoint_at"] == due.astimezone(timezone.utc).isoformat()
    assert assigned["action_url"] == "/tickets?ticket=ticket-1"
    assert rows["ticket-4"]["user_id"] == "all"
    assert "ticket-2" not in rows
    assert "ticket-3" not in rows

    second = asyncio.run(checkpoint_notifications.notify_due_ticket_checkpoints())
    assert second == {"checked": 2, "created": 0}
    assert len(database.notifications.rows) == 2

    moved_due = due - timedelta(minutes=5)
    database.tickets.rows[0]["next_checkpoint_at"] = moved_due.astimezone(timezone.utc).isoformat()
    moved = asyncio.run(checkpoint_notifications.notify_due_ticket_checkpoints())
    assert moved == {"checked": 2, "created": 1}
    assert len(database.notifications.rows) == 3


class RaceTicketCollection(FakeCollection):
    """Simulate a publish clearing the promise while the worker is inserting."""

    async def find_one(self, query, _projection=None):
        self.rows[0].pop("next_checkpoint_at", None)
        return await super().find_one(query, _projection)


def test_a_worker_cleans_up_an_alert_when_the_promise_is_cleared_during_insert(monkeypatch):
    now = datetime.now(timezone.utc)
    database = SimpleNamespace(
        tickets=RaceTicketCollection([_ticket("ticket-1", due=now - timedelta(minutes=5))]),
        notifications=FakeCollection(),
    )
    monkeypatch.setattr(checkpoint_notifications, "db", database)

    result = asyncio.run(checkpoint_notifications.notify_due_ticket_checkpoints())

    assert result == {"checked": 1, "created": 0}
    alert = database.notifications.rows[0]
    assert alert["read"] is True
    assert alert["resolution"] == "promise_superseded"
    assert alert["resolved_at"]


def test_client_update_settles_only_its_due_alerts_and_clears_the_older_promise(monkeypatch):
    database = SimpleNamespace(
        tickets=FakeCollection([
            {
                "id": "ticket-1",
                "tenant_id": "tenant-a",
                "client_id": "client-a",
                "next_checkpoint_at": "2026-11-15T11:00:00+00:00",
                "next_checkpoint_set_at": "2026-11-15T10:00:00+00:00",
                "next_checkpoint_set_by": "tech-1",
                "next_checkpoint_set_by_name": "Alex Tech",
            }
        ]),
        notifications=FakeCollection([
            {"id": "personal", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "shared", "user_id": "all", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "newer", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T13:00:00+00:00", "read": False},
            {"id": "other-client", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-b", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "other-ticket", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-2", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "foreign", "user_id": "tech-1", "tenant_id": "tenant-b", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
        ]),
    )
    monkeypatch.setattr(checkpoint_notifications, "db", database)
    ticket = database.tickets.rows[0]

    result = asyncio.run(checkpoint_notifications.acknowledge_client_visible_update(
        ticket,
        tenant_id="tenant-a",
        published_before="2026-11-15T12:00:00+00:00",
        actor={"id": "tech-1", "name": "Alex Tech"},
        comment_id="comment-1",
        clear_existing_promise=True,
    ))

    assert result == {
        "alerts_resolved": 2,
        "promise_cleared": True,
        "cleared_checkpoint_at": "2026-11-15T11:00:00+00:00",
    }
    rows = {row["id"]: row for row in database.notifications.rows}
    for resolved_id in ("personal", "shared"):
        assert rows[resolved_id]["read"] is True
        assert rows[resolved_id]["resolved_at"]
        assert rows[resolved_id]["resolution"] == "client_update_published"
        assert rows[resolved_id]["resolved_by"] == "tech-1"
        assert rows[resolved_id]["resolved_comment_id"] == "comment-1"
    for untouched_id in ("newer", "other-client", "other-ticket", "foreign"):
        assert "resolved_at" not in rows[untouched_id]
    assert "next_checkpoint_at" not in ticket
    assert "next_checkpoint_set_at" not in ticket
    assert "next_checkpoint_set_by" not in ticket
    assert "next_checkpoint_set_by_name" not in ticket

    second = asyncio.run(checkpoint_notifications.acknowledge_client_visible_update(
        ticket,
        tenant_id="tenant-a",
        published_before="2026-11-15T12:00:00+00:00",
        actor={"id": "tech-1", "name": "Alex Tech"},
        comment_id="comment-1",
        clear_existing_promise=True,
    ))
    assert second["alerts_resolved"] == 0
    assert second["promise_cleared"] is False


def test_client_update_can_resolve_an_old_alert_while_keeping_a_new_promise(monkeypatch):
    database = SimpleNamespace(
        tickets=FakeCollection([{
            "id": "ticket-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "next_checkpoint_at": "2026-11-15T11:00:00+00:00",
            "next_checkpoint_set_at": "2026-11-15T10:00:00+00:00",
        }]),
        notifications=FakeCollection([{
            "id": "due-alert",
            "user_id": "tech-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "type": "ticket_checkpoint_due",
            "ref_id": "ticket-1",
            "checkpoint_at": "2026-11-15T11:00:00+00:00",
            "read": False,
        }]),
    )
    monkeypatch.setattr(checkpoint_notifications, "db", database)

    result = asyncio.run(checkpoint_notifications.acknowledge_client_visible_update(
        database.tickets.rows[0],
        tenant_id="tenant-a",
        published_before="2026-11-15T12:00:00+00:00",
        actor={"id": "tech-1", "name": "Alex Tech"},
        comment_id="comment-1",
        clear_existing_promise=False,
    ))

    assert result["alerts_resolved"] == 1
    assert result["promise_cleared"] is False
    assert database.tickets.rows[0]["next_checkpoint_at"] == "2026-11-15T11:00:00+00:00"
    assert database.notifications.rows[0]["resolved_at"]


def test_client_update_does_not_clear_a_newer_promise(monkeypatch):
    database = SimpleNamespace(
        tickets=FakeCollection([{
            "id": "ticket-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "next_checkpoint_at": "2026-11-15T15:00:00+00:00",
            "next_checkpoint_set_at": "2026-11-15T12:30:00+00:00",
            "next_checkpoint_set_by": "tech-2",
            "next_checkpoint_set_by_name": "Blake Tech",
        }]),
        notifications=FakeCollection(),
    )
    monkeypatch.setattr(checkpoint_notifications, "db", database)

    result = asyncio.run(checkpoint_notifications.acknowledge_client_visible_update(
        database.tickets.rows[0],
        tenant_id="tenant-a",
        published_before="2026-11-15T12:00:00+00:00",
        actor={"id": "tech-1", "name": "Alex Tech"},
        comment_id="comment-1",
        clear_existing_promise=True,
    ))

    assert result["promise_cleared"] is False
    assert database.tickets.rows[0]["next_checkpoint_at"] == "2026-11-15T15:00:00+00:00"


def test_explicit_foreign_tenant_notifications_are_not_visible(monkeypatch):
    database = SimpleNamespace(
        user_settings=FakeCollection(),
        notifications=FakeCollection([
            {"id": "shared-a", "user_id": "all", "tenant_id": "tenant-a", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:00:00+00:00"},
            {"id": "shared-b", "user_id": "all", "tenant_id": "tenant-b", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:01:00+00:00"},
            {"id": "legacy", "user_id": "all", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:02:00+00:00"},
            {"id": "personal-a", "user_id": "tech-1", "tenant_id": "tenant-a", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:03:00+00:00"},
            {"id": "personal-b", "user_id": "tech-1", "tenant_id": "tenant-b", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:04:00+00:00"},
        ]),
    )
    monkeypatch.setattr(clients, "db", database)

    visible = asyncio.run(clients._visible_notifications({"id": "tech-1", "tenant_id": "tenant-a"}))

    assert {row["id"] for row in visible} == {"shared-a", "legacy", "personal-a"}


def test_resolved_due_alerts_are_not_outstanding_unread_items(monkeypatch):
    database = SimpleNamespace(
        user_settings=FakeCollection(),
        notifications=FakeCollection([
            {
                "id": "resolved-personal",
                "user_id": "tech-1",
                "tenant_id": "tenant-a",
                "type": "ticket_checkpoint_due",
                "read": True,
                "resolved_at": "2026-11-15T12:05:00+00:00",
                "created_at": "2026-11-15T12:00:00+00:00",
            },
            {
                "id": "resolved-shared",
                "user_id": "all",
                "tenant_id": "tenant-a",
                "type": "ticket_checkpoint_due",
                "read": False,
                "read_by": [],
                "resolved_at": "2026-11-15T12:06:00+00:00",
                "created_at": "2026-11-15T12:01:00+00:00",
            },
            {
                "id": "new-alert",
                "user_id": "tech-1",
                "tenant_id": "tenant-a",
                "type": "ticket_checkpoint_due",
                "read": False,
                "created_at": "2026-11-15T12:07:00+00:00",
            },
        ]),
    )
    monkeypatch.setattr(clients, "db", database)
    user = {"id": "tech-1", "tenant_id": "tenant-a", "client_scope_mode": "all"}

    unread = asyncio.run(clients._visible_notifications(user, unread_only=True))
    all_visible = asyncio.run(clients._visible_notifications(user))

    assert {row["id"] for row in unread} == {"new-alert"}
    assert {row["id"] for row in all_visible} == {"resolved-personal", "resolved-shared", "new-alert"}
    assert all(row["read"] for row in all_visible if row["id"] != "new-alert")


def test_dismissing_a_due_promise_alert_does_not_let_it_reappear(monkeypatch):
    database = SimpleNamespace(
        user_settings=FakeCollection(),
        notifications=FakeCollection([
            {
                "id": "due-1",
                "user_id": "tech-1",
                "tenant_id": "nexus-local",
                "type": "ticket_checkpoint_due",
                "read": False,
                "created_at": "2026-11-15T12:00:00+00:00",
            },
        ]),
    )
    monkeypatch.setattr(clients, "db", database)

    asyncio.run(clients.delete_notifications({"ids": ["due-1"]}, {"id": "tech-1"}))

    stored = database.notifications.rows[0]
    assert stored["read"] is True
    assert stored["dismissed_by"] == ["tech-1"]
    assert asyncio.run(clients._visible_notifications({"id": "tech-1"})) == []


def test_reassignment_can_alert_the_new_recipient_for_the_same_promise(monkeypatch):
    now = datetime.now(timezone.utc)
    database = SimpleNamespace(
        tickets=FakeCollection([_ticket("ticket-1", due=now - timedelta(minutes=5), assigned_to="tech-1")]),
        notifications=FakeCollection(),
    )
    monkeypatch.setattr(checkpoint_notifications, "db", database)

    assert asyncio.run(checkpoint_notifications.notify_due_ticket_checkpoints()) == {"checked": 1, "created": 1}
    database.tickets.rows[0]["assigned_to"] = "tech-2"
    assert asyncio.run(checkpoint_notifications.notify_due_ticket_checkpoints()) == {"checked": 1, "created": 1}

    assert {row["user_id"] for row in database.notifications.rows} == {"tech-1", "tech-2"}
    assert len({row["dedupe_key"] for row in database.notifications.rows}) == 2


def test_restricted_technicians_only_see_notifications_for_their_client_and_site(monkeypatch):
    database = SimpleNamespace(
        user_settings=FakeCollection(),
        notifications=FakeCollection([
            {"id": "in-scope", "user_id": "all", "tenant_id": "tenant-a", "client_id": "client-a", "site_id": "site-a", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:00:00+00:00"},
            {"id": "other-client", "user_id": "all", "tenant_id": "tenant-a", "client_id": "client-b", "site_id": "site-a", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:01:00+00:00"},
            {"id": "other-site", "user_id": "all", "tenant_id": "tenant-a", "client_id": "client-a", "site_id": "site-b", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:02:00+00:00"},
            {"id": "legacy", "user_id": "all", "tenant_id": "tenant-a", "type": "ticket_checkpoint_due", "read": False, "created_at": "2026-11-15T12:03:00+00:00"},
        ]),
    )
    monkeypatch.setattr(clients, "db", database)
    user = {
        "id": "tech-1",
        "tenant_id": "tenant-a",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
        "site_scope_ids": ["site-a"],
    }

    visible = asyncio.run(clients._visible_notifications(user))

    assert {row["id"] for row in visible} == {"in-scope", "legacy"}


def test_due_promise_notification_preference_is_enabled_and_configurable():
    assert clients.NOTIFICATION_PREFERENCE_KEYS["ticket_checkpoint_due"] == "inapp_ticket_checkpoint_due"
    assert clients.NOTIFICATION_PREFERENCE_DEFAULTS["inapp_ticket_checkpoint_due"] is True


def test_the_durable_worker_registers_due_promise_notifications():
    import server

    loops = dict(server.background_worker_specs())
    assert callable(loops.get("ticket-checkpoints"))



def test_ticket_closure_resolves_outstanding_alerts_and_clears_the_promise():
    database = _NoTruthDatabase(
        tickets=FakeCollection([
            {
                "id": "ticket-1",
                "tenant_id": "tenant-a",
                "client_id": "client-a",
                "status": "closed",
                "next_checkpoint_at": "2026-11-15T11:00:00+00:00",
                "next_checkpoint_set_at": "2026-11-15T10:00:00+00:00",
                "next_checkpoint_set_by": "tech-1",
                "next_checkpoint_set_by_name": "Alex Tech",
            },
            {
                "id": "ticket-2",
                "tenant_id": "tenant-a",
                "client_id": "client-a",
                "status": "open",
                "next_checkpoint_at": "2026-11-15T11:00:00+00:00",
            },
        ]),
        notifications=FakeCollection([
            {"id": "personal", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "shared", "user_id": "all", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "other-client", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-b", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "other-ticket", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-2", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "foreign", "user_id": "tech-1", "tenant_id": "tenant-b", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "checkpoint_at": "2026-11-15T11:00:00+00:00", "read": False},
            {"id": "already-resolved", "user_id": "tech-1", "tenant_id": "tenant-a", "client_id": "client-a", "type": "ticket_checkpoint_due", "ref_id": "ticket-1", "resolved_at": "2026-11-15T10:30:00+00:00", "read": True},
        ]),
    )

    result = asyncio.run(checkpoint_notifications.settle_closed_ticket_checkpoint(
        database.tickets.rows[0],
        tenant_id="tenant-a",
        actor={"id": "tech-1", "name": "Alex Tech"},
        database=database,
    ))

    assert result == {
        "alerts_resolved": 2,
        "promise_cleared": True,
        "cleared_checkpoint_at": "2026-11-15T11:00:00+00:00",
        "resolution": "ticket_closed",
    }
    rows = {row["id"]: row for row in database.notifications.rows}
    for resolved_id in ("personal", "shared"):
        assert rows[resolved_id]["read"] is True
        assert rows[resolved_id]["resolved_at"]
        assert rows[resolved_id]["resolution"] == "ticket_closed"
        assert rows[resolved_id]["resolved_by"] == "tech-1"
        assert rows[resolved_id]["read_by"] == ["tech-1"]
    for untouched_id in ("other-client", "other-ticket", "foreign", "already-resolved"):
        assert rows[untouched_id].get("resolution") != "ticket_closed"
    ticket = database.tickets.rows[0]
    assert "next_checkpoint_at" not in ticket
    assert "next_checkpoint_set_at" not in ticket
    assert "next_checkpoint_set_by" not in ticket
    assert "next_checkpoint_set_by_name" not in ticket
    assert database.tickets.rows[1]["next_checkpoint_at"] == "2026-11-15T11:00:00+00:00"

    second = asyncio.run(checkpoint_notifications.settle_closed_ticket_checkpoint(
        {**ticket, "status": "closed"},
        tenant_id="tenant-a",
        actor={"id": "tech-1", "name": "Alex Tech"},
        database=database,
    ))
    assert second["alerts_resolved"] == 0
    assert second["promise_cleared"] is False


def test_ticket_resolution_uses_resolution_specific_alert_evidence():
    database = SimpleNamespace(
        tickets=FakeCollection([{
            "id": "ticket-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "status": "resolved",
            "next_checkpoint_at": "2026-11-15T11:00:00+00:00",
        }]),
        notifications=FakeCollection([{
            "id": "due",
            "user_id": "tech-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "type": "ticket_checkpoint_due",
            "ref_id": "ticket-1",
            "read": False,
        }]),
    )

    result = asyncio.run(checkpoint_notifications.settle_closed_ticket_checkpoint(
        database.tickets.rows[0],
        tenant_id="tenant-a",
        actor={"id": "tech-1", "name": "Alex Tech"},
        database=database,
    ))

    assert result["resolution"] == "ticket_resolved"
    assert database.notifications.rows[0]["resolution"] == "ticket_resolved"
    assert "next_checkpoint_at" not in database.tickets.rows[0]


def test_an_open_ticket_does_not_consume_its_due_promise():
    database = SimpleNamespace(
        tickets=FakeCollection([{
            "id": "ticket-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "status": "open",
            "next_checkpoint_at": "2026-11-15T11:00:00+00:00",
        }]),
        notifications=FakeCollection([{
            "id": "due",
            "user_id": "tech-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "type": "ticket_checkpoint_due",
            "ref_id": "ticket-1",
            "read": False,
        }]),
    )

    result = asyncio.run(checkpoint_notifications.settle_closed_ticket_checkpoint(
        database.tickets.rows[0],
        tenant_id="tenant-a",
        actor={"id": "tech-1", "name": "Alex Tech"},
        database=database,
    ))

    assert result == {
        "alerts_resolved": 0,
        "promise_cleared": False,
        "cleared_checkpoint_at": None,
        "resolution": None,
    }
    assert database.tickets.rows[0]["next_checkpoint_at"] == "2026-11-15T11:00:00+00:00"
    assert "resolved_at" not in database.notifications.rows[0]


def test_ticket_update_helper_records_closure_settlement_audit(monkeypatch):
    from app.routers import tickets

    database = SimpleNamespace(
        tickets=FakeCollection([{
            "id": "ticket-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "status": "closed",
            "next_checkpoint_at": "2026-11-15T11:00:00+00:00",
        }]),
        notifications=FakeCollection([{
            "id": "due",
            "user_id": "tech-1",
            "tenant_id": "tenant-a",
            "client_id": "client-a",
            "type": "ticket_checkpoint_due",
            "ref_id": "ticket-1",
            "read": False,
        }]),
        ticket_audit_log=FakeCollection(),
    )
    monkeypatch.setattr(tickets, "db", database)

    asyncio.run(tickets._settle_closed_checkpoint(
        database.tickets.rows[0],
        {"id": "tech-1", "name": "Alex Tech", "tenant_id": "tenant-a"},
    ))

    audit = database.ticket_audit_log.rows[-1]
    assert audit["action"] == "next_checkpoint_closed"
    assert "cleared the promised update" in audit["details"]
    assert audit["metadata"]["alerts_resolved"] == 1
    assert audit["metadata"]["resolution"] == "ticket_closed"
