"""Security contract for legacy RustDesk registry compatibility routes."""

import asyncio

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routers import rustdesk
from app.services import scope_permissions
from app.services.secret_store import decrypt_secret


class _Result:
    def __init__(self, *, matched_count=1, deleted_count=1):
        self.matched_count = matched_count
        self.deleted_count = deleted_count


def _matches(row, query):
    for key, expected in query.items():
        value = row.get(key)
        if isinstance(expected, dict) and "$in" in expected:
            if value not in expected["$in"]:
                return False
        elif value != expected:
            return False
    return True


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
                row.update(update.get("$set", {}))
                return _Result()
        if upsert:
            self.rows.append({**query, **update.get("$set", {})})
            return _Result()
        return _Result(matched_count=0)

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if _matches(row, query):
                self.rows.pop(index)
                return _Result()
        return _Result(deleted_count=0)


class _DB:
    def __init__(self):
        self.rustdesk_devices = _Collection([
            {
                "id": "rd-a",
                "client_id": "client-a",
                "device_name": "Reception A",
                "rustdesk_id": "100-200",
                "rustdesk_password": "legacy-secret",
            },
            {
                "id": "rd-b",
                "client_id": "client-b",
                "device_name": "Reception B",
                "rustdesk_id": "300-400",
                "rustdesk_password": "foreign-secret",
            },
        ])
        self.clients = _Collection([
            {"id": "client-a", "name": "Client A"},
            {"id": "client-b", "name": "Client B"},
        ])
        self.devices = _Collection()
        self.rustdesk_sessions = _Collection()
        self.settings = _Collection()
        self.scope_denials = _Collection()


def _request(method="GET", path="/api/rustdesk"):
    return Request({"type": "http", "method": method, "path": path, "headers": []})


def _tech(*client_ids):
    return {
        "id": "tech-1",
        "name": "Restricted Tech",
        "role": "technician",
        "client_scope_mode": "restricted",
        "client_scope_ids": list(client_ids),
    }


def _install_db(monkeypatch):
    fake_db = _DB()
    monkeypatch.setattr(rustdesk, "db", fake_db)
    monkeypatch.setattr(scope_permissions, "db", fake_db)
    return fake_db


def test_client_registry_denies_foreign_client_and_audits_scope(monkeypatch):
    fake_db = _install_db(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rustdesk.get_client_rustdesk_devices(
            "client-b", _request(), _tech("client-a")
        ))

    assert exc.value.status_code == 403
    assert fake_db.scope_denials.rows[0]["operation"] == "device.remote.view"


def test_registry_list_redacts_unattended_credentials(monkeypatch):
    fake_db = _install_db(monkeypatch)

    result = asyncio.run(rustdesk.get_client_rustdesk_devices(
        "client-a", _request(), _tech("client-a")
    ))

    assert len(result) == 1
    assert "rustdesk_password" not in result[0]
    assert "rustdesk_password_encrypted" not in result[0]
    assert result[0]["credential_configured"] is True


def test_new_registry_password_is_encrypted_at_rest_and_redacted(monkeypatch):
    fake_db = _install_db(monkeypatch)

    result = asyncio.run(rustdesk.add_rustdesk_device(
        "client-a",
        {"device_name": "Workshop", "rustdesk_id": "500-600", "rustdesk_password": "new-secret"},
        _request("POST"),
        _tech("client-a"),
    ))

    stored = fake_db.rustdesk_devices.rows[-1]
    assert stored.get("rustdesk_password") in (None, "")
    assert decrypt_secret(stored["rustdesk_password_encrypted"]) == "new-secret"
    assert "rustdesk_password" not in result
    assert "rustdesk_password_encrypted" not in result
    assert result["credential_configured"] is True


def test_connection_masks_foreign_record_and_migrates_legacy_secret(monkeypatch):
    fake_db = _install_db(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rustdesk.initiate_rustdesk_connection(
            "rd-b", _request("POST"), _tech("client-a")
        ))
    assert exc.value.status_code == 404

    result = asyncio.run(rustdesk.initiate_rustdesk_connection(
        "rd-a", _request("POST"), _tech("client-a")
    ))
    stored = fake_db.rustdesk_devices.rows[0]
    assert result["rustdesk_password"] == "legacy-secret"
    assert stored.get("rustdesk_password") in (None, "")
    assert decrypt_secret(stored["rustdesk_password_encrypted"]) == "legacy-secret"


def test_all_devices_is_scoped_and_never_returns_passwords(monkeypatch):
    fake_db = _install_db(monkeypatch)
    fake_db.devices.rows = [
        {"id": "dev-a", "client_id": "client-a", "name": "A", "rustdesk_id": "100-200"},
        {"id": "dev-b", "client_id": "client-b", "name": "B", "rustdesk_id": "300-400"},
    ]
    fake_db.rustdesk_devices.rows[0]["linked_device_id"] = "dev-a"
    fake_db.rustdesk_devices.rows[1]["linked_device_id"] = "dev-b"

    result = asyncio.run(rustdesk.get_all_remote_devices(_tech("client-a")))

    assert [row["id"] for row in result] == ["dev-a"]
    assert "rd_password" not in result[0]
    assert result[0]["credential_configured"] is True


def test_assign_remote_identity_enforces_device_scope_and_encrypts_password(monkeypatch):
    fake_db = _install_db(monkeypatch)
    fake_db.devices.rows = [
        {"id": "dev-a", "client_id": "client-a", "client_name": "Client A", "name": "A"},
        {"id": "dev-b", "client_id": "client-b", "client_name": "Client B", "name": "B"},
    ]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(rustdesk.assign_rustdesk_id(
            "dev-b",
            {"rustdesk_id": "999", "rustdesk_password": "foreign"},
            _request("PUT"),
            _tech("client-a"),
        ))
    assert exc.value.status_code == 404

    asyncio.run(rustdesk.assign_rustdesk_id(
        "dev-a",
        {"rustdesk_id": "777", "rustdesk_password": "assigned-secret"},
        _request("PUT"),
        _tech("client-a"),
    ))
    stored = fake_db.rustdesk_devices.rows[-1]
    assert decrypt_secret(stored["rustdesk_password_encrypted"]) == "assigned-secret"
    assert stored.get("rustdesk_password") in (None, "")


def test_global_rustdesk_api_key_is_encrypted_at_rest(monkeypatch):
    fake_db = _install_db(monkeypatch)
    admin = {"id": "admin-1", "name": "Admin", "role": "admin"}

    asyncio.run(rustdesk.save_rustdesk_global_config(
        {"server_url": "https://remote.example", "api_key": "api-secret"},
        _request("POST", "/api/rustdesk/config"),
        admin,
    ))

    value = fake_db.settings.rows[0]["value"]
    assert value.get("api_key") in (None, "")
    assert decrypt_secret(value["api_key_encrypted"]) == "api-secret"
