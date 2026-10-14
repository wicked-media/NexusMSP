"""Resolve Microsoft provider evidence through Nexus-owned client mappings.

Microsoft's ``tenant_id`` identifies an Entra tenant, not the Nexus platform
tenant.  This module therefore establishes platform visibility from Nexus
clients first, then uses stable mapped provider tenant IDs for Graph/Partner
Center evidence.  It deliberately fails closed if the mapping is missing or
ambiguous.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from app.database import db as default_db
from app.services.scope_permissions import (
    effective_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)


VERIFIED_M365_SOURCES = ("m365_graph", "m365_partner_center")


def _identifier(value: Any) -> str:
    return str(value or "").strip()


def _verified_source_query(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    source = {"source": {"$in": list(VERIFIED_M365_SOURCES)}}
    if not extra:
        return source
    return {"$and": [source, dict(extra)]}


def _mapped_provider_tenant_ids(
    clients: list[dict[str, Any]],
    connections: list[dict[str, Any]],
    provider_tenants: list[dict[str, Any]],
) -> set[str]:
    """Return only provider IDs with one unambiguous Nexus-client owner."""
    allowed_clients = {
        _identifier(client.get("id"))
        for client in clients
        if _identifier(client.get("id"))
    }
    candidates: dict[str, set[str]] = defaultdict(set)

    def add(tenant_id: Any, client_id: Any) -> None:
        tenant = _identifier(tenant_id)
        client = _identifier(client_id)
        if tenant and client:
            candidates[tenant].add(client)

    for client in clients:
        for field in ("cipp_tenant_id", "m365_tenant_id", "office365_tenant_id"):
            add(client.get(field), client.get("id"))
    for connection in connections:
        add(connection.get("tenant_id") or connection.get("tenantId"), connection.get("client_id"))
    for tenant in provider_tenants:
        add(tenant.get("tenant_id") or tenant.get("tenantId"), tenant.get("client_id"))
        # ``id`` is an established legacy alias for a provider tenant record.
        add(tenant.get("id"), tenant.get("client_id"))

    return {
        tenant_id
        for tenant_id, owners in candidates.items()
        if len(owners) == 1 and next(iter(owners)) in allowed_clients
    }


async def visible_m365_provider_tenant_ids(
    current_user: dict[str, Any],
    *,
    database: Any | None = None,
) -> set[str] | None:
    """Resolve Entra tenant IDs visible to the actor's Nexus platform tenant.

    ``None`` preserves the documented single-installation ``nexus-local``
    administrator compatibility path.  Every explicitly platform-bound actor
    receives a finite set derived from platform-scoped Nexus clients; an empty
    set deliberately means no provider evidence may be returned.
    """
    if platform_tenant_id(current_user) == "nexus-local" and effective_scope(current_user)["mode"] == "all":
        return None

    # PyMongo Database deliberately rejects truth-value testing. Keep injected
    # databases explicit so production and test stores follow the same path.
    store = database if database is not None else default_db
    clients = await store.clients.find(
        tenant_scoped_query(
            current_user,
            scoped_query(current_user, {}, field="id", site_field=None),
        ),
        {
            "_id": 0,
            "id": 1,
            "cipp_tenant_id": 1,
            "m365_tenant_id": 1,
            "office365_tenant_id": 1,
        },
    ).to_list(2_000)
    client_ids = sorted(
        {
            _identifier(client.get("id"))
            for client in clients
            if _identifier(client.get("id"))
        }
    )
    if not client_ids:
        return set()

    connections, provider_tenants = await asyncio.gather(
        store.m365_tenant_connections.find(
            {"client_id": {"$in": client_ids}},
            {"_id": 0, "tenant_id": 1, "tenantId": 1, "client_id": 1},
        ).to_list(2_000),
        store.m365_tenants.find(
            _verified_source_query({"client_id": {"$in": client_ids}}),
            {"_id": 0, "id": 1, "tenant_id": 1, "tenantId": 1, "client_id": 1},
        ).to_list(2_000),
    )
    candidate_ids = {
        _identifier(client.get(field))
        for client in clients
        for field in ("cipp_tenant_id", "m365_tenant_id", "office365_tenant_id")
        if _identifier(client.get(field))
    }
    candidate_ids.update(
        _identifier(connection.get("tenant_id") or connection.get("tenantId"))
        for connection in connections
        if _identifier(connection.get("tenant_id") or connection.get("tenantId"))
    )
    candidate_ids.update(
        _identifier(tenant.get(field))
        for tenant in provider_tenants
        for field in ("tenant_id", "tenantId", "id")
        if _identifier(tenant.get(field))
    )
    if not candidate_ids:
        return set()

    identifiers = sorted(candidate_ids)
    all_connections, all_provider_tenants = await asyncio.gather(
        store.m365_tenant_connections.find(
            {"$or": [{"tenant_id": {"$in": identifiers}}, {"tenantId": {"$in": identifiers}}]},
            {"_id": 0, "tenant_id": 1, "tenantId": 1, "client_id": 1},
        ).to_list(2_000),
        store.m365_tenants.find(
            _verified_source_query(
                {
                    "$or": [
                        {"tenant_id": {"$in": identifiers}},
                        {"tenantId": {"$in": identifiers}},
                        {"id": {"$in": identifiers}},
                    ]
                }
            ),
            {"_id": 0, "id": 1, "tenant_id": 1, "tenantId": 1, "client_id": 1},
        ).to_list(2_000),
    )
    return _mapped_provider_tenant_ids(
        clients,
        [*connections, *all_connections],
        [*provider_tenants, *all_provider_tenants],
    )


def m365_provider_tenant_query(
    provider_tenant_ids: set[str] | None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a verified Microsoft tenant-inventory query.

    Tenant inventory retains ``id`` as a legacy alias; provider user evidence
    must use :func:`m365_provider_evidence_query` instead.
    """
    identifiers = sorted(provider_tenant_ids or [])
    source = _verified_source_query(extra)
    if provider_tenant_ids is None:
        return source
    return {
        "$and": [
            source,
            {
                "$or": [
                    {"tenant_id": {"$in": identifiers}},
                    {"id": {"$in": identifiers}},
                ]
            },
        ]
    }


def m365_tenant_connection_query(
    provider_tenant_ids: set[str] | None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a connection-registry query constrained by provider tenant ID.

    Connection documents predate the canonical field in some installations, so
    both ``tenant_id`` and ``tenantId`` are retained as read aliases.  As with
    provider evidence, an explicitly resolved empty set is intentionally a
    zero-result query rather than permission to enumerate every connection.
    """
    operational = dict(extra or {})
    if provider_tenant_ids is None:
        return operational

    identifiers = sorted(provider_tenant_ids)
    provider_identifier = {
        "$or": [
            {"tenant_id": {"$in": identifiers}},
            {"tenantId": {"$in": identifiers}},
        ]
    }
    if not operational:
        return provider_identifier
    return {"$and": [operational, provider_identifier]}


def m365_provider_evidence_query(
    provider_tenant_ids: set[str] | None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a verified provider-evidence query constrained by Entra tenant."""
    identifiers = sorted(provider_tenant_ids or [])
    source = _verified_source_query(extra)
    if provider_tenant_ids is None:
        return source
    return {"$and": [source, {"tenant_id": {"$in": identifiers}}]}
