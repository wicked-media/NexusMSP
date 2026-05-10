"""
Saved Views — per-user pinned filter+grouping presets for tickets & workspace.
Each user can save: name, scope ('tickets'|'workspace'), filters, group_by, density,
sort, color, icon, pinned (top-bar), shared (visible to whole team).
"""

from fastapi import APIRouter, Depends, Body, HTTPException
from datetime import datetime, timezone
import uuid

from app.database import db
from app.routers.auth import get_current_user

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip(d: dict) -> dict:
    d.pop("_id", None)
    return d


@router.get("/saved-views")
async def list_saved_views(scope: str | None = None, current_user: dict = Depends(get_current_user)):
    """List my views + shared team views, optionally filtered by scope."""
    uid = current_user.get("id")
    q = {"$or": [{"user_id": uid}, {"shared": True}]}
    if scope:
        q["scope"] = scope
    cursor = db.saved_views.find(q, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(200)
    return items


@router.post("/saved-views")
async def create_saved_view(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    scope = payload.get("scope") or "tickets"
    if scope not in {"tickets", "workspace", "devices", "clients"}:
        raise HTTPException(400, "scope must be tickets|workspace|devices|clients")
    view = {
        "id": uuid.uuid4().hex,
        "user_id": current_user.get("id"),
        "user_name": current_user.get("name"),
        "name": name,
        "scope": scope,
        "filters": payload.get("filters") or {},
        "group_by": payload.get("group_by") or "none",
        "density": payload.get("density") or "comfortable",
        "sort": payload.get("sort") or "created_desc",
        "color": payload.get("color") or "violet",
        "icon": payload.get("icon") or "Star",
        "pinned": bool(payload.get("pinned", True)),
        "shared": bool(payload.get("shared", False)),
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.saved_views.insert_one(dict(view))
    return _strip(view)


@router.put("/saved-views/{view_id}")
async def update_saved_view(view_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    existing = await db.saved_views.find_one({"id": view_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "View not found")
    if existing.get("user_id") != current_user.get("id") and not existing.get("shared"):
        raise HTTPException(403, "Not your view")

    allowed = {"name", "filters", "group_by", "density", "sort", "color", "icon", "pinned", "shared"}
    update = {k: v for k, v in payload.items() if k in allowed}
    update["updated_at"] = _now()
    await db.saved_views.update_one({"id": view_id}, {"$set": update})
    fresh = await db.saved_views.find_one({"id": view_id}, {"_id": 0})
    return fresh


@router.delete("/saved-views/{view_id}")
async def delete_saved_view(view_id: str, current_user: dict = Depends(get_current_user)):
    existing = await db.saved_views.find_one({"id": view_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "View not found")
    if existing.get("user_id") != current_user.get("id"):
        raise HTTPException(403, "Not your view")
    await db.saved_views.delete_one({"id": view_id})
    return {"success": True}
