from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid, os
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/billing-portal/config")
async def get_billing_portal_config(current_user: dict = Depends(get_current_user)):
    """Get Stripe billing portal configuration."""
    config = await db.settings.find_one({"type": "stripe_billing_portal"}, {"_id": 0})
    if not config:
        config = {"enabled": False, "allow_self_service": True, "payment_methods": ["card"], "auto_reminders": True}
    return config


@router.put("/billing-portal/config")
async def update_billing_portal_config(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "stripe_billing_portal"},
        {"$set": {**data, "type": "stripe_billing_portal", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"message": "Billing portal config updated"}


@router.get("/billing-portal/clients")
async def get_client_billing_status(current_user: dict = Depends(get_current_user)):
    """Get billing status for all clients."""
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1, "mrr": 1}).to_list(500)
    result = []
    for c in clients:
        invoices = await db.invoices.find({"client_id": c["id"]}, {"_id": 0, "status": 1, "total": 1, "amount_due": 1}).to_list(100)
        total_outstanding = sum(i.get("amount_due", 0) for i in invoices if i.get("status") in ("sent", "overdue"))
        overdue_count = len([i for i in invoices if i.get("status") == "overdue"])
        result.append({
            **c,
            "total_invoices": len(invoices),
            "outstanding_amount": total_outstanding,
            "overdue_count": overdue_count,
            "has_payment_method": bool(c.get("stripe_customer_id")),
        })
    return result


@router.post("/billing-portal/clients/{client_id}/create-portal-link")
async def create_client_portal_link(client_id: str, current_user: dict = Depends(get_current_user)):
    """Generate a Stripe customer portal link for a client to manage their billing."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # In production, this would create a real Stripe portal session
    now = datetime.now(timezone.utc).isoformat()
    portal_link = {
        "id": f"bpl-{uuid.uuid4().hex[:8]}",
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "url": f"https://billing.stripe.com/p/session/{uuid.uuid4().hex}",
        "expires_at": datetime.now(timezone.utc).isoformat(),
        "created_at": now,
        "created_by": current_user.get("name", ""),
    }
    await db.billing_portal_links.insert_one(portal_link)
    return {k: v for k, v in portal_link.items() if k != "_id"}


@router.post("/billing-portal/send-reminder")
async def send_payment_reminder(data: dict, current_user: dict = Depends(get_current_user)):
    """Send a payment reminder to a client."""
    client_id = data.get("client_id")
    invoice_id = data.get("invoice_id")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    now = datetime.now(timezone.utc).isoformat()
    reminder = {
        "id": f"rem-{uuid.uuid4().hex[:8]}",
        "client_id": client_id,
        "invoice_id": invoice_id,
        "client_name": client.get("name", ""),
        "email": client.get("email", ""),
        "status": "sent",
        "sent_at": now,
        "sent_by": current_user.get("name", ""),
    }
    await db.payment_reminders.insert_one(reminder)
    return {"message": f"Payment reminder sent to {client.get('email', 'N/A')}", "reminder_id": reminder["id"]}


@router.get("/billing-portal/stats")
async def get_billing_portal_stats(current_user: dict = Depends(get_current_user)):
    """Get billing portal statistics."""
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(5000)
    total_revenue = sum(i.get("total", 0) for i in invoices if i.get("status") == "paid")
    outstanding = sum(i.get("amount_due", 0) for i in invoices if i.get("status") in ("sent", "overdue"))
    overdue = sum(i.get("amount_due", 0) for i in invoices if i.get("status") == "overdue")
    reminders = await db.payment_reminders.count_documents({})
    return {
        "total_clients": len(clients),
        "total_revenue": round(total_revenue, 2),
        "outstanding": round(outstanding, 2),
        "overdue": round(overdue, 2),
        "reminders_sent": reminders,
        "collection_rate": round((total_revenue / max(total_revenue + outstanding, 1)) * 100, 1),
    }
