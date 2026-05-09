"""
Command Palette router — global search + slash command execution from anywhere.

Endpoints:
- GET  /api/command-palette/search?q=...  → { tickets, clients, devices, users }
- POST /api/command-palette/run           → run a slash command without a channel
                                             (auto-resolves to user's #ops or #general)
"""

from fastapi import APIRouter, Depends, Body, HTTPException
from app.database import db
from app.routers.auth import get_current_user
import re

router = APIRouter()


@router.get("/command-palette/search")
async def palette_search(q: str = "", current_user: dict = Depends(get_current_user)):
    q = (q or "").strip()
    if len(q) < 1:
        return {"tickets": [], "clients": [], "devices": [], "users": []}

    # Escape regex special chars so user input doesn't blow up the query
    rx = re.escape(q)
    regex = {"$regex": rx, "$options": "i"}

    tickets = await db.tickets.find(
        {"$or": [{"title": regex}, {"ticket_number": regex}, {"client_name": regex}]},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1, "priority": 1, "client_name": 1},
    ).limit(8).to_list(8)

    clients = await db.clients.find(
        {"$or": [{"name": regex}, {"email": regex}, {"phone": regex}]},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "contract_status": 1},
    ).limit(8).to_list(8)

    devices = await db.devices.find(
        {"$or": [{"hostname": regex}, {"name": regex}, {"client_name": regex}]},
        {"_id": 0, "id": 1, "hostname": 1, "name": 1, "client_name": 1, "status": 1, "device_type": 1},
    ).limit(8).to_list(8)

    users = await db.users.find(
        {"$or": [{"name": regex}, {"email": regex}]},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1},
    ).limit(6).to_list(6)

    return {"tickets": tickets, "clients": clients, "devices": devices, "users": users}


async def _resolve_default_channel(user_id: str) -> str | None:
    """Pick a sensible channel to post to when the palette runs a slash command."""
    # Prefer #ops, then #general, then any team channel the user is a member of
    for name in ("ops", "general"):
        ch = await db.chat_channels.find_one({"name": name, "kind": "team"}, {"_id": 0, "id": 1})
        if ch:
            return ch["id"]
    ch = await db.chat_channels.find_one(
        {"$or": [{"member_ids": user_id}, {"kind": "team", "member_ids": {"$size": 0}}]},
        {"_id": 0, "id": 1},
    )
    return ch["id"] if ch else None


@router.post("/command-palette/run")
async def palette_run(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Run a slash command from the palette — channel-less.
    The command is executed via the existing chat slash router, posting to a
    default channel so the action is auditable in chat history.
    """
    raw = (payload.get("raw") or "").strip()
    if not raw.startswith("/"):
        raise HTTPException(400, "raw must start with /")

    channel_id = payload.get("channel_id") or await _resolve_default_channel(current_user.get("id"))
    if not channel_id:
        raise HTTPException(404, "No team channel available — create #ops or #general first")

    # Delegate to the existing slash handler — single source of truth for command logic
    from app.routers.chat_presence import slash as _slash
    msg = await _slash(payload={"raw": raw, "channel_id": channel_id}, current_user=current_user)
    return {"channel_id": channel_id, "message": msg}
