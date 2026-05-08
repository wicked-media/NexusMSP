"""
Per-tech Workspace module.
Each user has a workspace doc holding pinned tickets, watched devices, and personal notes.
"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
from typing import Optional
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


async def _get_or_create_workspace(user_id: str):
    ws = await db.workspaces.find_one({"user_id": user_id}, {"_id": 0})
    if ws:
        return ws
    ws = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "pinned_tickets": [],   # list of {ticket_id, pinned_at, note}
        "watched_devices": [],  # list of {device_id, watched_at, reason}
        "scratch_notes": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.workspaces.insert_one(ws.copy())
    return ws


@router.get("/workspace")
async def get_workspace(current_user: dict = Depends(get_current_user)):
    """Get the current user's workspace with hydrated ticket and device data."""
    ws = await _get_or_create_workspace(current_user["id"])

    # Hydrate pinned tickets
    pinned_ids = [p["ticket_id"] for p in (ws.get("pinned_tickets") or []) if p.get("ticket_id")]
    pinned_tickets = []
    if pinned_ids:
        ticket_docs = await db.tickets.find(
            {"id": {"$in": pinned_ids}},
            {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "status": 1, "client_name": 1, "sla_due": 1, "assigned_name": 1}
        ).to_list(200)
        ticket_map = {t["id"]: t for t in ticket_docs}
        for p in ws.get("pinned_tickets") or []:
            t = ticket_map.get(p["ticket_id"])
            if t:
                pinned_tickets.append({**t, "pinned_at": p.get("pinned_at"), "note": p.get("note", "")})

    # Hydrate watched devices
    watched_ids = [w["device_id"] for w in (ws.get("watched_devices") or []) if w.get("device_id")]
    watched_devices = []
    if watched_ids:
        device_docs = await db.devices.find(
            {"id": {"$in": watched_ids}},
            {"_id": 0, "id": 1, "name": 1, "client_name": 1, "status": 1, "ip_address": 1, "os": 1, "device_type": 1, "last_seen": 1}
        ).to_list(200)
        device_map = {d["id"]: d for d in device_docs}
        for w in ws.get("watched_devices") or []:
            d = device_map.get(w["device_id"])
            if d:
                watched_devices.append({**d, "watched_at": w.get("watched_at"), "reason": w.get("reason", "")})

    # Recent activity (my own actions, last 20)
    recent = await db.activity_logs.find(
        {"user_id": current_user["id"]},
        {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)

    # My open tickets
    my_open = await db.tickets.find(
        {"assigned_to": current_user["id"], "status": {"$nin": ["closed", "resolved"]}},
        {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "priority": 1, "status": 1, "sla_due": 1, "client_name": 1}
    ).sort("sla_due", 1).limit(50).to_list(50)

    return {
        "workspace_id": ws["id"],
        "user_id": ws["user_id"],
        "pinned_tickets": pinned_tickets,
        "watched_devices": watched_devices,
        "scratch_notes": ws.get("scratch_notes", ""),
        "recent_activity": recent,
        "my_open_tickets": my_open,
        "stats": {
            "pinned_count": len(pinned_tickets),
            "watched_count": len(watched_devices),
            "open_assigned": len(my_open),
            "critical_assigned": sum(1 for t in my_open if t.get("priority") == "critical"),
        },
    }


@router.post("/workspace/pin/ticket/{ticket_id}")
async def pin_ticket(ticket_id: str, body: Optional[dict] = None, current_user: dict = Depends(get_current_user)):
    body = body or {}
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "title": 1})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    ws = await _get_or_create_workspace(current_user["id"])
    pinned = ws.get("pinned_tickets") or []
    if any(p.get("ticket_id") == ticket_id for p in pinned):
        return {"message": "Already pinned", "pinned": True}
    pinned.append({
        "ticket_id": ticket_id,
        "pinned_at": datetime.now(timezone.utc).isoformat(),
        "note": body.get("note", ""),
    })
    await db.workspaces.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"pinned_tickets": pinned, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Pinned", "pinned": True, "count": len(pinned)}


@router.delete("/workspace/pin/ticket/{ticket_id}")
async def unpin_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ws = await _get_or_create_workspace(current_user["id"])
    pinned = [p for p in (ws.get("pinned_tickets") or []) if p.get("ticket_id") != ticket_id]
    await db.workspaces.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"pinned_tickets": pinned, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Unpinned", "pinned": False, "count": len(pinned)}


@router.get("/workspace/pin/ticket/{ticket_id}/status")
async def is_ticket_pinned(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ws = await db.workspaces.find_one({"user_id": current_user["id"]}, {"_id": 0, "pinned_tickets": 1}) or {}
    pinned = any(p.get("ticket_id") == ticket_id for p in (ws.get("pinned_tickets") or []))
    return {"pinned": pinned}


@router.post("/workspace/watch/device/{device_id}")
async def watch_device(device_id: str, body: Optional[dict] = None, current_user: dict = Depends(get_current_user)):
    body = body or {}
    device = await db.devices.find_one({"id": device_id}, {"_id": 0, "id": 1, "name": 1})
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    ws = await _get_or_create_workspace(current_user["id"])
    watched = ws.get("watched_devices") or []
    if any(w.get("device_id") == device_id for w in watched):
        return {"message": "Already watched", "watched": True}
    watched.append({
        "device_id": device_id,
        "watched_at": datetime.now(timezone.utc).isoformat(),
        "reason": body.get("reason", ""),
    })
    await db.workspaces.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"watched_devices": watched, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Watching", "watched": True, "count": len(watched)}


@router.delete("/workspace/watch/device/{device_id}")
async def unwatch_device(device_id: str, current_user: dict = Depends(get_current_user)):
    ws = await _get_or_create_workspace(current_user["id"])
    watched = [w for w in (ws.get("watched_devices") or []) if w.get("device_id") != device_id]
    await db.workspaces.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"watched_devices": watched, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Unwatched", "watched": False, "count": len(watched)}


@router.put("/workspace/scratch-notes")
async def update_scratch_notes(body: dict, current_user: dict = Depends(get_current_user)):
    notes = (body or {}).get("notes", "")
    await _get_or_create_workspace(current_user["id"])
    await db.workspaces.update_one(
        {"user_id": current_user["id"]},
        {"$set": {"scratch_notes": notes, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Saved"}
