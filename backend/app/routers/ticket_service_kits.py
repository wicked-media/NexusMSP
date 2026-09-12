"""Thin API boundary for curated Service Desk delivery kits."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.services.scope_permissions import assert_record_scope
from app.database import db
from app.services.ticket_service_kits import activate_service_kit, public_catalog


router = APIRouter()


class ApplyServiceKitPayload(BaseModel):
    kit_id: str
    context: dict[str, Any] = Field(default_factory=dict)


@router.get("/ticket-service-kits")
async def list_ticket_service_kits(current_user: dict = Depends(get_current_user)):
    """Return the bounded, curated kit catalogue; no per-client data is exposed."""
    return {"kits": public_catalog()}


@router.post("/tickets/{ticket_id}/service-kit")
async def apply_ticket_service_kit(
    ticket_id: str,
    payload: ApplyServiceKitPayload,
    current_user: dict = Depends(get_current_user),
):
    """Attach exactly one specialist delivery workflow to a canonical ticket."""
    ticket = await assert_record_scope(
        current_user,
        db.tickets,
        ticket_id,
        operation="ticket.service_kit.apply",
        resource_name="Ticket",
    )
    return await activate_service_kit(ticket, payload.kit_id, payload.context, current_user)
