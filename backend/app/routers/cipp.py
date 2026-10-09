"""
CIPP (Cyber Integrated Partner Platform) integration.
CIPP typically runs as Azure Static Web App + Functions; auth is header-based
(x-functions-key) against a base like https://<app>.azurewebsites.net/api.

Endpoints implemented (read + a few writes):
  GET  /api/cipp/status · POST/DELETE /api/cipp/settings · GET /api/cipp/test
  GET  /api/cipp/tenants
  GET  /api/cipp/tenants/{tenant_id}/users
  POST /api/cipp/tenants/{tenant_id}/users  (create user)
  GET  /api/cipp/tenants/{tenant_id}/licenses
  POST /api/cipp/tenants/{tenant_id}/users/{user_id}/assign-license
  POST /api/clients/{client_id}/link-cipp-tenant  · retired; use Nexus Microsoft onboarding mapping
  POST /api/clients/{client_id}/link-suped-tenant · same for Suped
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from datetime import datetime, timezone
from typing import Optional
import httpx

from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.rustdesk_provider_security import redact_provider_payload
from app.services.secret_store import decrypt_secret, encrypt_secret
from app.services.scope_permissions import assert_client_scope, assert_global_scope, platform_tenant_id, scoped_query, tenant_scoped_query
from app.services.nexus_verify_execution import begin_verified_execution, complete_verified_execution, release_verified_execution
from app.services.activity import log_activity
from app.services.m365_provider_visibility import visible_m365_provider_tenant_ids

router = APIRouter()

SETTINGS_KEY = "cipp"


def _cipp_settings_query(current_user: dict, extra: Optional[dict] = None) -> dict:
    """Select the CIPP connection owned by the actor's Nexus platform.

    A Microsoft tenant ID belongs to a customer, not to a Nexus installation.
    Connection credentials therefore use the explicit ``platform_tenant_id``
    partition.  ``tenant_scoped_query`` retains documented nexus-local access
    to an untagged legacy record, but a platform-bound actor can never fall
    back to that record or another platform's credentials.
    """
    return tenant_scoped_query(
        current_user,
        {"type": SETTINGS_KEY, **(extra or {})},
        tenant_field="platform_tenant_id",
    )


async def _get_config(current_user: dict, *, migrate_legacy: bool = False) -> Optional[dict]:
    """Return the provider secret only in server memory.

    New CIPP adapter credentials are encrypted before persistence. A legacy raw
    key remains usable during the bounded compatibility period, but only a
    globally governed settings workflow is allowed to migrate and remove it.
    """
    doc = await db.settings.find_one(_cipp_settings_query(current_user), {"_id": 0})
    if not doc or not doc.get("base_url"):
        return None
    config = dict(doc)
    encrypted = str(config.get("api_key_encrypted") or "").strip()
    legacy = str(config.get("api_key_full") or "").strip()
    if encrypted:
        config["api_key_full"] = decrypt_secret(encrypted)
        if migrate_legacy and legacy:
            await db.settings.update_one(
                _cipp_settings_query(current_user, {"api_key_encrypted": encrypted}),
                {"$unset": {"api_key_full": ""}},
            )
    elif legacy:
        config["api_key_full"] = legacy
        if migrate_legacy:
            await db.settings.update_one(
                _cipp_settings_query(current_user, {
                    "api_key_full": legacy,
                    "$or": [
                        {"api_key_encrypted": {"$exists": False}},
                        {"api_key_encrypted": ""},
                        {"api_key_encrypted": None},
                    ],
                }),
                {
                    "$set": {"api_key_encrypted": encrypt_secret(legacy)},
                    "$unset": {"api_key_full": ""},
                },
            )
    else:
        return None
    return config if config.get("api_key_full") else None


def _headers(cfg: dict) -> dict:
    """CIPP accepts x-functions-key and/or Authorization: Bearer — we send both for compatibility."""
    return {
        "x-functions-key": cfg["api_key_full"],
        "Authorization": f"Bearer {cfg['api_key_full']}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def _cipp_call(
    method: str,
    path: str,
    params: Optional[dict] = None,
    json_body: Optional[dict] = None,
    *,
    current_user: dict,
):
    cfg = await _get_config(current_user)
    if not cfg:
        raise HTTPException(503, "Microsoft tenant provider is not configured")
    base = cfg["base_url"].rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=45.0) as c:
            r = await c.request(method, url, headers=_headers(cfg), params=params or {}, json=json_body)
    except httpx.TimeoutException:
        raise HTTPException(504, "Microsoft tenant provider timed out")
    except httpx.RequestError as e:
        raise HTTPException(503, f"Microsoft tenant provider is unreachable: {str(e)[:120]}")
    if r.status_code == 401:
        raise HTTPException(401, "Microsoft tenant provider authentication failed — check the API key")
    if r.status_code == 429:
        raise HTTPException(429, "Microsoft tenant provider rate limit reached")
    if r.status_code >= 400:
        # Provider error payloads are untrusted and may echo a credential or
        # sensitive customer field. Keep the actionable HTTP status without
        # reflecting raw upstream content into the browser or audit trail.
        raise HTTPException(r.status_code, f"Microsoft tenant provider returned HTTP {r.status_code}")
    try:
        return r.json() if r.content else {}
    except Exception:
        return {"raw": r.text}


async def _assert_tenant_scope(
    current_user: dict,
    tenant_id: str,
    operation: str,
    request: Request,
    *,
    require_mapping: bool = False,
) -> dict:
    """Resolve and enforce the Nexus client boundary for a CIPP tenant.

    Provider tenant IDs are not a Nexus ownership boundary by themselves. Reads
    that expose user or licence data, and every provider mutation, require one
    unambiguous client mapping before they can proceed.
    """
    clients = await db.clients.find(
        tenant_scoped_query(current_user, {"cipp_tenant_id": tenant_id}),
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(2)
    client = clients[0] if len(clients) == 1 else {}
    await assert_client_scope(
        current_user,
        client.get("id"),
        operation=operation,
        request=request,
    )
    if require_mapping and len(clients) != 1:
        raise HTTPException(
            status_code=422,
            detail="Map this Microsoft tenant to exactly one Nexus client before this action",
        )
    return client


def _action_audit_context(current_user: dict, client: dict, request: Request) -> dict:
    """Keep provider-action audit evidence scoped without recording secrets."""
    return {
        "client_id": client.get("id"),
        "actor_id": current_user.get("id"),
        "correlation_id": getattr(getattr(request, "state", None), "correlation_id", None),
    }


def _safe_provider_result(result):
    """Return provider output without credential-shaped values or raw blobs."""
    redacted = redact_provider_payload(result)
    if isinstance(redacted, dict) and "raw" in redacted:
        return {
            key: ("[provider payload omitted]" if key == "raw" else value)
            for key, value in redacted.items()
        }
    return redacted


def _safe_result_preview(result) -> str:
    return str(_safe_provider_result(result))[:400]


async def _visible_tenant_ids(current_user: dict) -> set[str] | None:
    """Resolve CIPP tenant visibility through the canonical Microsoft resolver.

    CIPP is an optional provider adapter, not a separate tenancy model. Reuse
    the same platform-aware, conflict-safe mapping resolver as the native
    Microsoft control-plane paths so an explicitly platform-bound administrator
    cannot accidentally enumerate provider-wide tenant evidence.
    """
    return await visible_m365_provider_tenant_ids(current_user, database=db)


# --- settings --------------------------------------------------------------

@router.get("/cipp/status")
async def status(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="entra.provider.status.read", request=request)
    config = await _get_config(current_user, migrate_legacy=True)
    return {
        "configured": bool(config),
        "base_url": (config or {}).get("base_url", ""),
        "last_test_status": (config or {}).get("last_test_status"),
        "last_tested_at": (config or {}).get("last_tested_at"),
        "last_synced_at": (config or {}).get("last_synced_at"),
    }


@router.post("/cipp/settings", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def save_settings(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="entra.provider.connection.modify", request=request)
    base_url = (data or {}).get("base_url", "").strip().rstrip("/")
    api_key = (data or {}).get("api_key", "").strip()
    if not base_url or not api_key:
        raise HTTPException(400, "base_url and api_key are required")
    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        _cipp_settings_query(current_user),
        {"$set": {
            "type": SETTINGS_KEY,
            "platform_tenant_id": platform_tenant_id(current_user),
            "base_url": base_url,
            "api_key_encrypted": encrypt_secret(api_key),
            "updated_at": now,
            "updated_by": current_user.get("name"),
        }, "$unset": {"api_key_full": ""}},
        upsert=True,
    )
    await log_activity(
        current_user,
        "m365_provider_credentials_saved",
        "integration",
        SETTINGS_KEY,
        "Microsoft tenant provider",
        "Updated Microsoft tenant provider credentials.",
        metadata={"correlation_id": getattr(request.state, "correlation_id", None)},
    )
    return {"message": "Microsoft tenant provider settings saved"}


@router.delete("/cipp/settings", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def clear_settings(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="entra.provider.connection.modify", request=request)
    await db.settings.delete_one(_cipp_settings_query(current_user))
    await log_activity(
        current_user,
        "m365_provider_credentials_removed",
        "integration",
        SETTINGS_KEY,
        "Microsoft tenant provider",
        "Removed Microsoft tenant provider credentials.",
        metadata={"correlation_id": getattr(request.state, "correlation_id", None)},
    )
    return {"message": "Microsoft tenant provider credentials removed"}


@router.get("/cipp/test", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def test_connection(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="entra.provider.connection.test", request=request)
    cfg = await _get_config(current_user, migrate_legacy=True)
    if not cfg:
        return {"success": False, "message": "Not configured"}
    now = datetime.now(timezone.utc).isoformat()
    try:
        # Try ListTenants first — that's the canonical CIPP smoke endpoint
        data = await _cipp_call("GET", "ListTenants", current_user=current_user)
        await db.settings.update_one(
            _cipp_settings_query(current_user),
            {"$set": {"last_test_status": "success", "last_tested_at": now}},
        )
        tenants = data if isinstance(data, list) else (data.get("Tenants") or data.get("tenants") or [])
        await log_activity(
            current_user,
            "m365_provider_connection_tested",
            "integration",
            SETTINGS_KEY,
            "Microsoft tenant provider",
            "Microsoft tenant provider connection test succeeded.",
            metadata={"success": True, "correlation_id": getattr(request.state, "correlation_id", None)},
        )
        return {"success": True, "message": f"Connected — {len(tenants)} tenants visible"}
    except HTTPException as e:
        await db.settings.update_one(
            _cipp_settings_query(current_user),
            {"$set": {"last_test_status": f"failed_{e.status_code}", "last_tested_at": now}},
        )
        await log_activity(
            current_user,
            "m365_provider_connection_tested",
            "integration",
            SETTINGS_KEY,
            "Microsoft tenant provider",
            "Microsoft tenant provider connection test failed.",
            metadata={"success": False, "status_code": e.status_code, "correlation_id": getattr(request.state, "correlation_id", None)},
        )
        return {"success": False, "message": e.detail}


# --- tenants / users / licenses -------------------------------------------

def _norm_tenants(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("Tenants") or data.get("tenants") or data.get("Results") or []
    return []


@router.get("/cipp/tenants")
async def list_tenants(current_user: dict = Depends(get_current_user)):
    data = await _cipp_call("GET", "ListTenants", current_user=current_user)
    tenants = _norm_tenants(data)
    # Normalise: always return customerId, displayName, defaultDomainName
    visible_tenant_ids = await _visible_tenant_ids(current_user)
    out = [{
        "customerId": t.get("customerId") or t.get("CustomerId") or t.get("tenant_id") or t.get("id"),
        "displayName": t.get("displayName") or t.get("DisplayName") or t.get("Name") or "",
        "defaultDomainName": t.get("defaultDomainName") or t.get("DefaultDomainName") or t.get("domain") or "",
        "country": t.get("country") or t.get("Country") or "",
        "raw": t,
    } for t in tenants]
    if visible_tenant_ids is not None:
        out = [tenant for tenant in out if str(tenant.get("customerId") or "") in visible_tenant_ids]
    return out


@router.get("/cipp/tenants/{tenant_id}/users")
async def list_tenant_users(tenant_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    await _assert_tenant_scope(current_user, tenant_id, "entra.user.read", request, require_mapping=True)
    data = await _cipp_call("GET", "ListUsers", params={"TenantFilter": tenant_id}, current_user=current_user)
    users = data if isinstance(data, list) else (data.get("Users") or data.get("users") or data.get("Results") or [])
    out = [{
        "id": u.get("id") or u.get("Id") or u.get("userPrincipalName") or u.get("UserPrincipalName"),
        "userPrincipalName": u.get("userPrincipalName") or u.get("UserPrincipalName") or u.get("UPN"),
        "displayName": u.get("displayName") or u.get("DisplayName"),
        "accountEnabled": u.get("accountEnabled") if "accountEnabled" in u else u.get("AccountEnabled", True),
        "givenName": u.get("givenName") or u.get("GivenName"),
        "surname": u.get("surname") or u.get("Surname"),
        "jobTitle": u.get("jobTitle") or u.get("JobTitle"),
        "licenses_count": len(u.get("assignedLicenses") or u.get("AssignedLicenses") or []),
    } for u in users]
    return out


@router.post("/cipp/tenants/{tenant_id}/users", dependencies=[Depends(require_action("entra.user.create"))])
async def create_user(tenant_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """
    body: { displayName, userPrincipalName, mailNickname, password, firstName?, lastName?,
            usageLocation?: 'AU', licenses?: ['SKU_ID'] }
    """
    required = ["displayName", "userPrincipalName", "password"]
    missing = [k for k in required if not (data or {}).get(k)]
    if missing:
        raise HTTPException(400, f"Missing fields: {', '.join(missing)}")
    client = await _assert_tenant_scope(current_user, tenant_id, "entra.user.create", request, require_mapping=True)

    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "displayName": data["displayName"],
        "userPrincipalName": data["userPrincipalName"],
        "mailNickname": data.get("mailNickname") or data["userPrincipalName"].split("@")[0],
        "password": data["password"],
        "firstName": data.get("firstName", ""),
        "lastName": data.get("lastName", ""),
        "usageLocation": data.get("usageLocation", "AU"),
        "licenses": data.get("licenses", []),
        "mustChangePassword": bool(data.get("mustChangePassword", True)),
    }
    result = await _cipp_call("POST", "AddUser", json_body=payload, current_user=current_user)

    # Audit
    await db.cipp_actions.insert_one({
        "action": "create_user",
        "tenant_id": tenant_id,
        "upn": payload["userPrincipalName"],
        "result_preview": _safe_result_preview(result),
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_action_audit_context(current_user, client, request),
    })
    return {"success": True, "result": _safe_provider_result(result)}


@router.get("/cipp/tenants/{tenant_id}/licenses")
async def list_tenant_licenses(tenant_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    await _assert_tenant_scope(current_user, tenant_id, "entra.license.read", request, require_mapping=True)
    data = await _cipp_call("GET", "ListLicenses", params={"TenantFilter": tenant_id}, current_user=current_user)
    lic = data if isinstance(data, list) else (data.get("Licenses") or data.get("licenses") or data.get("Results") or [])
    out = [{
        "skuId": x.get("skuId") or x.get("SkuId") or x.get("id"),
        "skuPartNumber": x.get("skuPartNumber") or x.get("SkuPartNumber") or x.get("name"),
        "consumedUnits": x.get("consumedUnits") or x.get("ConsumedUnits") or 0,
        "prepaidUnits": (x.get("prepaidUnits") or x.get("PrepaidUnits") or {}).get("enabled"),
        "available": ((x.get("prepaidUnits") or x.get("PrepaidUnits") or {}).get("enabled") or 0) - (x.get("consumedUnits") or 0),
    } for x in lic]
    return out


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/assign-license", dependencies=[Depends(require_action("entra.license.modify"))])
async def assign_license(tenant_id: str, user_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """body: { addLicenses: ['SKU_ID', ...], removeLicenses: ['SKU_ID'] }"""
    client = await _assert_tenant_scope(current_user, tenant_id, "entra.license.modify", request, require_mapping=True)
    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "userId": user_id,
        "UserId": user_id,
        "addLicenses": (data or {}).get("addLicenses", []),
        "removeLicenses": (data or {}).get("removeLicenses", []),
    }
    result = await _cipp_call("POST", "ExecBulkUserLicense", json_body=payload, current_user=current_user)
    await db.cipp_actions.insert_one({
        "action": "assign_license",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "add": payload["addLicenses"],
        "remove": payload["removeLicenses"],
        "result_preview": _safe_result_preview(result),
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_action_audit_context(current_user, client, request),
    })
    return {"success": True, "result": _safe_provider_result(result)}


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/reset-password", dependencies=[Depends(require_action("entra.credential.reset"))])
async def reset_password(tenant_id: str, user_id: str, request: Request, data: dict = None, current_user: dict = Depends(get_current_user)):
    """body: { password?, mustChange?: bool, verification_request_id }.

    Password resets are provider actions with a Nexus Verify gate. A password
    is never reset merely because a technician knows the requester's name.
    """
    client = await _assert_tenant_scope(current_user, tenant_id, "entra.credential.reset", request, require_mapping=True)
    data = data or {}
    verification = await begin_verified_execution(
        data.get("verification_request_id"), client_id=client["id"], action_type="password_reset",
        actor=current_user, target=f"Microsoft tenant {tenant_id} user {user_id}",
        provider_target={"provider": "microsoft_entra", "tenant_id": tenant_id, "provider_user_id": user_id},
    )
    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "userId": user_id,
        "UserId": user_id,
        "password": data.get("password", ""),
        "MustChangePass": bool(data.get("mustChange", True)),
    }
    try:
        result = await _cipp_call("POST", "ExecResetPass", json_body=payload, current_user=current_user)
    except HTTPException as error:
        await release_verified_execution(verification, actor=current_user, reason=str(error.detail))
        raise
    await complete_verified_execution(verification, actor=current_user, outcome=f"Password reset provider action returned for {user_id}.")
    await db.cipp_actions.insert_one({
        "action": "reset_password",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "verification_request_id": verification["id"],
        "result_preview": _safe_result_preview(result),
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_action_audit_context(current_user, client, request),
    })
    return {"success": True, "result": _safe_provider_result(result)}


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/block-signin", dependencies=[Depends(require_action("entra.user.disable"))])
async def block_signin(tenant_id: str, user_id: str, request: Request, data: dict = None, current_user: dict = Depends(get_current_user)):
    """body: { enable?: bool, verification_request_id }.

    Blocking or restoring a user's sign-in is a protected identity action. It
    uses the existing offboarding approval policy rather than treating a CIPP
    adapter call as sufficient authorisation.
    """
    client = await _assert_tenant_scope(current_user, tenant_id, "entra.user.disable", request, require_mapping=True)
    data = data or {}
    enable = bool(data.get("enable", False))
    verification = await begin_verified_execution(
        data.get("verification_request_id"), client_id=client["id"], action_type="offboarding",
        actor=current_user,
        target=f"Microsoft tenant {tenant_id} user {user_id} sign-in {'enabled' if enable else 'blocked'}",
        provider_target={"provider": "microsoft_entra", "tenant_id": tenant_id, "provider_user_id": user_id},
    )
    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "userId": user_id,
        "UserId": user_id,
        "Enable": enable,
    }
    try:
        result = await _cipp_call("POST", "ExecDisableUser", json_body=payload, current_user=current_user)
    except HTTPException as error:
        await release_verified_execution(verification, actor=current_user, reason=str(error.detail))
        raise
    await complete_verified_execution(
        verification,
        actor=current_user,
        outcome=f"Microsoft sign-in {'enabled' if enable else 'blocked'} provider action returned for {user_id}.",
    )
    await db.cipp_actions.insert_one({
        "action": "unblock_signin" if enable else "block_signin",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "verification_request_id": verification["id"],
        "result_preview": _safe_result_preview(result),
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_action_audit_context(current_user, client, request),
    })
    return {"success": True, "result": _safe_provider_result(result), "enabled": enable}


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/offboard", dependencies=[Depends(require_action("entra.user.disable"))])
async def offboard_user(tenant_id: str, user_id: str, request: Request, data: dict = None, current_user: dict = Depends(get_current_user)):
    """body: { convertToShared?: bool, removeLicenses?: bool, resetPassword?: bool, revokeSessions?: bool,
               outOfOffice?: str, forwardTo?: str, disableUser?: bool }"""
    client = await _assert_tenant_scope(current_user, tenant_id, "entra.user.disable", request, require_mapping=True)
    data = data or {}
    verification = await begin_verified_execution(
        data.get("verification_request_id"), client_id=client["id"], action_type="offboarding",
        actor=current_user, target=f"Microsoft tenant {tenant_id} user {user_id}",
        provider_target={"provider": "microsoft_entra", "tenant_id": tenant_id, "provider_user_id": user_id},
    )
    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "user": user_id,
        "User": user_id,
        "ConvertToShared": bool(data.get("convertToShared", True)),
        "RemoveLicenses": bool(data.get("removeLicenses", True)),
        "ResetPass": bool(data.get("resetPassword", True)),
        "RevokeSessions": bool(data.get("revokeSessions", True)),
        "DisableSignIn": bool(data.get("disableUser", True)),
        "RemoveGroups": bool(data.get("removeGroups", True)),
        "HideFromGAL": bool(data.get("hideFromGAL", True)),
        "OOO": data.get("outOfOffice", ""),
        "forward": data.get("forwardTo", ""),
    }
    try:
        result = await _cipp_call("POST", "ExecOffboardUser", json_body=payload, current_user=current_user)
    except HTTPException as error:
        await release_verified_execution(verification, actor=current_user, reason=str(error.detail))
        raise
    await complete_verified_execution(verification, actor=current_user, outcome=f"Offboarding provider action returned for {user_id}.")
    await db.cipp_actions.insert_one({
        "action": "offboard_user",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "verification_request_id": verification["id"],
        "options": {k: v for k, v in payload.items() if k not in ("tenantFilter", "TenantFilter", "user", "User")},
        "result_preview": _safe_result_preview(result),
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_action_audit_context(current_user, client, request),
    })
    return {"success": True, "result": _safe_provider_result(result)}


@router.get("/cipp/summary")
async def cipp_summary(current_user: dict = Depends(get_current_user)):
    """Aggregated dashboard: tenant/user/license counts + linked-client coverage."""
    cfg = await _get_config(current_user)
    if not cfg:
        return {"configured": False, "message": "Microsoft tenant provider is not configured"}

    tenants_raw = await _cipp_call("GET", "ListTenants", current_user=current_user)
    visible_tenant_ids = await _visible_tenant_ids(current_user)
    tenants = _norm_tenants(tenants_raw)
    if visible_tenant_ids is not None:
        tenants = [
            tenant for tenant in tenants
            if str(tenant.get("customerId") or tenant.get("CustomerId") or tenant.get("tenant_id") or tenant.get("id") or "") in visible_tenant_ids
        ]

    linked = await db.clients.count_documents(scoped_query(current_user, {"cipp_tenant_id": {"$exists": True, "$ne": ""}}))
    clients_total = await db.clients.count_documents(scoped_query(current_user))
    action_query = {} if visible_tenant_ids is None else {"tenant_id": {"$in": list(visible_tenant_ids)}}
    recent_actions = await db.cipp_actions.find(action_query, {"_id": 0}).sort("timestamp", -1).to_list(10)

    now = datetime.now(timezone.utc).isoformat()
    return {
        "configured": True,
        "stats": {
            "tenants": len(tenants),
            "linked_clients": linked,
            "total_clients": clients_total,
            "coverage_pct": round((linked / clients_total) * 100, 1) if clients_total else 0,
        },
        "tenants": [{
            "customerId": t.get("customerId") or t.get("CustomerId") or t.get("tenant_id") or t.get("id"),
            "displayName": t.get("displayName") or t.get("DisplayName") or t.get("Name") or "",
            "defaultDomainName": t.get("defaultDomainName") or t.get("DefaultDomainName") or "",
        } for t in tenants[:100]],
        "recent_actions": recent_actions,
        "last_synced_at": now,
    }


@router.get("/cipp/linked-clients")
async def list_linked_clients(current_user: dict = Depends(get_current_user)):
    """Clients with a CIPP tenant link."""
    cursor = db.clients.find(
        scoped_query(current_user, {"cipp_tenant_id": {"$exists": True, "$ne": ""}}),
        {"_id": 0, "id": 1, "name": 1, "cipp_tenant_id": 1, "cipp_tenant_display": 1, "cipp_tenant_domain": 1, "cipp_linked_at": 1},
    )
    return await cursor.to_list(1000)


# --- client linking --------------------------------------------------------

@router.post("/clients/{client_id}/link-cipp-tenant", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def link_cipp_tenant(client_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    # This endpoint accepted an arbitrary provider tenant ID and could bypass
    # the canonical mapping review. Retire it rather than preserving a second
    # ownership system beside the Nexus Microsoft onboarding registry.
    raise HTTPException(
        status_code=410,
        detail="Direct CIPP tenant linking is retired. Register and map the tenant in Control Plane → Microsoft tenant setup.",
    )


@router.delete("/clients/{client_id}/link-cipp-tenant", dependencies=[Depends(require_action("m365.tenant.manage"))])
async def unlink_cipp_tenant(client_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    raise HTTPException(
        status_code=410,
        detail="Direct CIPP tenant unlinking is retired. Change the audited mapping in Control Plane → Microsoft tenant setup.",
    )


@router.post("/clients/{client_id}/link-suped-tenant")
async def link_suped_tenant(client_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    tenant_id = (data or {}).get("tenant_id")
    tenant_display = (data or {}).get("tenant_display", "")
    if not tenant_id:
        raise HTTPException(400, "tenant_id required")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    await assert_client_scope(current_user, client["id"], operation="mail.tenant.link", request=request, mask_not_found=True)
    now = datetime.now(timezone.utc).isoformat()
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {
            "suped_tenant_id": tenant_id,
            "suped_tenant_display": tenant_display,
            "suped_linked_at": now,
        }},
    )
    return {"message": "Suped tenant linked", "client_id": client_id, "tenant_id": tenant_id}


@router.delete("/clients/{client_id}/link-suped-tenant")
async def unlink_suped_tenant(client_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    await assert_client_scope(current_user, client["id"], operation="mail.tenant.unlink", request=request, mask_not_found=True)
    await db.clients.update_one(
        {"id": client_id},
        {"$unset": {"suped_tenant_id": "", "suped_tenant_display": "", "suped_linked_at": ""}},
    )
    return {"message": "Suped tenant unlinked"}
