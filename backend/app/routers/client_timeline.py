"""Compatibility route for the canonical Nexus client timeline."""

from fastapi import APIRouter, Depends

from app.auth import get_current_user
from app.database import db
from app.services.nexus_timeline import build_client_timeline
from app.services.scope_permissions import assert_record_scope


router = APIRouter()


@router.get("/client-timeline/{client_id}")
async def get_client_timeline(client_id: str, current_user: dict = Depends(get_current_user)):
    """Preserve legacy links while serving the authoritative timeline read model."""
    await assert_record_scope(
        current_user,
        db.clients,
        client_id,
        client_field="id",
        operation="client.timeline.read",
        resource_name="Client",
    )
    return await build_client_timeline(client_id, limit=300)
