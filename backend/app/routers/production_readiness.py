"""Internal production-readiness register and evidence controls."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import ACTION_PERMISSION_IDS, require_action
from app.services.activity import log_activity
from app.services.core_relationships import core_integrity_snapshot
from app.services.event_backbone import event_backbone_health
from app.services.platform_foundation import emit_platform_event, request_correlation_id
from app.services.production_readiness import (
    DEFAULT_READINESS_ITEMS,
    READINESS_SECTIONS,
    normalise_readiness_payload,
    summarise_readiness,
    utc_now,
)


router = APIRouter()


async def _ensure_default_register() -> None:
    now = utc_now()
    await asyncio.gather(*(
        db.production_readiness_items.update_one(
            {"id": item["id"]},
            {"$setOnInsert": {
                **item,
                "review_note": "",
                "evidence_reference": "",
                "last_reviewed": None,
                "last_reviewed_by": None,
                "created_at": now,
                "created_by": "Nexus Foundation",
                "updated_at": now,
                "updated_by": "Nexus Foundation",
                "review_history": [],
            }},
            upsert=True,
        )
        for item in DEFAULT_READINESS_ITEMS
    ))


async def _system_evidence() -> list[dict]:
    (
        core,
        events,
        active_agents,
        mtls_agents,
        permission_denials,
        scope_denials,
        successful_restores,
        verified_mfa,
    ) = await asyncio.gather(
        core_integrity_snapshot(),
        event_backbone_health(),
        db.nexus_agents.count_documents({"is_active": True}),
        db.nexus_agents.count_documents({
            "is_active": True,
            "device_identity.last_transport": "mtls",
            "device_identity.certificate_expires_at": {"$gt": datetime.now(timezone.utc).isoformat()},
        }),
        db.permission_denials.count_documents({}),
        db.scope_denials.count_documents({}),
        db.backup_drills.count_documents({"status": "completed", "outcome": {"$in": ["passed", "success", "successful"]}}),
        db.user_2fa.count_documents({"verified": True}),
    )
    return [
        {
            "id": "canonical-model",
            "label": "Canonical relationship coverage",
            "value": f"{core.get('client_linked_pct', 0)}%",
            "status": "healthy" if core.get("status") == "healthy" else "attention",
            "detail": f"{core.get('entities', 0)} entities, {core.get('anomaly_count', 0)} retained anomalies",
        },
        {
            "id": "agent-trust",
            "label": "Agent mutual-TLS coverage",
            "value": f"{mtls_agents}/{active_agents}",
            "status": "healthy" if active_agents and mtls_agents == active_agents else "attention",
            "detail": "Every active agent must authenticate with a current per-device identity.",
        },
        {
            "id": "isolation-denials",
            "label": "Boundary denials retained",
            "value": permission_denials + scope_denials,
            "status": "healthy",
            "detail": f"{permission_denials} action and {scope_denials} client/site scope denials are auditable.",
        },
        {
            "id": "core-isolation-coverage",
            "label": "Fail-closed core resources",
            "value": "5 domains",
            "status": "attention",
            "detail": (
                "Clients, managed devices, inventory assets, tickets and agent management now enforce "
                "client/site and object ownership. Legacy unauthenticated heartbeat intake is retired; "
                "secondary domains and an independent penetration test remain open launch evidence."
            ),
        },
        {
            "id": "agent-command-envelope",
            "label": "Agent command authorization",
            "value": "signed + expiring",
            "status": "attention",
            "detail": (
                "Ed25519 signatures, payload integrity, endpoint/client binding, five-minute expiry and "
                "restart-safe nonce replay rejection are implemented and tested. Staged endpoint rollout "
                "and adversarial deployment evidence remain required."
            ),
        },
        {
            "id": "automation-runtime-safety",
            "label": "Automation runtime controls",
            "value": "durable + scoped",
            "status": "attention",
            "detail": (
                "Runs are restart-safe, idempotent, approval-aware, compensatable and now client-scoped "
                "for reads, decisions, retries and rollback. Canary rings, concurrency ceilings and "
                "production blast-radius exercises remain launch evidence."
            ),
        },
        {
            "id": "event-backbone",
            "label": "Event backbone",
            "value": events.get("status", "unknown"),
            "status": "healthy" if events.get("status") == "healthy" else "attention",
            "detail": f"{events.get('queue_depth', 0)} queued, {events.get('dead_letter', 0)} dead-letter deliveries.",
        },
        {
            "id": "restore-proof",
            "label": "Successful restore exercises",
            "value": successful_restores,
            "status": "healthy" if successful_restores else "attention",
            "detail": "A completed backup is not launch evidence until restoration is validated.",
        },
        {
            "id": "mfa",
            "label": "Verified MSP MFA",
            "value": verified_mfa,
            "status": "healthy" if verified_mfa else "attention",
            "detail": "Production policy requires MFA for every MSP user.",
        },
        {
            "id": "permission-subjects",
            "label": "Governed action subjects",
            "value": len(ACTION_PERMISSION_IDS),
            "status": "healthy",
            "detail": "Stable action permissions exist; route coverage remains a production gate.",
        },
    ]


@router.get(
    "/production-readiness/overview",
    dependencies=[Depends(require_action("platform.readiness.view"))],
)
async def readiness_overview(current_user: dict = Depends(get_current_user)):
    await _ensure_default_register()
    items, evidence = await asyncio.gather(
        db.production_readiness_items.find({}, {"_id": 0}).sort(
            [("production_blocker", -1), ("severity", 1), ("updated_at", -1)]
        ).to_list(500),
        _system_evidence(),
    )
    summary = summarise_readiness(items)
    return {
        "generated_at": utc_now(),
        "summary": {key: value for key, value in summary.items() if key != "gates"},
        "gates": summary["gates"],
        "sections": list(READINESS_SECTIONS),
        "items": items,
        "system_evidence": evidence,
        "priority_order": [
            "Tenant isolation and security",
            "Agent and automation safety",
            "Backup restoration and rollback",
            "Billing accuracy",
            "Monitoring and incident response",
            "Controlled pilot deployment",
            "Public production only after every gate passes",
        ],
        "nexusos": {
            "status": "developer_preview",
            "production_blocker": False,
            "message": "NexusOS remains a separate internal preview and does not share the NexusMSP Core public-launch decision.",
        },
    }


@router.post(
    "/production-readiness/items",
    dependencies=[Depends(require_action("platform.readiness.manage"))],
)
async def create_readiness_item(payload: dict, request: Request, current_user: dict = Depends(get_current_user)):
    try:
        data = normalise_readiness_payload(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    now = utc_now()
    item = {
        "id": f"readiness-{uuid.uuid4().hex[:12]}",
        **data,
        "created_at": now,
        "created_by": current_user.get("name") or current_user.get("email"),
        "updated_at": now,
        "updated_by": current_user.get("name") or current_user.get("email"),
        "last_reviewed": now,
        "last_reviewed_by": current_user.get("name") or current_user.get("email"),
        "review_history": [{
            "at": now,
            "by": current_user.get("name") or current_user.get("email"),
            "action": "created",
            "status": data["status"],
            "test_result": data["test_result"],
            "note": data.get("review_note") or "Readiness item created.",
        }],
    }
    await db.production_readiness_items.insert_one(dict(item))
    await _record_readiness_change(item, None, request, current_user, "created")
    item.pop("_id", None)
    return item


@router.put(
    "/production-readiness/items/{item_id}",
    dependencies=[Depends(require_action("platform.readiness.manage"))],
)
async def update_readiness_item(item_id: str, payload: dict, request: Request, current_user: dict = Depends(get_current_user)):
    existing = await db.production_readiness_items.find_one({"id": item_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Production-readiness item not found")
    try:
        updates = normalise_readiness_payload(payload, partial=True)
        # Validate the merged state as well as the changed fields.  A partial
        # request must not be able to set status=passed while preserving a
        # previously failed or unrun test result.
        normalise_readiness_payload({**existing, **updates})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updates:
        raise HTTPException(status_code=400, detail="No supported readiness fields were provided")
    now = utc_now()
    actor = current_user.get("name") or current_user.get("email")
    review = {
        "at": now,
        "by": actor,
        "action": "reviewed",
        "status": updates.get("status", existing.get("status")),
        "test_result": updates.get("test_result", existing.get("test_result")),
        "note": updates.get("review_note") or "Readiness evidence reviewed.",
        "evidence_reference": updates.get("evidence_reference") or existing.get("evidence_reference"),
    }
    updates.update({
        "updated_at": now,
        "updated_by": actor,
        "last_reviewed": now,
        "last_reviewed_by": actor,
    })
    await db.production_readiness_items.update_one(
        {"id": item_id},
        {"$set": updates, "$push": {"review_history": review}},
    )
    updated = await db.production_readiness_items.find_one({"id": item_id}, {"_id": 0})
    await _record_readiness_change(updated, existing, request, current_user, "reviewed")
    return updated


async def _record_readiness_change(
    item: dict,
    previous: dict | None,
    request: Request,
    user: dict,
    action: str,
) -> None:
    changes = {}
    if previous:
        for key in ("owner", "severity", "status", "test_result", "production_blocker", "target_release", "evidence_reference"):
            if previous.get(key) != item.get(key):
                changes[key] = {"from": previous.get(key), "to": item.get(key)}
    await log_activity(
        user,
        f"production_readiness_{action}",
        "production_readiness",
        item["id"],
        item.get("title") or item["id"],
        item.get("review_note") or f"Production-readiness item {action}.",
        changes=changes,
        metadata={
            "section": item.get("section"),
            "production_blocker": item.get("production_blocker"),
            "correlation_id": request_correlation_id(request),
        },
    )
    await emit_platform_event(
        subject="platform.readiness.reviewed",
        source="nexus.production-readiness",
        actor=user,
        correlation_id=request_correlation_id(request),
        payload={
            "item_id": item["id"],
            "section": item.get("section"),
            "status": item.get("status"),
            "test_result": item.get("test_result"),
            "production_blocker": item.get("production_blocker"),
            "action": action,
        },
        idempotency_key=f"{item['id']}:{item.get('updated_at')}:{action}",
    )
