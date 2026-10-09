"""Nexus Data Quality Engine API.

This route composes a scoped, non-persistent data-quality read model.  It
never repairs records from the browser and it intentionally leaves unowned
records invisible to restricted technicians because their client scope cannot
be proven.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.database import db
from app.services.data_quality_engine import build_data_quality_snapshot
from app.services.scope_permissions import effective_scope, scoped_query, tenant_scoped_query


router = APIRouter(tags=["Nexus Data Quality"])


async def _capture_source(collection: Any, query: dict[str, Any], projection: dict[str, int], limit: int) -> tuple[list[dict[str, Any]], bool]:
    """Read a bounded evidence window and report whether it was truncated.

    A review limit protects this derived read model from becoming an unbounded
    operational query.  Fetching one additional document lets the response
    remain honest about what it did *not* inspect.
    """

    rows = await collection.find(query, projection).to_list(limit + 1)
    return rows[:limit], len(rows) > limit


def _owned_source_query(current_user: dict[str, Any], client_ids: list[str]) -> dict[str, Any]:
    """Return a client-scoped source query for data-quality evidence.

    This helper deliberately includes the known permitted client IDs *and*
    applies the shared scope rule.  A malformed source record without a stable
    client owner is therefore fail-closed for restricted technicians.
    """

    return scoped_query(
        current_user,
        {"client_id": {"$in": client_ids}},
        site_field=None,
    )


def _unattributed_query(client_ids: list[str]) -> dict[str, Any]:
    """Return only records with absent or invalid client ownership.

    This query is used exclusively for an explicitly all-client operator; the
    response returns aggregate counts rather than raw, potentially unscoped
    record data.
    """

    return {
        "$or": [
            {"client_id": {"$exists": False}},
            {"client_id": None},
            {"client_id": ""},
            {"client_id": {"$nin": client_ids}},
        ]
    }


@router.get("/data-quality/overview")
async def data_quality_overview(
    limit: int = Query(default=5000, ge=1, le=10000),
    current_user: dict = Depends(get_current_user),
):
    """Return deterministic data-quality signals for the permitted estate.

    The endpoint is read-only.  It returns source provenance and unresolved
    gaps rather than generating inferred replacements, merges or data changes.
    """

    scope = effective_scope(current_user)
    client_query = tenant_scoped_query(
        current_user,
        scoped_query(current_user, {}, field="id", site_field=None),
    )
    clients, clients_truncated = await _capture_source(
        db.clients,
        client_query,
        {
            "_id": 0,
            "id": 1,
            "name": 1,
            "company_name": 1,
            "email": 1,
            "phone": 1,
            "mobile": 1,
            "contacts.id": 1,
            "contacts.name": 1,
            "contacts.email": 1,
            "contacts.phone": 1,
            "contacts.mobile": 1,
            "contacts.is_primary": 1,
        },
        limit,
    )
    client_ids = [str(item.get("id")) for item in clients if str(item.get("id") or "").strip()]
    source_query = tenant_scoped_query(current_user, _owned_source_query(current_user, client_ids))

    (devices, devices_truncated), (tickets, tickets_truncated), (subscriptions, subscriptions_truncated), (agents, agents_truncated) = await asyncio.gather(
        _capture_source(db.devices, source_query, {"_id": 0, "id": 1, "client_id": 1, "name": 1, "hostname": 1, "serial_number": 1, "nexus_agent_id": 1, "agent_id": 1}, limit),
        _capture_source(db.tickets, source_query, {"_id": 0, "id": 1, "client_id": 1, "ticket_number": 1, "title": 1, "subject": 1}, limit),
        _capture_source(db.subscriptions, source_query, {"_id": 0, "id": 1, "client_id": 1, "name": 1, "service_name": 1, "product_name": 1, "product": 1, "sku": 1}, limit),
        _capture_source(db.nexus_agents, source_query, {"_id": 0, "id": 1, "client_id": 1, "hostname": 1, "device_name": 1}, limit),
    )
    source_capture = {
        "clients": clients_truncated,
        "devices": devices_truncated,
        "tickets": tickets_truncated,
        "subscriptions": subscriptions_truncated,
        "nexus_agents": agents_truncated,
    }

    # Global operators can review the *count* of records with no valid client
    # owner.  We intentionally do not load their raw content into the response.
    unattributed_counts: dict[str, int] = {}
    unattributed_counts_available = not clients_truncated
    if scope["mode"] == "all" and unattributed_counts_available:
        orphan_query = tenant_scoped_query(current_user, _unattributed_query(client_ids))
        device_count, ticket_count, subscription_count, agent_count = await asyncio.gather(
            db.devices.count_documents(orphan_query),
            db.tickets.count_documents(orphan_query),
            db.subscriptions.count_documents(orphan_query),
            db.nexus_agents.count_documents(orphan_query),
        )
        unattributed_counts = {
            "devices": device_count,
            "tickets": ticket_count,
            "subscriptions": subscription_count,
            "nexus_agents": agent_count,
        }

    return build_data_quality_snapshot(
        clients=clients,
        devices=devices,
        tickets=tickets,
        subscriptions=subscriptions,
        agents=agents,
        global_scope=scope["mode"] == "all",
        unattributed_counts=unattributed_counts,
        source_capture=source_capture,
        unattributed_counts_available=unattributed_counts_available,
    )
