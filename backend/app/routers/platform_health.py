"""Platform Health — authenticated, global-scope, read-only operator evidence."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.event_backbone import event_backbone_health
from app.services.platform_health import build_snapshot
from app.services.scope_permissions import assert_global_scope

router = APIRouter(prefix="/platform-health", tags=["Platform Health"])


@router.get("/overview", dependencies=[Depends(require_action("platform.readiness.view"))])
async def overview(request: Request, current_user: dict = Depends(get_current_user)) -> dict:
    """Return platform evidence only to an authorised global-scope operator."""
    await assert_global_scope(current_user, operation="platform-health.view", request=request)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    database_reachable = True
    try:
        await db.command("ping")
    except Exception:  # The payload intentionally contains no driver internals.
        database_reachable = False
    event_health, active_agents, reporting_agents = await asyncio.gather(
        event_backbone_health(),
        db.nexus_agents.count_documents({"is_active": True}),
        db.nexus_agents.count_documents({"is_active": True, "last_seen": {"$gte": cutoff}}),
    )
    snapshot = build_snapshot(
        database_reachable=database_reachable,
        event_backbone=event_health,
        active_agents=active_agents,
        reporting_agents=reporting_agents,
        tenant_isolation_evidence={
            "state": "not_measured",
            "detail": "Independent tenant-isolation runtime probing is not configured; production-readiness evidence remains the release gate.",
        },
    )
    snapshot["generated_at"] = datetime.now(timezone.utc).isoformat()
    return snapshot
