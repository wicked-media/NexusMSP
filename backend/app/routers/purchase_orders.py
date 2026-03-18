from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== PURCHASE ORDER ENDPOINTS ==============

@router.get("/purchase-orders/stats")
async def get_po_stats(current_user: dict = Depends(get_current_user)):
    all_pos = await db.purchase_orders.find({}, {"_id": 0}).to_list(10000)
    total = len(all_pos)
    draft = len([p for p in all_pos if p.get("status") == "draft"])
    submitted = len([p for p in all_pos if p.get("status") == "submitted"])
    partial = len([p for p in all_pos if p.get("status") == "partial"])
    received = len([p for p in all_pos if p.get("status") == "received"])
    overdue_count = 0
    now = datetime.now(timezone.utc)
    for p in all_pos:
        if p.get("status") in ("submitted", "partial") and p.get("expected_delivery"):
            try:
                exp = datetime.fromisoformat(p["expected_delivery"].replace("Z", "+00:00")) if "T" in p["expected_delivery"] else datetime.strptime(p["expected_delivery"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if exp < now:
                    overdue_count += 1
            except Exception:
                pass
    total_value = sum(p.get("total", 0) for p in all_pos)
    pending_value = sum(p.get("total", 0) for p in all_pos if p.get("status") in ("draft", "submitted", "partial"))
    return {
        "total": total, "draft": draft, "submitted": submitted, "partial": partial,
        "received": received, "overdue": overdue_count,
        "total_value": round(total_value, 2), "pending_value": round(pending_value, 2)
    }

@router.get("/purchase-orders")
async def get_purchase_orders(status: Optional[str] = None, search: Optional[str] = None, vendor_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status
    if vendor_id:
        query["vendor_id"] = vendor_id
    if search:
        query["$or"] = [
            {"po_number": {"$regex": search, "$options": "i"}},
            {"vendor": {"$regex": search, "$options": "i"}},
        ]
    pos = await db.purchase_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return pos

@router.post("/purchase-orders")
async def create_purchase_order(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.purchase_orders.count_documents({})
    line_items = data.get("line_items", [])
    for li in line_items:
        li["received_qty"] = 0
        li["status"] = "pending"
    po = {
        "id": str(uuid.uuid4()),
        "po_number": f"PO-{count + 1001:04d}",
        "vendor": data.get("vendor", ""),
        "vendor_id": data.get("vendor_id", ""),
        "vendor_contact": data.get("vendor_contact", ""),
        "vendor_email": data.get("vendor_email", ""),
        "status": data.get("status", "draft"),
        "line_items": line_items,
        "subtotal": float(data.get("subtotal", 0)),
        "tax": float(data.get("tax", 0)),
        "shipping": float(data.get("shipping", 0)),
        "total": float(data.get("total", 0)),
        "notes": data.get("notes", ""),
        "ship_to": data.get("ship_to", ""),
        "expected_delivery": data.get("expected_delivery", ""),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "assigned_to": data.get("assigned_to", ""),
        "assigned_to_name": data.get("assigned_to_name", ""),
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "last_ping_at": None,
        "escalated": False,
        "escalated_at": None,
    }
    await db.purchase_orders.insert_one(po)
    po.pop("_id", None)
    await _log_po_audit(po["id"], "created", f"Purchase order {po['po_number']} created", current_user)
    return po

@router.get("/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@router.put("/purchase-orders/{po_id}")
async def update_purchase_order(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"vendor", "vendor_id", "vendor_contact", "vendor_email", "status", "line_items",
               "subtotal", "tax", "shipping", "total", "notes", "ship_to", "expected_delivery",
               "client_id", "client_name", "assigned_to", "assigned_to_name"}
    update = {k: v for k, v in data.items() if k in allowed}
    for f in ("subtotal", "tax", "shipping", "total"):
        if f in update:
            update[f] = float(update[f])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    old_po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    await db.purchase_orders.update_one({"id": po_id}, {"$set": update})
    if "status" in update and old_po and old_po.get("status") != update["status"]:
        await _log_po_audit(po_id, "status_changed", f"Status changed from '{old_po.get('status')}' to '{update['status']}'", current_user)
    else:
        await _log_po_audit(po_id, "updated", "Purchase order updated", current_user)
    return {"message": "Purchase order updated"}

@router.delete("/purchase-orders/{po_id}")
async def delete_purchase_order(po_id: str, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    await db.purchase_orders.delete_one({"id": po_id})
    await db.po_audit_log.delete_many({"po_id": po_id})
    if po:
        await _log_po_audit(po_id, "deleted", f"Purchase order {po.get('po_number', po_id)} deleted", current_user)
    return {"message": "Purchase order deleted"}

# ============== STOCK RECEIVING ==============

@router.post("/purchase-orders/{po_id}/receive")
async def receive_po_items(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if po["status"] not in ("submitted", "partial"):
        raise HTTPException(status_code=400, detail="Only submitted or partial POs can receive stock")
    received_items = data.get("items", [])
    line_items = po.get("line_items", [])
    li_map = {}
    for li in line_items:
        key = li.get("product_id") or li.get("product_name", "")
        li_map[key] = li
    total_all_received = True
    for ri in received_items:
        pid = ri.get("product_id")
        recv_qty = int(ri.get("quantity", 0))
        if recv_qty <= 0:
            continue
        if pid in li_map:
            li = li_map[pid]
            prev_received = li.get("received_qty", 0)
            new_received = prev_received + recv_qty
            ordered_qty = li.get("quantity", 0)
            li["received_qty"] = min(new_received, ordered_qty)
            li["status"] = "received" if li["received_qty"] >= ordered_qty else "partial"
            if li["received_qty"] < ordered_qty:
                total_all_received = False
            product = await db.products.find_one({"id": pid}, {"_id": 0})
            if product:
                old_stock = product.get("quantity_in_stock", 0)
                new_stock = old_stock + recv_qty
                await db.products.update_one({"id": pid}, {"$set": {
                    "quantity_in_stock": new_stock,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }})
                movement = {
                    "id": str(uuid.uuid4()), "product_id": pid,
                    "product_name": product.get("name", ""), "type": "in",
                    "quantity": recv_qty, "previous_stock": old_stock, "new_stock": new_stock,
                    "reason": f"Received from PO {po['po_number']}",
                    "reference": po_id, "po_id": po_id,
                    "created_by": current_user["id"],
                    "created_by_name": current_user.get("name", ""),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.stock_movements.insert_one(movement)
        else:
            total_all_received = False
    for li in line_items:
        if li.get("received_qty", 0) < li.get("quantity", 0):
            total_all_received = False
            break
    new_status = "received" if total_all_received else "partial"
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "line_items": line_items, "status": new_status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    recv_summary = ", ".join(f"{ri.get('product_name', ri.get('product_id', '?'))} x{ri.get('quantity', 0)}" for ri in received_items if ri.get("quantity", 0) > 0)
    await _log_po_audit(po_id, "stock_received", f"Stock received: {recv_summary}. PO status: {new_status}", current_user)
    return {"message": f"Stock received. PO status: {new_status}", "status": new_status}

# ============== PO AUDIT LOG ==============

@router.get("/purchase-orders/{po_id}/audit-log")
async def get_po_audit_log(po_id: str, current_user: dict = Depends(get_current_user)):
    logs = await db.po_audit_log.find({"po_id": po_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs

# ============== PO PING & ESCALATION ==============

@router.get("/settings/po-ping")
async def get_po_ping_settings(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "po_ping"}, {"_id": 0})
    return settings or {
        "type": "po_ping",
        "enabled": True,
        "tech_ping_hours": 48,
        "escalation_hours": 72,
        "ping_on_overdue": True,
        "auto_escalate": True,
        "escalation_contacts": [],
        "updated_at": None,
    }

@router.put("/settings/po-ping")
async def update_po_ping_settings(data: dict, current_user: dict = Depends(get_current_user)):
    data["type"] = "po_ping"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "po_ping"}, {"$set": data}, upsert=True)
    return {"message": "PO ping settings updated"}

@router.post("/purchase-orders/check-escalations")
async def check_po_escalations(current_user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"type": "po_ping"}, {"_id": 0})
    if not settings or not settings.get("enabled", True):
        return {"message": "PO ping disabled", "pings_sent": 0, "escalations": 0}
    tech_hours = settings.get("tech_ping_hours", 48)
    escalation_hours = settings.get("escalation_hours", 72)
    now = datetime.now(timezone.utc)
    open_pos = await db.purchase_orders.find({"status": {"$in": ["submitted", "partial"]}}, {"_id": 0}).to_list(5000)
    pings_sent = 0
    escalations = 0
    for po in open_pos:
        created = datetime.fromisoformat(po["created_at"].replace("Z", "+00:00")) if po.get("created_at") else now
        hours_open = (now - created).total_seconds() / 3600
        last_ping = po.get("last_ping_at")
        should_ping = False
        if last_ping:
            last_ping_dt = datetime.fromisoformat(last_ping.replace("Z", "+00:00"))
            if (now - last_ping_dt).total_seconds() / 3600 >= 24:
                should_ping = True
        elif hours_open >= tech_hours:
            should_ping = True
        if should_ping and hours_open >= tech_hours:
            assignee = po.get("assigned_to") or po.get("created_by")
            if assignee:
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()), "user_id": assignee,
                    "title": f"PO {po['po_number']} needs attention",
                    "message": f"Purchase order {po['po_number']} for {po.get('vendor', 'unknown vendor')} has been open for {int(hours_open)}h. Please receive or update stock.",
                    "severity": "warning", "type": "po_ping",
                    "ref_type": "purchase_order", "ref_id": po["id"],
                    "read": False, "created_at": now.isoformat(),
                })
                pings_sent += 1
            await db.purchase_orders.update_one({"id": po["id"]}, {"$set": {"last_ping_at": now.isoformat()}})
        if settings.get("auto_escalate") and hours_open >= escalation_hours and not po.get("escalated"):
            contacts = settings.get("escalation_contacts", [])
            admins = await db.users.find({"$or": [{"role": "admin"}, {"is_admin": True}]}, {"_id": 0, "id": 1}).to_list(50)
            escalate_to = contacts + [a["id"] for a in admins]
            for uid in set(escalate_to):
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()), "user_id": uid,
                    "title": f"ESCALATION: PO {po['po_number']} overdue",
                    "message": f"PO {po['po_number']} ({po.get('vendor', '')}) has been open {int(hours_open)}h without full receipt. Assigned to: {po.get('assigned_to_name', 'Unassigned')}.",
                    "severity": "critical", "type": "po_escalation",
                    "ref_type": "purchase_order", "ref_id": po["id"],
                    "read": False, "created_at": now.isoformat(),
                })
            await db.purchase_orders.update_one({"id": po["id"]}, {"$set": {"escalated": True, "escalated_at": now.isoformat()}})
            escalations += 1
            await _log_po_audit(po["id"], "escalated", f"PO escalated to management after {int(hours_open)}h open", {"id": "system", "name": "System"})
    return {"message": "Escalation check complete", "pings_sent": pings_sent, "escalations": escalations}

@router.get("/purchase-orders/overdue/list")
async def get_overdue_pos(current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    open_pos = await db.purchase_orders.find({"status": {"$in": ["submitted", "partial"]}}, {"_id": 0}).to_list(5000)
    overdue = []
    for po in open_pos:
        if po.get("expected_delivery"):
            try:
                exp = datetime.fromisoformat(po["expected_delivery"].replace("Z", "+00:00")) if "T" in po["expected_delivery"] else datetime.strptime(po["expected_delivery"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
                if exp < now:
                    po["days_overdue"] = (now - exp).days
                    overdue.append(po)
            except Exception:
                pass
    overdue.sort(key=lambda x: x.get("days_overdue", 0), reverse=True)
    return overdue

# ============== HELPERS ==============

async def _log_po_audit(po_id: str, action: str, details: str, user: dict):
    log = {
        "id": str(uuid.uuid4()), "po_id": po_id, "action": action,
        "details": details, "user_id": user.get("id", "system"),
        "user_name": user.get("name", "System"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.po_audit_log.insert_one(log)
