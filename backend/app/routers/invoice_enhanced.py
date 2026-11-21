from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import Response
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid
import logging
from math import isfinite
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity
from app.services.action_permissions import require_action
from app.services.finance_integrity import (
    begin_idempotent_operation,
    complete_idempotent_operation,
    fail_idempotent_operation,
)
from app.services.commercial_documents import (
    freeze_commercial_document_snapshot,
)
from app.services.nexus_document_pdf import render_nexus_invoice_pdf
from app.services.scope_permissions import assert_client_scope, assert_global_scope, platform_tenant_id, scoped_query
from app.services import invoice_reminders as reminder_policy
from app.routers.financial_reports import build_accounts_receivable_aging
from app.routers.invoice_reminders import load_reminder_settings, run_due_reminders

logger = logging.getLogger(__name__)
router = APIRouter()


def _credit_money(value: object, field: str) -> float:
    """Parse a finite, cent-precise credit-note amount.

    Credit notes are financial records.  ``float('nan')`` and infinity both
    pass surprisingly many ordinary numeric comparisons, so reject them at
    the shared input boundary rather than allowing a malformed value to reach
    an invoice balance.
    """
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Credit note {field} must be a valid number")
    if not isfinite(amount):
        raise HTTPException(status_code=422, detail=f"Credit note {field} must be finite")
    return round(amount, 2)


def _optimistic_version_filter(document: dict) -> dict:
    """Match either the saved version or the legacy no-version representation."""
    version = document.get("version")
    return {"version": version} if version is not None else {"version": {"$exists": False}}


def _monthly_recurring_value(amount: object, frequency: object) -> float:
    try:
        value = float(amount or 0)
    except (TypeError, ValueError):
        return 0.0
    freq = str(frequency or "monthly").lower()
    if not isfinite(value):
        return 0.0
    if freq == "weekly":
        return value * 52 / 12
    if freq == "fortnightly":
        return value * 26 / 12
    if freq == "quarterly":
        return value / 3
    if freq in {"annually", "annual", "yearly"}:
        return value / 12
    return value


# ============== EMAIL INVOICE TO CLIENT ==============

@router.post("/invoices/{invoice_id}/email", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def email_invoice_to_client(
    invoice_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        operation="billing.invoice.email",
        request=request,
        mask_not_found=True,
    )
    email = data.get("email", "")
    if not email:
        client = await db.clients.find_one({"id": invoice.get("client_id", "")}, {"_id": 0})
        email = client.get("email", "") if client else ""
    if not email:
        raise HTTPException(status_code=400, detail="No email address provided or found for client")
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=422, detail="A valid recipient email address is required")
    subject = data.get("subject", f"Invoice {invoice.get('invoice_number', '')} from NexusMSP")
    message = data.get("message", "")
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    company = branding.get("company_name", "NexusMSP")
    if not message:
        balance = float(invoice.get("total", 0)) - float(invoice.get("amount_paid", 0))
        message = f"""<h2>{company}</h2>
        <p>Dear {invoice.get('client_name', 'Customer')},</p>
        <p>Please find your invoice details below:</p>
        <table style='border-collapse:collapse;width:100%;'>
        <tr style='background:#3B82F6;color:white;'><td style='padding:8px;'>Invoice</td><td style='padding:8px;'>{invoice.get('invoice_number', '')}</td></tr>
        <tr><td style='padding:8px;border:1px solid #eee;'>Due Date</td><td style='padding:8px;border:1px solid #eee;'>{invoice.get('due_date', 'N/A')}</td></tr>
        <tr><td style='padding:8px;border:1px solid #eee;'>Total</td><td style='padding:8px;border:1px solid #eee;'>${invoice.get('total', 0):,.2f}</td></tr>
        <tr><td style='padding:8px;border:1px solid #eee;'>Amount Paid</td><td style='padding:8px;border:1px solid #eee;'>${invoice.get('amount_paid', 0):,.2f}</td></tr>
        <tr style='font-weight:bold;'><td style='padding:8px;border:1px solid #eee;'>Balance Due</td><td style='padding:8px;border:1px solid #eee;color:#DC2626;'>${balance:,.2f}</td></tr>
        </table>
        <p>Thank you for your business.</p>
        <p>Regards,<br/>{company}</p>"""
    from app.routers.email_signatures import append_default_signature
    message, _, signature_id = await append_default_signature(
        body=message,
        body_type="html",
        current_user=current_user,
        subject=subject,
    )
    idempotency_key = str(data.get("idempotency_key", "") or "").strip()
    replay = await begin_idempotent_operation(
        db,
        scope=f"invoice-email:{invoice_id}",
        key=idempotency_key,
        payload={"email": email, "subject": subject, "message": message},
        user_id=current_user.get("id", ""),
    )
    if replay is not None:
        return {**replay, "replayed": True}
    try:
        # Render the exact evidence we will freeze if delivery succeeds.  The
        # attachment, browser preview and subsequent download therefore share
        # one governed commercial-document contract.
        document_snapshot = await freeze_commercial_document_snapshot(
            "invoice", invoice, branding, database=db
        )
        document_context = {
            "profile": document_snapshot["profile"],
            "branding": document_snapshot["branding"],
        }
        actor = current_user.get("name") or current_user.get("email") or "NexusMSP"
        pdf_attachment = {
            "filename": f"Invoice_{invoice.get('invoice_number') or invoice_id}.pdf",
            "content": render_nexus_invoice_pdf(
                invoice,
                branding=document_context["branding"],
                generated_by=actor,
                document_profile=document_context["profile"],
            ),
            "content_type": "application/pdf",
        }
    except Exception:
        await fail_idempotent_operation(
            db,
            scope=f"invoice-email:{invoice_id}",
            key=idempotency_key,
            error="Unable to generate the invoice PDF attachment",
        )
        raise
    from app.routers.email_utils import send_email
    delivery = await send_email(
        email,
        subject,
        f"<div style='font-family:sans-serif;max-width:600px;margin:auto;'>{message}</div>",
        category="billing",
        attachments=[pdf_attachment],
        client_id=invoice.get("client_id"),
        related_type="invoice",
        related_id=invoice_id,
        initiated_by=current_user.get("id"),
        initiated_by_name=current_user.get("name"),
    )
    sent = delivery.get("status") == "sent"
    delivery_status = delivery.get("status", "failed")
    record = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "client_id": invoice.get("client_id"),
        "email": email,
        "subject": subject,
        "sent": sent,
        "delivery_status": delivery_status,
        "sent_by": current_user["id"],
        "sent_by_name": current_user.get("name", ""),
        "signature_id": signature_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.invoice_emails.insert_one(record)
    record.pop("_id", None)
    update = {
        "last_emailed_to": email,
        "last_emailed_at": datetime.now(timezone.utc).isoformat(),
        "last_email_delivery_status": delivery_status,
    }
    if sent and (invoice.get("status") == "draft" or not invoice.get("document_snapshot")):
        # A legacy already-sent invoice can gain immutable render evidence on
        # its next successful delivery without altering its financial state.
        update["document_snapshot"] = document_snapshot
    if sent and invoice.get("status") == "draft":
        update["status"] = "sent"
        update["sent_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.invoices.update_one(
        {"id": invoice_id, **_optimistic_version_filter(invoice)},
        {"$set": update, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(
            status_code=409,
            detail="Invoice changed while the email was being delivered; refresh and review the delivery record",
        )
    activity_action = "emailed" if sent else "email_attempted"
    activity_detail = f"Invoice emailed to {email}" if sent else f"Invoice email {delivery_status} for {email}"
    await log_activity(current_user, activity_action, "invoice", invoice_id, invoice.get("invoice_number", ""), activity_detail)
    response = {"message": delivery.get("message") or (f"Invoice emailed to {email}" if sent else f"Email recorded; connect Microsoft 365 to deliver to {email}"), "sent": sent, "delivery_status": delivery_status, "email_id": delivery.get("email_id")}
    await complete_idempotent_operation(
        db,
        scope=f"invoice-email:{invoice_id}",
        key=idempotency_key,
        response=response,
    )
    return response


@router.get("/invoices/{invoice_id}/email-history", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_invoice_email_history(
    invoice_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0, "client_id": 1})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        operation="billing.invoice.email_history.read",
        request=request,
        mask_not_found=True,
    )
    emails = await db.invoice_emails.find({"invoice_id": invoice_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return emails


# ============== CREDIT NOTES ==============

@router.get("/credit-notes", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_credit_notes(
    client_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    query = {}
    if client_id:
        query["client_id"] = client_id
        await assert_client_scope(
            current_user,
            client_id,
            operation="billing.credit_note.read",
            request=request,
            mask_not_found=True,
        )
    notes = await db.credit_notes.find(
        scoped_query(current_user, query, site_field=None),
        {"_id": 0},
    ).sort("created_at", -1).to_list(1000)
    return notes


@router.post("/credit-notes", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def create_credit_note(
    data: dict,
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    count = await db.credit_notes.count_documents({})
    invoice_id = str(data.get("invoice_id") or "").strip()
    requested_client_id = str(data.get("client_id") or "").strip()
    invoice = None
    if invoice_id:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        await assert_client_scope(
            current_user,
            invoice.get("client_id"),
            operation="billing.credit_note.create",
            request=request,
            mask_not_found=True,
        )
        if invoice.get("status") in {"cancelled", "voided"}:
            raise HTTPException(status_code=409, detail="Cannot issue a credit note for a voided invoice")
        if invoice.get("is_split_parent"):
            raise HTTPException(status_code=409, detail="Issue credits against a generated payer invoice, not a split-billing source record")
        if requested_client_id and requested_client_id != invoice.get("client_id"):
            raise HTTPException(status_code=422, detail="Credit note client must match the linked invoice client")
        client_id = str(invoice.get("client_id") or "").strip()
        client = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Invoice client not found")
    else:
        if not requested_client_id:
            raise HTTPException(status_code=422, detail="Client is required when no invoice is linked")
        await assert_client_scope(
            current_user,
            requested_client_id,
            operation="billing.credit_note.create",
            request=request,
            mask_not_found=True,
        )
        client_id = requested_client_id
        client = await db.clients.find_one({"id": client_id}, {"_id": 0})
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")

    total = _credit_money(data.get("total", 0), "total")
    subtotal = _credit_money(data.get("subtotal", total), "subtotal")
    tax = _credit_money(data.get("tax", 0), "tax")
    if total <= 0:
        raise HTTPException(status_code=422, detail="Credit note total must be greater than zero")
    if subtotal < 0 or tax < 0:
        raise HTTPException(status_code=422, detail="Credit note subtotal and tax cannot be negative")
    if abs(round(subtotal + tax, 2) - total) > 0.005:
        raise HTTPException(status_code=422, detail="Credit note total must equal subtotal plus tax")
    cn = {
        "id": str(uuid.uuid4()),
        "credit_note_number": f"CN-{count + 1001:04d}",
        "invoice_id": invoice_id,
        "invoice_number": invoice.get("invoice_number", "") if invoice else "",
        "client_id": client_id,
        "client_name": client.get("name", ""),
        "line_items": data.get("line_items", []),
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
        "reason": data.get("reason", ""),
        "status": "issued",
        "applied_to_invoice": False,
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "version": 1,
        "audit_trail": [{
            "action": "issued",
            "by": current_user.get("name", ""),
            "at": datetime.now(timezone.utc).isoformat(),
            "invoice_id": invoice_id,
            "client_id": client_id,
            "amount": total,
        }],
    }
    await db.credit_notes.insert_one(cn)
    cn.pop("_id", None)
    await log_activity(
        current_user,
        "created",
        "credit_note",
        cn["id"],
        cn["credit_note_number"],
        f"Issued credit note {cn['credit_note_number']} for ${total:.2f}",
        metadata={"invoice_id": invoice_id, "client_id": client_id, "total": total},
    )
    return cn


@router.post("/credit-notes/{cn_id}/apply", dependencies=[Depends(require_action("billing.payment.record"))])
async def apply_credit_note(
    cn_id: str,
    data: dict,
    request: Request = None,
    current_user: dict = Depends(get_current_user),
):
    cn = await db.credit_notes.find_one({"id": cn_id}, {"_id": 0})
    if not cn:
        raise HTTPException(status_code=404, detail="Credit note not found")
    credit_client_id = str(cn.get("client_id") or "").strip()
    await assert_client_scope(
        current_user,
        credit_client_id,
        operation="billing.credit_note.apply",
        request=request,
        mask_not_found=True,
    )
    if not credit_client_id:
        raise HTTPException(status_code=422, detail="Credit note has no client and cannot be applied")
    if cn.get("applied_to_invoice"):
        raise HTTPException(status_code=409, detail="Credit note is already applied")
    if cn.get("status", "issued") != "issued":
        raise HTTPException(status_code=409, detail="Credit note is not available to apply")
    invoice_id = str(data.get("invoice_id") or cn.get("invoice_id") or "").strip()
    if not invoice_id:
        raise HTTPException(status_code=400, detail="No invoice to apply to")
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        operation="billing.credit_note.apply",
        request=request,
        mask_not_found=True,
    )
    if invoice.get("status") == "pending_approval":
        raise HTTPException(status_code=409, detail="Approve the invoice before sending it to the customer")
    if invoice.get("status") in {"cancelled", "voided"}:
        raise HTTPException(status_code=409, detail="Voided invoices cannot be emailed as payable documents")
    if invoice.get("is_split_parent"):
        raise HTTPException(status_code=409, detail="Email the generated payer invoices; the split-billing source is retained for audit only")
    if credit_client_id != invoice.get("client_id"):
        raise HTTPException(status_code=409, detail="Credit note client does not match the invoice client")
    credit_amount = _credit_money(cn.get("total", 0), "total")
    invoice_total = _credit_money(invoice.get("total", 0), "total")
    previous_paid = _credit_money(invoice.get("amount_paid", 0), "amount paid")
    outstanding = round(max(0, invoice_total - previous_paid), 2)
    if credit_amount <= 0 or credit_amount > outstanding:
        raise HTTPException(status_code=422, detail=f"Credit must be greater than zero and no more than the outstanding balance of ${outstanding:.2f}")
    new_paid = round(previous_paid + credit_amount, 2)
    new_status = "paid" if new_paid >= invoice_total else "partial"

    # Claim the credit note before touching the invoice.  The conditional
    # version match prevents concurrent browser requests from applying the
    # same credit twice.  If the invoice has changed we release the claim so a
    # technician can refresh and retry against the current balance.
    claim = await db.credit_notes.update_one(
        {
            "id": cn_id,
            "client_id": credit_client_id,
            "status": "issued",
            "applied_to_invoice": {"$ne": True},
            **_optimistic_version_filter(cn),
        },
        {
            "$set": {
                "status": "applying",
                "application_invoice_id": invoice_id,
                "application_started_at": datetime.now(timezone.utc).isoformat(),
            },
            "$inc": {"version": 1},
        },
    )
    if claim.matched_count == 0:
        raise HTTPException(status_code=409, detail="Credit note changed while it was being applied; refresh and retry")

    invoice_update = await db.invoices.update_one({
        "id": invoice_id,
        "client_id": credit_client_id,
        "status": invoice.get("status"),
        "payment_status": invoice.get("payment_status"),
        "amount_paid": invoice.get("amount_paid", 0),
        **_optimistic_version_filter(invoice),
    }, {
        "$set": {
            "amount_paid": new_paid,
            "payment_status": new_status,
            "status": "paid" if new_status == "paid" else invoice.get("status"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        "$push": {"payments": {
            "amount": credit_amount, "method": "credit_note",
            "date": datetime.now(timezone.utc).isoformat(),
            "reference": cn.get("credit_note_number", ""),
            "recorded_by": current_user.get("name", ""),
            "credit_note_id": cn_id,
        }},
        "$inc": {"version": 1},
    })
    if invoice_update.matched_count == 0:
        await db.credit_notes.update_one(
            {"id": cn_id, "client_id": credit_client_id, "status": "applying", "application_invoice_id": invoice_id},
            {"$set": {
                "status": "issued",
                "application_error": "invoice_update_conflict",
                "application_failed_at": datetime.now(timezone.utc).isoformat(),
            }, "$inc": {"version": 1}},
        )
        raise HTTPException(status_code=409, detail="Invoice changed while the credit was being applied; refresh and retry")

    applied = await db.credit_notes.update_one(
        {"id": cn_id, "client_id": credit_client_id, "status": "applying", "application_invoice_id": invoice_id},
        {"$set": {
            "applied_to_invoice": True,
            "applied_to_invoice_id": invoice_id,
            "applied_at": datetime.now(timezone.utc).isoformat(),
            "status": "applied",
        }, "$push": {"audit_trail": {
            "action": "applied",
            "by": current_user.get("name", ""),
            "at": datetime.now(timezone.utc).isoformat(),
            "invoice_id": invoice_id,
            "amount": credit_amount,
        }}, "$inc": {"version": 1}},
    )
    if applied.matched_count == 0:
        # The invoice payment is intentionally not reversed here: another
        # writer may already have observed it.  Leave a recoverable, auditable
        # claim rather than risk silently applying a second credit.
        await log_activity(
            current_user,
            "credit_application_reconciliation_required",
            "credit_note",
            cn_id,
            cn.get("credit_note_number", ""),
            "Invoice credit was recorded but the credit-note finalisation needs reconciliation.",
            metadata={"invoice_id": invoice_id, "client_id": credit_client_id, "amount": credit_amount},
        )
        raise HTTPException(status_code=409, detail="Credit was recorded but finalisation needs reconciliation; do not retry until reviewed")
    await log_activity(
        current_user,
        "credit_applied",
        "invoice",
        invoice_id,
        invoice.get("invoice_number", ""),
        f"Applied credit note {cn.get('credit_note_number', '')} for ${credit_amount:.2f}",
        metadata={"credit_note_id": cn_id, "client_id": credit_client_id, "amount": credit_amount, "invoice_version": invoice.get("version")},
    )
    return {"message": f"Credit of ${credit_amount:.2f} applied to invoice", "new_balance": round(max(0, invoice_total - new_paid), 2)}


# ============== LATE FEE AUTOMATION ==============

@router.get(
    "/settings/late-fees",
    dependencies=[Depends(require_action("billing.late_fee.policy.manage"))],
)
async def get_late_fee_settings(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.late_fee.policy.read", request=request)
    s = await db.settings.find_one({"type": "late_fees"}, {"_id": 0})
    return s or {
        "type": "late_fees", "enabled": False,
        "grace_period_days": 7, "fee_type": "percentage",
        "fee_amount": 5, "max_fee_percentage": 25,
        "apply_frequency": "once",
    }


@router.put(
    "/settings/late-fees",
    dependencies=[Depends(require_action("billing.late_fee.policy.manage"))],
)
async def update_late_fee_settings(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.late_fee.policy.update", request=request)
    update = {k: v for k, v in data.items() if k in {"enabled", "grace_period_days", "fee_type", "fee_amount", "max_fee_percentage", "apply_frequency"}}
    try:
        grace = int(update.get("grace_period_days", 7))
        fee_amount = float(update.get("fee_amount", 5))
        max_pct = float(update.get("max_fee_percentage", 25))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Late fee values must be numbers") from None
    if not 0 <= grace <= 365:
        raise HTTPException(status_code=422, detail="grace_period_days must be between 0 and 365")
    if not isfinite(fee_amount) or fee_amount < 0:
        raise HTTPException(status_code=422, detail="fee_amount must be a non-negative number")
    if not isfinite(max_pct) or not 0 <= max_pct <= 100:
        raise HTTPException(status_code=422, detail="max_fee_percentage must be between 0 and 100")
    if update.get("fee_type", "percentage") not in {"percentage", "fixed"}:
        raise HTTPException(status_code=422, detail="fee_type must be percentage or fixed")
    if update.get("apply_frequency", "once") not in {"once", "monthly"}:
        raise HTTPException(status_code=422, detail="apply_frequency must be once or monthly")
    update.update({
        "type": "late_fees",
        "grace_period_days": grace,
        "fee_amount": fee_amount,
        "max_fee_percentage": max_pct,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": current_user.get("id"),
    })
    await db.settings.update_one({"type": "late_fees"}, {"$set": update}, upsert=True)
    await log_activity(
        current_user, "updated", "late_fee_policy", "late_fees", "Late fee policy",
        "Updated the organisation late-fee policy", metadata={"enabled": update.get("enabled")},
    )
    return {"message": "Late fee settings updated"}


@router.post(
    "/invoices/apply-late-fees",
    dependencies=[Depends(require_action("billing.late_fee.policy.manage"))],
)
async def apply_late_fees(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.late_fee.apply", request=request)
    settings = await db.settings.find_one({"type": "late_fees"}, {"_id": 0})
    if not settings or not settings.get("enabled"):
        return {"message": "Late fees disabled", "applied": 0}
    grace = settings.get("grace_period_days", 7)
    fee_type = settings.get("fee_type", "percentage")
    fee_amount = float(settings.get("fee_amount", 5))
    max_pct = float(settings.get("max_fee_percentage", 25))
    frequency = settings.get("apply_frequency", "once")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=grace)).strftime("%Y-%m-%d")
    overdue = await db.invoices.find(
        scoped_query(
            current_user,
            {
                "payment_status": {"$in": ["unpaid", "partial"]},
                "due_date": {"$lt": cutoff},
                "status": {"$ne": "cancelled"},
                "is_split_parent": {"$ne": True},
            },
            site_field=None,
        ),
        {"_id": 0},
    ).to_list(10000)
    applied = 0
    for inv in overdue:
        if frequency == "once" and inv.get("late_fee_applied"):
            continue
        total = float(inv.get("total", 0))
        balance = total - float(inv.get("amount_paid", 0))
        if balance <= 0:
            continue
        if fee_type == "percentage":
            fee = round(balance * (fee_amount / 100), 2)
        else:
            fee = fee_amount
        existing_fees = float(inv.get("total_late_fees", 0))
        fee_base = max(0.0, total - existing_fees)
        if max_pct > 0 and (existing_fees + fee) > (fee_base * max_pct / 100):
            continue
        new_total = round(total + fee, 2)
        result = await db.invoices.update_one(
            {
                "id": inv["id"],
                "client_id": inv.get("client_id"),
                **_optimistic_version_filter(inv),
            },
            {"$set": {
                "total": new_total,
                "amount_due": round(new_total - float(inv.get("amount_paid") or 0), 2),
                "late_fee_applied": True,
                "total_late_fees": round(existing_fees + fee, 2),
                "last_late_fee_date": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, "$push": {"audit_trail": {
                "action": "late_fee", "amount": fee,
                "date": datetime.now(timezone.utc).isoformat(),
                "by": "System",
            }}, "$inc": {"version": 1}},
        )
        if result.matched_count:
            applied += 1
    return {"message": f"Late fees applied to {applied} invoices", "applied": applied}


# ============== PAYMENT REMINDERS ==============
# Legacy endpoint contract retained for existing clients, backed by the single
# invoice-reminder programme.  A second delivery loop here would allow two
# schedules to email the same invoice on the same day.

def _legacy_schedule_payload(settings: dict) -> dict:
    stages = settings.get("stages", [])
    return {
        "type": "payment_reminders",
        "authoritative_type": "invoice_reminders",
        "enabled": bool(settings.get("enabled")),
        "before_due_days": sorted({
            int(stage.get("days", 0)) for stage in stages
            if stage.get("kind") == "before_due" and stage.get("enabled", True)
        }),
        "after_due_days": sorted({
            int(stage.get("days", 0)) for stage in stages
            if stage.get("kind") == "after_due" and stage.get("enabled", True)
        }),
        "include_due_date": any(
            stage.get("kind") == "due_date" and stage.get("enabled", True)
            for stage in stages
        ),
        "weekday_only": bool(settings.get("weekday_only", True)),
        "min_balance": float(settings.get("min_balance", 0) or 0),
        "updated_at": settings.get("updated_at"),
        "updated_by": settings.get("updated_by"),
    }


def _default_reminder_stage(kind: str, days: int) -> dict:
    for stage in reminder_policy.DEFAULT_STAGES:
        if stage.get("kind") == kind and int(stage.get("days", 0)) == days:
            return dict(stage)
    return {
        "id": f"{kind}-{days}",
        "kind": kind,
        "days": days,
        "enabled": True,
        "tone": "professional",
        "subject": "Payment reminder: invoice {invoice_number}",
        "message": (
            "Hi {client_name},\n\n"
            "This is a reminder for invoice {invoice_number} for {amount_due}, "
            "due on {due_date}."
        ),
    }


@router.get(
    "/settings/payment-reminders",
    dependencies=[Depends(require_action("billing.portal.reminder.send"))],
)
async def get_reminder_settings(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.payment_reminder.policy.read", request=request)
    return _legacy_schedule_payload(await load_reminder_settings())


@router.put(
    "/settings/payment-reminders",
    dependencies=[Depends(require_action("billing.portal.reminder.send"))],
)
async def update_reminder_settings(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.payment_reminder.policy.update", request=request)
    before = data.get("before_due_days", [7, 3, 1])
    after = data.get("after_due_days", [1, 7, 14, 30])
    if not isinstance(before, list) or not isinstance(after, list):
        raise HTTPException(status_code=422, detail="Reminder offsets must be lists of days")
    try:
        before_days = sorted({int(day) for day in before if 0 <= int(day) <= 365})
        after_days = sorted({int(day) for day in after if 0 <= int(day) <= 365})
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Reminder offsets must be whole days") from None

    current_settings = await load_reminder_settings()
    existing = {
        (stage.get("kind"), int(stage.get("days", 0))): stage
        for stage in current_settings.get("stages", [])
    }
    stages: list[dict] = []
    for days in before_days:
        stage = dict(existing.get(("before_due", days)) or _default_reminder_stage("before_due", days))
        stage.update({"kind": "before_due", "days": days, "enabled": True})
        stages.append(stage)
    if data.get("include_due_date", True):
        stage = dict(existing.get(("due_date", 0)) or _default_reminder_stage("due_date", 0))
        stage.update({"kind": "due_date", "days": 0, "enabled": True})
        stages.append(stage)
    for days in after_days:
        stage = dict(existing.get(("after_due", days)) or _default_reminder_stage("after_due", days))
        stage.update({"kind": "after_due", "days": days, "enabled": True})
        stages.append(stage)

    settings, errors = reminder_policy.normalise_reminder_settings({
        "enabled": bool(data.get("enabled", False)),
        "stages": stages,
        "min_balance": data.get("min_balance", 0),
        "weekday_only": bool(data.get("weekday_only", False)),
    })
    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors))
    settings["updated_at"] = datetime.now(timezone.utc).isoformat()
    settings["updated_by"] = current_user.get("name", "")
    await db.settings.update_one({"type": "invoice_reminders"}, {"$set": settings}, upsert=True)
    await log_activity(
        current_user,
        "payment_reminder_policy_updated",
        "billing",
        "invoice_reminders",
        "Payment reminder policy",
        "Updated the organisation payment-reminder schedule",
        metadata={"enabled": settings["enabled"], "stages": len(settings["stages"])},
    )
    return {
        "message": "Reminder settings updated",
        "settings": _legacy_schedule_payload(settings),
    }


@router.post(
    "/invoices/send-reminders",
    dependencies=[Depends(require_action("billing.portal.reminder.send"))],
)
async def send_payment_reminders(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.payment_reminder.run", request=request)
    return await run_due_reminders(current_user, force=True)


# ============== CLIENT ACCOUNT STATEMENTS ==============

@router.get("/clients/{client_id}/statement", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_client_statement(
    client_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.client_statement.read",
        request=request,
        mask_not_found=True,
    )
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    invoices = await db.invoices.find(
        scoped_query(current_user, {"client_id": client_id}, site_field=None),
        {"_id": 0},
    ).sort("created_at", -1).to_list(1000)
    credits = await db.credit_notes.find(
        scoped_query(current_user, {"client_id": client_id}, site_field=None),
        {"_id": 0},
    ).to_list(200)
    total_invoiced = sum(i.get("total", 0) for i in invoices)
    total_paid = sum(i.get("amount_paid", 0) for i in invoices)
    total_credits = sum(c.get("total", 0) for c in credits if c.get("status") == "applied")
    outstanding = total_invoiced - total_paid - total_credits
    entries = []
    for inv in invoices:
        entries.append({
            "type": "invoice",
            "number": inv.get("invoice_number", ""),
            "date": str(inv.get("created_at", ""))[:10],
            "due_date": inv.get("due_date", ""),
            "total": inv.get("total", 0),
            "paid": inv.get("amount_paid", 0),
            "balance": inv.get("total", 0) - inv.get("amount_paid", 0),
            "status": inv.get("payment_status", "unpaid"),
        })
    for cn in credits:
        entries.append({
            "type": "credit_note",
            "number": cn.get("credit_note_number", ""),
            "date": str(cn.get("created_at", ""))[:10],
            "total": -cn.get("total", 0),
            "status": cn.get("status", "issued"),
        })
    entries.sort(key=lambda x: x.get("date", ""), reverse=True)
    return {
        "client": {"id": client_id, "name": client.get("name", ""), "email": client.get("email", "")},
        "total_invoiced": round(total_invoiced, 2),
        "total_paid": round(total_paid, 2),
        "total_credits": round(total_credits, 2),
        "outstanding": round(outstanding, 2),
        "entries": entries,
    }


@router.get("/clients/{client_id}/statement/pdf", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_client_statement_pdf(
    client_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.client_statement.export",
        request=request,
        mask_not_found=True,
    )
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    invoices = await db.invoices.find(
        scoped_query(current_user, {"client_id": client_id}, site_field=None),
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    from fpdf import FPDF

    company = branding.get("company_name", "NexusOps")
    hex_c = branding.get("primary_color", "#3B82F6").lstrip("#")
    primary = tuple(int(hex_c[i:i+2], 16) for i in (0, 2, 4)) if len(hex_c) == 6 else (59, 130, 246)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()
    pdf.set_fill_color(*primary)
    pdf.rect(0, 0, 210, 30, 'F')
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_xy(10, 5)
    cn = company.encode('latin-1', 'ignore').decode('latin-1')
    pdf.cell(100, 10, cn)
    pdf.set_font("Helvetica", "", 22)
    pdf.set_xy(120, 5)
    pdf.cell(80, 10, "STATEMENT", align="R")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_xy(120, 18)
    pdf.cell(80, 5, f"As of {datetime.now(timezone.utc).strftime('%Y-%m-%d')}", align="R")
    pdf.set_y(36)

    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(30, 30, 30)
    cname = (client.get("name", "")).encode('latin-1', 'ignore').decode('latin-1')
    pdf.cell(0, 7, cname, ln=True)
    cemail = (client.get("email") or "").encode('latin-1', 'ignore').decode('latin-1')
    if cemail:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(100, 100, 100)
        pdf.cell(0, 5, cemail, ln=True)
    pdf.ln(5)

    total_invoiced = sum(i.get("total", 0) for i in invoices)
    total_paid = sum(i.get("amount_paid", 0) for i in invoices)
    outstanding = total_invoiced - total_paid

    # Summary boxes
    pdf.set_fill_color(240, 253, 244)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_text_color(34, 197, 94)
    pdf.cell(63, 12, f"  Total Invoiced: ${total_invoiced:,.2f}", 0, 0, fill=True)
    pdf.set_fill_color(240, 249, 255)
    pdf.set_text_color(59, 130, 246)
    pdf.cell(63, 12, f"  Total Paid: ${total_paid:,.2f}", 0, 0, fill=True)
    color = (220, 38, 38) if outstanding > 0 else (34, 197, 94)
    pdf.set_fill_color(254, 242, 242) if outstanding > 0 else pdf.set_fill_color(240, 253, 244)
    pdf.set_text_color(*color)
    pdf.cell(64, 12, f"  Outstanding: ${outstanding:,.2f}", 0, 1, fill=True)
    pdf.ln(5)

    # Table
    cols = [30, 55, 25, 30, 30, 20]
    heads = ["Invoice #", "Description", "Date", "Total", "Paid", "Status"]
    pdf.set_fill_color(*primary)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 8)
    for i, h in enumerate(heads):
        pdf.cell(cols[i], 8, h, 0, 0, "C" if i >= 2 else "L", True)
    pdf.ln()
    pdf.set_font("Helvetica", "", 8)
    for idx, inv in enumerate(invoices[:50]):
        pdf.set_fill_color(245, 247, 250) if idx % 2 == 1 else pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(40, 40, 40)
        pdf.cell(cols[0], 7, inv.get("invoice_number", ""), 0, 0, "L", True)
        notes = (inv.get("notes") or "")[:30].encode('latin-1', 'ignore').decode('latin-1')
        pdf.cell(cols[1], 7, notes, 0, 0, "L", True)
        pdf.cell(cols[2], 7, str(inv.get("created_at", ""))[:10], 0, 0, "C", True)
        pdf.cell(cols[3], 7, f"${inv.get('total', 0):,.2f}", 0, 0, "R", True)
        pdf.cell(cols[4], 7, f"${inv.get('amount_paid', 0):,.2f}", 0, 0, "R", True)
        ps = inv.get("payment_status", "unpaid")
        c = (34, 197, 94) if ps == "paid" else (220, 38, 38) if ps == "unpaid" else (245, 158, 11)
        pdf.set_text_color(*c)
        pdf.cell(cols[5], 7, ps.title(), 0, 1, "C", True)
    pdf.set_y(-20)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(0, 4, f"Generated by {cn} on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", align="C")
    return Response(content=bytes(pdf.output()), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Statement_{cname}.pdf"'})


# ============== AGING REPORT ==============

@router.get("/invoices/aging-report", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_aging_report(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Legacy compatibility endpoint; Reporting is now the authoritative UI."""
    await assert_global_scope(current_user, operation="billing.aging_report.read", request=request)
    report = await build_accounts_receivable_aging(
        scoped_query(current_user, {}, site_field=None)
    )
    legacy_keys = {
        "current": "current",
        "30": "30_days",
        "60": "60_days",
        "90": "90_days",
        "120_plus": "over_90",
    }
    return {
        "as_of": report["as_of"],
        "buckets": {
            legacy_key: {
                "invoices": report["buckets"][source_key]["items"],
                "total": report["buckets"][source_key]["total"],
                "count": report["buckets"][source_key]["count"],
            }
            for legacy_key, source_key in legacy_keys.items()
        },
        "grand_total": report["grand_total"],
        "total_invoices": report["total_invoices"],
    }


# ============== INVOICE CLONING ==============

@router.post(
    "/invoices/{invoice_id}/clone",
    dependencies=[Depends(require_action("billing.invoice.create"))],
)
async def clone_invoice(
    invoice_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        inv.get("client_id"),
        operation="billing.invoice.clone",
        request=request,
        mask_not_found=True,
    )
    if inv.get("is_split_parent"):
        raise HTTPException(status_code=409, detail="Clone a generated payer invoice instead of a split-billing source record")
    now = datetime.now(timezone.utc)
    new = {**inv}
    new["id"] = str(uuid.uuid4())
    # A global row count is not a numbering scheme: concurrent clones can reuse
    # it.  The date + random suffix is unique even under concurrent requests.
    new["invoice_number"] = f"INV-{now.strftime('%Y%m')}-{uuid.uuid4().hex[:6].upper()}"
    new["payment_status"] = "unpaid"
    new["amount_paid"] = 0
    new["amount_due"] = float(inv.get("total", 0) or 0)
    new["status"] = "draft"
    new["version"] = 1
    new["tenant_id"] = platform_tenant_id(current_user)
    new["created_by"] = current_user.get("id", "")
    new["created_by_name"] = current_user.get("name", "")
    source_name = str(inv.get("invoice_name") or "").strip()
    if source_name:
        new["invoice_name"] = f"Copy of {source_name}"[:160]
    new["payments"] = []
    new["audit_trail"] = []
    new["due_date"] = (now + timedelta(days=30)).strftime("%Y-%m-%d")
    new["created_at"] = now.isoformat()
    new["updated_at"] = now.isoformat()
    for key in [
        "_id", "paid_date", "stripe_session_id", "stripe_payment_intent_id",
        "xero_invoice_id", "xero_synced_at", "last_emailed_to", "last_emailed_at",
        "sent_at", "viewed_at", "late_fee_applied", "total_late_fees",
        "last_reminder_date", "reminder_count", "void_reason", "voided_at",
        "recurring_invoice_id", "billing_period", "auto_generated", "recurring_delivery",
        "document_snapshot", "payment_plan", "payment_plan_id", "has_payment_plan",
        "is_split_parent", "split_billing", "credit_notes", "refunds",
    ]:
        new.pop(key, None)
    await db.invoices.insert_one(new)
    new.pop("_id", None)
    await log_activity(
        current_user, "cloned", "invoice", new["id"], new["invoice_number"],
        f"Cloned from {inv.get('invoice_number', '')}",
        metadata={"client_id": inv.get("client_id"), "source_invoice_id": inv.get("id")},
    )
    return new


# ============== BATCH INVOICING ==============

@router.post(
    "/invoices/batch-create",
    dependencies=[Depends(require_action("billing.invoice.create"))],
)
async def batch_create_invoices(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    raw_client_ids = data.get("client_ids", [])
    template = data.get("template", {})
    if not isinstance(raw_client_ids, list) or not isinstance(template, dict):
        raise HTTPException(status_code=422, detail="client_ids must be a list and template must be an object")
    client_ids = list(dict.fromkeys(str(cid).strip() for cid in raw_client_ids if str(cid).strip()))
    if not client_ids:
        raise HTTPException(status_code=400, detail="At least one client_id is required")
    if len(client_ids) > 100:
        raise HTTPException(status_code=422, detail="A batch supports at most 100 clients")

    raw_lines = template.get("line_items", [])
    if not isinstance(raw_lines, list) or not raw_lines:
        raise HTTPException(status_code=400, detail="template.line_items required")
    if len(raw_lines) > 200:
        raise HTTPException(status_code=422, detail="A batch invoice supports at most 200 lines")
    line_items = []
    for index, raw in enumerate(raw_lines, start=1):
        if not isinstance(raw, dict):
            raise HTTPException(status_code=422, detail=f"Line {index} must be an object")
        description = str(raw.get("description") or raw.get("name") or "").strip()
        if not description:
            raise HTTPException(status_code=422, detail=f"Line {index} needs a description")
        try:
            quantity = float(raw.get("quantity", 1))
            rate = float(raw.get("rate", raw.get("unit_price", 0)))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"Line {index} quantity and rate must be numbers") from None
        if not isfinite(quantity) or not isfinite(rate) or quantity <= 0 or rate < 0:
            raise HTTPException(status_code=422, detail=f"Line {index} needs a positive quantity and valid rate")
        line = {**raw, "description": description, "quantity": quantity, "rate": rate}
        line["amount"] = round(quantity * rate, 2)
        line["unit_price"] = rate
        line["total"] = line["amount"]
        line_items.append(line)
    subtotal = round(sum(float(line["amount"]) for line in line_items), 2)
    try:
        tax_rate = float(template.get("tax_rate", 0))
        due_days = int(template.get("due_days", 30))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="tax_rate and due_days must be numbers") from None
    if not isfinite(tax_rate) or not 0 <= tax_rate <= 100:
        raise HTTPException(status_code=422, detail="tax_rate must be between 0 and 100")
    if not 0 <= due_days <= 365:
        raise HTTPException(status_code=422, detail="due_days must be between 0 and 365")
    notes = str(template.get("notes") or "")[:5000]
    currency = str(template.get("currency") or "AUD").strip().upper()[:8]
    tax = round(subtotal * (tax_rate / 100), 2)
    total = round(subtotal + tax, 2)

    # Validate every target before writing anything.  A partial batch that
    # silently skips a foreign client both hides the denial and creates an
    # inconsistent set of invoices.
    clients: list[dict] = []
    for cid in client_ids:
        await assert_client_scope(
            current_user, cid, operation="billing.invoice.batch_create", request=request, mask_not_found=True
        )
        client = await db.clients.find_one({"id": cid}, {"_id": 0, "id": 1, "name": 1})
        if not client:
            raise HTTPException(status_code=404, detail="One or more clients were not found")
        clients.append(client)

    now = datetime.now(timezone.utc)
    created = []
    for client in clients:
        inv = {
            "id": str(uuid.uuid4()),
            "invoice_number": f"INV-{now.strftime('%Y%m')}-{uuid.uuid4().hex[:6].upper()}",
            "client_id": client["id"],
            "client_name": client.get("name", ""),
            "line_items": line_items,
            "subtotal": subtotal,
            "tax": tax,
            "tax_amount": tax,
            "tax_rate": tax_rate,
            "total": total,
            "amount_due": total,
            "amount_paid": 0,
            "currency": currency,
            "payment_status": "unpaid",
            "status": "draft",
            "due_date": (now + timedelta(days=due_days)).strftime("%Y-%m-%d"),
            "notes": notes,
            "payments": [],
            "tenant_id": platform_tenant_id(current_user),
            "version": 1,
            "created_by": current_user["id"],
            "created_by_name": current_user.get("name", ""),
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }
        await db.invoices.insert_one(inv)
        inv.pop("_id", None)
        created.append(inv)
    await log_activity(
        current_user, "batch_created", "invoice", "batch", f"{len(created)} invoices",
        f"Created {len(created)} invoices from a shared template",
        metadata={"client_ids": [c["id"] for c in clients], "total": total, "count": len(created)},
    )
    return {"message": f"Created {len(created)} invoices", "invoices": created}


# ============== TAX PROFILES ==============

@router.get("/settings/tax-profiles", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_tax_profiles(current_user: dict = Depends(get_current_user)):
    profiles = await db.tax_profiles.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not profiles:
        defaults = [
            {"id": "tax-gst-15", "name": "GST 15%", "rate": 15, "region": "New Zealand", "is_default": True},
            {"id": "tax-gst-10", "name": "GST 10%", "rate": 10, "region": "Australia", "is_default": False},
            {"id": "tax-vat-20", "name": "VAT 20%", "rate": 20, "region": "United Kingdom", "is_default": False},
            {"id": "tax-none", "name": "No Tax", "rate": 0, "region": "Tax Exempt", "is_default": False},
        ]
        for d in defaults:
            await db.tax_profiles.insert_one(d)
            d.pop("_id", None)
        return defaults
    return profiles


@router.post(
    "/settings/tax-profiles",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def create_tax_profile(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.tax_profile.create", request=request)
    name = str(data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Tax profile name is required")
    try:
        rate = float(data.get("rate", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Tax profile rate must be a number") from None
    if not isfinite(rate) or not 0 <= rate <= 100:
        raise HTTPException(status_code=422, detail="Tax profile rate must be between 0 and 100")
    profile = {
        "id": str(uuid.uuid4()),
        "name": name[:120],
        "rate": rate,
        "region": str(data.get("region") or "").strip()[:120],
        "is_default": bool(data.get("is_default", False)),
        "tenant_id": platform_tenant_id(current_user),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if profile["is_default"]:
        await db.tax_profiles.update_many({}, {"$set": {"is_default": False}})
    await db.tax_profiles.insert_one(profile)
    profile.pop("_id", None)
    await log_activity(
        current_user, "created", "tax_profile", profile["id"], profile["name"],
        f"Created tax profile {profile['name']} at {rate:g}%",
    )
    return profile


@router.delete(
    "/settings/tax-profiles/{profile_id}",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def delete_tax_profile(
    profile_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.tax_profile.delete", request=request)
    result = await db.tax_profiles.delete_one({"id": profile_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Tax profile not found")
    await log_activity(current_user, "deleted", "tax_profile", profile_id, profile_id, "Deleted a tax profile")
    return {"message": "Tax profile deleted"}


# ============== REVENUE ANALYTICS ==============

@router.get(
    "/invoices/analytics/revenue",
    dependencies=[Depends(require_action("billing.analytics.view"))],
)
async def get_revenue_analytics(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await assert_global_scope(current_user, operation="billing.analytics.view", request=request)
    all_inv = await db.invoices.find(
        scoped_query(
            current_user,
            {"status": {"$ne": "cancelled"}, "is_split_parent": {"$ne": True}},
            site_field=None,
        ),
        {"_id": 0},
    ).to_list(10000)
    monthly_revenue = {}
    monthly_collected = {}
    client_revenue: dict[str, dict] = {}
    for inv in all_inv:
        month = str(inv.get("created_at", ""))[:7]
        if month:
            monthly_revenue[month] = monthly_revenue.get(month, 0) + float(inv.get("total") or 0)
            monthly_collected[month] = monthly_collected.get(month, 0) + float(inv.get("amount_paid") or 0)
        cid = inv.get("client_id") or inv.get("client_name") or "Unknown"
        bucket = client_revenue.setdefault(cid, {"name": inv.get("client_name") or "Unknown", "revenue": 0.0})
        bucket["revenue"] += float(inv.get("total") or 0)
    monthly_sorted = sorted(monthly_revenue.items())[-12:]
    top_clients = sorted(client_revenue.values(), key=lambda item: item["revenue"], reverse=True)[:10]
    total_rev = sum(float(inv.get("total") or 0) for inv in all_inv)
    total_col = sum(float(inv.get("amount_paid") or 0) for inv in all_inv)
    collection_rate = (total_col / total_rev * 100) if total_rev else 0
    recurring = await db.recurring_invoices.find(
        scoped_query(current_user, {"status": "active"}, site_field=None),
        {"_id": 0, "amount": 1, "frequency": 1},
    ).to_list(500)
    mrr = sum(
        _monthly_recurring_value(r.get("amount"), r.get("frequency"))
        for r in recurring
    )
    arr = mrr * 12
    return {
        "total_revenue": round(total_rev, 2),
        "total_collected": round(total_col, 2),
        "outstanding": round(total_rev - total_col, 2),
        "collection_rate": round(collection_rate, 1),
        "mrr": round(mrr, 2),
        "arr": round(arr, 2),
        "monthly_revenue": [{"month": m, "revenue": round(monthly_revenue[m], 2), "collected": round(monthly_collected.get(m, 0), 2)} for m, _ in monthly_sorted],
        "top_clients": [{"client": item["name"], "revenue": round(item["revenue"], 2)} for item in top_clients],
        "total_invoices": len(all_inv),
    }
