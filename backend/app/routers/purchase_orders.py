from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
from app.database import db, AVATARS_DIR
from app.auth import get_current_user, hash_password, verify_password, create_token
from app.services.activity import log_activity, ticket_audit, ACHIEVEMENT_DEFINITIONS
from app.models import *

router = APIRouter()

# ============== PURCHASE ORDER ENDPOINTS ==============

@router.get("/purchase-orders/stats")
async def get_po_stats(current_user: dict = Depends(get_current_user)):
    all_pos = await db.purchase_orders.find({}, {"_id": 0}).to_list(10000)
    total = len(all_pos)
    draft = len([p for p in all_pos if p.get("status") == "draft"])
    submitted = len([p for p in all_pos if p.get("status") == "submitted"])
    received = len([p for p in all_pos if p.get("status") == "received"])
    total_value = sum(p.get("total", 0) for p in all_pos)
    pending_value = sum(p.get("total", 0) for p in all_pos if p.get("status") in ("draft", "submitted"))
    return {
        "total": total, "draft": draft, "submitted": submitted, "received": received,
        "total_value": round(total_value, 2), "pending_value": round(pending_value, 2)
    }

@router.get("/purchase-orders")
async def get_purchase_orders(status: Optional[str] = None, search: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status
    if search:
        query["$or"] = [
            {"po_number": {"$regex": search, "$options": "i"}},
            {"vendor": {"$regex": search, "$options": "i"}},
        ]
    pos = await db.purchase_orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return pos

@router.post("/purchase-orders")
async def create_purchase_order(data: dict, current_user: dict = Depends(get_current_user)):
    count = await db.purchase_orders.count_documents({})
    po = {
        "id": str(uuid.uuid4()),
        "po_number": f"PO-{count + 1001:04d}",
        "vendor": data.get("vendor", ""),
        "vendor_contact": data.get("vendor_contact", ""),
        "vendor_email": data.get("vendor_email", ""),
        "status": data.get("status", "draft"),
        "line_items": data.get("line_items", []),
        "subtotal": float(data.get("subtotal", 0)),
        "tax": float(data.get("tax", 0)),
        "shipping": float(data.get("shipping", 0)),
        "total": float(data.get("total", 0)),
        "notes": data.get("notes", ""),
        "ship_to": data.get("ship_to", ""),
        "expected_delivery": data.get("expected_delivery", ""),
        "client_id": data.get("client_id", ""),
        "client_name": data.get("client_name", ""),
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.purchase_orders.insert_one(po)
    po.pop("_id", None)
    return po

@router.get("/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str, current_user: dict = Depends(get_current_user)):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return po

@router.put("/purchase-orders/{po_id}")
async def update_purchase_order(po_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    allowed = {"vendor", "vendor_contact", "vendor_email", "status", "line_items", "subtotal",
               "tax", "shipping", "total", "notes", "ship_to", "expected_delivery", "client_id", "client_name"}
    update = {k: v for k, v in data.items() if k in allowed}
    for f in ("subtotal", "tax", "shipping", "total"):
        if f in update:
            update[f] = float(update[f])
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.purchase_orders.update_one({"id": po_id}, {"$set": update})
    return {"message": "Purchase order updated"}

@router.delete("/purchase-orders/{po_id}")
async def delete_purchase_order(po_id: str, current_user: dict = Depends(get_current_user)):
    await db.purchase_orders.delete_one({"id": po_id})
    return {"message": "Purchase order deleted"}

