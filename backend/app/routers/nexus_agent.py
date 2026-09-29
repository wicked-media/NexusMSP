"""
NexusOps Agent Ã¢â‚¬â€ backend router.

Endpoints:
  AGENT-FACING (auth via X-Agent-Token):
    POST /api/nexus-agent/enroll
    POST /api/nexus-agent/heartbeat
    GET  /api/nexus-agent/commands/poll
    POST /api/nexus-agent/command-result

  ADMIN-FACING (auth via JWT Bearer):
    GET    /api/nexus-agent/agents
    GET    /api/nexus-agent/agents/{device_id}
    POST   /api/nexus-agent/agents/{device_id}/command
    GET    /api/nexus-agent/agents/{device_id}/commands
    POST   /api/nexus-agent/installers/build           Ã¢â‚¬â€ generate installer for a client
    GET    /api/nexus-agent/installers/{token}/download Ã¢â‚¬â€ download installer ZIP (public, token-protected)
    GET    /api/nexus-agent/binary/latest              Ã¢â‚¬â€ latest agent .exe (public)
    GET    /api/nexus-agent/settings                   Ã¢â‚¬â€ admin settings
    PUT    /api/nexus-agent/settings                   Ã¢â‚¬â€ update settings
"""
from __future__ import annotations

import io
import json
import hashlib
import ipaddress
import logging
import os
import re
import secrets
import time
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path, PureWindowsPath
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.agent_trust import (
    agent_trust_state,
    build_agent_policy,
    issue_device_certificate,
    sign_agent_command_payload,
    sign_update_manifest,
)
from app.services.action_permissions import require_action
from app.services.native_remote import signing_identity
from app.services.platform_foundation import emit_platform_event
from app.services.scope_permissions import assert_client_scope, assert_record_scope, platform_tenant_id, scoped_query
from app.services.time_machine import record_endpoint_state_snapshot

logger = logging.getLogger("nexus_agent")
router = APIRouter(tags=["NexusOps Agent"])

ONLINE_WINDOW_SECONDS = 180
MAX_FLEET_TARGETS = 200
COMMAND_AUTHORIZATION_TTL_SECONDS = 300
INSTALLER_DOWNLOAD_TTL_HOURS = min(
    max(int(os.environ.get("NEXUS_AGENT_INSTALLER_DOWNLOAD_TTL_HOURS", "24")), 1),
    24 * 30,
)

# Where the compiled Windows agent binary lives. Production can set
# NEXUS_AGENT_BINARY; local development uses the repository's agent/dist.
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_LOCAL_AGENT_BINARY = _PROJECT_ROOT / "agent" / "dist" / "nexus-agent.exe"
_CONTAINER_AGENT_BINARY = Path("/app/agent/dist/nexus-agent.exe")
_LOCAL_CHAT_COMPANION_BINARY = _PROJECT_ROOT / "agent" / "dist" / "nexus-client-chat.exe"
_CONTAINER_CHAT_COMPANION_BINARY = Path("/app/agent/dist/nexus-client-chat.exe")
_LOCAL_TRAY_COMPANION_BINARY = _PROJECT_ROOT / "agent" / "dist" / "nexus-agent-tray.exe"
_CONTAINER_TRAY_COMPANION_BINARY = Path("/app/agent/dist/nexus-agent-tray.exe")
_LOCAL_REMOTE_COMPANION_BINARY = _PROJECT_ROOT / "agent" / "dist" / "nexus-remote-companion.exe"
_CONTAINER_REMOTE_COMPANION_BINARY = Path("/app/agent/dist/nexus-remote-companion.exe")
AGENT_BINARY_PATH = Path(os.environ["NEXUS_AGENT_BINARY"]) if os.environ.get("NEXUS_AGENT_BINARY") else (
    _CONTAINER_AGENT_BINARY if _CONTAINER_AGENT_BINARY.exists() else _LOCAL_AGENT_BINARY
)
CHAT_COMPANION_BINARY_PATH = Path(os.environ["NEXUS_CHAT_COMPANION_BINARY"]) if os.environ.get("NEXUS_CHAT_COMPANION_BINARY") else (
    _CONTAINER_CHAT_COMPANION_BINARY if _CONTAINER_CHAT_COMPANION_BINARY.exists() else _LOCAL_CHAT_COMPANION_BINARY
)
TRAY_COMPANION_BINARY_PATH = Path(os.environ["NEXUS_TRAY_COMPANION_BINARY"]) if os.environ.get("NEXUS_TRAY_COMPANION_BINARY") else (
    _CONTAINER_TRAY_COMPANION_BINARY if _CONTAINER_TRAY_COMPANION_BINARY.exists() else _LOCAL_TRAY_COMPANION_BINARY
)
REMOTE_COMPANION_BINARY_PATH = Path(os.environ["NEXUS_REMOTE_COMPANION_BINARY"]) if os.environ.get("NEXUS_REMOTE_COMPANION_BINARY") else (
    _CONTAINER_REMOTE_COMPANION_BINARY if _CONTAINER_REMOTE_COMPANION_BINARY.exists() else _LOCAL_REMOTE_COMPANION_BINARY
)
AGENT_VERSION = os.environ.get("NEXUS_AGENT_VERSION") or "0.1.13-companion-health"
MTLS_PROXY_TRUST_ENABLED = os.environ.get("NEXUS_TRUST_MTLS_PROXY_HEADER", "").strip().lower() in {
    "1", "true", "yes", "on",
}


async def _native_remote_policy(agent_id: str, client_id: str, tenant_id: str) -> dict[str, Any]:
    """Issue the canonical device binding trusted by the Remote Companion."""
    _, identity = await signing_identity(tenant_id)
    device = await db.devices.find_one(
        {"nexus_agent_id": agent_id, "client_id": client_id, "archived": {"$ne": True}},
        {"_id": 0, "id": 1, "tenant_id": 1},
    )
    managed_device_id = str((device or {}).get("id") or "")
    # Legacy unpartitioned devices belong only to nexus-local; never promote
    # them into an explicitly tenant-bound companion policy by fallback.
    device_tenant = str((device or {}).get("tenant_id") or "nexus-local")
    binding_valid = bool(managed_device_id and device_tenant == tenant_id)
    companion = _remote_companion_binary_info()
    enabled = binding_valid and bool(companion["exists"] and companion["sha256"])
    reason = None
    if not binding_valid:
        reason = "A canonical tenant-bound managed device is required before Native Remote can be enabled."
    elif not companion["exists"]:
        reason = "The signed Nexus Remote Companion artifact is unavailable on the server."
    return {
        "enabled": enabled,
        "schema_version": 1,
        "tenant_id": tenant_id,
        "managed_device_id": managed_device_id,
        "grant_algorithm": "Ed25519",
        "grant_key_id": identity["key_id"],
        "grant_public_key_b64": identity["public_key_b64"],
        # This policy is authenticated by the agent control plane. The agent
        # verifies the installed companion against this digest before it can
        # advertise or broker Native Remote capability.
        "companion_sha256": companion["sha256"],
        "companion_size": companion["size"],
		"maximum_grant_lifetime_seconds": 24 * 60 * 60,
        "replay_store_required": True,
        "attended_only": True,
        "reason": reason,
    }

# Bundled into every newly generated Windows installer. This profile enables
# evidence collection and Canary integrity monitoring only; it does not claim
# to install an AV/EDR or silently change Defender, firewall or user settings.
NEXUS_SHIELD_AGENT_PROFILE = {
    "enabled": True,
    "posture_telemetry": True,
    "canary_enabled": True,
    "canary_check_secs": 30,
    "auto_deploy_canary": True,
}

# Every newly generated installer also carries the Nexus DNS control-plane
# profile. Visibility is the safe default: the installer does not change the
# endpoint resolver until a technician approves a staged deployment and a
# trusted resolver edge has attested healthy.
NEXUS_DNS_AGENT_PROFILE = {
    "enabled": True,
    "mode": "visibility",
    "transport": "doh",
    "resolver_endpoints": [],
    "bypass_detection": True,
    "local_policy_cache": True,
    "restore_previous_dns_on_remove": True,
    "enforcement_ready": False,
}

# Cached binary fingerprint (computed lazily; invalidated when mtime changes).
_binary_cache: dict[str, Any] = {"mtime": 0, "sha256": "", "size": 0}
_companion_binary_cache: dict[str, Any] = {"mtime": 0, "sha256": "", "size": 0}
_tray_companion_binary_cache: dict[str, Any] = {"mtime": 0, "sha256": "", "size": 0}
_remote_companion_binary_cache: dict[str, Any] = {"mtime": 0, "sha256": "", "size": 0}


def _binary_info() -> dict[str, Any]:
    """Return {version, sha256, size, exists} for the current Windows binary.
    Re-computes the SHA256 only when the file mtime changes."""
    if not AGENT_BINARY_PATH.exists():
        return {"version": AGENT_VERSION, "sha256": "", "size": 0, "exists": False}
    st = AGENT_BINARY_PATH.stat()
    if _binary_cache["mtime"] != st.st_mtime or not _binary_cache["sha256"]:
        h = hashlib.sha256()
        with AGENT_BINARY_PATH.open("rb") as fp:
            for chunk in iter(lambda: fp.read(1024 * 64), b""):
                h.update(chunk)
        _binary_cache.update({"mtime": st.st_mtime, "sha256": h.hexdigest(), "size": st.st_size})
    return {"version": AGENT_VERSION, "sha256": _binary_cache["sha256"], "size": _binary_cache["size"], "exists": True}


def _companion_binary_info() -> dict[str, Any]:
    """Return the fingerprint for the user-session support companion."""
    if not CHAT_COMPANION_BINARY_PATH.exists():
        return {"sha256": "", "size": 0, "exists": False}
    stat = CHAT_COMPANION_BINARY_PATH.stat()
    if _companion_binary_cache["mtime"] != stat.st_mtime or not _companion_binary_cache["sha256"]:
        digest = hashlib.sha256()
        with CHAT_COMPANION_BINARY_PATH.open("rb") as fp:
            for chunk in iter(lambda: fp.read(1024 * 64), b""):
                digest.update(chunk)
        _companion_binary_cache.update({"mtime": stat.st_mtime, "sha256": digest.hexdigest(), "size": stat.st_size})
    return {"sha256": _companion_binary_cache["sha256"], "size": _companion_binary_cache["size"], "exists": True}


def _tray_companion_binary_info() -> dict[str, Any]:
    """Return the fingerprint for the optional user-session tray companion."""
    if not TRAY_COMPANION_BINARY_PATH.exists():
        return {"sha256": "", "size": 0, "exists": False}
    stat = TRAY_COMPANION_BINARY_PATH.stat()
    if _tray_companion_binary_cache["mtime"] != stat.st_mtime or not _tray_companion_binary_cache["sha256"]:
        digest = hashlib.sha256()
        with TRAY_COMPANION_BINARY_PATH.open("rb") as fp:
            for chunk in iter(lambda: fp.read(1024 * 64), b""):
                digest.update(chunk)
        _tray_companion_binary_cache.update({"mtime": stat.st_mtime, "sha256": digest.hexdigest(), "size": stat.st_size})
    return {
        "sha256": _tray_companion_binary_cache["sha256"],
        "size": _tray_companion_binary_cache["size"],
        "exists": True,
    }


def _remote_companion_binary_info() -> dict[str, Any]:
    """Return the fingerprint for the signed Nexus Remote Companion."""
    if not REMOTE_COMPANION_BINARY_PATH.exists():
        return {"sha256": "", "size": 0, "exists": False}
    stat = REMOTE_COMPANION_BINARY_PATH.stat()
    if _remote_companion_binary_cache["mtime"] != stat.st_mtime or not _remote_companion_binary_cache["sha256"]:
        digest = hashlib.sha256()
        with REMOTE_COMPANION_BINARY_PATH.open("rb") as fp:
            for chunk in iter(lambda: fp.read(1024 * 64), b""):
                digest.update(chunk)
        _remote_companion_binary_cache.update({"mtime": stat.st_mtime, "sha256": digest.hexdigest(), "size": stat.st_size})
    return {
        "sha256": _remote_companion_binary_cache["sha256"],
        "size": _remote_companion_binary_cache["size"],
        "exists": True,
    }


def _is_windows_agent(agent: dict) -> bool:
    platform = " ".join(str(agent.get(key) or "") for key in ("os", "os_platform", "platform")).lower()
    return "windows" in platform


async def _ensure_elevate_companion_for_agent(agent: dict) -> str:
    """Reconcile the bundled Elevate companion after agent enrolment/check-in.

    Nexus Elevate is an entitlement of the existing Nexus Agent, not another
    endpoint installation.  An enabled Windows agent receives the signed
    companion automatically; the agent reports ``active`` only after its own
    hash-verified command result is received.
    """
    if not agent.get("id") or not agent.get("is_active", True):
        return "not_enrolled"
    settings = await db.nexus_elevate_settings.find_one({"_id": "nexus_elevate"}, {"_id": 0}) or {}
    if not settings.get("native_enabled", True):
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"nexus_elevate.state": "paused"}})
        return "paused"
    if not settings.get("auto_deploy_companion", True):
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"nexus_elevate.state": "manual_deployment"}})
        return "manual_deployment"
    if not _is_windows_agent(agent):
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"nexus_elevate.state": "unsupported_platform"}})
        return "unsupported_platform"
    companion = _companion_binary_info()
    if not companion["exists"]:
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"nexus_elevate.state": "awaiting_companion_build"}})
        return "awaiting_companion_build"
    tray_companion = _tray_companion_binary_info()
    elevation = agent.get("nexus_elevate") if isinstance(agent.get("nexus_elevate"), dict) else {}
    tray_is_current = not tray_companion["exists"] or agent.get("tray_companion_sha256") == tray_companion["sha256"]
    if agent.get("client_companion_sha256") == companion["sha256"] and agent.get("client_companion_installed_at") and tray_is_current:
        companion_state = {
            "nexus_elevate.state": "active",
            "nexus_elevate.active_at": elevation.get("active_at") or _now(),
            "nexus_elevate.companion_sha256": companion["sha256"],
        }
        if tray_companion["exists"]:
            companion_state["nexus_elevate.tray_companion_sha256"] = tray_companion["sha256"]
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
            **companion_state,
        }})
        return "active"
    if agent.get("agent_version") != AGENT_VERSION:
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"nexus_elevate.state": "requires_agent_update"}})
        return "requires_agent_update"
    retry_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    if elevation.get("state") == "deployment_failed" and str(elevation.get("last_attempt_at") or "") >= retry_cutoff:
        return "deployment_failed"
    existing_query = {
        "device_id": agent["id"], "kind": "install_companion", "status": {"$in": ["pending", "dispatched"]},
        "payload.sha256": companion["sha256"],
    }
    if tray_companion["exists"]:
        existing_query["payload.tray_sha256"] = tray_companion["sha256"]
    existing = await db.nexus_agent_commands.find_one(existing_query, {"_id": 0, "id": 1})
    if existing:
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"nexus_elevate.state": "deploying", "nexus_elevate.command_id": existing["id"]}})
        return "deploying"
    command_id = str(uuid.uuid4())
    await db.nexus_agent_commands.insert_one({
        "id": command_id,
        "device_id": agent["id"],
        "client_id": agent.get("client_id"),
        "kind": "install_companion",
        "payload": {
            "sha256": companion["sha256"],
            "tray_sha256": tray_companion["sha256"] if tray_companion["exists"] else "",
            "reason": "nexus_elevate_entitlement",
        },
        "status": "pending",
        "queued_by": "Nexus Elevate entitlement",
        "created_at": _now(),
    })
    queued_state = {
        "nexus_elevate.state": "deploying",
        "nexus_elevate.entitled_at": _now(),
        "nexus_elevate.last_attempt_at": _now(),
        "nexus_elevate.command_id": command_id,
        "nexus_elevate.companion_sha256": companion["sha256"],
    }
    if tray_companion["exists"]:
        queued_state["nexus_elevate.tray_companion_sha256"] = tray_companion["sha256"]
    await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": queued_state, "$inc": {"nexus_elevate.deployment_attempts": 1}})
    await _audit(db, "nexus_elevate_companion_queued", {"device_id": agent["id"], "command_id": command_id})
    return "deploying"


async def _ensure_native_remote_companion_for_agent(agent: dict) -> str:
    """Queue a hash-pinned Remote Companion only for an eligible current agent."""
    if not agent.get("id") or not agent.get("is_active", True) or not _is_windows_agent(agent):
        return "not_eligible"
    # A companion may be delivered to a newer compatible agent build.  Exact
    # label comparison incorrectly treated a newer vendor-suffixed build as
    # stale when the control plane was serving an older release, leaving the
    # endpoint permanently unable to reconcile its signed companion.  Only a
    # parseable version below the server minimum must be upgraded first.
    if not _agent_supports_remote_companion(str(agent.get("agent_version") or "")):
        return "requires_agent_update"
    tenant_id = str(agent.get("tenant_id") or "nexus-local")
    policy = await _native_remote_policy(str(agent["id"]), str(agent.get("client_id") or ""), tenant_id)
    if not policy.get("enabled"):
        return "not_enabled"
    companion = _remote_companion_binary_info()
    health_status = str((agent.get("native_remote_evidence") or {}).get("status") or "")
    if (
        agent.get("remote_companion_sha256") == companion["sha256"]
        and agent.get("remote_companion_installed_at")
        and health_status != "integrity_unverified"
    ):
        return "current"
    existing = await db.nexus_agent_commands.find_one({
        "device_id": agent["id"], "kind": "install_remote_companion",
        "status": {"$in": ["pending", "dispatched"]}, "payload.remote_sha256": companion["sha256"],
    }, {"_id": 0, "id": 1})
    if existing:
        return "deploying"
    command_id = str(uuid.uuid4())
    await db.nexus_agent_commands.insert_one({
        "id": command_id, "device_id": agent["id"], "client_id": agent.get("client_id"),
        "kind": "install_remote_companion",
        "payload": {"remote_sha256": companion["sha256"], "reason": "native_remote_release"},
        "status": "pending", "queued_by": "Nexus Native Remote release", "created_at": _now(),
    })
    await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
        "remote_companion_state": "deploying", "remote_companion_expected_sha256": companion["sha256"],
        "remote_companion_command_id": command_id, "remote_companion_deployment_requested_at": _now(),
    }})
    await _audit(db, "native_remote_companion_queued", {"device_id": agent["id"], "command_id": command_id})
    return "deploying"


async def _mirror_elevate_state_to_device(agent_id: str, state: str, details: dict | None = None) -> None:
    """Keep the main device inventory honest about agent-attested Elevate state."""
    update = {"nexus_elevate_state": state, "nexus_elevate_updated_at": _now()}
    if details:
        update.update(details)
    # Archiving retires the managed-asset record without uninstalling the
    # companion. Agent telemetry must not silently resurrect it in active fleet
    # views; restoring the asset is an explicit technician decision.
    await db.devices.update_one({"nexus_agent_id": agent_id, "archived": {"$ne": True}}, {"$set": update})


async def _notify_elevate_companion_failure(agent: dict, error: str) -> None:
    """Raise one shared repair alert for an unresolved deployment failure."""
    device = await db.devices.find_one({"nexus_agent_id": agent.get("id")}, {"_id": 0, "id": 1, "name": 1}) or {}
    ref_id = device.get("id") or agent.get("id")
    if not ref_id:
        return
    existing = await db.notifications.find_one({
        "ref_id": ref_id,
        "type": "nexus_elevate_companion_failure",
        "resolved_at": {"$exists": False},
    }, {"_id": 0, "id": 1})
    if existing:
        return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": "all",
        "type": "nexus_elevate_companion_failure",
        "title": "Nexus Elevate companion needs repair",
        "message": f"{device.get('name') or agent.get('hostname') or 'A managed endpoint'} could not verify its Elevate companion: {error[:180]}",
        "ref_id": ref_id,
        "ref_type": "device" if device.get("id") else "nexus_agent",
        "action_url": f"/devices/{device['id']}" if device.get("id") else "/nexus-elevate",
        "action_label": "Open device",
        "severity": "warning",
        "read": False,
        "read_by": [],
        "dismissed_by": [],
        "created_at": _now(),
    })


async def _resolve_elevate_companion_failure(agent_id: str) -> None:
    device = await db.devices.find_one({"nexus_agent_id": agent_id}, {"_id": 0, "id": 1}) or {}
    ref_id = device.get("id") or agent_id
    await db.notifications.update_many(
        {"ref_id": ref_id, "type": "nexus_elevate_companion_failure", "resolved_at": {"$exists": False}},
        {"$set": {"resolved_at": _now(), "resolution": "recovered"}},
    )

# Installer archives are stored locally by default. Set NEXUS_AGENT_INSTALLER_DIR
# to a mounted volume in production; no third-party object storage is required.
APP_NAME = "nexusops"
INSTALLER_STORAGE_DIR = Path(os.environ.get("NEXUS_AGENT_INSTALLER_DIR", _PROJECT_ROOT / "data" / "agent-installers"))


def _storage_put(path: str, data: bytes, content_type: str = "application/zip") -> dict | None:
    try:
        target = INSTALLER_STORAGE_DIR / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {"path": str(target), "content_type": content_type}
    except Exception as e:
        logger.warning("[nexus-agent] storage put failed for %s: %s", path, e)
        return None


def _storage_get(path: str) -> bytes | None:
    try:
        target = INSTALLER_STORAGE_DIR / path
        if target.exists():
            return target.read_bytes()
    except Exception as e:
        logger.warning("[nexus-agent] storage get failed for %s: %s", path, e)
    return None


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_AGENT_VERSION_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")


def _agent_version_tuple(value: str) -> tuple[int, int, int] | None:
    """Parse the release number without treating an unknown version as stale.

    Agents can carry a development or vendor-suffixed build label.  We only
    advertise an update when both ends have a comparable semantic release
    number, which prevents the control plane from accidentally offering a
    downgrade to a newer or unmanaged build.
    """
    match = _AGENT_VERSION_RE.match(value.strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def _agent_release_state(current_version: str, target_version: str = AGENT_VERSION) -> str:
    current = _agent_version_tuple(current_version)
    target = _agent_version_tuple(target_version)
    if not current or not target:
        return "version_unparseable"
    if current < target:
        return "update_available"
    if current == target:
        return "current"
    return "ahead_or_unmanaged"


def _agent_supports_remote_companion(agent_version: str) -> bool:
    """Return whether an agent meets the server's minimum companion contract.

    The release label may differ when a compatible agent has been rebuilt with
    a newer vendor suffix.  Treating that as an exact-version mismatch blocks
    the signed companion reconciler indefinitely, even though the endpoint is
    newer than the control-plane minimum.
    """
    return _agent_release_state(agent_version, AGENT_VERSION) in {"current", "ahead_or_unmanaged"}


def _validate_agent_server_url(value: str, *, allow_empty: bool = True) -> str:
    """Validate an agent callback origin before it is placed in an installer.

    Agent credentials and device telemetry must not be sent across a cleartext
    network.  HTTP is deliberately limited to loopback development so local
    developers can run the stack without weakening deployed endpoint safety.
    """
    raw = value.strip().rstrip("/")
    if not raw:
        if allow_empty:
            return ""
        raise HTTPException(422, "Nexus Agent callback URL is required")
    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in {"https", "http"} or not parsed.hostname:
        raise HTTPException(422, "Nexus Agent callback URL must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise HTTPException(422, "Nexus Agent callback URL cannot contain credentials, a query, or a fragment")
    if parsed.scheme.lower() == "http":
        host = parsed.hostname.lower()
        is_loopback = host == "localhost"
        if not is_loopback:
            try:
                is_loopback = ipaddress.ip_address(host).is_loopback
            except ValueError:
                is_loopback = False
        if not is_loopback:
            raise HTTPException(422, "Nexus Agent callback URL must use HTTPS outside local loopback development")
    return raw


def _timestamp_has_expired(value: Any) -> bool:
    """Fail closed when a capability timestamp is absent or malformed."""
    if not value:
        return True
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except (TypeError, ValueError):
        return True


def _online_cutoff() -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=ONLINE_WINDOW_SECONDS)).isoformat()


def _is_online(last_seen: Any) -> bool:
    try:
        last = datetime.fromisoformat(str(last_seen or "").replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - last).total_seconds() < ONLINE_WINDOW_SECONDS
    except (TypeError, ValueError):
        return False


def _is_agent_admin(user: dict) -> bool:
    role = str(user.get("role") or "").lower()
    return bool(user.get("is_admin") or role in {"admin", "owner"})


def _can_execute_agent_commands(user: dict) -> bool:
    if _is_agent_admin(user):
        return True
    permissions = user.get("permissions") or {}
    return bool((permissions.get("agent_commands") or {}).get("execute"))


async def require_agent_operator(user=Depends(get_current_user)) -> dict:
    if not _can_execute_agent_commands(user):
        raise HTTPException(403, "Agent command permission required")
    return user


async def require_agent_admin(user=Depends(get_current_user)) -> dict:
    """Restrict tenant-wide agent configuration to platform administrators.

    Command operators can run work on endpoints, but they must not be able to
    change the callback URL, update cadence, or remote-access deployment code
    for every installer in the tenant.
    """
    if not _is_agent_admin(user):
        raise HTTPException(403, "Nexus Agent administrator permission required")
    return user


def _batch_scope(batch_id: str, user: dict) -> dict[str, Any]:
    query: dict[str, Any] = {"batch_id": batch_id}
    if not _is_agent_admin(user):
        identities = [value for value in {user.get("id"), user.get("email")} if value]
        query["queued_by"] = {"$in": identities}
    return scoped_query(user, query)


async def _verify_agent_token(
    db,
    x_agent_token: str | None,
    x_client_cert_fingerprint: str | None = None,
    *,
    allow_expired_identity: bool = False,
) -> dict:
    if not x_agent_token:
        raise HTTPException(401, "missing agent token")
    agent = await db.nexus_agents.find_one({"agent_token": x_agent_token, "is_active": True})
    if not agent:
        raise HTTPException(401, "invalid agent token")
    identity = agent.get("device_identity") if isinstance(agent.get("device_identity"), dict) else {}
    expected = str(identity.get("certificate_fingerprint") or "").lower()
    expires_at = identity.get("certificate_expires_at")
    if expires_at and not allow_expired_identity:
        try:
            expired = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")) <= datetime.now(timezone.utc)
        except (TypeError, ValueError):
            expired = True
        if expired:
            raise HTTPException(401, "device certificate expired; renew the enrolled identity")

    settings: dict[str, Any] = {}
    settings_collection = getattr(db, "nexus_agent_settings", None)
    if settings_collection is not None:
        try:
            settings = await settings_collection.find_one({"_id": "settings"}, {"_id": 0}) or {}
        except (AttributeError, TypeError):
            settings = {}
    require_mtls = bool(settings.get("require_mtls", False))
    raw_fingerprint = x_client_cert_fingerprint if isinstance(x_client_cert_fingerprint, str) else ""
    presented = (
        raw_fingerprint.replace(":", "").strip().lower()
        if MTLS_PROXY_TRUST_ENABLED
        else ""
    )
    if require_mtls and not MTLS_PROXY_TRUST_ENABLED:
        raise HTTPException(503, "mTLS enforcement is enabled but the trusted proxy certificate header is disabled")
    if require_mtls and not presented:
        raise HTTPException(401, "device certificate is required")
    if presented and (not expected or not secrets.compare_digest(expected, presented)):
        raise HTTPException(401, "device certificate fingerprint does not match enrolled identity")
    transport = "mtls" if presented and expected else "token"
    if identity.get("last_transport") != transport and hasattr(db.nexus_agents, "update_one"):
        now = _now()
        await db.nexus_agents.update_one(
            {"id": agent["id"]},
            {"$set": {
                "device_identity.last_transport": transport,
                "device_identity.last_transport_verified_at": now,
            }},
        )
        agent.setdefault("device_identity", {})["last_transport"] = transport
    return agent


@router.get("/nexus-agent/local/status")
async def get_local_agent_status(
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None),
):
    """Return a deliberately small, credential-free status view for the local tray console."""
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    policy = agent.get("platform_policy") if isinstance(agent.get("platform_policy"), dict) else {}
    modules = policy.get("modules") if isinstance(policy.get("modules"), dict) else {}
    elevate = agent.get("nexus_elevate") if isinstance(agent.get("nexus_elevate"), dict) else {}
    update = agent.get("update_evidence") if isinstance(agent.get("update_evidence"), dict) else {}
    client_name = str(agent.get("client_name") or "")
    if not client_name and agent.get("client_id"):
        client = await db.clients.find_one({"id": agent["client_id"]}, {"_id": 0, "name": 1}) or {}
        client_name = str(client.get("name") or "")
    services = [{"id": "nexus_agent", "name": "Nexus Agent", "state": "active", "included": True}]
    for module_id, name in (("nexus_shield", "Nexus Shield"), ("nexus_dns", "Nexus DNS"), ("nexus_elevate", "Nexus Elevate")):
        enabled = bool(modules.get(module_id))
        state = str(elevate.get("state") or "not_activated") if module_id == "nexus_elevate" else ("active" if enabled else "not_included")
        services.append({"id": module_id, "name": name, "state": state, "included": enabled})
    current_version = str(agent.get("agent_version") or "unknown")
    release_state = _agent_release_state(current_version)
    return {
        "agent": {
            "id": agent.get("id"),
            "hostname": agent.get("hostname") or "Managed endpoint",
            "client_name": client_name or "Assigned client",
            "online": _is_online(agent.get("last_seen")),
            "last_seen": agent.get("last_seen"),
            "version": current_version,
            "identity": agent_trust_state(agent).get("status"),
        },
        "update": {
            "current_version": current_version,
            "target_version": AGENT_VERSION,
            "state": str(update.get("status") or "not_reported"),
            "release_state": release_state,
            "signature_verified": bool(update.get("signature_verified")),
            "update_available": release_state == "update_available",
        },
        "services": services,
    }


def _command_payload_sha256(payload: dict[str, Any] | None) -> str:
    canonical = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _seal_agent_command(command: dict[str, Any], agent: dict[str, Any]) -> dict[str, Any]:
    """Create a short-lived authorization envelope bound to one endpoint."""
    issued = datetime.now(timezone.utc)
    expires = issued + timedelta(seconds=COMMAND_AUTHORIZATION_TTL_SECONDS)
    nonce = uuid.uuid4().hex
    client_id = str(agent.get("client_id") or command.get("client_id") or "")
    payload_sha256 = _command_payload_sha256(command.get("payload"))
    envelope = {
        "schema_version": 1,
        "command_id": str(command.get("id") or ""),
        "device_id": str(agent.get("id") or command.get("device_id") or ""),
        "client_id": client_id,
        "kind": str(command.get("kind") or ""),
        "payload_sha256": payload_sha256,
        "issued_at": issued.isoformat(),
        "expires_at": expires.isoformat(),
        "nonce": nonce,
        "queued_by": str(command.get("queued_by") or "system"),
        "approval_id": str(command.get("approval_id") or ""),
        "privilege": str(command.get("privilege") or "system"),
    }
    signed_payload = "|".join(str(envelope[key]) for key in (
        "schema_version",
        "command_id",
        "device_id",
        "client_id",
        "kind",
        "payload_sha256",
        "issued_at",
        "expires_at",
        "nonce",
        "queued_by",
        "approval_id",
        "privilege",
    ))
    return {
        **envelope,
        **sign_agent_command_payload(signed_payload),
    }


async def _agent_in_scope(device_id: str, user: dict, operation: str) -> dict[str, Any]:
    return await assert_record_scope(
        user,
        db.nexus_agents,
        device_id,
        operation=operation,
        resource_name="Agent",
    )


async def _issue_enrollment_identity(
    *,
    agent_id: str,
    client_id: str,
    hostname: str,
    install_id: str,
    csr_pem: str,
    public_key_fingerprint: str,
) -> dict[str, Any]:
    """Issue and retain certificate metadata without storing the device key."""
    if not csr_pem.strip():
        return {
            "status": "legacy_token",
            "install_id": install_id,
            "public_key_fingerprint": public_key_fingerprint,
            "last_transport": "token",
        }
    try:
        issued = issue_device_certificate(
            csr_pem=csr_pem,
            device_id=agent_id,
            client_id=client_id,
            hostname=hostname,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    await db.nexus_agent_certificates.update_many(
        {"device_id": agent_id, "status": "active"},
        {"$set": {"status": "superseded", "superseded_at": _now()}},
    )
    await db.nexus_agent_certificates.insert_one({
        "id": str(uuid.uuid4()),
        "device_id": agent_id,
        "client_id": client_id,
        "install_id": install_id,
        "fingerprint_sha256": issued["fingerprint_sha256"],
        "serial_number": issued["serial_number"],
        "spiffe_id": issued["spiffe_id"],
        "issued_at": issued["issued_at"],
        "expires_at": issued["expires_at"],
        "status": "active",
    })
    return {
        "status": "certificate_issued",
        "install_id": install_id,
        "public_key_fingerprint": public_key_fingerprint,
        "certificate_fingerprint": issued["fingerprint_sha256"],
        "certificate_serial_number": issued["serial_number"],
        "certificate_issued_at": issued["issued_at"],
        "certificate_expires_at": issued["expires_at"],
        "spiffe_id": issued["spiffe_id"],
        "last_transport": "token",
        "certificate_pem": issued["certificate_pem"],
        "ca_certificate_pem": issued["ca_certificate_pem"],
    }


async def _audit(db, kind: str, payload: dict) -> None:
    try:
        await db.nexus_agent_audit.insert_one({
            "id": str(uuid.uuid4()),
            "kind": kind,
            "payload": payload,
            "at": _now(),
        })
    except Exception:
        pass


def _nexus_shield_profile_from_token(token: dict[str, Any]) -> dict[str, Any]:
    profile = token.get("nexus_shield")
    if not isinstance(profile, dict):
        return dict(NEXUS_SHIELD_AGENT_PROFILE)
    return {
        **NEXUS_SHIELD_AGENT_PROFILE,
        **{key: value for key, value in profile.items() if key in NEXUS_SHIELD_AGENT_PROFILE},
    }


async def _queue_default_nexus_canary(agent: dict[str, Any], profile: dict[str, Any]) -> None:
    """Queue the installer-bundled Canary exactly once for a Windows agent.

    The command remains asynchronous: the installer never creates files itself,
    and the agent reports the resulting fingerprint before Shield marks the
    sensor active. Existing manually deployed canaries prevent a duplicate.
    """
    if not profile.get("enabled") or not profile.get("canary_enabled") or not profile.get("auto_deploy_canary"):
        return
    platform = str(agent.get("os") or "").lower()
    if platform and "windows" not in platform:
        return
    agent_id = str(agent.get("id") or "").strip()
    if not agent_id:
        return
    existing = await db.ransomware_canaries.find_one({
        "agent_id": agent_id,
        "deployment_source": "nexus-agent",
    }, {"_id": 0, "id": 1})
    if existing:
        return

    canary_id = f"canary-{uuid.uuid4().hex[:12]}"
    path = str(PureWindowsPath(r"C:\Users\Public\Documents") / f"NexusShield-{canary_id}-Canary.txt")
    mirrored = await db.devices.find_one({"nexus_agent_id": agent_id}, {"_id": 0, "id": 1, "name": 1, "client_id": 1, "client_name": 1}) or {}
    client_id = str(mirrored.get("client_id") or agent.get("client_id") or "").strip()
    # Commands are cryptographically bound to the owning client before an
    # endpoint can poll them.  An agent without that identity must be repaired
    # or re-enrolled rather than receiving an ambiguous privileged command.
    if not client_id:
        return
    now = _now()
    command_id = str(uuid.uuid4())
    await db.ransomware_canaries.insert_one({
        "id": canary_id,
        "agent_id": agent_id,
        "device_id": mirrored.get("id") or agent_id,
        "device_name": mirrored.get("name") or agent.get("hostname") or agent_id,
        "client_id": client_id,
        "client_name": mirrored.get("client_name") or agent.get("client_name") or "Unassigned client",
        "file_path": path,
        "status": "queued",
        "deployment_source": "nexus-agent",
        "auto_provisioned": True,
        "created_at": now,
        "created_by": "nexus-shield-installer",
    })
    await db.nexus_agent_commands.insert_one({
        "id": command_id,
        "device_id": agent_id,
        "client_id": client_id,
        "kind": "canary_deploy",
        "payload": {"canary_id": canary_id, "canary_path": path},
        "status": "pending",
        "queued_by": "nexus-shield-installer",
        "created_at": now,
    })
    await db.nexus_agents.update_one({"id": agent_id}, {"$set": {
        "nexus_shield_canary_status": "queued",
        "nexus_shield_canary_id": canary_id,
        "nexus_shield_canary_queued_at": now,
    }})
    await _audit(db, "nexus_shield_canary_queued", {
        "device_id": agent_id,
        "canary_id": canary_id,
        "command_id": command_id,
        "source": "installer",
    })


# ----------------------------------------------------------------------
# Public helpers Ã¢â‚¬â€ used by device_intel.bulk_action and ticket_device_actions
# ----------------------------------------------------------------------

async def get_nexus_agent_for_device(device_doc: dict) -> dict | None:
    """Given a `devices` doc, return the live nexus_agents doc, or None."""
    nid = device_doc.get("nexus_agent_id")
    if not nid:
        return None
    return await db.nexus_agents.find_one({"id": nid, "is_active": True})


async def queue_command_for_device(device_doc: dict, kind: str, payload: dict, queued_by: str = "system") -> str | None:
    """Queue a command against the nexus-agent linked to this device.
    Returns the command id, or None if device has no agent."""
    nid = device_doc.get("nexus_agent_id")
    if not nid:
        return None
    client_id = str(device_doc.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(409, "Managed asset has no client binding; command was not queued")
    agent = await db.nexus_agents.find_one({
        "id": nid,
        "client_id": client_id,
        "is_active": True,
        "last_seen": {"$gte": _online_cutoff()},
    }, {"_id": 1})
    if not agent:
        raise HTTPException(409, "NexusOps Agent is offline; command was not queued")
    cmd_id = str(uuid.uuid4())
    await db.nexus_agent_commands.insert_one({
        "id": cmd_id,
        "device_id": nid,
        "client_id": client_id,
        "kind": kind,
        "payload": payload or {},
        "status": "pending",
        "queued_by": queued_by,
        "created_at": _now(),
    })
    await _audit(db, "queue", {
        "cmd_id": cmd_id,
        "device_id": nid,
        "kind": kind,
        "by": queued_by,
        "source": "device_action",
    })
    return cmd_id


# ----------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------

class EnrollRequest(BaseModel):
    enrollment_token: str
    client_id: str = ""
    hostname: str = ""
    os: str = ""
    arch: str = ""
    os_version: str = ""
    mac: str = ""
    agent_version: str = ""
    capabilities: list[str] = Field(default_factory=list, max_length=20)
    runtime_capabilities: list[str] = Field(default_factory=list, max_length=64)
    install_id: str = Field(default="", max_length=200)
    certificate_signing_request: str = Field(default="", max_length=20_000)
    public_key_fingerprint: str = Field(default="", max_length=128)


class EnrollResponse(BaseModel):
    agent_token: str
    device_id: str
    identity_status: str = "legacy_token"
    certificate_pem: str = ""
    ca_certificate_pem: str = ""
    certificate_fingerprint: str = ""
    certificate_expires_at: str = ""
    spiffe_id: str = ""
    policy: dict = Field(default_factory=dict)


class HeartbeatPayload(BaseModel):
    agent_version: str = ""
    snapshot: dict = Field(default_factory=dict)
    capabilities: list[str] = Field(default_factory=list, max_length=20)
    runtime_capabilities: list[str] = Field(default_factory=list, max_length=64)
    nexus_dns: dict = Field(default_factory=dict)
    identity: dict = Field(default_factory=dict)
    policy_evidence: dict = Field(default_factory=dict)
    self_repair: dict = Field(default_factory=dict)
    update_evidence: dict = Field(default_factory=dict)
    native_remote_evidence: dict = Field(default_factory=dict)


class IdentityRenewRequest(BaseModel):
    install_id: str = Field(default="", max_length=200)
    certificate_signing_request: str = Field(min_length=100, max_length=20_000)
    public_key_fingerprint: str = Field(default="", max_length=128)


class CommandRequest(BaseModel):
    kind: Literal["run_script", "run_powershell", "run_cmd", "reboot", "shutdown", "kill_process", "ping", "agent_repair"]
    payload: dict = Field(default_factory=dict)
    include_offline: bool = False


class CommandResult(BaseModel):
    id: str
    nonce: str = Field(default="", max_length=128)
    status: Literal["ok", "error", "timeout"]
    exit_code: int = 0
    stdout: str = Field(default="", max_length=70_000)
    stderr: str = Field(default="", max_length=20_000)
    duration_ms: int = Field(default=0, ge=0, le=86_400_000)


class CompanionDeployRequest(BaseModel):
    device_ids: list[str] = Field(default_factory=list, max_length=200)
    all_online: bool = False


class AgentRepairRequest(BaseModel):
    actions: list[Literal["identity", "policy", "config", "companion"]] = Field(
        default_factory=lambda: ["identity", "policy", "config", "companion"],
        max_length=4,
    )
    reason: str = Field(default="", max_length=500)


class InstallerBuildRequest(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=500)


class NexusAgentSettings(BaseModel):
    heartbeat_secs: int = Field(default=60, ge=15, le=3600)
    poll_secs: int = Field(default=10, ge=2, le=300)
    server_url: str = Field(default="", max_length=2048)  # full https URL the agent should call back to
    splashtop_enabled: bool = False
    splashtop_deploy_code_default: str = Field(default="", max_length=500)
    auto_update_enabled: bool = True
    self_repair_enabled: bool = True
    require_signed_updates: Literal[True] = True
    require_mtls: bool = False
    winget_enabled: bool = False
    winget_allowed_ids: list[str] = Field(default_factory=list, max_length=100)


# ----------------------------------------------------------------------
# AGENT-FACING ENDPOINTS  (X-Agent-Token auth)
# ----------------------------------------------------------------------

@router.post("/nexus-agent/enroll", response_model=EnrollResponse)
async def enroll(req: EnrollRequest):
    # Look up enrollment token
    tok = await db.nexus_agent_enrollment_tokens.find_one({"token": req.enrollment_token, "is_active": True})
    if not tok:
        raise HTTPException(401, "invalid or revoked enrollment token")
    if tok.get("expires_at") and tok["expires_at"] < _now():
        raise HTTPException(401, "enrollment token expired")

    client_id = tok.get("client_id") or req.client_id or ""
    shield_profile = _nexus_shield_profile_from_token(tok)
    dns_profile = tok.get("nexus_dns") if isinstance(tok.get("nexus_dns"), dict) else dict(NEXUS_DNS_AGENT_PROFILE)
    reported_capabilities = [item for item in req.capabilities if isinstance(item, str)][:20]
    reported_runtime_capabilities = [item for item in req.runtime_capabilities if isinstance(item, str)][:64]
    settings = await db.nexus_agent_settings.find_one({"_id": "settings"}, {"_id": 0}) or {}
    tenant_id = str(tok.get("tenant_id") or "nexus-local")
    initial_agent = await db.nexus_agents.find_one(
        {"client_id": client_id, "hostname": req.hostname}, {"_id": 0, "id": 1},
    ) or {}
    policy = build_agent_policy(
        settings, dns_profile,
        await _native_remote_policy(str(initial_agent.get("id") or ""), client_id, tenant_id),
    )

    # Idempotency Ã¢â‚¬â€ try to find an existing agent for (hostname, client_id, mac)
    existing = None
    if req.hostname:
        existing = await db.nexus_agents.find_one({
            "client_id": client_id,
            "hostname": req.hostname,
        })

    if existing:
        # Rotate token
        new_token = secrets.token_urlsafe(32)
        identity = await _issue_enrollment_identity(
            agent_id=existing["id"],
            client_id=client_id,
            hostname=req.hostname or existing.get("hostname", ""),
            install_id=req.install_id,
            csr_pem=req.certificate_signing_request,
            public_key_fingerprint=req.public_key_fingerprint,
        )
        stored_identity = {key: value for key, value in identity.items() if not key.endswith("_pem")}
        await db.nexus_agents.update_one(
            {"id": existing["id"]},
            {"$set": {
                "agent_token": new_token,
                "tenant_id": tenant_id,
                "is_active": True,
                "last_seen": _now(),
                "os": req.os, "arch": req.arch,
                "os_version": req.os_version,
                "agent_version": req.agent_version,
                "primary_mac": req.mac,
                "nexus_shield": shield_profile,
                "nexus_shield_capabilities": reported_capabilities,
                "agent_runtime_capabilities": reported_runtime_capabilities,
                "nexus_dns": {**dns_profile, "enrolled": bool(dns_profile.get("enrolled", False))},
                "device_identity": stored_identity,
                "policy_evidence": {
                    "version": policy["version"],
                    "expected_checksum_sha256": policy["checksum_sha256"],
                    "status": "offered",
                    "offered_at": _now(),
                },
            }},
        )
        await _audit(db, "re-enroll", {"device_id": existing["id"], "client_id": client_id})
        await _sync_to_devices(db, existing["id"], client_id, req)
        await _queue_default_nexus_canary({**existing, "os": req.os or existing.get("os"), "nexus_shield": shield_profile}, shield_profile)
        try:
            elevate_state = await _ensure_elevate_companion_for_agent({**existing, "is_active": True, "os": req.os or existing.get("os"), "agent_version": req.agent_version})
            await _mirror_elevate_state_to_device(existing["id"], elevate_state)
        except Exception:
            logger.exception("[nexus-agent] failed to reconcile Nexus Elevate after re-enrolment")
        await emit_platform_event(
            subject="device.identity.issued",
            source="nexus.agent.enrollment",
            actor={"id": existing["id"], "name": req.hostname or "Nexus Agent", "role": "device"},
            client_id=client_id or None,
            payload={"device_id": existing["id"], "identity_status": identity["status"], "reenrollment": True},
        )
        return EnrollResponse(
            agent_token=new_token,
            device_id=existing["id"],
            identity_status=identity["status"],
            certificate_pem=identity.get("certificate_pem", ""),
            ca_certificate_pem=identity.get("ca_certificate_pem", ""),
            certificate_fingerprint=identity.get("certificate_fingerprint", ""),
            certificate_expires_at=identity.get("certificate_expires_at", ""),
            spiffe_id=identity.get("spiffe_id", ""),
            policy=policy,
        )

    device_id = str(uuid.uuid4())
    agent_token = secrets.token_urlsafe(32)
    identity = await _issue_enrollment_identity(
        agent_id=device_id,
        client_id=client_id,
        hostname=req.hostname,
        install_id=req.install_id,
        csr_pem=req.certificate_signing_request,
        public_key_fingerprint=req.public_key_fingerprint,
    )
    stored_identity = {key: value for key, value in identity.items() if not key.endswith("_pem")}
    doc = {
        "id": device_id,
        "client_id": client_id,
        "tenant_id": tenant_id,
        "hostname": req.hostname,
        "os": req.os,
        "arch": req.arch,
        "os_version": req.os_version,
        "primary_mac": req.mac,
        "agent_version": req.agent_version,
        "agent_token": agent_token,
        "is_active": True,
        "enrolled_at": _now(),
        "last_seen": _now(),
        "source": "nexus-agent",
        "nexus_shield": shield_profile,
        "nexus_shield_capabilities": reported_capabilities,
        "agent_runtime_capabilities": reported_runtime_capabilities,
        "nexus_dns": {**dns_profile, "enrolled": bool(dns_profile.get("enrolled", False))},
        "device_identity": stored_identity,
        "policy_evidence": {
            "version": policy["version"],
            "expected_checksum_sha256": policy["checksum_sha256"],
            "status": "offered",
            "offered_at": _now(),
        },
    }
    await db.nexus_agents.insert_one(doc)
    await _audit(db, "enroll", {"device_id": device_id, "client_id": client_id, "hostname": req.hostname})
    await _sync_to_devices(db, device_id, client_id, req)
    await _queue_default_nexus_canary(doc, shield_profile)
    try:
        elevate_state = await _ensure_elevate_companion_for_agent(doc)
        await _mirror_elevate_state_to_device(device_id, elevate_state)
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile Nexus Elevate after enrolment")
    await emit_platform_event(
        subject="device.identity.issued",
        source="nexus.agent.enrollment",
        actor={"id": device_id, "name": req.hostname or "Nexus Agent", "role": "device"},
        client_id=client_id or None,
        payload={"device_id": device_id, "identity_status": identity["status"], "reenrollment": False},
    )
    return EnrollResponse(
        agent_token=agent_token,
        device_id=device_id,
        identity_status=identity["status"],
        certificate_pem=identity.get("certificate_pem", ""),
        ca_certificate_pem=identity.get("ca_certificate_pem", ""),
        certificate_fingerprint=identity.get("certificate_fingerprint", ""),
        certificate_expires_at=identity.get("certificate_expires_at", ""),
        spiffe_id=identity.get("spiffe_id", ""),
        policy=policy,
    )


@router.post("/nexus-agent/identity/renew")
async def renew_device_identity(
    req: IdentityRenewRequest,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    agent = await _verify_agent_token(
        db,
        x_agent_token,
        x_client_cert_fingerprint,
        allow_expired_identity=True,
    )
    identity = await _issue_enrollment_identity(
        agent_id=agent["id"],
        client_id=str(agent.get("client_id") or ""),
        hostname=str(agent.get("hostname") or ""),
        install_id=req.install_id or str((agent.get("device_identity") or {}).get("install_id") or ""),
        csr_pem=req.certificate_signing_request,
        public_key_fingerprint=req.public_key_fingerprint,
    )
    stored_identity = {key: value for key, value in identity.items() if not key.endswith("_pem")}
    await db.nexus_agents.update_one(
        {"id": agent["id"]},
        {"$set": {"device_identity": stored_identity}},
    )
    await _audit(db, "device_identity_renewed", {
        "device_id": agent["id"],
        "client_id": agent.get("client_id"),
        "certificate_fingerprint": identity.get("certificate_fingerprint"),
    })
    await emit_platform_event(
        subject="device.identity.issued",
        source="nexus.agent.renewal",
        actor={"id": agent["id"], "name": agent.get("hostname") or "Nexus Agent", "role": "device"},
        client_id=agent.get("client_id") or None,
        payload={"device_id": agent["id"], "identity_status": identity["status"], "renewal": True},
    )
    return {
        "identity_status": identity["status"],
        "certificate_pem": identity.get("certificate_pem", ""),
        "ca_certificate_pem": identity.get("ca_certificate_pem", ""),
        "certificate_fingerprint": identity.get("certificate_fingerprint", ""),
        "certificate_expires_at": identity.get("certificate_expires_at", ""),
        "spiffe_id": identity.get("spiffe_id", ""),
    }


async def _sync_to_devices(db, nexus_device_id: str, client_id: str, req: "EnrollRequest"):
    """Mirror the nexus agent into the existing `devices` collection so it appears
    on the standard Devices page without any UI changes."""
    client_name = ""
    try:
        c = await db.clients.find_one({"id": client_id}, {"name": 1})
        if c:
            client_name = c.get("name", "")
    except Exception:
        pass
    device_filter = {"nexus_agent_id": nexus_device_id}
    existing_device = await db.devices.find_one(device_filter, {"_id": 0, "id": 1, "archived": 1})
    if existing_device and existing_device.get("archived"):
        return
    update = {
        "$set": {
            "nexus_agent_id": nexus_device_id,
            "client_id": client_id,
            "client_name": client_name,
            "hostname": req.hostname or "",
            "name": req.hostname or "Unnamed",
            "os_name": req.os or "windows",
            "os_version": req.os_version or "",
            "primary_mac": req.mac or "",
            "agent_version": req.agent_version or "",
            "status": "online",
            "last_seen": _now(),
            "source": "nexus-agent",
            "nexus_shield_enabled": True,
            "nexus_canary_enabled": True,
            "nexus_dns_available": True,
            "nexus_dns_mode": "visibility",
        },
        "$setOnInsert": {
            "id": str(uuid.uuid4()),
            "created_at": _now(),
            "device_type": "workstation",
        },
    }
    await db.devices.update_one(device_filter, update, upsert=not bool(existing_device))


def _agent_device_telemetry(snapshot: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Translate the lightweight agent heartbeat into the schema used by Devices.

    The agent deliberately reports a compact cross-platform snapshot.  Keeping
    the translation here makes agent-enrolled endpoints look identical to
    devices reported by the legacy full inventory agent.
    """
    disks = snapshot.get("disks") or []
    nics = snapshot.get("nics") or []

    def _number(value: Any) -> float | None:
        """Preserve a reported zero, but never turn an absent value into zero."""
        if value is None or value == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    disk_percentages = [value for value in (_number(disk.get("percent")) for disk in disks) if value is not None]
    disk_totals = [value for value in (_number(disk.get("total_gb")) for disk in disks) if value is not None]
    disk_used = [value for value in (_number(disk.get("used_gb")) for disk in disks) if value is not None]
    disk_percent = max(disk_percentages) if disk_percentages else None
    total_gb = round(sum(disk_totals), 2) if disk_totals else None
    used_gb = round(sum(disk_used), 2) if disk_used else None
    uptime_raw = _number(snapshot.get("uptime_sec"))
    uptime_seconds = int(uptime_raw) if uptime_raw is not None else None
    cpu_percent = _number(snapshot.get("cpu_percent"))
    memory_percent = _number(snapshot.get("mem_percent"))
    cpu_count = _number(snapshot.get("cpu_count"))
    memory_total_mb = _number(snapshot.get("mem_total_mb"))

    # Prefer a routable IPv4 address. Link-local addresses are not useful for
    # a technician trying to identify or reach the endpoint.
    ip_address = ""
    for nic in nics:
        for address in nic.get("ipv4") or []:
            value = str(address).split("/")[0]
            if value and not value.startswith(("127.", "169.254.")) and ":" not in value:
                ip_address = value
                break
        if ip_address:
            break

    device_update = {
        # DeviceDetailPage gauges use these canonical names.
        "cpu_usage": cpu_percent,
        "memory_usage": memory_percent,
        "disk_usage": disk_percent,
        # Keep the compact list-view fields in sync as well.
        "cpu_load": cpu_percent,
        "memory_pct": memory_percent,
        "disk_pct": disk_percent,
        "processor": str(snapshot.get("cpu_model") or "").strip(),
        "processor_cores": int(cpu_count) if cpu_count is not None else None,
        "ram_gb": round(memory_total_mb / 1024, 1) if memory_total_mb is not None else None,
        "storage_total_gb": total_gb,
        "storage_used_gb": used_gb,
        "storage_free_gb": round(total_gb - used_gb, 2) if total_gb is not None and used_gb is not None else None,
        "uptime_sec": uptime_seconds,
        "uptime_hours": round(uptime_seconds / 3600, 1) if uptime_seconds is not None else None,
        "uptime_display": f"{uptime_seconds // 86400}d {(uptime_seconds % 86400) // 3600}h" if uptime_seconds is not None else None,
    }
    if snapshot.get("boot_time"):
        device_update["last_reboot"] = datetime.fromtimestamp(int(snapshot["boot_time"]), tz=timezone.utc).isoformat()
    if snapshot.get("os_version"):
        device_update["os_build"] = str(snapshot["os_version"]).split("Build ")[-1]
    if ip_address:
        device_update["ip_address"] = ip_address

    security = snapshot.get("security") or {}
    if security:
        defender_enabled = bool(security.get("defender_enabled"))
        realtime_enabled = bool(security.get("real_time_enabled"))
        firewall_enabled = bool(security.get("firewall_enabled"))
        signature_age_raw = _number(security.get("signature_age_days"))
        signature_age = int(signature_age_raw) if signature_age_raw is not None else None
        pending_updates_raw = _number(security.get("pending_update_count"))
        pending_updates = int(pending_updates_raw) if pending_updates_raw is not None else None
        encryption = str(security.get("encryption_status") or "Unknown")
        # Transparent scoring: 40 Defender + 20 signatures + 20 firewall +
        # 10 patch status + 10 encryption. Each input remains visible in UI.
        score = 0
        score += 40 if defender_enabled and realtime_enabled else 0
        score += 20 if signature_age is not None and signature_age <= 3 else (10 if signature_age is not None and signature_age <= 7 else 0)
        score += 20 if firewall_enabled else 0
        score += 10 if pending_updates == 0 else 0
        score += 10 if any(marker in encryption.lower() for marker in ("encrypted", "bitlocker on", "protection on")) else 0
        device_update.update({
            "security_assessed_at": _now(),
            "compliance_score": score,
            "antivirus": "Microsoft Defender" if security.get("defender_installed") else "Not detected",
            "antivirus_status": "active" if defender_enabled and realtime_enabled else "inactive",
            "edr_status": "active" if defender_enabled and realtime_enabled else "inactive",
            "defender_real_time_enabled": realtime_enabled,
            "defender_signature_age_days": signature_age,
            "firewall_enabled": firewall_enabled,
            "encryption_status": encryption,
            "pending_patches": pending_updates,
        })
    hardware = snapshot.get("hardware") or {}
    if hardware:
        device_update.update({key: str(hardware.get(key) or "") for key in ("manufacturer", "model", "serial_number", "bios_version", "domain")})

    disk_records = [
        {
            "id": str(uuid.uuid4()),
            "drive_letter": disk.get("device") or disk.get("mount") or "",
            "mount_point": disk.get("mount") or disk.get("device") or "",
            "file_system": disk.get("fs_type") or "",
            "total_gb": round(float(disk.get("total_gb") or 0), 2),
            "used_gb": round(float(disk.get("used_gb") or 0), 2),
            "free_gb": round(float(disk.get("total_gb") or 0) - float(disk.get("used_gb") or 0), 2),
            "usage_percent": round(float(disk.get("percent") or 0), 2),
            "disk_type": "Unknown",
            "smart_status": "Unknown",
        }
        for disk in disks
    ]
    network_records = [
        {
            "id": str(uuid.uuid4()),
            "adapter_name": nic.get("name") or "Unknown adapter",
            "mac_address": nic.get("mac") or "",
            "ip_address": next((str(v).split("/")[0] for v in (nic.get("ipv4") or []) if ":" not in str(v) and not str(v).startswith("169.254.")), ""),
            "subnet": next((str(v).split("/")[1] for v in (nic.get("ipv4") or []) if ":" not in str(v) and "/" in str(v)), ""),
            "ip_addresses": nic.get("ipv4") or [], "type": nic.get("type") or "ethernet",
            "status": nic.get("status") or "down", "gateway": nic.get("gateway") or "",
            "dns": nic.get("dns") or [], "speed_mbps": nic.get("speed_mbps") or 0,
        }
        for nic in nics
    ]
    return device_update, disk_records, network_records


def _patch_evidence_update(snapshot: dict[str, Any], observed_at: str) -> dict[str, Any]:
    """Return only the patch fields supported by this exact agent payload.

    Heartbeat liveness and patch-collector liveness are deliberately separate:
    no count is better than a stale zero when a technician is deciding whether
    an endpoint is actually current.
    """
    security_snapshot = snapshot.get("security") if isinstance(snapshot.get("security"), dict) else {}
    raw_pending_count = security_snapshot.get("pending_update_count")
    try:
        parsed_pending_count = float(raw_pending_count)
        pending_count = int(parsed_pending_count) if parsed_pending_count >= 0 and parsed_pending_count.is_integer() else None
    except (TypeError, ValueError):
        pending_count = None
    return {
        "patch_evidence_state": "reported" if pending_count is not None else "not_reported",
        "patch_evidence_source": "nexus-agent" if pending_count is not None else None,
        "patch_evidence_observed_at": observed_at if pending_count is not None else None,
        "patch_evidence_not_reported_at": None if pending_count is not None else observed_at,
        "pending_patches": pending_count,
    }


@router.post("/nexus-agent/heartbeat")
async def heartbeat(
    p: HeartbeatPayload,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    snap = p.snapshot or {}
    now = _now()
    update = {
        "last_seen": now,
        "agent_version": p.agent_version or agent.get("agent_version", ""),
        "online": True,
        "nexus_shield_capabilities": [item for item in p.capabilities if isinstance(item, str)][:20],
        "agent_runtime_capabilities": [item for item in p.runtime_capabilities if isinstance(item, str)][:64],
    }
    if p.identity:
        update.update({
            "device_identity.reported_install_id": str(p.identity.get("install_id") or "")[:200],
            "device_identity.reported_certificate_fingerprint": str(p.identity.get("certificate_fingerprint") or "")[:128].lower(),
            "device_identity.agent_reported_at": now,
        })
    if p.policy_evidence:
        update["policy_evidence.reported_version"] = str(p.policy_evidence.get("version") or "")[:100]
        update["policy_evidence.reported_checksum_sha256"] = str(p.policy_evidence.get("checksum_sha256") or "")[:128].lower()
        update["policy_evidence.reported_at"] = now
    if p.self_repair:
        update["self_repair"] = {
            "status": str(p.self_repair.get("status") or "unknown")[:50],
            "checks": list(p.self_repair.get("checks") or [])[:20],
            "repairs": list(p.self_repair.get("repairs") or [])[:20],
            "reported_at": now,
        }
    if p.update_evidence:
        update["update_evidence"] = {
            "status": str(p.update_evidence.get("status") or "unknown")[:50],
            "version": str(p.update_evidence.get("version") or "")[:100],
            "signature_verified": bool(p.update_evidence.get("signature_verified")),
            "reported_at": now,
        }
    if p.native_remote_evidence:
        update["native_remote_evidence"] = {
            "status": str(p.native_remote_evidence.get("status") or "unknown")[:80],
            "detail": str(p.native_remote_evidence.get("detail") or "")[:500],
            "observed_at": str(p.native_remote_evidence.get("observed_at") or "")[:64],
            "reported_at": now,
        }
    if p.nexus_dns:
        reported_deployment = str(p.nexus_dns.get("deployment_id") or "")
        expected_deployment = str((agent.get("nexus_dns") or {}).get("deployment_id") or "")
        update.update({
            "nexus_dns.reported_mode": str(p.nexus_dns.get("mode") or "visibility"),
            "nexus_dns.acknowledged_deployment_id": reported_deployment,
            "nexus_dns.agent_reported_at": now,
            "nexus_dns.status": "acknowledged" if reported_deployment and reported_deployment == expected_deployment else "profile_reported",
        })
    # Top-level snapshot fields useful for list views
    for k in ("hostname", "os", "os_version", "os_platform", "arch",
              "cpu_percent", "cpu_count", "cpu_model",
              "mem_total_mb", "mem_used_mb", "mem_percent",
              "uptime_sec", "security", "software", "hardware"):
        if k in snap:
            update[k] = snap[k]
    update["disks"] = snap.get("disks", [])
    update["nics"] = snap.get("nics", [])
    await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": update})

    try:
        elevate_state = await _ensure_elevate_companion_for_agent({**agent, **update})
        await _mirror_elevate_state_to_device(agent["id"], elevate_state)
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile Nexus Elevate after heartbeat")
    try:
        await _ensure_native_remote_companion_for_agent({**agent, **update})
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile Nexus Remote Companion after heartbeat")

    # Mirror into devices collection so the existing /devices page sees live data.
    try:
        telemetry, disk_records, network_records = _agent_device_telemetry(snap)
        # A heartbeat can be fresh while its patch collector is unavailable.
        # Preserve that uncertainty rather than letting a prior zero count look
        # like a current patch assessment on the Devices/RMM workspace.
        patch_evidence = _patch_evidence_update(snap, now)
        await db.devices.update_one(
            {"nexus_agent_id": agent["id"], "archived": {"$ne": True}},
            {"$set": {
                "status": "online",
                "last_seen": now,
                "hostname": snap.get("hostname", agent.get("hostname", "")),
                "name": snap.get("hostname", agent.get("hostname", "")) or "Unnamed",
                "os_name": snap.get("os_platform") or snap.get("os") or agent.get("os", ""),
                "os": snap.get("os_platform") or snap.get("os") or agent.get("os", ""),
                "os_version": snap.get("os_version", ""),
                "mac_address": agent.get("primary_mac", ""),
                "agent_version": p.agent_version or agent.get("agent_version", ""),
                "source": "nexus-agent",
                "nexus_shield_enabled": "nexus_shield" in p.capabilities,
                "nexus_canary_enabled": "nexus_canary" in p.capabilities,
                "nexus_shield_capabilities": [item for item in p.capabilities if isinstance(item, str)][:20],
                "agent_runtime_capabilities": [item for item in p.runtime_capabilities if isinstance(item, str)][:64],
                "native_remote_evidence": update.get("native_remote_evidence", agent.get("native_remote_evidence", {})),
                **telemetry,
                **patch_evidence,
            }},
        )
        mirrored_device = await db.devices.find_one(
            {"nexus_agent_id": agent["id"], "archived": {"$ne": True}},
            {"_id": 0, "id": 1, "client_id": 1},
        )
        if mirrored_device and mirrored_device.get("id"):
            device_id = mirrored_device["id"]
            await db.device_disks.delete_many({"device_id": device_id})
            if disk_records:
                for record in disk_records:
                    record.update({"device_id": device_id, "last_updated": now})
                await db.device_disks.insert_many(disk_records)
            await db.device_network.delete_many({"device_id": device_id})
            if network_records:
                for record in network_records:
                    record.update({"device_id": device_id, "last_updated": now})
                await db.device_network.insert_many(network_records)
            await db.device_performance.insert_one({
                "id": str(uuid.uuid4()), "device_id": device_id, "timestamp": now,
                "cpu": telemetry["cpu_usage"], "memory": telemetry["memory_usage"], "disk": telemetry["disk_usage"],
                "cpu_usage": telemetry["cpu_usage"], "memory_usage": telemetry["memory_usage"], "disk_usage": telemetry["disk_usage"],
            })
            security = snap.get("security") or {}
            if security.get("pending_updates") is not None:
                await db.device_patches.delete_many({"device_id": device_id, "source": "windows-update-agent", "status": "pending"})
                pending = security.get("pending_updates") or []
                if pending:
                    await db.device_patches.insert_many([{
                        "id": str(uuid.uuid4()), "device_id": device_id,
                        "title": str(patch.get("title") or "Windows Update"),
                        "kb_article": str(patch.get("kb") or ""),
                        "status": "pending", "source": "windows-update-agent",
                        "reboot_required": bool(patch.get("reboot_required")), "detected_at": now,
                    } for patch in pending])
            software = snap.get("software") or []
            if software:
                await db.device_software.delete_many({"device_id": device_id, "source": "nexus-agent"})
                await db.device_software.insert_many([{
                    "id": str(uuid.uuid4()), "device_id": device_id,
                    "name": str(app.get("name") or "Unknown application"),
                    "version": str(app.get("version") or ""),
                    "publisher": str(app.get("publisher") or ""),
                    "install_date": str(app.get("install_date") or ""),
                    "size_mb": float(app.get("size_mb") or 0),
                    "category": "installed_application", "source": "nexus-agent",
                    "last_inventory_at": now,
                } for app in software])
                await db.devices.update_one({"id": device_id}, {"$set": {"installed_software_count": len(software)}})
            try:
                await record_endpoint_state_snapshot(
                    db,
                    device_id=device_id,
                    client_id=mirrored_device.get("client_id") or agent.get("client_id"),
                    agent_id=agent["id"],
                    snapshot=snap,
                    capabilities=p.capabilities,
                    agent_version=p.agent_version or agent.get("agent_version", ""),
                    captured_at=now,
                )
            except Exception:
                # State history must never make a valid heartbeat fail.
                logger.exception("[nexus-agent] failed to capture endpoint state history")
            # Keep a compact, technician-useful trailÃ¢â‚¬â€not one noisy event per
            # minute. Heartbeat inventory is summarised at most once per hour.
            last_audit = agent.get("last_device_audit_at")
            should_audit = True
            if last_audit:
                try:
                    should_audit = (datetime.now(timezone.utc) - datetime.fromisoformat(str(last_audit).replace("Z", "+00:00"))).total_seconds() >= 3600
                except (TypeError, ValueError):
                    pass
            if should_audit:
                await log_activity(
                    {"id": "nexus-agent", "name": "NexusOps Agent"}, "agent_check_in", "device", device_id,
                    snap.get("hostname") or "Endpoint",
                    f"Inventory check-in: {len(snap.get('software') or [])} applications, {len(snap.get('disks') or [])} drives, {len(snap.get('nics') or [])} adapters.",
                    metadata={"source": "nexus-agent", "security_assessed": bool(snap.get("security")), "pending_updates": (snap.get("security") or {}).get("pending_update_count", 0)},
                )
                await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"last_device_audit_at": now}})
            last_event = agent.get("last_device_event_at")
            should_event = True
            if last_event:
                try:
                    should_event = (datetime.now(timezone.utc) - datetime.fromisoformat(str(last_event).replace("Z", "+00:00"))).total_seconds() >= 3600
                except (TypeError, ValueError):
                    pass
            if should_event:
                security = snap.get("security") or {}
                pending_updates = security.get("pending_update_count")
                update_summary = (
                    f"{int(pending_updates)} updates pending"
                    if pending_updates not in (None, "")
                    else "update state not reported"
                )
                await db.device_events.insert_one({
                    "id": str(uuid.uuid4()), "device_id": device_id, "event_type": "agent_check_in",
                    "message": (
                        "NexusOps Agent checked in Ã‚Â· "
                        f"CPU {telemetry['cpu_usage']:.0f}%" if telemetry["cpu_usage"] is not None else "NexusOps Agent checked in Ã‚Â· CPU not reported"
                    ) + (
                        f" Ã‚Â· memory {telemetry['memory_usage']:.0f}%" if telemetry["memory_usage"] is not None else " Ã‚Â· memory not reported"
                    ) + f" Ã‚Â· {update_summary}.",
                    "severity": "info", "timestamp": now, "source": "nexus-agent",
                })
                await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {"last_device_event_at": now}})
    except Exception:
        logger.exception("[nexus-agent] failed to mirror heartbeat into device inventory")

    # Evaluate monitoring rules after the mirrored device telemetry is current.
    # The evaluator owns duration/cooldown state, so regular heartbeats cannot
    # create duplicate alerts or tickets.
    try:
        mirrored = await db.devices.find_one({"nexus_agent_id": agent["id"]}, {"_id": 0, "id": 1})
        if mirrored and mirrored.get("id"):
            from app.routers.alert_rules import evaluate_alert_rules
            await evaluate_alert_rules(device_ids=[mirrored["id"]], create_actions=True, actor="nexus-agent")
    except Exception as exc:
        logger.warning("[nexus-agent] monitoring evaluation failed: %s", exc)

    # Write a heartbeat history row (lightweight Ã¢â‚¬â€ for sparklines)
    try:
        await db.nexus_agent_heartbeats.insert_one({
            "device_id": agent["id"],
            "at": now,
            "cpu_percent": snap.get("cpu_percent", 0),
            "mem_percent": snap.get("mem_percent", 0),
        })
    except Exception:
        pass

    # Auto-update advertisement
    update_info = None
    settings = await db.nexus_agent_settings.find_one({"_id": "settings"}) or {}
    auto_update_enabled = settings.get("auto_update_enabled", True)
    if auto_update_enabled:
        info = _binary_info()
        agent_ver = (p.agent_version or "").strip()
        if info["exists"] and _agent_release_state(agent_ver, info["version"]) == "update_available":
            update_info = {
                "version": info["version"],
                "url": "/api/nexus-agent/binary/latest",
                "sha256": info["sha256"],
                "size": info["size"],
                **sign_update_manifest(
                    version=info["version"],
                    sha256=info["sha256"],
                    size=info["size"],
                ),
            }

    # Deliver the low-risk Nexus DNS control-plane profile through the same
    # authenticated heartbeat. The current agent persists this profile but does
    # not change adapter DNS or install certificates; enforcement remains false
    # until a separately signed resolver module and trusted edge attestation
    # exist.
    dns_settings = await db.nexus_dns_settings.find_one({"id": "nexus-dns-settings"}, {"_id": 0}) or {}
    stored_dns = agent.get("nexus_dns") if isinstance(agent.get("nexus_dns"), dict) else {}
    dns_profile = {
        **NEXUS_DNS_AGENT_PROFILE,
        **stored_dns,
        "transport": dns_settings.get("dns_transport") or stored_dns.get("transport") or "doh",
        "resolver_endpoints": dns_settings.get("resolver_endpoints") or [],
        "bypass_detection": dns_settings.get("bypass_detection", True),
        "local_policy_cache": dns_settings.get("local_policy_cache", True),
        "enforcement_ready": False,
    }
    if dns_profile.get("enrolled"):
        await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
            "nexus_dns.status": "profile_offered",
            "nexus_dns.profile_offered_at": now,
        }})

    policy = build_agent_policy(
        settings, dns_profile,
        await _native_remote_policy(
            agent["id"], str(agent.get("client_id") or ""), str(agent.get("tenant_id") or "nexus-local"),
        ),
    )
    reported_checksum = str(p.policy_evidence.get("checksum_sha256") or "").lower()
    policy_status = "acknowledged" if reported_checksum and secrets.compare_digest(
        reported_checksum,
        policy["checksum_sha256"],
    ) else "offered"
    await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
        "policy_evidence.version": policy["version"],
        "policy_evidence.expected_checksum_sha256": policy["checksum_sha256"],
        "policy_evidence.status": policy_status,
        "policy_evidence.offered_at": now,
    }})

    identity = agent.get("device_identity") if isinstance(agent.get("device_identity"), dict) else {}
    rotation_required = False
    if identity.get("certificate_expires_at"):
        try:
            expires = datetime.fromisoformat(str(identity["certificate_expires_at"]).replace("Z", "+00:00"))
            rotation_required = expires <= datetime.now(timezone.utc) + timedelta(days=30)
        except ValueError:
            rotation_required = True
    return {
        "ok": True,
        "update": update_info,
        "server_time": now,
        "nexus_dns": dns_profile,
        "policy": policy,
        "identity": {
            "status": agent_trust_state(agent)["status"],
            "certificate_rotation_required": rotation_required,
            "certificate_expires_at": identity.get("certificate_expires_at"),
            "spiffe_id": identity.get("spiffe_id"),
        },
    }


@router.get("/nexus-agent/commands/poll")
async def commands_poll(
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    agent_client_id = str(agent.get("client_id") or "").strip()
    # Commands created before client binding was mandatory are intentionally
    # not dispatched. Requeueing under a current, scoped workflow is safer
    # than allowing a cross-client command to execute on a guessed agent ID.
    if not agent_client_id:
        return []
    # Read candidates, then atomically claim each one. The status predicate on
    # update prevents overlapping polls from dispatching the same command twice.
    pending = await db.nexus_agent_commands.find({
        "device_id": agent["id"],
        "client_id": agent_client_id,
        "status": "pending",
    }).to_list(length=20)
    out: list[dict] = []
    for c in pending:
        authorization = _seal_agent_command(c, agent)
        claimed = await db.nexus_agent_commands.update_one(
            {"_id": c["_id"], "client_id": agent_client_id, "status": "pending"},
            {"$set": {
                "status": "dispatched",
                "dispatched_at": _now(),
                "client_id": agent.get("client_id"),
                "authorization": authorization,
            }},
        )
        if claimed.modified_count == 1:
            if c.get("script_execution_id"):
                await db.script_executions.update_one({"id": c["script_execution_id"], "status": "pending"}, {"$set": {
                    "status": "running", "started_at": _now(),
                }})
            out.append({
                "id": c["id"],
                "kind": c["kind"],
                "payload": c.get("payload") or {},
                "authorization": authorization,
            })
    return {"commands": out}


@router.post("/nexus-agent/command-result")
async def command_result(
    res: CommandResult,
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    agent = await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    command_record = await db.nexus_agent_commands.find_one(
        {"id": res.id, "device_id": agent["id"]},
        {"_id": 0, "status": 1, "authorization": 1},
    )
    if not command_record:
        raise HTTPException(404, "command not found")
    expected_nonce = str((command_record.get("authorization") or {}).get("nonce") or "")
    if not expected_nonce or not res.nonce or not secrets.compare_digest(expected_nonce, res.nonce):
        await _audit(db, "command_result_rejected", {
            "device_id": agent["id"],
            "command_id": res.id,
            "reason": "authorization nonce mismatch",
        })
        raise HTTPException(409, "command result authorization does not match the dispatched command")
    result_update = await db.nexus_agent_commands.update_one(
        {"id": res.id, "device_id": agent["id"], "status": "dispatched"},
        {"$set": {
            "status": res.status,
            "exit_code": res.exit_code,
            "stdout": res.stdout,
            "stderr": res.stderr,
            "duration_ms": res.duration_ms,
            "completed_at": _now(),
        }},
    )
    if result_update.modified_count != 1:
        await _audit(db, "command_result_rejected", {
            "device_id": agent["id"],
            "command_id": res.id,
            "reason": f"invalid result transition from {command_record.get('status')}",
        })
        raise HTTPException(409, "command result has already been recorded or was not dispatched")
    try:
        repair_command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"], "kind": "agent_repair"},
            {"_id": 0, "payload": 1},
        )
        if repair_command:
            repair_evidence: dict[str, Any] = {}
            if res.stdout:
                try:
                    parsed = json.loads(res.stdout)
                    if isinstance(parsed, dict):
                        repair_evidence = parsed
                except json.JSONDecodeError:
                    repair_evidence = {}
            repair_status = (
                "healthy"
                if res.status == "ok" and repair_evidence.get("status") == "healthy"
                else "attention"
            )
            await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
                "self_repair": {
                    "status": repair_status,
                    "checks": list(repair_evidence.get("checks") or [])[:20],
                    "repairs": list(repair_evidence.get("repairs") or [])[:20],
                    "details": repair_evidence.get("details") if isinstance(repair_evidence.get("details"), dict) else {},
                    "last_repair_at": _now(),
                    "command_id": res.id,
                },
            }})
            await emit_platform_event(
                subject="device.trust.changed",
                source="nexus.agent.repair",
                actor={"id": agent["id"], "name": agent.get("hostname") or "Nexus Agent", "role": "device"},
                client_id=agent.get("client_id") or None,
                payload={
                    "device_id": agent["id"],
                    "state": repair_status,
                    "command_id": res.id,
                    "actions": (repair_command.get("payload") or {}).get("actions") or [],
                },
            )
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile agent trust repair")
    # Maintenance windows queue commands asynchronously; reconcile the window
    # record when the agent returns instead of leaving a permanent "queued".
    try:
        maintenance_run = await db.maintenance_window_runs.find_one({"command_id": res.id}, {"_id": 0, "window_id": 1})
        if maintenance_run:
            run_status = "ok" if res.status == "ok" else "failed"
            await db.maintenance_window_runs.update_one({"command_id": res.id}, {"$set": {
                "status": run_status, "message": f"Agent command {res.status} (exit code {res.exit_code})", "finished_at": _now(),
            }})
            runs = await db.maintenance_window_runs.find({"window_id": maintenance_run["window_id"]}, {"_id": 0, "status": 1}).to_list(500)
            counts = {"queued": 0, "ok": 0, "failed": 0, "skipped": 0}
            for run in runs:
                counts[run.get("status", "skipped")] = counts.get(run.get("status", "skipped"), 0) + 1
            await db.maintenance_windows.update_one({"id": maintenance_run["window_id"]}, {"$set": {"summary_counts": counts, "reconciled_at": _now()}})
            from app.routers.maintenance_windows import reconcile_window_from_runs
            await reconcile_window_from_runs(maintenance_run["window_id"])
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile maintenance command")
    # Command-console sessions use the same agent transport. Persist actual
    # stdout/stderr only after the endpoint has returned its command result.
    try:
        terminal_command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"]},
            {"_id": 0, "terminal_session_id": 1, "terminal_command_id": 1},
        )
        terminal_session_id = (terminal_command or {}).get("terminal_session_id")
        if terminal_session_id:
            terminal_status = "completed" if res.status == "ok" else ("timeout" if res.status == "timeout" else "failed")
            terminal_output = res.stdout or res.stderr or "Command returned no output."
            await db.terminal_sessions.update_one(
                {"id": terminal_session_id, "commands.id": res.id},
                {"$set": {
                    "commands.$.status": terminal_status,
                    "commands.$.output": terminal_output,
                    "commands.$.stderr": res.stderr or "",
                    "commands.$.exit_code": res.exit_code,
                    "commands.$.duration_ms": res.duration_ms,
                    "commands.$.completed_at": _now(),
                    "last_result_at": _now(),
                }},
            )
    except Exception:
        logger.exception("[nexus-agent] failed to mirror command-console result")
    # File transfer status is evidence from the bound Agent command result;
    # staging a file is never represented as successful endpoint delivery.
    try:
        transfer_command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"], "kind": "file_transfer_download"},
            {"_id": 0, "payload": 1},
        )
        transfer_id = str(((transfer_command or {}).get("payload") or {}).get("transfer_id") or "")
        if transfer_id:
            transfer_status = "completed" if res.status == "ok" else ("timed_out" if res.status == "timeout" else "failed")
            await db.agent_file_transfers.update_one(
                {
                    "id": transfer_id, "tenant_id": platform_tenant_id(agent),
                    "agent_id": agent["id"], "client_id": agent.get("client_id"), "status": {"$in": ["queued", "dispatched"]},
                },
                {"$set": {
                    "status": transfer_status, "completed_at": _now(), "agent_exit_code": res.exit_code,
                    "agent_detail": (res.stdout or res.stderr or "Agent returned no transfer detail.")[:1000],
                }},
            )
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile file transfer")
    try:
        mirrored = await db.devices.find_one({"nexus_agent_id": agent["id"]}, {"_id": 0, "id": 1, "name": 1})
        command = await db.nexus_agent_commands.find_one({"id": res.id, "device_id": agent["id"]}, {"_id": 0, "kind": 1})
        if mirrored:
            outcome = "completed" if res.status == "ok" else res.status
            await log_activity(
                {"id": "nexus-agent", "name": "NexusOps Agent"}, "agent_command", "device", mirrored["id"], mirrored.get("name", "Endpoint"),
                f"{command.get('kind', 'agent command') if command else 'Agent command'} {outcome} (exit code {res.exit_code}, {res.duration_ms} ms).",
                metadata={"command_id": res.id, "status": res.status, "exit_code": res.exit_code},
            )
            await db.device_events.insert_one({
                "id": str(uuid.uuid4()), "device_id": mirrored["id"], "event_type": "script_executed",
                "message": f"{command.get('kind', 'Agent command') if command else 'Agent command'} {outcome} (exit code {res.exit_code}).",
                "severity": "info" if res.status == "ok" else "error", "timestamp": _now(), "source": "nexus-agent",
            })
    except Exception:
        logger.exception("[nexus-agent] failed to write command audit entry")
    # Native elevation commands are reflected in the purpose-built, immutable
    # audit trail as well as the normal agent command history.
    try:
        elevate_command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"], "kind": "elevate_launch"},
            {"_id": 0},
        )
        if elevate_command:
            from app.routers.permission_elevation import record_native_elevation_execution
            await record_native_elevation_execution(elevate_command, {
                "status": res.status,
                "exit_code": res.exit_code,
                "stdout": res.stdout,
                "stderr": res.stderr,
                "duration_ms": res.duration_ms,
            }, agent)
    except Exception:
        logger.exception("[nexus-agent] failed to record Nexus Elevate execution")
    # Companion readiness is recorded only after the agent has returned a
    # verified successful installation result.
    try:
        companion_command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"], "kind": "install_companion"},
            {"_id": 0},
        )
        if companion_command and res.status == "ok":
            companion_payload = companion_command.get("payload") or {}
            installed_state = {
                "client_companion_installed_at": _now(),
                "client_companion_sha256": companion_payload.get("sha256", ""),
                "nexus_elevate.state": "active",
                "nexus_elevate.active_at": _now(),
                "nexus_elevate.companion_sha256": companion_payload.get("sha256", ""),
            }
            if companion_payload.get("tray_sha256"):
                installed_state["tray_companion_sha256"] = companion_payload["tray_sha256"]
                installed_state["nexus_elevate.tray_companion_sha256"] = companion_payload["tray_sha256"]
            await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
                **installed_state,
            }})
            await _mirror_elevate_state_to_device(agent["id"], "active", {
                "nexus_elevate_active_at": _now(),
                "nexus_elevate_companion_sha256": companion_payload.get("sha256", ""),
                "nexus_elevate_tray_companion_sha256": companion_payload.get("tray_sha256", ""),
            })
            await _resolve_elevate_companion_failure(agent["id"])
            await _audit(db, "companion_installed", {"device_id": agent["id"], "command_id": res.id})
        elif companion_command:
            await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
                "nexus_elevate.state": "deployment_failed",
                "nexus_elevate.last_error": (res.stderr or res.stdout or "Companion deployment failed")[:500],
                "nexus_elevate.last_attempt_at": _now(),
            }})
            await _mirror_elevate_state_to_device(agent["id"], "deployment_failed", {
                "nexus_elevate_last_error": (res.stderr or res.stdout or "Companion deployment failed")[:500],
            })
            await _notify_elevate_companion_failure(agent, res.stderr or res.stdout or "Companion deployment failed")
    except Exception:
        logger.exception("[nexus-agent] failed to record companion deployment")
    try:
        remote_command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"], "kind": "install_remote_companion"},
            {"_id": 0},
        )
        if remote_command and res.status == "ok":
            remote_hash = str((remote_command.get("payload") or {}).get("remote_sha256") or "")
            await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
                "remote_companion_state": "installed", "remote_companion_sha256": remote_hash,
                "remote_companion_installed_at": _now(), "remote_companion_last_error": "",
            }})
            await _audit(db, "native_remote_companion_installed", {"device_id": agent["id"], "command_id": res.id})
        elif remote_command:
            await db.nexus_agents.update_one({"id": agent["id"]}, {"$set": {
                "remote_companion_state": "deployment_failed",
                "remote_companion_last_error": (res.stderr or res.stdout or "Remote Companion deployment failed")[:500],
                "remote_companion_last_attempt_at": _now(),
            }})
    except Exception:
        logger.exception("[nexus-agent] failed to record Nexus Remote Companion deployment")
    try:
        canary_command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"], "kind": "canary_deploy"},
            {"_id": 0},
        )
        if canary_command:
            payload = canary_command.get("payload") or {}
            canary_id = payload.get("canary_id")
            updates: dict[str, Any] = {
                "agent_command_id": res.id,
                "last_command_result_at": _now(),
            }
            if res.status == "ok":
                manifest = json.loads(res.stdout or "{}")
                updates.update({
                    "status": "active",
                    "expected_sha256": str(manifest.get("sha256") or ""),
                    "file_path": str(manifest.get("path") or payload.get("canary_path") or ""),
                    "deployed_at": _now(),
                    "deployment_error": "",
                })
                await _audit(db, "canary_deployed", {"canary_id": canary_id, "device_id": agent["id"], "command_id": res.id})
            else:
                updates.update({"status": "failed", "deployment_error": res.stderr or "Agent deployment failed"})
                await _audit(db, "canary_deploy_failed", {"canary_id": canary_id, "device_id": agent["id"], "command_id": res.id})
            await db.ransomware_canaries.update_one({"id": canary_id, "agent_id": agent["id"]}, {"$set": updates})
    except Exception:
        logger.exception("[nexus-agent] failed to reconcile ransomware canary deployment")
    # Scripts queued from the Scripting workspace use this same transport, so
    # mirror their agent result into the execution history.
    try:
        command = await db.nexus_agent_commands.find_one(
            {"id": res.id, "device_id": agent["id"]},
            {"_id": 0, "script_execution_id": 1, "dispatched_at": 1},
        )
        execution_id = (command or {}).get("script_execution_id")
        if execution_id:
            now = _now()
            final_status = "completed" if res.status == "ok" else ("timeout" if res.status == "timeout" else "failed")
            await db.script_executions.update_one({"id": execution_id}, {"$set": {
                "status": final_status,
                "exit_code": res.exit_code,
                "output": res.stdout or "",
                "error_output": res.stderr or "",
                "duration_ms": res.duration_ms,
                "duration_seconds": round(res.duration_ms / 1000, 3),
                "started_at": (command or {}).get("dispatched_at") or now,
                "completed_at": now,
            }})
    except Exception:
        logger.exception("[nexus-agent] failed to mirror script execution result")
    return {"ok": True}


# ----------------------------------------------------------------------
# ADMIN-FACING ENDPOINTS  (JWT Bearer auth)
# ----------------------------------------------------------------------

@router.get("/nexus-agent/agents")
async def list_agents(client_id: str | None = None, user=Depends(get_current_user)):
    q: dict[str, Any] = {}
    if client_id:
        q["client_id"] = client_id
    cursor = db.nexus_agents.find(scoped_query(user, q), {"agent_token": 0}).sort("last_seen", -1)
    agents = await cursor.to_list(length=2000)
    for a in agents:
        a.pop("_id", None)
        a["online"] = _is_online(a.get("last_seen"))
        a["trust"] = agent_trust_state(a)
    return agents


@router.get("/nexus-agent/agents/{device_id}")
async def get_agent(device_id: str, user=Depends(require_agent_operator)):
    agent = await _agent_in_scope(device_id, user, "agent.read")
    agent.pop("agent_token", None)
    agent["trust"] = agent_trust_state(agent)
    # Recent commands
    cmds = await db.nexus_agent_commands.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1).to_list(length=50)
    # Heartbeat history (last 60 points)
    hb = await db.nexus_agent_heartbeats.find({"device_id": device_id}, {"_id": 0}).sort("at", -1).to_list(length=60)
    hb.reverse()
    return {"agent": agent, "commands": cmds, "heartbeats": hb}


@router.get("/nexus-agent/trust/overview")
async def trust_overview(user=Depends(get_current_user)):
    """Summarise endpoint identity, policy and local resilience evidence."""
    agents = await db.nexus_agents.find(
        scoped_query(user, {"is_active": True}),
        {
            "_id": 0,
            "id": 1,
            "hostname": 1,
            "client_id": 1,
            "client_name": 1,
            "last_seen": 1,
            "device_identity": 1,
            "policy_evidence": 1,
            "self_repair": 1,
            "update_evidence": 1,
        },
    ).sort("last_seen", -1).to_list(length=10_000)
    client_ids = list({str(agent.get("client_id")) for agent in agents if agent.get("client_id")})
    clients = await db.clients.find(
        {"id": {"$in": client_ids}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(length=max(1, len(client_ids)))
    client_names = {str(client.get("id")): str(client.get("name") or "") for client in clients}
    counts = {
        "total": len(agents),
        "mtls_verified": 0,
        "certificate_issued": 0,
        "legacy_token": 0,
        "certificate_expired": 0,
        "policy_acknowledged": 0,
        "self_repair_healthy": 0,
        "signed_update_verified": 0,
    }
    attention: list[dict[str, Any]] = []
    for agent in agents:
        trust = agent_trust_state(agent)
        status = trust["status"]
        if status in counts:
            counts[status] += 1
        if status == "mtls_verified":
            counts["certificate_issued"] += 1
        policy_ok = (agent.get("policy_evidence") or {}).get("status") == "acknowledged"
        repair_ok = (agent.get("self_repair") or {}).get("status") == "healthy"
        update_ok = bool((agent.get("update_evidence") or {}).get("signature_verified"))
        counts["policy_acknowledged"] += int(policy_ok)
        counts["self_repair_healthy"] += int(repair_ok)
        counts["signed_update_verified"] += int(update_ok)
        issues: list[str] = []
        if status in {"legacy_token", "certificate_expired"}:
            issues.append("Device certificate requires enrollment or renewal")
        elif status == "certificate_issued":
            issues.append("Certificate issued; validated proxy transport not yet observed")
        if not policy_ok:
            issues.append("Current policy has not been acknowledged")
        if not repair_ok:
            issues.append("Local self-repair evidence is missing or unhealthy")
        if issues:
            attention.append({
                "device_id": agent.get("id"),
                "hostname": agent.get("hostname") or "Unnamed endpoint",
                "client_id": agent.get("client_id"),
                "client_name": agent.get("client_name") or client_names.get(str(agent.get("client_id"))) or "Unassigned client",
                "online": _is_online(agent.get("last_seen")),
                "trust_status": status,
                "issues": issues,
                "last_seen": agent.get("last_seen"),
            })
    return {
        "counts": counts,
        "attention": attention[:100],
        "transport": {
            "mode": "token-compatible-mtls-ready",
            "proxy_header": "X-Client-Cert-Fingerprint",
            "proxy_trust_enabled": MTLS_PROXY_TRUST_ENABLED,
            "note": "mTLS is recorded only when a validating reverse proxy supplies the verified certificate fingerprint.",
        },
    }


@router.post("/nexus-agent/agents/{device_id}/trust/remediate")
async def remediate_agent_trust(
    device_id: str,
    req: AgentRepairRequest,
    user=Depends(require_action("agent.trust.remediate")),
):
    agent = await _agent_in_scope(device_id, user, "agent.trust.remediate")
    if not agent.get("is_active"):
        raise HTTPException(404, "agent not found")
    if not _is_online(agent.get("last_seen")):
        raise HTTPException(409, "agent is offline; reconnect it before repairing trust")
    command_id = str(uuid.uuid4())
    now = _now()
    await db.nexus_agent_commands.insert_one({
        "id": command_id,
        "device_id": device_id,
        "client_id": agent.get("client_id"),
        "kind": "agent_repair",
        "payload": {
            "actions": req.actions,
            "reason": req.reason.strip(),
        },
        "status": "pending",
        "queued_by": user.get("email") or user.get("id"),
        "created_at": now,
    })
    await _audit(db, "trust_repair_queued", {
        "device_id": device_id,
        "command_id": command_id,
        "actions": req.actions,
        "reason": req.reason.strip(),
        "by": user.get("email") or user.get("id"),
    })
    await emit_platform_event(
        subject="device.trust.changed",
        client_id=agent.get("client_id"),
        payload={
            "device_id": device_id,
            "state": "repair_queued",
            "command_id": command_id,
            "actions": req.actions,
            "reason": req.reason.strip(),
        },
        source="nexus-agent",
        actor={
            "id": user.get("id") or user.get("email"),
            "name": user.get("name") or user.get("email"),
            "role": user.get("role") or "technician",
        },
    )
    return {"ok": True, "command_id": command_id, "status": "pending"}


@router.post("/nexus-agent/agents/{device_id}/command")
async def queue_command(device_id: str, req: CommandRequest, user=Depends(require_agent_operator)):
    scoped_agent = await _agent_in_scope(device_id, user, "agent.command.queue")
    agent_query: dict[str, Any] = {
        "id": device_id,
        "client_id": scoped_agent.get("client_id"),
        "is_active": True,
    }
    if not req.include_offline:
        agent_query["last_seen"] = {"$gte": _online_cutoff()}
    agent = await db.nexus_agents.find_one(agent_query)
    if not agent:
        detail = "agent is offline; set include_offline=true to queue for later" if not req.include_offline else "agent not found"
        raise HTTPException(409 if not req.include_offline else 404, detail)
    cmd_id = str(uuid.uuid4())
    doc = {
        "id": cmd_id,
        "device_id": device_id,
        "client_id": scoped_agent.get("client_id"),
        "kind": req.kind,
        "payload": req.payload or {},
        "status": "pending",
        "queued_by": user.get("email") or user.get("id"),
        "created_at": _now(),
    }
    await db.nexus_agent_commands.insert_one(doc)
    await _audit(db, "queue", {"cmd_id": cmd_id, "device_id": device_id, "kind": req.kind, "by": doc["queued_by"]})
    return {"id": cmd_id, "status": "pending"}


@router.post("/nexus-agent/companions/deploy")
async def deploy_client_companion(req: CompanionDeployRequest, user=Depends(require_agent_operator)):
    """Queue the signed user-session companion to selected online agents.

    The agent validates the SHA-256 after download. A companion is copied to
    the agent installation folder but is never launched by the service, so it
    still opens only in an interactive user session.
    """
    companion = _companion_binary_info()
    if not companion["exists"]:
        raise HTTPException(409, "Nexus Client Chat companion binary is not available on the server")
    tray_companion = _tray_companion_binary_info()
    selected_ids = list(dict.fromkeys([item.strip() for item in req.device_ids if item and item.strip()]))
    if req.all_online:
        agents = await db.nexus_agents.find(scoped_query(user, {
            "is_active": True,
            "last_seen": {"$gte": _online_cutoff()},
            "agent_version": AGENT_VERSION,
        }), {"_id": 0, "id": 1, "hostname": 1, "client_id": 1}).sort("last_seen", -1).to_list(MAX_FLEET_TARGETS)
    else:
        if not selected_ids:
            raise HTTPException(400, "Select at least one online agent or choose all online agents")
        agents = await db.nexus_agents.find(scoped_query(user, {
            "id": {"$in": selected_ids},
            "is_active": True,
            "last_seen": {"$gte": _online_cutoff()},
            "agent_version": AGENT_VERSION,
        }), {"_id": 0, "id": 1, "hostname": 1, "client_id": 1}).to_list(MAX_FLEET_TARGETS)
        if len({agent.get("id") for agent in agents}) != len(selected_ids):
            raise HTTPException(404, "One or more selected agents were unavailable or outside your client scope")
    if not agents:
        raise HTTPException(409, "No selected Nexus Agents are online with the current companion-rollout agent version")

    now = _now()
    commands: list[dict] = []
    for agent in agents:
        commands.append({
            "id": str(uuid.uuid4()),
            "device_id": agent["id"],
            "client_id": agent.get("client_id"),
            "kind": "install_companion",
            "payload": {
                "sha256": companion["sha256"],
                "tray_sha256": tray_companion["sha256"] if tray_companion["exists"] else "",
            },
            "status": "pending",
            "queued_by": user.get("email") or user.get("id"),
            "created_at": now,
        })
    await db.nexus_agent_commands.insert_many(commands)
    for command in commands:
        rollout_state = {
            "nexus_elevate.state": "deploying",
            "nexus_elevate.entitled_at": now,
            "nexus_elevate.command_id": command["id"],
            "nexus_elevate.companion_sha256": companion["sha256"],
        }
        if tray_companion["exists"]:
            rollout_state["nexus_elevate.tray_companion_sha256"] = tray_companion["sha256"]
        await db.nexus_agents.update_one({"id": command["device_id"]}, {"$set": rollout_state})
        await _mirror_elevate_state_to_device(command["device_id"], "deploying")
    await _audit(db, "companion_deploy", {
        "count": len(commands),
        "device_ids": [command["device_id"] for command in commands],
        "sha256": companion["sha256"],
        "tray_sha256": tray_companion["sha256"] if tray_companion["exists"] else "",
        "by": user.get("email") or user.get("id"),
    })
    return {
        "queued": len(commands),
        "commands": [{"id": command["id"], "device_id": command["device_id"]} for command in commands],
        "companion_sha256": companion["sha256"],
        "tray_companion_sha256": tray_companion["sha256"] if tray_companion["exists"] else "",
    }


@router.get("/nexus-agent/agents/{device_id}/commands")
async def agent_commands(
    device_id: str,
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_agent_operator),
):
    await _agent_in_scope(device_id, user, "agent.command.read")
    cur = db.nexus_agent_commands.find({"device_id": device_id}, {"_id": 0}).sort("created_at", -1)
    return await cur.to_list(length=limit)


# ----------------------------------------------------------------------
# INSTALLER BUILDER
# ----------------------------------------------------------------------

def _build_installer_zip(
    client_id: str,
    client_name: str,
    enrollment_token: str,
    server_url: str,
    binary_bytes: bytes,
    chat_companion_bytes: bytes | None = None,
    tray_companion_bytes: bytes | None = None,
    remote_companion_bytes: bytes | None = None,
    heartbeat_secs: int = 60,
    poll_secs: int = 10,
) -> bytes:
    """Build a deterministic ZIP containing the service agent and companions.

    The package carries a signed release manifest so a technician can inspect
    the exact binary supplied at installation time.  The running agent still
    independently verifies signed update manifests before auto-updating.
    """
    config = {
        "server_url": server_url,
        "enrollment_token": enrollment_token,
        "client_id": client_id,
        "client_name": client_name,
        "heartbeat_secs": heartbeat_secs,
        "poll_secs": poll_secs,
        "nexus_shield": NEXUS_SHIELD_AGENT_PROFILE,
        "nexus_dns": NEXUS_DNS_AGENT_PROFILE,
    }
    companion_copy_line = (
        'copy /Y "%~dp0nexus-client-chat.exe" "%INSTDIR%\\nexus-client-chat.exe" >nul\r\n'
        'if errorlevel 1 ( echo Could not copy nexus-client-chat.exe & exit /b 1 )\r\n'
        if chat_companion_bytes else ""
    )
    tray_copy_line = (
        'copy /Y "%~dp0nexus-agent-tray.exe" "%INSTDIR%\\nexus-agent-tray.exe" >nul\r\n'
        'if errorlevel 1 ( echo Could not copy nexus-agent-tray.exe & exit /b 1 )\r\n'
        if tray_companion_bytes else ""
    )
    remote_copy_line = (
        'copy /Y "%~dp0nexus-remote-companion.exe" "%INSTDIR%\\nexus-remote-companion.exe" >nul\r\n'
        'if errorlevel 1 ( echo Could not copy nexus-remote-companion.exe & exit /b 1 )\r\n'
        if remote_companion_bytes else ""
    )
    companion_start_menu_lines = (
        'if not exist "%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\NexusMSP" mkdir "%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\NexusMSP"\r\n'
        'copy /Y "%~dp0Open Nexus Client Chat.bat" "%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\NexusMSP\\Nexus Client Chat.bat" >nul\r\n'
        if chat_companion_bytes else ""
    )
    agent_sha256 = hashlib.sha256(binary_bytes).hexdigest()
    release_manifest = {
        "schema_version": 1,
        "agent_version": AGENT_VERSION,
        "sha256": agent_sha256,
        "size": len(binary_bytes),
        "bundled_components": {
            "client_chat": bool(chat_companion_bytes),
            "agent_tray": bool(tray_companion_bytes),
            "native_remote": bool(remote_companion_bytes),
        },
        **sign_update_manifest(version=AGENT_VERSION, sha256=agent_sha256, size=len(binary_bytes)),
    }
    install_bat = (
        "@echo off\r\n"
        "REM NexusOps Agent installer\r\n"
        "setlocal\r\n"
        "set INSTDIR=%ProgramFiles%\\NexusOps Agent\r\n"
        "echo Installing NexusOps Agent to %INSTDIR%\r\n"
        "if not exist \"%INSTDIR%\" mkdir \"%INSTDIR%\"\r\n"
        "sc query NexusOpsAgent >nul 2>&1\r\n"
        "if not errorlevel 1 (\r\n"
        "  echo Stopping existing NexusOps Agent service...\r\n"
        "  sc stop NexusOpsAgent >nul 2>&1\r\n"
        "  timeout /t 3 /nobreak >nul\r\n"
        ")\r\n"
        "REM A previous interrupted install can leave a stopped service process holding the binary.\r\n"
        "REM This image name is reserved for NexusOps Agent and is stopped before replacing its files.\r\n"
        "taskkill /F /IM nexus-agent.exe >nul 2>&1\r\n"
        "timeout /t 2 /nobreak >nul\r\n"
        "copy /Y \"%~dp0nexus-agent.exe\" \"%INSTDIR%\\nexus-agent.exe\" >nul\r\n"
        "if errorlevel 1 ( echo Could not copy nexus-agent.exe & exit /b 1 )\r\n"
        "copy /Y \"%~dp0config.json\"     \"%INSTDIR%\\config.json\"     >nul\r\n"
        "if errorlevel 1 ( echo Could not copy config.json & exit /b 1 )\r\n"
        "icacls \"%INSTDIR%\\config.json\" /inheritance:r /grant:r \"*S-1-5-18:(F)\" \"*S-1-5-32-544:(F)\" >nul\r\n"
        "if errorlevel 1 ( echo Could not protect config.json & exit /b 1 )\r\n"
        + companion_copy_line
        + tray_copy_line
        + remote_copy_line
        + companion_start_menu_lines
        + "cd /d \"%INSTDIR%\"\r\n"
        "\"%INSTDIR%\\nexus-agent.exe\" -run install\r\n"
        "if errorlevel 1 (\r\n"
        "  echo Install failed. Run this script as Administrator.\r\n"
        "  exit /b 1\r\n"
        ")\r\n"
        "echo NexusOps Agent installed and started.\r\n"
        "endlocal\r\n"
    )
    uninstall_bat = (
        "@echo off\r\n"
        "set INSTDIR=%ProgramFiles%\\NexusOps Agent\r\n"
        "\"%INSTDIR%\\nexus-agent.exe\" -run uninstall\r\n"
        "rd /S /Q \"%INSTDIR%\" 2>nul\r\n"
        "echo NexusOps Agent uninstalled.\r\n"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("nexus-agent.exe", binary_bytes)
        z.writestr("release-manifest.json", json.dumps(release_manifest, indent=2, sort_keys=True))
        if chat_companion_bytes:
            z.writestr("nexus-client-chat.exe", chat_companion_bytes)
            z.writestr("Open Nexus Client Chat.bat", "@echo off\r\n\"%ProgramFiles%\\NexusOps Agent\\nexus-client-chat.exe\"\r\n")
        if tray_companion_bytes:
            z.writestr("nexus-agent-tray.exe", tray_companion_bytes)
        if remote_companion_bytes:
            z.writestr("nexus-remote-companion.exe", remote_companion_bytes)
        z.writestr("config.json", json.dumps(config, indent=2))
        z.writestr("install.bat", install_bat)
        z.writestr("uninstall.bat", uninstall_bat)
        z.writestr("README.txt",
                   "NexusOps Agent\n\n"
                   "1) Review release-manifest.json, then right-click install.bat Ã¢â€ â€™ Run as Administrator\n"
                   "2) Agent will register itself as the 'NexusOpsAgent' Windows service\n"
                   "3) Existing NexusOps Agent services are stopped, reconfigured and restarted safely\n"
                   "4) Within 60 seconds the device will appear in NexusOps Ã¢â€ â€™ Devices\n\n"
                   "The callback URL uses HTTPS except for explicit local loopback development.\n"
                   "To remove: run uninstall.bat as Administrator.\n")
    return buf.getvalue()


@router.post("/nexus-agent/installers/build")
async def build_installer(req: InstallerBuildRequest, request: Request, user=Depends(require_agent_operator)):
    await assert_client_scope(user, req.client_id, operation="agent.installer.build")
    client = await db.clients.find_one({"id": req.client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(404, "client not found")

    # Load admin settings for server_url (fallback to request origin)
    settings = await db.nexus_agent_settings.find_one({"_id": "settings"}) or {}
    server_url = str(settings.get("server_url") or "").strip()
    if not server_url:
        host = request.headers.get("x-forwarded-host") or request.headers.get("host")
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
        server_url = f"{scheme}://{host}" if host else str(request.base_url)
    server_url = _validate_agent_server_url(server_url, allow_empty=False)

    # Store the cadence in each package so the installer is deterministic.
    # Values may pre-date Pydantic validation, so normalise legacy settings.
    heartbeat_secs = min(max(int(settings.get("heartbeat_secs") or 60), 15), 3600)
    poll_secs = min(max(int(settings.get("poll_secs") or 10), 2), 300)

    # Read the compiled binary
    if not AGENT_BINARY_PATH.exists():
        raise HTTPException(500, f"agent binary missing at {AGENT_BINARY_PATH}; run `make windows` in /app/agent")
    binary_bytes = AGENT_BINARY_PATH.read_bytes()
    agent_binary_sha256 = hashlib.sha256(binary_bytes).hexdigest()
    chat_companion_bytes = CHAT_COMPANION_BINARY_PATH.read_bytes() if CHAT_COMPANION_BINARY_PATH.exists() else None
    tray_companion_bytes = TRAY_COMPANION_BINARY_PATH.read_bytes() if TRAY_COMPANION_BINARY_PATH.exists() else None
    remote_companion_bytes = REMOTE_COMPANION_BINARY_PATH.read_bytes() if REMOTE_COMPANION_BINARY_PATH.exists() else None
    includes_client_chat = bool(chat_companion_bytes)
    includes_agent_tray = bool(tray_companion_bytes)
    # Nexus Elevate is delivered through the protected agent service together
    # with the user-session Client Chat companion; it is not a separate agent.
    includes_nexus_elevate = includes_client_chat
    includes_nexus_shield = True
    includes_nexus_canary = True
    includes_nexus_dns = True
    includes_device_identity = True
    includes_signed_updates = True
    includes_policy_cache = True
    includes_self_repair = True

    # Mint an enrollment token bound to this client
    enrollment_token = secrets.token_urlsafe(28)
    await db.nexus_agent_enrollment_tokens.insert_one({
        "token": enrollment_token,
        "tenant_id": platform_tenant_id(user),
        "client_id": req.client_id,
        "client_name": client["name"],
        "is_active": True,
        "created_at": _now(),
        "created_by": user.get("email") or user.get("id"),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
        "note": req.note or "",
        "nexus_shield": NEXUS_SHIELD_AGENT_PROFILE,
        "nexus_dns": NEXUS_DNS_AGENT_PROFILE,
    })

    # Build the ZIP
    zip_bytes = _build_installer_zip(
        client_id=req.client_id,
        client_name=client["name"],
        enrollment_token=enrollment_token,
        server_url=server_url,
        binary_bytes=binary_bytes,
        chat_companion_bytes=chat_companion_bytes,
        tray_companion_bytes=tray_companion_bytes,
        remote_companion_bytes=remote_companion_bytes,
        heartbeat_secs=heartbeat_secs,
        poll_secs=poll_secs,
    )

    # Store on local installer storage (with a download token) and record a manifest entry
    download_token = secrets.token_urlsafe(20)
    storage_path = f"{APP_NAME}/agent-installers/{req.client_id}/{download_token}.zip"
    put_result = _storage_put(storage_path, zip_bytes, content_type="application/zip")

    manifest = {
        "id": str(uuid.uuid4()),
        "client_id": req.client_id,
        "client_name": client["name"],
        "enrollment_token": enrollment_token,
        "server_url": server_url,
        "storage_path": storage_path if put_result else "",
        "download_token": download_token,
        "size_bytes": len(zip_bytes),
        "created_at": _now(),
        "download_expires_at": (datetime.now(timezone.utc) + timedelta(hours=INSTALLER_DOWNLOAD_TTL_HOURS)).isoformat(),
        "created_by": user.get("email") or user.get("id"),
        "agent_version": AGENT_VERSION,
        "agent_sha256": agent_binary_sha256,
        "agent_size": len(binary_bytes),
        "package_format": "zip",
        "includes_client_chat": includes_client_chat,
        "includes_agent_tray": includes_agent_tray,
        "includes_nexus_elevate": includes_nexus_elevate,
        "includes_nexus_shield": includes_nexus_shield,
        "includes_nexus_canary": includes_nexus_canary,
        "includes_nexus_dns": includes_nexus_dns,
        "includes_device_identity": includes_device_identity,
        "includes_signed_updates": includes_signed_updates,
        "includes_policy_cache": includes_policy_cache,
        "includes_self_repair": includes_self_repair,
        "heartbeat_secs": heartbeat_secs,
        "poll_secs": poll_secs,
        "is_deleted": False,
    }
    await db.nexus_agent_installers.insert_one(manifest)
    await _audit(db, "installer_built", {
        "installer_id": manifest["id"],
        "client_id": req.client_id,
        "agent_version": AGENT_VERSION,
        "agent_sha256": agent_binary_sha256,
        "includes_client_chat": includes_client_chat,
        "includes_agent_tray": includes_agent_tray,
        "includes_nexus_elevate": includes_nexus_elevate,
        "includes_nexus_shield": includes_nexus_shield,
        "includes_nexus_canary": includes_nexus_canary,
        "includes_nexus_dns": includes_nexus_dns,
        "includes_device_identity": includes_device_identity,
        "includes_signed_updates": includes_signed_updates,
        "includes_policy_cache": includes_policy_cache,
        "includes_self_repair": includes_self_repair,
        "heartbeat_secs": heartbeat_secs,
        "poll_secs": poll_secs,
        "by": manifest["created_by"],
    })

    # Keep a direct local request on its real scheme (HTTP in local development),
    # while still respecting the public origin supplied by a reverse proxy.
    api_base = str(request.base_url).rstrip("/")
    fwd_host = request.headers.get("x-forwarded-host")
    fwd_proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    if fwd_host:
        api_base = f"{fwd_proto}://{fwd_host}"
    return {
        "id": manifest["id"],
        "download_url": f"{api_base}/api/nexus-agent/installers/{download_token}/download",
        "download_expires_at": manifest["download_expires_at"],
        "filename": f"NexusOpsAgent_{client['name'].replace(' ', '_')}.zip",
        "size_bytes": len(zip_bytes),
        "agent_version": AGENT_VERSION,
        "agent_sha256": agent_binary_sha256,
        "agent_size": len(binary_bytes),
        "package_format": "zip",
        "includes_client_chat": includes_client_chat,
        "includes_agent_tray": includes_agent_tray,
        "includes_nexus_elevate": includes_nexus_elevate,
        "includes_nexus_shield": includes_nexus_shield,
        "includes_nexus_canary": includes_nexus_canary,
        "includes_nexus_dns": includes_nexus_dns,
        "includes_device_identity": includes_device_identity,
        "includes_signed_updates": includes_signed_updates,
        "includes_policy_cache": includes_policy_cache,
        "includes_self_repair": includes_self_repair,
        "server_url": server_url,
        "heartbeat_secs": heartbeat_secs,
        "poll_secs": poll_secs,
    }


@router.get("/nexus-agent/installers/{token}/download")
async def installer_download(token: str):
    manifest = await db.nexus_agent_installers.find_one({"download_token": token, "is_deleted": False})
    if not manifest:
        raise HTTPException(404, "installer not found")
    if _timestamp_has_expired(manifest.get("download_expires_at")):
        # Deliberately do not distinguish a stale capability from a bad token.
        # An administrator can create a fresh package without extending an old
        # public URL that may have been forwarded or logged elsewhere.
        raise HTTPException(404, "installer not found")
    # Try storage first. A historical installer must never silently change
    # release if its package file has been pruned: rebuilding it with the
    # current binary would make the recorded version/hash misleading.
    zip_bytes: bytes | None = None
    if manifest.get("storage_path"):
        zip_bytes = _storage_get(manifest["storage_path"])
    if not zip_bytes:
        if str(manifest.get("agent_version") or "") != AGENT_VERSION:
            raise HTTPException(409, "installer artifact is unavailable; build a fresh installer for the current release")
        if not AGENT_BINARY_PATH.exists():
            raise HTTPException(500, "agent binary missing Ã¢â‚¬â€ rebuild required")
        current_binary = AGENT_BINARY_PATH.read_bytes()
        expected_sha256 = str(manifest.get("agent_sha256") or "")
        if expected_sha256 and not secrets.compare_digest(expected_sha256, hashlib.sha256(current_binary).hexdigest()):
            raise HTTPException(409, "installer artifact is unavailable; current binary does not match the recorded release")
        zip_bytes = _build_installer_zip(
            client_id=manifest["client_id"],
            client_name=manifest["client_name"],
            enrollment_token=manifest["enrollment_token"],
            server_url=str(manifest.get("server_url") or "").strip(),
            binary_bytes=current_binary,
            chat_companion_bytes=CHAT_COMPANION_BINARY_PATH.read_bytes() if CHAT_COMPANION_BINARY_PATH.exists() else None,
            tray_companion_bytes=TRAY_COMPANION_BINARY_PATH.read_bytes() if TRAY_COMPANION_BINARY_PATH.exists() else None,
            remote_companion_bytes=REMOTE_COMPANION_BINARY_PATH.read_bytes() if REMOTE_COMPANION_BINARY_PATH.exists() else None,
            heartbeat_secs=int(manifest.get("heartbeat_secs") or 60),
            poll_secs=int(manifest.get("poll_secs") or 10),
        )
    filename = f"NexusOpsAgent_{manifest['client_name'].replace(' ', '_')}.zip"
    await db.nexus_agent_installers.update_one(
        {"id": manifest["id"]},
        {
            "$set": {"last_downloaded_at": _now()},
            "$inc": {"download_count": 1},
        },
    )
    await _audit(db, "installer_downloaded", {
        "installer_id": manifest["id"],
        "client_id": manifest.get("client_id"),
        "download_count_increment": 1,
    })
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=zip_bytes, media_type="application/zip", headers=headers)


@router.get("/nexus-agent/installers")
async def list_installers(client_id: str | None = None, user=Depends(require_agent_operator)):
    q: dict[str, Any] = {"is_deleted": False}
    if client_id:
        q["client_id"] = client_id
    # Download and enrollment tokens are package capabilities, not fleet
    # metadata.  They must never appear in an ordinary installer listing.
    cur = db.nexus_agent_installers.find(
        scoped_query(user, q),
        {"_id": 0, "enrollment_token": 0, "download_token": 0, "storage_path": 0},
    ).sort("created_at", -1)
    return await cur.to_list(length=200)


@router.get("/nexus-agent/binary/latest")
async def latest_binary(
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    if not AGENT_BINARY_PATH.exists():
        raise HTTPException(404, "agent binary not built; run `make windows` in /app/agent")
    return Response(
        content=AGENT_BINARY_PATH.read_bytes(),
        media_type="application/vnd.microsoft.portable-executable",
        headers={"Content-Disposition": 'attachment; filename="nexus-agent.exe"'},
    )


@router.get("/nexus-agent/version")
async def version_manifest():
    """Returns the current latest-binary version + SHA256 + size. Used by agents
    for auto-update verification (also embedded in heartbeat responses)."""
    info = _binary_info()
    if not info["exists"]:
        return info
    return {
        **info,
        **sign_update_manifest(
            version=info["version"],
            sha256=info["sha256"],
            size=info["size"],
        ),
    }


# ----------------------------------------------------------------------
# FLEET OPERATIONS Ã¢â‚¬â€ the differentiator surface
# ----------------------------------------------------------------------

@router.get("/nexus-agent/fleet/version-distribution")
async def fleet_version_distribution(user=Depends(get_current_user)):
    """Version-distribution donut data for the Fleet Control Room."""
    agents = await db.nexus_agents.find(
        scoped_query(user, {"is_active": True}),
        {"_id": 0, "agent_version": 1},
    ).to_list(length=10_000)
    version_counts: dict[str, int] = {}
    for agent in agents:
        version = str(agent.get("agent_version") or "unknown")
        version_counts[version] = version_counts.get(version, 0) + 1
    rows = [
        {"version": version, "count": count}
        for version, count in sorted(version_counts.items(), key=lambda item: item[1], reverse=True)
    ]
    latest = _binary_info()["version"]
    total = sum(r["count"] for r in rows) or 1
    for r in rows:
        r["pct"] = round(r["count"] * 100 / total, 1)
        r["is_latest"] = r["version"] == latest
    return {
        "latest_version": latest,
        "total_agents": sum(r["count"] for r in rows),
        "rows": rows,
    }


@router.get("/nexus-agent/fleet/activity")
async def fleet_activity(
    limit: int = Query(60, ge=1, le=200),
    user=Depends(get_current_user),
):
    """Bloomberg-style ticker of recent fleet events: enrollments + commands +
    heartbeat anomalies. Most-recent first."""
    events: list[dict] = []
    allowed_agents = await db.nexus_agents.find(
        scoped_query(user, {"is_active": True}),
        {"_id": 0, "id": 1},
    ).to_list(length=10_000)
    allowed_agent_ids = [agent["id"] for agent in allowed_agents if agent.get("id")]
    if not allowed_agent_ids:
        return {"events": []}
    # Recent enrollments
    cur = db.nexus_agent_audit.find({
        "kind": {"$in": ["enroll", "re-enroll"]},
        "payload.device_id": {"$in": allowed_agent_ids},
    }, {"_id": 0}).sort("at", -1).limit(20)
    async for a in cur:
        p = a.get("payload") or {}
        events.append({
            "kind": "enrollment",
            "label": "ENROLLED" if a["kind"] == "enroll" else "RE-ENROLLED",
            "at": a.get("at"),
            "device_id": p.get("device_id"),
            "hostname": p.get("hostname") or "",
            "client_id": p.get("client_id"),
            "tone": "emerald",
        })
    # Recent commands
    cur = db.nexus_agent_commands.find(
        {"device_id": {"$in": allowed_agent_ids}},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit)
    async for c in cur:
        events.append({
            "kind": "command",
            "label": (c.get("kind") or "?").upper(),
            "at": c.get("completed_at") or c.get("dispatched_at") or c.get("created_at"),
            "device_id": c.get("device_id"),
            "status": c.get("status"),
            "by": c.get("queued_by"),
            "tone": "emerald" if c.get("status") == "ok" else "rose" if c.get("status") == "error" else "amber" if c.get("status") == "timeout" else "cyan",
        })
    # Use immutable heartbeat rows so the feed represents actual events rather
    # than repeatedly presenting each agent's mutable last_seen value as new.
    cur = db.nexus_agent_heartbeats.find(
        {"device_id": {"$in": allowed_agent_ids}},
        {"_id": 0},
    ).sort("at", -1).limit(20)
    async for heartbeat in cur:
        events.append({
            "kind": "heartbeat",
            "label": "HEARTBEAT",
            "at": heartbeat.get("at"),
            "device_id": heartbeat.get("device_id"),
            "cpu_percent": heartbeat.get("cpu_percent"),
            "mem_percent": heartbeat.get("mem_percent"),
            "tone": "cyan",
        })
    # Hydrate hostname for command events
    ids = list({e.get("device_id") for e in events if e.get("device_id") and not e.get("hostname")})
    if ids:
        host_map = {}
        cur = db.nexus_agents.find(
            scoped_query(user, {"id": {"$in": ids}}),
            {"_id": 0, "id": 1, "hostname": 1, "client_id": 1},
        )
        async for a in cur:
            host_map[a["id"]] = {"hostname": a.get("hostname"), "client_id": a.get("client_id")}
        for e in events:
            m = host_map.get(e.get("device_id"))
            if m:
                e["hostname"] = e.get("hostname") or m.get("hostname")
                e["client_id"] = e.get("client_id") or m.get("client_id")

    events.sort(key=lambda e: e.get("at") or "", reverse=True)
    return {"events": events[:limit]}


@router.get("/nexus-agent/fleet/recent-enrollments")
async def fleet_recent_enrollments(
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
):
    cur = db.nexus_agents.find(
        scoped_query(user),
        {"_id": 0, "agent_token": 0},
    ).sort("enrolled_at", -1).limit(limit)
    rows = await cur.to_list(length=limit)
    agent_ids = [row.get("id") for row in rows if row.get("id")]
    device_ids: dict[str, str] = {}
    if agent_ids:
        devices = db.devices.find(
            {"nexus_agent_id": {"$in": agent_ids}},
            {"_id": 0, "id": 1, "nexus_agent_id": 1},
        )
        async for device in devices:
            if device.get("nexus_agent_id") and device.get("id"):
                device_ids[device["nexus_agent_id"]] = device["id"]
    for row in rows:
        row["online"] = _is_online(row.get("last_seen"))
        row["device_record_id"] = device_ids.get(row.get("id"))
    return rows


class FleetScriptRequest(BaseModel):
    device_ids: list[str] = Field(default_factory=list, max_length=MAX_FLEET_TARGETS)
    client_id: str | None = Field(default=None, max_length=200)  # target every online agent for this client
    shell: Literal["powershell", "cmd", "bash"] = "powershell"
    script: str = Field(min_length=1, max_length=50_000)
    timeout_sec: int = Field(default=120, ge=1, le=900)
    include_offline: bool = False


@router.post("/nexus-agent/fleet/run-script")
async def fleet_run_script(req: FleetScriptRequest, user=Depends(require_agent_operator)):
    """Fan out a single script across many endpoints in parallel.
    Returns a batch_id + the list of queued command IDs so the UI can stream results."""
    if not (req.script or "").strip():
        raise HTTPException(400, "script required")

    base_query: dict[str, Any] = {"is_active": True}
    if not req.include_offline:
        base_query["last_seen"] = {"$gte": _online_cutoff()}

    targets: list[dict] = []
    requested_ids = list(dict.fromkeys(req.device_ids))
    if req.device_ids:
        cur = db.nexus_agents.find(
            scoped_query(user, {**base_query, "id": {"$in": requested_ids}}),
            {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "os": 1, "last_seen": 1},
        )
        targets = await cur.to_list(length=len(requested_ids))
    elif req.client_id:
        await assert_client_scope(user, req.client_id, operation="agent.fleet.run_script")
        cur = db.nexus_agents.find(
            scoped_query(user, {**base_query, "client_id": req.client_id}),
            {"_id": 0, "id": 1, "hostname": 1, "client_id": 1, "os": 1, "last_seen": 1},
        )
        targets = await cur.to_list(length=MAX_FLEET_TARGETS + 1)
        if len(targets) > MAX_FLEET_TARGETS:
            raise HTTPException(400, f"fleet scripts are limited to {MAX_FLEET_TARGETS} devices per batch")
    else:
        raise HTTPException(400, "device_ids or client_id required")

    if not targets:
        detail = "No selected agents are currently online" if not req.include_offline else "No active agents matched"
        raise HTTPException(409, detail)

    batch_id = str(uuid.uuid4())
    payload = {"shell": req.shell, "script": req.script, "timeout_sec": req.timeout_sec, "batch_id": batch_id}
    now = _now()
    queued_by = user.get("email") or user.get("id")
    docs: list[dict] = []
    for t in targets:
        cmd_id = str(uuid.uuid4())
        docs.append({
            "id": cmd_id,
            "device_id": t["id"],
            "client_id": t.get("client_id"),
            "hostname": t.get("hostname"),
            "kind": "run_script",
            "payload": payload,
            "status": "pending",
            "queued_by": queued_by,
            "created_at": now,
            "batch_id": batch_id,
        })
    try:
        await db.nexus_agent_commands.insert_many(docs, ordered=True)
    except Exception as exc:
        await db.nexus_agent_commands.delete_many({"batch_id": batch_id, "status": "pending"})
        logger.exception("[nexus-agent] failed to queue fleet batch %s", batch_id)
        raise HTTPException(500, "Unable to queue the complete fleet batch") from exc

    cmd_ids = [doc["id"] for doc in docs]
    matched_ids = {target["id"] for target in targets}
    skipped_ids = [device_id for device_id in requested_ids if device_id not in matched_ids]
    await _audit(db, "fleet_script", {
        "batch_id": batch_id,
        "count": len(cmd_ids),
        "skipped_count": len(skipped_ids),
        "shell": req.shell,
        "script_sha256": hashlib.sha256(req.script.encode("utf-8")).hexdigest(),
        "by": queued_by,
    })
    return {
        "batch_id": batch_id,
        "command_ids": cmd_ids,
        "targets": [{"id": t["id"], "hostname": t.get("hostname")} for t in targets],
        "skipped_device_ids": skipped_ids,
    }


@router.get("/nexus-agent/fleet/batch/{batch_id}")
async def fleet_batch_status(batch_id: str, user=Depends(require_agent_operator)):
    cur = db.nexus_agent_commands.find(_batch_scope(batch_id, user), {"_id": 0}).sort("created_at", 1)
    cmds = await cur.to_list(length=MAX_FLEET_TARGETS)
    if not cmds:
        raise HTTPException(404, "batch not found")
    counts = {"pending": 0, "dispatched": 0, "ok": 0, "error": 0, "timeout": 0, "cancelled": 0}
    for c in cmds:
        s = c.get("status", "pending")
        counts[s] = counts.get(s, 0) + 1
    return {"batch_id": batch_id, "total": len(cmds), "counts": counts, "commands": cmds}


@router.post("/nexus-agent/fleet/batch/{batch_id}/cancel")
async def fleet_batch_cancel(batch_id: str, user=Depends(require_agent_operator)):
    scope = _batch_scope(batch_id, user)
    existing = await db.nexus_agent_commands.find_one(scope, {"_id": 1})
    if not existing:
        raise HTTPException(404, "batch not found")
    result = await db.nexus_agent_commands.update_many(
        {**scope, "status": "pending"},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": _now(),
            "cancelled_by": user.get("email") or user.get("id"),
        }},
    )
    await _audit(db, "fleet_script_cancel", {
        "batch_id": batch_id,
        "cancelled_count": result.modified_count,
        "by": user.get("email") or user.get("id"),
    })
    return {"batch_id": batch_id, "cancelled": result.modified_count}


@router.get("/nexus-agent/companion/latest")
async def latest_client_companion(
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    """Authenticated companion download used only by an enrolled agent."""
    await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    if not CHAT_COMPANION_BINARY_PATH.exists():
        raise HTTPException(404, "Nexus Client Chat companion binary is not built")
    return Response(
        content=CHAT_COMPANION_BINARY_PATH.read_bytes(),
        media_type="application/vnd.microsoft.portable-executable",
        headers={"Content-Disposition": 'attachment; filename="nexus-client-chat.exe"'},
    )


@router.get("/nexus-agent/tray/latest")
async def latest_tray_companion(
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    """Authenticated tray companion download used only by an enrolled agent."""
    await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    if not TRAY_COMPANION_BINARY_PATH.exists():
        raise HTTPException(404, "Nexus Agent Tray companion binary is not built")
    return Response(
        content=TRAY_COMPANION_BINARY_PATH.read_bytes(),
        media_type="application/vnd.microsoft.portable-executable",
        headers={"Content-Disposition": 'attachment; filename="nexus-agent-tray.exe"'},
    )


@router.get("/nexus-agent/remote-companion/latest")
async def latest_remote_companion(
    x_agent_token: str | None = Header(None),
    x_client_cert_fingerprint: str | None = Header(None, alias="X-Client-Cert-Fingerprint"),
):
    """Authenticated Native Remote Companion download for enrolled agents only."""
    await _verify_agent_token(db, x_agent_token, x_client_cert_fingerprint)
    if not REMOTE_COMPANION_BINARY_PATH.exists():
        raise HTTPException(404, "Nexus Remote Companion binary is not built")
    return Response(
        content=REMOTE_COMPANION_BINARY_PATH.read_bytes(),
        media_type="application/vnd.microsoft.portable-executable",
        headers={"Content-Disposition": 'attachment; filename="nexus-remote-companion.exe"'},
    )


# ----------------------------------------------------------------------
# ADMIN SETTINGS
# ----------------------------------------------------------------------

@router.get("/nexus-agent/settings")
async def get_settings(user=Depends(require_agent_admin)):
    s = await db.nexus_agent_settings.find_one({"_id": "settings"}, {"_id": 0}) or {}
    return {
        "heartbeat_secs": s.get("heartbeat_secs", 60),
        "poll_secs": s.get("poll_secs", 10),
        "server_url": s.get("server_url", ""),
        "splashtop_enabled": s.get("splashtop_enabled", False),
        "splashtop_deploy_code_default": s.get("splashtop_deploy_code_default", ""),
        "auto_update_enabled": s.get("auto_update_enabled", True),
        "self_repair_enabled": s.get("self_repair_enabled", True),
        "require_signed_updates": s.get("require_signed_updates", True),
        "require_mtls": s.get("require_mtls", False),
        "winget_enabled": s.get("winget_enabled", False),
        "winget_allowed_ids": s.get("winget_allowed_ids", []),
        "agent_version": AGENT_VERSION,
        "agent_binary_exists": AGENT_BINARY_PATH.exists(),
        "agent_binary_sha256": _binary_info()["sha256"],
        "agent_binary_size": _binary_info()["size"],
        "client_companion_exists": _companion_binary_info()["exists"],
        "client_companion_sha256": _companion_binary_info()["sha256"],
        "client_companion_size": _companion_binary_info()["size"],
        "tray_companion_exists": _tray_companion_binary_info()["exists"],
        "tray_companion_sha256": _tray_companion_binary_info()["sha256"],
        "tray_companion_size": _tray_companion_binary_info()["size"],
        "transport_mode": "mtls-required" if s.get("require_mtls", False) else "token-compatible-mtls-ready",
        "mtls_proxy_header": "X-Client-Cert-Fingerprint",
        "mtls_proxy_trust_enabled": MTLS_PROXY_TRUST_ENABLED,
    }


@router.put("/nexus-agent/settings")
async def put_settings(payload: NexusAgentSettings, user=Depends(require_agent_admin)):
    if payload.require_mtls and not MTLS_PROXY_TRUST_ENABLED:
        raise HTTPException(
            409,
            "Enable NEXUS_AGENT_TRUST_PROXY_MTLS before requiring device certificates",
        )
    server_url = _validate_agent_server_url(payload.server_url)
    await db.nexus_agent_settings.update_one(
        {"_id": "settings"},
        {"$set": {
            "heartbeat_secs": payload.heartbeat_secs,
            "poll_secs": payload.poll_secs,
            "server_url": server_url,
            "splashtop_enabled": payload.splashtop_enabled,
            "splashtop_deploy_code_default": payload.splashtop_deploy_code_default,
            "auto_update_enabled": payload.auto_update_enabled,
            "self_repair_enabled": payload.self_repair_enabled,
            "require_signed_updates": payload.require_signed_updates,
            "require_mtls": payload.require_mtls,
            "winget_enabled": payload.winget_enabled,
            "winget_allowed_ids": [item.strip() for item in payload.winget_allowed_ids if item.strip()],
            "updated_at": _now(),
            "updated_by": user.get("email") or user.get("id"),
        }},
        upsert=True,
    )
    await _audit(db, "settings_updated", {
        "heartbeat_secs": payload.heartbeat_secs,
        "poll_secs": payload.poll_secs,
        "auto_update_enabled": payload.auto_update_enabled,
        "self_repair_enabled": payload.self_repair_enabled,
        "require_signed_updates": payload.require_signed_updates,
        "require_mtls": payload.require_mtls,
        "winget_enabled": payload.winget_enabled,
        "by": user.get("email") or user.get("id"),
    })
    return {"ok": True}


@router.get("/nexus-agent/stats")
async def stats(user=Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=3)).isoformat()
    active_agents = await db.nexus_agents.find(
        scoped_query(user, {"is_active": True}, site_field=None),
        {
            "_id": 0,
            "id": 1,
            "client_id": 1,
            "last_seen": 1,
            "device_identity": 1,
            "policy_evidence": 1,
            "self_repair": 1,
            "update_evidence": 1,
        },
    ).to_list(length=10_000)
    active_agent_ids = [agent["id"] for agent in active_agents if agent.get("id")]
    total = len(active_agents)
    online = sum(1 for agent in active_agents if str(agent.get("last_seen") or "") >= cutoff)
    cmds_pending = await db.nexus_agent_commands.count_documents(
        {"status": "pending", "device_id": {"$in": active_agent_ids}}
    )
    agent_device_query = scoped_query(
        user,
        {"nexus_agent_id": {"$in": active_agent_ids}},
    )
    agent_devices = await db.devices.count_documents(agent_device_query)
    assessed_devices = await db.devices.count_documents({
        "$and": [
            agent_device_query,
            {"security_assessed_at": {"$exists": True, "$ne": None}},
        ],
    })
    managed_devices = await db.devices.count_documents(scoped_query(user, {}))
    assessed_rows = await db.devices.find(
        {
            "$and": [
                agent_device_query,
                {"security_assessed_at": {"$exists": True, "$ne": None}},
            ],
        },
        {"_id": 0, "pending_patches": 1},
    ).to_list(5000)
    pending_updates = sum(int(row.get("pending_patches") or 0) for row in assessed_rows)
    trust_counts = {
        "certificate_issued": 0,
        "mtls_verified": 0,
        "policy_acknowledged": 0,
        "self_repair_healthy": 0,
        "signed_update_verified": 0,
    }
    by_client_counts: dict[str, int] = {}
    for row in active_agents:
        trust_status = agent_trust_state(row)["status"]
        trust_counts["certificate_issued"] += int(trust_status in {"certificate_issued", "mtls_verified"})
        trust_counts["mtls_verified"] += int(trust_status == "mtls_verified")
        trust_counts["policy_acknowledged"] += int((row.get("policy_evidence") or {}).get("status") == "acknowledged")
        trust_counts["self_repair_healthy"] += int((row.get("self_repair") or {}).get("status") == "healthy")
        trust_counts["signed_update_verified"] += int(bool((row.get("update_evidence") or {}).get("signature_verified")))
        client_id = str(row.get("client_id") or "unassigned")
        by_client_counts[client_id] = by_client_counts.get(client_id, 0) + 1
    by_client = sorted(by_client_counts.items(), key=lambda item: (-item[1], item[0]))[:12]
    return {
        "total_agents": total,
        "online_agents": online,
        "offline_agents": max(0, total - online),
        "pending_commands": cmds_pending,
        "agent_devices": agent_devices,
        "assessed_devices": assessed_devices,
        "managed_devices": managed_devices,
        "pending_updates": pending_updates,
        **trust_counts,
        "by_client": [{"client_id": client_id, "count": count} for client_id, count in by_client],
        "agent_version": AGENT_VERSION,
    }
