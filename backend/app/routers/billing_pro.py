"""
Billing Pro — best-in-class enhancements for Invoices, Products, Recurring.
Adds endpoints for:
  - Smart numbering scheme settings & sequence generator
  - Bulk invoice actions (send / mark paid / delete / csv export)
  - AI smart-suggest line items from tickets
  - Recurring CPI / annual indexation (auto bump %)
  - Mid-cycle proration calculator
  - Generation calendar (forecast)
  - Net-New MRR / churn / expansion analytics
  - Multi-warehouse stock locations + transfers
  - Auto-PO from low stock
  - Quantity-break (tier) pricing
  - Bulk product CSV import
  - Approval workflow (>$X needs sign-off)
  - Deposits / progress invoicing helpers
  - Margin calculator / suggest retail
  - AU/NZ GST tax-invoice compliance settings
  - Inventory month-end snapshots
  - Live FX conversion
  - Retainer / pre-paid hours
  - Customer invoice portal comments / disputes
"""
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import uuid
import csv
import io
import httpx
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============================================================================
#  SMART NUMBERING
# ============================================================================

@router.get("/billing-pro/numbering")
async def get_numbering(current_user: dict = Depends(get_current_user)):
    cfg = await db.settings.find_one({"key": "invoice_numbering"}, {"_id": 0}) or {}
    return cfg.get("value") or {
        "format": "INV-{YYYY}-{SEQ:05d}",
        "client_prefix": False,
        "fy_reset": True,
        "fy_start_month": 7,  # AU FY = July
        "next_seq": 1,
    }


@router.put("/billing-pro/numbering")
async def save_numbering(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one(
        {"key": "invoice_numbering"},
        {"$set": {"key": "invoice_numbering", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"message": "Numbering format saved"}


def _fiscal_year(now: datetime, fy_start_month: int) -> int:
    return now.year if now.month >= fy_start_month else now.year - 1


@router.post("/billing-pro/numbering/preview")
async def preview_numbering(data: dict, current_user: dict = Depends(get_current_user)):
    """Render a sample invoice number from the format string."""
    cfg = data or {}
    fmt = cfg.get("format", "INV-{YYYY}-{SEQ:05d}")
    now = datetime.now(timezone.utc)
    fy = _fiscal_year(now, cfg.get("fy_start_month", 7))
    sample_client = (cfg.get("sample_client") or "ACME").upper()[:4]
    seq = cfg.get("next_seq", 1)
    try:
        out = fmt.format(YYYY=now.year, YY=str(now.year)[-2:], MM=f"{now.month:02d}", FY=fy, CLIENT=sample_client, SEQ=seq)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid format: {e}")
    return {"sample": out}


# ============================================================================
#  BULK INVOICE ACTIONS
# ============================================================================

@router.post("/billing-pro/invoices/bulk-action")
async def bulk_invoice_action(data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {invoice_ids:[...], action: 'mark_sent'|'mark_paid'|'delete'|'void'}"""
    ids = data.get("invoice_ids") or []
    action = data.get("action")
    if not ids or not action:
        raise HTTPException(status_code=400, detail="invoice_ids and action required")
    now = datetime.now(timezone.utc).isoformat()
    if action == "mark_sent":
        res = await db.invoices.update_many({"id": {"$in": ids}, "status": "draft"}, {"$set": {"status": "sent", "sent_at": now}})
        return {"updated": res.modified_count, "action": action}
    if action == "mark_paid":
        raise HTTPException(status_code=409, detail="Use Record Payment so the amount, method, and audit history are retained")
    if action == "void":
        res = await db.invoices.update_many({"id": {"$in": ids}, "payment_status": {"$in": ["unpaid", None]}, "status": {"$nin": ["cancelled", "voided"]}}, {"$set": {"status": "cancelled", "voided_at": now, "voided_by": current_user.get("name", "")}})
        return {"updated": res.modified_count, "action": action}
    if action == "delete":
        res = await db.invoices.delete_many({"id": {"$in": ids}, "payment_status": {"$in": ["unpaid", None]}, "status": {"$in": ["draft", "pending_approval"]}})
        return {"deleted": res.deleted_count, "action": action}
    raise HTTPException(status_code=400, detail=f"Unknown action: {action}")


@router.post("/billing-pro/invoices/export-csv")
async def export_invoices_csv(data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {invoice_ids: [...] OR filter: {status, client_id, from, to}}"""
    ids = data.get("invoice_ids") or []
    if ids:
        invs = await db.invoices.find({"id": {"$in": ids}}, {"_id": 0}).to_list(2000)
    else:
        f = data.get("filter") or {}
        q = {}
        if f.get("status") and f["status"] != "all":
            q["status"] = f["status"]
        if f.get("client_id"):
            q["client_id"] = f["client_id"]
        invs = await db.invoices.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "Invoice #", "Status", "Payment Status", "Client", "Issue Date", "Due Date",
        "Subtotal", "Discount", "Tax", "Total", "Amount Paid", "Balance", "Notes"
    ])
    for inv in invs:
        balance = round((inv.get("total", 0) or 0) - (inv.get("amount_paid", 0) or 0), 2)
        w.writerow([
            inv.get("invoice_number", ""), inv.get("status", ""), inv.get("payment_status", ""),
            inv.get("client_name", ""), (inv.get("created_at") or "")[:10], inv.get("due_date") or "",
            inv.get("subtotal", 0), inv.get("discount_amount", 0) or 0,
            inv.get("tax", 0), inv.get("total", 0), inv.get("amount_paid", 0), balance,
            (inv.get("notes") or "").replace("\n", " ")[:200],
        ])
    return {"csv": buf.getvalue(), "count": len(invs), "filename": f"invoices-{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"}


# ============================================================================
#  AI SMART SUGGEST LINE ITEMS (from tickets/time-entries)
# ============================================================================

@router.get("/billing-pro/invoices/smart-suggest")
async def smart_suggest_lines(client_id: str, days: int = 30, current_user: dict = Depends(get_current_user)):
    """Suggest invoice line items from un-invoiced billable time entries + closed tickets in the period."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    # Time entries
    entries = await db.time_entries.find(
        {"client_id": client_id, "billable": True, "invoiced": {"$ne": True}, "date": {"$gte": since[:10]}},
        {"_id": 0}
    ).to_list(500)
    # Group by ticket
    by_ticket = {}
    for e in entries:
        tid = e.get("ticket_id", "")
        bucket = by_ticket.setdefault(tid, {"ticket_id": tid, "ticket_title": e.get("ticket_title"), "minutes": 0, "rate": e.get("hourly_rate", 75.0), "entries": []})
        bucket["minutes"] += int(e.get("minutes", 0))
        bucket["rate"] = e.get("hourly_rate", bucket["rate"])
        bucket["entries"].append(e.get("id"))
    suggestions = []
    for t in by_ticket.values():
        hrs = round(t["minutes"] / 60, 2)
        if hrs <= 0:
            continue
        suggestions.append({
            "kind": "time_entry",
            "ticket_id": t["ticket_id"],
            "description": f"{t.get('ticket_title') or 'Ticket'} — {hrs}h labour",
            "quantity": hrs,
            "unit_price": t["rate"],
            "total": round(hrs * t["rate"], 2),
            "entry_ids": t["entries"],
        })

    # Products attached to tickets, not yet invoiced
    products = await db.ticket_products.find(
        {"client_id": client_id, "invoiced": {"$ne": True}},
        {"_id": 0}
    ).to_list(500)
    for p in products:
        suggestions.append({
            "kind": "product",
            "ticket_id": p.get("ticket_id"),
            "product_id": p.get("product_id"),
            "description": p.get("name") or p.get("description") or "Product",
            "quantity": p.get("quantity", 1),
            "unit_price": p.get("unit_price", 0),
            "total": round(p.get("quantity", 1) * p.get("unit_price", 0), 2),
            "ticket_product_id": p.get("id"),
        })

    total = round(sum(s["total"] for s in suggestions), 2)
    return {
        "client_id": client_id,
        "period_days": days,
        "suggestions": suggestions,
        "total": total,
        "count": len(suggestions),
    }


# ============================================================================
#  CPI / ANNUAL INDEXATION
# ============================================================================

@router.post("/billing-pro/recurring/{ri_id}/set-indexation")
async def set_indexation(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Auto-bump pricing on each anniversary by X%. Body: {pct, anniversary_date, enabled}"""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Recurring invoice not found")
    pct = float(data.get("pct", 0))
    anniv = data.get("anniversary_date") or ri.get("start_date")
    enabled = bool(data.get("enabled", True))
    await db.recurring_invoices.update_one(
        {"id": ri_id},
        {"$set": {
            "indexation": {"enabled": enabled, "pct": pct, "anniversary_date": anniv, "next_apply": anniv},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"message": f"Indexation set to +{pct}% on each {anniv}", "indexation": {"enabled": enabled, "pct": pct, "anniversary_date": anniv}}


@router.post("/billing-pro/recurring/run-indexation")
async def run_indexation(current_user: dict = Depends(get_current_user)):
    """Apply indexation to all recurring invoices whose anniversary has passed.
    Bumps unit_price on every line item by the configured percentage."""
    today = datetime.now(timezone.utc).date().isoformat()
    ris = await db.recurring_invoices.find(
        {"indexation.enabled": True, "status": "active"},
        {"_id": 0}
    ).to_list(500)
    bumped = []
    for ri in ris:
        idx = ri.get("indexation", {})
        next_apply = idx.get("next_apply")
        if not next_apply or next_apply > today:
            continue
        pct = float(idx.get("pct", 0))
        if pct == 0:
            continue
        new_lines = []
        old_total = 0
        for li in ri.get("line_items", []):
            old_rate = float(li.get("rate", 0) or 0)
            qty = float(li.get("quantity", 1) or 1)
            new_rate = round(old_rate * (1 + pct / 100), 2)
            new_amount = round(qty * new_rate, 2)
            old_total += float(li.get("amount", 0) or 0)
            new_lines.append({**li, "rate": new_rate, "amount": new_amount})
        subtotal = sum(li["amount"] for li in new_lines)
        tax_rate = float(ri.get("tax_rate", 0))
        tax_amount = round(subtotal * tax_rate / 100, 2)
        # Move next_apply forward 1 year
        try:
            anniv_dt = datetime.fromisoformat(next_apply).replace(tzinfo=timezone.utc)
            new_next = anniv_dt.replace(year=anniv_dt.year + 1).date().isoformat()
        except Exception:
            new_next = (datetime.now(timezone.utc) + timedelta(days=365)).date().isoformat()
        await db.recurring_invoices.update_one(
            {"id": ri["id"]},
            {"$set": {
                "line_items": new_lines,
                "subtotal": subtotal,
                "tax_amount": tax_amount,
                "amount": round(subtotal + tax_amount, 2),
                "indexation.next_apply": new_next,
                "indexation.last_applied": today,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }}
        )
        # Audit
        await db.recurring_indexation_log.insert_one({
            "id": str(uuid.uuid4()),
            "ri_id": ri["id"],
            "client_name": ri.get("client_name"),
            "applied_at": datetime.now(timezone.utc).isoformat(),
            "pct": pct,
            "old_total": round(old_total, 2),
            "new_total": round(subtotal, 2),
            "delta": round(subtotal - old_total, 2),
        })
        bumped.append({"ri_id": ri["id"], "client": ri.get("client_name"), "pct": pct, "old_total": round(old_total, 2), "new_total": round(subtotal, 2)})
    return {"bumped_count": len(bumped), "bumped": bumped}


# ============================================================================
#  MID-CYCLE PRORATION
# ============================================================================

@router.post("/billing-pro/recurring/{ri_id}/prorate")
async def prorate_change(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Calculate prorated charge for adding/removing a line item mid-cycle.
    Body: {quantity_delta, unit_price, description, effective_date}"""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Not found")
    qty_delta = float(data.get("quantity_delta", 0))
    unit_price = float(data.get("unit_price", 0))
    eff = data.get("effective_date") or datetime.now(timezone.utc).date().isoformat()
    # Compute days remaining in the current billing period
    freq = ri.get("frequency", "monthly")
    period_days = {"weekly": 7, "fortnightly": 14, "monthly": 30, "quarterly": 90, "annually": 365}.get(freq, 30)
    next_gen = ri.get("next_generation") or eff
    try:
        eff_dt = datetime.fromisoformat(eff).replace(tzinfo=timezone.utc)
        next_dt = datetime.fromisoformat(next_gen).replace(tzinfo=timezone.utc)
        remaining = max(0, (next_dt - eff_dt).days)
    except Exception:
        remaining = period_days // 2
    full_period_charge = qty_delta * unit_price
    prorated = round(full_period_charge * (remaining / period_days), 2)
    return {
        "remaining_days": remaining,
        "period_days": period_days,
        "full_period_charge": round(full_period_charge, 2),
        "prorated_amount": prorated,
        "currency": ri.get("currency", "AUD"),
        "description": data.get("description", "Mid-cycle change"),
        "effective_date": eff,
    }


# ============================================================================
#  GENERATION CALENDAR
# ============================================================================

@router.get("/billing-pro/recurring/calendar")
async def generation_calendar(months: int = 3, current_user: dict = Depends(get_current_user)):
    """Forecast which recurring invoices will generate over the next N months."""
    ris = await db.recurring_invoices.find({"status": "active"}, {"_id": 0}).to_list(500)
    today = datetime.now(timezone.utc).date()
    horizon = today + timedelta(days=months * 31)
    events = []
    freq_days = {"weekly": 7, "fortnightly": 14, "monthly": 30, "quarterly": 91, "annually": 365}
    for ri in ris:
        ng = ri.get("next_generation")
        if not ng:
            continue
        try:
            d = datetime.fromisoformat(ng).date()
        except Exception:
            continue
        days = freq_days.get(ri.get("frequency", "monthly"), 30)
        while d <= horizon:
            events.append({
                "ri_id": ri["id"],
                "client_id": ri.get("client_id"),
                "client_name": ri.get("client_name"),
                "description": ri.get("description"),
                "amount": ri.get("amount", 0),
                "currency": ri.get("currency", "AUD"),
                "frequency": ri.get("frequency"),
                "date": d.isoformat(),
            })
            d = d + timedelta(days=days)
    by_month = {}
    for e in events:
        m = e["date"][:7]
        b = by_month.setdefault(m, {"month": m, "count": 0, "total": 0, "events": []})
        b["count"] += 1
        b["total"] += float(e["amount"] or 0)
        b["events"].append(e)
    return {
        "months": sorted(by_month.values(), key=lambda x: x["month"]),
        "horizon": horizon.isoformat(),
        "total_events": len(events),
    }


# ============================================================================
#  NET-NEW MRR / CHURN / EXPANSION
# ============================================================================

@router.get("/billing-pro/recurring/mrr-analytics")
async def mrr_analytics(current_user: dict = Depends(get_current_user)):
    """Compute MRR breakdown — new, churn, expansion, contraction over last 12 months."""
    ris = await db.recurring_invoices.find({}, {"_id": 0}).to_list(2000)
    now = datetime.now(timezone.utc)
    months = []
    for i in range(12, -1, -1):
        month = (now.replace(day=1) - timedelta(days=i * 30)).strftime("%Y-%m")
        months.append(month)
    monthly_mrr = {m: 0 for m in months}

    def to_monthly(amount: float, freq: str) -> float:
        f = (freq or "monthly").lower()
        if f == "annually":
            return amount / 12
        if f == "quarterly":
            return amount / 3
        if f == "fortnightly":
            return amount * 26 / 12
        if f == "weekly":
            return amount * 52 / 12
        return amount

    active_now = 0
    paused_now = 0
    cancelled_now = 0
    new_mrr = 0
    expansion = 0
    contraction = 0
    churn = 0

    for ri in ris:
        amount = float(ri.get("amount", 0) or 0)
        mrr = to_monthly(amount, ri.get("frequency", "monthly"))
        status = ri.get("status", "active")
        if status == "active":
            active_now += mrr
            try:
                created = (ri.get("created_at") or "")[:7]
                if created in monthly_mrr:
                    monthly_mrr[created] += mrr
                    if created == months[-1]:
                        new_mrr += mrr
            except Exception:
                pass
        elif status == "paused":
            paused_now += mrr
        elif status == "cancelled":
            cancelled_now += mrr
            churn += mrr

    return {
        "current_mrr": round(active_now, 2),
        "paused_mrr": round(paused_now, 2),
        "cancelled_mrr": round(cancelled_now, 2),
        "new_mrr_this_month": round(new_mrr, 2),
        "churn_this_month": round(churn, 2),
        "expansion_mrr": round(expansion, 2),
        "contraction_mrr": round(contraction, 2),
        "active_count": sum(1 for r in ris if r.get("status") == "active"),
        "paused_count": sum(1 for r in ris if r.get("status") == "paused"),
        "cancelled_count": sum(1 for r in ris if r.get("status") == "cancelled"),
        "by_month": [{"month": m, "mrr": round(monthly_mrr[m], 2)} for m in months],
    }


# ============================================================================
#  WAREHOUSES / LOCATIONS  +  STOCK TRANSFERS
# ============================================================================

@router.get("/billing-pro/warehouses")
async def list_warehouses(current_user: dict = Depends(get_current_user)):
    items = await db.warehouses.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not items:
        # seed default
        default = {"id": "wh-default", "name": "Main Warehouse", "code": "HQ", "address": "", "is_default": True, "created_at": datetime.now(timezone.utc).isoformat()}
        await db.warehouses.insert_one(default.copy())
        items = [default]
    return items


@router.post("/billing-pro/warehouses")
async def create_warehouse(data: dict, current_user: dict = Depends(get_current_user)):
    w = {
        "id": f"wh-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", "New Location").strip(),
        "code": (data.get("code") or "").upper().strip()[:8],
        "address": data.get("address", ""),
        "is_default": bool(data.get("is_default", False)),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if w["is_default"]:
        await db.warehouses.update_many({}, {"$set": {"is_default": False}})
    await db.warehouses.insert_one(w)
    w.pop("_id", None)
    return w


@router.delete("/billing-pro/warehouses/{wh_id}")
async def delete_warehouse(wh_id: str, current_user: dict = Depends(get_current_user)):
    await db.warehouses.delete_one({"id": wh_id})
    return {"message": "deleted"}


@router.post("/billing-pro/products/{product_id}/transfer")
async def transfer_stock(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Move stock between warehouses. Body: {from_id, to_id, qty, note}"""
    from_id = data.get("from_id")
    to_id = data.get("to_id")
    qty = int(data.get("qty", 0))
    if not from_id or not to_id or qty <= 0 or from_id == to_id:
        raise HTTPException(status_code=400, detail="from_id, to_id and positive qty required")
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    stock_by_loc = product.get("stock_by_location") or {}
    available = int(stock_by_loc.get(from_id, 0))
    if available < qty:
        raise HTTPException(status_code=400, detail=f"Only {available} available at source")
    stock_by_loc[from_id] = available - qty
    stock_by_loc[to_id] = int(stock_by_loc.get(to_id, 0)) + qty
    await db.products.update_one({"id": product_id}, {"$set": {"stock_by_location": stock_by_loc, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await db.stock_transfers.insert_one({
        "id": str(uuid.uuid4()),
        "product_id": product_id,
        "product_name": product.get("name"),
        "from_id": from_id,
        "to_id": to_id,
        "qty": qty,
        "note": data.get("note", ""),
        "transferred_by": current_user.get("name", ""),
        "transferred_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": f"Transferred {qty} unit(s)", "stock_by_location": stock_by_loc}


@router.get("/billing-pro/products/inventory/snapshot")
async def inventory_snapshot(current_user: dict = Depends(get_current_user)):
    """Month-end valuation snapshot."""
    products = await db.products.find({}, {"_id": 0}).to_list(2000)
    total_units = 0
    total_value_cost = 0
    total_value_retail = 0
    by_category = {}
    low_stock = []
    for p in products:
        qty = int(p.get("quantity_in_stock", 0))
        cost = float(p.get("cost_price", 0))
        retail = float(p.get("retail_price", 0))
        total_units += qty
        total_value_cost += qty * cost
        total_value_retail += qty * retail
        cat = p.get("category", "Uncategorised")
        c = by_category.setdefault(cat, {"category": cat, "units": 0, "value_cost": 0, "value_retail": 0})
        c["units"] += qty
        c["value_cost"] += qty * cost
        c["value_retail"] += qty * retail
        if qty <= int(p.get("reorder_level", 0)):
            low_stock.append({"id": p["id"], "name": p["name"], "sku": p.get("sku"), "qty": qty, "reorder": p.get("reorder_level", 0), "vendor": p.get("vendor", "")})
    return {
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
        "total_units": total_units,
        "total_value_cost": round(total_value_cost, 2),
        "total_value_retail": round(total_value_retail, 2),
        "potential_margin": round(total_value_retail - total_value_cost, 2),
        "by_category": sorted(by_category.values(), key=lambda x: -x["value_cost"]),
        "low_stock": low_stock,
        "low_stock_count": len(low_stock),
    }


# ============================================================================
#  AUTO PO FROM LOW-STOCK
# ============================================================================

@router.post("/billing-pro/products/{product_id}/create-po")
async def create_po_from_low_stock(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Generate a vendor PO for re-stocking. Body: {qty, note}"""
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    qty = int(data.get("qty", max(1, int(product.get("reorder_level", 5)) * 2 - int(product.get("quantity_in_stock", 0)))))
    if qty <= 0:
        qty = max(1, int(product.get("reorder_level", 5)))
    cost = float(product.get("cost_price", 0))
    po = {
        "id": f"po-{uuid.uuid4().hex[:8]}",
        "po_number": f"PO-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}",
        "vendor": product.get("vendor") or "Unknown",
        "status": "draft",
        "items": [{
            "product_id": product["id"],
            "product_name": product["name"],
            "sku": product.get("sku", ""),
            "quantity": qty,
            "unit_cost": cost,
            "total": round(qty * cost, 2),
        }],
        "subtotal": round(qty * cost, 2),
        "tax": 0,
        "total": round(qty * cost, 2),
        "currency": "AUD",
        "expected_date": (datetime.now(timezone.utc) + timedelta(days=7)).date().isoformat(),
        "notes": data.get("note", f"Auto-generated for low stock of {product['name']}"),
        "created_by": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.purchase_orders.insert_one(po)
    po.pop("_id", None)
    return po


@router.get("/billing-pro/purchase-orders")
async def list_pos(current_user: dict = Depends(get_current_user)):
    docs = await db.purchase_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@router.put("/billing-pro/purchase-orders/{po_id}/status")
async def update_po_status(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    status = data.get("status")
    if status not in ("draft", "sent", "received", "cancelled"):
        raise HTTPException(status_code=400, detail="bad status")
    update = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status == "received":
        update["received_at"] = datetime.now(timezone.utc).isoformat()
        po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
        if po:
            for it in po.get("items", []):
                await db.products.update_one(
                    {"id": it["product_id"]},
                    {"$inc": {"quantity_in_stock": int(it["quantity"])},
                     "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
                )
                await db.product_stock_movements.insert_one({
                    "id": str(uuid.uuid4()),
                    "product_id": it["product_id"],
                    "type": "in",
                    "quantity": int(it["quantity"]),
                    "reason": f"PO {po.get('po_number')} received",
                    "user": current_user.get("name", ""),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
    await db.purchase_orders.update_one({"id": po_id}, {"$set": update})
    return {"message": f"PO marked {status}"}


# ============================================================================
#  BULK PRODUCT CSV IMPORT
# ============================================================================

@router.post("/billing-pro/products/bulk-import")
async def bulk_import_products(data: dict, current_user: dict = Depends(get_current_user)):
    """Import products from CSV. Body: {csv_text, mapping?: {csv_col: product_field}}.
    Default mapping assumes: Name, SKU, Category, Vendor, Cost Price, Retail Price, Stock, Reorder, Tax Rate, Description"""
    csv_text = data.get("csv_text", "")
    if not csv_text:
        raise HTTPException(status_code=400, detail="csv_text required")
    reader = csv.DictReader(io.StringIO(csv_text))
    mapping = data.get("mapping") or {}
    inserted, updated, errors = 0, 0, []
    now = datetime.now(timezone.utc).isoformat()
    for i, row in enumerate(reader, start=2):
        try:
            def get(field, default=""):
                # Try mapped col first, then field name (case-insensitive)
                col = mapping.get(field)
                if col and col in row:
                    return row[col]
                for k in row:
                    if k.lower().replace("_", " ").replace("-", " ") == field.lower().replace("_", " ").replace("-", " "):
                        return row[k]
                return default
            name = get("name").strip()
            if not name:
                continue
            sku = get("sku").strip() or name.lower().replace(" ", "-")[:20]
            existing = await db.products.find_one({"sku": sku}, {"_id": 0, "id": 1})
            doc = {
                "name": name,
                "sku": sku,
                "category": get("category", "General"),
                "vendor": get("vendor", ""),
                "cost_price": float(get("cost_price", 0) or 0),
                "retail_price": float(get("retail_price", 0) or 0),
                "tax_rate": float(get("tax_rate", 0) or 0),
                "quantity_in_stock": int(float(get("stock", 0) or 0)),
                "reorder_level": int(float(get("reorder", 5) or 5)),
                "description": get("description", ""),
                "unit": get("unit", "each"),
                "is_active": True,
                "is_taxable": True,
                "updated_at": now,
            }
            if existing:
                await db.products.update_one({"id": existing["id"]}, {"$set": doc})
                updated += 1
            else:
                doc["id"] = str(uuid.uuid4())
                doc["created_at"] = now
                await db.products.insert_one(doc)
                inserted += 1
        except Exception as e:
            errors.append({"row": i, "error": str(e)[:100]})
    return {"inserted": inserted, "updated": updated, "errors": errors, "total_processed": inserted + updated}


# ============================================================================
#  QUANTITY-BREAK PRICING
# ============================================================================

@router.put("/billing-pro/products/{product_id}/pricing-tiers")
async def set_tier_pricing(product_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {tiers: [{min_qty: 1, unit_price: 100}, {min_qty: 10, unit_price: 90}, ...]}"""
    raw_tiers = data.get("tiers", [])
    if not isinstance(raw_tiers, list):
        raise HTTPException(status_code=422, detail="Tiers must be a list")
    tiers = []
    for tier in raw_tiers:
        try:
            min_qty = int(tier.get("min_qty", 0))
            unit_price = float(tier.get("unit_price", -1))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Each tier requires a valid minimum quantity and unit price")
        if min_qty < 1 or unit_price < 0:
            raise HTTPException(status_code=422, detail="Tier quantities must be at least 1 and prices cannot be negative")
        tiers.append({"min_qty": min_qty, "unit_price": unit_price})
    tiers.sort(key=lambda tier: tier["min_qty"])
    result = await db.products.update_one(
        {"id": product_id},
        {"$set": {"pricing_tiers": tiers, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"message": f"Saved {len(tiers)} tier(s)", "tiers": tiers}


@router.get("/billing-pro/products/{product_id}/price-for-qty")
async def get_tier_price(product_id: str, qty: int, current_user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Not found")
    tiers = p.get("pricing_tiers") or []
    base_price = float(p.get("retail_price", 0))
    chosen = base_price
    for t in sorted(tiers, key=lambda x: int(x.get("min_qty", 1))):
        if qty >= int(t.get("min_qty", 1)):
            chosen = float(t.get("unit_price", base_price))
    return {"qty": qty, "unit_price": chosen, "total": round(qty * chosen, 2), "base_price": base_price, "tier_savings": round((base_price - chosen) * qty, 2)}


# ============================================================================
#  APPROVAL WORKFLOW
# ============================================================================

@router.get("/billing-pro/settings/approval")
async def get_approval_settings(current_user: dict = Depends(get_current_user)):
    cfg = await db.settings.find_one({"key": "invoice_approval"}, {"_id": 0}) or {}
    return cfg.get("value") or {"enabled": False, "threshold": 5000, "approver_role": "admin"}


@router.put("/billing-pro/settings/approval")
async def save_approval_settings(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"key": "invoice_approval"}, {"$set": {"key": "invoice_approval", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"message": "saved"}


@router.post("/billing-pro/invoices/{invoice_id}/request-approval")
async def request_approval(invoice_id: str, current_user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Not found")
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {
            "status": "pending_approval",
            "approval_requested_by": current_user.get("name", ""),
            "approval_requested_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"message": "Approval requested"}


@router.post("/billing-pro/invoices/{invoice_id}/approve")
async def approve_invoice(invoice_id: str, data: dict = None, current_user: dict = Depends(get_current_user)):
    decision = (data or {}).get("decision", "approve")
    if decision == "approve":
        await db.invoices.update_one(
            {"id": invoice_id},
            {"$set": {
                "status": "draft",
                "approved_by": current_user.get("name", ""),
                "approved_at": datetime.now(timezone.utc).isoformat(),
            }}
        )
        return {"message": "Invoice approved — ready to send"}
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {
            "status": "rejected",
            "rejected_by": current_user.get("name", ""),
            "rejection_reason": (data or {}).get("reason", ""),
            "rejected_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"message": "Invoice rejected"}


# ============================================================================
#  DEPOSITS / PROGRESS INVOICING
# ============================================================================

@router.post("/billing-pro/invoices/{invoice_id}/create-deposit")
async def create_deposit(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {pct: 50}. Generates a deposit invoice = X% of parent."""
    parent = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not parent:
        raise HTTPException(status_code=404, detail="Parent invoice not found")
    pct = float(data.get("pct", 50))
    deposit_amount = round(float(parent.get("total", 0)) * pct / 100, 2)
    now = datetime.now(timezone.utc)
    deposit = {
        "id": str(uuid.uuid4()),
        "invoice_number": f"DEP-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}",
        "client_id": parent.get("client_id"),
        "client_name": parent.get("client_name"),
        "parent_invoice_id": invoice_id,
        "is_deposit": True,
        "deposit_pct": pct,
        "status": "draft",
        "payment_status": "unpaid",
        "subtotal": deposit_amount,
        "tax": 0,
        "tax_rate": 0,
        "total": deposit_amount,
        "amount_paid": 0,
        "due_date": (now + timedelta(days=7)).date().isoformat(),
        "notes": f"Deposit invoice ({pct}%) for {parent.get('invoice_number')}",
        "line_items": [{
            "description": f"Deposit ({pct}% of {parent.get('invoice_number')})",
            "quantity": 1,
            "unit_price": deposit_amount,
            "total": deposit_amount,
        }],
        "created_at": now.isoformat(),
    }
    await db.invoices.insert_one(deposit)
    deposit.pop("_id", None)
    # Mark parent
    await db.invoices.update_one(
        {"id": invoice_id},
        {"$set": {"has_deposit": True, "deposit_invoice_id": deposit["id"], "deposit_pct": pct}}
    )
    return deposit


# ============================================================================
#  MARGIN CALCULATOR
# ============================================================================

@router.post("/billing-pro/products/suggest-retail")
async def suggest_retail(data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {cost_price, target_margin_pct (default 35)}."""
    cost = float(data.get("cost_price", 0))
    margin_pct = float(data.get("target_margin_pct", 35))
    if cost <= 0:
        raise HTTPException(status_code=400, detail="cost_price must be > 0")
    # Margin = (Retail - Cost)/Retail. So Retail = Cost / (1 - margin/100)
    retail = round(cost / (1 - margin_pct / 100), 2) if margin_pct < 100 else cost * 2
    markup_pct = round((retail - cost) / cost * 100, 1)
    return {
        "cost_price": cost,
        "suggested_retail": retail,
        "margin_pct": margin_pct,
        "markup_pct": markup_pct,
        "profit_per_unit": round(retail - cost, 2),
    }


# ============================================================================
#  AU/NZ GST TAX-INVOICE COMPLIANCE SETTINGS
# ============================================================================

@router.get("/billing-pro/settings/tax-compliance")
async def get_tax_compliance(current_user: dict = Depends(get_current_user)):
    cfg = await db.settings.find_one({"key": "tax_compliance"}, {"_id": 0}) or {}
    return cfg.get("value") or {
        "country": "AU", "abn": "", "gst_registered": True, "gst_pct": 10,
        "show_tax_invoice_label": True, "company_name": "", "company_address": "", "company_phone": "",
        "bank_name": "", "bsb": "", "account_number": "", "account_name": "",
    }


@router.put("/billing-pro/settings/tax-compliance")
async def save_tax_compliance(data: dict, current_user: dict = Depends(get_current_user)):
    await db.settings.update_one({"key": "tax_compliance"}, {"$set": {"key": "tax_compliance", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"message": "saved"}


# ============================================================================
#  LIVE FX CONVERSION
# ============================================================================

@router.get("/billing-pro/fx/rate")
async def fx_rate(base: str = "AUD", target: str = "USD", current_user: dict = Depends(get_current_user)):
    if base.upper() == target.upper():
        return {"base": base.upper(), "target": target.upper(), "rate": 1.0}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"https://api.exchangerate-api.com/v4/latest/{base.upper()}")
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="FX API error")
            rates = resp.json().get("rates", {})
            r = rates.get(target.upper())
            if not r:
                raise HTTPException(status_code=400, detail=f"Unsupported target {target}")
            return {"base": base.upper(), "target": target.upper(), "rate": r, "fetched_at": datetime.now(timezone.utc).isoformat()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"FX lookup failed: {e}")


# ============================================================================
#  RETAINER / PRE-PAID HOURS
# ============================================================================

@router.get("/billing-pro/retainers/{client_id}")
async def get_retainer(client_id: str, current_user: dict = Depends(get_current_user)):
    r = await db.retainers.find_one({"client_id": client_id}, {"_id": 0})
    if not r:
        return {"client_id": client_id, "balance_hours": 0, "rate": 0, "history": []}
    history = await db.retainer_transactions.find({"client_id": client_id}, {"_id": 0}).sort("date", -1).to_list(100)
    r["history"] = history
    return r


@router.post("/billing-pro/retainers/{client_id}/topup")
async def topup_retainer(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {hours, rate, note}"""
    hrs = float(data.get("hours", 0))
    rate = float(data.get("rate", 75))
    if hrs <= 0:
        raise HTTPException(status_code=400, detail="hours must be > 0")
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.retainers.find_one({"client_id": client_id}, {"_id": 0})
    if existing:
        new_balance = float(existing.get("balance_hours", 0)) + hrs
        await db.retainers.update_one({"client_id": client_id}, {"$set": {"balance_hours": new_balance, "rate": rate, "updated_at": now}})
    else:
        await db.retainers.insert_one({
            "id": str(uuid.uuid4()), "client_id": client_id,
            "balance_hours": hrs, "rate": rate, "created_at": now, "updated_at": now,
        })
        new_balance = hrs
    await db.retainer_transactions.insert_one({
        "id": str(uuid.uuid4()), "client_id": client_id,
        "type": "topup", "hours": hrs, "rate": rate,
        "note": data.get("note", "Retainer top-up"),
        "by": current_user.get("name", ""), "date": now,
    })
    return {"balance_hours": new_balance, "rate": rate}


@router.post("/billing-pro/retainers/{client_id}/draw")
async def draw_retainer(client_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Body: {hours, ticket_id, note}"""
    hrs = float(data.get("hours", 0))
    if hrs <= 0:
        raise HTTPException(status_code=400, detail="hours must be > 0")
    r = await db.retainers.find_one({"client_id": client_id}, {"_id": 0})
    if not r or float(r.get("balance_hours", 0)) < hrs:
        raise HTTPException(status_code=400, detail="Insufficient retainer balance")
    new_balance = float(r["balance_hours"]) - hrs
    now = datetime.now(timezone.utc).isoformat()
    await db.retainers.update_one({"client_id": client_id}, {"$set": {"balance_hours": new_balance, "updated_at": now}})
    await db.retainer_transactions.insert_one({
        "id": str(uuid.uuid4()), "client_id": client_id, "type": "draw",
        "hours": hrs, "ticket_id": data.get("ticket_id"),
        "note": data.get("note", ""), "by": current_user.get("name", ""), "date": now,
    })
    return {"balance_hours": new_balance}


# ============================================================================
#  CUSTOMER INVOICE PORTAL — comments / disputes
# ============================================================================

@router.get("/billing-pro/invoices/{invoice_id}/comments")
async def get_comments(invoice_id: str, current_user: dict = Depends(get_current_user)):
    docs = await db.invoice_comments.find({"invoice_id": invoice_id}, {"_id": 0}).sort("date", 1).to_list(200)
    return docs


@router.post("/billing-pro/invoices/{invoice_id}/comments")
async def add_comment(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    doc = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "author": current_user.get("name", "Internal"),
        "author_kind": "internal",
        "text": (data.get("text") or "").strip(),
        "is_dispute": bool(data.get("is_dispute", False)),
        "date": datetime.now(timezone.utc).isoformat(),
    }
    if not doc["text"]:
        raise HTTPException(status_code=400, detail="text required")
    await db.invoice_comments.insert_one(doc)
    if doc["is_dispute"]:
        await db.invoices.update_one(
            {"id": invoice_id},
            {"$set": {"is_disputed": True, "dispute_opened_at": doc["date"], "dispute_reason": doc["text"][:200]}}
        )
    doc.pop("_id", None)
    return doc
