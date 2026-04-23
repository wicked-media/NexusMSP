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
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
from typing import Optional
import httpx

from app.database import db
from app.auth import get_current_user

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
        raise HTTPException(503, "CIPP not configured")
    base = cfg["base_url"].rstrip("/")
    url = f"{base}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=45.0) as c:
            r = await c.request(method, url, headers=_headers(cfg), params=params or {}, json=json_body)
    except httpx.TimeoutException:
        raise HTTPException(504, "CIPP timeout")
    except httpx.RequestError as e:
        raise HTTPException(503, f"CIPP unreachable: {str(e)[:120]}")
    if r.status_code == 401:
        raise HTTPException(401, "CIPP auth failed — check API key")
    if r.status_code == 429:
        raise HTTPException(429, "CIPP rate-limit hit")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"CIPP error: {r.text[:300]}")
    try:
        return r.json() if r.content else {}
    except Exception:
        return {"raw": r.text}


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
    return {"message": "CIPP settings saved"}


@router.delete("/cipp/settings")
async def clear_settings(current_user: dict = Depends(get_current_user)):
    await db.settings.delete_one({"type": SETTINGS_KEY})
    return {"message": "CIPP credentials removed"}


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


@router.post("/cipp/tenants/{tenant_id}/users")
async def create_user(tenant_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """
    body: { displayName, userPrincipalName, mailNickname, password, firstName?, lastName?,
            usageLocation?: 'AU', licenses?: ['SKU_ID'] }
    """
    required = ["displayName", "userPrincipalName", "password"]
    missing = [k for k in required if not (data or {}).get(k)]
    if missing:
        raise HTTPException(400, f"Missing fields: {', '.join(missing)}")

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


@router.post("/cipp/tenants/{tenant_id}/users/{user_id}/assign-license")
async def assign_license(tenant_id: str, user_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """body: { addLicenses: ['SKU_ID', ...], removeLicenses: ['SKU_ID'] }"""
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
    return {"message": "CIPP tenant linked", "client_id": client_id, "tenant_id": tenant_id}


@router.delete("/clients/{client_id}/link-cipp-tenant")
async def unlink_cipp_tenant(client_id: str, current_user: dict = Depends(get_current_user)):
    await db.clients.update_one(
        {"id": client_id},
        {"$unset": {"cipp_tenant_id": "", "cipp_tenant_display": "", "cipp_tenant_domain": "", "cipp_linked_at": ""}},
    )
    return {"message": "CIPP tenant unlinked"}


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
