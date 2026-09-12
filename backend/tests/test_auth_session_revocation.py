"""Regression coverage for server-side Nexus session revocation."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException

from app import auth as auth_service
from app.routers import user_settings


class _Users:
    def __init__(self, rows: list[dict]):
        self.rows = [deepcopy(row) for row in rows]

    async def find_one(self, query: dict, _projection: dict | None = None):
        return next(
            (deepcopy(row) for row in self.rows if all(row.get(key) == value for key, value in query.items())),
            None,
        )

    async def update_one(self, query: dict, update: dict):
        for row in self.rows:
            if not all(row.get(key) == value for key, value in query.items()):
                continue
            row.update(deepcopy(update.get("$set", {})))
            for field, increment in update.get("$inc", {}).items():
                row[field] = int(row.get(field) or 0) + int(increment)
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class _Db(SimpleNamespace):
    def __init__(self, rows: list[dict]):
        super().__init__(users=_Users(rows))


def _user(*, session_version: int = 0, password_hash: str = "") -> dict:
    return {
        "id": "tech-1",
        "email": "tech@example.test",
        "name": "Nexus Technician",
        "role": "technician",
        "is_active": True,
        "session_version": session_version,
        "password_hash": password_hash,
    }


def _install_fake_database(monkeypatch: pytest.MonkeyPatch, rows: list[dict]) -> _Db:
    fake_db = _Db(rows)
    monkeypatch.setattr(auth_service, "db", fake_db)
    monkeypatch.setattr(user_settings, "db", fake_db)
    return fake_db


def test_new_tokens_carry_a_session_generation_and_legacy_generation_zero_tokens_work(monkeypatch: pytest.MonkeyPatch):
    _install_fake_database(monkeypatch, [_user()])
    monkeypatch.setattr(auth_service, "JWT_SECRET", "session-revocation-test-secret-0123456789")

    token = auth_service.create_token(
        "tech-1",
        "tech@example.test",
        "technician",
        session_version=0,
    )
    payload = jwt.decode(token, auth_service.JWT_SECRET, algorithms=[auth_service.JWT_ALGORITHM])

    assert payload["sv"] == 0
    assert payload["jti"]
    assert asyncio.run(auth_service.get_active_user_from_token(token))["id"] == "tech-1"

    legacy_token = jwt.encode(
        {"sub": "tech-1", "email": "tech@example.test", "role": "technician"},
        auth_service.JWT_SECRET,
        algorithm=auth_service.JWT_ALGORITHM,
    )
    assert asyncio.run(auth_service.get_active_user_from_token(legacy_token))["id"] == "tech-1"


def test_revoke_all_sessions_invalidates_previously_issued_tokens(monkeypatch: pytest.MonkeyPatch):
    _install_fake_database(monkeypatch, [_user()])
    monkeypatch.setattr(auth_service, "JWT_SECRET", "session-revocation-test-secret-0123456789")
    token = auth_service.create_token("tech-1", "tech@example.test", "technician")

    assert asyncio.run(auth_service.revoke_all_user_sessions("tech-1")) == 1
    with pytest.raises(HTTPException) as revoked:
        asyncio.run(auth_service.get_active_user_from_token(token))

    assert revoked.value.status_code == 401
    assert revoked.value.detail == "Session has been revoked"


def test_password_change_revokes_all_existing_sessions(monkeypatch: pytest.MonkeyPatch):
    password_hash = auth_service.hash_password("OldPassword!123")
    fake_db = _install_fake_database(monkeypatch, [_user(password_hash=password_hash)])
    monkeypatch.setattr(auth_service, "JWT_SECRET", "session-revocation-test-secret-0123456789")
    token = auth_service.create_token("tech-1", "tech@example.test", "technician")

    result = asyncio.run(user_settings.change_password(
        {"current_password": "OldPassword!123", "new_password": "NewPassword!456"},
        current_user={"id": "tech-1", "email": "tech@example.test"},
    ))

    assert result["sessions_revoked"] is True
    assert fake_db.users.rows[0]["session_version"] == 1
    with pytest.raises(HTTPException) as revoked:
        asyncio.run(auth_service.get_active_user_from_token(token))
    assert revoked.value.status_code == 401
