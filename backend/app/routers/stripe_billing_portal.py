from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone
import uuid, os
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, assert_global_scope, scoped_query

router = APIRouter()


_BILLING_PORTAL_DEFAULTS = {
    "enabled": False,
    "allow_self_service": True,
    "payment_methods": ["card"],
    "auto_reminders": True,
}
_BILLING_PORTAL_BOOLEAN_FIELDS = ("enabled", "allow_self_service", "auto_reminders")


def _safe_billing_portal_config(config: dict | None) -> dict:
    """Return the public portal settings without echoing arbitrary stored fields.

    Billing-portal configuration is global operational state.  It must never
    become an accidental API for Stripe credentials or other implementation
    details that happened to be present in a legacy settings document.
    """
    source = config if isinstance(config, dict) else {}
    safe = dict(_BILLING_PORTAL_DEFAULTS)
    for field in _BILLING_PORTAL_BOOLEAN_FIELDS:
        if isinstance(source.get(field), bool):
            safe[field] = source[field]
    methods = source.get("payment_methods")
    if isinstance(methods, list):
        cleaned = [str(method).strip() for method in methods if isinstance(method, str) and str(method).strip()]
        if cleaned:
            safe["payment_methods"] = list(dict.fromkeys(cleaned))
    return safe


def _portal_config_update(data: dict) -> dict:
    """Accept only supported portal options so unknown inputs cannot be stored or echoed."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Billing portal configuration must be an object")
    update: dict = {}
    for field in _BILLING_PORTAL_BOOLEAN_FIELDS:
        if field in data:
            if not isinstance(data[field], bool):
                raise HTTPException(status_code=422, detail=f"{field} must be true or false")
            update[field] = data[field]
    if "payment_methods" in data:
        methods = data["payment_methods"]
        if not isinstance(methods, list) or any(not isinstance(method, str) or not method.strip() for method in methods):
            raise HTTPException(status_code=422, detail="payment_methods must be a list of non-empty strings")
        update["payment_methods"] = list(dict.fromkeys(method.strip() for method in methods))
    return update


async def _require_billing_admin(current_user: dict):
    user = await db.users.find_one({"id": current_user["id"]}, {"_id": 0, "role": 1, "is_admin": 1}) or current_user
    if user.get("role") != "admin" and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Billing portal settings require administrator access")


@router.get("/billing-portal/config")
async def get_billing_portal_config(
    request: Request,
    current_user: dict = Depends(get_current_user),
    _permission: dict = Depends(require_action("billing.integration.manage")),
):
    """Get Stripe billing portal configuration."""
    await assert_global_scope(current_user, operation="billing.portal.configuration.read", request=request)
    config = await db.settings.find_one({"type": "stripe_billing_portal"}, {"_id": 0})
    return {
        **_safe_billing_portal_config(config),
        "stripe_configured": bool(os.environ.get("STRIPE_API_KEY") or os.environ.get("STRIPE_SECRET_KEY")),
    }


@router.put("/billing-portal/config")
async def update_billing_portal_config(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
    _permission: dict = Depends(require_action("billing.integration.manage")),
):
    await assert_global_scope(current_user, operation="billing.portal.configuration.update", request=request)
    await _require_billing_admin(current_user)
    update = _portal_config_update(data)
    await db.settings.update_one(
        {"type": "stripe_billing_portal"},
        {"$set": {
            **update,
            "type": "stripe_billing_portal",
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": current_user.get("name") or current_user.get("email") or current_user.get("id"),
        }},
        upsert=True,
    )
    await log_activity(
        current_user,
        "billing_portal_configuration_updated",
        "billing_portal_configuration",
        "stripe_billing_portal",
        "Stripe billing portal",
        "Updated customer billing portal configuration",
        metadata={"updated_fields": sorted(update)},
    )
    return {"message": "Billing portal config updated"}


@router.get("/billing-portal/clients", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_client_billing_status(current_user: dict = Depends(get_current_user)):
    """Get billing status only for clients in the caller's server-side scope."""
    clients = await db.clients.find(
        scoped_query(current_user, field="id", site_field=None),
        {"_id": 0, "id": 1, "name": 1, "email": 1, "mrr": 1, "stripe_customer_id": 1},
    ).to_list(500)
    result = []
    for c in clients:
        invoices = await db.invoices.find({"client_id": c["id"]}, {"_id": 0, "status": 1, "total": 1, "amount_due": 1}).to_list(100)
        total_outstanding = sum(i.get("amount_due", 0) for i in invoices if i.get("status") in ("sent", "overdue"))
        overdue_count = len([i for i in invoices if i.get("status") == "overdue"])
        result.append({
            "id": c.get("id"),
            "name": c.get("name", ""),
            "email": c.get("email", ""),
            "mrr": c.get("mrr", 0),
            "total_invoices": len(invoices),
            "outstanding_amount": total_outstanding,
            "overdue_count": overdue_count,
            "has_payment_method": bool(c.get("stripe_customer_id")),
        })
    return result


@router.post("/billing-portal/clients/{client_id}/create-portal-link", dependencies=[Depends(require_action("billing.portal.link.create"))])
async def create_client_portal_link(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Generate a Stripe customer portal link for a client to manage their billing."""
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.portal.link.create",
        request=request,
        mask_not_found=True,
    )
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
        customer_created = False
        if not customer_id:
            customer = stripe.Customer.create(
                name=client.get("name") or None,
                email=client.get("email") or None,
                metadata={"nexus_client_id": client_id},
            )
            customer_id = customer.id
            customer_created = True
            await db.clients.update_one({"id": client_id}, {"$set": {"stripe_customer_id": customer_id}})

        public_url = os.environ.get("PUBLIC_URL", "http://localhost:3000").rstrip("/")
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{public_url}/billing-portal",
        )
    except Exception as exc:
        # Do not return provider exceptions: they can include request context or
        # integration implementation details that belong only in server logs.
        raise HTTPException(status_code=502, detail="Stripe could not create the customer portal session") from exc

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
    await log_activity(
        current_user,
        "billing_portal_session_created",
        "client",
        client_id,
        client.get("name", ""),
        "Created a Stripe customer billing portal session",
        metadata={"portal_link_id": portal_link["id"], "customer_created": customer_created},
    )
    return {k: v for k, v in portal_link.items() if k != "_id"}


@router.post("/billing-portal/send-reminder", dependencies=[Depends(require_action("billing.portal.reminder.send"))])
async def send_payment_reminder(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Send a payment reminder to a client."""
    client_id = data.get("client_id")
    invoice_id = data.get("invoice_id")
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.portal.reminder.send",
        request=request,
        mask_not_found=True,
    )
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if invoice_id:
        invoice = await db.invoices.find_one({"id": str(invoice_id)}, {"_id": 0, "id": 1, "client_id": 1})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        await assert_client_scope(
            current_user,
            invoice.get("client_id"),
            operation="billing.portal.reminder.invoice",
            request=request,
            mask_not_found=True,
        )
        if invoice.get("client_id") != client_id:
            # Do not let a caller create a billing-reminder record that points
            # at an invoice owned by another client, even with global scope.
            raise HTTPException(status_code=404, detail="Invoice not found")
        invoice_id = invoice["id"]
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
    await log_activity(
        current_user,
        "billing_payment_reminder_sent",
        "client",
        client_id,
        client.get("name", ""),
        "Sent a customer payment reminder",
        metadata={
            "reminder_id": reminder["id"],
            "delivery_status": reminder["status"],
            "invoice_count": reminder["invoice_count"],
        },
    )
    delivered = delivery.get("status") == "sent"
    return {
        "message": delivery.get("message") or (f"Payment reminder sent to {recipient}" if delivered else f"Payment reminder recorded for {recipient}"),
        "sent": delivered,
        "delivery_status": delivery.get("status", "failed"),
        "reminder_id": reminder["id"],
    }


@router.get("/billing-portal/stats", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_billing_portal_stats(current_user: dict = Depends(get_current_user)):
    """Get billing portal statistics only for the caller's client scope."""
    client_query = scoped_query(current_user, field="id", site_field=None)
    clients = await db.clients.find(client_query, {"_id": 0}).to_list(500)
    invoices = await db.invoices.find(scoped_query(current_user, site_field=None), {"_id": 0}).to_list(5000)
    total_revenue = sum(i.get("total", 0) for i in invoices if i.get("status") == "paid")
    outstanding = sum(i.get("amount_due", 0) for i in invoices if i.get("status") in ("sent", "overdue"))
    overdue = sum(i.get("amount_due", 0) for i in invoices if i.get("status") == "overdue")
    reminder_attempts = await db.payment_reminders.count_documents(scoped_query(current_user, site_field=None))
    reminders_delivered = await db.payment_reminders.count_documents(scoped_query(current_user, {"status": "sent"}, site_field=None))
    reminder_delivery_issues = await db.payment_reminders.count_documents(
        scoped_query(current_user, {"status": {"$in": ["failed", "mocked"]}}, site_field=None)
    )
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
