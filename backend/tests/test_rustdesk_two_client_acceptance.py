"""Two-client acceptance coverage for the governed RustDesk provider boundary.

These tests use two deliberately independent customer scopes.  They protect the
invariant that a technician limited to Client A cannot use provider controls,
registry records, device mappings, session evidence, or live peer status to
observe or alter Client B.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routers import remote, remote_providers, rustdesk
from app.services import scope_permissions


class _Result:
    def __init__(self, *, matched_count: int = 1):
        self.matched_count = matched_count


def _value(row: dict[str, Any], key: str) -> Any:
    value: Any = row
    for segment in key.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(segment)
    return value


def _matches(row: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, expected in (query or {}).items():
        if key == "$and":
            if not all(_matches(row, child) for child in expected):
                return False
            continue
        if key == "$or":
            if not any(_matches(row, child) for child in expected):
                return False
            continue

        actual = _value(row, key)
        if isinstance(expected, dict):
            for operator, expected_value in expected.items():
                if operator == "$in" and actual not in expected_value:
                    return False
                if operator == "$ne" and actual == expected_value:
                    return False
                if operator == "$exists" and (actual is not None) != bool(expected_value):
                    return False
            continue
        if actual != expected:
            return False
    return True


def _set_value(row: dict[str, Any], key: str, value: Any) -> None:
    target = row
    segments = key.split(".")
    for segment in segments[:-1]:
        target = target.setdefault(segment, {})
    target[segments[-1]] = value


class _Cursor:
    def __init__(self, rows: list[dict[str, Any]]):
        self.rows = [dict(row) for row in rows]

    def sort(self, *_args: Any):
        return self

    async def to_list(self, _length: int) -> list[dict[str, Any]]:
        return [dict(row) for row in self.rows]


class _Collection:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = [dict(row) for row in (rows or [])]

    def find(self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> _Cursor:
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query: dict[str, Any], _projection: dict[str, Any] | None = None) -> dict[str, Any] | None:
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, row: dict[str, Any]) -> _Result:
        self.rows.append(dict(row))
        return _Result()

    async def update_one(self, query: dict[str, Any], update: dict[str, Any], upsert: bool = False) -> _Result:
        for row in self.rows:
            if _matches(row, query):
                for key, value in update.get("$set", {}).items():
                    _set_value(row, key, value)
                return _Result()
        if upsert:
            row = {
                key: value
                for key, value in query.items()
                if not key.startswith("$") and not isinstance(value, dict)
            }
            for key, value in update.get("$set", {}).items():
                _set_value(row, key, value)
            self.rows.append(row)
            return _Result()
        return _Result(matched_count=0)


class _DB:
    def __init__(
        self,
        *,
        clients: list[dict[str, Any]] | None = None,
        devices: list[dict[str, Any]] | None = None,
        registry: list[dict[str, Any]] | None = None,
        remote_sessions: list[dict[str, Any]] | None = None,
    ):
        self.clients = _Collection(clients)
        self.devices = _Collection(devices)
        self.rustdesk_devices = _Collection(registry)
        self.remote_session_records = _Collection(remote_sessions)
        self.rustdesk_sessions = _Collection()
        self.settings = _Collection()
        self.users = _Collection([{"id": "admin-1", "role": "admin", "is_admin": True}])
        self.scope_denials = _Collection()
        self.permission_denials = _Collection()


class _Response:
    def __init__(self, data: Any, status_code: int = 200):
        self.status_code = status_code
        self._data = data

    def json(self) -> Any:
        return self._data


def _request(method: str = "GET", path: str = "/api/rustdesk") -> Request:
    return Request({"type": "http", "method": method, "path": path, "headers": []})


def _client_a_technician() -> dict[str, Any]:
    return {
        "id": "tech-a",
        "name": "Client A Technician",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": ["client-a"],
    }


def _install_db(
    monkeypatch: pytest.MonkeyPatch,
    *,
    clients: list[dict[str, Any]] | None = None,
    devices: list[dict[str, Any]] | None = None,
    registry: list[dict[str, Any]] | None = None,
    remote_sessions: list[dict[str, Any]] | None = None,
) -> _DB:
    fake_db = _DB(
        clients=clients,
        devices=devices,
        registry=registry,
        remote_sessions=remote_sessions,
    )
    monkeypatch.setattr(rustdesk, "db", fake_db)
    monkeypatch.setattr(remote, "db", fake_db)
    monkeypatch.setattr(remote_providers, "db", fake_db)
    monkeypatch.setattr(scope_permissions, "db", fake_db)
    return fake_db


def _install_live_peers(monkeypatch: pytest.MonkeyPatch, peers: list[dict[str, Any]]) -> None:
    async def _config() -> dict[str, str]:
        return {"server_url": "https://rustdesk.example", "api_key": "saved-token"}

    class _Client:
        def __init__(self, *_args: Any, **_kwargs: Any):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args: Any):
            return False

        async def get(self, _url: str, **_kwargs: Any) -> _Response:
            return _Response(peers)

    monkeypatch.setattr(rustdesk, "_get_rustdesk_config", _config)
    monkeypatch.setattr(rustdesk.httpx, "AsyncClient", _Client)


def test_client_scoped_technician_cannot_use_global_rustdesk_provider_controls(monkeypatch: pytest.MonkeyPatch):
    """A technician limited to Client A cannot operate global provider controls.

    Those controls would otherwise reveal or mutate peers belonging to Client B,
    so they require an explicit all-client scope rather than relying on UI hiding.
    """
    fake_db = _install_db(monkeypatch)
    technician = _client_a_technician()

    operations = (
        lambda: rustdesk.get_rustdesk_global_config(_request(), technician),
        lambda: rustdesk.save_rustdesk_global_config(
            {"server_url": "https://rustdesk.example", "api_key": "not-written"},
            _request("POST", "/api/rustdesk/config"),
            technician,
        ),
        lambda: remote_providers.get_provider_settings(
            "rustdesk", _request(), technician
        ),
        lambda: remote_providers.save_provider_settings(
            "rustdesk",
            {"server_url": "https://rustdesk.example", "api_key": "not-written"},
            _request("PUT", "/api/remote-providers/rustdesk/settings"),
            technician,
        ),
        lambda: remote_providers.test_provider_connection(
            "rustdesk", _request("POST"), technician
        ),
        lambda: rustdesk.test_rustdesk_connection(_request(), technician),
        lambda: rustdesk.get_live_peers(_request(), technician),
        lambda: rustdesk.sync_rustdesk_peers(_request("POST"), technician),
        lambda: rustdesk.get_live_audit_logs(_request(), technician),
    )

    for operation in operations:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(operation())
        assert exc.value.status_code == 403

    assert fake_db.settings.rows == []
    assert len(fake_db.scope_denials.rows) == len(operations)


def test_client_a_registry_and_device_mapping_cannot_target_client_b(monkeypatch: pytest.MonkeyPatch):
    """Client A access cannot read, configure, or cross-link Client B resources."""
    fake_db = _install_db(
        monkeypatch,
        clients=[
            {"id": "client-a", "name": "Client A"},
            {"id": "client-b", "name": "Client B"},
        ],
        devices=[
            {"id": "device-a", "client_id": "client-a", "client_name": "Client A", "name": "Asset A"},
            {"id": "device-b", "client_id": "client-b", "client_name": "Client B", "name": "Asset B"},
        ],
        registry=[
            {"id": "registry-a", "client_id": "client-a", "rustdesk_id": "peer-a", "device_name": "Provider A"},
            {"id": "registry-b", "client_id": "client-b", "rustdesk_id": "peer-b", "device_name": "Provider B"},
        ],
    )
    technician = _client_a_technician()

    rejected = (
        (lambda: rustdesk.get_client_rustdesk_devices("client-b", _request(), technician), 403),
        (lambda: rustdesk.add_rustdesk_device(
            "client-b",
            {"device_name": "Foreign", "rustdesk_id": "peer-foreign"},
            _request("POST"),
            technician,
        ), 403),
        # Device resources outside the caller's scope are deliberately non-enumerable.
        (lambda: remote.get_device_remote_options("device-b", _request(), technician), 404),
        (lambda: remote.save_device_remote_access(
            "device-b",
            {"remote_provider": "rustdesk", "rustdesk_id": "peer-foreign"},
            _request("PUT"),
            technician,
        ), 404),
        # Either side of a proposed link must be in the technician's scope.
        (lambda: rustdesk.link_rustdesk_registry_entry(
            "registry-a", {"managed_device_id": "device-b"}, _request("PUT"), technician
        ), 404),
        (lambda: rustdesk.link_rustdesk_registry_entry(
            "registry-b", {"managed_device_id": "device-a"}, _request("PUT"), technician
        ), 404),
        (lambda: rustdesk.assign_rustdesk_id(
            "device-b", {"rustdesk_id": "peer-foreign"}, _request("PUT"), technician
        ), 404),
    )

    for operation, status_code in rejected:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(operation())
        assert exc.value.status_code == status_code

    assert fake_db.rustdesk_devices.rows == [
        {"id": "registry-a", "client_id": "client-a", "rustdesk_id": "peer-a", "device_name": "Provider A"},
        {"id": "registry-b", "client_id": "client-b", "rustdesk_id": "peer-b", "device_name": "Provider B"},
    ]
    assert all("rustdesk_id" not in row for row in fake_db.devices.rows)


def test_client_a_can_only_read_its_own_live_status_and_session_evidence(monkeypatch: pytest.MonkeyPatch):
    """Live peer state and audit evidence stay within the client boundary."""
    _install_db(
        monkeypatch,
        devices=[
            {"id": "device-a", "client_id": "client-a", "rustdesk_id": "peer-a"},
            {"id": "device-b", "client_id": "client-b", "rustdesk_id": "peer-b"},
        ],
        registry=[
            {"id": "registry-a", "client_id": "client-a", "rustdesk_id": "peer-a"},
            {"id": "registry-b", "client_id": "client-b", "rustdesk_id": "peer-b"},
        ],
        remote_sessions=[
            {"id": "session-a", "client_id": "client-a", "started_at": "2026-08-22T01:00:00+00:00"},
            {"id": "session-b", "client_id": "client-b", "started_at": "2026-08-22T02:00:00+00:00"},
        ],
    )
    _install_live_peers(monkeypatch, [
        {"id": "peer-a", "online": True},
        {"id": "peer-b", "online": False},
    ])
    technician = _client_a_technician()

    status = asyncio.run(rustdesk.get_live_status_map(_request(), technician))
    sessions = asyncio.run(rustdesk.admin_list_remote_session_records(_request(), current_user=technician))

    assert status["status_map"] == {"peer-a": "online"}
    assert status["peer_count"] == 1
    assert [session["id"] for session in sessions] == ["session-a"]

    with pytest.raises(HTTPException) as foreign_client_filter:
        asyncio.run(rustdesk.admin_list_remote_session_records(
            _request(), client_id="client-b", current_user=technician
        ))
    assert foreign_client_filter.value.status_code == 403

    with pytest.raises(HTTPException) as foreign_pdf:
        asyncio.run(rustdesk.admin_remote_session_pdf("session-b", _request(), technician))
    assert foreign_pdf.value.status_code == 404
