from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== ESTIMATES ==============

@router.get("/estimates")
async def get_estimates(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status
    estimates = await db.estimates.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return estimates

@router.get("/estimates/stats/summary")
async def get_estimate_stats(current_user: dict = Depends(get_current_user)):
    ests = await db.estimates.find({}, {"_id": 0}).to_list(10000)
    by_status = {}
    for e in ests:
        s = e.get("status", "draft")
        by_status[s] = by_status.get(s, 0) + 1
    total_value = sum(e.get("total", 0) for e in ests)
    approved_value = sum(e.get("total", 0) for e in ests if e.get("status") == "approved")
    return {
        "total": len(ests), "by_status": by_status,
        "total_value": round(total_value, 2),
        "approved_value": round(approved_value, 2),
    }

@router.get("/estimates/client/{client_id}")
async def get_client_estimates(client_id: str):
    ests = await db.estimates.find({
        "client_id": client_id,
        "status": {"$in": ["published", "sent", "approved", "declined"]}
    }, {"_id": 0}).sort("created_at", -1).to_list(100)
    return ests

@router.post("/estimates")
async def create_estimate(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.estimates.count_documents({})
    line_items = data.get("line_items", [])
    subtotal = sum(float(li.get("quantity", 1)) * float(li.get("unit_price", 0)) for li in line_items)
    tax_rate = float(data.get("tax_rate", 0))
    tax_amount = subtotal * tax_rate / 100
    estimate = {
        "id": str(uuid.uuid4()),
        "estimate_number": f"EST-{count + 1001:04d}",
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "client_email": data.get("client_email", ""),
        "ticket_id": data.get("ticket_id", ""),
        "title": data.get("title", ""),
        "description": data.get("description", ""),
        "line_items": line_items,
        "subtotal": round(subtotal, 2),
        "tax_rate": tax_rate,
        "tax_amount": round(tax_amount, 2),
        "total": round(subtotal + tax_amount, 2),
        "discount": float(data.get("discount", 0)),
        "status": "draft",
        "valid_until": data.get("valid_until", ""),
        "notes": data.get("notes", ""),
        "terms": data.get("terms", ""),
        "sent_at": None,
        "published_at": None,
        "approved_at": None,
        "declined_at": None,
        "declined_reason": None,
        "converted_to_invoice": None,
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.estimates.insert_one(estimate)
    estimate.pop("_id", None)
    await _log_estimate_audit(estimate["id"], "created", f"Estimate {estimate['estimate_number']} created as draft", current_user)
    return estimate

@router.get("/estimates/{estimate_id}")
async def get_estimate(estimate_id: str, current_user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return est

@router.put("/estimates/{estimate_id}")
async def update_estimate(estimate_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"title", "description", "line_items", "subtotal", "tax_rate", "tax_amount",
               "total", "discount", "valid_until", "notes", "terms", "client_id", "client_name",
               "client_email", "ticket_id"}
    update = {k: v for k, v in data.items() if k in allowed}
    if "line_items" in update:
        li = update["line_items"]
        sub = sum(float(i.get("quantity", 1)) * float(i.get("unit_price", 0)) for i in li)
        tr = float(update.get("tax_rate", data.get("tax_rate", 0)))
        ta = sub * tr / 100
        update["subtotal"] = round(sub, 2)
        update["tax_amount"] = round(ta, 2)
        update["total"] = round(sub + ta - float(update.get("discount", 0)), 2)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.estimates.update_one({"id": estimate_id}, {"$set": update})
    await _log_estimate_audit(estimate_id, "updated", "Estimate updated", current_user)
    return {"message": "Estimate updated"}

@router.put("/estimates/{estimate_id}/status")
async def update_estimate_status(estimate_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    new_status = data.get("status")
    valid = {"draft", "published", "sent", "approved", "declined", "expired", "converted"}
    if new_status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")
    update = {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if new_status == "published":
        update["published_at"] = datetime.now(timezone.utc).isoformat()
    elif new_status == "sent":
        update["sent_at"] = datetime.now(timezone.utc).isoformat()
    elif new_status == "approved":
        update["approved_at"] = datetime.now(timezone.utc).isoformat()
    elif new_status == "declined":
        update["declined_at"] = datetime.now(timezone.utc).isoformat()
        update["declined_reason"] = data.get("reason", "")
    await db.estimates.update_one({"id": estimate_id}, {"$set": update})
    await _log_estimate_audit(estimate_id, f"status_{new_status}", f"Status changed to {new_status}", current_user)
    return {"message": f"Estimate status: {new_status}"}

@router.post("/estimates/{estimate_id}/convert-to-invoice")
async def convert_estimate_to_invoice(estimate_id: str, current_user: dict = Depends(get_current_user)):
    est = await db.estimates.find_one({"id": estimate_id}, {"_id": 0})
    if not est:
        raise HTTPException(status_code=404, detail="Estimate not found")
    inv_count = await db.invoices.count_documents({})
    invoice = {
        "id": str(uuid.uuid4()),
        "invoice_number": f"INV-{inv_count + 1001:04d}",
        "client_id": est.get("client_id", ""),
        "client_name": est.get("client_name", ""),
        "status": "draft",
        "payment_status": "unpaid",
        "line_items": est.get("line_items", []),
        "subtotal": est.get("subtotal", 0),
        "tax_rate": est.get("tax_rate", 0),
        "tax_amount": est.get("tax_amount", 0),
        "total": est.get("total", 0),
        "amount_paid": 0,
        "due_date": "",
        "notes": f"Converted from estimate {est['estimate_number']}",
        "from_estimate": estimate_id,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.invoices.insert_one(invoice)
    await db.estimates.update_one({"id": estimate_id}, {"$set": {
        "status": "converted", "converted_to_invoice": invoice["id"],
        "updated_at": datetime.now(timezone.utc).isoformat()
    }})
    await _log_estimate_audit(estimate_id, "converted", f"Converted to invoice {invoice['invoice_number']}", current_user)
    return {"message": f"Converted to {invoice['invoice_number']}", "invoice_id": invoice["id"]}

@router.delete("/estimates/{estimate_id}")
async def delete_estimate(estimate_id: str, current_user: dict = Depends(get_current_user)):
    await db.estimates.delete_one({"id": estimate_id})
    await db.estimate_audit.delete_many({"estimate_id": estimate_id})
    return {"message": "Estimate deleted"}

@router.get("/estimates/{estimate_id}/audit-log")
async def get_estimate_audit(estimate_id: str, current_user: dict = Depends(get_current_user)):
    logs = await db.estimate_audit.find({"estimate_id": estimate_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs

async def _log_estimate_audit(estimate_id: str, action: str, details: str, user: dict):
    await db.estimate_audit.insert_one({
        "id": str(uuid.uuid4()), "estimate_id": estimate_id, "action": action,
        "details": details, "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

# ============== TICKET WORKSHEETS ==============

@router.get("/tickets/{ticket_id}/worksheet")
async def get_ticket_worksheet(ticket_id: str, current_user: dict = Depends(get_current_user)):
    ws = await db.ticket_worksheets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not ws:
        return []
    return ws.get("items", [])

@router.post("/tickets/{ticket_id}/worksheet")
async def add_worksheet_item(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    item_text = data.get("item", "").strip()
    if not item_text:
        raise HTTPException(status_code=400, detail="Item text required")
    ws = await db.ticket_worksheets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    items = ws.get("items", []) if ws else []
    new_item = {
        "id": str(uuid.uuid4())[:8],
        "item": item_text,
        "checked": False,
        "checked_by": None,
        "checked_by_name": None,
        "checked_at": None,
        "added_by": current_user.get("name", ""),
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    items.append(new_item)
    completed = sum(1 for i in items if i.get("checked"))
    await db.ticket_worksheets.update_one(
        {"ticket_id": ticket_id},
        {"$set": {"ticket_id": ticket_id, "items": items, "completed": completed, "total": len(items),
                  "updated_by": current_user.get("name", ""), "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return new_item

@router.put("/tickets/{ticket_id}/worksheet")
async def update_ticket_worksheet(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    items = data.get("items", [])
    completed = sum(1 for i in items if i.get("checked"))
    ws = {
        "ticket_id": ticket_id, "items": items,
        "completed": completed, "total": len(items),
        "updated_by": current_user.get("name", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ticket_worksheets.update_one({"ticket_id": ticket_id}, {"$set": ws}, upsert=True)
    return {"message": "Worksheet updated", "completed": completed, "total": len(items)}

@router.post("/tickets/{ticket_id}/worksheet/check")
async def check_worksheet_item(ticket_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ws = await db.ticket_worksheets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not ws:
        raise HTTPException(status_code=404, detail="Worksheet not found")
    item_id = data.get("item_id")
    checked = data.get("checked", True)
    items = ws.get("items", [])
    for i in items:
        if i.get("id") == item_id:
            i["checked"] = checked
            i["checked_by_name"] = current_user.get("name", "")
            i["checked_at"] = datetime.now(timezone.utc).isoformat()
            break
    completed = sum(1 for i in items if i.get("checked"))
    await db.ticket_worksheets.update_one({"ticket_id": ticket_id}, {"$set": {
        "items": items, "completed": completed, "total": len(items),
        "updated_by": current_user.get("name", ""), "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    return {"message": "Item updated", "completed": completed, "total": len(items)}

@router.get("/worksheet-templates")
async def get_worksheet_templates(current_user: dict = Depends(get_current_user)):
    return {
        "sla": [
            {"label": "Issue verified with customer", "checked": False},
            {"label": "Root cause identified", "checked": False},
            {"label": "Resolution applied", "checked": False},
            {"label": "Tested & verified working", "checked": False},
            {"label": "Customer notified of resolution", "checked": False},
            {"label": "Documentation updated", "checked": False},
        ],
        "workshop": [
            {"label": "Device checked in & logged", "checked": False},
            {"label": "Initial diagnosis complete", "checked": False},
            {"label": "Customer quoted / approved", "checked": False},
            {"label": "Parts sourced / ordered", "checked": False},
            {"label": "Repair completed", "checked": False},
            {"label": "Quality check passed", "checked": False},
            {"label": "Customer notified for pickup", "checked": False},
        ],
        "cabling_wisp": [
            {"label": "Site survey completed", "checked": False},
            {"label": "Cable run / antenna mounted", "checked": False},
            {"label": "Router / CPE configured", "checked": False},
            {"label": "Speed test performed", "checked": False},
            {"label": "Customer walkthrough done", "checked": False},
            {"label": "Documentation photos taken", "checked": False},
            {"label": "Service activated in billing", "checked": False},
        ],
    }
