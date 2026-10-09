"""Focused regression coverage for Voice Journal's ticket-time boundary."""

from __future__ import annotations

import asyncio
from copy import deepcopy
import math
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import voice_journal
from app.services import scope_permissions


def _matches(row: dict, query: dict) -> bool:
    return all(row.get(key) == value for key, value in query.items())


class FakeCursor:
    def __init__(self, rows: list[dict]):
        self.rows = deepcopy(rows)

    async def to_list(self, _limit: int) -> list[dict]:
        return deepcopy(self.rows)


class FakeCollection:
    def __init__(self, rows: list[dict] | None = None):
        self.rows = deepcopy(rows or [])
        self.indexes: list[dict] = []

    async def find_one(self, query: dict, _projection=None):
        return next((deepcopy(row) for row in self.rows if _matches(row, query)), None)

    def find(self, query: dict, _projection=None) -> FakeCursor:
        return FakeCursor([row for row in self.rows if _matches(row, query)])

    async def insert_one(self, document: dict):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def create_index(self, keys, **kwargs):
        self.indexes.append({"keys": keys, **kwargs})
        return kwargs.get("name")

    async def update_one(self, query: dict, update: dict):
        for row in self.rows:
            if _matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class FakeDb(SimpleNamespace):
    def __init__(self):
        super().__init__(
            tickets=FakeCollection(
                [
                    {
                        "id": "ticket-1",
                        "title": "Restore workstation access",
                        "client_id": "client-1",
                        "client_name": "Northwind Dental",
                    }
                ]
            ),
            users=FakeCollection(
                [{"id": "tech-1", "name": "Alex Tech", "hourly_rate": 120.0}]
            ),
            time_entries=FakeCollection(),
            ticket_time_entries=FakeCollection(),
            ticket_comments=FakeCollection(),
        )


class FakeAudio:
    def __init__(self, payload: bytes, *, fail_if_read: bool = False):
        self.payload = payload
        self.filename = "voice.webm"
        self.content_type = "audio/webm"
        self.fail_if_read = fail_if_read
        self.read_called = False

    async def read(self) -> bytes:
        self.read_called = True
        if self.fail_if_read:
            raise AssertionError("audio must not be read before ticket scope is authorised")
        return self.payload


def test_voice_journal_denies_cross_client_ticket_before_audio_upload(monkeypatch):
    asyncio.run(_test_voice_journal_denies_cross_client_ticket_before_audio_upload(monkeypatch))


async def _test_voice_journal_denies_cross_client_ticket_before_audio_upload(monkeypatch):
    database = FakeDb()
    denial_store = FakeCollection()
    monkeypatch.setattr(voice_journal, "db", database)
    monkeypatch.setattr(
        scope_permissions,
        "db",
        SimpleNamespace(scope_denials=denial_store),
    )
    audio = FakeAudio(b"foreign-client-audio", fail_if_read=True)
    restricted_tech = {
        "id": "tech-1",
        "name": "Alex Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-2"],
    }

    with pytest.raises(HTTPException) as error:
        await voice_journal.voice_journal_log_entry(
            ticket_id="ticket-1",
            duration_minutes=15.0,
            billable=True,
            category="Support",
            audio=audio,
            current_user=restricted_tech,
        )

    assert error.value.status_code == 404
    assert audio.read_called is False
    assert len(denial_store.rows) == 1
    assert denial_store.rows[0]["client_id"] == "client-1"
    assert denial_store.rows[0]["operation"] == "voice_journal.log_entry"


def test_voice_journal_rejects_nonfinite_duration_before_audio_read(monkeypatch):
    asyncio.run(_test_voice_journal_rejects_nonfinite_duration_before_audio_read(monkeypatch))


async def _test_voice_journal_rejects_nonfinite_duration_before_audio_read(monkeypatch):
    database = FakeDb()
    monkeypatch.setattr(voice_journal, "db", database)
    audio = FakeAudio(b"invalid-duration-audio", fail_if_read=True)
    in_scope_tech = {
        "id": "tech-1",
        "name": "Alex Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-1"],
    }

    with pytest.raises(HTTPException) as error:
        await voice_journal.voice_journal_log_entry(
            ticket_id="ticket-1",
            duration_minutes=math.nan,
            billable=True,
            category="Support",
            audio=audio,
            current_user=in_scope_tech,
        )

    assert error.value.status_code == 422
    assert audio.read_called is False


def test_voice_journal_writes_one_canonical_billable_entry_and_replays_safely(monkeypatch):
    asyncio.run(_test_voice_journal_writes_one_canonical_billable_entry_and_replays_safely(monkeypatch))


async def _test_voice_journal_writes_one_canonical_billable_entry_and_replays_safely(monkeypatch):
    database = FakeDb()
    monkeypatch.setattr(voice_journal, "db", database)

    async def _transcribe(_raw: bytes, _filename: str) -> str:
        return "Restored remote access and verified that Outlook launches normally."

    monkeypatch.setattr(voice_journal, "_whisper_transcribe", _transcribe)
    in_scope_tech = {
        "id": "tech-1",
        "name": "Alex Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-1"],
    }
    first = await voice_journal.voice_journal_log_entry(
        ticket_id="ticket-1",
        duration_minutes=15.0,
        billable=True,
        category="Support",
        audio=FakeAudio(b"same-journal-recording"),
        current_user=in_scope_tech,
    )
    replay = await voice_journal.voice_journal_log_entry(
        ticket_id="ticket-1",
        duration_minutes=15.0,
        billable=True,
        category="Support",
        audio=FakeAudio(b"same-journal-recording"),
        current_user=in_scope_tech,
    )

    assert first["idempotent_replay"] is False
    assert replay["idempotent_replay"] is True
    assert len(database.time_entries.rows) == 1
    entry = database.time_entries.rows[0]
    assert entry["ticket_id"] == "ticket-1"
    assert entry["client_id"] == "client-1"
    assert entry["source"] == "voice_journal"
    assert entry["source_reference"].startswith("voice-journal-")
    assert entry["idempotency_key"].startswith("voice_journal:")
    assert entry["minutes"] == 15
    assert entry["billable"] is True
    assert entry["hourly_rate"] == 120.0
    assert entry["total_amount"] == 30.0
    assert entry["time_entry_schema"] == "ticket_time.v1"
    assert database.tickets.rows[0]["total_time_minutes"] == 15
    assert database.tickets.rows[0]["total_time_source"] == "time_entries"
    assert len(database.ticket_comments.rows) == 1
    assert database.ticket_comments.rows[0]["time_entry_id"] == entry["id"]
    assert database.ticket_comments.rows[0]["voice_journal_id"] == entry["source_reference"]
