from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/vendors")
async def get_vendors(current_user: dict = Depends(get_current_user)):
    return await db.vendors.find({}, {"_id": 0}).sort("name", 1).to_list(500)


@router.post("/vendors")
async def create_vendor(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    vendor = {
        "id": f"vendor-{uuid.uuid4().hex[:8]}",
        "name": data.get("name", ""),
        "contact_name": data.get("contact_name", ""),
        "email": data.get("email", ""),
        "phone": data.get("phone", ""),
        "website": data.get("website", ""),
        "address": data.get("address", ""),
        "account_number": data.get("account_number", ""),
        "payment_terms": data.get("payment_terms", "net_30"),
        "avg_lead_time_days": data.get("avg_lead_time_days", 5),
        "category": data.get("category", "general"),
        "notes": data.get("notes", ""),
        "is_preferred": data.get("is_preferred", False),
        "total_orders": 0,
        "total_spent": 0,
        "rating": data.get("rating", 0),
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    await db.vendors.insert_one(vendor)
    return {k: v for k, v in vendor.items() if k != "_id"}


# Literal /vendors/stats must be registered before /vendors/{vendor_id} or the
# parameterised route shadows it and the stats widget can never load.
@router.get("/vendors/stats")
async def get_vendor_stats(current_user: dict = Depends(get_current_user)):
    vendors = await db.vendors.find({}, {"_id": 0}).to_list(500)
    return {
        "total": len(vendors),
        "active": len([v for v in vendors if v.get("status") == "active"]),
        "preferred": len([v for v in vendors if v.get("is_preferred")]),
        "total_spent": round(sum(v.get("total_spent", 0) for v in vendors), 2),
    }


@router.get("/vendors/{vendor_id}")
async def get_vendor(vendor_id: str, current_user: dict = Depends(get_current_user)):
    """Return a supplier with its PO history and live purchasing totals."""
    vendor = await db.vendors.find_one({"id": vendor_id}, {"_id": 0})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    purchase_orders = await db.purchase_orders.find(
        {"vendor_id": vendor_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    vendor["purchase_orders"] = purchase_orders
    vendor["total_orders"] = len(purchase_orders)
    vendor["total_spent"] = round(sum(float(po.get("total", 0) or 0) for po in purchase_orders), 2)
    vendor["open_orders"] = sum(1 for po in purchase_orders if po.get("status") in {"draft", "pending_approval", "approved", "submitted", "partial"})
    return vendor


@router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    v = await db.vendors.find_one({"id": vendor_id})
    if not v:
        raise HTTPException(status_code=404, detail="Vendor not found")
    update = {k: v for k, v in data.items() if k not in ("id", "_id", "created_at")}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.vendors.update_one({"id": vendor_id}, {"$set": update})
    return {"message": "Vendor updated"}


@router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.vendors.delete_one({"id": vendor_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


# ============== WARRANTY TRACKING ==============

@router.get("/warranties/stats")
async def get_warranty_stats(current_user: dict = Depends(get_current_user)):
    all_w = await db.warranties.find({}, {"_id": 0}).to_list(500)
    now = datetime.now(timezone.utc)
    now_str = now.strftime("%Y-%m-%d")
    thirty_days = (now + timedelta(days=30)).strftime("%Y-%m-%d")
    ninety_days = (now + timedelta(days=90)).strftime("%Y-%m-%d")

    active = [w for w in all_w if w.get("expiry_date", "") >= now_str]
    expired = [w for w in all_w if w.get("expiry_date", "") < now_str]
    expiring_30 = [w for w in active if w.get("expiry_date", "") <= thirty_days]
    expiring_90 = [w for w in active if w.get("expiry_date", "") <= ninety_days]

    return {
        "total": len(all_w), "active": len(active), "expired": len(expired),
        "expiring_30_days": len(expiring_30), "expiring_90_days": len(expiring_90),
        "total_coverage_value": round(sum(w.get("coverage_value", 0) for w in active), 2),
    }


# ============== PRODUCT MARGIN & LOW STOCK ==============

@router.get("/products/analytics/margins")
async def get_product_margins(current_user: dict = Depends(get_current_user)):
    products = await db.products.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(5000)
    results = []
    for p in products:
        cost = float(p.get("cost_price", 0))
        sell = float(p.get("sell_price", 0))
        margin = round(sell - cost, 2)
        margin_pct = round((margin / sell * 100) if sell > 0 else 0, 1)
        stock = int(p.get("quantity_in_stock", 0))
        results.append({
            "id": p["id"], "name": p.get("name", ""), "sku": p.get("sku", ""),
            "category": p.get("category", ""),
            "cost_price": cost, "sell_price": sell, "margin": margin, "margin_pct": margin_pct,
            "stock": stock, "stock_value": round(cost * stock, 2),
        })
    results.sort(key=lambda x: x["margin_pct"], reverse=True)
    total_stock_value = sum(r["stock_value"] for r in results)
    avg_margin = round(sum(r["margin_pct"] for r in results) / max(len(results), 1), 1)
    return {"products": results, "total_stock_value": total_stock_value, "avg_margin": avg_margin, "total_products": len(results)}


@router.get("/products/analytics/low-stock")
async def get_low_stock_products(current_user: dict = Depends(get_current_user)):
    products = await db.products.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(5000)
    low_stock = []
    out_of_stock = []
    for p in products:
        stock = int(p.get("quantity_in_stock", 0))
        reorder = int(p.get("reorder_level", 5))
        if stock == 0:
            out_of_stock.append({"id": p["id"], "name": p.get("name", ""), "sku": p.get("sku", ""), "reorder_level": reorder, "stock": 0, "vendor": p.get("vendor", "")})
        elif stock <= reorder:
            low_stock.append({"id": p["id"], "name": p.get("name", ""), "sku": p.get("sku", ""), "reorder_level": reorder, "stock": stock, "vendor": p.get("vendor", "")})
    return {"low_stock": low_stock, "out_of_stock": out_of_stock, "low_stock_count": len(low_stock), "out_of_stock_count": len(out_of_stock)}


# ============== SEED DATA ==============
