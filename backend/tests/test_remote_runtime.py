import asyncio
from copy import deepcopy
from types import SimpleNamespace

from fastapi import HTTPException

from app.services import remote_runtime
from app.services.remote_runtime import (
    build_rustdesk_uri,
    normalise_session_type,
    parse_datetime,
    ticket_links_device,
)


class _RustDeskRegistry:
    def __init__(self, row):
        self.row = row
        self.query = None

    async def find_one(self, query, _projection=None):
        self.query = query
        if self.row and self.row.get("client_id") == query.get("client_id"):
            return dict(self.row)
        return None


class _RuntimeDB:
    def __init__(self, registry_row):
        self.rustdesk_devices = _RustDeskRegistry(registry_row)


class _Rows:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])

    async def find_one(self, query, _projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return deepcopy(row)
        return None

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def update_one(self, query, update):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class _WorkSessionRuntimeDB:
    def __init__(self):
        self.tickets = _Rows([{
            "id": "ticket-1",
            "client_id": "client-1",
            "device_id": "device-1",
            "ticket_number": "INC-101",
            "title": "Restore Outlook access",
        }])
        self.nexus_work_sessions = _Rows([{
            "id": "work-1",
            "ticket_id": "ticket-1",
            "client_id": "client-1",
            "started_by": "tech-1",
            "status": "active",
        }])
        self.clients = _Rows([{"id": "client-1", "name": "Northwind Dental"}])
        self.remote_sessions = _Rows()
        self.time_entries = _Rows()


def test_rustdesk_uri_uses_configured_relay_without_credentials():
    uri = build_rustdesk_uri(
        "842931675",
        "https://relay.nexus.example:21117/path",
        "https://fallback.nexus.example",
    )
    assert uri == "rustdesk://842931675@relay.nexus.example"
    assert "password" not in uri


def test_rustdesk_uri_falls_back_to_server_then_plain_identity():
    assert build_rustdesk_uri("42", None, "id.nexus.example:21116") == "rustdesk://42@id.nexus.example"
    assert build_rustdesk_uri("42") == "rustdesk://42"


def test_remote_session_types_are_an_explicit_allow_list():
    assert normalise_session_type("TERMINAL") == "terminal"
    try:
        normalise_session_type("arbitrary-shell")
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("unsupported session type should be rejected")


def test_ticket_device_link_supports_primary_and_multiple_assets():
    assert ticket_links_device({"device_id": "device-1"}, "device-1")
    assert ticket_links_device({"device_ids": ["device-2", "device-3"]}, "device-3")
    assert not ticket_links_device({"device_id": "device-1"}, "device-9")


def test_session_timestamps_accept_zulu_and_reject_invalid_values():
    assert parse_datetime("2026-07-25T08:00:00Z").tzinfo is not None
    assert parse_datetime("not-a-date") is None


def test_rustdesk_registry_mapping_requires_the_same_canonical_client(monkeypatch):
    fake_db = _RuntimeDB({
        "client_id": "client-b",
        "linked_device_id": "device-a",
        "rustdesk_id": "peer-b",
    })
    monkeypatch.setattr(remote_runtime, "db", fake_db)

    remote_id = asyncio.run(remote_runtime.provider_device_id(
        {"id": "device-a", "client_id": "client-a"},
        "rustdesk",
    ))

    assert remote_id == ""
    assert fake_db.rustdesk_devices.query["client_id"] == "client-a"
    assert asyncio.run(remote_runtime.provider_device_id(
        {"id": "unowned-device", "client_id": ""},
        "rustdesk",
    )) == ""
