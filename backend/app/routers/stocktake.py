from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user

router = APIRouter()

# ============== STOCKTAKE SYSTEM ==============

@router.get("/stocktake/sessions")
async def get_stocktake_sessions(status: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status
    sessions = await db.stocktake_sessions.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return sessions

@router.post("/stocktake/sessions")
async def create_stocktake_session(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.stocktake_sessions.count_documents({})
    products = await db.products.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(10000)
    snapshot_items = []
    for p in products:
        snapshot_items.append({
            "product_id": p["id"],
            "product_name": p.get("name", ""),
            "sku": p.get("sku", ""),
            "barcode": p.get("barcode", ""),
            "category": p.get("category", ""),
            "expected_qty": p.get("quantity_in_stock", 0),
            "counted_qty": None,
            "variance": None,
            "cost_price": p.get("cost_price", 0),
            "retail_price": p.get("retail_price", 0),
            "status": "pending",
            "counted_by": None,
            "counted_at": None,
            "notes": "",
        })
    session = {
        "id": str(uuid.uuid4()),
        "session_number": f"ST-{count + 1001:04d}",
        "name": data.get("name", f"Stocktake {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"),
        "description": data.get("description", ""),
        "location": data.get("location", "All Locations"),
        "category_filter": data.get("category_filter", ""),
        "status": "in_progress",
        "items": snapshot_items,
        "total_items": len(snapshot_items),
        "counted_items": 0,
        "variance_count": 0,
        "total_expected_value": sum(i["expected_qty"] * i["cost_price"] for i in snapshot_items),
        "total_counted_value": 0,
        "stock_loss_value": 0,
        "stock_gain_value": 0,
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "finalized_by": None,
        "finalized_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if data.get("category_filter"):
        session["items"] = [i for i in snapshot_items if i["category"] == data["category_filter"]]
        session["total_items"] = len(session["items"])
        session["total_expected_value"] = sum(i["expected_qty"] * i["cost_price"] for i in session["items"])
    await db.stocktake_sessions.insert_one(session)
    session.pop("_id", None)
    await _log_stocktake_audit(session["id"], "session_created", f"Stocktake session '{session['name']}' created with {session['total_items']} items", current_user)
    return session

@router.get("/stocktake/sessions/{session_id}")
async def get_stocktake_session(session_id: str, current_user: dict = Depends(get_current_user)):
    session = await db.stocktake_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Stocktake session not found")
    return session

@router.put("/stocktake/sessions/{session_id}/count")
async def update_stocktake_count(session_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    session = await db.stocktake_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Session is not in progress")
    product_id = data.get("product_id")
    counted_qty = int(data.get("counted_qty", 0))
    notes = data.get("notes", "")
    items = session.get("items", [])
    found = False
    for item in items:
        if item["product_id"] == product_id:
            item["counted_qty"] = counted_qty
            item["variance"] = counted_qty - item["expected_qty"]
            item["status"] = "counted"
            item["counted_by"] = current_user.get("name", "")
            item["counted_at"] = datetime.now(timezone.utc).isoformat()
            if notes:
                item["notes"] = notes
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Product not found in session")
    counted_items = sum(1 for i in items if i["status"] == "counted")
    variance_count = sum(1 for i in items if i.get("variance") and i["variance"] != 0)
    total_counted_value = sum((i.get("counted_qty") or 0) * i["cost_price"] for i in items if i["status"] == "counted")
    stock_loss_value = sum(abs(i["variance"]) * i["cost_price"] for i in items if i.get("variance") and i["variance"] < 0)
    stock_gain_value = sum(i["variance"] * i["cost_price"] for i in items if i.get("variance") and i["variance"] > 0)
    await db.stocktake_sessions.update_one({"id": session_id}, {"$set": {
        "items": items, "counted_items": counted_items, "variance_count": variance_count,
        "total_counted_value": round(total_counted_value, 2),
        "stock_loss_value": round(stock_loss_value, 2),
        "stock_gain_value": round(stock_gain_value, 2),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _log_stocktake_audit(session_id, "item_counted", f"Counted {counted_qty} of product '{data.get('product_name', product_id)}' (expected: {items[0]['expected_qty'] if found else '?'})", current_user)
    return {"message": "Count updated", "counted_items": counted_items, "total_items": len(items)}

@router.put("/stocktake/sessions/{session_id}/batch-count")
async def batch_stocktake_count(session_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    session = await db.stocktake_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session or session["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Invalid session")
    counts = data.get("counts", [])
    items = session.get("items", [])
    item_map = {i["product_id"]: i for i in items}
    for c in counts:
        pid = c.get("product_id")
        if pid in item_map:
            item_map[pid]["counted_qty"] = int(c.get("counted_qty", 0))
            item_map[pid]["variance"] = item_map[pid]["counted_qty"] - item_map[pid]["expected_qty"]
            item_map[pid]["status"] = "counted"
            item_map[pid]["counted_by"] = current_user.get("name", "")
            item_map[pid]["counted_at"] = datetime.now(timezone.utc).isoformat()
    items = list(item_map.values())
    counted_items = sum(1 for i in items if i["status"] == "counted")
    variance_count = sum(1 for i in items if i.get("variance") and i["variance"] != 0)
    total_counted_value = sum((i.get("counted_qty") or 0) * i["cost_price"] for i in items if i["status"] == "counted")
    stock_loss_value = sum(abs(i["variance"]) * i["cost_price"] for i in items if i.get("variance") and i["variance"] < 0)
    stock_gain_value = sum(i["variance"] * i["cost_price"] for i in items if i.get("variance") and i["variance"] > 0)
    await db.stocktake_sessions.update_one({"id": session_id}, {"$set": {
        "items": items, "counted_items": counted_items, "variance_count": variance_count,
        "total_counted_value": round(total_counted_value, 2),
        "stock_loss_value": round(stock_loss_value, 2),
        "stock_gain_value": round(stock_gain_value, 2),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _log_stocktake_audit(session_id, "batch_count", f"Batch counted {len(counts)} items", current_user)
    return {"message": f"Batch count updated for {len(counts)} items"}

@router.put("/stocktake/sessions/{session_id}/finalize")
async def finalize_stocktake(session_id: str, data: dict = {}, current_user: dict = Depends(get_current_user)):
    session = await db.stocktake_sessions.find_one({"id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Session is not in progress")
    apply_adjustments = data.get("apply_adjustments", True)
    items = session.get("items", [])
    adjustments_made = 0
    if apply_adjustments:
        for item in items:
            if item["status"] == "counted" and item.get("variance") and item["variance"] != 0:
                product = await db.products.find_one({"id": item["product_id"]}, {"_id": 0})
                if product:
                    old_stock = product.get("quantity_in_stock", 0)
                    new_stock = item["counted_qty"]
                    await db.products.update_one({"id": item["product_id"]}, {"$set": {
                        "quantity_in_stock": new_stock,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }})
                    movement = {
                        "id": str(uuid.uuid4()), "product_id": item["product_id"],
                        "product_name": item["product_name"], "type": "adjustment",
                        "quantity": abs(item["variance"]),
                        "previous_stock": old_stock, "new_stock": new_stock,
                        "reason": f"Stocktake adjustment ({session['session_number']})",
                        "reference": session_id, "created_by": current_user["id"],
                        "created_by_name": current_user.get("name", ""),
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    await db.stock_movements.insert_one(movement)
                    adjustments_made += 1
    await db.stocktake_sessions.update_one({"id": session_id}, {"$set": {
        "status": "completed", "finalized_by": current_user.get("name", ""),
        "finalized_at": datetime.now(timezone.utc).isoformat(),
        "adjustments_applied": apply_adjustments, "adjustments_count": adjustments_made,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await _log_stocktake_audit(session_id, "session_finalized", f"Stocktake finalized. {adjustments_made} adjustments {'applied' if apply_adjustments else 'recorded (not applied)'}.", current_user)
    return {"message": "Stocktake finalized", "adjustments_made": adjustments_made}

@router.delete("/stocktake/sessions/{session_id}")
async def delete_stocktake_session(session_id: str, current_user: dict = Depends(get_current_user)):
    await db.stocktake_sessions.delete_one({"id": session_id})
    return {"message": "Session deleted"}

@router.get("/stocktake/sessions/{session_id}/audit-log")
async def get_stocktake_audit_log(session_id: str, current_user: dict = Depends(get_current_user)):
    logs = await db.stocktake_audit.find({"session_id": session_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return logs

@router.get("/stocktake/reports/summary")
async def get_stocktake_report_summary(current_user: dict = Depends(get_current_user)):
    sessions = await db.stocktake_sessions.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    completed = [s for s in sessions if s["status"] == "completed"]
    total_loss = sum(s.get("stock_loss_value", 0) for s in completed)
    total_gain = sum(s.get("stock_gain_value", 0) for s in completed)
    products = await db.products.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(10000)
    stock_in_hand_cost = sum(p.get("quantity_in_stock", 0) * p.get("cost_price", 0) for p in products)
    stock_in_hand_retail = sum(p.get("quantity_in_stock", 0) * p.get("retail_price", 0) for p in products)
    on_order = await db.purchase_orders.find({"status": {"$in": ["submitted", "partial"]}}, {"_id": 0}).to_list(5000)
    on_order_value = sum(po.get("total", 0) for po in on_order)
    on_order_items = sum(sum(li.get("quantity", 0) - li.get("received_qty", 0) for li in po.get("line_items", [])) for po in on_order)
    low_stock = [p for p in products if p.get("quantity_in_stock", 0) <= p.get("reorder_level", 5)]
    out_of_stock = [p for p in products if p.get("quantity_in_stock", 0) <= 0]
    return {
        "total_sessions": len(sessions), "completed_sessions": len(completed),
        "in_progress_sessions": len([s for s in sessions if s["status"] == "in_progress"]),
        "total_stock_loss": round(total_loss, 2), "total_stock_gain": round(total_gain, 2),
        "net_variance": round(total_gain - total_loss, 2),
        "stock_in_hand_cost": round(stock_in_hand_cost, 2),
        "stock_in_hand_retail": round(stock_in_hand_retail, 2),
        "on_order_value": round(on_order_value, 2), "on_order_items": on_order_items,
        "total_products": len(products), "low_stock_count": len(low_stock),
        "out_of_stock_count": len(out_of_stock),
        "low_stock_products": [{"id": p["id"], "name": p["name"], "sku": p.get("sku", ""), "qty": p.get("quantity_in_stock", 0), "reorder": p.get("reorder_level", 5)} for p in low_stock[:10]],
        "recent_sessions": [{"id": s["id"], "session_number": s["session_number"], "name": s["name"], "status": s["status"], "total_items": s["total_items"], "counted_items": s.get("counted_items", 0), "stock_loss_value": s.get("stock_loss_value", 0), "created_at": s["created_at"]} for s in sessions[:5]],
    }

async def _log_stocktake_audit(session_id: str, action: str, details: str, user: dict):
    log = {
        "id": str(uuid.uuid4()), "session_id": session_id, "action": action,
        "details": details, "user_id": user["id"], "user_name": user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stocktake_audit.insert_one(log)
