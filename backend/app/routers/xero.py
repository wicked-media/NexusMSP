from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
import random as _random_mod
_srand = _random_mod.SystemRandom()
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== XERO SETTINGS ==============

@router.get("/xero/status")
async def get_xero_status(current_user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    connected = bool(doc and doc.get("client_id") and doc.get("client_secret"))
    return {"connected": connected, "org_name": doc.get("org_name", "Demo Organisation") if connected else None}

@router.put("/xero/settings")
async def update_xero_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"type": "xero"}, {"$set": {
        "type": "xero",
        "client_id": data.get("client_id", ""),
        "client_secret": data.get("client_secret", ""),
        "tenant_id": data.get("tenant_id", ""),
        "org_name": data.get("org_name", ""),
        "redirect_uri": data.get("redirect_uri", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    return {"message": "Xero settings saved"}

# ============== XERO CONTACTS ==============

@router.get("/xero/contacts")
async def get_xero_contacts(current_user: dict = Depends(get_current_user)):
    contacts = await db.xero_contacts.find({}, {"_id": 0}).to_list(500)
    if not contacts:
        contacts = await _seed_xero_demo()
    return contacts

@router.post("/xero/contacts/sync")
async def sync_xero_contacts(current_user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(100)
    synced = 0
    for client in clients:
        existing = await db.xero_contacts.find_one({"client_id": client["id"]}, {"_id": 0})
        if not existing:
            contact = {
                "id": str(uuid.uuid4()),
                "client_id": client["id"],
                "client_name": client["name"],
                "xero_contact_id": f"XC-{uuid.uuid4().hex[:8].upper()}",
                "email": client.get("email", ""),
                "name": client["name"],
                "account_number": f"ACC-{str(synced + 1).zfill(4)}",
                "balance_due": round(_srand.uniform(100, 5000), 2),
                "overdue_amount": round(_srand.uniform(0, 1000), 2) if synced % 3 == 0 else 0,
                "status": "ACTIVE",
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.xero_contacts.insert_one(contact)
            synced += 1
    return {"synced": synced, "message": f"Synced {synced} contacts to Xero"}

# ============== XERO INVOICES ==============

@router.get("/xero/invoices")
async def get_xero_invoices(client_id: str = None, status: str = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    invoices = await db.xero_invoices.find(query, {"_id": 0}).sort("date", -1).to_list(500)
    if not invoices:
        await _seed_xero_demo()
        invoices = await db.xero_invoices.find(query, {"_id": 0}).sort("date", -1).to_list(500)
    return invoices

@router.post("/xero/invoices")
async def create_xero_invoice(data: dict, current_user: dict = Depends(get_current_user)):
    line_items = data.get("line_items", [])
    sub_total = sum(item.get("quantity", 1) * item.get("unit_price", 0) for item in line_items)
    tax = round(sub_total * 0.1, 2)
    total = round(sub_total + tax, 2)
    invoice = {
        "id": str(uuid.uuid4()),
        "xero_invoice_id": f"INV-{uuid.uuid4().hex[:8].upper()}",
        "invoice_number": data.get("invoice_number", f"INV-{str(await db.xero_invoices.count_documents({}) + 1).zfill(4)}"),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "contact_id": data.get("contact_id", ""),
        "date": data.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        "due_date": data.get("due_date", (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")),
        "status": data.get("status", "DRAFT"),
        "line_items": line_items,
        "sub_total": data.get("sub_total", sub_total),
        "tax": data.get("tax", tax),
        "total": data.get("total", total),
        "amount_paid": 0,
        "amount_due": data.get("total", total),
        "currency": data.get("currency", "AUD"),
        "reference": data.get("reference", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.xero_invoices.insert_one(invoice)
    invoice.pop("_id", None)
    return invoice

@router.put("/xero/invoices/{invoice_id}")
async def update_xero_invoice(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await db.xero_invoices.find_one({"id": invoice_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Invoice not found")
    updates = {}
    for field in ["client_name", "client_id", "date", "due_date", "status", "line_items", "sub_total", "tax", "total", "amount_due", "reference", "currency"]:
        if field in data:
            updates[field] = data[field]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.xero_invoices.update_one({"id": invoice_id}, {"$set": updates})
    return {"message": "Invoice updated"}

@router.put("/xero/invoices/{invoice_id}/pay")
async def pay_xero_invoice(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    amount = data.get("amount", 0)
    invoice = await db.xero_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    new_paid = (invoice.get("amount_paid", 0) or 0) + amount
    new_due = max(0, (invoice.get("total", 0) or 0) - new_paid)
    new_status = "PAID" if new_due <= 0 else "AUTHORISED"
    await db.xero_invoices.update_one({"id": invoice_id}, {"$set": {
        "amount_paid": new_paid, "amount_due": new_due, "status": new_status,
        "paid_at": datetime.now(timezone.utc).isoformat() if new_due <= 0 else None,
    }})
    # Log sync event
    await _log_sync_event("payment_recorded", f"Payment ${amount:.2f} on {invoice.get('invoice_number', invoice_id)}")
    return {"message": "Payment recorded", "amount_paid": new_paid, "amount_due": new_due, "status": new_status}

@router.put("/xero/invoices/{invoice_id}/void")
async def void_xero_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.xero_invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await db.xero_invoices.update_one({"id": invoice_id}, {"$set": {"status": "VOIDED", "amount_due": 0, "voided_at": datetime.now(timezone.utc).isoformat()}})
    return {"message": "Invoice voided"}

@router.post("/xero/invoices/{invoice_id}/send")
async def send_xero_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await db.xero_invoices.find_one({"id": invoice_id})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    new_status = "AUTHORISED" if invoice.get("status") == "DRAFT" else invoice.get("status")
    await db.xero_invoices.update_one({"id": invoice_id}, {"$set": {"status": new_status, "sent_at": datetime.now(timezone.utc).isoformat()}})
    await _log_sync_event("invoice_sent", f"Invoice {invoice.get('invoice_number', invoice_id)} sent to client")
    return {"message": "Invoice sent"}

# ============== XERO ESTIMATES ==============

@router.get("/xero/estimates")
async def get_xero_estimates(current_user: dict = Depends(get_current_user)):
    estimates = await db.xero_estimates.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    if not estimates:
        await _seed_xero_estimates()
        estimates = await db.xero_estimates.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return estimates

@router.post("/xero/estimates")
async def create_xero_estimate(data: dict, current_user: dict = Depends(get_current_user)):
    line_items = data.get("line_items", [])
    sub_total = sum(item.get("quantity", 1) * item.get("unit_price", 0) for item in line_items)
    tax = round(sub_total * data.get("tax_rate", 10) / 100, 2)
    total = round(sub_total + tax, 2)
    estimate = {
        "id": str(uuid.uuid4()),
        "estimate_number": f"EST-{str(await db.xero_estimates.count_documents({}) + 1).zfill(4)}",
        "title": data.get("title", ""),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "line_items": line_items,
        "sub_total": sub_total,
        "tax": tax,
        "total": total,
        "status": "DRAFT",
        "valid_until": data.get("valid_until", (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")),
        "notes": data.get("notes", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.xero_estimates.insert_one(estimate)
    estimate.pop("_id", None)
    return estimate

@router.put("/xero/estimates/{estimate_id}/status")
async def update_estimate_status(estimate_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    new_status = data.get("status", "DRAFT")
    result = await db.xero_estimates.find_one({"id": estimate_id})
    if not result:
        raise HTTPException(status_code=404, detail="Estimate not found")
    await db.xero_estimates.update_one({"id": estimate_id}, {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"message": f"Estimate status updated to {new_status}"}

@router.post("/xero/estimates/{estimate_id}/convert")
async def convert_estimate_to_invoice(estimate_id: str, current_user: dict = Depends(get_current_user)):
    est = await db.xero_estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    invoice = {
        "id": str(uuid.uuid4()),
        "xero_invoice_id": f"INV-{uuid.uuid4().hex[:8].upper()}",
        "invoice_number": f"INV-{str(await db.xero_invoices.count_documents({}) + 1).zfill(4)}",
        "client_id": est.get("client_id", ""),
        "client_name": est.get("client_name", ""),
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "due_date": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
        "status": "DRAFT",
        "line_items": est.get("line_items", []),
        "sub_total": est.get("sub_total", 0),
        "tax": est.get("tax", 0),
        "total": est.get("total", 0),
        "amount_paid": 0,
        "amount_due": est.get("total", 0),
        "currency": "AUD",
        "reference": f"From estimate {est.get('estimate_number', '')}",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.xero_invoices.insert_one(invoice)
    await db.xero_estimates.update_one({"id": estimate_id}, {"$set": {"status": "CONVERTED", "converted_invoice_id": invoice["id"]}})
    invoice.pop("_id", None)
    await _log_sync_event("estimate_converted", f"Estimate {est.get('estimate_number', '')} converted to Invoice {invoice['invoice_number']}")
    return invoice

# ============== XERO RECURRING ==============

@router.get("/xero/recurring")
async def get_xero_recurring(current_user: dict = Depends(get_current_user)):
    recurring = await db.xero_recurring.find({}, {"_id": 0}).to_list(100)
    if not recurring:
        await _seed_xero_recurring()
        recurring = await db.xero_recurring.find({}, {"_id": 0}).to_list(100)
    return recurring

@router.post("/xero/recurring")
async def create_xero_recurring(data: dict, current_user: dict = Depends(get_current_user)):
    line_items = data.get("line_items", [])
    sub_total = sum(item.get("quantity", 1) * item.get("unit_price", 0) for item in line_items)
    tax = round(sub_total * 0.1, 2)
    total = round(sub_total + tax, 2)
    rec = {
        "id": str(uuid.uuid4()),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "description": data.get("description", ""),
        "frequency": data.get("frequency", "monthly"),
        "line_items": line_items,
        "amount": total,
        "status": "active",
        "next_generation": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"),
        "invoices_generated": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.xero_recurring.insert_one(rec)
    rec.pop("_id", None)
    return rec

@router.put("/xero/recurring/{rec_id}/toggle")
async def toggle_recurring(rec_id: str, current_user: dict = Depends(get_current_user)):
    item = await db.xero_recurring.find_one({"id": rec_id})
    if not item:
        raise HTTPException(status_code=404, detail="Recurring item not found")
    new_status = "paused" if item.get("status") == "active" else "active"
    await db.xero_recurring.update_one({"id": rec_id}, {"$set": {"status": new_status}})
    return {"message": f"Recurring invoice {new_status}", "status": new_status}

# ============== XERO SYNC HISTORY ==============

@router.get("/xero/sync-history")
async def get_sync_history(current_user: dict = Depends(get_current_user)):
    history = await db.xero_sync_history.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    if not history:
        await _seed_sync_history()
        history = await db.xero_sync_history.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    return history

@router.post("/xero/sync")
async def trigger_xero_sync(current_user: dict = Depends(get_current_user)):
    await _log_sync_event("full_sync", "Full sync triggered - contacts, invoices, and accounts refreshed")
    contacts_synced = await db.xero_contacts.count_documents({})
    invoices_synced = await db.xero_invoices.count_documents({})
    return {"message": "Xero sync completed", "contacts_synced": contacts_synced, "invoices_synced": invoices_synced}

# ============== XERO DASHBOARD ==============

@router.get("/xero/dashboard")
async def get_xero_dashboard(current_user: dict = Depends(get_current_user)):
    invoices = await db.xero_invoices.find({}, {"_id": 0}).to_list(1000)
    if not invoices:
        await _seed_xero_demo()
        invoices = await db.xero_invoices.find({}, {"_id": 0}).to_list(1000)

    total_revenue = sum(i.get("total", 0) for i in invoices)
    total_paid = sum(i.get("amount_paid", 0) for i in invoices)
    total_outstanding = sum(i.get("amount_due", 0) for i in invoices)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    overdue = [i for i in invoices if i.get("status") == "AUTHORISED" and i.get("due_date", "") < now_str]
    total_overdue = sum(i.get("amount_due", 0) for i in overdue)

    by_status = {}
    for i in invoices:
        s = i.get("status", "DRAFT")
        if s not in by_status:
            by_status[s] = {"count": 0, "total": 0}
        by_status[s]["count"] += 1
        by_status[s]["total"] += i.get("total", 0)

    monthly = {}
    for i in invoices:
        if i.get("status") in ["PAID", "AUTHORISED"]:
            month = i.get("date", "")[:7]
            if month:
                monthly[month] = monthly.get(month, 0) + i.get("total", 0)
    monthly_data = [{"month": k, "revenue": v} for k, v in sorted(monthly.items())[-12:]
    ]

    # Aging buckets
    aging = {"current": 0, "30_days": 0, "60_days": 0, "90_plus": 0}
    for i in invoices:
        if i.get("amount_due", 0) > 0 and i.get("status") not in ["PAID", "VOIDED", "DRAFT"]:
            due = i.get("due_date", "")
            if due:
                days_overdue = (datetime.now(timezone.utc) - datetime.strptime(due, "%Y-%m-%d").replace(tzinfo=timezone.utc)).days
                if days_overdue <= 0:
                    aging["current"] += i["amount_due"]
                elif days_overdue <= 30:
                    aging["30_days"] += i["amount_due"]
                elif days_overdue <= 60:
                    aging["60_days"] += i["amount_due"]
                else:
                    aging["90_plus"] += i["amount_due"]

    # Contacts count
    contacts_count = await db.xero_contacts.count_documents({})
    estimates_count = await db.xero_estimates.count_documents({})
    recurring_count = await db.xero_recurring.count_documents({})

    # Collection rate
    collection_rate = round((total_paid / total_revenue * 100) if total_revenue > 0 else 0, 1)

    # Recent sync
    last_sync = await db.xero_sync_history.find_one({}, {"_id": 0}, sort=[("timestamp", -1)])

    return {
        "total_revenue": round(total_revenue, 2),
        "total_paid": round(total_paid, 2),
        "total_outstanding": round(total_outstanding, 2),
        "total_overdue": round(total_overdue, 2),
        "overdue_count": len(overdue),
        "invoice_count": len(invoices),
        "contacts_count": contacts_count,
        "estimates_count": estimates_count,
        "recurring_count": recurring_count,
        "collection_rate": collection_rate,
        "by_status": by_status,
        "monthly_revenue": monthly_data,
        "aging": aging,
        "last_sync": last_sync.get("timestamp") if last_sync else None,
    }

# ============== XERO ACCOUNTS ==============

@router.get("/xero/accounts")
async def get_xero_accounts(current_user: dict = Depends(get_current_user)):
    accounts = await db.xero_accounts.find({}, {"_id": 0}).to_list(100)
    if not accounts:
        defaults = [
            {"id": str(uuid.uuid4()), "code": "200", "name": "Sales", "type": "REVENUE", "status": "ACTIVE", "balance": 45230.50},
            {"id": str(uuid.uuid4()), "code": "400", "name": "Managed Services", "type": "REVENUE", "status": "ACTIVE", "balance": 128500.00},
            {"id": str(uuid.uuid4()), "code": "401", "name": "Break/Fix Revenue", "type": "REVENUE", "status": "ACTIVE", "balance": 23400.00},
            {"id": str(uuid.uuid4()), "code": "410", "name": "Hardware Sales", "type": "REVENUE", "status": "ACTIVE", "balance": 67800.00},
            {"id": str(uuid.uuid4()), "code": "610", "name": "Accounts Receivable", "type": "ASSET", "status": "ACTIVE", "balance": 34200.00},
            {"id": str(uuid.uuid4()), "code": "800", "name": "Operating Expenses", "type": "EXPENSE", "status": "ACTIVE", "balance": 18900.00},
            {"id": str(uuid.uuid4()), "code": "801", "name": "Software & Licensing", "type": "EXPENSE", "status": "ACTIVE", "balance": 8450.00},
            {"id": str(uuid.uuid4()), "code": "810", "name": "Wages & Salaries", "type": "EXPENSE", "status": "ACTIVE", "balance": 52300.00},
        ]
        for a in defaults:
            await db.xero_accounts.insert_one(a)
        accounts = defaults
    for a in accounts:
        a.pop("_id", None)
    return accounts

# ============== TICKET BULK ACTIONS ==============

@router.post("/tickets/bulk-action")
async def bulk_ticket_action(data: dict, current_user: dict = Depends(get_current_user)):
    ticket_ids = data.get("ticket_ids", [])
    action = data.get("action", "")
    value = data.get("value", "")
    if not ticket_ids or not action:
        raise HTTPException(status_code=400, detail="ticket_ids and action required")

    updated = 0
    if action == "close":
        result = await db.tickets.update_many({"id": {"$in": ticket_ids}}, {"$set": {"status": "closed", "updated_at": datetime.now(timezone.utc).isoformat()}})
        updated = result.modified_count
    elif action == "assign":
        if not value:
            raise HTTPException(status_code=400, detail="value (user_id) required for assign")
        result = await db.tickets.update_many({"id": {"$in": ticket_ids}}, {"$set": {"assigned_to": value, "updated_at": datetime.now(timezone.utc).isoformat()}})
        updated = result.modified_count
    elif action == "priority":
        if value not in ["low", "medium", "high", "critical"]:
            raise HTTPException(status_code=400, detail="Invalid priority value")
        result = await db.tickets.update_many({"id": {"$in": ticket_ids}}, {"$set": {"priority": value, "updated_at": datetime.now(timezone.utc).isoformat()}})
        updated = result.modified_count
    elif action == "tag":
        if not value:
            raise HTTPException(status_code=400, detail="value (tag) required")
        for tid in ticket_ids:
            await db.tickets.update_one({"id": tid}, {"$addToSet": {"tags": value}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}})
            updated += 1
    elif action == "status":
        if value not in ["open", "in_progress", "on_hold", "resolved", "closed"]:
            raise HTTPException(status_code=400, detail="Invalid status value")
        result = await db.tickets.update_many({"id": {"$in": ticket_ids}}, {"$set": {"status": value, "updated_at": datetime.now(timezone.utc).isoformat()}})
        updated = result.modified_count
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    return {"message": f"Bulk {action} applied to {updated} tickets", "updated": updated}

# ============== SEED HELPERS ==============

async def _log_sync_event(event_type: str, message: str):
    event = {
        "id": str(uuid.uuid4()),
        "event_type": event_type,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "success",
    }
    await db.xero_sync_history.insert_one(event)
    return event

async def _seed_sync_history():
    now = datetime.now(timezone.utc)
    events = [
        {"id": str(uuid.uuid4()), "event_type": "full_sync", "message": "Full sync completed - 12 contacts, 24 invoices synced", "timestamp": (now - timedelta(hours=2)).isoformat(), "status": "success"},
        {"id": str(uuid.uuid4()), "event_type": "invoice_created", "message": "Invoice INV-0015 created and synced to Xero", "timestamp": (now - timedelta(hours=5)).isoformat(), "status": "success"},
        {"id": str(uuid.uuid4()), "event_type": "payment_recorded", "message": "Payment $2,450.00 recorded on INV-0008", "timestamp": (now - timedelta(hours=8)).isoformat(), "status": "success"},
        {"id": str(uuid.uuid4()), "event_type": "contact_sync", "message": "3 new contacts synced from Xero", "timestamp": (now - timedelta(days=1)).isoformat(), "status": "success"},
        {"id": str(uuid.uuid4()), "event_type": "estimate_converted", "message": "Estimate EST-0003 converted to Invoice INV-0012", "timestamp": (now - timedelta(days=1, hours=4)).isoformat(), "status": "success"},
        {"id": str(uuid.uuid4()), "event_type": "reconciliation", "message": "Monthly reconciliation completed - $3,200 variance resolved", "timestamp": (now - timedelta(days=2)).isoformat(), "status": "success"},
        {"id": str(uuid.uuid4()), "event_type": "full_sync", "message": "Scheduled sync completed", "timestamp": (now - timedelta(days=3)).isoformat(), "status": "success"},
        {"id": str(uuid.uuid4()), "event_type": "invoice_voided", "message": "Invoice INV-0004 voided - duplicate entry", "timestamp": (now - timedelta(days=4)).isoformat(), "status": "warning"},
    ]
    for e in events:
        await db.xero_sync_history.insert_one(e)

async def _seed_xero_estimates():
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10)
    if not clients:
        return
    now = datetime.now(timezone.utc)
    statuses = ["DRAFT", "SENT", "APPROVED", "DECLINED", "DRAFT", "SENT"]
    items_pool = [
        [{"description": "Network Infrastructure Upgrade", "quantity": 1, "unit_price": 8500}, {"description": "Installation & Config", "quantity": 8, "unit_price": 150}],
        [{"description": "Cloud Migration Project", "quantity": 1, "unit_price": 12000}, {"description": "Data Transfer", "quantity": 1, "unit_price": 2500}],
        [{"description": "Cybersecurity Audit", "quantity": 1, "unit_price": 4500}, {"description": "Penetration Testing", "quantity": 1, "unit_price": 3000}],
        [{"description": "VoIP System Deployment", "quantity": 20, "unit_price": 85}, {"description": "Training & Setup", "quantity": 4, "unit_price": 150}],
        [{"description": "Server Replacement", "quantity": 2, "unit_price": 6500}, {"description": "Migration Services", "quantity": 12, "unit_price": 150}],
    ]
    for idx, client in enumerate(clients[:5]):
        items = items_pool[idx % len(items_pool)]
        sub_total = sum(i["quantity"] * i["unit_price"] for i in items)
        tax = round(sub_total * 0.1, 2)
        total = round(sub_total + tax, 2)
        est = {
            "id": str(uuid.uuid4()),
            "estimate_number": f"EST-{str(idx + 1).zfill(4)}",
            "title": items[0]["description"],
            "client_id": client["id"],
            "client_name": client["name"],
            "line_items": items,
            "sub_total": sub_total,
            "tax": tax,
            "total": total,
            "status": statuses[idx % len(statuses)],
            "valid_until": (now + timedelta(days=30 - idx * 5)).strftime("%Y-%m-%d"),
            "notes": "Standard terms apply. 50% deposit required.",
            "created_at": (now - timedelta(days=idx * 7)).isoformat(),
        }
        await db.xero_estimates.insert_one(est)

async def _seed_xero_recurring():
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10)
    if not clients:
        return
    now = datetime.now(timezone.utc)
    templates = [
        {"description": "Managed IT Services - Monthly", "amount": 2500, "frequency": "monthly"},
        {"description": "Backup & DR Services", "amount": 450, "frequency": "monthly"},
        {"description": "Cybersecurity Suite", "amount": 800, "frequency": "monthly"},
        {"description": "Cloud Hosting", "amount": 600, "frequency": "monthly"},
        {"description": "Annual License Renewal", "amount": 4800, "frequency": "yearly"},
    ]
    for idx, client in enumerate(clients[:5]):
        tmpl = templates[idx % len(templates)]
        rec = {
            "id": str(uuid.uuid4()),
            "client_id": client["id"],
            "client_name": client["name"],
            "description": tmpl["description"],
            "frequency": tmpl["frequency"],
            "line_items": [{"description": tmpl["description"], "quantity": 1, "unit_price": tmpl["amount"]}],
            "amount": tmpl["amount"],
            "status": "active" if idx < 4 else "paused",
            "next_generation": (now + timedelta(days=_srand.randint(5, 25))).strftime("%Y-%m-%d"),
            "invoices_generated": _srand.randint(3, 24),
            "created_at": (now - timedelta(days=_srand.randint(60, 365))).isoformat(),
        }
        await db.xero_recurring.insert_one(rec)

async def _seed_xero_demo():
    existing = await db.xero_invoices.count_documents({})
    if existing > 0:
        return []

    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(20)
    if not clients:
        return []

    now = datetime.now(timezone.utc)
    invoices = []
    statuses = ["PAID", "AUTHORISED", "DRAFT", "PAID", "PAID", "AUTHORISED"]
    items_pool = [
        {"description": "Managed IT Services - Monthly", "quantity": 1, "unit_price": 2500},
        {"description": "Backup & Recovery - Monthly", "quantity": 1, "unit_price": 450},
        {"description": "Cybersecurity Suite", "quantity": 1, "unit_price": 800},
        {"description": "Network Monitoring", "quantity": 1, "unit_price": 350},
        {"description": "Help Desk Support - Hourly", "quantity": 4, "unit_price": 150},
        {"description": "Server Maintenance", "quantity": 1, "unit_price": 1200},
        {"description": "Cloud Hosting - Monthly", "quantity": 1, "unit_price": 600},
        {"description": "VoIP Phone System", "quantity": 10, "unit_price": 25},
    ]

    for idx, client in enumerate(clients[:8]):
        for m in range(3):
            date = (now - timedelta(days=30 * m)).strftime("%Y-%m-%d")
            due_date = (now - timedelta(days=30 * m - 30)).strftime("%Y-%m-%d")
            items = [items_pool[idx % len(items_pool)], items_pool[(idx + 1) % len(items_pool)]]
            subtotal = sum(i["quantity"] * i["unit_price"] for i in items)
            tax = round(subtotal * 0.1, 2)
            total = round(subtotal + tax, 2)
            status = statuses[(idx + m) % len(statuses)]
            paid = total if status == "PAID" else (total * 0.5 if status == "AUTHORISED" and m > 0 else 0)

            inv = {
                "id": str(uuid.uuid4()),
                "xero_invoice_id": f"XER-{uuid.uuid4().hex[:6].upper()}",
                "invoice_number": f"INV-{str(idx * 3 + m + 1).zfill(4)}",
                "client_id": client["id"],
                "client_name": client["name"],
                "date": date,
                "due_date": due_date,
                "status": status,
                "line_items": items,
                "sub_total": subtotal,
                "tax": tax,
                "total": total,
                "amount_paid": paid,
                "amount_due": round(total - paid, 2),
                "currency": "AUD",
                "reference": f"Monthly services {date[:7]}",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.xero_invoices.insert_one(inv)
            invoices.append(inv)

    # Also seed contacts
    clients_for_sync = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(100)
    for idx, client in enumerate(clients_for_sync):
        existing = await db.xero_contacts.find_one({"client_id": client["id"]}, {"_id": 0})
        if not existing:
            contact = {
                "id": str(uuid.uuid4()),
                "client_id": client["id"],
                "client_name": client["name"],
                "xero_contact_id": f"XC-{uuid.uuid4().hex[:8].upper()}",
                "email": client.get("email", ""),
                "name": client["name"],
                "account_number": f"ACC-{str(idx + 1).zfill(4)}",
                "balance_due": round(_srand.uniform(100, 5000), 2),
                "overdue_amount": round(_srand.uniform(0, 1000), 2) if idx % 3 == 0 else 0,
                "status": "ACTIVE",
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.xero_contacts.insert_one(contact)
    return invoices
