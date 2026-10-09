import asyncio
import base64
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import HTTPException
import pytest

from app.services import native_remote, remote_runtime


class Rows:
    def __init__(self, rows=None):
        self.rows = deepcopy(rows or [])

    async def create_index(self, *_args, **_kwargs):
        return None

    async def find_one(self, query, _projection=None, **_kwargs):
        for row in self.rows:
            if self.matches(row, query):
                return deepcopy(row)
        return None

    def find(self, query, _projection=None, **_kwargs):
        return _Cursor([row for row in self.rows if self.matches(row, query)])

    @staticmethod
    def matches(row, query):
        for key, value in query.items():
            if key == "$and":
                if not all(Rows.matches(row, part) for part in value):
                    return False
            elif key == "$or":
                if not any(Rows.matches(row, part) for part in value):
                    return False
            elif isinstance(value, dict):
                for op, operand in value.items():
                    actual = row.get(key)
                    if op == "$in" and actual not in operand:
                        return False
                    if op == "$nin" and actual in operand:
                        return False
                    if op == "$gt" and (actual is None or actual <= operand):
                        return False
                    if op == "$lt" and (actual is None or actual >= operand):
                        return False
                    if op == "$lte" and (actual is None or actual > operand):
                        return False
                    if op == "$ne" and actual == operand:
                        return False
                    if op == "$exists" and (key in row) != operand:
                        return False
            elif row.get(key) != value:
                return False
        return True

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if self.matches(row, query):
                row.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            document = {**query, **deepcopy(update.get("$setOnInsert", {})), **deepcopy(update.get("$set", {}))}
            self.rows.append(document)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id="new")
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def insert_one(self, document):
        self.rows.append(deepcopy(document))
        return SimpleNamespace(inserted_id=document.get("id"))

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if self.matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class ProjectionRows(Rows):
    """Capture the requested database projection for persistence-bound tests."""

    def __init__(self, rows=None):
        super().__init__(rows)
        self.last_projection = None

    async def find_one(self, query, projection=None, **kwargs):
        self.last_projection = deepcopy(projection)
        return await super().find_one(query, projection, **kwargs)


class _Cursor:
    def __init__(self, rows):
        self.rows = deepcopy(rows)

    async def to_list(self, _limit):
        return deepcopy(self.rows)


def test_native_grant_is_signed_bound_and_idempotent(monkeypatch):
    database = SimpleNamespace(
        settings=Rows(),
        native_remote_grants=Rows(),
        native_remote_control_events=Rows(),
        native_remote_frames=Rows(),
        nexus_agents=Rows(),
    )
    monkeypatch.setattr(native_remote, "db", database)
    session = {
        "id": "session-1",
        "device_id": "device-1",
        "client_id": "client-1",
        "site_id": "site-1",
        "provider_device_id": "agent-1",
    }
    user = {"id": "tech-1", "tenant_id": "tenant-1"}

    first = asyncio.run(native_remote.issue_grant(session=session, user=user, mode="view"))
    second = asyncio.run(native_remote.issue_grant(session=session, user=user, mode="view"))

    assert first == second
    assert len(database.native_remote_grants.rows) == 1
    assert "payload_b64" not in first
    assert "signature_b64" not in first
    stored = database.native_remote_grants.rows[0]
    payload = base64.b64decode(stored["payload_b64"])
    signature = base64.b64decode(stored["signature_b64"])
    public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(first["public_key_b64"]))
    public_key.verify(signature, native_remote.GRANT_DOMAIN + payload)
    assert b'"tenant_id":"tenant-1"' in payload
    assert b'"device_id":"device-1"' in payload
    assert b'"actor_id":"tech-1"' in payload
    expires_at = datetime.fromisoformat(stored["expires_at"])
    assert 23 * 60 * 60 <= (expires_at - datetime.now(timezone.utc)).total_seconds() <= 24 * 60 * 60


def test_native_grant_allows_only_attended_control(monkeypatch):
    database = SimpleNamespace(settings=Rows(), native_remote_grants=Rows(), native_remote_control_events=Rows(), native_remote_frames=Rows(), nexus_agents=Rows())
    monkeypatch.setattr(native_remote, "db", database)
    grant = asyncio.run(native_remote.issue_grant(
        session={"id": "session-1", "device_id": "device-1", "client_id": "client-1", "provider_device_id": "agent-1"},
        user={"id": "tech-1", "tenant_id": "tenant-1"},
        mode="control",
    ))
    assert grant["mode"] == "control"
    with pytest.raises(HTTPException) as error:
        asyncio.run(native_remote.issue_grant(
            session={"id": "session-2", "device_id": "device-2", "client_id": "client-1", "provider_device_id": "agent-2"},
            user={"id": "tech-1", "tenant_id": "tenant-1"},
            mode="control", consent_required=False,
        ))
    assert error.value.status_code == 422
    assert len(database.native_remote_grants.rows) == 1


def test_expired_grants_close_abandoned_sessions_and_remove_relay_frame(monkeypatch):
    database = SimpleNamespace(
        native_remote_grants=Rows([{
            "id": "grant-1", "tenant_id": "tenant-1", "session_id": "session-1",
            "device_id": "device-1", "client_id": "client-1", "status": "acknowledged",
            "expires_at": native_remote._iso(native_remote._now()),
        }, {
            "id": "other-tenant", "tenant_id": "tenant-2", "session_id": "session-2",
            "device_id": "device-2", "client_id": "client-2", "status": "acknowledged",
            "expires_at": native_remote._iso(native_remote._now()),
        }]),
        native_remote_control_events=Rows(),
        remote_sessions=Rows([{
            "id": "session-1", "tenant_id": "tenant-1", "device_id": "device-1",
            "client_id": "client-1", "status": "active", "ended_at": None,
        }]),
        native_remote_frames=Rows([{
            "tenant_id": "tenant-1", "session_id": "session-1", "client_id": "client-1", "jpeg": b"frame",
        }]),
    )
    monkeypatch.setattr(native_remote, "db", database)

    assert asyncio.run(native_remote.expire_overdue_grants(tenant_id="tenant-1")) == 1
    assert database.native_remote_grants.rows[0]["status"] == "expired"
    assert database.native_remote_grants.rows[1]["status"] == "acknowledged"
    assert database.remote_sessions.rows[0]["status"] == "ended"
    assert database.remote_sessions.rows[0]["launch_status"] == "grant_expired"
    assert database.native_remote_frames.rows == []


def test_native_grants_are_single_active_session_per_endpoint(monkeypatch):
    database = SimpleNamespace(settings=Rows(), native_remote_grants=Rows(), native_remote_control_events=Rows(), native_remote_frames=Rows(), nexus_agents=Rows())
    monkeypatch.setattr(native_remote, "db", database)
    user = {"id": "tech-1", "tenant_id": "tenant-1"}
    first = {"id": "session-1", "device_id": "device-1", "client_id": "client-1", "provider_device_id": "agent-1"}
    second = {**first, "id": "session-2"}

    asyncio.run(native_remote.issue_grant(session=first, user=user, mode="view"))
    with pytest.raises(HTTPException) as error:
        asyncio.run(native_remote.issue_grant(session=second, user=user, mode="view"))

    assert error.value.status_code == 409
    assert len(database.native_remote_grants.rows) == 1


def test_revoked_native_grant_releases_endpoint_for_new_authorisation(monkeypatch):
    database = SimpleNamespace(settings=Rows(), native_remote_grants=Rows(), native_remote_control_events=Rows(), native_remote_frames=Rows(), nexus_agents=Rows())
    monkeypatch.setattr(native_remote, "db", database)
    user = {"id": "tech-1", "tenant_id": "tenant-1"}
    first = {"id": "session-1", "device_id": "device-1", "client_id": "client-1", "provider_device_id": "agent-1"}
    second = {**first, "id": "session-2"}

    asyncio.run(native_remote.issue_grant(session=first, user=user, mode="view"))
    assert asyncio.run(native_remote.revoke_grant(tenant_id="tenant-1", session_id="session-1", actor_id="tech-1", reason="Technician ended session"))
    replacement = asyncio.run(native_remote.issue_grant(session=second, user=user, mode="view"))

    assert replacement["session_id"] == "session-2"
    assert database.native_remote_grants.rows[0]["status"] == "revoked"
    assert database.native_remote_grants.rows[1]["status"] == "issued"


def test_terminal_session_grant_is_reconciled_before_new_endpoint_authorisation(monkeypatch):
    database = SimpleNamespace(
        settings=Rows(), native_remote_grants=Rows(), native_remote_control_events=Rows(),
        native_remote_frames=Rows(), nexus_agents=Rows(),
        remote_sessions=Rows([{"id": "session-1", "tenant_id": "tenant-1", "status": "ended"}]),
    )
    monkeypatch.setattr(native_remote, "db", database)
    user = {"id": "tech-1", "tenant_id": "tenant-1"}
    first = {"id": "session-1", "device_id": "device-1", "client_id": "client-1", "provider_device_id": "agent-1"}
    second = {**first, "id": "session-2"}

    asyncio.run(native_remote.issue_grant(session=first, user=user, mode="view"))
    replacement = asyncio.run(native_remote.issue_grant(session=second, user=user, mode="view"))

    assert replacement["session_id"] == "session-2"
    assert database.native_remote_grants.rows[0]["status"] == "revoked"


def test_native_readiness_requires_online_capable_linked_agent(monkeypatch):
    database = SimpleNamespace(
        nexus_agents=ProjectionRows([{
            "id": "agent-1",
            "client_id": "client-1",
            "is_active": True,
            "last_seen": native_remote._iso(native_remote._now()),
            "runtime_capabilities": [native_remote.RUNTIME_CAPABILITY],
                "native_remote_evidence": {"status": "ready"},
        }]),
    )
    monkeypatch.setattr(native_remote, "db", database)

    result = asyncio.run(native_remote.device_readiness({
        "id": "device-1", "client_id": "client-1", "nexus_agent_id": "agent-1",
    }))
    missing = asyncio.run(native_remote.device_readiness({"id": "device-2", "client_id": "client-1"}))

    assert result["ready"] is True
    assert result["agent_id"] == "agent-1"
    assert result["companion_capability"] == native_remote.RUNTIME_CAPABILITY
    assert result["agent_last_seen"]
    assert result["checked_at"]
    assert database.nexus_agents.last_projection["native_remote_evidence"] == 1
    assert missing == {
        "ready": False,
        "state": "not_enrolled",
        "detail": "Install and link the Nexus Agent before starting native remote access.",
    }


def test_third_party_remote_launches_are_retired(monkeypatch):
    async def no_indexes():
        return None

    async def native_policy(*_args):
        return dict(remote_runtime.REMOTE_POLICY_DEFAULTS)

    monkeypatch.setattr(remote_runtime, "ensure_remote_runtime_indexes", no_indexes)
    monkeypatch.setattr(remote_runtime, "remote_policy", native_policy)

    with pytest.raises(HTTPException) as retired:
        asyncio.run(remote_runtime.start_remote_session(
            device={"id": "device-1", "client_id": "client-1"},
            user={"id": "tech-1", "tenant_id": "tenant-1"},
            data={"provider": "rustdesk"},
        ))

    assert retired.value.status_code == 410
    assert "retired" in retired.value.detail.lower()
