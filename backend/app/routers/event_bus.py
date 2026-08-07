from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, timezone
import uuid
import json
import asyncio
from app.database import db
from app.auth import get_current_user
from app.routers.audit_trail import _events as historical_audit_events, _require_audit_access
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.event_backbone import (
    create_subscription,
    event_backbone_health,
    verify_event_integrity,
    process_due_deliveries,
    replay_events,
    retry_delivery,
    rotate_subscription_secret,
    update_subscription,
)
from app.services.scope_permissions import scoped_query
from app.services.platform_foundation import (
    EVENT_SUBJECTS,
    emit_platform_event,
    request_correlation_id,
)

router = APIRouter()

# In-memory event store for SSE
_event_subscribers: Dict[str, asyncio.Queue] = {}
_ticket_viewers: Dict[str, Dict[str, dict]] = {}

# ============== REAL-TIME EVENT BUS ==============

@router.post("/events/publish")
async def publish_event(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Persist and publish an event using the shared Nexus event envelope."""
    try:
        event = await emit_platform_event(
            subject=data.get("subject") or data.get("type") or "platform.general",
            source=data.get("source", "nexus.api"),
            payload=data.get("payload", {}),
            actor=current_user,
            tenant_id=data.get("tenant_id"),
            client_id=data.get("client_id"),
            correlation_id=request_correlation_id(request),
            causation_id=data.get("causation_id"),
            schema_version=data.get("schema_version", 1),
            idempotency_key=data.get("idempotency_key") or request.headers.get("Idempotency-Key"),
            partition_key=data.get("partition_key"),
            retention_days=data.get("retention_days"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    compatibility_event = {
        **event,
        "type": event["subject"],
        "user_id": event["actor"]["id"],
        "user_name": event["actor"]["name"],
        "timestamp": event["occurred_at"],
    }
    
    if not event.get("deduplicated"):
        await db.events.insert_one({**compatibility_event})
    
        for user_id, queue in list(_event_subscribers.items()):
            try:
                queue.put_nowait(compatibility_event)
            except asyncio.QueueFull:
                pass
    
    return {
        "message": "Event persisted and published",
        "event_id": event["id"],
        "correlation_id": event["correlation_id"],
        "subject": event["subject"],
        "partition_key": event.get("partition_key"),
        "sequence": event.get("sequence"),
        "delivery_count": event.get("delivery_count", 0),
        "deduplicated": bool(event.get("deduplicated")),
    }


@router.get("/events/catalog")
async def event_catalog(current_user: dict = Depends(get_current_user)):
    """Return the governed platform subjects modules should publish."""
    return {
        "schema_version": 1,
        "required_fields": [
            "id", "subject", "schema_version", "source", "tenant_id",
            "correlation_id", "actor", "payload", "occurred_at",
        ],
        "subjects": EVENT_SUBJECTS,
    }


@router.get("/events/platform/recent")
async def recent_platform_events(
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    safe_limit = max(1, min(int(limit or 50), 200))
    query = scoped_query(current_user, {}, field="client_id", site_field=None)
    return await db.platform_events.find(query, {"_id": 0}).sort("occurred_at", -1).to_list(safe_limit)


@router.get("/events/black-box")
async def nexus_black_box(
    hours: int = 24,
    limit: int = 250,
    client_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
    subject: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Return a scoped, read-only event replay with integrity evidence."""
    _require_audit_access(current_user)
    safe_hours = max(1, min(int(hours or 24), 24 * 365))
    safe_limit = max(1, min(int(limit or 250), 1000))
    since = (datetime.now(timezone.utc) - timedelta(hours=safe_hours)).isoformat()
    requested: dict[str, Any] = {"occurred_at": {"$gte": since}}
    if client_id:
        requested["client_id"] = str(client_id)
    if correlation_id:
        requested["correlation_id"] = str(correlation_id)
    if subject:
        requested["subject"] = str(subject)
    query = scoped_query(current_user, requested, field="client_id", site_field=None)
    events = await db.platform_events.find(query, {"_id": 0}).sort("occurred_at", 1).to_list(safe_limit)

    first_by_partition: dict[str, dict] = {}
    for event in events:
        partition = str(event.get("partition_key") or event.get("client_id") or event.get("tenant_id") or "nexus-local")
        first_by_partition.setdefault(partition, event)

    previous_by_partition: dict[str, dict | None] = {}
    for partition, first in first_by_partition.items():
        anchor_query = scoped_query(
            current_user,
            {
                "partition_key": partition,
                "sequence": {"$lt": int(first.get("sequence") or 0)},
            },
            field="client_id",
            site_field=None,
        )
        previous_by_partition[partition] = await db.platform_events.find_one(
            anchor_query,
            {"_id": 0},
            sort=[("sequence", -1)],
        )

    enriched = []
    status_counts = {"verified": 0, "partial": 0, "legacy": 0, "compromised": 0}
    for event in events:
        partition = str(event.get("partition_key") or event.get("client_id") or event.get("tenant_id") or "nexus-local")
        verification = verify_event_integrity(event, previous_by_partition.get(partition))
        status_counts[verification["status"]] += 1
        enriched.append({**event, "verification": verification})
        previous_by_partition[partition] = event

    # The durable platform ledger is new, but Nexus already has years of persisted
    # activity and device evidence. Surface that history behind an explicit legacy
    # boundary rather than pretending a retroactive cryptographic seal existed.
    legacy_events = []
    for index, event in enumerate(reversed(await historical_audit_events()), start=1):
        occurred_at = str(event.get("timestamp") or "")
        if not occurred_at or occurred_at < since:
            continue
        metadata = event.get("metadata") or {}
        legacy_client_id = metadata.get("client_id")
        if not legacy_client_id and event.get("entity_type") == "client":
            legacy_client_id = event.get("entity_id")
        legacy_correlation_id = metadata.get("correlation_id")
        legacy_subject = ".".join(
            str(value or "activity").strip().lower().replace(" ", "_")
            for value in (event.get("category"), event.get("action"))
        )
        if client_id and str(legacy_client_id or "") != str(client_id):
            continue
        if correlation_id and str(legacy_correlation_id or "") != str(correlation_id):
            continue
        if subject and legacy_subject != str(subject):
            continue
        legacy_events.append({
            "id": event.get("id") or f"legacy-evidence-{index}",
            "subject": legacy_subject,
            "schema_version": 0,
            "source": event.get("source") or "nexus.audit",
            "tenant_id": "nexus-local",
            "client_id": legacy_client_id,
            "correlation_id": legacy_correlation_id,
            "causation_id": None,
            "actor": {
                "id": None,
                "name": event.get("user") or "Nexus System",
                "type": "system" if event.get("user") in {None, "System"} else "technician",
            },
            "payload": {
                "description": event.get("description"),
                "target": event.get("target"),
                "severity": event.get("severity"),
                "entity_type": event.get("entity_type"),
                "entity_id": event.get("entity_id"),
                "changes": event.get("changes") or {},
                "metadata": metadata,
            },
            "occurred_at": occurred_at,
            "partition_key": f"legacy:{legacy_client_id or event.get('entity_type') or 'platform'}",
            "sequence": index,
            "published_at": occurred_at,
            "integrity": None,
            "verification": {
                "status": "legacy",
                "valid": None,
                "reason": "Recorded before the Nexus cryptographic event ledger was enabled",
            },
        })

    enriched = sorted(
        [*enriched, *legacy_events],
        key=lambda event: str(event.get("occurred_at") or ""),
    )[-safe_limit:]
    status_counts = {"verified": 0, "partial": 0, "legacy": 0, "compromised": 0}
    for event in enriched:
        status = (event.get("verification") or {}).get("status") or "partial"
        status_counts[status] = status_counts.get(status, 0) + 1
    correlations = {event.get("correlation_id") for event in enriched if event.get("correlation_id")}
    actors = {
        (event.get("actor") or {}).get("name")
        for event in enriched
        if (event.get("actor") or {}).get("name")
    }
    clients = {event.get("client_id") for event in enriched if event.get("client_id")}
    compromised = status_counts["compromised"]
    legacy = status_counts["legacy"]
    integrity_status = "compromised" if compromised else "legacy" if legacy else "verified"
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": safe_hours,
        "events": enriched,
        "summary": {
            "event_count": len(enriched),
            "correlation_count": len(correlations),
            "actor_count": len(actors),
            "client_count": len(clients),
            "integrity_status": integrity_status,
            "verification": status_counts,
            "first_event_at": enriched[0].get("occurred_at") if enriched else None,
            "last_event_at": enriched[-1].get("occurred_at") if enriched else None,
            "read_only": True,
            "scope": "Administrator-scoped platform ledger and historical audit evidence",
        },
    }


# ============== DURABLE EVENT BACKBONE ==============

@router.get("/events/backbone/health")
async def get_event_backbone_health(current_user: dict = Depends(get_current_user)):
    return await event_backbone_health()


@router.get("/events/backbone/subscriptions")
async def list_event_subscriptions(current_user: dict = Depends(get_current_user)):
    return await db.platform_event_subscriptions.find(
        {},
        {"_id": 0, "signing_secret_encrypted": 0},
    ).sort("created_at", -1).to_list(500)


@router.post("/events/backbone/subscriptions")
async def add_event_subscription(
    data: dict,
    current_user: dict = Depends(require_action("platform.events.manage")),
):
    try:
        subscription = await create_subscription(data, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await log_activity(
        current_user,
        "created",
        "event_subscription",
        subscription["id"],
        subscription["name"],
        f"Created {subscription['delivery_type']} event subscription",
        metadata={"subject_patterns": subscription["subject_patterns"]},
    )
    return subscription


@router.patch("/events/backbone/subscriptions/{subscription_id}")
async def edit_event_subscription(
    subscription_id: str,
    data: dict,
    current_user: dict = Depends(require_action("platform.events.manage")),
):
    try:
        subscription = await update_subscription(subscription_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not subscription:
        raise HTTPException(status_code=404, detail="Event subscription not found")
    await log_activity(
        current_user,
        "updated",
        "event_subscription",
        subscription_id,
        subscription.get("name", ""),
        "Updated event subscription delivery controls",
        changes=data,
    )
    return subscription


@router.post("/events/backbone/subscriptions/{subscription_id}/rotate-secret")
async def rotate_event_subscription_secret(
    subscription_id: str,
    current_user: dict = Depends(require_action("platform.events.manage")),
):
    result = await rotate_subscription_secret(subscription_id)
    if not result:
        raise HTTPException(status_code=404, detail="Webhook subscription not found")
    await log_activity(
        current_user,
        "secret_rotated",
        "event_subscription",
        subscription_id,
        "Event webhook",
        "Rotated the webhook signing secret",
    )
    return result


@router.get("/events/backbone/deliveries")
async def list_event_deliveries(
    status: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user),
):
    query = {"status": status} if status else {}
    safe_limit = max(1, min(int(limit or 100), 500))
    return await db.platform_event_deliveries.find(
        query,
        {"_id": 0, "lock_token": 0},
    ).sort("created_at", -1).to_list(safe_limit)


@router.post("/events/backbone/deliveries/process")
async def process_event_delivery_queue(
    data: dict,
    current_user: dict = Depends(require_action("platform.events.manage")),
):
    result = await process_due_deliveries(data.get("limit", 50))
    if result["processed"]:
        await log_activity(
            current_user,
            "processed",
            "event_delivery_queue",
            "platform-events",
            "Nexus event backbone",
            f"Processed {result['processed']} due event deliveries",
            metadata=result,
        )
    return result


@router.post("/events/backbone/deliveries/{delivery_id}/retry")
async def retry_event_delivery(
    delivery_id: str,
    current_user: dict = Depends(require_action("platform.events.manage")),
):
    delivery = await retry_delivery(delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Event delivery not found")
    await log_activity(
        current_user,
        "retried",
        "event_delivery",
        delivery_id,
        delivery.get("subscription_name", "Event subscription"),
        f"Queued {delivery.get('subject')} for another delivery attempt",
    )
    return delivery


@router.get("/events/backbone/replays")
async def list_event_replays(
    limit: int = 50,
    current_user: dict = Depends(get_current_user),
):
    safe_limit = max(1, min(int(limit or 50), 200))
    return await db.platform_event_replays.find(
        {},
        {"_id": 0},
    ).sort("created_at", -1).to_list(safe_limit)


@router.post("/events/backbone/replay")
async def replay_platform_events(
    data: dict,
    current_user: dict = Depends(require_action("platform.events.replay")),
):
    try:
        result = await replay_events(data, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await log_activity(
        current_user,
        "previewed" if result.get("dry_run") else "created",
        "event_replay",
        result.get("id", "dry-run"),
        "Nexus event replay",
        (
            f"Previewed {result.get('delivery_count', 0)} replay deliveries"
            if result.get("dry_run")
            else f"Created {result.get('delivery_count', 0)} governed replay deliveries"
        ),
        metadata={
            "dry_run": result.get("dry_run"),
            "event_count": result.get("event_count"),
            "delivery_count": result.get("delivery_count"),
        },
    )
    return result

@router.get("/events/stream")
async def event_stream(request: Request, current_user: dict = Depends(get_current_user)):
    """SSE endpoint for real-time events"""
    user_id = current_user["id"]
    queue = asyncio.Queue(maxsize=100)
    _event_subscribers[user_id] = queue
    
    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.now(timezone.utc).isoformat()})}\n\n"
        finally:
            _event_subscribers.pop(user_id, None)
    
    return StreamingResponse(generate(), media_type="text/event-stream")

@router.get("/events/recent")
async def get_recent_events(
    event_type: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if event_type:
        query["type"] = event_type
    events = await db.events.find(query, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return events

# ============== TICKET VIEWER TRACKING ==============

@router.post("/tickets/{ticket_id}/viewing")
async def mark_viewing_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Mark that a user is currently viewing a ticket"""
    if ticket_id not in _ticket_viewers:
        _ticket_viewers[ticket_id] = {}
    
    _ticket_viewers[ticket_id][current_user["id"]] = {
        "user_id": current_user["id"],
        "user_name": current_user["name"],
        "avatar_url": current_user.get("avatar"),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    
    for uid, queue in list(_event_subscribers.items()):
        try:
            queue.put_nowait({
                "type": "ticket_viewing",
                "payload": {
                    "ticket_id": ticket_id,
                    "viewers": list(_ticket_viewers.get(ticket_id, {}).values()),
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except asyncio.QueueFull:
            pass
    
    return {"message": "Viewing status updated"}

@router.post("/tickets/{ticket_id}/stop-viewing")
async def stop_viewing_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Mark that a user stopped viewing a ticket"""
    if ticket_id in _ticket_viewers:
        _ticket_viewers[ticket_id].pop(current_user["id"], None)
        if not _ticket_viewers[ticket_id]:
            del _ticket_viewers[ticket_id]
    
    for uid, queue in list(_event_subscribers.items()):
        try:
            queue.put_nowait({
                "type": "ticket_viewing",
                "payload": {
                    "ticket_id": ticket_id,
                    "viewers": list(_ticket_viewers.get(ticket_id, {}).values()),
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        except asyncio.QueueFull:
            pass
    
    return {"message": "Viewing status cleared"}

@router.get("/tickets/active-viewers")
async def get_all_active_viewers(current_user: dict = Depends(get_current_user)):
    """Get all tickets currently being viewed and by whom"""
    result = {}
    for ticket_id, viewers in _ticket_viewers.items():
        if viewers:
            result[ticket_id] = list(viewers.values())
    return result
