"""Acceptance boundaries for Work Session prevention follow-up proposals."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import prevention_followups


def _matches(row: dict, query: dict) -> bool:
    for key, expected in query.items():
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
        elif actual != expected:
            return False
    return True


class FakeCursor:
    def __init__(self, rows):
        self.rows = [deepcopy(row) for row in rows]

    def sort(self, field, direction):
        self.rows.sort(key=lambda row: str(row.get(field) or ""), reverse=direction < 0)
        return self

    async def to_list(self, _limit):
        return deepcopy(self.rows[:_limit])


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = [deepcopy(row) for row in (rows or [])]
        self.indexes = []

    async def create_index(self, *args, **kwargs):
        self.indexes.append((args, kwargs))

    async def find_one(self, query, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query, _projection=None):
        return FakeCursor(row for row in self.rows if _matches(row, query))

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class FakeDb(SimpleNamespace):
    def __init__(self, *, session_status="completed", ticket_client_id="client-a"):
        super().__init__(
            nexus_work_sessions=FakeCollection(
                [
                    {
                        "id": "work-session-a",
                        "ticket_id": "ticket-a",
                        "client_id": "client-a",
                        "device_id": "device-a",
                        "status": session_status,
                        "outcome": {
                            "recurrence_check": "23 endpoints show the same Outlook profile failure.",
                            "verified": True,
                        },
                    }
                ]
            ),
            tickets=FakeCollection(
                [
                    {
                        "id": "ticket-a",
                        "ticket_number": "48291",
                        "title": "Outlook cannot open",
                        "client_id": ticket_client_id,
                        "site_id": "site-a",
                    }
                ]
            ),
            devices=FakeCollection(
                [
                    {"id": "device-a", "client_id": "client-a", "site_id": "site-a", "name": "Sarah-Laptop"},
                    {"id": "device-b", "client_id": "client-a", "site_id": "site-a", "name": "Finance-Laptop"},
                    {"id": "device-other-site", "client_id": "client-a", "site_id": "site-b", "name": "Other-Site-PC"},
                    {"id": "device-other-client", "client_id": "client-b", "site_id": "site-b", "name": "Other-Tenant-PC"},
                ]
            ),
            nexus_prevention_followups=FakeCollection(),
            ticket_audit_log=FakeCollection(),
            activity_logs=FakeCollection(),
        )


async def _scope_allows(_user, client_id, *, site_id=None, operation=None, **_kwargs):
    assert client_id == "client-a"
    assert site_id == "site-a"
    assert operation
    return {"mode": "all"}


def _actor():
    return {"id": "tech-a", "name": "Aaron Tech", "role": "technician"}


def _payload(**overrides):
    return {
        "title": "Prevent repeated Outlook profile failures",
        "summary": "Review affected endpoints and decide whether a governed repair campaign is justified.",
        "candidate_device_ids": ["device-b"],
        "idempotency_key": "work-session-a-prevention-1",
        **overrides,
    }


def _install(monkeypatch, database: FakeDb, activity_events: list[dict]):
    monkeypatch.setattr(prevention_followups, "db", database)
    monkeypatch.setattr(prevention_followups, "assert_client_scope", _scope_allows)

    async def _log(_user, action, entity_type, entity_id, entity_name, details, *, metadata=None, **_kwargs):
        activity_events.append(
            {
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "entity_name": entity_name,
                "details": details,
                "metadata": metadata or {},
            }
        )

    monkeypatch.setattr(prevention_followups, "log_activity", _log)


def test_completed_work_session_creates_review_only_prevention_follow_up(monkeypatch):
    asyncio.run(_test_completed_work_session_creates_review_only_prevention_follow_up(monkeypatch))


async def _test_completed_work_session_creates_review_only_prevention_follow_up(monkeypatch):
    database = FakeDb()
    activity_events = []
    _install(monkeypatch, database, activity_events)

    result = await prevention_followups.propose_work_session_prevention_follow_up(
        "work-session-a", _payload(), current_user=_actor()
    )

    follow_up = result["follow_up"]
    assert result["idempotent_replay"] is False
    assert follow_up["work_session_id"] == "work-session-a"
    assert follow_up["ticket_id"] == "ticket-a"
    assert follow_up["client_id"] == "client-a"
    assert follow_up["site_id"] == "site-a"
    assert follow_up["source_device_id"] == "device-a"
    assert follow_up["candidate_device_ids"] == ["device-b"]
    assert follow_up["recurrence_evidence"] == "23 endpoints show the same Outlook profile failure."
    assert follow_up["status"] == "proposed"
    assert follow_up["execution_status"] == "not_started"
    assert follow_up["requires_human_review"] is True
    assert follow_up["auto_remediation"] is False
    assert "No remediation was scheduled or executed" in result["message"]
    assert len(database.nexus_prevention_followups.rows) == 1
    assert database.ticket_audit_log.rows[0]["action"] == "prevention_follow_up_proposed"
    assert activity_events[0]["action"] == "prevention_follow_up_proposed"
    assert activity_events[0]["metadata"]["auto_remediation"] is False


def test_prevention_follow_up_retries_do_not_duplicate_audit_or_proposal(monkeypatch):
    asyncio.run(_test_prevention_follow_up_retries_do_not_duplicate_audit_or_proposal(monkeypatch))


async def _test_prevention_follow_up_retries_do_not_duplicate_audit_or_proposal(monkeypatch):
    database = FakeDb()
    activity_events = []
    _install(monkeypatch, database, activity_events)

    first = await prevention_followups.propose_work_session_prevention_follow_up(
        "work-session-a", _payload(), current_user=_actor()
    )
    second = await prevention_followups.propose_work_session_prevention_follow_up(
        "work-session-a", _payload(), current_user=_actor()
    )

    assert second["idempotent_replay"] is True
    assert second["follow_up"]["id"] == first["follow_up"]["id"]
    assert len(database.nexus_prevention_followups.rows) == 1
    assert len(database.ticket_audit_log.rows) == 1
    assert len(activity_events) == 1


def test_prevention_follow_up_rejects_uncompleted_work_and_cross_client_candidate(monkeypatch):
    asyncio.run(_test_prevention_follow_up_rejects_uncompleted_work_and_cross_client_candidate(monkeypatch))


async def _test_prevention_follow_up_rejects_uncompleted_work_and_cross_client_candidate(monkeypatch):
    activity_events = []
    uncompleted = FakeDb(session_status="active")
    _install(monkeypatch, uncompleted, activity_events)
    with pytest.raises(HTTPException) as uncompleted_error:
        await prevention_followups.propose_work_session_prevention_follow_up(
            "work-session-a", _payload(), current_user=_actor()
        )
    assert uncompleted_error.value.status_code == 409
    assert uncompleted.nexus_prevention_followups.rows == []

    cross_client_candidate = FakeDb()
    _install(monkeypatch, cross_client_candidate, activity_events)
    with pytest.raises(HTTPException) as candidate_error:
        await prevention_followups.propose_work_session_prevention_follow_up(
            "work-session-a",
            _payload(candidate_device_ids=["device-other-client"]),
            current_user=_actor(),
        )
    assert candidate_error.value.status_code == 422
    assert "source client" in str(candidate_error.value.detail).lower()
    assert cross_client_candidate.nexus_prevention_followups.rows == []

    other_site_candidate = FakeDb()
    _install(monkeypatch, other_site_candidate, activity_events)
    with pytest.raises(HTTPException) as site_error:
        await prevention_followups.propose_work_session_prevention_follow_up(
            "work-session-a",
            _payload(candidate_device_ids=["device-other-site"]),
            current_user=_actor(),
        )
    assert site_error.value.status_code == 422
    assert other_site_candidate.nexus_prevention_followups.rows == []


def test_prevention_follow_up_hides_inconsistent_session_ticket_scope(monkeypatch):
    asyncio.run(_test_prevention_follow_up_hides_inconsistent_session_ticket_scope(monkeypatch))


async def _test_prevention_follow_up_hides_inconsistent_session_ticket_scope(monkeypatch):
    database = FakeDb(ticket_client_id="client-b")
    activity_events = []
    _install(monkeypatch, database, activity_events)

    with pytest.raises(HTTPException) as error:
        await prevention_followups.list_work_session_prevention_follow_ups(
            "work-session-a", current_user=_actor()
        )

    assert error.value.status_code == 409
    assert "safe client scope" in str(error.value.detail).lower()


def test_prevention_follow_up_detail_rechecks_the_source_site_scope(monkeypatch):
    asyncio.run(_test_prevention_follow_up_detail_rechecks_the_source_site_scope(monkeypatch))


async def _test_prevention_follow_up_detail_rechecks_the_source_site_scope(monkeypatch):
    database = FakeDb()
    activity_events = []
    _install(monkeypatch, database, activity_events)
    created = await prevention_followups.propose_work_session_prevention_follow_up(
        "work-session-a", _payload(), current_user=_actor()
    )

    response = await prevention_followups.get_prevention_follow_up(
        created["follow_up"]["id"], current_user=_actor()
    )

    assert response["follow_up"]["site_id"] == "site-a"
    assert "non-executable" in response["boundary"]
