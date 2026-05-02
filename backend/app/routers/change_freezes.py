"""Change Freeze Calendar.

Lets MSP define client-specific blackout windows during which automated
TRMM patches/scripts/reboots/SLA broadcasts must NOT fire.

Endpoints:
  GET  /api/change-freezes              — list all (optional ?client_id=, ?active_only=true)
  POST /api/change-freezes              — create
  GET  /api/change-freezes/{id}         — fetch one
  PUT  /api/change-freezes/{id}         — update
  DELETE /api/change-freezes/{id}       — remove
  GET  /api/change-freezes/active       — windows currently active right now (across all clients)
  GET  /api/change-freezes/check?client_id=X[&kind=patch]  — boolean is-frozen check
                                          (used by other routers + scheduler)
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from datetime import datetime, timezone
from typing import Optional
import uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize(payload: dict) -> dict:
    return {
        "client_id": payload.get("client_id"),  # None = MSP-wide freeze
        "title": (payload.get("title") or "").strip()[:160] or "Change Freeze",
        "starts_at": payload.get("starts_at"),  # ISO string
        "ends_at": payload.get("ends_at"),
        "kinds": payload.get("kinds") or ["patch", "reboot", "script", "broadcast"],
        "reason": (payload.get("reason") or "").strip()[:600],
        "owner_email": payload.get("owner_email"),
        "active": bool(payload.get("active", True)),
    }


@router.get("/change-freezes")
async def list_freezes(client_id: Optional[str] = None, active_only: bool = False, current_user: dict = Depends(get_current_user)):
    q = {}
    if client_id is not None:
        q["client_id"] = client_id
    if active_only:
        now = _now_iso()
        q["active"] = True
        q["starts_at"] = {"$lte": now}
        q["ends_at"] = {"$gte": now}
    rows = await db.change_freezes.find(q, {"_id": 0}).sort("starts_at", -1).limit(500).to_list(500)
    # Hydrate client name for display
    client_ids = list({r.get("client_id") for r in rows if r.get("client_id")})
    name_map = {}
    if client_ids:
        cs = await db.clients.find({"id": {"$in": client_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        name_map = {c["id"]: c["name"] for c in cs}
    for r in rows:
        r["client_name"] = name_map.get(r.get("client_id")) if r.get("client_id") else "All clients"
    return {"freezes": rows, "count": len(rows)}


@router.post("/change-freezes")
async def create_freeze(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    doc = _normalize(payload)
    if not doc.get("starts_at") or not doc.get("ends_at"):
        raise HTTPException(400, "starts_at and ends_at are required (ISO format)")
    doc.update({
        "id": uuid.uuid4().hex,
        "created_at": _now_iso(),
        "created_by": current_user.get("email"),
    })
    await db.change_freezes.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


@router.get("/change-freezes/active")
async def active_freezes(current_user: dict = Depends(get_current_user)):
    now = _now_iso()
    rows = await db.change_freezes.find(
        {"active": True, "starts_at": {"$lte": now}, "ends_at": {"$gte": now}},
        {"_id": 0},
    ).limit(200).to_list(200)
    client_ids = list({r.get("client_id") for r in rows if r.get("client_id")})
    name_map = {}
    if client_ids:
        cs = await db.clients.find({"id": {"$in": client_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        name_map = {c["id"]: c["name"] for c in cs}
    for r in rows:
        r["client_name"] = name_map.get(r.get("client_id")) if r.get("client_id") else "All clients"
    return {"active": rows, "count": len(rows)}


@router.get("/change-freezes/check")
async def check_freeze(client_id: Optional[str] = None, kind: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Used by other routers + the scheduler to bail before firing."""
    return await _is_frozen(client_id, kind)


# Reusable helper for other modules to import
async def _is_frozen(client_id: Optional[str] = None, kind: Optional[str] = None) -> dict:
    now = _now_iso()
    q = {"active": True, "starts_at": {"$lte": now}, "ends_at": {"$gte": now}}
    rows = await db.change_freezes.find(q, {"_id": 0}).to_list(200)
    matches = []
    for r in rows:
        # MSP-wide (no client_id) always matches; otherwise must match the requested client
        if r.get("client_id") and client_id and r["client_id"] != client_id:
            continue
        if r.get("client_id") and not client_id:
            continue
        if kind and kind not in (r.get("kinds") or []):
            continue
        matches.append(r)
    return {"frozen": len(matches) > 0, "matches": matches, "client_id": client_id, "kind": kind}


@router.get("/change-freezes/{freeze_id}")
async def get_freeze(freeze_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.change_freezes.find_one({"id": freeze_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "freeze not found")
    return doc


@router.put("/change-freezes/{freeze_id}")
async def update_freeze(freeze_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    existing = await db.change_freezes.find_one({"id": freeze_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "freeze not found")
    patch = _normalize({**existing, **payload})
    patch["updated_at"] = _now_iso()
    patch["updated_by"] = current_user.get("email")
    await db.change_freezes.update_one({"id": freeze_id}, {"$set": patch})
    return {**existing, **patch}


@router.delete("/change-freezes/{freeze_id}")
async def delete_freeze(freeze_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.change_freezes.delete_one({"id": freeze_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "freeze not found")
    return {"deleted": True}
