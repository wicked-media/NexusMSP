"""Focused tests for multi-display native remote frames.

The companion captures the full virtual desktop and reports validated display
topology with each frame; the relay stores that geometry and serves it to the
viewer as a bounded header.  These tests pin the contract end to end without a
database or a Windows endpoint.
"""

import asyncio
import base64
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.routers import native_remote
from app.routers.native_remote import NativeDisplayInfo, NativeFrameUpload


JPEG_B64 = base64.b64encode(b"\xff\xd8\xff" + b"0" * 29).decode()
FUTURE = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()

DISPLAYS = [
    {"index": 0, "x": 0, "y": 0, "width": 1920, "height": 1080, "primary": True, "name": "DISPLAY1"},
    {"index": 1, "x": 1920, "y": 0, "width": 1920, "height": 1080, "primary": False, "name": "DISPLAY2"},
]


class _Result:
    def __init__(self, matched_count=0, upserted_id=None):
        self.matched_count = matched_count
        self.upserted_id = upserted_id


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
            if "$lt" in expected and not (actual is not None and actual < expected["$lt"]):
                return False
            if "$lte" in expected and not (actual is not None and actual <= expected["$lte"]):
                return False
            if "$gt" in expected and not (actual is not None and actual > expected["$gt"]):
                return False
        elif actual != expected:
            return False
    return True


class _Rows:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                row.update(update.get("$set") or {})
                return _Result(1)
        if upsert:
            new_row = {key: value for key, value in query.items() if not isinstance(value, dict)}
            new_row.update(update.get("$set") or {})
            self.rows.append(new_row)
            return _Result(0, upserted_id="upserted")
        return _Result()


def _database():
    return SimpleNamespace(
        native_remote_grants=_Rows([{
            "id": "grant-1", "session_id": "session-1", "tenant_id": "tenant-1",
            "agent_id": "agent-1", "client_id": "client-1", "device_id": "device-1",
            "status": "acknowledged", "expires_at": FUTURE,
        }]),
        remote_sessions=_Rows([{
            "id": "session-1", "tenant_id": "tenant-1", "device_id": "device-1",
            "client_id": "client-1", "provider": "nexus", "status": "active",
            "transport_state": "connected", "ended_at": None,
        }]),
        native_remote_frames=_Rows(),
    )


async def _no_indexes():
    return None


async def _agent(*_args, **_kwargs):
    return {"id": "agent-1", "client_id": "client-1", "tenant_id": "tenant-1"}


async def _allow(*_args, **_kwargs):
    return None


def _install(monkeypatch, database):
    monkeypatch.setattr(native_remote, "db", database)
    monkeypatch.setattr(native_remote, "ensure_native_remote_indexes", _no_indexes)
    monkeypatch.setattr(native_remote, "_verify_agent_token", _agent)
    monkeypatch.setattr(native_remote, "assert_client_scope", _allow)


def _upload(displays):
    return asyncio.run(native_remote.native_remote_frame_upload(
        session_id="session-1",
        body=NativeFrameUpload(sequence=1, jpeg_b64=JPEG_B64, displays=displays),
        x_agent_token="agent-token",
        x_client_cert_fingerprint=None,
    ))


def _viewer_frame():
    return asyncio.run(native_remote.native_remote_latest_frame(
        "session-1",
        request=SimpleNamespace(),
        current_user={"id": "tech-1", "tenant_id": "tenant-1"},
    ))


def test_display_topology_travels_from_endpoint_frame_to_viewer(monkeypatch):
    database = _database()
    _install(monkeypatch, database)

    result = _upload([NativeDisplayInfo(**display) for display in DISPLAYS])
    assert result["sequence"] == 1

    stored = database.native_remote_frames.rows[0]
    assert stored["displays"] == DISPLAYS

    response = _viewer_frame()
    assert response.headers["X-Nexus-Remote-Sequence"] == "1"
    import json
    assert json.loads(response.headers["X-Nexus-Remote-Displays"]) == DISPLAYS


def test_frames_without_topology_reach_the_viewer_without_a_displays_header(monkeypatch):
    database = _database()
    _install(monkeypatch, database)

    _upload(None)

    response = _viewer_frame()
    assert "X-Nexus-Remote-Displays" not in response.headers
    assert response.headers["X-Nexus-Remote-Sequence"] == "1"


def test_display_topology_is_strictly_validated():
    with pytest.raises(ValidationError):
        NativeDisplayInfo(index=16, x=0, y=0, width=1920, height=1080)
    with pytest.raises(ValidationError):
        NativeDisplayInfo(index=0, x=0, y=0, width=0, height=1080)
    with pytest.raises(ValidationError):
        NativeDisplayInfo(index=0, x=-1, y=0, width=1920, height=1080)
    with pytest.raises(ValidationError):
        NativeFrameUpload(sequence=1, jpeg_b64=JPEG_B64, displays=[
            NativeDisplayInfo(index=i, x=0, y=0, width=10, height=10) for i in range(17)
        ])
