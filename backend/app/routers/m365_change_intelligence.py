"""Client-scoped Nexus 365 Change Intelligence API.

The route composes bounded retained evidence only.  It never calls Microsoft
or CIPP and returns no provider result previews, identity targets, credentials,
verification material or arbitrary provider payloads.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.m365_change_intelligence import build_change_intelligence
from app.services.m365_lifecycle import VERIFIED_PROVIDER_SOURCES, stable_tenant_id
from app.services.scope_permissions import assert_client_scope, scoped_query


router = APIRouter(prefix="/m365/change-intelligence", tags=["Nexus 365 Change Intelligence"])

CLIENT_PROJECTION = {
    "_id": 0,
    "id": 1,
    "name": 1,
    "cipp_tenant_id": 1,
    "cipp_tenant_display": 1,
    "cipp_tenant_domain": 1,
}


async def _rows(cursor: Any, limit: int, *, sort: tuple[str, int] | None = None) -> list[dict[str, Any]]:
    if sort:
        cursor = cursor.sort(*sort)
    return await cursor.limit(limit).to_list(limit)


async def _load_evidence(tenant_ids: set[str], client_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    """Load only verified, bounded evidence for resolved Nexus ownership."""
    empty = {
        "tenant_connections": [], "provider_tenants": [], "provider_users": [],
        "provider_groups": [], "provider_licenses": [], "provider_conditional_access": [],
        "provider_security_alerts": [], "provider_intune_devices": [], "cipp_actions": [],
    }
    if not tenant_ids or not client_ids:
        return empty

    tenant_list = sorted(tenant_ids)
    client_list = sorted(client_ids)
    verified_source = {"source": {"$in": sorted(VERIFIED_PROVIDER_SOURCES)}}
    tenant_records = {
        "$and": [
            verified_source,
            {"$or": [{"tenant_id": {"$in": tenant_list}}, {"id": {"$in": tenant_list}}]},
        ]
    }
    tenant_evidence = {"$and": [verified_source, {"tenant_id": {"$in": tenant_list}}]}
    connections, tenants, users, groups, licenses, conditional_access, security_alerts, intune_devices, actions = await asyncio.gather(
        _rows(
            db.m365_tenant_connections.find(
                {"tenant_id": {"$in": tenant_list}},
                {"_id": 0, "tenant_id": 1, "client_id": 1, "graph_verified": 1, "updated_at": 1, "discovered_at": 1},
            ),
            2_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_tenants.find(
                tenant_records,
                {"_id": 0, "id": 1, "tenant_id": 1, "source": 1, "observed_at": 1, "updated_at": 1, "verified_at": 1},
            ),
            2_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_users.find(
                tenant_evidence,
                {"_id": 0, "tenant_id": 1, "source": 1, "observed_at": 1, "updated_at": 1, "synced_at": 1},
            ),
            25_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_groups.find(
                tenant_evidence,
                {"_id": 0, "tenant_id": 1, "source": 1, "observed_at": 1, "updated_at": 1, "synced_at": 1},
            ),
            10_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_licenses.find(
                tenant_evidence,
                {"_id": 0, "tenant_id": 1, "source": 1, "observed_at": 1, "updated_at": 1, "synced_at": 1},
            ),
            10_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_conditional_access_policies.find(
                tenant_evidence,
                {"_id": 0, "tenant_id": 1, "source": 1, "observed_at": 1, "updated_at": 1, "synced_at": 1},
            ),
            10_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_security_alerts.find(
                tenant_evidence,
                {"_id": 0, "tenant_id": 1, "source": 1, "observed_at": 1, "updated_at": 1, "synced_at": 1},
            ),
            10_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_intune_devices.find(
                tenant_evidence,
                {"_id": 0, "tenant_id": 1, "source": 1, "observed_at": 1, "updated_at": 1, "synced_at": 1},
            ),
            25_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.cipp_actions.find(
                {"client_id": {"$in": client_list}, "tenant_id": {"$in": tenant_list}},
                {"_id": 0, "client_id": 1, "tenant_id": 1, "action": 1, "timestamp": 1, "occurred_at": 1, "actor_id": 1, "by": 1, "correlation_id": 1},
            ),
            2_000,
            sort=("timestamp", -1),
        ),
    )
    return {
        "tenant_connections": connections,
        "provider_tenants": tenants,
        "provider_users": users,
        "provider_groups": groups,
        "provider_licenses": licenses,
        "provider_conditional_access": conditional_access,
        "provider_security_alerts": security_alerts,
        "provider_intune_devices": intune_devices,
        "cipp_actions": actions,
    }


async def _portfolio(clients: list[dict[str, Any]]) -> dict[str, Any]:
    tenant_ids = {
        stable_tenant_id(client.get("cipp_tenant_id"))
        for client in clients
        if stable_tenant_id(client.get("cipp_tenant_id"))
    }
    client_ids = {str(client.get("id") or "").strip() for client in clients if str(client.get("id") or "").strip()}
    evidence = await _load_evidence(tenant_ids, client_ids)
    return build_change_intelligence(clients, **evidence)


@router.get("/readiness")
async def change_intelligence_readiness(current_user: dict = Depends(get_current_user)):
    """Return records only for clients visible to the caller's Nexus scope."""
    clients = await _rows(
        db.clients.find(
            scoped_query(current_user, {"id": {"$exists": True, "$ne": ""}}, field="id", site_field=None),
            CLIENT_PROJECTION,
        ),
        2_000,
        sort=("name", 1),
    )
    return await _portfolio(clients)


@router.get("/clients/{client_id}")
async def client_change_intelligence(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Return one client ledger after a server-side client-scope check."""
    client = await db.clients.find_one({"id": str(client_id)}, CLIENT_PROJECTION)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    await assert_client_scope(
        current_user,
        str(client.get("id") or ""),
        operation="m365.change_intelligence.read",
        request=request,
        mask_not_found=True,
    )
    response = await _portfolio([client])
    return response["clients"][0]
