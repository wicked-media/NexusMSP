"""Nexus Web Studio - governed website, hosting and domain delivery records.

Synergy Wholesale exposes a SOAP API for domains, DNS, hosting/cPanel, SSL and
Microsoft 365 subscriptions.  This router deliberately owns the Nexus side of
the workflow first.  It does not accept or return reseller credentials and it
does not perform a live provider mutation until a server-side connector has
been configured and approved.
"""
from __future__ import annotations

import os
import uuid
import base64
import ipaddress
import socket
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
import httpx
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.routers.approval_workflows import create_approval
from app.services.action_permissions import require_action
from app.services.scope_permissions import assert_client_scope, assert_global_scope, assert_record_scope, scoped_query
from app.services.synergy_wholesale import SYNERGY_OPERATIONS, connector_status, execute as execute_synergy, public_catalogue, seal_action_parameters, unseal_action_parameters, validate_parameters


router = APIRouter(tags=["Nexus Web Studio"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _integration_status() -> dict:
    """Return configuration evidence only - never expose a credential."""
    has_reseller_id = bool(os.environ.get("SYNERGY_WHOLESALE_RESELLER_ID"))
    has_api_key = bool(os.environ.get("SYNERGY_WHOLESALE_API_KEY"))
    connector = connector_status()
    return {
        "provider": "synergy_wholesale",
        "display_name": "Synergy Wholesale",
        "transport": "SOAP/WSDL",
        "endpoint": "https://api.synergywholesale.com",
        "configured": has_reseller_id and has_api_key,
        "readiness": "ready" if connector["ready"] else "credentials_source_ip_wsdl_and_client_required",
        "required": [
            "Server-side reseller ID",
            "Server-side API key",
            "Synergy API source-IP allowlisting",
            "Server-side WSDL URL",
        ],
        "capabilities": [
            "Domain inventory, renewal and transfer workflow",
            "DNS zones, records, DNSSEC and forwarding",
            "Hosting/cPanel lifecycle and temporary preview URLs",
            "SSL lifecycle and certificate validation",
            "Microsoft 365 subscription lifecycle",
        ],
        "catalogue_operations": len(SYNERGY_OPERATIONS),
    }


class WebSiteInput(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=160)
    primary_domain: str = Field(min_length=3, max_length=253)
    site_url: str = Field(default="", max_length=2048)
    platform: Literal["wordpress", "static", "custom", "other"] = "wordpress"
    stage: Literal["discovery", "design", "build", "review", "launch", "live", "maintenance"] = "discovery"
    hosting_provider: str = Field(default="synergy_wholesale", max_length=100)
    hosting_identifier: str = Field(default="", max_length=300)
    wordpress_version: str = Field(default="", max_length=60)
    php_version: str = Field(default="", max_length=60)
    owner_name: str = Field(default="", max_length=160)
    renewal_date: str = Field(default="", max_length=40)
    service_plan: str = Field(default="", max_length=160)
    agreement_id: str = Field(default="", max_length=200)
    billing_status: Literal["not_linked", "included", "billable", "suspended"] = "not_linked"
    monthly_fee: float = Field(default=0, ge=0, le=1000000)
    notes: str = Field(default="", max_length=4000)


class WebSiteUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    site_url: str | None = Field(default=None, max_length=2048)
    platform: Literal["wordpress", "static", "custom", "other"] | None = None
    stage: Literal["discovery", "design", "build", "review", "launch", "live", "maintenance"] | None = None
    hosting_provider: str | None = Field(default=None, max_length=100)
    hosting_identifier: str | None = Field(default=None, max_length=300)
    wordpress_version: str | None = Field(default=None, max_length=60)
    php_version: str | None = Field(default=None, max_length=60)
    owner_name: str | None = Field(default=None, max_length=160)
    renewal_date: str | None = Field(default=None, max_length=40)
    service_plan: str | None = Field(default=None, max_length=160)
    agreement_id: str | None = Field(default=None, max_length=200)
    billing_status: Literal["not_linked", "included", "billable", "suspended"] | None = None
    monthly_fee: float | None = Field(default=None, ge=0, le=1000000)
    notes: str | None = Field(default=None, max_length=4000)


class ProviderAction(BaseModel):
    action: Literal["sync_inventory", "hosting_login", "temporary_preview", "dns_change_plan", "renewal_plan"]
    reason: str = Field(default="", max_length=500)


class SynergyActionRequest(BaseModel):
    """A governed operation from the documented Synergy Wholesale catalogue."""
    operation_id: str = Field(min_length=3, max_length=100)
    client_id: str = Field(min_length=1, max_length=200)
    parameters: dict = Field(default_factory=dict)
    reason: str = Field(min_length=8, max_length=1000)


class WordPressConnectionInput(BaseModel):
    api_url: str = Field(min_length=10, max_length=2048)
    username: str = Field(min_length=1, max_length=160)
    application_password: str = Field(min_length=8, max_length=500)


class WordPressActionInput(BaseModel):
    action: Literal["inventory", "plugin_update", "theme_update", "core_update", "backup_and_update"]
    target: str = Field(default="", max_length=300)
    reason: str = Field(min_length=8, max_length=1000)


def _redacted_parameters(parameters: dict) -> dict:
    return {
        key: "[entered securely]" if any(word in key.lower() for word in ("password", "secret", "token")) else value
        for key, value in parameters.items()
    }


def _redact_provider_value(value):
    """Persist useful evidence but never expose credential-shaped values."""
    if isinstance(value, dict):
        return {key: "[redacted]" if any(word in key.lower() for word in ("key", "secret", "password", "token")) else _redact_provider_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_provider_value(item) for item in value]
    return value


def _web_secret_key() -> bytes:
    key = os.environ.get("WEB_STUDIO_ENCRYPTION_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Web Studio credential encryption is not configured")
    return key.encode()


def _seal_web_secret(value: str) -> str:
    try:
        from cryptography.fernet import Fernet
        return Fernet(_web_secret_key()).encrypt(value.encode()).decode()
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Web Studio credential encryption key is invalid") from exc


def _open_web_secret(value: str) -> str:
    try:
        from cryptography.fernet import Fernet
        return Fernet(_web_secret_key()).decrypt(value.encode()).decode()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The WordPress connection credential is unavailable") from exc


def _wordpress_api_url(value: str) -> str:
    clean = value.strip().rstrip("/")
    if not clean.startswith("https://"):
        raise HTTPException(status_code=400, detail="WordPress management connections must use HTTPS")
    parsed = urlparse(clean)
    host = parsed.hostname
    if not host or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise HTTPException(status_code=400, detail="WordPress connection URL must use a public HTTPS host")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise HTTPException(status_code=400, detail="WordPress connection host could not be resolved") from exc
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise HTTPException(status_code=400, detail="WordPress management connections cannot target private or reserved network addresses")
    return clean if clean.endswith("/wp-json") else f"{clean}/wp-json"


async def _wordpress_inventory(site: dict) -> dict:
    connection = site.get("wordpress_connection") or {}
    if not connection.get("api_url") or not connection.get("username") or not connection.get("application_password_encrypted"):
        raise HTTPException(status_code=409, detail="Link a secured WordPress management connection before syncing inventory")
    password = _open_web_secret(connection["application_password_encrypted"])
    basic = base64.b64encode(f"{connection['username']}:{password}".encode()).decode()
    headers = {"Authorization": f"Basic {basic}"}
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            root = await client.get(connection["api_url"], headers=headers)
            root.raise_for_status()
            plugins = await client.get(f"{connection['api_url']}/wp/v2/plugins?context=edit&per_page=100", headers=headers)
            plugin_data = plugins.json() if plugins.status_code == 200 else []
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Nexus could not reach the secured WordPress REST endpoint") from exc
    return {"connected": True, "synced_at": _now(), "plugins": [
        {"plugin": item.get("plugin"), "name": item.get("name"), "version": item.get("version"), "status": item.get("status"), "update": item.get("update")}
        for item in plugin_data if isinstance(item, dict)
    ], "plugin_inventory_available": plugins.status_code == 200}


async def _site_or_404(site_id: str, user: dict, operation: str) -> dict:
    return await assert_record_scope(
        user,
        db.web_sites,
        site_id,
        operation=operation,
        resource_name="Web site",
    )


@router.get("/web-studio/overview")
async def get_web_studio_overview(client_id: str | None = None, user: dict = Depends(get_current_user)):
    query: dict = {"archived_at": {"$exists": False}}
    if client_id:
        await assert_client_scope(user, client_id, operation="web_studio.read")
        query["client_id"] = client_id
    sites = await db.web_sites.find(scoped_query(user, query), {"_id": 0}).sort("updated_at", -1).to_list(1000)
    counts = {stage: sum(1 for site in sites if site.get("stage") == stage) for stage in ("discovery", "design", "build", "review", "launch", "live", "maintenance")}
    return {
        "sites": sites,
        "summary": {"total": len(sites), "live": counts["live"], "in_delivery": sum(counts[s] for s in ("design", "build", "review", "launch")), "maintenance": counts["maintenance"]},
        "stages": counts,
        "synergy": _integration_status(),
    }


@router.post("/web-studio/sites")
async def create_web_site(payload: WebSiteInput, user: dict = Depends(get_current_user)):
    await assert_client_scope(user, payload.client_id, operation="web_studio.create")
    client = await db.clients.find_one({"id": payload.client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(404, "Client not found")
    now = _now()
    site = {
        "id": str(uuid.uuid4()),
        **payload.model_dump(),
        "primary_domain": payload.primary_domain.lower().strip().rstrip("."),
        "client_name": client.get("name") or "Unnamed client",
        "created_at": now,
        "updated_at": now,
        "created_by": user.get("email") or user.get("id"),
        "last_provider_sync_at": None,
    }
    await db.web_sites.insert_one(site)
    return {key: value for key, value in site.items() if key != "_id"}


@router.patch("/web-studio/sites/{site_id}")
async def update_web_site(site_id: str, payload: WebSiteUpdate, user: dict = Depends(get_current_user)):
    await _site_or_404(site_id, user, "web_studio.update")
    update = {key: value for key, value in payload.model_dump().items() if value is not None}
    update.update({"updated_at": _now(), "updated_by": user.get("email") or user.get("id")})
    await db.web_sites.update_one({"id": site_id}, {"$set": update})
    return await db.web_sites.find_one({"id": site_id}, {"_id": 0})


@router.delete("/web-studio/sites/{site_id}")
async def archive_web_site(site_id: str, user: dict = Depends(get_current_user)):
    await _site_or_404(site_id, user, "web_studio.archive")
    await db.web_sites.update_one({"id": site_id}, {"$set": {"archived_at": _now(), "archived_by": user.get("email") or user.get("id")}})
    return {"ok": True}


@router.post("/web-studio/sites/{site_id}/provider-actions")
async def request_provider_action(site_id: str, payload: ProviderAction, user: dict = Depends(get_current_user)):
    site = await _site_or_404(site_id, user, "web_studio.provider_action")
    action = {
        "id": str(uuid.uuid4()),
        "site_id": site_id,
        "client_id": site.get("client_id"),
        "provider": "synergy_wholesale",
        "action": payload.action,
        "reason": payload.reason.strip(),
        "status": "pending_connector" if not _integration_status()["configured"] else "pending_approval",
        "created_at": _now(),
        "requested_by": user.get("email") or user.get("id"),
    }
    await db.web_provider_actions.insert_one(action)
    return {"action": {key: value for key, value in action.items() if key != "_id"}, "connector": _integration_status()}


@router.post("/web-studio/sites/{site_id}/wordpress/connect")
async def connect_wordpress_site(site_id: str, payload: WordPressConnectionInput, user: dict = Depends(require_action("synergy.wholesale.manage"))):
    """Store a WordPress application password encrypted at rest, never in the UI."""
    await _site_or_404(site_id, user, "web_studio.wordpress.connect")
    api_url = _wordpress_api_url(payload.api_url)
    connection = {
        "api_url": api_url,
        "username": payload.username.strip(),
        "application_password_encrypted": _seal_web_secret(payload.application_password),
        "connected_at": _now(),
        "connected_by": user.get("email") or user.get("id"),
    }
    await db.web_sites.update_one({"id": site_id}, {"$set": {"wordpress_connection": connection, "updated_at": _now(), "updated_by": user.get("email") or user.get("id")}})
    return {"site_id": site_id, "connected": True, "api_url": api_url, "username": connection["username"]}


@router.post("/web-studio/sites/{site_id}/wordpress/actions")
async def request_wordpress_action(site_id: str, payload: WordPressActionInput, user: dict = Depends(require_action("synergy.wholesale.manage"))):
    """Inventory is read-only; all update work is independently approved."""
    site = await _site_or_404(site_id, user, "web_studio.wordpress.action")
    if site.get("platform") != "wordpress":
        raise HTTPException(status_code=409, detail="This site is not recorded as a WordPress site")
    if payload.action == "inventory":
        inventory = await _wordpress_inventory(site)
        await db.web_sites.update_one({"id": site_id}, {"$set": {"wordpress_inventory": inventory, "last_wordpress_sync_at": inventory["synced_at"], "updated_at": _now()}})
        return inventory
    action = {
        "id": str(uuid.uuid4()), "provider": "wordpress", "site_id": site_id, "client_id": site.get("client_id"),
        "client_name": site.get("client_name"), "action": payload.action, "target": payload.target.strip(),
        "reason": payload.reason.strip(), "status": "pending_approval", "created_at": _now(),
        "requested_by": user.get("email") or user.get("id"), "requested_by_id": user.get("id"),
        "execution_mode": "nexus_wordpress_control_worker_required",
    }
    await db.web_provider_actions.insert_one(action)
    approval = await create_approval({
        "type": "wordpress_update", "title": f"WordPress: {payload.action.replace('_', ' ')}",
        "description": payload.reason.strip(), "client_id": site.get("client_id"), "client_name": site.get("client_name", ""),
        "ref_id": action["id"], "ref_type": "web_provider_action", "approver_role": "admin",
    }, user)
    await db.web_provider_actions.update_one({"id": action["id"]}, {"$set": {"approval_id": approval["id"]}})
    return {"action": {**action, "approval_id": approval["id"]}, "approval": approval,
            "message": "Update is awaiting approval and a Nexus WordPress Control worker; no WordPress change has been made."}


@router.get("/web-studio/sites/{site_id}/management")
async def get_wordpress_management(site_id: str, user: dict = Depends(get_current_user)):
    site = await _site_or_404(site_id, user, "web_studio.wordpress.read")
    connection = site.get("wordpress_connection") or {}
    inventory = site.get("wordpress_inventory") or {}
    actions = await db.web_provider_actions.find(scoped_query(user, {"site_id": site_id, "provider": "wordpress"}), {"_id": 0, "parameters_encrypted": 0}).sort("created_at", -1).to_list(50)
    return {"site_id": site_id, "client_id": site.get("client_id"), "billing": {key: site.get(key) for key in ("service_plan", "agreement_id", "billing_status", "monthly_fee", "renewal_date")},
            "connection": {"connected": bool(connection), "api_url": connection.get("api_url"), "username": connection.get("username")}, "inventory": inventory, "actions": actions}


@router.get("/web-studio/integrations/synergy-wholesale")
async def get_synergy_status(user: dict = Depends(get_current_user)):
    await assert_global_scope(user, operation="web_studio.integration.read")
    return _integration_status()


@router.get("/web-studio/integrations/synergy-wholesale/catalogue")
async def get_synergy_catalogue(user: dict = Depends(get_current_user)):
    """Expose the fixed v3.17 Nexus capability map, never raw SOAP methods."""
    await assert_global_scope(user, operation="web_studio.integration.read")
    return {"provider": "synergy_wholesale", "operations": public_catalogue(), "connector": _integration_status()}


@router.post("/web-studio/integrations/synergy-wholesale/actions")
async def create_synergy_action(payload: SynergyActionRequest, user: dict = Depends(require_action("synergy.wholesale.manage"))):
    """Execute safe reads now; route every provider change through approval."""
    operation = SYNERGY_OPERATIONS.get(payload.operation_id)
    if not operation:
        raise HTTPException(status_code=400, detail="That Synergy Wholesale operation is not in the Nexus capability catalogue")
    await assert_client_scope(user, payload.client_id, operation="synergy.action.create")
    client = await db.clients.find_one({"id": payload.client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    parameters = validate_parameters(payload.parameters)
    now = _now()
    action = {
        "id": str(uuid.uuid4()), "provider": "synergy_wholesale", "operation_id": payload.operation_id,
        "provider_command": operation["command"], "area": operation["area"], "client_id": payload.client_id,
        "client_name": client.get("name") or "Unnamed client", "parameters": _redacted_parameters(parameters),
        "reason": payload.reason.strip(), "status": "pending_execution" if not operation["mutates"] else "pending_approval",
        "created_at": now, "requested_by": user.get("email") or user.get("id"), "requested_by_id": user.get("id"),
    }
    if operation["mutates"]:
        action["parameters_encrypted"] = seal_action_parameters(parameters)
    await db.web_provider_actions.insert_one(action)
    if operation["mutates"]:
        approval = await create_approval({
            "type": "synergy_wholesale", "title": f"Synergy: {payload.operation_id.replace('.', ' ')}",
            "description": payload.reason.strip(), "client_id": payload.client_id, "client_name": action["client_name"],
            "ref_id": action["id"], "ref_type": "web_provider_action", "approver_role": "admin",
        }, user)
        await db.web_provider_actions.update_one({"id": action["id"]}, {"$set": {"approval_id": approval["id"]}})
        action["approval_id"] = approval["id"]
        return {"action": action, "approval": approval, "message": "Provider change is awaiting independent approval"}
    result = execute_synergy(payload.operation_id, parameters)
    safe_result = _redact_provider_value(result)
    await db.web_provider_actions.update_one({"id": action["id"]}, {"$set": {"status": "completed", "completed_at": _now(), "result": safe_result}})
    return {"action": {**action, "status": "completed"}, "result": safe_result}


@router.post("/web-studio/integrations/synergy-wholesale/actions/{action_id}/execute")
async def execute_approved_synergy_action(action_id: str, user: dict = Depends(require_action("synergy.wholesale.manage"))):
    """Perform a previously approved commercial/configuration action exactly once."""
    await assert_global_scope(user, operation="synergy.action.execute")
    action = await assert_record_scope(user, db.web_provider_actions, action_id, operation="synergy.action.execute", resource_name="Synergy action")
    if action.get("status") not in {"pending_approval", "approved_execution_failed"}:
        raise HTTPException(status_code=409, detail="This Synergy action is not awaiting approved execution")
    approval = await db.approvals.find_one({"id": action.get("approval_id"), "ref_id": action_id, "status": "approved"}, {"_id": 0})
    if not approval:
        raise HTTPException(status_code=409, detail="An independent approval is required before Synergy executes this action")
    await db.web_provider_actions.update_one({"id": action_id, "status": "pending_approval"}, {"$set": {"status": "executing", "execution_started_at": _now(), "executed_by": user.get("email") or user.get("id")}})
    try:
        result = execute_synergy(action["operation_id"], unseal_action_parameters(action.get("parameters_encrypted", "")))
    except HTTPException:
        await db.web_provider_actions.update_one({"id": action_id}, {"$set": {"status": "approved_execution_failed", "failed_at": _now()}})
        raise
    safe_result = _redact_provider_value(result)
    await db.web_provider_actions.update_one({"id": action_id}, {"$set": {"status": "completed", "completed_at": _now(), "result": safe_result}})
    return {"id": action_id, "status": "completed", "result": safe_result}
