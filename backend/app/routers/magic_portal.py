from fastapi import APIRouter, Depends
from datetime import datetime, timezone
import uuid, hashlib
from app.database import db
from app.auth import get_current_user

router = APIRouter()


def generate_magic_token(client_id: str) -> str:
    """Generate a deterministic but hard-to-guess magic link token."""
    secret = f"nexusops-magic-{client_id}-{uuid.uuid4().hex[:8]}"
    return hashlib.sha256(secret.encode()).hexdigest()[:24]


@router.post("/magic-portal/generate/{client_id}")
async def generate_magic_link(client_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a magic link for a client portal."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "email": 1})
    if not client:
        return {"error": "Client not found"}

    token = generate_magic_token(client_id)
    doc = {
        "client_id": client_id, "client_name": client.get("name", ""),
        "token": token, "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", ""),
        "expires_at": None,  # Never expires unless revoked
        "last_accessed": None, "access_count": 0,
    }
    await db.magic_links.update_one({"client_id": client_id}, {"$set": doc}, upsert=True)
    return {"token": token, "client_name": client.get("name", ""), "url": f"/portal/{token}"}


@router.get("/magic-portal/links")
async def get_all_magic_links(current_user: dict = Depends(get_current_user)):
    """Get all generated magic links."""
    links = await db.magic_links.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return links


@router.delete("/magic-portal/revoke/{client_id}")
async def revoke_magic_link(client_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke a client's magic link."""
    await db.magic_links.update_one({"client_id": client_id}, {"$set": {"active": False}})
    return {"message": "Link revoked"}


@router.get("/magic-portal/access/{token}")
async def access_magic_portal(token: str):
    """Public endpoint - access client portal via magic link."""
    link = await db.magic_links.find_one({"token": token, "active": True}, {"_id": 0})
    if not link:
        return {"error": "Invalid or expired link", "found": False}

    client_id = link["client_id"]
    await db.magic_links.update_one({"token": token}, {
        "$set": {"last_accessed": datetime.now(timezone.utc).isoformat()},
        "$inc": {"access_count": 1}
    })

    # Gather portal data
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1, "email": 1, "phone": 1})
    tickets = await db.tickets.find(
        {"client_id": client_id}, {"_id": 0, "id": 1, "ticket_number": 1, "title": 1, "status": 1,
         "priority": 1, "created_at": 1, "assigned_to_name": 1}
    ).sort("created_at", -1).to_list(30)

    devices = await db.devices.find(
        {"client_id": client_id}, {"_id": 0, "id": 1, "hostname": 1, "device_type": 1, "status": 1}
    ).to_list(100)

    estimates = await db.estimates.find(
        {"client_id": client_id, "status": {"$in": ["published", "sent"]}},
        {"_id": 0, "id": 1, "estimate_number": 1, "title": 1, "total": 1, "status": 1}
    ).to_list(10)

    invoices = await db.invoices.find(
        {"client_id": client_id, "status": {"$in": ["sent", "overdue"]}},
        {"_id": 0, "id": 1, "invoice_number": 1, "total": 1, "status": 1, "due_date": 1}
    ).to_list(10)

    contracts = await db.contracts.find(
        {"client_id": client_id, "status": "active"},
        {"_id": 0, "name": 1, "type": 1, "value": 1, "billing_cycle": 1}
    ).to_list(10)

    open_count = sum(1 for t in tickets if t.get("status") in ["open", "in_progress"])
    online_count = sum(1 for d in devices if d.get("status") == "online")

    return {
        "found": True, "client": client,
        "tickets": tickets, "devices": devices,
        "estimates": estimates, "invoices": invoices, "contracts": contracts,
        "stats": {
            "open_tickets": open_count, "total_tickets": len(tickets),
            "total_devices": len(devices), "online_devices": online_count,
            "pending_estimates": len(estimates), "outstanding_invoices": len(invoices),
        }
    }


@router.post("/magic-portal/access/{token}/approve-estimate/{estimate_id}")
async def approve_estimate_via_portal(token: str, estimate_id: str):
    """Approve an estimate via magic portal."""
    link = await db.magic_links.find_one({"token": token, "active": True}, {"_id": 0})
    if not link:
        return {"error": "Invalid link"}

    est = await db.estimates.find_one({"id": estimate_id, "client_id": link["client_id"]}, {"_id": 0})
    if not est or est.get("status") not in ["published", "sent"]:
        return {"error": "Estimate not available for approval"}

    await db.estimates.update_one({"id": estimate_id}, {"$set": {
        "status": "approved", "approved_at": datetime.now(timezone.utc).isoformat(), "approved_by_client": True,
    }})
    return {"message": "Estimate approved"}
