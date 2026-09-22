"""Regression coverage for technician boundaries in Live Chat."""

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

from app.routers import live_chat  # noqa: E402
from app.services import scope_permissions  # noqa: E402


class SessionCollection:
    def __init__(self, session):
        self.session = session

    async def find_one(self, query, *_args, **_kwargs):
        return self.session


class ScopeDenials:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))


def test_direct_live_chat_session_read_is_denied_outside_client_scope(monkeypatch):
    sessions = SessionCollection({"id": "chat-1", "client_id": "client-outside", "status": "active"})
    denials = ScopeDenials()
    fake_db = SimpleNamespace(chat_sessions=sessions, scope_denials=denials)
    monkeypatch.setattr(live_chat, "db", fake_db)
    monkeypatch.setattr(scope_permissions, "db", fake_db)

    with pytest.raises(HTTPException) as denied:
        asyncio.run(live_chat._require_session(
            "chat-1",
            {"id": "tech-1", "client_scope_mode": "restricted", "client_scope_ids": ["client-allowed"]},
        ))

    assert denied.value.status_code == 404
    assert denials.rows[0]["operation"] == "live_chat.session"
