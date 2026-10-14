"""Nexus Remote Session Studio — technician preferences and adaptive usage.

These endpoints make the Nexus Remote viewer customisable per technician and
teach it to adapt: preferences persist the chosen layout, panels and defaults,
usage events record which studio tools a technician actually uses, and insights
turn those counts into an explainable adaptive ordering plus bounded
suggestions. Records are tenant-scoped and user-scoped: one technician's studio
never learns from another technician's habits, and nothing here carries remote
session content, credentials or endpoint data.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.database import db
from app.services.remote_studio import (
    DEFAULT_PREFERENCES,
    REMOTE_TOOLS,
    STUDIO_PRESETS,
    derive_suggestions,
    maturity_label,
    normalise_preferences,
    order_quick_actions,
)
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query


router = APIRouter(tags=["Nexus Remote Studio"])


class RemoteStudioPanels(BaseModel):
    evidence: bool = True
    files: bool = True
    timeline: bool = True


class RemoteStudioPreferences(BaseModel):
    """Whitelisted studio preferences. Unknown fields are rejected by pydantic."""

    preset: Literal["standard", "compact", "pro", "focus"] = "standard"
    panels: RemoteStudioPanels = Field(default_factory=RemoteStudioPanels)
    density: Literal["comfortable", "compact"] = "comfortable"
    default_mode: Literal["view", "control"] = "view"
    default_display: Literal["all", "primary"] = "all"
    quick_actions: list[str] = Field(default_factory=list, max_length=len(REMOTE_TOOLS))

    def to_policy(self) -> dict:
        return normalise_preferences({
            "preset": self.preset,
            "panels": self.panels.model_dump(),
            "density": self.density,
            "default_mode": self.default_mode,
            "default_display": self.default_display,
            "quick_actions": self.quick_actions,
        })


class RemoteStudioUsageEvent(BaseModel):
    tool: Literal[
        "start_view", "start_control", "display_all", "display_focus",
        "zoom_in", "zoom_out", "fit", "focus_desktop", "show_evidence",
        "full_screen", "pop_out", "file_browse", "file_retrieve", "file_send",
        "end_session",
    ]
    session_id: str = Field(default="", max_length=64)
    mode: Literal["view", "control"] | None = None
    display: str = Field(default="", max_length=16)


from app.services.time_utils import now_iso as _now


def _studio_query(current_user: dict) -> dict:
    return tenant_scoped_query(current_user, {"user_id": str(current_user.get("id") or "")})


@router.get("/remote/studio/preferences")
async def get_remote_studio_preferences(current_user: dict = Depends(get_current_user)):
    """Return this technician's saved studio preferences, defaulting cleanly."""
    saved = await db.remote_studio_preferences.find_one(
        _studio_query(current_user), {"_id": 0}
    )
    return normalise_preferences(saved or DEFAULT_PREFERENCES)


@router.put("/remote/studio/preferences")
async def put_remote_studio_preferences(
    payload: RemoteStudioPreferences,
    current_user: dict = Depends(get_current_user),
):
    """Persist this technician's studio preferences (tenant- and user-scoped)."""
    document = payload.to_policy()
    document.update({
        "tenant_id": platform_tenant_id(current_user),
        "user_id": str(current_user.get("id") or ""),
        "updated_at": _now(),
    })
    await db.remote_studio_preferences.update_one(
        _studio_query(current_user),
        {"$set": document},
        upsert=True,
    )
    return normalise_preferences(document)


@router.post("/remote/studio/usage")
async def record_remote_studio_usage(
    payload: RemoteStudioUsageEvent,
    current_user: dict = Depends(get_current_user),
):
    """Record one bounded studio-tool usage event for adaptive ordering.

    Counters only: no desktop content, coordinates, file names or endpoint
    paths are accepted or stored here.
    """
    query = tenant_scoped_query(current_user, {
        "user_id": str(current_user.get("id") or ""),
        "tool": payload.tool,
    })
    update = {
        "$set": {
            "tenant_id": platform_tenant_id(current_user),
            "user_id": str(current_user.get("id") or ""),
            "tool": payload.tool,
            "last_used_at": _now(),
        },
        "$inc": {"count": 1},
    }
    if payload.mode:
        update["$set"]["last_mode"] = payload.mode
    if payload.display:
        update["$set"]["last_display"] = payload.display
    await db.remote_studio_usage.update_one(query, update, upsert=True)
    return {"recorded": True, "tool": payload.tool}


@router.get("/remote/studio/insights")
async def get_remote_studio_insights(current_user: dict = Depends(get_current_user)):
    """Return the explainable adaptation state derived from recorded usage."""
    rows = await db.remote_studio_usage.find(
        _studio_query(current_user), {"_id": 0}
    ).to_list(len(REMOTE_TOOLS) + 8)
    usage_counts = {str(row.get("tool") or ""): int(row.get("count") or 0) for row in rows}
    event_total = sum(usage_counts.values())
    preferences = normalise_preferences(
        (await db.remote_studio_preferences.find_one(_studio_query(current_user), {"_id": 0}))
        or DEFAULT_PREFERENCES
    )
    ordered = order_quick_actions(list(REMOTE_TOOLS), usage_counts)
    return {
        "usage_counts": {tool: usage_counts.get(tool, 0) for tool in REMOTE_TOOLS},
        "event_total": event_total,
        "maturity": maturity_label(event_total),
        "quick_action_order": ordered,
        "suggestions": derive_suggestions(usage_counts, {"events": event_total}),
        "preferences": preferences,
        "presets": {
            key: {"label": value["label"], "detail": value["detail"]}
            for key, value in STUDIO_PRESETS.items()
        },
        "policy": [
            "Adaptation is derived only from recorded studio-tool counters.",
            "Suggestions cite the counts that produced them and are bounded to four.",
            "No desktop content, credentials or endpoint paths are collected.",
        ],
    }
