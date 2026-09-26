"""Regression coverage for the canonical ticket-time compatibility boundary."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

from app.routers import tickets, time_entries, voice_journal, work_sessions
from app.services import ticket_time
from app.services.ticket_time import (
    create_canonical_ticket_time_entry,
    list_ticket_time_history,
    list_technician_time_history,
    sync_ticket_time_cache,
)
from app.models import TimeEntryCreate
from fastapi import HTTPException


def _matches(row: dict, query: dict) -> bool:
    for key, value in query.items():
        if key == "$and":
            if not all(_matches(row, clause) for clause in value):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, clause) for clause in value):
                return False
            continue
        actual = row.get(key)
        if isinstance(value, dict):
            if "$in" in value and actual not in value["$in"]:
                return False
            if "$ne" in value and actual == value["$ne"]:
                return False
            if "$gte" in value and (actual is None or actual < value["$gte"]):
                return False
            if "$exists" in value and (key in row) != bool(value["$exists"]):
                return False
            continue
        if actual != value:
            return False
    return True


class FakeCursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    def sort(self, _field, _direction):
        return self

    async def to_list(self, _limit):
        return deepcopy(self.rows)


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(deepcopy(rows or []))
        self.indexes = []

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, _projection=None):
        return FakeCursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def create_index(self, keys, **kwargs):
        self.indexes.append({"keys": keys, **kwargs})
        return kwargs.get("name")

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class FakeDb(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=FakeCollection(
                [
                    {
                        "id": "ticket-1",
                        "tenant_id": "tenant-a",
                        "title": "Restore workstation access",
                        "client_id": "client-1",
                        "client_name": "Northwind Dental",
                    }
                ]
            ),
            users=FakeCollection([{"id": "tech-1", "tenant_id": "tenant-a", "name": "Alex Tech", "hourly_rate": 120.0}]),
            time_entries=FakeCollection(),
            ticket_time_entries=FakeCollection(),
            ticket_audit_log=FakeCollection(),
            nexus_work_sessions=FakeCollection(),
            devices=FakeCollection(),
            activity_logs=FakeCollection(),
            contracts=FakeCollection(),
        )


def test_ticket_history_keeps_legacy_rows_visible_but_total_is_canonical_only():
    asyncio.run(_test_ticket_history_keeps_legacy_rows_visible_but_total_is_canonical_only())


async def _test_ticket_history_keeps_legacy_rows_visible_but_total_is_canonical_only():
    db = FakeDb()
    db.time_entries.rows.append(
        {
            "id": "time-authoritative",
            "ticket_id": "ticket-1",
            "minutes": 35,
            "source": "nexus_remote",
            "source_reference": "remote-1",
            "created_at": "2026-08-22T10:00:00+00:00",
        }
    )
    db.ticket_time_entries.rows.append(
        {
            "id": "legacy-time-1",
            "ticket_id": "ticket-1",
            "minutes": 45,
            "created_at": "2026-08-21T10:00:00+00:00",
        }
    )

    history = await list_ticket_time_history("ticket-1", database=db)
    total = await sync_ticket_time_cache("ticket-1", database=db)

    assert [entry["id"] for entry in history] == ["time-authoritative", "legacy-time-1"]
    assert history[0]["authoritative"] is True
    assert history[0]["billing_eligible"] is True
    assert history[1]["authoritative"] is False
    assert history[1]["billing_eligible"] is False
    assert history[1]["legacy_read_only"] is True
    assert total == 35
    assert db.tickets.rows[0]["total_time_minutes"] == 35
    assert db.tickets.rows[0]["total_time_source"] == "time_entries"


def test_ticket_workspace_writes_canonical_time_idempotently(monkeypatch):
    asyncio.run(_test_ticket_workspace_writes_canonical_time_idempotently(monkeypatch))


async def _test_ticket_workspace_writes_canonical_time_idempotently(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(tickets, "db", db)
    async def _ticket_in_scope(ticket_id, _user, _operation):
        return await db.tickets.find_one({"id": ticket_id})
    async def _no_ticket_audit(*_args, **_kwargs):
        await db.ticket_audit_log.insert_one({"id": "audit-1"})
    monkeypatch.setattr(tickets, "_ticket_in_scope", _ticket_in_scope)
    monkeypatch.setattr(tickets, "ticket_audit", _no_ticket_audit)

    user = {"id": "tech-1", "name": "Alex Tech", "role": "technician"}
    payload = {
        "minutes": 30,
        "description": "Diagnosed and restored access",
        "billable": True,
        "idempotency_key": "ticket-1:manual:request-1",
    }
    first = await tickets.add_ticket_time_entry("ticket-1", payload, current_user=user)
    second = await tickets.add_ticket_time_entry("ticket-1", payload, current_user=user)

    assert len(db.time_entries.rows) == 1
    assert db.ticket_time_entries.rows == []
    assert first["source"] == "ticket_workspace"
    assert first["source_reference"] == first["id"]
    assert first["idempotency_key"] == payload["idempotency_key"]
    assert first["idempotent_replay"] is False
    assert second["id"] == first["id"]
    assert second["idempotent_replay"] is True
    assert db.tickets.rows[0]["total_time_minutes"] == 30
    assert len(db.ticket_audit_log.rows) == 1
    assert {index["name"] for index in db.time_entries.indexes} == {
        "ticket_time_idempotency",
        "canonical_time_entry_id_unique",
        "ticket_time_history",
    }


def test_work_session_completion_reuses_its_canonical_entry_on_retry(monkeypatch):
    asyncio.run(_test_work_session_completion_reuses_its_canonical_entry_on_retry(monkeypatch))


async def _test_work_session_completion_reuses_its_canonical_entry_on_retry(monkeypatch):
    db = FakeDb()
    db.nexus_work_sessions.rows.append(
        {"id": "work-1", "ticket_id": "ticket-1", "status": "active"}
    )
    monkeypatch.setattr(work_sessions, "db", db)
    async def _ticket_for(ticket_id, _user, _operation):
        return await db.tickets.find_one({"id": ticket_id})
    async def _no_activity(*_args, **_kwargs):
        return None
    monkeypatch.setattr(work_sessions, "ticket_for", _ticket_for)
    monkeypatch.setattr(work_sessions, "log_activity", _no_activity)

    user = {"id": "tech-1", "name": "Alex Tech", "role": "technician"}
    payload = {
        "minutes": 18,
        "technical_notes": "Repaired the Outlook profile and verified launch.",
        "customer_summary": "Outlook is opening normally again.",
        "billing_classification": "billable",
        "verified": True,
    }
    first = await work_sessions.complete_work_session("work-1", payload, current_user=user)
    replay = await work_sessions.complete_work_session("work-1", payload, current_user=user)

    assert len(db.time_entries.rows) == 1
    entry = db.time_entries.rows[0]
    assert entry["source"] == "nexus_work_session"
    assert entry["source_reference"] == "work-1"
    assert entry["idempotency_key"] == "nexus_work_session:work-1"
    assert first["idempotent_replay"] is False
    assert first["work_session_id"] == "work-1"
    assert replay["idempotent_replay"] is True
    assert replay["work_session_id"] == "work-1"
    assert replay["time_entry"]["id"] == entry["id"]
    assert db.tickets.rows[0]["total_time_minutes"] == 18


def test_work_session_brief_does_not_disclose_a_cross_client_linked_device(monkeypatch):
    asyncio.run(_test_work_session_brief_does_not_disclose_a_cross_client_linked_device(monkeypatch))


async def _test_work_session_brief_does_not_disclose_a_cross_client_linked_device(monkeypatch):
    db = FakeDb()
    db.tickets.rows[0]["device_id"] = "device-foreign"
    db.devices.rows.append(
        {
            "id": "device-foreign",
            "client_id": "client-2",
            "hostname": "restricted-client-device",
        }
    )
    monkeypatch.setattr(work_sessions, "db", db)

    async def _ticket_for(ticket_id, _user, _operation):
        return await db.tickets.find_one({"id": ticket_id})

    monkeypatch.setattr(work_sessions, "ticket_for", _ticket_for)

    result = await work_sessions.work_session_brief(
        "ticket-1", {"id": "tech-1", "name": "Alex Tech", "role": "technician"}
    )

    assert result["device"] is None


def test_work_session_completion_assist_uses_only_scoped_retained_evidence(monkeypatch):
    asyncio.run(_test_work_session_completion_assist_uses_only_scoped_retained_evidence(monkeypatch))


async def _test_work_session_completion_assist_uses_only_scoped_retained_evidence(monkeypatch):
    db = FakeDb()
    db.tickets.rows[0].update(
        {
            "ticket_number": "SR-101",
            "description": "Outlook is not opening for the user.",
            "device_id": "device-1",
        }
    )
    db.devices.rows.append({"id": "device-1", "client_id": "client-1", "name": "NW-WS-01"})
    db.activity_logs.rows.append(
        {
            "id": "activity-1",
            "client_id": "client-1",
            "entity_type": "device",
            "action": "diagnostic_completed",
            "details": "Diagnostic evidence recorded for Outlook launch.",
            "created_at": "2026-08-29T09:00:00+00:00",
        }
    )
    db.remote_sessions = FakeCollection(
        [
            {
                "id": "remote-authorised",
                "ticket_id": "ticket-1",
                "client_id": "client-1",
                "provider": "rustdesk",
                "status": "connected",
                "started_at": "2026-08-29T09:03:00+00:00",
            },
            {
                "id": "remote-foreign",
                "ticket_id": "ticket-1",
                "client_id": "client-2",
                "provider": "restricted-provider",
                "status": "connected",
                "started_at": "2026-08-29T09:04:00+00:00",
            },
        ]
    )
    monkeypatch.setattr(work_sessions, "db", db)

    async def _ticket_for(ticket_id, _user, _operation):
        return await db.tickets.find_one({"id": ticket_id})

    monkeypatch.setattr(work_sessions, "ticket_for", _ticket_for)

    result = await work_sessions.work_session_brief(
        "ticket-1", {"id": "tech-1", "name": "Alex Tech", "role": "technician"}
    )

    assist = result["completion_assist"]
    assert assist["status"] == "review_required"
    assert "[Technician to confirm]" in assist["drafts"]["technical_notes"]
    assert "Outlook is not opening" in assist["drafts"]["technical_notes"]
    evidence = " ".join(item["detail"] for item in assist["evidence"])
    assert "rustdesk" in evidence
    assert "restricted-provider" not in evidence


def test_completed_work_session_never_replays_cross_client_time_entry(monkeypatch):
    asyncio.run(_test_completed_work_session_never_replays_cross_client_time_entry(monkeypatch))


async def _test_completed_work_session_never_replays_cross_client_time_entry(monkeypatch):
    db = FakeDb()
    db.nexus_work_sessions.rows.append(
        {
            "id": "work-cross-client",
            "ticket_id": "ticket-1",
            "status": "completed",
            "time_entry_id": "time-entry-foreign",
        }
    )
    db.time_entries.rows.append(
        {
            "id": "time-entry-foreign",
            "ticket_id": "ticket-client-2",
            "client_id": "client-2",
            "description": "Restricted financial work record",
        }
    )
    monkeypatch.setattr(work_sessions, "db", db)

    async def _ticket_for(ticket_id, _user, _operation):
        return await db.tickets.find_one({"id": ticket_id})

    monkeypatch.setattr(work_sessions, "ticket_for", _ticket_for)

    try:
        await work_sessions.complete_work_session(
            "work-cross-client",
            {},
            current_user={"id": "tech-1", "name": "Alex Tech", "role": "technician"},
        )
    except HTTPException as exc:
        assert exc.status_code == 409
    else:
        raise AssertionError("Cross-client time records must not be returned by a work-session replay")


def test_voice_journal_history_respects_the_technicians_client_scope(monkeypatch):
    asyncio.run(_test_voice_journal_history_respects_the_technicians_client_scope(monkeypatch))


async def _test_voice_journal_history_respects_the_technicians_client_scope(monkeypatch):
    db = FakeDb()
    db.time_entries.rows.extend(
        [
            {
                "id": "voice-client-1",
                "ticket_id": "ticket-1",
                "client_id": "client-1",
                "user_id": "tech-1",
                "source": "voice_journal",
            },
            {
                "id": "voice-client-2",
                "ticket_id": "ticket-client-2",
                "client_id": "client-2",
                "user_id": "tech-1",
                "source": "voice_journal",
            },
        ]
    )
    monkeypatch.setattr(voice_journal, "db", db)

    history = await voice_journal.voice_journal_history(
        current_user={
            "id": "tech-1",
            "name": "Alex Tech",
            "role": "technician",
            "client_scope_mode": "restricted",
            "client_scope_ids": ["client-1"],
        }
    )

    assert [entry["id"] for entry in history] == ["voice-client-1"]


def test_work_session_scope_guardian_prevents_included_time_becoming_billable(monkeypatch):
    asyncio.run(_test_work_session_scope_guardian_prevents_included_time_becoming_billable(monkeypatch))


async def _test_work_session_scope_guardian_prevents_included_time_becoming_billable(monkeypatch):
    db = FakeDb()
    db.nexus_work_sessions.rows.append(
        {"id": "work-included", "ticket_id": "ticket-1", "status": "active"}
    )
    monkeypatch.setattr(work_sessions, "db", db)
    async def _ticket_for(ticket_id, _user, _operation):
        return await db.tickets.find_one({"id": ticket_id})
    monkeypatch.setattr(work_sessions, "ticket_for", _ticket_for)
    monkeypatch.setattr(work_sessions, "log_activity", lambda *_args, **_kwargs: asyncio.sleep(0))

    await work_sessions.complete_work_session(
        "work-included",
        {
            "minutes": 12,
            "technical_notes": "Completed the included service request.",
            "customer_summary": "The requested service has been completed.",
            "billing_classification": "included",
            # A forged browser value cannot override the classification.
            "billable": True,
        },
        current_user={"id": "tech-1", "name": "Alex Tech", "role": "technician"},
    )

    assert db.time_entries.rows[0]["billable"] is False
    assert db.time_entries.rows[0]["total_amount"] == 0.0


def test_work_session_completion_claim_blocks_concurrent_writer(monkeypatch):
    asyncio.run(_test_work_session_completion_claim_blocks_concurrent_writer(monkeypatch))


async def _test_work_session_completion_claim_blocks_concurrent_writer(monkeypatch):
    db = FakeDb()
    db.nexus_work_sessions.rows.append(
        {"id": "work-claim", "ticket_id": "ticket-1", "status": "completing", "completion_claim_id": "other"}
    )
    monkeypatch.setattr(work_sessions, "db", db)
    async def _ticket_for(ticket_id, _user, _operation):
        return await db.tickets.find_one({"id": ticket_id})
    monkeypatch.setattr(work_sessions, "ticket_for", _ticket_for)

    try:
        await work_sessions.complete_work_session(
            "work-claim",
            {
                "minutes": 10,
                "technical_notes": "Attempted concurrent completion.",
                "customer_summary": "Attempted concurrent completion.",
                "billing_classification": "billable",
            },
            current_user={"id": "tech-1", "name": "Alex Tech", "role": "technician"},
        )
    except HTTPException as exc:
        assert exc.status_code == 409
    else:
        raise AssertionError("A claimed completion must not overwrite the other technician's outcome")
    assert db.time_entries.rows == []


def test_time_entry_edits_and_deletes_recalculate_from_canonical_rows(monkeypatch):
    asyncio.run(_test_time_entry_edits_and_deletes_recalculate_from_canonical_rows(monkeypatch))


async def _test_time_entry_edits_and_deletes_recalculate_from_canonical_rows(monkeypatch):
    db = FakeDb()
    db.time_entries.rows.extend(
        [
            {
                "id": "time-1",
                "tenant_id": "tenant-a",
                "ticket_id": "ticket-1",
                "client_id": "client-1",
                "minutes": 10,
                "hourly_rate": 120,
                "billable": True,
                "invoiced": False,
            },
            {
                "id": "time-2",
                "tenant_id": "tenant-a",
                "ticket_id": "ticket-1",
                "client_id": "client-1",
                "minutes": 20,
                "hourly_rate": 120,
                "billable": True,
                "invoiced": False,
            },
        ]
    )
    monkeypatch.setattr(time_entries, "db", db)
    async def _ticket_audit(ticket_id, user, action, details=""):
        await db.ticket_audit_log.insert_one({
            "ticket_id": ticket_id,
            "user_id": user.get("id"),
            "action": action,
            "details": details,
        })
    monkeypatch.setattr(time_entries, "ticket_audit", _ticket_audit)
    async def _entry_or_404(entry_id, _user):
        return await db.time_entries.find_one({"id": entry_id})
    monkeypatch.setattr(time_entries, "_time_entry_or_404", _entry_or_404)

    user = {"id": "tech-1", "tenant_id": "tenant-a", "name": "Alex Tech", "role": "technician"}
    await time_entries.update_time_entry("time-1", {"minutes": 15}, current_user=user)
    assert db.tickets.rows[0]["total_time_minutes"] == 35
    await time_entries.delete_time_entry("time-2", current_user=user)
    assert db.tickets.rows[0]["total_time_minutes"] == 15
    assert db.tickets.rows[0]["total_time_source"] == "time_entries"


def test_manual_time_api_accepts_an_idempotency_key(monkeypatch):
    asyncio.run(_test_manual_time_api_accepts_an_idempotency_key(monkeypatch))


async def _test_manual_time_api_accepts_an_idempotency_key(monkeypatch):
    db = FakeDb()
    ticket_time._indexed_database_ids.clear()
    monkeypatch.setattr(time_entries, "db", db)
    async def _allow_scope(*_args, **_kwargs):
        return {"mode": "all"}
    monkeypatch.setattr(time_entries, "assert_client_scope", _allow_scope)

    request = TimeEntryCreate(
        ticket_id="ticket-1",
        # This is intentionally a different user.  API attribution must come
        # from the authenticated identity, never a browser form field.
        user_id="foreign-user",
        description="Manual administrative follow-up",
        minutes=12,
        billable=True,
        idempotency_key="time-api:ticket-1:request-1",
    )
    user = {"id": "tech-1", "tenant_id": "tenant-a", "name": "Alex Tech", "role": "technician"}
    first = await time_entries.create_time_entry(request, current_user=user)
    second = await time_entries.create_time_entry(request, current_user=user)

    assert len(db.time_entries.rows) == 1
    assert first.id == second.id
    assert db.time_entries.rows[0]["user_id"] == "tech-1"
    assert db.time_entries.rows[0]["hourly_rate"] == 120.0
    assert db.time_entries.rows[0]["source"] == "manual_time_entry"
    assert db.time_entries.rows[0]["idempotency_key"] == request.idempotency_key
    assert {index["name"] for index in db.time_entries.indexes} == {
        "ticket_time_idempotency",
        "canonical_time_entry_id_unique",
        "ticket_time_history",
    }


def test_bulk_time_ignores_browser_owned_identity_rate_and_id(monkeypatch):
    asyncio.run(_test_bulk_time_ignores_browser_owned_identity_rate_and_id(monkeypatch))


async def _test_bulk_time_ignores_browser_owned_identity_rate_and_id(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(time_entries, "db", db)
    async def _allow_scope(*_args, **_kwargs):
        return {"mode": "all"}
    monkeypatch.setattr(time_entries, "assert_client_scope", _allow_scope)

    result = await time_entries.bulk_create_time_entries(
        {
            "entries": [
                {
                    "ticket_id": "ticket-1",
                    "minutes": 15,
                    "description": "Checked the reported access issue",
                    "billable": "false",
                    "user_id": "forged-user",
                    "user_name": "Forged Name",
                    "hourly_rate": -999,
                    "id": "forged-time-entry-id",
                }
            ]
        },
        current_user={"id": "tech-1", "name": "Alex Tech", "role": "technician"},
    )

    assert result["created"] == 1
    entry = db.time_entries.rows[0]
    assert entry["id"] != "forged-time-entry-id"
    assert entry["user_id"] == "tech-1"
    assert entry["user_name"] == "Alex Tech"
    assert entry["hourly_rate"] == 120.0
    assert entry["billable"] is False
    assert entry["total_amount"] == 0.0


def test_canonical_time_rejects_invalid_financial_rate():
    asyncio.run(_test_canonical_time_rejects_invalid_financial_rate())


async def _test_canonical_time_rejects_invalid_financial_rate():
    db = FakeDb()
    try:
        await create_canonical_ticket_time_entry(
            ticket=db.tickets.rows[0],
            actor={"id": "tech-1", "name": "Alex Tech"},
            minutes=5,
            description="Invalid-rate regression test",
            billable=True,
            source="test",
            hourly_rate=float("nan"),
            database=db,
        )
    except HTTPException as exc:
        assert exc.status_code == 422
        assert "Hourly rate" in str(exc.detail)
    else:
        raise AssertionError("Non-finite rates must be rejected")


def test_technician_history_combines_new_canonical_and_legacy_without_double_counting():
    asyncio.run(_test_technician_history_combines_new_canonical_and_legacy_without_double_counting())


async def _test_technician_history_combines_new_canonical_and_legacy_without_double_counting():
    db = FakeDb()
    db.time_entries.rows.append(
        {
            "id": "canonical-time",
            "ticket_id": "ticket-1",
            "user_id": "tech-1",
            "minutes": 20,
            "created_at": "2026-08-22T10:00:00+00:00",
            "time_entry_schema": "ticket_time.v1",
        }
    )
    db.ticket_time_entries.rows.extend(
        [
            {
                "id": "legacy-visible",
                "ticket_id": "ticket-1",
                "user_id": "tech-1",
                "minutes": 10,
                "created_at": "2026-08-21T10:00:00+00:00",
            },
            {
                "id": "legacy-imported",
                "ticket_id": "ticket-1",
                "user_id": "tech-1",
                "minutes": 5,
                "created_at": "2026-08-20T10:00:00+00:00",
            },
        ]
    )
    db.time_entries.rows[0]["legacy_ticket_time_entry_id"] = "legacy-imported"

    history = await list_technician_time_history("tech-1", database=db)

    assert [entry["id"] for entry in history] == ["canonical-time", "legacy-visible"]
    assert sum(entry["minutes"] for entry in history) == 30
