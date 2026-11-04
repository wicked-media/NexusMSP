from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Any
from datetime import datetime, timezone
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_global_scope, platform_tenant_id, tenant_scoped_query

router = APIRouter()


# Legacy configuration documents pre-date the dedicated integration routers and
# may contain provider credential material.  Keep this conservative rather than
# returning an arbitrary settings document to a browser: credential-shaped
# fields are removed recursively and callers receive status flags instead.
_SENSITIVE_SETTING_KEYS = {
    "access_token",
    "api_key",
    "api_key_full",
    "api_key_preview",
    "api_secret",
    "app_secret",
    "auth",
    "authorization",
    "authorization_header",
    "client_secret",
    "client_secret_preview",
    "key",
    "password",
    "private_key",
    "refresh_token",
    "secret",
    "secret_preview",
    "token",
    "token_preview",
    "webhook_url",
    "webhook_uri",
    "webhook_preview",
}
_SENSITIVE_SETTING_SUFFIXES = (
    "_api_key",
    "_authorization",
    "_ciphertext",
    "_credential",
    "_credentials",
    "_encrypted",
    "_key",
    "_password",
    "_secret",
    "_token",
)
_UNSAFE_SETTING_CONTAINER_KEYS = {"headers", "payload", "provider_payload", "raw", "raw_payload"}
_SENSITIVE_SETTING_CANONICAL_KEYS = {
    "accesstoken",
    "apikey",
    "apikeyfull",
    "apikeypreview",
    "apisecret",
    "appsecret",
    "auth",
    "authorization",
    "authorizationheader",
    "clientsecret",
    "clientsecretpreview",
    "password",
    "privatekey",
    "refreshtoken",
    "secret",
    "secretpreview",
    "token",
    "tokenpreview",
    "webhookpreview",
    "webhookuri",
    "webhookurl",
}
_SENSITIVE_SETTING_CANONICAL_SUFFIXES = (
    "apikey",
    "authorization",
    "ciphertext",
    "credential",
    "credentials",
    "encrypted",
    "password",
    "privatekey",
    "secret",
    "token",
)


def _is_sensitive_setting_key(value: object) -> bool:
    key = str(value or "").strip().lower()
    canonical_key = "".join(character for character in key if character.isalnum())
    return bool(key) and (
        key in _SENSITIVE_SETTING_KEYS
        or key in _UNSAFE_SETTING_CONTAINER_KEYS
        or canonical_key in _SENSITIVE_SETTING_CANONICAL_KEYS
        or (
            canonical_key.startswith("webhook")
            and canonical_key not in {"webhookconfigured", "webhookenabled"}
        )
        or key.endswith(_SENSITIVE_SETTING_SUFFIXES)
        or canonical_key.endswith(_SENSITIVE_SETTING_CANONICAL_SUFFIXES)
    )


def _public_integration_settings(
    settings: dict | None,
    *,
    integration_type: str,
    defaults: dict[str, Any],
    configured_flags: dict[str, tuple[str, ...]],
) -> dict[str, Any]:
    """Return safe integration metadata without returning provider credentials.

    Legacy settings are intentionally schema-flexible.  Recursively remove
    credential-shaped fields so additions such as refresh tokens or encrypted
    key blobs cannot become browser-visible by accident.  Explicit configured
    flags preserve the useful UX state without exposing a credential value.
    """

    source = dict(settings or {})

    def sanitise(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                str(key): sanitise(item)
                for key, item in value.items()
                if key != "_id" and not _is_sensitive_setting_key(key)
            }
        if isinstance(value, list):
            return [sanitise(item) for item in value]
        return value

    public = sanitise(source)
    public["type"] = integration_type
    for key, value in defaults.items():
        public.setdefault(key, value)
    for flag, fields in configured_flags.items():
        public[flag] = any(bool(source.get(field)) for field in fields)
    return public


async def _audit_integration_settings_change(
    current_user: dict,
    request: Request,
    integration_type: str,
    integration_name: str,
) -> None:
    """Record the privileged configuration change without retaining its secrets."""

    await log_activity(
        current_user,
        "integration_settings_updated",
        "integration",
        integration_type,
        integration_name,
        "Integration settings updated.",
        metadata={"correlation_id": getattr(request.state, "correlation_id", None)},
    )


_LEGACY_M365_SYNC_DISABLED = (
    "Legacy Microsoft 365 sync is disabled because submitted user evidence cannot be provider-verified. "
    "Use Nexus Control Plane Microsoft 365 connections and a verified provider synchronisation instead."
)


def _platform_integration_settings_query(
    current_user: dict,
    integration_type: str,
) -> dict[str, Any]:
    """Return the safe partition for a platform-owned integration setting.

    These legacy endpoints are retained for compatibility while dedicated
    connection routes progressively take ownership.  They must still never
    let one Nexus platform tenant read or overwrite another tenant's provider
    configuration.  ``nexus-local`` continues to see its pre-partition
    records until an approved migration exists.
    """

    tenant_id = platform_tenant_id(current_user)
    if tenant_id != "nexus-local":
        return {"type": integration_type, "platform_tenant_id": tenant_id}
    return {
        "type": integration_type,
        "$or": [
            {"platform_tenant_id": "nexus-local"},
            {"platform_tenant_id": {"$exists": False}},
            {"platform_tenant_id": None},
            {"platform_tenant_id": ""},
        ],
    }


def _platform_integration_settings_payload(
    current_user: dict,
    data: dict | None,
    integration_type: str,
) -> dict[str, Any]:
    """Bind legacy configuration writes to the actor's platform partition."""

    payload = dict(data or {})
    payload["type"] = integration_type
    payload["platform_tenant_id"] = platform_tenant_id(current_user)
    return payload


# ============== MICROSOFT INTEGRATIONS CONFIG ==============


@router.get(
    "/settings/microsoft-teams",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_teams_settings(request: Request, current_user: dict = Depends(get_current_user)):
    """Get Microsoft Teams integration settings"""
    await assert_global_scope(current_user, operation="platform.integration.microsoft_teams.read", request=request)
    settings = await db.settings.find_one(
        _platform_integration_settings_query(current_user, "microsoft_teams"),
        {"_id": 0},
    )
    return _public_integration_settings(
        settings,
        integration_type="microsoft_teams",
        defaults={"enabled": False, "tenant_id": "", "client_id": ""},
        configured_flags={
            "client_secret_configured": (
                "client_secret",
                "clientSecret",
                "app_secret",
                "appSecret",
                "client_secret_encrypted",
            ),
            "webhook_configured": ("webhook_url", "webhookUrl", "webhook_uri", "webhook_secret"),
        },
    )


@router.put(
    "/settings/microsoft-teams",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def update_teams_settings(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Update Microsoft Teams integration settings"""
    await assert_global_scope(current_user, operation="platform.integration.microsoft_teams.write", request=request)
    payload = _platform_integration_settings_payload(current_user, data, "microsoft_teams")
    await db.settings.update_one(
        _platform_integration_settings_query(current_user, "microsoft_teams"),
        {"$set": payload},
        upsert=True,
    )
    await _audit_integration_settings_change(current_user, request, "microsoft_teams", "Microsoft Teams")
    return {"message": "Teams settings updated"}


@router.get("/settings/cipp", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def get_cipp_settings(request: Request, current_user: dict = Depends(get_current_user)):
    """Get CIPP integration settings"""
    await assert_global_scope(current_user, operation="m365.legacy_settings.cipp.read", request=request)
    settings = await db.settings.find_one(
        _platform_integration_settings_query(current_user, "cipp"),
        {"_id": 0},
    )
    return _public_integration_settings(
        settings,
        integration_type="cipp",
        defaults={"enabled": False, "api_url": "", "tenant_filter": ""},
        configured_flags={
            "api_key_configured": (
                "api_key",
                "apiKey",
                "api_key_full",
                "apiKeyFull",
                "api_key_encrypted",
                "api_secret",
            )
        },
    )


@router.put("/settings/cipp", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def update_cipp_settings(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Update CIPP integration settings"""
    await assert_global_scope(current_user, operation="m365.legacy_settings.cipp.write", request=request)
    payload = _platform_integration_settings_payload(current_user, data, "cipp")
    await db.settings.update_one(
        _platform_integration_settings_query(current_user, "cipp"),
        {"$set": payload},
        upsert=True,
    )
    await _audit_integration_settings_change(current_user, request, "cipp", "CIPP")
    return {"message": "CIPP settings updated"}


@router.get("/settings/microsoft365", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def get_m365_settings(request: Request, current_user: dict = Depends(get_current_user)):
    """Get Microsoft 365 integration settings"""
    await assert_global_scope(current_user, operation="m365.legacy_settings.microsoft365.read", request=request)
    settings = await db.settings.find_one(
        _platform_integration_settings_query(current_user, "microsoft365"),
        {"_id": 0},
    )
    return _public_integration_settings(
        settings,
        integration_type="microsoft365",
        defaults={"enabled": False, "tenant_id": "", "client_id": "", "redirect_uri": ""},
        configured_flags={
            "client_secret_configured": (
                "client_secret",
                "clientSecret",
                "app_secret",
                "appSecret",
                "client_secret_encrypted",
            )
        },
    )


@router.put("/settings/microsoft365", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def update_m365_settings(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Update Microsoft 365 integration settings"""
    await assert_global_scope(current_user, operation="m365.legacy_settings.microsoft365.write", request=request)
    payload = _platform_integration_settings_payload(current_user, data, "microsoft365")
    await db.settings.update_one(
        _platform_integration_settings_query(current_user, "microsoft365"),
        {"$set": payload},
        upsert=True,
    )
    await _audit_integration_settings_change(current_user, request, "microsoft365", "Microsoft 365")
    return {"message": "Microsoft 365 settings updated"}


@router.post("/clients/{client_id}/m365-sync", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def sync_client_m365(client_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Reject legacy manual evidence writes until a verified provider path owns them."""
    await assert_global_scope(current_user, operation="m365.legacy_sync.write", request=request)
    raise HTTPException(status_code=409, detail=_LEGACY_M365_SYNC_DISABLED)


@router.get("/clients/{client_id}/m365-users", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def get_client_m365_users(client_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Reject reads of legacy manually submitted Microsoft 365 user evidence."""
    await assert_global_scope(current_user, operation="m365.legacy_sync.read", request=request)
    raise HTTPException(status_code=409, detail=_LEGACY_M365_SYNC_DISABLED)

@router.post("/cipp/sync-tenants", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def sync_cipp_tenants(request: Request, current_user: dict = Depends(get_current_user)):
    """Retire the historical mock sync route before it can imply real provider evidence."""
    await assert_global_scope(current_user, operation="m365.legacy_cipp_sync.write", request=request)
    raise HTTPException(
        status_code=409,
        detail=(
            "Legacy CIPP tenant sync is retired because it did not perform a provider-verified synchronisation. "
            "Use Nexus Control Plane Microsoft 365 connections and the verified provider discovery flow instead."
        ),
    )

@router.post("/teams/update-status")
async def update_teams_status(data: dict, current_user: dict = Depends(get_current_user)):
    """Update Microsoft Teams status for current user"""
    teams_settings = await db.settings.find_one(
        _platform_integration_settings_query(current_user, "microsoft_teams"),
        {"_id": 0},
    )
    if not teams_settings or not teams_settings.get("enabled"):
        return {"message": "Teams integration not configured. Please set up in Settings > Integrations.", "configured": False}
    
    # Store the desired status locally
    status_data = {
        "user_id": current_user["id"],
        "availability": data.get("availability", "Available"),
        "status_message": data.get("status_message", ""),
        "platform_tenant_id": platform_tenant_id(current_user),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.teams_status.update_one(
        tenant_scoped_query(current_user, {"user_id": current_user["id"]}, tenant_field="platform_tenant_id"),
        {"$set": status_data},
        upsert=True,
    )
    return {"message": "Status updated", "configured": True, "status": status_data}

@router.get("/technicians/{tech_id}/teams-status")
async def get_tech_teams_status(tech_id: str, current_user: dict = Depends(get_current_user)):
    """Get Teams status for a technician"""
    status = await db.teams_status.find_one(
        tenant_scoped_query(current_user, {"user_id": tech_id}, tenant_field="platform_tenant_id"),
        {"_id": 0},
    )
    return status or {"availability": "Unknown", "status_message": ""}

