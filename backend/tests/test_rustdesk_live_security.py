"""Focused P0 regression coverage for the legacy RustDesk live provider boundary."""

from __future__ import annotations

import asyncio
import inspect
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.models import RustDeskSettings
from app.routers import remote, remote_providers, rustdesk
from app.services import scope_permissions
from app.services.secret_store import decrypt_secret
from app.services.rustdesk_provider_security import normalise_rustdesk_server_url


class _Result:
    def __init__(self, *, matched_count: int = 1):
        self.matched_count = matched_count


def _value(row: dict, key: str):
    value = row
    for segment in key.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(segment)
    return value


def _matches(row: dict, query: dict) -> bool:
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
                if operator == "$exists" and bool(actual is not None) != bool(expected_value):
                    return False
            continue
        if actual != expected:
            return False
    return True


def _set_value(row: dict, key: str, value) -> None:
    target = row
    segments = key.split(".")
    for segment in segments[:-1]:
        target = target.setdefault(segment, {})
    target[segments[-1]] = value


class _Cursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    def sort(self, *_args):
        return self

    async def to_list(self, _length):
        return [dict(row) for row in self.rows]


class _Collection:
    def __init__(self, rows=None):
        self.rows = [dict(row) for row in (rows or [])]

    def find(self, query, _projection=None):
        return _Cursor([row for row in self.rows if _matches(row, query)])

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if _matches(row, query)), None)

    async def insert_one(self, row):
        self.rows.append(dict(row))
        return _Result()

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                for key, value in update.get("$set", {}).items():
                    _set_value(row, key, value)
                for key in update.get("$unset", {}):
                    row.pop(key, None)
                return _Result()
        if upsert:
            new_row = {
                key: value
                for key, value in query.items()
                if not key.startswith("$") and not isinstance(value, dict)
            }
            for key, value in update.get("$set", {}).items():
                _set_value(new_row, key, value)
            self.rows.append(new_row)
            return _Result()
        return _Result(matched_count=0)


class _DB:
    def __init__(self, *, clients=None, devices=None, registry=None, remote_sessions=None):
        self.clients = _Collection(clients)
        self.devices = _Collection(devices)
        self.rustdesk_devices = _Collection(registry)
        self.remote_session_records = _Collection(remote_sessions)
        self.settings = _Collection()
        self.users = _Collection([{"id": "admin-1", "role": "admin", "is_admin": True}])
        self.scope_denials = _Collection()
        self.permission_denials = _Collection()


class _Response:
    def __init__(self, status_code=200, data=None):
        self.status_code = status_code
        self._data = data if data is not None else []

    def json(self):
        return self._data


def _request(method="GET", path="/api/rustdesk"):
    return Request({"type": "http", "method": method, "path": path, "headers": []})


def _admin():
    return {"id": "admin-1", "name": "Admin", "role": "admin", "is_admin": True}


def _tech(*client_ids):
    return {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": list(client_ids),
    }


def _install_db(monkeypatch, *, clients=None, devices=None, registry=None, remote_sessions=None):
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


def _install_http(monkeypatch, responder):
    calls = []

    class _Client:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def get(self, url, headers=None, **_kwargs):
            calls.append({"url": url, "headers": dict(headers or {})})
            return responder(url)

    monkeypatch.setattr(rustdesk.httpx, "AsyncClient", _Client)
    return calls


def _saved_config(monkeypatch, *, server_url="https://rustdesk.example", api_key="saved-token"):
    async def _config():
        return {"server_url": server_url, "api_key": api_key}

    monkeypatch.setattr(rustdesk, "_get_rustdesk_config", _config)


def test_rustdesk_origin_validation_blocks_unsafe_targets_and_honours_allowlist(monkeypatch):
    assert normalise_rustdesk_server_url("rustdesk.example:21114/") == "https://rustdesk.example:21114"
    for target in (
        "http://127.0.0.1:21114",
        "http://127.0.0.1.",
        "https://[::1]",
        "http://169.254.169.254",
        "http://127.1",
        "http://2130706433",
        "http://0x7f000001",
        "http://0177.0.0.1",
        "https://user:password@rustdesk.example",
        "https://rustdesk.example/api/peers",
    ):
        with pytest.raises(HTTPException) as exc:
            normalise_rustdesk_server_url(target)
        assert exc.value.status_code == 422

    monkeypatch.setenv("NEXUS_RUSTDESK_ALLOWED_HOSTS", "rustdesk.example")
    assert normalise_rustdesk_server_url("https://rustdesk.example") == "https://rustdesk.example"
    with pytest.raises(HTTPException):
        normalise_rustdesk_server_url("https://other.example")


def test_live_connection_uses_only_saved_configuration(monkeypatch):
    _install_db(monkeypatch)
    _saved_config(monkeypatch, server_url="https://approved.example", api_key="saved-token")
    calls = _install_http(monkeypatch, lambda _url: _Response(200, []))

    result = asyncio.run(rustdesk.test_rustdesk_connection(_request(), _admin()))

    assert result["connected"] is True
    assert calls
    assert all(call["url"].startswith("https://approved.example") for call in calls)
    assert all("saved-token" in call["headers"].get("Authorization", "") or not call["headers"] for call in calls)
    assert {"request", "current_user"} == set(inspect.signature(rustdesk.test_rustdesk_connection).parameters)


def test_global_live_operations_deny_restricted_technicians(monkeypatch):
    fake_db = _install_db(monkeypatch)
    _saved_config(monkeypatch)
    restricted = _tech("client-a")

    for operation in (
        lambda: rustdesk.test_rustdesk_connection(_request(), restricted),
        lambda: rustdesk.get_live_peers(_request(), restricted),
        lambda: rustdesk.sync_rustdesk_peers(_request("POST"), restricted),
        lambda: rustdesk.get_live_audit_logs(_request(), restricted),
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(operation())
        assert exc.value.status_code == 403

    assert len(fake_db.scope_denials.rows) == 4


def test_live_status_is_limited_to_the_technicians_client_scope(monkeypatch):
    _install_db(
        monkeypatch,
        devices=[
            {"id": "device-a", "client_id": "client-a", "rustdesk_id": "peer-a"},
            {"id": "device-b", "client_id": "client-b", "rustdesk_id": "peer-b"},
        ],
    )
    _saved_config(monkeypatch)
    _install_http(
        monkeypatch,
        lambda _url: _Response(200, [
            {"id": "peer-a", "online": True},
            {"id": "peer-b", "online": False},
        ]),
    )

    result = asyncio.run(rustdesk.get_live_status_map(_request(), _tech("client-a")))

    assert result["status_map"] == {"peer-a": "online"}
    assert result["peer_count"] == 1


def test_live_sync_requires_canonical_owner_and_redacts_audit_payloads(monkeypatch):
    fake_db = _install_db(
        monkeypatch,
        devices=[
            {"id": "device-a", "client_id": "client-a", "client_name": "Client A", "name": "Owned", "rustdesk_id": "peer-a"},
        ],
    )
    _saved_config(monkeypatch)

    def responder(url):
        if "/audit" in url:
            return _Response(200, [{"event": "login", "token": "do-not-return", "nested": {"password": "nope"}}])
        return _Response(200, [
            {"id": "peer-a", "hostname": "owned", "online": True},
            {"id": "unowned-peer", "hostname": "unknown", "online": False},
        ])

    _install_http(monkeypatch, responder)
    sync_result = asyncio.run(rustdesk.sync_rustdesk_peers(_request("POST"), _admin()))
    audit_result = asyncio.run(rustdesk.get_live_audit_logs(_request(), _admin()))

    assert sync_result["created"] == 1
    assert sync_result["skipped_unowned"] == 1
    assert fake_db.rustdesk_devices.rows[0]["client_id"] == "client-a"
    assert all(str(row.get("client_id") or "").strip() for row in fake_db.rustdesk_devices.rows)
    assert "do-not-return" not in str(audit_result)
    assert audit_result["logs"][0]["token"] == "[redacted]"
    assert audit_result["logs"][0]["nested"]["password"] == "[redacted]"


def test_manual_assignment_refuses_unowned_managed_assets(monkeypatch):
    fake_db = _install_db(
        monkeypatch,
        devices=[{"id": "unowned-device", "name": "Unowned", "client_id": ""}],
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rustdesk.assign_rustdesk_id(
            "unowned-device",
            {"rustdesk_id": "peer-unowned"},
            _request("PUT"),
            _admin(),
        ))

    assert exc.value.status_code == 409
    assert fake_db.rustdesk_devices.rows == []


def test_registry_create_cannot_link_another_clients_asset_or_expose_raw_payload(monkeypatch):
    fake_db = _install_db(
        monkeypatch,
        clients=[{"id": "client-a", "name": "Client A"}],
        devices=[{"id": "device-b", "client_id": "client-b", "name": "Client B asset"}],
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rustdesk.add_rustdesk_device(
            "client-a",
            {"device_name": "Not allowed", "rustdesk_id": "peer-b", "linked_device_id": "device-b"},
            _request("POST"),
            _admin(),
        ))

    assert exc.value.status_code == 409
    assert fake_db.rustdesk_devices.rows == []
    public = rustdesk._public_rustdesk_device({
        "id": "registry-a",
        "client_id": "client-a",
        "raw": {"token": "provider-secret", "password": "provider-password"},
    })
    assert "raw" not in public
    assert "provider-secret" not in str(public)


def test_remote_session_audit_records_are_scoped_to_the_technician(monkeypatch):
    _install_db(
        monkeypatch,
        remote_sessions=[
            {"id": "session-a", "client_id": "client-a", "started_at": "2026-08-22T01:00:00+00:00"},
            {"id": "session-b", "client_id": "client-b", "started_at": "2026-08-22T02:00:00+00:00"},
        ],
    )
    restricted = _tech("client-a")

    records = asyncio.run(rustdesk.admin_list_remote_session_records(
        _request(),
        current_user=restricted,
    ))
    assert [record["id"] for record in records] == ["session-a"]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rustdesk.admin_remote_session_pdf("session-b", _request(), restricted))
    assert exc.value.status_code == 404


def test_auto_sync_worker_delegates_to_the_governed_scoped_sync_service():
    source = (Path(__file__).resolve().parents[1] / "server.py").read_text(encoding="utf-8")
    start = source.index("async def _rustdesk_auto_sync_loop")
    end = source.index("\n\nasync def _trmm_scheduled_broadcast_loop", start)
    worker = source[start:end]

    assert "sync_rustdesk_peers(" in worker
    assert "system-rustdesk-auto-sync" in worker
    assert 'update_many({"rustdesk_id": rd_id}' not in worker
    assert "_rustdesk_api_request" not in worker


def test_legacy_config_write_paths_validate_origins_and_encrypt_tokens(monkeypatch):
    fake_db = _install_db(monkeypatch)

    with pytest.raises(HTTPException):
        asyncio.run(remote.save_remote_settings(
            RustDeskSettings(server_url="http://127.0.0.1", api_key="unsafe"),
            _admin(),
        ))

    asyncio.run(remote_providers.save_provider_settings(
        "rustdesk",
        {"server_url": "rustdesk.example:21114", "api_key": "provider-secret", "active": True},
        _request("PUT", "/api/remote-providers/rustdesk/settings"),
        _admin(),
    ))
    stored = fake_db.settings.rows[0]["value"]
    assert stored["server_url"] == "https://rustdesk.example:21114"
    assert "api_key" not in stored
    assert decrypt_secret(stored["api_key_encrypted"]) == "provider-secret"
