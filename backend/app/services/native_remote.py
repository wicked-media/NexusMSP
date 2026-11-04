"""Nexus Native Remote trust and grant lifecycle.

This module owns the server side of the first-party remote session boundary.
It deliberately does not implement desktop capture, input injection or relay
transport.  A grant is useful only to an enrolled Nexus Agent advertising the
``native_remote_v1`` runtime capability.
"""

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException

from app.database import db
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query
from app.services.secret_store import decrypt_secret, encrypt_secret


GRANT_DOMAIN = b"nexus-remote-grant-v1\x00"
RUNTIME_CAPABILITY = "native_remote_v1"
UNATTENDED_RUNTIME_CAPABILITY = "native_remote_v2"
# Attended support should not interrupt a technician in the middle of a real
# repair.  This is deliberately a bounded day-long lease rather than an
# indefinite credential: endpoint stop, technician end, revocation and stale
# transport handling remain immediate, while an abandoned session still fails
# closed without relying on a browser timer.
ATTENDED_GRANT_TTL_HOURS = 24
ONLINE_WINDOW_SECONDS = 300
CONTROL_EVENT_TTL_SECONDS = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _decode_private_key(value: str) -> Ed25519PrivateKey:
    try:
        raw = base64.b64decode(value, validate=True)
        if len(raw) != 32:
            raise ValueError("invalid length")
        return Ed25519PrivateKey.from_private_bytes(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Nexus Remote signing identity is invalid") from exc


def _public_bytes(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


async def ensure_native_remote_indexes() -> None:
    await db.native_remote_grants.create_index(
        [("tenant_id", 1), ("session_id", 1)],
        unique=True,
        name="native_remote_tenant_session_unique",
    )
    await db.native_remote_frames.create_index(
        [("tenant_id", 1), ("session_id", 1)],
        unique=True,
        name="native_remote_frame_per_session",
    )
    await db.native_remote_frames.create_index(
        "purge_at",
        expireAfterSeconds=0,
        name="native_remote_frame_retention",
    )
    await db.native_remote_grants.create_index(
        [("tenant_id", 1), ("device_id", 1), ("status", 1), ("expires_at", 1)],
        name="native_remote_device_delivery",
    )
    await db.native_remote_grants.create_index(
        "purge_at",
        expireAfterSeconds=0,
        name="native_remote_grant_retention",
    )
    await db.native_remote_control_events.create_index(
        [("tenant_id", 1), ("session_id", 1), ("sequence", 1)],
        unique=True,
        name="native_remote_control_event_sequence",
    )
    await db.native_remote_control_events.create_index(
        "purge_at",
        expireAfterSeconds=0,
        name="native_remote_control_event_retention",
    )
    await db.settings.create_index(
        [("type", 1), ("tenant_id", 1)],
        unique=True,
        partialFilterExpression={"type": "native_remote_trust"},
        name="native_remote_trust_per_tenant",
    )


async def signing_identity(tenant_id: str) -> tuple[Ed25519PrivateKey, dict[str, str]]:
    """Load or create the encrypted per-tenant signing identity."""
    tenant = str(tenant_id or "").strip()
    if not tenant:
        raise RuntimeError("Nexus Remote tenant binding is required")
    query = {"type": "native_remote_trust", "tenant_id": tenant}
    record = await db.settings.find_one(query, {"_id": 0})
    if not record:
        key = Ed25519PrivateKey.generate()
        private_raw = key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        )
        public_raw = _public_bytes(key)
        public_b64 = base64.b64encode(public_raw).decode("ascii")
        candidate = {
            **query,
            "key_id": hashlib.sha256(public_raw).hexdigest()[:24],
            "private_key_encrypted": encrypt_secret(base64.b64encode(private_raw).decode("ascii")),
            "public_key_b64": public_b64,
            "algorithm": "Ed25519",
            "created_at": _iso(_now()),
        }
        await db.settings.update_one(query, {"$setOnInsert": candidate}, upsert=True)
        record = await db.settings.find_one(query, {"_id": 0})
    encrypted = str((record or {}).get("private_key_encrypted") or "")
    private_b64 = decrypt_secret(encrypted)
    if not private_b64:
        raise RuntimeError("Nexus Remote signing identity cannot be decrypted")
    key = _decode_private_key(private_b64)
    public_raw = _public_bytes(key)
    public_b64 = base64.b64encode(public_raw).decode("ascii")
    if public_b64 != str(record.get("public_key_b64") or ""):
        raise RuntimeError("Nexus Remote signing identity failed its integrity check")
    return key, {
        "key_id": str(record.get("key_id") or hashlib.sha256(public_raw).hexdigest()[:24]),
        "public_key_b64": public_b64,
    }


def _agent_capabilities(agent: dict[str, Any]) -> set[str]:
    values = (
        list(agent.get("agent_runtime_capabilities") or agent.get("runtime_capabilities") or [])
        + list(agent.get("nexus_shield_capabilities") or agent.get("capabilities") or [])
    )
    return {str(value).strip().lower() for value in values if value}


async def device_readiness(device: dict[str, Any], tenant_id: str | None = None) -> dict[str, Any]:
    """Return the native companion state for one canonical managed device."""
    agent_id = str(device.get("nexus_agent_id") or "").strip()
    client_id = str(device.get("client_id") or "").strip()
    if not agent_id or not client_id:
        return {
            "ready": False,
            "state": "not_enrolled",
            "detail": "Install and link the Nexus Agent before starting native remote access.",
        }
    expected_tenant = str(tenant_id or "").strip()
    agent = await db.nexus_agents.find_one(
        tenant_scoped_query({"tenant_id": expected_tenant or "nexus-local"}, {"id": agent_id, "client_id": client_id, "is_active": True}),
        {
            "_id": 0,
            "id": 1,
            "tenant_id": 1,
            "last_seen": 1,
            "nexus_shield_capabilities": 1,
            "agent_runtime_capabilities": 1,
            # Readiness is reported by the authenticated agent heartbeat.  Keep
            # it in this explicit projection so the server-side decision uses
            # the same evidence that is persisted for the endpoint.
            "native_remote_evidence": 1,
        },
    )
    if not agent:
        return {"ready": False, "state": "agent_unavailable", "detail": "The linked Nexus Agent is inactive."}
    agent_tenant = str(agent.get("tenant_id") or "nexus-local").strip()
    if expected_tenant and agent_tenant != expected_tenant:
        return {
            "ready": False,
            "state": "trust_reenrollment_required",
            "detail": "Re-enrol this Nexus Agent so its native trust key matches the current tenant.",
        }
    last_seen = agent.get("last_seen")
    try:
        observed = datetime.fromisoformat(str(last_seen).replace("Z", "+00:00"))
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        observed = None
    online = bool(observed and 0 <= (_now() - observed).total_seconds() <= ONLINE_WINDOW_SECONDS)
    if not online:
        return {"ready": False, "state": "agent_offline", "detail": "The Nexus Agent is offline or stale."}
    if RUNTIME_CAPABILITY not in _agent_capabilities(agent):
        return {
            "ready": False,
            "state": "companion_required",
            "detail": "This agent build does not contain the Nexus Remote Companion yet.",
        }
    evidence = agent.get("native_remote_evidence") if isinstance(agent.get("native_remote_evidence"), dict) else {}
    if str(evidence.get("status") or "") != "ready":
        return {
            "ready": False,
            "state": str(evidence.get("status") or "readiness_unreported"),
            "detail": str(evidence.get("detail") or "The Remote Companion has not reported a verified signed-in user session yet."),
            "agent_id": agent_id,
            "agent_last_seen": last_seen,
        }
    return {
        "ready": True,
        "state": "ready",
        "detail": "The enrolled Nexus Agent is online and advertises the native remote capability.",
        "agent_id": agent_id,
        "agent_last_seen": last_seen,
        "companion_capability": RUNTIME_CAPABILITY,
        "unattended_ready": UNATTENDED_RUNTIME_CAPABILITY in _agent_capabilities(agent),
        "checked_at": _iso(_now()),
    }


async def issue_grant(*, session: dict[str, Any], user: dict[str, Any], mode: str, consent_required: bool = True) -> dict[str, Any]:
    """Issue one short-lived, device-bound, signed grant for an authorised session."""
    if mode not in {"view", "control"}:
        raise HTTPException(status_code=422, detail="Choose a supported Nexus Native Remote access mode")
    if mode == "control" and not consent_required:
        raise HTTPException(status_code=422, detail="Interactive control always requires fresh endpoint consent")
    tenant_id = platform_tenant_id(user)
    session_id = str(session.get("id") or "").strip()
    device_id = str(session.get("device_id") or "").strip()
    client_id = str(session.get("client_id") or "").strip()
    actor_id = str(user.get("id") or "").strip()
    if not all((session_id, device_id, client_id, actor_id, session.get("provider_device_id"))):
        raise RuntimeError("Nexus Remote grant is missing a stable scope binding")
    if session.get("tenant_id", tenant_id) != tenant_id:
        raise HTTPException(status_code=404, detail="Remote session not found")
    await ensure_native_remote_indexes()
    existing = await db.native_remote_grants.find_one(
        {"tenant_id": tenant_id, "session_id": session_id}, {"_id": 0}
    )
    if existing:
        if (existing.get("device_id") != device_id or existing.get("client_id") != client_id
                or existing.get("actor_id") != actor_id or existing.get("mode") != mode
                or existing.get("status") not in {"issued", "delivered", "acknowledged"}
                or str(existing.get("expires_at") or "") <= _iso(_now())):
            raise HTTPException(status_code=409, detail="Existing native grant does not match an active request")
        return _public_grant(existing)
    active_for_endpoint = await db.native_remote_grants.find_one(
        {
            "tenant_id": tenant_id,
            "client_id": client_id,
            "device_id": device_id,
            "agent_id": session.get("provider_device_id"),
            "session_id": {"$ne": session_id},
            "status": {"$in": ["issued", "delivered", "acknowledged"]},
            "expires_at": {"$gt": _iso(_now())},
        },
        {"_id": 0, "session_id": 1},
    )
    # A request can be closed by the server while the endpoint is still
    # presenting consent (for example after a transport restart). Reconcile
    # that terminal session before enforcing the one-grant-per-endpoint rule;
    # otherwise its delivered grant would strand the endpoint for the rest of
    # the lease. This remains fail-closed for every non-terminal session.
    if active_for_endpoint and getattr(db, "remote_sessions", None) is not None:
        prior_session = await db.remote_sessions.find_one(
            {"tenant_id": tenant_id, "id": active_for_endpoint["session_id"]},
            {"_id": 0, "status": 1},
        )
        if prior_session and prior_session.get("status") == "ended":
            await revoke_grant(
                tenant_id=tenant_id,
                session_id=active_for_endpoint["session_id"],
                actor_id=actor_id,
                reason="Reconciled stale grant from a terminal remote session",
            )
            active_for_endpoint = None
    if active_for_endpoint:
        raise HTTPException(
            status_code=409,
            detail="This endpoint already has an active Nexus Native Remote grant",
        )
    key, identity = await signing_identity(tenant_id)
    issued_at = _now()
    expires_at = issued_at + timedelta(hours=ATTENDED_GRANT_TTL_HOURS)
    payload = {
        "version": 1 if consent_required else 2,
        "session_id": session_id,
        "tenant_id": tenant_id,
        "device_id": device_id,
        "actor_id": actor_id,
        "mode": mode,
        "issued_at": _iso(issued_at),
        "expires_at": _iso(expires_at),
    }
    if not consent_required:
        payload.update({
            "consent_required": False,
            "technician_name": str(user.get("name") or user.get("email") or "Nexus Support")[:160],
            "purpose": str(session.get("purpose") or "Technician support session")[:500],
        })
    payload_bytes = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    signature = key.sign(GRANT_DOMAIN + payload_bytes)
    record = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "client_id": client_id,
        "site_id": session.get("site_id"),
        "device_id": device_id,
        "agent_id": session.get("provider_device_id"),
        "session_id": session_id,
        "actor_id": actor_id,
        "mode": mode,
        "key_id": identity["key_id"],
        "public_key_b64": identity["public_key_b64"],
        "payload_b64": base64.b64encode(payload_bytes).decode("ascii"),
        "signature_b64": base64.b64encode(signature).decode("ascii"),
        "payload_sha256": hashlib.sha256(payload_bytes).hexdigest(),
        "status": "issued",
        "issued_at": payload["issued_at"],
        "expires_at": payload["expires_at"],
        "purge_at": expires_at + timedelta(days=30),
        "delivered_at": None,
        "acknowledged_at": None,
        "revoked_at": None,
    }
    await db.native_remote_grants.insert_one(dict(record))
    return _public_grant(record)


def _public_grant(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record.get("id"),
        "session_id": record.get("session_id"),
        "mode": record.get("mode"),
        "status": record.get("status"),
        "key_id": record.get("key_id"),
        "public_key_b64": record.get("public_key_b64"),
        "expires_at": record.get("expires_at"),
    }


async def grant_for_session(*, tenant_id: str, session_id: str) -> dict[str, Any] | None:
    record = await db.native_remote_grants.find_one(
        {"tenant_id": tenant_id, "session_id": session_id}, {"_id": 0}
    )
    return _public_grant(record) if record else None


async def expire_overdue_grants(*, tenant_id: str) -> int:
    """Close expired native sessions even when the endpoint is no longer polling.

    The companion performs this cleanup during its protected status check, but
    an endpoint can be shut down or its companion can exit before that happens.
    Reconcile the server-side lifecycle on technician reads as well so an old
    signed grant can never leave an endpoint shown as actively accessible.
    """
    tenant = str(tenant_id or "").strip()
    if not tenant:
        return 0
    now = _iso(_now())
    grants = await db.native_remote_grants.find(
        {
            "tenant_id": tenant,
            "status": {"$in": ["issued", "delivered", "acknowledged"]},
            "expires_at": {"$lte": now},
        },
        {"_id": 0, "id": 1, "session_id": 1, "device_id": 1, "client_id": 1},
    ).to_list(500)
    expired = 0
    for grant in grants:
        changed = await db.native_remote_grants.update_one(
            {
                "id": grant["id"],
                "tenant_id": tenant,
                "status": {"$in": ["issued", "delivered", "acknowledged"]},
                "expires_at": {"$lte": now},
            },
            {"$set": {"status": "expired", "expired_at": now}},
        )
        if not getattr(changed, "matched_count", 0):
            continue
        expired += 1
        await db.remote_sessions.update_one(
            {
                "id": grant["session_id"],
                "tenant_id": tenant,
                "device_id": grant.get("device_id"),
                "client_id": grant.get("client_id"),
                "status": {"$in": ["authorised", "active", "ending"]},
                "ended_at": None,
            },
            {"$set": {
                "status": "ended", "ended_at": now, "launch_status": "grant_expired",
                "transport_state": "disconnected", "transport_detail": "native remote grant expired",
            }},
        )
        await db.native_remote_frames.delete_one(
            {"tenant_id": tenant, "session_id": grant["session_id"], "client_id": grant.get("client_id")}
        )
    return expired


async def revoke_grant(*, tenant_id: str, session_id: str, actor_id: str, reason: str) -> bool:
    # A relay frame is a transient view of an attended desktop, never a
    # recording. Remove it even for an idempotent revoke so no end path can
    # leave capture data readable after the grant becomes terminal.
    await db.native_remote_frames.delete_one({
        "tenant_id": tenant_id,
        "session_id": session_id,
    })
    now = _iso(_now())
    result = await db.native_remote_grants.update_one(
        {"tenant_id": tenant_id, "session_id": session_id, "status": {"$nin": ["revoked", "expired"]}},
        {"$set": {
            "status": "revoked",
            "revoked_at": now,
            "revoked_by": actor_id,
            "revocation_reason": str(reason or "Session ended")[:500],
        }},
    )
    return bool(getattr(result, "matched_count", 0))
