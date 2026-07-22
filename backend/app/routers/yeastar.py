import os
import asyncio
import logging
import time
import httpx
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Body
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()
logger = logging.getLogger(__name__)

# ============== YEASTAR PBX ENDPOINTS ==============

@router.get("/yeastar/status")
async def get_yeastar_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    return {"configured": bool(settings and settings.get("client_id") and settings.get("pbx_url"))}

@router.post("/yeastar/settings")
async def save_yeastar_settings(settings: dict, current_user: dict = Depends(get_current_user)):
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
    _yeastar_token_cache.clear()
    return {"message": "Yeastar settings saved"}

@router.get("/yeastar/settings")
async def get_yeastar_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if settings:
        settings.pop("client_secret", None)
    return settings or {"type": "yeastar", "pbx_url": "", "client_id": ""}

@router.get("/yeastar/test-connection")
async def test_yeastar_connection(pbx_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Test either the default connection or a customer-specific PBX."""
    if pbx_id and pbx_id != "primary":
        settings = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
        if not settings:
            raise HTTPException(status_code=404, detail="PBX not found")
    else:
        settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if not settings or not _has_pbx_credentials(settings):
        return {"success": False, "message": "This PBX needs a Cloud URL, Client ID, and Client Secret before it can be tested."}
    try:
        token = await _yeastar_get_token(settings)
        if token:
            if pbx_id and pbx_id != "primary":
                await db.yeastar_pbxs.update_one({"id": pbx_id}, {"$set": {"status": "online", "last_test_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}})
            return {"success": True, "message": "Successfully connected to Yeastar PBX."}
        return {"success": False, "message": "Authentication failed. This may be due to max token limit (8) — tokens auto-expire after 30 minutes. Try again shortly."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}

_yeastar_token_lock = asyncio.Lock()
_yeastar_token_cache: dict[str, dict[str, Any]] = {}


def _pbx_url(settings: dict) -> str:
    return str(settings.get("pbx_url") or settings.get("url") or "").rstrip("/")


def _pbx_client_id(settings: dict) -> str:
    return str(settings.get("client_api_id") or settings.get("client_id") or "")


def _has_pbx_credentials(settings: dict) -> bool:
    return bool(_pbx_url(settings) and _pbx_client_id(settings) and settings.get("client_secret"))

async def _yeastar_get_token(settings: dict) -> str | None:
    """Get access token from Yeastar PBX with caching and lock"""
    pbx_url = _pbx_url(settings)
    client_id = _pbx_client_id(settings)
    client_secret = settings.get("client_secret", "")
    if not pbx_url or not client_id or not client_secret:
        return None

    cache_key = f"{pbx_url}|{client_id}"
    async with _yeastar_token_lock:
        now = datetime.now(timezone.utc).timestamp()
        cached = _yeastar_token_cache.get(cache_key) or {}
        if cached.get("token") and now < float(cached.get("expires") or 0):
            return cached["token"]
        
        url = f"{pbx_url}/openapi/v1.0/get_token"
        try:
            verify_tls = settings.get("tls_validation", os.environ.get('ALLOW_SELF_SIGNED_CERTS', 'false').lower() != 'true')
            async with httpx.AsyncClient(verify=verify_tls, timeout=15) as http:
                resp = await http.post(url, json={"username": client_id, "password": client_secret}, headers={"User-Agent": "OpenAPI", "Content-Type": "application/json"})
                data = resp.json()
                if data.get("errcode") == 0:
                    token = data.get("access_token")
                    _yeastar_token_cache[cache_key] = {
                        "token": token,
                        "expires": now + data.get("access_token_expire_time", 1800) - 60,
                        "refresh_token": data.get("refresh_token"),
                    }
                    return token
                if data.get("errcode") == 60002:
                    logger.warning("Yeastar max tokens exceeded, waiting for auto-expiry")
                logger.error(f"Yeastar auth: {data.get('errmsg', 'Unknown error')}")
                return None
        except Exception as e:
            logger.error(f"Yeastar auth error: {e}")
            return None

async def _yeastar_api_get(path: str, params: dict = None, settings: dict | None = None) -> dict | list | None:
    """Make authenticated GET request to Yeastar PBX"""
    settings = settings or await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if not settings:
        return None
    token = await _yeastar_get_token(settings)
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
                return resp.json()
            logger.error(f"Yeastar API {path}: status={resp.status_code}, body={resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"Yeastar API {path} error: {e}")
        return None

@router.get("/yeastar/system-info")
async def get_yeastar_system_info(current_user: dict = Depends(get_current_user)):
    data = await _yeastar_api_get("system/information")
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
async def get_yeastar_extensions(current_user: dict = Depends(get_current_user), settings: dict | None = None):
    data = await _yeastar_api_get("extension/list", settings=settings)
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

@router.get("/yeastar/active-calls")
async def get_yeastar_active_calls(current_user: dict = Depends(get_current_user)):
    data = await _yeastar_api_get("call/query")
    if data and data.get("errcode") == 0:
        raw = data.get("data", [])
        if not raw or raw is None:
            return []
        result = []
        for call in (raw if isinstance(raw, list) else []):
            caller = str(call.get("caller", call.get("call_from", "")))
            callee = str(call.get("callee", call.get("call_to", "")))
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
            })
        return result
    return []

@router.get("/yeastar/call-logs")
async def get_yeastar_call_logs(
    page: int = 1,
    page_size: int = 20,
    current_user: dict = Depends(get_current_user)
):
    data = await _yeastar_api_get("cdr/list", {"page": page, "page_size": page_size})
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


# ============== VOICE WORKSPACE (YEASTAR PROVIDER) ==============

async def _voice_extensions_with_overrides(current_user: dict, pbx: dict | None = None):
    """Return live extensions enriched with billing and manual-override metadata."""
    settings = pbx or await db.settings.find_one({"type": "yeastar"}, {"_id": 0}) or {}
    extensions = await get_yeastar_extensions(current_user, settings=settings)
    policy = settings.get("billing_policy", "all_enabled")
    pbx_id = str(settings.get("id") or "primary")
    pbx_name = settings.get("name") or settings.get("pbx_name") or "Primary Yeastar PBX"
    overrides = await db.yeastar_extension_overrides.find({}, {"_id": 0}).to_list(1000)
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


@router.get("/yeastar/voice-workspace")
async def yeastar_voice_workspace(current_user: dict = Depends(get_current_user)):
    settings = await get_yeastar_settings(current_user)
    sync_history = await db.yeastar_sync_history.find({}, {"_id": 0}).sort("started_at", -1).to_list(30)
    billing_history = await db.yeastar_billing_snapshots.find({}, {"_id": 0}).sort("created_at", -1).to_list(24)
    last_success = next((entry for entry in sync_history if entry.get("status") == "success"), None)
    pbx_records = await db.yeastar_pbxs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    if not pbx_records and (settings.get("pbx_url") or settings.get("client_id")):
        pbx_records = [{
            "id": "primary",
            "name": settings.get("pbx_name") or "Primary Yeastar PBX",
            "client_name": settings.get("client_name") or "Unassigned client",
            "pbx_url": settings.get("pbx_url", ""),
            "client_id": settings.get("linked_client_id", ""),
            "client_api_id": settings.get("client_id", ""),
            "client_secret": settings.get("client_secret", ""),
            "enabled": settings.get("enabled", True),
            "billing_policy": settings.get("billing_policy", "all_enabled"),
        }]

    extensions = []
    for pbx in pbx_records:
        if not pbx.get("enabled", True):
            continue
        extensions.extend(await _voice_extensions_with_overrides(current_user, pbx))
    billable = len([extension for extension in extensions if extension.get("included_in_billing")])
    summary_history = [item for item in billing_history if not item.get("pbx_id")]
    previous_quantity = summary_history[1].get("billable_quantity", billable) if len(summary_history) > 1 else billable
    pbxs = [{
        **{key: value for key, value in record.items() if key != "client_secret"},
        "url": record.get("url", record.get("pbx_url", "")),
        "status": record.get("status", "online" if last_success else "unknown"),
        "has_credentials": _has_pbx_credentials(record),
        "extension_count": record.get("extension_count", len([extension for extension in extensions if extension.get("pbx_id") == str(record.get("id") or "primary")])),
        "billable_extension_count": record.get("billable_extension_count", len([extension for extension in extensions if extension.get("pbx_id") == str(record.get("id") or "primary") and extension.get("included_in_billing")])),
        "billing_policy": record.get("billing_policy", settings.get("billing_policy", "all_enabled")),
        "agreement_mapping": record.get("agreement_mapping", settings.get("agreement_mapping", "")),
        "last_sync": record.get("last_sync", last_success.get("completed_at") if last_success else None),
        "next_sync": record.get("auto_sync_schedule", settings.get("auto_sync_schedule", "daily")),
        "alerts": record.get("alerts", 0),
    } for record in pbx_records]
    billing_by_pbx = []
    for pbx in pbxs:
        pbx_id = str(pbx.get("id") or "primary")
        current_quantity = len([extension for extension in extensions if extension.get("pbx_id") == pbx_id and extension.get("included_in_billing")])
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
        "settings": settings,
        "pbxs": pbxs,
        "extensions": extensions,
        "billing": {"current_quantity": billable, "previous_quantity": previous_quantity, "pending_changes": abs(billable - previous_quantity), "history": billing_history, "by_pbx": billing_by_pbx},
        "sync_history": sync_history,
        "last_successful_sync": last_success.get("completed_at") if last_success else None,
        "system_health": "healthy" if last_success else "needs_attention",
    }


@router.get("/yeastar/pbxs")
async def list_yeastar_pbxs(current_user: dict = Depends(get_current_user)):
    return await db.yeastar_pbxs.find({}, {"_id": 0, "client_secret": 0}).sort("created_at", -1).to_list(500)


@router.post("/yeastar/pbxs")
async def create_yeastar_pbx(data: dict, current_user: dict = Depends(get_current_user)):
    client_id = data.get("client_id", "")
    if not client_id or not data.get("name", "").strip() or not data.get("pbx_url", "").strip():
        raise HTTPException(status_code=400, detail="Client, PBX name, and Yeastar Cloud URL are required")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    now = datetime.now(timezone.utc).isoformat()
    record = {"id": str(uuid.uuid4()), "provider": "yeastar", "client_id": client_id, "client_name": client.get("name", "Client"), "name": data["name"].strip(), "pbx_url": data["pbx_url"].strip().rstrip("/"), "client_api_id": data.get("client_api_id", ""), "client_secret": data.get("client_secret", ""), "billing_policy": data.get("billing_policy", "all_enabled"), "agreement_mapping": data.get("agreement_mapping", ""), "product_mapping": data.get("product_mapping", ""), "auto_sync_schedule": data.get("auto_sync_schedule", "daily"), "automatic_billing": bool(data.get("automatic_billing", False)), "approval_threshold": int(data.get("approval_threshold", 0) or 0), "tls_validation": bool(data.get("tls_validation", True)), "notifications": bool(data.get("notifications", True)), "enabled": bool(data.get("enabled", True)), "status": "pending_configuration", "created_at": now, "updated_at": now, "created_by": current_user.get("email", "system")}
    await db.yeastar_pbxs.insert_one(record)
    return {key: value for key, value in record.items() if key != "client_secret"}


@router.put("/yeastar/pbxs/{pbx_id}")
async def update_yeastar_pbx(pbx_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Maintain one customer's PBX without exposing its stored client secret."""
    existing = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="PBX not found")

    client_id = data.get("client_id", existing.get("client_id", ""))
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1}) if client_id else None
    if client_id and not client:
        raise HTTPException(status_code=404, detail="Client not found")

    allowed = {
        "name", "pbx_url", "client_api_id", "billing_policy", "agreement_mapping", "product_mapping",
        "auto_sync_schedule", "automatic_billing", "approval_threshold", "tls_validation", "notifications", "enabled",
    }
    update = {key: data[key] for key in allowed if key in data}
    if "pbx_url" in update:
        update["pbx_url"] = str(update["pbx_url"]).strip().rstrip("/")
    if "name" in update:
        update["name"] = str(update["name"]).strip()
    if data.get("client_secret"):
        update["client_secret"] = data["client_secret"]
    if client_id:
        update["client_id"] = client_id
        update["client_name"] = client.get("name", "Client")
    update.update({"updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user.get("email", "system")})
    await db.yeastar_pbxs.update_one({"id": pbx_id}, {"$set": update})
    _yeastar_token_cache.clear()
    record = await db.yeastar_pbxs.find_one({"id": pbx_id}, {"_id": 0})
    return {key: value for key, value in record.items() if key != "client_secret"}


@router.post("/yeastar/sync")
async def sync_yeastar_workspace(data: dict = Body(default={}), current_user: dict = Depends(get_current_user)):
    """Synchronise one selected PBX or every enabled PBX with its own credentials."""
    requested_pbx_id = str(data.get("pbx_id") or "")
    pbx_records = await db.yeastar_pbxs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    if requested_pbx_id:
        pbx_records = [pbx for pbx in pbx_records if str(pbx.get("id")) == requested_pbx_id]
        if not pbx_records and requested_pbx_id != "primary":
            raise HTTPException(status_code=404, detail="PBX not found")
    if not pbx_records:
        legacy_settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0}) or {}
        if requested_pbx_id in ("", "primary") and legacy_settings:
            pbx_records = [{
                **legacy_settings,
                "id": "primary",
                "name": legacy_settings.get("pbx_name") or "Primary Yeastar PBX",
                "client_name": legacy_settings.get("client_name") or "Unassigned client",
            }]

    if not pbx_records:
        raise HTTPException(status_code=400, detail="Add a Yeastar PBX before running a synchronisation")

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
            if pbx_id == "primary":
                await db.settings.update_one({"type": "yeastar"}, {"$set": {"last_sync": completed_at.isoformat()}}, upsert=True)
            else:
                await db.yeastar_pbxs.update_one({"id": pbx_id}, {"$set": {"status": "online", "last_sync": completed_at.isoformat(), "extension_count": len(extensions), "billable_extension_count": len([extension for extension in extensions if extension.get("included_in_billing")]), "updated_at": completed_at.isoformat()}})
        except Exception as exc:
            completed_at = datetime.now(timezone.utc)
            entry.update({"status": "failed", "completed_at": completed_at.isoformat(), "duration_ms": int((completed_at - started_at).total_seconds() * 1000), "error": str(exc)})
            failed_pbxs.append({"id": pbx_id, "name": entry["pbx_name"], "error": str(exc)})
            if pbx_id != "primary":
                await db.yeastar_pbxs.update_one({"id": pbx_id}, {"$set": {"status": "authentication_failed" if "Authentication" in str(exc) else "offline", "last_sync": completed_at.isoformat(), "updated_at": completed_at.isoformat()}})
        await db.yeastar_sync_history.insert_one(entry)
        completed_entries.append(entry)

    if not successful_pbxs and failed_pbxs:
        raise HTTPException(status_code=502, detail=f"Yeastar sync failed: {failed_pbxs[0]['error']}")
    return {"extensions_processed": successful_extensions, "pbxs_processed": len(pbx_records), "failed_pbxs": failed_pbxs, "entries": completed_entries}


@router.post("/yeastar/billing/recalculate")
async def recalculate_yeastar_billing(current_user: dict = Depends(get_current_user)):
    pbx_records = await db.yeastar_pbxs.find({}, {"_id": 0}).to_list(500)
    if not pbx_records:
        settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0}) or {}
        pbx_records = [settings] if settings else []
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
            {"pbx_id": pbx_id}, {"_id": 0, "billable_quantity": 1}, sort=[("created_at", -1)]
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
        await db.yeastar_billing_snapshots.insert_one(snapshot)
        per_pbx.append(snapshot)

    quantity = len([extension for extension in all_extensions if extension.get("included_in_billing")])
    summary = {"id": str(uuid.uuid4()), "created_at": captured_at, "billable_quantity": quantity, "pbx_count": len(per_pbx), "source": "manual_recalculate_summary", "created_by": current_user.get("email", "system")}
    await db.yeastar_billing_snapshots.insert_one(summary)
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
    return {"message": "Yeastar extension usage will be attached to the selected recurring billing", "recurring_invoice_ids": modified, "created_recurring_invoice_id": created_id, "preview": billing}


@router.put("/yeastar/extensions/{extension_number}/override")
async def update_yeastar_extension_override(extension_number: str, data: dict, current_user: dict = Depends(get_current_user)):
    extension_key = str(data.get("extension_key") or extension_number)
    existing = await db.yeastar_extension_overrides.find_one({"extension_key": extension_key}, {"_id": 0}) or {}
    if not existing and ":" not in extension_key:
        existing = await db.yeastar_extension_overrides.find_one({"extension_number": extension_number}, {"_id": 0}) or {}
    record = {
        "extension_key": extension_key,
        "extension_number": extension_number,
        "enabled": bool(data.get("enabled", existing.get("enabled", True))),
        "exclude_from_billing": bool(data.get("exclude_from_billing", existing.get("exclude_from_billing", False))),
        "exclusion_reason": data.get("exclusion_reason", existing.get("exclusion_reason", "")),
        "first_discovered": existing.get("first_discovered", datetime.now(timezone.utc).isoformat()),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("email", "system"),
    }
    await db.yeastar_extension_overrides.update_one({"extension_key": extension_key}, {"$set": record}, upsert=True)
    return record

