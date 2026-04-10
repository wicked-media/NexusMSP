import os
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== YEASTAR PBX ENDPOINTS ==============

@router.get("/yeastar/status")
async def get_yeastar_status(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    return {"configured": bool(settings and settings.get("client_id") and settings.get("pbx_url"))}

@router.post("/yeastar/settings")
async def save_yeastar_settings(settings: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "yeastar"},
        {"$set": {
            "type": "yeastar",
            "pbx_url": settings.get("pbx_url", ""),
            "client_id": settings.get("client_id", ""),
            "client_secret": settings.get("client_secret", ""),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    _yeastar_token_cache["token"] = None
    _yeastar_token_cache["expires"] = 0
    _yeastar_token_cache["refresh_token"] = None
    return {"message": "Yeastar settings saved"}

@router.get("/yeastar/settings")
async def get_yeastar_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if settings:
        settings.pop("client_secret", None)
    return settings or {"type": "yeastar", "pbx_url": "", "client_id": ""}

@router.get("/yeastar/test-connection")
async def test_yeastar_connection(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if not settings or not settings.get("client_id"):
        return {"success": False, "message": "Yeastar not configured. Please add PBX URL, Client ID and Client Secret."}
    try:
        token = await _yeastar_get_token(settings)
        if token:
            return {"success": True, "message": "Successfully connected to Yeastar PBX."}
        return {"success": False, "message": "Authentication failed. This may be due to max token limit (8) — tokens auto-expire after 30 minutes. Try again shortly."}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}

import asyncio

_yeastar_token_lock = asyncio.Lock()
_yeastar_token_cache = {"token": None, "expires": 0, "client_id": None}

async def _yeastar_get_token(settings: dict) -> str | None:
    """Get access token from Yeastar PBX with caching and lock"""
    pbx_url = settings.get("pbx_url", "").rstrip("/")
    client_id = settings.get("client_id", "")
    client_secret = settings.get("client_secret", "")
    if not pbx_url or not client_id or not client_secret:
        return None
    
    async with _yeastar_token_lock:
        now = datetime.now(timezone.utc).timestamp()
        if (_yeastar_token_cache["token"] and 
            _yeastar_token_cache["client_id"] == client_id and 
            now < _yeastar_token_cache["expires"]):
            return _yeastar_token_cache["token"]
        
        url = f"{pbx_url}/openapi/v1.0/get_token"
        try:
            async with httpx.AsyncClient(verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true', timeout=15) as http:
                resp = await http.post(url, json={"username": client_id, "password": client_secret}, headers={"User-Agent": "OpenAPI", "Content-Type": "application/json"})
                data = resp.json()
                if data.get("errcode") == 0:
                    token = data.get("access_token")
                    _yeastar_token_cache["token"] = token
                    _yeastar_token_cache["expires"] = now + data.get("access_token_expire_time", 1800) - 60
                    _yeastar_token_cache["client_id"] = client_id
                    _yeastar_token_cache["refresh_token"] = data.get("refresh_token")
                    return token
                if data.get("errcode") == 60002:
                    logger.warning("Yeastar max tokens exceeded, waiting for auto-expiry")
                logger.error(f"Yeastar auth: {data.get('errmsg', 'Unknown error')}")
                return None
        except Exception as e:
            logger.error(f"Yeastar auth error: {e}")
            return None

async def _yeastar_api_get(path: str, params: dict = None) -> dict | list | None:
    """Make authenticated GET request to Yeastar PBX"""
    settings = await db.settings.find_one({"type": "yeastar"}, {"_id": 0})
    if not settings:
        return None
    token = await _yeastar_get_token(settings)
    if not token:
        return None
    pbx_url = settings.get("pbx_url", "").rstrip("/")
    url = f"{pbx_url}/openapi/v1.0/{path}"
    query = {"access_token": token}
    if params:
        query.update(params)
    try:
        async with httpx.AsyncClient(verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true', timeout=15) as http:
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
async def get_yeastar_extensions(current_user: dict = Depends(get_current_user)):
    data = await _yeastar_api_get("extension/list")
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

