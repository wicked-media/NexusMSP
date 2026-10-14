"""Client-scoped Nexus 365 access-governance readiness API.

This API only composes retained, verified provider observations.  It neither
calls Microsoft/CIPP nor creates an entitlement, approval, ticket or audit
record; governed Control Plane actions remain the only execution path.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.m365_access_governance import build_access_governance
from app.services.m365_lifecycle import VERIFIED_PROVIDER_SOURCES, stable_tenant_id
from app.services.scope_permissions import assert_client_scope, scoped_query


router = APIRouter(prefix="/m365/access-governance", tags=["Nexus 365 Access Governance"])

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


async def _load_provider_evidence(tenant_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    """Load only evidence whose stable tenant owner was resolved in Nexus."""
    if not tenant_ids:
        return {
            "tenant_connections": [], "provider_tenants": [], "provider_users": [],
            "provider_groups": [], "provider_guests": [], "provider_gdap": [],
        }

    tenant_list = sorted(tenant_ids)
    verified_source = {"source": {"$in": sorted(VERIFIED_PROVIDER_SOURCES)}}
    provider_tenant_query = {
        "$and": [
            verified_source,
            {"$or": [{"tenant_id": {"$in": tenant_list}}, {"id": {"$in": tenant_list}}]},
        ]
    }
    provider_evidence_query = {
        "$and": [verified_source, {"tenant_id": {"$in": tenant_list}}]
    }
    connections, tenants, users, groups, guests, gdap = await asyncio.gather(
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
                provider_tenant_query,
                {"_id": 0, "id": 1, "tenant_id": 1, "source": 1, "updated_at": 1, "observed_at": 1},
            ),
            2_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_users.find(
                provider_evidence_query,
                {
                    "_id": 0, "id": 1, "tenant_id": 1, "source": 1, "account_enabled": 1,
                    "accountEnabled": 1, "enabled": 1, "is_admin": 1, "isAdmin": 1,
                    "assigned_roles": 1, "assignedRoles": 1, "directory_roles": 1,
                    "directoryRoles": 1, "roles": 1, "memberOf": 1, "observed_at": 1,
                    "updated_at": 1, "synced_at": 1,
                },
            ),
            25_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_groups.find(
                provider_evidence_query,
                {
                    "_id": 0, "id": 1, "tenant_id": 1, "source": 1,
                    "is_assignable_to_role": 1, "isAssignableToRole": 1, "role_assignable": 1,
                    "members": 1, "member_ids": 1, "memberIds": 1, "member_count": 1,
                    "memberCount": 1, "observed_at": 1, "updated_at": 1, "synced_at": 1,
                },
            ),
            10_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_guest_users.find(
                provider_evidence_query,
                {
                    "_id": 0, "id": 1, "tenant_id": 1, "source": 1,
                    "last_sign_in": 1, "lastSignInDateTime": 1, "last_sign_in_at": 1,
                    "lastSignIn": 1, "observed_at": 1, "updated_at": 1, "created_at": 1,
                    "createdDateTime": 1,
                },
            ),
            25_000,
            sort=("updated_at", -1),
        ),
        _rows(
            db.m365_gdap.find(
                provider_evidence_query,
                {
                    "_id": 0, "id": 1, "tenant_id": 1, "source": 1,
                    "expires_in_days": 1, "expiresInDays": 1, "expires_at": 1,
                    "expiresAt": 1, "end_date": 1, "endDateTime": 1, "observed_at": 1,
                    "updated_at": 1,
                },
            ),
            10_000,
            sort=("updated_at", -1),
        ),
    )
    return {
        "tenant_connections": connections,
        "provider_tenants": tenants,
        "provider_users": users,
        "provider_groups": groups,
        "provider_guests": guests,
        "provider_gdap": gdap,
    }


async def _readiness_for_clients(clients: list[dict[str, Any]]) -> dict[str, Any]:
    tenant_ids = {
        stable_tenant_id(client.get("cipp_tenant_id"))
        for client in clients
        if stable_tenant_id(client.get("cipp_tenant_id"))
    }
    evidence = await _load_provider_evidence(tenant_ids)
    return build_access_governance(clients, **evidence)


@router.get("/readiness")
async def access_governance_readiness(current_user: dict = Depends(get_current_user)):
    """Return access-governance evidence only for the caller's permitted clients."""
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
async def client_access_governance_readiness(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Return one client evidence pack after server-side scope enforcement."""
    client = await db.clients.find_one({"id": str(client_id)}, CLIENT_PROJECTION)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    await assert_client_scope(
        current_user,
        str(client.get("id") or ""),
        operation="m365.access_governance.read",
        request=request,
        mask_not_found=True,
    )
    response = await _readiness_for_clients([client])
    return response["clients"][0]
