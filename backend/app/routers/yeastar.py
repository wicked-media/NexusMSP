import os
import asyncio
import logging
import re
import time
import httpx
from fastapi import APIRouter, HTTPException, Depends, Body, Request
from pymongo.errors import DuplicateKeyError
from typing import Optional, Any
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import assert_action_permission
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, assert_global_scope, scope_query
from app.services.yeastar import client as yeastar_client
from app.services.yeastar import registry as yeastar_registry
from app.services.yeastar import ycm
from app.services.yeastar.client import resolve_pbx, resolve_pbx_optional
from app.services.yeastar.errors import YeastarError, http_status_for

router = APIRouter()
logger = logging.getLogger(__name__)

# ============== YEASTAR PBX ENDPOINTS ==============

@router.get("/yeastar/status")
async def get_yeastar_status(current_user: dict = Depends(get_current_user)):
    configured = await db.yeastar_pbxs.find_one(
        {**scope_query(current_user), "enabled": {"$ne": False}, "pbx_url": {"$nin": ["", None]}, "client_api_id": {"$nin": ["", None]}, "client_secret": {"$nin": ["", None]}},
        {"_id": 1},
    )
    return {"configured": bool(configured), "mode": "client_pbx"}

@router.post("/yeastar/settings")
async def save_yeastar_settings(settings: dict, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="voice.legacy_settings.update")
    existing = await db.settings.find_one({"type": "yeastar"}, {"_id": 0}) or {}
    await db.settings.update_one(
        {"type": "yeastar"},
        {"$set": {
            "type": "yeastar",
            "pbx_url": settings.get("pbx_url", ""),
            "client_id": settings.get("client_id", ""),
            # A blank secret from the settings form means "keep the stored secret".
            "client_secret": settings.get("client_secret") or existing.get("client_secret", ""),
            "pbx_name": settings.get("pbx_name", existing.get("pbx_name", "")),
            "client_name": settings.get("client_name", existing.get("client_name", "")),
            "billing_policy": settings.get("billing_policy", existing.get("billing_policy", "all_enabled")),
            "agreement_mapping": settings.get("agreement_mapping", existing.get("agreement_mapping", "")),
            "product_mapping": settings.get("product_mapping", existing.get("product_mapping", "")),
            "auto_sync_schedule": settings.get("auto_sync_schedule", existing.get("auto_sync_schedule", "daily")),
            "automatic_billing": bool(settings.get("automatic_billing", existing.get("automatic_billing", False))),
            "approval_threshold": int(settings.get("approval_threshold", existing.get("approval_threshold", 0)) or 0),
            "tls_validation": bool(settings.get("tls_validation", existing.get("tls_validation", True))),
            "notifications": bool(settings.get("notifications", existing.get("notifications", True))),
            "enabled": bool(settings.get("enabled", existing.get("enabled", True))),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    yeastar_client.invalidate_token()
    return {"message": "Yeastar settings saved"}

@router.get("/yeastar/settings")
async def get_yeastar_settings(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="voice.legacy_settings.read")
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if settings:
        settings.pop("client_secret", None)
    return settings or {"type": "yeastar", "pbx_url": "", "client_id": ""}

@router.get("/yeastar/test-connection")
async def test_yeastar_connection(pbx_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Run a live test against one client-linked P-Series PBX."""
    if not pbx_id or pbx_id == "primary":
        raise HTTPException(status_code=400, detail="Choose a client-linked PBX to test")
    settings = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
    if not settings:
        raise HTTPException(status_code=404, detail="PBX not found")
    await assert_client_scope(current_user, settings.get("client_id"), operation="voice.pbx.connection.test", mask_not_found=True)
    if not settings or not _has_pbx_credentials(settings):
        return {"success": False, "message": "This PBX needs its base URL, Client ID, and Client Secret before it can be tested."}
    try:
        result = await _test_pbx_live(settings)
        now = datetime.now(timezone.utc).isoformat()
        await db.yeastar_pbxs.update_one(
            {"id": pbx_id},
            {"$set": {
                "status": "online",
                "last_test_at": now,
                "last_test_error": "",
                "api_latency_ms": result["api_latency_ms"],
                "system_name": result.get("system_name", ""),
                "model": result.get("model", ""),
                "firmware_version": result.get("firmware_version", ""),
                "serial_number": result.get("serial_number", ""),
                "updated_at": now,
            }},
        )
        await log_activity(
            current_user,
            "voice_pbx_connection_verified",
            "voice_pbx",
            pbx_id,
            settings.get("name") or "Yeastar PBX",
            f"Live PBX connection verified in {result['api_latency_ms']} ms.",
            metadata={"client_id": settings.get("client_id", ""), "api_latency_ms": result["api_latency_ms"]},
        )
        return {
            "success": True,
            "message": f"Connected to {result.get('system_name') or settings.get('name') or 'Yeastar PBX'} in {result['api_latency_ms']} ms.",
            **result,
        }
    except YeastarConnectionError as exc:
        now = datetime.now(timezone.utc).isoformat()
        status = "authentication_failed" if exc.kind == "authentication" else "offline"
        await db.yeastar_pbxs.update_one(
            {"id": pbx_id},
            {"$set": {"status": status, "last_test_at": now, "last_test_error": str(exc), "updated_at": now}},
        )
        await log_activity(
            current_user,
            "voice_pbx_connection_failed",
            "voice_pbx",
            pbx_id,
            settings.get("name") or "Yeastar PBX",
            f"Live PBX connection test failed: {exc}",
            metadata={"client_id": settings.get("client_id", ""), "error_kind": exc.kind},
        )
        return {"success": False, "message": str(exc), "error_kind": exc.kind}

# The shared client owns the failure taxonomy now, including the provider's
# eight-token limit message. The name is kept as an alias so existing call
# sites and tests keep importing one symbol.
YeastarConnectionError = YeastarError


# The YCM fleet transport lives in app.services.yeastar.ycm so the fleet
# connection shares one token discipline and one failure taxonomy with the PBX
# client. These five names stay as thin delegations because the routes below
# and the existing test suite call them by name.
def _normalise_ycm_url(value: str) -> str:
    return ycm.normalise_ycm_url(value)


def _ycm_items(payload: Any) -> list[dict]:
    return ycm.ycm_items(payload)


async def _ycm_get_token(settings: dict, *, strict: bool = False) -> str | None:
    return await ycm.get_ycm_token(settings, strict=strict)


async def _ycm_api_get(path: str, settings: dict) -> dict:
    return await ycm.ycm_api_get(path, settings)


def _safe_ycm_settings(record: dict | None) -> dict:
    return ycm.safe_ycm_settings(record)


@router.get("/yeastar/ycm/overview")
async def get_ycm_overview(current_user: dict = Depends(get_current_user)):
    # YCM credentials and unclaimed fleet discoveries are platform-wide integration
    # data. A client-scoped technician must use the PBXs already assigned to their
    # permitted clients, never this fleet administration surface.
    await assert_global_scope(current_user, operation="voice.ycm.overview")
    settings = await db.settings.find_one({"type": "yeastar_ycm"}, {"_id": 0}) or {}
    discoveries = await db.yeastar_ycm_discoveries.find({}, {"_id": 0}).sort("last_seen_at", -1).to_list(500)
    return {"connection": _safe_ycm_settings(settings), "discoveries": discoveries}


@router.post("/yeastar/ycm/settings")
async def save_ycm_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="voice.ycm.settings.update")
    existing = await db.settings.find_one({"type": "yeastar_ycm"}, {"_id": 0}) or {}
    try:
        base_url = _normalise_ycm_url(data.get("base_url") or existing.get("base_url") or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    client_id = str(data.get("client_id") or existing.get("client_id") or "").strip()
    client_secret = str(data.get("client_secret") or existing.get("client_secret") or "")
    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="YCM Client ID and Client Secret are required the first time this connection is saved")
    await db.settings.update_one(
        {"type": "yeastar_ycm"},
        {"$set": {"type": "yeastar_ycm", "base_url": base_url, "client_id": client_id, "client_secret": client_secret, "user_agent": str(data.get("user_agent") or existing.get("user_agent") or "NexusMSP/1.0").strip(), "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user.get("email", "system")}},
        upsert=True,
    )
    ycm.invalidate_ycm_token()
    return {"message": "YCM fleet connection saved", "connection": _safe_ycm_settings(await db.settings.find_one({"type": "yeastar_ycm"}, {"_id": 0}))}


@router.post("/yeastar/ycm/test")
async def test_ycm_connection(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="voice.ycm.connection.test")
    settings = await db.settings.find_one({"type": "yeastar_ycm"}, {"_id": 0}) or {}
    try:
        payload = await _ycm_api_get("v2/cloud_pbx/instances", settings)
        count = len(_ycm_items(payload))
        now = datetime.now(timezone.utc).isoformat()
        await db.settings.update_one({"type": "yeastar_ycm"}, {"$set": {"last_test_at": now, "last_test_status": "verified", "last_test_error": ""}})
        await log_activity(current_user, "voice_ycm_connection_verified", "voice_provider", "yeastar_ycm", "Yeastar Central Management", f"Verified YCM access and found {count} Cloud PBX record{'s' if count != 1 else ''}.")
        return {"success": True, "message": f"YCM connection verified. {count} Cloud PBX record{'s' if count != 1 else ''} available.", "cloud_pbx_count": count}
    except YeastarConnectionError as exc:
        now = datetime.now(timezone.utc).isoformat()
        await db.settings.update_one({"type": "yeastar_ycm"}, {"$set": {"last_test_at": now, "last_test_status": "failed", "last_test_error": str(exc)}})
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/yeastar/ycm/discover")
async def discover_ycm_cloud_pbxs(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="voice.ycm.discovery.run")
    settings = await db.settings.find_one({"type": "yeastar_ycm"}, {"_id": 0}) or {}
    try:
        payload = await _ycm_api_get("v2/cloud_pbx/instances", settings)
    except YeastarConnectionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    now = datetime.now(timezone.utc).isoformat()
    discoveries = []
    for item in _ycm_items(payload):
        external_id = str(item.get("id") or item.get("cloudPbxId") or item.get("sn") or item.get("serialNumber") or item.get("url") or uuid.uuid4())
        discovery_id = f"ycm:{external_id}"
        name = item.get("name") or item.get("instanceName") or item.get("pbxName") or item.get("sn") or "Yeastar Cloud PBX"
        url = item.get("url") or item.get("domain") or item.get("fqdn") or ""
        record = {"id": discovery_id, "provider": "yeastar_ycm", "external_id": external_id, "name": name, "pbx_url": url, "status": item.get("status") or item.get("state") or "discovered", "customer_name": item.get("customerName") or item.get("customer") or "", "raw": item, "last_seen_at": now, "updated_at": now}
        await db.yeastar_ycm_discoveries.update_one({"id": discovery_id}, {"$set": record, "$setOnInsert": {"created_at": now, "claimed_pbx_id": ""}}, upsert=True)
        discoveries.append(record)
    await db.settings.update_one({"type": "yeastar_ycm"}, {"$set": {"last_discovery_at": now, "last_test_status": "verified", "last_test_error": ""}})
    await log_activity(current_user, "voice_ycm_discovery_completed", "voice_provider", "yeastar_ycm", "Yeastar Central Management", f"Discovered {len(discoveries)} Cloud PBX record{'s' if len(discoveries) != 1 else ''}." )
    return {"discovered": len(discoveries), "items": discoveries}


@router.post("/yeastar/ycm/discoveries/{discovery_id}/claim")
async def claim_ycm_discovery(discovery_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Choose the Nexus client that owns this Cloud PBX")
    await assert_global_scope(current_user, operation="voice.ycm.discovery.claim")
    discovery = await db.yeastar_ycm_discoveries.find_one({"id": discovery_id}, {"_id": 0})
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not discovery:
        raise HTTPException(status_code=404, detail="YCM discovery record not found. Run discovery again.")
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    existing = await db.yeastar_pbxs.find_one({"ycm_discovery_id": discovery_id}, {"_id": 0})
    if existing:
        if existing.get("client_id") != client_id:
            raise HTTPException(status_code=409, detail=f"This Cloud PBX is already linked to {existing.get('client_name') or 'another client'}.")
        return {key: value for key, value in existing.items() if key != "client_secret"}
    now = datetime.now(timezone.utc).isoformat()
    record = {"id": str(uuid.uuid4()), "provider": "yeastar", "connection_mode": "ycm_discovered", "ycm_discovery_id": discovery_id, "ycm_external_id": discovery.get("external_id"), "client_id": client_id, "client_name": client.get("name", "Client"), "name": discovery.get("name") or "Yeastar Cloud PBX", "pbx_url": discovery.get("pbx_url") or "", "enabled": True, "status": "ycm_managed", "created_at": now, "updated_at": now, "created_by": current_user.get("email", "system"), "discovery_source": "ycm", "direct_api_configured": False}
    await db.yeastar_pbxs.insert_one(dict(record))
    await db.yeastar_ycm_discoveries.update_one({"id": discovery_id}, {"$set": {"claimed_pbx_id": record["id"], "claimed_client_id": client_id, "claimed_at": now}})
    await log_activity(current_user, "voice_ycm_cloud_pbx_claimed", "voice_pbx", record["id"], record["name"], f"Linked YCM-discovered Cloud PBX to {record['client_name']}. Direct PBX API access remains optional until live telemetry is enabled.", metadata={"client_id": client_id, "ycm_discovery_id": discovery_id})
    return {key: value for key, value in record.items() if key != "client_secret"}


# These four names are delegated to the shared client so the URL rules and the
# credential test exist once. They are kept because the routes below and the
# existing test suite call them by name.
def _normalise_pbx_url(value: str) -> str:
    return yeastar_client.normalise_pbx_url(value)


def _pbx_url(settings: dict) -> str:
    return yeastar_client.pbx_base_url(settings)


def _pbx_client_id(settings: dict) -> str:
    return yeastar_client.pbx_client_id(settings)


def _has_pbx_credentials(settings: dict) -> bool:
    return yeastar_client.has_credentials(settings)


async def _yeastar_get_token(settings: dict, *, strict: bool = False) -> str | None:
    """Return a token from the shared Yeastar client.

    Token lifetime, the provider's eight-token limit and credential revocation
    live in app.services.yeastar.client, so every caller shares one cache
    instead of minting a second token for the same PBX.
    """
    return await yeastar_client.get_token(settings, strict=strict)


async def _yeastar_api_get(path: str, params: dict = None, settings: dict | None = None, *, strict: bool = False, token: str | None = None) -> dict | list | None:
    """Make an authenticated PBX call through the shared client.

    ``settings`` is required. There is deliberately no fallback to the legacy
    single-tenant settings document: that document carries no client binding,
    so using it for any authenticated caller let a restricted technician read
    another customer's PBX. Callers that still serve the legacy path resolve
    it explicitly with ``resolve_pbx(..., include_legacy=True)``, which demands
    all-client scope.
    """
    settings = settings or await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if not settings:
        if strict:
            raise YeastarConnectionError("PBX configuration was not found.", "configuration")
        return None
    token = token or await _yeastar_get_token(settings, strict=strict)
    if not token:
        return None
    pbx_url = _pbx_url(settings)
    url = f"{pbx_url}/openapi/v1.0/{path}"
    query = {"access_token": token}
    if params:
        query.update(params)
    try:
        verify_tls = settings.get("tls_validation", os.environ.get('ALLOW_SELF_SIGNED_CERTS', 'false').lower() != 'true')
        async with httpx.AsyncClient(verify=verify_tls, timeout=15) as http:
            resp = await http.get(url, params=query, headers={"User-Agent": "OpenAPI"})
            if resp.status_code == 200 and resp.text:
                try:
                    data = resp.json()
                except ValueError as exc:
                    if strict:
                        raise YeastarConnectionError("The PBX returned an invalid API response.", "endpoint") from exc
                    return None
                if strict and isinstance(data, dict) and data.get("errcode", 0) != 0:
                    raise YeastarConnectionError(
                        f"Yeastar API check failed ({data.get('errmsg') or 'unknown error'}, error {data.get('errcode')}).",
                        "api",
                    )
                return data
            logger.error(f"Yeastar API {path}: status={resp.status_code}, body={resp.text[:200]}")
            if strict:
                raise YeastarConnectionError(f"The PBX returned HTTP {resp.status_code} for {path}.", "http")
            return None
    except YeastarConnectionError:
        raise
    except httpx.ConnectTimeout as exc:
        if strict:
            raise YeastarConnectionError("The PBX API timed out during its live system check.", "timeout") from exc
        return None
    except httpx.ConnectError as exc:
        if strict:
            raise YeastarConnectionError("The PBX became unreachable during its live system check.", "connection") from exc
        return None
    except Exception as e:
        logger.error(f"Yeastar API {path} error: {e}")
        if strict:
            raise YeastarConnectionError("The PBX API live check failed.", "api") from e
        return None


async def _test_pbx_live(settings: dict) -> dict:
    started = time.perf_counter()
    data = await _yeastar_api_get("system/information", settings=settings, strict=True)
    info = data.get("data", {}) if isinstance(data, dict) else {}
    return {
        "api_latency_ms": max(1, int((time.perf_counter() - started) * 1000)),
        "system_name": info.get("device_name", ""),
        "model": info.get("model_name", ""),
        "firmware_version": info.get("firmware_version", ""),
        "serial_number": info.get("sn", ""),
    }

@router.get("/yeastar/system-info")
async def get_yeastar_system_info(current_user: dict = Depends(get_current_user)):
    # Resolve a PBX inside the caller's own scope. The legacy singleton is
    # offered only to an all-client actor, never assumed.
    settings = await resolve_pbx_optional(current_user, include_legacy=True)
    data = await _yeastar_api_get("system/information", settings=settings)
    if data and data.get("errcode") == 0:
        info = data.get("data", {})
        uptime_sec = info.get("up_time", 0)
        days = uptime_sec // 86400
        hours = (uptime_sec % 86400) // 3600
        return {
            "hostname": info.get("device_name", "Unknown"),
            "firmware_version": info.get("firmware_version", "Unknown"),
            "model": info.get("model_name", ""),
            "serial_number": info.get("sn", ""),
            "system_time": info.get("system_time", ""),
            "uptime": f"{days} days, {hours} hours",
            "source": "live"
        }
    return {
        "hostname": "Not available", "firmware_version": "N/A",
        "model": "", "serial_number": "", "system_time": "",
        "uptime": "N/A", "source": "error",
        "error": data.get("errmsg", "Failed to connect") if data else "No credentials configured"
    }

@router.get("/yeastar/extensions")
async def get_yeastar_extensions(current_user: dict = Depends(get_current_user), settings: dict | None = None, token: str | None = None):
    settings = settings or await resolve_pbx_optional(current_user, include_legacy=True)
    data = await _yeastar_api_get("extension/list", settings=settings, token=token)
    if data and data.get("errcode") == 0:
        raw = data.get("data", [])
        result = []
        for i, ext in enumerate(raw if isinstance(raw, list) else []):
            # Determine registration status from online_status
            online = ext.get("online_status", {})
            registered = False
            ip_addr = None
            device_type = "Unknown"
            for dev_key in ["sip_phone", "linkus_desktop", "linkus_mobile", "linkus_web", "fxs_phone"]:
                dev = online.get(dev_key, {})
                if dev.get("status") == 1 or (isinstance(dev.get("status_list", []), list) and any(s.get("status") == 1 for s in dev.get("status_list", []))):
                    registered = True
                    device_type = dev_key.replace("_", " ").title()
                    # Get IP from status_list
                    for s in dev.get("status_list", []):
                        if s.get("ip"):
                            ip_addr = s["ip"].split(":")[0]
                    if not ip_addr and dev.get("ip"):
                        ip_addr = dev["ip"]
                    break
            result.append({
                "id": ext.get("id", i + 1),
                "number": str(ext.get("number", "")),
                "name": ext.get("caller_id_name", f"Ext {ext.get('number', i)}"),
                "status": ext.get("presence_status", ext.get("custom_presence_status", "unknown")),
                "device": device_type,
                "registered": registered,
                "ip": ip_addr,
            })
        return result
    return []


def _normalise_extension_presence(raw_status: Any, registered: bool) -> str:
    """Map provider/version-specific presence values to stable Nexus states.

    P-Series versions may return a named presence, a custom label, or omit the
    field entirely.  The raw value stays with the monitoring payload for
    diagnosis, while the UI only depends on this small, predictable vocabulary.
    """
    value = str(raw_status or "").strip().lower().replace("_", " ").replace("-", " ")
    if "ring" in value:
        return "ringing"
    if any(token in value for token in ("busy", "call", "talking", "in use")):
        return "on_call"
    if any(token in value for token in ("dnd", "do not disturb")):
        return "do_not_disturb"
    if any(token in value for token in ("away", "break", "lunch", "meeting")):
        return "away"
    if any(token in value for token in ("offline", "unavailable", "logout", "unregistered")):
        return "offline"
    if any(token in value for token in ("available", "online", "idle", "ready")):
        return "available"
    return "available" if registered else "offline"


def _call_mentions_extension(call: dict, extension_number: str) -> bool:
    """Avoid assuming an exact call/query format while matching a live extension."""
    if not extension_number:
        return False
    for value in (call.get("caller"), call.get("callee"), call.get("answered_by"), call.get("landing_target")):
        if re.search(rf"(?<!\d){re.escape(extension_number)}(?!\d)", str(value or "")):
            return True
    return False


def _extension_presence_snapshot(extensions: list[dict], active_calls: list[dict]) -> tuple[list[dict], dict[str, int]]:
    """Overlay live calls over extension-list presence for the operator wallboard."""
    items = []
    counts: dict[str, int] = {}
    for extension in extensions:
        live_call = next((call for call in active_calls if _call_mentions_extension(call, str(extension.get("number") or ""))), None)
        if live_call:
            raw_call_status = str(live_call.get("status") or "").lower()
            state = "ringing" if "ring" in raw_call_status else "on_call"
            source = "live_call"
        else:
            state = _normalise_extension_presence(extension.get("status"), bool(extension.get("registered")))
            source = "extension_presence"
        counts[state] = counts.get(state, 0) + 1
        items.append({
            "id": str(extension.get("id") or extension.get("number") or uuid.uuid4()),
            "number": str(extension.get("number") or ""),
            "name": extension.get("name") or f"Extension {extension.get('number') or ''}".strip(),
            "state": state,
            "registered": bool(extension.get("registered")),
            "device": extension.get("device") or "Unknown",
            "raw_status": extension.get("status") or "",
            "source": source,
        })
    return items, counts

@router.get("/yeastar/active-calls")
async def get_yeastar_active_calls(current_user: dict = Depends(get_current_user), settings: dict | None = None, token: str | None = None):
    settings = settings or await resolve_pbx_optional(current_user, include_legacy=True)
    data = await _yeastar_api_get("call/query", settings=settings, token=token)
    if data and data.get("errcode") == 0:
        raw = data.get("data", [])
        if not raw or raw is None:
            return []
        result = []
        for call in (raw if isinstance(raw, list) else []):
            caller = str(call.get("caller", call.get("call_from", "")))
            callee = str(call.get("callee", call.get("call_to", "")))
            # Yeastar call/query field names vary slightly by P-Series release
            # and call type. Preserve the operational destination where it is
            # provided, without assuming a queue/ring group for every call.
            landing_target = (
                call.get("ring_group_name") or call.get("ring_group") or call.get("ringgroup")
                or call.get("queue_name") or call.get("queue") or call.get("destination_name") or ""
            )
            answered_by = (
                call.get("answered_by_name") or call.get("answered_by") or call.get("answer_by")
                or call.get("answered_extension") or call.get("agent_name") or call.get("agent") or ""
            )
            result.append({
                "call_id": str(call.get("id", call.get("call_id", uuid.uuid4()))),
                "caller": caller,
                "caller_name": call.get("caller_name", call.get("caller_id_name", caller)),
                "callee": callee,
                "callee_name": call.get("callee_name", call.get("callee_id_name", callee)),
                "direction": call.get("direction", "internal"),
                "duration": call.get("duration", call.get("talk_duration", 0)),
                "status": call.get("status", call.get("call_status", "answered")).lower(),
                "started_at": call.get("started_at", call.get("time_start", datetime.now(timezone.utc).isoformat())),
                "landing_target": str(landing_target),
                "answered_by": str(answered_by),
            })
        return result
    return []

@router.get("/yeastar/call-logs")
async def get_yeastar_call_logs(
    page: int = 1,
    page_size: int = 20,
    current_user: dict = Depends(get_current_user),
    settings: dict | None = None,
    token: str | None = None,
):
    settings = settings or await resolve_pbx_optional(current_user, include_legacy=True)
    data = await _yeastar_api_get("cdr/list", {"page": page, "page_size": page_size}, settings=settings, token=token)
    if data and data.get("errcode") == 0:
        raw = data.get("data", [])
        total = data.get("total_number", len(raw) if isinstance(raw, list) else 0)
        result = []
        for cdr in (raw if isinstance(raw, list) else []):
            call_from = cdr.get("call_from", "")
            call_to = cdr.get("call_to", "")
            call_type = cdr.get("call_type", "").lower()
            if call_type == "inbound":
                direction = "inbound"
            elif call_type == "outbound":
                direction = "outbound"
            else:
                direction = "internal"
            disposition = cdr.get("disposition", "").upper()
            status = "answered" if disposition == "ANSWERED" else "missed" if disposition in ("NO ANSWER", "NOANSWER") else "failed" if disposition == "FAILED" else disposition.lower()
            # Parse caller name from "Name<ext>" format
            caller_name = call_from
            caller_num = call_from
            if "<" in call_from and ">" in call_from:
                parts = call_from.split("<")
                caller_name = parts[0].strip()
                caller_num = parts[1].rstrip(">")
            callee_name = call_to
            callee_num = call_to
            if "<" in call_to and ">" in call_to:
                parts = call_to.split("<")
                callee_name = parts[0].strip()
                callee_num = parts[1].rstrip(">")
            dur = int(cdr.get("duration", 0))
            talk = int(cdr.get("billsec", cdr.get("talk_duration", dur)))
            result.append({
                "id": str(cdr.get("id", cdr.get("uid", ""))),
                "caller": caller_num,
                "caller_name": caller_name if caller_name != caller_num else caller_num,
                "callee": callee_num,
                "callee_name": callee_name if callee_name != callee_num else callee_num,
                "direction": direction,
                "duration": dur,
                "talking_time": talk,
                "status": status,
                "recording": bool(cdr.get("recording", "")),
                "timestamp": cdr.get("time", datetime.now(timezone.utc).isoformat()),
            })
        return {"total": total, "page": page, "page_size": page_size, "data": result}
    return {"total": 0, "page": page, "page_size": page_size, "data": []}

@router.get("/yeastar/dashboard")
async def get_yeastar_dashboard(current_user: dict = Depends(get_current_user)):
    extensions = await get_yeastar_extensions(current_user)
    active_calls = await get_yeastar_active_calls(current_user)
    call_logs_resp = await get_yeastar_call_logs(page=1, page_size=200, current_user=current_user)
    call_logs = call_logs_resp.get("data", [])

    total_ext = len(extensions)
    online_ext = len([e for e in extensions if e.get("registered")])
    num_active = len(active_calls)
    answered = [c for c in call_logs if c.get("status") == "answered"]
    missed = [c for c in call_logs if c.get("status") in ("missed", "no answer")]
    total_talk = sum(c.get("talking_time", 0) for c in answered)
    avg_dur = (total_talk // len(answered)) if answered else 0
    avg_m, avg_s = divmod(avg_dur, 60)
    tot_m, tot_s = divmod(total_talk, 60)
    tot_h, tot_m = divmod(tot_m, 60)

    return {
        "total_extensions": total_ext,
        "online_extensions": online_ext,
        "active_calls": num_active,
        "calls_today": len(call_logs),
        "missed_calls_today": len(missed),
        "avg_call_duration": f"{avg_m}m {avg_s}s",
        "total_talk_time_today": f"{tot_h}h {tot_m}m",
        "trunks": {"total": 0, "active": 0},
    }


@router.get("/yeastar/pbxs/{pbx_id}/monitoring")
async def get_yeastar_pbx_monitoring(pbx_id: str, current_user: dict = Depends(get_current_user)):
    """Return a live, client-scoped PBX operations snapshot without exposing credentials."""
    pbx = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
    if not pbx:
        raise HTTPException(status_code=404, detail="PBX not found")
    await assert_client_scope(current_user, pbx.get("client_id"), operation="monitor Yeastar PBX", mask_not_found=True)
    if not _has_pbx_credentials(pbx):
        raise HTTPException(status_code=400, detail="This PBX needs its API URL, Client ID, and Client Secret before monitoring can start")

    started = time.perf_counter()
    cached_extensions = await db.yeastar_extension_cache.find({"pbx_id": str(pbx.get("id"))}, {"_id": 0}).to_list(1000)
    read_issues: list[str] = []

    async def bounded_read(label: str, operation, fallback):
        try:
            return await asyncio.wait_for(operation, timeout=6)
        except Exception as exc:
            # The technician still receives a usable degraded snapshot rather
            # than an indefinitely loading page when a PBX stalls.
            logger.info("PBX monitoring %s read timed out or failed for %s: %s", label, pbx.get("id"), exc)
            read_issues.append(label)
            return fallback

    # A PBX only needs one access token for a complete operational snapshot.
    # Sharing it prevents concurrent reads from queuing behind the token lock and
    # all timing out together on a slower appliance or cloud connection.
    token = await bounded_read("authentication", _yeastar_get_token(pbx), None)
    skipped_reads: list[str] = []
    if token:
        # Check the inexpensive baseline endpoint first. Some PBXs serialise or
        # throttle OpenAPI requests; if the API is already unavailable, issuing
        # three more calls merely amplifies load and gives technicians no extra
        # signal. Cached extension context remains available in that case.
        system_raw = await bounded_read("system", _yeastar_api_get("system/information", settings=pbx, token=token), None)
        if isinstance(system_raw, dict) and system_raw.get("errcode") == 0:
            extensions, active_calls, call_logs = await asyncio.gather(
                bounded_read("extensions", get_yeastar_extensions(current_user, settings=pbx, token=token), cached_extensions),
                bounded_read("active calls", get_yeastar_active_calls(current_user, settings=pbx, token=token), []),
                bounded_read("recent calls", get_yeastar_call_logs(page=1, page_size=20, current_user=current_user, settings=pbx, token=token), {"data": []}),
            )
        else:
            extensions, active_calls, call_logs = cached_extensions, [], {"data": []}
            skipped_reads = ["extensions", "active calls", "recent calls"]
    else:
        system_raw, extensions, active_calls, call_logs = None, cached_extensions, [], {"data": []}
        skipped_reads = ["system", "extensions", "active calls", "recent calls"]
    system = system_raw.get("data", {}) if isinstance(system_raw, dict) and system_raw.get("errcode") == 0 else {}
    uptime_seconds = int(system.get("up_time", 0) or 0)
    online_extensions = len([extension for extension in extensions if extension.get("registered")])
    missed = len([call for call in call_logs.get("data", []) if call.get("status") in {"missed", "failed"}])
    presence_extensions, presence_summary = _extension_presence_snapshot(extensions, active_calls)
    checked_at = datetime.now(timezone.utc).isoformat()
    api_latency_ms = max(1, int((time.perf_counter() - started) * 1000))
    health = "online" if system else "degraded"
    snapshot = {
        "pbx": {"id": pbx.get("id"), "name": pbx.get("name") or "Yeastar PBX", "client_id": pbx.get("client_id"), "client_name": pbx.get("client_name") or "Client"},
        "health": health,
        "checked_at": checked_at,
        "degraded_reads": read_issues,
        "skipped_reads": skipped_reads,
        "last_connection_test": {
            "at": pbx.get("last_test_at") or "",
            "latency_ms": pbx.get("api_latency_ms"),
            "status": pbx.get("status") or "unknown",
            "error": pbx.get("last_test_error") or "",
        },
        "api_latency_ms": api_latency_ms,
        "system": {"name": system.get("device_name") or pbx.get("name") or "Yeastar PBX", "model": system.get("model_name", ""), "firmware_version": system.get("firmware_version", ""), "uptime_seconds": uptime_seconds},
        "extensions": {"total": len(extensions), "registered": online_extensions, "unregistered": len(extensions) - online_extensions},
        "presence": {"extensions": presence_extensions, "summary": presence_summary},
        "active_calls": active_calls,
        "recent_calls": call_logs.get("data", []),
        "missed_calls": missed,
    }
    # Persist the operational result separately from the connection-test state.
    # A transient monitor failure should be visible throughout Voice without
    # overwriting the last verified credential test or marking a PBX offline.
    await db.yeastar_pbxs.update_one(
        {"id": pbx_id},
        {"$set": {
            "last_monitoring_at": checked_at,
            "last_monitoring_health": health,
            "last_monitoring_latency_ms": api_latency_ms,
            "last_monitoring_degraded_reads": read_issues,
            "last_monitoring_skipped_reads": skipped_reads,
        }},
    )
    return snapshot


@router.get("/yeastar/monitoring/wallboard")
async def get_yeastar_voice_wallboard(current_user: dict = Depends(get_current_user)):
    """Live PBX summaries for every client the signed-in technician may see."""
    pbxs = await db.yeastar_pbxs.find(
        {**scope_query(current_user), "enabled": {"$ne": False}},
        {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "client_api_id": 1, "client_secret": 1, "pbx_url": 1},
    ).to_list(100)

    async def collect(pbx: dict) -> dict:
        if not _has_pbx_credentials(pbx):
            return {"pbx": {"id": pbx.get("id"), "name": pbx.get("name") or "Yeastar PBX", "client_id": pbx.get("client_id"), "client_name": pbx.get("client_name") or "Client"}, "health": "not_configured", "active_calls": [], "extensions": {"total": 0, "registered": 0, "unregistered": 0}, "missed_calls": 0}
        try:
            return await get_yeastar_pbx_monitoring(str(pbx.get("id")), current_user=current_user)
        except Exception as exc:  # Individual PBX failures must not hide every tenant's voice state.
            logger.info("Voice wallboard check failed for PBX %s: %s", pbx.get("id"), exc)
            return {"pbx": {"id": pbx.get("id"), "name": pbx.get("name") or "Yeastar PBX", "client_id": pbx.get("client_id"), "client_name": pbx.get("client_name") or "Client"}, "health": "degraded", "active_calls": [], "extensions": {"total": 0, "registered": 0, "unregistered": 0}, "missed_calls": 0}

    snapshots = await asyncio.gather(*(collect(pbx) for pbx in pbxs))
    return {"scope": "all", "checked_at": datetime.now(timezone.utc).isoformat(), "pbxs": snapshots}


# ============== VOICE WORKSPACE (YEASTAR PROVIDER) ==============

async def _voice_extensions_with_overrides(current_user: dict, pbx: dict | None = None):
    """Return live extensions enriched with billing and manual-override metadata."""
    # The legacy singleton is only reachable for an all-client actor, which
    # resolve_pbx(include_legacy=True) enforces rather than assumes.
    settings = pbx or await resolve_pbx_optional(current_user, include_legacy=True) or {}
    extensions = await get_yeastar_extensions(current_user, settings=settings)
    policy = settings.get("billing_policy", "all_enabled")
    pbx_id = str(settings.get("id") or "primary")
    pbx_name = settings.get("name") or settings.get("pbx_name") or "Primary Yeastar PBX"
    # Only the overrides owned by the PBX being enriched. Reading every
    # tenant's overrides and matching on a bare extension number let a shared
    # number such as 101 inherit another customer's billing exclusion.
    overrides = await db.yeastar_extension_overrides.find(
        {"pbx_id": pbx_id}, {"_id": 0}
    ).to_list(1000)
    override_map = {str(item.get("extension_key") or item.get("extension_number")): item for item in overrides}
    now = datetime.now(timezone.utc).isoformat()
    enriched = []
    for extension in extensions:
        number = str(extension.get("number", ""))
        override_key = f"{pbx_id}:{number}"
        override = override_map.get(override_key) or (override_map.get(number, {}) if pbx_id == "primary" else {})
        enabled = override.get("enabled", True)
        excluded = bool(override.get("exclude_from_billing", False))
        included = enabled and not excluded
        if policy == "registered_only":
            included = included and bool(extension.get("registered"))
        enriched.append({
            **extension,
            "presence_state": _normalise_extension_presence(extension.get("status"), bool(extension.get("registered"))),
            "id": override_key,
            "pbx_id": pbx_id,
            "pbx_name": pbx_name,
            "client_id": settings.get("client_id") or settings.get("linked_client_id") or "",
            "client_name": settings.get("client_name") or "",
            "override_key": override_key,
            "enabled": enabled,
            "included_in_billing": included,
            "exclusion_reason": override.get("exclusion_reason", "") if excluded else "",
            "first_discovered": override.get("first_discovered", now),
            "last_discovered": now,
            "manual_override": bool(override),
        })
    return enriched


async def _cache_voice_extensions(pbx: dict, extensions: list[dict], captured_at: str) -> None:
    """Persist the last successful roster for a responsive, offline-safe workspace."""
    pbx_id = str(pbx.get("id") or "primary")
    await db.yeastar_extension_cache.delete_many({"pbx_id": pbx_id})
    if not extensions:
        return
    snapshots = []
    for extension in extensions:
        snapshots.append({
            **{key: value for key, value in extension.items() if key != "_id"},
            "pbx_id": pbx_id,
            "client_id": pbx.get("client_id") or pbx.get("linked_client_id") or "",
            "cached_at": captured_at,
        })
    await db.yeastar_extension_cache.insert_many(snapshots)


@router.get("/yeastar/voice-workspace")
async def yeastar_voice_workspace(current_user: dict = Depends(get_current_user)):
    client_scope = scope_query(current_user)
    # Client-linked Voice history is not a global operations feed. Scope every
    # collection query here; older unscoped aggregate documents deliberately
    # remain visible only to explicitly global users.
    sync_history = await db.yeastar_sync_history.find(client_scope, {"_id": 0}).sort("started_at", -1).to_list(30)
    billing_history = await db.yeastar_billing_snapshots.find(client_scope, {"_id": 0}).sort("created_at", -1).to_list(24)
    activity = await db.activity_logs.find(
        {
            "entity_type": {"$in": ["voice_pbx", "voice_extension", "voice_billing", "voice_provider"]},
            **scope_query(current_user, field="metadata.client_id"),
        },
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    last_success = next((entry for entry in sync_history if entry.get("status") == "success"), None)
    pbx_records = await db.yeastar_pbxs.find(client_scope, {"_id": 0}).sort("created_at", -1).to_list(500)

    # Keep the landing workspace independent of an external PBX response. A
    # live call to every customer PBX belongs in the explicit Monitor and
    # Wallboard workflows; this page should be immediately usable during a
    # provider outage. Extension details are refreshed by the governed sync.
    extensions = await db.yeastar_extension_cache.find(client_scope, {"_id": 0}).to_list(5000)
    billable = sum(int(pbx.get("billable_extension_count", 0) or 0) for pbx in pbx_records if pbx.get("enabled", True))
    summary_history = [item for item in billing_history if not item.get("pbx_id")]
    previous_quantity = summary_history[1].get("billable_quantity", billable) if len(summary_history) > 1 else billable
    pbxs = [{
        **{key: value for key, value in record.items() if key != "client_secret"},
        "url": record.get("url", record.get("pbx_url", "")),
        "status": record.get("status", "online" if last_success else "unknown"),
        "has_credentials": _has_pbx_credentials(record),
        "extension_count": record.get("extension_count", len([extension for extension in extensions if extension.get("pbx_id") == str(record.get("id") or "primary")])),
        "billable_extension_count": record.get("billable_extension_count", len([extension for extension in extensions if extension.get("pbx_id") == str(record.get("id") or "primary") and extension.get("included_in_billing")])),
        "billing_policy": record.get("billing_policy", "all_enabled"),
        "agreement_mapping": record.get("agreement_mapping", ""),
        "last_sync": record.get("last_sync", last_success.get("completed_at") if last_success else None),
        "next_sync": record.get("auto_sync_schedule", "daily"),
        "alerts": record.get("alerts", 0),
    } for record in pbx_records]
    billing_by_pbx = []
    for pbx in pbxs:
        pbx_id = str(pbx.get("id") or "primary")
        current_quantity = int(pbx.get("billable_extension_count", 0) or 0)
        previous = next((item for item in billing_history if str(item.get("pbx_id") or "") == pbx_id), None)
        previous_pbx_quantity = int((previous or {}).get("billable_quantity", current_quantity) or 0)
        billing_by_pbx.append({
            "pbx_id": pbx_id,
            "client_id": pbx.get("client_id") or "",
            "client_name": pbx.get("client_name") or "Unassigned client",
            "pbx_name": pbx.get("name") or "Yeastar PBX",
            "current_quantity": current_quantity,
            "previous_quantity": previous_pbx_quantity,
            "pending_changes": abs(current_quantity - previous_pbx_quantity),
            "agreement_mapping": pbx.get("agreement_mapping") or "",
            "product_mapping": pbx.get("product_mapping") or "",
            "automatic_billing": bool(pbx.get("automatic_billing", False)),
        })
    return {
        "provider": {"id": "yeastar", "name": "Yeastar", "connected": any(_has_pbx_credentials(pbx) and pbx.get("enabled", True) for pbx in pbx_records)},
        "settings": {"mode": "client_pbx"},
        "pbxs": pbxs,
        "extensions": extensions,
        "billing": {"current_quantity": billable, "previous_quantity": previous_quantity, "pending_changes": abs(billable - previous_quantity), "history": billing_history, "by_pbx": billing_by_pbx},
        "sync_history": sync_history,
        "activity": activity,
        "last_successful_sync": last_success.get("completed_at") if last_success else None,
        "system_health": "healthy" if last_success else "needs_attention",
    }


@router.get("/yeastar/pbxs")
async def list_yeastar_pbxs(current_user: dict = Depends(get_current_user)):
    return await db.yeastar_pbxs.find(scope_query(current_user), {"_id": 0, "client_secret": 0}).sort("created_at", -1).to_list(500)


@router.post("/yeastar/pbxs")
async def create_yeastar_pbx(data: dict, current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    name = str(data.get("name") or "").strip()
    client_api_id = str(data.get("client_api_id") or "").strip()
    client_secret = str(data.get("client_secret") or "")
    if not client_id or not name or not data.get("pbx_url"):
        raise HTTPException(status_code=400, detail="Client, PBX name, and PBX URL are required")
    if not client_api_id or not client_secret:
        raise HTTPException(status_code=400, detail="Client ID and Client Secret from Integrations > API on the PBX are required")
    await assert_client_scope(current_user, client_id, operation="voice.pbx.create", mask_not_found=True)
    try:
        pbx_url = _normalise_pbx_url(data.get("pbx_url"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    duplicate = await db.yeastar_pbxs.find_one(
        {"client_id": client_id, "pbx_url": {"$regex": f"^{re.escape(pbx_url.rstrip('/'))}/?$", "$options": "i"}},
        {"_id": 0, "id": 1, "name": 1},
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"This PBX is already linked to {client.get('name', 'the client')}. Edit the existing {duplicate.get('name') or 'PBX'} record instead.",
        )

    now = datetime.now(timezone.utc).isoformat()
    record = {"id": str(uuid.uuid4()), "provider": "yeastar", "client_id": client_id, "client_name": client.get("name", "Client"), "name": name, "pbx_url": pbx_url, "client_api_id": client_api_id, "client_secret": client_secret, "billing_policy": data.get("billing_policy", "all_enabled"), "agreement_mapping": data.get("agreement_mapping", ""), "product_mapping": data.get("product_mapping", ""), "auto_sync_schedule": data.get("auto_sync_schedule", "daily"), "automatic_billing": bool(data.get("automatic_billing", False)), "approval_threshold": int(data.get("approval_threshold", 0) or 0), "tls_validation": bool(data.get("tls_validation", True)), "notifications": bool(data.get("notifications", True)), "enabled": bool(data.get("enabled", True)), "status": "testing", "created_at": now, "updated_at": now, "created_by": current_user.get("email", "system")}

    try:
        live = await _test_pbx_live(record)
        extensions = await _voice_extensions_with_overrides(current_user, record)
    except YeastarConnectionError as exc:
        raise HTTPException(status_code=400, detail=f"PBX was not linked: {exc}") from exc

    completed_at = datetime.now(timezone.utc).isoformat()
    record.update({
        "status": "online",
        "last_test_at": completed_at,
        "last_sync": completed_at,
        "last_test_error": "",
        "extension_count": len(extensions),
        "billable_extension_count": len([extension for extension in extensions if extension.get("included_in_billing")]),
        **live,
    })
    try:
        # Insert a copy so Motor cannot add MongoDB's internal ``_id`` to the
        # object returned to the browser after a successful connection test.
        await db.yeastar_pbxs.insert_one(dict(record))
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="This client PBX was linked by another request. Open the existing record instead.") from exc
    await _cache_voice_extensions(record, extensions, completed_at)
    await db.yeastar_sync_history.insert_one({
        "id": str(uuid.uuid4()),
        "pbx_id": record["id"],
        "pbx_name": record["name"],
        "client_id": client_id,
        "started_at": now,
        "completed_at": completed_at,
        "status": "success",
        "duration_ms": live["api_latency_ms"],
        "api_latency_ms": live["api_latency_ms"],
        "extensions_processed": len(extensions),
        "source": "initial_link",
        "created_by": current_user.get("email", "system"),
    })
    await log_activity(
        current_user,
        "voice_pbx_linked",
        "voice_pbx",
        record["id"],
        record["name"],
        f"Linked {record['name']} to {record['client_name']} after a successful live connection test.",
        changes={"extension_count": {"before": 0, "after": len(extensions)}},
        metadata={"client_id": client_id, "connection_verified": True},
    )
    return {**{key: value for key, value in record.items() if key != "client_secret"}, "connection_verified": True}


@router.put("/yeastar/pbxs/{pbx_id}")
async def update_yeastar_pbx(pbx_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Maintain one customer's PBX without exposing its stored client secret."""
    existing = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="PBX not found")
    await assert_client_scope(current_user, existing.get("client_id"), operation="voice.pbx.update", mask_not_found=True)

    client_id = data.get("client_id", existing.get("client_id", ""))
    await assert_client_scope(current_user, client_id, operation="voice.pbx.update", mask_not_found=True)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1}) if client_id else None
    if client_id and not client:
        raise HTTPException(status_code=404, detail="Client not found")

    allowed = {
        "name", "pbx_url", "client_api_id", "billing_policy", "agreement_mapping", "product_mapping",
        "auto_sync_schedule", "automatic_billing", "approval_threshold", "tls_validation", "notifications", "enabled",
    }
    update = {key: data[key] for key in allowed if key in data}
    if "pbx_url" in update:
        try:
            update["pbx_url"] = _normalise_pbx_url(update["pbx_url"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "name" in update:
        update["name"] = str(update["name"]).strip()
    if data.get("client_secret"):
        update["client_secret"] = data["client_secret"]
    if client_id:
        update["client_id"] = client_id
        update["client_name"] = client.get("name", "Client")

    candidate = {**existing, **update}
    duplicate = await db.yeastar_pbxs.find_one(
        {
            "id": {"$ne": pbx_id},
            "client_id": candidate.get("client_id"),
            "pbx_url": {"$regex": f"^{re.escape(_pbx_url(candidate).rstrip('/'))}/?$", "$options": "i"},
        },
        {"_id": 0, "id": 1},
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="That PBX URL is already linked to this client")

    connection_fields = {"pbx_url", "client_api_id", "client_secret", "tls_validation", "enabled"}
    connection_changed = any(field in update for field in connection_fields)
    if candidate.get("enabled", True) and connection_changed:
        try:
            live = await _test_pbx_live(candidate)
            update.update({"status": "online", "last_test_error": "", "last_test_at": datetime.now(timezone.utc).isoformat(), **live})
        except YeastarConnectionError as exc:
            raise HTTPException(status_code=400, detail=f"PBX settings were not changed: {exc}") from exc

    changes = {
        key: {"before": existing.get(key), "after": candidate.get(key)}
        for key in allowed | {"client_id"}
        if existing.get(key) != candidate.get(key)
    }
    if data.get("client_secret"):
        changes["client_secret"] = {"before": "stored", "after": "rotated"}
    update.update({"updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user.get("email", "system")})
    await db.yeastar_pbxs.update_one({"id": pbx_id}, {"$set": update})
    yeastar_client.invalidate_token()
    record = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
    await log_activity(
        current_user,
        "voice_pbx_configuration_updated",
        "voice_pbx",
        pbx_id,
        record.get("name") or "Yeastar PBX",
        "PBX configuration updated after its effective connection settings passed validation.",
        changes=changes,
        metadata={"client_id": record.get("client_id", ""), "connection_verified": bool(candidate.get("enabled", True))},
    )
    return {key: value for key, value in record.items() if key != "client_secret"}


@router.post("/yeastar/sync")
async def sync_yeastar_workspace(data: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Synchronise one selected PBX or every enabled PBX with its own credentials."""
    requested_pbx_id = str(data.get("pbx_id") or "")
    pbx_records = await db.yeastar_pbxs.find(scope_query(current_user), {"_id": 0}).sort("created_at", -1).to_list(500)
    if requested_pbx_id:
        pbx_records = [pbx for pbx in pbx_records if str(pbx.get("id")) == requested_pbx_id]
        if not pbx_records:
            raise HTTPException(status_code=404, detail="PBX not found")

    if not pbx_records:
        raise HTTPException(status_code=400, detail="Add a client-linked Yeastar PBX before running a synchronisation")

    successful_extensions = 0
    successful_pbxs = 0
    failed_pbxs = []
    completed_entries = []
    for pbx in pbx_records:
        started_at = datetime.now(timezone.utc)
        pbx_id = str(pbx.get("id") or "primary")
        entry = {
            "id": str(uuid.uuid4()),
            "pbx_id": pbx_id,
            "pbx_name": pbx.get("name") or pbx.get("pbx_name") or "Yeastar PBX",
            "client_id": pbx.get("client_id") or pbx.get("linked_client_id") or "",
            "started_at": started_at.isoformat(),
            "status": "running",
        }
        try:
            if not pbx.get("enabled", True):
                raise RuntimeError("Connection is disabled")
            if not _has_pbx_credentials(pbx):
                raise RuntimeError("Cloud URL, Client ID, or Client Secret is missing")
            if not await _yeastar_get_token(pbx):
                raise RuntimeError("Authentication failed")
            extensions = await _voice_extensions_with_overrides(current_user, pbx)
            completed_at = datetime.now(timezone.utc)
            duration_ms = int((completed_at - started_at).total_seconds() * 1000)
            entry.update({"status": "success", "completed_at": completed_at.isoformat(), "duration_ms": duration_ms, "extensions_processed": len(extensions), "token_refreshes": 0, "api_latency_ms": duration_ms})
            successful_extensions += len(extensions)
            successful_pbxs += 1
            await _cache_voice_extensions(pbx, extensions, completed_at.isoformat())
            await db.yeastar_pbxs.update_one({"id": pbx_id}, {"$set": {"status": "online", "last_sync": completed_at.isoformat(), "extension_count": len(extensions), "billable_extension_count": len([extension for extension in extensions if extension.get("included_in_billing")]), "updated_at": completed_at.isoformat()}})
        except Exception as exc:
            completed_at = datetime.now(timezone.utc)
            entry.update({"status": "failed", "completed_at": completed_at.isoformat(), "duration_ms": int((completed_at - started_at).total_seconds() * 1000), "error": str(exc)})
            failed_pbxs.append({"id": pbx_id, "name": entry["pbx_name"], "error": str(exc)})
            await db.yeastar_pbxs.update_one({"id": pbx_id}, {"$set": {"status": "authentication_failed" if "Authentication" in str(exc) else "offline", "last_sync": completed_at.isoformat(), "updated_at": completed_at.isoformat()}})
        # Motor mutates the inserted mapping by adding MongoDB's ``_id``.
        # Insert a copy so the API response remains JSON serialisable.
        await db.yeastar_sync_history.insert_one(dict(entry))
        completed_entries.append(entry)

    if not successful_pbxs and failed_pbxs:
        raise HTTPException(status_code=502, detail=f"Yeastar sync failed: {failed_pbxs[0]['error']}")
    return {"extensions_processed": successful_extensions, "pbxs_processed": len(pbx_records), "failed_pbxs": failed_pbxs, "entries": completed_entries}


@router.post("/yeastar/billing/recalculate")
async def recalculate_yeastar_billing(current_user: dict = Depends(get_current_user)):
    # Billing snapshots are customer-scoped operational data. A restricted
    # technician may recalculate only the PBXs they can access; a global user
    # retains the approved whole-fleet operation. Do not rely on the UI client
    # selector for this boundary.
    client_scope = scope_query(current_user)
    pbx_records = await db.yeastar_pbxs.find(client_scope, {"_id": 0}).to_list(500)
    captured_at = datetime.now(timezone.utc).isoformat()
    per_pbx = []
    all_extensions = []
    for pbx in pbx_records:
        if not pbx.get("enabled", True):
            continue
        pbx_id = str(pbx.get("id") or "primary")
        extensions = await _voice_extensions_with_overrides(current_user, pbx)
        all_extensions.extend(extensions)
        quantity = len([extension for extension in extensions if extension.get("included_in_billing")])
        previous = await db.yeastar_billing_snapshots.find_one(
            {"pbx_id": pbx_id, **client_scope}, {"_id": 0, "billable_quantity": 1}, sort=[("created_at", -1)]
        )
        snapshot = {
            "id": str(uuid.uuid4()), "created_at": captured_at, "billable_quantity": quantity,
            "previous_quantity": int((previous or {}).get("billable_quantity", quantity) or 0),
            "pending_changes": abs(quantity - int((previous or {}).get("billable_quantity", quantity) or 0)),
            "pbx_id": pbx_id, "pbx_name": pbx.get("name") or pbx.get("pbx_name") or "Yeastar PBX",
            "client_id": pbx.get("client_id") or pbx.get("linked_client_id") or "",
            "client_name": pbx.get("client_name") or "Unassigned client",
            "product_mapping": pbx.get("product_mapping") or "",
            "agreement_mapping": pbx.get("agreement_mapping") or "",
            "source": "manual_recalculate", "created_by": current_user.get("email", "system"),
        }
        await db.yeastar_billing_snapshots.insert_one(dict(snapshot))
        per_pbx.append(snapshot)

    quantity = len([extension for extension in all_extensions if extension.get("included_in_billing")])
    summary = {"id": str(uuid.uuid4()), "created_at": captured_at, "billable_quantity": quantity, "pbx_count": len(per_pbx), "source": "manual_recalculate_summary", "created_by": current_user.get("email", "system")}
    # Aggregate summary documents intentionally have no single client owner.
    # Only explicitly global users can create them. Restricted callers still
    # receive their scoped result and per-PBX snapshots, without creating a
    # document that could later be mistaken for a whole-fleet billing total.
    if not client_scope:
        await db.yeastar_billing_snapshots.insert_one(dict(summary))
    activity_metadata = {"billable_quantity": quantity, "pbx_count": len(per_pbx)}
    recalculated_client_ids = {str(snapshot.get("client_id") or "") for snapshot in per_pbx}
    recalculated_client_ids.discard("")
    # One client can be safely attributed in the shared activity ledger. A
    # multi-client/global aggregate deliberately remains global rather than
    # being exposed to a technician who can see only one constituent client.
    if len(recalculated_client_ids) == 1:
        activity_metadata["client_id"] = recalculated_client_ids.pop()
    await log_activity(
        current_user,
        "voice_billing_snapshot_captured",
        "voice_billing",
        summary["id"],
        "Voice billing snapshot",
        f"Captured {quantity} billable extensions across {len(per_pbx)} PBX connections.",
        metadata=activity_metadata,
    )
    return {**summary, "by_pbx": per_pbx}


def _product_rate(product: dict | None) -> float:
    for field in ("retail_price", "unit_price", "price", "selling_price"):
        try:
            value = float((product or {}).get(field) or 0)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return 0.0


async def get_client_yeastar_billing(client_id: str, current_user: dict = Depends(get_current_user)):
    """Build client-scoped, live Yeastar extension usage for recurring billing.

    A PBX must be mapped to a product ID before usage is allowed to reach a
    recurring invoice. This prevents a live count from silently billing at $0.
    """
    await assert_client_scope(current_user, client_id, operation="voice.billing.read")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    pbxs = await db.yeastar_pbxs.find(
        {"client_id": client_id, "enabled": {"$ne": False}}, {"_id": 0}
    ).to_list(100)
    if not pbxs:
        return {"linked": False, "client_id": client_id, "client_name": client.get("name", "Client"), "total": 0, "line_items": [], "billing_ready": False, "missing_mappings": []}

    line_items, missing_mappings = [], []
    for pbx in pbxs:
        extensions = await _voice_extensions_with_overrides(current_user, pbx)
        quantity = len([extension for extension in extensions if extension.get("included_in_billing")])
        product_id = str(pbx.get("product_mapping") or "").strip()
        product = await db.products.find_one({"id": product_id}, {"_id": 0}) if product_id else None
        rate = _product_rate(product)
        if not product or rate <= 0:
            missing_mappings.append({"pbx_id": pbx.get("id"), "pbx_name": pbx.get("name") or "Yeastar PBX", "product_mapping": product_id})
            continue
        line_items.append({
            "pbx_id": str(pbx.get("id") or "primary"),
            "pbx_name": pbx.get("name") or "Yeastar PBX",
            "product_id": product_id,
            "label": product.get("name") or "Yeastar extension",
            "quantity": quantity,
            "unit": "extension",
            "unit_price": rate,
            "total": round(quantity * rate, 2),
        })

    return {
        "linked": True,
        "client_id": client_id,
        "client_name": client.get("name", "Client"),
        "period": datetime.now(timezone.utc).strftime("%Y-%m"),
        "currency": "AUD",
        "total": round(sum(item["total"] for item in line_items), 2),
        "line_items": line_items,
        "billing_ready": bool(line_items) and not missing_mappings,
        "missing_mappings": missing_mappings,
    }


@router.get("/yeastar/billing/client/{client_id}")
async def yeastar_client_billing(client_id: str, current_user: dict = Depends(get_current_user)):
    return await get_client_yeastar_billing(client_id, current_user)


@router.post("/yeastar/billing/client/{client_id}/link-to-recurring")
async def link_yeastar_billing_to_recurring(client_id: str, data: dict | None = None, current_user: dict = Depends(get_current_user)):
    """Enable safe per-extension usage attachment on a client's recurring invoice."""
    data = data or {}
    billing = await get_client_yeastar_billing(client_id, current_user)
    if not billing.get("linked"):
        raise HTTPException(status_code=400, detail="Link a Yeastar PBX to this client before enabling extension billing")
    if not billing.get("billing_ready"):
        missing = ", ".join(item.get("pbx_name") or "Yeastar PBX" for item in billing.get("missing_mappings", []))
        raise HTTPException(status_code=400, detail=f"Map each PBX to an active product with a unit price before enabling billing ({missing})")

    now = datetime.now(timezone.utc).isoformat()
    target_id = str(data.get("recurring_invoice_id") or "")
    modified, created_id = [], None
    if target_id:
        recurring = await db.recurring_invoices.find_one({"id": target_id, "client_id": client_id}, {"_id": 0, "id": 1})
        if not recurring:
            raise HTTPException(status_code=404, detail="Recurring invoice not found for this client")
        await db.recurring_invoices.update_one({"id": target_id}, {"$set": {"include_yeastar_usage": True, "updated_at": now}})
        modified.append(target_id)
    else:
        active = await db.recurring_invoices.find({"client_id": client_id, "status": "active"}, {"_id": 0, "id": 1}).to_list(50)
        for recurring in active:
            await db.recurring_invoices.update_one({"id": recurring["id"]}, {"$set": {"include_yeastar_usage": True, "updated_at": now}})
            modified.append(recurring["id"])

        if not modified and data.get("create_if_missing"):
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            created_id = f"ri-{uuid.uuid4().hex[:8]}"
            await db.recurring_invoices.insert_one({
                "id": created_id, "client_id": client_id, "client_name": billing["client_name"],
                "description": data.get("description", f"Yeastar Extension Billing — {billing['client_name']}"),
                "line_items": [], "subtotal": 0.0, "tax_rate": float(data.get("tax_rate", 10)), "tax_amount": 0.0,
                "amount": 0.0, "currency": data.get("currency", "AUD"), "frequency": data.get("frequency", "monthly"),
                "start_date": today, "next_generation": today, "end_date": None, "contract_id": None,
                "payment_terms": data.get("payment_terms", "net_30"),
                "notes": "Extension quantities are sourced live from the client-linked Yeastar PBX connections.",
                "auto_send": False, "auto_send_email": "", "include_pdf": True, "include_yeastar_usage": True,
                "status": "active", "invoices_generated": 0, "total_billed": 0, "created_at": now, "updated_at": now,
            })
            modified.append(created_id)

    await db.yeastar_pbxs.update_many({"client_id": client_id}, {"$set": {"automatic_billing": True, "updated_at": now, "updated_by": current_user.get("email", "system")}})
    await log_activity(
        current_user,
        "voice_billing_linked",
        "voice_billing",
        client_id,
        f"{billing['client_name']} Voice billing",
        f"Linked live Yeastar quantities to {len(modified)} recurring invoice configuration(s).",
        changes={"recurring_invoice_ids": {"before": [], "after": modified}},
        metadata={"client_id": client_id, "billable_quantity": sum(item.get("quantity", 0) for item in billing.get("line_items", []))},
    )
    return {"message": "Yeastar extension usage will be attached to the selected recurring billing", "recurring_invoice_ids": modified, "created_recurring_invoice_id": created_id, "preview": billing}


@router.put("/yeastar/extensions/{extension_number}/override")
async def update_yeastar_extension_override(extension_number: str, data: dict, current_user: dict = Depends(get_current_user)):
    extension_number = str(extension_number or "").strip()
    extension_key = str(data.get("extension_key") or "").strip()
    pbx_id, separator, keyed_extension_number = extension_key.partition(":")
    if (
        not pbx_id
        or not separator
        or not keyed_extension_number
        or ":" in keyed_extension_number
        or keyed_extension_number != extension_number
    ):
        raise HTTPException(status_code=400, detail="Extension key must match the selected PBX and extension number")

    # The extension key is caller-controlled. Resolve its parent PBX and prove
    # the PBX client is in scope before reading an existing override or making
    # any mutation. A bare extension number cannot safely establish ownership.
    pbx = await db.yeastar_pbxs.find_one(
        {"id": pbx_id}, {"_id": 0, "id": 1, "name": 1, "client_id": 1}
    )
    if not pbx:
        raise HTTPException(status_code=404, detail="PBX not found")
    await assert_client_scope(
        current_user,
        pbx.get("client_id"),
        operation="voice.extension.override.update",
        mask_not_found=True,
    )

    existing = await db.yeastar_extension_overrides.find_one({"extension_key": extension_key}, {"_id": 0}) or {}
    next_enabled = bool(data.get("enabled", existing.get("enabled", True)))
    next_excluded = bool(data.get("exclude_from_billing", existing.get("exclude_from_billing", False)))
    previous_enabled = bool(existing.get("enabled", True))
    previous_excluded = bool(existing.get("exclude_from_billing", False))
    changed = next_enabled != previous_enabled or next_excluded != previous_excluded
    change_reason = str(data.get("change_reason") or "").strip()
    if changed and not change_reason:
        raise HTTPException(status_code=400, detail="A technician justification is required for extension overrides")
    record = {
        "extension_key": extension_key,
        "extension_number": extension_number,
        "pbx_id": pbx_id,
        "pbx_name": pbx.get("name") or "Yeastar PBX",
        "client_id": pbx.get("client_id") or "",
        "enabled": next_enabled,
        "exclude_from_billing": next_excluded,
        "exclusion_reason": data.get("exclusion_reason", existing.get("exclusion_reason", "")),
        "change_reason": change_reason or existing.get("change_reason", ""),
        "first_discovered": existing.get("first_discovered", datetime.now(timezone.utc).isoformat()),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("email", "system"),
    }
    await db.yeastar_extension_overrides.update_one({"extension_key": extension_key}, {"$set": record}, upsert=True)
    if changed:
        await log_activity(
            current_user,
            "voice_extension_override_updated",
            "voice_extension",
            extension_key,
            f"Extension {extension_number}",
            change_reason,
            changes={
                "enabled": {"before": previous_enabled, "after": next_enabled},
                "included_in_billing": {
                    "before": previous_enabled and not previous_excluded,
                    "after": next_enabled and not next_excluded,
                },
            },
            metadata={
                "client_id": pbx.get("client_id", ""),
                "pbx_id": pbx_id,
                "pbx_name": pbx.get("name", ""),
            },
        )
    return record


# ============== PBX LIFECYCLE ==============


def _nexus_client_id(settings: dict) -> str:
    """Return the Nexus client binding, never the provider's API client ID.

    A client PBX stores ``client_id`` as its Nexus client. The legacy
    singleton stores ``client_id`` as the Yeastar API identifier, which is half
    of a provider credential and must not be recorded as customer ownership or
    written into an audit trail.
    """
    if settings.get("type") == "yeastar":
        return ""
    return str(settings.get("client_id") or "")


@router.delete("/yeastar/pbxs/{pbx_id}")
async def delete_yeastar_pbx(pbx_id: str, current_user: dict = Depends(get_current_user)):
    """Unlink a client PBX and release its token slot on the appliance.

    Yeastar allows eight live API tokens per PBX, so an unlinked PBX that keeps
    a token alive is what produces the provider's token-limit failure later.
    Extension billing overrides are deliberately retained: they record why a
    quantity was governed and stay audit evidence after the link is gone.
    """
    existing = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="PBX not found")
    await assert_client_scope(current_user, existing.get("client_id"), operation="voice.pbx.delete", mask_not_found=True)
    await assert_action_permission(current_user, "voice.pbx.modify")
    released = await yeastar_client.revoke_token(existing)
    yeastar_client.invalidate_token(existing)
    await db.yeastar_pbxs.delete_one({"id": pbx_id})
    removed = await db.yeastar_extension_cache.delete_many({"pbx_id": str(pbx_id)})
    await log_activity(
        current_user,
        "voice_pbx_unlinked",
        "voice_pbx",
        pbx_id,
        existing.get("name") or "Yeastar PBX",
        "PBX unlinked from its client after its provider token was released.",
        metadata={
            "client_id": existing.get("client_id", ""),
            "token_released": bool(released),
            "cached_extensions_removed": int(getattr(removed, "deleted_count", 0) or 0),
        },
    )
    return {"deleted": True, "token_released": bool(released)}


# ============== CAPABILITY CATALOGUE ==============


@router.get("/yeastar/catalogue")
async def get_yeastar_catalogue(current_user: dict = Depends(get_current_user)):
    """Describe the Yeastar capability this integration can reach.

    Safe for any authenticated technician: it names interfaces and the action
    permission each write requires, and carries no provider payload, credential
    or download URL.
    """
    operations = yeastar_registry.OPERATIONS
    return {
        "operation_count": len(operations),
        "write_count": sum(1 for operation in operations if operation.is_write),
        "destructive_count": sum(1 for operation in operations if operation.destructive),
        "categories": yeastar_registry.catalogue(),
    }


def _operation_for_dispatch(operation_id: str, *, expect_write: bool):
    """Resolve a catalogue operation and reject unsafe dispatch targets.

    Nexus decides the caller's verb from whether the operation changes PBX
    state, never from the provider's own verb: Yeastar performs its deletes with
    a GET, so ``operation.method`` cannot be what selects the route. The
    provider method stays an internal detail of dispatch, and a caller that
    used the wrong route is told which one this operation needs.
    """
    operation = yeastar_registry.get_operation(operation_id)
    if not operation:
        raise HTTPException(status_code=404, detail="Unknown Yeastar operation")
    if operation.proxied:
        raise HTTPException(
            status_code=400,
            detail="That Yeastar operation returns a provider download URL, so it is served by the Nexus artifact routes instead of the dispatcher.",
        )
    if operation.is_write != expect_write:
        if operation.is_write:
            detail = "That Yeastar operation changes PBX state and must be called as a POST command on /api/yeastar/operations/{operation_id}."
        else:
            detail = "That Yeastar operation only reads from the PBX and must be called with GET."
        raise HTTPException(status_code=405, detail=detail)
    return operation


async def _dispatch_yeastar_operation(operation, current_user: dict, pbx_id: str | None, params: dict, body: dict) -> dict:
    """Resolve scope, enforce the action gate, then run one catalogue interface."""
    try:
        settings = await resolve_pbx(current_user, pbx_id, operation=f"voice.operation.{operation.id}", include_legacy=True)
    except YeastarError as exc:
        raise HTTPException(status_code=http_status_for(exc), detail=str(exc)) from exc
    if not _has_pbx_credentials(settings):
        raise HTTPException(status_code=400, detail="This PBX needs its API URL, Client ID, and Client Secret before Nexus can run that operation")
    if operation.action:
        await assert_action_permission(current_user, operation.action)
    try:
        payload = await yeastar_client.dispatch_operation(settings, operation, params=params, body=body, strict=True)
    except YeastarError as exc:
        raise HTTPException(status_code=http_status_for(exc), detail=str(exc)) from exc
    if isinstance(payload, dict) and payload.get("errcode", 0) != 0:
        raise HTTPException(
            status_code=502,
            detail=f"Yeastar rejected {operation.id} ({payload.get('errmsg') or 'unknown error'}, error {payload.get('errcode')}).",
        )
    resolved_pbx_id = str(settings.get("id") or "primary")
    if operation.is_write:
        await log_activity(
            current_user,
            "voice_operation_executed",
            "voice_pbx",
            resolved_pbx_id,
            settings.get("name") or "Yeastar PBX",
            f"Ran the Yeastar {operation.id} interface from the capability catalogue.",
            metadata={
                "operation": operation.id,
                "category": operation.category,
                "client_id": _nexus_client_id(settings),
                "destructive": operation.destructive,
            },
        )
    return {
        "operation": operation.id,
        "category": operation.category,
        "pbx_id": resolved_pbx_id,
        "client_id": _nexus_client_id(settings),
        "destructive": operation.destructive,
        "data": payload.get("data") if isinstance(payload, dict) else payload,
    }


@router.get("/yeastar/operations/{operation_id}")
async def run_yeastar_read_operation(
    operation_id: str,
    request: Request,
    pbx_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Run one read interface from the catalogue.

    Only the parameters the catalogue declares are forwarded, so a caller
    cannot append arbitrary arguments to the provider request.
    """
    operation = _operation_for_dispatch(operation_id, expect_write=False)
    return await _dispatch_yeastar_operation(operation, current_user, pbx_id, dict(request.query_params), {})


@router.post("/yeastar/operations/{operation_id}")
async def run_yeastar_write_operation(
    operation_id: str,
    request: Request,
    data: dict = Body(default={}),
    pbx_id: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Run one write interface from the catalogue.

    Every write names the Nexus action permission it requires and leaves an
    audit record, including whether the provider call is destructive.
    """
    operation = _operation_for_dispatch(operation_id, expect_write=True)
    body = dict(data or {})
    body.pop("pbx_id", None)
    resolved_pbx_id = pbx_id or request.query_params.get("pbx_id")
    return await _dispatch_yeastar_operation(operation, current_user, resolved_pbx_id, dict(request.query_params), body)

