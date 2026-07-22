from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from datetime import datetime, timezone, timedelta
import uuid
import math
import os
import secrets
import hashlib
import base64
import httpx
from urllib.parse import urlencode
from typing import Optional
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# Zone center coordinates (simulated for demo - would be configured per business)
ZONE_COORDS = {
    "North Rural": (-26.1, 28.0), "South Suburb": (-26.3, 28.05), "East Industrial": (-26.2, 28.15),
    "West CBD": (-26.2, 27.9), "Central": (-26.2, 28.05), "Downtown": (-26.19, 28.04),
}
DEFAULT_COORD = (-26.2, 28.05)

# Short-lived OAuth state is intentionally kept separate from the saved calendar
# connection. It prevents an authorization response from being attached to a
# different NexusMSP user.
_calendar_oauth_states = {}


def _calendar_pkce():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def _frontend_url():
    return os.environ.get("FRONTEND_URL", "http://127.0.0.1:3001").rstrip("/")


async def _microsoft_calendar_config():
    """Use the existing Microsoft app registration for delegated calendar consent."""
    config = await db.settings.find_one({"type": "microsoft_sso"}, {"_id": 0}) or {}
    if not config.get("tenant_id") or not config.get("client_id"):
        raise HTTPException(
            status_code=400,
            detail="Set the Microsoft Entra tenant ID and client ID in Settings > Sign-in & Access before connecting a calendar.",
        )
    return config


def _calendar_redirect_uri(request: Request, config: dict):
    # This must be registered as a Web redirect URI in the Microsoft Entra app.
    return (config.get("calendar_redirect_uri") or f"{str(request.base_url).rstrip('/')}/api/scheduling/microsoft365/callback").strip()


@router.get("/scheduling/microsoft365/connect")
async def start_microsoft_calendar_connect(request: Request, current_user: dict = Depends(get_current_user)):
    """Create a one-click delegated Microsoft calendar consent URL for this user."""
    config = await _microsoft_calendar_config()
    verifier, challenge = _calendar_pkce()
    state = secrets.token_urlsafe(32)
    _calendar_oauth_states[state] = {
        "user_id": current_user.get("id", ""),
        "user_name": current_user.get("name", ""),
        "code_verifier": verifier,
        "created_at": datetime.now(timezone.utc),
    }
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
    for stale_state, payload in list(_calendar_oauth_states.items()):
        if payload.get("created_at", cutoff) < cutoff:
            _calendar_oauth_states.pop(stale_state, None)

    redirect_uri = _calendar_redirect_uri(request, config)
    params = {
        "client_id": config["client_id"],
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "response_mode": "query",
        "scope": "openid profile offline_access User.Read Calendars.ReadWrite",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return {
        "authorization_url": f"https://login.microsoftonline.com/{config['tenant_id']}/oauth2/v2.0/authorize?{urlencode(params)}",
        "redirect_uri": redirect_uri,
        "permissions": ["User.Read", "Calendars.ReadWrite"],
    }


@router.get("/scheduling/microsoft365/callback")
async def complete_microsoft_calendar_connect(request: Request, code: str = "", state: str = "", error: str = ""):
    """Exchange the Microsoft authorization response and save the calendar connection."""
    frontend = _frontend_url()
    if error or not code or not state:
        reason = error or "missing_authorization_response"
        return RedirectResponse(f"{frontend}/settings?tab=calendar&calendar_error={reason}", status_code=302)

    state_data = _calendar_oauth_states.pop(state, None)
    if not state_data:
        return RedirectResponse(f"{frontend}/settings?tab=calendar&calendar_error=invalid_or_expired_state", status_code=302)

    try:
        config = await _microsoft_calendar_config()
        redirect_uri = _calendar_redirect_uri(request, config)
        token_payload = {
            "client_id": config["client_id"],
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": state_data["code_verifier"],
        }
        if config.get("client_secret"):
            token_payload["client_secret"] = config["client_secret"]
        async with httpx.AsyncClient(timeout=30) as client:
            token_response = await client.post(
                f"https://login.microsoftonline.com/{config['tenant_id']}/oauth2/v2.0/token",
                data=token_payload,
            )
            if token_response.status_code != 200:
                raise HTTPException(status_code=502, detail="Microsoft could not complete the calendar authorization")
            tokens = token_response.json()
            profile_response = await client.get(
                "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
        if profile_response.status_code != 200:
            raise HTTPException(status_code=502, detail="Microsoft calendar authorization completed but the user profile could not be read")
        profile = profile_response.json()
        now = datetime.now(timezone.utc)
        connection = {
            "provider": "microsoft365",
            "connected": True,
            "calendar_name": "NexusMSP Dispatch",
            "sync_direction": "two_way",
            "connected_by_user_id": state_data["user_id"],
            "connected_by_name": state_data["user_name"],
            "microsoft_user_id": profile.get("id"),
            "microsoft_email": profile.get("mail") or profile.get("userPrincipalName"),
            "last_synced_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        credentials = {
            "access_token": tokens.get("access_token", ""),
            "refresh_token": tokens.get("refresh_token", ""),
            "expires_at": (now + timedelta(seconds=int(tokens.get("expires_in", 3600)))).isoformat(),
            "scope": tokens.get("scope", ""),
            "updated_at": now.isoformat(),
        }
        await db.settings.update_one({"key": "dispatch_calendar_connection"}, {"$set": {"key": "dispatch_calendar_connection", "value": connection}}, upsert=True)
        await db.settings.update_one({"key": "dispatch_calendar_credentials"}, {"$set": {"key": "dispatch_calendar_credentials", "value": credentials}}, upsert=True)
        await db.activity_logs.insert_one({
            "id": str(uuid.uuid4()), "user_id": state_data["user_id"], "user_name": state_data["user_name"],
            "action": "dispatch_calendar_connected", "entity_type": "settings", "entity_id": "dispatch_calendar_connection",
            "entity_name": connection["calendar_name"], "details": f"Microsoft 365 calendar connected as {connection.get('microsoft_email') or 'selected account'}.",
            "created_at": now.isoformat(),
        })
        return RedirectResponse(f"{frontend}/settings?tab=calendar&calendar_connected=1", status_code=302)
    except HTTPException as exc:
        return RedirectResponse(f"{frontend}/settings?tab=calendar&calendar_error={exc.detail}", status_code=302)
    except Exception:
        return RedirectResponse(f"{frontend}/settings?tab=calendar&calendar_error=connection_failed", status_code=302)


@router.get("/scheduling/calendar-connection")
async def get_calendar_connection(current_user: dict = Depends(get_current_user)):
    """Return the organisation calendar policy without exposing credentials."""
    doc = await db.settings.find_one({"key": "dispatch_calendar_connection"}, {"_id": 0}) or {}
    value = doc.get("value", {})
    return {
        "provider": value.get("provider", "microsoft365"),
        "connected": bool(value.get("connected", False)),
        "calendar_name": value.get("calendar_name", "NexusMSP Dispatch"),
        "sync_direction": value.get("sync_direction", "two_way"),
        "last_synced_at": value.get("last_synced_at"),
        "requires_microsoft_permissions": not bool(value.get("connected", False)),
    }


@router.put("/scheduling/calendar-connection")
async def save_calendar_connection(data: dict, current_user: dict = Depends(get_current_user)):
    provider = data.get("provider", "microsoft365")
    if provider != "microsoft365":
        raise HTTPException(status_code=400, detail="Microsoft 365 is currently the supported dispatch calendar provider")
    value = {
        "provider": provider,
        "connected": bool(data.get("connected", False)),
        "calendar_name": (data.get("calendar_name") or "NexusMSP Dispatch").strip(),
        "sync_direction": data.get("sync_direction") if data.get("sync_direction") in {"one_way", "two_way"} else "two_way",
        "last_synced_at": datetime.now(timezone.utc).isoformat() if data.get("connected") else None,
        "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user.get("name", ""),
    }
    await db.settings.update_one({"key": "dispatch_calendar_connection"}, {"$set": {"key": "dispatch_calendar_connection", "value": value}}, upsert=True)
    await db.activity_logs.insert_one({
        "id": str(uuid.uuid4()), "user_id": current_user.get("id", ""), "user_name": current_user.get("name", ""),
        "action": "dispatch_calendar_connection_updated", "entity_type": "settings", "entity_id": "dispatch_calendar_connection",
        "entity_name": value["calendar_name"], "details": f"Microsoft 365 dispatch calendar {'connected' if value['connected'] else 'disconnected'}.",
        "created_at": value["updated_at"],
    })
    return value


async def _microsoft_calendar_access_token() -> tuple[str | None, dict]:
    """Return a usable delegated Graph token, refreshing it only when required."""
    connection_doc = await db.settings.find_one({"key": "dispatch_calendar_connection"}, {"_id": 0}) or {}
    connection = connection_doc.get("value", {})
    if not connection.get("connected") or connection.get("provider") != "microsoft365":
        return None, connection

    credentials_doc = await db.settings.find_one({"key": "dispatch_calendar_credentials"}, {"_id": 0}) or {}
    credentials = credentials_doc.get("value", {})
    access_token = credentials.get("access_token")
    expires_at = credentials.get("expires_at")
    now = datetime.now(timezone.utc)
    try:
        expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00")) if expires_at else now
    except (TypeError, ValueError):
        expires = now
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if access_token and expires > now + timedelta(minutes=2):
        return access_token, connection

    refresh_token = credentials.get("refresh_token")
    if not refresh_token:
        return None, connection
    config = await _microsoft_calendar_config()
    token_payload = {"client_id": config["client_id"], "grant_type": "refresh_token", "refresh_token": refresh_token}
    if config.get("client_secret"):
        token_payload["client_secret"] = config["client_secret"]
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"https://login.microsoftonline.com/{config['tenant_id']}/oauth2/v2.0/token", data=token_payload)
    if response.status_code != 200:
        return None, connection
    tokens = response.json()
    refreshed = {
        **credentials,
        "access_token": tokens.get("access_token", ""),
        "refresh_token": tokens.get("refresh_token") or refresh_token,
        "expires_at": (now + timedelta(seconds=int(tokens.get("expires_in", 3600)))).isoformat(),
        "scope": tokens.get("scope", credentials.get("scope", "")),
        "updated_at": now.isoformat(),
    }
    await db.settings.update_one({"key": "dispatch_calendar_credentials"}, {"$set": {"key": "dispatch_calendar_credentials", "value": refreshed}}, upsert=True)
    return refreshed["access_token"] or None, connection


async def sync_schedule_to_microsoft(schedule: dict) -> dict:
    """Create the appointment in the authorised Microsoft 365 calendar and persist its outcome."""
    if not schedule.get("id"):
        return {"state": "not_requested"}
    token, connection = await _microsoft_calendar_access_token()
    if not token:
        state = "not_connected" if not connection.get("connected") else "authentication_failed"
        await db.schedules.update_one({"id": schedule["id"]}, {"$set": {"calendar_sync_state": state, "calendar_sync_error": "Connect or re-authorise the Microsoft 365 dispatch calendar"}})
        return {"state": state}

    timezone_name = connection.get("timezone") or "Australia/Sydney"
    payload = {
        "subject": schedule.get("title") or "NexusMSP appointment",
        "body": {"contentType": "HTML", "content": (schedule.get("description") or "").replace("\n", "<br />")},
        "start": {"dateTime": f"{schedule.get('date')}T{schedule.get('start_time')}:00", "timeZone": timezone_name},
        "end": {"dateTime": f"{schedule.get('date')}T{schedule.get('end_time')}:00", "timeZone": timezone_name},
        "location": {"displayName": schedule.get("location") or ""},
        "categories": ["NexusMSP", "Dispatch"],
        "transactionId": schedule["id"],
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post("https://graph.microsoft.com/v1.0/me/events", json=payload, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        if response.status_code not in (200, 201):
            raise RuntimeError(f"Microsoft Graph returned {response.status_code}")
        event = response.json()
        now = datetime.now(timezone.utc).isoformat()
        await db.schedules.update_one({"id": schedule["id"]}, {"$set": {"calendar_sync_state": "synced", "calendar_event_id": event.get("id"), "calendar_last_synced_at": now, "calendar_sync_error": None}})
        return {"state": "synced", "event_id": event.get("id"), "synced_at": now}
    except Exception as exc:
        await db.schedules.update_one({"id": schedule["id"]}, {"$set": {"calendar_sync_state": "failed", "calendar_sync_error": str(exc)[:240], "calendar_last_synced_at": datetime.now(timezone.utc).isoformat()}})
        return {"state": "failed", "error": str(exc)}


def haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def estimate_travel_time(dist_km):
    avg_speed_kmh = 40
    return round(dist_km / avg_speed_kmh * 60)  # minutes


@router.get("/scheduling/calendar")
async def get_schedule_calendar(current_user: dict = Depends(get_current_user)):
    """Get all scheduled items for calendar view."""
    # Fetch field jobs, workshop jobs, and scheduled tickets
    fj = await db.field_jobs.find({"field_status": {"$ne": "completed"}}, {"_id": 0}).to_list(500)
    ws = await db.workshop_jobs.find({"repair_status": {"$nin": ["collected", "cancelled"]}}, {"_id": 0}).to_list(500)
    events = []
    for j in fj:
        events.append({
            "id": j["id"], "type": "field_job", "title": f"[FIELD] {j.get('customer_name', '')} - {j.get('description', '')[:50]}",
            "date": j.get("scheduled_date", ""), "time": j.get("scheduled_time", "09:00"),
            "duration": j.get("estimated_duration", 60), "zone": j.get("zone", ""),
            "technician": j.get("assigned_to_name", "Unassigned"), "technician_id": j.get("assigned_to", ""),
            "status": j.get("field_status", "scheduled"), "address": j.get("service_address", ""),
            "color": "#06b6d4",
        })
    for j in ws:
        events.append({
            "id": j["id"], "type": "workshop", "title": f"[WS] {j.get('customer_name', '')} - {j.get('fault_description', '')[:50]}",
            "date": j.get("created_at", "")[:10], "time": "09:00",
            "duration": j.get("estimated_duration", 60), "zone": "Workshop",
            "technician": j.get("assigned_to_name", "Unassigned"), "technician_id": j.get("assigned_to", ""),
            "status": j.get("repair_status", "checked_in"), "color": "#a855f7",
        })
    appointments = await db.schedules.find({"event_type": {"$in": ["appointment", "pto", "blocked", "on_call"]}}, {"_id": 0}).to_list(1000)
    for appointment in appointments:
        events.append({
            "id": appointment["id"], "type": "appointment", "title": appointment.get("title") or appointment.get("event_type", "appointment").replace("_", " ").title(),
            "date": appointment.get("date", ""), "time": appointment.get("start_time", ""), "end_time": appointment.get("end_time", ""),
            "duration": 0, "zone": "", "technician": appointment.get("user_name", "Unassigned"), "technician_name": appointment.get("user_name", "Unassigned"),
            "technician_id": appointment.get("user_id", ""), "status": appointment.get("event_type", "appointment"),
            "address": appointment.get("location", ""), "location": appointment.get("location", ""), "client_id": appointment.get("client_id"),
            "client_name": appointment.get("client_name", ""), "ticket_id": appointment.get("ticket_id"), "calendar_sync_state": appointment.get("calendar_sync_state", "not_requested"), "calendar_sync_error": appointment.get("calendar_sync_error"), "color": "#10b981" if appointment.get("event_type") == "appointment" else "#f59e0b",
        })
    return events


@router.get("/scheduling/technician-workload")
async def get_technician_workload(date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    target_date = date or datetime.now(timezone.utc).date().isoformat()
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(100)
    appointments = await db.schedules.find({"date": target_date}, {"_id": 0}).sort("start_time", 1).to_list(1000)
    return [{
        "id": tech.get("id"), "name": tech.get("name"),
        "bookings": [{key: item.get(key) for key in ["id", "title", "start_time", "end_time", "event_type", "client_name", "location", "ticket_id"]} for item in appointments if item.get("user_id") == tech.get("id")],
    } for tech in techs]


@router.get("/scheduling/map-data")
async def get_map_data(current_user: dict = Depends(get_current_user)):
    """Get job locations for map view."""
    fj = await db.field_jobs.find({"field_status": {"$ne": "completed"}}, {"_id": 0}).to_list(200)
    markers = []
    for j in fj:
        zone = j.get("zone", "Central")
        coord = ZONE_COORDS.get(zone, DEFAULT_COORD)
        # Add slight randomization within zone
        import random
        lat = coord[0] + random.uniform(-0.02, 0.02)
        lng = coord[1] + random.uniform(-0.02, 0.02)
        markers.append({
            "id": j["id"], "lat": lat, "lng": lng, "zone": zone,
            "title": j.get("description", "Field Job")[:60],
            "customer": j.get("customer_name", ""),
            "address": j.get("service_address", ""),
            "status": j.get("field_status", "scheduled"),
            "technician": j.get("assigned_to_name", "Unassigned"),
            "scheduled": f"{j.get('scheduled_date', '')} {j.get('scheduled_time', '')}",
        })
    return {"markers": markers, "zones": ZONE_COORDS}


@router.post("/scheduling/optimize-route")
async def optimize_route(data: dict, current_user: dict = Depends(get_current_user)):
    """Optimize job order for a technician to minimize travel."""
    technician_id = data.get("technician_id")
    date = data.get("date")
    if not technician_id:
        return {"error": "technician_id required"}

    q = {"assigned_to": technician_id, "field_status": {"$nin": ["completed", "cancelled"]}}
    if date:
        q["scheduled_date"] = date
    jobs = await db.field_jobs.find(q, {"_id": 0}).to_list(50)
    if len(jobs) <= 1:
        return {"optimized_order": [j["id"] for j in jobs], "total_distance_km": 0, "total_travel_min": 0, "savings": 0}

    # Simple nearest-neighbor optimization
    coords = []
    for j in jobs:
        zone = j.get("zone", "Central")
        c = ZONE_COORDS.get(zone, DEFAULT_COORD)
        coords.append({"job": j, "lat": c[0], "lng": c[1]})

    # Calculate original distance
    orig_dist = 0
    for i in range(len(coords) - 1):
        orig_dist += haversine(coords[i]["lat"], coords[i]["lng"], coords[i + 1]["lat"], coords[i + 1]["lng"])

    # Nearest neighbor
    visited = [False] * len(coords)
    order = [0]
    visited[0] = True
    for _ in range(len(coords) - 1):
        curr = order[-1]
        best = -1
        best_dist = float("inf")
        for j in range(len(coords)):
            if not visited[j]:
                d = haversine(coords[curr]["lat"], coords[curr]["lng"], coords[j]["lat"], coords[j]["lng"])
                if d < best_dist:
                    best_dist = d
                    best = j
        if best >= 0:
            order.append(best)
            visited[best] = True

    opt_dist = 0
    for i in range(len(order) - 1):
        opt_dist += haversine(coords[order[i]]["lat"], coords[order[i]]["lng"], coords[order[i + 1]]["lat"], coords[order[i + 1]]["lng"])

    optimized = [coords[i]["job"]["id"] for i in order]
    optimized_jobs = [coords[i]["job"] for i in order]
    savings = max(0, orig_dist - opt_dist)

    return {
        "optimized_order": optimized,
        "optimized_jobs": optimized_jobs,
        "total_distance_km": round(opt_dist, 1),
        "original_distance_km": round(orig_dist, 1),
        "total_travel_min": estimate_travel_time(opt_dist),
        "savings_km": round(savings, 1),
        "savings_min": estimate_travel_time(savings),
    }


@router.get("/scheduling/technician-availability")
async def get_tech_availability(current_user: dict = Depends(get_current_user)):
    """Get technician availability based on scheduled jobs."""
    techs = await db.users.find({"role": {"$in": ["technician", "admin"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
    today = datetime.now(timezone.utc).date().isoformat()
    result = []
    for t in techs:
        jobs_today = await db.field_jobs.count_documents({"assigned_to": t["id"], "scheduled_date": today, "field_status": {"$ne": "completed"}})
        open_tickets = await db.tickets.count_documents({"assigned_to": t["id"], "status": {"$in": ["open", "in_progress"]}})
        result.append({
            "id": t["id"], "name": t["name"],
            "jobs_today": jobs_today, "open_tickets": open_tickets,
            "total_load": jobs_today + open_tickets,
            "available": jobs_today < 5,
        })
    return sorted(result, key=lambda x: x["total_load"])
