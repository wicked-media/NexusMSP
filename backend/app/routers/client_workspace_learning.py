"""Learned memory for the client workspace.

The client workspace carries more views and actions than any single screen
should show at once. Instead of guessing which ones "technicians use most",
Nexus learns: every time a technician opens a workspace view or runs a quick
action, one bounded counter advances. The workspace then ranks its own
navigation and promotes the actions that are actually used, falling back to the
designed order whenever there is no evidence — including on first use, and after
a technician forgets their memory.

What is stored is deliberately small and deliberately not customer data: one
count and one last-used timestamp per (tenant, technician, surface, target).
There is no client ID, no page content, no free text and no session detail, so
a client-attributed behavioural profile is never created. Targets are restricted
to short lowercase slugs, which keeps the key space bounded and stops anything
arbitrary from being written here.

Only aggregate counts are ever returned for the tenant: a technician can see
what the team uses most, never who used it. Personal rows are readable only by
the technician who created them, and every query is partitioned by the caller's
Nexus platform tenant.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.database import db
from app.services.activity import log_activity
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

router = APIRouter()

# Only these two kinds of evidence are recorded. A "view" is a client workspace
# view (a Nexus tab slug); an "action" is a quick action a technician ran.
SURFACES = ("view", "action")

_TARGET_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,47}$")

# A technician can accumulate at most this many remembered targets per surface.
# Beyond it the least recently used target is forgotten, so memory stays bounded
# instead of growing with every UI value a future release introduces.
_MAX_TARGETS_PER_SURFACE = 32

# Personal memory returned to the workspace, and the bounded window of the
# tenant's most recent rows used to build the team aggregate. Both are caps on
# response size and aggregation cost, not retention limits.
_PERSONAL_ROWS = 128
_TEAM_WINDOW = 2000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_surface(value: object) -> str:
    surface = str(value or "").strip().lower()
    if surface not in SURFACES:
        raise HTTPException(status_code=422, detail="surface must be 'view' or 'action'")
    return surface


def _clean_target(value: object) -> str:
    target = str(value or "").strip().lower()
    if not _TARGET_PATTERN.match(target):
        raise HTTPException(
            status_code=422,
            detail="target must be a short lowercase identifier such as 'billing' or 'schedule'",
        )
    return target


def _safe_row(row: dict) -> dict:
    """Project a stored row onto the evidence the workspace needs."""
    return {
        "surface": row.get("surface"),
        "target": row.get("target"),
        "count": int(row.get("count") or 0),
        "last_used_at": row.get("last_used_at"),
    }


def _team_aggregate(rows: list[dict]) -> list[dict]:
    """Sum tenant-wide counts per target without exposing who used it."""
    aggregate: dict[tuple[str, str], dict] = {}
    for row in rows:
        surface = row.get("surface")
        target = row.get("target")
        if surface not in SURFACES or not target:
            continue
        key = (str(surface), str(target))
        entry = aggregate.setdefault(
            key,
            {"surface": key[0], "target": key[1], "count": 0, "last_used_at": None},
        )
        entry["count"] += int(row.get("count") or 0)
        last_used = row.get("last_used_at")
        if last_used and (entry["last_used_at"] is None or str(last_used) > str(entry["last_used_at"])):
            entry["last_used_at"] = last_used
    return sorted(aggregate.values(), key=lambda item: (-item["count"], item["target"]))


async def _prune_surface(user_id: str, tenant_id: str, surface: str) -> None:
    """Forget the least recently used targets once a surface exceeds its cap."""
    cursor = db.client_workspace_signals.find(
        {"tenant_id": tenant_id, "user_id": user_id, "surface": surface},
        {"_id": 0, "target": 1, "last_used_at": 1},
    ).sort("last_used_at", -1)
    rows = await cursor.to_list(_MAX_TARGETS_PER_SURFACE + 8)
    for stale in rows[_MAX_TARGETS_PER_SURFACE:]:
        await db.client_workspace_signals.delete_one(
            {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "surface": surface,
                "target": stale.get("target"),
            }
        )


@router.get("/client-workspace/learning")
async def get_client_workspace_learning(current_user: dict = Depends(get_current_user)):
    """Return the caller's own memory plus a tenant-wide aggregate of use.

    The response carries counts only. Another technician's identity, client or
    activity is never part of it.
    """
    user_id = str(current_user.get("id") or "")
    tenant_id = platform_tenant_id(current_user)

    personal_rows = await db.client_workspace_signals.find(
        tenant_scoped_query(current_user, {"user_id": user_id}),
        {"_id": 0},
    ).sort("last_used_at", -1).to_list(_PERSONAL_ROWS)

    team_rows = await db.client_workspace_signals.find(
        tenant_scoped_query(current_user, {}),
        {"_id": 0, "surface": 1, "target": 1, "count": 1, "last_used_at": 1},
    ).sort("last_used_at", -1).to_list(_TEAM_WINDOW)

    return {
        "personal": [_safe_row(row) for row in personal_rows],
        "team": _team_aggregate(team_rows),
        "memory": {
            "personal_signals": sum(int(row.get("count") or 0) for row in personal_rows),
            "team_window": _TEAM_WINDOW,
            "max_targets_per_surface": _MAX_TARGETS_PER_SURFACE,
        },
    }


@router.post("/client-workspace/learning/signals")
async def record_client_workspace_signal(
    payload: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Record one piece of usage evidence for the calling technician.

    This is presentational preference memory. It never grants access, changes a
    record or emails anyone, so it is not an audited business action; it is
    constrained to the caller's own tenant and user row.
    """
    body = payload or {}
    surface = _clean_surface(body.get("surface"))
    target = _clean_target(body.get("target"))
    user_id = str(current_user.get("id") or "")
    tenant_id = platform_tenant_id(current_user)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authenticated technician required")

    await db.client_workspace_signals.update_one(
        {"tenant_id": tenant_id, "user_id": user_id, "surface": surface, "target": target},
        {
            "$inc": {"count": 1},
            "$set": {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "surface": surface,
                "target": target,
                "last_used_at": _now_iso(),
            },
        },
        upsert=True,
    )
    await _prune_surface(user_id, tenant_id, surface)
    return {"recorded": True, "surface": surface, "target": target}


@router.delete("/client-workspace/learning")
async def forget_client_workspace_learning(current_user: dict = Depends(get_current_user)):
    """Forget everything Nexus has learned about this technician's workspace use."""
    user_id = str(current_user.get("id") or "")
    result = await db.client_workspace_signals.delete_many(
        tenant_scoped_query(current_user, {"user_id": user_id}),
    )
    removed = int(getattr(result, "deleted_count", 0) or 0)
    await log_activity(
        current_user,
        "client_workspace_learning.forgotten",
        "user",
        user_id,
        entity_name=current_user.get("name") or current_user.get("email") or "",
        details=f"Forgot {removed} learned client workspace signal(s)",
    )
    return {"removed": removed}
