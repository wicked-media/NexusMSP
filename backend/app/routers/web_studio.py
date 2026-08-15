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
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import assert_client_scope, assert_global_scope, assert_record_scope, scoped_query


router = APIRouter(tags=["Nexus Web Studio"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _integration_status() -> dict:
    """Return configuration evidence only - never expose a credential."""
    has_reseller_id = bool(os.environ.get("SYNERGY_WHOLESALE_RESELLER_ID"))
    has_api_key = bool(os.environ.get("SYNERGY_WHOLESALE_API_KEY"))
    return {
        "provider": "synergy_wholesale",
        "display_name": "Synergy Wholesale",
        "transport": "SOAP/WSDL",
        "endpoint": "https://api.synergywholesale.com",
        "configured": has_reseller_id and has_api_key,
        "readiness": "ready_for_server_connector" if has_reseller_id and has_api_key else "credentials_and_source_ip_required",
        "required": [
            "Server-side reseller ID",
            "Server-side API key",
            "Synergy API source-IP allowlisting",
        ],
        "capabilities": [
            "Domain inventory, renewal and transfer workflow",
            "DNS zones, records, DNSSEC and forwarding",
            "Hosting/cPanel lifecycle and temporary preview URLs",
            "SSL lifecycle and certificate validation",
            "Microsoft 365 subscription lifecycle",
        ],
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
    notes: str | None = Field(default=None, max_length=4000)


class ProviderAction(BaseModel):
    action: Literal["sync_inventory", "hosting_login", "temporary_preview", "dns_change_plan", "renewal_plan"]
    reason: str = Field(default="", max_length=500)


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


@router.get("/web-studio/integrations/synergy-wholesale")
async def get_synergy_status(user: dict = Depends(get_current_user)):
    await assert_global_scope(user, operation="web_studio.integration.read")
    return _integration_status()
