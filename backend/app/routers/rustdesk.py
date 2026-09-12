import os

from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional
from datetime import datetime, timezone
import uuid
import httpx
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.scope_permissions import (
    assert_client_scope,
    assert_global_scope,
    assert_record_scope,
    scoped_query,
)
from app.services.secret_store import decrypt_secret, encrypt_secret
from app.services.activity import log_activity
from app.services.rustdesk_provider_security import (
    is_masked_secret as _is_masked_secret,
    normalise_rustdesk_server_url as _normalise_rustdesk_server_url,
    redact_provider_payload as _redact_provider_payload,
)

router = APIRouter()

_RUSTDESK_EDITABLE_FIELDS = {
    "device_name",
    "rustdesk_id",
    "rustdesk_password",
    "os",
    "notes",
}

_RUSTDESK_CONFIG_EDITABLE_FIELDS = {
    "server_url",
    "api_key",
    "relay_server",
    "enabled",
    "auto_sync",
    "default_password_length",
}

_RUSTDESK_CONFIG_RESPONSE_FIELDS = {
    "server_url",
    "relay_server",
    "enabled",
    "auto_sync",
    "default_password_length",
    "last_sync",
    "last_sync_peers",
    "last_auto_sync",
    "last_auto_sync_peers",
}

def _public_rustdesk_config(value: dict) -> dict:
    """Expose only provider state required by the administrator UI."""
    public = {key: value.get(key) for key in _RUSTDESK_CONFIG_RESPONSE_FIELDS if key in value}
    secret = decrypt_secret(value.get("api_key_encrypted")) or str(value.get("api_key") or "")
    if secret:
        public["api_key"] = "********"
        public["api_key_configured"] = True
    else:
        public["api_key"] = ""
        public["api_key_configured"] = False
    return public


def _credential_configured(record: dict) -> bool:
    return bool(record.get("rustdesk_password_encrypted") or record.get("rustdesk_password"))


def _public_rustdesk_device(record: dict) -> dict:
    """Return registry metadata without leaking provider secrets or raw payloads."""
    public = dict(record)
    public.pop("_id", None)
    public.pop("rustdesk_password", None)
    public.pop("rustdesk_password_encrypted", None)
    # Raw provider payloads are flexible by design and may contain fields we
    # have not yet classified. They are retained only as server-side evidence,
    # never returned through the client-facing registry API.
    public.pop("raw", None)
    public["credential_configured"] = _credential_configured(record)
    return public


def _password_update(password: object) -> dict:
    value = str(password or "").strip()
    return {
        "rustdesk_password_encrypted": encrypt_secret(value) if value else "",
        "rustdesk_password": "",
    }


async def _read_remote_password(record: dict) -> str:
    """Read encrypted credentials and opportunistically migrate legacy plaintext."""
    encrypted = str(record.get("rustdesk_password_encrypted") or "")
    if encrypted:
        return decrypt_secret(encrypted)
    legacy = str(record.get("rustdesk_password") or "")
    if not legacy:
        return ""
    await db.rustdesk_devices.update_one(
        {"id": record.get("id")},
        {"$set": _password_update(legacy)},
    )
    return legacy

# ============== RUSTDESK REMOTE ACCESS MANAGEMENT ==============

async def _get_rustdesk_config():
    """Get the validated, server-owned RustDesk provider configuration."""
    config = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0})
    value = dict(config.get("value") or {}) if config else {}
    if value.get("api_key_encrypted"):
        value["api_key"] = decrypt_secret(value.get("api_key_encrypted"))
    value["server_url"] = _normalise_rustdesk_server_url(value.get("server_url"))
    return value

async def _rustdesk_api_request(method: str, path: str, data: dict = None):
    """Make an authenticated request to the RustDesk server API."""
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    if not server_url:
        return None
    
    url = f"{server_url}/api{path}"
    headers_dict = {}
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            if method == "GET":
                resp = await client.get(url, headers=headers_dict)
            elif method == "POST":
                resp = await client.post(url, json=data or {}, headers=headers_dict)
            else:
                return None
            if resp.status_code == 200:
                return resp.json()
            return None
    except Exception:
        return None

@router.post(
    "/rustdesk/sync/devices",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def sync_rustdesk_devices(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Read the Pro device inventory and link matching NexusMSP endpoints."""
    await assert_global_scope(
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    config = await _get_rustdesk_config()
    base, token = config.get("server_url", ""), config.get("api_key", "")
    if not base or not token:
        raise HTTPException(400, "RustDesk server URL and API token are required")
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(f"{base}/api/devices", params={"pageSize": 1000, "current": 1}, headers={"Authorization": f"Bearer {token}"})
    if response.status_code != 200:
        raise HTTPException(502, f"RustDesk API returned HTTP {response.status_code}")
    payload = response.json()
    devices = payload.get("data") or []
    linked = 0
    skipped_unowned = 0
    skipped_ambiguous = 0
    for item in devices:
        info = item.get("info") or {}
        hostname = str(info.get("hostname") or info.get("name") or item.get("id") or "").strip()
        rustdesk_id = str(item.get("id") or "").strip()
        if not rustdesk_id:
            skipped_unowned += 1
            continue

        # A provider payload carries no Nexus client ownership.  Only bind it
        # when one canonical Nexus asset can establish that ownership.
        candidates = await db.devices.find(
            {"rustdesk_id": rustdesk_id},
            {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "hostname": 1, "os": 1},
        ).to_list(2)
        if not candidates and hostname:
            candidates = await db.devices.find(
                {"$or": [{"hostname": hostname}, {"name": hostname}]},
                {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "hostname": 1, "os": 1},
            ).to_list(2)
        if len(candidates) != 1:
            skipped_ambiguous += 1 if candidates else 0
            skipped_unowned += 1 if not candidates else 0
            continue

        local = candidates[0]
        client_id = str(local.get("client_id") or "").strip()
        if not client_id:
            skipped_unowned += 1
            continue

        now = datetime.now(timezone.utc).isoformat()
        existing = await db.rustdesk_devices.find_one({"linked_device_id": local["id"]}, {"_id": 0})
        if existing and str(existing.get("client_id") or "").strip() not in {"", client_id}:
            skipped_ambiguous += 1
            continue
        entry_id = str((existing or {}).get("id") or uuid.uuid4())
        doc = {
            "id": entry_id,
            "client_id": client_id,
            "client_name": local.get("client_name") or "",
            "linked_device_id": local["id"],
            "device_name": local.get("name") or local.get("hostname") or hostname,
            "rustdesk_guid": item.get("guid"),
            "rustdesk_id": rustdesk_id,
            "os": local.get("os") or "",
            "status": item.get("status"),
            "last_online": item.get("last_online"),
            "raw": _redact_provider_payload(item),
            "synced_at": now,
            "updated_at": now,
        }
        if not existing:
            doc.update({"created_at": now, "created_by": current_user["id"]})
        await db.rustdesk_devices.update_one(
            {"id": entry_id} if existing and existing.get("id") else {"linked_device_id": local["id"]},
            {"$set": doc},
            upsert=not bool(existing),
        )
        await db.devices.update_one(
            {"id": local["id"]},
            {"$set": {"rustdesk_id": rustdesk_id, "rustdesk_guid": item.get("guid"), "remote_access_updated_at": now}},
        )
        linked += 1
    return {
        "success": True,
        "synced": len(devices),
        "linked": linked,
        "skipped_unowned": skipped_unowned,
        "skipped_ambiguous": skipped_ambiguous,
        "total": payload.get("total", len(devices)),
    }

@router.get(
    "/rustdesk/config",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def get_rustdesk_global_config(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Get global RustDesk server configuration"""
    await assert_global_scope(
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    config = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0})
    if not config:
        return {
            "key": "rustdesk_config",
            "value": {
                "server_url": "",
                "api_key": "",
                "relay_server": "",
                "enabled": False,
                "default_password_length": 8,
            }
        }
    return {"key": "rustdesk_config", "value": _public_rustdesk_config(dict(config.get("value") or {}))}

@router.post(
    "/rustdesk/config",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def save_rustdesk_global_config(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Save global RustDesk server configuration"""
    await assert_global_scope(
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    existing = await db.settings.find_one({"key": "rustdesk_config"}, {"_id": 0}) or {}
    current_value = existing.get("value") if isinstance(existing.get("value"), dict) else {}
    incoming = {key: data[key] for key in _RUSTDESK_CONFIG_EDITABLE_FIELDS if key in data}
    if "server_url" in incoming:
        incoming["server_url"] = _normalise_rustdesk_server_url(incoming["server_url"])
    incoming_key = str(incoming.get("api_key") or "")
    if _is_masked_secret(incoming_key):
        incoming.pop("api_key", None)
    value = {**current_value, **incoming}
    value["server_url"] = _normalise_rustdesk_server_url(value.get("server_url"))
    api_key = str(value.get("api_key") or "")
    if api_key and not _is_masked_secret(api_key):
        value["api_key_encrypted"] = encrypt_secret(api_key)
    value.pop("api_key", None)
    await db.settings.update_one(
        {"key": "rustdesk_config"},
        {"$set": {"key": "rustdesk_config", "value": value, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user["id"]}},
        upsert=True
    )
    return {"message": "RustDesk configuration saved"}

@router.get("/rustdesk/clients/{client_id}/devices")
async def get_client_rustdesk_devices(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Get all RustDesk device configs for a client"""
    await assert_client_scope(
        current_user,
        client_id,
        operation="device.remote.view",
        request=request,
    )
    devices = await db.rustdesk_devices.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [_public_rustdesk_device(device) for device in devices]

@router.post(
    "/rustdesk/clients/{client_id}/devices",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def add_rustdesk_device(
    client_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Register a RustDesk device for a client"""
    await assert_client_scope(
        current_user,
        client_id,
        operation="device.remote.configure",
        request=request,
    )
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    linked_device_id = str(data.get("linked_device_id") or "").strip()
    if linked_device_id:
        linked_device = await assert_record_scope(
            current_user,
            db.devices,
            linked_device_id,
            operation="device.remote.configure",
            request=request,
            resource_name="Managed asset",
        )
        if str(linked_device.get("client_id") or "").strip() != client_id:
            raise HTTPException(
                status_code=409,
                detail="A RustDesk record can only link to an asset owned by the selected client",
            )
        existing_link = await db.rustdesk_devices.find_one(
            {"linked_device_id": linked_device_id},
            {"_id": 0, "id": 1, "rustdesk_id": 1},
        )
        if existing_link:
            raise HTTPException(
                status_code=409,
                detail=f"This asset is already linked to RustDesk ID {existing_link.get('rustdesk_id')}",
            )

    device_entry = {
        "id": str(uuid.uuid4()),
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "device_name": data.get("device_name", ""),
        "rustdesk_id": data.get("rustdesk_id", ""),
        **_password_update(data.get("rustdesk_password")),
        "os": data.get("os", ""),
        "status": "configured",
        "last_connected": None,
        "notes": data.get("notes", ""),
        "linked_device_id": linked_device_id,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.rustdesk_devices.insert_one(device_entry)
    device_entry.pop("_id", None)
    return _public_rustdesk_device(device_entry)

@router.put(
    "/rustdesk/devices/{device_id}",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def update_rustdesk_device(
    device_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Update a RustDesk device config"""
    await assert_record_scope(
        current_user,
        db.rustdesk_devices,
        device_id,
        operation="device.remote.configure",
        request=request,
        resource_name="RustDesk device",
    )
    updates = {key: data[key] for key in _RUSTDESK_EDITABLE_FIELDS if key in data and key != "rustdesk_password"}
    if "rustdesk_password" in data:
        updates.update(_password_update(data.get("rustdesk_password")))
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.rustdesk_devices.update_one({"id": device_id}, {"$set": updates})
    return {"message": "RustDesk device updated"}

@router.delete(
    "/rustdesk/devices/{device_id}",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def delete_rustdesk_device(
    device_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Remove a RustDesk device config"""
    await assert_record_scope(
        current_user,
        db.rustdesk_devices,
        device_id,
        operation="device.remote.configure",
        request=request,
        resource_name="RustDesk device",
    )
    await db.rustdesk_devices.delete_one({"id": device_id})
    return {"message": "RustDesk device removed"}

@router.post(
    "/rustdesk/devices/{device_id}/connect",
    dependencies=[Depends(require_action("device.remote.start"))],
)
async def initiate_rustdesk_connection(
    device_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Retired legacy connection path.

    This route returned unattended credentials to the browser and did not use
    the governed remote-session lifecycle.  Keep the URL as an explicit
    failure so old clients cannot silently downgrade a session's consent,
    ticket, time and audit evidence.
    """
    raise HTTPException(
        status_code=410,
        detail="Legacy RustDesk connection is retired. Start a governed remote session from the managed asset or work session.",
    )

@router.get("/rustdesk/sessions")
async def get_rustdesk_sessions(
    request: Request,
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get RustDesk session history"""
    query = {}
    if client_id:
        await assert_client_scope(
            current_user,
            client_id,
            operation="device.remote.view",
            request=request,
        )
        query["client_id"] = client_id
    query = scoped_query(current_user, query)
    sessions = await db.rustdesk_sessions.find(query, {"_id": 0}).sort("started_at", -1).to_list(100)
    client_ids = {session.get("client_id") for session in sessions if session.get("client_id")}
    client_rows = await db.clients.find(
        {"id": {"$in": list(client_ids)}},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(len(client_ids) or 1)
    client_names = {client["id"]: client.get("name") for client in client_rows}

    registry_ids = {session.get("device_id") for session in sessions if session.get("device_id")}
    registry_rows = await db.rustdesk_devices.find(
        {"id": {"$in": list(registry_ids)}},
        {"_id": 0, "id": 1, "device_name": 1},
    ).to_list(len(registry_ids) or 1)
    device_names = {device["id"]: device.get("device_name") for device in registry_rows}
    for session in sessions:
        session["client_name"] = client_names.get(session.get("client_id"))
        session["device_name"] = device_names.get(session.get("device_id"))
    return sessions


@router.get("/rustdesk/all-devices")
async def get_all_remote_devices(current_user: dict = Depends(get_current_user)):
    """Get all managed devices enriched with their RustDesk registration status"""
    # Get all managed devices
    devices = await db.devices.find(scoped_query(current_user), {
        "_id": 0, "id": 1, "name": 1, "hostname": 1, "client_id": 1, "client_name": 1,
        "device_type": 1, "os": 1, "status": 1, "ip_address": 1, "rustdesk_id": 1,
    }).to_list(500)
    # Get all registered RustDesk device entries
    rd_devices = await db.rustdesk_devices.find(scoped_query(current_user), {"_id": 0}).to_list(500)
    rd_by_linked = {r.get("linked_device_id"): r for r in rd_devices if r.get("linked_device_id")}
    rd_by_id = {r.get("id"): r for r in rd_devices}

    enriched = []
    for d in devices:
        rd = rd_by_linked.get(d["id"])
        entry = {
            **d,
            "managed_asset": True,
            "registry_state": "managed",
            "rd_registered": bool(rd or d.get("rustdesk_id")),
            "rd_id": rd.get("rustdesk_id") if rd else d.get("rustdesk_id"),
            "credential_configured": _credential_configured(rd or {}),
            "rd_entry_id": rd.get("id") if rd else None,
            "rd_last_connected": rd.get("last_connected") if rd else None,
            "rd_notes": rd.get("notes") if rd else None,
        }
        enriched.append(entry)

    # Add standalone RustDesk entries not linked to a managed device
    linked_ids = {r.get("linked_device_id") for r in rd_devices if r.get("linked_device_id")}
    for rd in rd_devices:
        if rd.get("linked_device_id") not in [d["id"] for d in devices]:
            enriched.append({
                "id": rd.get("id"),
                "name": rd.get("device_name", "Unlinked Device"),
                "hostname": None,
                "client_id": rd.get("client_id"),
                "client_name": rd.get("client_name"),
                "device_type": "unknown",
                "os": rd.get("os"),
                "status": rd.get("status", "configured"),
                "ip_address": None,
                "managed_asset": False,
                "registry_state": "provider_only",
                "rd_registered": True,
                "rd_id": rd.get("rustdesk_id"),
                "credential_configured": _credential_configured(rd),
                "rd_entry_id": rd.get("id"),
                "rd_last_connected": rd.get("last_connected"),
                "rd_notes": rd.get("notes"),
            })

    return enriched


@router.put(
    "/rustdesk/assign/{device_id}",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def assign_rustdesk_id(
    device_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Assign or update a RustDesk ID directly on a managed device, and create/update the rustdesk_devices entry"""
    rd_id = data.get("rustdesk_id", "").strip()
    rd_password_supplied = "rustdesk_password" in data
    rd_password = str(data.get("rustdesk_password") or "").strip()
    if not rd_id:
        raise HTTPException(status_code=400, detail="RustDesk ID is required")

    device = await assert_record_scope(
        current_user,
        db.devices,
        device_id,
        operation="device.remote.configure",
        request=request,
        resource_name="Device",
    )
    device_client_id = str(device.get("client_id") or "").strip()
    if not device_client_id:
        raise HTTPException(
            status_code=409,
            detail="Link the managed asset to a client before assigning a RustDesk identity",
        )
    await db.devices.update_one({"id": device_id}, {"$set": {"rustdesk_id": rd_id}})

    # Upsert a rustdesk_devices entry linked to this device
    existing = await db.rustdesk_devices.find_one({"linked_device_id": device_id}, {"_id": 0})
    if existing:
        existing_client_id = str(existing.get("client_id") or "").strip()
        if existing_client_id and existing_client_id != device_client_id:
            raise HTTPException(status_code=409, detail="RustDesk registry ownership conflicts with the selected managed asset")
        updates = {"rustdesk_id": rd_id, "updated_at": datetime.now(timezone.utc).isoformat()}
        if not existing_client_id:
            updates.update({
                "client_id": device_client_id,
                "client_name": device.get("client_name", ""),
                "device_name": device.get("name") or device.get("hostname") or "",
                "os": device.get("os", ""),
            })
        if rd_password_supplied:
            updates.update(_password_update(rd_password))
        await db.rustdesk_devices.update_one(
            {"linked_device_id": device_id},
            {"$set": updates},
        )
    else:
        entry = {
            "id": str(uuid.uuid4()), "client_id": device_client_id,
            "client_name": device.get("client_name", ""), "device_name": device.get("name", ""),
            "rustdesk_id": rd_id, **_password_update(rd_password), "os": device.get("os", ""),
            "status": "configured", "last_connected": None, "notes": "",
            "linked_device_id": device_id, "created_by": current_user["id"],
            "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.rustdesk_devices.insert_one(entry)
        entry.pop("_id", None)

    return {"message": "RustDesk ID assigned", "rustdesk_id": rd_id}


@router.put(
    "/rustdesk/devices/{entry_id}/link",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def link_rustdesk_registry_entry(
    entry_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Link a provider-only RustDesk record to one canonical NexusMSP asset."""

    managed_device_id = str(data.get("managed_device_id") or "").strip()
    if not managed_device_id:
        raise HTTPException(status_code=422, detail="Choose a managed asset")

    registry_entry = await assert_record_scope(
        current_user,
        db.rustdesk_devices,
        entry_id,
        operation="device.remote.configure",
        request=request,
        resource_name="RustDesk provider record",
    )
    device = await assert_record_scope(
        current_user,
        db.devices,
        managed_device_id,
        operation="device.remote.configure",
        request=request,
        resource_name="Managed asset",
    )

    registry_client_id = str(registry_entry.get("client_id") or "").strip()
    device_client_id = str(device.get("client_id") or "").strip()
    if not device_client_id:
        raise HTTPException(
            status_code=409,
            detail="Link the managed asset to a client before attaching a RustDesk provider record",
        )
    if registry_client_id and registry_client_id != device_client_id:
        raise HTTPException(status_code=409, detail="RustDesk provider record belongs to a different client")

    existing_link = await db.rustdesk_devices.find_one(
        {"linked_device_id": managed_device_id, "id": {"$ne": entry_id}},
        {"_id": 0, "id": 1, "rustdesk_id": 1},
    )
    if existing_link:
        raise HTTPException(
            status_code=409,
            detail=f"This asset is already linked to RustDesk ID {existing_link.get('rustdesk_id')}",
        )

    rustdesk_id = str(registry_entry.get("rustdesk_id") or "").strip()
    if not rustdesk_id:
        raise HTTPException(status_code=409, detail="The provider record has no RustDesk ID")

    now = datetime.now(timezone.utc).isoformat()
    await db.rustdesk_devices.update_one(
        {"id": entry_id},
        {"$set": {
            "linked_device_id": managed_device_id,
            "device_name": device.get("name") or device.get("hostname") or rustdesk_id,
            "client_id": device.get("client_id"),
            "client_name": device.get("client_name"),
            "os": device.get("os"),
            "updated_at": now,
            "linked_at": now,
            "linked_by": current_user.get("id"),
        }},
    )
    await db.devices.update_one(
        {"id": managed_device_id},
        {"$set": {"rustdesk_id": rustdesk_id, "remote_access_updated_at": now}},
    )
    await log_activity(
        current_user,
        "rustdesk_asset_linked",
        "device",
        managed_device_id,
        device.get("name") or device.get("hostname") or "",
        f"Linked RustDesk provider record {rustdesk_id}",
        metadata={"rustdesk_entry_id": entry_id, "rustdesk_id": rustdesk_id},
    )
    return {
        "message": "RustDesk record linked to managed asset",
        "managed_device_id": managed_device_id,
        "rustdesk_id": rustdesk_id,
    }


@router.post(
    "/rustdesk/quick-connect",
    dependencies=[Depends(require_action("device.remote.start"))],
)
async def quick_connect(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Retired unlinked remote-connect path.

    Nexus must have a managed asset, client boundary and session workflow
    before it launches remote access.  An arbitrary RustDesk ID cannot supply
    those controls, even for a globally scoped operator.
    """
    raise HTTPException(
        status_code=410,
        detail="Unlinked quick connect is retired. Select a managed asset and start a governed remote session instead.",
    )


# ─── Patch Agent Deployment via RustDesk ───

@router.post("/rustdesk/devices/{device_id}/deploy-agent")
async def deploy_agent_to_device(device_id: str, current_user: dict = Depends(get_current_user)):
    """Queue a patch agent deployment for a device. Generates the deploy command and tracks status."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Install Nexus Agent from the Nexus Agent workspace.")
    device = await db.devices.find_one({"id": device_id}, {"_id": 0})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Get agent settings for the API URL
    settings = await db.settings.find_one({"type": "patch_agent"}, {"_id": 0})
    api_url = settings.get("api_url", "") if settings else ""
    agent_key = settings.get("agent_api_key", f"nxagent-{uuid.uuid4().hex[:16]}") if settings else f"nxagent-{uuid.uuid4().hex[:16]}"

    deploy_cmd = f'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \'{api_url}/patch-hub/agent/download-script\' -OutFile NexusOps-PatchAgent.ps1; .\\NexusOps-PatchAgent.ps1"'

    deployment = {
        "id": f"dep-{uuid.uuid4().hex[:8]}",
        "device_id": device_id,
        "device_name": device.get("name", device.get("hostname", "Unknown")),
        "client_id": device.get("client_id", ""),
        "client_name": device.get("client_name", ""),
        "status": "pending",
        "deploy_command": deploy_cmd,
        "queued_by": current_user.get("name", ""),
        "queued_at": datetime.now(timezone.utc).isoformat(),
        "deployed_at": None,
        "agent_version": "1.0.0",
    }

    await db.agent_deployments.update_one(
        {"device_id": device_id},
        {"$set": deployment, "$setOnInsert": {"first_queued": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )

    # Mark device as pending agent deployment
    await db.devices.update_one({"id": device_id}, {"$set": {"agent_deploy_status": "pending", "agent_deploy_queued_at": deployment["queued_at"]}})

    return {"message": "Agent deployment queued", "deployment": deployment}


@router.post("/rustdesk/devices/{device_id}/deploy-agent/complete")
async def mark_agent_deployed(device_id: str, current_user: dict = Depends(get_current_user)):
    """Mark a device's agent deployment as complete (tech confirms after running the script)."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Nexus Agent enrollment is recorded automatically.")
    await db.agent_deployments.update_one(
        {"device_id": device_id},
        {"$set": {"status": "deployed", "deployed_at": datetime.now(timezone.utc).isoformat(), "deployed_by": current_user.get("name", "")}}
    )
    await db.devices.update_one({"id": device_id}, {"$set": {"agent_deploy_status": "deployed", "agent_version": "1.0.0"}})
    return {"message": "Agent deployment marked complete"}


@router.post("/rustdesk/deploy-agent/bulk")
async def bulk_deploy_agent(data: dict, current_user: dict = Depends(get_current_user)):
    """Queue agent deployment for multiple devices at once."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Use Nexus Agent installers instead.")
    device_ids = data.get("device_ids", [])
    if not device_ids:
        raise HTTPException(status_code=400, detail="No devices specified")

    settings = await db.settings.find_one({"type": "patch_agent"}, {"_id": 0})
    api_url = settings.get("api_url", "") if settings else ""
    agent_key = settings.get("agent_api_key", f"nxagent-{uuid.uuid4().hex[:16]}") if settings else f"nxagent-{uuid.uuid4().hex[:16]}"

    devices = await db.devices.find({"id": {"$in": device_ids}}, {"_id": 0}).to_list(500)
    queued = 0
    for device in devices:
        deploy_cmd = f'powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri \'{api_url}/patch-hub/agent/download-script\' -OutFile NexusOps-PatchAgent.ps1; .\\NexusOps-PatchAgent.ps1"'
        deployment = {
            "id": f"dep-{uuid.uuid4().hex[:8]}",
            "device_id": device["id"],
            "device_name": device.get("name", device.get("hostname", "Unknown")),
            "client_id": device.get("client_id", ""),
            "client_name": device.get("client_name", ""),
            "status": "pending",
            "deploy_command": deploy_cmd,
            "queued_by": current_user.get("name", ""),
            "queued_at": datetime.now(timezone.utc).isoformat(),
            "deployed_at": None,
            "agent_version": "1.0.0",
        }
        await db.agent_deployments.update_one(
            {"device_id": device["id"]},
            {"$set": deployment, "$setOnInsert": {"first_queued": datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        await db.devices.update_one({"id": device["id"]}, {"$set": {"agent_deploy_status": "pending"}})
        queued += 1

    return {"message": f"Agent deployment queued for {queued} devices", "queued_count": queued}


@router.get("/rustdesk/agent-deployments")
async def get_agent_deployments(current_user: dict = Depends(get_current_user)):
    """Get all agent deployment statuses."""
    raise HTTPException(status_code=410, detail="The legacy Patch Agent is retired. Nexus Agent enrollment is available in the Nexus Agent workspace.")
    deployments = await db.agent_deployments.find({}, {"_id": 0}).sort("queued_at", -1).to_list(500)
    return {
        "total": len(deployments),
        "pending": len([d for d in deployments if d.get("status") == "pending"]),
        "deployed": len([d for d in deployments if d.get("status") == "deployed"]),
        "failed": len([d for d in deployments if d.get("status") == "failed"]),
        "deployments": deployments,
    }


# ─── Live RustDesk Server API Integration ───

@router.get(
    "/rustdesk/live/test-connection",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def test_rustdesk_connection(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    """Test the administrator-approved RustDesk provider configuration only."""
    await assert_global_scope(
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    saved_config = await _get_rustdesk_config()
    server_url = saved_config.get("server_url", "").rstrip("/")
    api_key = saved_config.get("api_key", "")
    
    if not server_url:
        return {"connected": False, "message": "No server URL configured"}
    
    results = {
        "server_url": server_url,
        "connected": False,
        "authorized": False,
        "api_version": None,
        "peer_count": None,
        "endpoints_available": [],
    }
    
    # Try multiple API patterns
    endpoints_to_try = [
        ("GET", "/peers", "peers"),
        ("GET", "/v1/peers", "v1_peers"),
        ("GET", "/ab/peers", "ab_peers"),
        ("GET", "/heartbeat", "heartbeat"),
    ]
    
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            headers_dict = {}
            if api_key:
                headers_dict["Authorization"] = f"Bearer {api_key}"
            
            # Basic connectivity check
            for method, path, label in endpoints_to_try:
                try:
                    url = f"{server_url}/api{path}"
                    resp = await client.get(url, headers=headers_dict)
                    if resp.status_code in [200, 401, 403]:
                        results["connected"] = True
                        results["endpoints_available"].append({"path": path, "status": resp.status_code, "label": label})
                        if resp.status_code == 200:
                            results["authorized"] = True
                            try:
                                data = resp.json()
                                if isinstance(data, list):
                                    results["peer_count"] = len(data)
                                elif isinstance(data, dict) and "data" in data:
                                    results["peer_count"] = len(data["data"]) if isinstance(data["data"], list) else None
                            except Exception:
                                pass
                except Exception:
                    continue
            
            # Try root API
            try:
                resp = await client.get(f"{server_url}/api", headers=headers_dict)
                if resp.status_code == 200:
                    results["connected"] = True
            except Exception:
                pass
                    
        if not results["connected"]:
            # Try raw TCP to see if server is reachable
            try:
                async with httpx.AsyncClient(timeout=5.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
                    resp = await client.get(server_url)
                results["connected"] = True
                results["message"] = f"Server reachable (HTTP {resp.status_code}) but API endpoints not accessible. Check API key permissions."
            except Exception:
                results["message"] = "Cannot reach server. Check URL and firewall rules."
    except Exception:
        results["message"] = "Connection test failed. Check the saved server configuration and connectivity."
    
    if results["authorized"]:
        results["message"] = f"Connected and authorised. {len(results['endpoints_available'])} API endpoint(s) responded."
    elif results["connected"] and not results.get("message"):
        results["message"] = "Server reachable, but the API token was rejected or lacks permission to read peers."
    
    return results


@router.get(
    "/rustdesk/live/peers",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def get_live_peers(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Fetch live peer data from the RustDesk server. Tries multiple API patterns."""
    await assert_global_scope(
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    
    if not server_url:
        raise HTTPException(status_code=400, detail="RustDesk server not configured")
    
    peers = []
    source = None
    
    headers_dict = {}
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            # Try different peer list endpoints
            for path in ["/peers", "/v1/peers", "/ab/peers", "/ab"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list):
                            peers = data
                            source = path
                            break
                        elif isinstance(data, dict):
                            if "data" in data and isinstance(data["data"], list):
                                peers = data["data"]
                                source = path
                                break
                            elif "peers" in data and isinstance(data["peers"], list):
                                peers = data["peers"]
                                source = path
                                break
                except Exception:
                    continue
    except Exception:
        raise HTTPException(status_code=502, detail="Failed to reach the configured RustDesk server") from None
    
    # Normalize peer data
    normalized = []
    for p in peers:
        normalized.append({
            "id": p.get("id") or p.get("Id") or p.get("peer_id") or "",
            "hostname": p.get("hostname") or p.get("Hostname") or p.get("host_name") or "",
            "username": p.get("username") or p.get("Username") or "",
            "os": p.get("os") or p.get("platform") or p.get("Platform") or "",
            "online": p.get("online", False) if isinstance(p.get("online"), bool) else str(p.get("online", "")).lower() in ["true", "1", "yes"],
            "last_online": p.get("last_online") or p.get("LastOnline") or "",
            "version": p.get("version") or p.get("Version") or "",
            "ip": p.get("ip") or "",
            "tags": p.get("tags") or p.get("Tags") or [],
            "alias": p.get("alias") or p.get("note") or "",
        })
    
    return {"peers": normalized, "count": len(normalized), "source": source, "server_url": server_url}


async def _scoped_rustdesk_ids(current_user: dict) -> set[str]:
    """Return only RustDesk identities attached to assets the user may see."""
    managed = await db.devices.find(
        scoped_query(current_user, {"rustdesk_id": {"$exists": True, "$ne": ""}}),
        {"_id": 0, "rustdesk_id": 1},
    ).to_list(2000)
    registry = await db.rustdesk_devices.find(
        scoped_query(current_user, {"rustdesk_id": {"$exists": True, "$ne": ""}}),
        {"_id": 0, "rustdesk_id": 1},
    ).to_list(2000)
    return {
        str(row.get("rustdesk_id") or "").strip()
        for row in [*managed, *registry]
        if str(row.get("rustdesk_id") or "").strip()
    }


@router.get(
    "/rustdesk/live/status-map",
    dependencies=[Depends(require_action("device.remote.start"))],
)
async def get_live_status_map(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Lightweight endpoint: returns {rd_id: online/offline} map for all known peers.
    Used for polling connection status indicators on Devices pages."""
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    api_key = config.get("api_key", "")
    
    if not server_url:
        return {"status_map": {}, "server_configured": False}
    
    headers_dict = {}
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    allowed_ids = await _scoped_rustdesk_ids(current_user)
    status_map = {}
    try:
        async with httpx.AsyncClient(timeout=8.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            for path in ["/ab/peers", "/peers", "/v1/peers"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        peers = data if isinstance(data, list) else data.get("data", data.get("peers", []))
                        if isinstance(peers, list):
                            for p in peers:
                                rd_id = str(p.get("id") or p.get("Id") or p.get("peer_id") or "")
                                if rd_id and rd_id in allowed_ids:
                                    is_online = p.get("online", False) if isinstance(p.get("online"), bool) else str(p.get("online", "")).lower() in ["true", "1", "yes"]
                                    status_map[rd_id] = "online" if is_online else "offline"
                            break
                except Exception:
                    continue
    except Exception:
        pass
    
    return {"status_map": status_map, "server_configured": True, "peer_count": len(status_map)}



@router.post(
    "/rustdesk/live/sync",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def sync_rustdesk_peers(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Sync live RustDesk peers into the NexusOps device/rustdesk_devices collections.
    - Matches by RustDesk ID to existing devices
    - Updates online/offline status
    - Creates registry entries only after a canonical Nexus asset establishes ownership
    """
    await assert_global_scope(
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    if not server_url:
        raise HTTPException(status_code=400, detail="RustDesk server not configured")
    
    # Fetch live peers
    headers_dict = {}
    api_key = config.get("api_key", "")
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    peers = []
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            for path in ["/peers", "/v1/peers", "/ab/peers", "/ab"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list):
                            peers = data; break
                        elif isinstance(data, dict):
                            if "data" in data and isinstance(data["data"], list):
                                peers = data["data"]; break
                            elif "peers" in data:
                                peers = data["peers"]; break
                except Exception:
                    continue
    except Exception:
        raise HTTPException(status_code=502, detail="Cannot reach the configured RustDesk server") from None
    
    if not peers:
        return {"message": "No peers found on server or API not accessible", "synced": 0, "created": 0, "updated": 0}
    
    # Normalize
    normalized = []
    for p in peers:
        rd_id = p.get("id") or p.get("Id") or p.get("peer_id") or ""
        if rd_id:
            normalized.append({
                "rd_id": str(rd_id),
                "hostname": p.get("hostname") or p.get("Hostname") or p.get("host_name") or "",
                "username": p.get("username") or p.get("Username") or "",
                "os": p.get("os") or p.get("platform") or p.get("Platform") or "",
                "online": p.get("online", False) if isinstance(p.get("online"), bool) else str(p.get("online", "")).lower() in ["true", "1", "yes"],
                "version": p.get("version") or p.get("Version") or "",
                "ip": p.get("ip") or "",
                "alias": p.get("alias") or p.get("note") or "",
            })
    
    # Provider payloads do not carry Nexus client ownership.  Treat a peer as
    # actionable only when exactly one canonical managed asset claims its ID.
    existing_rd = await db.rustdesk_devices.find({}, {"_id": 0}).to_list(1000)
    existing_devices = await db.devices.find(
        {"rustdesk_id": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "client_id": 1, "client_name": 1, "name": 1, "hostname": 1, "os": 1, "rustdesk_id": 1},
    ).to_list(1000)

    devices_by_rd: dict[str, list[dict]] = {}
    for device in existing_devices:
        rustdesk_id = str(device.get("rustdesk_id") or "").strip()
        if rustdesk_id:
            devices_by_rd.setdefault(rustdesk_id, []).append(device)
    registry_by_rd: dict[str, list[dict]] = {}
    for entry in existing_rd:
        rustdesk_id = str(entry.get("rustdesk_id") or "").strip()
        if rustdesk_id:
            registry_by_rd.setdefault(rustdesk_id, []).append(entry)
    
    created = 0
    updated = 0
    skipped_unowned = 0
    skipped_ambiguous = 0
    now = datetime.now(timezone.utc).isoformat()
    
    for peer in normalized:
        rd_id = peer["rd_id"]
        status = "online" if peer["online"] else "offline"
        
        device_candidates = devices_by_rd.get(rd_id, [])
        if len(device_candidates) != 1:
            skipped_ambiguous += 1 if device_candidates else 0
            skipped_unowned += 1 if not device_candidates else 0
            continue
        device = device_candidates[0]
        client_id = str(device.get("client_id") or "").strip()
        if not client_id:
            skipped_unowned += 1
            continue

        registry_candidates = registry_by_rd.get(rd_id, [])
        conflicting_registry = [
            entry
            for entry in registry_candidates
            if str(entry.get("client_id") or "").strip() not in {"", client_id}
        ]
        eligible_registry = [
            entry
            for entry in registry_candidates
            if str(entry.get("client_id") or "").strip() in {"", client_id}
            and str(entry.get("linked_device_id") or "").strip() in {"", str(device["id"])}
        ]
        if conflicting_registry or len(eligible_registry) > 1:
            skipped_ambiguous += 1
            continue

        await db.devices.update_one(
            {"id": device["id"]},
            {"$set": {"status": status, "rd_last_seen": now, "rd_hostname": peer["hostname"], "rd_version": peer["version"]}},
        )

        registry_entry = eligible_registry[0] if eligible_registry else None
        entry_id = str((registry_entry or {}).get("id") or uuid.uuid4())
        registry_update = {
            "id": entry_id,
            "client_id": client_id,
            "client_name": device.get("client_name") or "",
            "device_name": device.get("name") or device.get("hostname") or peer["alias"] or peer["hostname"] or f"RustDesk-{rd_id}",
            "rustdesk_id": rd_id,
            "rustdesk_password": "",
            "rustdesk_password_encrypted": str((registry_entry or {}).get("rustdesk_password_encrypted") or "") or encrypt_secret(str((registry_entry or {}).get("rustdesk_password") or "")),
            "os": peer["os"] or device.get("os") or (registry_entry or {}).get("os", ""),
            "status": status,
            "last_connected": now if peer["online"] else (registry_entry or {}).get("last_connected"),
            "last_online": now if peer["online"] else (registry_entry or {}).get("last_online"),
            "rd_version": peer["version"],
            "rd_hostname": peer["hostname"],
            "notes": (registry_entry or {}).get("notes") or "Auto-synced from RustDesk server",
            "linked_device_id": device["id"],
            "updated_at": now,
        }
        if registry_entry:
            await db.rustdesk_devices.update_one({"id": entry_id}, {"$set": registry_update})
            updated += 2
        else:
            registry_update.update({"created_by": current_user["id"], "created_at": now})
            await db.rustdesk_devices.insert_one(registry_update)
            created += 1
            updated += 1
    
    # Update sync timestamp
    await db.settings.update_one(
        {"key": "rustdesk_config"},
        {"$set": {"value.last_sync": now, "value.last_sync_peers": len(normalized)}}
    )
    
    return {
        "message": f"Synced {len(normalized)} trusted peers from RustDesk server",
        "synced": len(normalized),
        "created": created,
        "updated": updated,
        "skipped_unowned": skipped_unowned,
        "skipped_ambiguous": skipped_ambiguous,
    }


@router.get(
    "/rustdesk/live/audit",
    dependencies=[Depends(require_action("device.remote.configure"))],
)
async def get_live_audit_logs(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Fetch live session audit logs from the RustDesk server."""
    await assert_global_scope(
        current_user,
        operation="device.remote.configure",
        request=request,
    )
    config = await _get_rustdesk_config()
    server_url = config.get("server_url", "").rstrip("/")
    if not server_url:
        return {"logs": [], "source": None}
    
    headers_dict = {}
    api_key = config.get("api_key", "")
    if api_key:
        headers_dict["Authorization"] = f"Bearer {api_key}"
    
    logs = []
    source = None
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=os.environ.get('ALLOW_SELF_SIGNED_CERTS','false').lower()!='true') as client:
            for path in ["/audit", "/v1/audit", "/sessions", "/conn-log"]:
                try:
                    resp = await client.get(f"{server_url}/api{path}", headers=headers_dict)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list):
                            logs = data; source = path; break
                        elif isinstance(data, dict) and isinstance(data.get("data"), list):
                            logs = data["data"]; source = path; break
                except Exception:
                    continue
    except Exception:
        pass
    
    redacted_logs = [_redact_provider_payload(item) for item in logs[:100] if isinstance(item, dict)]
    return {"logs": redacted_logs, "count": len(redacted_logs), "source": source}



# ============== REMOTE SESSION AUDIT RECORDS ==============

@router.get(
    "/remote-session-records",
    dependencies=[Depends(require_action("device.remote.start"))],
)
async def admin_list_remote_session_records(
    request: Request,
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
    current_user: dict = Depends(get_current_user),
):
    """List client-portal remote session audit records within the caller's scope."""
    query = {}
    if client_id:
        await assert_client_scope(
            current_user,
            client_id,
            operation="device.remote.start",
            request=request,
        )
        query["client_id"] = client_id
    if status:
        query["status"] = status
    recs = await db.remote_session_records.find(
        scoped_query(current_user, query),
        {"_id": 0},
    ).sort("started_at", -1).to_list(max(1, min(int(limit), 500)))
    return recs


@router.get(
    "/remote-session-records/{session_id}/pdf",
    dependencies=[Depends(require_action("device.remote.start"))],
)
async def admin_remote_session_pdf(
    session_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Download a client-portal remote-session audit PDF within caller scope."""
    rec = await assert_record_scope(
        current_user,
        db.remote_session_records,
        session_id,
        operation="device.remote.start",
        request=request,
        resource_name="Remote session record",
    )
    from fpdf import FPDF
    from fastapi.responses import Response

    branding = await db.settings.find_one({"key": "branding"}, {"_id": 0}) or {}
    msp_name = (branding.get("value", {}) or {}).get("company_name") or "NexusOps"

    def _fmt_dur(s):
        if s is None: return "In progress"
        s = int(s or 0); h, rem = divmod(s, 3600); m, sec = divmod(rem, 60)
        return f"{h}h {m}m {sec}s" if h else (f"{m}m {sec}s" if m else f"{sec}s")
    def _fmt_dt(iso):
        if not iso: return "—"
        try:
            return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M:%S UTC")
        except Exception: return iso

    pdf = FPDF(); pdf.add_page()
    pdf.set_fill_color(15, 23, 42); pdf.rect(0, 0, 210, 25, "F")
    pdf.set_font("Helvetica", "B", 16); pdf.set_text_color(255, 255, 255); pdf.set_xy(10, 8)
    pdf.cell(0, 8, msp_name, ln=1)
    pdf.set_font("Helvetica", "", 10); pdf.set_x(10); pdf.cell(0, 5, "Remote Access Session - Audit Record", ln=1)
    pdf.set_text_color(0, 0, 0); pdf.set_y(35)
    pdf.set_font("Helvetica", "B", 13); pdf.cell(0, 8, f"Session ID: {rec['id'][:8].upper()}", ln=1); pdf.ln(2)

    def row(l, v):
        pdf.set_font("Helvetica", "B", 10); pdf.cell(55, 7, l)
        pdf.set_font("Helvetica", "", 10)
        txt = str(v or "-").encode("latin-1", "replace").decode("latin-1")
        if len(txt) > 85: txt = txt[:82] + "..."
        pdf.cell(0, 7, txt, ln=1)

    pdf.set_font("Helvetica", "B", 11); pdf.cell(0, 7, "Session Details", ln=1)
    pdf.set_draw_color(200, 200, 200); pdf.line(10, pdf.get_y(), 200, pdf.get_y()); pdf.ln(2)
    row("Client", rec.get("client_name"))
    row("Initiated by", f"{rec.get('portal_user_name')} ({rec.get('portal_user_email')})")
    row("Device", f"{rec.get('device_name')} ({rec.get('device_os', '—')})")
    row("RustDesk ID", rec.get("rustdesk_id"))
    row("Started at", _fmt_dt(rec.get("started_at")))
    row("Ended at", _fmt_dt(rec.get("ended_at")))
    row("Duration", _fmt_dur(rec.get("duration_seconds")))
    row("Status", (rec.get("status") or "").capitalize())
    row("IP address", rec.get("ip_address"))
    pdf.ln(4); pdf.set_font("Helvetica", "B", 11); pdf.cell(0, 7, "Consent Acknowledgement", ln=1)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y()); pdf.ln(2)
    pdf.set_font("Helvetica", "", 10); pdf.multi_cell(0, 6, (rec.get("consent_text") or "-").encode("latin-1","replace").decode("latin-1"))
    pdf.ln(1); pdf.set_font("Helvetica", "I", 9); pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 5, f"Acknowledged at: {_fmt_dt(rec.get('consent_acknowledged_at'))}", ln=1)
    if rec.get("notes"):
        pdf.ln(4); pdf.set_text_color(0, 0, 0); pdf.set_font("Helvetica", "B", 11); pdf.cell(0, 7, "Session Notes", ln=1)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y()); pdf.ln(2)
        pdf.set_font("Helvetica", "", 10); pdf.multi_cell(0, 6, rec.get("notes").encode("latin-1","replace").decode("latin-1"))
    pdf.set_y(-25); pdf.set_font("Helvetica", "", 8); pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 5, f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} · {msp_name}", ln=1, align="C")
    pdf.cell(0, 5, "This document is a tamper-evident audit record of a client-initiated remote access session.", ln=1, align="C")

    pdf_bytes = bytes(pdf.output(dest="S"))
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="remote-session-{rec["id"][:8]}.pdf"'})
