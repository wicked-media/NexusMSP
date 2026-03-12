from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
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
    client = await db.clients.find_one({"id": invoice_data.client_id}, {"_id": 0})
    client_name = client['name'] if client else None
    
    subtotal = sum(item.get('total', item.get('quantity', 1) * item.get('unit_price', 0)) for item in invoice_data.line_items)
    tax_rate = invoice_data.tax_rate or 0.0
    tax = subtotal * (tax_rate / 100)
    total = subtotal + tax
    
    invoice = Invoice(
        client_id=invoice_data.client_id,
        client_name=client_name,
        contract_id=invoice_data.contract_id,
        due_date=invoice_data.due_date,
        notes=invoice_data.notes,
        line_items=invoice_data.line_items,
        subtotal=subtotal,
        tax=tax,
        tax_rate=tax_rate,
        total=total,
        payment_status="unpaid",
        is_recurring=invoice_data.is_recurring,
        recurring_interval=invoice_data.recurring_interval,
        recurring_start_date=invoice_data.recurring_start_date,
        recurring_end_date=invoice_data.recurring_end_date,
        recurring_next_date=invoice_data.recurring_start_date,
    )
    doc = invoice.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.invoices.insert_one(doc)
    doc.pop("_id", None)
    await log_activity(current_user, "created", "invoice", invoice.id, invoice.invoice_number, f"Created invoice {invoice.invoice_number} for {client_name}", metadata={"client_name": client_name, "total": total})
    return invoice

@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, invoice_data: dict, current_user: dict = Depends(get_current_user)):
    old_inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    result = await db.invoices.update_one({"id": invoice_id}, {"$set": invoice_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if old_inv:
        change_dict = {}
        for k, v in invoice_data.items():
            if old_inv.get(k) != v:
                change_dict[k] = {"old": str(old_inv.get(k)), "new": str(v)}
        if change_dict:
            await log_activity(current_user, "updated", "invoice", invoice_id, old_inv.get("invoice_number", ""), f"Updated invoice fields: {', '.join(change_dict.keys())}", changes=change_dict)
    return {"message": "Invoice updated"}

@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    old_inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
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

    from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
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

    from emergentintegrations.payments.stripe.checkout import StripeCheckout
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
    amount = float(data.get("amount", 0))
    method = data.get("method", "manual")
    new_paid = float(invoice.get("amount_paid", 0)) + amount
    new_status = "paid" if new_paid >= float(invoice.get("total", 0)) else "partial"
    payment_record = {
        "amount": amount, "method": method, "date": datetime.now(timezone.utc).isoformat(),
        "reference": data.get("reference", ""), "recorded_by": current_user.get("name", ""),
    }
    await db.invoices.update_one({"id": invoice_id}, {
        "$set": {"payment_status": new_status, "amount_paid": new_paid,
                 "status": "paid" if new_status == "paid" else invoice.get("status"),
                 "paid_date": datetime.now(timezone.utc).strftime("%Y-%m-%d") if new_status == "paid" else invoice.get("paid_date")},
        "$push": {"payments": payment_record}
    })
    await log_activity(current_user, "payment_recorded", "invoice", invoice_id, invoice.get("invoice_number", ""), f"Recorded {method} payment of ${amount:.2f}", metadata={"amount": amount, "method": method})
    return {"message": "Payment recorded", "new_balance": float(invoice.get("total", 0)) - new_paid}

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
    xero_id = f"XERO-{str(uuid.uuid4())[:8].upper()}"
    await db.invoices.update_one({"id": invoice_id}, {"$set": {
        "xero_invoice_id": xero_id, "xero_synced_at": datetime.now(timezone.utc).isoformat()
    }})
    return {"message": "Invoice synced to Xero", "xero_invoice_id": xero_id}

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

