from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
import os
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== INVOICES ENDPOINTS ==============

@router.get("/invoices", response_model=List[Invoice])
async def get_invoices(
    client_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    
    invoices = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for i in invoices:
        if isinstance(i.get('created_at'), str):
            i['created_at'] = datetime.fromisoformat(i['created_at'])
    return invoices

@router.get("/invoices/stats/summary")
async def get_invoice_stats(current_user: dict = Depends(get_current_user)):
    all_inv = await db.invoices.find({}, {"_id": 0}).to_list(10000)
    total = len(all_inv)
    paid = len([i for i in all_inv if i.get("payment_status") == "paid"])
    unpaid = len([i for i in all_inv if i.get("payment_status") in ("unpaid", None)])
    overdue_count = 0
    for i in all_inv:
        if i.get("payment_status") not in ("paid",) and i.get("due_date"):
            try:
                due = datetime.strptime(i["due_date"], "%Y-%m-%d")
                if due < datetime.now():
                    overdue_count += 1
            except:
                pass
    total_revenue = sum(i.get("total", 0) for i in all_inv)
    total_collected = sum(i.get("amount_paid", 0) for i in all_inv)
    total_outstanding = total_revenue - total_collected
    return {
        "total": total, "paid": paid, "unpaid": unpaid, "overdue": overdue_count,
        "total_revenue": round(total_revenue, 2), "total_collected": round(total_collected, 2),
        "total_outstanding": round(total_outstanding, 2)
    }

@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice

@router.get("/invoices/{invoice_id}/activity-log")
async def get_invoice_activity_log(invoice_id: str, current_user: dict = Depends(get_current_user)):
    """Get activity log for a specific invoice (admin only)"""
    caller = await db.users.find_one({"id": current_user["id"]}, {"_id": 0})
    if not caller or (caller.get("role") != "admin" and not caller.get("is_admin")):
        raise HTTPException(status_code=403, detail="Admin access required")
    logs = await db.activity_logs.find({"entity_type": "invoice", "entity_id": invoice_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return logs

@router.post("/invoices", response_model=Invoice)
async def create_invoice(invoice_data: InvoiceCreate, current_user: dict = Depends(get_current_user)):
    if not invoice_data.client_id:
        raise HTTPException(status_code=422, detail="Client is required")
    client = await db.clients.find_one({"id": invoice_data.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not invoice_data.due_date:
        raise HTTPException(status_code=422, detail="Due date is required")
    try:
        datetime.strptime(invoice_data.due_date[:10], "%Y-%m-%d")
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Due date must be YYYY-MM-DD")
    if not invoice_data.line_items:
        raise HTTPException(status_code=422, detail="At least one invoice line is required")
    if not 0 <= float(invoice_data.tax_rate or 0) <= 100:
        raise HTTPException(status_code=422, detail="Tax rate must be between 0 and 100")
    if not 0 <= float(invoice_data.discount_pct or 0) <= 100:
        raise HTTPException(status_code=422, detail="Discount percentage must be between 0 and 100")
    client_name = client['name'] if client else None

    # ---- Calculate totals supporting per-line tax + per-line discount + invoice-level discount ----
    payload = invoice_data.model_dump()
    line_items = payload.get("line_items", []) or []
    invoice_tax_rate = float(payload.get("tax_rate") or 0.0)
    inv_discount_pct = float(payload.get("discount_pct") or 0.0)
    inv_discount_amt = float(payload.get("discount_amount") or 0.0)

    subtotal = 0.0
    line_tax_total = 0.0
    enriched_lines = []
    for index, li in enumerate(line_items, start=1):
        try:
            qty = float(li.get("quantity", 1) or 1)
            unit = float(li.get("unit_price", li.get("rate", 0)) or 0)
            line_disc_pct = float(li.get("discount_pct", 0) or 0)
            line_tax_pct = float(li.get("tax_rate", invoice_tax_rate) or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"Line {index} has an invalid quantity, price, discount, or tax rate")
        if not str(li.get("name") or "").strip():
            raise HTTPException(status_code=422, detail=f"Line {index} needs a description")
        if qty <= 0 or unit < 0 or not 0 <= line_disc_pct <= 100 or not 0 <= line_tax_pct <= 100:
            raise HTTPException(status_code=422, detail=f"Line {index} has invalid billing values")
        line_total_pre = qty * unit
        line_disc_amt = round(line_total_pre * line_disc_pct / 100, 2)
        line_total = round(line_total_pre - line_disc_amt, 2)
        line_tax = round(line_total * line_tax_pct / 100, 2)
        subtotal += line_total
        line_tax_total += line_tax
        enriched_lines.append({**li, "quantity": qty, "unit_price": unit, "discount_pct": line_disc_pct,
                               "discount_amount": line_disc_amt, "tax_rate": line_tax_pct,
                               "tax_amount": line_tax, "total": line_total})

    # Apply invoice-level discount
    if inv_discount_amt < 0:
        raise HTTPException(status_code=422, detail="Discount amount cannot be negative")
    if inv_discount_pct:
        inv_discount_amt = round(subtotal * inv_discount_pct / 100, 2)
    if inv_discount_amt > subtotal:
        raise HTTPException(status_code=422, detail="Discount cannot exceed the invoice subtotal")
    discounted_subtotal = max(0, round(subtotal - inv_discount_amt, 2))

    # If line items had per-line tax, use that. Otherwise apply flat tax rate to discounted subtotal.
    if line_tax_total > 0:
        # Recalculate per-line tax against discounted subtotal proportionally if invoice-level discount
        if inv_discount_amt and subtotal:
            ratio = discounted_subtotal / subtotal
            tax = round(line_tax_total * ratio, 2)
        else:
            tax = round(line_tax_total, 2)
    else:
        tax = round(discounted_subtotal * invoice_tax_rate / 100, 2)

    total = round(discounted_subtotal + tax, 2)

    # Smart numbering (optional override)
    invoice_number = None
    cfg = await db.settings.find_one({"key": "invoice_numbering"}, {"_id": 0}) or {}
    cfg_val = cfg.get("value") or {}
    if cfg_val.get("format"):
        from datetime import datetime as _dt
        now = _dt.now(timezone.utc)
        fy_start = int(cfg_val.get("fy_start_month", 7))
        fy = now.year if now.month >= fy_start else now.year - 1
        seq_doc = await db.settings.find_one_and_update(
            {"key": "invoice_seq"},
            {"$inc": {"value": 1}},
            upsert=True,
            return_document=True,
        ) or {"value": 1}
        seq = int(seq_doc.get("value") or 1)
        client_prefix = (client_name or "INV").upper().replace(" ", "")[:4]
        try:
            invoice_number = cfg_val["format"].format(
                YYYY=now.year, YY=str(now.year)[-2:],
                MM=f"{now.month:02d}", FY=fy, CLIENT=client_prefix, SEQ=seq,
            )
        except Exception:
            invoice_number = None

    # Approval workflow
    approval_cfg = await db.settings.find_one({"key": "invoice_approval"}, {"_id": 0}) or {}
    approval_val = approval_cfg.get("value") or {}
    needs_approval = bool(approval_val.get("enabled")) and total >= float(approval_val.get("threshold", 5000))
    initial_status = "pending_approval" if needs_approval else "draft"

    invoice_kwargs = dict(
        client_id=invoice_data.client_id,
        client_name=client_name,
        contract_id=invoice_data.contract_id,
        due_date=invoice_data.due_date,
        notes=invoice_data.notes,
        line_items=enriched_lines,
        subtotal=subtotal,
        tax=tax,
        tax_rate=invoice_tax_rate,
        total=total,
        payment_status="unpaid",
        status=initial_status,
        is_recurring=invoice_data.is_recurring,
        recurring_interval=invoice_data.recurring_interval,
        recurring_start_date=invoice_data.recurring_start_date,
        recurring_end_date=invoice_data.recurring_end_date,
        recurring_next_date=invoice_data.recurring_start_date,
    )
    if invoice_number:
        invoice_kwargs["invoice_number"] = invoice_number
    invoice = Invoice(**invoice_kwargs)
    doc = invoice.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    # Persist enrichment fields not in the base model
    doc["discount_pct"] = inv_discount_pct
    doc["discount_amount"] = inv_discount_amt
    doc["needs_approval"] = needs_approval
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(current_user, "created", "invoice", invoice.id, invoice.invoice_number, f"Created invoice {invoice.invoice_number} for {client_name}", metadata={"client_name": client_name, "total": total})
    return invoice

@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, invoice_data: dict, current_user: dict = Depends(get_current_user)):
    old_inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not old_inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    allowed = {"client_id", "client_name", "contract_id", "due_date", "notes", "line_items", "tax_rate", "discount_pct", "discount_amount", "subtotal", "tax", "total", "is_recurring", "recurring_interval", "recurring_start_date", "recurring_end_date"}
    update = {key: value for key, value in invoice_data.items() if key in allowed}
    financial_fields = {"line_items", "tax_rate", "discount_pct", "discount_amount", "subtotal", "tax", "total"}
    if old_inv.get("payment_status") == "paid" and financial_fields.intersection(update):
        raise HTTPException(status_code=409, detail="Paid invoices cannot be financially edited; issue a credit note instead")
    if old_inv.get("status") in {"cancelled", "voided"}:
        raise HTTPException(status_code=409, detail="Voided invoices cannot be edited")
    for value in (update.get("subtotal"), update.get("tax"), update.get("total"), update.get("discount_amount")):
        if value is not None and float(value) < 0:
            raise HTTPException(status_code=422, detail="Invoice totals cannot be negative")
    if update.get("discount_pct") is not None and not 0 <= float(update["discount_pct"]) <= 100:
        raise HTTPException(status_code=422, detail="Discount percentage must be between 0 and 100")
    if update.get("tax_rate") is not None and not 0 <= float(update["tax_rate"]) <= 100:
        raise HTTPException(status_code=422, detail="Tax rate must be between 0 and 100")

    # Financial totals are always derived server-side.  The UI may display a
    # preview, but it must never be able to set a subtotal, tax or total itself.
    if financial_fields.intersection(update):
        source_lines = update.get("line_items", old_inv.get("line_items", [])) or []
        if not source_lines:
            raise HTTPException(status_code=422, detail="At least one invoice line is required")
        invoice_tax_rate = float(update.get("tax_rate", old_inv.get("tax_rate", 0)) or 0)
        discount_pct = float(update.get("discount_pct", old_inv.get("discount_pct", 0)) or 0)
        discount_amount = float(update.get("discount_amount", old_inv.get("discount_amount", 0)) or 0)
        if not 0 <= discount_pct <= 100 or discount_amount < 0:
            raise HTTPException(status_code=422, detail="Invoice discount is invalid")

        subtotal = 0.0
        line_tax_total = 0.0
        enriched_lines = []
        for index, line in enumerate(source_lines, start=1):
            try:
                quantity = float(line.get("quantity", 1) or 1)
                unit_price = float(line.get("unit_price", line.get("rate", 0)) or 0)
                line_discount_pct = float(line.get("discount_pct", 0) or 0)
                line_tax_rate = float(line.get("tax_rate", invoice_tax_rate) or 0)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"Line {index} has invalid billing values")
            if not str(line.get("name") or line.get("description") or "").strip() or quantity <= 0 or unit_price < 0 or not 0 <= line_discount_pct <= 100 or not 0 <= line_tax_rate <= 100:
                raise HTTPException(status_code=422, detail=f"Line {index} has invalid billing values")
            line_pre_discount = quantity * unit_price
            line_discount_amount = round(line_pre_discount * line_discount_pct / 100, 2)
            line_total = round(line_pre_discount - line_discount_amount, 2)
            line_tax = round(line_total * line_tax_rate / 100, 2)
            subtotal += line_total
            line_tax_total += line_tax
            enriched_lines.append({**line, "quantity": quantity, "unit_price": unit_price, "discount_pct": line_discount_pct,
                                   "discount_amount": line_discount_amount, "tax_rate": line_tax_rate,
                                   "tax_amount": line_tax, "total": line_total})

        if discount_pct:
            discount_amount = round(subtotal * discount_pct / 100, 2)
        if discount_amount > subtotal:
            raise HTTPException(status_code=422, detail="Discount cannot exceed the invoice subtotal")
        discounted_subtotal = round(subtotal - discount_amount, 2)
        tax = round(line_tax_total * (discounted_subtotal / subtotal), 2) if line_tax_total and subtotal else round(discounted_subtotal * invoice_tax_rate / 100, 2)
        update.update({
            "line_items": enriched_lines,
            "tax_rate": invoice_tax_rate,
            "discount_pct": discount_pct,
            "discount_amount": discount_amount,
            "subtotal": round(subtotal, 2),
            "tax": tax,
            "total": round(discounted_subtotal + tax, 2),
        })
    result = await db.invoices.update_one({"id": invoice_id}, {"$set": update})
    if old_inv:
        change_dict = {}
        for k, v in update.items():
            if old_inv.get(k) != v:
                change_dict[k] = {"old": str(old_inv.get(k)), "new": str(v)}
        if change_dict:
            await log_activity(current_user, "updated", "invoice", invoice_id, old_inv.get("invoice_number", ""), f"Updated invoice fields: {', '.join(change_dict.keys())}", changes=change_dict)
    return {"message": "Invoice updated"}

@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    old_inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if old_inv and (old_inv.get("payment_status") in {"paid", "partial"} or old_inv.get("status") not in {"draft", "pending_approval"}):
        raise HTTPException(status_code=409, detail="Only unpaid draft invoices can be deleted; use a credit note or void workflow instead")
    result = await db.invoices.delete_one({"id": invoice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if old_inv:
        await log_activity(current_user, "deleted", "invoice", invoice_id, old_inv.get("invoice_number", ""), f"Deleted invoice {old_inv.get('invoice_number', '')}")
    return {"message": "Invoice deleted"}

@router.post("/invoices/{invoice_id}/generate-from-contract")
async def generate_invoice_from_contract(invoice_id: str, contract_id: str, current_user: dict = Depends(get_current_user)):
    contract = await db.contracts.find_one({"id": contract_id}, {"_id": 0})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    
    line_items = await db.line_items.find({"contract_id": contract_id}, {"_id": 0}).to_list(100)
    
    invoice_lines = [
        {
            "name": item['name'],
            "description": item.get('description', ''),
            "quantity": item['quantity'],
            "unit_price": item['unit_price'],
            "total": item['total']
        }
        for item in line_items
    ]
    
    client = await db.clients.find_one({"id": contract['client_id']}, {"_id": 0})
    subtotal = sum(item['total'] for item in line_items)
    
    invoice = Invoice(
        client_id=contract['client_id'],
        client_name=client['name'] if client else None,
        contract_id=contract_id,
        due_date=(datetime.now(timezone.utc) + timedelta(days=30)).strftime('%Y-%m-%d'),
        line_items=invoice_lines,
        subtotal=subtotal,
        total=subtotal
    )
    doc = invoice.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoices.insert_one(doc)
    return invoice

# ============== STRIPE PAYMENT ENDPOINTS ==============

@router.post("/invoices/{invoice_id}/pay")
async def create_invoice_payment(invoice_id: str, request_data: dict, current_user: dict = Depends(get_current_user)):
    from fastapi import Request
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Invoice already paid")

    stripe_key = None
    stripe_setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0})
    if stripe_setting and stripe_setting.get("api_key"):
        stripe_key = stripe_setting["api_key"]
    if not stripe_key:
        stripe_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_key:
        raise HTTPException(status_code=500, detail="Stripe not configured. Go to Settings to add your Stripe API key.")

    from app.services.stripe_checkout import StripeCheckout, CheckoutSessionRequest
    origin_url = request_data.get("origin_url", "")
    webhook_url = f"{origin_url}/api/webhook/stripe"
    stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url=webhook_url)

    success_url = f"{origin_url}/invoices?payment_success=true&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{origin_url}/invoices?payment_cancelled=true"

    amount = float(invoice.get("total", 0)) - float(invoice.get("amount_paid", 0))
    checkout_req = CheckoutSessionRequest(
        amount=round(amount, 2),
        currency="usd",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"invoice_id": invoice_id, "invoice_number": invoice.get("invoice_number", "")}
    )
    session = await stripe_checkout.create_checkout_session(checkout_req)

    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "session_id": session.session_id,
        "amount": amount,
        "currency": "usd",
        "payment_status": "initiated",
        "user_id": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"stripe_session_id": session.session_id}})

    return {"url": session.url, "session_id": session.session_id}

@router.get("/invoices/{invoice_id}/payment-status")
async def check_payment_status(invoice_id: str, session_id: str, current_user: dict = Depends(get_current_user)):
    stripe_key = None
    stripe_setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0})
    if stripe_setting and stripe_setting.get("api_key"):
        stripe_key = stripe_setting["api_key"]
    if not stripe_key:
        stripe_key = os.environ.get("STRIPE_API_KEY")
    if not stripe_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    from app.services.stripe_checkout import StripeCheckout
    stripe_checkout = StripeCheckout(api_key=stripe_key, webhook_url="")
    status = await stripe_checkout.get_checkout_status(session_id)

    existing = await db.payment_transactions.find_one({"session_id": session_id, "payment_status": "paid"})
    if existing:
        return {"payment_status": "paid", "already_processed": True}

    if status.payment_status == "paid":
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": "paid", "updated_at": datetime.now(timezone.utc).isoformat()}}
        )
        invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        new_paid = float(invoice.get("amount_paid", 0)) + float(status.amount_total / 100)
        new_payment_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
        payment_record = {
            "amount": status.amount_total / 100,
            "method": "stripe",
            "date": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
        }
        await db.invoices.update_one({"id": invoice_id}, {
            "$set": {
                "payment_status": new_payment_status,
                "amount_paid": new_paid,
                "status": "paid" if new_payment_status == "paid" else invoice.get("status"),
                "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d") if new_payment_status == "paid" else None,
            },
            "$push": {"payments": payment_record}
        })

    return {"payment_status": status.payment_status, "amount_total": status.amount_total, "currency": status.currency}

@router.post("/invoices/{invoice_id}/record-payment")
async def record_manual_payment(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("status") in {"cancelled", "voided"}:
        raise HTTPException(status_code=409, detail="Cannot record a payment against a voided invoice")
    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Payment amount must be a number")
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero")
    outstanding = max(0, float(invoice.get("total", 0) or 0) - float(invoice.get("amount_paid", 0) or 0))
    if amount > outstanding + 0.005:
        raise HTTPException(status_code=422, detail=f"Payment exceeds the outstanding balance of ${outstanding:.2f}")
    method = data.get("method", "manual")
    payment_date = str(data.get("date") or "").strip()
    if payment_date:
        try:
            datetime.strptime(payment_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Payment date must be YYYY-MM-DD")
    else:
        payment_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    new_paid = float(invoice.get("amount_paid", 0) or 0) + amount
    new_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
    payment_record = {
        "amount": amount, "method": method, "date": payment_date,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "reference": data.get("reference", ""), "notes": data.get("notes", ""),
        "recorded_by": current_user.get("name", ""),
    }
    await db.invoices.update_one({"id": invoice_id}, {
        "$set": {"payment_status": new_status, "amount_paid": new_paid,
                 "status": "paid" if new_status == "paid" else invoice.get("status"),
                 "paid_date": payment_date if new_status == "paid" else invoice.get("paid_date")},
        "$push": {"payments": payment_record}
    })
    await log_activity(current_user, "payment_recorded", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Recorded {method} payment of ${amount:.2f}", metadata={"amount": amount, "method": method, "payment_date": payment_date, "reference": data.get("reference", "")})
    return {"message": "Payment recorded", "new_balance": max(0, float(invoice.get("total", 0) or 0) - new_paid)}

# Move invoice to different client
@router.post("/invoices/{invoice_id}/move-client")
async def move_invoice_to_client(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    new_client_id = data.get("client_id")
    if not new_client_id:
        raise HTTPException(status_code=400, detail="New client_id required")
    new_client = await db.clients.find_one({"id": new_client_id}, {"_id": 0})
    if not new_client:
        raise HTTPException(status_code=404, detail="Target client not found")
    old_client_name = invoice.get("client_name", "Unknown")
    await db.invoices.update_one({"id": invoice_id}, {"$set": {
        "client_id": new_client_id, "client_name": new_client["name"],
    }, "$push": {"audit_trail": {
        "action": "moved_client", "from_client": old_client_name, "to_client": new_client["name"],
        "by": current_user.get("name", ""), "date": datetime.now(timezone.utc).isoformat()
    }}})
    await log_activity(current_user, "moved_client", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Moved invoice from {old_client_name} to {new_client['name']}", changes={"client": {"old": old_client_name, "new": new_client["name"]}})
    return {"message": f"Invoice moved to {new_client['name']}", "new_client_name": new_client["name"]}

# Void / write off invoice
@router.post("/invoices/{invoice_id}/void")
async def void_invoice(invoice_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.get("payment_status") in {"paid", "partial"}:
        raise HTTPException(status_code=409, detail="Paid or partially paid invoices cannot be voided; issue a credit note instead")
    if invoice.get("status") in {"cancelled", "voided"}:
        raise HTTPException(status_code=409, detail="Invoice is already voided")
    reason = data.get("reason", "")
    await db.invoices.update_one({"id": invoice_id}, {"$set": {
        "status": "cancelled", "void_reason": reason,
    }, "$push": {"audit_trail": {
        "action": "voided", "reason": reason,
        "by": current_user.get("name", ""), "date": datetime.now(timezone.utc).isoformat()
    }}})
    await log_activity(current_user, "voided", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Voided invoice. Reason: {reason}")
    return {"message": "Invoice voided"}

# Xero integration endpoints
@router.get("/settings/xero")
async def get_xero_settings(current_user: dict = Depends(get_current_user)):
    settings_doc = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    if not settings_doc:
        return {"type": "xero", "connected": False, "client_id": "", "tenant_name": ""}
    settings_doc.pop("client_secret", None)
    return settings_doc

@router.put("/settings/xero")
async def update_xero_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"type": "xero"}, {"$set": {
        "type": "xero", "client_id": data.get("client_id", ""),
        "client_secret": data.get("client_secret", ""),
        "redirect_uri": data.get("redirect_uri", ""),
        "connected": data.get("connected", False),
        "tenant_name": data.get("tenant_name", ""),
        "tenant_id": data.get("tenant_id", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Xero settings updated"}

@router.post("/xero/sync-invoice/{invoice_id}")
async def sync_invoice_to_xero(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    xero_settings = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    if not xero_settings or not xero_settings.get("connected"):
        raise HTTPException(status_code=400, detail="Xero not connected. Configure in Settings.")
    if not (xero_settings.get("access_token") or xero_settings.get("refresh_token")) or not xero_settings.get("tenant_id"):
        raise HTTPException(
            status_code=409,
            detail="Xero is not OAuth-authorized. Complete the Xero connection before syncing invoices.",
        )
    # A real Xero API client is intentionally required here. Never manufacture
    # an external invoice ID: that would make the finance record look synced
    # when Xero has never accepted it.
    raise HTTPException(
        status_code=501,
        detail="Xero invoice push is awaiting the OAuth API connector. This invoice has not been marked as synced.",
    )

@router.post("/xero/webhook")
async def xero_webhook(data: dict):
    events = data.get("events", [])
    for event in events:
        if event.get("eventType") == "INVOICES.UPDATE":
            xero_id = event.get("resourceId")
            invoice = await db.invoices.find_one({"xero_invoice_id": xero_id}, {"_id": 0})
            if invoice:
                new_status = event.get("status", invoice.get("status"))
                if new_status == "PAID":
                    await db.invoices.update_one({"id": invoice["id"]}, {"$set": {
                        "payment_status": "paid", "status": "paid",
                        "amount_paid": invoice.get("total", 0),
                        "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    }, "$push": {"payments": {
                        "amount": invoice.get("total", 0), "method": "xero",
                        "date": datetime.now(timezone.utc).isoformat(), "reference": xero_id,
                    }}})
    return {"status": "received"}

# ============== NO-NOTES ESCALATION SETTINGS ==============

@router.get("/settings/no-notes-threshold")
async def get_no_notes_threshold(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "no_notes_threshold"}, {"_id": 0})
    if not setting:
        return {"enabled": False, "threshold_hours": 24, "escalate_to": "", "escalate_to_name": ""}
    return setting

@router.put("/settings/no-notes-threshold")
async def update_no_notes_threshold(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "no_notes_threshold"},
        {"$set": {
            "type": "no_notes_threshold",
            "enabled": data.get("enabled", False),
            "threshold_hours": int(data.get("threshold_hours", 24)),
            "escalate_to": data.get("escalate_to", ""),
            "escalate_to_name": data.get("escalate_to_name", ""),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )
    return {"message": "No-notes threshold updated"}

@router.post("/tickets/check-escalation")
async def check_no_notes_escalation(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "no_notes_threshold"}, {"_id": 0})
    if not setting or not setting.get("enabled"):
        return {"escalated": 0}
    threshold_hours = setting.get("threshold_hours", 24)
    escalate_to = setting.get("escalate_to", "")
    if not escalate_to:
        return {"escalated": 0}
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=threshold_hours)).isoformat()
    open_tickets = await db.tickets.find(
        {"status": {"$in": ["open", "in_progress"]}, "created_at": {"$lte": cutoff}},
        {"_id": 0}
    ).to_list(10000)
    escalated = 0
    for t in open_tickets:
        if t.get("assigned_to") == escalate_to:
            continue
        nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        if nc == 0:
            old_assigned = t.get("assigned_to", "")
            await db.tickets.update_one({"id": t["id"]}, {
                "$set": {"assigned_to": escalate_to, "priority": "high"},
                "$push": {"audit_log": {
                    "action": "auto_escalated",
                    "from_value": old_assigned,
                    "to_value": escalate_to,
                    "reason": f"No notes after {threshold_hours}h threshold",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "user": "System"
                }}
            })
            escalated += 1
    return {"escalated": escalated, "threshold_hours": threshold_hours}

# ============== XERO INTEGRATION SETTINGS ==============

@router.get("/settings/xero")
async def get_xero_settings(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    if not setting:
        return {"configured": False, "client_id": "", "connected": False}
    return {**setting, "client_secret": "***" if setting.get("client_secret") else ""}

@router.put("/settings/xero")
async def update_xero_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"type": "xero"},
        {"$set": {
            "type": "xero",
            "client_id": data.get("client_id", ""),
            "client_secret": data.get("client_secret", ""),
            "redirect_uri": data.get("redirect_uri", ""),
            "connected": data.get("connected", False),
            "configured": bool(data.get("client_id")),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )
    return {"message": "Xero settings saved"}

# ============== STRIPE SETTINGS ==============

@router.get("/settings/stripe")
async def get_stripe_settings(current_user: dict = Depends(get_current_user)):
    setting = await db.settings.find_one({"type": "stripe"}, {"_id": 0})
    env_key = os.environ.get("STRIPE_API_KEY", "")
    if setting:
        return {"api_key": "***" + (setting.get("api_key", ""))[-4:] if setting.get("api_key") else "", "configured": bool(setting.get("api_key") or env_key)}
    return {"api_key": "***" + env_key[-4:] if env_key else "", "configured": bool(env_key)}

@router.put("/settings/stripe")
async def update_stripe_settings(data: dict, current_user: dict = Depends(get_current_user)):
    api_key = data.get("api_key", "")
    if not api_key or api_key.startswith("***"):
        return {"message": "No changes (masked key ignored)"}
    await db.settings.update_one(
        {"type": "stripe"},
        {"$set": {
            "type": "stripe",
            "api_key": api_key,
            "configured": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True
    )
    # Also update the env var in memory for immediate use
    os.environ["STRIPE_API_KEY"] = api_key
    return {"message": "Stripe API key saved"}

# ============== ENHANCED DASHBOARD ==============

@router.get("/dashboard/enhanced-stats")
async def get_enhanced_dashboard(current_user: dict = Depends(get_current_user)):
    open_tickets = await db.tickets.count_documents({"status": {"$in": ["open", "in_progress"]}})
    total_devices = await db.devices.count_documents({})
    online_devices = await db.devices.count_documents({"status": "online"})
    total_clients = await db.clients.count_documents({})

    all_inv = await db.invoices.find({}, {"_id": 0, "total": 1, "amount_paid": 1, "payment_status": 1, "due_date": 1}).to_list(10000)
    total_revenue = sum(i.get("total", 0) for i in all_inv)
    total_collected = sum(i.get("amount_paid", 0) for i in all_inv)
    unpaid_inv = [i for i in all_inv if i.get("payment_status") in ("unpaid", None)]
    overdue_inv = 0
    for i in unpaid_inv:
        try:
            if datetime.strptime(i.get("due_date", "2099-01-01"), "%Y-%m-%d") < datetime.now():
                overdue_inv += 1
        except:
            pass

    # No-notes tickets
    open_t = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}}, {"_id": 0, "id": 1}).to_list(10000)
    no_notes_count = 0
    for t in open_t:
        nc = await db.ticket_comments.count_documents({"ticket_id": t["id"]})
        if nc == 0:
            no_notes_count += 1

    # Low stock products
    products = await db.products.find({"is_active": True}, {"_id": 0, "quantity_in_stock": 1, "reorder_level": 1}).to_list(10000)
    low_stock = sum(1 for p in products if p.get("quantity_in_stock", 0) <= p.get("reorder_level", 5))

    # Pending POs
    pending_pos = await db.purchase_orders.count_documents({"status": {"$in": ["draft", "submitted"]}})

    # SLA breaches
    sla_breaches = 0
    for t in open_t:
        full_t = await db.tickets.find_one({"id": t["id"]}, {"_id": 0, "sla_due": 1})
        sla = full_t.get("sla_due") if full_t else None
        if sla:
            try:
                sla_dt = datetime.fromisoformat(str(sla).replace("Z", "+00:00")) if isinstance(sla, str) else sla
                if sla_dt and sla_dt < datetime.now(timezone.utc):
                    sla_breaches += 1
            except:
                pass

    mrr_result = await db.clients.aggregate([{"$group": {"_id": None, "total_mrr": {"$sum": "$mrr"}}}]).to_list(1)
    total_mrr = mrr_result[0]['total_mrr'] if mrr_result else 0

    return {
        "open_tickets": open_tickets, "total_devices": total_devices, "online_devices": online_devices,
        "total_clients": total_clients, "total_revenue": round(total_revenue, 2),
        "total_collected": round(total_collected, 2), "outstanding": round(total_revenue - total_collected, 2),
        "unpaid_invoices": len(unpaid_inv), "overdue_invoices": overdue_inv,
        "no_notes_tickets": no_notes_count, "low_stock_products": low_stock,
        "pending_purchase_orders": pending_pos, "sla_breaches": sla_breaches,
        "total_mrr": round(total_mrr, 2),
    }

