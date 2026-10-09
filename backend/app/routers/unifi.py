"""
UniFi Site Manager API integration (api.ui.com).

API REFERENCE: https://developer.ui.com/
Auth: X-API-KEY header.

Available endpoints (read-only on Site Manager):
  GET /v1/hosts                       — list UniFi consoles
  GET /v1/hosts/{hostId}              — host details
  GET /v1/sites                       — list sites (with rich `statistics.counts`)
  GET /v1/devices?hostIds[]=<id>      — list devices grouped by host
  GET /v1/isps                        — ISP info (where supported)

Default base is /v1 (stable, 10000 req/min). /ea is Early Access (100 req/min).

Note: Per-site clients/networks/alerts are NOT exposed by the Site Manager API.
We surface client/device counts from the site's `statistics.counts` instead.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional, Any
import httpx
from urllib.parse import quote
import uuid
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.database import db
from app.auth import get_current_user
from app.services.module_permissions import require_module_permission
from app.services.scope_permissions import assert_global_scope
from app.services.secret_store import decrypt_secret, encrypt_secret

router = APIRouter()

SETTINGS_KEY = "unifi"
DEFAULT_BASE_URL = "https://api.ui.com/v1"
SITE_MANAGER_KEY_FIELD = "site_manager_api_key_encrypted"
SITE_MANAGER_BASE_URL_FIELD = "site_manager_base_url"
SITE_MANAGER_PREVIEW_FIELD = "site_manager_api_key_preview"
SITE_MANAGER_TENANT_FIELD = "site_manager_tenant_id"
SITE_MANAGER_ALLOWED_BASE_URLS = frozenset({"https://api.ui.com/v1", "https://api.ui.com/ea"})


from app.services.time_utils import now_iso as _now


def _payload(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


from app.services.identity_utils import tenant_id_or_none as _tenant_id


def _tenant_scoped_query(current_user: dict, query: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fail closed for tenant-bound actors while retaining legacy system mode."""
    scoped = dict(query or {})
    actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
    if actor_tenant_id:
        scoped["tenant_id"] = actor_tenant_id
    return scoped


def _site_manager_settings_write_query(current_user: dict) -> dict[str, Any]:
    actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
    if not actor_tenant_id:
        return {"type": SETTINGS_KEY}
    return {
        "$and": [
            {"type": SETTINGS_KEY},
            {
                "$or": [
                    {SITE_MANAGER_TENANT_FIELD: actor_tenant_id},
                    {SITE_MANAGER_TENANT_FIELD: {"$exists": False}},
                    {SITE_MANAGER_TENANT_FIELD: None},
                    {SITE_MANAGER_TENANT_FIELD: ""},
                ]
            },
        ]
    }


async def _record_tenant_scope_denial(current_user: dict, operation: str, *, client_id: str | None = None) -> None:
    await db.scope_denials.insert_one({
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "role": current_user.get("role"),
        "tenant_id": current_user.get("tenant_id"),
        "client_id": client_id,
        "operation": operation,
        "occurred_at": _now(),
    })


def _has_site_manager_state(config: dict[str, Any] | None) -> bool:
    return bool(
        (config or {}).get(SITE_MANAGER_TENANT_FIELD)
        or (config or {}).get(SITE_MANAGER_KEY_FIELD)
        or (config or {}).get("api_key_full")
        or (config or {}).get("site_manager_configured")
    )


async def _assert_site_manager_configuration_scope(
    current_user: dict,
    operation: str,
    *,
    allow_unbound_configuration: bool = False,
) -> None:
    """Enforce a tenant-owned Site Manager configuration without read-time claims."""
    actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
    if not actor_tenant_id:
        return

    config = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0, SITE_MANAGER_TENANT_FIELD: 1})
    if not config:
        return
    # A direct-controller-only settings record is not Site Manager state.  A
    # read-only status check must never claim it and block another tenant from
    # completing the first Site Manager setup.
    full_config = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not _has_site_manager_state(full_config):
        return
    owner_tenant_id = _tenant_id(config.get(SITE_MANAGER_TENANT_FIELD))
    if owner_tenant_id == actor_tenant_id:
        return
    if owner_tenant_id:
        await _record_tenant_scope_denial(current_user, operation)
        raise HTTPException(status_code=404, detail="UniFi Site Manager configuration not found")

    if allow_unbound_configuration:
        return
    raise HTTPException(
        status_code=409,
        detail="UniFi Site Manager credentials must be re-saved to bind this legacy configuration to your tenant",
    )


def _normalise_site_manager_base_url(value: object) -> str:
    """Site Manager is a public Ubiquiti API, never an arbitrary proxy target."""
    base_url = str(value or DEFAULT_BASE_URL).strip().rstrip("/") or DEFAULT_BASE_URL
    if base_url not in SITE_MANAGER_ALLOWED_BASE_URLS:
        raise HTTPException(
            status_code=422,
            detail="Site Manager URL must be https://api.ui.com/v1 or https://api.ui.com/ea",
        )
    return base_url


async def _require_site_manager(current_user: dict, permission: str, operation: str) -> None:
    await require_module_permission(current_user, "networking", permission)
    # Site Manager currently exposes MSP-wide cloud inventory.  It must remain
    # global-only until a verified Nexus client-to-provider-site map exists.
    await assert_global_scope(current_user, operation=operation)
    await _assert_site_manager_configuration_scope(
        current_user,
        operation,
        allow_unbound_configuration=operation in {
            "unifi.site_manager.settings.read",
            "unifi.site_manager.settings.update",
        },
    )


async def _audit_site_manager(current_user: dict, operation: str, details: dict[str, Any] | None = None) -> None:
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "actor_id": current_user.get("id"),
        "actor_name": current_user.get("name"),
        "operation": operation,
        "entity_type": "unifi_site_manager",
        "entity_id": SETTINGS_KEY,
        "tenant_id": current_user.get("tenant_id"),
        "details": details or {},
        "created_at": _now(),
    })


def _site_manager_api_key(config: dict) -> str:
    key = decrypt_secret(str(config.get(SITE_MANAGER_KEY_FIELD) or ""))
    if not key:
        raise HTTPException(status_code=503, detail="UniFi Site Manager is not configured")
    return key


def _site_manager_api_key_preview(api_key: str) -> str:
    """Expose only a non-sensitive configuration hint to global operators."""
    return f"...{api_key[-4:]}" if len(api_key) >= 8 else "configured"


async def _get_site_manager_client(client_id: str, current_user: dict, operation: str) -> dict:
    """Load a client through the actor's tenant boundary and mask foreign IDs."""
    client = await db.clients.find_one(_tenant_scoped_query(current_user, {"id": str(client_id)}), {"_id": 0})
    if client:
        return client
    if _tenant_id(current_user.get("tenant_id")):
        await _record_tenant_scope_denial(current_user, operation, client_id=str(client_id))
    raise HTTPException(status_code=404, detail="Client not found")


async def _ensure_unique_unifi_site_link_index() -> None:
    """Make the one-provider-site-to-one-Nexus-client invariant database-enforced."""
    try:
        await db.clients.create_index(
            [("unifi_site_id", ASCENDING)],
            name="unique_unifi_site_link",
            unique=True,
            partialFilterExpression={"unifi_site_id": {"$exists": True, "$gt": ""}},
        )
    except (DuplicateKeyError, OperationFailure):
        raise HTTPException(
            status_code=409,
            detail="Existing UniFi site links must be de-duplicated before another site can be linked",
        ) from None


async def _get_config(*, migrate_legacy: bool = True) -> Optional[dict]:
    cfg = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not cfg:
        return None
    if not migrate_legacy and not _tenant_id(cfg.get(SITE_MANAGER_TENANT_FIELD)):
        return None
    if decrypt_secret(str(cfg.get(SITE_MANAGER_KEY_FIELD) or "")):
        return cfg

    # Migrate the previous plaintext Site Manager credential lazily.  This is
    # called only after the route has enforced global operator access.
    legacy_key = str(cfg.get("api_key_full") or "").strip()
    if not legacy_key:
        return None
    migrated_base_url = _normalise_site_manager_base_url(cfg.get("base_url") or DEFAULT_BASE_URL)
    encrypted_key = encrypt_secret(legacy_key)
    preview = _site_manager_api_key_preview(legacy_key)
    result = await db.settings.update_one(
        {"type": SETTINGS_KEY, "api_key_full": legacy_key},
        {
            "$set": {
                SITE_MANAGER_KEY_FIELD: encrypted_key,
                SITE_MANAGER_BASE_URL_FIELD: migrated_base_url,
                SITE_MANAGER_PREVIEW_FIELD: preview,
                "site_manager_configured": True,
                "site_manager_migrated_at": _now(),
            },
            "$unset": {"api_key_full": "", "base_url": ""},
        },
    )
    if getattr(result, "matched_count", 0):
        cfg.pop("api_key_full", None)
        cfg.pop("base_url", None)
        cfg[SITE_MANAGER_KEY_FIELD] = encrypted_key
        cfg[SITE_MANAGER_BASE_URL_FIELD] = migrated_base_url
        cfg[SITE_MANAGER_PREVIEW_FIELD] = preview
        return cfg
    refreshed = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    return refreshed if refreshed and decrypt_secret(str(refreshed.get(SITE_MANAGER_KEY_FIELD) or "")) else None


async def _unifi_call(method: str, path: str, params=None, json_body: Optional[dict] = None):
    """params can be a dict OR a list of (key, value) tuples to preserve `hostIds[]` literal brackets."""
    cfg = await _get_config()
    if not cfg:
        raise HTTPException(503, "UniFi not configured")
    base = _normalise_site_manager_base_url(cfg.get(SITE_MANAGER_BASE_URL_FIELD) or DEFAULT_BASE_URL)
    url = f"{base}/{path.lstrip('/')}"
    headers = {
        "X-API-KEY": _site_manager_api_key(cfg),
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=30, verify=True, follow_redirects=False) as client:
            r = await client.request(method, url, headers=headers, params=params, json=json_body)
            if r.status_code in (401, 403):
                raise HTTPException(403, "UniFi Site Manager authentication or permission failed")
            if r.status_code in (404, 405, 501):
                raise HTTPException(502, "UniFi endpoint is unavailable for this account")
            if r.status_code == 429:
                raise HTTPException(429, "UniFi rate limit hit — wait and retry")
            if r.status_code >= 400:
                raise HTTPException(502, "UniFi Site Manager request failed")
            try:
                return r.json()
            except (ValueError, TypeError):
                return {}
    except HTTPException:
        raise
    except httpx.HTTPError:
        raise HTTPException(502, "Cannot reach UniFi Site Manager") from None


def _data(resp: Any) -> list:
    """Site Manager API wraps everything in `{data: [...], httpStatusCode, traceId, nextToken}`."""
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        d = resp.get("data")
        if isinstance(d, list):
            return d
    return []


def _provider_identifier(value: object, label: str) -> str:
    identifier = str(value or "").strip()
    if not identifier or len(identifier) > 255:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    return quote(identifier, safe="")


_SENSITIVE_PROVIDER_FIELDS = frozenset({
    "api_key", "apikey", "apiKey", "authorization", "token", "secret", "password", "credentials",
})
_LEGACY_ACTION_RESPONSE_FIELDS = frozenset({
    "result", "response", "provider_response", "raw_response", "provider_result", "error",
})


def _public_provider_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_public_provider_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    sensitive_fields = {field.lower() for field in _SENSITIVE_PROVIDER_FIELDS}
    return {
        key: _public_provider_value(item)
        for key, item in value.items()
        if str(key).lower() not in sensitive_fields
    }


def _public_unifi_action(action: dict[str, Any]) -> dict[str, Any]:
    """Historic action rows can contain raw provider results; never return them."""
    public = _public_provider_value(action)
    for field in _LEGACY_ACTION_RESPONSE_FIELDS:
        public.pop(field, None)
    return public


# ─────────────────────────── Settings ───────────────────────────

@router.get("/unifi/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "view", "unifi.site_manager.settings.read")
    raw_config = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    actor_has_tenant = bool(_tenant_id(current_user.get("tenant_id")))
    migration_required = bool(
        actor_has_tenant
        and _has_site_manager_state(raw_config)
        and not _tenant_id((raw_config or {}).get(SITE_MANAGER_TENANT_FIELD))
    )
    cfg = await _get_config(migrate_legacy=not actor_has_tenant)
    if not cfg:
        return {
            "configured": False,
            "migration_required": migration_required,
            "base_url": DEFAULT_BASE_URL,
            "api_key_preview": None,
            "last_test_status": None,
            "last_tested_at": None,
            "last_synced_at": None,
        }
    return {
        "configured": bool(decrypt_secret(str(cfg.get(SITE_MANAGER_KEY_FIELD) or ""))),
        "migration_required": False,
        "base_url": cfg.get(SITE_MANAGER_BASE_URL_FIELD) or DEFAULT_BASE_URL,
        "api_key_preview": cfg.get(SITE_MANAGER_PREVIEW_FIELD),
        "last_test_status": cfg.get("site_manager_last_test_status"),
        "last_tested_at": cfg.get("site_manager_last_tested_at"),
        "last_synced_at": cfg.get("site_manager_last_synced_at"),
    }


@router.get("/unifi/status")
async def get_status(current_user: dict = Depends(get_current_user)):
    return await get_settings(current_user)


@router.post("/unifi/settings")
async def save_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "edit", "unifi.site_manager.settings.update")
    payload = _payload(data)
    api_key = str(payload.get("api_key") or "").strip()
    base_url = _normalise_site_manager_base_url(payload.get("base_url") or DEFAULT_BASE_URL)
    if not api_key:
        raise HTTPException(422, "api_key required")
    preview = _site_manager_api_key_preview(api_key)
    settings_update = {
        "type": SETTINGS_KEY,
        SITE_MANAGER_KEY_FIELD: encrypt_secret(api_key),
        SITE_MANAGER_PREVIEW_FIELD: preview,
        SITE_MANAGER_BASE_URL_FIELD: base_url,
        "site_manager_configured": True,
        "site_manager_updated_at": _now(),
        "site_manager_updated_by": current_user.get("name"),
    }
    actor_tenant_id = _tenant_id(current_user.get("tenant_id"))
    if actor_tenant_id:
        settings_update[SITE_MANAGER_TENANT_FIELD] = actor_tenant_id

    existing = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0, SITE_MANAGER_TENANT_FIELD: 1})
    result = await db.settings.update_one(
        _site_manager_settings_write_query(current_user) if existing else {"type": SETTINGS_KEY},
        {
            "$set": settings_update,
            "$unset": {"api_key_full": "", "base_url": "", "api_key_preview": ""},
        },
        upsert=not bool(existing),
    )
    if existing and not getattr(result, "matched_count", 0):
        await _record_tenant_scope_denial(current_user, "unifi.site_manager.settings.update")
        raise HTTPException(status_code=409, detail="UniFi Site Manager configuration changed; retry")
    await _audit_site_manager(current_user, "unifi.site_manager.settings_updated")
    return {"message": "UniFi settings saved"}


@router.delete("/unifi/settings")
async def delete_settings(current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "delete", "unifi.site_manager.settings.delete")
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {
            "$unset": {
                SITE_MANAGER_KEY_FIELD: "",
                SITE_MANAGER_BASE_URL_FIELD: "",
                SITE_MANAGER_PREVIEW_FIELD: "",
                "site_manager_configured": "",
                "site_manager_last_test_status": "",
                "site_manager_last_tested_at": "",
                "site_manager_last_synced_at": "",
                "site_manager_updated_at": "",
                "site_manager_updated_by": "",
                SITE_MANAGER_TENANT_FIELD: "",
                "site_manager_tenant_bound_at": "",
                "api_key_full": "",
                "api_key_preview": "",
                "base_url": "",
            }
        },
    )
    await _audit_site_manager(current_user, "unifi.site_manager.settings_deleted")
    return {"message": "UniFi credentials removed"}


@router.get("/unifi/test")
async def test_connection(current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "edit", "unifi.site_manager.test")
    cfg = await _get_config()
    if not cfg:
        return {"success": False, "message": "Not configured"}
    now = datetime.now(timezone.utc).isoformat()
    try:
        data = await _unifi_call("GET", "hosts")
        hosts = _data(data)
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"site_manager_last_test_status": "ok", "site_manager_last_tested_at": now}},
        )
        await _audit_site_manager(current_user, "unifi.site_manager.tested", {"success": True, "host_count": len(hosts)})
        return {"success": True, "message": f"Connected · {len(hosts)} host(s) visible"}
    except HTTPException as e:
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"site_manager_last_test_status": f"fail:{e.status_code}", "site_manager_last_tested_at": now}},
        )
        await _audit_site_manager(current_user, "unifi.site_manager.tested", {"success": False, "status": e.status_code})
        return {"success": False, "message": str(e.detail)[:200]}


# ─────────────────────────── Normalization ───────────────────────────

def _norm_site(s: dict) -> dict:
    meta = s.get("meta") or {}
    stats = (s.get("statistics") or {}).get("counts") or {}
    counts = {
        "total_devices": stats.get("totalDevice", 0),
        "offline_devices": stats.get("offlineDevice", 0),
        "pending_devices": stats.get("pendingDevice", 0),
        "wlan_configured": stats.get("wlanConfigured", 0),
        "lan_configured": stats.get("lanConfigured", 0),
        "guest_clients": stats.get("guestClient", 0),
        "wifi_clients": stats.get("wifiClient", 0),
        "wired_clients": stats.get("wiredClient", 0),
        "critical_notifications": stats.get("criticalNotification", 0),
    }
    online = max(counts["total_devices"] - counts["offline_devices"], 0)
    total_clients = counts["wifi_clients"] + counts["wired_clients"] + counts["guest_clients"]
    internet = _public_provider_value((s.get("statistics") or {}).get("internet") or {})
    return {
        "id": str(s.get("id") or s.get("siteId") or ""),
        "name": meta.get("desc") or meta.get("name") or s.get("internalReference") or s.get("id") or "",
        "internal_name": meta.get("name") or s.get("internalReference") or "",
        "host_id": s.get("hostId") or "",
        "is_owner": s.get("isOwner", False),
        "permission": s.get("permission") or "",
        "timezone": meta.get("timezone") or "",
        "gateway_mac": meta.get("gatewayMac") or "",
        "counts": counts,
        "devices_total": counts["total_devices"],
        "devices_online": online,
        "clients_total": total_clients,
        "alerts": counts["critical_notifications"],
        "internet": internet,
    }


def _norm_device(d: dict, host_id: str = "") -> dict:
    """Devices come from /v1/devices grouped under each host's `devices` array."""
    state = d.get("status") or d.get("state")
    if isinstance(state, int):
        state = "online" if state == 1 else "offline"
    if not state:
        # Some shapes use `connectionState`
        cs = d.get("connectionState") or {}
        state = cs.get("state") or "unknown"
    uptime = d.get("uptimeSec") or d.get("uptime") or 0
    return {
        "id": str(d.get("id") or d.get("_id") or d.get("mac") or ""),
        "mac": d.get("mac") or "",
        "name": d.get("name") or d.get("shortname") or d.get("model") or "",
        "model": d.get("model") or d.get("shortname") or d.get("productLine") or "",
        "type": d.get("productLine") or d.get("type") or "",
        "shortname": d.get("shortname") or "",
        "status": str(state).lower(),
        "ip": d.get("ip") or d.get("ipAddress") or "",
        "uptime": uptime,
        "firmware": d.get("version") or d.get("firmwareVersion") or "",
        "firmware_status": d.get("firmwareStatus") or "",
        "adopted": d.get("adopted", True) if "adopted" in d else True,
        "is_console": bool(d.get("isConsole", False)),
        "host_id": host_id or d.get("hostId") or "",
        "site_id": str(d.get("siteId") or ""),
        "startup_time": d.get("startupTime") or "",
        "note": d.get("note") or "",
    }


# ─────────────────────────── Data endpoints ───────────────────────────

@router.get("/unifi/hosts")
async def list_hosts(current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "view", "unifi.site_manager.hosts.read")
    data = await _unifi_call("GET", "hosts")
    return _public_provider_value(_data(data))


@router.get("/unifi/sites")
async def list_sites(current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "view", "unifi.site_manager.sites.read")
    items = await _unifi_paged("sites")
    return [_norm_site(s) for s in items]


async def _unifi_paged(path: str, params=None) -> list:
    """GET path, follow nextToken pagination, return concatenated `data` arrays."""
    out = []
    base_params = list(params) if isinstance(params, list) else (list(params.items()) if isinstance(params, dict) else [])
    base_params.append(("pageSize", "500"))
    page_params = list(base_params)
    for _ in range(20):  # hard cap at 20 pages = 10k items
        raw = await _unifi_call("GET", path, params=page_params)
        items = _data(raw)
        out.extend(items)
        next_token = raw.get("nextToken") if isinstance(raw, dict) else None
        if not next_token:
            break
        page_params = list(base_params) + [("nextToken", next_token)]
    return out


async def _fetch_devices_for_host(host_id: str = "") -> list:
    """The /v1/devices response is grouped per host: [{hostId, devices: [...]}]
    OR sometimes flat. We always paginate, and we always look at every host group."""
    out = []

    def _ingest_items(items):
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("devices"), list):
                gid = item.get("hostId") or host_id
                for dev in item["devices"]:
                    out.append(_norm_device(dev, host_id=gid))
            elif isinstance(item, dict):
                out.append(_norm_device(item, host_id=item.get("hostId") or host_id))

    # 1) Try host-filtered call first
    if host_id:
        try:
            raw_host_id = str(host_id).strip()
            _provider_identifier(raw_host_id, "Host ID")
            items = await _unifi_paged("devices", params=[("hostIds[]", raw_host_id)])
            _ingest_items(items)
        except HTTPException:
            pass

    # 2) ALWAYS also fetch unfiltered if filtered call returned nothing
    if not out:
        try:
            items = await _unifi_paged("devices")
            _ingest_items(items)
            if host_id:
                # Filter to this host
                filtered = [d for d in out if not d.get("host_id") or str(d["host_id"]) == str(host_id)]
                if filtered:
                    out = filtered
        except HTTPException:
            pass
    return out


@router.get("/unifi/sites/{site_id}/devices")
async def list_site_devices(site_id: str, current_user: dict = Depends(get_current_user)):
    """Look up the host owning this site, fetch devices, then filter by site if available.
    Site Manager API doesn't always expose siteId on the device payload — when missing, we
    return all of the host's devices (better than returning empty)."""
    await _require_site_manager(current_user, "view", "unifi.site_manager.site_devices.read")
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    host_id = target.get("hostId") or ""
    all_devs = await _fetch_devices_for_host(host_id)
    # Soft filter: if any device is tagged with this site, only return matches; otherwise return all
    tagged = [d for d in all_devs if str(d.get("site_id") or "") == str(site_id)]
    return tagged if tagged else all_devs


@router.get("/unifi/devices")
async def list_all_devices(current_user: dict = Depends(get_current_user)):
    """All devices visible to the API key — useful when Site Manager doesn't expose site->device mapping."""
    await _require_site_manager(current_user, "view", "unifi.site_manager.devices.read")
    return await _fetch_devices_for_host("")


@router.get("/unifi/hosts/{host_id}/devices")
async def list_host_devices(host_id: str, current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "view", "unifi.site_manager.host_devices.read")
    _provider_identifier(host_id, "Host ID")
    return await _fetch_devices_for_host(host_id)


@router.get("/unifi/sites/{site_id}/clients")
async def list_site_clients(site_id: str, current_user: dict = Depends(get_current_user)):
    """Site Manager API does not expose individual client objects. Return aggregate counts from site stats."""
    await _require_site_manager(current_user, "view", "unifi.site_manager.site_clients.read")
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    counts = (target.get("statistics") or {}).get("counts") or {}
    summary = {
        "wifi": counts.get("wifiClient", 0),
        "wired": counts.get("wiredClient", 0),
        "guest": counts.get("guestClient", 0),
        "total": counts.get("wifiClient", 0) + counts.get("wiredClient", 0) + counts.get("guestClient", 0),
    }
    return {
        "supported": False,
        "summary": summary,
        "message": "Per-client detail is not exposed by the UniFi Site Manager API. Aggregate counts shown.",
        "items": [],
    }


@router.get("/unifi/sites/{site_id}/networks")
async def list_site_networks(site_id: str, current_user: dict = Depends(get_current_user)):
    """SSIDs are not enumerated by the Site Manager API. Return wlan/lan counts."""
    await _require_site_manager(current_user, "view", "unifi.site_manager.site_networks.read")
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    counts = (target.get("statistics") or {}).get("counts") or {}
    return {
        "supported": False,
        "summary": {
            "wlan_configured": counts.get("wlanConfigured", 0),
            "lan_configured": counts.get("lanConfigured", 0),
        },
        "message": "Detailed SSID/VLAN list is only available from the on-controller Network API. Counts shown.",
        "items": [],
    }


@router.get("/unifi/sites/{site_id}/alerts")
async def list_site_alerts(site_id: str, current_user: dict = Depends(get_current_user)):
    """Site Manager API exposes only critical notification counts, not individual alerts."""
    await _require_site_manager(current_user, "view", "unifi.site_manager.site_alerts.read")
    sites = _data(await _unifi_call("GET", "sites"))
    target = next((s for s in sites if str(s.get("id")) == str(site_id)), None)
    if not target:
        raise HTTPException(404, "Site not found")
    counts = (target.get("statistics") or {}).get("counts") or {}
    critical = counts.get("criticalNotification", 0)
    return {
        "supported": False,
        "summary": {"critical_notifications": critical},
        "message": "Individual alert objects are not exposed by the Site Manager API. Counts shown.",
        "items": [],
    }


# ─────────────────────────── Summary / dashboard ───────────────────────────

@router.get("/unifi/summary")
async def unifi_summary(current_user: dict = Depends(get_current_user)):
    """Aggregated summary across every site visible to the API key — no extra API calls beyond /sites."""
    await _require_site_manager(current_user, "view", "unifi.site_manager.summary.read")
    cfg = await _get_config()
    if not cfg:
        return {"configured": False, "message": "UniFi not configured"}

    try:
        sites_raw = await _unifi_call("GET", "sites")
        sites = [_norm_site(s) for s in _data(sites_raw)]
    except HTTPException as e:
        return {"configured": True, "error": str(e.detail)[:200], "sites": []}

    total_devices = sum(s["devices_total"] for s in sites)
    online_devices = sum(s["devices_online"] for s in sites)
    total_clients = sum(s["clients_total"] for s in sites)
    total_alerts = sum(s["alerts"] for s in sites)

    site_rows = [{
        "id": s["id"],
        "name": s["name"],
        "host_id": s["host_id"],
        "devices": s["devices_total"],
        "devices_online": s["devices_online"],
        "clients": s["clients_total"],
        "alerts": s["alerts"],
    } for s in sites]
    # Sort: most devices first
    site_rows.sort(key=lambda x: x["devices"], reverse=True)

    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {"site_manager_last_synced_at": now}},
    )

    # Cache is derived operational data.  A provider site can contribute to a
    # client only after Nexus has a verified client-to-provider-site link.
    client_link_query = _tenant_scoped_query(
        current_user,
        {"unifi_site_id": {"$exists": True, "$ne": ""}},
    )
    linked_clients = await db.clients.find(
        client_link_query,
        {"_id": 0, "id": 1, "tenant_id": 1, "unifi_site_id": 1},
    ).to_list(10000)
    links_by_site = {str(client["unifi_site_id"]): client for client in linked_clients if client.get("id")}
    for s in sites:
        linked_client = links_by_site.get(str(s["id"]))
        if not linked_client:
            continue
        await db.unifi_site_cache.update_one(
            {"site_id": s["id"], "client_id": linked_client["id"]},
            {"$set": {
                "site_id": s["id"],
                "client_id": linked_client["id"],
                "tenant_id": linked_client.get("tenant_id"),
                "host_id": s["host_id"],
                "name": s["name"],
                "devices_total": s["devices_total"],
                "devices_online": s["devices_online"],
                "clients_total": s["clients_total"],
                "alerts": s["alerts"],
                "cached_at": now,
            }},
            upsert=True,
        )

    linked = await db.clients.count_documents(client_link_query)
    total_clients_nx = await db.clients.count_documents(_tenant_scoped_query(current_user))

    return {
        "configured": True,
        "last_synced_at": now,
        "stats": {
            "sites": len(sites),
            "devices": total_devices,
            "devices_online": online_devices,
            "clients": total_clients,
            "alerts": total_alerts,
            "linked_clients": linked,
            "coverage_pct": round((linked / total_clients_nx) * 100, 1) if total_clients_nx else 0,
        },
        "sites": site_rows,
    }


# ─────────────────────────── Device actions (restart / locate / power-cycle) ───────────────────────────
# The UniFi Site Manager API is officially read-only today. Ubiquiti has begun rolling out
# write endpoints — these handlers attempt the action and surface a clear message if your
# API key lacks write access yet. Track availability at https://unifi.ui.com/api.

async def _device_action(host_id: str, device_id: str, action: str, body: Optional[dict] = None):
    """Try several known endpoint shapes; return the first success or raise.
    Known shapes (varies by EA cohort):
      POST /v1/hosts/{hostId}/devices/{deviceId}/actions  body {action}
      POST /v1/devices/{deviceId}/actions                 body {action, hostId}
      POST /v1/devices/{deviceId}/{action}                no body
    """
    raw_host_id = str(host_id or "").strip()
    encoded_device_id = _provider_identifier(device_id, "Device ID")
    encoded_host_id = _provider_identifier(raw_host_id, "Host ID") if raw_host_id else ""
    payload = {"action": action}
    if body:
        payload.update(body)
    candidates = []
    if encoded_host_id:
        candidates.append(("POST", f"hosts/{encoded_host_id}/devices/{encoded_device_id}/actions", payload))
    candidates.extend([
        ("POST", f"devices/{encoded_device_id}/actions", {**payload, **({"hostId": raw_host_id} if raw_host_id else {})}),
        ("POST", f"devices/{encoded_device_id}/{action}", None),
    ])
    last_err = None
    for method, path, p in candidates:
        try:
            return await _unifi_call(method, path, json_body=p)
        except HTTPException as e:
            last_err = e
            if e.status_code in (401, 403):
                raise  # auth/permission won't fix by trying another path
            continue
    raise last_err or HTTPException(501, "No supported action endpoint on this UniFi account")


async def _record_action(
    current_user: dict,
    *,
    action: str,
    device_id: str,
    host_id: str,
    success: bool,
    extra: dict[str, Any] | None = None,
) -> None:
    occurred_at = _now()
    await db.unifi_actions.insert_one({
        "id": str(uuid.uuid4()),
        "source": "site_manager",
        "action": action,
        "device_id": device_id,
        "host_id": host_id,
        "success": success,
        "extra": extra or {},
        "actor_id": current_user.get("id"),
        "by": current_user.get("name"),
        "tenant_id": current_user.get("tenant_id"),
        "timestamp": occurred_at,
    })
    await _audit_site_manager(
        current_user,
        f"unifi.site_manager.device_{action}",
        {"device_id": device_id, "host_id": host_id, "success": success, "extra": extra or {}},
    )


async def _run_device_action(
    device_id: str,
    data: dict | None,
    current_user: dict,
    *,
    action: str,
    extra: dict[str, Any] | None = None,
    success_message: str,
) -> dict:
    await _require_site_manager(current_user, "edit", f"unifi.site_manager.device_{action}")
    raw_host_id = str(_payload(data).get("host_id") or "").strip()
    _provider_identifier(device_id, "Device ID")
    if raw_host_id:
        _provider_identifier(raw_host_id, "Host ID")
    try:
        await _device_action(raw_host_id, device_id, action, extra)
        await _record_action(
            current_user,
            action=action,
            device_id=device_id,
            host_id=raw_host_id,
            success=True,
            extra=extra,
        )
        return {"success": True, "message": success_message}
    except HTTPException as error:
        await _record_action(
            current_user,
            action=action,
            device_id=device_id,
            host_id=raw_host_id,
            success=False,
            extra=extra,
        )
        return {"success": False, "message": str(error.detail), "status": error.status_code}


@router.post("/unifi/devices/{device_id}/restart")
async def device_restart(device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    return await _run_device_action(device_id, data, current_user, action="restart", success_message="Restart issued")


@router.post("/unifi/devices/{device_id}/power-cycle")
async def device_power_cycle(device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Power-cycle a PoE port on the device. body: { host_id, port_idx? }"""
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
        device_id,
        data,
        current_user,
        action="power-cycle",
        extra=extra,
        success_message="Power-cycle issued",
    )


@router.post("/unifi/devices/{device_id}/locate")
async def device_locate(device_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    """Toggle the 'locate' LED-blink for the device. body: { host_id, enable?: bool }"""
    enable = bool(_payload(data).get("enable", True))
    action = "locate" if enable else "locate-stop"
    return await _run_device_action(
        device_id,
        data,
        current_user,
        action=action,
        success_message=f"Locate {'on' if enable else 'off'}",
    )


@router.get("/unifi/actions/log")
async def actions_log(current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "view", "unifi.site_manager.actions.read")
    rows = await db.unifi_actions.find(_tenant_scoped_query(current_user), {"_id": 0}).sort("timestamp", -1).to_list(50)
    return [_public_unifi_action(row) for row in rows]


# ─────────────────────────── Debug helpers ───────────────────────────

@router.get("/unifi/_debug/raw")
async def debug_raw(path: str = "devices", current_user: dict = Depends(get_current_user)):
    """Return bounded response metadata without exposing provider payloads."""
    await _require_site_manager(current_user, "edit", "unifi.site_manager.debug.read")
    if path not in ("sites", "devices", "hosts"):
        raise HTTPException(422, "path must be one of: sites, devices, hosts")
    cfg = await _get_config()
    if not cfg:
        return {"configured": False, "message": "UniFi not configured"}
    try:
        raw = await _unifi_call("GET", path, params=[("pageSize", "500")])
        return {
            "configured": True,
            "path": path,
            "data_count": len(_data(raw)),
            "has_next_page": bool(raw.get("nextToken")) if isinstance(raw, dict) else False,
            "trace_id": raw.get("traceId") if isinstance(raw, dict) else None,
            "raw_keys": list(raw.keys()) if isinstance(raw, dict) else None,
        }
    except HTTPException as e:
        return {"configured": True, "path": path, "error": str(e.detail), "status": e.status_code}


@router.get("/unifi/_debug/host-devices")
async def debug_host_devices(host_id: str, current_user: dict = Depends(get_current_user)):
    """Diagnose device discoverability without returning raw provider objects."""
    await _require_site_manager(current_user, "edit", "unifi.site_manager.host_debug.read")
    raw_host_id = str(host_id).strip()
    _provider_identifier(raw_host_id, "Host ID")
    cfg = await _get_config()
    if not cfg:
        return {"configured": False}
    out = {"host_id": raw_host_id, "configured": True}
    try:
        filtered = await _unifi_paged("devices", params=[("hostIds[]", raw_host_id)])
        out["filtered"] = {
            "groups": len(filtered),
            "devices": sum(len(group.get("devices", [])) for group in filtered if isinstance(group, dict)),
        }
    except HTTPException as e:
        out["filtered"] = {"error": str(e.detail), "status": e.status_code}
    try:
        unfiltered = await _unifi_paged("devices")
        match = next((g for g in unfiltered if isinstance(g, dict) and g.get("hostId") == raw_host_id), None)
        out["unfiltered"] = {
            "total_groups": len(unfiltered),
            "matched_group_device_count": len(match.get("devices", [])) if match else 0,
        }
    except HTTPException as e:
        out["unfiltered"] = {"error": str(e.detail), "status": e.status_code}
    return out



@router.post("/clients/{client_id}/link-unifi-site")
async def link_unifi_site(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "edit", "unifi.site_manager.client_link")
    client = await _get_site_manager_client(client_id, current_user, "unifi.site_manager.client_link")
    site_id = str(_payload(data).get("site_id") or "").strip()
    if not site_id:
        raise HTTPException(422, "site_id required")
    _provider_identifier(site_id, "Site ID")
    provider_sites = await _unifi_paged("sites")
    provider_site = next((site for site in provider_sites if str(site.get("id") or site.get("siteId") or "") == site_id), None)
    if not provider_site:
        raise HTTPException(404, "UniFi provider site not found")
    canonical_site_id = str(provider_site.get("id") or provider_site.get("siteId"))
    await _ensure_unique_unifi_site_link_index()
    linked_clients = await db.clients.find(
        {"unifi_site_id": canonical_site_id},
        {"_id": 0, "id": 1, "tenant_id": 1},
    ).to_list(2)
    if any(str(link.get("id")) != str(client_id) for link in linked_clients):
        raise HTTPException(409, "That UniFi site is already linked to another client")
    current_site_id = str(client.get("unifi_site_id") or "").strip()
    if current_site_id and current_site_id != canonical_site_id:
        raise HTTPException(409, "Unlink this client's current UniFi site before linking another")
    metadata = provider_site.get("meta") if isinstance(provider_site.get("meta"), dict) else {}
    canonical_name = metadata.get("desc") or metadata.get("name") or provider_site.get("internalReference") or canonical_site_id
    canonical_host_id = str(provider_site.get("hostId") or "")
    try:
        result = await db.clients.update_one(
            _tenant_scoped_query(current_user, {
                "id": client_id,
                "$or": [
                    {"unifi_site_id": canonical_site_id},
                    {"unifi_site_id": {"$exists": False}},
                    {"unifi_site_id": None},
                    {"unifi_site_id": ""},
                ],
            }),
            {"$set": {
                "unifi_site_id": canonical_site_id,
                "unifi_site_name": canonical_name,
                "unifi_host_id": canonical_host_id,
                "unifi_linked_at": _now(),
                "integrations.unifi": True,
            }},
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="That UniFi site is already linked to another client") from None
    if not getattr(result, "matched_count", 0):
        raise HTTPException(status_code=409, detail="Client link changed while it was being updated; retry")
    await _audit_site_manager(
        current_user,
        "unifi.site_manager.client_linked",
        {"client_id": client_id, "site_id": canonical_site_id, "host_id": canonical_host_id},
    )
    return {"message": "UniFi site linked", "client_id": client_id, "site_id": canonical_site_id}


@router.delete("/clients/{client_id}/link-unifi-site")
async def unlink_unifi_site(client_id: str, current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "edit", "unifi.site_manager.client_unlink")
    client = await _get_site_manager_client(client_id, current_user, "unifi.site_manager.client_unlink")
    await db.clients.update_one(
        _tenant_scoped_query(current_user, {"id": client_id}),
        {"$unset": {"unifi_site_id": "", "unifi_site_name": "", "unifi_host_id": "", "unifi_linked_at": ""},
         "$set": {"integrations.unifi": False}},
    )
    await _audit_site_manager(
        current_user,
        "unifi.site_manager.client_unlinked",
        {"client_id": client_id, "site_id": client.get("unifi_site_id")},
    )
    return {"message": "UniFi site unlinked"}


@router.get("/unifi/linked-clients")
async def list_linked_clients(current_user: dict = Depends(get_current_user)):
    await _require_site_manager(current_user, "view", "unifi.site_manager.client_links.read")
    cursor = db.clients.find(
        _tenant_scoped_query(current_user, {"unifi_site_id": {"$exists": True, "$ne": ""}}),
        {"_id": 0, "id": 1, "name": 1, "unifi_site_id": 1, "unifi_site_name": 1, "unifi_host_id": 1, "unifi_linked_at": 1},
    )
    return await cursor.to_list(1000)
