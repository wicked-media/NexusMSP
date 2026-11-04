"""Technician Roster — the directory of pageable humans.

Each technician has:
  - basic identity (name, email, role, active)
  - contact channels (mobile, slack_handle, teams_email)
  - escalation_tier (1 | 2 | 3) — auto-escalation waterfall
  - on_call (derived bool) — current state from time-bound on-call shifts
  - preferred_channels (array) — which channels the tech wants pages on

This router powers the War Room "Page Team" flow and any future on-call rotation.
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone
import uuid

from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import platform_tenant_id, tenant_scoped_query

router = APIRouter()

VALID_CHANNELS = {"slack", "teams", "sms", "email", "push"}


def _sanitize(data: dict) -> dict:
    out = {}
    for k in ("name", "email", "role", "mobile", "slack_handle", "teams_email", "notes"):
        v = data.get(k)
        if v is not None:
            out[k] = str(v).strip()[:200]
    if "active" in data:
        out["active"] = bool(data["active"])
    if "on_call" in data:
        out["on_call"] = bool(data["on_call"])
    if "escalation_tier" in data:
        try:
            tier = int(data["escalation_tier"])
            out["escalation_tier"] = max(1, min(3, tier))
        except Exception:
            pass
    if "preferred_channels" in data:
        ch = [c for c in (data.get("preferred_channels") or []) if c in VALID_CHANNELS]
        out["preferred_channels"] = ch or ["email"]
    return out


@router.get("/tech-roster")
async def list_technicians(active_only: bool = False, on_call_only: bool = False, current_user: dict = Depends(get_current_user)):
    q = {}
    if active_only:
        q["active"] = True
    techs = await db.tech_roster.find(tenant_scoped_query(current_user, q), {"_id": 0, "tenant_id": 0}).sort("escalation_tier", 1).to_list(500)
    now = datetime.now(timezone.utc).isoformat()
    active_shifts = await db.on_call_roster.find(tenant_scoped_query(current_user, {
        "start_time": {"$lte": now}, "end_time": {"$gte": now}, "status": {"$ne": "cancelled"},
    }), {"_id": 0, "tech_id": 1}).to_list(500)
    active_ids = {shift.get("tech_id") for shift in active_shifts}
    for tech in techs:
        tech["on_call"] = tech.get("id") in active_ids
    if on_call_only:
        techs = [tech for tech in techs if tech["on_call"]]
    return techs


@router.post("/tech-roster")
async def create_technician(data: dict, current_user: dict = Depends(get_current_user), _permission: dict = Depends(require_action("platform.configuration.manage"))):
    if not (data.get("name") or "").strip():
        raise HTTPException(400, "name required")
    clean = _sanitize(data)
    doc = {
        "id": f"tech-{uuid.uuid4().hex[:10]}",
        "tenant_id": platform_tenant_id(current_user),
        "active": True,
        "on_call": False,
        "escalation_tier": 2,
        "preferred_channels": ["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name"),
        **clean,
    }
    await db.tech_roster.insert_one(doc)
    await log_activity(
        current_user, "roster_contact_created", "tech_roster", doc["id"], doc.get("name", "Roster contact"),
        "Added contact to on-call coverage.",
        metadata={"tier": doc.get("escalation_tier"), "on_call": doc.get("on_call"), "channels": doc.get("preferred_channels", [])},
    )
    doc.pop("_id", None)
    doc.pop("tenant_id", None)
    return doc


@router.put("/tech-roster/{tech_id}")
async def update_technician(tech_id: str, data: dict, current_user: dict = Depends(get_current_user), _permission: dict = Depends(require_action("platform.configuration.manage"))):
    clean = _sanitize(data)
    if not clean:
        return {"success": True, "no_change": True}
    query = tenant_scoped_query(current_user, {"id": tech_id})
    before = await db.tech_roster.find_one(query, {"_id": 0})
    if not before:
        raise HTTPException(404, "Tech not found")
    clean["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.tech_roster.update_one(query, {"$set": clean})
    doc = await db.tech_roster.find_one(query, {"_id": 0, "tenant_id": 0})
    changed = {key: value for key, value in clean.items() if key != "updated_at" and before.get(key) != value}
    if changed:
        await log_activity(
            current_user, "roster_contact_updated", "tech_roster", tech_id, doc.get("name", "Roster contact"),
            "Updated on-call coverage details.", changes=changed,
        )
    return doc


@router.delete("/tech-roster/{tech_id}")
async def delete_technician(tech_id: str, current_user: dict = Depends(get_current_user), _permission: dict = Depends(require_action("platform.configuration.manage"))):
    query = tenant_scoped_query(current_user, {"id": tech_id})
    target = await db.tech_roster.find_one(query, {"_id": 0})
    if not target:
        raise HTTPException(404, "Tech not found")
    await db.tech_roster.delete_one(query)
    await log_activity(
        current_user, "roster_contact_removed", "tech_roster", tech_id, target.get("name", "Roster contact"),
        "Removed contact from on-call coverage.",
        metadata={"tier": target.get("escalation_tier"), "on_call": target.get("on_call"), "channels": target.get("preferred_channels", [])},
    )
    return {"success": True}
