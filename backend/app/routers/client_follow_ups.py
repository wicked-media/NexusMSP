"""Client Studio's tenant-scoped, auditable follow-up register."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.auth import get_current_user
from app.database import db
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.client_follow_ups import new_follow_up, update_follow_up, visible_follow_up
from app.services.scope_permissions import (
    assert_client_scope,
    effective_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)


router = APIRouter(tags=["Client follow-ups"])


# This endpoint is a personal working register, not a replacement for a
# tenant-wide CRM report.  Keeping the page bounded protects the API from an
# unbounded historical portfolio while making a partial view obvious to the UI.
MY_FOLLOW_UPS_LIMIT = 100
_MY_FOLLOW_UP_VISIBLE_FIELDS = (
    "id",
    "client_id",
    "title",
    "note",
    "kind",
    "priority",
    "status",
    "due_at",
    "owner_id",
    "owner_name",
    "created_at",
    "updated_at",
    "version",
    "completed_at",
    "completed_by_id",
    "completed_by_name",
    "completion_note",
)


class FollowUpCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    note: str = Field(default="", max_length=4000)
    kind: Literal["task", "call", "meeting", "review"] = "task"
    priority: Literal["low", "normal", "high"] = "normal"
    due_at: datetime
    owner_id: str | None = Field(default=None, min_length=1, max_length=200)
    idempotency_key: str = Field(min_length=8, max_length=160)


class FollowUpUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    note: str | None = Field(default=None, max_length=4000)
    kind: Literal["task", "call", "meeting", "review"] | None = None
    priority: Literal["low", "normal", "high"] | None = None
    due_at: datetime | None = None
    owner_id: str | None = Field(default=None, min_length=1, max_length=200)
    status: Literal["open", "completed", "cancelled"] | None = None
    completion_note: str | None = Field(default=None, max_length=4000)
    expected_version: int = Field(ge=1)

    @model_validator(mode="after")
    def has_change(self):
        editable = ("title", "note", "kind", "priority", "due_at", "owner_id", "status", "completion_note")
        if not any(getattr(self, field) is not None for field in editable):
            raise ValueError("Include at least one follow-up change")
        return self


async def _client_or_404(client_id: str, current_user: dict, *, operation: str) -> dict:
    await assert_client_scope(current_user, client_id, operation=operation, mask_not_found=True)
    client = await db.clients.find_one(tenant_scoped_query(current_user, {"id": client_id}), {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def _owner_or_422(owner_id: str | None, current_user: dict) -> dict:
    selected_id = str(owner_id or current_user.get("id") or "").strip()
    owner = await db.users.find_one(
        tenant_scoped_query(current_user, {
            "id": selected_id,
            "archived": {"$ne": True},
            "is_active": {"$ne": False},
        }),
        {"_id": 0, "id": 1, "name": 1},
    )
    if not owner:
        raise HTTPException(status_code=422, detail="Choose an active team member in this Nexus workspace")
    return owner


async def _owners(current_user: dict) -> list[dict]:
    return await db.users.find(
        tenant_scoped_query(current_user, {"archived": {"$ne": True}, "is_active": {"$ne": False}}),
        {"_id": 0, "id": 1, "name": 1},
    ).sort("name", 1).to_list(500)


async def _audit(current_user: dict, action: str, client_id: str, changes: dict) -> None:
    follow_up_id = changes.get("follow_up_id")
    await log_activity(
        current_user,
        action,
        "client",
        client_id,
        details="Client follow-up changed",
        changes=changes,
        metadata={"tenant_id": platform_tenant_id(current_user), "follow_up_id": follow_up_id},
    )


async def _authorized_client_display_names(current_user: dict, client_ids: set[str]) -> dict[str, str]:
    """Resolve names only from parent clients still visible to this technician.

    A follow-up's stored client ID is not treated as display data or proof of
    current access.  This second, tenant- and client-scoped query means a
    stale/orphaned relationship record cannot disclose a client name in the
    technician's cross-client portfolio.
    """
    if not client_ids:
        return {}

    clients = await db.clients.find(
        tenant_scoped_query(
            current_user,
            scoped_query(
                current_user,
                {"id": {"$in": sorted(client_ids)}},
                field="id",
                site_field=None,
            ),
        ),
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(len(client_ids))
    return {
        str(client["id"]): str(client.get("name") or "Unnamed client").strip() or "Unnamed client"
        for client in clients
        if client.get("id")
    }


def _my_follow_up_view(row: dict, client_name: str) -> dict:
    """Return the intentionally small, safe projection for the personal register."""
    visible = visible_follow_up(row)
    result = {key: visible[key] for key in _MY_FOLLOW_UP_VISIBLE_FIELDS if key in visible}
    result["client_name"] = client_name
    return result


@router.get("/client-follow-ups/mine")
async def list_my_client_follow_ups(current_user: dict = Depends(get_current_user)):
    """List the signed-in technician's owned follow-ups across permitted clients.

    The owner, tenant and client boundary are all derived server-side.  The
    browser cannot widen this into another technician's portfolio by sending a
    user ID or client filter.
    """
    owner_id = str(current_user.get("id") or "").strip()
    if not owner_id:
        raise HTTPException(status_code=403, detail="A signed-in technician identity is required")

    scope = effective_scope(current_user)
    if scope["mode"] == "restricted" and not scope["client_ids"]:
        return {"follow_ups": [], "limit": MY_FOLLOW_UPS_LIMIT, "possibly_truncated": False}

    query: dict = {"owner_id": owner_id}
    if scope["mode"] == "restricted":
        query["client_id"] = {"$in": scope["client_ids"]}

    rows = await db.client_follow_ups.find(
        tenant_scoped_query(current_user, query),
        {"_id": 0, "tenant_id": 0, "idempotency_key": 0},
    ).sort("due_at", 1).to_list(MY_FOLLOW_UPS_LIMIT + 1)
    possibly_truncated = len(rows) > MY_FOLLOW_UPS_LIMIT
    allowed_client_ids = set(scope["client_ids"])
    page = [
        row
        for row in rows[:MY_FOLLOW_UPS_LIMIT]
        if str(row.get("owner_id") or "") == owner_id
        and (scope["mode"] == "all" or str(row.get("client_id") or "") in allowed_client_ids)
    ]
    client_names = await _authorized_client_display_names(
        current_user,
        {str(row.get("client_id") or "").strip() for row in page if str(row.get("client_id") or "").strip()},
    )

    # Do not return an owned row when its client can no longer be resolved
    # inside the caller's tenant and effective client boundary.
    return {
        "follow_ups": [
            _my_follow_up_view(row, client_names[str(row["client_id"])])
            for row in page
            if str(row.get("client_id") or "") in client_names
        ],
        "limit": MY_FOLLOW_UPS_LIMIT,
        "possibly_truncated": possibly_truncated,
    }


@router.get("/clients/{client_id}/follow-ups")
async def list_client_follow_ups(client_id: str, current_user: dict = Depends(get_current_user)):
    """Return the scoped register and eligible owners for one client account."""
    await _client_or_404(client_id, current_user, operation="client.follow_up.read")
    rows = await db.client_follow_ups.find(
        tenant_scoped_query(current_user, {"client_id": client_id}),
        {"_id": 0, "tenant_id": 0, "idempotency_key": 0},
    ).sort("due_at", 1).to_list(500)
    return {
        "follow_ups": [visible_follow_up(row) for row in rows],
        "owners": await _owners(current_user),
        "limit": 500,
        "possibly_truncated": len(rows) == 500,
    }


@router.post("/clients/{client_id}/follow-ups", dependencies=[Depends(require_action("client.follow_up.manage"))])
async def create_client_follow_up(
    client_id: str,
    data: FollowUpCreate,
    current_user: dict = Depends(get_current_user),
):
    await _client_or_404(client_id, current_user, operation="client.follow_up.create")
    owner = await _owner_or_422(data.owner_id, current_user)
    row = new_follow_up(
        tenant_id=platform_tenant_id(current_user),
        client_id=client_id,
        data=data.model_dump(),
        owner=owner,
        actor=current_user,
    )
    result = await db.client_follow_ups.update_one(
        {"_id": row["_id"], "tenant_id": row["tenant_id"], "client_id": client_id},
        {"$setOnInsert": row},
        upsert=True,
    )
    created = result.upserted_id is not None
    if created:
        await _audit(current_user, "client_follow_up_created", client_id, {
            "follow_up_id": row["id"],
            "kind": row["kind"],
            "priority": row["priority"],
            "due_at": row["due_at"],
            "owner_id": row["owner_id"],
            "status": row["status"],
        })
        return {"follow_up": visible_follow_up(row), "created": True}

    existing = await db.client_follow_ups.find_one(
        tenant_scoped_query(current_user, {"_id": row["_id"], "client_id": client_id}),
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(status_code=409, detail="Follow-up submission is still being processed. Refresh and try again")
    return {"follow_up": visible_follow_up(existing), "created": False}


@router.put("/clients/{client_id}/follow-ups/{follow_up_id}", dependencies=[Depends(require_action("client.follow_up.manage"))])
async def update_client_follow_up(
    client_id: str,
    follow_up_id: str,
    data: FollowUpUpdate,
    current_user: dict = Depends(get_current_user),
):
    await _client_or_404(client_id, current_user, operation="client.follow_up.update")
    query = tenant_scoped_query(current_user, {"id": follow_up_id, "client_id": client_id})
    existing = await db.client_follow_ups.find_one(query, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    if data.status == "completed" and existing.get("status") == "completed":
        raise HTTPException(status_code=409, detail="This follow-up is already complete. Refresh before recording another update")

    owner = await _owner_or_422(data.owner_id, current_user) if data.owner_id is not None else None
    changes, operations = update_follow_up(existing, data.model_dump(), owner=owner, actor=current_user)
    mutation: dict = {"$set": changes, "$inc": {"version": 1}}
    if operations["unset"]:
        mutation["$unset"] = operations["unset"]
    result = await db.client_follow_ups.update_one(
        tenant_scoped_query(current_user, {
            "id": follow_up_id,
            "client_id": client_id,
            "version": data.expected_version,
        }),
        mutation,
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This follow-up changed. Refresh before saving again")

    audit = operations["audit"]
    if data.status == "completed" and existing.get("status") != "completed":
        action = "client_follow_up_completed"
    elif data.status == "cancelled" and existing.get("status") != "cancelled":
        action = "client_follow_up_cancelled"
    elif data.status == "open" and existing.get("status") != "open":
        action = "client_follow_up_reopened"
    else:
        action = "client_follow_up_updated"
    await _audit(current_user, action, client_id, audit)

    updated = {**existing, **changes, "version": data.expected_version + 1}
    for key in operations["unset"]:
        updated.pop(key, None)
    return {"follow_up": visible_follow_up(updated)}
