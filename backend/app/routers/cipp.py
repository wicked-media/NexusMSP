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
  POST /api/clients/{client_id}/link-cipp-tenant  · link CIPP tenant to a NexusOps client
  POST /api/clients/{client_id}/link-suped-tenant · same for Suped
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from datetime import datetime, timezone
from typing import Optional
import httpx

from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_client_scope

router = APIRouter()

SETTINGS_KEY = "cipp"


async def _get_config() -> Optional[dict]:
    doc = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0})
    if not doc or not doc.get("base_url") or not doc.get("api_key_full"):
        return None
    return doc


def _headers(cfg: dict) -> dict:
    """CIPP accepts x-functions-key and/or Authorization: Bearer — we send both for compatibility."""
    return {
        "x-functions-key": cfg["api_key_full"],
        "Authorization": f"Bearer {cfg['api_key_full']}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def _cipp_call(method: str, path: str, params: Optional[dict] = None, json_body: Optional[dict] = None):
    cfg = await _get_config()
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
        raise HTTPException(r.status_code, f"Microsoft tenant provider error: {r.text[:300]}")
    try:
        return r.json() if r.content else {}
    except Exception:
        return {"raw": r.text}


async def _assert_tenant_scope(current_user: dict, tenant_id: str, operation: str, request: Request) -> dict:
    client = await db.clients.find_one(
        {"cipp_tenant_id": tenant_id},
        {"_id": 0, "id": 1, "name": 1},
    )
    await assert_client_scope(
        current_user,
        (client or {}).get("id"),
        operation=operation,
        request=request,
    )
    return client or {}


# --- settings --------------------------------------------------------------

@router.get("/cipp/status")
async def status(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": SETTINGS_KEY}, {"_id": 0}) or {}
    return {
        "configured": bool(doc.get("base_url") and doc.get("api_key_full")),
        "base_url": doc.get("base_url", ""),
        "api_key_preview": (doc.get("api_key_full", "")[:6] + "…" + doc.get("api_key_full", "")[-4:]) if doc.get("api_key_full") else None,
        "last_test_status": doc.get("last_test_status"),
        "last_tested_at": doc.get("last_tested_at"),
        "last_synced_at": doc.get("last_synced_at"),
    }


@router.post("/cipp/settings")
async def save_settings(data: dict, current_user: dict = Depends(get_current_user)):
    base_url = (data or {}).get("base_url", "").strip().rstrip("/")
    api_key = (data or {}).get("api_key", "").strip()
    if not base_url or not api_key:
        raise HTTPException(400, "base_url and api_key are required")
    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {
            "type": SETTINGS_KEY,
            "base_url": base_url,
            "api_key_full": api_key,
            "updated_at": now,
            "updated_by": current_user.get("name"),
        }},
        upsert=True,
    )
    return {"message": "Microsoft tenant provider settings saved"}


@router.delete("/cipp/settings")
async def clear_settings(current_user: dict = Depends(get_current_user)):
    await db.settings.delete_one({"type": SETTINGS_KEY})
    return {"message": "Microsoft tenant provider credentials removed"}


@router.get("/cipp/test")
async def test_connection(current_user: dict = Depends(get_current_user)):
    cfg = await _get_config()
    if not cfg:
        return {"success": False, "message": "Not configured"}
    now = datetime.now(timezone.utc).isoformat()
    try:
        # Try ListTenants first — that's the canonical CIPP smoke endpoint
        data = await _cipp_call("GET", "ListTenants")
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"last_test_status": "success", "last_tested_at": now}},
        )
        tenants = data if isinstance(data, list) else (data.get("Tenants") or data.get("tenants") or [])
        return {"success": True, "message": f"Connected — {len(tenants)} tenants visible"}
    except HTTPException as e:
        await db.settings.update_one(
            {"type": SETTINGS_KEY},
            {"$set": {"last_test_status": f"failed_{e.status_code}", "last_tested_at": now}},
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
    data = await _cipp_call("GET", "ListTenants")
    tenants = _norm_tenants(data)
    # Normalise: always return customerId, displayName, defaultDomainName
    out = [{
        "customerId": t.get("customerId") or t.get("CustomerId") or t.get("tenant_id") or t.get("id"),
        "displayName": t.get("displayName") or t.get("DisplayName") or t.get("Name") or "",
        "defaultDomainName": t.get("defaultDomainName") or t.get("DefaultDomainName") or t.get("domain") or "",
        "country": t.get("country") or t.get("Country") or "",
        "raw": t,
    } for t in tenants]
    return out


@router.get("/cipp/tenants/{tenant_id}/users")
async def list_tenant_users(tenant_id: str, current_user: dict = Depends(get_current_user)):
    data = await _cipp_call("GET", "ListUsers", params={"TenantFilter": tenant_id})
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
    await _assert_tenant_scope(current_user, tenant_id, "entra.user.create", request)

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
    result = await _cipp_call("POST", "AddUser", json_body=payload)

    # Audit
    await db.cipp_actions.insert_one({
        "action": "create_user",
        "tenant_id": tenant_id,
        "upn": payload["userPrincipalName"],
        "result_preview": str(result)[:400],
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "result": result}


@router.get("/cipp/tenants/{tenant_id}/licenses")
async def list_tenant_licenses(tenant_id: str, current_user: dict = Depends(get_current_user)):
    data = await _cipp_call("GET", "ListLicenses", params={"TenantFilter": tenant_id})
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
    await _assert_tenant_scope(current_user, tenant_id, "entra.license.modify", request)
    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "userId": user_id,
        "UserId": user_id,
        "addLicenses": (data or {}).get("addLicenses", []),
        "removeLicenses": (data or {}).get("removeLicenses", []),
    }
    result = await _cipp_call("POST", "ExecBulkUserLicense", json_body=payload)
    await db.cipp_actions.insert_one({
        "action": "assign_license",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "add": payload["addLicenses"],
        "remove": payload["removeLicenses"],
        "result_preview": str(result)[:400],
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "result": result}


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/reset-password", dependencies=[Depends(require_action("entra.credential.reset"))])
async def reset_password(tenant_id: str, user_id: str, request: Request, data: dict = None, current_user: dict = Depends(get_current_user)):
    """body: { password?, mustChange?: bool } — password auto-generated if missing."""
    await _assert_tenant_scope(current_user, tenant_id, "entra.credential.reset", request)
    data = data or {}
    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "userId": user_id,
        "UserId": user_id,
        "password": data.get("password", ""),
        "MustChangePass": bool(data.get("mustChange", True)),
    }
    result = await _cipp_call("POST", "ExecResetPass", json_body=payload)
    await db.cipp_actions.insert_one({
        "action": "reset_password",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "result_preview": str(result)[:400],
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "result": result}


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/block-signin", dependencies=[Depends(require_action("entra.user.disable"))])
async def block_signin(tenant_id: str, user_id: str, request: Request, data: dict = None, current_user: dict = Depends(get_current_user)):
    """body: { enable?: bool } — default disables sign-in; set enable=true to unblock."""
    await _assert_tenant_scope(current_user, tenant_id, "entra.user.disable", request)
    data = data or {}
    enable = bool(data.get("enable", False))
    payload = {
        "tenantFilter": tenant_id,
        "TenantFilter": tenant_id,
        "userId": user_id,
        "UserId": user_id,
        "Enable": enable,
    }
    result = await _cipp_call("POST", "ExecDisableUser", json_body=payload)
    await db.cipp_actions.insert_one({
        "action": "unblock_signin" if enable else "block_signin",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "result_preview": str(result)[:400],
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "result": result, "enabled": enable}


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/offboard", dependencies=[Depends(require_action("entra.user.disable"))])
async def offboard_user(tenant_id: str, user_id: str, request: Request, data: dict = None, current_user: dict = Depends(get_current_user)):
    """body: { convertToShared?: bool, removeLicenses?: bool, resetPassword?: bool, revokeSessions?: bool,
               outOfOffice?: str, forwardTo?: str, disableUser?: bool }"""
    await _assert_tenant_scope(current_user, tenant_id, "entra.user.disable", request)
    data = data or {}
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
    result = await _cipp_call("POST", "ExecOffboardUser", json_body=payload)
    await db.cipp_actions.insert_one({
        "action": "offboard_user",
        "tenant_id": tenant_id,
        "user_id": user_id,
        "options": {k: v for k, v in payload.items() if k not in ("tenantFilter", "TenantFilter", "user", "User")},
        "result_preview": str(result)[:400],
        "by": current_user.get("name"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return {"success": True, "result": result}


@router.get("/cipp/summary")
async def cipp_summary(current_user: dict = Depends(get_current_user)):
    """Aggregated dashboard: tenant/user/license counts + linked-client coverage."""
    cfg = await _get_config()
    if not cfg:
        return {"configured": False, "message": "Microsoft tenant provider is not configured"}

    tenants_raw = await _cipp_call("GET", "ListTenants")
    tenants = _norm_tenants(tenants_raw)

    linked = await db.clients.count_documents({"cipp_tenant_id": {"$exists": True, "$ne": ""}})
    clients_total = await db.clients.count_documents({})
    recent_actions = await db.cipp_actions.find({}, {"_id": 0}).sort("timestamp", -1).to_list(10)

    now = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one(
        {"type": SETTINGS_KEY},
        {"$set": {"last_synced_at": now}},
    )
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
        {"cipp_tenant_id": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "name": 1, "cipp_tenant_id": 1, "cipp_tenant_display": 1, "cipp_tenant_domain": 1, "cipp_linked_at": 1},
    )
    return await cursor.to_list(1000)


# --- client linking --------------------------------------------------------

@router.post("/clients/{client_id}/link-cipp-tenant")
async def link_cipp_tenant(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    tenant_id = (data or {}).get("tenant_id")
    tenant_display = (data or {}).get("tenant_display", "")
    tenant_domain = (data or {}).get("tenant_domain", "")
    if not tenant_id:
        raise HTTPException(400, "tenant_id required")
    now = datetime.now(timezone.utc).isoformat()
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {
            "cipp_tenant_id": tenant_id,
            "cipp_tenant_display": tenant_display,
            "cipp_tenant_domain": tenant_domain,
            "cipp_linked_at": now,
        }},
    )
    return {"message": "Microsoft tenant linked to Nexus Control Plane", "client_id": client_id, "tenant_id": tenant_id}


@router.delete("/clients/{client_id}/link-cipp-tenant")
async def unlink_cipp_tenant(client_id: str, current_user: dict = Depends(get_current_user)):
    await db.clients.update_one(
        {"id": client_id},
        {"$unset": {"cipp_tenant_id": "", "cipp_tenant_display": "", "cipp_tenant_domain": "", "cipp_linked_at": ""}},
    )
    return {"message": "Microsoft tenant unlinked from Nexus Control Plane"}


@router.post("/clients/{client_id}/link-suped-tenant")
async def link_suped_tenant(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    tenant_id = (data or {}).get("tenant_id")
    tenant_display = (data or {}).get("tenant_display", "")
    if not tenant_id:
        raise HTTPException(400, "tenant_id required")
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
async def unlink_suped_tenant(client_id: str, current_user: dict = Depends(get_current_user)):
    await db.clients.update_one(
        {"id": client_id},
        {"$unset": {"suped_tenant_id": "", "suped_tenant_display": "", "suped_linked_at": ""}},
    )
    return {"message": "Suped tenant unlinked"}
