"""Nexus Core canonical model, relationship graph and integrity APIs."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.core_relationships import (
    build_core_index,
    client_core_graph,
    core_integrity_snapshot,
    core_schema,
)
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import assert_client_scope


router = APIRouter()


@router.get("/core/schema")
async def get_core_schema(current_user: dict = Depends(get_current_user)):
    return core_schema()


@router.get("/core/integrity")
async def get_core_integrity(current_user: dict = Depends(get_current_user)):
    return await core_integrity_snapshot()


@router.get("/core/clients/{client_id}/graph")
async def get_client_core_graph(client_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    await assert_client_scope(
        current_user,
        client_id,
        operation="platform.core.graph.read",
        request=request,
    )
    return {"client": client, **(await client_core_graph(client_id))}


@router.post(
    "/core/relationships/rebuild",
    dependencies=[Depends(require_action("platform.core.rebuild"))],
)
async def rebuild_core_relationships(request: Request, current_user: dict = Depends(get_current_user)):
    correlation_id = request_correlation_id(request)
    result = await build_core_index(
        persist=True,
        actor=current_user,
        correlation_id=correlation_id,
    )
    await emit_platform_event(
        subject="core.relationships.rebuilt",
        source="nexus.core",
        actor=current_user,
        correlation_id=correlation_id,
        payload={
            "schema_version": result["schema_version"],
            "entities": result["entities"],
            "relationships": result["relationships"],
            "anomaly_count": result["anomaly_count"],
            "integrity_status": result["status"],
        },
    )
    await db.activity_logs.insert_one({
        "id": f"core-rebuild-{result['id']}",
        "action": "core_relationships_rebuilt",
        "entity_type": "platform_foundation",
        "entity_id": "nexus-core",
        "entity_name": "Nexus Core",
        "description": f"Rebuilt Nexus Core index with {result['entities']} entities and {result['relationships']} relationships.",
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "correlation_id": correlation_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    return result
