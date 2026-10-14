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
from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone, timedelta
import uuid
import csv
import io
import math
import httpx
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, assert_global_scope, scope_query
from app.services.commercial_documents import (
    freeze_commercial_document_snapshot,
    get_commercial_document_branding,
)

router = APIRouter()


# Inventory, warehouse and purchase-order records in the legacy Billing Pro
# model describe the MSP's shared catalogue and stock holding.  They are not
# client-owned records, so a restricted client scope cannot safely operate on
# them.  Reuse the governed catalogue action rather than creating a parallel
# legacy permission surface.
_CATALOGUE_MANAGE_ACTION = "billing.catalogue.pricing.manage"
_BILLING_ANALYTICS_ACTION = "billing.analytics.view"
_BILLING_PORTAL_VIEW_ACTION = "billing.portal.view"
_MAX_CATALOGUE_QUANTITY = 1_000_000
_MAX_CATALOGUE_MONEY = 1_000_000_000


def _record_write_filter(record: dict) -> dict:
    """Bind a legacy global-record mutation to its loaded version."""
    criteria = {"id": record["id"]}
    if "version" in record:
        criteria["version"] = record["version"]
    else:
        criteria["version"] = {"$exists": False}
    return criteria


def _bounded_identifier(value: object, field: str, *, maximum: int = 200) -> str:
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{field} must be a non-empty identifier")
    identifier = value.strip()
    if not identifier or len(identifier) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} must be a non-empty identifier")
    return identifier


def _bounded_positive_quantity(value: object, field: str) -> int:
    try:
        quantity = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a positive whole number") from None
    if not math.isfinite(quantity) or quantity <= 0 or quantity > _MAX_CATALOGUE_QUANTITY or not quantity.is_integer():
        raise HTTPException(status_code=422, detail=f"{field} must be a positive whole number")
    return int(quantity)


def _bounded_nonnegative_quantity(value: object, field: str) -> int:
    try:
        quantity = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a finite non-negative whole number") from None
    if not math.isfinite(quantity) or quantity < 0 or quantity > _MAX_CATALOGUE_QUANTITY or not quantity.is_integer():
        raise HTTPException(status_code=422, detail=f"{field} must be a finite non-negative whole number")
    return int(quantity)


def _bounded_catalogue_money(value: object, field: str) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a finite non-negative number") from None
    if not math.isfinite(amount) or amount < 0 or amount > _MAX_CATALOGUE_MONEY:
        raise HTTPException(status_code=422, detail=f"{field} must be a finite non-negative number")
    return round(amount, 2)


def _bounded_catalogue_text(value: object, field: str, *, maximum: int, default: str = "") -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail=f"{field} must be text")
    text = value.strip()
    if len(text) > maximum:
        raise HTTPException(status_code=422, detail=f"{field} must be at most {maximum} characters")
    return text


async def _load_global_record(collection, record_id: str, resource_name: str) -> dict:
    record = await collection.find_one({"id": record_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail=f"{resource_name} not found")
    return record


def _invoice_write_filter(invoice: dict) -> dict:
    """Bind an invoice mutation to the identity and version that was scoped.

    Billing Pro predates the main invoice router.  Keeping the compare-and-set
    predicate here prevents a record that is moved to another client (or
    otherwise changed) between the read and write from being changed through a
    stale Billing Pro request.
    """
    criteria = {"id": invoice["id"], "client_id": invoice.get("client_id")}
    if "version" in invoice:
        criteria["version"] = invoice["version"]
    else:
        criteria["version"] = {"$exists": False}
    return criteria


def _recurring_invoice_write_filter(recurring_invoice: dict) -> dict:
    """Apply the same client/version guard to recurring billing mutations."""
    criteria = {"id": recurring_invoice["id"], "client_id": recurring_invoice.get("client_id")}
    if "version" in recurring_invoice:
        criteria["version"] = recurring_invoice["version"]
    else:
        criteria["version"] = {"$exists": False}
    return criteria


def _csv_text(value: object) -> str:
    """Return a text cell that spreadsheet software will not evaluate as code."""
    text = str(value or "")
    return f"'{text}" if text.lstrip().startswith(("=", "+", "-", "@")) else text


async def _load_scoped_invoice(
    invoice_id: str,
    current_user: dict,
    request: Request | None,
    operation: str,
) -> dict:
    """Load an invoice and prove client scope before exposing or mutating it."""
    invoice = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    await assert_client_scope(
        current_user,
        invoice.get("client_id"),
        operation=operation,
        request=request,
        mask_not_found=True,
    )
    return invoice


async def _load_scoped_recurring_invoice(
    recurring_invoice_id: str,
    current_user: dict,
    request: Request | None,
    operation: str,
) -> dict:
    recurring_invoice = await db.recurring_invoices.find_one({"id": recurring_invoice_id}, {"_id": 0})
    if not recurring_invoice:
        raise HTTPException(status_code=404, detail="Recurring invoice not found")
    await assert_client_scope(
        current_user,
        recurring_invoice.get("client_id"),
        operation=operation,
        request=request,
        mask_not_found=True,
    )
    return recurring_invoice

# ============================================================================
#  SMART NUMBERING
# ============================================================================

@router.get(
    "/billing-pro/numbering",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_numbering(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.numbering.view", request=request)
    cfg = await db.settings.find_one({"key": "invoice_numbering"}, {"_id": 0}) or {}
    return cfg.get("value") or {
        "format": "INV-{YYYY}-{SEQ:05d}",
        "client_prefix": False,
        "fy_reset": True,
        "fy_start_month": 7,  # AU FY = July
        "next_seq": 1,
    }


@router.put(
    "/billing-pro/numbering",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def save_numbering(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await assert_global_scope(current_user, operation="billing.numbering.save", request=request)
    await db.settings.update_one(
        {"key": "invoice_numbering"},
        {"$set": {"key": "invoice_numbering", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    await log_activity(
        current_user,
        "updated",
        "billing_configuration",
        "invoice_numbering",
        "Invoice numbering",
        "Updated organisation-wide invoice numbering configuration",
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

@router.post(
    "/billing-pro/invoices/bulk-action",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def bulk_invoice_action(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Body: {invoice_ids:[...], action: 'mark_sent'|'mark_paid'|'delete'|'void'}"""
    ids = data.get("invoice_ids") or []
    action = data.get("action")
    if not isinstance(ids, list) or not ids or any(not isinstance(invoice_id, str) or not invoice_id.strip() for invoice_id in ids):
        raise HTTPException(status_code=422, detail="invoice_ids must be a non-empty list of invoice IDs")
    ids = list(dict.fromkeys(invoice_id.strip() for invoice_id in ids))
    if not action:
        raise HTTPException(status_code=400, detail="invoice_ids and action required")
    if action not in {"mark_sent", "mark_paid", "void", "delete"}:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
    if action in {"void", "delete"}:
        # A bulk endpoint has a mixed action surface.  Keep the usual invoice
        # modify permission as its baseline and dynamically enforce the
        # critical void/delete permission before any target is loaded or changed.
        await require_action("billing.invoice.void")(request=request, current_user=current_user)
    if action == "mark_paid":
        raise HTTPException(status_code=409, detail="Use Record Payment so the amount, method, and audit history are retained")

    invoices = await db.invoices.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids))
    by_id = {str(invoice.get("id")): invoice for invoice in invoices}
    if len(by_id) != len(ids):
        raise HTTPException(status_code=404, detail="Invoice not found")
    # Authorise every target before making any change.  This prevents a valid
    # in-scope selection from partially applying while a foreign ID is rejected.
    for invoice_id in ids:
        await assert_client_scope(
            current_user,
            by_id[invoice_id].get("client_id"),
            operation=f"billing.invoice.bulk.{action}",
            request=request,
            mask_not_found=True,
        )

    invalid_statuses: list[str] = []
    for invoice in invoices:
        status = invoice.get("status")
        payment_status = invoice.get("payment_status")
        if action == "mark_sent" and status != "draft":
            invalid_statuses.append(str(invoice.get("invoice_number") or invoice.get("id")))
        elif action == "void" and (payment_status not in {"unpaid", None} or status in {"cancelled", "voided"}):
            invalid_statuses.append(str(invoice.get("invoice_number") or invoice.get("id")))
        elif action == "delete" and (payment_status not in {"unpaid", None} or status not in {"draft", "pending_approval"}):
            invalid_statuses.append(str(invoice.get("invoice_number") or invoice.get("id")))
    if invalid_statuses:
        raise HTTPException(
            status_code=409,
            detail=f"{action} is not allowed for: {', '.join(invalid_statuses[:5])}",
        )

    now = datetime.now(timezone.utc).isoformat()
    if action == "mark_sent":
        branding = await get_commercial_document_branding(database=db)
        for invoice in invoices:
            snapshot = invoice.get("document_snapshot")
            if not isinstance(snapshot, dict):
                snapshot = await freeze_commercial_document_snapshot(
                    "invoice",
                    invoice,
                    branding,
                    database=db,
                )
            result = await db.invoices.update_one(
                {**_invoice_write_filter(invoice), "status": "draft"},
                {"$set": {
                    "status": "sent",
                    "sent_at": now,
                    "updated_at": now,
                    "document_snapshot": snapshot,
                }, "$inc": {"version": 1}},
            )
            if not result.matched_count:
                raise HTTPException(status_code=409, detail="Invoice changed before the bulk action could complete")
            await log_activity(
                current_user, "sent", "invoice", invoice["id"], invoice.get("invoice_number", ""),
                "Marked invoice as sent via bulk action", metadata={"bulk_action": action},
            )
        return {"updated": len(invoices), "action": action}
    if action == "void":
        for invoice in invoices:
            result = await db.invoices.update_one(
                {
                    **_invoice_write_filter(invoice),
                    "payment_status": {"$in": ["unpaid", None]},
                    "status": {"$nin": ["cancelled", "voided"]},
                },
                {"$set": {"status": "cancelled", "voided_at": now, "voided_by": current_user.get("name", ""), "updated_at": now}, "$inc": {"version": 1}},
            )
            if not result.matched_count:
                raise HTTPException(status_code=409, detail="Invoice changed before the bulk action could complete")
            await log_activity(
                current_user, "voided", "invoice", invoice["id"], invoice.get("invoice_number", ""),
                "Voided invoice via bulk action", metadata={"bulk_action": action},
            )
        return {"updated": len(invoices), "action": action}
    for invoice in invoices:
        result = await db.invoices.delete_one(
            {
                **_invoice_write_filter(invoice),
                "payment_status": {"$in": ["unpaid", None]},
                "status": {"$in": ["draft", "pending_approval"]},
            }
        )
        if not result.deleted_count:
            raise HTTPException(status_code=409, detail="Invoice changed before the bulk action could complete")
        await log_activity(
            current_user, "deleted", "invoice", invoice["id"], invoice.get("invoice_number", ""),
            "Deleted draft invoice via bulk action", metadata={"bulk_action": action},
        )
    return {"deleted": len(invoices), "action": action}


@router.post(
    "/billing-pro/invoices/export-csv",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def export_invoices_csv(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Body: {invoice_ids: [...] OR filter: {status, client_id, from, to}}"""
    ids = data.get("invoice_ids") or []
    if ids:
        if (
            not isinstance(ids, list)
            or len(ids) > 2000
            or any(not isinstance(invoice_id, str) or not invoice_id.strip() for invoice_id in ids)
        ):
            raise HTTPException(status_code=422, detail="invoice_ids must be a list of at most 2,000 invoice IDs")
        ids = list(dict.fromkeys(invoice_id.strip() for invoice_id in ids))
        invs = await db.invoices.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids))
        by_id = {str(invoice.get("id")): invoice for invoice in invs}
        if len(by_id) != len(ids):
            raise HTTPException(status_code=404, detail="Invoice not found")
        # Scope every requested ID before a single row is returned.  Do not
        # rely on a browser-side selection or a client_id display field.
        for invoice_id in ids:
            await assert_client_scope(
                current_user,
                by_id[invoice_id].get("client_id"),
                operation="billing.invoice.export",
                request=request,
                mask_not_found=True,
            )
    else:
        f = data.get("filter") or {}
        if not isinstance(f, dict):
            raise HTTPException(status_code=422, detail="filter must be an object")
        q = scope_query(current_user)
        status = f.get("status")
        if status and status != "all":
            if not isinstance(status, str):
                raise HTTPException(status_code=422, detail="filter.status must be a string")
            q["status"] = status
        client_id = f.get("client_id")
        if client_id:
            if not isinstance(client_id, str) or not client_id.strip():
                raise HTTPException(status_code=422, detail="filter.client_id must be an ID string")
            client_id = client_id.strip()
            await assert_client_scope(
                current_user,
                client_id,
                operation="billing.invoice.export",
                request=request,
                mask_not_found=True,
            )
            q["client_id"] = client_id
        invs = await db.invoices.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "Invoice #", "Invoice Name", "Status", "Payment Status", "Client", "Issue Date", "Due Date",
        "Subtotal", "Discount", "Tax", "Total", "Amount Paid", "Balance", "Notes"
    ])
    for inv in invs:
        balance = round((inv.get("total", 0) or 0) - (inv.get("amount_paid", 0) or 0), 2)
        w.writerow([
            _csv_text(inv.get("invoice_number", "")), _csv_text(inv.get("invoice_name", "")), _csv_text(inv.get("status", "")), _csv_text(inv.get("payment_status", "")),
            _csv_text(inv.get("client_name", "")), _csv_text((inv.get("created_at") or "")[:10]), _csv_text(inv.get("due_date") or ""),
            inv.get("subtotal", 0), inv.get("discount_amount", 0) or 0,
            inv.get("tax", 0), inv.get("total", 0), inv.get("amount_paid", 0), balance,
            _csv_text((inv.get("notes") or "").replace("\n", " ")[:200]),
        ])
    await log_activity(
        current_user,
        "exported",
        "invoice",
        "billing-pro-csv",
        "Invoice CSV export",
        "Exported scoped invoice records as CSV",
        metadata={"count": len(invs), "invoice_ids_supplied": bool(ids)},
    )
    return {"csv": buf.getvalue(), "count": len(invs), "filename": f"invoices-{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"}


# ============================================================================
#  AI SMART SUGGEST LINE ITEMS (from tickets/time-entries)
# ============================================================================

@router.get(
    "/billing-pro/invoices/smart-suggest",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def smart_suggest_lines(
    client_id: str,
    request: Request,
    days: int = 30,
    current_user: dict = Depends(get_current_user),
):
    """Suggest invoice line items from un-invoiced billable time entries + closed tickets in the period."""
    if not client_id or not client_id.strip():
        raise HTTPException(status_code=422, detail="client_id is required")
    if days < 1 or days > 366:
        raise HTTPException(status_code=422, detail="days must be between 1 and 366")
    client_id = client_id.strip()
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.invoice.smart_suggest",
        request=request,
        mask_not_found=True,
    )
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

@router.post(
    "/billing-pro/recurring/{ri_id}/set-indexation",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def set_indexation(
    ri_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Auto-bump pricing on each anniversary by X%. Body: {pct, anniversary_date, enabled}"""
    ri = await _load_scoped_recurring_invoice(ri_id, current_user, request, "billing.recurring.indexation.set")
    try:
        pct = float(data.get("pct", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="pct must be a number")
    if not math.isfinite(pct) or pct < -100 or pct > 100:
        raise HTTPException(status_code=422, detail="pct must be between -100 and 100")
    anniv = data.get("anniversary_date") or ri.get("start_date")
    if not isinstance(anniv, str) or not anniv:
        raise HTTPException(status_code=422, detail="anniversary_date is required")
    enabled = bool(data.get("enabled", True))
    result = await db.recurring_invoices.update_one(
        _recurring_invoice_write_filter(ri),
        {"$set": {
            "indexation": {"enabled": enabled, "pct": pct, "anniversary_date": anniv, "next_apply": anniv},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, "$inc": {"version": 1}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Recurring invoice changed before indexation could be saved")
    await log_activity(
        current_user,
        "updated",
        "recurring_invoice",
        ri_id,
        ri.get("description") or ri_id,
        "Updated recurring invoice indexation policy",
        metadata={"pct": pct, "enabled": enabled},
    )
    return {"message": f"Indexation set to +{pct}% on each {anniv}", "indexation": {"enabled": enabled, "pct": pct, "anniversary_date": anniv}}


@router.post(
    "/billing-pro/recurring/run-indexation",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def run_indexation(request: Request, current_user: dict = Depends(get_current_user)):
    """Apply indexation to all recurring invoices whose anniversary has passed.
    Bumps unit_price on every line item by the configured percentage."""
    await assert_global_scope(current_user, operation="billing.recurring.indexation.run", request=request)
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
        result = await db.recurring_invoices.update_one(
            _recurring_invoice_write_filter(ri),
            {"$set": {
                "line_items": new_lines,
                "subtotal": subtotal,
                "tax_amount": tax_amount,
                "amount": round(subtotal + tax_amount, 2),
                "indexation.next_apply": new_next,
                "indexation.last_applied": today,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }, "$inc": {"version": 1}}
        )
        if not result.matched_count:
            raise HTTPException(status_code=409, detail="A recurring invoice changed before indexation could be applied")
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
    await log_activity(
        current_user,
        "ran",
        "recurring_invoice",
        "billing-pro-indexation",
        "Recurring indexation run",
        "Applied due recurring invoice indexation policies",
        metadata={"bumped_count": len(bumped)},
    )
    return {"bumped_count": len(bumped), "bumped": bumped}


# ============================================================================
#  MID-CYCLE PRORATION
# ============================================================================

@router.post(
    "/billing-pro/recurring/{ri_id}/prorate",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def prorate_change(
    ri_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Calculate prorated charge for adding/removing a line item mid-cycle.
    Body: {quantity_delta, unit_price, description, effective_date}"""
    ri = await _load_scoped_recurring_invoice(ri_id, current_user, request, "billing.recurring.prorate")
    try:
        qty_delta = float(data.get("quantity_delta", 0))
        unit_price = float(data.get("unit_price", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="quantity_delta and unit_price must be numbers")
    if not math.isfinite(qty_delta) or not math.isfinite(unit_price):
        raise HTTPException(status_code=422, detail="quantity_delta and unit_price must be finite numbers")
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

@router.get(
    "/billing-pro/recurring/calendar",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def generation_calendar(request: Request, months: int = 3, current_user: dict = Depends(get_current_user)):
    """Forecast which recurring invoices will generate over the next N months."""
    await assert_global_scope(current_user, operation="billing.recurring.calendar.view", request=request)
    if months < 1 or months > 24:
        raise HTTPException(status_code=422, detail="months must be between 1 and 24")
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

@router.get(
    "/billing-pro/recurring/mrr-analytics",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def mrr_analytics(request: Request, current_user: dict = Depends(get_current_user)):
    """Compute MRR breakdown — new, churn, expansion, contraction over last 12 months."""
    await assert_global_scope(current_user, operation="billing.recurring.mrr_analytics.view", request=request)
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

@router.get(
    "/billing-pro/warehouses",
    dependencies=[Depends(require_action(_BILLING_ANALYTICS_ACTION))],
)
async def list_warehouses(request: Request, current_user: dict = Depends(get_current_user)):
    """List the organisation-wide warehouse configuration.

    Warehouses do not belong to a customer.  A client-restricted technician
    therefore cannot enumerate the wider MSP stock configuration through this
    legacy route.
    """
    await assert_global_scope(current_user, operation="billing.warehouse.list", request=request)
    items = await db.warehouses.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    if not items:
        # Preserve the useful first-run default while making its identity and
        # concurrency version explicit for later operational mutations.
        default = {
            "id": "wh-default",
            "name": "Main Warehouse",
            "code": "HQ",
            "address": "",
            "is_default": True,
            "version": 1,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.warehouses.insert_one(default.copy())
        await log_activity(
            current_user,
            "initialised",
            "warehouse",
            default["id"],
            default["name"],
            "Initialised the default organisation warehouse",
        )
        items = [default]
    return items


@router.post(
    "/billing-pro/warehouses",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def create_warehouse(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.warehouse.create", request=request)
    now = datetime.now(timezone.utc).isoformat()
    name = _bounded_catalogue_text(data.get("name", "New Location"), "name", maximum=120)
    if not name:
        raise HTTPException(status_code=422, detail="name must not be empty")
    code = _bounded_catalogue_text(data.get("code", ""), "code", maximum=8).upper()
    warehouse = {
        "id": f"wh-{uuid.uuid4().hex[:8]}",
        "name": name,
        "code": code,
        "address": _bounded_catalogue_text(data.get("address", ""), "address", maximum=500),
        "is_default": bool(data.get("is_default", False)),
        "version": 1,
        "created_at": now,
        "updated_at": now,
    }
    if warehouse["is_default"]:
        # There should be one default location.  Use per-record compare and
        # set updates so a stale configuration screen cannot silently replace
        # a concurrently changed default.
        current_defaults = await db.warehouses.find({"is_default": True}, {"_id": 0}).to_list(100)
        reset_defaults: list[dict] = []
        for existing in current_defaults:
            result = await db.warehouses.update_one(
                {**_record_write_filter(existing), "is_default": True},
                {"$set": {"is_default": False, "updated_at": now}, "$inc": {"version": 1}},
            )
            if not result.matched_count:
                # Restore defaults already changed in this request before
                # surfacing the concurrency conflict.
                for previous in reset_defaults:
                    try:
                        reset_version = int(previous.get("version") or 0) + 1
                    except (TypeError, ValueError):
                        reset_version = None
                    await db.warehouses.update_one(
                        (
                            {"id": previous["id"], "version": reset_version}
                            if reset_version is not None
                            else {"id": previous["id"]}
                        ),
                        {
                            "$set": {"is_default": True, "updated_at": datetime.now(timezone.utc).isoformat()},
                            "$inc": {"version": 1},
                        },
                    )
                raise HTTPException(status_code=409, detail="Warehouse default changed before this request completed")
            reset_defaults.append(existing)
    try:
        await db.warehouses.insert_one(warehouse.copy())
    except Exception:
        for previous in reset_defaults:
            try:
                reset_version = int(previous.get("version") or 0) + 1
            except (TypeError, ValueError):
                reset_version = None
            await db.warehouses.update_one(
                (
                    {"id": previous["id"], "version": reset_version}
                    if reset_version is not None
                    else {"id": previous["id"]}
                ),
                {
                    "$set": {"is_default": True, "updated_at": datetime.now(timezone.utc).isoformat()},
                    "$inc": {"version": 1},
                },
            )
        raise
    await log_activity(
        current_user,
        "created",
        "warehouse",
        warehouse["id"],
        warehouse["name"],
        "Created organisation warehouse",
        metadata={"is_default": warehouse["is_default"], "code": warehouse["code"]},
    )
    return warehouse


@router.delete(
    "/billing-pro/warehouses/{wh_id}",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def delete_warehouse(wh_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.warehouse.delete", request=request)
    warehouse = await _load_global_record(db.warehouses, wh_id, "Warehouse")
    if warehouse.get("is_default"):
        raise HTTPException(status_code=409, detail="The default warehouse cannot be deleted")
    products = await db.products.find({}, {"_id": 0, "id": 1, "stock_by_location": 1}).to_list(2000)
    referenced_product = next(
        (
            product
            for product in products
            if isinstance(product.get("stock_by_location"), dict)
            and _bounded_nonnegative_quantity(product["stock_by_location"].get(wh_id, 0), "stock quantity") > 0
        ),
        None,
    )
    if referenced_product:
        raise HTTPException(
            status_code=409,
            detail="Transfer stock out of this warehouse before deleting it",
        )
    result = await db.warehouses.delete_one(_record_write_filter(warehouse))
    if not result.deleted_count:
        raise HTTPException(status_code=409, detail="Warehouse changed before it could be deleted")
    await log_activity(
        current_user,
        "deleted",
        "warehouse",
        warehouse["id"],
        warehouse.get("name") or warehouse["id"],
        "Deleted organisation warehouse",
    )
    return {"message": "deleted"}


@router.post(
    "/billing-pro/products/{product_id}/transfer",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def transfer_stock(product_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Move shared catalogue stock between authorised organisation warehouses."""
    await assert_global_scope(current_user, operation="billing.inventory.transfer", request=request)
    from_id = _bounded_identifier(data.get("from_id"), "from_id")
    to_id = _bounded_identifier(data.get("to_id"), "to_id")
    qty = _bounded_positive_quantity(data.get("qty"), "qty")
    if from_id == to_id:
        raise HTTPException(status_code=422, detail="from_id and to_id must be different")
    product = await _load_global_record(db.products, product_id, "Product")
    await _load_global_record(db.warehouses, from_id, "Source warehouse")
    await _load_global_record(db.warehouses, to_id, "Destination warehouse")
    stock_by_loc = product.get("stock_by_location") or {}
    if not isinstance(stock_by_loc, dict):
        raise HTTPException(status_code=409, detail="Product stock locations are invalid and require reconciliation")
    stock_by_loc = dict(stock_by_loc)
    available = _bounded_nonnegative_quantity(stock_by_loc.get(from_id, 0), "source stock quantity")
    if available < qty:
        raise HTTPException(status_code=409, detail=f"Only {available} available at source")
    stock_by_loc[from_id] = available - qty
    stock_by_loc[to_id] = _bounded_nonnegative_quantity(stock_by_loc.get(to_id, 0), "destination stock quantity") + qty
    now = datetime.now(timezone.utc).isoformat()
    result = await db.products.update_one(
        _record_write_filter(product),
        {"$set": {"stock_by_location": stock_by_loc, "updated_at": now}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Product changed before stock could be transferred")
    await db.stock_transfers.insert_one({
        "id": str(uuid.uuid4()),
        "product_id": product_id,
        "product_name": product.get("name"),
        "from_id": from_id,
        "to_id": to_id,
        "qty": qty,
        "note": _bounded_catalogue_text(data.get("note", ""), "note", maximum=1000),
        "transferred_by": current_user.get("name", ""),
        "transferred_at": now,
    })
    await log_activity(
        current_user,
        "stock_transferred",
        "product",
        product_id,
        product.get("name") or product_id,
        "Transferred stock between organisation warehouses",
        metadata={"from_id": from_id, "to_id": to_id, "quantity": qty},
    )
    return {"message": f"Transferred {qty} unit(s)", "stock_by_location": stock_by_loc}


@router.get(
    "/billing-pro/products/inventory/snapshot",
    dependencies=[Depends(require_action(_BILLING_ANALYTICS_ACTION))],
)
async def inventory_snapshot(request: Request, current_user: dict = Depends(get_current_user)):
    """Return a bounded organisation-wide month-end valuation snapshot."""
    await assert_global_scope(current_user, operation="billing.inventory.snapshot", request=request)
    products = await db.products.find({}, {"_id": 0}).to_list(2000)
    total_units = 0
    total_value_cost = 0.0
    total_value_retail = 0.0
    by_category = {}
    low_stock = []
    for product in products:
        # Legacy catalogue records can contain incomplete data.  Treat a
        # malformed value as a reconciliation issue, not an opportunity to
        # return NaN/Infinity in financial output.
        try:
            qty = _bounded_nonnegative_quantity(product.get("quantity_in_stock", 0), "quantity_in_stock")
            cost = _bounded_catalogue_money(product.get("cost_price", 0), "cost_price")
            retail = _bounded_catalogue_money(product.get("retail_price", 0), "retail_price")
            reorder = _bounded_nonnegative_quantity(product.get("reorder_level", 0), "reorder_level")
        except HTTPException:
            continue
        total_units += qty
        total_value_cost += qty * cost
        total_value_retail += qty * retail
        category = str(product.get("category") or "Uncategorised")[:120]
        bucket = by_category.setdefault(category, {"category": category, "units": 0, "value_cost": 0.0, "value_retail": 0.0})
        bucket["units"] += qty
        bucket["value_cost"] += qty * cost
        bucket["value_retail"] += qty * retail
        if qty <= reorder:
            low_stock.append({
                "id": product.get("id"),
                "name": product.get("name"),
                "sku": product.get("sku"),
                "qty": qty,
                "reorder": reorder,
                "vendor": product.get("vendor", ""),
            })
    return {
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
        "total_units": total_units,
        "total_value_cost": round(total_value_cost, 2),
        "total_value_retail": round(total_value_retail, 2),
        "potential_margin": round(total_value_retail - total_value_cost, 2),
        "by_category": sorted(by_category.values(), key=lambda item: -item["value_cost"]),
        "low_stock": low_stock,
        "low_stock_count": len(low_stock),
    }


# ============================================================================
#  AUTO PO FROM LOW-STOCK
# ============================================================================

@router.post(
    "/billing-pro/products/{product_id}/create-po",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def create_po_from_low_stock(product_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Generate an organisation purchase order from a shared catalogue item."""
    await assert_global_scope(current_user, operation="billing.purchase_order.create", request=request)
    product = await _load_global_record(db.products, product_id, "Product")
    reorder_level = _bounded_nonnegative_quantity(product.get("reorder_level", 5), "reorder_level")
    quantity_in_stock = _bounded_nonnegative_quantity(product.get("quantity_in_stock", 0), "quantity_in_stock")
    default_qty = max(1, reorder_level * 2 - quantity_in_stock)
    qty = _bounded_positive_quantity(data["qty"] if "qty" in data else default_qty, "qty")
    cost = _bounded_catalogue_money(product.get("cost_price", 0), "cost_price")
    now = datetime.now(timezone.utc)
    po = {
        "id": f"po-{uuid.uuid4().hex[:8]}",
        "po_number": f"PO-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}",
        "vendor": _bounded_catalogue_text(product.get("vendor") or "Unknown", "vendor", maximum=200),
        "status": "draft",
        "version": 1,
        "items": [{
            "product_id": product["id"],
            "product_name": product.get("name"),
            "sku": product.get("sku", ""),
            "quantity": qty,
            "unit_cost": cost,
            "total": round(qty * cost, 2),
        }],
        "subtotal": round(qty * cost, 2),
        "tax": 0,
        "total": round(qty * cost, 2),
        "currency": "AUD",
        "expected_date": (now + timedelta(days=7)).date().isoformat(),
        "notes": _bounded_catalogue_text(
            data.get("note", f"Auto-generated for low stock of {product.get('name') or product_id}"),
            "note",
            maximum=2000,
        ),
        "created_by": current_user.get("name", ""),
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await db.purchase_orders.insert_one(po.copy())
    await log_activity(
        current_user,
        "created",
        "purchase_order",
        po["id"],
        po["po_number"],
        "Created purchase order from catalogue stock level",
        metadata={"product_id": product_id, "quantity": qty, "total": po["total"]},
    )
    return po


@router.get(
    "/billing-pro/purchase-orders",
    dependencies=[Depends(require_action(_BILLING_ANALYTICS_ACTION))],
)
async def list_pos(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.purchase_order.list", request=request)
    return await db.purchase_orders.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.put(
    "/billing-pro/purchase-orders/{po_id}/status",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def update_po_status(po_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Progress a purchase order with a compare-and-set receipt claim.

    The legacy implementation incremented stock on every request for
    ``received``.  Claiming a short-lived ``receiving`` state first prevents
    duplicate receipt requests from double-counting stock.
    """
    await assert_global_scope(current_user, operation="billing.purchase_order.status", request=request)
    requested_status = data.get("status")
    if requested_status not in {"draft", "sent", "received", "cancelled"}:
        raise HTTPException(status_code=422, detail="status must be draft, sent, received, or cancelled")
    po = await _load_global_record(db.purchase_orders, po_id, "Purchase order")
    current_status = str(po.get("status") or "draft")
    if current_status == requested_status:
        return {"message": f"PO already {requested_status}", "idempotent": True}
    valid_transitions = {
        "draft": {"sent", "received", "cancelled"},
        "sent": {"received", "cancelled"},
    }
    if requested_status not in valid_transitions.get(current_status, set()):
        raise HTTPException(status_code=409, detail=f"Cannot change a {current_status} purchase order to {requested_status}")
    now = datetime.now(timezone.utc).isoformat()
    if requested_status != "received":
        update_fields = {"status": requested_status, "updated_at": now}
        if requested_status == "sent" and not isinstance(po.get("document_snapshot"), dict):
            update_fields["document_snapshot"] = await freeze_commercial_document_snapshot(
                "purchase_order",
                po,
                await get_commercial_document_branding(database=db),
                database=db,
            )
        result = await db.purchase_orders.update_one(
            {**_record_write_filter(po), "status": current_status},
            {"$set": update_fields, "$inc": {"version": 1}},
        )
        if not result.matched_count:
            raise HTTPException(status_code=409, detail="Purchase order changed before its status could be updated")
        await log_activity(
            current_user,
            "status_changed",
            "purchase_order",
            po_id,
            po.get("po_number") or po_id,
            "Updated purchase-order status",
            metadata={"from": current_status, "to": requested_status},
        )
        return {"message": f"PO marked {requested_status}"}

    items = po.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=409, detail="Purchase order has no receivable items")
    product_quantities: dict[str, int] = {}
    products: dict[str, dict] = {}
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise HTTPException(status_code=409, detail=f"Purchase-order item {index + 1} is invalid")
        product_id = _bounded_identifier(item.get("product_id"), f"items[{index}].product_id")
        qty = _bounded_positive_quantity(item.get("quantity"), f"items[{index}].quantity")
        product_quantities[product_id] = product_quantities.get(product_id, 0) + qty
        if product_id not in products:
            product = await _load_global_record(db.products, product_id, "Purchase-order product")
            _bounded_nonnegative_quantity(product.get("quantity_in_stock", 0), "catalogue quantity_in_stock")
            products[product_id] = product

    try:
        claimed_version = int(po.get("version") or 0) + 1
    except (TypeError, ValueError):
        raise HTTPException(status_code=409, detail="Purchase order version requires reconciliation") from None

    claim = await db.purchase_orders.update_one(
        {**_record_write_filter(po), "status": current_status},
        {
            "$set": {"status": "receiving", "receiving_at": now, "updated_at": now},
            "$inc": {"version": 1},
        },
    )
    if not claim.matched_count:
        raise HTTPException(status_code=409, detail="Purchase order changed before stock receipt could begin")

    applied: list[tuple[dict, int]] = []
    try:
        for product_id, qty in product_quantities.items():
            product = products[product_id]
            result = await db.products.update_one(
                _record_write_filter(product),
                {
                    "$inc": {"quantity_in_stock": qty, "version": 1},
                    "$set": {"updated_at": now},
                },
            )
            if not result.matched_count:
                raise HTTPException(status_code=409, detail="A catalogue product changed before the purchase order could be received")
            applied.append((product, qty))
        for product, qty in applied:
            await db.product_stock_movements.insert_one({
                "id": str(uuid.uuid4()),
                "product_id": product["id"],
                "type": "in",
                "quantity": qty,
                "reason": f"PO {po.get('po_number')} received",
                "user": current_user.get("name", ""),
                "timestamp": now,
            })
    except Exception:
        # Compensate only records still at the version written by this receipt.
        # A concurrent change is never overwritten during best-effort rollback.
        for product, qty in applied:
            expected_version = int(product.get("version") or 0) + 1
            await db.products.update_one(
                {"id": product["id"], "version": expected_version},
                {
                    "$inc": {"quantity_in_stock": -qty, "version": 1},
                    "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
                },
            )
        await db.purchase_orders.update_one(
            {"id": po_id, "status": "receiving", "version": claimed_version},
            {
                "$set": {"status": current_status, "updated_at": datetime.now(timezone.utc).isoformat()},
                "$inc": {"version": 1},
            },
        )
        raise

    received = await db.purchase_orders.update_one(
        {"id": po_id, "status": "receiving", "version": claimed_version},
        {
            "$set": {"status": "received", "received_at": now, "updated_at": now},
            "$inc": {"version": 1},
        },
    )
    if not received.matched_count:
        raise HTTPException(status_code=409, detail="Purchase order receipt requires reconciliation")
    await log_activity(
        current_user,
        "received",
        "purchase_order",
        po_id,
        po.get("po_number") or po_id,
        "Received purchase order into catalogue stock",
        metadata={"product_count": len(product_quantities), "unit_count": sum(product_quantities.values())},
    )
    return {"message": "PO marked received"}


# ============================================================================
#  BULK PRODUCT CSV IMPORT
# ============================================================================

@router.post(
    "/billing-pro/products/bulk-import",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def bulk_import_products(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Import products from CSV. Body: {csv_text, mapping?: {csv_col: product_field}}.
    Default mapping assumes: Name, SKU, Category, Vendor, Cost Price, Retail Price, Stock, Reorder, Tax Rate, Description"""
    await assert_global_scope(current_user, operation="billing.catalogue.bulk_import", request=request)
    csv_text = data.get("csv_text", "")
    if not isinstance(csv_text, str) or not csv_text.strip():
        raise HTTPException(status_code=422, detail="csv_text required")
    if len(csv_text) > 5_000_000:
        raise HTTPException(status_code=422, detail="csv_text must not exceed 5 MB")
    reader = csv.DictReader(io.StringIO(csv_text))
    mapping = data.get("mapping") or {}
    if not isinstance(mapping, dict):
        raise HTTPException(status_code=422, detail="mapping must be an object")
    inserted, updated, errors = 0, 0, []
    now = datetime.now(timezone.utc).isoformat()
    for i, row in enumerate(reader, start=2):
        if i > 2001:
            errors.append({"row": i, "error": "Maximum 2,000 catalogue rows per import"})
            break
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
            name = _bounded_catalogue_text(get("name"), "name", maximum=200)
            if not name:
                continue
            sku = _bounded_catalogue_text(get("sku") or name.lower().replace(" ", "-")[:20], "sku", maximum=100)
            existing = await db.products.find_one({"sku": sku}, {"_id": 0})
            tax_rate = _bounded_catalogue_money(get("tax_rate", 0) or 0, "tax_rate")
            if tax_rate > 100:
                raise HTTPException(status_code=422, detail="tax_rate must not exceed 100")
            doc = {
                "name": name,
                "sku": sku,
                "category": _bounded_catalogue_text(get("category", "General"), "category", maximum=120),
                "vendor": _bounded_catalogue_text(get("vendor", ""), "vendor", maximum=200),
                "cost_price": _bounded_catalogue_money(get("cost_price", 0) or 0, "cost_price"),
                "retail_price": _bounded_catalogue_money(get("retail_price", 0) or 0, "retail_price"),
                "tax_rate": tax_rate,
                "quantity_in_stock": _bounded_nonnegative_quantity(get("stock", 0) or 0, "stock"),
                "reorder_level": _bounded_nonnegative_quantity(get("reorder", 5) or 5, "reorder"),
                "description": _bounded_catalogue_text(get("description", ""), "description", maximum=5000),
                "unit": _bounded_catalogue_text(get("unit", "each"), "unit", maximum=40),
                "is_active": True,
                "is_taxable": True,
                "updated_at": now,
            }
            if existing:
                result = await db.products.update_one(
                    _record_write_filter(existing),
                    {"$set": doc, "$inc": {"version": 1}},
                )
                if not result.matched_count:
                    raise HTTPException(status_code=409, detail="Product changed during bulk import")
                updated += 1
            else:
                doc["id"] = str(uuid.uuid4())
                doc["created_at"] = now
                doc["version"] = 1
                await db.products.insert_one(doc)
                inserted += 1
        except Exception as e:
            errors.append({"row": i, "error": str(e)[:100]})
    await log_activity(
        current_user,
        "bulk_imported",
        "product_catalogue",
        "billing-pro-csv-import",
        "Product catalogue CSV import",
        "Imported global catalogue products",
        metadata={"inserted": inserted, "updated": updated, "errors": len(errors)},
    )
    return {"inserted": inserted, "updated": updated, "errors": errors, "total_processed": inserted + updated}


# ============================================================================
#  QUANTITY-BREAK PRICING
# ============================================================================

@router.put(
    "/billing-pro/products/{product_id}/pricing-tiers",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def set_tier_pricing(product_id: str, data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Body: {tiers: [{min_qty: 1, unit_price: 100}, {min_qty: 10, unit_price: 90}, ...]}"""
    await assert_global_scope(current_user, operation="billing.catalogue.pricing_tiers.save", request=request)
    raw_tiers = data.get("tiers", [])
    if not isinstance(raw_tiers, list) or len(raw_tiers) > 100:
        raise HTTPException(status_code=422, detail="Tiers must be a list containing at most 100 tiers")
    tiers = []
    for index, tier in enumerate(raw_tiers):
        if not isinstance(tier, dict):
            raise HTTPException(status_code=422, detail=f"Tier {index + 1} must be an object")
        min_qty = _bounded_positive_quantity(tier.get("min_qty"), f"tiers[{index}].min_qty")
        unit_price = _bounded_catalogue_money(tier.get("unit_price"), f"tiers[{index}].unit_price")
        tiers.append({"min_qty": min_qty, "unit_price": unit_price})
    tiers.sort(key=lambda tier: tier["min_qty"])
    if len({tier["min_qty"] for tier in tiers}) != len(tiers):
        raise HTTPException(status_code=422, detail="Each tier must have a unique minimum quantity")
    product = await _load_global_record(db.products, product_id, "Product")
    result = await db.products.update_one(
        _record_write_filter(product),
        {"$set": {"pricing_tiers": tiers, "updated_at": datetime.now(timezone.utc).isoformat()}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Product changed before pricing tiers could be saved")
    await log_activity(
        current_user,
        "pricing_tiers_updated",
        "product",
        product_id,
        product.get("name") or product_id,
        "Updated global product quantity-break pricing",
        metadata={"tier_count": len(tiers)},
    )
    return {"message": f"Saved {len(tiers)} tier(s)", "tiers": tiers}


@router.get(
    "/billing-pro/products/{product_id}/price-for-qty",
    dependencies=[Depends(require_action(_BILLING_PORTAL_VIEW_ACTION))],
)
async def get_tier_price(product_id: str, qty: int, request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.catalogue.price_for_quantity", request=request)
    qty = _bounded_nonnegative_quantity(qty, "qty")
    product = await _load_global_record(db.products, product_id, "Product")
    tiers = product.get("pricing_tiers") or []
    base_price = _bounded_catalogue_money(product.get("retail_price", 0), "retail_price")
    chosen = base_price
    normalised_tiers = []
    for tier in tiers:
        if not isinstance(tier, dict):
            raise HTTPException(status_code=409, detail="Product pricing tiers require reconciliation")
        min_qty = _bounded_positive_quantity(tier.get("min_qty"), "pricing tier minimum quantity")
        unit_price = _bounded_catalogue_money(tier.get("unit_price", base_price), "pricing tier unit price")
        normalised_tiers.append((min_qty, unit_price))
    for min_qty, unit_price in sorted(normalised_tiers):
        if qty >= min_qty:
            chosen = unit_price
    return {"qty": qty, "unit_price": chosen, "total": round(qty * chosen, 2), "base_price": base_price, "tier_savings": round((base_price - chosen) * qty, 2)}


# ============================================================================
#  APPROVAL WORKFLOW
# ============================================================================

@router.get(
    "/billing-pro/settings/approval",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_approval_settings(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.approval_settings.view", request=request)
    cfg = await db.settings.find_one({"key": "invoice_approval"}, {"_id": 0}) or {}
    return cfg.get("value") or {"enabled": False, "threshold": 5000, "approver_role": "admin"}


@router.put(
    "/billing-pro/settings/approval",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def save_approval_settings(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await assert_global_scope(current_user, operation="billing.approval_settings.save", request=request)
    await db.settings.update_one({"key": "invoice_approval"}, {"$set": {"key": "invoice_approval", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await log_activity(
        current_user,
        "updated",
        "billing_configuration",
        "invoice_approval",
        "Invoice approval policy",
        "Updated organisation-wide invoice approval policy",
    )
    return {"message": "saved"}


@router.post(
    "/billing-pro/invoices/{invoice_id}/request-approval",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def request_approval(
    invoice_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    inv = await _load_scoped_invoice(invoice_id, current_user, request, "billing.invoice.approval.request")
    result = await db.invoices.update_one(
        {**_invoice_write_filter(inv), "status": "draft"},
        {"$set": {
            "status": "pending_approval",
            "approval_requested_by": current_user.get("name", ""),
            "approval_requested_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, "$inc": {"version": 1}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Invoice must still be a draft to request approval")
    await log_activity(
        current_user,
        "approval_requested",
        "invoice",
        invoice_id,
        inv.get("invoice_number", ""),
        "Requested invoice approval",
    )
    return {"message": "Approval requested"}


@router.post(
    "/billing-pro/invoices/{invoice_id}/approve",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def approve_invoice(
    invoice_id: str,
    request: Request,
    data: dict = None,
    current_user: dict = Depends(get_current_user),
):
    inv = await _load_scoped_invoice(invoice_id, current_user, request, "billing.invoice.approval.decide")
    decision = (data or {}).get("decision", "approve")
    if decision not in {"approve", "reject"}:
        raise HTTPException(status_code=422, detail="decision must be approve or reject")
    now = datetime.now(timezone.utc).isoformat()
    if decision == "approve":
        result = await db.invoices.update_one(
            {**_invoice_write_filter(inv), "status": "pending_approval"},
            {"$set": {
                "status": "draft",
                "approved_by": current_user.get("name", ""),
                "approved_at": now,
                "updated_at": now,
            }, "$inc": {"version": 1}}
        )
        if not result.matched_count:
            raise HTTPException(status_code=409, detail="Invoice is no longer awaiting approval")
        await log_activity(
            current_user,
            "approved",
            "invoice",
            invoice_id,
            inv.get("invoice_number", ""),
            "Approved invoice for sending",
        )
        return {"message": "Invoice approved — ready to send"}
    result = await db.invoices.update_one(
        {**_invoice_write_filter(inv), "status": "pending_approval"},
        {"$set": {
            "status": "rejected",
            "rejected_by": current_user.get("name", ""),
            "rejection_reason": (data or {}).get("reason", ""),
            "rejected_at": now,
            "updated_at": now,
        }, "$inc": {"version": 1}}
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Invoice is no longer awaiting approval")
    await log_activity(
        current_user,
        "rejected",
        "invoice",
        invoice_id,
        inv.get("invoice_number", ""),
        "Rejected invoice approval request",
        metadata={"reason_present": bool((data or {}).get("reason"))},
    )
    return {"message": "Invoice rejected"}


# ============================================================================
#  DEPOSITS / PROGRESS INVOICING
# ============================================================================

@router.post(
    "/billing-pro/invoices/{invoice_id}/create-deposit",
    dependencies=[Depends(require_action("billing.invoice.create"))],
)
async def create_deposit(
    invoice_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Body: {pct: 50}. Generates a deposit invoice = X% of parent."""
    parent = await _load_scoped_invoice(invoice_id, current_user, request, "billing.invoice.deposit.create")
    try:
        pct = float(data.get("pct", 50))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="pct must be a number")
    if not math.isfinite(pct) or pct <= 0 or pct > 100:
        raise HTTPException(status_code=422, detail="pct must be greater than 0 and no more than 100")
    if parent.get("status") in {"cancelled", "voided"}:
        raise HTTPException(status_code=409, detail="A voided invoice cannot create a deposit")
    if parent.get("has_deposit") or parent.get("deposit_invoice_id"):
        raise HTTPException(status_code=409, detail="A deposit invoice already exists for this invoice")
    deposit_amount = round(float(parent.get("total", 0)) * pct / 100, 2)
    if deposit_amount <= 0:
        raise HTTPException(status_code=409, detail="A positive invoice total is required to create a deposit")
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
        "version": 1,
    }
    # Reserve the parent first under its scoped identity and current version.
    # This avoids two concurrent create-deposit requests producing duplicate
    # financial documents.  If persistence of the child fails, release the
    # reservation again with the child ID as a guard.
    parent_update = await db.invoices.update_one(
        {
            **_invoice_write_filter(parent),
            "status": {"$nin": ["cancelled", "voided"]},
            "has_deposit": {"$ne": True},
        },
        {
            "$set": {
                "has_deposit": True,
                "deposit_invoice_id": deposit["id"],
                "deposit_pct": pct,
                "updated_at": now.isoformat(),
            },
            "$inc": {"version": 1},
        },
    )
    if not parent_update.matched_count:
        raise HTTPException(status_code=409, detail="Invoice changed before the deposit could be created")
    try:
        await db.invoices.insert_one(deposit)
    except Exception:
        await db.invoices.update_one(
            {"id": invoice_id, "client_id": parent.get("client_id"), "deposit_invoice_id": deposit["id"]},
            {
                "$set": {"has_deposit": False, "deposit_invoice_id": None, "deposit_pct": None, "updated_at": datetime.now(timezone.utc).isoformat()},
                "$inc": {"version": 1},
            },
        )
        raise
    deposit.pop("_id", None)
    await log_activity(
        current_user,
        "created",
        "invoice",
        deposit["id"],
        deposit["invoice_number"],
        "Created deposit invoice from parent invoice",
        metadata={"parent_invoice_id": invoice_id, "deposit_pct": pct, "amount": deposit_amount},
    )
    return deposit


# ============================================================================
#  MARGIN CALCULATOR
# ============================================================================

@router.post(
    "/billing-pro/products/suggest-retail",
    dependencies=[Depends(require_action(_CATALOGUE_MANAGE_ACTION))],
)
async def suggest_retail(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    """Body: {cost_price, target_margin_pct (default 35)}."""
    await assert_global_scope(current_user, operation="billing.catalogue.suggest_retail", request=request)
    cost = _bounded_catalogue_money(data.get("cost_price", 0), "cost_price")
    try:
        margin_pct = float(data.get("target_margin_pct", 35))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="target_margin_pct must be a finite percentage") from None
    if cost <= 0:
        raise HTTPException(status_code=422, detail="cost_price must be greater than zero")
    if not math.isfinite(margin_pct) or margin_pct < 0 or margin_pct >= 100:
        raise HTTPException(status_code=422, detail="target_margin_pct must be between 0 and 100")
    # Margin = (Retail - Cost)/Retail. So Retail = Cost / (1 - margin/100)
    retail = round(cost / (1 - margin_pct / 100), 2)
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

@router.get(
    "/billing-pro/settings/tax-compliance",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def get_tax_compliance(request: Request, current_user: dict = Depends(get_current_user)):
    await assert_global_scope(current_user, operation="billing.tax_compliance.view", request=request)
    cfg = await db.settings.find_one({"key": "tax_compliance"}, {"_id": 0}) or {}
    return cfg.get("value") or {
        "country": "AU", "abn": "", "gst_registered": True, "gst_pct": 10,
        "show_tax_invoice_label": True, "company_name": "", "company_address": "", "company_phone": "",
        "bank_name": "", "bsb": "", "account_number": "", "account_name": "",
    }


@router.put(
    "/billing-pro/settings/tax-compliance",
    dependencies=[Depends(require_action("platform.configuration.manage"))],
)
async def save_tax_compliance(
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await assert_global_scope(current_user, operation="billing.tax_compliance.save", request=request)
    await db.settings.update_one({"key": "tax_compliance"}, {"$set": {"key": "tax_compliance", "value": data, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    await log_activity(
        current_user,
        "updated",
        "billing_configuration",
        "tax_compliance",
        "Tax compliance and payment details",
        "Updated organisation-wide tax compliance configuration",
    )
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

@router.get(
    "/billing-pro/retainers/{client_id}",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def get_retainer(
    client_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.retainer.view",
        request=request,
        mask_not_found=True,
    )
    r = await db.retainers.find_one({"client_id": client_id}, {"_id": 0})
    if not r:
        return {"client_id": client_id, "balance_hours": 0, "rate": 0, "history": []}
    history = await db.retainer_transactions.find({"client_id": client_id}, {"_id": 0}).sort("date", -1).to_list(100)
    r["history"] = history
    return r


@router.post(
    "/billing-pro/retainers/{client_id}/topup",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def topup_retainer(
    client_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Body: {hours, rate, note}"""
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.retainer.topup",
        request=request,
        mask_not_found=True,
    )
    try:
        hrs = float(data.get("hours", 0))
        rate = float(data.get("rate", 75))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="hours and rate must be numbers")
    if not math.isfinite(hrs) or not math.isfinite(rate) or hrs <= 0 or rate < 0:
        raise HTTPException(status_code=422, detail="hours must be positive and rate cannot be negative")
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.retainers.find_one({"client_id": client_id}, {"_id": 0})
    if existing:
        new_balance = float(existing.get("balance_hours", 0)) + hrs
        result = await db.retainers.update_one(
            {"client_id": client_id, "balance_hours": existing.get("balance_hours", 0)},
            {
                "$set": {"rate": rate, "updated_at": now},
                "$inc": {"balance_hours": hrs, "version": 1},
            },
        )
        if not result.matched_count:
            raise HTTPException(status_code=409, detail="Retainer balance changed before hours could be added")
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
    await log_activity(
        current_user,
        "topped_up",
        "retainer",
        client_id,
        client_id,
        "Added prepaid retainer hours",
        metadata={"hours": hrs, "rate": rate},
    )
    return {"balance_hours": new_balance, "rate": rate}


@router.post(
    "/billing-pro/retainers/{client_id}/draw",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def draw_retainer(
    client_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Body: {hours, ticket_id, note}"""
    await assert_client_scope(
        current_user,
        client_id,
        operation="billing.retainer.draw",
        request=request,
        mask_not_found=True,
    )
    try:
        hrs = float(data.get("hours", 0))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="hours must be a number")
    if not math.isfinite(hrs) or hrs <= 0:
        raise HTTPException(status_code=422, detail="hours must be positive")
    r = await db.retainers.find_one({"client_id": client_id}, {"_id": 0})
    if not r or float(r.get("balance_hours", 0)) < hrs:
        raise HTTPException(status_code=400, detail="Insufficient retainer balance")
    new_balance = float(r["balance_hours"]) - hrs
    now = datetime.now(timezone.utc).isoformat()
    result = await db.retainers.update_one(
        {"client_id": client_id, "balance_hours": r.get("balance_hours")},
        {"$set": {"balance_hours": new_balance, "updated_at": now}, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Retainer balance changed before hours could be drawn")
    await db.retainer_transactions.insert_one({
        "id": str(uuid.uuid4()), "client_id": client_id, "type": "draw",
        "hours": hrs, "ticket_id": data.get("ticket_id"),
        "note": data.get("note", ""), "by": current_user.get("name", ""), "date": now,
    })
    await log_activity(
        current_user,
        "drawn",
        "retainer",
        client_id,
        client_id,
        "Drew prepaid retainer hours",
        metadata={"hours": hrs, "ticket_id": data.get("ticket_id")},
    )
    return {"balance_hours": new_balance}


# ============================================================================
#  CUSTOMER INVOICE PORTAL — comments / disputes
# ============================================================================

@router.get(
    "/billing-pro/invoices/{invoice_id}/comments",
    dependencies=[Depends(require_action("billing.portal.view"))],
)
async def get_comments(
    invoice_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    await _load_scoped_invoice(invoice_id, current_user, request, "billing.invoice.comments.view")
    docs = await db.invoice_comments.find({"invoice_id": invoice_id}, {"_id": 0}).sort("date", 1).to_list(200)
    return docs


@router.post(
    "/billing-pro/invoices/{invoice_id}/comments",
    dependencies=[Depends(require_action("billing.invoice.modify"))],
)
async def add_comment(
    invoice_id: str,
    data: dict,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    invoice = await _load_scoped_invoice(invoice_id, current_user, request, "billing.invoice.comments.create")
    doc = {
        "id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "client_id": invoice.get("client_id"),
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
        result = await db.invoices.update_one(
            _invoice_write_filter(invoice),
            {
                "$set": {
                    "is_disputed": True,
                    "dispute_opened_at": doc["date"],
                    "dispute_reason": doc["text"][:200],
                    "updated_at": doc["date"],
                },
                "$inc": {"version": 1},
            },
        )
        if not result.matched_count:
            # The comment remains retained as evidence, but the caller must
            # reload the invoice rather than silently setting a dispute on a
            # record whose ownership/state changed after scope validation.
            raise HTTPException(status_code=409, detail="Invoice changed before the dispute could be recorded")
    await log_activity(
        current_user,
        "commented",
        "invoice",
        invoice_id,
        invoice.get("invoice_number", ""),
        "Added invoice comment" + (" and opened a dispute" if doc["is_dispute"] else ""),
        metadata={"is_dispute": doc["is_dispute"]},
    )
    doc.pop("_id", None)
    return doc
