from fastapi import APIRouter, HTTPException, Depends, Request
from datetime import datetime, timezone, timedelta
import calendar
import math
import uuid
from pymongo.errors import DuplicateKeyError
from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import require_action
from app.services.activity import log_activity
from app.services.scope_permissions import (
    assert_client_scope,
    assert_global_scope,
    assert_record_scope,
    platform_tenant_id,
    scoped_query,
)

router = APIRouter()

RECURRING_FREQUENCIES = {"weekly", "fortnightly", "monthly", "quarterly", "annually"}


def _finite_number(value: object, field: str, *, minimum: float, maximum: float) -> float:
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{field} must be a number")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a number") from None
    if not math.isfinite(parsed) or not minimum <= parsed <= maximum:
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be between {minimum:g} and {maximum:g}",
        )
    return parsed


def _normalise_tax_rate(value: object, fallback: float = 0.0) -> float:
    return _finite_number(
        value if value is not None else fallback,
        "tax_rate",
        minimum=0.0,
        maximum=100.0,
    )


def _normalise_recurring_lines(raw_lines: object) -> list[dict]:
    if not isinstance(raw_lines, list) or not raw_lines:
        raise HTTPException(status_code=400, detail="At least one recurring invoice line is required")
    if len(raw_lines) > 200:
        raise HTTPException(status_code=422, detail="A recurring invoice supports at most 200 lines")
    lines: list[dict] = []
    for index, raw in enumerate(raw_lines, start=1):
        if not isinstance(raw, dict):
            raise HTTPException(status_code=422, detail=f"Line {index} must be an object")
        line = dict(raw)
        description = str(line.get("description") or "").strip()
        if not description:
            raise HTTPException(status_code=400, detail="Each recurring invoice line needs a description")
        quantity = _finite_number(
            line.get("quantity", 0), f"Line {index} quantity", minimum=0.0001, maximum=1_000_000
        )
        rate = _finite_number(
            line.get("rate", 0), f"Line {index} rate", minimum=0.0, maximum=1_000_000_000
        )
        line["description"] = description
        line["quantity"] = quantity
        line["rate"] = rate
        line["amount"] = round(quantity * rate, 2)
        lines.append(line)
    return lines


def _parse_recurring_date(value: object, field: str) -> datetime:
    text = str(value or "").strip()
    try:
        return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{field} must be a valid YYYY-MM-DD date") from None


def _recurring_write_filter(document: dict) -> dict:
    criteria = {"id": document.get("id"), "client_id": document.get("client_id")}
    version = document.get("version")
    criteria["version"] = version if version is not None else {"$exists": False}
    return criteria


def _recurring_anchor_day(ri: dict) -> int:
    try:
        anchor = int(ri.get("billing_anchor_day") or 0)
    except (TypeError, ValueError):
        anchor = 0
    if 1 <= anchor <= 31:
        return anchor
    try:
        return datetime.strptime(str(ri.get("start_date") or ""), "%Y-%m-%d").day
    except (TypeError, ValueError):
        return 1


async def _validated_recurring_contract(
    contract_id: object,
    client_id: str,
    current_user: dict,
    operation: str,
) -> str | None:
    """A recurring template may only link to a contract for the same client."""
    value = str(contract_id or "").strip()
    if not value:
        return None
    contract = await db.contracts.find_one(
        {"id": value}, {"_id": 0, "id": 1, "client_id": 1}
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    if str(contract.get("client_id") or "") != client_id:
        raise HTTPException(status_code=422, detail="The linked contract belongs to a different client")
    await assert_client_scope(
        current_user,
        contract.get("client_id"),
        operation=operation,
        mask_not_found=True,
    )
    return value


def _monthly_recurring_value(amount: float, frequency: str) -> float:
    freq = str(frequency or "monthly").lower()
    if freq == "weekly":
        return amount * 52 / 12
    if freq == "fortnightly":
        return amount * 26 / 12
    if freq == "quarterly":
        return amount / 3
    if freq == "annually":
        return amount / 12
    return amount


async def _get_scoped_recurring_invoice(
    recurring_invoice_id: str,
    current_user: dict,
    *,
    operation: str,
) -> dict:
    """Load one recurring invoice without revealing another client's record."""
    return await assert_record_scope(
        current_user,
        db.recurring_invoices,
        recurring_invoice_id,
        operation=operation,
        resource_name="Recurring invoice",
    )


async def _require_global_recurring_template_scope(
    current_user: dict,
    request: Request | None,
    operation: str,
) -> None:
    """Reusable billing baselines are organisation-wide commercial settings."""
    await assert_global_scope(current_user, operation=operation, request=request)


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


async def _resolve_acronis_usage_lines(recurring: dict, current_user: dict) -> list[dict]:
    """Attach verified Acronis usage, failing closed when it cannot be priced.

    A linked tenant with no billable lines usually means a provider outage, an
    empty usage response, or an incomplete pricing map.  Generating the base
    invoice in that state silently under-bills the client, so the template is
    blocked until the usage can be reconciled.
    """
    if not recurring.get("include_acronis_usage"):
        return []
    client_id = str(recurring.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=409, detail="Acronis billing is enabled but the recurring invoice has no client")
    try:
        from app.routers.acronis import get_client_acronis_billing

        usage = await get_client_acronis_billing(client_id, current_user=current_user)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Acronis usage could not be verified; no potentially incomplete invoice was generated",
        ) from exc
    if not usage.get("linked"):
        raise HTTPException(status_code=409, detail="Acronis billing is enabled but no Acronis tenant is linked to this client")
    if usage.get("error"):
        raise HTTPException(
            status_code=503,
            detail="Acronis usage could not be retrieved; no potentially incomplete invoice was generated",
        )
    line_items = usage.get("line_items") or []
    total = _finite_number(usage.get("total", 0), "Acronis usage total", minimum=0, maximum=1_000_000_000)
    if not line_items or total <= 0:
        raise HTTPException(
            status_code=409,
            detail="Acronis billing is enabled but no billable usage was returned; check the tenant and product pricing mappings",
        )
    period = usage.get("period") or datetime.now(timezone.utc).strftime("%Y-%m")
    currency = usage.get("currency") or recurring.get("currency") or "AUD"
    attached: list[dict] = []
    for item in line_items:
        quantity = _finite_number(item.get("quantity"), "Acronis line quantity", minimum=0, maximum=1_000_000)
        rate = _finite_number(item.get("unit_price"), "Acronis unit price", minimum=0, maximum=1_000_000_000)
        amount = _finite_number(item.get("total"), "Acronis line total", minimum=0, maximum=1_000_000_000)
        attached.append({
            "description": f"Acronis - {item.get('label') or 'Usage'} ({period})",
            "details": f"{quantity} {item.get('unit') or 'unit'} x {currency} {rate:.4f}",
            "quantity": quantity,
            "rate": rate,
            "amount": round(amount, 2),
            "acronis_auto": True,
            "acronis_period": period,
        })
    return attached


async def _resolve_pax8_usage_lines(recurring: dict, current_user: dict) -> list[dict]:
    """Attach verified Pax8 subscription usage, failing closed on uncertainty."""
    if not recurring.get("include_pax8_usage"):
        return []
    client_id = str(recurring.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=409, detail="Pax8 billing is enabled but the recurring invoice has no client")
    try:
        from app.routers.pax8 import pax8_billing_client

        usage = await pax8_billing_client(client_id, current_user=current_user)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Pax8 usage could not be verified; no potentially incomplete invoice was generated",
        ) from exc
    if not usage.get("linked"):
        raise HTTPException(status_code=409, detail="Pax8 billing is enabled but no Pax8 company is linked to this client")
    if usage.get("error"):
        raise HTTPException(
            status_code=503,
            detail="Pax8 usage could not be retrieved; no potentially incomplete invoice was generated",
        )
    line_items = usage.get("line_items") or []
    total = _finite_number(usage.get("total", 0), "Pax8 usage total", minimum=0, maximum=1_000_000_000)
    if not line_items or total <= 0:
        raise HTTPException(
            status_code=409,
            detail="Pax8 billing is enabled but no active billable subscriptions were returned; reconcile the subscription sync before invoicing",
        )
    period = usage.get("period") or datetime.now(timezone.utc).strftime("%Y-%m")
    currency = usage.get("currency") or recurring.get("currency") or "AUD"
    attached: list[dict] = []
    for item in line_items:
        quantity = _finite_number(item.get("quantity"), "Pax8 line quantity", minimum=0, maximum=1_000_000)
        rate = _finite_number(item.get("unit_price"), "Pax8 unit price", minimum=0, maximum=1_000_000_000)
        amount = _finite_number(item.get("total"), "Pax8 line total", minimum=0, maximum=1_000_000_000)
        attached.append({
            "description": f"Pax8 - {item.get('label') or 'Subscription'} ({period})",
            "details": f"{quantity} {item.get('unit') or 'unit'} x {currency} {rate:.4f} - {item.get('billing_term') or 'monthly'}",
            "quantity": quantity,
            "rate": rate,
            "amount": round(amount, 2),
            "pax8_auto": True,
            "pax8_product_id": item.get("product_id"),
            "pax8_period": period,
            "pax8_billing_term": item.get("billing_term"),
        })
    return attached


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
    # Do not seed demo billing data from a read path.  An empty scoped result is
    # legitimate, particularly for a technician who is assigned to another client.
    return await db.recurring_invoices.find(
        scoped_query(current_user), {"_id": 0}
    ).sort("created_at", -1).to_list(500)


@router.get("/recurring-invoices/stats")
async def get_recurring_stats(current_user: dict = Depends(get_current_user)):
    all_ri = await db.recurring_invoices.find(
        scoped_query(current_user), {"_id": 0}
    ).to_list(500)
    active = [r for r in all_ri if r.get("status") == "active"]
    paused = [r for r in all_ri if r.get("status") == "paused"]
    by_frequency = {freq: 0 for freq in sorted(RECURRING_FREQUENCIES)}
    for record in active:
        frequency = str(record.get("frequency") or "monthly").lower()
        if frequency in by_frequency:
            by_frequency[frequency] += 1
    mrr = sum(
        _monthly_recurring_value(float(r.get("amount") or 0), str(r.get("frequency") or "monthly"))
        for r in active
    )
    arr = mrr * 12
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
        except Exception:
            pass
    return {
        "total": len(all_ri), "active": len(active), "paused": len(paused),
        "mrr": round(mrr, 2), "arr": round(arr, 2),
        "total_generated": total_generated, "total_revenue": round(total_revenue, 2),
        "due_this_week": due_soon,
        "by_frequency": by_frequency,
    }


@router.get("/recurring-invoices/{ri_id}")
async def get_recurring_invoice(ri_id: str, current_user: dict = Depends(get_current_user)):
    return await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.read"
    )


@router.post("/recurring-invoices/create")
async def create_recurring(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    client_id = str(data.get("client_id") or "").strip()
    description = str(data.get("description") or "").strip()
    if not client_id or not description:
        raise HTTPException(status_code=400, detail="Client and description are required")
    await assert_client_scope(
        current_user,
        client_id,
        operation="recurring_invoice.create",
        mask_not_found=True,
    )
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Amounts are always derived from quantity x rate.  Never trust a client
    # supplied line total, which could otherwise under-bill or over-bill the
    # customer while looking legitimate in the template.
    line_items = _normalise_recurring_lines(data.get("line_items"))
    subtotal = round(sum(li["amount"] for li in line_items), 2)
    tax_rate = _normalise_tax_rate(data.get("tax_rate", 0))
    tax_amount = round(subtotal * tax_rate / 100, 2)
    total = round(subtotal + tax_amount, 2)

    start_date = str(data.get("start_date") or now.strftime("%Y-%m-%d")).strip()
    start_dt = _parse_recurring_date(start_date, "start_date")
    end_date = None
    if str(data.get("end_date") or "").strip():
        end_date = str(data["end_date"]).strip()
        if _parse_recurring_date(end_date, "end_date") < start_dt:
            raise HTTPException(status_code=422, detail="end_date cannot be before start_date")
    frequency = str(data.get("frequency") or "monthly").strip().lower()
    if frequency not in RECURRING_FREQUENCIES:
        raise HTTPException(
            status_code=422,
            detail=f"frequency must be one of {', '.join(sorted(RECURRING_FREQUENCIES))}",
        )
    if data.get("auto_send") and not str(data.get("auto_send_email", "")).strip():
        raise HTTPException(status_code=400, detail="An email recipient is required when auto-send is enabled")
    contract_id = await _validated_recurring_contract(
        data.get("contract_id"), client_id, current_user, "recurring_invoice.create"
    )

    inv = {
        "id": f"ri-{uuid.uuid4().hex[:8]}",
        "client_id": client_id,
        "client_name": client.get("name") or data.get("client_name", ""),
        "description": description,
        "line_items": line_items,
        "subtotal": subtotal,
        "tax_rate": tax_rate,
        "tax_amount": tax_amount,
        "amount": total,
        "currency": str(data.get("currency") or "AUD").strip().upper()[:8],
        "frequency": frequency,
        "start_date": start_date,
        "billing_anchor_day": start_dt.day,
        "next_generation": _calc_next_date(start_date, frequency, start_dt.day),
        "end_date": end_date,
        "contract_id": contract_id,
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
        "tenant_id": platform_tenant_id(current_user),
        "version": 1,
        "created_by": current_user.get("name", ""),
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    await db.recurring_invoices.insert_one(inv)
    return {k: v for k, v in inv.items() if k != "_id"}


@router.put("/recurring-invoices/{ri_id}")
async def update_recurring(ri_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    ri = await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.update"
    )
    requested_client_id = data.get("client_id")
    if requested_client_id is not None and str(requested_client_id) != str(ri.get("client_id") or ""):
        raise HTTPException(
            status_code=422,
            detail="A recurring invoice cannot be moved to a different client",
        )
    # Billing state is server-owned.  A general PUT must not be able to forge
    # generated counts, totals, history, the next billing period, or status.
    editable = {
        "description", "line_items", "tax_rate", "frequency", "start_date",
        "end_date", "contract_id", "payment_terms", "notes", "auto_send",
        "auto_send_email", "include_pdf", "include_acronis_usage",
        "include_pax8_usage", "include_yeastar_usage", "currency", "invoice_name",
    }
    unknown = sorted(set(data) - editable - {"id", "_id", "client_id", "created_at", "created_by"})
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"These fields are server-managed and cannot be updated: {', '.join(unknown)}",
        )
    update = {k: v for k, v in data.items() if k in editable}
    if not update:
        raise HTTPException(status_code=422, detail="No editable recurring invoice fields were supplied")

    frequency = str(update.get("frequency", ri.get("frequency") or "monthly")).strip().lower()
    if frequency not in RECURRING_FREQUENCIES:
        raise HTTPException(
            status_code=422,
            detail=f"frequency must be one of {', '.join(sorted(RECURRING_FREQUENCIES))}",
        )
    if "frequency" in update:
        update["frequency"] = frequency

    start_date = str(update.get("start_date") or ri.get("start_date") or "").strip()
    if "start_date" in update:
        start_dt = _parse_recurring_date(start_date, "start_date")
        update["start_date"] = start_date
        update["billing_anchor_day"] = start_dt.day
    else:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            start_dt = datetime.now(timezone.utc)
    end_date = update.get("end_date", ri.get("end_date"))
    if str(end_date or "").strip():
        end_date = str(end_date).strip()
        if _parse_recurring_date(end_date, "end_date") < start_dt:
            raise HTTPException(status_code=422, detail="end_date cannot be before start_date")
        update["end_date"] = end_date
    else:
        update["end_date"] = None
    if "contract_id" in update:
        update["contract_id"] = await _validated_recurring_contract(
            update["contract_id"], str(ri.get("client_id") or ""), current_user, "recurring_invoice.update"
        )

    line_items = (
        _normalise_recurring_lines(update["line_items"])
        if "line_items" in update
        else list(ri.get("line_items") or [])
    )
    if "line_items" in update:
        update["line_items"] = line_items
    if "line_items" in update or "tax_rate" in update:
        tax_rate = _normalise_tax_rate(update.get("tax_rate"), float(ri.get("tax_rate") or 0))
        subtotal = round(sum(float(li.get("amount", 0)) for li in line_items), 2)
        update["tax_rate"] = tax_rate
        update["subtotal"] = subtotal
        update["tax_amount"] = round(subtotal * tax_rate / 100, 2)
        update["amount"] = round(subtotal + update["tax_amount"], 2)

    if "frequency" in update or "start_date" in update:
        anchor = int(update.get("billing_anchor_day") or _recurring_anchor_day(ri))
        base = str(ri.get("next_generation") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        # A future start date should schedule from that date.  Otherwise keep
        # the existing next billing period so a cadence edit cannot rewind and
        # re-bill periods that were already generated.
        if start_date > datetime.now(timezone.utc).strftime("%Y-%m-%d") and start_date > base:
            base = start_date
        update["next_generation"] = _calc_next_date(base, frequency, anchor)

    if update.get("auto_send", ri.get("auto_send", False)) and not str(update.get("auto_send_email", ri.get("auto_send_email", ""))).strip():
        raise HTTPException(status_code=400, detail="An email recipient is required when auto-send is enabled")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.recurring_invoices.update_one(
        _recurring_write_filter(ri),
        {"$set": update, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Recurring invoice changed before the update could be saved")
    return {"message": "Updated"}


@router.delete("/recurring-invoices/{ri_id}")
async def delete_recurring(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.delete"
    )
    if ri.get("invoices_generated", 0) > 0 or ri.get("generation_history"):
        raise HTTPException(status_code=400, detail="Recurring invoices with generated invoice history are retained for financial traceability")
    await db.recurring_invoices.delete_one({"id": ri_id, "client_id": ri.get("client_id")})
    return {"message": "Deleted"}


@router.get("/recurring-invoices/by-client/{client_id}")
async def get_recurring_by_client(client_id: str, current_user: dict = Depends(get_current_user)):
    """Return active recurring invoices for a specific client (used by Acronis link UI)."""
    await assert_client_scope(
        current_user,
        client_id,
        operation="recurring_invoice.list_by_client",
        mask_not_found=True,
    )
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
    ri = await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.acronis_auto.update"
    )
    enabled = bool(data.get("include_acronis_usage", True))
    await db.recurring_invoices.update_one(
        {"id": ri_id, "client_id": ri.get("client_id")},
        {"$set": {
            "include_acronis_usage": enabled,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"message": f"Acronis auto-billing {'enabled' if enabled else 'disabled'} on {ri_id}", "include_acronis_usage": enabled}


@router.post("/recurring-invoices/{ri_id}/toggle")
async def toggle_recurring(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.toggle"
    )
    if ri.get("status") not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Only active or paused recurring invoices can be toggled")
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    new_status = "paused" if ri.get("status") == "active" else "active"
    update = {"status": new_status, "updated_at": now.isoformat()}
    if new_status == "active":
        end_date = str(ri.get("end_date") or "").strip()
        if end_date and end_date < today:
            raise HTTPException(status_code=409, detail=f"This recurring invoice ended on {end_date} and cannot be resumed")
        next_generation = str(ri.get("next_generation") or today)
        if not ri.get("next_generation"):
            update["next_generation"] = next_generation
        if next_generation < today:
            # Do not back-bill the whole paused period.  Move to the next
            # scheduled occurrence on or after today, keeping the anchor day.
            guard = 0
            while next_generation < today and guard < 520:
                next_generation = _calc_next_date(next_generation, ri.get("frequency", "monthly"), _recurring_anchor_day(ri))
                guard += 1
            update["next_generation"] = next_generation
        update["resumed_at"] = now.isoformat()
    else:
        update["paused_at"] = now.isoformat()
    result = await db.recurring_invoices.update_one(
        _recurring_write_filter(ri),
        {"$set": update, "$inc": {"version": 1}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="Recurring invoice changed before it could be toggled")
    return {"status": new_status}


@router.post("/recurring-invoices/{ri_id}/generate-now")
async def generate_invoice_now(ri_id: str, current_user: dict = Depends(get_current_user)):
    """Manually generate an invoice from a recurring template right now.

    Enabled provider usage is attached from verified live data.  If it cannot
    be reconciled the request fails rather than billing a base-only invoice.
    """
    ri = await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.generate"
    )
    if ri.get("status") != "active":
        raise HTTPException(status_code=400, detail="Activate the recurring invoice before generating an invoice")

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    billing_period = ri.get("next_generation") or today
    if str(ri.get("start_date") or "") > today:
        raise HTTPException(status_code=409, detail=f"This recurring invoice starts on {ri.get('start_date')} and cannot be billed yet")
    end_date = str(ri.get("end_date") or "").strip()
    if end_date and (end_date < today or billing_period > end_date):
        await db.recurring_invoices.update_one(
            {"id": ri_id, "client_id": ri.get("client_id")},
            {"$set": {"status": "completed", "completed_at": now.isoformat(), "completion_reason": "end_date_reached", "updated_at": now.isoformat()}},
        )
        raise HTTPException(status_code=409, detail=f"This recurring invoice ended on {end_date} and has been completed")
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

    # Provider usage resolves fail closed, so an unlinked tenant, provider
    # outage or unpriced usage cannot silently under-bill the client.
    acronis_attached = await _resolve_acronis_usage_lines(ri, current_user)
    line_items.extend(acronis_attached)

    pax8_attached = await _resolve_pax8_usage_lines(ri, current_user)
    line_items.extend(pax8_attached)

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
        "tenant_id": ri.get("tenant_id") or platform_tenant_id(current_user),
        "version": 1,
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
    next_date = _calc_next_date(billing_period, ri.get("frequency", "monthly"), _recurring_anchor_day(ri))
    schedule_update = {
        "last_generated": now.isoformat(),
        "next_generation": next_date,
        "updated_at": now.isoformat(),
    }
    if end_date and next_date > end_date:
        schedule_update.update({
            "status": "completed",
            "completed_at": now.isoformat(),
            "completion_reason": "end_date_reached",
        })
    await db.recurring_invoices.update_one(
        _recurring_write_filter(ri),
        {
            "$inc": {"invoices_generated": 1, "total_billed": total, "version": 1},
            "$set": schedule_update,
            "$push": {"generation_history": gen_entry},
        },
    )

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
    ri = await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.duplicate"
    )
    now = datetime.now(timezone.utc)
    new_ri = {**ri}
    new_ri["id"] = f"ri-{uuid.uuid4().hex[:8]}"
    new_ri["description"] = f"(Copy) {ri.get('description', '')}"
    new_ri["status"] = "paused"
    new_ri["invoices_generated"] = 0
    new_ri["total_billed"] = 0
    new_ri["last_generated"] = None
    new_ri["generation_history"] = []
    new_ri["completed_at"] = None
    new_ri["completion_reason"] = None
    new_ri["version"] = 1
    new_ri["tenant_id"] = platform_tenant_id(current_user)
    new_ri["created_by"] = current_user.get("name", "")
    new_ri["created_at"] = now.isoformat()
    new_ri["updated_at"] = now.isoformat()
    today = now.strftime("%Y-%m-%d")
    if str(new_ri.get("next_generation") or "") < today:
        new_ri["next_generation"] = _calc_next_date(today, new_ri.get("frequency", "monthly"), _recurring_anchor_day(new_ri))
    await db.recurring_invoices.insert_one(new_ri)
    return {k: v for k, v in new_ri.items() if k != "_id"}


@router.get("/recurring-invoices/{ri_id}/history")
async def get_generation_history(ri_id: str, current_user: dict = Depends(get_current_user)):
    ri = await _get_scoped_recurring_invoice(
        ri_id, current_user, operation="recurring_invoice.history.read"
    )
    return ri.get("generation_history", [])


# ============== RECURRING BILLING TEMPLATES (reusable line-item baselines) ==============

# These are deliberately not ``/invoice-templates``.  That public namespace is
# owned by the commercial PDF-layout template studio.  Reusing it made the
# recurring UI create/list the wrong collection and let FastAPI shadow dynamic
# update/delete handlers according to import order.
@router.get(
    "/recurring-invoice-templates",
    dependencies=[Depends(require_action("billing.document_template.manage"))],
)
async def get_invoice_templates(
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_recurring_template_scope(
        current_user, request, "recurring_invoice.template.list"
    )
    templates = await db.invoice_templates.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return templates


@router.post(
    "/recurring-invoice-templates",
    dependencies=[Depends(require_action("billing.document_template.manage"))],
)
async def create_invoice_template(
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_recurring_template_scope(
        current_user, request, "recurring_invoice.template.create"
    )
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Template payload must be an object")
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
    result = {k: v for k, v in template.items() if k != "_id"}
    await log_activity(
        current_user,
        "created",
        "recurring_invoice_template",
        result["id"],
        result["name"],
        "Created an organisation-wide reusable recurring billing template",
        metadata={"category": result["category"], "line_item_count": len(result["line_items"])},
    )
    return result


@router.put(
    "/recurring-invoice-templates/{template_id}",
    dependencies=[Depends(require_action("billing.document_template.manage"))],
)
async def update_invoice_template(
    template_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_recurring_template_scope(
        current_user, request, "recurring_invoice.template.update"
    )
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Template payload must be an object")
    tpl = await db.invoice_templates.find_one({"id": template_id})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    editable_fields = {
        "name", "description", "line_items", "tax_rate", "payment_terms",
        "notes", "currency", "category",
    }
    update = {key: value for key, value in data.items() if key in editable_fields}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.invoice_templates.update_one({"id": template_id}, {"$set": update})
    await log_activity(
        current_user,
        "updated",
        "recurring_invoice_template",
        template_id,
        tpl.get("name") or "Recurring billing template",
        "Updated an organisation-wide reusable recurring billing template",
        metadata={"fields": sorted(key for key in update if key != "updated_at")},
    )
    return {"message": "Template updated"}


@router.delete(
    "/recurring-invoice-templates/{template_id}",
    dependencies=[Depends(require_action("billing.document_template.manage"))],
)
async def delete_invoice_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    await _require_global_recurring_template_scope(
        current_user, request, "recurring_invoice.template.delete"
    )
    existing = await db.invoice_templates.find_one({"id": template_id}, {"_id": 0, "name": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")
    result = await db.invoice_templates.delete_one({"id": template_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    await log_activity(
        current_user,
        "deleted",
        "recurring_invoice_template",
        template_id,
        existing.get("name") or "Recurring billing template",
        "Deleted an organisation-wide reusable recurring billing template",
    )
    return {"message": "Template deleted"}


@router.post(
    "/recurring-invoice-templates/{template_id}/apply",
    dependencies=[Depends(require_action("billing.document_template.manage"))],
)
async def apply_template_to_recurring(
    template_id: str,
    data: dict,
    current_user: dict = Depends(get_current_user),
    request: Request = None,
):
    """Create a recurring invoice from a template."""
    await _require_global_recurring_template_scope(
        current_user, request, "recurring_invoice.template.apply"
    )
    if not isinstance(data, dict):
        raise HTTPException(status_code=422, detail="Template payload must be an object")
    tpl = await db.invoice_templates.find_one({"id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    # Check the requested client before mutating the global template's usage
    # counter.  Otherwise a restricted technician could still alter shared
    # billing metadata while attempting to create a foreign-client invoice.
    client_id = str(data.get("client_id") or "").strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="Client is required")
    await assert_client_scope(
        current_user,
        client_id,
        operation="recurring_invoice.template.apply",
        mask_not_found=True,
    )
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
    recurring = await create_recurring(create_data, current_user)
    await log_activity(
        current_user,
        "applied",
        "recurring_invoice_template",
        template_id,
        tpl.get("name") or "Recurring billing template",
        "Applied a reusable recurring billing template",
        metadata={"recurring_invoice_id": recurring.get("id"), "client_id": client_id},
    )
    return recurring



# ============== SCHEDULER STATUS & LOGS ==============

@router.get("/recurring-invoices/scheduler/status")
async def get_scheduler_status(current_user: dict = Depends(get_current_user)):
    """Get the auto-generation scheduler status and recent logs."""
    await assert_global_scope(
        current_user, operation="recurring_invoice.scheduler.read"
    )
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
    await assert_global_scope(
        current_user, operation="recurring_invoice.scheduler.run"
    )
    return await _run_scheduler_now(current_user)


async def _run_scheduler_now(current_user: dict) -> dict:
    """Run the global scheduler after its caller has passed the global boundary.

    This private helper is also used by the server-owned background worker.  It
    deliberately has no FastAPI dependency so scheduled work can use an
    explicit, auditable system actor rather than bypassing the route's policy.
    """
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
            start_date = str(ri.get("start_date") or "").strip()
            end_date = str(ri.get("end_date") or "").strip()
            if start_date and billing_period < start_date:
                results.append({"ri_id": ri["id"], "client": ri.get("client_name"), "status": "skipped", "reason": f"Starts on {start_date}"})
                continue
            if end_date and (end_date < today_str or billing_period > end_date):
                await db.recurring_invoices.update_one(
                    _recurring_write_filter(ri),
                    {"$set": {"status": "completed", "completed_at": now.isoformat(), "completion_reason": "end_date_reached", "updated_at": now.isoformat()}, "$inc": {"version": 1}},
                )
                results.append({"ri_id": ri["id"], "client": ri.get("client_name"), "status": "skipped", "reason": f"Ended on {end_date}"})
                continue
            inv_number = f"INV-{now.strftime('%Y%m')}-{uuid.uuid4().hex[:4].upper()}"
            due_date = _calc_due_date(ri.get("payment_terms", "net_30"))

            # Start from static line items (strip any prior auto-attach)
            line_items = await _resolve_source_driven_lines(ri)
            acronis_attached = []
            pax8_attached = []

            # Parity with /generate-now: provider usage resolves fail closed
            # rather than generating an incomplete invoice.
            acronis_attached = await _resolve_acronis_usage_lines(ri, current_user)
            line_items.extend(acronis_attached)
            pax8_attached = await _resolve_pax8_usage_lines(ri, current_user)
            line_items.extend(pax8_attached)

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
                "tenant_id": ri.get("tenant_id") or platform_tenant_id(current_user),
                "version": 1,
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

            next_date = _calc_next_date(billing_period, ri.get("frequency", "monthly"), _recurring_anchor_day(ri))
            gen_entry = {"invoice_id": invoice["id"], "invoice_number": inv_number, "amount": total, "generated_at": now.isoformat(), "generated_by": actor_name, "acronis_items": len(acronis_attached), "pax8_items": len(pax8_attached), "yeastar_items": len(yeastar_attached), "delivery": delivery}
            schedule_update = {"last_generated": now.isoformat(), "next_generation": next_date, "updated_at": now.isoformat()}
            if end_date and next_date > end_date:
                schedule_update.update({"status": "completed", "completed_at": now.isoformat(), "completion_reason": "end_date_reached"})
            await db.recurring_invoices.update_one(
                _recurring_write_filter(ri),
                {
                    "$inc": {"invoices_generated": 1, "total_billed": total, "version": 1},
                    "$set": schedule_update,
                    "$push": {"generation_history": gen_entry},
                },
            )

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
            error_text = str(e)
            results.append({"ri_id": ri["id"], "client": ri.get("client_name"), "status": "error", "error": error_text})
            try:
                await db.scheduler_logs.insert_one({
                    "id": f"slog-{uuid.uuid4().hex[:8]}",
                    "type": "recurring_invoice_error",
                    "recurring_invoice_id": ri.get("id"),
                    "client_name": ri.get("client_name", ""),
                    "status": "error",
                    "error": error_text[:1000],
                    "triggered_by": actor_name,
                    "timestamp": now.isoformat(),
                })
            except Exception:
                pass

    generated_count = sum(1 for result in results if result.get("status") == "generated")
    skipped_duplicates = sum(1 for result in results if result.get("status") == "skipped")
    return {
        "processed": len(results),
        "generated": generated_count,
        "skipped_duplicates": skipped_duplicates,
        "results": results,
    }


# ============== HELPERS ==============

def _add_months(anchor: datetime, months: int, billing_day: int) -> datetime:
    month_index = anchor.month - 1 + months
    year = anchor.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return anchor.replace(year=year, month=month, day=min(max(1, billing_day), last_day))


def _calc_next_date(from_date_str: str, frequency: str, anchor_day: int | None = None) -> str:
    """Advance one billing period without permanently drifting off the anchor day.

    A 31st-of-month schedule becomes the last day of a shorter month and then
    returns to the 31st, rather than drifting to the 28th forever.
    """
    try:
        d = datetime.strptime(from_date_str, "%Y-%m-%d")
    except Exception:
        d = datetime.now(timezone.utc)
    billing_day = anchor_day if isinstance(anchor_day, int) and 1 <= anchor_day <= 31 else d.day
    if frequency == "weekly":
        d += timedelta(days=7)
    elif frequency == "fortnightly":
        d += timedelta(days=14)
    elif frequency == "monthly":
        d = _add_months(d, 1, billing_day)
    elif frequency == "quarterly":
        d = _add_months(d, 3, billing_day)
    elif frequency == "annually":
        d = _add_months(d, 12, billing_day)
    else:
        d += timedelta(days=30)
    return d.strftime("%Y-%m-%d")


def _calc_due_date(payment_terms: str) -> str:
    now = datetime.now(timezone.utc)
    days_map = {"due_on_receipt": 0, "net_7": 7, "net_14": 14, "net_30": 30, "net_45": 45, "net_60": 60, "net_90": 90}
    days = days_map.get(payment_terms, 30)
    return (now + timedelta(days=days)).strftime("%Y-%m-%d")
