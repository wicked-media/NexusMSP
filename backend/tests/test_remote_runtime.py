import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from app.services import remote_runtime
from app.routers import remote as remote_routes
from app.services.remote_runtime import normalise_session_type, parse_datetime, ticket_links_device


def test_native_session_freshness_is_derived_from_protected_heartbeat():
    now = datetime.now(timezone.utc)
    fresh = remote_routes._native_session_freshness({
        "provider": "nexus", "status": "active", "last_heartbeat_at": now.isoformat(),
    })
    stale = remote_routes._native_session_freshness({
        "provider": "nexus", "status": "active",
        "last_heartbeat_at": (now - timedelta(seconds=30)).isoformat(),
    })

    assert fresh["capture_freshness"] == "fresh"
    assert stale["capture_freshness"] == "stale"


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


class _PolicySettings:
    def __init__(self, rows):
        self.rows = deepcopy(rows)
        self.queries = []

    async def find_one(self, query, _projection=None):
        self.queries.append(deepcopy(query))
        for row in self.rows:
            if row.get("type") != query.get("type"):
                continue
            requested_tenant = query.get("tenant_id")
            if isinstance(requested_tenant, dict) and "$exists" in requested_tenant:
                if ("tenant_id" in row) == requested_tenant["$exists"]:
                    return deepcopy(row)
            elif row.get("tenant_id") == requested_tenant:
                return deepcopy(row)
        return None


class _RemoteSessionCursor:
    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return []


class _RemoteSessionQueries:
    def __init__(self):
        self.find_query = None
        self.find_one_query = None

    def find(self, query, _projection=None):
        self.find_query = deepcopy(query)
        return _RemoteSessionCursor()

    async def find_one(self, query, _projection=None):
        self.find_one_query = deepcopy(query)
        return None


class _RemoteDeviceQueries:
    def __init__(self):
        self.find_one_query = None

    async def find_one(self, query, _projection=None):
        self.find_one_query = deepcopy(query)
        return None


class _ScopedRemoteDevice:
    async def find_one(self, _query, _projection=None):
        return {"id": "device-1", "tenant_id": "tenant-a", "client_id": "client-a"}


class _DeviceChatDeletes:
    def __init__(self):
        self.delete_query = None

    async def delete_many(self, query):
        self.delete_query = deepcopy(query)
        return SimpleNamespace(deleted_count=0)


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


def test_remote_session_types_are_an_explicit_allow_list():
    assert normalise_session_type("TERMINAL") == "terminal"
    try:
        normalise_session_type("arbitrary-shell")
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("unsupported session type should be rejected")


def test_remote_policy_is_tenant_partitioned_with_local_legacy_fallback(monkeypatch):
    settings = _PolicySettings([
        {"type": "remote_access_policy", "tenant_id": "tenant-a", "require_ticket_reference": True},
        {"type": "remote_access_policy", "allow_standing_authorisation": True},
    ])
    monkeypatch.setattr(remote_runtime, "db", SimpleNamespace(settings=settings))

    tenant_policy = asyncio.run(remote_runtime.remote_policy("tenant-a"))
    local_policy = asyncio.run(remote_runtime.remote_policy("nexus-local"))

    assert tenant_policy["require_ticket_reference"] is True
    assert tenant_policy["allow_standing_authorisation"] is False
    assert local_policy["allow_standing_authorisation"] is True
    assert settings.queries == [
        {"type": "remote_access_policy", "tenant_id": "tenant-a"},
        {"type": "remote_access_policy", "tenant_id": "nexus-local"},
        {"type": "remote_access_policy", "tenant_id": {"$exists": False}},
    ]


def test_ticket_device_link_supports_primary_and_multiple_assets():
    assert ticket_links_device({"device_id": "device-1"}, "device-1")
    assert ticket_links_device({"device_ids": ["device-2", "device-3"]}, "device-3")
    assert not ticket_links_device({"device_id": "device-1"}, "device-9")


def test_session_timestamps_accept_zulu_and_reject_invalid_values():
    assert parse_datetime("2026-07-25T08:00:00Z").tzinfo is not None
    assert parse_datetime("not-a-date") is None


def test_native_provider_identity_uses_only_the_linked_nexus_agent():
    assert asyncio.run(remote_runtime.provider_device_id({"nexus_agent_id": "agent-1"}, "nexus")) == "agent-1"
    assert asyncio.run(remote_runtime.provider_device_id({"rustdesk_id": "legacy-peer"}, "rustdesk")) == ""


def test_native_session_rejects_control_mode_before_creating_any_record(monkeypatch):
    async def no_indexes():
        return None

    async def native_policy(*_args):
        return dict(remote_runtime.REMOTE_POLICY_DEFAULTS)

    monkeypatch.setattr(remote_runtime, "ensure_remote_runtime_indexes", no_indexes)
    monkeypatch.setattr(remote_runtime, "remote_policy", native_policy)

    with pytest.raises(HTTPException) as error:
        asyncio.run(remote_runtime.start_remote_session(
            device={"id": "device-1", "client_id": "client-1"},
            user={"id": "tech-1", "tenant_id": "tenant-1"},
            data={"provider": "nexus", "mode": "control"},
        ))

    assert error.value.status_code == 422
    assert "view-only" in error.value.detail


def test_remote_session_list_is_partitioned_by_tenant(monkeypatch):
    sessions = _RemoteSessionQueries()
    monkeypatch.setattr(remote_routes, "db", SimpleNamespace(remote_sessions=sessions))

    result = asyncio.run(remote_routes.get_remote_sessions(
        current_user={"id": "admin-1", "tenant_id": "tenant-a", "is_admin": True},
    ))

    assert result == []
    assert sessions.find_query == {"tenant_id": "tenant-a"}


def test_remote_session_lifecycle_masks_foreign_tenant_before_action(monkeypatch):
    sessions = _RemoteSessionQueries()
    monkeypatch.setattr(remote_routes, "db", SimpleNamespace(remote_sessions=sessions))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(remote_routes.confirm_remote_session_opened(
            "session-from-another-tenant",
            request=None,
            current_user={"id": "tech-1", "tenant_id": "tenant-a", "is_admin": True},
        ))

    assert denied.value.status_code == 404
    assert sessions.find_one_query == {
        "$and": [{"id": "session-from-another-tenant"}, {"tenant_id": "tenant-a"}]
    }


def test_remote_device_entry_points_are_partitioned_by_tenant(monkeypatch):
    devices = _RemoteDeviceQueries()
    monkeypatch.setattr(remote_routes, "db", SimpleNamespace(devices=devices))

    with pytest.raises(HTTPException) as denied:
        asyncio.run(remote_routes.get_device_remote_options(
            "device-from-another-tenant",
            request=None,
            current_user={"id": "admin-1", "tenant_id": "tenant-a", "is_admin": True},
        ))

    assert denied.value.status_code == 404
    assert devices.find_one_query == {
        "$and": [{"id": "device-from-another-tenant"}, {"tenant_id": "tenant-a"}]
    }


def test_remote_device_chat_deletion_is_partitioned_by_tenant(monkeypatch):
    chat = _DeviceChatDeletes()
    monkeypatch.setattr(
        remote_routes,
        "db",
        SimpleNamespace(devices=_ScopedRemoteDevice(), device_chat=chat),
    )

    result = asyncio.run(remote_routes.clear_device_chat(
        "device-1",
        current_user={"id": "admin-1", "tenant_id": "tenant-a", "is_admin": True},
    ))

    assert result == {"message": "Cleared 0 messages"}
    assert chat.delete_query == {
        "$and": [
            {"device_id": "device-1", "client_id": "client-a"},
            {"tenant_id": "tenant-a"},
        ]
    }


def test_url_based_device_chat_transfer_is_retired_without_accessing_storage():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(remote_routes.send_device_file(
            "device-1",
            filename="support-tool.exe",
            file_url="https://untrusted.example/support-tool.exe",
            current_user={"id": "tech-1", "tenant_id": "tenant-a"},
        ))

    assert retired.value.status_code == 410
    assert "governed nexus agent file-transfer" in retired.value.detail.lower()


def test_simulated_device_chat_command_is_retired_without_queuing_work():
    with pytest.raises(HTTPException) as retired:
        asyncio.run(remote_routes.send_device_command(
            "device-1",
            command="systeminfo",
            current_user={"id": "tech-1", "tenant_id": "tenant-a"},
        ))

    assert retired.value.status_code == 410
    assert "nexus terminal & files" in retired.value.detail.lower()
