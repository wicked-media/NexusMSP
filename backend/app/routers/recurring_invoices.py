from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid
from pymongo.errors import DuplicateKeyError
from app.database import db
from app.auth import get_current_user

router = APIRouter()


async def _ensure_recurring_period_guard():
    """One invoice per recurring template and billing period.

    Sparse keeps legacy/manual invoices (which have no billing_period) out of the
    unique constraint while protecting every generated recurring invoice.
    """
    await db.invoices.create_index(
        [("recurring_invoice_id", 1), ("billing_period", 1)],
        unique=True,
        sparse=True,
        name="recurring_invoice_billing_period_unique",
    )


async def _resolve_source_driven_lines(recurring: dict) -> list:
    """Refresh live asset/stock quantities at the moment of invoicing."""
    resolved = []
    for line in recurring.get("line_items", []):
        if line.get("acronis_auto") or line.get("pax8_auto") or line.get("yeastar_auto"):
            continue
        updated = dict(line)
        source = line.get("billing_source", "manual")
        source_id = line.get("source_line_item_id")
        source_item = await db.line_items.find_one({"id": source_id}, {"_id": 0}) if source_id else None
        if source == "asset_count" and source_item:
            query = {"client_id": recurring.get("client_id"), "status": "active"}
            if source_item.get("asset_type_filter"):
                query["asset_type"] = source_item["asset_type_filter"]
            updated["quantity"] = await db.assets.count_documents(query)
            updated["details"] = f"Live asset count{': ' + source_item['asset_type_filter'] if source_item.get('asset_type_filter') else ''}"
        elif source == "inventory" and source_item and source_item.get("product_id"):
            product = await db.products.find_one({"id": source_item["product_id"]}, {"_id": 0, "quantity_in_stock": 1})
            updated["quantity"] = int((product or {}).get("quantity_in_stock", 0))
            updated["details"] = "Live warehouse stock level"
        updated["amount"] = round(float(updated.get("quantity", 0)) * float(updated.get("rate", 0)), 2)
        resolved.append(updated)
    return resolved


async def _resolve_yeastar_usage_lines_legacy(recurring: dict, current_user: dict) -> list:
    """Attach only product-mapped, client-scoped Yeastar extension usage."""
    if not recurring.get("include_yeastar_usage") or not recurring.get("client_id"):
        return []
    try:
        from app.routers.yeastar import get_client_yeastar_billing
        usage = await get_client_yeastar_billing(recurring["client_id"], current_user=current_user)
        if not usage.get("linked") or not usage.get("billing_ready"):
            return []
        return [{
            "description": f"Yeastar — {item['pbx_name']} ({usage['period']})",
            "details": f"{item['quantity']} live billable extensions × {usage['currency']} {item['unit_price']:.4f}",
            "quantity": item["quantity"], "rate": item["unit_price"], "amount": item["total"],
            "yeastar_auto": True, "yeastar_pbx_id": item["pbx_id"],
            "yeastar_product_id": item["product_id"], "yeastar_period": usage["period"],
        } for item in usage.get("line_items", [])]
    except Exception:
        # A provider outage must not prevent the rest of a recurring invoice from generating.
        return []


async def _resolve_yeastar_usage_lines(recurring: dict, current_user: dict) -> list:
    """Attach verified Yeastar usage, failing closed to prevent underbilling."""
    if not recurring.get("include_yeastar_usage") or not recurring.get("client_id"):
        return []
    try:
        from app.routers.yeastar import get_client_yeastar_billing
        usage = await get_client_yeastar_billing(recurring["client_id"], current_user=current_user)
        if not usage.get("linked"):
            raise HTTPException(status_code=409, detail="Yeastar billing is enabled but no active PBX is linked to this client")
        if not usage.get("billing_ready"):
            missing = ", ".join(
                item.get("pbx_name") or "Yeastar PBX"
                for item in usage.get("missing_mappings", [])
            ) or "one or more PBXs"
            raise HTTPException(
                status_code=409,
                detail=f"Yeastar billing cannot be reconciled until product mappings are complete ({missing})",
            )
        return [{
            "description": f"Yeastar - {item['pbx_name']} ({usage['period']})",
            "details": f"{item['quantity']} live billable extensions x {usage['currency']} {item['unit_price']:.4f}",
            "quantity": item["quantity"], "rate": item["unit_price"], "amount": item["total"],
            "yeastar_auto": True, "yeastar_pbx_id": item["pbx_id"],
            "yeastar_product_id": item["product_id"], "yeastar_period": usage["period"],
        } for item in usage.get("line_items", [])]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Yeastar usage could not be verified; no potentially incomplete invoice was generated",
        ) from exc


async def _deliver_recurring_invoice(invoice: dict, recurring: dict, current_user: dict) -> dict:
    """Use the normal invoice email pipeline and persist an auditable outcome."""
    if not recurring.get("auto_send"):
        return {"requested": False, "status": "not_requested"}
    recipient = str(recurring.get("auto_send_email") or "").strip()
    if not recipient:
        return {"requested": True, "status": "not_configured", "message": "No auto-send recipient configured"}
    try:
        from app.routers.invoice_enhanced import email_invoice_to_client
        result = await email_invoice_to_client(invoice["id"], {"email": recipient}, current_user)
        return {"requested": True, "status": result.get("delivery_status", "failed"), "recipient": recipient, "message": result.get("message", "")}
    except HTTPException as exc:
        return {"requested": True, "status": "failed", "recipient": recipient, "message": str(exc.detail)}
    except Exception as exc:
        return {"requested": True, "status": "failed", "recipient": recipient, "message": str(exc)}

# ============== RECURRING INVOICE TEMPLATES ==============

@router.get("/recurring-invoices/list")
async def get_recurring_invoices(current_user: dict = Depends(get_current_user)):
    invoices = await db.recurring_invoices.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    if not invoices:
        invoices = await _seed_recurring()
    return invoices


@router.get("/recurring-invoices/stats")
async def get_recurring_stats(current_user: dict = Depends(get_current_user)):
    all_ri = await db.recurring_invoices.find({}, {"_id": 0}).to_list(500)
    active = [r for r in all_ri if r.get("status") == "active"]
    paused = [r for r in all_ri if r.get("status") == "paused"]
    monthly = [r for r in active if r.get("frequency") == "monthly"]
    quarterly = [r for r in active if r.get("frequency") == "quarterly"]
    annual = [r for r in active if r.get("frequency") == "annually"]
    mrr = sum(r.get("amount", 0) for r in monthly)
    arr = mrr * 12 + sum(r.get("amount", 0) for r in quarterly) * 4 + sum(r.get("amount", 0) for r in annual)
    total_generated = sum(r.get("invoices_generated", 0) for r in all_ri)
    total_revenue = sum(r.get("total_billed", 0) for r in all_ri)
    # Due this week
    now = datetime.now(timezone.utc)
    week_end = now + timedelta(days=7)
    due_soon = 0
    for r in active:
        try:
            nd = datetime.strptime(r.get("next_generation", ""), "%Y-%m-%d").replace(tzinfo=timezone.utc)
            if nd <= week_end:
                due_soon += 1
        except:
            pass
    return {
        "total": len(all_ri), "active": len(active), "paused": len(paused),
        "mrr": round(mrr, 2), "arr": round(arr, 2),
        "total_generated": total_generated, "total_revenue": round(total_revenue, 2),
        "due_this_week": due_soon,
        "by_frequency": {"monthly": len(monthly), "quarterly": len(quarterly), "annually": len(annual)},
    }


@router.get("/recurring-invoices/{ri_id}")
async def get_recurring_invoice(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Recurring invoice not found")
    return ri


@router.post("/recurring-invoices/create")
async def create_recurring(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    line_items = data.get("line_items", [])
    if not data.get("client_id") or not str(data.get("description", "")).strip():
        raise HTTPException(status_code=400, detail="Client and description are required")
    if not line_items:
        raise HTTPException(status_code=400, detail="At least one recurring invoice line is required")
    for line in line_items:
        if not str(line.get("description", "")).strip():
            raise HTTPException(status_code=400, detail="Each recurring invoice line needs a description")
        if float(line.get("quantity", 0)) <= 0 or float(line.get("rate", 0)) < 0:
            raise HTTPException(status_code=400, detail="Each recurring invoice line needs a positive quantity and valid rate")
    if data.get("auto_send") and not str(data.get("auto_send_email", "")).strip():
        raise HTTPException(status_code=400, detail="An email recipient is required when auto-send is enabled")

    # Calculate amount from line items
    subtotal = sum(float(li.get("amount", 0)) for li in line_items)
    tax_rate = float(data.get("tax_rate", 0))
    tax_amount = round(subtotal * tax_rate / 100, 2)
    total = round(subtotal + tax_amount, 2)

    # Calculate next generation date
    start_date = data.get("start_date") or now.strftime("%Y-%m-%d")
    frequency = data.get("frequency", "monthly")

    inv = {
        "id": f"ri-{uuid.uuid4().hex[:8]}",
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "description": data.get("description", ""),
        "line_items": line_items,
        "subtotal": subtotal,
        "tax_rate": tax_rate,
        "tax_amount": tax_amount,
        "amount": total,
        "currency": data.get("currency", "AUD"),
        "frequency": frequency,
        "start_date": start_date,
        "next_generation": _calc_next_date(start_date, frequency),
        "end_date": data.get("end_date"),
        "contract_id": data.get("contract_id"),
        "payment_terms": data.get("payment_terms", "net_30"),
        "notes": data.get("notes", ""),
        "auto_send": data.get("auto_send", False),
        "auto_send_email": data.get("auto_send_email", ""),
        "include_pdf": data.get("include_pdf", True),
        "include_acronis_usage": bool(data.get("include_acronis_usage", False)),
        "include_pax8_usage": bool(data.get("include_pax8_usage", False)),
        "status": "active",
        "invoices_generated": 0,
        "total_billed": 0,
        "last_generated": None,
        "generation_history": [],
        "created_by": current_user.get("name", ""),
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await db.recurring_invoices.insert_one(inv)
    return {k: v for k, v in inv.items() if k != "_id"}


@router.put("/recurring-invoices/{ri_id}")
async def update_recurring(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id})
    if not ri:
        raise HTTPException(status_code=404, detail="Recurring invoice not found")
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at", "created_by")}
    # Recalculate amount if line_items changed
    if "line_items" in update:
        if not update["line_items"]:
            raise HTTPException(status_code=400, detail="At least one recurring invoice line is required")
        for line in update["line_items"]:
            if not str(line.get("description", "")).strip():
                raise HTTPException(status_code=400, detail="Each recurring invoice line needs a description")
            if float(line.get("quantity", 0)) <= 0 or float(line.get("rate", 0)) < 0:
                raise HTTPException(status_code=400, detail="Each recurring invoice line needs a positive quantity and valid rate")
        subtotal = sum(float(li.get("amount", 0)) for li in update["line_items"])
        tax_rate = float(update.get("tax_rate", ri.get("tax_rate", 0)))
        update["subtotal"] = subtotal
        update["tax_amount"] = round(subtotal * tax_rate / 100, 2)
        update["amount"] = round(subtotal + update["tax_amount"], 2)
    if update.get("auto_send", ri.get("auto_send", False)) and not str(update.get("auto_send_email", ri.get("auto_send_email", ""))).strip():
        raise HTTPException(status_code=400, detail="An email recipient is required when auto-send is enabled")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.recurring_invoices.update_one({"id": ri_id}, {"$set": update})
    return {"message": "Updated"}


@router.delete("/recurring-invoices/{ri_id}")
async def delete_recurring(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0, "invoices_generated": 1, "generation_history": 1})
    if not ri:
        raise HTTPException(status_code=404, detail="Not found")
    if ri.get("invoices_generated", 0) > 0 or ri.get("generation_history"):
        raise HTTPException(status_code=400, detail="Recurring invoices with generated invoice history are retained for financial traceability")
    result = await db.recurring_invoices.delete_one({"id": ri_id})
    return {"message": "Deleted"}


@router.get("/recurring-invoices/by-client/{client_id}")
async def get_recurring_by_client(client_id: str, current_user: dict = Depends(get_current_user)):
    """Return active recurring invoices for a specific client (used by Acronis link UI)."""
    docs = await db.recurring_invoices.find(
        {"client_id": client_id},
        {"_id": 0, "id": 1, "description": 1, "amount": 1, "currency": 1, "frequency": 1,
         "status": 1, "include_acronis_usage": 1, "next_generation": 1, "last_generated": 1,
         "invoices_generated": 1, "total_billed": 1}
    ).sort("status", 1).to_list(100)
    return docs


@router.post("/recurring-invoices/{ri_id}/set-acronis-auto")
async def set_acronis_auto(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Toggle the include_acronis_usage flag on a specific recurring invoice."""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Not found")
    enabled = bool(data.get("include_acronis_usage", True))
    await db.recurring_invoices.update_one(
        {"id": ri_id},
        {"$set": {
            "include_acronis_usage": enabled,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"message": f"Acronis auto-billing {'enabled' if enabled else 'disabled'} on {ri_id}", "include_acronis_usage": enabled}


@router.post("/recurring-invoices/{ri_id}/toggle")
async def toggle_recurring(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Not found")
    if ri.get("status") not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Only active or paused recurring invoices can be toggled")
    new_status = "paused" if ri.get("status") == "active" else "active"
    await db.recurring_invoices.update_one({"id": ri_id}, {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": new_status}


@router.post("/recurring-invoices/{ri_id}/generate-now")
async def generate_invoice_now(ri_id: str, current_user: dict = Depends(get_current_user)):
    """Manually generate an invoice from a recurring template right now.
    If the linked contract's client has an Acronis tenant and `include_acronis_usage=True`,
    fresh Acronis usage line items are auto-attached for the current period."""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Not found")
    if ri.get("status") != "active":
        raise HTTPException(status_code=400, detail="Activate the recurring invoice before generating an invoice")

    now = datetime.now(timezone.utc)
    billing_period = ri.get("next_generation") or now.strftime("%Y-%m-%d")
    await _ensure_recurring_period_guard()
    existing = await db.invoices.find_one(
        {"recurring_invoice_id": ri_id, "billing_period": billing_period}, {"_id": 0, "id": 1, "invoice_number": 1}
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"An invoice ({existing.get('invoice_number', existing.get('id'))}) already exists for the {billing_period} billing period",
        )
    inv_number = f"INV-{now.strftime('%Y%m')}-{uuid.uuid4().hex[:4].upper()}"
    due_date = _calc_due_date(ri.get("payment_terms", "net_30"))

    # Start with the template's static line items (excluding any prior auto-attach)
    line_items = await _resolve_source_driven_lines(ri)

    # Auto-attach Acronis usage if enabled and client is linked
    acronis_attached = []
    if ri.get("include_acronis_usage", False) and ri.get("client_id"):
        try:
            from app.routers.acronis import get_client_acronis_billing
            acr = await get_client_acronis_billing(ri["client_id"], current_user=current_user)
            if acr.get("linked") and acr.get("total", 0) > 0:
                for li in acr.get("line_items", []):
                    acronis_attached.append({
                        "description": f"Acronis — {li['label']} ({acr['period']})",
                        "details": f"{li['quantity']} {li['unit']} × {acr['currency']} {li['unit_price']:.4f}",
                        "quantity": li["quantity"],
                        "rate": li["unit_price"],
                        "amount": li["total"],
                        "acronis_auto": True,
                        "acronis_period": acr["period"],
                    })
                line_items.extend(acronis_attached)
        except Exception:
            pass  # Don't block invoice generation on Acronis failure

    # Auto-attach Pax8 / Microsoft subscription usage
    pax8_attached = []
    if ri.get("include_pax8_usage", False) and ri.get("client_id"):
        try:
            from app.routers.pax8 import pax8_billing_client
            p8 = await pax8_billing_client(ri["client_id"], current_user=current_user)
            if p8.get("linked") and p8.get("total", 0) > 0:
                for li in p8.get("line_items", []):
                    pax8_attached.append({
                        "description": f"Pax8 — {li['label']} ({p8['period']})",
                        "details": f"{li['quantity']} {li['unit']} × {li['currency']} {li['unit_price']:.4f} · {li['billing_term']}",
                        "quantity": li["quantity"],
                        "rate": li["unit_price"],
                        "amount": li["total"],
                        "pax8_auto": True,
                        "pax8_product_id": li.get("product_id"),
                        "pax8_period": p8["period"],
                        "pax8_billing_term": li["billing_term"],
                    })
                line_items.extend(pax8_attached)
        except Exception:
            pass

    yeastar_attached = await _resolve_yeastar_usage_lines(ri, current_user)
    line_items.extend(yeastar_attached)

    # Recompute totals
    subtotal = round(sum(float(li.get("amount", 0)) for li in line_items), 2)
    tax_rate = float(ri.get("tax_rate", 0))
    tax_amount = round(subtotal * tax_rate / 100, 2)
    total = round(subtotal + tax_amount, 2)

    invoice = {
        "id": f"inv-{uuid.uuid4().hex[:8]}",
        "invoice_number": inv_number,
        "invoice_name": str(ri.get("invoice_name") or ri.get("description") or "").strip()[:160] or None,
        "client_id": ri.get("client_id", ""),
        "client_name": ri.get("client_name", ""),
        "description": ri.get("description", ""),
        "line_items": line_items,
        "subtotal": subtotal,
        "tax_rate": tax_rate,
        "tax_amount": tax_amount,
        "total": total,
        "amount_due": total,
        "amount_paid": 0,
        "currency": ri.get("currency", "AUD"),
        # A generated invoice is a draft until the verified email pipeline confirms delivery.
        "status": "draft",
        "payment_status": "unpaid",
        "due_date": due_date,
        "recurring_invoice_id": ri_id,
        "billing_period": billing_period,
        "notes": ri.get("notes", ""),
        "acronis_auto_attached": len(acronis_attached),
        "pax8_auto_attached": len(pax8_attached),
        "yeastar_auto_attached": len(yeastar_attached),
        "created_at": now.isoformat(),
        "created_by": current_user.get("name", ""),
    }
    try:
        await db.invoices.insert_one(invoice)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail=f"An invoice already exists for the {billing_period} billing period")
    delivery = await _deliver_recurring_invoice(invoice, ri, current_user)
    await db.invoices.update_one({"id": invoice["id"]}, {"$set": {"recurring_delivery": delivery}})

    # Update recurring invoice stats
    gen_entry = {"invoice_id": invoice["id"], "invoice_number": inv_number, "amount": total,
                 "generated_at": now.isoformat(), "generated_by": current_user.get("name", ""),
                 "acronis_items": len(acronis_attached),
                 "pax8_items": len(pax8_attached), "yeastar_items": len(yeastar_attached), "delivery": delivery}
    next_date = _calc_next_date(now.strftime("%Y-%m-%d"), ri.get("frequency", "monthly"))
    await db.recurring_invoices.update_one({"id": ri_id}, {
        "$inc": {"invoices_generated": 1, "total_billed": total},
        "$set": {"last_generated": now.isoformat(), "next_generation": next_date, "updated_at": now.isoformat()},
        "$push": {"generation_history": gen_entry},
    })

    msg = f"Invoice {inv_number} generated"
    extras = []
    if acronis_attached:
        extras.append(f"{len(acronis_attached)} Acronis")
    if pax8_attached:
        extras.append(f"{len(pax8_attached)} Pax8")
    if yeastar_attached:
        extras.append(f"{len(yeastar_attached)} Yeastar")
    if extras:
        msg += f" (+{' + '.join(extras)} auto-attached line items)"
    return {"message": msg, "invoice_id": invoice["id"], "invoice_number": inv_number,
            "amount": total, "acronis_items": len(acronis_attached), "pax8_items": len(pax8_attached), "yeastar_items": len(yeastar_attached),
            "delivery": delivery}


@router.post("/recurring-invoices/{ri_id}/duplicate")
async def duplicate_recurring(ri_id: str, current_user: dict = Depends(get_current_user)):
    """Duplicate a recurring invoice template."""
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc)
    new_ri = {**ri}
    new_ri["id"] = f"ri-{uuid.uuid4().hex[:8]}"
    new_ri["description"] = f"(Copy) {ri.get('description', '')}"
    new_ri["status"] = "paused"
    new_ri["invoices_generated"] = 0
    new_ri["total_billed"] = 0
    new_ri["last_generated"] = None
    new_ri["generation_history"] = []
    new_ri["created_by"] = current_user.get("name", "")
    new_ri["created_at"] = now.isoformat()
    new_ri["updated_at"] = now.isoformat()
    await db.recurring_invoices.insert_one(new_ri)
    return {k: v for k, v in new_ri.items() if k != "_id"}


@router.get("/recurring-invoices/{ri_id}/history")
async def get_generation_history(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await db.recurring_invoices.find_one({"id": ri_id}, {"_id": 0})
    if not ri:
        raise HTTPException(status_code=404, detail="Not found")
    return ri.get("generation_history", [])


# ============== INVOICE TEMPLATES (reusable billing templates) ==============

@router.get("/invoice-templates")
async def get_invoice_templates(current_user: dict = Depends(get_current_user)):
    templates = await db.invoice_templates.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return templates


@router.post("/invoice-templates")
async def create_invoice_template(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    template = {
        "id": f"it-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", "Untitled Template"),
        "description": data.get("description", ""),
        "line_items": data.get("line_items", []),
        "tax_rate": data.get("tax_rate", 10),
        "payment_terms": data.get("payment_terms", "net_30"),
        "notes": data.get("notes", ""),
        "currency": data.get("currency", "AUD"),
        "category": data.get("category", "general"),
        "usage_count": 0,
        "created_by": current_user.get("name", ""),
        "created_at": now,
        "updated_at": now,
    }
    await db.invoice_templates.insert_one(template)
    return {k: v for k, v in template.items() if k != "_id"}


@router.put("/invoice-templates/{template_id}")
async def update_invoice_template(template_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    tpl = await db.invoice_templates.find_one({"id": template_id})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at", "created_by")}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.invoice_templates.update_one({"id": template_id}, {"$set": update})
    return {"message": "Template updated"}


@router.delete("/invoice-templates/{template_id}")
async def delete_invoice_template(template_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.invoice_templates.delete_one({"id": template_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Template deleted"}


@router.post("/invoice-templates/{template_id}/apply")
async def apply_template_to_recurring(template_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    """Create a recurring invoice from a template."""
    tpl = await db.invoice_templates.find_one({"id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    # Increment usage count
    await db.invoice_templates.update_one({"id": template_id}, {"$inc": {"usage_count": 1}})
    # Create recurring invoice with template data
    create_data = {
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "description": tpl.get("name", ""),
        "line_items": tpl.get("line_items", []),
        "tax_rate": tpl.get("tax_rate", 10),
        "payment_terms": tpl.get("payment_terms", "net_30"),
        "notes": tpl.get("notes", ""),
        "currency": tpl.get("currency", "AUD"),
        "frequency": data.get("frequency", "monthly"),
        "start_date": data.get("start_date"),
        "auto_send": data.get("auto_send", False),
        "auto_send_email": data.get("auto_send_email", ""),
    }
    return await create_recurring(create_data, current_user)



# ============== SCHEDULER STATUS & LOGS ==============

@router.get("/recurring-invoices/scheduler/status")
async def get_scheduler_status(current_user: dict = Depends(get_current_user)):
    """Get the auto-generation scheduler status and recent logs."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    # Count due invoices
    due_count = await db.recurring_invoices.count_documents({
        "status": "active",
        "next_generation": {"$lte": today_str},
    })

    # Recent scheduler logs
    logs = await db.scheduler_logs.find(
        {"type": {"$in": ["recurring_invoice", "recurring_invoice_error"]}},
        {"_id": 0}
    ).sort("timestamp", -1).to_list(20)
    latest_log = logs[0] if logs else None

    # Stats
    total_auto_generated = await db.scheduler_logs.count_documents({"type": "recurring_invoice"})
    errors = await db.scheduler_logs.count_documents({"type": "recurring_invoice_error"})

    return {
        "scheduler_active": True,
        "check_interval_seconds": 300,
        "due_now": due_count,
        "total_auto_generated": total_auto_generated,
        "total_errors": errors,
        "last_activity_at": latest_log.get("timestamp") if latest_log else None,
        "last_activity_status": latest_log.get("status") if latest_log else None,
        "recent_logs": logs,
    }


@router.post("/recurring-invoices/scheduler/run-now")
async def run_scheduler_now(current_user: dict = Depends(get_current_user)):
    """Manually trigger the scheduler to process all due recurring invoices."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")
    actor_name = current_user.get("name") or "Manual Scheduler Run"

    due_invoices = await db.recurring_invoices.find({
        "status": "active",
        "next_generation": {"$lte": today_str},
    }, {"_id": 0}).to_list(100)
    await _ensure_recurring_period_guard()

    results = []
    for ri in due_invoices:
        try:
            billing_period = ri.get("next_generation") or today_str
            inv_number = f"INV-{now.strftime('%Y%m')}-{uuid.uuid4().hex[:4].upper()}"
            due_date = _calc_due_date(ri.get("payment_terms", "net_30"))

            # Start from static line items (strip any prior auto-attach)
            line_items = await _resolve_source_driven_lines(ri)
            acronis_attached = []
            pax8_attached = []

            # Auto-attach Acronis usage if enabled — parity with /generate-now
            if ri.get("include_acronis_usage", False) and ri.get("client_id"):
                try:
                    from app.routers.acronis import get_client_acronis_billing
                    acr = await get_client_acronis_billing(ri["client_id"], current_user=current_user)
                    if acr.get("linked") and acr.get("total", 0) > 0:
                        for li in acr.get("line_items", []):
                            acronis_attached.append({
                                "description": f"Acronis — {li['label']} ({acr['period']})",
                                "details": f"{li['quantity']} {li['unit']} × {acr['currency']} {li['unit_price']:.4f}",
                                "quantity": li["quantity"],
                                "rate": li["unit_price"],
                                "amount": li["total"],
                                "acronis_auto": True,
                                "acronis_period": acr["period"],
                            })
                        line_items.extend(acronis_attached)
                except Exception:
                    pass  # Don't block scheduler on Acronis failure

            # Auto-attach Pax8 subscription usage if enabled
            if ri.get("include_pax8_usage", False) and ri.get("client_id"):
                try:
                    from app.routers.pax8 import pax8_billing_client
                    p8 = await pax8_billing_client(ri["client_id"], current_user=current_user)
                    if p8.get("linked") and p8.get("total", 0) > 0:
                        for li in p8.get("line_items", []):
                            pax8_attached.append({
                                "description": f"Pax8 — {li['label']} ({p8['period']})",
                                "details": f"{li['quantity']} {li['unit']} × {li['currency']} {li['unit_price']:.4f} · {li['billing_term']}",
                                "quantity": li["quantity"],
                                "rate": li["unit_price"],
                                "amount": li["total"],
                                "pax8_auto": True,
                                "pax8_product_id": li.get("product_id"),
                                "pax8_period": p8["period"],
                                "pax8_billing_term": li["billing_term"],
                            })
                        line_items.extend(pax8_attached)
                except Exception:
                    pass

            yeastar_attached = await _resolve_yeastar_usage_lines(ri, current_user)
            line_items.extend(yeastar_attached)

            subtotal = round(sum(float(li.get("amount", 0)) for li in line_items), 2)
            tax_rate = float(ri.get("tax_rate", 0))
            tax_amount = round(subtotal * tax_rate / 100, 2)
            total = round(subtotal + tax_amount, 2)

            invoice = {
                "id": f"inv-{uuid.uuid4().hex[:8]}",
                "invoice_number": inv_number,
                "invoice_name": str(ri.get("invoice_name") or ri.get("description") or "").strip()[:160] or None,
                "client_id": ri.get("client_id", ""),
                "client_name": ri.get("client_name", ""),
                "description": ri.get("description", ""),
                "line_items": line_items,
                "subtotal": subtotal,
                "tax_rate": tax_rate,
                "tax_amount": tax_amount,
                "total": total,
                "amount_due": total,
                "amount_paid": 0,
                "currency": ri.get("currency", "AUD"),
                # Do not represent a generated invoice as sent before delivery succeeds.
                "status": "draft",
                "payment_status": "unpaid",
                "due_date": due_date,
                "recurring_invoice_id": ri["id"],
                "billing_period": billing_period,
                "notes": ri.get("notes", ""),
                "auto_generated": True,
                "acronis_auto_attached": len(acronis_attached),
                "pax8_auto_attached": len(pax8_attached),
                "yeastar_auto_attached": len(yeastar_attached),
                "created_at": now.isoformat(),
                "created_by": actor_name,
            }
            try:
                await db.invoices.insert_one(invoice)
            except DuplicateKeyError:
                results.append({"ri_id": ri["id"], "client": ri.get("client_name"), "status": "skipped", "reason": f"Invoice already exists for {billing_period}"})
                continue
            delivery = await _deliver_recurring_invoice(invoice, ri, current_user)
            await db.invoices.update_one({"id": invoice["id"]}, {"$set": {"recurring_delivery": delivery}})

            next_date = _calc_next_date(today_str, ri.get("frequency", "monthly"))
            gen_entry = {"invoice_id": invoice["id"], "invoice_number": inv_number, "amount": total, "generated_at": now.isoformat(), "generated_by": actor_name, "acronis_items": len(acronis_attached), "pax8_items": len(pax8_attached), "yeastar_items": len(yeastar_attached), "delivery": delivery}
            await db.recurring_invoices.update_one({"id": ri["id"]}, {
                "$inc": {"invoices_generated": 1, "total_billed": total},
                "$set": {"last_generated": now.isoformat(), "next_generation": next_date, "updated_at": now.isoformat()},
                "$push": {"generation_history": gen_entry},
            })

            await db.scheduler_logs.insert_one({
                "id": f"slog-{uuid.uuid4().hex[:8]}", "type": "recurring_invoice",
                "recurring_invoice_id": ri["id"], "invoice_id": invoice["id"],
                "invoice_number": inv_number, "client_name": ri.get("client_name", ""),
                "amount": total, "status": "generated",
                "acronis_items": len(acronis_attached),
                "pax8_items": len(pax8_attached),
                "yeastar_items": len(yeastar_attached),
                "delivery": delivery,
                "triggered_by": actor_name, "timestamp": now.isoformat(),
            })
            results.append({"ri_id": ri["id"], "client": ri.get("client_name"), "invoice": inv_number, "amount": total, "acronis_items": len(acronis_attached), "pax8_items": len(pax8_attached), "delivery": delivery, "status": "generated"})
        except Exception as e:
            results.append({"ri_id": ri["id"], "client": ri.get("client_name"), "status": "error", "error": str(e)})

    generated_count = sum(1 for result in results if result.get("status") == "generated")
    skipped_duplicates = sum(1 for result in results if result.get("status") == "skipped")
    return {
        "processed": len(results),
        "generated": generated_count,
        "skipped_duplicates": skipped_duplicates,
        "results": results,
    }


# ============== HELPERS ==============

def _calc_next_date(from_date_str: str, frequency: str) -> str:
    try:
        d = datetime.strptime(from_date_str, "%Y-%m-%d")
    except:
        d = datetime.now(timezone.utc)
    if frequency == "weekly":
        d += timedelta(days=7)
    elif frequency == "fortnightly":
        d += timedelta(days=14)
    elif frequency == "monthly":
        month = d.month + 1
        year = d.year
        if month > 12:
            month = 1
            year += 1
        day = min(d.day, 28)
        d = d.replace(year=year, month=month, day=day)
    elif frequency == "quarterly":
        month = d.month + 3
        year = d.year
        while month > 12:
            month -= 12
            year += 1
        day = min(d.day, 28)
        d = d.replace(year=year, month=month, day=day)
    elif frequency == "annually":
        d = d.replace(year=d.year + 1)
    else:
        d += timedelta(days=30)
    return d.strftime("%Y-%m-%d")


def _calc_due_date(payment_terms: str) -> str:
    now = datetime.now(timezone.utc)
    days_map = {"due_on_receipt": 0, "net_7": 7, "net_14": 14, "net_30": 30, "net_45": 45, "net_60": 60, "net_90": 90}
    days = days_map.get(payment_terms, 30)
    return (now + timedelta(days=days)).strftime("%Y-%m-%d")


async def _seed_recurring():
    now = datetime.now(timezone.utc)
    invoices = [
        {"id": "ri-001", "client_id": "client-001", "client_name": "Acme Corporation", "description": "Monthly Managed IT Services", "amount": 4500.00, "subtotal": 4090.91, "tax_rate": 10, "tax_amount": 409.09, "currency": "AUD", "frequency": "monthly", "next_generation": (now + timedelta(days=12)).strftime("%Y-%m-%d"), "start_date": "2025-01-01", "contract_id": "contract-001", "payment_terms": "net_30", "auto_send": True, "auto_send_email": "accounts@acme.com", "include_pdf": True, "line_items": [{"description": "Managed IT - 45 endpoints @ $85/ep", "quantity": 45, "rate": 85, "amount": 3825}, {"description": "M365 License Management", "quantity": 1, "rate": 265.91, "amount": 265.91}], "status": "active", "invoices_generated": 14, "total_billed": 63000, "last_generated": (now - timedelta(days=18)).isoformat(), "generation_history": [], "notes": "Standard managed services agreement", "created_by": "Alex Thompson", "created_at": (now - timedelta(days=420)).isoformat(), "updated_at": now.isoformat()},
        {"id": "ri-002", "client_id": "client-003", "client_name": "Global Finance Ltd", "description": "Monthly IT Support & Security", "amount": 12800.00, "subtotal": 11636.36, "tax_rate": 10, "tax_amount": 1163.64, "currency": "AUD", "frequency": "monthly", "next_generation": (now + timedelta(days=5)).strftime("%Y-%m-%d"), "start_date": "2024-01-01", "payment_terms": "net_14", "auto_send": True, "auto_send_email": "finance@globalfin.com", "include_pdf": True, "line_items": [{"description": "Premium IT Management - 120 endpoints", "quantity": 120, "rate": 75, "amount": 9000}, {"description": "24/7 SOC Monitoring", "quantity": 1, "rate": 1800, "amount": 1800}, {"description": "Compliance Management (PCI-DSS)", "quantity": 1, "rate": 836.36, "amount": 836.36}], "status": "active", "invoices_generated": 24, "total_billed": 307200, "last_generated": (now - timedelta(days=25)).isoformat(), "generation_history": [], "created_by": "Alex Thompson", "created_at": (now - timedelta(days=730)).isoformat(), "updated_at": now.isoformat()},
        {"id": "ri-003", "client_id": "client-004", "client_name": "HealthCare Plus", "description": "HIPAA Compliant IT Management", "amount": 7200.00, "subtotal": 6545.45, "tax_rate": 10, "tax_amount": 654.55, "currency": "AUD", "frequency": "monthly", "next_generation": (now + timedelta(days=8)).strftime("%Y-%m-%d"), "start_date": "2024-06-01", "payment_terms": "net_30", "auto_send": False, "line_items": [{"description": "Healthcare IT Management - 67 endpoints", "quantity": 67, "rate": 85, "amount": 5695}, {"description": "HIPAA Compliance Monitoring", "quantity": 1, "rate": 850.45, "amount": 850.45}], "status": "active", "invoices_generated": 18, "total_billed": 129600, "last_generated": (now - timedelta(days=22)).isoformat(), "generation_history": [], "created_by": "Sarah Chen", "created_at": (now - timedelta(days=540)).isoformat(), "updated_at": now.isoformat()},
        {"id": "ri-004", "client_id": "client-002", "client_name": "TechStart Inc", "description": "Quarterly Security Audit & Pen Test", "amount": 3500.00, "subtotal": 3181.82, "tax_rate": 10, "tax_amount": 318.18, "currency": "AUD", "frequency": "quarterly", "next_generation": (now + timedelta(days=45)).strftime("%Y-%m-%d"), "start_date": "2025-01-01", "payment_terms": "net_30", "auto_send": True, "auto_send_email": "billing@techstart.io", "line_items": [{"description": "External Penetration Test", "quantity": 1, "rate": 2000, "amount": 2000}, {"description": "Internal Vulnerability Scan", "quantity": 1, "rate": 800, "amount": 800}, {"description": "Report & Remediation Plan", "quantity": 1, "rate": 381.82, "amount": 381.82}], "status": "active", "invoices_generated": 4, "total_billed": 14000, "last_generated": (now - timedelta(days=60)).isoformat(), "generation_history": [], "created_by": "Alex Thompson", "created_at": (now - timedelta(days=365)).isoformat(), "updated_at": now.isoformat()},
        {"id": "ri-005", "client_id": "client-006", "client_name": "Summit Legal Group", "description": "Monthly IT Services + Legal Compliance", "amount": 5600.00, "subtotal": 5090.91, "tax_rate": 10, "tax_amount": 509.09, "currency": "AUD", "frequency": "monthly", "next_generation": (now + timedelta(days=15)).strftime("%Y-%m-%d"), "start_date": "2025-06-01", "payment_terms": "net_30", "auto_send": True, "auto_send_email": "admin@summitlegal.com", "line_items": [{"description": "Managed IT - 22 endpoints", "quantity": 22, "rate": 95, "amount": 2090}, {"description": "Document Management System", "quantity": 1, "rate": 1500, "amount": 1500}, {"description": "Legal DMS Compliance Pack", "quantity": 1, "rate": 1500.91, "amount": 1500.91}], "status": "active", "invoices_generated": 8, "total_billed": 44800, "last_generated": (now - timedelta(days=15)).isoformat(), "generation_history": [], "created_by": "Mike Rodriguez", "created_at": (now - timedelta(days=240)).isoformat(), "updated_at": now.isoformat()},
        {"id": "ri-006", "client_id": "client-005", "client_name": "RetailMax", "description": "Monthly POS & IT Support", "amount": 2800.00, "subtotal": 2545.45, "tax_rate": 10, "tax_amount": 254.55, "currency": "AUD", "frequency": "monthly", "next_generation": (now + timedelta(days=20)).strftime("%Y-%m-%d"), "start_date": "2025-03-01", "payment_terms": "net_14", "auto_send": True, "line_items": [{"description": "POS System Management - 8 terminals", "quantity": 8, "rate": 120, "amount": 960}, {"description": "Network & Security", "quantity": 1, "rate": 800, "amount": 800}, {"description": "Help Desk Support", "quantity": 1, "rate": 785.45, "amount": 785.45}], "status": "active", "invoices_generated": 11, "total_billed": 30800, "last_generated": (now - timedelta(days=10)).isoformat(), "generation_history": [], "created_by": "Lisa Park", "created_at": (now - timedelta(days=330)).isoformat(), "updated_at": now.isoformat()},
    ]
    # Also seed invoice templates
    templates = [
        {"id": "it-001", "name": "Standard MSP Monthly", "description": "Per-endpoint managed services with M365 management", "line_items": [{"description": "Managed IT Services - per endpoint", "quantity": 1, "rate": 85, "amount": 85}, {"description": "M365 License Management", "quantity": 1, "rate": 250, "amount": 250}], "tax_rate": 10, "payment_terms": "net_30", "currency": "AUD", "category": "managed_services", "usage_count": 8, "created_by": "System", "created_at": now.isoformat(), "updated_at": now.isoformat()},
        {"id": "it-002", "name": "Security Bundle", "description": "SOC monitoring + EDR + compliance", "line_items": [{"description": "24/7 SOC Monitoring", "quantity": 1, "rate": 1800, "amount": 1800}, {"description": "EDR Management", "quantity": 1, "rate": 500, "amount": 500}, {"description": "Compliance Reporting", "quantity": 1, "rate": 400, "amount": 400}], "tax_rate": 10, "payment_terms": "net_30", "currency": "AUD", "category": "security", "usage_count": 3, "created_by": "System", "created_at": now.isoformat(), "updated_at": now.isoformat()},
        {"id": "it-003", "name": "Backup & DR Package", "description": "Cloud backup + disaster recovery", "line_items": [{"description": "Cloud Backup - per server", "quantity": 1, "rate": 150, "amount": 150}, {"description": "Cloud Backup - per workstation", "quantity": 1, "rate": 25, "amount": 25}, {"description": "DR Runbook Maintenance", "quantity": 1, "rate": 300, "amount": 300}], "tax_rate": 10, "payment_terms": "net_30", "currency": "AUD", "category": "backup", "usage_count": 5, "created_by": "System", "created_at": now.isoformat(), "updated_at": now.isoformat()},
        {"id": "it-004", "name": "Quarterly Security Audit", "description": "Pen test + vuln scan + report", "line_items": [{"description": "External Penetration Test", "quantity": 1, "rate": 2000, "amount": 2000}, {"description": "Internal Vulnerability Scan", "quantity": 1, "rate": 800, "amount": 800}, {"description": "Remediation Report", "quantity": 1, "rate": 400, "amount": 400}], "tax_rate": 10, "payment_terms": "net_30", "currency": "AUD", "category": "security", "usage_count": 2, "created_by": "System", "created_at": now.isoformat(), "updated_at": now.isoformat()},
        {"id": "it-005", "name": "Hardware-as-a-Service", "description": "Monthly device leasing", "line_items": [{"description": "Laptop Lease - per unit/month", "quantity": 1, "rate": 65, "amount": 65}, {"description": "Monitor Lease - per unit/month", "quantity": 1, "rate": 20, "amount": 20}, {"description": "Docking Station - per unit/month", "quantity": 1, "rate": 15, "amount": 15}], "tax_rate": 10, "payment_terms": "net_30", "currency": "AUD", "category": "haas", "usage_count": 1, "created_by": "System", "created_at": now.isoformat(), "updated_at": now.isoformat()},
    ]
    await db.recurring_invoices.delete_many({})
    for i in invoices:
        await db.recurring_invoices.insert_one(i)
    await db.invoice_templates.delete_many({})
    for t in templates:
        await db.invoice_templates.insert_one(t)
    return [{k: v for k, v in i.items() if k != "_id"} for i in invoices]
