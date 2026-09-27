"""First-party Nexus Remote control-plane endpoints."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.auth import get_current_user
from app.database import db
from app.routers.nexus_agent import _verify_agent_token
from app.services.native_remote import device_readiness, ensure_native_remote_indexes
from app.services.scope_permissions import assert_client_scope, platform_tenant_id, tenant_scoped_query


router = APIRouter(tags=["Nexus Native Remote"])

# Keep relay-frame delivery aligned with the console's capture freshness window.
# A current transport status alone cannot make an older desktop image safe to show.
NATIVE_REMOTE_FRAME_STALE_SECONDS = 20
NATIVE_REMOTE_MIN_FRAME_INTERVAL_SECONDS = 0.5


class NativeGrantAck(BaseModel):
    outcome: Literal["accepted", "rejected"]
    reason: str = Field(default="", max_length=500)


class NativeTransportState(BaseModel):
    state: Literal["connected", "disconnected"]
    detail: str = Field(default="", max_length=500)


class NativeLocalStop(BaseModel):
    reason: str = Field(default="Endpoint user stopped view-only access", max_length=500)


class NativeFrameUpload(BaseModel):
    sequence: int = Field(ge=1, le=2_147_483_647)
    jpeg_b64: str = Field(min_length=16, max_length=5_600_000)


def _frame_is_current(updated_at: object) -> bool:
    try:
        observed = datetime.fromisoformat(str(updated_at or "").replace("Z", "+00:00"))
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - observed).total_seconds()
        return 0 <= age <= NATIVE_REMOTE_FRAME_STALE_SECONDS
    except (TypeError, ValueError):
        return False


@router.get("/devices/{device_id}/native-remote/readiness")
async def native_remote_readiness(
    device_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    device = await db.devices.find_one(tenant_scoped_query(current_user, {"id": device_id}), {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await assert_client_scope(
        current_user,
        device.get("client_id"),
        site_id=device.get("site_id"),
        operation="device.remote.view",
        request=request,
    )
    return {"device_id": device_id, **await device_readiness(device, platform_tenant_id(current_user))}


@router.get("/nexus-agent/native-remote/grants/pending")
async def pending_native_remote_grant(
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Deliver the next still-valid grant only to its enrolled endpoint."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    device = await db.devices.find_one(
        tenant_scoped_query(agent, {"nexus_agent_id": agent["id"], "client_id": agent.get("client_id"), "archived": {"$ne": True}}),
        {"_id": 0, "id": 1, "client_id": 1},
    )
    if not device:
        raise HTTPException(status_code=409, detail="Agent is not linked to a canonical managed device")
    now = datetime.now(timezone.utc).isoformat()
    grant = await db.native_remote_grants.find_one(
        {
            "tenant_id": platform_tenant_id(agent),
            "agent_id": agent["id"],
            "device_id": device["id"],
            "client_id": device["client_id"],
            "status": {"$in": ["issued", "delivered"]},
            "expires_at": {"$gt": now},
        },
        {"_id": 0},
        sort=[("issued_at", 1)],
    )
    redelivery = False
    if not grant:
        # A bridge restart must not silently restore desktop capture.  It may
        # re-deliver the same still-valid grant only after the server recorded
        # the transport as disconnected; the companion will present consent
        # again and the acknowledgement below remains bound to this session.
        candidate = await db.native_remote_grants.find_one(
            {
                "tenant_id": platform_tenant_id(agent), "agent_id": agent["id"],
                "device_id": device["id"], "client_id": device["client_id"],
                "status": "acknowledged", "agent_outcome": "accepted", "expires_at": {"$gt": now},
            },
            {"_id": 0}, sort=[("acknowledged_at", -1)],
        )
        if candidate:
            resumed = await db.remote_sessions.find_one({
                "id": candidate["session_id"], "tenant_id": platform_tenant_id(agent),
                "device_id": device["id"], "client_id": device["client_id"],
                "status": "active", "transport_state": "disconnected", "ended_at": None,
            })
            if resumed:
                grant = candidate
                redelivery = True
    if not grant:
        return {"grant": None}
    session = await db.remote_sessions.find_one({
        "id": grant["session_id"], "tenant_id": platform_tenant_id(agent),
        "device_id": device["id"], "client_id": device["client_id"],
        "status": {"$in": ["authorised", "active"]}, "authorisation_audited": True,
    })
    if not session:
        return {"grant": None}
    delivered = await db.native_remote_grants.update_one(
        {"id": grant["id"], "tenant_id": platform_tenant_id(agent), "status": {"$in": ["issued", "delivered", "acknowledged"]}, "expires_at": {"$gt": now}},
        {"$set": {"status": "delivered" if not redelivery else "acknowledged", "delivered_at": now, **({"redelivered_at": now} if redelivery else {})}, "$inc": {"delivery_count": 1, **({"redelivery_count": 1} if redelivery else {})}},
    )
    if not delivered.matched_count:
        return {"grant": None}
    return {
        "grant": {
            "id": grant["id"],
            "session_id": grant["session_id"],
            "mode": grant["mode"],
            "technician_name": str(session.get("user_name") or "Nexus Support")[:160],
            "purpose": str(session.get("purpose") or "Technician support session")[:500],
            "key_id": grant["key_id"],
            "public_key_b64": grant["public_key_b64"],
            "payload_b64": grant["payload_b64"],
            "signature_b64": grant["signature_b64"],
            "expires_at": grant["expires_at"],
        }
    }


@router.post("/nexus-agent/native-remote/grants/{session_id}/ack")
async def acknowledge_native_remote_grant(
    session_id: str,
    body: NativeGrantAck,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Record local acceptance or rejection without trusting browser state."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    grant = await db.native_remote_grants.find_one(
        {"session_id": session_id, "tenant_id": platform_tenant_id(agent), "agent_id": agent["id"], "client_id": agent.get("client_id")},
        {"_id": 0},
    )
    if not grant:
        raise HTTPException(status_code=404, detail="Native remote grant not found")
    now = datetime.now(timezone.utc).isoformat()
    if str(grant.get("expires_at") or "") <= now:
        await db.native_remote_grants.update_one(
            {"id": grant["id"], "status": {"$in": ["issued", "delivered", "acknowledged"]}}, {"$set": {"status": "expired", "expired_at": now}}
        )
        raise HTTPException(status_code=410, detail="Native remote grant has expired")
    if grant.get("status") == "acknowledged" and grant.get("agent_outcome") == "accepted" and body.outcome == "accepted":
        return {"session_id": session_id, "status": "acknowledged", "reconnected": True}
    status = "acknowledged" if body.outcome == "accepted" else "rejected"
    changed = await db.native_remote_grants.update_one(
        {"id": grant["id"], "tenant_id": platform_tenant_id(agent), "status": {"$in": ["issued", "delivered"]}, "expires_at": {"$gt": now}},
        {"$set": {
            "status": status,
            "acknowledged_at": now,
            "agent_outcome": body.outcome,
            "agent_reason": body.reason,
        }},
    )
    if not changed.matched_count:
        raise HTTPException(status_code=409, detail="Grant is no longer pending; acknowledgement cannot change it")
    await db.remote_sessions.update_one(
        {"id": session_id, "tenant_id": platform_tenant_id(agent), "device_id": grant["device_id"], "client_id": grant["client_id"], "status": "authorised", "ended_at": None},
        {"$set": {
            "launch_status": "companion_accepted" if body.outcome == "accepted" else "companion_rejected",
            "companion_acknowledged_at": now,
            "companion_reason": body.reason or None,
            **({"status": "ended", "ended_at": now} if body.outcome == "rejected" else {}),
        }},
    )
    return {"session_id": session_id, "status": status}


@router.get("/nexus-agent/native-remote/grants/{session_id}/status")
async def native_remote_grant_status(
    session_id: str,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Allow the companion to fail closed when the server revokes a grant."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    grant = await db.native_remote_grants.find_one(
        {
            "session_id": session_id,
            "tenant_id": platform_tenant_id(agent),
            "agent_id": agent["id"],
            "client_id": agent.get("client_id"),
        },
        {"_id": 0, "id": 1, "session_id": 1, "device_id": 1, "client_id": 1, "status": 1, "expires_at": 1, "revoked_at": 1},
    )
    if not grant:
        raise HTTPException(status_code=404, detail="Native remote grant not found")
    now = datetime.now(timezone.utc).isoformat()
    status = str(grant.get("status") or "")
    if status == "acknowledged" and str(grant.get("expires_at") or "") <= now:
        await db.native_remote_grants.update_one(
            {"id": grant["id"], "tenant_id": platform_tenant_id(agent), "status": "acknowledged", "expires_at": {"$lte": now}},
            {"$set": {"status": "expired", "expired_at": now}},
        )
        status = "expired"
    active = status == "acknowledged" and str(grant.get("expires_at") or "") > now
    if not active:
        terminal_status = "grant_expired" if status == "expired" else "grant_revoked" if status == "revoked" else "grant_inactive"
        # The same protected status check that stops the companion also closes
        # the server lifecycle. This avoids an expired/revoked grant leaving
        # behind an apparently active support session or relay image.
        await db.remote_sessions.update_one(
            {
                "id": session_id, "tenant_id": platform_tenant_id(agent),
                "device_id": grant.get("device_id"), "client_id": grant.get("client_id"),
                "status": {"$in": ["authorised", "active", "ending"]}, "ended_at": None,
            },
            {"$set": {
                "status": "ended", "ended_at": now, "launch_status": terminal_status,
                "transport_state": "disconnected", "transport_detail": "native remote grant is no longer active",
            }},
        )
        await db.native_remote_frames.delete_one({
            "tenant_id": platform_tenant_id(agent), "session_id": session_id,
            "client_id": grant.get("client_id"),
        })
    return {
        "session_id": session_id,
        "active": active,
        "status": status if not active else "active",
        "expires_at": grant.get("expires_at"),
        "revoked_at": grant.get("revoked_at"),
    }


@router.post("/nexus-agent/native-remote/grants/{session_id}/stop")
async def stop_native_remote_from_endpoint(
    session_id: str,
    body: NativeLocalStop,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Terminally revoke an active grant at the attended endpoint's request."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    tenant_id = platform_tenant_id(agent)
    now = datetime.now(timezone.utc).isoformat()
    grant = await db.native_remote_grants.find_one(
        {
            "session_id": session_id, "tenant_id": tenant_id,
            "agent_id": agent["id"], "client_id": agent.get("client_id"),
            "status": "acknowledged", "expires_at": {"$gt": now},
        },
        {"_id": 0},
        sort=[("issued_at", 1)],
    )
    if not grant:
        raise HTTPException(status_code=409, detail="Native remote grant is not active")
    reason = body.reason or "Endpoint user stopped view-only access"
    changed = await db.native_remote_grants.update_one(
        {"id": grant["id"], "tenant_id": tenant_id, "status": "acknowledged", "expires_at": {"$gt": now}},
        {"$set": {"status": "revoked", "revoked_at": now, "revoked_by": "endpoint_user", "revocation_reason": reason}},
    )
    if not changed.matched_count:
        raise HTTPException(status_code=409, detail="Native remote grant is no longer active")
    await db.remote_sessions.update_one(
        {
            "id": session_id, "tenant_id": tenant_id,
            "device_id": grant["device_id"], "client_id": grant["client_id"],
            "status": {"$in": ["authorised", "active"]}, "ended_at": None,
        },
        {"$set": {
            "status": "ended", "ended_at": now, "launch_status": "endpoint_user_stopped",
            "companion_reason": reason, "transport_state": "disconnected", "transport_detail": "endpoint user stopped access",
        }},
    )
    await db.native_remote_frames.delete_one({"tenant_id": tenant_id, "session_id": session_id})
    return {"session_id": session_id, "status": "revoked", "revoked_at": now}


@router.post("/nexus-agent/native-remote/grants/{session_id}/transport")
async def native_remote_transport_state(
    session_id: str,
    body: NativeTransportState,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Record actual companion transport evidence; browsers cannot call this."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    now = datetime.now(timezone.utc).isoformat()
    grant = await db.native_remote_grants.find_one(
        {
            "session_id": session_id,
            "tenant_id": platform_tenant_id(agent),
            "agent_id": agent["id"],
            "client_id": agent.get("client_id"),
            "status": "acknowledged",
            "expires_at": {"$gt": now},
        },
        {"_id": 0},
    )
    if not grant:
        raise HTTPException(status_code=409, detail="Native remote grant is not active")
    update = {
        "transport_state": body.state,
        "transport_detail": body.detail or None,
        "transport_reported_at": now,
    }
    if body.state == "connected":
        update.update({"status": "active", "opened_at": now, "last_heartbeat_at": now, "launch_status": "transport_connected"})
    else:
        update.update({"launch_status": "transport_disconnected", "last_transport_disconnect_at": now})
    changed = await db.remote_sessions.update_one(
        {
            "id": session_id,
            "tenant_id": platform_tenant_id(agent),
            "device_id": grant["device_id"],
            "client_id": grant["client_id"],
            "status": {"$in": ["authorised", "active"]},
            "ended_at": None,
        },
        {"$set": update},
    )
    if not changed.matched_count:
        raise HTTPException(status_code=409, detail="Native remote session is no longer eligible for transport")
    if body.state == "disconnected":
        # A disconnected companion must not leave its last desktop image
        # available for a technician to mistake for a current endpoint view.
        await db.native_remote_frames.delete_one({
            "tenant_id": platform_tenant_id(agent), "session_id": session_id,
            "client_id": grant["client_id"],
        })
    return {"session_id": session_id, "transport_state": body.state, "reported_at": now}


@router.post("/nexus-agent/native-remote/grants/{session_id}/frame")
async def native_remote_frame_upload(
    session_id: str,
    body: NativeFrameUpload,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Replace the short-lived latest view-only frame for one active session."""
    try:
        jpeg = base64.b64decode(body.jpeg_b64, validate=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Frame must be valid base64 JPEG data") from exc
    if not 16 <= len(jpeg) <= 4 * 1024 * 1024 or not jpeg.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=422, detail="Frame must be a bounded JPEG image")
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    tenant_id = platform_tenant_id(agent)
    now_dt = datetime.now(timezone.utc)
    now = now_dt.isoformat()
    frame_cutoff = (now_dt - timedelta(seconds=NATIVE_REMOTE_MIN_FRAME_INTERVAL_SECONDS)).isoformat()
    grant = await db.native_remote_grants.find_one(
        {
            "session_id": session_id, "tenant_id": tenant_id,
            "agent_id": agent["id"], "client_id": agent.get("client_id"),
            "status": "acknowledged", "expires_at": {"$gt": now},
        },
        {"_id": 0, "id": 1, "device_id": 1, "client_id": 1, "last_frame_sequence": 1},
    )
    if not grant:
        raise HTTPException(status_code=409, detail="Native remote grant is not active")
    session = await db.remote_sessions.find_one(
        {"id": session_id, "tenant_id": tenant_id, "device_id": grant["device_id"], "client_id": grant["client_id"], "status": "active", "transport_state": "connected", "ended_at": None},
        {"_id": 0, "id": 1},
    )
    if not session:
        raise HTTPException(status_code=409, detail="Native remote session is not actively connected")
    # A replay or late capture must never replace a frame the technician has
    # already observed.  The sequence reservation is made on the grant before
    # touching the short-lived relay record, and survives a frame-cache TTL.
    reserved = await db.native_remote_grants.update_one(
        {
            "id": grant["id"],
            "tenant_id": tenant_id,
            "status": "acknowledged",
            "expires_at": {"$gt": now},
            "$or": [
                {"last_frame_sequence": {"$exists": False}},
                {"last_frame_sequence": {"$lt": body.sequence}},
            ],
            "$and": [{"$or": [
                {"last_frame_at": {"$exists": False}},
                {"last_frame_at": {"$lte": frame_cutoff}},
            ]}],
        },
        {"$set": {"last_frame_sequence": body.sequence, "last_frame_at": now}},
    )
    if not reserved.matched_count:
        current = await db.native_remote_grants.find_one(
            {"id": grant["id"], "tenant_id": tenant_id}, {"_id": 0, "last_frame_sequence": 1},
        ) or {}
        if body.sequence <= int(current.get("last_frame_sequence") or 0):
            raise HTTPException(status_code=409, detail="Native remote frame is stale or replayed")
        raise HTTPException(status_code=429, detail="Native remote frame rate limit exceeded")
    await ensure_native_remote_indexes()
    try:
        updated = await db.native_remote_frames.update_one(
            {
                "tenant_id": tenant_id,
                "session_id": session_id,
                "$or": [
                    {"sequence": {"$exists": False}},
                    {"sequence": {"$lt": body.sequence}},
                ],
            },
            {"$set": {
                "tenant_id": tenant_id, "session_id": session_id,
                "device_id": grant["device_id"], "client_id": grant["client_id"],
                "sequence": body.sequence, "jpeg": jpeg, "updated_at": now,
                "purge_at": now_dt + timedelta(minutes=2),
            }},
            upsert=True,
        )
    except DuplicateKeyError as exc:
        # The unique session index wins a concurrent late-frame race.  The
        # newer frame remains intact; do not retry as an overwrite.
        raise HTTPException(status_code=409, detail="Native remote frame is stale or replayed") from exc
    if not updated.matched_count and not getattr(updated, "upserted_id", None):
        raise HTTPException(status_code=409, detail="Native remote frame is stale or replayed")
    # Frames are the strongest available evidence that the attended companion
    # is still capturing.  Refresh the session heartbeat only after the relay
    # accepted the strictly ordered frame; rejected/replayed data cannot make
    # a session appear healthy.
    await db.remote_sessions.update_one(
        {
            "id": session_id,
            "tenant_id": tenant_id,
            "device_id": grant["device_id"],
            "client_id": grant["client_id"],
            "status": "active",
            "ended_at": None,
        },
        {"$set": {"last_heartbeat_at": now, "transport_state": "connected", "transport_reported_at": now}},
    )
    return {"session_id": session_id, "sequence": body.sequence, "accepted_at": now}


@router.get("/remote/sessions/{session_id}/native-frame")
async def native_remote_latest_frame(
    session_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Return only the latest ephemeral JPEG after server-side session scope checks."""
    tenant_id = platform_tenant_id(current_user)
    session = await db.remote_sessions.find_one(
        {"id": session_id, "tenant_id": tenant_id, "provider": "nexus", "status": "active", "ended_at": None},
        {"_id": 0, "client_id": 1, "site_id": 1, "transport_state": 1},
    )
    if not session:
        raise HTTPException(status_code=404, detail="An active native remote session was not found")
    await assert_client_scope(current_user, session.get("client_id"), site_id=session.get("site_id"), operation="device.remote.view", request=request)
    if session.get("transport_state") != "connected":
        raise HTTPException(status_code=409, detail="Native remote transport is disconnected; awaiting endpoint reconnect")
    frame = await db.native_remote_frames.find_one(
        {"tenant_id": tenant_id, "session_id": session_id, "client_id": session.get("client_id")},
        {"_id": 0, "jpeg": 1, "sequence": 1, "updated_at": 1},
    )
    if not frame or not isinstance(frame.get("jpeg"), (bytes, bytearray)):
        raise HTTPException(status_code=404, detail="No native remote frame is available yet")
    if not _frame_is_current(frame.get("updated_at")):
        raise HTTPException(status_code=409, detail="Native remote capture is stale; awaiting a newer endpoint frame")
    return Response(
        content=bytes(frame["jpeg"]), media_type="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "X-Nexus-Remote-Sequence": str(frame.get("sequence") or 0),
            # This is server receipt time, not an endpoint-provided clock.  It
            # lets the viewer label the exact capture evidence it received.
            "X-Nexus-Remote-Captured-At": str(frame.get("updated_at") or ""),
        },
    )
