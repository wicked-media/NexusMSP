"""UniFi Network Integration API routes for per-controller integrations.

Controller records are Nexus-owned configuration.  Their credentials never
leave the server, and every request is constrained by the controller's client
ownership before it can reach a provider endpoint.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import quote
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.routers.networking import (
    _normalise_unifi_controller_url,
    _normalise_unifi_site_id,
    _public_controller_url,
)
from app.services.module_permissions import require_module_permission
from app.services.scope_permissions import (
    assert_client_scope,
    assert_global_scope,
    assert_record_scope,
    scoped_query,
)
from app.services.secret_store import decrypt_secret, encrypt_secret


router = APIRouter()


from app.services.time_utils import now_iso as _now


def _payload(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _controller_client_id(controller: dict[str, Any]) -> str | None:
    client_id = str(controller.get("client_id") or "").strip()
    return client_id or None


from app.services.identity_utils import tenant_id_or_none as _tenant_id


def _controller_write_query(controller: dict[str, Any]) -> dict[str, Any]:
    """Make later writes conditional on the ownership we just authorised."""
    query = {"id": controller["id"], "client_id": _controller_client_id(controller)}
    controller_tenant_id = _tenant_id(controller.get("tenant_id"))
    if controller_tenant_id:
        query["tenant_id"] = controller_tenant_id
    return query


async def _assert_controller_tenant_scope(
    current_user: dict[str, Any],
    controller: dict[str, Any],
    operation: str,
) -> None:
    """Fail closed when a tenant-bound actor reaches another tenant's record."""
    actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
    controller_tenant_id = _tenant_id(controller.get("tenant_id"))
    if not actor_tenant_id or actor_tenant_id == controller_tenant_id:
        return
    await db.scope_denials.insert_one(
        {
            "user_id": current_user.get("id"),
            "user_name": current_user.get("name"),
            "role": current_user.get("role"),
            "tenant_id": controller_tenant_id,
            "client_id": _controller_client_id(controller),
            "operation": operation,
            "occurred_at": _now(),
        }
    )
    raise HTTPException(status_code=404, detail="Controller not found")


def _validate_controller_api_key(value: object) -> str:
    api_key = str(value or "").strip()
    if len(api_key) < 12:
        raise HTTPException(status_code=422, detail="Controller API key must be at least 12 characters")
    return api_key


def _api_key_preview(api_key: str) -> str:
    return f"...{api_key[-4:]}" if len(api_key) >= 8 else "configured"


async def _normalise_legacy_controller_scope(controller: dict[str, Any]) -> dict[str, Any]:
    """Classify blank legacy ownership explicitly after access has been checked."""
    client_id = _controller_client_id(controller)
    if "client_id" in controller and controller.get("client_id") == client_id:
        return controller

    await db.unifi_controllers.update_one(
        {"id": controller["id"]},
        {"$set": {"client_id": client_id, "scope_classification": "legacy_global" if not client_id else "client"}},
    )
    controller["client_id"] = client_id
    controller["scope_classification"] = "legacy_global" if not client_id else "client"
    return controller


async def _migrate_legacy_controller_secret(controller: dict[str, Any]) -> dict[str, Any]:
    """Encrypt a legacy plaintext API key only after controller scope is proven."""
    encrypted = str(controller.get("api_key_encrypted") or "")
    legacy = str(controller.get("api_key") or "").strip()
    if encrypted and decrypt_secret(encrypted):
        if legacy:
            await db.unifi_controllers.update_one(
                _controller_write_query(controller),
                {"$unset": {"api_key": ""}},
            )
            controller.pop("api_key", None)
        return controller
    if not legacy:
        return controller

    encrypted = encrypt_secret(legacy)
    result = await db.unifi_controllers.update_one(
        {**_controller_write_query(controller), "api_key": legacy},
        {"$set": {"api_key_encrypted": encrypted}, "$unset": {"api_key": ""}},
    )
    if getattr(result, "matched_count", 0):
        controller["api_key_encrypted"] = encrypted
        controller.pop("api_key", None)
        return controller

    refreshed = await db.unifi_controllers.find_one(_controller_write_query(controller), {"_id": 0})
    if refreshed:
        controller.clear()
        controller.update(refreshed)
    return controller


def _controller_api_key(controller: dict[str, Any]) -> str:
    api_key = decrypt_secret(str(controller.get("api_key_encrypted") or ""))
    if not api_key:
        raise HTTPException(status_code=409, detail="Controller has no usable encrypted API credential")
    return api_key


def _public_controller(controller: dict[str, Any]) -> dict[str, Any]:
    public = dict(controller)
    public.pop("_id", None)
    public.pop("api_key", None)
    public.pop("api_key_encrypted", None)
    public["client_id"] = _controller_client_id(controller)
    public["controller_url"] = _public_controller_url(public.get("controller_url"))
    public["api_key_configured"] = bool(decrypt_secret(str(controller.get("api_key_encrypted") or "")))
    public["api_key_preview"] = _api_key_preview(_controller_api_key(controller)) if public["api_key_configured"] else ""
    return public


async def _get_controller(controller_id: str, current_user: dict[str, Any], operation: str) -> dict[str, Any]:
    controller = await assert_record_scope(
        current_user,
        db.unifi_controllers,
        controller_id,
        operation=operation,
        resource_name="Controller",
    )
    await _assert_controller_tenant_scope(current_user, controller, operation)
    await _normalise_legacy_controller_scope(controller)
    return await _migrate_legacy_controller_secret(controller)


async def _audit_controller(
    current_user: dict[str, Any],
    operation: str,
    controller: dict[str, Any],
    *,
    details: dict[str, Any] | None = None,
) -> None:
    await db.audit_logs.insert_one(
        {
            "id": str(uuid.uuid4()),
            "actor_id": current_user.get("id"),
            "actor_name": current_user.get("name"),
            "operation": operation,
            "entity_type": "unifi_controller",
            "entity_id": controller.get("id"),
            "client_id": _controller_client_id(controller),
            "tenant_id": controller.get("tenant_id") or current_user.get("tenant_id"),
            "details": details or {},
            "created_at": _now(),
        }
    )


def _api_base(controller: dict[str, Any]) -> str:
    origin = _normalise_unifi_controller_url(controller.get("controller_url"))
    if not origin:
        raise HTTPException(status_code=409, detail="Controller has no usable URL")
    return f"{origin}/proxy/network/integration/v1"


async def _net_call(
    controller: dict[str, Any],
    method: str,
    path: str,
    json_body: Optional[dict[str, Any]] = None,
    params: Optional[dict[str, Any]] = None,
) -> Any:
    """Call an explicitly validated Network Integration API endpoint."""
    url = f"{_api_base(controller)}/{path.lstrip('/')}"
    headers = {
        "X-API-KEY": _controller_api_key(controller),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(
            timeout=30,
            verify=bool(controller.get("verify_tls", True)),
            follow_redirects=False,
        ) as client:
            response = await client.request(method, url, headers=headers, json=json_body, params=params)
            if response.status_code in (401, 403):
                raise HTTPException(status_code=response.status_code, detail="Controller authentication failed")
            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="Controller endpoint not found")
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail="Controller request failed")
            try:
                return response.json()
            except (ValueError, TypeError):
                return {}
    except HTTPException:
        raise
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Cannot reach controller") from None


def _data(response: Any) -> list[dict[str, Any]]:
    if isinstance(response, list):
        return [item for item in response if isinstance(item, dict)]
    if isinstance(response, dict):
        for key in ("data", "Data", "items"):
            if isinstance(response.get(key), list):
                return [item for item in response[key] if isinstance(item, dict)]
    return []


_SENSITIVE_PROVIDER_FIELDS = frozenset({
    "api_key", "apikey", "apiKey", "authorization", "token", "secret", "password", "credentials",
})


def _public_provider_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_public_provider_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: _public_provider_value(item)
        for key, item in value.items()
        if str(key).lower() not in {field.lower() for field in _SENSITIVE_PROVIDER_FIELDS}
    }


def _normalise_controller_url(value: object, *, required: bool) -> str:
    url = _normalise_unifi_controller_url(value)
    if required and not url:
        raise HTTPException(status_code=422, detail="Controller URL is required")
    return url


def _normalise_device_id(value: object) -> str:
    device_id = str(value or "").strip()
    if not device_id or len(device_id) > 255:
        raise HTTPException(status_code=422, detail="Device ID is required")
    return quote(device_id, safe="")


def _controller_site_id(controller: dict[str, Any]) -> str:
    return _normalise_unifi_site_id(controller.get("network_site_id"))


async def _record_device_action(
    current_user: dict[str, Any],
    controller: dict[str, Any],
    *,
    device_id: str,
    action: str,
    success: bool,
    extra: dict[str, Any] | None = None,
) -> None:
    occurred_at = _now()
    await db.unifi_actions.insert_one(
        {
            "id": str(uuid.uuid4()),
            "controller_id": controller["id"],
            "client_id": _controller_client_id(controller),
            "tenant_id": controller.get("tenant_id") or current_user.get("tenant_id"),
            "device_id": device_id,
            "action": action,
            "success": success,
            "extra": extra or {},
            "actor_id": current_user.get("id"),
            "by": current_user.get("name"),
            "timestamp": occurred_at,
        }
    )
    await _audit_controller(
        current_user,
        f"unifi.controller.device_{action.lower()}",
        controller,
        details={"device_id": device_id, "success": success, "extra": extra or {}},
    )


# ─────────────────────────── CRUD ───────────────────────────


@router.get("/unifi/controllers")
async def list_controllers(current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    query: dict[str, Any] = {}
    actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
    if actor_tenant_id:
        query["tenant_id"] = actor_tenant_id
    rows = await db.unifi_controllers.find(
        scoped_query(current_user, query, field="client_id", site_field=None),
        {"_id": 0},
    ).to_list(500)
    controllers = []
    for controller in rows:
        controller = await _normalise_legacy_controller_scope(controller)
        controller = await _migrate_legacy_controller_secret(controller)
        controllers.append(_public_controller(controller))
    return controllers


@router.post("/unifi/controllers")
async def create_controller(data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "create")
    payload = _payload(data)
    name = str(payload.get("name") or "").strip()
    api_key = str(payload.get("api_key") or "").strip()
    if not name or not api_key:
        raise HTTPException(status_code=422, detail="Name and API key are required")

    client_id = str(payload.get("client_id") or "").strip() or None
    client: dict[str, Any] | None = None
    if client_id:
        await assert_client_scope(current_user, client_id, operation="unifi.controller.create")
        client = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
        client_tenant_id = _tenant_id(client.get("tenant_id"))
        if actor_tenant_id and actor_tenant_id != client_tenant_id:
            raise HTTPException(status_code=404, detail="Client not found")
    else:
        await assert_global_scope(current_user, operation="unifi.controller.create.global")

    api_key = _validate_controller_api_key(api_key)

    controller = {
        "id": str(uuid.uuid4()),
        "name": name,
        "controller_url": _normalise_controller_url(payload.get("controller_url"), required=True),
        "api_key_encrypted": encrypt_secret(api_key),
        "network_site_id": _normalise_unifi_site_id(payload.get("network_site_id")),
        "verify_tls": bool(payload.get("verify_tls", True)),
        "notes": str(payload.get("notes") or "").strip(),
        "client_id": client_id,
        "client_name": (client or {}).get("name"),
        "tenant_id": _tenant_id((client or {}).get("tenant_id")) or _tenant_id(current_user.get("tenant_id")),
        "scope_classification": "client" if client_id else "global",
        "created_at": _now(),
        "created_by": current_user.get("name"),
        "last_test_status": None,
        "last_tested_at": None,
        "last_synced_at": None,
    }
    await db.unifi_controllers.insert_one(controller)
    await _audit_controller(current_user, "unifi.controller.created", controller, details={"verify_tls": controller["verify_tls"]})
    return {"message": "Controller added", "id": controller["id"]}


@router.put("/unifi/controllers/{controller_id}")
async def update_controller(controller_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "edit")
    controller = await _get_controller(controller_id, current_user, "unifi.controller.update")
    payload = _payload(data)
    if "client_id" in payload:
        requested_client_id = str(payload.get("client_id") or "").strip() or None
        if requested_client_id != _controller_client_id(controller):
            raise HTTPException(status_code=422, detail="Controller ownership can only change through an explicit transfer workflow")

    updates: dict[str, Any] = {}
    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="Controller name is required")
        updates["name"] = name
    if "notes" in payload:
        updates["notes"] = str(payload.get("notes") or "").strip()
    if "controller_url" in payload:
        updates["controller_url"] = _normalise_controller_url(payload.get("controller_url"), required=True)
    if "network_site_id" in payload:
        updates["network_site_id"] = _normalise_unifi_site_id(payload.get("network_site_id"))
    if "verify_tls" in payload:
        updates["verify_tls"] = bool(payload.get("verify_tls"))
    api_key = str(payload.get("api_key") or "").strip()
    if api_key:
        api_key = _validate_controller_api_key(api_key)
        updates["api_key_encrypted"] = encrypt_secret(api_key)
    if not updates:
        return {"message": "Controller unchanged"}

    updates["updated_at"] = _now()
    updates["updated_by"] = current_user.get("name")
    unset = {"api_key": ""} if api_key else {}
    result = await db.unifi_controllers.update_one(
        _controller_write_query(controller),
        {"$set": updates, **({"$unset": unset} if unset else {})},
    )
    if not getattr(result, "matched_count", 0):
        raise HTTPException(status_code=409, detail="Controller changed while it was being updated; retry")
    controller.update(updates)
    controller.pop("api_key", None)
    await _audit_controller(
        current_user,
        "unifi.controller.updated",
        controller,
        details={"fields": sorted(key for key in updates if key not in {"api_key_encrypted"}), "credential_rotated": bool(api_key)},
    )
    return {"message": "Controller updated"}


@router.delete("/unifi/controllers/{controller_id}")
async def delete_controller(controller_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "delete")
    controller = await _get_controller(controller_id, current_user, "unifi.controller.delete")
    result = await db.unifi_controllers.delete_one(_controller_write_query(controller))
    if not getattr(result, "deleted_count", 0):
        raise HTTPException(status_code=409, detail="Controller changed while it was being deleted; retry")
    await _audit_controller(current_user, "unifi.controller.deleted", controller)
    return {"message": "Controller removed"}


@router.get("/unifi/controllers/{controller_id}/test")
async def test_controller(controller_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "edit")
    controller = await _get_controller(controller_id, current_user, "unifi.controller.test")
    now = _now()
    try:
        sites = _data(await _net_call(controller, "GET", "sites"))
        await db.unifi_controllers.update_one(
            _controller_write_query(controller),
            {"$set": {"last_test_status": "ok", "last_tested_at": now}},
        )
        await _audit_controller(current_user, "unifi.controller.tested", controller, details={"success": True, "site_count": len(sites)})
        return {"success": True, "message": f"Connected · {len(sites)} site(s) on this controller", "sites": _public_provider_value(sites)}
    except HTTPException as error:
        await db.unifi_controllers.update_one(
            _controller_write_query(controller),
            {"$set": {"last_test_status": f"fail:{error.status_code}", "last_tested_at": now}},
        )
        await _audit_controller(current_user, "unifi.controller.tested", controller, details={"success": False, "status": error.status_code})
        return {"success": False, "message": str(error.detail), "status": error.status_code}


# ─────────────────────────── Data passthrough ───────────────────────────


def _norm_net_device(device: dict[str, Any]) -> dict[str, Any]:
    state = device.get("state") or device.get("status") or "unknown"
    return {
        "id": str(device.get("id") or device.get("_id") or device.get("mac") or ""),
        "mac": device.get("macAddress") or device.get("mac") or "",
        "name": device.get("name") or device.get("model") or "",
        "model": device.get("model") or "",
        "type": device.get("type") or device.get("productLine") or "",
        "status": str(state).lower(),
        "ip": device.get("ipAddress") or device.get("ip") or "",
        "uptime": device.get("uptime") or 0,
        "firmware": device.get("firmwareVersion") or device.get("version") or "",
        "adopted": device.get("adopted", True) if "adopted" in device else True,
        "features": _public_provider_value(device.get("features") or {}),
    }


def _norm_net_client(client: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(client.get("id") or client.get("_id") or client.get("mac") or ""),
        "mac": client.get("macAddress") or client.get("mac") or "",
        "name": client.get("name") or client.get("hostname") or "",
        "ip": client.get("ipAddress") or client.get("ip") or "",
        "is_wired": not bool(client.get("isWireless", False)) if "isWireless" in client else bool(client.get("is_wired")),
        "network": client.get("connectedNetwork") or client.get("essid") or "",
        "uplink_mac": client.get("uplinkMac") or client.get("ap_mac") or "",
        "rx_bytes": client.get("rxBytes") or 0,
        "tx_bytes": client.get("txBytes") or 0,
        "signal": client.get("signalDbm") or client.get("rssi") or 0,
        "last_seen": client.get("lastSeen") or "",
        "manufacturer": client.get("manufacturer") or client.get("oui") or "",
    }


@router.get("/unifi/controllers/{controller_id}/devices")
async def get_devices(controller_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    controller = await _get_controller(controller_id, current_user, "unifi.controller.devices.read")
    raw = await _net_call(controller, "GET", f"sites/{_controller_site_id(controller)}/devices")
    return [_norm_net_device(device) for device in _data(raw)]


@router.get("/unifi/controllers/{controller_id}/clients")
async def get_clients(controller_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    controller = await _get_controller(controller_id, current_user, "unifi.controller.clients.read")
    raw = await _net_call(controller, "GET", f"sites/{_controller_site_id(controller)}/clients")
    return [_norm_net_client(item) for item in _data(raw)]


@router.get("/unifi/controllers/{controller_id}/sites")
async def get_network_sites(controller_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    controller = await _get_controller(controller_id, current_user, "unifi.controller.sites.read")
    return _public_provider_value(_data(await _net_call(controller, "GET", "sites")))


@router.get("/unifi/controllers/{controller_id}/summary")
async def controller_summary(controller_id: str, current_user: dict = Depends(get_current_user)):
    await require_module_permission(current_user, "networking", "view")
    controller = await _get_controller(controller_id, current_user, "unifi.controller.summary.read")
    site_id = _controller_site_id(controller)
    devices: list[dict[str, Any]] = []
    clients: list[dict[str, Any]] = []
    error: str | None = None
    try:
        devices = [_norm_net_device(item) for item in _data(await _net_call(controller, "GET", f"sites/{site_id}/devices"))]
    except HTTPException as exc:
        error = str(exc.detail)
    try:
        clients = [_norm_net_client(item) for item in _data(await _net_call(controller, "GET", f"sites/{site_id}/clients"))]
    except HTTPException as exc:
        error = error or str(exc.detail)
    now = _now()
    await db.unifi_controllers.update_one(
        _controller_write_query(controller),
        {"$set": {"last_synced_at": now}},
    )
    return {
        "controller": {
            "id": controller["id"],
            "name": controller.get("name") or "",
            "controller_url": _public_controller_url(controller.get("controller_url")),
            "network_site_id": site_id,
        },
        "stats": {
            "devices": len(devices),
            "devices_online": sum(1 for device in devices if device["status"] in ("online", "connected")),
            "clients": len(clients),
            "wifi_clients": sum(1 for client in clients if not client["is_wired"]),
            "wired_clients": sum(1 for client in clients if client["is_wired"]),
        },
        "devices": devices,
        "clients": clients,
        "last_synced_at": now,
        "error": error,
    }


# ─────────────────────────── Actions ───────────────────────────


async def _device_action(controller: dict[str, Any], encoded_device_id: str, action: str, extra: Optional[dict[str, Any]] = None):
    body: dict[str, Any] = {"action": action}
    if extra:
        body.update(extra)
    return await _net_call(
        controller,
        "POST",
        f"sites/{_controller_site_id(controller)}/devices/{encoded_device_id}/actions",
        json_body=body,
    )


async def _run_device_action(
    controller_id: str,
    device_id: str,
    action: str,
    current_user: dict[str, Any],
    *,
    extra: dict[str, Any] | None = None,
    success_message: str,
) -> dict[str, Any]:
    await require_module_permission(current_user, "networking", "edit")
    controller = await _get_controller(controller_id, current_user, f"unifi.controller.device.{action.lower()}")
    normalised_device_id = _normalise_device_id(device_id)
    try:
        await _device_action(controller, normalised_device_id, action, extra)
        await _record_device_action(
            current_user,
            controller,
            device_id=normalised_device_id,
            action=action,
            success=True,
            extra=extra,
        )
        return {"success": True, "message": success_message}
    except HTTPException as error:
        await _record_device_action(
            current_user,
            controller,
            device_id=normalised_device_id,
            action=action,
            success=False,
            extra=extra,
        )
        return {"success": False, "message": str(error.detail), "status": error.status_code}


@router.post("/unifi/controllers/{controller_id}/devices/{device_id}/restart")
async def device_restart(controller_id: str, device_id: str, current_user: dict = Depends(get_current_user)):
    return await _run_device_action(
        controller_id,
        device_id,
        "RESTART",
        current_user,
        success_message="Restart issued",
    )


@router.post("/unifi/controllers/{controller_id}/devices/{device_id}/locate")
async def device_locate(
    controller_id: str,
    device_id: str,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    enable = bool(_payload(data).get("enable", True))
    return await _run_device_action(
        controller_id,
        device_id,
        "LOCATE" if enable else "LOCATE_STOP",
        current_user,
        success_message=f"Locate {'on' if enable else 'off'}",
    )


@router.post("/unifi/controllers/{controller_id}/devices/{device_id}/power-cycle")
async def device_power_cycle(
    controller_id: str,
    device_id: str,
    data: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    payload = _payload(data)
    extra: dict[str, Any] = {}
    if payload.get("port_idx") is not None:
        try:
            port_index = int(payload["port_idx"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Port index must be a whole number") from None
        if port_index < 0 or port_index > 255:
            raise HTTPException(status_code=422, detail="Port index is out of range")
        extra["portIdx"] = port_index
    return await _run_device_action(
        controller_id,
        device_id,
        "POWER_CYCLE",
        current_user,
        extra=extra,
        success_message="Power-cycle issued",
    )
