"""Learned ordering memory for Nexus workspaces.

Every Nexus workspace carries more views, tools and buttons than one screen
should show at once — the client workspace has six navigation groups and ten
quick actions, the ticket workspace has twelve detail tabs plus a desk-tools
menu, the voice workspace has ten views behind a catalogue of Yeastar
capabilities, and the documentation reader carries two libraries whose order is
meaningless until somebody has read something. Instead of guessing which ones
"technicians use most", Nexus
learns: every time a technician opens a workspace view or runs an action, one
bounded counter advances. The workspace then ranks its own navigation and
promotes the actions that are actually used, falling back to the designed order
whenever there is no evidence — including on first use, and after a technician
forgets their memory.

What is stored is deliberately small and deliberately not customer data: one
count and one last-used timestamp per (tenant, technician, workspace, surface,
target). There is no client ID, no record ID, no page content, no free text and
no session detail, so a customer-attributed or per-record behavioural profile is
never created. Workspaces and targets are restricted to short lowercase slugs,
which keeps the key space bounded and stops anything arbitrary from being
written here.

Only aggregate counts are ever returned for the tenant: a technician can see
what the team uses most in a workspace, never who used it. Personal rows are
readable only by the technician who created them, and every query is partitioned
by the caller's Nexus platform tenant.
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

# The workspaces that may remember how they are used. A technician's habit in one
# workspace never leaks into another: the workspace is part of the stored key and
# part of every read. Adding a workspace is a deliberate, reviewable change here
# rather than a silent typo creating a parallel key space in the database.
# `documentation` is the Knowledge & Help reader. It stores which guide or
# knowledge article a technician opens, so the library order, the continue-
# reading rail and the related-reading list follow use instead of guessing, and
# the tenant aggregate lets a new technician benefit from what the team reads.
WORKSPACES = (
    "client",
    "tickets",
    "invoices",
    "voice",
    "devices",
    "purchase_orders",
    "chat",
    "documentation",
)

# Only these two kinds of evidence are recorded. A "view" is a workspace view (a
# Nexus tab or screen slug); an "action" is a tool, quick action or button a
# technician ran.
SURFACES = ("view", "action")

_TARGET_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,47}$")

# A technician can accumulate at most this many remembered targets per surface of
# each workspace. Beyond it the least recently used target is forgotten, so
# memory stays bounded instead of growing with every UI value a future release
# introduces. The cap is per workspace and surface, so a large catalogue (the
# voice workspace's provider interfaces) cannot evict the client workspace's
# shortcuts.
_MAX_TARGETS_PER_SURFACE = 48

# Personal memory returned to the workspace, and the bounded window of the
# tenant's most recent rows used to build the team aggregate. Both are caps on
# response size and aggregation cost, not retention limits.
_PERSONAL_ROWS = 128
_TEAM_WINDOW = 2000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_workspace(value: object) -> str:
    workspace = str(value or "").strip().lower()
    if workspace not in WORKSPACES:
        raise HTTPException(
            status_code=422,
            detail=f"workspace must be one of: {', '.join(WORKSPACES)}",
        )
    return workspace


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


async def _prune_surface(user_id: str, tenant_id: str, workspace: str, surface: str) -> None:
    """Forget the least recently used targets once a surface exceeds its cap."""
    query = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "workspace": workspace,
        "surface": surface,
    }
    cursor = db.workspace_learning_signals.find(
        query,
        {"_id": 0, "target": 1, "last_used_at": 1},
    ).sort("last_used_at", -1)
    rows = await cursor.to_list(_MAX_TARGETS_PER_SURFACE + 8)
    for stale in rows[_MAX_TARGETS_PER_SURFACE:]:
        await db.workspace_learning_signals.delete_one({**query, "target": stale.get("target")})


@router.get("/workspace-learning/{workspace}")
async def get_workspace_learning(
    workspace: str,
    current_user: dict = Depends(get_current_user),
):
    """Return the caller's own memory for one workspace plus a tenant aggregate.

    The response carries counts only. Another technician's identity, client or
    activity is never part of it, and another workspace's evidence is never
    included: the workspace is part of the read.
    """
    workspace = _clean_workspace(workspace)
    user_id = str(current_user.get("id") or "")

    personal_rows = await db.workspace_learning_signals.find(
        tenant_scoped_query(current_user, {"workspace": workspace, "user_id": user_id}),
        {"_id": 0},
    ).sort("last_used_at", -1).to_list(_PERSONAL_ROWS)

    team_rows = await db.workspace_learning_signals.find(
        tenant_scoped_query(current_user, {"workspace": workspace}),
        {"_id": 0, "surface": 1, "target": 1, "count": 1, "last_used_at": 1},
    ).sort("last_used_at", -1).to_list(_TEAM_WINDOW)

    return {
        "workspace": workspace,
        "personal": [_safe_row(row) for row in personal_rows],
        "team": _team_aggregate(team_rows),
        "memory": {
            "personal_signals": sum(int(row.get("count") or 0) for row in personal_rows),
            "team_window": _TEAM_WINDOW,
            "max_targets_per_surface": _MAX_TARGETS_PER_SURFACE,
        },
    }


@router.post("/workspace-learning/{workspace}/signals")
async def record_workspace_signal(
    workspace: str,
    payload: dict | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Record one piece of usage evidence for the calling technician.

    This is presentational preference memory. It never grants access, changes a
    record or emails anyone, so it is not an audited business action; it is
    constrained to the caller's own tenant and user row.
    """
    workspace = _clean_workspace(workspace)
    body = payload or {}
    surface = _clean_surface(body.get("surface"))
    target = _clean_target(body.get("target"))
    user_id = str(current_user.get("id") or "")
    tenant_id = platform_tenant_id(current_user)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authenticated technician required")

    await db.workspace_learning_signals.update_one(
        {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "workspace": workspace,
            "surface": surface,
            "target": target,
        },
        {
            "$inc": {"count": 1},
            "$set": {
                "tenant_id": tenant_id,
                "user_id": user_id,
                "workspace": workspace,
                "surface": surface,
                "target": target,
                "last_used_at": _now_iso(),
            },
        },
        upsert=True,
    )
    await _prune_surface(user_id, tenant_id, workspace, surface)
    return {"recorded": True, "workspace": workspace, "surface": surface, "target": target}


@router.delete("/workspace-learning/{workspace}")
async def forget_workspace_learning(
    workspace: str,
    current_user: dict = Depends(get_current_user),
):
    """Forget everything Nexus has learned about this technician in one workspace."""
    workspace = _clean_workspace(workspace)
    user_id = str(current_user.get("id") or "")
    result = await db.workspace_learning_signals.delete_many(
        tenant_scoped_query(current_user, {"workspace": workspace, "user_id": user_id}),
    )
    removed = int(getattr(result, "deleted_count", 0) or 0)
    await log_activity(
        current_user,
        "workspace_learning.forgotten",
        "user",
        user_id,
        entity_name=current_user.get("name") or current_user.get("email") or "",
        details=f"Forgot {removed} learned {workspace} workspace signal(s)",
    )
    return {"workspace": workspace, "removed": removed}
