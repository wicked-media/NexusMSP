from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone, timedelta
import uuid
import random as _random_mod
import logging
from math import isfinite
_srand = _random_mod.SystemRandom()
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.scope_permissions import (
    assert_client_scope,
    assert_global_scope,
    effective_scope,
    platform_tenant_id,
    scoped_query,
    tenant_scoped_query,
)
from app.services.activity import log_activity, ticket_audit
from app.services.integration_security import redact_connection_settings

logger = logging.getLogger(__name__)

router = APIRouter()


def _version_filter(document: dict) -> dict:
    """Match the version saved when a financial document was authorised."""
    version = document.get("version")
    return {"version": version} if version is not None else {"version": {"$exists": False}}


async def _scoped_xero_invoice(invoice_id: str, current_user: dict, operation: str) -> dict:
    """Load a Xero mirror invoice and enforce its Nexus client boundary."""
    invoice = await db.xero_invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        operation=operation,
        mask_not_found=True,
    )
    return invoice


async def _scoped_xero_client_record(
    collection,
    record_id: str,
    current_user: dict,
    operation: str,
    resource_name: str,
) -> dict:
    """Resolve an integration mirror record through the stable client boundary."""
    record = await collection.find_one({"id": record_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found")
    await assert_client_scope(
        current_user,
        record.get("client_id"),
        operation=operation,
        mask_not_found=True,
    )
    return record


async def _scoped_client_identity(client_id: object, current_user: dict, operation: str) -> dict:
    """Validate a client reference and derive the canonical display identity."""
    normalized = str(client_id or "").strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="client_id is required")
    await assert_client_scope(current_user, normalized, operation=operation, mask_not_found=True)
    client = await db.clients.find_one({"id": normalized}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _payment_amount(value: object) -> float:
    """Normalise a manual Xero payment amount without allowing non-finite values."""
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail="Payment amount must be a positive number")
    try:
        amount = round(float(value), 2)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Payment amount must be a positive number") from None
    if amount <= 0 or not isfinite(amount):
        raise HTTPException(status_code=422, detail="Payment amount must be a positive finite number")
    return amount

# ============== XERO SETTINGS ==============

@router.get("/xero/status")
async def get_xero_status(request: Request, current_user: dict = Depends(get_current_user), _permission: dict = Depends(require_action("billing.integration.manage"))):
    await assert_global_scope(current_user, operation="billing.integration.xero.status", request=request)
    settings_doc = await db.settings.find_one({"type": "xero"}, {"_id": 0})
    configured = bool(settings_doc and settings_doc.get("client_id") and settings_doc.get("client_secret"))
    oauth_ready = bool(
        configured
        and settings_doc.get("tenant_id")
        and (settings_doc.get("access_token") or settings_doc.get("refresh_token"))
    )
    doc = redact_connection_settings(settings_doc)
    return {
        "connected": oauth_ready,
        "configured": configured,
        "org_name": doc.get("org_name") if oauth_ready else None,
    }

@router.put("/xero/settings")
async def update_xero_settings(data: dict, request: Request, current_user: dict = Depends(get_current_user), _permission: dict = Depends(require_action("billing.integration.manage"))):
    await assert_global_scope(current_user, operation="billing.integration.xero.update", request=request)
    await db.settings.update_one({"type": "xero"}, {"$set": {
        "type": "xero",
        "client_id": data.get("client_id", ""),
        "client_secret": data.get("client_secret", ""),
        "tenant_id": data.get("tenant_id", ""),
        "org_name": data.get("org_name", ""),
        "redirect_uri": data.get("redirect_uri", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }}, upsert=True)
    await log_activity(current_user, "xero_settings_updated", "integration", "xero", "Xero accounting connection")
    return {"message": "Xero settings saved"}

# ============== XERO CONTACTS ==============

@router.get("/xero/contacts", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_xero_contacts(current_user: dict = Depends(get_current_user)):
    return await db.xero_contacts.find(scoped_query(current_user), {"_id": 0}).to_list(500)

@router.post("/xero/contacts/sync", dependencies=[Depends(require_action("billing.integration.manage"))])
async def sync_xero_contacts(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.integration.xero.contacts.sync")
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

@router.get("/xero/invoices", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_xero_invoices(client_id: str = None, status: str = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        await assert_client_scope(current_user, client_id, operation="billing.xero_invoice.list", mask_not_found=True)
        query["client_id"] = client_id
    if status:
        query["status"] = status
    return await db.xero_invoices.find(scoped_query(current_user, query), {"_id": 0}).sort("date", -1).to_list(500)

@router.post("/xero/invoices", dependencies=[Depends(require_action("billing.invoice.create"))])
async def create_xero_invoice(data: dict, current_user: dict = Depends(get_current_user)):
    client_id = str(data.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=422, detail="client_id is required")
    await assert_client_scope(current_user, client_id, operation="billing.xero_invoice.create", mask_not_found=True)
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    line_items = data.get("line_items", [])
    sub_total = sum(item.get("quantity", 1) * item.get("unit_price", 0) for item in line_items)
    tax = round(sub_total * 0.1, 2)
    total = round(sub_total + tax, 2)
    invoice = {
        "id": str(uuid.uuid4()),
        "xero_invoice_id": f"INV-{uuid.uuid4().hex[:8].upper()}",
        "invoice_number": data.get("invoice_number", f"INV-{str(await db.xero_invoices.count_documents({}) + 1).zfill(4)}"),
        "client_id": client_id,
        "client_name": client.get("name", ""),
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
        "version": 1,
    }
    await db.xero_invoices.insert_one(invoice)
    invoice.pop("_id", None)
    await log_activity(current_user, "created", "xero_invoice", invoice["id"], invoice["invoice_number"], "Created Xero mirror invoice")
    return invoice

@router.put("/xero/invoices/{invoice_id}", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def update_xero_invoice(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    existing = await _scoped_xero_invoice(invoice_id, current_user, "billing.xero_invoice.update")
    requested_client_id = data.get("client_id")
    if requested_client_id is not None and str(requested_client_id).strip() != str(existing.get("client_id") or ""):
        raise HTTPException(status_code=409, detail="Move a Xero invoice through the governed invoice ownership workflow")
    updates = {}
    for field in ["date", "due_date", "status", "line_items", "sub_total", "tax", "total", "amount_due", "reference", "currency"]:
        if field in data:
            updates[field] = data[field]
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.xero_invoices.update_one(
        {"id": invoice_id, "client_id": existing.get("client_id"), **_version_filter(existing)},
        {"$set": updates, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Invoice changed while it was being updated; refresh and retry")
    await log_activity(current_user, "updated", "xero_invoice", invoice_id, existing.get("invoice_number", ""), "Updated Xero mirror invoice")
    return {"message": "Invoice updated"}

@router.put("/xero/invoices/{invoice_id}/pay", dependencies=[Depends(require_action("billing.payment.record"))])
async def pay_xero_invoice(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await _scoped_xero_invoice(invoice_id, current_user, "billing.xero_invoice.payment.record")
    amount = _payment_amount(data.get("amount"))
    total = float(invoice.get("total", 0) or 0)
    paid = float(invoice.get("amount_paid", 0) or 0)
    outstanding = round(total - paid, 2)
    if str(invoice.get("status") or "").upper() == "VOIDED" or outstanding <= 0:
        raise HTTPException(status_code=409, detail="Invoice is not eligible for a payment")
    if amount > outstanding + 0.01:
        raise HTTPException(status_code=422, detail="Payment cannot exceed the outstanding balance")
    new_paid = round(paid + amount, 2)
    new_due = max(0, (invoice.get("total", 0) or 0) - new_paid)
    new_status = "PAID" if new_due <= 0 else "AUTHORISED"
    result = await db.xero_invoices.update_one(
        {"id": invoice_id, "client_id": invoice.get("client_id"), **_version_filter(invoice)},
        {"$set": {
            "amount_paid": new_paid, "amount_due": new_due, "status": new_status,
            "paid_at": datetime.now(timezone.utc).isoformat() if new_due <= 0 else None,
        }, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Invoice changed while the payment was being recorded; refresh and retry")
    # Log sync event
    await _log_sync_event("payment_recorded", f"Payment ${amount:.2f} on {invoice.get('invoice_number', invoice_id)}")
    await log_activity(current_user, "payment_recorded", "xero_invoice", invoice_id, invoice.get("invoice_number", ""), f"Recorded Xero mirror payment of ${amount:.2f}")
    return {"message": "Payment recorded", "amount_paid": new_paid, "amount_due": new_due, "status": new_status}

@router.put("/xero/invoices/{invoice_id}/void", dependencies=[Depends(require_action("billing.invoice.void"))])
async def void_xero_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await _scoped_xero_invoice(invoice_id, current_user, "billing.xero_invoice.void")
    if str(invoice.get("status") or "").upper() == "VOIDED" or float(invoice.get("amount_paid", 0) or 0) > 0:
        raise HTTPException(status_code=409, detail="Paid or already voided invoices cannot be voided")
    result = await db.xero_invoices.update_one(
        {"id": invoice_id, "client_id": invoice.get("client_id"), **_version_filter(invoice)},
        {"$set": {"status": "VOIDED", "amount_due": 0, "voided_at": datetime.now(timezone.utc).isoformat()}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Invoice changed while it was being voided; refresh and retry")
    await log_activity(current_user, "voided", "xero_invoice", invoice_id, invoice.get("invoice_number", ""), "Voided Xero mirror invoice")
    return {"message": "Invoice voided"}

@router.post("/xero/invoices/{invoice_id}/send", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def send_xero_invoice(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await _scoped_xero_invoice(invoice_id, current_user, "billing.xero_invoice.send")
    if str(invoice.get("status") or "").upper() == "VOIDED":
        raise HTTPException(status_code=409, detail="A voided invoice cannot be sent")
    new_status = "AUTHORISED" if invoice.get("status") == "DRAFT" else invoice.get("status")
    result = await db.xero_invoices.update_one(
        {"id": invoice_id, "client_id": invoice.get("client_id"), **_version_filter(invoice)},
        {"$set": {"status": new_status, "sent_at": datetime.now(timezone.utc).isoformat()}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Invoice changed while it was being sent; refresh and retry")
    await _log_sync_event("invoice_sent", f"Invoice {invoice.get('invoice_number', invoice_id)} sent to client")
    await log_activity(current_user, "sent", "xero_invoice", invoice_id, invoice.get("invoice_number", ""), "Sent Xero mirror invoice")
    return {"message": "Invoice sent"}

# ============== XERO ESTIMATES ==============

@router.get("/xero/estimates", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_xero_estimates(current_user: dict = Depends(get_current_user)):
    return await db.xero_estimates.find(scoped_query(current_user), {"_id": 0}).sort("created_at", -1).to_list(500)

@router.post("/xero/estimates", dependencies=[Depends(require_action("billing.invoice.create"))])
async def create_xero_estimate(data: dict, current_user: dict = Depends(get_current_user)):
    client = await _scoped_client_identity(data.get("client_id"), current_user, "billing.xero_estimate.create")
    line_items = data.get("line_items", [])
    sub_total = sum(item.get("quantity", 1) * item.get("unit_price", 0) for item in line_items)
    tax = round(sub_total * data.get("tax_rate", 10) / 100, 2)
    total = round(sub_total + tax, 2)
    estimate = {
        "id": str(uuid.uuid4()),
        "estimate_number": f"EST-{str(await db.xero_estimates.count_documents({}) + 1).zfill(4)}",
        "title": data.get("title", ""),
        "client_id": client["id"],
        "client_name": client.get("name", ""),
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
    await log_activity(current_user, "created", "xero_estimate", estimate["id"], estimate["estimate_number"], "Created Xero mirror estimate")
    return estimate

@router.put("/xero/estimates/{estimate_id}/status", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def update_estimate_status(estimate_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    new_status = data.get("status", "DRAFT")
    result = await _scoped_xero_client_record(db.xero_estimates, estimate_id, current_user, "billing.xero_estimate.status", "Estimate")
    await db.xero_estimates.update_one(
        {"id": estimate_id, "client_id": result.get("client_id")},
        {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await log_activity(current_user, "updated", "xero_estimate", estimate_id, result.get("estimate_number", ""), f"Set Xero mirror estimate status to {new_status}")
    return {"message": f"Estimate status updated to {new_status}"}

@router.post("/xero/estimates/{estimate_id}/convert", dependencies=[Depends(require_action("billing.invoice.create"))])
async def convert_estimate_to_invoice(estimate_id: str, current_user: dict = Depends(get_current_user)):
    est = await _scoped_xero_client_record(db.xero_estimates, estimate_id, current_user, "billing.xero_estimate.convert", "Estimate")
    if str(est.get("status") or "").upper() == "CONVERTED":
        raise HTTPException(status_code=409, detail="Estimate has already been converted")
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
        "version": 1,
    }
    await db.xero_invoices.insert_one(invoice)
    await db.xero_estimates.update_one(
        {"id": estimate_id, "client_id": est.get("client_id"), "status": {"$ne": "CONVERTED"}},
        {"$set": {"status": "CONVERTED", "converted_invoice_id": invoice["id"], "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    invoice.pop("_id", None)
    await _log_sync_event("estimate_converted", f"Estimate {est.get('estimate_number', '')} converted to Invoice {invoice['invoice_number']}")
    await log_activity(current_user, "converted", "xero_estimate", estimate_id, est.get("estimate_number", ""), f"Converted Xero mirror estimate to invoice {invoice['invoice_number']}")
    return invoice

# ============== XERO RECURRING ==============

FREQ_DAYS = {"weekly": 7, "fortnightly": 14, "monthly": 30, "quarterly": 90, "yearly": 365}

@router.get("/xero/recurring", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_xero_recurring(current_user: dict = Depends(get_current_user)):
    return await db.xero_recurring.find(scoped_query(current_user), {"_id": 0}).sort("created_at", -1).to_list(200)

@router.post("/xero/recurring", dependencies=[Depends(require_action("billing.invoice.create"))])
async def create_xero_recurring(data: dict, current_user: dict = Depends(get_current_user)):
    client = await _scoped_client_identity(data.get("client_id"), current_user, "billing.xero_recurring.create")
    line_items = data.get("line_items", [])
    tax_rate = data.get("tax_rate", 10)
    sub_total = sum(item.get("quantity", 1) * item.get("unit_price", 0) for item in line_items)
    tax = round(sub_total * tax_rate / 100, 2)
    total = round(sub_total + tax, 2)
    freq = data.get("frequency", "monthly")
    rec = {
        "id": str(uuid.uuid4()),
        "client_id": client["id"],
        "client_name": client.get("name", ""),
        "description": data.get("description", ""),
        "frequency": freq,
        "line_items": line_items,
        "sub_total": sub_total,
        "tax": tax,
        "tax_rate": tax_rate,
        "amount": total,
        "payment_terms": data.get("payment_terms", 14),
        "contract_start": data.get("contract_start", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        "contract_end": data.get("contract_end", ""),
        "escalation_percent": data.get("escalation_percent", 0),
        "auto_send": data.get("auto_send", False),
        "auto_generate": data.get("auto_generate", True),
        "notes": data.get("notes", ""),
        "email": data.get("email", ""),
        "status": "active",
        "next_generation": data.get("next_generation", (datetime.now(timezone.utc) + timedelta(days=FREQ_DAYS.get(freq, 30))).strftime("%Y-%m-%d")),
        "invoices_generated": 0,
        "total_billed": 0,
        "total_collected": 0,
        "last_generated": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.xero_recurring.insert_one(rec)
    rec.pop("_id", None)
    await _log_sync_event("recurring_created", f"Recurring template created for {rec['client_name']} - {rec['description']} (${total}/{freq})")
    await log_activity(current_user, "created", "xero_recurring", rec["id"], rec.get("description", ""), "Created Xero mirror recurring template")
    return rec

@router.put("/xero/recurring/{rec_id}", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def update_xero_recurring(rec_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    item = await _scoped_xero_client_record(db.xero_recurring, rec_id, current_user, "billing.xero_recurring.update", "Recurring invoice")
    requested_client_id = data.get("client_id")
    if requested_client_id is not None and str(requested_client_id).strip() != str(item.get("client_id") or ""):
        raise HTTPException(status_code=409, detail="Move recurring billing through an explicit client reassignment workflow")
    updates = {}
    for field in ["description", "frequency", "line_items", "payment_terms",
                   "contract_start", "contract_end", "escalation_percent", "auto_send", "auto_generate",
                   "notes", "email", "next_generation", "tax_rate"]:
        if field in data:
            updates[field] = data[field]
    if "line_items" in data:
        tax_rate = data.get("tax_rate", item.get("tax_rate", 10))
        sub_total = sum(li.get("quantity", 1) * li.get("unit_price", 0) for li in data["line_items"])
        tax = round(sub_total * tax_rate / 100, 2)
        updates["sub_total"] = sub_total
        updates["tax"] = tax
        updates["amount"] = round(sub_total + tax, 2)
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.xero_recurring.update_one({"id": rec_id, "client_id": item.get("client_id")}, {"$set": updates})
    await log_activity(current_user, "updated", "xero_recurring", rec_id, item.get("description", ""), "Updated Xero mirror recurring template")
    return {"message": "Recurring template updated"}

@router.delete("/xero/recurring/{rec_id}", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def delete_xero_recurring(rec_id: str, current_user: dict = Depends(get_current_user)):
    item = await _scoped_xero_client_record(db.xero_recurring, rec_id, current_user, "billing.xero_recurring.delete", "Recurring invoice")
    result = await db.xero_recurring.delete_one({"id": rec_id, "client_id": item.get("client_id")})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Recurring item not found")
    await log_activity(current_user, "deleted", "xero_recurring", rec_id, item.get("description", ""), "Deleted Xero mirror recurring template")
    return {"message": "Recurring template deleted"}

@router.put("/xero/recurring/{rec_id}/toggle", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def toggle_recurring(rec_id: str, current_user: dict = Depends(get_current_user)):
    item = await _scoped_xero_client_record(db.xero_recurring, rec_id, current_user, "billing.xero_recurring.toggle", "Recurring invoice")
    new_status = "paused" if item.get("status") == "active" else "active"
    await db.xero_recurring.update_one({"id": rec_id, "client_id": item.get("client_id")}, {"$set": {"status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await log_activity(current_user, "toggled", "xero_recurring", rec_id, item.get("description", ""), f"Set Xero mirror recurring template to {new_status}")
    return {"message": f"Recurring invoice {new_status}", "status": new_status}

@router.post("/xero/recurring/{rec_id}/generate", dependencies=[Depends(require_action("billing.invoice.create"))])
async def generate_from_recurring(rec_id: str, current_user: dict = Depends(get_current_user)):
    rec = await _scoped_xero_client_record(db.xero_recurring, rec_id, current_user, "billing.xero_recurring.generate", "Recurring invoice")
    invoice = await _create_invoice_from_recurring(rec)
    await log_activity(current_user, "generated", "xero_recurring", rec_id, rec.get("description", ""), f"Generated Xero mirror invoice {invoice.get('invoice_number', '')}")
    return invoice

@router.post("/xero/recurring/batch-generate", dependencies=[Depends(require_action("billing.invoice.create"))])
async def batch_generate_recurring(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.xero_recurring.batch_generate")
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    due_templates = await db.xero_recurring.find(
        {"status": "active", "next_generation": {"$lte": now_str}}, {"_id": 0}
    ).to_list(200)
    generated = []
    for rec in due_templates:
        inv = await _create_invoice_from_recurring(rec)
        generated.append(inv)
    return {"message": f"Generated {len(generated)} invoices", "generated": len(generated), "invoices": generated}

@router.get("/xero/recurring/{rec_id}/history", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_recurring_history(rec_id: str, current_user: dict = Depends(get_current_user)):
    rec = await _scoped_xero_client_record(db.xero_recurring, rec_id, current_user, "billing.xero_recurring.history", "Recurring invoice")
    invoices = await db.xero_invoices.find(
        {"recurring_id": rec_id, "client_id": rec.get("client_id")}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return invoices

@router.get("/xero/recurring/forecast", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_recurring_forecast(current_user: dict = Depends(get_current_user)):
    active = await db.xero_recurring.find(scoped_query(current_user, {"status": "active"}), {"_id": 0}).to_list(200)
    now = datetime.now(timezone.utc)
    forecast = []
    for m in range(12):
        month_start = (now + timedelta(days=30 * m)).replace(day=1)
        month_label = month_start.strftime("%Y-%m")
        total = 0
        for rec in active:
            freq = rec.get("frequency", "monthly")
            amount = rec.get("amount", 0)
            contract_end = rec.get("contract_end", "")
            if contract_end and contract_end < month_label:
                continue
            escalation = rec.get("escalation_percent", 0)
            years_ahead = m / 12
            escalated_amount = amount * (1 + escalation / 100) ** years_ahead if escalation else amount
            if freq == "monthly":
                total += escalated_amount
            elif freq == "quarterly" and m % 3 == 0:
                total += escalated_amount
            elif freq == "yearly" and m == 0:
                total += escalated_amount
            elif freq == "weekly":
                total += escalated_amount * 4.33
            elif freq == "fortnightly":
                total += escalated_amount * 2.17
        forecast.append({"month": month_label, "projected": round(total, 2)})
    mrr = sum(r.get("amount", 0) for r in active if r.get("frequency") == "monthly")
    mrr += sum(r.get("amount", 0) / 3 for r in active if r.get("frequency") == "quarterly")
    mrr += sum(r.get("amount", 0) / 12 for r in active if r.get("frequency") == "yearly")
    mrr += sum(r.get("amount", 0) * 4.33 for r in active if r.get("frequency") == "weekly")
    arr = mrr * 12
    return {"forecast": forecast, "mrr": round(mrr, 2), "arr": round(arr, 2), "active_count": len(active)}

# ============== INVOICE EMAIL ==============

@router.post("/xero/invoices/{invoice_id}/email", dependencies=[Depends(require_action("billing.invoice.modify"))])
async def email_xero_invoice(invoice_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    invoice = await _scoped_xero_invoice(invoice_id, current_user, "billing.xero_invoice.email")
    to_email = str(data.get("to_email") or "").strip()
    subject = data.get("subject", f"Invoice {invoice.get('invoice_number', '')} from NexusOps")
    message = data.get("message", "")
    if not to_email:
        raise HTTPException(status_code=400, detail="Recipient email required")

    # Generate PDF
    pdf_bytes = None
    pdf_filename = f"{invoice.get('invoice_number', 'invoice')}.pdf"
    try:
        from app.routers.invoice_pdf import generate_invoice_pdf, _get_branding
        branding = await _get_branding()
        pdf_bytes = bytes(generate_invoice_pdf(invoice, branding))
    except Exception as e:
        logger.warning(f"PDF generation failed for email: {e}")

    # Send through the Microsoft 365 billing mailbox.
    email_status = "sent"
    email_message = f"Invoice emailed to {to_email}"
    try:
        from app.routers.email_utils import send_email
        # Build HTML email body
        inv_num = invoice.get("invoice_number", "N/A")
        total = invoice.get("total", 0)
        due_date = invoice.get("due_date", "N/A")
        client_name = invoice.get("client_name", "")
        html_body = f"""
        <div style="font-family:Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1a56db;padding:20px 28px;color:#fff;border-radius:8px 8px 0 0">
            <h2 style="margin:0">Invoice {inv_num}</h2>
          </div>
          <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
            <p>Hi{' ' + client_name if client_name else ''},</p>
            <p>{message.replace(chr(10), '<br>')}</p>
            <table style="width:100%;margin:20px 0;border-collapse:collapse">
              <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Invoice #</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold;text-align:right">{inv_num}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Amount</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold;text-align:right">${total:,.2f}</td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Due Date</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">{due_date}</td></tr>
            </table>
            {('<p style="font-size:13px;color:#666">The invoice PDF is attached to this email.</p>' if pdf_bytes else '')}
            <p style="font-size:12px;color:#999;margin-top:24px;border-top:1px solid #eee;padding-top:12px">Sent via NexusOps</p>
          </div>
        </div>
        """

        result = await send_email(
            to_email,
            subject,
            html_body,
            category="billing",
            attachments=[{"filename": pdf_filename, "content": pdf_bytes, "content_type": "application/pdf"}] if pdf_bytes else None,
        )
        email_status = result.get("status", "failed")
        email_message = result.get("message", email_message)
    except Exception:
        logger.exception("xero_invoice_email_failed invoice_id=%s", invoice_id)
        email_status = "failed"
        email_message = "Email failed to send"

    email_record = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "client_id": invoice.get("client_id"),
        "invoice_number": invoice.get("invoice_number", ""),
        "to_email": to_email,
        "subject": subject,
        "message": message,
        "status": email_status,
        "has_pdf": pdf_bytes is not None,
        "sent_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.xero_invoice_emails.insert_one(email_record)
    if invoice.get("status") == "DRAFT":
        await db.xero_invoices.update_one(
            {"id": invoice_id, "client_id": invoice.get("client_id"), **_version_filter(invoice)},
            {"$set": {"status": "AUTHORISED", "sent_at": datetime.now(timezone.utc).isoformat()}, "$inc": {"version": 1}},
        )
    await _log_sync_event("invoice_emailed", f"Invoice {invoice.get('invoice_number', '')} emailed to {to_email}")
    await log_activity(current_user, "emailed", "xero_invoice", invoice_id, invoice.get("invoice_number", ""), f"Sent Xero mirror invoice to {to_email}")
    email_record.pop("_id", None)
    return {"message": email_message, "email": email_record}

@router.get("/xero/invoices/{invoice_id}/emails", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_invoice_emails(invoice_id: str, current_user: dict = Depends(get_current_user)):
    invoice = await _scoped_xero_invoice(invoice_id, current_user, "billing.xero_invoice.email_history")
    emails = await db.xero_invoice_emails.find(
        {"invoice_id": invoice_id, "client_id": invoice.get("client_id")}, {"_id": 0}
    ).sort("sent_at", -1).to_list(50)
    return emails

# ============== XERO SYNC HISTORY ==============

@router.get("/xero/sync-history", dependencies=[Depends(require_action("billing.integration.manage"))])
async def get_sync_history(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.integration.xero.sync_history")
    history = await db.xero_sync_history.find({}, {"_id": 0}).sort("timestamp", -1).to_list(50)
    return history

@router.post("/xero/sync", dependencies=[Depends(require_action("billing.integration.manage"))])
async def trigger_xero_sync(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.integration.xero.sync")
    await _log_sync_event("full_sync", "Full sync triggered - contacts, invoices, and accounts refreshed")
    contacts_synced = await db.xero_contacts.count_documents({})
    invoices_synced = await db.xero_invoices.count_documents({})
    return {"message": "Xero sync completed", "contacts_synced": contacts_synced, "invoices_synced": invoices_synced}

# ============== XERO DASHBOARD ==============

@router.get("/xero/dashboard", dependencies=[Depends(require_action("billing.portal.view"))])
async def get_xero_dashboard(current_user: dict = Depends(get_current_user)):
    invoices = await db.xero_invoices.find(scoped_query(current_user), {"_id": 0}).to_list(1000)

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
    contacts_count = await db.xero_contacts.count_documents(scoped_query(current_user))
    estimates_count = await db.xero_estimates.count_documents(scoped_query(current_user))
    recurring_count = await db.xero_recurring.count_documents(scoped_query(current_user))

    # Collection rate
    collection_rate = round((total_paid / total_revenue * 100) if total_revenue > 0 else 0, 1)

    # Recent sync
    # Sync events are integration-wide and currently have no client reference.
    # Do not use them to disclose tenant-wide operational timing to a restricted
    # technician; client-scoped dashboard data remains available above.
    last_sync = None
    if effective_scope(current_user)["mode"] == "all":
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

@router.get("/xero/accounts", dependencies=[Depends(require_action("billing.integration.manage"))])
async def get_xero_accounts(current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.integration.xero.accounts")
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

_BULK_TICKET_ACTIONS = frozenset({"assign", "close", "priority", "status", "tag"})
_BULK_TICKET_PRIORITIES = frozenset({"low", "medium", "high", "critical"})
_BULK_TICKET_STATUSES = frozenset({"open", "in_progress", "on_hold", "resolved", "closed"})
_MAX_BULK_TICKETS = 100
_MAX_TICKET_TAG_LENGTH = 64


def _normalise_bulk_ticket_ids(value: object) -> list[str]:
    """Reject malformed or ambiguous ticket selections before any record is read."""
    if not isinstance(value, list) or not value:
        raise HTTPException(status_code=422, detail="ticket_ids must be a non-empty array")
    if len(value) > _MAX_BULK_TICKETS:
        raise HTTPException(status_code=422, detail=f"A bulk action may contain at most {_MAX_BULK_TICKETS} tickets")

    ticket_ids: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise HTTPException(status_code=422, detail="Every ticket_id must be a string")
        ticket_id = item.strip()
        if not ticket_id or len(ticket_id) > 128:
            raise HTTPException(status_code=422, detail="Every ticket_id must be a non-empty value up to 128 characters")
        if ticket_id in seen:
            raise HTTPException(status_code=422, detail="ticket_ids must not contain duplicates")
        seen.add(ticket_id)
        ticket_ids.append(ticket_id)
    return ticket_ids


def _normalise_bulk_ticket_request(data: object) -> tuple[list[str], str, str | None]:
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Bulk ticket action payload must be an object")

    ticket_ids = _normalise_bulk_ticket_ids(data.get("ticket_ids"))
    raw_action = data.get("action")
    if not isinstance(raw_action, str):
        raise HTTPException(status_code=422, detail="action is required")
    action = raw_action.strip().lower()
    if action not in _BULK_TICKET_ACTIONS:
        raise HTTPException(status_code=422, detail="Unsupported bulk ticket action")

    raw_value = data.get("value")
    if action == "assign":
        if not isinstance(raw_value, str) or not raw_value.strip() or len(raw_value.strip()) > 128:
            raise HTTPException(status_code=422, detail="A valid assignee user ID is required")
        return ticket_ids, action, raw_value.strip()
    if action == "priority":
        if not isinstance(raw_value, str) or raw_value.strip().lower() not in _BULK_TICKET_PRIORITIES:
            raise HTTPException(status_code=422, detail="Invalid priority value")
        return ticket_ids, action, raw_value.strip().lower()
    if action == "status":
        if not isinstance(raw_value, str) or raw_value.strip().lower() not in _BULK_TICKET_STATUSES:
            raise HTTPException(status_code=422, detail="Invalid status value")
        return ticket_ids, action, raw_value.strip().lower()
    if action == "tag":
        if not isinstance(raw_value, str):
            raise HTTPException(status_code=422, detail="A tag is required")
        tag = raw_value.strip()
        if not tag or len(tag) > _MAX_TICKET_TAG_LENGTH or any(ord(char) < 32 for char in tag):
            raise HTTPException(status_code=422, detail="Tag must be printable text up to 64 characters")
        return ticket_ids, action, tag
    return ticket_ids, action, None


async def _load_scoped_bulk_tickets(
    ticket_ids: list[str],
    current_user: dict,
    *,
    operation: str,
    request: Request | None,
) -> list[dict]:
    """Resolve the whole selection first so a foreign/missing ticket changes nothing."""
    records = await db.tickets.find(
        tenant_scoped_query(current_user, {"id": {"$in": ticket_ids}}),
        {"_id": 0},
    ).to_list(len(ticket_ids))
    tickets_by_id = {str(ticket.get("id")): ticket for ticket in records if ticket.get("id")}
    missing = [ticket_id for ticket_id in ticket_ids if ticket_id not in tickets_by_id]
    if missing:
        raise HTTPException(status_code=404, detail="One or more tickets could not be found")

    tickets = [tickets_by_id[ticket_id] for ticket_id in ticket_ids]
    scope = effective_scope(current_user)
    for ticket in tickets:
        # A site-restricted technician cannot act on an old ticket that lacks a
        # site reference: Nexus cannot prove it belongs to their permitted
        # location.  ``assert_client_scope`` intentionally permits a missing
        # site for ordinary client-scoped workflows, so make this legacy bulk
        # operation fail closed when a site boundary is explicit.
        ticket_site_id = ticket.get("site_id")
        if scope["mode"] != "all" and scope["site_ids"] and not ticket_site_id:
            await assert_client_scope(
                current_user,
                ticket.get("client_id"),
                site_id="__unassigned_ticket_site__",
                operation=operation,
                request=request,
                mask_not_found=True,
            )
        await assert_client_scope(
            current_user,
            ticket.get("client_id"),
            site_id=ticket_site_id,
            operation=operation,
            request=request,
            mask_not_found=True,
        )
    return tickets


async def _assert_bulk_ticket_can_close(ticket: dict) -> None:
    """Keep the old bulk route from bypassing project and blueprint closure gates."""
    if ticket.get("project_ticket_plan_role") == "parent":
        child_ticket_ids = list(dict.fromkeys(ticket.get("child_ticket_ids") or []))
        if child_ticket_ids:
            children = await db.tickets.find(
                {
                    "id": {"$in": child_ticket_ids},
                    "client_id": ticket.get("client_id"),
                    "$or": [
                        {"project_ticket_plan_required": {"$ne": False}},
                        {"project_ticket_plan_required": {"$exists": False}},
                    ],
                },
                {"_id": 0, "id": 1, "ticket_number": 1, "status": 1},
            ).to_list(len(child_ticket_ids))
            open_children = [
                child for child in children
                if str(child.get("status") or "open").lower() not in {"resolved", "closed", "completed"}
            ]
            if open_children:
                raise HTTPException(
                    status_code=409,
                    detail="Project delivery is still in progress; close required child tickets before the parent",
                )

    if not ticket.get("blueprint_require_completion"):
        return
    missing_items = [
        str(item.get("label") or "checklist item")
        for item in (ticket.get("blueprint_checklist") or [])
        if item.get("required") and not item.get("done")
    ]
    blueprint = (
        await db.blueprints.find_one({"id": ticket.get("blueprint_id")}, {"_id": 0, "fields": 1})
        if ticket.get("blueprint_id")
        else None
    )
    values = ticket.get("blueprint_fields") or {}
    missing_fields = [
        str(field.get("label") or field.get("key") or "required field")
        for field in ((blueprint or {}).get("fields") or [])
        if field.get("required") and not str(values.get(field.get("key"), "") or "").strip()
    ]
    if missing_items or missing_fields:
        raise HTTPException(
            status_code=409,
            detail="Ticket blueprint is incomplete; complete required checklist items and fields before closing",
        )


async def _mark_bulk_project_task_for_review(ticket: dict, current_user: dict, completed_at: str) -> None:
    """Preserve the parent project review hand-off when child work closes in bulk."""
    if ticket.get("project_ticket_plan_role") != "child" or not ticket.get("project_id"):
        return
    await db.project_tasks.update_one(
        {
            "project_id": ticket["project_id"],
            "ticket_id": ticket.get("id"),
            "status": {"$nin": ["review", "completed"]},
        },
        {
            "$set": {
                "status": "review",
                "completed_at": completed_at,
                "implemented_by": current_user.get("id") or current_user.get("email"),
                "implemented_by_name": current_user.get("name") or current_user.get("email"),
                "implemented_at": completed_at,
                "reviewed_by": None,
                "reviewed_by_name": None,
                "reviewed_at": None,
                "review_result": None,
                "review_notes": None,
            }
        },
    )


@router.post("/tickets/bulk-action", dependencies=[Depends(require_action("ticket.bulk.modify"))])
async def bulk_ticket_action(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Apply one bounded, auditable mutation to a fully validated ticket selection.

    This compatibility route remains registered for the older queue UI, but it
    deliberately follows the same scope and close-out gates as the primary
    ticket workflow.  The selection is fully resolved and checked before any
    ticket is changed, preventing a mixed-client request from partly mutating
    accessible records.
    """
    ticket_ids, action, value = _normalise_bulk_ticket_request(data)
    resolution_summary = str(data.get("resolution_summary") or "").strip() if isinstance(data, dict) else ""
    closure_reason = str(data.get("closure_reason") or "").strip() if isinstance(data, dict) else ""
    if action == "close" and (not resolution_summary or not closure_reason):
        raise HTTPException(status_code=422, detail="Bulk close requires a resolution summary and closure reason")
    operation = f"ticket.bulk.{action}"
    tickets = await _load_scoped_bulk_tickets(
        ticket_ids,
        current_user,
        operation=operation,
        request=request,
    )

    assignee = None
    if action == "assign":
        assignee = await db.users.find_one(
            tenant_scoped_query(current_user, {"id": value}),
            {"_id": 0, "id": 1, "name": 1},
        )
        if not assignee:
            raise HTTPException(status_code=422, detail="Assigned technician was not found")

    closing = action == "close" or (action == "status" and value in {"resolved", "closed"})
    if closing:
        for ticket in tickets:
            if str(ticket.get("status") or "").lower() != "closed":
                await _assert_bulk_ticket_can_close(ticket)

    now_iso = datetime.now(timezone.utc).isoformat()
    operation_id = str(uuid.uuid4())
    updated = 0
    for ticket in tickets:
        updates = {"updated_at": now_iso}
        changes: dict[str, dict[str, object]] = {}
        if action == "assign":
            updates.update({
                "assigned_to": assignee["id"],
                "assigned_name": assignee.get("name"),
                "assigned_at": now_iso,
            })
            changes["assigned_to"] = {"old": ticket.get("assigned_to"), "new": assignee["id"]}
        elif action == "priority":
            updates["priority"] = value
            changes["priority"] = {"old": ticket.get("priority"), "new": value}
        elif action == "tag":
            updates["tags"] = list(dict.fromkeys([*(ticket.get("tags") or []), value]))
            changes["tag"] = {"old": ticket.get("tags") or [], "new": updates["tags"]}
        else:
            requested_status = "closed" if action == "close" else value
            updates["status"] = requested_status
            changes["status"] = {"old": ticket.get("status"), "new": requested_status}
            if requested_status in {"resolved", "closed"} and str(ticket.get("status") or "").lower() not in {"resolved", "closed"}:
                updates.update({
                    "resolved_at": ticket.get("resolved_at") or now_iso,
                    "resolved_by": ticket.get("resolved_by") or current_user.get("id") or current_user.get("email"),
                    "resolved_by_name": ticket.get("resolved_by_name") or current_user.get("name") or current_user.get("email"),
                    "resolution_status": "resolved" if requested_status == "resolved" else "closed",
                })
            if requested_status == "closed" and str(ticket.get("status") or "").lower() != "closed":
                updates.update({
                    "closed_at": now_iso,
                    "closed_by": current_user.get("id") or current_user.get("email"),
                    "closed_by_name": current_user.get("name") or current_user.get("email"),
                    "resolution_status": "resolved_and_closed" if str(ticket.get("status") or "").lower() == "resolved" else "closed",
                    "resolution_summary": resolution_summary,
                    "closure_reason": closure_reason,
                    "resolution_recorded_at": now_iso,
                    "resolution_recorded_by": current_user.get("id") or current_user.get("email"),
                })

        result = await db.tickets.update_one(
            tenant_scoped_query(
                current_user,
                {
                    "id": ticket["id"],
                    "client_id": ticket.get("client_id"),
                    "site_id": ticket.get("site_id"),
                },
            ),
            {"$set": updates},
        )
        if not result.matched_count:
            raise HTTPException(status_code=409, detail="Ticket changed while the bulk action was being applied; refresh and retry")
        updated += 1
        if updates.get("status") == "closed" and str(ticket.get("status") or "").lower() != "closed":
            await _mark_bulk_project_task_for_review(ticket, current_user, now_iso)

        audit_details = f"Bulk {action} operation {operation_id} applied"
        await ticket_audit(ticket["id"], current_user, "bulk_updated", audit_details)
        await log_activity(
            current_user,
            "bulk_updated",
            "ticket",
            ticket["id"],
            ticket.get("title", ""),
            audit_details,
            changes=changes,
            metadata={
                "operation_id": operation_id,
                "bulk_action": action,
                "selection_size": len(tickets),
                "client_id": ticket.get("client_id"),
                "site_id": ticket.get("site_id"),
                "tenant_id": platform_tenant_id(current_user),
            },
        )

    return {
        "message": f"Bulk {action} applied to {updated} tickets",
        "updated": updated,
        "action": action,
        "operation_id": operation_id,
    }

# ============== SEED HELPERS ==============

async def _create_invoice_from_recurring(rec: dict) -> dict:
    """Generate a new invoice from a recurring template."""
    now = datetime.now(timezone.utc)
    freq = rec.get("frequency", "monthly")
    payment_terms = rec.get("payment_terms", 14)
    invoice = {
        "id": str(uuid.uuid4()),
        "xero_invoice_id": f"INV-{uuid.uuid4().hex[:8].upper()}",
        "invoice_number": f"INV-{str(await db.xero_invoices.count_documents({}) + 1).zfill(4)}",
        "client_id": rec.get("client_id", ""),
        "client_name": rec.get("client_name", ""),
        "date": now.strftime("%Y-%m-%d"),
        "due_date": (now + timedelta(days=payment_terms)).strftime("%Y-%m-%d"),
        "status": "AUTHORISED" if rec.get("auto_send") else "DRAFT",
        "line_items": rec.get("line_items", []),
        "sub_total": rec.get("sub_total", 0),
        "tax": rec.get("tax", 0),
        "total": rec.get("amount", 0),
        "amount_paid": 0,
        "amount_due": rec.get("amount", 0),
        "currency": "AUD",
        "reference": f"Recurring: {rec.get('description', '')} ({freq})",
        "recurring_id": rec.get("id", ""),
        "created_at": now.isoformat(),
    }
    await db.xero_invoices.insert_one(invoice)
    invoice.pop("_id", None)
    # Update the recurring template
    next_days = FREQ_DAYS.get(freq, 30)
    new_next = (now + timedelta(days=next_days)).strftime("%Y-%m-%d")
    total_billed = (rec.get("total_billed", 0) or 0) + rec.get("amount", 0)
    await db.xero_recurring.update_one({"id": rec["id"]}, {"$set": {
        "next_generation": new_next,
        "last_generated": now.isoformat(),
        "total_billed": total_billed,
    }, "$inc": {"invoices_generated": 1}})
    await _log_sync_event("recurring_generated", f"Invoice {invoice['invoice_number']} generated from recurring: {rec.get('description', '')} for {rec.get('client_name', '')}")
    return invoice

async def _log_sync_event(event_type: str, message: str):
    event = {
        "id": str(uuid.uuid4()),
        "event_type": event_type,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "status": "success",
    }
    await db.xero_sync_history.insert_one(event)
    event.pop("_id", None)
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
    clients = await db.clients.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(10)
    if not clients:
        return
    now = datetime.now(timezone.utc)
    templates = [
        {"description": "Managed IT Services - Monthly", "amount": 2500, "frequency": "monthly", "payment_terms": 14, "escalation_percent": 3, "auto_send": True, "auto_generate": True, "notes": "Includes remote monitoring, patch management, and unlimited helpdesk support.", "tax_rate": 10},
        {"description": "Backup & DR Services", "amount": 450, "frequency": "monthly", "payment_terms": 14, "escalation_percent": 2, "auto_send": True, "auto_generate": True, "notes": "Cloud backup with 30-day retention, daily verification, quarterly DR test.", "tax_rate": 10},
        {"description": "Cybersecurity Suite", "amount": 800, "frequency": "monthly", "payment_terms": 7, "escalation_percent": 5, "auto_send": False, "auto_generate": True, "notes": "EDR, SIEM monitoring, vulnerability scanning, security awareness training.", "tax_rate": 10},
        {"description": "Cloud Hosting & Infrastructure", "amount": 1200, "frequency": "monthly", "payment_terms": 30, "escalation_percent": 0, "auto_send": True, "auto_generate": True, "notes": "Azure hosting, 99.9% SLA, includes OS patching and monitoring.", "tax_rate": 10},
        {"description": "VoIP Phone System", "amount": 350, "frequency": "monthly", "payment_terms": 14, "escalation_percent": 2, "auto_send": True, "auto_generate": True, "notes": "20 handsets, unlimited domestic calls, Teams integration.", "tax_rate": 10},
        {"description": "Network Support Retainer", "amount": 2800, "frequency": "quarterly", "payment_terms": 30, "escalation_percent": 3, "auto_send": False, "auto_generate": True, "notes": "Quarterly network health assessment, firewall management, switch/AP support.", "tax_rate": 10},
        {"description": "Annual Microsoft 365 License Bundle", "amount": 8400, "frequency": "yearly", "payment_terms": 30, "escalation_percent": 5, "auto_send": True, "auto_generate": True, "notes": "Business Premium licenses x35 users. Annual renewal.", "tax_rate": 10},
        {"description": "Weekly Maintenance Window", "amount": 375, "frequency": "weekly", "payment_terms": 7, "escalation_percent": 0, "auto_send": False, "auto_generate": True, "notes": "After-hours maintenance window: patching, updates, health checks.", "tax_rate": 10},
    ]
    for idx, client in enumerate(clients[:8]):
        tmpl = templates[idx % len(templates)]
        sub_total = tmpl["amount"] / 1.1
        tax = round(sub_total * tmpl["tax_rate"] / 100, 2)
        contract_start = (now - timedelta(days=_srand.randint(90, 540))).strftime("%Y-%m-%d")
        contract_end = (now + timedelta(days=_srand.randint(180, 730))).strftime("%Y-%m-%d") if idx % 3 != 0 else ""
        gen_count = _srand.randint(3, 24)
        total_billed = tmpl["amount"] * gen_count
        total_collected = round(total_billed * _srand.uniform(0.75, 1.0), 2)
        rec = {
            "id": str(uuid.uuid4()),
            "client_id": client["id"],
            "client_name": client["name"],
            "description": tmpl["description"],
            "frequency": tmpl["frequency"],
            "line_items": [{"description": tmpl["description"], "quantity": 1, "unit_price": round(sub_total, 2)}],
            "sub_total": round(sub_total, 2),
            "tax": tax,
            "tax_rate": tmpl["tax_rate"],
            "amount": tmpl["amount"],
            "payment_terms": tmpl["payment_terms"],
            "contract_start": contract_start,
            "contract_end": contract_end,
            "escalation_percent": tmpl["escalation_percent"],
            "auto_send": tmpl["auto_send"],
            "auto_generate": tmpl["auto_generate"],
            "notes": tmpl["notes"],
            "email": client.get("email", f"billing@{client['name'].lower().replace(' ', '')}.com"),
            "status": "active" if idx < 6 else "paused",
            "next_generation": (now + timedelta(days=_srand.randint(1, 25))).strftime("%Y-%m-%d"),
            "invoices_generated": gen_count,
            "total_billed": total_billed,
            "total_collected": total_collected,
            "last_generated": (now - timedelta(days=_srand.randint(5, 30))).isoformat(),
            "created_at": (now - timedelta(days=_srand.randint(90, 540))).isoformat(),
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
    return [{k: v for k, v in inv.items() if k != "_id"} for inv in invoices]
