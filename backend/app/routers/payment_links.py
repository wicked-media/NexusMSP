"""One-Time Payment Links - Secure, expiring payment links for invoices"""
from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
import secrets
import os
from app.database import db
from app.auth import get_current_user

router = APIRouter()


def _get_stripe_key():
    return os.environ.get("STRIPE_API_KEY", "")


@router.post("/payment-links")
async def create_payment_link(data: dict, current_user: dict = Depends(get_current_user)):
    """Create a one-time payment link for an invoice"""
    invoice_id = data.get("invoice_id")
    if not invoice_id:
        raise HTTPException(status_code=400, detail="invoice_id required")

    invoice = await db.xero_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    expires_days = int(data.get("expires_days", 14))
    allowed_methods = data.get("allowed_methods", ["card", "becs", "bank_transfer"])
    token = secrets.token_urlsafe(32)

    total = float(invoice.get("total", 0))
    amount_paid = float(invoice.get("amount_paid", 0))
    balance = round(total - amount_paid, 2)

    if balance <= 0:
        raise HTTPException(status_code=400, detail="Invoice already fully paid")

    link = {
        "id": str(uuid.uuid4()),
        "token": token,
        "invoice_id": invoice_id,
        "invoice_number": invoice.get("invoice_number", ""),
        "client_name": invoice.get("client_name", ""),
        "total": total,
        "balance_at_creation": balance,
        "allowed_methods": allowed_methods,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=expires_days)).isoformat(),
        "expires_days": expires_days,
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user.get("name", "Admin"),
        "payments": [],
    }
    await db.payment_links.insert_one(link)
    link.pop("_id", None)
    return link


@router.get("/payment-links")
async def list_payment_links(current_user: dict = Depends(get_current_user)):
    """List all payment links (admin view)"""
    links = await db.payment_links.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return links


@router.delete("/payment-links/{link_id}")
async def revoke_payment_link(link_id: str, current_user: dict = Depends(get_current_user)):
    """Revoke a payment link"""
    result = await db.payment_links.update_one(
        {"id": link_id},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"message": "Payment link revoked"}


# ==================== PUBLIC ENDPOINTS (no auth) ====================

@router.get("/pay/{token}")
async def get_payment_page_data(token: str):
    """Public: Get invoice details for payment page"""
    link = await db.payment_links.find_one({"token": token}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Payment link not found or expired")

    if link.get("status") == "revoked":
        raise HTTPException(status_code=410, detail="This payment link has been revoked")

    if link.get("status") == "completed":
        raise HTTPException(status_code=410, detail="This payment link has already been used — invoice is fully paid")

    expires_at = link.get("expires_at", "")
    if expires_at and datetime.fromisoformat(expires_at) < datetime.now(timezone.utc):
        await db.payment_links.update_one({"token": token}, {"$set": {"status": "expired"}})
        raise HTTPException(status_code=410, detail="This payment link has expired")

    invoice = await db.xero_invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    if not invoice:
        invoice = await db.invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    total = float(invoice.get("total", 0))
    amount_paid = float(invoice.get("amount_paid", 0))
    balance = round(total - amount_paid, 2)

    # Get bank transfer details from branding settings
    bank_settings = await db.doc_branding_settings.find_one({"doc_type": "invoice"}, {"_id": 0})
    bank_details = (bank_settings or {}).get("bank_details", "")
    company_name = (bank_settings or {}).get("company_name", "")
    payment_instructions = (bank_settings or {}).get("payment_instructions", "")

    return {
        "link_id": link["id"],
        "invoice_number": invoice.get("invoice_number", ""),
        "client_name": invoice.get("client_name", ""),
        "due_date": invoice.get("due_date", ""),
        "total": total,
        "amount_paid": amount_paid,
        "balance": balance,
        "line_items": invoice.get("line_items", []),
        "allowed_methods": link.get("allowed_methods", []),
        "payments": link.get("payments", []),
        "expires_at": link.get("expires_at", ""),
        "bank_details": bank_details,
        "company_name": company_name,
        "payment_instructions": payment_instructions,
        "status": invoice.get("status", ""),
    }


@router.post("/pay/{token}/card")
async def pay_with_card(token: str, data: dict):
    """Public: Initiate Stripe card payment"""
    link = await db.payment_links.find_one({"token": token}, {"_id": 0})
    if not link or link.get("status") not in ("active",):
        raise HTTPException(status_code=410, detail="Payment link invalid or expired")

    if "card" not in link.get("allowed_methods", []):
        raise HTTPException(status_code=400, detail="Card payments not allowed on this link")

    amount = float(data.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    # Check balance
    invoice = await db.xero_invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    if not invoice:
        invoice = await db.invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    balance = round(float(invoice.get("total", 0)) - float(invoice.get("amount_paid", 0)), 2)
    if amount > balance + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds balance of ${balance:.2f}")

    stripe_key = _get_stripe_key()
    if not stripe_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    origin_url = data.get("origin_url", "")
    success_url = f"{origin_url}/pay/{token}?payment_status=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin_url}/pay/{token}?payment_status=cancelled"

    from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
    stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url=f"{origin_url}/api/webhook/stripe")
    checkout_req = CheckoutSessionRequest(
        amount=round(amount, 2),
        currency=data.get("currency", "aud"),
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "payment_link_token": token,
            "invoice_id": link["invoice_id"],
            "invoice_number": link.get("invoice_number", ""),
        }
    )
    session = await stripe_checkout.create_checkout_session(checkout_req)

    payment_record = {
        "id": str(uuid.uuid4()),
        "method": "card",
        "amount": amount,
        "status": "pending",
        "stripe_session_id": session.session_id,
        "initiated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payment_links.update_one({"token": token}, {"$push": {"payments": payment_record}})

    return {"url": session.url, "session_id": session.session_id}


@router.post("/pay/{token}/becs")
async def pay_with_becs(token: str, data: dict):
    """Public: Initiate BECS Direct Debit payment via Stripe"""
    link = await db.payment_links.find_one({"token": token}, {"_id": 0})
    if not link or link.get("status") not in ("active",):
        raise HTTPException(status_code=410, detail="Payment link invalid or expired")

    if "becs" not in link.get("allowed_methods", []):
        raise HTTPException(status_code=400, detail="BECS Direct Debit not allowed on this link")

    amount = float(data.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    invoice = await db.xero_invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    if not invoice:
        invoice = await db.invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    balance = round(float(invoice.get("total", 0)) - float(invoice.get("amount_paid", 0)), 2)
    if amount > balance + 0.01:
        raise HTTPException(status_code=400, detail=f"Amount exceeds balance of ${balance:.2f}")

    stripe_key = _get_stripe_key()
    if not stripe_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    import stripe
    stripe.api_key = stripe_key

    try:
        intent = stripe.PaymentIntent.create(
            amount=int(round(amount * 100)),
            currency="aud",
            payment_method_types=["au_becs_debit"],
            metadata={
                "payment_link_token": token,
                "invoice_id": link["invoice_id"],
                "invoice_number": link.get("invoice_number", ""),
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create BECS payment: {str(e)}")

    payment_record = {
        "id": str(uuid.uuid4()),
        "method": "becs",
        "amount": amount,
        "status": "pending",
        "stripe_payment_intent_id": intent.id,
        "client_secret": intent.client_secret,
        "initiated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payment_links.update_one({"token": token}, {"$push": {"payments": payment_record}})

    return {"client_secret": intent.client_secret, "payment_intent_id": intent.id}


@router.post("/pay/{token}/bank-transfer")
async def record_bank_transfer(token: str, data: dict):
    """Public: Record a bank transfer payment (pending admin confirmation)"""
    link = await db.payment_links.find_one({"token": token}, {"_id": 0})
    if not link or link.get("status") not in ("active",):
        raise HTTPException(status_code=410, detail="Payment link invalid or expired")

    if "bank_transfer" not in link.get("allowed_methods", []):
        raise HTTPException(status_code=400, detail="Bank transfer not allowed on this link")

    amount = float(data.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    reference = data.get("reference", "")
    payer_name = data.get("payer_name", "")
    bank_name = data.get("bank_name", "")

    payment_record = {
        "id": str(uuid.uuid4()),
        "method": "bank_transfer",
        "amount": amount,
        "status": "awaiting_confirmation",
        "reference": reference,
        "payer_name": payer_name,
        "bank_name": bank_name,
        "initiated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payment_links.update_one({"token": token}, {"$push": {"payments": payment_record}})

    return {"message": "Bank transfer recorded. The provider will confirm your payment.", "payment": payment_record}


@router.get("/pay/{token}/confirm")
async def confirm_payment(token: str, session_id: str = ""):
    """Public: Confirm Stripe payment status and update invoice"""
    link = await db.payment_links.find_one({"token": token}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Payment link not found")

    if not session_id:
        return {"status": "no_session"}

    stripe_key = _get_stripe_key()
    if not stripe_key:
        return {"status": "stripe_not_configured"}

    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url="")

    try:
        status = await stripe_checkout.get_checkout_status(session_id)
    except Exception:
        return {"status": "check_failed"}

    if status.payment_status == "paid":
        # Find the matching payment record and mark paid
        payments = link.get("payments", [])
        paid_amount = 0
        for p in payments:
            if p.get("stripe_session_id") == session_id and p.get("status") != "paid":
                p["status"] = "paid"
                p["confirmed_at"] = datetime.now(timezone.utc).isoformat()
                paid_amount = p.get("amount", 0)
                break

        await db.payment_links.update_one({"token": token}, {"$set": {"payments": payments}})

        # Update the invoice
        invoice = await db.xero_invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
        collection = "xero_invoices"
        if not invoice:
            invoice = await db.invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
            collection = "invoices"

        if invoice and paid_amount > 0:
            new_paid = round(float(invoice.get("amount_paid", 0)) + paid_amount, 2)
            total = float(invoice.get("total", 0))
            is_fully_paid = new_paid >= total - 0.01

            update_fields = {
                "amount_paid": new_paid,
                "amount_due": round(total - new_paid, 2),
            }
            if is_fully_paid:
                update_fields["payment_status"] = "paid"
                update_fields["status"] = "PAID"
                update_fields["paid_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                await db.payment_links.update_one({"token": token}, {"$set": {"status": "completed"}})
            else:
                update_fields["payment_status"] = "partial"

            payment_entry = {
                "amount": paid_amount,
                "method": "stripe_card",
                "date": datetime.now(timezone.utc).isoformat(),
                "session_id": session_id,
                "reference": f"Payment Link {link.get('invoice_number', '')}",
            }
            coll = db.xero_invoices if collection == "xero_invoices" else db.invoices
            await coll.update_one({"id": link["invoice_id"]}, {
                "$set": update_fields,
                "$push": {"payments": payment_entry}
            })

        return {"status": "paid", "amount": paid_amount, "fully_paid": new_paid >= total - 0.01 if invoice else False}

    return {"status": status.payment_status}


@router.post("/payment-links/{link_id}/confirm-transfer")
async def admin_confirm_bank_transfer(link_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Admin: Confirm a bank transfer payment"""
    payment_id = data.get("payment_id")
    link = await db.payment_links.find_one({"id": link_id}, {"_id": 0})
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    payments = link.get("payments", [])
    paid_amount = 0
    for p in payments:
        if p.get("id") == payment_id and p.get("status") == "awaiting_confirmation":
            p["status"] = "paid"
            p["confirmed_at"] = datetime.now(timezone.utc).isoformat()
            p["confirmed_by"] = current_user.get("name", "Admin")
            paid_amount = p.get("amount", 0)
            break

    if paid_amount == 0:
        raise HTTPException(status_code=400, detail="Payment not found or already confirmed")

    await db.payment_links.update_one({"id": link_id}, {"$set": {"payments": payments}})

    # Update invoice
    invoice = await db.xero_invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
    collection = "xero_invoices"
    if not invoice:
        invoice = await db.invoices.find_one({"id": link["invoice_id"]}, {"_id": 0})
        collection = "invoices"

    if invoice:
        new_paid = round(float(invoice.get("amount_paid", 0)) + paid_amount, 2)
        total = float(invoice.get("total", 0))
        is_fully_paid = new_paid >= total - 0.01

        update_fields = {
            "amount_paid": new_paid,
            "amount_due": round(total - new_paid, 2),
        }
        if is_fully_paid:
            update_fields["payment_status"] = "paid"
            update_fields["status"] = "PAID"
            update_fields["paid_date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            await db.payment_links.update_one({"id": link_id}, {"$set": {"status": "completed"}})
        else:
            update_fields["payment_status"] = "partial"

        payment_entry = {
            "amount": paid_amount,
            "method": "bank_transfer",
            "date": datetime.now(timezone.utc).isoformat(),
            "reference": f"Bank Transfer - confirmed by {current_user.get('name', 'Admin')}",
        }
        coll = db.xero_invoices if collection == "xero_invoices" else db.invoices
        await coll.update_one({"id": link["invoice_id"]}, {
            "$set": update_fields,
            "$push": {"payments": payment_entry}
        })

    return {"message": "Bank transfer confirmed", "amount": paid_amount}
