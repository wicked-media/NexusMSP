"""Client-scoped, read-only Nexus 365 employee lifecycle readiness API.

This router intentionally does not invoke CIPP/Graph, create a ticket, or
change commercial records.  It composes only retained Nexus mappings and
already-collected provider evidence, then returns safe navigation metadata for
the governed workflows that own any future action.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.m365_lifecycle import (
    LIFECYCLE_ACTIONS,
    VERIFIED_PROVIDER_SOURCES,
    build_lifecycle_readiness,
    stable_tenant_id,
)
from app.services.scope_permissions import assert_client_scope, scoped_query


router = APIRouter(prefix="/m365/lifecycle", tags=["Nexus 365 Lifecycle"])

CLIENT_PROJECTION = {
    "_id": 0,
    "id": 1,
    "name": 1,
    "cipp_tenant_id": 1,
    "cipp_tenant_display": 1,
    "cipp_tenant_domain": 1,
    "cipp_linked_at": 1,
}


async def _rows(cursor: Any, limit: int, *, sort: tuple[str, int] | None = None) -> list[dict[str, Any]]:
    if sort:
        cursor = cursor.sort(*sort)
    cursor = cursor.limit(limit)
    return await cursor.to_list(limit)


async def _load_provider_evidence(tenant_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    """Read bounded cached evidence only for client-linked stable tenant IDs."""
    if not tenant_ids:
        return {
            "tenant_connections": [],
            "provider_tenants": [],
            "provider_users": [],
            "provider_licenses": [],
            "cipp_actions": [],
        }

    tenant_list = sorted(tenant_ids)
    verified_source_query = {"source": {"$in": sorted(VERIFIED_PROVIDER_SOURCES)}}
    provider_tenant_query = {
        "$and": [
            verified_source_query,
            {"$or": [{"tenant_id": {"$in": tenant_list}}, {"id": {"$in": tenant_list}}]},
        ]
    }
    provider_evidence_query = {
        "$and": [
            verified_source_query,
            {"tenant_id": {"$in": tenant_list}},
        ]
    }
    action_query = {
        "tenant_id": {"$in": tenant_list},
        "action": {"$in": sorted(LIFECYCLE_ACTIONS)},
    }
    connections, tenants, users, licenses, actions = await asyncio.gather(
        _rows(
            db.m365_tenant_connections.find(
                {"tenant_id": {"$in": tenant_list}},
                {"_id": 0, "tenant_id": 1, "client_id": 1, "consent_method": 1, "graph_verified": 1, "discovery_status": 1, "updated_at": 1, "discovered_at": 1},
            ),
            2_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_tenants.find(
                provider_tenant_query,
                {"_id": 0, "id": 1, "tenant_id": 1, "source": 1, "verified_at": 1, "updated_at": 1},
            ),
            2_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_users.find(
                provider_evidence_query,
                {"_id": 0, "tenant_id": 1, "source": 1, "account_enabled": 1, "accountEnabled": 1, "enabled": 1, "assigned_licenses": 1, "assignedLicenses": 1, "licenses": 1, "updated_at": 1, "observed_at": 1, "synced_at": 1},
            ),
            25_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_licenses.find(
                provider_evidence_query,
                {"_id": 0, "tenant_id": 1, "source": 1, "total_units": 1, "enabled_units": 1, "prepaid_units": 1, "consumed_units": 1, "consumedUnits": 1, "updated_at": 1, "observed_at": 1, "synced_at": 1},
            ),
            10_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.cipp_actions.find(
                action_query,
                {"_id": 0, "tenant_id": 1, "action": 1, "timestamp": 1},
            ),
            1_000,
            sort=("timestamp", -1),
        ),
    )
    return {
        "tenant_connections": connections,
        "provider_tenants": tenants,
        "provider_users": users,
        "provider_licenses": licenses,
        "cipp_actions": actions,
    }


async def _readiness_for_clients(clients: list[dict[str, Any]]) -> dict[str, Any]:
    evidence = await _load_provider_evidence(
        {stable_tenant_id(client.get("cipp_tenant_id")) for client in clients if stable_tenant_id(client.get("cipp_tenant_id"))}
    )
    return build_lifecycle_readiness(clients, **evidence)


@router.get("/readiness")
async def lifecycle_readiness(current_user: dict = Depends(get_current_user)):
    """Return lifecycle readiness only for clients visible to the caller."""
    clients = await _rows(
        db.clients.find(
            scoped_query(current_user, {"id": {"$exists": True, "$ne": ""}}, field="id", site_field=None),
            CLIENT_PROJECTION,
        ),
        2_000,
        sort=("name", 1),
    )
    return await _readiness_for_clients(clients)


@router.get("/clients/{client_id}")
async def client_lifecycle_readiness(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Return one client lifecycle evidence pack after server-side scope proof."""
    client = await db.clients.find_one({"id": str(client_id)}, CLIENT_PROJECTION)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    await assert_client_scope(
        current_user,
        str(client.get("id") or ""),
        operation="m365.lifecycle.read",
        request=request,
        mask_not_found=True,
    )
    response = await _readiness_for_clients([client])
    return response["clients"][0]
