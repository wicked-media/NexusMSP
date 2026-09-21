"""Focused regression tests for internal team-chat access and state handling."""

import asyncio
import base64
import os
import sys
from datetime import datetime, timedelta, timezone
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

from app.routers import chat_presence, chat_pro  # noqa: E402
from app.services import chat_access, chat_live  # noqa: E402


def test_channel_access_preserves_dm_privacy_even_for_admins():
    public = {"kind": "team", "is_private": False, "member_ids": []}
    private = {"kind": "team", "is_private": True, "member_ids": ["member-1"]}
    dm = {"kind": "dm", "is_private": True, "member_ids": ["member-1", "member-2"]}

    assert chat_access.channel_is_accessible(public, {"id": "outsider"})
    assert not chat_access.channel_is_accessible(private, {"id": "outsider"})
    assert chat_access.channel_is_accessible(private, {"id": "member-1"})
    assert not chat_access.channel_is_accessible(dm, {"id": "admin-1", "role": "admin"})
    assert chat_access.channel_is_accessible(dm, {"id": "member-2", "role": "admin"})


class ChannelCollection:
    def __init__(self, existing=None):
        self.existing = existing
        self.inserted = []

    async def find_one(self, *_args, **_kwargs):
        return self.existing

    async def insert_one(self, document):
        self.inserted.append(dict(document))
        return SimpleNamespace(inserted_id=document.get("id"))


class UserCollection:
    async def count_documents(self, _query):
        return 4


def test_public_channel_creation_stays_company_wide(monkeypatch):
    channels = ChannelCollection()
    fake_db = SimpleNamespace(chat_channels=channels, users=UserCollection())
    monkeypatch.setattr(chat_presence, "db", fake_db)
    monkeypatch.setattr(chat_access, "db", fake_db)

    result = asyncio.run(chat_presence.create_channel(
        {"name": "Service Desk", "description": "Daily operations", "is_private": False},
        current_user={"id": "creator-1", "name": "Creator"},
    ))

    assert result["name"] == "service-desk"
    assert result["is_private"] is False
    assert result["member_ids"] == []
    assert result["member_count"] == 4
    assert channels.inserted[0]["created_by"] == "creator-1"


class ReadStateCollection:
    def __init__(self):
        self.update = None

    async def update_one(self, query, update, upsert=False):
        self.update = (query, update, upsert)
        return SimpleNamespace(modified_count=1)


class MutableChannelCollection(ChannelCollection):
    def __init__(self, existing=None):
        super().__init__(existing)
        self.update = None

    async def update_one(self, query, update):
        self.update = (query, update)
        return SimpleNamespace(modified_count=1)


class MessageCollection:
    async def find_one(self, *_args, **_kwargs):
        return {"ts": "2026-09-21T10:30:00+00:00"}


def test_mark_read_uses_the_same_timestamp_field_as_previews(monkeypatch):
    channel = {"id": "channel-1", "kind": "team", "is_private": False, "member_ids": []}
    channels = ChannelCollection(existing=channel)
    reads = ReadStateCollection()
    fake_db = SimpleNamespace(chat_channels=channels, chat_read_state=reads)
    monkeypatch.setattr(chat_presence, "db", fake_db)
    monkeypatch.setattr(chat_access, "db", fake_db)

    asyncio.run(chat_presence.mark_read("channel-1", current_user={"id": "user-1"}))

    assert "last_read_at" in reads.update[1]["$set"]
    assert "last_read_ts" not in reads.update[1]["$set"]


def test_mark_unread_rewinds_only_to_the_latest_received_message(monkeypatch):
    channel = {"id": "channel-1", "kind": "team", "is_private": False, "member_ids": []}
    channels = ChannelCollection(existing=channel)
    reads = ReadStateCollection()
    fake_db = SimpleNamespace(chat_channels=channels, chat_read_state=reads, chat_messages=MessageCollection())
    monkeypatch.setattr(chat_presence, "db", fake_db)
    monkeypatch.setattr(chat_access, "db", fake_db)

    result = asyncio.run(chat_presence.mark_unread("channel-1", current_user={"id": "user-1"}))

    assert result["ok"] is True
    assert reads.update[1]["$set"]["last_read_at"] == "2026-09-21T10:29:59.999999+00:00"


class FileCollection:
    async def find_one(self, *_args, **_kwargs):
        return {
            "id": "file-1",
            "channel_id": "dm-1",
            "filename": "notes.txt",
            "content_type": "text/plain",
            "data_b64": base64.b64encode(b"private notes").decode(),
        }


def test_private_attachment_download_requires_channel_membership(monkeypatch):
    dm = {"id": "dm-1", "kind": "dm", "is_private": True, "member_ids": ["user-1", "user-2"]}
    fake_db = SimpleNamespace(chat_channels=ChannelCollection(existing=dm), chat_files=FileCollection())
    monkeypatch.setattr(chat_pro, "db", fake_db)
    monkeypatch.setattr(chat_access, "db", fake_db)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(chat_pro.download_file("file-1", current_user={"id": "outsider"}))
    assert denied.value.status_code == 403

    response = asyncio.run(chat_pro.download_file("file-1", current_user={"id": "user-1"}))
    assert response.body == b"private notes"
    assert response.media_type == "text/plain"


class PresenceCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _length):
        return [dict(row) for row in self.rows]


class PresenceCollection:
    def __init__(self, rows):
        self.rows = rows

    def find(self, *_args, **_kwargs):
        return PresenceCursor(self.rows)


def test_presence_moves_to_away_before_offline(monkeypatch):
    now = datetime(2026, 7, 13, 6, 0, tzinfo=timezone.utc)
    rows = [
        {"user_id": "away", "last_heartbeat": (now - timedelta(seconds=60)).isoformat()},
        {"user_id": "offline", "last_heartbeat": (now - timedelta(seconds=301)).isoformat()},
    ]
    monkeypatch.setattr(chat_presence, "db", SimpleNamespace(presence_state=PresenceCollection(rows)))
    monkeypatch.setattr(chat_presence, "_now", lambda: now)

    result = asyncio.run(chat_presence.list_presence(current_user={"id": "viewer"}))
    by_id = {row["user_id"]: row["led"] for row in result["users"]}

    assert by_id == {"away": "away", "offline": "offline"}


def test_private_chat_live_updates_never_reach_non_members():
    member_id, member_queue = chat_live.subscribe("member-1")
    outsider_id, outsider_queue = chat_live.subscribe("outsider")
    try:
        chat_live.publish_channel_update("private-channel", "message.created", ["member-1", "member-2"])
        event = asyncio.run(member_queue.get())
        assert event == {"type": "chat.channel.updated", "channel_id": "private-channel", "kind": "message.created"}
        assert outsider_queue.empty()
    finally:
        chat_live.unsubscribe(member_id)
        chat_live.unsubscribe(outsider_id)


def test_conversation_preferences_are_actor_and_tenant_bound(monkeypatch):
    channel = {"id": "team-1", "kind": "team", "is_private": False, "member_ids": []}
    channels = ChannelCollection(existing=channel)
    preferences = ReadStateCollection()
    fake_db = SimpleNamespace(chat_channels=channels, chat_user_preferences=preferences)
    monkeypatch.setattr(chat_pro, "db", fake_db)
    monkeypatch.setattr(chat_access, "db", fake_db)

    result = asyncio.run(chat_pro.update_channel_preference(
        "team-1",
        {"is_saved": True, "is_muted": True},
        current_user={"id": "tech-1", "tenant_id": "tenant-1"},
    ))

    query, update, upsert = preferences.update
    assert result == {"channel_id": "team-1", "is_saved": True, "is_muted": True}
    assert query == {"tenant_id": "tenant-1", "user_id": "tech-1", "channel_id": "team-1"}
    assert update["$set"]["is_saved"] is True
    assert update["$setOnInsert"]["channel_id"] == "team-1"
    assert upsert is True


def test_channel_owner_can_update_a_team_channel_purpose(monkeypatch):
    channel = {
        "id": "team-1", "kind": "team", "name": "service-desk",
        "description": "Old purpose", "created_by": "owner-1",
        "is_private": False, "member_ids": [],
    }
    channels = MutableChannelCollection(existing=channel)
    fake_db = SimpleNamespace(chat_channels=channels)
    monkeypatch.setattr(chat_pro, "db", fake_db)
    monkeypatch.setattr(chat_access, "db", fake_db)

    result = asyncio.run(chat_pro.update_channel_details(
        "team-1", {"description": "Coordinate service desk work"}, current_user={"id": "owner-1"},
    ))

    assert result["description"] == "Coordinate service desk work"
    assert channels.update[0] == {"id": "team-1"}
    assert channels.update[1]["$set"]["description"] == "Coordinate service desk work"
