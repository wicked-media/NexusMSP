"""Evidence-only context used by the ticket workspace."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.scope_permissions import (
    assert_tenant_record_scope,
    tenant_scoped_query,
)

router = APIRouter()


@router.get("/ticket-enrichment/{ticket_id}")
async def get_ticket_enrichment(
    ticket_id: str, current_user: dict = Depends(get_current_user)
):
    """Return adjacent ticket evidence without turning unknowns into scores."""
    ticket = await assert_tenant_record_scope(
        current_user, db.tickets, ticket_id,
        operation="ticket.context.read", resource_name="Ticket",
    )
    client_id = ticket.get("client_id")
    client_query = tenant_scoped_query(current_user, {"client_id": client_id})
    client = (
        await db.clients.find_one(
            tenant_scoped_query(current_user, {"id": client_id}), {"_id": 0}
        )
        if client_id
        else None
    )
    device_ids = ticket.get("device_ids") or [None]
    device_id = ticket.get("device_id") or device_ids[0]
    device = (
        await db.devices.find_one(
            tenant_scoped_query(
                current_user, {"id": device_id, "client_id": client_id}
            ),
            {"_id": 0},
        )
        if device_id and client_id
        else None
    )
    active_contracts = (
        await db.contracts.find(
            tenant_scoped_query(
                current_user, {"client_id": client_id, "status": "active"}
            ),
            {
                "_id": 0,
                "id": 1,
                "name": 1,
                "contract_type": 1,
                "status": 1,
            },
        ).to_list(20)
        if client_id
        else []
    )
    similar = (
        await db.tickets.find(
            tenant_scoped_query(
                current_user,
                {
                    "client_id": client_id,
                    "status": {"$in": ["open", "in_progress"]},
                    "id": {"$ne": ticket_id},
                },
            ),
            {
                "_id": 0,
                "id": 1,
                "ticket_number": 1,
                "title": 1,
                "priority": 1,
                "status": 1,
                "category": 1,
            },
        ).to_list(5)
        if client_id
        else []
    )
    return {
        "meta": {
            "data_status": "current" if client_id else "partial",
            "source": "ticket_client_device_contract_records",
            "observed_at": datetime.now(timezone.utc).isoformat(),
        },
        "client_context": {
            "id": client_id,
            "name": (
                (client or {}).get("name")
                or ticket.get("client_name")
                or "Client not linked"
            ),
            "open_tickets": (
                await db.tickets.count_documents(
                    {
                        **client_query,
                        "status": {"$in": ["open", "in_progress"]},
                    }
                )
                if client_id
                else 0
            ),
            "total_tickets_lifetime": (
                await db.tickets.count_documents(client_query)
                if client_id
                else 0
            ),
            "total_devices": (
                await db.devices.count_documents(client_query)
                if client_id
                else 0
            ),
            "offline_devices": (
                await db.devices.count_documents(
                    {**client_query, "status": "offline"}
                )
                if client_id
                else 0
            ),
            "active_contracts": active_contracts,
        },
        "device_context": {
            "id": device.get("id"),
            "name": device.get("name") or device.get("hostname"),
            "status": device.get("status"),
            "last_seen_at": (
                device.get("last_seen") or device.get("last_seen_at")
            ),
        }
        if device
        else None,
        "merge_candidates": similar,
    }
