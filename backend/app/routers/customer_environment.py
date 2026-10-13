"""Customer Environment Studio routes — one customer's operating context.

Read-only. Every read is tenant-partitioned and client/site-scoped on the server
(``tenant_scoped_query`` + ``scoped_query`` / ``assert_tenant_record_scope``), and
the per-client route proves the target is inside the caller's client and site
boundary before returning anything.

No new collection is introduced: the view is a projection of records that already
have an owner (see ``docs/DATA_OWNERSHIP.md``). Nothing here writes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth import get_current_user
from app.database import db
from app.services import customer_environment as policy
from app.services import operations_assurance as assurance
from app.services.scope_permissions import (
    assert_client_scope,
    assert_tenant_record_scope,
    scoped_query,
    tenant_scoped_query,
)

router = APIRouter(prefix="/customer-environment", tags=["Customer Environment"])

CLOSED_TICKET_STATUSES = ("closed", "resolved", "cancelled", "merged")
RESOLVED_ALERT_STATUSES = ("resolved", "closed", "dismissed", "suppressed")
ACTIVE_CONTRACT_STATUSES = ("active", "current", "signed")

SUMMARY_CLIENT_LIMIT = 200


def _scoped(user: dict[str, Any], query: dict[str, Any] | None = None) -> dict[str, Any]:
    """Tenant partition plus the caller's client/site boundary, combined once."""
    return tenant_scoped_query(user, scoped_query(user, query))


async def _count(collection: Any, user: dict[str, Any], query: dict[str, Any] | None = None) -> int:
    return await collection.count_documents(_scoped(user, query))


async def _dimensions(user: dict[str, Any], client_id: str) -> dict[str, dict[str, Any]]:
    """The six disclosed counts for one customer, all from already-scoped reads."""
    scope = {"client_id": client_id}
    devices = await _count(db.devices, user, scope)
    websites = await _count(db.web_sites, user, scope)
    contracts = await db.contracts.find(
        _scoped(user, {**scope, "status": {"$in": list(ACTIVE_CONTRACT_STATUSES)}}), {"_id": 0, "id": 1},
    ).to_list(2000)
    open_tickets = await _count(db.tickets, user, {**scope, "status": {"$nin": list(CLOSED_TICKET_STATUSES)}})
    changes = await _count(db.change_management, user, scope)
    alerts = await _count(db.alerts, user, {**scope, "status": {"$nin": list(RESOLVED_ALERT_STATUSES)}})
    return {
        "devices": policy.build_dimension(devices, source="devices"),
        "websites": policy.build_dimension(websites, source="web_sites"),
        "services": policy.build_dimension(len(contracts), source="contracts"),
        "open_tickets": policy.build_dimension(open_tickets, source="tickets"),
        "changes": policy.build_dimension(changes, source="change_management"),
        "alerts": policy.build_dimension(alerts, source="alerts"),
    }


def _chip_state_from_commitment(state: str) -> str:
    return {
        "met": "verified",
        "breached": "attention",
        "at_risk": "due",
        "not_measured": "not_measured",
    }.get(state, "not_measured")


async def _signals(user: dict[str, Any], client_id: str) -> list[dict[str, Any]]:
    """Evidence chips, each derived from a real record or disclosed as unmeasured."""
    scope = _scoped(user, {"client_id": client_id})

    websites = await db.web_sites.find(scope, {"_id": 0}).to_list(500)
    critical = [site for site in websites if site.get("critical") is True or str(site.get("priority") or "").lower() == "critical"]
    now = datetime.now(timezone.utc)
    enquiry = assurance.evaluate_website_enquiry_form(
        critical, assurance.COMMITMENT_BY_ID["website_enquiry_form"], now,
    )

    workloads = await db.backup_jobs.find(scope, {"_id": 0}).to_list(2000)
    recovery = assurance.evaluate_verified_recovery_point(
        workloads, assurance.COMMITMENT_BY_ID["verified_recovery_point"], now,
    )

    connection = await db.settings.find_one(
        tenant_scoped_query(user, {"type": "microsoft_graph_connection"}), {"_id": 0},
    )
    if not connection:
        microsoft = policy.build_signal(
            "microsoft_365_integration", "Microsoft 365 integration", "not_measured",
            "No Microsoft 365 connection is recorded for this tenant.",
        )
    else:
        state = str(connection.get("status") or connection.get("state") or "").strip().lower()
        healthy = state in {"connected", "ok", "healthy", "active"}
        microsoft = policy.build_signal(
            "microsoft_365_integration", "Microsoft 365 integration",
            "connected" if healthy else "attention",
            "" if healthy else f"Recorded connection state is '{state or 'unknown'}'.",
        )

    return [
        policy.build_signal("website_enquiry_workflow", "Website enquiry workflow",
                            _chip_state_from_commitment(enquiry["state"]),
                            "" if enquiry["state"] == "met" else enquiry["reason"]),
        policy.build_signal("backup_recovery_test", "Backup recovery test",
                            _chip_state_from_commitment(recovery["state"]),
                            "" if recovery["state"] == "met" else recovery["reason"]),
        microsoft,
    ]


@router.get("/summary")
async def environment_summary(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Every customer in scope with their disclosed environment dimensions."""
    clients = await db.clients.find(_scoped(user, {}), {"_id": 0, "id": 1, "name": 1, "client_name": 1}) \
        .sort("name", 1).to_list(SUMMARY_CLIENT_LIMIT)
    rows = []
    for client in clients:
        client_id = str(client.get("id") or "")
        if not client_id:
            continue
        dimensions = await _dimensions(user, client_id)
        chips = await _signals(user, client_id)
        rows.append(policy.build_overview(
            client_id=client_id,
            client_name=str(client.get("name") or client.get("client_name") or ""),
            dimensions=dimensions,
            signals=chips,
        ))
    return {
        "clients": rows,
        "count": len(rows),
        "boundary": policy.OVERVIEW_BOUNDARY,
    }


@router.get("/{client_id}")
async def environment_overview(client_id: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """One customer's operating context, or 404 when it is not in scope."""
    # A client record's own boundary is its own id, so the boundary check keys on
    # `id` rather than a `client_id` field the record does not carry.
    client = await assert_tenant_record_scope(
        user, db.clients, client_id, client_field="id", operation="customer-environment.read",
    )
    resolved_client_id = str(client.get("id") or client_id)
    await assert_client_scope(user, resolved_client_id, operation="customer-environment.read")
    dimensions = await _dimensions(user, resolved_client_id)
    chips = await _signals(user, resolved_client_id)
    return policy.build_overview(
        client_id=resolved_client_id,
        client_name=str(client.get("client_name") or client.get("name") or ""),
        dimensions=dimensions,
        signals=chips,
    )


@router.get("/{client_id}/investigation")
async def environment_investigation(
    client_id: str,
    window_hours: int = Query(24, ge=1, le=168),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """What changed for this customer, correlated with what is open now.

    Correlation only — candidates carry the change, the ticket and the shared
    identifier that linked them, and the boundary sentence says Nexus does not
    decide causation.
    """
    client = await assert_tenant_record_scope(
        user, db.clients, client_id, client_field="id", operation="customer-environment.investigate",
    )
    resolved_client_id = str(client.get("id") or client_id)
    await assert_client_scope(user, resolved_client_id, operation="customer-environment.investigate")

    changes = await db.change_management.find(
        _scoped(user, {"client_id": resolved_client_id}), {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    open_tickets = await db.tickets.find(
        _scoped(user, {"client_id": resolved_client_id, "status": {"$nin": list(CLOSED_TICKET_STATUSES)}}),
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    return policy.build_investigation(
        client_id=resolved_client_id,
        changes=changes,
        open_tickets=open_tickets,
        window_hours=window_hours,
    )
