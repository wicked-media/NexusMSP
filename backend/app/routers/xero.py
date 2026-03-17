from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
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
    """Get contacts synced or mocked from Xero"""
    contacts = await db.xero_contacts.find({}, {"_id": 0}).to_list(500)
    if not contacts:
        # Return mock data for demo
        contacts = await _seed_xero_demo()
    return contacts

@router.post("/xero/contacts/sync")
async def sync_xero_contacts(current_user: dict = Depends(get_current_user)):
    """Sync contacts from Xero (mock for now)"""
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
                "balance_due": round(abs(hash(client["name"]) % 5000) + 100, 2),
                "overdue_amount": round(abs(hash(client["name"]) % 1000), 2) if synced % 3 == 0 else 0,
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
        "line_items": data.get("line_items", []),
        "sub_total": data.get("sub_total", 0),
        "tax": data.get("tax", 0),
        "total": data.get("total", 0),
        "amount_paid": 0,
        "amount_due": data.get("total", 0),
        "currency": data.get("currency", "AUD"),
        "reference": data.get("reference", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.xero_invoices.insert_one(invoice)
    invoice.pop("_id", None)
    return invoice

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
    return {"message": "Payment recorded", "amount_paid": new_paid, "amount_due": new_due, "status": new_status}

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
    overdue = [i for i in invoices if i.get("status") == "AUTHORISED" and i.get("due_date", "") < datetime.now(timezone.utc).strftime("%Y-%m-%d")]
    total_overdue = sum(i.get("amount_due", 0) for i in overdue)
    
    by_status = {}
    for i in invoices:
        s = i.get("status", "DRAFT")
        if s not in by_status:
            by_status[s] = {"count": 0, "total": 0}
        by_status[s]["count"] += 1
        by_status[s]["total"] += i.get("total", 0)
    
    # Monthly revenue for chart
    monthly = {}
    for i in invoices:
        if i.get("status") in ["PAID", "AUTHORISED"]:
            month = i.get("date", "")[:7]
            if month:
                monthly[month] = monthly.get(month, 0) + i.get("total", 0)
    monthly_data = [{"month": k, "revenue": v} for k, v in sorted(monthly.items())[-12:]
    ]
    
    return {
        "total_revenue": round(total_revenue, 2),
        "total_paid": round(total_paid, 2),
        "total_outstanding": round(total_outstanding, 2),
        "total_overdue": round(total_overdue, 2),
        "overdue_count": len(overdue),
        "invoice_count": len(invoices),
        "by_status": by_status,
        "monthly_revenue": monthly_data,
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
        ]
        for a in defaults:
            await db.xero_accounts.insert_one(a)
        accounts = defaults
    for a in accounts:
        a.pop("_id", None)
    return accounts

# ============== SEED DEMO DATA ==============

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
    
    # Also seed contacts by syncing clients
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
                "balance_due": round(abs(hash(client["name"]) % 5000) + 100, 2),
                "overdue_amount": round(abs(hash(client["name"]) % 1000), 2) if idx % 3 == 0 else 0,
                "status": "ACTIVE",
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.xero_contacts.insert_one(contact)
    return invoices
