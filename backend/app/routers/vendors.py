from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from datetime import datetime, timezone
import uuid
from app.database import db
from app.auth import get_current_user
from app.models import *

router = APIRouter()

# ============== VENDOR ENDPOINTS ==============

@router.get("/vendors")
async def get_vendors(is_active: Optional[bool] = None, category: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if is_active is not None:
        query["is_active"] = is_active
    if category:
        query["category"] = category
    vendors = await db.vendors.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    return vendors

@router.get("/vendors/{vendor_id}")
async def get_vendor(vendor_id: str, current_user: dict = Depends(get_current_user)):
    vendor = await db.vendors.find_one({"id": vendor_id}, {"_id": 0})
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    # Get related POs
    pos = await db.purchase_orders.find({"vendor_id": vendor_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {**vendor, "purchase_orders": pos}

@router.post("/vendors")
async def create_vendor(data: VendorCreate, current_user: dict = Depends(get_current_user)):
    vendor = Vendor(**data.model_dump())
    doc = vendor.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.vendors.insert_one(doc)
    doc.pop("_id", None)
    return vendor

@router.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    result = await db.vendors.update_one({"id": vendor_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"message": "Vendor updated"}

@router.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.vendors.delete_one({"id": vendor_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"message": "Vendor deleted"}
