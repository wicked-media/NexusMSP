import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import nexus_connect


def _matches(document, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(document, clause) for clause in expected):
                return False
            continue
        if key == "$and":
            if not all(_matches(document, clause) for clause in expected):
                return False
            continue
        actual = document.get(key)
        if isinstance(expected, dict):
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$exists" in expected and (key in document) != expected["$exists"]:
                return False
            continue
        if actual != expected:
            return False
    return True


class Result:
    def __init__(self, matched_count=0):
        self.matched_count = matched_count


class Collection:
    def __init__(self, rows=None):
        self.rows = [deepcopy(row) for row in (rows or [])]

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        row = next((row for row in self.rows if _matches(row, query)), None)
        if not row:
            return Result(0)
        row.update(deepcopy(update.get("$set") or {}))
        for field, value in (update.get("$addToSet") or {}).items():
            current = row.setdefault(field, [])
            values = value.get("$each", []) if isinstance(value, dict) and "$each" in value else [value]
            for item in values:
                if item not in current:
                    current.append(item)
        return Result(1)

    async def find_one_and_update(self, query, update, **_options):
        row = next((row for row in self.rows if _matches(row, query)), None)
        if not row:
            return None
        row.update(deepcopy(update.get("$set") or {}))
        return deepcopy(row)


class FakeDB:
    def __init__(self):
        self.tickets = Collection([{
            "id": "ticket-1",
            "ticket_number": "TKT-24891",
            "title": "Printer unavailable",
            "status": "in_progress",
            "priority": "high",
            "client_id": "client-1",
            "client_name": "ABC Plumbing",
            "assigned_to": "tech-aaron",
            "assigned_name": "Aaron",
            "watchers": [],
        }])
        self.users = Collection([{
            "id": "tech-emma",
            "name": "Emma",
            "email": "emma@example.com",
            "is_active": True,
            "archived": False,
        }])
        self.ticket_handoffs = Collection()
        self.chat_channels = Collection()
        self.chat_messages = Collection()
        self.notifications = Collection()
        self.presence_state = Collection([{"user_id": "tech-aaron", "busy_state": "ticket:TKT-24891"}])


def actor(user_id="tech-aaron", name="Aaron"):
    return {
        "id": user_id,
        "name": name,
        "email": f"{name.lower()}@example.com",
        "role": "technician",
        "client_scope_mode": "all",
    }


def request():
    return SimpleNamespace(headers={}, state=SimpleNamespace(correlation_id="connect-test"))


def install_fakes(monkeypatch):
    fake_db = FakeDB()

    async def noop(*_args, **_kwargs):
        return {}

    monkeypatch.setattr(nexus_connect, "db", fake_db)
    monkeypatch.setattr(nexus_connect, "assert_client_scope", noop)
    monkeypatch.setattr(nexus_connect, "ticket_audit", noop)
    monkeypatch.setattr(nexus_connect, "log_activity", noop)
    monkeypatch.setattr(nexus_connect, "emit_platform_event", noop)
    return fake_db


def create_pass(fake_db):
    return asyncio.run(nexus_connect.create_ticket_pass(
        nexus_connect.TicketPassCreate(
            ticket_ref="TKT-24891",
            to_user_id="tech-emma",
            mode="take_over",
            reason="Needs print-server experience",
            work_completed=["Restarted workstation", "Cleared print queue"],
            suggested_next_action="Check PRINT-SRV01 spooler",
        ),
        request(),
        actor(),
    ))


def test_ticket_pass_creates_private_object_room_and_action_card(monkeypatch):
    fake_db = install_fakes(monkeypatch)
    result = create_pass(fake_db)

    handoff = result["handoff"]
    assert handoff["status"] == "pending"
    assert handoff["transfers_ownership"] is True
    assert handoff["work_completed"] == ["Restarted workstation", "Cleared print queue"]
    assert fake_db.chat_channels.rows[0]["kind"] == "object"
    assert set(fake_db.chat_channels.rows[0]["member_ids"]) == {"tech-aaron", "tech-emma"}
    assert fake_db.chat_messages.rows[0]["action_card"] == {"kind": "ticket_pass", "id": handoff["id"]}
    assert fake_db.notifications.rows[0]["target_user_id"] == "tech-emma"


def test_accept_ticket_pass_changes_owner_and_stops_sender_focus(monkeypatch):
    fake_db = install_fakes(monkeypatch)
    created = create_pass(fake_db)
    handoff_id = created["handoff"]["id"]

    result = asyncio.run(nexus_connect.accept_ticket_pass(
        handoff_id,
        request(),
        actor("tech-emma", "Emma"),
    ))

    assert result["handoff"]["status"] == "accepted"
    assert fake_db.tickets.rows[0]["assigned_to"] == "tech-emma"
    assert fake_db.tickets.rows[0]["assigned_name"] == "Emma"
    assert fake_db.presence_state.rows[0]["busy_state"] is None
    assert fake_db.notifications.rows[-1]["target_user_id"] == "tech-aaron"


def test_ticket_pass_can_only_be_answered_once_by_recipient(monkeypatch):
    fake_db = install_fakes(monkeypatch)
    created = create_pass(fake_db)
    handoff_id = created["handoff"]["id"]

    with pytest.raises(HTTPException) as wrong_user:
        asyncio.run(nexus_connect.accept_ticket_pass(handoff_id, request(), actor("tech-josh", "Josh")))
    assert wrong_user.value.status_code == 409

    asyncio.run(nexus_connect.accept_ticket_pass(handoff_id, request(), actor("tech-emma", "Emma")))
    with pytest.raises(HTTPException) as duplicate:
        asyncio.run(nexus_connect.accept_ticket_pass(handoff_id, request(), actor("tech-emma", "Emma")))
    assert duplicate.value.status_code == 409


def test_decline_requires_reason_and_preserves_ticket_owner(monkeypatch):
    fake_db = install_fakes(monkeypatch)
    created = create_pass(fake_db)
    handoff_id = created["handoff"]["id"]

    with pytest.raises(HTTPException) as missing_reason:
        asyncio.run(nexus_connect.decline_ticket_pass(
            handoff_id,
            request(),
            nexus_connect.TicketPassDecision(reason=""),
            actor("tech-emma", "Emma"),
        ))
    assert missing_reason.value.status_code == 400

    result = asyncio.run(nexus_connect.decline_ticket_pass(
        handoff_id,
        request(),
        nexus_connect.TicketPassDecision(reason="Already handling a priority-one incident"),
        actor("tech-emma", "Emma"),
    ))
    assert result["handoff"]["status"] == "declined"
    assert fake_db.tickets.rows[0]["assigned_to"] == "tech-aaron"
