from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()


@router.get("/vendors")
async def get_vendors(current_user: dict = Depends(get_current_user)):
    vendors = await db.vendors.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    if not vendors:
        vendors = await _seed_vendors()
    return vendors


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


@router.get("/vendors/stats")
async def get_vendor_stats(current_user: dict = Depends(get_current_user)):
    vendors = await db.vendors.find({}, {"_id": 0}).to_list(500)
    return {
        "total": len(vendors),
        "active": len([v for v in vendors if v.get("status") == "active"]),
        "preferred": len([v for v in vendors if v.get("is_preferred")]),
        "total_spent": round(sum(v.get("total_spent", 0) for v in vendors), 2),
    }


# ============== WARRANTY TRACKING ==============

@router.get("/warranties")
async def get_warranties(current_user: dict = Depends(get_current_user)):
    warranties = await db.warranties.find({}, {"_id": 0}).sort("expiry_date", 1).to_list(500)
    if not warranties:
        warranties = await _seed_warranties()
    return warranties


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


@router.post("/warranties")
async def create_warranty(data: dict, current_user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    warranty = {
        "id": f"warr-{uuid.uuid4().hex[:8]}",
        "device_id": data.get("device_id", ""),
        "device_name": data.get("device_name", ""),
        "product_id": data.get("product_id", ""),
        "product_name": data.get("product_name", ""),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "vendor": data.get("vendor", ""),
        "serial_number": data.get("serial_number", ""),
        "warranty_type": data.get("warranty_type", "manufacturer"),
        "start_date": data.get("start_date", ""),
        "expiry_date": data.get("expiry_date", ""),
        "coverage_value": float(data.get("coverage_value", 0)),
        "coverage_details": data.get("coverage_details", ""),
        "notes": data.get("notes", ""),
        "status": "active",
        "created_at": now,
    }
    await db.warranties.insert_one(warranty)
    return {k: v for k, v in warranty.items() if k != "_id"}


@router.delete("/warranties/{warranty_id}")
async def delete_warranty(warranty_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.warranties.delete_one({"id": warranty_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"message": "Deleted"}


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

async def _seed_vendors():
    vendors = [
        {"id": "vendor-001", "name": "Ingram Micro Australia", "contact_name": "Michael Lee", "email": "orders@ingrammicro.com.au", "phone": "+61 2 9000 1234", "website": "https://au.ingrammicro.com", "account_number": "IM-AU-4521", "payment_terms": "net_30", "avg_lead_time_days": 3, "category": "distributor", "is_preferred": True, "total_orders": 45, "total_spent": 185400, "rating": 5, "status": "active"},
        {"id": "vendor-002", "name": "Synnex Australia", "contact_name": "Sarah Kim", "email": "sales@synnex.com.au", "phone": "+61 3 9000 5678", "website": "https://www.synnex.com.au", "account_number": "SYN-8723", "payment_terms": "net_30", "avg_lead_time_days": 4, "category": "distributor", "is_preferred": True, "total_orders": 32, "total_spent": 124500, "rating": 4, "status": "active"},
        {"id": "vendor-003", "name": "Leader Computers", "contact_name": "David Wong", "email": "trade@leader.com.au", "phone": "+61 2 9000 9012", "website": "https://www.leader.com.au", "account_number": "LC-3456", "payment_terms": "net_14", "avg_lead_time_days": 2, "category": "distributor", "is_preferred": False, "total_orders": 18, "total_spent": 67800, "rating": 4, "status": "active"},
        {"id": "vendor-004", "name": "Dicker Data", "contact_name": "James Chen", "email": "orders@dickerdata.com.au", "phone": "+61 2 9000 3456", "website": "https://www.dickerdata.com.au", "account_number": "DD-7890", "payment_terms": "net_30", "avg_lead_time_days": 3, "category": "distributor", "is_preferred": True, "total_orders": 28, "total_spent": 95200, "rating": 5, "status": "active"},
        {"id": "vendor-005", "name": "Scorptec Computers", "contact_name": "Alex Turner", "email": "trade@scorptec.com.au", "phone": "+61 3 9000 7890", "website": "https://www.scorptec.com.au", "account_number": "SC-2345", "payment_terms": "net_14", "avg_lead_time_days": 1, "category": "retailer", "is_preferred": False, "total_orders": 12, "total_spent": 23400, "rating": 3, "status": "active"},
    ]
    now = datetime.now(timezone.utc).isoformat()
    await db.vendors.delete_many({})
    for v in vendors:
        v["created_at"] = now
        v["updated_at"] = now
        await db.vendors.insert_one(v)
    return [{k: v for k, v in vendor.items() if k != "_id"} for vendor in vendors]


async def _seed_warranties():
    now = datetime.now(timezone.utc)
    warranties = [
        {"id": "warr-001", "device_id": "dev-001", "device_name": "ACME-DC-01", "client_id": "client-001", "client_name": "Acme Corporation", "vendor": "Dell", "serial_number": "SRV-2024-A1B2C3", "warranty_type": "manufacturer", "start_date": "2024-03-15", "expiry_date": (now + timedelta(days=365)).strftime("%Y-%m-%d"), "coverage_value": 2500, "coverage_details": "ProSupport Plus 4-hour onsite", "status": "active"},
        {"id": "warr-002", "device_id": "dev-002", "device_name": "ACME-WS-001", "client_id": "client-001", "client_name": "Acme Corporation", "vendor": "HP", "serial_number": "WS-2024-D4E5F6", "warranty_type": "manufacturer", "start_date": "2024-06-01", "expiry_date": (now + timedelta(days=180)).strftime("%Y-%m-%d"), "coverage_value": 800, "coverage_details": "HP Care Pack 3 year NBD", "status": "active"},
        {"id": "warr-003", "device_id": "dev-004", "device_name": "GF-DC-MAIN", "client_id": "client-003", "client_name": "Global Finance Ltd", "vendor": "HPE", "serial_number": "SRV-HPE-G7H8I9", "warranty_type": "extended", "start_date": "2023-01-01", "expiry_date": (now + timedelta(days=45)).strftime("%Y-%m-%d"), "coverage_value": 5000, "coverage_details": "HPE Foundation Care 24x7 4h", "status": "active"},
        {"id": "warr-004", "device_id": "dev-009", "device_name": "GF-LT-CFO01", "client_id": "client-003", "client_name": "Global Finance Ltd", "vendor": "Apple", "serial_number": "C02G23ABCDEF", "warranty_type": "applecare", "start_date": "2025-06-01", "expiry_date": (now + timedelta(days=540)).strftime("%Y-%m-%d"), "coverage_value": 550, "coverage_details": "AppleCare+ for Mac", "status": "active"},
        {"id": "warr-005", "device_id": "dev-005", "device_name": "HC-WS-REC01", "client_id": "client-004", "client_name": "HealthCare Plus", "vendor": "Dell", "serial_number": "WS-DELL-J0K1L2", "warranty_type": "manufacturer", "start_date": "2021-01-01", "expiry_date": (now - timedelta(days=120)).strftime("%Y-%m-%d"), "coverage_value": 0, "coverage_details": "Dell Basic 3yr - EXPIRED", "status": "expired"},
        {"id": "warr-006", "device_id": "dev-006", "device_name": "RETAIL-POS-01", "client_id": "client-005", "client_name": "RetailMax", "vendor": "Lenovo", "serial_number": "POS-LNV-M3N4O5", "warranty_type": "manufacturer", "start_date": "2025-03-01", "expiry_date": (now + timedelta(days=700)).strftime("%Y-%m-%d"), "coverage_value": 350, "coverage_details": "Lenovo Premier Support 3yr", "status": "active"},
    ]
    await db.warranties.delete_many({})
    for w in warranties:
        w["created_at"] = now.isoformat()
        await db.warranties.insert_one(w)
    return [{k: v for k, v in w.items() if k != "_id"} for w in warranties]
