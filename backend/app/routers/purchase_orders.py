from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user
from app.services.activity import ticket_audit

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
    line_items = await _normalise_line_item_destinations(data.get("line_items", []))
    for li in line_items:
        li["received_qty"] = 0
        li["status"] = "pending"
        li["arrival_notified"] = False
        li.pop("arrival_notification_at", None)
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
        "ticket_id": data.get("ticket_id", ""),
        "ticket_number": data.get("ticket_number", ""),
        "ticket_title": data.get("ticket_title", ""),
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

@router.get("/purchase-orders/by-ticket/{ticket_id}")
async def get_purchase_orders_for_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    return await db.purchase_orders.find(
        {"ticket_id": ticket_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)

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
               "client_id", "client_name", "ticket_id", "ticket_number", "ticket_title", "assigned_to", "assigned_to_name"}
    update = {k: v for k, v in data.items() if k in allowed}
    if "line_items" in update:
        update["line_items"] = await _normalise_line_item_destinations(update["line_items"])
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

@router.post("/purchase-orders/{po_id}/vendor-invoice-match")
async def record_vendor_invoice_match(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Record a supplier invoice against a PO without changing the PO or billing totals."""
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")

    invoice_number = str(data.get("invoice_number", "")).strip()
    if not invoice_number:
        raise HTTPException(status_code=422, detail="Supplier invoice number is required")
    try:
        supplier_total = round(float(data.get("supplier_total")), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Supplier invoice total must be a valid amount")
    if supplier_total < 0:
        raise HTTPException(status_code=422, detail="Supplier invoice total cannot be negative")

    expected_total = round(float(po.get("total", 0) or 0), 2)
    variance = round(supplier_total - expected_total, 2)
    match = {
        "invoice_number": invoice_number,
        "invoice_date": str(data.get("invoice_date", "")).strip(),
        "supplier_total": supplier_total,
        "expected_total": expected_total,
        "variance": variance,
        "status": "matched" if abs(variance) < 0.01 else "variance",
        "notes": str(data.get("notes", "")).strip(),
        "matched_by": current_user.get("id", "system"),
        "matched_by_name": current_user.get("name", "System"),
        "matched_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "vendor_invoice_match": match,
        "updated_at": match["matched_at"],
    }})
    outcome = "matched" if match["status"] == "matched" else f"has a ${abs(variance):.2f} {'over' if variance > 0 else 'under'} variance"
    await _log_po_audit(po_id, "vendor_invoice_matched", f"Supplier invoice {invoice_number} recorded and {outcome} against PO total ${expected_total:.2f}", current_user)
    return {"message": "Supplier invoice match recorded", "vendor_invoice_match": match}

@router.post("/purchase-orders/{po_id}/vendor-invoice-match/review")
async def review_vendor_invoice_match(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    match = po.get("vendor_invoice_match")
    if not match:
        raise HTTPException(status_code=400, detail="Record a supplier invoice before reviewing it")
    if match.get("status") != "variance":
        raise HTTPException(status_code=400, detail="Only supplier invoice variances need review")

    decision = str(data.get("decision", "")).strip().lower()
    if decision not in {"accepted", "follow_up"}:
        raise HTTPException(status_code=422, detail="Choose whether the variance is accepted or needs follow-up")
    notes = str(data.get("notes", "")).strip()
    review = {
        "status": decision,
        "notes": notes,
        "reviewed_by": current_user.get("id", "system"),
        "reviewed_by_name": current_user.get("name", "System"),
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    match["review"] = review
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "vendor_invoice_match": match,
        "updated_at": review["reviewed_at"],
    }})
    action = "accepted" if decision == "accepted" else "marked for supplier follow-up"
    await _log_po_audit(po_id, "vendor_invoice_variance_reviewed", f"Supplier invoice {match.get('invoice_number', '')} variance {action}", current_user)
    assignee_id = po.get("assigned_to")
    if decision == "follow_up" and assignee_id and assignee_id != current_user.get("id"):
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": assignee_id,
            "title": f"Supplier follow-up: {po.get('po_number', 'Purchase order')}",
            "message": f"Supplier invoice {match.get('invoice_number', '')} has a ${abs(float(match.get('variance', 0) or 0)):.2f} variance and needs follow-up.",
            "severity": "warning",
            "type": "supplier_invoice_follow_up",
            "ref_type": "purchase_order",
            "ref_id": po_id,
            "read": False,
            "created_at": review["reviewed_at"],
        })
    return {"message": "Supplier invoice variance review saved", "vendor_invoice_match": match}

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
    notification_deliveries = []
    now_iso = datetime.now(timezone.utc).isoformat()
    total_all_received = True
    for ri in received_items:
        pid = ri.get("product_id", "")
        try:
            recv_qty = int(ri.get("quantity", 0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Received quantity must be a whole number")
        if recv_qty < 1:
            raise HTTPException(status_code=422, detail="Received quantity must be at least 1")
        line_index = ri.get("line_index")
        if isinstance(line_index, str) and line_index.isdigit():
            line_index = int(line_index)
        if isinstance(line_index, int) and 0 <= line_index < len(line_items):
            li = line_items[line_index]
            if pid and li.get("product_id") and pid != li.get("product_id"):
                raise HTTPException(status_code=422, detail="Received item does not match this purchase order line")
        else:
            # Backwards-compatible matching for older clients. Prefer an open line so
            # duplicate products on one PO can still be received correctly.
            li = next((item for item in line_items if (
                (pid and item.get("product_id") == pid)
                or (not pid and item.get("product_name") == ri.get("product_name"))
            ) and int(item.get("received_qty", 0)) < int(item.get("quantity", 0))), None)
            if not li:
                raise HTTPException(status_code=422, detail="Received item is not on this purchase order")
            line_index = line_items.index(li)
        prev_received = int(li.get("received_qty", 0))
        ordered_qty = int(li.get("quantity", 0))
        remaining_qty = max(0, ordered_qty - prev_received)
        if recv_qty > remaining_qty:
            raise HTTPException(status_code=422, detail=f"Cannot receive {recv_qty}: only {remaining_qty} remaining for this line")
        li["received_qty"] = prev_received + recv_qty
        li["status"] = "received" if li["received_qty"] >= ordered_qty else "partial"
        if li["received_qty"] < ordered_qty:
            total_all_received = False

        # A ticket-owned line is only announced once its full quantity has arrived.
        # This prevents a technician being sent an "arrived" alert for a partial
        # shipment while retaining the receipt history on the PO line itself.
        if (
            li.get("status") == "received"
            and li.get("destination_type") == "ticket"
            and not li.get("arrival_notified")
        ):
            ticket = await db.tickets.find_one({"id": li.get("destination_ticket_id")}, {"_id": 0})
            recipient_id = (ticket or {}).get("assigned_to") or li.get("destination_technician_id") or po.get("assigned_to") or "all"
            recipient_name = (ticket or {}).get("assigned_name") or li.get("destination_technician_name") or po.get("assigned_to_name") or "the service team"
            ticket_number = (ticket or {}).get("ticket_number") or li.get("destination_ticket_number") or "Linked ticket"
            ticket_title = (ticket or {}).get("title") or li.get("destination_ticket_title") or ""
            notification_type = "po_ticket_line_received"
            already_sent = await db.notifications.find_one({
                "type": notification_type,
                "ref_id": po_id,
                "line_index": line_index,
            }, {"_id": 0, "id": 1})
            if not already_sent:
                await db.notifications.insert_one({
                    "id": str(uuid.uuid4()),
                    "user_id": recipient_id,
                    "title": f"Parts received for {ticket_number}",
                    "message": f"{li.get('product_name') or 'A purchase order item'} x{ordered_qty} from {po.get('po_number', 'this PO')} is now ready for {ticket_number}{f': {ticket_title}' if ticket_title else ''}.",
                    "severity": "success",
                    "type": notification_type,
                    "ref_type": "purchase_order",
                    "ref_id": po_id,
                    "ticket_id": li.get("destination_ticket_id"),
                    "ticket_number": ticket_number,
                    "line_index": line_index,
                    "read": False,
                    "created_at": now_iso,
                })
            li["arrival_notified"] = True
            li["arrival_notification_at"] = now_iso
            li["arrival_notification_recipient_id"] = recipient_id
            note_exists = await db.ticket_comments.find_one({
                "ticket_id": li.get("destination_ticket_id"),
                "source": "purchase_order_receipt",
                "po_id": po_id,
                "line_index": line_index,
            }, {"_id": 0, "id": 1})
            if not note_exists:
                await db.ticket_comments.insert_one({
                    "id": str(uuid.uuid4()),
                    "ticket_id": li.get("destination_ticket_id"),
                    "user_id": current_user.get("id", "system"),
                    "user_name": current_user.get("name", "System"),
                    "content": f"Parts received: {li.get('product_name') or 'Purchase order item'} x{ordered_qty} was receipted from {po.get('po_number', 'this purchase order')} and is ready for this ticket.",
                    "is_internal": True,
                    "source": "purchase_order_receipt",
                    "po_id": po_id,
                    "po_number": po.get("po_number", ""),
                    "line_index": line_index,
                    "received_quantity": ordered_qty,
                    "created_at": now_iso,
                })
            notification_deliveries.append({
                "ticket_id": li.get("destination_ticket_id"),
                "ticket_number": ticket_number,
                "recipient_name": recipient_name,
                "product_name": li.get("product_name") or "Item",
            })

        product = await db.products.find_one({"id": pid}, {"_id": 0})
        if product:
            stock_controlled_categories = {"hardware", "accessories", "networking", "security"}
            tracks_stock = product.get("track_inventory")
            if tracks_stock is None:
                tracks_stock = str(product.get("category", "")).lower() in stock_controlled_categories
            if tracks_stock:
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
                    "reason": f"Received from PO {po['po_number']}" + (f" for {li.get('destination_ticket_number') or 'linked ticket'}" if li.get("destination_type") == "ticket" else ""),
                    "reference": po_id, "po_id": po_id,
                    "destination_type": li.get("destination_type", "stock"),
                    "destination_ticket_id": li.get("destination_ticket_id", ""),
                    "destination_ticket_number": li.get("destination_ticket_number", ""),
                    "created_by": current_user["id"],
                    "created_by_name": current_user.get("name", ""),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.stock_movements.insert_one(movement)
    for li in line_items:
        if li.get("received_qty", 0) < li.get("quantity", 0):
            total_all_received = False
            break
    new_status = "received" if total_all_received else "partial"
    await db.purchase_orders.update_one({"id": po_id}, {"$set": {
        "line_items": line_items, "status": new_status,
        "updated_at": now_iso,
    }})
    recv_summary = ", ".join(f"{ri.get('product_name', ri.get('product_id', '?'))} x{ri.get('quantity', 0)}" for ri in received_items if ri.get("quantity", 0) > 0)
    await _log_po_audit(po_id, "stock_received", f"Stock received: {recv_summary}. PO status: {new_status}", current_user)
    for delivery in notification_deliveries:
        await _log_po_audit(
            po_id,
            "ticket_parts_notified",
            f"{delivery['product_name']} arrived for {delivery['ticket_number']}; notification sent to {delivery['recipient_name']}",
            current_user,
        )
        if delivery["ticket_id"]:
            await ticket_audit(
                delivery["ticket_id"],
                current_user,
                "parts_received",
                f"{delivery['product_name']} arrived on {po.get('po_number', 'a purchase order')}; the linked technician was notified.",
            )
    notification_message = f" {len(notification_deliveries)} ticket technician{'s' if len(notification_deliveries) != 1 else ''} notified." if notification_deliveries else ""
    return {
        "message": f"Stock received. PO status: {new_status}.{notification_message}",
        "status": new_status,
        "ticket_notifications": notification_deliveries,
    }

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


async def _normalise_line_item_destinations(line_items: list[dict]) -> list[dict]:
    """Validate and enrich each fulfilment destination before persisting a PO."""
    normalised = []
    for raw_line in line_items or []:
        line = dict(raw_line)
        destination_type = str(line.get("destination_type") or ("ticket" if line.get("destination_ticket_id") else "stock")).lower()
        if destination_type not in {"stock", "ticket"}:
            raise HTTPException(status_code=422, detail="Line item destination must be Stock or Ticket")

        if destination_type == "ticket":
            ticket_id = str(line.get("destination_ticket_id") or "").strip()
            if not ticket_id:
                raise HTTPException(status_code=422, detail="Choose a ticket for each ticket-linked line item")
            ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
            if not ticket:
                raise HTTPException(status_code=422, detail="The selected ticket for a line item could not be found")
            line.update({
                "destination_type": "ticket",
                "destination_ticket_id": ticket_id,
                "destination_ticket_number": ticket.get("ticket_number", ""),
                "destination_ticket_title": ticket.get("title", ""),
                "destination_technician_id": ticket.get("assigned_to", ""),
                "destination_technician_name": ticket.get("assigned_name", ""),
            })
        else:
            line.update({
                "destination_type": "stock",
                "destination_ticket_id": "",
                "destination_ticket_number": "",
                "destination_ticket_title": "",
                "destination_technician_id": "",
                "destination_technician_name": "",
            })
        normalised.append(line)
    return normalised
