from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid
import os
import asyncio
import logging
from app.database import db
from app.auth import get_current_user
from app.services.activity import log_activity

logger = logging.getLogger(__name__)
router = APIRouter()


# ============== EMAIL INVOICE TO CLIENT ==============

@router.post("/invoices/{invoice_id}/email")
async def email_invoice_to_client(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    email = data.get("email", "")
    if not email:
        client = await db.clients.find_one({"id": invoice.get("client_id", "")}, {"_id": 0})
        email = client.get("email", "") if client else ""
    if not email:
        raise HTTPException(status_code=400, detail="No email address provided or found for client")
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=422, detail="A valid recipient email address is required")
    subject = data.get("subject", f"Invoice {invoice.get('invoice_number', '')} from NexusOps")
    message = data.get("message", "")
    branding = await db.settings.find_one({"type": "branding"}, {"_id": 0}) or {}
    company = branding.get("company_name", "NexusOps")
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
    from app.routers.email_utils import send_email
    delivery = await send_email(
        email,
        subject,
        f"<div style='font-family:sans-serif;max-width:600px;margin:auto;'>{message}</div>",
        category="billing",
    )
    sent = delivery.get("status") == "sent"
    delivery_status = delivery.get("status", "failed")
    record = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
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
    if sent and invoice.get("status") in {"draft", "pending_approval"}:
        update["status"] = "sent"
    await db.invoices.update_one({"id": invoice_id}, {"$set": update})
    activity_action = "emailed" if sent else "email_attempted"
    activity_detail = f"Invoice emailed to {email}" if sent else f"Invoice email {delivery_status} for {email}"
    await log_activity(current_user, activity_action, "invoice", invoice_id, invoice.get("invoice_number", ""), activity_detail)
    return {"message": delivery.get("message") or (f"Invoice emailed to {email}" if sent else f"Email recorded; connect Microsoft 365 to deliver to {email}"), "sent": sent, "delivery_status": delivery_status, "email_id": delivery.get("email_id")}


@router.get("/invoices/{invoice_id}/email-history")
async def get_invoice_email_history(invoice_id: str, current_user: dict = Depends(get_current_user)):
    emails = await db.invoice_emails.find({"invoice_id": invoice_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return emails


# ============== CREDIT NOTES ==============

@router.get("/credit-notes")
async def get_credit_notes(client_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    notes = await db.credit_notes.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return notes


@router.post("/credit-notes")
async def create_credit_note(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.credit_notes.count_documents({})
    invoice_id = data.get("invoice_id", "")
    invoice = None
    if invoice_id:
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found")
        if invoice.get("status") in {"cancelled", "voided"}:
            raise HTTPException(status_code=409, detail="Cannot issue a credit note for a voided invoice")
    try:
        total = round(float(data.get("total", 0)), 2)
        subtotal = round(float(data.get("subtotal", total)), 2)
        tax = round(float(data.get("tax", 0)), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Credit note amounts must be valid numbers")
    if total <= 0:
        raise HTTPException(status_code=422, detail="Credit note total must be greater than zero")
    cn = {
        "id": str(uuid.uuid4()),
        "credit_note_number": f"CN-{count + 1001:04d}",
        "invoice_id": invoice_id,
        "invoice_number": invoice.get("invoice_number", "") if invoice else "",
        "client_id": data.get("client_id") or (invoice.get("client_id") if invoice else ""),
        "client_name": data.get("client_name") or (invoice.get("client_name") if invoice else ""),
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
    }
    await db.credit_notes.insert_one(cn)
    cn.pop("_id", None)
    await log_activity(current_user, "created", "credit_note", cn["id"], cn["credit_note_number"], f"Issued credit note {cn['credit_note_number']} for ${total:.2f}", metadata={"invoice_id": invoice_id, "total": total})
    return cn


@router.post("/credit-notes/{cn_id}/apply")
async def apply_credit_note(cn_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    cn = await db.credit_notes.find_one({"id": cn_id}, {"_id": 0})
    if not cn:
        raise HTTPException(status_code=404, detail="Credit note not found")
    if cn.get("applied_to_invoice"):
        raise HTTPException(status_code=400, detail="Already applied")
    invoice_id = data.get("invoice_id") or cn.get("invoice_id", "")
    if not invoice_id:
        raise HTTPException(status_code=400, detail="No invoice to apply to")
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("status") in {"cancelled", "voided"}:
        raise HTTPException(status_code=409, detail="Cannot apply a credit note to a voided invoice")
    if cn.get("client_id") and cn.get("client_id") != invoice.get("client_id"):
        raise HTTPException(status_code=409, detail="Credit note client does not match the invoice client")
    credit_amount = float(cn.get("total", 0) or 0)
    outstanding = max(0, float(invoice.get("total", 0) or 0) - float(invoice.get("amount_paid", 0) or 0))
    if credit_amount <= 0 or credit_amount > outstanding + 0.005:
        raise HTTPException(status_code=422, detail=f"Credit must be greater than zero and no more than the outstanding balance of ${outstanding:.2f}")
    new_paid = float(invoice.get("amount_paid", 0) or 0) + credit_amount
    new_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
    await db.invoices.update_one({"id": invoice_id}, {
        "$set": {"amount_paid": new_paid, "payment_status": new_status, "status": "paid" if new_status == "paid" else invoice.get("status")},
        "$push": {"payments": {
            "amount": credit_amount, "method": "credit_note",
            "date": datetime.now(timezone.utc).isoformat(),
            "reference": cn.get("credit_note_number", ""),
            "recorded_by": current_user.get("name", ""),
        }}
    })
    await db.credit_notes.update_one({"id": cn_id}, {"$set": {
        "applied_to_invoice": True,
        "applied_to_invoice_id": invoice_id,
        "applied_at": datetime.now(timezone.utc).isoformat(),
        "status": "applied",
    }})
    await log_activity(current_user, "credit_applied", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Applied credit note {cn.get('credit_note_number', '')} for ${credit_amount:.2f}", metadata={"credit_note_id": cn_id, "amount": credit_amount})
    return {"message": f"Credit of ${credit_amount:.2f} applied to invoice", "new_balance": max(0, float(invoice.get("total", 0) or 0) - new_paid)}


# ============== LATE FEE AUTOMATION ==============

@router.get("/settings/late-fees")
async def get_late_fee_settings(current_user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"type": "late_fees"}, {"_id": 0})
    return s or {
        "type": "late_fees", "enabled": False,
        "grace_period_days": 7, "fee_type": "percentage",
        "fee_amount": 5, "max_fee_percentage": 25,
        "apply_frequency": "once",
    }


@router.put("/settings/late-fees")
async def update_late_fee_settings(data: dict, current_user: dict = Depends(get_current_user)):
    data["type"] = "late_fees"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "late_fees"}, {"$set": data}, upsert=True)
    return {"message": "Late fee settings updated"}


@router.post("/invoices/apply-late-fees")
async def apply_late_fees(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "late_fees"}, {"_id": 0})
    if not settings or not settings.get("enabled"):
        return {"message": "Late fees disabled", "applied": 0}
    grace = settings.get("grace_period_days", 7)
    fee_type = settings.get("fee_type", "percentage")
    fee_amount = float(settings.get("fee_amount", 5))
    max_pct = float(settings.get("max_fee_percentage", 25))
    frequency = settings.get("apply_frequency", "once")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=grace)).strftime("%Y-%m-%d")
    overdue = await db.invoices.find({
        "payment_status": {"$in": ["unpaid", "partial"]},
        "due_date": {"$lt": cutoff},
        "status": {"$ne": "cancelled"},
    }, {"_id": 0}).to_list(10000)
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
        if max_pct > 0 and (existing_fees + fee) > (total * max_pct / 100):
            continue
        new_total = total + fee
        await db.invoices.update_one({"id": inv["id"]}, {"$set": {
            "total": new_total,
            "late_fee_applied": True,
            "total_late_fees": existing_fees + fee,
            "last_late_fee_date": datetime.now(timezone.utc).isoformat(),
        }, "$push": {"audit_trail": {
            "action": "late_fee", "amount": fee,
            "date": datetime.now(timezone.utc).isoformat(),
            "by": "System",
        }}})
        applied += 1
    return {"message": f"Late fees applied to {applied} invoices", "applied": applied}


# ============== PAYMENT REMINDERS ==============

@router.get("/settings/payment-reminders")
async def get_reminder_settings(current_user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"type": "payment_reminders"}, {"_id": 0})
    return s or {
        "type": "payment_reminders", "enabled": False,
        "before_due_days": [7, 3, 1],
        "after_due_days": [1, 7, 14, 30],
    }


@router.put("/settings/payment-reminders")
async def update_reminder_settings(data: dict, current_user: dict = Depends(get_current_user)):
    data["type"] = "payment_reminders"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "payment_reminders"}, {"$set": data}, upsert=True)
    return {"message": "Reminder settings updated"}


@router.post("/invoices/send-reminders")
async def send_payment_reminders(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "payment_reminders"}, {"_id": 0})
    if not settings or not settings.get("enabled"):
        return {"message": "Reminders disabled", "sent": 0}
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_dt = datetime.strptime(today, "%Y-%m-%d")
    unpaid = await db.invoices.find({
        "payment_status": {"$in": ["unpaid", "partial"]},
        "status": {"$ne": "cancelled"},
    }, {"_id": 0}).to_list(10000)
    sent = 0
    for inv in unpaid:
        due = inv.get("due_date", "")
        if not due:
            continue
        try:
            due_dt = datetime.strptime(due, "%Y-%m-%d")
        except Exception:
            continue
        days_until = (due_dt - today_dt).days
        should_remind = False
        if days_until > 0 and days_until in settings.get("before_due_days", []):
            should_remind = True
        elif days_until < 0 and abs(days_until) in settings.get("after_due_days", []):
            should_remind = True
        elif days_until == 0:
            should_remind = True
        if should_remind:
            last_reminder = inv.get("last_reminder_date", "")
            if last_reminder == today:
                continue
            client = await db.clients.find_one({"id": inv.get("client_id", "")}, {"_id": 0})
            email = client.get("email", "") if client else ""
            if not email:
                continue
            balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
            urgency = "overdue" if days_until < 0 else "due_today" if days_until == 0 else "upcoming"
            await db.notifications.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": inv.get("created_by", current_user["id"]),
                "title": f"Payment reminder sent: {inv.get('invoice_number', '')}",
                "message": f"Reminder sent to {email} for ${balance:.2f} ({urgency})",
                "severity": "warning" if urgency == "overdue" else "info",
                "type": "payment_reminder",
                "ref_type": "invoice", "ref_id": inv["id"],
                "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.invoices.update_one({"id": inv["id"]}, {"$set": {
                "last_reminder_date": today,
                "reminder_count": (inv.get("reminder_count", 0) or 0) + 1,
            }})
            sent += 1
    return {"message": f"Sent {sent} payment reminders", "sent": sent}


# ============== CLIENT ACCOUNT STATEMENTS ==============

@router.get("/clients/{client_id}/statement")
async def get_client_statement(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    credits = await db.credit_notes.find({"client_id": client_id}, {"_id": 0}).to_list(200)
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


@router.get("/clients/{client_id}/statement/pdf")
async def get_client_statement_pdf(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    invoices = await db.invoices.find({"client_id": client_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
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

@router.get("/invoices/aging-report")
async def get_aging_report(current_user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%Y-%m-%d")
    unpaid = await db.invoices.find({
        "payment_status": {"$in": ["unpaid", "partial"]},
        "status": {"$ne": "cancelled"},
    }, {"_id": 0}).to_list(10000)
    buckets = {"current": [], "30": [], "60": [], "90": [], "120_plus": []}
    totals = {"current": 0, "30": 0, "60": 0, "90": 0, "120_plus": 0}
    for inv in unpaid:
        due = inv.get("due_date", "")
        if not due:
            buckets["current"].append(inv)
            balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
            totals["current"] += balance
            continue
        try:
            due_dt = datetime.strptime(due, "%Y-%m-%d")
        except Exception:
            buckets["current"].append(inv)
            continue
        days_overdue = (today - due_dt.replace(tzinfo=timezone.utc)).days
        balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
        inv["days_overdue"] = days_overdue
        inv["balance"] = round(balance, 2)
        if days_overdue <= 0:
            buckets["current"].append(inv)
            totals["current"] += balance
        elif days_overdue <= 30:
            buckets["30"].append(inv)
            totals["30"] += balance
        elif days_overdue <= 60:
            buckets["60"].append(inv)
            totals["60"] += balance
        elif days_overdue <= 90:
            buckets["90"].append(inv)
            totals["90"] += balance
        else:
            buckets["120_plus"].append(inv)
            totals["120_plus"] += balance
    grand_total = sum(totals.values())
    return {
        "as_of": today_str,
        "buckets": {k: {"invoices": v, "total": round(totals[k], 2), "count": len(v)} for k, v in buckets.items()},
        "grand_total": round(grand_total, 2),
        "total_invoices": len(unpaid),
    }


# ============== INVOICE CLONING ==============

@router.post("/invoices/{invoice_id}/clone")
async def clone_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    count = await db.invoices.count_documents({})
    new = {**inv}
    new["id"] = str(uuid.uuid4())
    new["invoice_number"] = f"INV-{count + 1001:04d}"
    new["payment_status"] = "unpaid"
    new["amount_paid"] = 0
    new["status"] = "draft"
    new["payments"] = []
    new["audit_trail"] = []
    new["due_date"] = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    new["created_at"] = datetime.now(timezone.utc).isoformat()
    new["updated_at"] = datetime.now(timezone.utc).isoformat()
    for key in ["paid_date", "stripe_session_id", "xero_invoice_id", "xero_synced_at",
                "last_emailed_to", "last_emailed_at", "late_fee_applied", "total_late_fees",
                "last_reminder_date", "reminder_count", "void_reason"]:
        new.pop(key, None)
    await db.invoices.insert_one(new)
    new.pop("_id", None)
    await log_activity(current_user, "cloned", "invoice", new["id"], new["invoice_number"],
                      f"Cloned from {inv.get('invoice_number', '')}")
    return new


# ============== BATCH INVOICING ==============

@router.post("/invoices/batch-create")
async def batch_create_invoices(data: dict, current_user: dict = Depends(get_current_user)):
    client_ids = data.get("client_ids", [])
    template = data.get("template", {})
    line_items = template.get("line_items", [])
    due_days = int(template.get("due_days", 30))
    notes = template.get("notes", "")
    tax_rate = float(template.get("tax_rate", 0))
    if not client_ids or not line_items:
        raise HTTPException(status_code=400, detail="client_ids and template.line_items required")
    created = []
    for cid in client_ids:
        client = await db.clients.find_one({"id": cid}, {"_id": 0})
        if not client:
            continue
        count = await db.invoices.count_documents({})
        subtotal = sum(float(li.get("total", li.get("quantity", 1) * li.get("unit_price", 0))) for li in line_items)
        tax = round(subtotal * (tax_rate / 100), 2)
        total = subtotal + tax
        inv = {
            "id": str(uuid.uuid4()),
            "invoice_number": f"INV-{count + 1001:04d}",
            "client_id": cid,
            "client_name": client.get("name", ""),
            "line_items": line_items,
            "subtotal": round(subtotal, 2),
            "tax": round(tax, 2),
            "tax_rate": tax_rate,
            "total": round(total, 2),
            "amount_paid": 0,
            "payment_status": "unpaid",
            "status": "draft",
            "due_date": (datetime.now(timezone.utc) + timedelta(days=due_days)).strftime("%Y-%m-%d"),
            "notes": notes,
            "payments": [],
            "created_by": current_user["id"],
            "created_by_name": current_user.get("name", ""),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.invoices.insert_one(inv)
        inv.pop("_id", None)
        created.append(inv)
    return {"message": f"Created {len(created)} invoices", "invoices": created}


# ============== TAX PROFILES ==============

@router.get("/settings/tax-profiles")
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
        return defaults
    return profiles


@router.post("/settings/tax-profiles")
async def create_tax_profile(data: dict, current_user: dict = Depends(get_current_user)):
    profile = {
        "id": str(uuid.uuid4()),
        "name": data.get("name", ""),
        "rate": float(data.get("rate", 0)),
        "region": data.get("region", ""),
        "is_default": data.get("is_default", False),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if profile["is_default"]:
        await db.tax_profiles.update_many({}, {"$set": {"is_default": False}})
    await db.tax_profiles.insert_one(profile)
    profile.pop("_id", None)
    return profile


@router.delete("/settings/tax-profiles/{profile_id}")
async def delete_tax_profile(profile_id: str, current_user: dict = Depends(get_current_user)):
    await db.tax_profiles.delete_one({"id": profile_id})
    return {"message": "Tax profile deleted"}


# ============== REVENUE ANALYTICS ==============

@router.get("/invoices/analytics/revenue")
async def get_revenue_analytics(current_user: dict = Depends(get_current_user)):
    all_inv = await db.invoices.find({"status": {"$ne": "cancelled"}}, {"_id": 0}).to_list(10000)
    monthly_revenue = {}
    monthly_collected = {}
    client_revenue = {}
    for inv in all_inv:
        month = str(inv.get("created_at", ""))[:7]
        if month:
            monthly_revenue[month] = monthly_revenue.get(month, 0) + inv.get("total", 0)
            monthly_collected[month] = monthly_collected.get(month, 0) + inv.get("amount_paid", 0)
        cname = inv.get("client_name", "Unknown")
        client_revenue[cname] = client_revenue.get(cname, 0) + inv.get("total", 0)
    monthly_sorted = sorted(monthly_revenue.items())[-12:]
    top_clients = sorted(client_revenue.items(), key=lambda x: x[1], reverse=True)[:10]
    total_rev = sum(inv.get("total", 0) for inv in all_inv)
    total_col = sum(inv.get("amount_paid", 0) for inv in all_inv)
    collection_rate = (total_col / total_rev * 100) if total_rev else 0
    recurring = await db.recurring_invoices.find({"status": "active"}, {"_id": 0}).to_list(500)
    mrr = sum(r.get("amount", 0) for r in recurring if r.get("frequency") == "monthly")
    arr = mrr * 12
    return {
        "total_revenue": round(total_rev, 2),
        "total_collected": round(total_col, 2),
        "outstanding": round(total_rev - total_col, 2),
        "collection_rate": round(collection_rate, 1),
        "mrr": round(mrr, 2),
        "arr": round(arr, 2),
        "monthly_revenue": [{"month": m, "revenue": round(monthly_revenue[m], 2), "collected": round(monthly_collected.get(m, 0), 2)} for m, _ in monthly_sorted],
        "top_clients": [{"client": c, "revenue": round(r, 2)} for c, r in top_clients],
        "total_invoices": len(all_inv),
    }
