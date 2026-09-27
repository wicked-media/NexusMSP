import asyncio
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import native_remote as routes
from app.services import native_remote, remote_runtime
from test_native_remote import Rows


def setup_endpoint(monkeypatch, *, status="delivered", session_status="authorised", tenant="tenant-1"):
    agent = {"id": "agent-1", "client_id": "client-1", "tenant_id": "tenant-1"}
    grant = {
        "id": "grant-1", "session_id": "session-1", "agent_id": "agent-1",
        "client_id": "client-1", "device_id": "device-1", "tenant_id": tenant,
        "status": status, "expires_at": native_remote._iso(native_remote._now() + timedelta(minutes=5)),
    }
    session = {
        "id": "session-1", "device_id": "device-1", "client_id": "client-1",
        "tenant_id": tenant, "status": session_status,
        "ended_at": None if session_status == "authorised" else "already-ended",
        "authorisation_audited": True,
    }
    database = SimpleNamespace(
        native_remote_grants=Rows([grant]), remote_sessions=Rows([session]),
        native_remote_frames=Rows(), native_remote_control_events=Rows(), settings=Rows(),
    )

    async def verify(*_args):
        return agent

    monkeypatch.setattr(routes, "db", database)
    monkeypatch.setattr(native_remote, "db", database)
    monkeypatch.setattr(routes, "_verify_agent_token", verify)
    return database


@pytest.mark.parametrize("status", ["revoked", "rejected", "expired", "acknowledged"])
def test_terminal_grant_cannot_be_acknowledged(monkeypatch, status):
    database = setup_endpoint(monkeypatch, status=status)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.acknowledge_native_remote_grant("session-1", routes.NativeGrantAck(outcome="accepted")))
    assert error.value.status_code == 409
    assert database.native_remote_grants.rows[0]["status"] == status
    assert "launch_status" not in database.remote_sessions.rows[0]


def test_late_acknowledgement_does_not_resurrect_ended_session(monkeypatch):
    database = setup_endpoint(monkeypatch, session_status="ended")
    asyncio.run(routes.acknowledge_native_remote_grant("session-1", routes.NativeGrantAck(outcome="accepted")))
    assert database.remote_sessions.rows[0]["status"] == "ended"
    assert database.remote_sessions.rows[0]["ended_at"] == "already-ended"
    assert "launch_status" not in database.remote_sessions.rows[0]


def test_agent_cannot_acknowledge_other_tenant(monkeypatch):
    database = setup_endpoint(monkeypatch, tenant="tenant-2")
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.acknowledge_native_remote_grant("session-1", routes.NativeGrantAck(outcome="accepted")))
    assert error.value.status_code == 404
    assert database.native_remote_grants.rows[0]["status"] == "delivered"


def test_browser_cannot_activate_native_session():
    with pytest.raises(HTTPException) as error:
        asyncio.run(remote_runtime.mark_remote_session_opened(
            {"id": "session-1", "provider": "nexus", "status": "authorised", "user_id": "tech-1"},
            {"id": "tech-1"},
        ))
    assert error.value.status_code == 409


def test_authenticated_agent_can_publish_companion_readiness_without_a_session(monkeypatch):
    database = SimpleNamespace(nexus_agents=Rows([{
        "id": "agent-1", "tenant_id": "tenant-1", "client_id": "client-1", "is_active": True,
    }]))

    async def verify(*_args):
        return {"id": "agent-1", "tenant_id": "tenant-1", "client_id": "client-1"}

    monkeypatch.setattr(routes, "db", database)
    monkeypatch.setattr(routes, "_verify_agent_token", verify)

    result = asyncio.run(routes.report_native_remote_companion_health(
        routes.NativeCompanionHealth(status="ready", detail="verified companion connected"),
    ))

    assert result["status"] == "ready"
    evidence = database.nexus_agents.rows[0]["native_remote_evidence"]
    assert evidence["status"] == "ready"
    assert evidence["detail"] == "verified companion connected"
    assert evidence["observed_at"]


def test_unaudited_session_cannot_deliver_grant(monkeypatch):
    database = setup_endpoint(monkeypatch)
    database.remote_sessions.rows[0]["authorisation_audited"] = False
    database.devices = Rows([{
        "id": "device-1", "nexus_agent_id": "agent-1", "client_id": "client-1", "tenant_id": "tenant-1",
    }])
    result = asyncio.run(routes.pending_native_remote_grant())
    assert result == {"grant": None}
    assert database.native_remote_grants.rows[0]["status"] == "delivered"


def test_disconnected_active_session_can_redeliver_only_the_same_accepted_grant(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged", session_status="active")
    database.devices = Rows([{
        "id": "device-1", "nexus_agent_id": "agent-1", "client_id": "client-1", "tenant_id": "tenant-1",
    }])
    database.remote_sessions.rows[0].update({"ended_at": None, "transport_state": "disconnected"})
    database.native_remote_grants.rows[0].update({
        "agent_outcome": "accepted", "mode": "view", "key_id": "key-1", "public_key_b64": "public",
        "payload_b64": "payload", "signature_b64": "signature",
    })

    result = asyncio.run(routes.pending_native_remote_grant())

    assert result["grant"]["session_id"] == "session-1"
    assert database.native_remote_grants.rows[0]["status"] == "acknowledged"
    assert database.native_remote_grants.rows[0]["redelivered_at"]


def test_redelivered_accepted_grant_acknowledgement_is_idempotent(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged", session_status="active")
    database.native_remote_grants.rows[0]["agent_outcome"] = "accepted"

    result = asyncio.run(routes.acknowledge_native_remote_grant(
        "session-1", routes.NativeGrantAck(outcome="accepted"),
    ))

    assert result == {"session_id": "session-1", "status": "acknowledged", "reconnected": True}
    assert database.remote_sessions.rows[0]["status"] == "active"


def test_native_session_end_rejects_other_tenant():
    with pytest.raises(HTTPException) as error:
        asyncio.run(remote_runtime.end_remote_session_record(
            session={"id": "session-1", "provider": "nexus", "tenant_id": "tenant-2", "status": "ended"},
            user={"id": "tech-1", "tenant_id": "tenant-1", "is_admin": True}, data={},
        ))
    assert error.value.status_code == 404


def test_agent_can_read_revocation_status_without_reactivating(monkeypatch):
    database = setup_endpoint(monkeypatch, status="revoked")
    database.native_remote_frames.rows.append({
        "tenant_id": "tenant-1", "session_id": "session-1", "client_id": "client-1", "jpeg": b"frame",
    })
    result = asyncio.run(routes.native_remote_grant_status("session-1"))
    assert result["active"] is False
    assert result["status"] == "revoked"
    assert database.remote_sessions.rows[0]["status"] == "ended"
    assert database.remote_sessions.rows[0]["launch_status"] == "grant_revoked"
    assert database.native_remote_frames.rows == []


def test_status_check_expires_and_closes_an_elapsed_grant(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    database.native_remote_grants.rows[0]["expires_at"] = native_remote._iso(native_remote._now() - timedelta(seconds=1))
    database.native_remote_frames.rows.append({
        "tenant_id": "tenant-1", "session_id": "session-1", "client_id": "client-1", "jpeg": b"frame",
    })

    result = asyncio.run(routes.native_remote_grant_status("session-1"))

    assert result["active"] is False
    assert result["status"] == "expired"
    assert database.native_remote_grants.rows[0]["status"] == "expired"
    assert database.remote_sessions.rows[0]["launch_status"] == "grant_expired"
    assert database.native_remote_frames.rows == []


def test_transport_evidence_activates_only_an_acknowledged_live_grant(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    result = asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="connected", detail="capture started"),
    ))
    assert result["transport_state"] == "connected"
    session = database.remote_sessions.rows[0]
    assert session["status"] == "active"
    assert session["launch_status"] == "transport_connected"


def test_agent_can_relay_only_bounded_jpeg_for_active_session(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="connected"),
    ))
    result = asyncio.run(routes.native_remote_frame_upload(
        "session-1", routes.NativeFrameUpload(sequence=1, jpeg_b64="/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=="),
    ))
    assert result["sequence"] == 1
    assert database.native_remote_frames.rows[0]["jpeg"].startswith(b"\xff\xd8\xff")


def test_replayed_or_out_of_order_frame_cannot_replace_live_view(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="connected"),
    ))
    frame = routes.NativeFrameUpload(sequence=2, jpeg_b64="/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==")
    asyncio.run(routes.native_remote_frame_upload("session-1", frame))

    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.native_remote_frame_upload("session-1", frame))

    assert error.value.status_code == 409
    assert database.native_remote_frames.rows[0]["sequence"] == 2
    assert database.native_remote_grants.rows[0]["last_frame_sequence"] == 2


def test_native_relay_rate_limits_rapid_distinct_frames(monkeypatch):
    setup_endpoint(monkeypatch, status="acknowledged")
    asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="connected"),
    ))
    asyncio.run(routes.native_remote_frame_upload(
        "session-1", routes.NativeFrameUpload(sequence=1, jpeg_b64="/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=="),
    ))

    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.native_remote_frame_upload(
            "session-1", routes.NativeFrameUpload(sequence=2, jpeg_b64="/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=="),
        ))

    assert error.value.status_code == 429


def test_latest_frame_identifies_server_capture_receipt_time(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    database.remote_sessions.rows[0].update({"provider": "nexus", "status": "active", "ended_at": None, "site_id": "site-1", "transport_state": "connected"})
    database.native_remote_frames.rows.append({
        "tenant_id": "tenant-1", "session_id": "session-1", "client_id": "client-1",
        "jpeg": b"\xff\xd8frame", "sequence": 7, "updated_at": native_remote._iso(native_remote._now()),
    })

    async def allow_scope(*_args, **_kwargs):
        return None

    monkeypatch.setattr(routes, "assert_client_scope", allow_scope)
    response = asyncio.run(routes.native_remote_latest_frame(
        "session-1", SimpleNamespace(), {"id": "tech-1", "tenant_id": "tenant-1"},
    ))

    assert response.headers["x-nexus-remote-sequence"] == "7"
    assert response.headers["x-nexus-remote-captured-at"] == database.native_remote_frames.rows[0]["updated_at"]


def test_latest_frame_refuses_stale_capture_even_with_active_transport(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    database.remote_sessions.rows[0].update({"provider": "nexus", "status": "active", "ended_at": None, "site_id": "site-1", "transport_state": "connected"})
    database.native_remote_frames.rows.append({
        "tenant_id": "tenant-1", "session_id": "session-1", "client_id": "client-1",
        "jpeg": b"\xff\xd8frame", "sequence": 7,
        "updated_at": native_remote._iso(native_remote._now() - timedelta(seconds=21)),
    })

    async def allow_scope(*_args, **_kwargs):
        return None

    monkeypatch.setattr(routes, "assert_client_scope", allow_scope)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.native_remote_latest_frame(
            "session-1", SimpleNamespace(), {"id": "tech-1", "tenant_id": "tenant-1"},
        ))
    assert error.value.status_code == 409


def test_endpoint_stop_terminally_revokes_active_native_session(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    database.native_remote_frames = Rows([{
        "tenant_id": "tenant-1", "session_id": "session-1", "client_id": "client-1", "jpeg": b"frame",
    }])
    result = asyncio.run(routes.stop_native_remote_from_endpoint(
        "session-1", routes.NativeLocalStop(reason="User selected stop"),
    ))
    assert result["status"] == "revoked"
    assert database.native_remote_grants.rows[0]["status"] == "revoked"
    assert database.native_remote_grants.rows[0]["revoked_by"] == "endpoint_user"
    assert database.remote_sessions.rows[0]["status"] == "ended"
    assert database.remote_sessions.rows[0]["launch_status"] == "endpoint_user_stopped"
    assert database.native_remote_frames.rows == []


def test_transport_disconnect_removes_last_desktop_frame(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="connected"),
    ))
    asyncio.run(routes.native_remote_frame_upload(
        "session-1", routes.NativeFrameUpload(sequence=1, jpeg_b64="/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=="),
    ))

    asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="disconnected", detail="companion stopped"),
    ))

    assert database.remote_sessions.rows[0]["transport_state"] == "disconnected"
    assert database.native_remote_frames.rows == []


def test_frame_cannot_reactivate_a_disconnected_native_session(monkeypatch):
    database = setup_endpoint(monkeypatch, status="acknowledged")
    asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="connected"),
    ))
    asyncio.run(routes.native_remote_transport_state(
        "session-1", routes.NativeTransportState(state="disconnected"),
    ))

    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.native_remote_frame_upload(
            "session-1", routes.NativeFrameUpload(sequence=1, jpeg_b64="/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=="),
        ))

    assert error.value.status_code == 409
    assert "last_frame_sequence" not in database.native_remote_grants.rows[0]
