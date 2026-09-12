"""Products & Invoices PLUS â€” 9 differentiator features.

1. Smart Product Catalog insights          GET  /api/products/margin-insights
                                           GET  /api/products/{id}/price-history
                                           POST /api/products/{id}/price-change
2. Product Kits / Bundles                  GET  /api/product-kits
                                           POST /api/product-kits
                                           PUT  /api/product-kits/{id}
                                           DELETE /api/product-kits/{id}
                                           POST /api/tickets/{tid}/apply-kit/{kit_id}
3. Per-Client Price Book                   GET  /api/clients/{id}/price-book
                                           POST /api/clients/{id}/price-book
                                           DELETE /api/clients/{id}/price-book/{product_id}
                                           GET  /api/clients/{id}/price-for/{product_id}
4. Subscription Drift Detector             GET  /api/subscription-drift
5. Cash Flow Forecast                      GET  /api/finance/cash-flow-forecast
6. Late-payment Predictor                  GET  /api/invoices/late-payment-risk
                                           GET  /api/invoices/{id}/late-risk
7. Margin per Invoice                      GET  /api/invoices/{id}/margin
                                           GET  /api/finance/margin-overview
8. Predictive Auto-Quote trigger           POST /api/tickets/{id}/quote-nudge
9. Pre-Emptive DisputeShield scan          POST /api/invoices/{id}/dispute-scan
"""
from fastapi import APIRouter, Depends, HTTPException, Body, Request
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Optional
import os, uuid

from app.database import db
from app.auth import get_current_user
from app.services.action_permissions import evaluate_action_permission, require_action
from app.services.activity import log_activity
from app.services.scope_permissions import assert_client_scope, assert_global_scope

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s: return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


_CATALOGUE_PRICING_ACTION = "billing.catalogue.pricing.manage"
_MAX_MONEY = Decimal("1000000000")
_MAX_QUANTITY = Decimal("100000")
_MAX_LABOUR_HOURS = Decimal("10000")


def _required_identifier(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise HTTPException(422, f"{field} must be a non-empty identifier")
    identifier = value.strip()
    if not identifier or len(identifier) > 200:
        raise HTTPException(422, f"{field} must be a non-empty identifier")
    return identifier


def _bounded_decimal(value: Any, field: str, *, maximum: Decimal, places: int = 2) -> float:
    """Parse only finite, non-negative financial or quantity values.

    ``float`` accepts NaN and infinity, which would otherwise become persistent
    catalogue values and poison invoice/ticket calculations.  Decimal parsing
    also gives every browser and API client the same minor-unit rounding.
    """
    try:
        amount = Decimal(str(value).strip())
    except (AttributeError, InvalidOperation, TypeError, ValueError):
        raise HTTPException(422, f"{field} must be a finite non-negative number") from None
    if not amount.is_finite() or amount < 0 or amount > maximum:
        raise HTTPException(422, f"{field} must be a finite non-negative number")
    try:
        return float(amount.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        raise HTTPException(422, f"{field} must be a finite non-negative number") from None


def _bounded_money(value: Any, field: str) -> float:
    return _bounded_decimal(value, field, maximum=_MAX_MONEY)


def _bounded_hours(value: Any, field: str) -> float:
    return _bounded_decimal(value, field, maximum=_MAX_LABOUR_HOURS)


def _bounded_quantity(value: Any, field: str) -> int:
    try:
        quantity = Decimal(str(value).strip())
    except (AttributeError, InvalidOperation, TypeError, ValueError):
        raise HTTPException(422, f"{field} must be a finite non-negative whole number") from None
    if (
        not quantity.is_finite()
        or quantity < 0
        or quantity > _MAX_QUANTITY
        or quantity != quantity.to_integral_value()
    ):
        raise HTTPException(422, f"{field} must be a finite non-negative whole number")
    return int(quantity)


def _bounded_text(value: Any, field: str, *, maximum: int, allow_empty: bool = True) -> str:
    if not isinstance(value, str):
        raise HTTPException(422, f"{field} must be text")
    text = value.strip()
    if (not allow_empty and not text) or len(text) > maximum:
        raise HTTPException(422, f"{field} must be {'non-empty ' if not allow_empty else ''}text up to {maximum} characters")
    return text


def _normalise_kit_items(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 200:
        raise HTTPException(422, "items must be an array containing at most 200 products")
    items: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise HTTPException(422, f"items[{index}] must be an object")
        product_id = _required_identifier(item.get("product_id"), f"items[{index}].product_id")
        quantity = _bounded_quantity(item["quantity"] if "quantity" in item else 1, f"items[{index}].quantity")
        items.append({"product_id": product_id, "quantity": quantity})
    return items


async def _require_catalogue_pricing_permission(current_user: dict) -> None:
    """Protect direct service calls as well as the FastAPI dependency path."""
    result = await evaluate_action_permission(current_user, _CATALOGUE_PRICING_ACTION)
    if result["allowed"]:
        return
    await db.permission_denials.insert_one(
        {
            "permission": _CATALOGUE_PRICING_ACTION,
            "user_id": current_user.get("id"),
            "user_name": current_user.get("name"),
            "role": current_user.get("role"),
            "source": result.get("source"),
            "operation": "billing.catalogue.pricing",
            "occurred_at": _now_iso(),
        }
    )
    raise HTTPException(
        status_code=403,
        detail=f"Action permission required: {_CATALOGUE_PRICING_ACTION}",
        headers={"X-Required-Permission": _CATALOGUE_PRICING_ACTION},
    )


async def _load_scoped_client(
    client_id: str,
    current_user: dict,
    *,
    operation: str,
    site_id: str | None = None,
    request: Request | None = None,
) -> dict:
    """Resolve the Nexus client record before using a client-bound URL ID."""
    canonical_id = _required_identifier(client_id, "client_id")
    client = await db.clients.find_one({"id": canonical_id}, {"_id": 0})
    if not client:
        raise HTTPException(404, "client not found")
    await assert_client_scope(
        current_user,
        client.get("id"),
        site_id=site_id,
        operation=operation,
        request=request,
        mask_not_found=True,
    )
    return client


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 1) SMART PRODUCT CATALOG â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/finance/product-margin-insights")
async def product_margin_insights(current_user: dict = Depends(get_current_user)):
    """Returns every product with computed margin%, flags low-margin + recent cost changes."""
    rows = await db.products.find({}, {"_id": 0}).limit(1000).to_list(1000)
    out = []
    low_margin = 0
    cost_erosion = 0
    for p in rows:
        cost = float(p.get("cost_price") or 0)
        retail = float(p.get("retail_price") or 0)
        margin_pct = ((retail - cost) / retail * 100) if retail > 0 else 0
        # Recent cost change heuristic: compare to last price_history entry
        history = p.get("price_history") or []
        prev_cost = None
        if history:
            # Find the most recent record with cost_price different from current
            for h in reversed(history):
                if "cost_price" in h and float(h["cost_price"]) != cost:
                    prev_cost = float(h["cost_price"])
                    break
        cost_change_pct = ((cost - prev_cost) / prev_cost * 100) if prev_cost and prev_cost > 0 else None
        status = "ok"
        if margin_pct < 10: status = "low_margin"; low_margin += 1
        elif cost_change_pct and cost_change_pct > 5: status = "cost_up"; cost_erosion += 1
        out.append({
            "id": p["id"],
            "name": p.get("name"),
            "sku": p.get("sku"),
            "vendor": p.get("vendor"),
            "cost_price": cost,
            "retail_price": retail,
            "margin_dollars": round(retail - cost, 2),
            "margin_pct": round(margin_pct, 1),
            "cost_change_pct": round(cost_change_pct, 1) if cost_change_pct is not None else None,
            "status": status,
        })
    out.sort(key=lambda x: x["margin_pct"])
    return {
        "products": out,
        "summary": {
            "count": len(out),
            "low_margin_count": low_margin,
            "cost_erosion_count": cost_erosion,
            "avg_margin_pct": round(sum(p["margin_pct"] for p in out) / len(out), 1) if out else 0,
        },
    }


@router.get("/finance/product/{product_id}/price-history")
async def product_price_history(product_id: str, current_user: dict = Depends(get_current_user)):
    p = await db.products.find_one({"id": product_id}, {"_id": 0, "price_history": 1, "name": 1})
    if not p: raise HTTPException(404, "product not found")
    return {"product_id": product_id, "name": p.get("name"), "history": p.get("price_history") or []}


@router.post(
    "/finance/product/{product_id}/price-change",
    dependencies=[Depends(require_action(_CATALOGUE_PRICING_ACTION))],
)
async def record_price_change(product_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """Record a cost or retail price change with timestamp."""
    await _require_catalogue_pricing_permission(current_user)
    await assert_global_scope(current_user, operation="billing.catalogue.price.change")
    p = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not p: raise HTTPException(404, "product not found")
    cost_price = _bounded_money(
        payload["cost_price"] if "cost_price" in payload else p.get("cost_price", 0),
        "cost_price",
    )
    retail_price = _bounded_money(
        payload["retail_price"] if "retail_price" in payload else p.get("retail_price", 0),
        "retail_price",
    )
    reason = "" if payload.get("reason") is None else _bounded_text(payload.get("reason"), "reason", maximum=200)
    entry = {
        "ts": _now_iso(),
        "changed_by": current_user.get("email"),
        "cost_price": cost_price,
        "retail_price": retail_price,
        "reason": reason,
    }
    await db.products.update_one(
        {"id": product_id},
        {"$push": {"price_history": entry},
         "$set": {"cost_price": entry["cost_price"], "retail_price": entry["retail_price"], "updated_at": _now_iso()}},
    )
    await log_activity(
        current_user,
        "catalogue_price_changed",
        "product",
        product_id,
        p.get("name") or product_id,
        "Changed global catalogue pricing",
        changes={
            "cost_price": {"from": p.get("cost_price"), "to": cost_price},
            "retail_price": {"from": p.get("retail_price"), "to": retail_price},
        },
        metadata={"scope": "global", "reason": reason},
    )
    return {"ok": True, "entry": entry}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 2) PRODUCT KITS / BUNDLES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/product-kits")
async def list_kits(current_user: dict = Depends(get_current_user)):
    kits = await db.product_kits.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    # Hydrate totals
    for k in kits:
        total_cost = 0.0
        total_retail = 0.0
        for item in k.get("items") or []:
            p = await db.products.find_one({"id": item.get("product_id")}, {"_id": 0, "cost_price": 1, "retail_price": 1})
            if p:
                total_cost += float(p.get("cost_price") or 0) * int(item.get("quantity") or 1)
                total_retail += float(p.get("retail_price") or 0) * int(item.get("quantity") or 1)
        # Labor component
        labor_rate = float(k.get("labor_rate") or 150)
        labor_hrs = float(k.get("labor_hours") or 0)
        total_retail += labor_hrs * labor_rate
        k["total_cost"] = round(total_cost, 2)
        k["total_retail"] = round(total_retail, 2)
        k["margin_pct"] = round((total_retail - total_cost) / total_retail * 100, 1) if total_retail else 0
    return {"kits": kits, "count": len(kits)}


@router.post(
    "/product-kits",
    dependencies=[Depends(require_action(_CATALOGUE_PRICING_ACTION))],
)
async def create_kit(payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    await _require_catalogue_pricing_permission(current_user)
    await assert_global_scope(current_user, operation="billing.catalogue.kit.create")
    name = _bounded_text(payload.get("name"), "name", maximum=160, allow_empty=False)
    description = "" if payload.get("description") is None else _bounded_text(payload.get("description"), "description", maximum=500)
    category = "general" if payload.get("category") is None else _bounded_text(payload.get("category"), "category", maximum=80, allow_empty=False)
    items = _normalise_kit_items(payload.get("items"))
    labor_hours = _bounded_hours(payload["labor_hours"], "labor_hours") if "labor_hours" in payload else 0.0
    labor_rate = _bounded_money(payload["labor_rate"], "labor_rate") if "labor_rate" in payload else 150.0
    doc = {
        "id": uuid.uuid4().hex,
        "name": name,
        "description": description,
        "items": items,
        "labor_hours": labor_hours,
        "labor_rate": labor_rate,
        "category": category,
        "created_at": _now_iso(),
        "created_by": current_user.get("email"),
        "version": 1,
    }
    await db.product_kits.insert_one(dict(doc))
    await log_activity(
        current_user,
        "catalogue_kit_created",
        "product_kit",
        doc["id"],
        doc["name"],
        "Created global product kit",
        metadata={"scope": "global", "item_count": len(items)},
    )
    doc.pop("_id", None)
    return doc


@router.put(
    "/product-kits/{kit_id}",
    dependencies=[Depends(require_action(_CATALOGUE_PRICING_ACTION))],
)
async def update_kit(kit_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    await _require_catalogue_pricing_permission(current_user)
    await assert_global_scope(current_user, operation="billing.catalogue.kit.update")
    kit = await db.product_kits.find_one({"id": kit_id}, {"_id": 0})
    if not kit: raise HTTPException(404, "kit not found")
    patch: dict[str, Any] = {}
    if "name" in payload:
        patch["name"] = _bounded_text(payload["name"], "name", maximum=160, allow_empty=False)
    if "description" in payload:
        patch["description"] = _bounded_text(payload["description"], "description", maximum=500)
    if "items" in payload:
        patch["items"] = _normalise_kit_items(payload["items"])
    if "labor_hours" in payload:
        patch["labor_hours"] = _bounded_hours(payload["labor_hours"], "labor_hours")
    if "labor_rate" in payload:
        patch["labor_rate"] = _bounded_money(payload["labor_rate"], "labor_rate")
    if "category" in payload:
        patch["category"] = _bounded_text(payload["category"], "category", maximum=80, allow_empty=False)
    if not patch:
        raise HTTPException(422, "At least one editable kit field is required")
    patch["updated_at"] = _now_iso()
    res = await db.product_kits.update_one({"id": kit_id}, {"$set": patch})
    if res.matched_count == 0: raise HTTPException(404, "kit not found")
    await log_activity(
        current_user,
        "catalogue_kit_updated",
        "product_kit",
        kit_id,
        kit.get("name") or kit_id,
        "Updated global product kit",
        changes={field: {"from": kit.get(field), "to": value} for field, value in patch.items() if field != "updated_at"},
        metadata={"scope": "global"},
    )
    return {"ok": True}


@router.delete(
    "/product-kits/{kit_id}",
    dependencies=[Depends(require_action(_CATALOGUE_PRICING_ACTION))],
)
async def delete_kit(kit_id: str, current_user: dict = Depends(get_current_user)):
    await _require_catalogue_pricing_permission(current_user)
    await assert_global_scope(current_user, operation="billing.catalogue.kit.delete")
    kit = await db.product_kits.find_one({"id": kit_id}, {"_id": 0})
    if not kit: raise HTTPException(404, "kit not found")
    res = await db.product_kits.delete_one({"id": kit_id})
    if res.deleted_count == 0: raise HTTPException(404, "kit not found")
    await log_activity(
        current_user,
        "catalogue_kit_deleted",
        "product_kit",
        kit_id,
        kit.get("name") or kit_id,
        "Deleted global product kit",
        metadata={"scope": "global", "item_count": len(kit.get("items") or [])},
    )
    return {"deleted": True}


@router.post(
    "/tickets/{ticket_id}/apply-kit/{kit_id}",
    dependencies=[Depends(require_action(_CATALOGUE_PRICING_ACTION))],
)
async def apply_kit_to_ticket(ticket_id: str, kit_id: str, current_user: dict = Depends(get_current_user)):
    await _require_catalogue_pricing_permission(current_user)
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t: raise HTTPException(404, "ticket not found")
    client = await _load_scoped_client(
        t.get("client_id"),
        current_user,
        operation="billing.catalogue.kit.apply",
        site_id=t.get("site_id"),
    )
    canonical_client_id = str(client.get("id"))
    kit = await db.product_kits.find_one({"id": kit_id}, {"_id": 0})
    if not kit: raise HTTPException(404, "kit not found")
    try:
        kit_items = _normalise_kit_items(kit.get("items"))
    except HTTPException:
        raise HTTPException(409, "Kit contains invalid product or quantity data and cannot be applied") from None

    # Validate every billable item before inserting any ticket product, so a
    # retired catalogue item cannot leave the ticket half-updated.
    resolved_items: list[tuple[dict[str, Any], dict[str, Any], float, float]] = []
    for item in kit_items:
        quantity = item["quantity"]
        if quantity == 0:
            continue
        product = await db.products.find_one(
            {"id": item["product_id"]},
            {"_id": 0, "name": 1, "sku": 1, "retail_price": 1, "cost_price": 1},
        )
        if not product:
            raise HTTPException(409, "Kit references an unavailable catalogue product")
        try:
            retail_price = _bounded_money(product.get("retail_price", 0), "catalogue retail_price")
            cost_price = _bounded_money(product.get("cost_price", 0), "catalogue cost_price")
        except HTTPException:
            raise HTTPException(409, "Kit references a product with invalid catalogue pricing") from None
        resolved_items.append((item, product, retail_price, cost_price))

    # Attach each validated product as a client-bound ticket product.
    attached = []
    for item, product, retail_price, cost_price in resolved_items:
        qty = item["quantity"]
        doc = {
            "id": uuid.uuid4().hex,
            "ticket_id": ticket_id,
            "client_id": canonical_client_id,
            "site_id": t.get("site_id"),
            "product_id": item["product_id"],
            "name": product.get("name"),
            "sku": product.get("sku"),
            "quantity": qty,
            "unit_price": retail_price,
            "cost_price": cost_price,
            "total": round(qty * retail_price, 2),
            "source": f"kit:{kit_id}",
            "added_at": _now_iso(),
            "added_by": current_user.get("id"),
        }
        await db.ticket_products.insert_one(dict(doc))
        attached.append({"name": product.get("name"), "quantity": qty, "total": doc["total"]})
    await log_activity(
        current_user,
        "ticket_product_kit_applied",
        "ticket",
        ticket_id,
        t.get("subject") or ticket_id,
        "Applied product kit to ticket",
        metadata={
            "client_id": canonical_client_id,
            "site_id": t.get("site_id"),
            "kit_id": kit_id,
            "kit_name": kit.get("name"),
            "attached_count": len(attached),
        },
    )
    return {"ok": True, "attached_count": len(attached), "attached": attached, "kit_name": kit.get("name")}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 3) PER-CLIENT PRICE BOOK â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/clients/{client_id}/price-book")
async def get_price_book(client_id: str, current_user: dict = Depends(get_current_user)):
    client = await _load_scoped_client(client_id, current_user, operation="billing.client_price_book.view")
    canonical_client_id = str(client.get("id"))
    rows = await db.client_price_overrides.find({"client_id": canonical_client_id}, {"_id": 0}).to_list(500)
    # Hydrate product names
    for r in rows:
        p = await db.products.find_one({"id": r.get("product_id")}, {"_id": 0, "name": 1, "sku": 1, "retail_price": 1})
        if p:
            r["product_name"] = p.get("name")
            r["product_sku"] = p.get("sku")
            r["standard_price"] = p.get("retail_price")
            r["delta_pct"] = round((r.get("override_price", 0) - p.get("retail_price", 0)) / max(p.get("retail_price", 1), 1) * 100, 1)
    return {"overrides": rows, "count": len(rows)}


@router.post(
    "/clients/{client_id}/price-book",
    dependencies=[Depends(require_action(_CATALOGUE_PRICING_ACTION))],
)
async def upsert_price_book(client_id: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    await _require_catalogue_pricing_permission(current_user)
    client = await _load_scoped_client(client_id, current_user, operation="billing.client_price_book.upsert")
    canonical_client_id = str(client.get("id"))
    pid = _required_identifier(payload.get("product_id"), "product_id")
    if "override_price" not in payload:
        raise HTTPException(422, "override_price is required")
    override_price = _bounded_money(payload["override_price"], "override_price")
    reason = "" if payload.get("reason") is None else _bounded_text(payload.get("reason"), "reason", maximum=200)
    product = await db.products.find_one({"id": pid}, {"_id": 0, "name": 1})
    if not product:
        raise HTTPException(404, "product not found")
    existing = await db.client_price_overrides.find_one(
        {"client_id": canonical_client_id, "product_id": pid}, {"_id": 0}
    )
    doc = {
        "client_id": canonical_client_id,
        "product_id": pid,
        "override_price": override_price,
        "reason": reason,
        "updated_at": _now_iso(),
        "updated_by": current_user.get("email"),
    }
    await db.client_price_overrides.update_one(
        {"client_id": canonical_client_id, "product_id": pid},
        {"$set": doc},
        upsert=True,
    )
    await log_activity(
        current_user,
        "client_price_book_updated",
        "client_price_override",
        f"{canonical_client_id}:{pid}",
        product.get("name") or pid,
        "Updated client-specific catalogue price",
        changes={"override_price": {"from": existing.get("override_price") if existing else None, "to": override_price}},
        metadata={"client_id": canonical_client_id, "product_id": pid, "reason": reason},
    )
    return {"ok": True}


@router.delete(
    "/clients/{client_id}/price-book/{product_id}",
    dependencies=[Depends(require_action(_CATALOGUE_PRICING_ACTION))],
)
async def delete_price_override(client_id: str, product_id: str, current_user: dict = Depends(get_current_user)):
    await _require_catalogue_pricing_permission(current_user)
    client = await _load_scoped_client(client_id, current_user, operation="billing.client_price_book.delete")
    canonical_client_id = str(client.get("id"))
    canonical_product_id = _required_identifier(product_id, "product_id")
    override = await db.client_price_overrides.find_one(
        {"client_id": canonical_client_id, "product_id": canonical_product_id}, {"_id": 0}
    )
    if not override:
        raise HTTPException(404, "override not found")
    res = await db.client_price_overrides.delete_one(
        {"client_id": canonical_client_id, "product_id": canonical_product_id}
    )
    if res.deleted_count == 0: raise HTTPException(404, "override not found")
    await log_activity(
        current_user,
        "client_price_book_deleted",
        "client_price_override",
        f"{canonical_client_id}:{canonical_product_id}",
        canonical_product_id,
        "Deleted client-specific catalogue price",
        changes={"override_price": {"from": override.get("override_price"), "to": None}},
        metadata={"client_id": canonical_client_id, "product_id": canonical_product_id},
    )
    return {"deleted": True}


@router.get("/clients/{client_id}/price-for/{product_id}")
async def client_price_for_product(client_id: str, product_id: str, current_user: dict = Depends(get_current_user)):
    client = await _load_scoped_client(client_id, current_user, operation="billing.client_price_book.view")
    canonical_client_id = str(client.get("id"))
    canonical_product_id = _required_identifier(product_id, "product_id")
    p = await db.products.find_one({"id": canonical_product_id}, {"_id": 0, "retail_price": 1, "name": 1})
    if not p: raise HTTPException(404, "product not found")
    override = await db.client_price_overrides.find_one(
        {"client_id": canonical_client_id, "product_id": canonical_product_id}, {"_id": 0}
    )
    if override:
        return {"price": override["override_price"], "source": "client_override", "reason": override.get("reason"), "standard": p.get("retail_price")}
    return {"price": p.get("retail_price"), "source": "standard", "standard": p.get("retail_price")}


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 4) SUBSCRIPTION DRIFT DETECTOR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/subscription-drift")
async def subscription_drift(current_user: dict = Depends(get_current_user)):
    """Find clients paying for more seats than they use (Pax8 / M365)."""
    findings = []
    # Try Pax8 subscriptions vs CIPP users
    subs = await db.pax8_subscriptions.find({}, {"_id": 0}).limit(500).to_list(500)
    for s in subs:
        seats = int(s.get("quantity") or 0)
        if seats <= 0: continue
        pax8_company = s.get("company_id")
        # Look up linked client
        link = await db.pax8_customer_links.find_one({"pax8_company_id": pax8_company}, {"_id": 0, "client_id": 1}) or {}
        client_id = link.get("client_id")
        if not client_id: continue
        # Look up CIPP users for that client
        cipp_link = await db.cipp_tenant_links.find_one({"client_id": client_id}, {"_id": 0, "tenant_id": 1}) or {}
        cached = await db.cipp_users_cache.find_one({"tenant_id": cipp_link.get("tenant_id")}, {"_id": 0}) if cipp_link.get("tenant_id") else None
        active_users = 0
        if cached:
            active_users = sum(1 for u in (cached.get("users") or []) if u.get("account_enabled") is not False)
        if active_users and seats > active_users:
            unused = seats - active_users
            monthly = float(s.get("unit_price", 0)) * unused
            client = await db.clients.find_one({"id": client_id}, {"_id": 0, "name": 1}) or {}
            findings.append({
                "client_id": client_id,
                "client_name": client.get("name"),
                "product_name": s.get("product_name") or s.get("sku"),
                "seats_paid": seats,
                "seats_used": active_users,
                "unused_seats": unused,
                "wasted_monthly_aud": round(monthly, 2),
                "recommendation": "Right-size or upsell" if unused >= 3 else "Monitor",
            })
    findings.sort(key=lambda x: -x["wasted_monthly_aud"])
    total_waste = sum(f["wasted_monthly_aud"] for f in findings)
    return {
        "findings": findings,
        "count": len(findings),
        "total_monthly_waste_aud": round(total_waste, 2),
        "annual_waste_aud": round(total_waste * 12, 2),
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 5) CASH FLOW FORECAST â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/finance/cash-flow-forecast")
async def cash_flow_forecast(current_user: dict = Depends(get_current_user)):
    """Project 30/60/90-day inflow from open invoices + recurring + promises."""
    now = datetime.now(timezone.utc)
    buckets = {"30": 0.0, "60": 0.0, "90": 0.0}
    risk_buckets = {"30": 0.0, "60": 0.0, "90": 0.0}

    open_inv = await db.invoices.find(
        {"payment_status": {"$nin": ["paid", "void"]}},
        {"_id": 0, "total": 1, "amount_paid": 1, "due_date": 1, "client_id": 1}
    ).to_list(500)

    for inv in open_inv:
        due = _parse_iso(inv.get("due_date"))
        if not due: continue
        # Normalize to timezone-aware
        if due.tzinfo is None: due = due.replace(tzinfo=timezone.utc)
        balance = float(inv.get("total", 0)) - float(inv.get("amount_paid", 0))
        if balance <= 0: continue
        days = (due - now).days
        churn = await db.churn_risk.find_one({"client_id": inv.get("client_id")}, {"_id": 0, "score": 1}) or {}
        risk_pct = min(float(churn.get("score", 20)) / 100, 0.7)
        risk_adjusted = balance * (1 - risk_pct)
        if days <= 30:
            buckets["30"] += balance
            risk_buckets["30"] += risk_adjusted
        elif days <= 60:
            buckets["60"] += balance
            risk_buckets["60"] += risk_adjusted
        elif days <= 90:
            buckets["90"] += balance
            risk_buckets["90"] += risk_adjusted

    # Recurring invoices projected
    recurring = await db.recurring_invoices.find({"status": "active"}, {"_id": 0, "amount": 1, "next_generation": 1, "frequency": 1}).to_list(500)
    for ri in recurring:
        amt = float(ri.get("amount", 0))
        try:
            ng = datetime.strptime(ri.get("next_generation", ""), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except Exception:
            continue
        # count generations per bucket
        freq_days = {"monthly": 30, "quarterly": 90, "yearly": 365, "weekly": 7}.get(ri.get("frequency", "monthly"), 30)
        for bucket_days in [30, 60, 90]:
            # count how many generations fall in window
            gens = 0
            cursor = ng
            while (cursor - now).days <= bucket_days:
                if (cursor - now).days >= 0:
                    gens += 1
                cursor = cursor + timedelta(days=freq_days)
                if gens > 12: break
            buckets[str(bucket_days)] += amt * (1 if gens else 0)
            risk_buckets[str(bucket_days)] += amt * 0.9 * (1 if gens else 0)

    return {
        "projected": {
            "30d": round(buckets["30"], 2),
            "60d": round(buckets["60"], 2),
            "90d": round(buckets["90"], 2),
        },
        "risk_adjusted": {
            "30d": round(risk_buckets["30"], 2),
            "60d": round(risk_buckets["60"], 2),
            "90d": round(risk_buckets["90"], 2),
        },
        "total_open_invoice_balance": round(sum(
            float(i.get("total", 0)) - float(i.get("amount_paid", 0))
            for i in open_inv
            if (float(i.get("total", 0)) - float(i.get("amount_paid", 0))) > 0
        ), 2),
        "generated_at": _now_iso(),
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 6) LATE-PAYMENT PREDICTOR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async def _score_late_risk(invoice: dict) -> dict:
    """Heuristic 0-100 score â€” probability that invoice is paid late."""
    client_id = invoice.get("client_id")
    score = 30  # baseline
    reasons = []

    # Client history: count of past paid-late invoices
    past = await db.invoices.find(
        {"client_id": client_id, "payment_status": "paid"},
        {"_id": 0, "due_date": 1, "paid_date": 1}
    ).limit(50).to_list(50)
    late_count = 0; on_time = 0
    for p in past:
        due = _parse_iso(p.get("due_date")); paid = _parse_iso(p.get("paid_date"))
        if due and paid:
            if paid > due + timedelta(days=3): late_count += 1
            else: on_time += 1
    if past:
        late_pct = late_count / len(past)
        score += int(late_pct * 50)
        if late_count > 0: reasons.append(f"{late_count} of {len(past)} past invoices paid late")

    # Current overdue balance for the client
    overdue = await db.invoices.find(
        {"client_id": client_id, "payment_status": {"$nin": ["paid", "void"]}},
        {"_id": 0, "total": 1, "amount_paid": 1, "due_date": 1}
    ).to_list(50)
    now = datetime.now(timezone.utc)
    past_due_total = 0.0
    for o in overdue:
        due = _parse_iso(o.get("due_date"))
        if due and due < now:
            past_due_total += float(o.get("total", 0)) - float(o.get("amount_paid", 0))
    if past_due_total > 0:
        score += 15
        reasons.append(f"${past_due_total:,.0f} already overdue")

    # Churn risk contribution
    churn = await db.churn_risk.find_one({"client_id": client_id}, {"_id": 0, "score": 1}) or {}
    if churn.get("score", 0) > 60:
        score += 10
        reasons.append(f"Churn risk {churn['score']}/100")

    # Broken payment promises
    broken = await db.payment_promises.count_documents({"invoice_id": invoice.get("id"), "status": "broken"})
    if broken > 0:
        score += 15
        reasons.append(f"{broken} broken payment promise(s)")

    score = max(0, min(100, score))
    band = "low" if score < 40 else "medium" if score < 70 else "high"
    return {"score": score, "band": band, "reasons": reasons, "on_time_history": on_time, "late_history": late_count}


@router.get("/finance/invoices/late-payment-risk")
async def invoices_late_risk_overview(current_user: dict = Depends(get_current_user)):
    open_inv = await db.invoices.find(
        {"payment_status": {"$nin": ["paid", "void"]}},
        {"_id": 0, "id": 1, "invoice_number": 1, "client_id": 1, "client_name": 1, "total": 1, "due_date": 1, "amount_paid": 1}
    ).limit(200).to_list(200)
    scored = []
    for i in open_inv:
        r = await _score_late_risk(i)
        scored.append({**i, **r})
    scored.sort(key=lambda x: -x["score"])
    summary = {
        "high_risk": sum(1 for x in scored if x["band"] == "high"),
        "medium_risk": sum(1 for x in scored if x["band"] == "medium"),
        "low_risk": sum(1 for x in scored if x["band"] == "low"),
        "total": len(scored),
    }
    return {"invoices": scored[:50], "summary": summary}


@router.get("/invoices/{invoice_id}/late-risk")
async def single_late_risk(invoice_id: str, current_user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv: raise HTTPException(404, "invoice not found")
    return await _score_late_risk(inv)


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 7) MARGIN PER INVOICE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async def _invoice_margin(inv: dict) -> dict:
    line_items = inv.get("line_items") or []
    # Product costs
    total_cost = 0.0
    cost_breakdown = {"products": 0.0, "labor": 0.0, "other": 0.0}
    for li in line_items:
        qty = float(li.get("quantity") or 1)
        line_cost = float(li.get("cost_price") or 0) * qty
        if line_cost > 0:
            total_cost += line_cost
            cost_breakdown["products"] += line_cost
        elif li.get("type") == "labor" or "hour" in (li.get("description") or "").lower():
            # Labor cost estimate â€” 40% of revenue
            lc = float(li.get("total") or 0) * 0.4
            total_cost += lc
            cost_breakdown["labor"] += lc
        else:
            # Default: 30% assumed cost if not specified
            lc = float(li.get("total") or 0) * 0.3
            total_cost += lc
            cost_breakdown["other"] += lc

    revenue = float(inv.get("total", 0))
    profit = revenue - total_cost
    margin_pct = (profit / revenue * 100) if revenue > 0 else 0
    return {
        "revenue": round(revenue, 2),
        "cost": round(total_cost, 2),
        "cost_breakdown": {k: round(v, 2) for k, v in cost_breakdown.items()},
        "profit": round(profit, 2),
        "margin_pct": round(margin_pct, 1),
    }


@router.get("/invoices/{invoice_id}/margin")
async def invoice_margin(invoice_id: str, current_user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv: raise HTTPException(404, "invoice not found")
    return await _invoice_margin(inv)


@router.get("/finance/margin-overview")
async def margin_overview(days: int = 90, current_user: dict = Depends(get_current_user)):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    invs = await db.invoices.find(
        {"issue_date": {"$gte": cutoff}, "status": {"$ne": "void"}},
        {"_id": 0}
    ).limit(1000).to_list(1000)
    total_rev = total_cost = 0.0
    per_client: dict = {}
    for inv in invs:
        m = await _invoice_margin(inv)
        total_rev += m["revenue"]; total_cost += m["cost"]
        cid = inv.get("client_id") or "unknown"
        cb = per_client.setdefault(cid, {"client_id": cid, "client_name": inv.get("client_name"), "revenue": 0, "cost": 0})
        cb["revenue"] += m["revenue"]; cb["cost"] += m["cost"]
    client_list = []
    for cb in per_client.values():
        cb["profit"] = round(cb["revenue"] - cb["cost"], 2)
        cb["margin_pct"] = round(cb["profit"] / cb["revenue"] * 100, 1) if cb["revenue"] > 0 else 0
        cb["revenue"] = round(cb["revenue"], 2); cb["cost"] = round(cb["cost"], 2)
        client_list.append(cb)
    client_list.sort(key=lambda x: -x["revenue"])
    return {
        "window_days": days,
        "total_revenue": round(total_rev, 2),
        "total_cost": round(total_cost, 2),
        "total_profit": round(total_rev - total_cost, 2),
        "margin_pct": round((total_rev - total_cost) / total_rev * 100, 1) if total_rev > 0 else 0,
        "clients": client_list[:50],
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 8) PREDICTIVE AUTO-QUOTE TRIGGER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/tickets/{ticket_id}/quote-nudge")
async def quote_nudge(ticket_id: str, current_user: dict = Depends(get_current_user)):
    """Assess if this ticket is quote-worthy. Based on conversation length + keyword matches + work already logged."""
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t: raise HTTPException(404, "ticket not found")
    # Signals
    comments = await db.ticket_comments.count_documents({"ticket_id": ticket_id})
    timelog = await db.time_entries.find({"ticket_id": ticket_id}, {"_id": 0, "duration_minutes": 1}).to_list(100)
    mins = sum(int(e.get("duration_minutes") or 0) for e in timelog)
    text = f"{t.get('title','')} {t.get('description','')}"
    keyword_hits = sum(1 for kw in ["install", "migrate", "deploy", "setup", "onboard", "upgrade", "refresh", "replace", "procure", "license", "project"] if kw in text.lower())

    # Score
    score = 0
    signals = []
    if comments >= 6: score += 30; signals.append(f"{comments} comments â€” scope expanding")
    elif comments >= 3: score += 15
    if mins >= 120: score += 30; signals.append(f"{mins}min logged already")
    elif mins >= 60: score += 15
    if keyword_hits >= 3: score += 30; signals.append(f"Keywords: project/deploy/migrate")
    elif keyword_hits >= 1: score += 10

    # Existing quote/estimate?
    existing = await db.estimates.find_one({"ticket_id": ticket_id}, {"_id": 0, "id": 1})
    if existing:
        signals.append("Estimate already exists")
        return {"should_quote": False, "score": score, "existing_estimate_id": existing["id"], "signals": signals}

    should_quote = score >= 50
    return {
        "should_quote": should_quote,
        "score": score,
        "signals": signals,
        "suggestion": (
            f"This ticket has {comments} comments, {mins}min logged and looks project-scoped. "
            f"Consider sending a quote before more time accrues."
        ) if should_quote else None,
    }


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• 9) PRE-EMPTIVE DISPUTESHIELD SCAN â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

def _safe_finance_number(value: Any, *, default: float = 0.0) -> float:
    """Return a bounded non-negative number for local heuristic analysis only."""
    try:
        return _bounded_money(value, "stored invoice value")
    except HTTPException:
        return default


def _dispute_amount_band(amount: float) -> str:
    if amount >= 5000:
        return "very_high"
    if amount >= 1500:
        return "high"
    if amount >= 500:
        return "medium"
    return "low"


def _dispute_quantity_band(quantity: float) -> str:
    if quantity >= 10:
        return "10_plus"
    if quantity >= 6:
        return "6_to_9"
    if quantity >= 2:
        return "2_to_5"
    return "one"


def _minimised_dispute_context(invoice: dict, *, resolved_ticket_count: int) -> str:
    """Build anonymous, structural context for the external AI provider.

    The model can identify billing-evidence patterns without customer names,
    invoice IDs/numbers, full line descriptions, exact monetary values, or
    ticket titles.  Nexus retains the detailed local heuristic result.
    """
    lines: list[str] = []
    for index, raw_line in enumerate((invoice.get("line_items") or [])[:50], start=1):
        line = raw_line if isinstance(raw_line, dict) else {}
        description = str(line.get("description") or "").strip().lower()
        quantity = _safe_finance_number(line.get("quantity", 1), default=1.0)
        unit_price = _safe_finance_number(line.get("unit_price"), default=0.0)
        total = _safe_finance_number(line.get("total"), default=round(quantity * unit_price, 2))
        description_quality = "missing" if not description else "brief" if len(description) < 30 else "detailed"
        lines.append(
            "line_{index}: description={description_quality}; value_band={value_band}; "
            "quantity_band={quantity_band}; emergency={emergency}; after_hours={after_hours}".format(
                index=index,
                description_quality=description_quality,
                value_band=_dispute_amount_band(total),
                quantity_band=_dispute_quantity_band(quantity),
                emergency="yes" if "emergency" in description else "no",
                after_hours="yes" if "after hours" in description else "no",
            )
        )
    invoice_total = _safe_finance_number(invoice.get("total"), default=0.0)
    return "\n".join(
        [
            "Anonymous invoice dispute-evidence analysis.",
            f"invoice_total_band={_dispute_amount_band(invoice_total)}",
            f"line_count={len(lines)}",
            f"recent_resolved_ticket_count={max(0, min(int(resolved_ticket_count), 1000))}",
            "lines:",
            *(lines or ["none"]),
        ]
    )


async def _audit_dispute_scan(
    *,
    current_user: dict,
    invoice: dict,
    client_id: str,
    correlation_id: str | None,
    outcome: str,
    ai_used: bool,
    line_count: int,
    resolved_ticket_count: int,
) -> None:
    """Record analysis provenance without retaining an AI prompt or raw error."""
    await log_activity(
        current_user,
        "invoice_dispute_scan_completed",
        "invoice",
        str(invoice.get("id") or ""),
        str(invoice.get("invoice_number") or invoice.get("id") or "Invoice"),
        "Ran pre-emptive invoice dispute analysis",
        metadata={
            "client_id": client_id,
            "correlation_id": correlation_id,
            "outcome": outcome,
            "ai_used": ai_used,
            "line_count": line_count,
            "resolved_ticket_count": resolved_ticket_count,
        },
    )


@router.post(
    "/invoices/{invoice_id}/dispute-scan",
    dependencies=[Depends(require_action("billing.analytics.view"))],
)
async def dispute_scan(
    invoice_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Nexus AI scans invoice line items and client history for dispute risks and drafts justifications."""
    # The route dependency is the HTTP boundary; retain the check here for
    # direct/internal callers as well so the AI path cannot bypass it.
    await require_action("billing.analytics.view")(request=request, current_user=current_user)
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv: raise HTTPException(404, "invoice not found")
    invoice_client_id = inv.get("client_id")
    if not isinstance(invoice_client_id, str) or not invoice_client_id.strip():
        raise HTTPException(409, "Invoice does not have a client ownership binding")
    client = await _load_scoped_client(
        invoice_client_id,
        current_user,
        operation="billing.invoice.dispute_scan",
        request=request,
    )
    canonical_client_id = str(client.get("id"))
    correlation_id = getattr(getattr(request, "state", None), "correlation_id", None)

    api_key = os.environ.get("OPENAI_API_KEY")
    resolved_ticket_count = await db.tickets.count_documents(
        {"client_id": canonical_client_id, "status": {"$in": ["resolved", "closed"]}}
    )

    # Heuristic pre-scan
    flags = []
    for li in inv.get("line_items") or []:
        if not isinstance(li, dict):
            continue
        unit = _safe_finance_number(li.get("unit_price"), default=0.0)
        qty = _safe_finance_number(li.get("quantity", 1), default=1.0)
        total = _safe_finance_number(li.get("total"), default=round(unit * qty, 2))
        desc = str(li.get("description") or "").lower()
        if total >= 1500 and len(desc) < 30:
            flags.append({"line": li.get("description"), "risk": "Vague high-value line â€” add detail", "severity": "high"})
        if "emergency" in desc and "after hours" not in desc:
            flags.append({"line": li.get("description"), "risk": "Emergency rate without explicit after-hours note", "severity": "medium"})
        if qty > 5 and unit > 100:
            flags.append({"line": li.get("description"), "risk": f"{qty} Ã— ${unit} â€” ensure quantity is explained", "severity": "low"})

    line_count = len(inv.get("line_items") or [])
    if not api_key:
        await _audit_dispute_scan(
            current_user=current_user,
            invoice=inv,
            client_id=canonical_client_id,
            correlation_id=correlation_id,
            outcome="heuristic_only",
            ai_used=False,
            line_count=line_count,
            resolved_ticket_count=resolved_ticket_count,
        )
        return {"flags": flags, "justification": None, "model": "heuristic-only"}

    try:
        from app.services.ai_provider import LlmChat, UserMessage
        corpus = _minimised_dispute_context(inv, resolved_ticket_count=resolved_ticket_count)
        chat = LlmChat(
            api_key=api_key,
            session_id=f"dispute-{uuid.uuid4().hex[:8]}",
            system_message=(
                "You are an MSP invoice-defense assistant. You receive anonymised structural billing metadata only. "
                "Identify dispute-evidence patterns and draft neutral, generic justifications. Do not invent customer, "
                "invoice, ticket, device, or contract details. State uncertainty where the metadata is insufficient. "
                "Output JSON ONLY: {risks:[{line,reason,severity,justification}], summary:'...'}. "
                "Severity: high|medium|low. Keep justifications under 50 words each."
            ),
        ).with_model("openai", "gpt-5.6-terra")
        resp = await chat.send_message(UserMessage(text=corpus))
        import json as _json, re as _re
        m = _re.search(r"\{[\s\S]*\}", resp or "")
        parsed = _json.loads(m.group(0)) if m else None
        ai_risks = (parsed or {}).get("risks")
        ai_summary = (parsed or {}).get("summary")
        if not isinstance(ai_risks, list):
            ai_risks = []
        if not isinstance(ai_summary, str):
            ai_summary = None
        await _audit_dispute_scan(
            current_user=current_user,
            invoice=inv,
            client_id=canonical_client_id,
            correlation_id=correlation_id,
            outcome="ai_completed",
            ai_used=True,
            line_count=line_count,
            resolved_ticket_count=resolved_ticket_count,
        )
        return {
            "flags": flags,
            "ai_risks": ai_risks,
            "ai_summary": ai_summary,
            "model": "gpt-5.6-terra",
        }
    except Exception:
        # Do not return provider errors because they can include customer
        # context, identifiers, or an upstream request representation.
        await _audit_dispute_scan(
            current_user=current_user,
            invoice=inv,
            client_id=canonical_client_id,
            correlation_id=correlation_id,
            outcome="ai_unavailable",
            ai_used=False,
            line_count=line_count,
            resolved_ticket_count=resolved_ticket_count,
        )
        return {
            "flags": flags,
            "justification": None,
            "error": "AI analysis is temporarily unavailable; heuristic scan completed.",
        }
