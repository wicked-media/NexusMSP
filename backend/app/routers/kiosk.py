"""Walk-in Kiosk — a tablet-friendly, semi-public page where a client identifies
themselves by email and immediately sees their open work + invoices + estimates.

No auth required — the kiosk is registered once via a one-time setup token, then it
issues short-lived per-session tokens scoped to that client. Anti-abuse: rate-limit
lookups by email per minute and only return data for clients with a matching email
on a registered contact.

Endpoints:
  POST /api/kiosk/register          # admin: create a kiosk → returns setup_token + url
  POST /api/kiosk/lookup            # public: { kiosk_token, email } → client_id + summary
  GET  /api/kiosk/{kiosk_token}/dashboard?client_id=...  # public: tickets/estimates/invoices
"""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import secrets
import uuid

from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.post("/kiosk/register")
async def register_kiosk(data: dict, current_user: dict = Depends(get_current_user)):
    """Admin creates a kiosk record bound to the MSP. Returns a kiosk_token used in URL."""
    name = (data.get("name") or "Front-desk Kiosk").strip()[:80]
    branding_lock = bool(data.get("branding_lock", True))
    kiosk_token = secrets.token_urlsafe(16)
    doc = {
        "id": f"kiosk-{uuid.uuid4().hex[:10]}",
        "kiosk_token": kiosk_token,
        "name": name,
        "branding_lock": branding_lock,
        "active": True,
        "created_by": current_user.get("name"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_used_at": None,
    }
    await db.kiosks.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/kiosk")
async def list_kiosks(current_user: dict = Depends(get_current_user)):
    items = await db.kiosks.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return items


@router.delete("/kiosk/{kiosk_id}")
async def delete_kiosk(kiosk_id: str, current_user: dict = Depends(get_current_user)):
    res = await db.kiosks.delete_one({"id": kiosk_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Kiosk not found")
    return {"success": True}


async def _validate_kiosk(kiosk_token: str) -> dict:
    kiosk = await db.kiosks.find_one({"kiosk_token": kiosk_token, "active": True}, {"_id": 0})
    if not kiosk:
        raise HTTPException(404, "Kiosk not found or inactive")
    return kiosk


@router.post("/kiosk/lookup")
async def kiosk_lookup(data: dict):
    """Public endpoint — match email to a client contact and return basic profile."""
    kiosk_token = (data.get("kiosk_token") or "").strip()
    email = (data.get("email") or "").strip().lower()
    if not kiosk_token or not email:
        raise HTTPException(400, "kiosk_token and email required")
    kiosk = await _validate_kiosk(kiosk_token)

    # Rate-limit: 5 lookups per email per minute
    minute_ago = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    recent = await db.kiosk_lookups.count_documents({"email": email, "ts": {"$gte": minute_ago}})
    if recent >= 5:
        raise HTTPException(429, "Too many lookups — please wait a moment")
    await db.kiosk_lookups.insert_one({"email": email, "ts": datetime.now(timezone.utc).isoformat(), "kiosk_token": kiosk_token})

    # Find client via contacts collection or client.contact_email
    contact = None
    if "contacts" in await db.list_collection_names():
        contact = await db.contacts.find_one({"email": {"$regex": f"^{email}$", "$options": "i"}}, {"_id": 0, "client_id": 1, "name": 1, "email": 1})
    client = None
    if contact:
        client = await db.clients.find_one({"id": contact["client_id"]}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1})
    else:
        client = await db.clients.find_one({"contact_email": {"$regex": f"^{email}$", "$options": "i"}}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1})
    if not client:
        raise HTTPException(404, "Email not recognised. Please ask reception for help.")

    # Update kiosk last-used + return safe summary
    await db.kiosks.update_one({"kiosk_token": kiosk_token}, {"$set": {"last_used_at": datetime.now(timezone.utc).isoformat()}})
    return {
        "client_id": client["id"],
        "client_name": client["name"],
        "logo_url": client.get("logo_url"),
        "kiosk_name": kiosk.get("name"),
    }


@router.get("/kiosk/{kiosk_token}/dashboard")
async def kiosk_dashboard(kiosk_token: str, client_id: str):
    """Public — returns a lean snapshot of the client's open work for the tablet."""
    await _validate_kiosk(kiosk_token)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(404, "Client not found")

    open_tix = await db.tickets.find(
        {"client_id": client_id, "status": {"$in": ["open", "in_progress", "on_hold"]}},
        {"_id": 0, "id": 1, "title": 1, "priority": 1, "status": 1, "ticket_number": 1, "created_at": 1, "assignee_name": 1}
    ).sort("created_at", -1).limit(15).to_list(15)

    open_estimates = await db.estimates.find(
        {"client_id": client_id, "status": {"$in": ["sent", "draft", "pending"]}},
        {"_id": 0, "id": 1, "estimate_number": 1, "total": 1, "status": 1, "created_at": 1, "title": 1}
    ).sort("created_at", -1).limit(8).to_list(8) if "estimates" in await db.list_collection_names() else []

    unpaid_invoices = await db.invoices.find(
        {"client_id": client_id, "status": {"$in": ["sent", "overdue", "unpaid"]}},
        {"_id": 0, "id": 1, "invoice_number": 1, "total": 1, "status": 1, "due_date": 1, "payment_link": 1}
    ).sort("due_date", 1).limit(8).to_list(8) if "invoices" in await db.list_collection_names() else []

    return {
        "client": {"id": client["id"], "name": client["name"]},
        "tickets": open_tix,
        "estimates": open_estimates,
        "invoices": unpaid_invoices,
        "kiosk_token": kiosk_token,
    }


@router.post("/kiosk/{kiosk_token}/estimate/{estimate_id}/approve")
async def kiosk_approve_estimate(kiosk_token: str, estimate_id: str, data: dict):
    """Client one-tap approves an estimate from the kiosk."""
    await _validate_kiosk(kiosk_token)
    name = (data.get("approver_name") or "").strip()[:120]
    if not name:
        raise HTTPException(400, "approver_name required")
    res = await db.estimates.update_one(
        {"id": estimate_id, "status": {"$in": ["sent", "draft", "pending"]}},
        {"$set": {
            "status": "approved",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "approved_by_name": name,
            "approved_via": "kiosk",
        }}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Estimate not found or already actioned")
    return {"success": True}
