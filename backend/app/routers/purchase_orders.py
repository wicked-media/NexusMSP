from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from typing import Optional
from datetime import datetime, timezone, timedelta
from pathlib import Path
import uuid
from app.database import db, UPLOADS_DIR
from app.auth import get_current_user
from app.services.activity import ticket_audit
from app.services.finance_integrity import (
    begin_idempotent_operation,
    complete_idempotent_operation,
    fail_idempotent_operation,
)
from app.services.procurement_integrity import get_po_approval_settings, next_po_number, version_filter
from app.services.scope_permissions import assert_client_scope, assert_global_scope, scoped_query

router = APIRouter()
PO_EVIDENCE_DIR = Path(UPLOADS_DIR) / "purchase-orders"
PO_EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)


async def _po_or_404(po_id: str, current_user: dict) -> dict:
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    await assert_client_scope(
        current_user,
        po.get("client_id"),
        operation="purchase_order.access",
        mask_not_found=True,
    )
    return po


async def _calculate_po_totals(line_items: list[dict], shipping_value=0) -> tuple[float, float, float, float]:
    subtotal = 0.0
    tax = 0.0
    for index, line in enumerate(line_items, start=1):
        try:
            quantity = int(line.get("quantity", 0))
            unit_price = float(line.get("unit_price", 0) or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"Line {index} has an invalid quantity or unit price")
        if quantity < 1 or unit_price < 0 or not str(line.get("product_name") or line.get("name") or "").strip():
            raise HTTPException(status_code=422, detail=f"Line {index} needs an item name, positive quantity, and valid unit price")
        product = None
        if line.get("product_id"):
            product = await db.products.find_one({"id": line["product_id"]}, {"_id": 0, "tax_rate": 1})
        try:
            tax_rate = float(line.get("tax_rate", (product or {}).get("tax_rate", 0)) or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"Line {index} has an invalid tax rate")
        if not 0 <= tax_rate <= 100:
            raise HTTPException(status_code=422, detail=f"Line {index} tax rate must be between 0 and 100")
        line_total = round(quantity * unit_price, 2)
        line["quantity"] = quantity
        line["unit_price"] = unit_price
        line["tax_rate"] = tax_rate
        line["total"] = line_total
        subtotal += line_total
        tax += line_total * tax_rate / 100
    try:
        shipping = round(float(shipping_value or 0), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Shipping must be a valid amount")
    if shipping < 0:
        raise HTTPException(status_code=422, detail="Shipping cannot be negative")
    subtotal = round(subtotal, 2)
    tax = round(tax, 2)
    return subtotal, tax, shipping, round(subtotal + tax + shipping, 2)


# ============== PURCHASE ORDER ENDPOINTS ==============

@router.get("/purchase-orders/stats")
async def get_po_stats(current_user: dict = Depends(get_current_user)):
    all_pos = await db.purchase_orders.find(
        scoped_query(current_user, {}, site_field=None), {"_id": 0}
    ).to_list(10000)
    total = len(all_pos)
    draft = len([p for p in all_pos if p.get("status") == "draft"])
    pending_approval = len([p for p in all_pos if p.get("status") == "pending_approval"])
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
    pending_value = sum(p.get("total", 0) for p in all_pos if p.get("status") in ("draft", "pending_approval", "approved", "submitted", "partial"))
    return {
        "total": total, "draft": draft, "pending_approval": pending_approval, "submitted": submitted, "partial": partial,
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
    pos = await db.purchase_orders.find(
        scoped_query(current_user, query, site_field=None), {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    return pos

@router.post("/purchase-orders")
async def create_purchase_order(data: dict, current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    if client_id:
        await assert_client_scope(current_user, client_id, operation="purchase_order.create")
    else:
        await assert_global_scope(current_user, operation="purchase_order.create.global")
    vendor = str(data.get("vendor", "") or "").strip()
    if not vendor:
        raise HTTPException(status_code=422, detail="Vendor is required")
    line_items = await _normalise_line_item_destinations(data.get("line_items", []), current_user)
    if not line_items:
        raise HTTPException(status_code=422, detail="At least one purchase-order line is required")
    if data.get("ticket_id"):
        await _ticket_or_422(str(data["ticket_id"]), current_user)
    for li in line_items:
        li["received_qty"] = 0
        li["returned_qty"] = 0
        li["status"] = "pending"
        li["arrival_notified"] = False
        li["received_serials"] = []
        li["receipt_batches"] = []
        li.pop("arrival_notification_at", None)
    subtotal, tax, shipping, total = await _calculate_po_totals(line_items, data.get("shipping", 0))
    policy = await get_po_approval_settings(db)
    po = {
        "id": str(uuid.uuid4()),
        "po_number": await next_po_number(db),
        "vendor": vendor,
        "vendor_id": data.get("vendor_id", ""),
        "vendor_contact": data.get("vendor_contact", ""),
        "vendor_email": data.get("vendor_email", ""),
        "status": "draft",
        "line_items": line_items,
        "subtotal": subtotal,
        "tax": tax,
        "shipping": shipping,
        "total": total,
        "approval_required": bool(policy.get("enabled", True)) and total >= float(policy.get("threshold", 0) or 0),
        "notes": data.get("notes", ""),
        "ship_to": data.get("ship_to", ""),
        "expected_delivery": data.get("expected_delivery", ""),
        "client_id": client_id,
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
        "version": 1,
    }
    await db.purchase_orders.insert_one(po)
    po.pop("_id", None)
    await _log_po_audit(po["id"], "created", f"Purchase order {po['po_number']} created", current_user)
    return po

@router.get("/purchase-orders/by-ticket/{ticket_id}")
async def get_purchase_orders_for_ticket(ticket_id: str, current_user: dict = Depends(get_current_user)):
    return await db.purchase_orders.find(
        scoped_query(current_user, {"ticket_id": ticket_id}, site_field=None), {"_id": 0}
    ).sort("created_at", -1).to_list(200)

@router.get("/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str, current_user: dict = Depends(get_current_user)):
    return await _po_or_404(po_id, current_user)

@router.put("/purchase-orders/{po_id}")
async def update_purchase_order(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    old_po = await _po_or_404(po_id, current_user)
    allowed = {"vendor", "vendor_id", "vendor_contact", "vendor_email", "status", "line_items",
               "subtotal", "tax", "shipping", "total", "notes", "ship_to", "expected_delivery",
               "client_id", "client_name", "ticket_id", "ticket_number", "ticket_title", "assigned_to", "assigned_to_name"}
    update = {k: v for k, v in data.items() if k in allowed}
    if "client_id" in update:
        updated_client_id = str(update["client_id"] or "").strip()
        if updated_client_id:
            await assert_client_scope(
                current_user,
                updated_client_id,
                operation="purchase_order.update.client",
            )
        else:
            await assert_global_scope(current_user, operation="purchase_order.update.global")
    financial_fields = {"line_items", "subtotal", "tax", "shipping", "total", "vendor", "vendor_id", "client_id", "ticket_id"}
    if old_po.get("status") not in {"draft", "rejected"} and financial_fields.intersection(update):
        raise HTTPException(status_code=409, detail="Ordered purchase orders are financially locked; duplicate or cancel the order to correct it")
    if "status" in update:
        requested_status = str(update["status"] or "").strip().lower()
        allowed_transitions = {
            "draft": {"cancelled"},
            "rejected": {"draft", "cancelled"},
            "approved": {"submitted", "cancelled"},
            "submitted": {"cancelled"},
            "pending_approval": set(),
            "partial": set(),
            "received": set(),
            "cancelled": set(),
        }
        if requested_status not in allowed_transitions.get(old_po.get("status", "draft"), set()):
            raise HTTPException(status_code=409, detail=f"Use the approval, receiving, return, or cancellation workflow from status '{old_po.get('status', 'draft')}'")
        if requested_status == "cancelled" and any(int(item.get("received_qty", 0) or 0) > 0 for item in old_po.get("line_items", [])):
            raise HTTPException(status_code=409, detail="A purchase order with received stock cannot be cancelled; record a return instead")
        update["status"] = requested_status
    if "line_items" in update:
        update["line_items"] = await _normalise_line_item_destinations(update["line_items"], current_user)
        for new_line in update["line_items"]:
            new_line.setdefault("received_qty", 0)
            new_line.setdefault("returned_qty", 0)
            new_line.setdefault("received_serials", [])
            new_line.setdefault("receipt_batches", [])
    if {"line_items", "shipping", "subtotal", "tax", "total"}.intersection(update):
        source_lines = update.get("line_items", old_po.get("line_items", []))
        subtotal, tax, shipping, total = await _calculate_po_totals(
            source_lines,
            update.get("shipping", old_po.get("shipping", 0)),
        )
        update.update({"line_items": source_lines, "subtotal": subtotal, "tax": tax, "shipping": shipping, "total": total})
    if update.get("ticket_id"):
        await _ticket_or_422(str(update["ticket_id"]), current_user)
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.purchase_orders.update_one(
        {"id": po_id, **version_filter(old_po)},
        {"$set": update, "$inc": {"version": 1}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Purchase order changed while you were editing it; refresh and review the latest record")
    if "status" in update and old_po and old_po.get("status") != update["status"]:
        await _log_po_audit(po_id, "status_changed", f"Status changed from '{old_po.get('status')}' to '{update['status']}'", current_user)
    else:
        await _log_po_audit(po_id, "updated", "Purchase order updated", current_user)
    return {"message": "Purchase order updated"}

@router.post("/purchase-orders/{po_id}/vendor-invoice-match")
async def record_vendor_invoice_match(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Record a supplier invoice against a PO without changing the PO or billing totals."""
    po = await _po_or_404(po_id, current_user)
    if po.get("status") not in {"submitted", "partial", "received"}:
        raise HTTPException(status_code=409, detail="Supplier invoices can only be matched after the purchase order has been sent")
    if po.get("supplier_bill_sync", {}).get("status") in {"queued", "synced"}:
        raise HTTPException(status_code=409, detail="The supplier invoice is locked because its Xero bill has already been queued")

    invoice_number = str(data.get("invoice_number", "")).strip()
    if not invoice_number:
        raise HTTPException(status_code=422, detail="Supplier invoice number is required")
    duplicate = await db.purchase_orders.find_one({
        "id": {"$ne": po_id},
        "vendor_id": po.get("vendor_id", ""),
        "vendor_invoice_match.invoice_number": invoice_number,
    }, {"_id": 0, "po_number": 1})
    if duplicate and po.get("vendor_id"):
        raise HTTPException(status_code=409, detail=f"Supplier invoice {invoice_number} is already recorded on {duplicate.get('po_number', 'another purchase order')}")
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
    po = await _po_or_404(po_id, current_user)
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
    po = await _po_or_404(po_id, current_user)
    if po.get("status") not in {"draft", "rejected"} or any(int(item.get("received_qty", 0) or 0) > 0 for item in po.get("line_items", [])):
        raise HTTPException(status_code=409, detail="Only unreceived draft or rejected purchase orders can be deleted")
    await _log_po_audit(po_id, "deleted", f"Purchase order {po.get('po_number', po_id)} deleted", current_user)
    await db.purchase_orders.delete_one({"id": po_id})
    # Retain the audit log as evidence even after the draft record is removed.
    return {"message": "Purchase order deleted"}

# ============== STOCK RECEIVING ==============

@router.post("/purchase-orders/{po_id}/receive")
async def receive_po_items(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await _po_or_404(po_id, current_user)
    if po["status"] not in ("submitted", "partial"):
        raise HTTPException(status_code=400, detail="Only submitted or partial POs can receive stock")
    received_items = data.get("items", [])
    if not received_items:
        raise HTTPException(status_code=422, detail="Choose at least one purchase-order line to receive")
    idempotency_key = str(data.get("idempotency_key", "") or "").strip()
    replay = await begin_idempotent_operation(
        db,
        scope=f"po-receive:{po_id}",
        key=idempotency_key,
        payload={
            "items": received_items,
            "packing_slip_number": data.get("packing_slip_number", ""),
            "evidence_reference": data.get("evidence_reference", ""),
        },
        user_id=current_user.get("id", ""),
    )
    if replay is not None:
        return {**replay, "replayed": True}
    line_items = po.get("line_items", [])
    notification_deliveries = []
    now_iso = datetime.now(timezone.utc).isoformat()
    total_all_received = True
    receipt_event_items = []
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
        serial_numbers = [str(value).strip() for value in (ri.get("serial_numbers") or []) if str(value).strip()]
        if serial_numbers and len(serial_numbers) != recv_qty:
            raise HTTPException(status_code=422, detail=f"Provide exactly {recv_qty} serial number(s) for {li.get('product_name') or 'this line'}, or leave serials blank")
        if len(serial_numbers) != len(set(serial_numbers)):
            raise HTTPException(status_code=422, detail="Serial numbers must be unique within a receipt")
        existing_serials = {
            str(serial)
            for item in line_items
            for serial in (item.get("received_serials") or [])
        }
        if existing_serials.intersection(serial_numbers):
            raise HTTPException(status_code=409, detail="One or more serial numbers have already been received on this purchase order")
        if serial_numbers:
            serial_match = await db.po_serials.find_one({"serial_number": {"$in": serial_numbers}}, {"_id": 0, "serial_number": 1})
            if serial_match:
                raise HTTPException(status_code=409, detail=f"Serial number {serial_match.get('serial_number')} has already been received")
        li["received_qty"] = prev_received + recv_qty
        li["status"] = "received" if li["received_qty"] >= ordered_qty else "partial"
        li.setdefault("received_serials", []).extend(serial_numbers)
        batch_number = str(ri.get("batch_number", "") or "").strip()
        if batch_number:
            li.setdefault("receipt_batches", []).append({
                "batch_number": batch_number,
                "quantity": recv_qty,
                "received_at": now_iso,
                "received_by": current_user.get("name", ""),
            })
        receipt_event_items.append({
            "line_index": line_index,
            "product_id": pid,
            "product_name": li.get("product_name") or ri.get("product_name", ""),
            "quantity": recv_qty,
            "serial_numbers": serial_numbers,
            "batch_number": batch_number,
            "destination_type": li.get("destination_type", "stock"),
            "destination_ticket_id": li.get("destination_ticket_id", ""),
        })
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
    receipt_event = {
        "id": str(uuid.uuid4()),
        "received_at": now_iso,
        "received_by": current_user.get("id", "system"),
        "received_by_name": current_user.get("name", "System"),
        "packing_slip_number": str(data.get("packing_slip_number", "") or "").strip(),
        "evidence_reference": str(data.get("evidence_reference", "") or "").strip(),
        "items": receipt_event_items,
        "idempotency_key": idempotency_key or None,
    }
    result = await db.purchase_orders.update_one({"id": po_id, **version_filter(po)}, {
        "$set": {
        "line_items": line_items, "status": new_status,
        "updated_at": now_iso,
        },
        "$push": {"receipt_events": receipt_event},
        "$inc": {"version": 1},
    })
    if result.matched_count == 0:
        await fail_idempotent_operation(
            db,
            scope=f"po-receive:{po_id}",
            key=idempotency_key,
            error="Purchase order changed during receiving",
        )
        raise HTTPException(status_code=409, detail="Purchase order changed while stock was being received; refresh before retrying")
    for item in receipt_event_items:
        for serial_number in item["serial_numbers"]:
            await db.po_serials.insert_one({
                "id": str(uuid.uuid4()),
                "serial_number": serial_number,
                "po_id": po_id,
                "po_number": po.get("po_number", ""),
                "line_index": item["line_index"],
                "product_id": item["product_id"],
                "product_name": item["product_name"],
                "received_at": now_iso,
                "received_by": current_user.get("id", "system"),
            })
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
    response = {
        "message": f"Stock received. PO status: {new_status}.{notification_message}",
        "status": new_status,
        "ticket_notifications": notification_deliveries,
        "receipt_event": receipt_event,
    }
    await complete_idempotent_operation(
        db,
        scope=f"po-receive:{po_id}",
        key=idempotency_key,
        response=response,
    )
    return response


# ============== RETURNS, EVIDENCE & SUPPLIER BILLS ==============

@router.post("/purchase-orders/{po_id}/returns")
async def return_po_items(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await _po_or_404(po_id, current_user)
    if po.get("status") not in {"partial", "received"}:
        raise HTTPException(status_code=409, detail="Only received purchase-order items can be returned")
    reason = str(data.get("reason", "") or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=422, detail="Provide a clear return or RMA reason")
    items = data.get("items") or []
    if not items:
        raise HTTPException(status_code=422, detail="Choose at least one received line to return")
    idempotency_key = str(data.get("idempotency_key", "") or "").strip()
    replay = await begin_idempotent_operation(
        db,
        scope=f"po-return:{po_id}",
        key=idempotency_key,
        payload=data,
        user_id=current_user.get("id", ""),
    )
    if replay is not None:
        return {**replay, "replayed": True}

    lines = po.get("line_items") or []
    returned_items = []
    stock_adjustments = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for raw in items:
        try:
            index = int(raw.get("line_index"))
            quantity = int(raw.get("quantity", 0))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Return line and quantity must be whole numbers")
        if index < 0 or index >= len(lines) or quantity < 1:
            raise HTTPException(status_code=422, detail="Choose a valid received line and return quantity")
        line = lines[index]
        available = int(line.get("received_qty", 0) or 0) - int(line.get("returned_qty", 0) or 0)
        if quantity > available:
            raise HTTPException(
                status_code=422,
                detail=f"Cannot return {quantity}: only {available} received item(s) remain on {line.get('product_name') or 'this line'}",
            )
        serial_numbers = [str(value).strip() for value in (raw.get("serial_numbers") or []) if str(value).strip()]
        received_serials = {str(value) for value in (line.get("received_serials") or [])}
        already_returned_serials = {str(value) for value in (line.get("returned_serials") or [])}
        if serial_numbers and len(serial_numbers) != quantity:
            raise HTTPException(status_code=422, detail=f"Provide exactly {quantity} returned serial number(s), or leave serials blank")
        if len(serial_numbers) != len(set(serial_numbers)):
            raise HTTPException(status_code=422, detail="Returned serial numbers must be unique")
        if any(serial not in received_serials or serial in already_returned_serials for serial in serial_numbers):
            raise HTTPException(status_code=409, detail="A selected serial number was not received on this line or has already been returned")

        line["returned_qty"] = int(line.get("returned_qty", 0) or 0) + quantity
        line.setdefault("returned_serials", []).extend(serial_numbers)
        line["return_status"] = "returned" if line["returned_qty"] >= int(line.get("received_qty", 0) or 0) else "partial_return"
        item = {
            "line_index": index,
            "product_id": line.get("product_id", ""),
            "product_name": line.get("product_name") or line.get("name", ""),
            "quantity": quantity,
            "serial_numbers": serial_numbers,
            "destination_type": line.get("destination_type", "stock"),
            "destination_ticket_id": line.get("destination_ticket_id", ""),
        }
        returned_items.append(item)
        if line.get("product_id"):
            stock_adjustments.append((line.get("product_id"), quantity, item))

    return_event = {
        "id": str(uuid.uuid4()),
        "rma_number": str(data.get("rma_number", "") or "").strip(),
        "supplier_credit_number": str(data.get("supplier_credit_number", "") or "").strip(),
        "reason": reason,
        "notes": str(data.get("notes", "") or "").strip(),
        "items": returned_items,
        "returned_at": now_iso,
        "returned_by": current_user.get("id", "system"),
        "returned_by_name": current_user.get("name", "System"),
        "idempotency_key": idempotency_key or None,
    }
    result = await db.purchase_orders.update_one(
        {"id": po_id, **version_filter(po)},
        {
            "$set": {"line_items": lines, "updated_at": now_iso},
            "$push": {"return_events": return_event},
            "$inc": {"version": 1},
        },
    )
    if result.matched_count == 0:
        await fail_idempotent_operation(
            db,
            scope=f"po-return:{po_id}",
            key=idempotency_key,
            error="Purchase order changed during return",
        )
        raise HTTPException(status_code=409, detail="Purchase order changed while the return was being recorded; refresh and retry")

    for product_id, quantity, item in stock_adjustments:
        product = await db.products.find_one({"id": product_id}, {"_id": 0})
        if product:
            old_stock = int(product.get("quantity_in_stock", 0) or 0)
            new_stock = max(0, old_stock - quantity)
            await db.products.update_one({"id": product_id}, {"$set": {"quantity_in_stock": new_stock, "updated_at": now_iso}})
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()),
                "product_id": product_id,
                "product_name": product.get("name", item["product_name"]),
                "type": "out",
                "quantity": quantity,
                "previous_stock": old_stock,
                "new_stock": new_stock,
                "reason": f"Supplier return from {po.get('po_number', 'purchase order')}: {reason}",
                "reference": po_id,
                "po_id": po_id,
                "created_by": current_user.get("id", "system"),
                "created_by_name": current_user.get("name", "System"),
                "created_at": now_iso,
            })
        for serial in item["serial_numbers"]:
            await db.po_serials.update_one(
                {"po_id": po_id, "serial_number": serial},
                {"$set": {"status": "returned", "returned_at": now_iso, "returned_by": current_user.get("id", "system")}},
            )
        if item.get("destination_ticket_id"):
            await db.ticket_comments.insert_one({
                "id": str(uuid.uuid4()),
                "ticket_id": item["destination_ticket_id"],
                "user_id": current_user.get("id", "system"),
                "user_name": current_user.get("name", "System"),
                "content": f"Supplier return recorded: {item['product_name']} x{quantity} from {po.get('po_number', 'the linked PO')}. Reason: {reason}",
                "is_internal": True,
                "source": "purchase_order_return",
                "po_id": po_id,
                "po_number": po.get("po_number", ""),
                "created_at": now_iso,
            })
            await ticket_audit(
                item["destination_ticket_id"],
                current_user,
                "parts_returned",
                f"{item['product_name']} x{quantity} returned to supplier from {po.get('po_number', '')}",
            )

    await _log_po_audit(
        po_id,
        "items_returned",
        f"Returned {sum(item['quantity'] for item in returned_items)} item(s)"
        + (f" under RMA {return_event['rma_number']}" if return_event["rma_number"] else "")
        + (f"; supplier credit {return_event['supplier_credit_number']}" if return_event["supplier_credit_number"] else ""),
        current_user,
    )
    response = {"message": "Supplier return recorded", "return_event": return_event}
    await complete_idempotent_operation(db, scope=f"po-return:{po_id}", key=idempotency_key, response=response)
    return response


@router.post("/purchase-orders/{po_id}/attachments")
async def upload_po_attachment(
    po_id: str,
    file: UploadFile = File(...),
    category: str = Form("receiving"),
    note: str = Form(""),
    current_user: dict = Depends(get_current_user),
):
    po = await _po_or_404(po_id, current_user)
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".pdf", ".png", ".jpg", ".jpeg", ".csv", ".docx", ".xlsx"}:
        raise HTTPException(status_code=422, detail="Upload a PDF, image, CSV, Word, or Excel evidence file")
    content = await file.read()
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="Evidence files must be between 1 byte and 10 MB")
    filename = f"{uuid.uuid4().hex}{extension}"
    path = PO_EVIDENCE_DIR / filename
    path.write_bytes(content)
    now_iso = datetime.now(timezone.utc).isoformat()
    attachment = {
        "id": str(uuid.uuid4()),
        "name": Path(file.filename or filename).name,
        "url": f"/api/uploads/purchase-orders/{filename}",
        "content_type": file.content_type or "application/octet-stream",
        "size": len(content),
        "category": str(category or "receiving").strip().lower(),
        "note": str(note or "").strip(),
        "uploaded_by": current_user.get("id", "system"),
        "uploaded_by_name": current_user.get("name", "System"),
        "uploaded_at": now_iso,
    }
    await db.purchase_orders.update_one(
        {"id": po_id},
        {"$push": {"attachments": attachment}, "$set": {"updated_at": now_iso}, "$inc": {"version": 1}},
    )
    await _log_po_audit(po_id, "evidence_attached", f"Attached {attachment['name']} as {attachment['category']} evidence", current_user)
    return attachment


@router.post("/purchase-orders/{po_id}/supplier-bill/sync")
async def queue_supplier_bill(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    po = await _po_or_404(po_id, current_user)
    match = po.get("vendor_invoice_match") or {}
    if not match:
        raise HTTPException(status_code=409, detail="Match the supplier invoice before creating its Xero bill")
    if match.get("status") == "variance" and (match.get("review") or {}).get("status") != "accepted":
        raise HTTPException(status_code=409, detail="Resolve or accept the supplier invoice variance before creating its Xero bill")
    idempotency_key = str(data.get("idempotency_key", "") or "").strip()
    replay = await begin_idempotent_operation(
        db,
        scope=f"po-supplier-bill:{po_id}",
        key=idempotency_key,
        payload={"invoice_number": match.get("invoice_number"), "total": match.get("supplier_total")},
        user_id=current_user.get("id", ""),
    )
    if replay is not None:
        return {**replay, "replayed": True}
    existing = await db.xero_supplier_bills.find_one({"po_id": po_id}, {"_id": 0})
    if existing and existing.get("status") in {"queued", "synced"}:
        response = {"message": "Supplier bill is already queued for Xero", "supplier_bill": existing}
        await complete_idempotent_operation(db, scope=f"po-supplier-bill:{po_id}", key=idempotency_key, response=response)
        return response

    xero = await db.settings.find_one({"type": "xero"}, {"_id": 0}) or {}
    connected = bool(
        xero.get("client_id")
        and xero.get("client_secret")
        and xero.get("tenant_id")
        and (xero.get("access_token") or xero.get("refresh_token"))
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    bill = {
        "id": (existing or {}).get("id") or str(uuid.uuid4()),
        "po_id": po_id,
        "po_number": po.get("po_number", ""),
        "client_id": po.get("client_id", ""),
        "type": "ACCPAY",
        "vendor_id": po.get("vendor_id", ""),
        "vendor_name": po.get("vendor", ""),
        "invoice_number": match.get("invoice_number", ""),
        "invoice_date": match.get("invoice_date", ""),
        "reference": po.get("po_number", ""),
        "line_items": po.get("line_items", []),
        "subtotal": po.get("subtotal", 0),
        "tax": po.get("tax", 0),
        "total": match.get("supplier_total", po.get("total", 0)),
        "status": "queued" if connected else "needs_connection",
        "xero_tenant_id": xero.get("tenant_id", "") if connected else "",
        "queued_at": now_iso if connected else None,
        "created_at": (existing or {}).get("created_at") or now_iso,
        "updated_at": now_iso,
        "created_by": current_user.get("id", "system"),
    }
    await db.xero_supplier_bills.update_one({"po_id": po_id}, {"$set": bill}, upsert=True)
    sync_state = {
        "status": bill["status"],
        "bill_id": bill["id"],
        "invoice_number": bill["invoice_number"],
        "updated_at": now_iso,
        "updated_by": current_user.get("name", "System"),
    }
    await db.purchase_orders.update_one(
        {"id": po_id},
        {"$set": {"supplier_bill_sync": sync_state, "updated_at": now_iso}, "$inc": {"version": 1}},
    )
    detail = "queued for Xero" if connected else "prepared and waiting for the Xero connection"
    await _log_po_audit(po_id, "supplier_bill_queued", f"Supplier invoice {bill['invoice_number']} {detail}", current_user)
    response = {
        "message": f"Supplier bill {detail}",
        "supplier_bill": bill,
        "xero_connected": connected,
    }
    await complete_idempotent_operation(db, scope=f"po-supplier-bill:{po_id}", key=idempotency_key, response=response)
    return response


@router.get("/xero/supplier-bills")
async def list_supplier_bills(current_user: dict = Depends(get_current_user)):
    return await db.xero_supplier_bills.find(
        scoped_query(current_user, {}, site_field=None), {"_id": 0}
    ).sort("updated_at", -1).to_list(1000)


# ============== PO AUDIT LOG ==============

@router.get("/purchase-orders/{po_id}/audit-log")
async def get_po_audit_log(po_id: str, current_user: dict = Depends(get_current_user)):
    await _po_or_404(po_id, current_user)
    logs = await db.po_audit_log.find({"po_id": po_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs

# ============== PO PING & ESCALATION ==============

@router.get("/settings/po-ping")
async def get_po_ping_settings(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="purchase_order.ping_settings.read")
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
    await assert_global_scope(current_user, operation="purchase_order.ping_settings.update")
    data["type"] = "po_ping"
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.settings.update_one({"type": "po_ping"}, {"$set": data}, upsert=True)
    return {"message": "PO ping settings updated"}

@router.post("/purchase-orders/check-escalations")
async def check_po_escalations(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="purchase_order.escalations.run")
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
    open_pos = await db.purchase_orders.find(
        scoped_query(current_user, {"status": {"$in": ["submitted", "partial"]}}, site_field=None),
        {"_id": 0},
    ).to_list(5000)
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


async def _ticket_or_422(ticket_id: str, current_user: dict) -> dict:
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status_code=422, detail="The selected ticket could not be found")
    await assert_client_scope(
        current_user,
        ticket.get("client_id"),
        operation="purchase_order.ticket_link",
        mask_not_found=True,
    )
    return ticket


async def _normalise_line_item_destinations(line_items: list[dict], current_user: dict) -> list[dict]:
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
            ticket = await _ticket_or_422(ticket_id, current_user)
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
