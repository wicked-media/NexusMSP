"""Nexus Core canonical model, relationship graph and integrity APIs."""

from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.core_relationships import (
    build_core_index,
    client_core_graph,
    core_integrity_snapshot,
    core_schema,
)
from app.services.nexus_fabric import build_client_fabric
from app.services.nexus_ideas import create_idea, ideas_snapshot, update_idea
from app.services.nexus_objects import build_object_story
from app.services.nexus_timeline import build_client_timeline
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.scope_permissions import assert_client_scope


router = APIRouter()


class IdeaCreate(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    summary: str = Field(min_length=10, max_length=1200)
    category: str = Field(default="general", max_length=80)
    horizon: str = Field(default="explore", max_length=40)
    value_axes: dict[str, bool]
    dependencies: list[str] = Field(default_factory=lambda: ["core-platform"], max_length=20)


class IdeaUpdate(BaseModel):
    status: str | None = None
    horizon: str | None = None
    decision_note: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None, max_length=80)
    summary: str | None = Field(default=None, max_length=1200)
    value_axes: dict[str, bool] | None = None
    dependencies: list[str] | None = Field(default=None, max_length=20)


class ContextRelationshipCreate(BaseModel):
    client_id: str = Field(min_length=1, max_length=120)
    from_ref: str = Field(min_length=5, max_length=300)
    to_ref: str = Field(min_length=5, max_length=300)
    purpose: str = Field(min_length=10, max_length=1200)
    business_process: str | None = Field(default=None, max_length=300)
    requested_by: str = Field(min_length=2, max_length=200)
    approval_evidence: str = Field(min_length=5, max_length=1000)
    decision_record: str | None = Field(default=None, max_length=1000)


@router.get("/core/schema")
async def get_core_schema(current_user: dict = Depends(get_current_user)):
    return core_schema()


@router.get("/core/integrity")
async def get_core_integrity(current_user: dict = Depends(get_current_user)):
    return await core_integrity_snapshot()


@router.get("/core/ideas")
async def get_nexus_ideas(current_user: dict = Depends(get_current_user)):
    """Return the durable idea inbox without implying roadmap approval."""
    return await ideas_snapshot()


@router.post(
    "/core/ideas",
    dependencies=[Depends(require_action("platform.core.rebuild"))],
)
async def add_nexus_idea(payload: IdeaCreate, request: Request, current_user: dict = Depends(get_current_user)):
    correlation_id = request_correlation_id(request)
    try:
        idea = await create_idea(payload.model_dump(), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await emit_platform_event(
        subject="core.idea.captured",
        source="nexus.foundation",
        actor=current_user,
        correlation_id=correlation_id,
        payload={"idea_id": idea["id"], "title": idea["title"], "value_axes": idea["value_axes"]},
    )
    return idea


@router.patch(
    "/core/ideas/{idea_id}",
    dependencies=[Depends(require_action("platform.core.rebuild"))],
)
async def revise_nexus_idea(idea_id: str, payload: IdeaUpdate, request: Request, current_user: dict = Depends(get_current_user)):
    correlation_id = request_correlation_id(request)
    try:
        idea = await update_idea(idea_id, payload.model_dump(exclude_unset=True), current_user)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")
    await emit_platform_event(
        subject="core.idea.updated",
        source="nexus.foundation",
        actor=current_user,
        correlation_id=correlation_id,
        payload={"idea_id": idea_id, "status": idea.get("status"), "horizon": idea.get("horizon")},
    )
    return idea


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


@router.get("/core/clients/{client_id}/context-relationships")
async def get_context_relationships(client_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_client_scope(current_user, client_id, operation="platform.core.context.read", request=request)
    return await db.context_relationships.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post(
    "/core/context-relationships",
    dependencies=[Depends(require_action("platform.core.rebuild"))],
)
async def record_context_relationship(payload: ContextRelationshipCreate, request: Request, current_user: dict = Depends(get_current_user)):
    """Record an approved, human-attested reason between canonical objects."""
    await assert_client_scope(current_user, payload.client_id, operation="platform.core.context.create", request=request)
    if payload.from_ref == payload.to_ref:
        raise HTTPException(status_code=422, detail="Context must connect two different canonical objects")
    nodes = await db.core_entities.find(
        {"id": {"$in": [payload.from_ref, payload.to_ref]}, "active": True},
        {"_id": 0, "id": 1, "client_id": 1, "name": 1, "entity_type": 1},
    ).to_list(2)
    by_ref = {node["id"]: node for node in nodes}
    if set(by_ref) != {payload.from_ref, payload.to_ref}:
        raise HTTPException(status_code=409, detail="Refresh Nexus Fabric before recording context for these objects")
    if any(node.get("client_id") != payload.client_id for node in nodes):
        raise HTTPException(status_code=409, detail="Both objects must belong to the selected client")

    now = datetime.now(timezone.utc).isoformat()
    actor_name = current_user.get("name") or current_user.get("email") or "Authorised administrator"
    record = {
        "id": f"context-{uuid.uuid4()}",
        "client_id": payload.client_id,
        "from_ref": payload.from_ref,
        "to_ref": payload.to_ref,
        "from_name": by_ref[payload.from_ref].get("name"),
        "to_name": by_ref[payload.to_ref].get("name"),
        "purpose": payload.purpose.strip(),
        "business_process": (payload.business_process or "").strip() or None,
        "requested_by": payload.requested_by.strip(),
        "approved_by": actor_name,
        "approved_by_id": current_user.get("id"),
        "approval_evidence": payload.approval_evidence.strip(),
        "decision_record": (payload.decision_record or "").strip() or None,
        "status": "approved",
        "created_by": current_user.get("id"),
        "created_by_name": actor_name,
        "created_at": now,
        "updated_at": now,
    }
    await db.context_relationships.insert_one(dict(record))
    correlation_id = request_correlation_id(request)
    rebuild = await build_core_index(persist=True, actor=current_user, correlation_id=correlation_id)
    await emit_platform_event(
        subject="core.context.recorded",
        source="nexus.core",
        actor=current_user,
        client_id=payload.client_id,
        correlation_id=correlation_id,
        payload={"context_id": record["id"], "from_ref": payload.from_ref, "to_ref": payload.to_ref, "purpose": record["purpose"]},
    )
    return {"context": record, "rebuild": {"entities": rebuild["entities"], "relationships": rebuild["relationships"], "status": rebuild["status"]}}


@router.get("/core/clients/{client_id}/fabric")
async def get_client_fabric(client_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Return the evidence-backed client relationship explorer read model."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    await assert_client_scope(
        current_user,
        client_id,
        operation="platform.core.fabric.read",
        request=request,
    )
    graph = {"client": client, **(await client_core_graph(client_id))}
    return build_client_fabric(graph)


@router.get("/core/objects/profile")
async def get_core_object_profile(object_ref: str, request: Request, current_user: dict = Depends(get_current_user)):
    """Return the health, trust, impact, relationships, and story for one canonical object."""
    entity = await db.core_entities.find_one({"id": object_ref, "active": True}, {"_id": 0})
    if not entity:
        raise HTTPException(status_code=404, detail="Canonical object not found; refresh Nexus Fabric and try again")
    client_id = entity.get("client_id") or (entity.get("entity_id") if entity.get("entity_type") == "client" else None)
    if not client_id:
        raise HTTPException(status_code=409, detail="Canonical object is not assigned to a client boundary")
    await assert_client_scope(current_user, client_id, operation="platform.core.object.read", request=request)
    relationships = await db.core_relationships.find(
        {"active": True, "client_id": client_id, "$or": [{"from_ref": object_ref}, {"to_ref": object_ref}]},
        {"_id": 0},
    ).limit(500).to_list(500)
    related_refs = {
        relationship.get("to_ref") if relationship.get("from_ref") == object_ref else relationship.get("from_ref")
        for relationship in relationships
    }
    related_refs.discard(None)
    related_entities = await db.core_entities.find(
        {"id": {"$in": list(related_refs)}, "active": True}, {"_id": 0}
    ).limit(500).to_list(500) if related_refs else []
    related_by_ref = {item["id"]: item for item in related_entities}
    for relationship in relationships:
        related_ref = relationship.get("to_ref") if relationship.get("from_ref") == object_ref else relationship.get("from_ref")
        relationship["related"] = related_by_ref.get(related_ref) or {"id": related_ref}
    timeline = await build_client_timeline(client_id, limit=500)
    return build_object_story(entity, relationships, timeline.get("events") or [])


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
