from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone
import uuid, os
from app.database import db
from app.auth import get_current_user

router = APIRouter()


async def _require_billing_admin(current_user: dict):
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "role": 1, "is_admin": 1}) or current_user
    if user.get("role") != "admin" and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Billing portal settings require administrator access")


@router.get("/billing-portal/config")
async def get_billing_portal_config(current_user: dict = Depends(get_current_user)):
    """Get Stripe billing portal configuration."""
    config = await db.settings.find_one({"type": "stripe_billing_portal"}, {"_id": 0})
    if not config:
        config = {"enabled": False, "allow_self_service": True, "payment_methods": ["card"], "auto_reminders": True}
    return {
        **config,
        "stripe_configured": bool(os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")),
    }


@router.put("/billing-portal/config")
async def update_billing_portal_config(data: dict, current_user: dict = Depends(get_current_user)):
    await _require_billing_admin(current_user)
    await db.settings.update_one(
        {"type": "stripe_billing_portal"},
        {"$set": {
            **data,
            "type": "stripe_billing_portal",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        }},
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

    config = await db.settings.find_one({"type": "stripe_billing_portal"}, {"_id": 0}) or {}
    if not config.get("enabled", False):
        raise HTTPException(status_code=400, detail="The customer billing portal is disabled. Enable it in Billing Portal settings first.")

    stripe_key = os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")
    if not stripe_key:
        raise HTTPException(status_code=400, detail="Stripe is not configured. Add the Stripe secret key before creating a customer portal link.")

    try:
        import stripe
        stripe.api_key = stripe_key
        customer_id = client.get("stripe_customer_id")
        if not customer_id:
            customer = stripe.Customer.create(
                name=client.get("name") or None,
                email=client.get("email") or None,
                metadata={"nexus_client_id": client_id},
            )
            customer_id = customer.id
            await db.clients.update_one({"id": client_id}, {"$set": {"stripe_customer_id": customer_id}})

        public_url = os.environ.get("PUBLIC_URL", "http://localhost:3000").rstrip("/")
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{public_url}/billing-portal",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Stripe could not create the customer portal session: {str(exc)[:160]}")

    now = datetime.now(timezone.utc).isoformat()
    portal_link = {
        "id": f"bpl-{uuid.uuid4().hex[:8]}",
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "url": session.url,
        "stripe_session_id": session.id,
        "expires_at": None,
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
    recipient = (client.get("email") or "").strip()
    if not recipient:
        raise HTTPException(status_code=400, detail="This client has no billing email address")

    outstanding_invoices = await db.invoices.find(
        {"client_id": client_id, "status": {"$in": ["sent", "overdue"]}},
        {"_id": 0, "invoice_number": 1, "amount_due": 1, "currency": 1},
    ).to_list(500)
    outstanding = round(sum(float(invoice.get("amount_due") or 0) for invoice in outstanding_invoices), 2)
    currencies = {str(invoice.get("currency") or "AUD").upper() for invoice in outstanding_invoices}
    currency_label = next(iter(currencies)) if len(currencies) == 1 else "multiple currencies"
    amount_label = f"{currency_label} {outstanding:,.2f}" if len(currencies) == 1 else f"{len(outstanding_invoices)} outstanding invoice(s)"
    from app.routers.email_utils import send_email
    delivery = await send_email(
        recipient,
        f"Payment reminder from NexusMSP · {amount_label}",
        (
            "<div style='font-family:Arial,sans-serif;max-width:600px;margin:auto'>"
            f"<p>Hello {client.get('name') or 'there'},</p>"
            f"<p>This is a friendly reminder that <strong>{amount_label}</strong> is currently outstanding on your account.</p>"
            "<p>Please contact us if you need a copy of an invoice or would like to discuss payment arrangements.</p>"
            "</div>"
        ),
        category="billing",
    )

    now = datetime.now(timezone.utc).isoformat()
    reminder = {
        "id": f"rem-{uuid.uuid4().hex[:8]}",
        "client_id": client_id,
        "invoice_id": invoice_id,
        "client_name": client.get("name", ""),
        "email": recipient,
        "status": delivery.get("status", "failed"),
        "message": delivery.get("message", ""),
        "provider_email_id": delivery.get("email_id"),
        "outstanding_amount": outstanding,
        "currency": currency_label,
        "invoice_count": len(outstanding_invoices),
        "sent_at": now,
        "sent_by": current_user.get("name", ""),
    }
    await db.payment_reminders.insert_one(reminder)
    delivered = delivery.get("status") == "sent"
    return {
        "message": delivery.get("message") or (f"Payment reminder sent to {recipient}" if delivered else f"Payment reminder recorded for {recipient}"),
        "sent": delivered,
        "delivery_status": delivery.get("status", "failed"),
        "reminder_id": reminder["id"],
    }


@router.get("/billing-portal/stats")
async def get_billing_portal_stats(current_user: dict = Depends(get_current_user)):
    """Get billing portal statistics."""
    clients = await db.clients.find({}, {"_id": 0}).to_list(500)
    invoices = await db.invoices.find({}, {"_id": 0}).to_list(5000)
    total_revenue = sum(i.get("total", 0) for i in invoices if i.get("status") == "paid")
    outstanding = sum(i.get("amount_due", 0) for i in invoices if i.get("status") in ("sent", "overdue"))
    overdue = sum(i.get("amount_due", 0) for i in invoices if i.get("status") == "overdue")
    reminder_attempts = await db.payment_reminders.count_documents({})
    reminders_delivered = await db.payment_reminders.count_documents({"status": "sent"})
    reminder_delivery_issues = await db.payment_reminders.count_documents({"status": {"$in": ["failed", "mocked"]}})
    return {
        "total_clients": len(clients),
        "total_revenue": round(total_revenue, 2),
        "outstanding": round(outstanding, 2),
        "overdue": round(overdue, 2),
        "reminders_sent": reminders_delivered,
        "reminder_attempts": reminder_attempts,
        "reminder_delivery_issues": reminder_delivery_issues,
        "collection_rate": round((total_revenue / max(total_revenue + outstanding, 1)) * 100, 1),
    }
